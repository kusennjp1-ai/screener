"""Static capture workflow event, authority, timeout and retention contract."""
from pathlib import Path
import re

ROOT=Path(__file__).resolve().parents[3]
WORKFLOW=(ROOT/'.github/workflows/financial-statement-capture.yml').read_text()


def test_single_push_event_and_read_only_permissions():
    assert re.search(r'on:\s+push:\s+branches: \[improve/financial-statement-capture\]',WORKFLOW)
    for forbidden in ('workflow_dispatch:','workflow_call:','schedule:','pull_request:',': write','continue-on-error:'):
        assert forbidden not in WORKFLOW
    assert 'contents: read' in WORKFLOW and 'actions: read' in WORKFLOW
    assert 'persist-credentials: false' in WORKFLOW and 'fetch-depth: 2' in WORKFLOW


def test_actual_clock_before_checkout_serialization_and_whole_job_bound():
    assert WORKFLOW.index('id: budget-clock')<WORKFLOW.index('actions/checkout')
    assert 'timeout-minutes: 25' in WORKFLOW
    assert 'group: financial-statement-recovery' in WORKFLOW and 'cancel-in-progress: false' in WORKFLOW
    assert WORKFLOW.count('CAPTURE_JOB_STARTED_AT:')==3


def test_fixed_new_request_owner_paths_no_arbitrary_inputs():
    assert 'restore-statement-capture-source.mjs' in WORKFLOW and 'run-statement-capture.py' in WORKFLOW
    assert 'verify-statement-capture-artifact.py' in WORKFLOW
    for forbidden in ('--admission','--request','--runtime-lock','successor-statement-refresh.py','verifySuccessfulSuccessorSource','gh workflow','git push','deploy-pages'):
        assert forbidden not in WORKFLOW


def test_unconditional_actual_upload_and_missing_readback_fail_closed():
    assert 'if-no-files-found: warn' not in WORKFLOW
    assert WORKFLOW.count('if: always()')==3
    assert WORKFLOW.count('include-hidden-files: true')==2
    assert "steps.upload.outputs.artifact-id != ''" not in WORKFLOW
    assert "--artifact-id '${{ steps.upload.outputs.artifact-id }}'" in WORKFLOW
    assert "--artifact-digest '${{ steps.upload.outputs.artifact-digest }}'" in WORKFLOW
    assert '--upload-root "$RUNNER_TEMP/financial-capture"' in WORKFLOW
    assert '$RUNNER_TEMP/capture-verification/expected-inventory.json' in WORKFLOW


def test_pinned_runtime_and_no_unrequested_prices_identity_or_publishing():
    for version in ('yfinance==0.2.66','curl_cffi==0.16.3','pandas==2.2.0','numpy==1.26.3','requests==2.31.0',
                    'certifi==2026.7.22','cffi==2.1.1'):
        assert version in WORKFLOW
    assert "python-version: '3.11'" in WORKFLOW
    for forbidden in ('publish-static','release-manifest','supabase','financial-renewal','price-refresh'):
        assert forbidden not in WORKFLOW


def test_strict_transport_synthetic_gate_is_in_hosted_tests():
    assert 'backend/tests/unit/test_statement_capture_transport.py' in WORKFLOW
