"""Small offline boundary fixtures; no production registry admission."""
from copy import deepcopy
import importlib.util
from pathlib import Path
import json
import subprocess
import sys
import zipfile

import pytest

PATH=Path(__file__).with_name('verify-postcapture-correction-archive.py')
spec=importlib.util.spec_from_file_location('postcapture_reader',PATH)
reader=importlib.util.module_from_spec(spec);spec.loader.exec_module(reader)


@pytest.mark.parametrize('raw',[b'{"x":1,"x":2}',b'{"x":NaN}',b'{"x":Infinity}'])
def test_duplicate_and_nonfinite_json_fail(raw):
    with pytest.raises(ValueError):reader.parse(raw)


@pytest.mark.parametrize('path',['../outside','/absolute','a//b','a/./b','a/../b','a\\b','a/',''])
def test_unsafe_member_names_fail(path):
    with pytest.raises(ValueError):reader.safe_name(path)


def test_default_registry_remains_empty_and_rejects_every_receipt():
    trust=reader.parse((reader.CONTRACTS/'financial_source_postcapture_trust_v1.json').read_bytes())
    assert trust['reviewed_requests']==[]
    with pytest.raises(ValueError,match='not independently admitted'):reader.select_review('a'*64)


def test_direct_review_requires_closed_fields_and_exact_receipt():
    with pytest.raises(ValueError):reader.select_review('a'*64,{'reference':{'receipt_sha256':'a'*64}})
    review={key:{} for key in reader.ENTRY_KEYS};review['reference']={'receipt_sha256':'b'*64}
    with pytest.raises(ValueError,match='identity mismatch'):reader.select_review('a'*64,review)


def test_cli_has_no_trust_or_schema_override(tmp_path):
    path=tmp_path/'empty.zip'
    with zipfile.ZipFile(path,'w'):pass
    result=subprocess.run([sys.executable,str(PATH),str(path),'a'*64],capture_output=True,text=True)
    assert result.returncode!=0 and 'not independently admitted' in result.stderr
    result=subprocess.run([sys.executable,str(PATH),str(path),'a'*64,'--trust','anything'],capture_output=True,text=True)
    assert result.returncode!=0 and 'Usage:' in result.stderr


def test_controller_request_and_schema_remain_exact():
    contracts,hashes,raw=reader.load_contracts()
    assert hashes['request_sha256']=='d8f06454c41eda4cd7707cdd69a10236b34b690ccd0370fcdcf396d444758e43'
    assert hashes['receipt_schema_sha256']=='095c34d4fb5d2d6c06b99f991ff58d5736238c802ce0883e93c8d8af02fdd5d5'
    request=contracts['request_sha256']
    assert request['source']['run_id']==37478731832
    assert request['failure_boundary']['producer_run_conclusion']=='failure'
    assert request['failure_boundary']['producer_cycle_exit_code']==0
    assert all(value is False for value in request['authority'].values())


def test_projection_expiry_rejects_expired_proof_before_arithmetic():
    # Minimal malformed projection is rejected before it could acquire authority.
    with pytest.raises(ValueError,match='closed'):
        reader.verify_projection({'evaluated_at':'2026-10-06T16:21:00Z'},{'projection':{},'source':{}},[])


def small_review_archive(tmp_path, mutation=None):
    contracts,hashes,raw=reader.load_contracts();request=contracts['request_sha256'];contract=contracts['reference_sha256']
    code={path:{'bytes':1,'sha256':'c'*64,'git_blob_sha':'d'*40} for path in contract['required_code_paths']}
    for path,content in [('.github/financial-source-postcapture/request.json',raw['request_sha256']),('.github/financial-source-postcapture/receipt.schema.json',raw['receipt_schema_sha256'])]:
        code[path]={'bytes':len(content),'sha256':reader.sha(content),'git_blob_sha':reader.git_blob(content)}
    prefix='unit/';names=[prefix+str(i)+'.json' for i in range(11)];files={name:{'bytes':2,'sha256':reader.sha(b'{}')} for name in names};directories=[]
    members=[(name,b'{}',False) for name in names]
    if mutation=='extra':members.append(('outside.json',b'{}',False))
    if mutation=='missing':members.pop()
    if mutation=='duplicate':members.append(members[0]);directories.append('not-present/')
    if mutation=='symlink':members[0]=(members[0][0],b'{}',True)
    if mutation=='bad-member-hash':files[names[0]]['sha256']='f'*64
    if mutation=='unsafe-layout':files['../outside']=files.pop(names[0])
    path=tmp_path/'small.zip'
    with zipfile.ZipFile(path,'w') as zipped:
        for name,body,link in members:
            info=zipfile.ZipInfo(name)
            if link:info.create_system=3;info.external_attr=0o120777<<16
            zipped.writestr(info,body)
    reference={'schema_version':contract['schema_version'],'repository':contract['repository'],'workflow':contract['validator_workflow'],'head_sha':'a'*40,'run_id':1,'run_attempt':1,'job_id':2,'artifact_id':3,'artifact_name':contract['artifact_prefix']+'-'+'a'*40+'-1','artifact_sha256':reader.sha(path.read_bytes()),'receipt_sha256':'e'*64}
    review={'reference':reference,'tree_sha':'b'*40,'source':request['source'],'request':{'path':'.github/financial-source-postcapture/request.json','raw_sha256':hashes['request_sha256'],'canonical_sha256':reader.digest(request),'git_blob_sha':reader.git_blob(raw['request_sha256'])},'code_manifest':code,'controller_contracts':hashes,'artifact_layout':{'companion_prefix':prefix,'files':files,'directories':directories},'captured_inventory_sha256':request['captured_inventory']['sha256'],'fresh_receipt_inventory_sha256':request['refresh']['new_receipt_inventory_sha256']}
    return path,review


@pytest.mark.parametrize('mutation,reason',[('extra','member count'),('missing','member count'),('duplicate','Duplicate'),('symlink','special ZIP'),('bad-member-hash','member changed'),('unsafe-layout','Unsafe')])
def test_archive_layout_rejects_mutations_even_with_rebound_outer_digest(tmp_path,mutation,reason):
    path,review=small_review_archive(tmp_path,mutation)
    with pytest.raises(ValueError,match=reason):reader.verify(path,'e'*64,review)


@pytest.mark.parametrize('mutation',[lambda review:review['code_manifest'].pop(next(iter(review['code_manifest']))),
                                    lambda review:review['controller_contracts'].update(receipt_schema_sha256='f'*64),
                                    lambda review:review['request'].update(raw_sha256='f'*64),
                                    lambda review:review.update(fresh_receipt_inventory_sha256='f'*64)])
def test_review_cannot_omit_code_or_replace_controller_bindings(tmp_path,mutation):
    path,review=small_review_archive(tmp_path);mutation(review)
    with pytest.raises(ValueError):reader.verify(path,'e'*64,review)
