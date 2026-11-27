import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
import socket
from unittest.mock import patch
from urllib.error import HTTPError, URLError

spec = importlib.util.spec_from_file_location('restore_history', Path(__file__).with_name('restore-candidate-history.py'))
restore = importlib.util.module_from_spec(spec)
spec.loader.exec_module(restore)


class RestorePerformanceTests(unittest.TestCase):
    def fixture(self, observations=None):
        observations = observations or [{'symbol': 'CASE', 'horizon': 5, 'result': {'return_pct': 5}}]
        cohort = {'sha256': 'a' * 64, 'as_of': '2026-09-21'}
        raw = gzip.compress(json.dumps({'schema_version': 1, 'calculator_version': 'published-close-returns-v1', 'cohort': cohort, 'observations': observations}).encode())
        digest = hashlib.sha256(raw).hexdigest()
        ref = {'path': f"candidate-performance-history/2026-09-21-{'a' * 16}-{digest[:16]}.json.gz", 'sha256': digest, 'cohort_sha256': cohort['sha256'], 'as_of': cohort['as_of'], 'observations': len(observations)}
        return {'schema_version': 1, 'cohorts': [ref]}, raw

    def save_existing(self, directory, catalog, raw):
        index = Path(directory) / 'candidate-performance-history/index.json'
        index.parent.mkdir(parents=True, exist_ok=True)
        index.write_text(json.dumps(catalog), encoding='utf-8')
        (Path(directory) / catalog['cohorts'][0]['path']).write_bytes(raw)
        return index.read_bytes()

    def test_restores_exact_published_bytes_and_reference(self):
        catalog, raw = self.fixture()
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', side_effect=[io.BytesIO(json.dumps(catalog).encode()), io.BytesIO(raw)]):
            restore.restore_performance_history()
            self.assertEqual((Path(directory) / catalog['cohorts'][0]['path']).read_bytes(), raw)
            self.assertEqual(json.loads((Path(directory) / 'candidate-performance-history/index.json').read_text()), catalog)

    def test_first_release_has_no_mature_observations_to_invent(self):
        error = HTTPError('https://example.com', 404, 'not found', {}, None)
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', side_effect=error):
            restore.restore_performance_history()
            self.assertEqual(json.loads((Path(directory) / 'candidate-performance-history/index.json').read_text())['cohorts'], [])

    def test_corrupt_download_does_not_publish_catalog(self):
        catalog, raw = self.fixture()
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', side_effect=[io.BytesIO(json.dumps(catalog).encode()), io.BytesIO(raw + b'corrupt')]):
            with self.assertRaisesRegex(ValueError, 'integrity'):
                restore.restore_performance_history()
            self.assertFalse((Path(directory) / 'candidate-performance-history/index.json').exists())

    def test_404_preserves_last_successful_nonempty_catalog(self):
        catalog, raw = self.fixture()
        error = HTTPError('https://example.com', 404, 'not found', {}, None)
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', side_effect=error):
            before = self.save_existing(directory, catalog, raw)
            with self.assertRaisesRegex(ValueError, 'refusing to erase'):
                restore.restore_performance_history()
            self.assertEqual((Path(directory) / 'candidate-performance-history/index.json').read_bytes(), before)
            self.assertEqual((Path(directory) / catalog['cohorts'][0]['path']).read_bytes(), raw)

    def test_remote_catalog_cannot_drop_an_existing_cohort(self):
        catalog, raw = self.fixture()
        remote = {'schema_version': 1, 'cohorts': []}
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', return_value=io.BytesIO(json.dumps(remote).encode())):
            before = self.save_existing(directory, catalog, raw)
            with self.assertRaisesRegex(ValueError, 'lost an existing cohort'):
                restore.restore_performance_history()
            self.assertEqual((Path(directory) / 'candidate-performance-history/index.json').read_bytes(), before)

    def test_remote_archive_cannot_drop_or_change_completed_observations(self):
        first = {'symbol': 'CASE', 'horizon': 5, 'result': {'return_pct': 5}}
        second = {'symbol': 'CASE', 'horizon': 20, 'result': {'return_pct': 10}}
        catalog, raw = self.fixture([first, second])
        for changed in [[first], [{**first, 'result': {'return_pct': 99}}, second]]:
            remote, remote_raw = self.fixture(changed)
            with self.subTest(changed=changed), tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', side_effect=[io.BytesIO(json.dumps(remote).encode()), io.BytesIO(remote_raw)]):
                before = self.save_existing(directory, catalog, raw)
                with self.assertRaisesRegex(ValueError, '(lost|changed) an existing completed observation'):
                    restore.restore_performance_history()
                self.assertEqual((Path(directory) / 'candidate-performance-history/index.json').read_bytes(), before)

    def test_later_horizons_can_be_added_without_replacing_prior_observations(self):
        first = {'symbol': 'CASE', 'horizon': 5, 'result': {'return_pct': 5}}
        catalog, raw = self.fixture([first])
        remote, remote_raw = self.fixture([first, {'symbol': 'CASE', 'horizon': 20, 'result': {'return_pct': 10}}])
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', side_effect=[io.BytesIO(json.dumps(remote).encode()), io.BytesIO(remote_raw)]):
            self.save_existing(directory, catalog, raw)
            restore.restore_performance_history()
            self.assertEqual(json.loads((Path(directory) / 'candidate-performance-history/index.json').read_text()), remote)
            self.assertEqual((Path(directory) / catalog['cohorts'][0]['path']).read_bytes(), raw)

    def test_unchanged_content_addressed_observations_are_reused(self):
        catalog, raw = self.fixture()
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), patch.object(restore, 'urlopen', return_value=io.BytesIO(json.dumps(catalog).encode())) as fetch:
            self.save_existing(directory, catalog, raw)
            restore.restore_performance_history()
            self.assertEqual(fetch.call_count, 1)



class BrokenBody:
    """A response whose connection drops while the body is read."""
    def __init__(self, error):
        self.error = error
    def __enter__(self):
        return self
    def __exit__(self, *_):
        return False
    def read(self):
        raise self.error


class RestoreRetryTests(unittest.TestCase):
    """Only HTTP 5xx, timeouts and dropped connections are read again."""
    fixture = RestorePerformanceTests.fixture

    def run_restore(self, responses, function='restore_performance_history', **patches):
        sleeps = []
        with tempfile.TemporaryDirectory() as directory, patch.object(restore, 'ROOT', Path(directory)), \
                patch.object(restore, 'retry_waited', 0), patch.object(restore, 'sleep', side_effect=sleeps.append), \
                patch.object(restore, 'urlopen', side_effect=responses) as fetch:
            for name, value in patches.items():
                stack = patch.object(restore, name, value)
                stack.start()
                self.addCleanup(stack.stop)
            error = None
            try:
                getattr(restore, function)()
            except Exception as caught:  # inspected by each test
                error = caught
            index = Path(directory) / ('candidate-performance-history' if function == 'restore_performance_history' else 'candidate-history') / 'index.json'
            files = {str(path.relative_to(directory)): path.read_bytes() for path in Path(directory).rglob('*') if path.is_file()}
            return error, sleeps, fetch.call_count, index.exists(), files

    def unavailable(self, code=503):
        return HTTPError('https://example.com', code, 'unavailable', {}, None)

    def test_503_then_success_restores_the_exact_verified_bytes(self):
        catalog, raw = self.fixture()
        error, sleeps, calls, indexed, files = self.run_restore([self.unavailable(), io.BytesIO(json.dumps(catalog).encode()), self.unavailable(502), io.BytesIO(raw)])
        self.assertIsNone(error)
        self.assertEqual((sleeps, calls, indexed), ([30, 30], 4, True))
        self.assertEqual(files[catalog['cohorts'][0]['path']], raw)

    def test_four_503_responses_fail_after_three_retries_without_a_catalog(self):
        error, sleeps, calls, indexed, files = self.run_restore([self.unavailable() for _ in range(5)])
        self.assertIsInstance(error, HTTPError)
        self.assertEqual(error.code, 503)
        self.assertEqual((sleeps, calls, indexed, files), ([30, 60, 120], 4, False, {}))

    def test_404_and_other_client_errors_are_answered_at_once_as_before(self):
        error, sleeps, calls, indexed, _ = self.run_restore([self.unavailable(404)])
        self.assertEqual((error, sleeps, calls, indexed), (None, [], 1, True))
        error, sleeps, calls, indexed, _ = self.run_restore([self.unavailable(404)], 'restore_selection_history')
        self.assertEqual((error, sleeps, calls, indexed), (None, [], 1, False))
        for code in (400, 403, 410, 429):
            error, sleeps, calls, indexed, _ = self.run_restore([self.unavailable(code), io.BytesIO(b'{}')])
            self.assertEqual((error.code, sleeps, calls, indexed), (code, [], 1, False))

    def test_integrity_failure_is_never_retried(self):
        catalog, raw = self.fixture()
        error, sleeps, calls, indexed, _ = self.run_restore([io.BytesIO(json.dumps(catalog).encode()), io.BytesIO(raw + b'corrupt'), io.BytesIO(raw)])
        self.assertIsInstance(error, ValueError)
        self.assertRegex(str(error), 'integrity')
        self.assertEqual((sleeps, calls, indexed), ([], 2, False))

    def test_timeouts_and_dropped_connections_mid_body_are_read_again(self):
        catalog, raw = self.fixture()
        for failure in (TimeoutError('read timed out'), socket.timeout('timed out'), ConnectionResetError(104, 'reset'), restore.http.client.IncompleteRead(b'part', 10), URLError(TimeoutError('connect timed out')), URLError(ConnectionRefusedError(111, 'refused'))):
            with self.subTest(failure=type(failure).__name__):
                responses = [BrokenBody(failure) if not isinstance(failure, URLError) else failure, io.BytesIO(json.dumps(catalog).encode()), io.BytesIO(raw)]
                error, sleeps, calls, indexed, files = self.run_restore(responses)
                self.assertIsNone(error)
                self.assertEqual((sleeps, calls, indexed), ([30], 3, True))
                self.assertEqual(files[catalog['cohorts'][0]['path']], raw)

    def test_other_failures_raise_unchanged(self):
        for failure in (URLError('unknown url type'), URLError(socket.gaierror(-2, 'Name or service not known')), ValueError('not json')):
            with self.subTest(failure=repr(failure)):
                error, sleeps, calls, indexed, _ = self.run_restore([failure, io.BytesIO(b'{}')])
                self.assertIs(error, failure)
                self.assertEqual((sleeps, calls, indexed), ([], 1, False))

    def test_selection_history_retries_one_snapshot_then_checks_hash_and_date(self):
        content = json.dumps({'as_of': '2026-11-25'}).encode()
        digest = hashlib.sha256(content).hexdigest()
        catalog = {'snapshots': [{'path': f'candidate-history/2026-11-25-{digest[:16]}.json', 'sha256': digest, 'as_of': '2026-11-25'}]}
        error, sleeps, calls, indexed, files = self.run_restore([io.BytesIO(json.dumps(catalog).encode()), self.unavailable(), io.BytesIO(content)], 'restore_selection_history')
        self.assertIsNone(error)
        self.assertEqual((sleeps, calls, indexed), ([30], 3, True))
        self.assertEqual(files[catalog['snapshots'][0]['path']], content)
        wrong_date = {'snapshots': [{**catalog['snapshots'][0], 'as_of': '2026-11-24'}]}
        error, sleeps, calls, indexed, _ = self.run_restore([io.BytesIO(json.dumps(wrong_date).encode()), self.unavailable(), io.BytesIO(content)], 'restore_selection_history')
        self.assertRegex(str(error), 'integrity')
        self.assertEqual((sleeps, calls, indexed), ([30], 3, False))

    def test_one_restore_waits_at_most_its_budget(self):
        self.assertEqual((restore.RETRY_DELAYS, restore.RETRY_BUDGET_SECONDS), ((30, 60, 120), 600))
        error, sleeps, calls, indexed, _ = self.run_restore([self.unavailable() for _ in range(5)], retry_waited=500)
        self.assertEqual((error.code, sleeps, calls, indexed), (503, [30, 60], 3, False))


if __name__ == '__main__':
    unittest.main()
