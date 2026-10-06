"""Finite C-source / R-intent / I-activation checks; no provider calls here.

The owner reviews C and the exact R bytes before the intent-only push. The
registration receipt proves source/run identity, not owner approval by itself.
"""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import io
import json
import os
from pathlib import Path
import re
import selectors
import subprocess
import tempfile
import time
import zipfile

from .bounded_price_recovery import PROPOSAL_SHA256, encoded, sha
from .price_pilot_admission import REPOSITORY, REPOSITORY_ID, complete, positive

WORKFLOW = '.github/workflows/four-symbol-price-push.yml'
BRANCH = 'capture/four-symbol-price-pilot'
INTENT_PATH = '.github/price-pilot-intent.json'
TEMPLATE_PATH = '.github/price-pilot-push-intent.template.json'
POLICY_PATH = '.github/price-pilot-push-policy.json'
REGISTER_JOB = 'register-price-source'
CAPTURE_JOB = 'capture-four-symbols'
CAPTURE_STEP = 'Acquire four-symbol proof once'
REGISTRATION_MAX_AGE = timedelta(hours=2)
PRIOR_RUN = 37456692717
PRIOR_SHA = '1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb'
PRIOR_ARTIFACT = 11421722413
PRIOR_ARTIFACT_NAME = 'github-pages-37456692717-1'
PRIOR_HEAD = '8a490df5b0a873637781a8e4e5351cece9313f37'
PRIOR_BYTES = 363691194
MAX_PRIOR_BYTES = 384 * 1024 * 1024


class GitSource:
    def __init__(self, root): self.root = Path(root)
    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root, stderr=subprocess.PIPE)
    def show(self, commit, path): return self.git('show', f'{commit}:{path}')
    def exists(self, commit, path):
        return bool(self.git('ls-tree', commit, '--', path).strip())
    def tree(self, commit): return self.git('rev-parse', f'{commit}^{{tree}}').decode().strip()
    def parents(self, commit): return self.git('rev-list', '--parents', '-n', '1', commit).decode().strip().split()[1:]
    def changes(self, before, after): return self.git('diff-tree', '--no-commit-id', '--name-status', '-r', before, after).decode().splitlines()
    def message(self, commit): return self.git('show', '-s', '--format=%B', commit).decode().rstrip('\n')


def activation_message(source, intent_sha):
    return f'Activate bounded four-symbol price intent\n\nPrice-Pilot-Source: {source}\nPrice-Pilot-Intent-SHA256: {intent_sha}'


def instant(value):
    result = datetime.fromisoformat(value.replace('Z', '+00:00'))
    if result.tzinfo is None: raise ValueError('Proof clock must have a timezone')
    return result.astimezone(timezone.utc)


def push_context(env, event):
    if (env.get('GITHUB_ACTIONS') != 'true' or env.get('GITHUB_EVENT_NAME') != 'push'
            or env.get('GITHUB_REPOSITORY') != REPOSITORY
            or env.get('GITHUB_REF') != 'refs/heads/' + BRANCH
            or event.get('ref') != env['GITHUB_REF'] or event.get('repository', {}).get('id') != REPOSITORY_ID
            or event.get('deleted') is not False or event.get('forced') is not False):
        raise ValueError('Unexpected repository/branch or forced/deleted push')
    head = env.get('GITHUB_SHA', '')
    if (not re.fullmatch(r'[a-f0-9]{40}', head) or event.get('after') != head
            or env.get('GITHUB_WORKFLOW_SHA') != head
            or env.get('GITHUB_WORKFLOW_REF') != f'{REPOSITORY}/{WORKFLOW}@refs/heads/{BRANCH}'):
        raise ValueError('Push and workflow source identity disagree')
    try:
        run_id, number, attempt = [int(env[key]) for key in ('GITHUB_RUN_ID','GITHUB_RUN_NUMBER','GITHUB_RUN_ATTEMPT')]
    except (KeyError, ValueError): raise ValueError('Missing finite push run identity') from None
    if (any(env[key]!=str(value) for key,value in zip(('GITHUB_RUN_ID','GITHUB_RUN_NUMBER','GITHUB_RUN_ATTEMPT'),(run_id,number,attempt)))
            or not positive(run_id) or number not in (1,2) or attempt != 1):
        raise ValueError('Second, retried or unbounded acquisition attempt is spent')
    return {'repository':REPOSITORY,'repository_id':REPOSITORY_ID,'workflow_path':WORKFLOW,
            'branch':BRANCH,'activation_sha':head,'run_id':run_id,'run_number':number,'run_attempt':attempt}


def checked_run(value, *, run_id, number, head, workflow_id=None, terminal=False):
    if (any(not positive(value.get(key)) for key in ('id','run_number','run_attempt','workflow_id'))
            or value.get('id') != run_id or value.get('run_number') != number or value.get('run_attempt') != 1
            or value.get('head_sha') != head or value.get('head_branch') != BRANCH or value.get('path') != WORKFLOW
            or value.get('event') != 'push' or not positive(value.get('workflow_id'))
            or (workflow_id is not None and value.get('workflow_id') != workflow_id)
            or value.get('repository', {}).get('id') != REPOSITORY_ID
            or value.get('head_repository', {}).get('id') != REPOSITORY_ID
            or value.get('repository', {}).get('full_name') != REPOSITORY
            or value.get('head_repository', {}).get('full_name') != REPOSITORY
            or value.get('status') != ('completed' if terminal else 'in_progress')
            or value.get('conclusion') != ('success' if terminal else None)):
        raise ValueError('Run is mismatched, retried, canceled or uncertain')
    return value


def check_policy(git, source):
    value = json.loads(git.show(source, POLICY_PATH))
    if value != {'schema_version':'four-symbol-price-push-policy-v1','branch':BRANCH,'enabled':True}:
        raise ValueError('Reviewed source policy remains disabled or changed')


def validate_intent(intent, template, source):
    if intent.get('schema_version') != 'four-symbol-price-pilot-admission-v1' or intent.get('proposal_sha256') != PROPOSAL_SHA256:
        raise ValueError('Intent has another acquisition envelope')
    if intent.get('controller_sha') != source or intent.get('capture_approved') is not True:
        raise ValueError('Intent source is unapproved or capture remains disabled')
    budget = intent.get('provider_budget', {})
    if (set(budget)!={'scope','review_status','review_note'} or budget.get('scope') != 'isolated_ci_job'
            or budget.get('review_status') != 'approved_for_ten_request_pilot'
            or not isinstance(budget.get('review_note'),str) or not budget['review_note'].strip()):
        raise ValueError('Exact isolated provider-budget review is missing')
    reg = intent.get('source_registration', {})
    if (set(reg)!={'run_id','workflow_id','artifact_id','artifact_sha256'} or not positive(reg.get('run_id'))
            or not positive(reg.get('workflow_id')) or not positive(reg.get('artifact_id'))
            or not re.fullmatch(r'[a-f0-9]{64}', reg.get('artifact_sha256',''))):
        raise ValueError('Exact immutable registration reference is missing')
    expected_github = {'review_status':'approved_finite_capture_run','repository':REPOSITORY,
        'workflow_path':WORKFLOW,'workflow_id':reg['workflow_id'],'branch':BRANCH,
        'expected_run_number':2,'expected_run_attempt':1}
    if intent.get('github_admission') != expected_github:
        raise ValueError('Finite intent run binding changed')
    if any(type(intent['github_admission'].get(k)) is not int for k in ('workflow_id','expected_run_number','expected_run_attempt')):
        raise ValueError('Finite intent run numbers must be exact integers')
    prior = intent.get('prior_release', {})
    if prior != {'run_id':PRIOR_RUN,'artifact_id':PRIOR_ARTIFACT,
                 'artifact_name':PRIOR_ARTIFACT_NAME,'artifact_sha256':PRIOR_SHA}:
        raise ValueError('Exact retained prior release reference is required')
    normalized = deepcopy(intent)
    # Only separately reviewed approval state and immutable reference fields may
    # differ from the source's template. All instruments/history bounds stay exact.
    for name in ('controller_sha','capture_approved','provider_budget','github_admission','source_registration'):
        normalized[name] = template[name]
    for row in normalized.get('identity_records', []):
        if row.get('review_status') not in ('pending_owner_review','approved_for_price_identity_validation'):
            raise ValueError('Unknown identity review state')
        row['review_status'] = 'pending_owner_review'
    if normalized != template:
        raise ValueError('Intent edits changed the reviewed source template or scope')
    return reg


def validate_activation(git, context, event, intent_raw, *, reviewed_intent_sha=None):
    intent = json.loads(intent_raw)
    source = intent.get('controller_sha', '')
    if not re.fullmatch(r'[a-f0-9]{40}', source): raise ValueError('Exact C source commit is required')
    activation = context['activation_sha']
    digest = sha(intent_raw)
    if reviewed_intent_sha is not None and digest != reviewed_intent_sha:
        raise ValueError('Intent bytes differ from the separately reviewed digest')
    if event.get('created') is not False or event.get('before') != source or context['run_number'] != 2:
        raise ValueError('Activation must be the one intent-only push after C')
    if git.parents(activation) != [source] or git.changes(source, activation) != ['A\t'+INTENT_PATH]:
        raise ValueError('Activation parent or one-file diff changed')
    if git.exists(source, INTENT_PATH) or git.show(activation, INTENT_PATH) != intent_raw:
        raise ValueError('Source already had intent or pushed intent bytes changed')
    if git.message(activation) != activation_message(source, digest):
        raise ValueError('Activation message does not bind the exact reviewed intent')
    if git.show(source, WORKFLOW) != git.show(activation, WORKFLOW):
        raise ValueError('Activation changed the reviewed workflow')
    check_policy(git, source)
    template_raw = git.show(source, TEMPLATE_PATH)
    reg = validate_intent(intent, json.loads(template_raw), source)
    return intent, {'source_sha':source,'source_tree':git.tree(source),'intent_sha256':digest,
                    'template_sha256':sha(template_raw),'registration':reg}


def registration_receipt(git, context, run, created_at):
    source = context['activation_sha']
    if context['run_number'] != 1 or git.exists(source, INTENT_PATH):
        raise ValueError('Only the first unarmed source push can register')
    checked_run(run,run_id=context['run_id'],number=1,head=source)
    policy = json.loads(git.show(source, POLICY_PATH))
    return {'schema_version':'four-symbol-source-registration-v1','context':context,
            'workflow_id':run['workflow_id'],'source_sha':source,'source_tree':git.tree(source),
            'template_sha256':sha(git.show(source,TEMPLATE_PATH)),
            'policy_sha256':sha(git.show(source,POLICY_PATH)), 'capture_policy_enabled':policy.get('enabled') is True,
            'created_at':created_at.isoformat(),'intent_present':False,'capture_approved':False,'provider_requests':0}


def read_registration_zip(raw, expected_sha):
    if len(raw)>256*1024 or sha(raw)!=expected_sha: raise ValueError('Registration archive hash/size changed')
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        entries=archive.infolist()
        if len(entries)!=1 or entries[0].filename!='source-registration.json' or entries[0].file_size>64*1024:
            raise ValueError('Unexpected registration archive members')
        return json.loads(archive.read(entries[0]))


def verify_registered_attempt(git, context, binding, api, download, now):
    base=f'repos/{REPOSITORY}'
    source=binding['source_sha'];ref=binding['registration'];wid=ref['workflow_id']
    current=api(f"{base}/actions/runs/{context['run_id']}")
    exact=api(f"{base}/actions/runs/{context['run_id']}/attempts/1")
    for row in (current,exact):
        checked_run(row,run_id=context['run_id'],number=2,head=context['activation_sha'],workflow_id=wid)
    workflow=api(f'{base}/actions/workflows/{wid}')
    if (workflow.get('id'),workflow.get('path'),workflow.get('state'))!=(wid,WORKFLOW,'active'):
        raise ValueError('Push workflow authority changed')
    runs=complete(api(f'{base}/actions/workflows/{wid}/runs?per_page=100'),'workflow_runs')
    if len(runs)!=2 or {r.get('id') for r in runs}!={ref['run_id'],context['run_id']}:
        raise ValueError('Additional, missing or uncertain push history consumes admission')
    previous=api(f"{base}/actions/runs/{ref['run_id']}/attempts/1")
    checked_run(previous,run_id=ref['run_id'],number=1,head=source,workflow_id=wid,terminal=True)
    for row in runs:
        checked_run(row,run_id=row['id'],number=1 if row['id']==ref['run_id'] else 2,
            head=source if row['id']==ref['run_id'] else context['activation_sha'],workflow_id=wid,terminal=row['id']==ref['run_id'])
    jobs=complete(api(f"{base}/actions/runs/{ref['run_id']}/attempts/1/jobs?per_page=100"),'jobs')
    registration=[j for j in jobs if j.get('name')==REGISTER_JOB]
    capture=[j for j in jobs if j.get('name')==CAPTURE_JOB]
    if (len(registration)!=1 or registration[0].get('conclusion')!='success'
            or len(capture)!=1 or capture[0].get('conclusion')!='skipped'
            or any(not positive(j.get('id')) or j.get('status')!='completed' or j.get('head_sha')!=source
                or j.get('run_id')!=ref['run_id'] or type(j.get('run_attempt')) is not int
                or j.get('run_attempt')!=1 for j in registration+capture)):
        raise ValueError('Registration did not prove an unarmed non-capture run')
    artifacts=complete(api(f"{base}/actions/runs/{ref['run_id']}/artifacts?per_page=100"),'artifacts')
    selected=[a for a in artifacts if a.get('id')==ref['artifact_id']]
    if len(selected)!=1: raise ValueError('Pinned registration artifact is missing')
    artifact=selected[0];producer=artifact.get('workflow_run',{})
    if (artifact.get('name')!=f"price-pilot-source-{ref['run_id']}-1" or artifact.get('expired') is not False
            or artifact.get('digest')!='sha256:'+ref['artifact_sha256'] or not 0<artifact.get('size_in_bytes',0)<=256*1024
            or producer.get('id')!=ref['run_id'] or producer.get('head_sha')!=source):
        raise ValueError('Registration artifact producer/hash/size changed')
    proof=read_registration_zip(download(ref['artifact_id']),ref['artifact_sha256'])
    source_context = {**context,'activation_sha':source,'run_id':ref['run_id'],'run_number':1}
    if (proof.get('schema_version')!='four-symbol-source-registration-v1' or proof.get('source_sha')!=source
            or proof.get('source_tree')!=binding['source_tree'] or proof.get('template_sha256')!=binding['template_sha256']
            or proof.get('workflow_id')!=wid or proof.get('context')!=source_context
            or any(not positive(proof.get('context',{}).get(key)) for key in ('repository_id','run_id','run_number','run_attempt'))
            or proof.get('capture_approved') is not False or type(proof.get('provider_requests')) is not int
            or proof.get('provider_requests')!=0
            or proof.get('intent_present') is not False or proof.get('capture_policy_enabled') is not True
            or proof.get('policy_sha256')!=sha(git.show(source,POLICY_PATH))):
        raise ValueError('Registration proof does not bind the reviewed source/template')
    created=instant(proof['created_at']);artifact_time=instant(artifact['created_at'])
    job=registration[0]
    if (not instant(previous['created_at'])<=instant(previous['run_started_at'])<=instant(job['started_at'])
            <=created<=artifact_time<=instant(job['completed_at'])<=instant(previous['updated_at'])<=now
            or now-created>REGISTRATION_MAX_AGE):
        raise ValueError('Registration proof is stale or its clock is invalid')
    current_artifacts=complete(api(f"{base}/actions/runs/{context['run_id']}/artifacts?per_page=100"),'artifacts')
    if any(a.get('name','').startswith('price-pilot-terminal-') for a in current_artifacts):
        raise ValueError('Current acquisition already has terminal proof and is spent')
    return proof


def stream_artifact(artifact_id, destination, *, maximum, seconds=180):
    """Bounded exact-repository read, without alternate endpoint or retry."""
    if not positive(artifact_id): raise ValueError('Invalid immutable artifact ID')
    with tempfile.TemporaryFile() as errors:
        process=subprocess.Popen(['gh','api',f'repos/{REPOSITORY}/actions/artifacts/{artifact_id}/zip'],stdout=subprocess.PIPE,stderr=errors)
        deadline=time.monotonic()+seconds; size=0
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(process.stdout,selectors.EVENT_READ)
                while True:
                    left=deadline-time.monotonic()
                    if left<=0 or not selector.select(left): raise ValueError('Artifact download deadline exceeded')
                    chunk=os.read(process.stdout.fileno(),min(1024*1024,maximum-size+1))
                    if not chunk: break
                    size+=len(chunk)
                    if size>maximum: raise ValueError('Artifact exceeds bounded download size')
                    destination.write(chunk)
            left=deadline-time.monotonic()
            if left<=0 or process.wait(timeout=left)!=0:
                raise ValueError('Artifact read failed; do not retry through another route')
            return size
        finally:
            if process.poll() is None: process.kill();process.wait()
            process.stdout.close()


def download_artifact(artifact_id, *, maximum=256*1024):
    output=io.BytesIO()
    stream_artifact(artifact_id,output,maximum=maximum,seconds=30)
    return output.getvalue()


def validated_capture_context(approval, admission_sha, *, environment, event, git, api, download, now):
    context=push_context(environment,event)
    if environment.get('GITHUB_JOB')!=CAPTURE_JOB: raise ValueError('Unexpected capture job')
    raw=git.show(context['activation_sha'],INTENT_PATH)
    if raw!=encoded(approval) or sha(raw)!=admission_sha:
        raise ValueError('Capture requires the exact canonical reviewed intent bytes')
    intent,binding=validate_activation(git,context,event,raw,reviewed_intent_sha=admission_sha)
    if git.git('rev-parse','HEAD').decode().strip()!=binding['source_sha']:
        raise ValueError('Capture must execute the verified C source checkout')
    verify_registered_attempt(git,context,binding,api,download,now)
    branch=api(f'repos/{REPOSITORY}/git/ref/heads/{BRANCH}')
    if (branch.get('ref')!='refs/heads/'+BRANCH or branch.get('object',{}).get('sha')!=context['activation_sha']
            or branch.get('object',{}).get('type')!='commit'):
        raise ValueError('Activation branch advanced after intent review')
    jobs=complete(api(f"repos/{REPOSITORY}/actions/runs/{context['run_id']}/attempts/1/jobs?per_page=100"),'jobs')
    selected=[j for j in jobs if j.get('name')==CAPTURE_JOB]
    if len(selected)!=1: raise ValueError('Missing or duplicated capture job')
    job=selected[0];steps=[s for s in job.get('steps',[]) if s.get('name')==CAPTURE_STEP]
    if (not positive(job.get('id')) or job.get('run_id')!=context['run_id'] or job.get('head_sha')!=context['activation_sha']
            or type(job.get('run_attempt')) is not int or job.get('run_attempt')!=1 or job.get('status')!='in_progress' or job.get('conclusion') is not None
            or not positive(job.get('runner_id')) or len(steps)!=1 or steps[0].get('status')!='in_progress'
            or steps[0].get('conclusion') is not None or not positive(steps[0].get('number'))):
        raise ValueError('Acquisition job does not belong to this exact finite activation')
    return {**context,'controller_sha':binding['source_sha'],'intent_sha256':admission_sha,
            'registration_artifact_id':binding['registration']['artifact_id'],
            'job_id':job['id'],'runner_id':job['runner_id'],'step_number':steps[0].get('number')}


def consume_push_attempt(approval, admission_sha, *, environment, api, clock, git=None, download=download_artifact):
    from .price_pilot_admission import consume_validated_context
    event_path=Path(environment['GITHUB_EVENT_PATH'])
    if event_path.stat().st_size>2*1024*1024: raise ValueError('Push event exceeds bounded size')
    event=json.loads(event_path.read_bytes());git=git or GitSource(Path.cwd())
    def check():
        return validated_capture_context(approval,admission_sha,environment=environment,event=event,git=git,
            api=api,download=download,now=clock())
    live=check()
    return consume_validated_context(live,admission_sha,environment=environment,recheck=check,clock=clock)


def prepare_activation(git, source, intent_raw, reviewed_intent_sha):
    """Return an exact push specification; never write a remote or bless HEAD."""
    if not re.fullmatch(r'[a-f0-9]{40}',source) or sha(intent_raw)!=reviewed_intent_sha:
        raise ValueError('Explicit reviewed C and intent digest are required')
    intent=json.loads(intent_raw)
    if intent_raw!=encoded(intent): raise ValueError('Review the canonical intent file before preparing activation')
    if git.exists(source,INTENT_PATH): raise ValueError('C must have no activation intent')
    check_policy(git,source)
    validate_intent(intent,json.loads(git.show(source,TEMPLATE_PATH)),source)
    return {'schema_version':'four-symbol-intent-push-spec-v1','repository':REPOSITORY,'repository_id':REPOSITORY_ID,
        'branch':BRANCH,'expected_parent':source,'only_changed_path':INTENT_PATH,
        'intent_sha256':reviewed_intent_sha,'commit_message':activation_message(source,reviewed_intent_sha),
        'capture_permission_from_spec_alone':False,'remote_write_performed':False}
