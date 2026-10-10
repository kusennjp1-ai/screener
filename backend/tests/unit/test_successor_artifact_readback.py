"""Actual upload inventory checks use tiny offline ZIP fixtures only."""
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
from pathlib import Path
import stat
import zipfile

import pytest

ROOT = Path(__file__).resolve().parents[3]
SPEC = importlib.util.spec_from_file_location('successor_readback',ROOT/'.github/scripts/verify-successor-artifact.py')
readback = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(readback)
NOW = datetime(2026,10,10,9,50,tzinfo=timezone.utc)


def package(tmp_path,files=None):
    files = files or {'archive/.archive.lock':b'','archive/manifest.json':b'original source clock','cycle.json':b'completed'}
    path = tmp_path/'source.zip'
    with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED) as writer:
        for name,data in files.items():writer.writestr(name,data)
    expected = {'schema_version':'financial-successor-retained-inventory-v1','final_retention_verified':True,
        'files':{name:{'bytes':len(data),'sha256':readback.sha(data)} for name,data in files.items()}}
    return path,expected,readback.sha(path.read_bytes())


def test_complete_actual_zip_including_hidden_lock_is_read_back(tmp_path):
    path,expected,digest = package(tmp_path)
    result = readback.verify_archive(path,expected,digest)
    assert result['retained_files'] == 3 and result['hidden_lock_retained'] is True
    assert result['all_retained_bytes_match'] and result['final_retention_verified']


@pytest.mark.parametrize('attack',['missing_lock','missing_source','changed_clock','extra','duplicate','traversal','absolute','symlink','fifo','wrong_digest'])
def test_upload_cannot_drop_change_or_add_source(tmp_path,attack):
    path,expected,digest = package(tmp_path)
    files = {'archive/.archive.lock':b'','archive/manifest.json':b'original source clock','cycle.json':b'completed'}
    if attack == 'missing_lock':del files['archive/.archive.lock']
    elif attack == 'missing_source':del files['archive/manifest.json']
    elif attack == 'changed_clock':files['archive/manifest.json'] = b'new observation clock'
    elif attack == 'extra':files['extra.json'] = b'new'
    elif attack == 'traversal':files['../escape'] = b'x'
    elif attack == 'absolute':files['/escape'] = b'x'
    with zipfile.ZipFile(path,'w') as writer:
        for name,data in files.items():writer.writestr(name,data)
        if attack == 'duplicate':writer.writestr('cycle.json',b'completed')
        if attack in ('symlink','fifo'):
            item = zipfile.ZipInfo('unsafe')
            item.create_system = 3
            item.external_attr = ((stat.S_IFLNK if attack == 'symlink' else stat.S_IFIFO)|0o600)<<16
            writer.writestr(item,b'target')
    actual = readback.sha(path.read_bytes())
    with pytest.raises(ValueError):
        readback.verify_archive(path,expected,'0'*64 if attack == 'wrong_digest' else actual)


@pytest.mark.parametrize('key,value',[('MAX_ZIP',1),('MAX_EXPANDED',1),('MAX_MEMBER',1),('MAX_FILES',1)])
def test_all_upload_bounds_still_apply(tmp_path,monkeypatch,key,value):
    path,expected,digest = package(tmp_path)
    monkeypatch.setattr(readback,key,value)
    with pytest.raises(ValueError):readback.verify_archive(path,expected,digest)


def test_partial_raw_readback_does_not_upgrade_retention_success(tmp_path):
    path,expected,digest = package(tmp_path)
    expected['final_retention_verified'] = False
    assert readback.verify_archive(path,expected,digest)['final_retention_verified'] is False


def metadata():
    context = {'id':999,'head_sha':'a'*40}
    repo = {'id':readback.REPOSITORY_ID,'full_name':readback.REPOSITORY}
    run = {**context,'run_attempt':1,'run_number':1,'path':readback.WORKFLOW,'head_branch':readback.BRANCH,
        'event':'push','status':'in_progress','conclusion':None,'repository':repo,'head_repository':repo,
        'run_started_at':'2026-10-10T09:40:00Z'}
    artifact = {'id':888,'expired':False,'name':'financial-statement-successor-'+context['head_sha']+'-1',
        'digest':'sha256:'+'b'*64,'size_in_bytes':1000,'created_at':'2026-10-10T09:49:00Z',
        'workflow_run':{**context,'head_branch':readback.BRANCH,'repository_id':readback.REPOSITORY_ID,
                        'head_repository_id':readback.REPOSITORY_ID}}
    return context,run,artifact


def test_actual_uploaded_metadata_binds_the_exact_current_attempt():
    context,run,artifact = metadata()
    assert readback.validate_metadata(artifact,run,context,888,'b'*64,NOW) == 'b'*64
    assert readback.validate_metadata(artifact,run,context,888,'sha256:'+'b'*64,NOW) == 'b'*64


@pytest.mark.parametrize('field,value',[('id',777),('expired',True),('name','other'),('digest','sha256:'+'c'*64),
    ('size_in_bytes',0),('size_in_bytes',True),('created_at','2026-10-10T09:39:00Z'),('created_at','2026-10-10T09:51:00Z')])
def test_wrong_upload_metadata_rejected(field,value):
    context,run,artifact = metadata()
    artifact[field] = value
    with pytest.raises(ValueError):readback.validate_metadata(artifact,run,context,888,'b'*64,NOW)


@pytest.mark.parametrize('field,value',[('run_attempt',2),('run_number',2),('head_branch','main'),('head_sha','c'*40),
    ('status','completed'),('path','.github/workflows/financial-statement-recovery.yml'),('event','workflow_dispatch')])
def test_prior_or_foreign_run_cannot_own_uploaded_source(field,value):
    context,run,artifact = metadata()
    run[field] = value
    with pytest.raises(ValueError):readback.validate_metadata(artifact,run,context,888,'b'*64,NOW)


def test_inventory_with_duplicate_json_keys_is_not_trusted():
    with pytest.raises(ValueError,match='Duplicate'):
        readback.parse(b'{"files":{},"files":{}}')
