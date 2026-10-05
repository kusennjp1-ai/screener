"""Offline destination policy tests; synthetic transport cannot access providers."""
from datetime import timedelta
import json
from pathlib import Path
import unittest
from unittest.mock import patch

from app.scripts import export_native_annual_projection as native
from app.scripts import export_statement_projection as legacy
from app.services import statement_artifact_archive as archive
from app.services.native_annual_history import CONTRACT
from tests.unit import test_export_statement_projection as original
from tests.unit import test_financial_statement_batch as fixtures


class TestNativeAnnualProjection(unittest.TestCase):
    def setup_source(self, currency='CAD', mutate=None):
        body = fixtures.body
        def source(symbol, attribute, **kwargs):
            value = body(symbol, attribute, **{**kwargs, 'currency': currency if attribute == 'income_stmt' else 'USD'})
            if mutate and attribute == 'income_stmt':
                mutate(value)
            return value
        test = original.TestExportStatementProjection()
        with patch.object(fixtures, 'body', source):
            test.setUp()
        self.addCleanup(test.doCleanups)
        return test

    def derive(self, test):
        summary = native.export_projection(**test.kwargs)
        value = json.loads(Path(summary['projection_path']).read_bytes())
        source = json.loads(Path(summary['source_projection_path']).read_bytes())
        return value, source, summary

    def test_new_policy_binds_source_without_changing_originals_or_quarterly_scalars(self):
        test = self.setup_source()
        before = {str(path): path.read_bytes() for path in test.archive.rglob('*') if path.is_file()}
        value, source, summary = self.derive(test)
        self.assertEqual(summary['native_annual_histories'], 1)
        self.assertEqual(value['policy']['id'], CONTRACT['policy_id'])
        self.assertEqual(value['derivation']['source_projection_sha256'], summary['source_projection_sha256'])
        self.assertEqual(value['receipt_inventory'], source['receipt_inventory'])
        self.assertEqual(value['bindings'], source['bindings'])
        item, previous = value['symbols']['NVDA'], source['symbols']['NVDA']
        history = item['financial_history']
        self.assertEqual(previous['financial_history']['annual'], [])
        self.assertEqual(previous['history_source_diagnostics']['reasons']['annual'], 'unsupported_currency')
        self.assertEqual(history['annual_currency'], 'CAD')
        self.assertEqual(history['quarterly_currency'], 'USD')
        self.assertEqual(history['quarterly'], previous['financial_history']['quarterly'])
        self.assertEqual(history['quarterly_retrieved_at'], previous['financial_history']['retrieved_at'])
        self.assertEqual(history['annual_source']['observed_at'], fixtures.batch.timestamp(fixtures.NOW + timedelta(seconds=2)))
        for field in ['financial_values', 'financial_current', 'financial_source_evidence', 'source_receipts', 'financial_identity', 'instrument_applicability']:
            self.assertEqual(item[field], previous[field])
        self.assertEqual(before, {str(path): path.read_bytes() for path in test.archive.rglob('*') if path.is_file()})
        self.assertEqual(value['symbols']['AMD'], source['symbols']['AMD'])
        self.assertEqual(value['symbols']['VIRT'], source['symbols']['VIRT'])

    def test_usd_series_and_all_owned_results_are_unchanged(self):
        value, source, summary = self.derive(self.setup_source('USD'))
        self.assertEqual(summary['native_annual_histories'], 0)
        self.assertEqual(value['symbols'], source['symbols'])

    def test_mixed_currency_and_missing_diluted_cells_remain_unknown(self):
        def series(value):
            return value['timeseries']['result'][0]['annualDilutedEPS']
        for mutate in [lambda value: series(value)[0].update(currencyCode='USD'),
                       lambda value: series(value)[1].update(reportedValue={'raw': None})]:
            with self.subTest(mutate=mutate):
                value, source, summary = self.derive(self.setup_source(mutate=mutate))
                self.assertEqual(summary['native_annual_histories'], 0)
                self.assertEqual(value['symbols'], source['symbols'])

    def test_nonpositive_base_keeps_completeness_and_zero_latest_is_not_rejected(self):
        def series(value):
            return value['timeseries']['result'][0]['annualDilutedEPS']
        for index, reason in [(1, 'nonpositive_comparison_base'), (0, 'available')]:
            with self.subTest(index=index):
                value, _, summary = self.derive(self.setup_source(mutate=lambda value: series(value)[index].update(reportedValue={'raw': 0})))
                self.assertEqual(summary['native_annual_histories'], 1)
                self.assertEqual(value['symbols']['NVDA']['history_source_diagnostics']['reasons']['annual'], reason)

    def test_replay_rejects_wrong_legacy_digest_and_preserves_expired_unknowns(self):
        test = self.setup_source()
        summary = legacy.export_projection(**test.kwargs)
        source = json.loads(Path(summary['projection_path']).read_bytes())
        verified = archive.load_archive(test.archive, test.archive_sha, base_bytes=test.base, cohort=test.cohort, now=test.now)
        with self.assertRaisesRegex(ValueError, 'source binding'):
            native.derive_projection(source, verified, original_sha256='0'*64, now=test.now)
        test.kwargs['evaluated_at'] = fixtures.batch.timestamp(test.now + timedelta(hours=73))
        value, source, summary = self.derive(test)
        self.assertEqual(summary['native_annual_histories'], 0)
        self.assertEqual(value['symbols'], source['symbols'])

    def test_source_policy_files_and_frontend_contract_remain_distinct(self):
        frontend = legacy.ROOT / 'frontend/contracts/native_annual_history_v1.json'
        self.assertEqual(frontend.read_bytes(), native.CONTRACT_PATH.read_bytes())
        self.assertNotIn('native_annual_history.py', '\n'.join(legacy.PROJECTOR_FILES))
        source_contract, _ = legacy.policy_identity()
        self.assertEqual(source_contract['policy_id'], CONTRACT['source_policy_id'])
