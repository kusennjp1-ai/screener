"""Provider selection remains scalar-compatible through shadow storage."""
from copy import deepcopy
import pickle
from unittest.mock import MagicMock

import pytest

from app.services.data_source_service import DataSourceService
from app.services.financial_source_evidence import (
    make_capture_context, make_envelope, make_observed_record,
    merge_financial_payloads, restore_retained_raw_envelope, validate_envelope,
)
from app.services.provider_adapters.fundamentals_plan_executor import FundamentalsProviderPlanExecutor
from app.services.yfinance_service import YFinanceService
from tests.unit.test_financial_evidence_cache import service  # noqa: F401
from tests.unit.test_financial_source_producers import _full_statements
from tests.unit.test_financial_source_yahoo_contract import real_transport  # noqa: F401


def observed(values, source="yfinance", symbol="AAPL", market="US"):
    capture = make_capture_context(
        symbol=symbol, market=market, source=source, producer=f"{source}.fixture/v1",
        provider_symbol=symbol, observed_at="2026-10-03T12:00:00Z", source_payload=values,
    )
    fields = {key: make_observed_record(key, value, capture, unit="percent_points", basis="test-v1")
              for key, value in values.items() if value is not None}
    return {"symbol": symbol, "market": market, **values,
            "financial_source_evidence": make_envelope(symbol=symbol, market=market, fields=fields)}


def host(yahoo, finviz=None, core=None, statements=None):
    service = DataSourceService(
        yfinance_service=yahoo, finviz_service=MagicMock(), cn_market_data_service=MagicMock(),
        krx_fundamentals_service=MagicMock(), opendart_fundamentals_service=MagicMock(),
        rate_limiter=MagicMock(),
    )
    service.finviz_service.get_fundamentals.return_value = finviz
    service.cn_market_data_service.core_fundamentals.return_value = core
    service.cn_market_data_service.statement_fundamentals.return_value = statements
    return service


def legacy_overlay(target, incoming, missing_only):
    expected = deepcopy(target)
    for key, value in incoming.items():
        if value is not None and not (missing_only and key in target):
            expected[key] = deepcopy(value)
    expected.pop("financial_source_evidence", None)
    return expected


@pytest.mark.parametrize("primary_observed,fallback_observed,missing_only,first,last,expected_source", [
    (False, True, True, 0., 0., None),
    (True, True, True, 0., 0., "primary"),
    (True, True, True, -5., -5., "primary"),
    (True, False, False, 0., 0., None),
    (False, True, False, -5., -6., "fallback"),
    (False, True, True, None, 0., None),
    (True, False, False, -5., None, "primary"),
])
def test_executor_overlay_preserves_exact_scalar_owner(primary_observed, fallback_observed, missing_only, first, last, expected_source):
    target = observed({"roe": first}, "primary") if primary_observed else {"roe": first}
    incoming = observed({"roe": last}, "fallback") if fallback_observed else {"roe": last}
    original_target, original_incoming = deepcopy(target), deepcopy(incoming)
    expected = legacy_overlay(target, incoming, missing_only)
    FundamentalsProviderPlanExecutor._merge_payload(target, incoming, missing_only=missing_only, symbol="AAPL", market="US")
    assert {key: value for key, value in target.items() if key != "financial_source_evidence"} == expected
    assert incoming == original_incoming
    envelope = validate_envelope(target["financial_source_evidence"])
    record = envelope["fields"].get("roe")
    if target["roe"] is None:
        assert record is None
    elif expected_source:
        assert record["source"] == expected_source and record["provenance_kind"] == "observed"
    else:
        assert record["provenance_kind"] == "legacy_canonical_map"
    retained = [restore_retained_raw_envelope(envelope, key) for key in envelope["retained_raw_envelopes"]]
    for original in (original_target, original_incoming):
        if "financial_source_evidence" in original:
            assert original["financial_source_evidence"] in retained


@pytest.mark.parametrize("missing_only", [True, False])
def test_alias_scalar_outcomes_are_unchanged_and_conflicts_cannot_certify(missing_only):
    target = {"eps_growth_qq": 0., "eps_growth_quarterly": -5., "roe": None}
    incoming = {**observed({"eps_growth_qq": 0., "roe": 0.}), "eps_growth_quarterly": -10.}
    expected = legacy_overlay(target, incoming, missing_only)
    FundamentalsProviderPlanExecutor._merge_payload(target, incoming, missing_only=missing_only, symbol="AAPL", market="US")
    assert {key: value for key, value in target.items() if key != "financial_source_evidence"} == expected
    assert target["financial_source_evidence"]["fields"]["eps_growth_qq"]["provenance_kind"] == "legacy_canonical_map"


def test_multiple_provider_sources_keep_only_selected_owner_and_all_raw_envelopes():
    target = {"roe": 0., "eps_growth_quarterly": -5.}
    statement = observed({"eps_growth_qq": -5.}, "statement")
    fallback = observed({"roe": 0., "eps_growth_qq": -5., "profit_margin": -10.})
    FundamentalsProviderPlanExecutor._merge_payload(target, statement, missing_only=False, symbol="AAPL", market="US")
    FundamentalsProviderPlanExecutor._merge_payload(target, fallback, missing_only=True, symbol="AAPL", market="US")
    fields = target["financial_source_evidence"]["fields"]
    assert fields["roe"]["provenance_kind"] == "legacy_canonical_map"
    assert fields["eps_growth_qq"]["source"] == "statement"
    assert fields["profit_margin"]["source"] == "yfinance"
    assert target["eps_growth_quarterly"] == target["eps_growth_qq"] == -5.
    assert len(target["financial_source_evidence"]["captures"]) == 2


def test_foreign_evidence_is_retained_unverified_and_core_still_rejects_cross_security():
    foreign = observed({"roe": 0.}, symbol="MSFT")
    target = {"symbol": "AAPL", "market": "US", "roe": 0.}
    with pytest.raises(ValueError, match="different symbols"):
        merge_financial_payloads(target, foreign)
    FundamentalsProviderPlanExecutor._merge_payload(target, foreign, missing_only=True, symbol="AAPL", market="US")
    envelope = validate_envelope(target["financial_source_evidence"])
    assert envelope["fields"]["roe"]["provenance_kind"] == "legacy_canonical_map"
    assert any(restore_retained_raw_envelope(envelope, key).get("rejected_source_envelope") == foreign["financial_source_evidence"]
               for key in envelope["retained_raw_envelopes"])


def test_actual_cn_provider_adapter_preserves_primary_zero_through_cache(service):
    cache, _, redis = service
    yahoo = MagicMock()
    yahoo.get_fundamentals.return_value = observed({"roe": 0., "profit_margin": -10.}, symbol="600519.SS", market="CN")
    provider = host(yahoo, core={"roe": 0.}, statements={})
    result = provider.get_fundamentals("600519.SS", market="CN")
    assert result["data_source"] == "akshare+yfinance"
    assert cache.store("600519.SS", result, market="CN")
    stored = pickle.loads(redis.values[cache._redis_data_key("600519.SS", "CN")])
    assert stored["roe"] == 0 and stored["profit_margin"] == -10
    fields = validate_envelope(stored["financial_source_evidence"])["fields"]
    assert fields["roe"]["provenance_kind"] == "legacy_canonical_map"
    assert fields["profit_margin"]["source"] == "yfinance"
    assert any(record["provenance_kind"] == "observed" for record in stored["financial_source_evidence"]["retained_candidates"]["roe"])


def test_actual_finviz_eps_supplement_preserves_selected_capture_through_cache(real_transport, service):
    _full_statements(real_transport)
    cache, _, redis = service
    yahoo = YFinanceService(rate_limiter=MagicMock())
    provider = host(yahoo, finviz={"market_cap": 1000, "roe": 0., "profit_margin": -.1})
    result = provider.get_fundamentals("AAPL", market="US")
    assert result["data_source"] == "finviz"
    assert result["eps_q1_yoy"] == -100. and result["eps_q2_yoy"] == 50.
    assert cache.store("AAPL", result, market="US")
    stored = pickle.loads(redis.values[cache._redis_data_key("AAPL", "US")])
    fields = validate_envelope(stored["financial_source_evidence"])["fields"]
    assert fields["eps_q1_yoy"]["provenance_kind"] == "observed"
    assert fields["eps_q2_yoy"]["source"] == "yfinance"
    assert fields["eps_raw_score"]["provenance_kind"] == "derived"
    assert fields["roe"]["provenance_kind"] == "legacy_canonical_map"
    assert fields["profit_margin"]["provenance_kind"] == "legacy_canonical_map"
    assert len(stored["financial_source_evidence"]["captures"]) == 3
    assert fields["eps_q1_yoy"]["observation_id"] == result["financial_source_evidence"]["fields"]["eps_q1_yoy"]["observation_id"]


def test_rejected_attachment_retains_foreign_fields_without_losing_scalars():
    from app.services.financial_source_capture import attach_evidence

    foreign = observed({"roe": -5.}, symbol="MSFT")
    foreign_fields = deepcopy(foreign["financial_source_evidence"]["fields"])
    # Rebuild the ordinary producer field shape with its retained source subset.
    for record in foreign_fields.values():
        record["source_payload"] = foreign["financial_source_evidence"]["captures"][record["capture_id"]]["source_payload"]
    values = {"roe": -5., "pe_ratio": 12.}
    attached = attach_evidence(values, foreign_fields, symbol="AAPL", market="US")
    assert attached["roe"] == -5. and attached["pe_ratio"] == 12.
    envelope = validate_envelope(attached["financial_source_evidence"])
    assert envelope["fields"] == {}
    assert envelope["unverified_source_fields"] == foreign_fields
