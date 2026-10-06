import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tarfile
import tempfile
import unittest
import zipfile
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('intake', Path(__file__).with_name('restore-financial-diagnostic.py'))
intake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(intake)

class TestDiagnosticIntake(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def archive(self, extra=None, change_metadata=None, change_sidecar=None):
        data = b'original compiled UI'
        metadata = {'status': 'UNAPPROVED', 'publication_authority': 'none', 'design_accepted': False,
                    'activation_eligible': False, 'producer': {'head_sha': 'a' * 40},
                    'preview_receipt_sha256': 'a' * 64,
                    'files': {'corrected/index.html': {'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}}}
        if change_metadata:
            change_metadata(metadata)
        buf = io.BytesIO()
        with tarfile.open(fileobj=buf, mode='w:gz') as t:
            for name, content in [('UNAPPROVED.txt', b'UNAPPROVED'), ('review-only/corrected/index.html', data), ('UNAPPROVED.json', json.dumps(metadata).encode())]:
                m = tarfile.TarInfo(name)
                m.size = len(content)
                t.addfile(m, io.BytesIO(content))
            if extra:
                t.addfile(extra, io.BytesIO(b'x' * extra.size))
        compressed = buf.getvalue()
        sidecar = {k: metadata[k] for k in ('status', 'publication_authority', 'design_accepted', 'activation_eligible', 'producer', 'preview_receipt_sha256')}
        sidecar.update(sha256=hashlib.sha256(compressed).hexdigest(), bytes=len(compressed))
        if change_sidecar:
            change_sidecar(sidecar)
        path = self.root / 'diagnostic.zip'
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('unapproved-financial-diagnostic.tar.gz', compressed)
            z.writestr('unapproved-financial-diagnostic-metadata.json', json.dumps(sidecar))
        return path

    def test_exact_metadata_inventory_preserved_without_granting_authority(self):
        result = intake.extract_diagnostic(self.archive(), self.root / 'out')
        self.assertEqual(result['status'], 'UNAPPROVED')
        self.assertEqual((self.root / 'out/corrected/index.html').read_bytes(), b'original compiled UI')
        self.assertFalse((self.root / 'out/diagnostic.tar.gz').exists())

    def test_rejects_traversal_duplicate_authority_and_symlink(self):
        for name in ('review-only/../escape', '/absolute', 'review-only/corrected/index.html', 'review-only/candidate.json', 'review-only/corrected/publication.json', 'review-only/transport.json/nested'):
            with self.subTest(name=name):
                m = tarfile.TarInfo(name)
                with self.assertRaises(ValueError):
                    intake.extract_diagnostic(self.archive(extra=m), self.root / str(len(list(self.root.iterdir()))))
        m = tarfile.TarInfo('review-only/corrected/link')
        m.type, m.linkname = tarfile.SYMTYPE, '/outside'
        with self.assertRaises(ValueError):
            intake.extract_diagnostic(self.archive(extra=m), self.root / 'link')

    def test_rejects_mutated_nested_archive_or_inventory_or_authority(self):
        for index, kwargs in enumerate(({'change_sidecar': lambda m: m.update(sha256='b' * 64)}, {'change_metadata': lambda m: m['files'].clear()}, {'change_metadata': lambda m: m.update(activation_eligible=True)})):
            with self.subTest(index=index), self.assertRaises(ValueError):
                intake.extract_diagnostic(self.archive(**kwargs), self.root / f'bad-{index}')

    def test_enforces_resource_bounds_before_extraction(self):
        with self.assertRaises(ValueError):
            intake.extract_diagnostic(self.archive(), self.root / 'small', maximum_bytes=10)
        with self.assertRaises(ValueError):
            intake.extract_diagnostic(self.archive(), self.root / 'few', maximum_files=1)

    def test_rejects_duplicate_outer_zip(self):
        path = self.archive()
        with zipfile.ZipFile(path, 'a') as z:
            z.writestr('extra', b'x')
        with self.assertRaises(ValueError):
            intake.extract_diagnostic(path, self.root / 'duplicate')

    def test_design_reads_only_hashes_report_and_input_provenance(self):
        path = self.root / 'design.zip'
        with zipfile.ZipFile(path, 'w') as z:
            z.writestr('a/design-review/report.json', '{}')
            z.writestr('a/design-input-provenance.json', '{}')
            z.writestr('a/design-review/one.png', b'pixels')
        out = self.root / 'design'
        self.assertEqual(intake.read_design(path, out), {'one.png': hashlib.sha256(b'pixels').hexdigest()})
        self.assertFalse((out / 'one.png').exists())

    def test_only_preview_publication_has_a_narrow_authority_exception(self):
        from financial_diagnostic_transport import preview_publication
        root = self.root / 'preview'
        (root / 'corrected').mkdir(parents=True)
        path = root / 'corrected/publication.json'
        valid = {'schema': 'static-json-transport-preview-v1', 'publication_authority': 'none',
                 'ui_sha': 'a' * 40, 'ui_digest': 'b' * 64,
                 'data_manifest_sha256': 'c' * 64, 'transport': {'fixture': True}}
        path.write_text(json.dumps(valid))
        self.assertEqual(preview_publication(root), valid)
        for change in ({'schema': 1}, {'approval': {}}, {'publication_authority': 'approved'}, {'transport': None}):
            path.write_text(json.dumps({**valid, **change}))
            with self.assertRaises(ValueError):
                preview_publication(root)

    def test_transport_proof_subprocess_is_required_and_bound_to_original_receipt(self):
        import financial_diagnostic_transport as transport
        root = self.root / 'proof'
        (root / 'corrected').mkdir(parents=True)
        preview = {'schema': 'static-json-transport-preview-v1', 'publication_authority': 'none',
                   'ui_sha': 'a' * 40, 'ui_digest': 'b' * 64,
                   'data_manifest_sha256': 'c' * 64, 'transport': {'fixture': True}}
        raw = json.dumps(preview).encode()
        (root / 'corrected/publication.json').write_bytes(raw)
        (root / 'preview-receipt.json').write_text(json.dumps({'candidate_ui': {'sha': 'a' * 40, 'digest': 'b' * 64},
                                                            'bundles': {'corrected_data_sha256': 'd' * 64}}))
        verified = {'schema': 'verified-candidate-transport-v1', 'logical_data_inventory_sha256': 'd' * 64,
                    'ui_inventory_sha256': 'b' * 64, 'physical_inventory_sha256': 'e' * 64,
                    'preview_publication_sha256': hashlib.sha256(raw).hexdigest()}
        from types import SimpleNamespace
        with patch.object(transport.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps(verified))) as run:
            self.assertEqual(transport.verify_candidate_transport(root), verified)
        self.assertTrue(run.call_args.kwargs['check'])
        self.assertEqual(run.call_args.kwargs['timeout'], 600)
        self.assertIn('verify-candidate-transport', run.call_args.args[0])
        for field in ('logical_data_inventory_sha256', 'ui_inventory_sha256', 'preview_publication_sha256'):
            with patch.object(transport.subprocess, 'run', return_value=SimpleNamespace(stdout=json.dumps({**verified, field: 'f' * 64}))):
                with self.assertRaisesRegex(ValueError, 'differs'):
                    transport.verify_candidate_transport(root)
        with patch.object(transport.subprocess, 'run', side_effect=RuntimeError('verifier failed')):
            with self.assertRaisesRegex(RuntimeError, 'verifier failed'):
                transport.verify_candidate_transport(root)

if __name__ == '__main__':
    unittest.main()
