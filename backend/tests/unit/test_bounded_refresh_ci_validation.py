"""The isolated CI wrapper has no provider, socket or subprocess escape route."""
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess

import curl_cffi
from curl_cffi import requests as curl_requests
import requests
import pytest
import yfinance

ROOT=Path(__file__).resolve().parents[3]
spec=importlib.util.spec_from_file_location('bounded_ci_test',ROOT/'.github/scripts/validate-bounded-refresh-ci.py')
harness=importlib.util.module_from_spec(spec)
spec.loader.exec_module(harness)


@pytest.mark.parametrize('call', [
    lambda:socket.create_connection(('example.invalid',443)),
    lambda:socket.getaddrinfo('example.invalid',443),
    lambda:curl_cffi.Curl.perform(None),
    lambda:curl_requests.Session.request(None,'GET','https://example.invalid'),
    lambda:requests.Session.request(None,'GET','https://example.invalid'),
    lambda:yfinance.Ticker('NVDA'),
    lambda:subprocess.Popen(['forbidden']),
    lambda:os.system('forbidden'),
])
def test_provider_network_and_process_routes_fail_before_execution(call):
    with harness.deny_acquisition() as attempted:
        with pytest.raises(RuntimeError,match='Acquisition forbidden'):
            call()
        assert len(attempted)==1


@pytest.mark.parametrize('method',['connect','connect_ex'])
def test_raw_socket_connection_is_denied(method):
    with socket.socket() as connection, harness.deny_acquisition() as attempted:
        with pytest.raises(RuntimeError,match='Acquisition forbidden'):
            getattr(connection,method)(('127.0.0.1',443))
        assert len(attempted)==1


def test_replay_requires_new_work_directory(tmp_path):
    with pytest.raises(ValueError,match='must be new'):
        harness.validate(restored=tmp_path/'missing',work=tmp_path,reports=tmp_path/'reports',job_started_at='2026-10-06T13:00:00Z')


def test_failed_replay_reports_failure_without_acquisition(tmp_path):
    with pytest.raises((ValueError,OSError)):
        harness.validate(restored=tmp_path/'missing',work=tmp_path/'work',reports=tmp_path/'reports',job_started_at='2026-10-06T13:00:00Z')
    report=json.loads((tmp_path/'reports/validation-report.json').read_text())
    assert report['status']=='failed'
    assert report['provider_acquisition'] is False
    assert report['denied_acquisition_attempts']==[]
    assert not (tmp_path/'work/output/batch').exists()
