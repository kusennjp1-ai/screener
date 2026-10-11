"""Offline destination policy tests; synthetic transport cannot access providers."""
from copy import deepcopy
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

    def test_native_eps_keeps_reported_values_and_does_not_claim_issuer_verification(self):
        for currency in ('CAD', 'EUR', 'JPY'):
            with self.subTest(currency=currency):
                value, source, _ = self.derive(self.setup_source(currency))
                item = value['symbols']['NVDA']
                history = item['financial_history']
                self.assertEqual([point['eps'] for point in history['annual'][-4:]], [2., 3., 4., 5.])
                self.assertEqual(history['annual_source']['currency'], currency)
                self.assertEqual(history['basis'], 'reported_diluted_eps')
                self.assertFalse(history['point_in_time'])
                self.assertIsNone(history['source_publication_date'])
                self.assertEqual(history['source_url'], source['symbols']['NVDA']['financial_history']['source_url'])
                # A matching provider ticker is not a verified legal issuer ID.
                self.assertEqual(item['financial_identity']['status'], 'ticker_only')
                self.assertFalse(item['financial_identity']['identifiers_bound_to_financial_receipts'])

    def test_basic_eps_and_nonconsecutive_years_do_not_extend_history(self):
        def basic(value):
            row = value['timeseries']['result'][0]
            row['meta']['type'] = ['annualBasicEPS']
            row['annualBasicEPS'] = row.pop('annualDilutedEPS')

        def gap(value):
            for row in value['timeseries']['result']:
                del row[row['meta']['type'][0]][1]
                del row['timestamp'][1]

        def short(value):
            for row in value['timeseries']['result']:
                key = row['meta']['type'][0]
                row[key], row['timestamp'] = row[key][:3], row['timestamp'][:3]

        for mutate in (basic, gap, short):
            with self.subTest(mutate=mutate.__name__):
                value, source, summary = self.derive(self.setup_source(mutate=mutate))
                self.assertEqual(summary['native_annual_histories'], 0)
                self.assertEqual(value['symbols'], source['symbols'])

    def test_mismatched_acquisition_symbol_and_provider_symbol_are_rejected(self):
        test = self.setup_source()
        summary = legacy.export_projection(**test.kwargs)
        source = json.loads(Path(summary['projection_path']).read_bytes())
        verified = archive.load_archive(test.archive, test.archive_sha, base_bytes=test.base, cohort=test.cohort, now=test.now)
        sha = verified.manifest['current']['NVDA/income_stmt']
        for field in ('symbol', 'provider_symbol'):
            with self.subTest(field=field):
                altered = deepcopy(verified)
                raw = altered.acquisitions[sha]['raw']
                if field == 'symbol':
                    raw[field] = 'OTHER'
                else:
                    raw['source_acquisition_contexts']['income_stmt'][field] = 'OTHER'
                with self.assertRaises(fixtures.batch.InvalidCache):
                    native.derive_projection(source, altered,
                        original_sha256=summary['projection_sha256'], now=test.now)

    def test_stale_reporting_period_does_not_become_current_via_native_currency(self):
        def old_periods(value):
            for row in value['timeseries']['result']:
                points = row[row['meta']['type'][0]]
                for point in points:
                    point['asOfDate'] = str(int(point['asOfDate'][:4]) - 1) + point['asOfDate'][4:]
                row['timestamp'] = [int(fixtures.pd.Timestamp(point['asOfDate'], tz='UTC').timestamp()) for point in points]

        value, source, summary = self.derive(self.setup_source(mutate=old_periods))
        self.assertEqual(summary['native_annual_histories'], 0)
        self.assertEqual(value['symbols'], source['symbols'])
        self.assertEqual(value['symbols']['NVDA']['history_source_diagnostics']['reasons']['annual'], 'stale_reporting_period')

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
