"""Finite GitHub-run admission plus a fixed same-job process marker.

GitHub's run/attempt history is the durable consumed admission. No branch,
release or external journal is written. This exact pilot never resumes a run.
"""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import quote

from .bounded_price_recovery import encoded, sha

REPOSITORY = "kusennjp1-ai/screener"
REPOSITORY_ID = 1203919607
PILOT = "us-close-2026-10-05-et-sun-dds-vmrk"
CAPTURE_WORKFLOW = ".github/workflows/four-symbol-price-capture.yml"
CAPTURE_JOB = "capture-four-symbols"
CAPTURE_STEP = "Acquire four-symbol proof once"


def positive(value):
    return type(value) is int and value > 0


def github_read(endpoint):
    return json.loads(subprocess.check_output(
        ["gh", "api", endpoint, "--header", "Cache-Control: no-cache"], stderr=subprocess.PIPE))


def complete(value, key, maximum=100):
    rows = value.get(key)
    count = value.get("total_count")
    if type(count) is not int or not 0 <= count <= maximum or not isinstance(rows, list) or len(rows) != count:
        raise ValueError("Incomplete or oversized GitHub admission history")
    return rows


def context_from_environment(environment, approval):
    expected = approval.get("github_admission", {})
    if (expected.get("repository") != REPOSITORY or expected.get("workflow_path") != CAPTURE_WORKFLOW
            or not positive(expected.get("workflow_id")) or not positive(expected.get("expected_run_number"))
            or type(expected.get("expected_run_attempt")) is not int or expected['expected_run_attempt'] != 1
            or expected.get("review_status") != "approved_finite_capture_run"):
        raise ValueError("Exact finite GitHub run admission is not approved")
    branch = expected.get("branch")
    if not isinstance(branch, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._/-]*", branch) or ".." in branch:
        raise ValueError("Invalid approved capture branch")
    if (environment.get("GITHUB_ACTIONS") != "true" or environment.get("GITHUB_REPOSITORY") != REPOSITORY
            or environment.get("GITHUB_EVENT_NAME") != "workflow_dispatch"
            or environment.get("GITHUB_REF") != "refs/heads/" + branch
            or environment.get("GITHUB_RUN_NUMBER") != str(expected['expected_run_number'])
            or environment.get("GITHUB_WORKFLOW_REF") != f"{REPOSITORY}/{CAPTURE_WORKFLOW}@refs/heads/{branch}"
            or environment.get("GITHUB_WORKFLOW_SHA") != approval.get("controller_sha")
            or environment.get("GITHUB_SHA") != approval.get("controller_sha")
            or environment.get("GITHUB_JOB") != CAPTURE_JOB):
        raise ValueError("Capture process is not the approved GitHub workflow context")
    try:
        run_id, attempt = int(environment["GITHUB_RUN_ID"]), int(environment["GITHUB_RUN_ATTEMPT"])
    except (KeyError, ValueError):
        raise ValueError("Missing exact GitHub run/attempt identity") from None
    if not positive(run_id) or attempt != 1 or not re.fullmatch(r"[0-9a-f]{40}", approval["controller_sha"]):
        raise ValueError("Reruns and unbound controllers cannot reuse capture admission")
    return {"repository": REPOSITORY, "repository_id": REPOSITORY_ID, "workflow_path": CAPTURE_WORKFLOW,
            "workflow_id": expected["workflow_id"], "run_number": expected["expected_run_number"],
            "run_id": run_id, "run_attempt": attempt, "branch": branch, "controller_sha": approval["controller_sha"]}


def check_run(run, context, *, current):
    fields = {"id": "run_id", "run_number": "run_number", "run_attempt": "run_attempt",
              "workflow_id": "workflow_id", "head_sha": "controller_sha", "head_branch": "branch", "path": "workflow_path"}
    if (any(not positive(run.get(key)) for key in ('id', 'run_number', 'run_attempt', 'workflow_id'))
            or any(run.get(key) != context[value] for key, value in fields.items())):
        raise ValueError("GitHub run/attempt/branch/controller binding changed")
    repo, head = run.get("repository", {}), run.get("head_repository", {})
    if (repo.get("full_name") != REPOSITORY or head.get("full_name") != REPOSITORY
            or repo.get("id") != REPOSITORY_ID or head.get("id") != REPOSITORY_ID
            or run.get("event") != "workflow_dispatch"
            or run.get("status") != ("in_progress" if current else "completed")
            or (current and run.get("conclusion") is not None)):
        raise ValueError("Capture run is terminal, canceled, foreign or otherwise spent")


def check_current_attempt(context, api=github_read):
    """Read complete bounded history; absent evidence never grants another try."""
    base = f"repos/{REPOSITORY}"
    latest = api(f"{base}/actions/runs/{context['run_id']}")
    attempt = api(f"{base}/actions/runs/{context['run_id']}/attempts/1")
    check_run(latest, context, current=True)
    check_run(attempt, context, current=True)
    workflow = api(f"{base}/actions/workflows/{context['workflow_id']}")
    if (workflow.get("id"), workflow.get("path"), workflow.get("state")) != (context['workflow_id'], CAPTURE_WORKFLOW, 'active'):
        raise ValueError("Capture workflow authority is disabled or changed")
    branch = api(f"{base}/git/ref/heads/{quote(context['branch'], safe='/')}")
    if (branch.get('ref') != 'refs/heads/' + context['branch'] or branch.get('object', {}).get('sha') != context['controller_sha']
            or branch.get('object', {}).get('type') != 'commit'):
        raise ValueError("Approved branch controller advanced before capture")
    runs = complete(api(f"{base}/actions/workflows/{context['workflow_id']}/runs?per_page=100"), 'workflow_runs')
    if len({r.get('id') for r in runs}) != len(runs) or len({r.get('run_number') for r in runs}) != len(runs):
        raise ValueError("Ambiguous workflow run history")
    # A removed predecessor cannot make this a new first run. Capture has its
    # own workflow; offline previews use a different path and do not consume it.
    if sorted(r.get('run_number', 0) for r in runs) != list(range(1, len(runs) + 1)):
        raise ValueError("Workflow history has a missing/deleted predecessor")
    if not any(r.get('id') == context['run_id'] for r in runs):
        raise ValueError("Current run is absent from complete workflow history")
    spent = []
    for run in runs:
        if run.get('id') == context['run_id']:
            check_run(run, context, current=True)
        else:
            if not positive(run.get('id')) or not positive(run.get('run_attempt')) or run['run_attempt'] > 10:
                raise ValueError("Invalid prior attempt inventory")
            # Inspect exact attempt endpoints rather than interpreting the run
            # endpoint's latest attempt as its predecessor, as in source restore.
            for number in range(1, run['run_attempt'] + 1):
                old = api(f"{base}/actions/runs/{run['id']}/attempts/{number}")
                if old.get('id') != run['id'] or old.get('run_attempt') != number or old.get('path') != CAPTURE_WORKFLOW:
                    raise ValueError("Prior exact-attempt evidence is inconsistent")
                spent.append({'run_id': run['id'], 'attempt': number, 'status': old.get('status'), 'conclusion': old.get('conclusion')})
        artifacts = complete(api(f"{base}/actions/runs/{run['id']}/artifacts?per_page=100"), 'artifacts')
        journals = [a for a in artifacts if a.get('name', '').startswith('price-pilot-terminal-')]
        for artifact in journals:
            producer = artifact.get('workflow_run', {})
            if (not positive(artifact.get('id')) or artifact.get('expired') is not False
                    or producer.get('id') != run['id'] or producer.get('head_sha') != run.get('head_sha')
                    or not re.fullmatch(r'sha256:[a-f0-9]{64}', artifact.get('digest', ''))):
                raise ValueError("Terminal artifact identity is missing, expired or unverified; admission is spent")
        if journals and run['id'] == context['run_id']:
            raise ValueError("Current attempt already has terminal journal evidence; admission is spent")
    if spent or len(runs) != 1 or context['run_number'] != 1:
        # This deliberately rejects even a prior zero-request attempt. It never
        # trusts a missing/expired/edited terminal artifact to authorize a retry.
        raise ValueError("This one-shot capture workflow already has consumed/uncertain run history; new owner review is required")
    jobs = complete(api(f"{base}/actions/runs/{context['run_id']}/attempts/1/jobs?per_page=100"), 'jobs')
    selected = [job for job in jobs if job.get('name') == CAPTURE_JOB]
    if len(selected) != 1:
        raise ValueError("Missing or duplicate acquisition job")
    job = selected[0]
    steps = [step for step in job.get('steps', []) if step.get('name') == CAPTURE_STEP]
    if (not positive(job.get('id')) or job.get('run_id') != context['run_id'] or job.get('head_sha') != context['controller_sha']
            or job.get('run_attempt') != 1 or job.get('status') != 'in_progress'
            or job.get('conclusion') is not None or len(steps) != 1 or steps[0].get('status') != 'in_progress'
            or steps[0].get('conclusion') is not None or not positive(steps[0].get('number')) or not positive(job.get('runner_id'))):
        raise ValueError("Acquisition job/step is completed, replaced, canceled or unverified")
    return {**context, 'job_id': job['id'], 'runner_id': job['runner_id'], 'step_number': steps[0].get('number')}


def consume_attempt(approval, admission_sha256, *, environment=None, api=github_read, clock=lambda: datetime.now(timezone.utc)):
    if not re.fullmatch(r'[a-f0-9]{64}', admission_sha256):
        raise ValueError('Admission must have its full verified file hash')
    environment = os.environ if environment is None else environment
    if environment.get('GITHUB_EVENT_NAME') == 'push' and approval.get('source_registration') is not None:
        from .price_pilot_push import consume_push_attempt
        return consume_push_attempt(approval, admission_sha256, environment=environment, api=api, clock=clock)
    context = context_from_environment(environment, approval)
    live = check_current_attempt(context, api)
    return consume_validated_context(live, admission_sha256, environment=environment,
        recheck=lambda: check_current_attempt(context,api), clock=clock)


def consume_validated_context(live, admission_sha256, *, environment, recheck, clock):
    root = Path(environment.get('RUNNER_TEMP', ''))
    if not root.is_absolute() or not root.is_dir() or root.is_symlink():
        raise ValueError("Trusted runner temporary directory is unavailable")
    # Fixed across caller output paths/admissions/Redis instances. Exclusive
    # creation stops a fresh process inside the same still-running job. Across
    # jobs, GitHub's finite run/attempt/history checks provide the durable barrier.
    marker = root / f'{PILOT}-consumed.json'
    claim = {'schema_version': 'price-pilot-attempt-claim-v1', 'pilot': PILOT, 'context': live,
             'admission_sha256': admission_sha256, 'claimed_at': clock().isoformat(), 'state': 'consumed'}
    raw = encoded(claim)
    descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(raw); output.flush(); os.fsync(output.fileno())
    directory = os.open(root, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(directory)
    finally:
        os.close(directory)
    if marker.read_bytes() != raw:
        raise ValueError('Attempt marker outcome is uncertain; do not retry')
    # Authority can advance while the marker is written. A failed reread spends
    # the attempt and cannot restore/reset the marker.
    if recheck() != live:
        raise ValueError('Attempt authority changed after consumption')
    return claim


def terminal_record(claim, report):
    stopped = report.get('stopped')
    state = 'denied' if str(stopped).startswith('provider_denied_') else ('uncertain' if stopped else 'completed')
    return {'schema_version': 'price-pilot-attempt-terminal-v1', 'pilot': PILOT,
            'claim': claim, 'claim_sha256': sha(encoded(claim)), 'state': state,
            'provider_requests': report.get('request_count'), 'report_sha256': sha(encoded(report)),
            'reason': stopped, 'admission_reusable': False, 'publication_authority': False}
