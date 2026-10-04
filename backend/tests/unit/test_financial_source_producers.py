"""Shadow producer behavior through real vendor normalization, offline only."""
from datetime import datetime, timedelta, timezone
import math
from types import SimpleNamespace
from unittest.mock import MagicMock

import pandas as pd
import pytest
import yfinance as yf

from app.services import bulk_data_fetcher as bulk_module
from app.services import financial_source_capture as capture
from app.services.bulk_data_fetcher import BulkDataFetcher
from app.services.eps_rating_service import EPSRatingService
from app.services.financial_source_evidence import validate_envelope
from app.services.provider_snapshot_service import ProviderSnapshotService
from app.services.yfinance_service import YFinanceService
from tests.unit.test_financial_source_yahoo_contract import real_transport  # noqa: F401


def _statements(prefix, periods, eps):
    return {"timeseries": {"error": None, "result": [
        {"meta": {"symbol": ["AAPL"], "type": [prefix + metric]},
         "timestamp": [int(pd.Timestamp(period).timestamp()) for period in periods],
         prefix + metric: [{"asOfDate": period, "currencyCode": "USD", "reportedValue": {"raw": value}}
                           for period, value in zip(periods, values)]}
        for metric, values in [("DilutedEPS", eps), ("TotalRevenue", [100 + i * 10 for i in range(len(periods))])]
    ]}}


def _full_statements(real_transport):
    real_transport["statement"] = _statements("quarterly", ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"], [0., -1., 2., 3., 1., -2.])
    real_transport["annual_statement"] = _statements("annual", ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"], [5., 4., 3., 2., 1.])


def _snapshot_service():
    return ProviderSnapshotService(price_cache=SimpleNamespace(), fundamentals_cache=SimpleNamespace(), rate_limiter=MagicMock())


def test_single_fraction_and_bulk_percent_units_preserve_existing_values(real_transport, monkeypatch):
    real_transport["quote"]["quoteResponse"]["result"][0].update(marketCap=1000, sharesOutstanding=100, currentPrice=10)
    single = YFinanceService(rate_limiter=MagicMock(), eps_rating_service=EPSRatingService())
    monkeypatch.setattr(single, "_extract_eps_rating_data", lambda ticker: {})
    single_result = single.get_fundamentals("AAPL")
    fetcher = BulkDataFetcher(rate_limiter=MagicMock())
    monkeypatch.setattr(bulk_module, "_new_yf_tickers", lambda symbols: SimpleNamespace(tickers={"AAPL": yf.Ticker("AAPL")}))
    bulk_result = fetcher.fetch_batch_fundamentals(["AAPL"], include_quarterly=False, delay_per_ticker=0)["AAPL"]
    assert single_result["profit_margin"] == -.1
    assert bulk_result["profit_margin"] == -10.
    assert single_result["roe"] == bulk_result["roe"] == 0.
    single_fields = validate_envelope(single_result["financial_source_evidence"])["fields"]
    bulk_fields = validate_envelope(bulk_result["financial_source_evidence"])["fields"]
    assert single_fields["profit_margin"]["unit"] == "fraction"
    assert bulk_fields["profit_margin"]["unit"] == "percent_points"
    assert bulk_fields["profit_margin"]["source_value"] == -.1
    assert bulk_fields["profit_margin"]["conversion"] == "multiply_100_round_2dp"
    assert single_fields["roe"]["period_end"] is None
    assert single_fields["roe"]["period_status"] == "not_supplied"


def test_shadow_capture_failure_preserves_computed_scalars(real_transport, monkeypatch):
    _full_statements(real_transport)
    def rejected_record(*args, **kwargs):
        raise ValueError("synthetic capture validation failure")
    monkeypatch.setattr(capture, "make_observed_record", rejected_record)
    result = YFinanceService(rate_limiter=MagicMock()).get_quarterly_growth("AAPL")
    assert result["eps_growth_qq"] == 100. and result["eps_growth_yy"] == -100.
    assert result["financial_source_evidence"]["fields"] == {}


def test_nonfinite_legacy_value_does_not_break_shadow_merge(real_transport, monkeypatch):
    real_transport["summary"]["quoteSummary"]["result"][0]["financialData"]["profitMargins"]["raw"] = float("nan")
    real_transport["quote"]["quoteResponse"]["result"][0].update(marketCap=1000, sharesOutstanding=100, currentPrice=10)
    monkeypatch.setattr(bulk_module, "_new_yf_tickers", lambda symbols: SimpleNamespace(tickers={"AAPL": yf.Ticker("AAPL")}))
    result = BulkDataFetcher(rate_limiter=MagicMock()).fetch_batch_fundamentals(["AAPL"], include_quarterly=True, delay_per_ticker=0)["AAPL"]
    assert not result.get("has_error") and math.isnan(result["profit_margin"])
    assert "profit_margin" not in result["financial_source_evidence"]["fields"]


def test_growth_and_eps_share_quarterly_receipt_but_keep_annual_and_q2_periods(real_transport, monkeypatch):
    _full_statements(real_transport)
    now = datetime(2026, 10, 1, tzinfo=timezone.utc)
    clocks = iter([now, now + timedelta(hours=1), now + timedelta(hours=2)])
    monkeypatch.setattr(capture, "_utc_now", lambda: next(clocks))
    ticker = yf.Ticker("AAPL")
    fetcher = BulkDataFetcher(rate_limiter=MagicMock())
    growth = fetcher._extract_quarterly_growth(ticker)
    eps = fetcher._extract_eps_rating_data(ticker)
    growth_fields = validate_envelope(growth["financial_source_evidence"])["fields"]
    eps_fields = validate_envelope(eps["financial_source_evidence"])["fields"]
    assert growth["eps_growth_qq"] == 100.
    assert growth["eps_growth_yy"] == -100.
    assert eps["eps_q1_yoy"] == -100. and eps["eps_q2_yoy"] == 50.
    assert growth_fields["eps_growth_qq"]["capture_id"] == eps_fields["eps_q2_yoy"]["capture_id"]
    assert eps_fields["eps_q1_yoy"]["observed_at"] == "2026-10-01T00:00:00.000Z"
    assert eps_fields["eps_5yr_cagr"]["observed_at"] == "2026-10-01T01:00:00.000Z"
    assert eps_fields["eps_q1_yoy"]["period_end"] == "2026-06-30"
    assert eps_fields["eps_q2_yoy"]["period_end"] == "2026-03-31"
    assert eps_fields["eps_q2_yoy"]["comparable_period_end"] == "2025-03-31"
    assert eps_fields["eps_5yr_cagr"]["periods_used"] == ["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"]
    raw = eps_fields["eps_raw_score"]
    assert raw["observed_at"] is None and raw["provenance_kind"] == "derived"
    assert set(raw["dependencies"]) == {eps_fields[name]["observation_id"] for name in ["eps_5yr_cagr", "eps_q1_yoy", "eps_q2_yoy"]}
    assert len(real_transport["calls"]) == 2
    # One copy of each original statement subset, even with several fields.
    assert len(eps["financial_source_evidence"]["captures"]) == 2
    assert all("source_payload" not in field for field in eps_fields.values())


def test_partial_invalid_annual_source_keeps_legacy_scores_without_false_proof(real_transport):
    _full_statements(real_transport)
    real_transport["annual_statement"]["timeseries"]["error"] = {"code": "partial"}
    result = BulkDataFetcher(rate_limiter=MagicMock())._extract_eps_rating_data(yf.Ticker("AAPL"))
    assert result["eps_5yr_cagr"] is not None and result["eps_raw_score"] is not None
    fields = result["financial_source_evidence"]["fields"]
    assert set(fields) == {"eps_q1_yoy", "eps_q2_yoy"}


def test_single_quarterly_path_preserves_same_numeric_calculation(real_transport):
    _full_statements(real_transport)
    result = YFinanceService(rate_limiter=MagicMock()).get_quarterly_growth("AAPL")
    assert result["eps_growth_yy"] == -100
    fields = validate_envelope(result["financial_source_evidence"])["fields"]
    assert fields["eps_growth_qq"]["basis"] == "quarterly_qoq/v1"
    assert fields["eps_growth_yy"]["basis"] == "comparable_period_yoy/v1"


def test_empty_snapshot_extractors_do_not_report_statement_observation(monkeypatch):
    service = _snapshot_service()
    monkeypatch.setattr(yf, "Ticker", lambda symbol: SimpleNamespace(ticker=symbol, info={}))
    monkeypatch.setattr(service.bulk_fetcher, "_extract_quarterly_growth", lambda ticker, **kwargs: {"eps_growth_qq": None, "growth_reporting_cadence": "insufficient_history"})
    monkeypatch.setattr(service.bulk_fetcher, "_extract_eps_rating_data", lambda ticker, **kwargs: {"eps_raw_score": None, "eps_years_available": 0})
    result = service._fetch_yahoo_only_fields("AAPL")
    assert result["eps_years_available"] == 0
    assert "yahoo_statements_refreshed_at" not in result
    assert "yahoo_profile_refreshed_at" not in result
    assert result["financial_source_evidence"]["fields"] == {}


def test_snapshot_partial_failure_keeps_quarterly_original_clock(real_transport):
    _full_statements(real_transport)
    real_transport["annual_statement"] = {"timeseries": {"error": {"code": "unavailable"}, "result": []}}
    real_transport["quote"]["quoteResponse"]["result"][0].update(marketCap=1000, sharesOutstanding=100)
    result = _snapshot_service()._fetch_yahoo_only_fields("AAPL")
    fields = validate_envelope(result["financial_source_evidence"])["fields"]
    assert fields["eps_growth_qq"]["provenance_kind"] == "observed"
    assert "eps_5yr_cagr" not in fields
    assert result["yahoo_statements_refreshed_at"] == fields["eps_growth_qq"]["observed_at"]
    assert "yahoo_profile_refreshed_at" not in result


def test_finviz_category_windows_do_not_certify_fields_or_change_precedence(monkeypatch):
    service = _snapshot_service()
    service.CATEGORY_LOADERS = {"valuation": None, "financial": None}
    rows = {
        "valuation": {"Ticker": "AAPL", "EPS Y/Y TTM": "0%", "ROE": "9%"},
        "financial": {"Ticker": "AAPL", "Profit Margin": "-10%", "ROE": "0%"},
    }
    def screener(category):
        class FakeScreener:
            def set_filter(self, **kwargs):
                pass
            def screener_view(self, **kwargs):
                return pd.DataFrame([rows[category]])
        return FakeScreener
    monkeypatch.setattr(service, "_load_screener_class", screener)
    result = service._build_snapshot_rows(exchange_filter="NASDAQ")["AAPL"]
    payload = result["normalized_payload"]
    assert payload["roe"] == 0 and payload["profit_margin"] == -10 and payload["eps_growth_yy"] == 0
    assert result["raw_payload"]["valuation"]["EPS Y/Y TTM"] == "0%"
    assert set(payload["financial_acquisition_windows"]) == {"valuation", "financial"}
    assert all(window["observation_status"] == "unverified_per_page_acquisition" for window in payload["financial_acquisition_windows"].values())
    fields = validate_envelope(payload["financial_source_evidence"])["fields"]
    assert all(record["observed_at"] is None and record["provenance_kind"] == "legacy_canonical_map" for record in fields.values())


@pytest.mark.parametrize("symbol", ["AAPL", "aapl", " AAPL "])
def test_single_identity_spelling_preserves_full_scalar_result(real_transport, symbol):
    _full_statements(real_transport)
    service = YFinanceService(rate_limiter=MagicMock())
    result = service.get_fundamentals(symbol)
    assert result is not None and result["symbol"] == symbol
    assert result["profit_margin"] == -.1 and result["roe"] == 0.
    assert result["eps_q1_yoy"] == -100. and result["eps_q2_yoy"] == 50.
    assert result["eps_5yr_cagr"] == 49.53
    fields = validate_envelope(result["financial_source_evidence"])["fields"]
    # Whitespace is preserved by the legacy public result. Vendor transport
    # aliases that cannot be bound exactly are permitted to remain unverified.
    assert all(field["symbol"] == "AAPL" for field in fields.values())
    if symbol == "aapl":
        assert fields["eps_q1_yoy"]["provenance_kind"] == "observed"


@pytest.mark.parametrize("parallel", [False, True])
def test_lowercase_bulk_market_preserves_scalar_result(real_transport, monkeypatch, parallel):
    _full_statements(real_transport)
    real_transport["quote"]["quoteResponse"]["result"][0].update(marketCap=1000, sharesOutstanding=100, currentPrice=10)
    monkeypatch.setattr(bulk_module, "_new_yf_tickers", lambda symbols: SimpleNamespace(tickers={"AAPL": yf.Ticker("AAPL")}))
    fetcher = BulkDataFetcher(rate_limiter=MagicMock())
    if parallel:
        result = fetcher.fetch_fundamentals_parallel(["AAPL"], market_by_symbol={"AAPL": "us"}, delay_per_ticker=0)["AAPL"]
    else:
        result = fetcher.fetch_batch_fundamentals(["AAPL"], market="us", delay_per_ticker=0)["AAPL"]
    assert not result.get("has_error")
    assert result["roe"] == 0 and result["profit_margin"] == -10
    assert result["eps_q1_yoy"] == -100 and result["eps_q2_yoy"] == 50
    envelope = validate_envelope(result["financial_source_evidence"])
    assert envelope["market"] == "US"
    assert envelope["fields"]["eps_q1_yoy"]["provenance_kind"] == "observed"


@pytest.mark.parametrize("periods,cadence,gap,basis", [
    (["2026-06-30", "2025-12-31", "2025-06-30", "2024-12-31", "2024-06-30", "2023-12-31"], "semiannual", 730, "positional_eps_growth/v1"),
    (["2026-06-30", "2026-03-31", "2025-09-30", "2025-06-30", "2024-12-31", "2024-09-30"], "irregular", 546, "positional_eps_growth/v1"),
    (["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"], "quarterly", 365, "quarterly_eps_yoy/v1"),
])
def test_actual_getter_eps_cadence_is_truthful_without_changing_positional_arithmetic(real_transport, periods, cadence, gap, basis):
    _full_statements(real_transport)
    real_transport["statement"] = _statements("quarterly", periods, [3., 4., 2., 3., 1., -2.])
    ticker = yf.Ticker("AAPL")
    result = BulkDataFetcher(rate_limiter=MagicMock())._extract_eps_rating_data(ticker)
    legacy = EPSRatingService().calculate_eps_rating_data(ticker.income_stmt, ticker.quarterly_income_stmt)
    assert {key: result[key] for key in legacy} == legacy
    assert result["eps_q1_yoy"] == 200 and result["eps_q2_yoy"] == 300
    fields = validate_envelope(result["financial_source_evidence"])["fields"]
    q1 = fields["eps_q1_yoy"]
    assert q1["provenance_kind"] == "observed"
    assert q1["cadence"] == cadence and q1["basis"] == basis
    assert q1["reference_gap_days"] == gap
    assert q1["periods_used"] == [periods[0], periods[4]]
    assert q1["column_positions"] == [0, 4]
    assert q1["statement_periods"] == periods[:5]
    assert fields["eps_raw_score"]["provenance_kind"] == "derived"


def test_unsupported_shadow_identity_preserves_all_scalars(real_transport, monkeypatch):
    _full_statements(real_transport)
    def unresolved(**kwargs):
        raise ValueError("Unsupported shadow identity")
    monkeypatch.setattr(capture.security_master_resolver, "resolve_identity", unresolved)
    result = YFinanceService(rate_limiter=MagicMock()).get_fundamentals("AAPL")
    assert result["roe"] == 0 and result["profit_margin"] == -.1
    assert result["eps_q1_yoy"] == -100 and result["eps_5yr_cagr"] == 49.53
    envelope = validate_envelope(result["financial_source_evidence"])
    assert all(field["provenance_kind"] == "legacy_canonical_map" for field in envelope["fields"].values())
    assert envelope["retained_raw_envelopes"]
