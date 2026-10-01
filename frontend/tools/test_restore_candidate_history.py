import gzip
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

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


if __name__ == '__main__':
    unittest.main()
