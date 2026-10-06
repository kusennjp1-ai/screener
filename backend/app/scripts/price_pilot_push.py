"""Prepare a reviewed finite push or verify its read-only Actions evidence.

This entry point never calls a price provider or writes a GitHub ref. Capture is
still the separate bounded adapter, from the verified source checkout only.
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path

from app.services.bounded_price_recovery import encoded, immutable_write, sha
from app.services.price_pilot_admission import github_read, complete, REPOSITORY, REPOSITORY_ID
from app.services.price_pilot_push import (
    GitSource, INTENT_PATH, WORKFLOW, REGISTER_JOB, PRIOR_RUN, PRIOR_SHA, PRIOR_HEAD, PRIOR_BYTES, MAX_PRIOR_BYTES,
    push_context, checked_run, registration_receipt, prepare_activation, validate_activation,
    verify_registered_attempt, download_artifact, stream_artifact,
)


def event_context(environment):
    path=Path(environment['GITHUB_EVENT_PATH'])
    if path.stat().st_size>2*1024*1024: raise ValueError('Push event exceeds bounded size')
    event=json.loads(path.read_bytes())
    return push_context(environment,event),event


def write_outputs(values, environment):
    # All values here are locally checked hex digests, fixed labels or integers.
    with Path(environment['GITHUB_OUTPUT']).open('a') as output:
        for key,value in values.items():
            if '\n' in str(value) or '\r' in str(value): raise ValueError('Invalid workflow output')
            output.write(f'{key}={value}\n')


def classify(git, context, event):
    head=context['activation_sha']
    if not git.exists(head,INTENT_PATH):
        if context['run_number']!=1: raise ValueError('Missing intent on an already consumed workflow')
        return {'mode':'source','source_sha':head,'intent_sha256':''}
    raw=git.show(head,INTENT_PATH)
    _,binding=validate_activation(git,context,event,raw)
    return {'mode':'activation','source_sha':binding['source_sha'],'intent_sha256':binding['intent_sha256']}


def register(git, context, api, now):
    base=f'repos/{REPOSITORY}'
    run=api(f"{base}/actions/runs/{context['run_id']}")
    checked_run(run,run_id=context['run_id'],number=1,head=context['activation_sha'])
    exact=api(f"{base}/actions/runs/{context['run_id']}/attempts/1")
    checked_run(exact,run_id=context['run_id'],number=1,head=context['activation_sha'],workflow_id=run['workflow_id'])
    workflow=api(f"{base}/actions/workflows/{run['workflow_id']}")
    if (workflow.get('id'),workflow.get('path'),workflow.get('state'))!=(run['workflow_id'],WORKFLOW,'active'):
        raise ValueError('Source workflow authority changed')
    runs=complete(api(f"{base}/actions/workflows/{run['workflow_id']}/runs?per_page=100"),'workflow_runs')
    if len(runs)!=1 or runs[0].get('id')!=context['run_id']:
        raise ValueError('Registration is not the first complete workflow history')
    checked_run(runs[0],run_id=context['run_id'],number=1,head=context['activation_sha'],workflow_id=run['workflow_id'])
    return registration_receipt(git,context,run,now)


def verify_prior_reference(approval, api):
    ref=approval['prior_release'];base=f'repos/{REPOSITORY}'
    run=api(f'{base}/actions/runs/{PRIOR_RUN}')
    if (run.get('id')!=PRIOR_RUN or run.get('head_sha')!=PRIOR_HEAD
            or run.get('status')!='completed' or run.get('conclusion')!='success'
            or run.get('repository',{}).get('id')!=REPOSITORY_ID
            or run.get('repository',{}).get('full_name')!=REPOSITORY):
        raise ValueError('Retained prior release run is not verified')
    rows=complete(api(f'{base}/actions/runs/{PRIOR_RUN}/artifacts?per_page=100'),'artifacts')
    selected=[row for row in rows if row.get('id')==ref['artifact_id']]
    if len(selected)!=1: raise ValueError('Pinned prior release artifact is missing')
    item=selected[0];producer=item.get('workflow_run',{})
    if (item.get('name')!=ref['artifact_name'] or item.get('digest')!='sha256:'+PRIOR_SHA
            or item.get('expired') is not False or type(item.get('size_in_bytes')) is not int
            or item['size_in_bytes']!=PRIOR_BYTES or producer.get('id')!=PRIOR_RUN
            or producer.get('repository_id')!=REPOSITORY_ID or producer.get('head_repository_id')!=REPOSITORY_ID
            or producer.get('head_sha')!=PRIOR_HEAD):
        raise ValueError('Retained artifact hash, producer or size does not match review')
    return item


def stage(git, context, event, output, api, now):
    raw=git.show(context['activation_sha'],INTENT_PATH)
    approval,binding=validate_activation(git,context,event,raw)
    if raw!=encoded(approval): raise ValueError('Intent must use the exact reviewed canonical bytes')
    verify_registered_attempt(git,context,binding,api,download_artifact,now)
    item=verify_prior_reference(approval,api)
    # New output directory only. No prior attempt directory can be resumed.
    output.mkdir(parents=False,exist_ok=False)
    immutable_write(output/'intent.json',raw,64*1024)
    archive=output/'prior-release.zip'
    with archive.open('xb') as handle:
        actual_size=stream_artifact(item['id'],handle,maximum=MAX_PRIOR_BYTES)
    with archive.open('rb') as handle:
        digest=hashlib.file_digest(handle,'sha256').hexdigest()
    if actual_size!=item['size_in_bytes'] or digest!=PRIOR_SHA:
        raise ValueError('Retained archive readback differs from its immutable reference')
    # C is the only code checkout used for acquisition. I remains the bound
    # workflow/event head, and consume_attempt rechecks all remote authority.
    git.git('worktree','add','--detach',str(output/'source'),binding['source_sha'])
    immutable_write(output/'staging-proof.json',encoded({**binding,'prior_release':item,
        'provider_requests':0,'publication_authority':False}),64*1024)
    return binding


def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command',choices=('prepare','classify','register','stage'))
    parser.add_argument('--source-commit')
    parser.add_argument('--intent',type=Path)
    parser.add_argument('--reviewed-intent-sha256')
    parser.add_argument('--output',type=Path)
    args=parser.parse_args(argv);git=GitSource(Path.cwd())
    if args.command=='prepare':
        if not args.source_commit or not args.intent or not args.reviewed_intent_sha256 or not args.output:
            parser.error('prepare requires explicit reviewed source, intent, digest and new output')
        spec=prepare_activation(git,args.source_commit,args.intent.read_bytes(),args.reviewed_intent_sha256)
        immutable_write(args.output,encoded(spec),64*1024)
        print(json.dumps(spec));return
    context,event=event_context(os.environ)
    if git.git('rev-parse','HEAD').decode().strip()!=context['activation_sha']:
        raise ValueError('Preparation checkout differs from the exact push head')
    if args.command=='classify':
        write_outputs(classify(git,context,event),os.environ);return
    if not args.output: parser.error('register/stage requires a new output path')
    now=datetime.now(timezone.utc)
    if args.command=='register':
        if os.environ.get('GITHUB_JOB')!=REGISTER_JOB: raise ValueError('Wrong source registration job')
        proof=register(git,context,github_read,now)
        args.output.mkdir(parents=False,exist_ok=False)
        immutable_write(args.output/'source-registration.json',encoded(proof),64*1024)
    else:
        binding=stage(git,context,event,args.output,github_read,now)
        write_outputs({'source_sha':binding['source_sha'],'intent_sha256':binding['intent_sha256']},os.environ)


if __name__=='__main__':
    main()
