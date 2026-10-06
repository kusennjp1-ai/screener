"""Offline workflow, staging and timed artifact transport checks."""
from copy import deepcopy
import io
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import textwrap

import pytest

from app.scripts import price_pilot_push as script
from app.services import price_pilot_push as push
from app.services.bounded_price_recovery import encoded
from tests.unit.test_price_pilot_push import (
    Fixture, SOURCE, ACTIVATION, REGISTER_RUN, WORKFLOW_ID, NOW, REPOSITORY_ID,
)

ROOT=Path(__file__).resolve().parents[3]


def test_classification_only_admits_first_unarmed_source_or_valid_intent():
    f=Fixture()
    assert script.classify(f.git,f.context,f.event)['mode']=='activation'
    del f.git.files[ACTIVATION,push.INTENT_PATH]
    with pytest.raises(ValueError,match='already consumed'):
        script.classify(f.git,f.context,f.event)
    assert script.classify(f.git,f.source_context,f.event)=={
        'mode':'source','source_sha':SOURCE,'intent_sha256':''}


def test_source_registration_requires_exact_complete_first_run():
    f=Fixture();run=deepcopy(f.registration_run)
    run.update(status='in_progress',conclusion=None)
    f.responses[f'actions/runs/{REGISTER_RUN}']=run
    f.responses[f'actions/runs/{REGISTER_RUN}/attempts/1']=run
    inventory=f.responses[f'actions/workflows/{WORKFLOW_ID}/runs?per_page=100']
    inventory.update(total_count=1,workflow_runs=[run])
    receipt=script.register(f.git,f.source_context,f.api,NOW)
    assert receipt['provider_requests']==0
    assert receipt['capture_approved'] is False
    inventory['total_count']=2
    with pytest.raises(ValueError,match='Incomplete'):
        script.register(f.git,f.source_context,f.api,NOW)
    inventory.update(total_count=2,workflow_runs=[run,deepcopy(run)])
    with pytest.raises(ValueError,match='first complete'):
        script.register(f.git,f.source_context,f.api,NOW)


def prior_fixture(f):
    run={'id':push.PRIOR_RUN,'head_sha':push.PRIOR_HEAD,'status':'completed','conclusion':'success',
         'repository':{'id':REPOSITORY_ID,'full_name':push.REPOSITORY}}
    artifact={'id':push.PRIOR_ARTIFACT,'name':push.PRIOR_ARTIFACT_NAME,'expired':False,
         'size_in_bytes':push.PRIOR_BYTES,'digest':'sha256:'+push.PRIOR_SHA,
         'workflow_run':{'id':push.PRIOR_RUN,'head_sha':push.PRIOR_HEAD,
                         'repository_id':REPOSITORY_ID,'head_repository_id':REPOSITORY_ID}}
    f.responses[f'actions/runs/{push.PRIOR_RUN}']=run
    f.responses[f'actions/runs/{push.PRIOR_RUN}/artifacts?per_page=100']={
        'total_count':1,'artifacts':[artifact]}
    return run,artifact


@pytest.mark.parametrize('field,value',[
    ('id',1),('name','latest'),('expired',True),('digest','sha256:'+'0'*64),
    ('size_in_bytes',push.PRIOR_BYTES+1),('size_in_bytes',True),
])
def test_prior_release_location_cannot_change_identity(field,value):
    f=Fixture();_,artifact=prior_fixture(f)
    assert script.verify_prior_reference(f.approval,f.api)==artifact
    artifact[field]=value
    with pytest.raises(ValueError): script.verify_prior_reference(f.approval,f.api)


@pytest.mark.parametrize('field,value',[
    ('id',1),('head_sha','e'*40),('repository_id',1),('head_repository_id',1),
])
def test_prior_archive_producer_is_exact(field,value):
    f=Fixture();_,artifact=prior_fixture(f)
    artifact['workflow_run'][field]=value
    with pytest.raises(ValueError): script.verify_prior_reference(f.approval,f.api)


def test_invalid_activation_stops_before_any_remote_read_or_output(tmp_path):
    f=Fixture();f.git.parent_list=['e'*40]
    def forbidden(*args): raise AssertionError('remote read must not occur')
    output=tmp_path/'new-stage'
    with pytest.raises(ValueError,match='parent'):
        script.stage(f.git,f.context,f.event,output,forbidden,NOW)
    assert not output.exists()


def test_noncanonical_intent_stops_before_remote_read(tmp_path):
    f=Fixture();raw=json.dumps(f.approval,indent=2).encode()
    f.git.files[ACTIVATION,push.INTENT_PATH]=raw
    f.git.commit_message=push.activation_message(SOURCE,push.sha(raw))
    def forbidden(*args): raise AssertionError('remote read must not occur')
    with pytest.raises(ValueError,match='canonical'):
        script.stage(f.git,f.context,f.event,tmp_path/'new',forbidden,NOW)


@pytest.mark.parametrize('code,maximum,seconds,expected',[
    ("import sys; sys.stdout.buffer.write(b'abc')",10,1,None),
    ("import sys; sys.stdout.buffer.write(b'x'*100)",10,1,'size'),
    ("import sys; sys.exit(1)",10,1,'failed'),
    ("import time; time.sleep(10)",10,.05,'deadline'),
])
def test_artifact_stream_timeout_size_and_no_retry(monkeypatch,code,maximum,seconds,expected):
    real_popen=subprocess.Popen;children=[];calls=[]
    def synthetic(command,**kwargs):
        calls.append(command)
        child=real_popen([sys.executable,'-c',code],**kwargs)
        children.append(child);return child
    monkeypatch.setattr(push.subprocess,'Popen',synthetic)
    output=io.BytesIO();started=time.monotonic()
    if expected:
        with pytest.raises(ValueError,match=expected):
            push.stream_artifact(123,output,maximum=maximum,seconds=seconds)
    else:
        assert push.stream_artifact(123,output,maximum=maximum,seconds=seconds)==3
        assert output.getvalue()==b'abc'
    assert len(calls)==1
    assert calls[0]==['gh','api',f'repos/{push.REPOSITORY}/actions/artifacts/123/zip']
    assert children[0].poll() is not None
    if expected=='deadline': assert time.monotonic()-started<2


def test_capture_workflow_has_finite_gates_and_read_only_permissions():
    text=(ROOT/push.WORKFLOW).read_text()
    assert 'branches: ['+push.BRANCH+']' in text
    trigger=text.split('on:',1)[1].split('permissions:',1)[0]
    assert 'schedule:' not in trigger and 'workflow_dispatch:' not in trigger
    permissions=text.split('permissions:',1)[1].split('concurrency:',1)[0]
    assert set(re.findall(r'  (\w+): (\w+)',permissions))=={('contents','read'),('actions','read')}
    assert "if: needs.classify.outputs.mode == 'source'" in text
    assert "if: needs.classify.outputs.mode == 'activation'" in text
    assert text.count('run --execute')==1
    capture=text.split('      - name: '+push.CAPTURE_STEP,1)[1]
    assert 'cd "$RUNNER_TEMP/price-pilot-stage/source"' in capture
    assert '--admission-sha256 "$ADMISSION_SHA256"' in capture
    proposal=re.search(r'--proposal (\S+)',capture).group(1)
    assert (ROOT/proposal).is_file()
    assert '127.0.0.1:6379:6379' in text
    assert 'retention-days: 14' in text
    assert 'persist-credentials: false' in text
    policy=json.loads((ROOT/push.POLICY_PATH).read_bytes())
    assert policy['enabled'] is False
    template=json.loads((ROOT/push.TEMPLATE_PATH).read_bytes())
    assert template['capture_approved'] is False
    assert all(row['review_status']=='pending_owner_review' for row in template['identity_records'])
    assert not (ROOT/push.INTENT_PATH).exists()


@pytest.mark.parametrize('ready_after,expected_calls,expected_code,hang_first',[
    (1,1,0,False),(3,3,0,False),(11,10,1,False),(2,2,0,True),
])
def test_redis_readiness_finishes_before_one_shot_capture(tmp_path,ready_after,expected_calls,expected_code,hang_first):
    workflow=(ROOT/push.WORKFLOW).read_text()
    step=workflow.split('      - name: Start the isolated job budget\n',1)[1].split('      - name: '+push.CAPTURE_STEP,1)[0]
    script=textwrap.dedent(step.split('        run: |\n',1)[1])
    assert 'for readiness_attempt in {1..10}' in script
    assert 'timeout --kill-after=1s 2s docker exec price-pilot-budget redis-cli --raw PING' in script
    assert 'run --execute' not in script and 'consume_attempt' not in script
    # /tmp is noexec in the approved offline container. Interpret exported
    # functions through bash; retain the real timeout, never execute tempfiles.
    mocks='''
docker() {
  if [[ "$1" == run ]]; then return 0; fi
  [[ "$*" == "exec price-pilot-budget redis-cli --raw PING" ]] || return 2
  count=0; [[ ! -f "$PROBE_COUNT" ]] || read -r count < "$PROBE_COUNT"
  count=$((count+1)); echo "$count" > "$PROBE_COUNT"
  if [[ "$HANG_FIRST" == true ]] && (( count == 1 )); then command sleep 10; fi
  if (( count >= READY_AFTER )); then echo PONG; else return 1; fi
}
export -f docker
sleep() { return 0; }
timeout() {
  [[ "$1" == --kill-after=1s && "$2" == 2s ]] || return 2
  shift 2
  command timeout --kill-after=1s 2s bash -c '"$@"' bash "$@"
}
'''
    count=tmp_path/'count'
    env={**os.environ,'PROBE_COUNT':str(count),'READY_AFTER':str(ready_after),
         'HANG_FIRST':'true' if hang_first else 'false'}
    started=time.monotonic()
    result=subprocess.run(['bash','-c',mocks+script],env=env,capture_output=True,text=True,timeout=5)
    assert result.returncode==expected_code
    assert int(count.read_text())==expected_calls
    assert list(tmp_path.iterdir())==[count]
    if hang_first: assert 1.5<=time.monotonic()-started<5
    if expected_code: assert 'acquisition will not start' in result.stderr
