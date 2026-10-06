"""Test-only retained-source replay; never source acquisition or publication."""
import argparse
from contextlib import ExitStack, contextmanager
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import socket
import subprocess
import time
from unittest.mock import patch

import curl_cffi
from curl_cffi import requests as curl_requests
import requests
import yfinance

from app.services import financial_statement_batch as batch
from app.services.statement_retention_budget import StatementRetentionBudget

ROOT = Path(__file__).resolve().parents[2]
REVIEW = ROOT / '.github/bounded-refresh-first-200/dispatch-review.json'


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / '.github/scripts' / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


@contextmanager
def deny_acquisition():
    """Block known provider, socket, native-curl and child-process routes."""
    attempted = []
    targets = [(socket.socket, 'connect'), (socket.socket, 'connect_ex'),
               (socket, 'create_connection'), (socket, 'getaddrinfo'),
               (curl_cffi.Curl, 'perform'), (curl_requests.Session, 'request'),
               (requests.Session, 'request'), (yfinance, 'Ticker'),
               (subprocess, 'Popen'), (os, 'system')]
    targets += [(os, name) for name in ('posix_spawn', 'posix_spawnp') if hasattr(os, name)]
    with ExitStack() as stack:
        for target, name in targets:
            label = f'{getattr(target, "__name__", type(target).__name__)}.{name}'
            def denied(*args, _label=label, **kwargs):
                attempted.append(_label)
                raise RuntimeError(f'Acquisition forbidden in retained-source CI replay: {_label}')
            stack.enter_context(patch.object(target, name, denied))
        yield attempted


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def validate(*, restored, work, reports, job_started_at):
    restored, work, reports = Path(restored), Path(work), Path(reports)
    if work.exists():
        raise ValueError('CI replay work directory must be new')
    work.mkdir(parents=True)
    reports.mkdir(parents=True, exist_ok=True)
    report = {'schema_version':'bounded-refresh-ci-validation-v1', 'authority':'test_evidence_only',
              'publication_authority':'none', 'provider_acquisition':False, 'python':platform.python_version(),
              'code_revision':os.environ.get('GITHUB_SHA'), 'status':'started', 'started_at':batch.timestamp(datetime.now(timezone.utc))}
    started = time.perf_counter()
    attempted = []
    try:
        with deny_acquisition() as attempted:
            bridge = module('bounded_ci_bridge', 'bounded-statement-refresh-plan.py')
            runner = module('bounded_ci_runner', 'run-statement-recovery-cycle.py')
            now = datetime.now(timezone.utc)
            review = bridge.load_review(REVIEW, now=now)
            admission, _ = bridge.load_admission(REVIEW, review, now=now, dry_run=True)
            if admission['execution_enabled'] is not False or admission['expected_run_number'] is not None:
                raise ValueError('Test replay cannot enable source dispatch')
            original = {name:digest(restored/'files'/name) for name in ('base.json','cohort.json','archive/manifest.json')}
            bridge.prepare_inputs(REVIEW, restored, work/'inputs', now=now)
            code = runner.run(work/'inputs', restored, work/'output', dry_run=True,
                              reviewed_plan=REVIEW, job_started_at=job_started_at)
            if code != 0 or (work/'output/batch').exists():
                raise ValueError('CI dry-run attempted acquisition or failed')
            output = work/'output'
            cycle = json.loads((output/'cycle.json').read_bytes())
            if (cycle['phase'] != 'completed' or cycle['dry_run'] is not True or cycle['published'] is not False
                    or cycle['exit_code'] != 0 or cycle['selected_symbols'] != 200
                    or cycle['archive_manifest_sha256'] != bridge.SOURCE['archive_manifest_sha256']):
                raise ValueError('CI replay changed the original source generation')
            for name, expected in original.items():
                if digest(restored/'files'/name) != expected or digest(output/name) != expected:
                    raise ValueError('CI replay changed retained source bytes')
            cache = output/'selected-cache/cache-manifest.json'
            if digest(cache) != bridge.SELECTED_CACHE_SHA256:
                raise ValueError('CI selected receipt cache differs from the reviewed original')
            cache_value = json.loads(cache.read_bytes())
            if len(cache_value['acquisitions']) != 400:
                raise ValueError('CI replay must retain all 400 selected receipts')
            guard = StatementRetentionBudget(output)
            retention = guard.check('initial')
            # Read-only phase proof over the unchanged archive. No merge occurs.
            guard.before_merge()
            manifest = json.loads((output/'archive/manifest.json').read_bytes())
            guard.authorize_finalization(archive_manifest_sha256=cycle['archive_manifest_sha256'],
                                         cycle_sha256=digest(output/'cycle.json'), archive_object_sha256s=manifest['objects'])
            package = guard.verify_final()
            if attempted:
                raise ValueError('A denied acquisition attempt was swallowed during replay')
            report.update(status='passed', dispatch_admission={'execution_enabled':False,'expected_run_number':None},
                          original_source=bridge.SOURCE, original_hashes=original,
                          full_cohort_count=1894, applicable_count=1891, selected_count=200, selected_receipts=400,
                          selected_cache_sha256=digest(cache), required_valid_through=review.plan['required_valid_through'],
                          source_clocks_preserved=True, dry_run_cycle=cycle, retention=retention, package=package)
    except Exception as exc:
        report.update(status='failed', error_type=type(exc).__name__, error=str(exc))
        raise
    finally:
        report.update(denied_acquisition_attempts=attempted, elapsed_seconds=time.perf_counter()-started,
                      completed_at=batch.timestamp(datetime.now(timezone.utc)))
        (reports/'validation-report.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,sort_keys=True))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--restored', required=True, type=Path)
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--reports', required=True, type=Path)
    parser.add_argument('--job-started-at', required=True)
    args = parser.parse_args()
    validate(restored=args.restored, work=args.work, reports=args.reports, job_started_at=args.job_started_at)
