from copy import deepcopy
from pathlib import Path
import tempfile
import unittest

from app.scripts.daily_price_artifact_provenance import producer_record, verify_producer_artifact


class ProducerArtifactTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(); self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name)
        files = {'daily-price/daily-price-us-20261005.json.gz': b'candidate',
                 'daily-price/daily-price-latest-us.json': b'manifest',
                 'daily-price-promotion/previous.json': b'prior'}
        for name, data in files.items():
            path = self.root / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        self.record = producer_record('candidate', self.root, list(files), repository='owner/repo', run_id=99, run_attempt=1, head_sha='a' * 40)
        self.metadata = {'id': 1001, 'name': 'daily-source-candidate-US-99-1', 'digest': 'sha256:' + 'b' * 64,
                         'expired': False, 'workflow_run': {'id': 99, 'head_sha': 'a' * 40}}

    def verify(self, **overrides):
        args = dict(metadata=self.metadata, record=self.record, artifact_id=1001, artifact_digest='b' * 64,
                    role='candidate', repository='owner/repo', run_id=99, producer_attempt=1, head_sha='a' * 40, root=self.root)
        return verify_producer_artifact(**(args | overrides))

    def test_failed_job_rerun_uses_original_successful_producer_attempt(self):
        # Consumer attempt2/3 is not a selector: output ID1001 and provenance
        # producer1 remain the intended successful artifact on both retries.
        for consumer_attempt in (2, 3):
            with self.subTest(consumer_attempt=consumer_attempt):
                self.assertEqual(self.verify()['producer']['run_attempt'], 1)
        with self.assertRaisesRegex(ValueError, 'provenance'):
            self.verify(producer_attempt=2)

    def test_no_artifact_id_never_resolves_latest_or_fallback(self):
        for value in (0, None, ''):
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, 'artifact ID'):
                self.verify(artifact_id=value)

    def test_wrong_id_digest_expiry_run_and_head_fail(self):
        mutations = [lambda m:m.update(id=1002), lambda m:m.update(digest='sha256:'+'c'*64),
                     lambda m:m.update(expired=True), lambda m:m['workflow_run'].update(id=98),
                     lambda m:m['workflow_run'].update(head_sha='c'*40), lambda m:m.update(name='daily-source-candidate-US-99-2')]
        for mutate in mutations:
            metadata = deepcopy(self.metadata); mutate(metadata)
            with self.assertRaises(ValueError): self.verify(metadata=metadata)

    def test_changed_candidate_or_predecessor_is_rejected(self):
        path = self.root / 'daily-price-promotion/previous.json'
        path.write_bytes(b'altered prior')
        with self.assertRaisesRegex(ValueError, 'bytes changed'):
            self.verify()

    def test_missing_capture_cannot_be_hidden_by_redeclaring_record(self):
        record = deepcopy(self.record)
        del record['files']['daily-price-promotion/previous.json']
        with self.assertRaisesRegex(ValueError, 'closure'):
            self.verify(record=record)

    def test_role_or_attempt_mismatch_fails(self):
        for updates in ({'role': 'downstream'}, {'run_attempt': 2}, {'repository': 'other/repo'}):
            record = self.record | updates
            with self.assertRaises(ValueError): self.verify(record=record)


if __name__ == '__main__':
    unittest.main()
