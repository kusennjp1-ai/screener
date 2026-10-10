"""Read back the actual uploaded source artifact; never contacts Yahoo."""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import subprocess
import tempfile
import zipfile

REPOSITORY = 'kusennjp1-ai/screener'
REPOSITORY_ID = 1203919607
WORKFLOW = '.github/workflows/financial-statement-successor.yml'
BRANCH = 'improve/financial-retention-successor'
MAX_ZIP = 128*1024*1024
MAX_EXPANDED = 512*1024*1024
MAX_MEMBER = 32*1024*1024
MAX_FILES = 30000


def require(condition,message):
    if not condition:
        raise ValueError(message)


def sha(content):
    return hashlib.sha256(content).hexdigest()


def strict_pairs(pairs):
    result = {}
    for key,value in pairs:
        require(key not in result,'Duplicate JSON field')
        result[key] = value
    return result


def parse(content):
    return json.loads(content,object_pairs_hook=strict_pairs,
        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Nonfinite JSON')))


def api(path):
    value = subprocess.run(['gh','api',path],check=True,capture_output=True,timeout=60).stdout
    require(len(value) <= 2*1024*1024,'Oversized GitHub metadata')
    return parse(value)


def clock(value):
    require(isinstance(value,str) and value.endswith('Z'),'Explicit UTC clock required')
    return datetime.fromisoformat(value.replace('Z','+00:00'))


def expected_context(environment):
    require(environment.get('GITHUB_REPOSITORY') == REPOSITORY
            and environment.get('GITHUB_REF_NAME') == BRANCH
            and environment.get('GITHUB_EVENT_NAME') == 'push'
            and environment.get('GITHUB_RUN_ATTEMPT') == '1'
            and environment.get('GITHUB_RUN_NUMBER') == '1','Wrong artifact readback execution context')
    require(re.fullmatch(r'[a-f0-9]{40}',environment.get('GITHUB_SHA','')) is not None
            and environment.get('GITHUB_RUN_ID','').isdigit(),'Unbound readback commit/run')
    return {'id':int(environment['GITHUB_RUN_ID']),'head_sha':environment['GITHUB_SHA']}


def validate_metadata(artifact,run,context,artifact_id,expected_digest,now):
    require(type(artifact_id) is int and artifact_id > 0,'Positive artifact ID required')
    expected_digest = expected_digest.removeprefix('sha256:')
    require(re.fullmatch(r'[a-f0-9]{64}',expected_digest) is not None,'Invalid upload digest')
    require(run.get('id') == context['id'] and run.get('head_sha') == context['head_sha']
            and run.get('run_attempt') == run.get('run_number') == 1
            and run.get('path') == WORKFLOW and run.get('head_branch') == BRANCH and run.get('event') == 'push'
            and run.get('status') == 'in_progress' and run.get('conclusion') is None,
            'Actual uploaded artifact must bind this first successor attempt')
    for key in ('repository','head_repository'):
        require(run.get(key,{}).get('full_name') == REPOSITORY and run.get(key,{}).get('id') == REPOSITORY_ID,
                'Readback repository identity changed')
    started = clock(run.get('run_started_at'))
    require(started <= now and (now-started).total_seconds() <= 1500,'Readback run clock exceeds bounded job')
    owner = artifact.get('workflow_run',{})
    require(artifact.get('id') == artifact_id and artifact.get('expired') is False
            and artifact.get('name') == f"financial-statement-successor-{context['head_sha']}-1"
            and artifact.get('digest') == 'sha256:'+expected_digest
            and type(artifact.get('size_in_bytes')) is int and 0 < artifact['size_in_bytes'] <= MAX_ZIP
            and owner.get('id') == context['id'] and owner.get('head_sha') == context['head_sha']
            and owner.get('head_branch') == BRANCH and owner.get('repository_id') == REPOSITORY_ID
            and owner.get('head_repository_id') == REPOSITORY_ID,
            'Uploaded artifact metadata/digest/owner differs from this attempt')
    require(started <= clock(artifact.get('created_at')) <= now,'Uploaded artifact is outside this attempt interval')
    return expected_digest


def verify_archive(zip_path,expected,expected_digest):
    info = zip_path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= MAX_ZIP,'Unsafe or oversized uploaded ZIP')
    require(sha(zip_path.read_bytes()) == expected_digest,'Actual Actions ZIP digest changed')
    require(set(expected) == {'schema_version','final_retention_verified','files'}
            and expected['schema_version'] == 'financial-successor-retained-inventory-v1'
            and type(expected['final_retention_verified']) is bool
            and isinstance(expected['files'],dict) and 0 < len(expected['files']) <= MAX_FILES,
            'Malformed retained file inventory')
    for name,item in expected['files'].items():
        require(isinstance(name,str) and isinstance(item,dict) and set(item) == {'bytes','sha256'}
                and type(item['bytes']) is int and 0 <= item['bytes'] <= MAX_MEMBER
                and re.fullmatch(r'[a-f0-9]{64}',item['sha256']) is not None,'Malformed expected file binding')
    files, names, total = {}, set(), 0
    with zipfile.ZipFile(zip_path) as reader:
        members = reader.infolist()
        require(len(members) <= MAX_FILES,'Uploaded ZIP member count exceeds bound')
        for item in members:
            name = item.filename
            path = PurePosixPath(name)
            require(name not in names and not path.is_absolute() and '\\' not in name
                    and len(name.encode()) <= 512 and all(p not in ('','.','..') for p in name.rstrip('/').split('/')),
                    'Unsafe or duplicate uploaded ZIP path')
            names.add(name)
            mode = item.external_attr >> 16
            require(not stat.S_ISLNK(mode) and (not stat.S_IFMT(mode) or stat.S_ISREG(mode) or stat.S_ISDIR(mode)),
                    'Linked or special uploaded ZIP member')
            total += item.file_size
            require(item.file_size <= MAX_MEMBER and total <= MAX_EXPANDED,'Uploaded ZIP exceeds expansion bounds')
            if item.is_dir():
                require(any(f.startswith(name) for f in expected['files']),'Unowned uploaded directory')
                continue
            require(name in expected['files'],'Unexpected uploaded retained source member')
            checksum = hashlib.sha256()
            count = 0
            with reader.open(item) as stream:
                for data in iter(lambda:stream.read(1024*1024),b''):
                    count += len(data)
                    require(count <= MAX_MEMBER,'Expanded member exceeds bound')
                    checksum.update(data)
            files[name] = {'bytes':count,'sha256':checksum.hexdigest()}
        require(files == expected['files'],'Actual upload dropped or changed retained bytes, including hidden files')
        require(reader.testzip() is None,'Actual uploaded ZIP CRC readback failed')
    return {'schema_version':'financial-successor-artifact-readback-v1','zip_sha256':expected_digest,
        'zip_bytes':info.st_size,'expanded_bytes':total,'retained_files':len(files),
        'all_retained_bytes_match':True,'hidden_lock_retained':'archive/.archive.lock' in files,
        'final_retention_verified':expected['final_retention_verified'],'provider_requests':0,
        'publication_authority':'none'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--inventory',type=Path,required=True)
    parser.add_argument('--artifact-id',type=int,required=True)
    parser.add_argument('--artifact-digest',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args = parser.parse_args()
    info = args.inventory.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1 and info.st_size <= 16*1024*1024,'Unsafe expected upload inventory')
    inventory_bytes = args.inventory.read_bytes()
    expected = parse(inventory_bytes)
    context = expected_context(os.environ)
    run = api(f"repos/{REPOSITORY}/actions/runs/{context['id']}/attempts/1")
    artifact = api(f'repos/{REPOSITORY}/actions/artifacts/{args.artifact_id}')
    digest = validate_metadata(artifact,run,context,args.artifact_id,args.artifact_digest,datetime.now(timezone.utc))
    with tempfile.TemporaryDirectory(prefix='successor-upload-readback-') as directory:
        path = Path(directory)/'actual-actions.zip'
        with path.open('xb') as stream:
            subprocess.run(['gh','api',f'repos/{REPOSITORY}/actions/artifacts/{args.artifact_id}/zip'],
                check=True,stdout=stream,timeout=120)
        require(path.stat().st_size == artifact['size_in_bytes'],'Actual upload size differs from GitHub metadata')
        result = verify_archive(path,expected,digest)
    result.update(artifact_id=args.artifact_id,run_id=context['id'],run_attempt=1,head_sha=context['head_sha'],
        inventory_sha256=sha(inventory_bytes),observed_at=datetime.now(timezone.utc).isoformat().replace('+00:00','Z'))
    args.output.parent.mkdir(parents=True,exist_ok=True)
    with args.output.open('x') as out:
        json.dump(result,out,indent=2)
        out.write('\n')
    print(json.dumps(result,sort_keys=True))


if __name__ == '__main__':
    main()
