"""Synthetic statement receipts exercise the real producer and proof evaluator."""
from copy import deepcopy
import json
import pickle

import pandas as pd
import pytest

from app.services.financial_source_capture import _statement_subset, statement_evidence
from app.services.financial_source_evidence import (
    FINANCIAL_FIELDS, make_capture_context, make_envelope, merge_financial_payloads,
    observation_id, restore_retained_raw_envelope, validate_envelope,
)
from app.services.growth_cadence_service import compute_cadence_aware_growth
from app.services.mandatory_statement_selection import (
    MANDATORY_STATEMENT_FIELDS, mandatory_statement_refresh_fields,
    merge_mandatory_statement_payloads,
)
from app.services.static_financial_evidence import build_static_financial_current
from tests.unit.test_financial_evidence_cache import service  # noqa: F401

NOW = "2026-10-03T16:35:00.000Z"
AS_OF = "2026-10-02"
CONTEXT = dict(symbol="TEST", market="US", now=NOW, as_of_date=AS_OF,
               us_mandatory_source_policy=True)


def statement(capture_id="fresh", *, observed="2026-10-01T00:00:00Z",
              recent=2.5, baseline=2., periods=None, symbol="TEST", market="US"):
    periods = periods or ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30"]
    frame = pd.DataFrame([[recent, 1., 2., 3., baseline], [120., 110., 90., 80., 100.]],
                         index=["Diluted EPS", "Total Revenue"], columns=pd.to_datetime(periods))
    subset = _statement_subset(frame)
    subset["source_rows"] = {row["metric"].lower().replace(" ", ""): {
        "provider_metric": "quarterly" + row["metric"].replace(" ", ""),
        "values": {pd.Timestamp(column).date().isoformat(): value
                   for column, value in zip(subset["columns"], row["values"])},
        "currencies": ["USD"],
    } for row in subset["rows"]}
    capture = make_capture_context(
        symbol=symbol, market=market, source="yfinance",
        producer="yfinance.quarterly_income_stmt/transport-capture-v1",
        provider_symbol=symbol, observed_at=observed, source_payload=subset, capture_id=capture_id,
    )
    payload = compute_cadence_aware_growth(frame, market=market, include_source_context=True)
    contexts = payload.pop("_financial_source_context")
    payload.update(symbol=symbol, market=market)
    fields = statement_evidence(payload, contexts, {"quarterly_income_stmt": capture})
    payload["financial_source_evidence"] = make_envelope(symbol=symbol, market=market, fields=fields)
    return payload


def merge(primary, fallback, **context):
    return merge_mandatory_statement_payloads(primary, fallback, **{**CONTEXT, **context})


def gaps(payload, **context):
    return mandatory_statement_refresh_fields(payload, **{**CONTEXT, **context})


def reasons(payload, **context):
    proof = build_static_financial_current(payload, now=context.get("now", NOW),
                                          as_of_date=context.get("as_of_date", AS_OF))
    return {field: proof["r"][FINANCIAL_FIELDS.index(field)] for field in MANDATORY_STATEMENT_FIELDS}


def receipt(payload, field="eps_growth_yy"):
    return payload["financial_source_evidence"]["fields"][field]


def archive(payload):
    envelope = validate_envelope(payload["financial_source_evidence"])
    return [restore_retained_raw_envelope(envelope, key) for key in envelope["retained_raw_envelopes"]]


def test_unproved_nonnull_primary_is_replaced_with_exact_fresh_owner_and_inputs_unchanged():
    primary = {"symbol": "TEST", "eps_growth_yy": 90., "eps_growth_annual": 90.,
               "sales_growth_yy": 80., "finviz_snapshot_at": "2026-09-01T01:00:00Z"}
    fallback = statement()
    before = deepcopy((primary, fallback))
    output = merge(primary, fallback)
    assert (primary, fallback) == before
    assert output["eps_growth_yy"] == output["eps_growth_annual"] == 25.
    assert output["sales_growth_yy"] == 20.
    assert gaps(primary) == MANDATORY_STATEMENT_FIELDS
    assert gaps(output) == ()
    for field in MANDATORY_STATEMENT_FIELDS:
        assert receipt(output, field) == receipt(fallback, field)
    assert any(item.get("raw_values", {}).get("eps_growth_yy") == 90. for item in archive(output))
    assert output["finviz_snapshot_at"] == primary["finviz_snapshot_at"]


@pytest.mark.parametrize("fallback_observed", ["2026-09-01T00:00:00Z", "2026-10-02T00:00:00Z"])
def test_supported_primary_wins_over_older_or_newer_supported_fallback(fallback_observed):
    primary = statement("primary", recent=3.)
    fallback = statement("fallback", observed=fallback_observed)
    output = merge(primary, fallback)
    assert output["eps_growth_yy"] == 50.
    assert receipt(output) == receipt(primary)
    assert gaps(output) == ()
    assert fallback["financial_source_evidence"] in archive(output)


def test_fresh_database_or_refresh_clock_does_not_rescue_an_old_receipt():
    primary = statement("old", observed="2026-09-01T00:00:00Z", recent=3.)
    primary.update(updated_at=NOW, yahoo_statements_refreshed_at=NOW, cache_timestamp=NOW)
    assert reasons(primary) == {field: "7" for field in MANDATORY_STATEMENT_FIELDS}
    assert gaps(primary) == MANDATORY_STATEMENT_FIELDS
    fresh = statement()
    output = merge(primary, fresh)
    assert receipt(output) == receipt(fresh)
    assert output["updated_at"] == output["yahoo_statements_refreshed_at"] == NOW
    assert receipt(output)["observed_at"] == "2026-10-01T00:00:00.000Z"
    assert primary["financial_source_evidence"] in archive(output)


@pytest.mark.parametrize("fault", ["empty", "invalid_envelope", "invalid_value", "boolean_value",
                                    "value_mismatch", "symbol", "market", "provider_symbol",
                                    "contract", "stale_source", "stale_period"])
def test_unusable_provider_result_does_not_replace_nonnull_primary_or_hide_gap(fault):
    primary = {"eps_growth_yy": 90., "sales_growth_yy": 80.}
    fallback = statement()
    if fault == "empty":
        fallback = {}
    elif fault == "invalid_envelope":
        fallback["financial_source_evidence"] = {"schema": "invalid"}
    elif fault in {"invalid_value", "boolean_value", "value_mismatch"}:
        for field in MANDATORY_STATEMENT_FIELDS:
            fallback[field] = {"invalid_value": float("nan"), "boolean_value": True,
                               "value_mismatch": 999.}[fault]
    elif fault in {"symbol", "market"}:
        fallback[fault] = "OTHER" if fault == "symbol" else "HK"
    elif fault in {"provider_symbol", "contract"}:
        for field in MANDATORY_STATEMENT_FIELDS:
            record = receipt(fallback, field)
            record["provider_symbol" if fault == "provider_symbol" else "basis"] = "OTHER"
            record["observation_id"] = observation_id(record)
    elif fault == "stale_source":
        fallback = statement(observed="2026-09-01T00:00:00Z")
    elif fault == "stale_period":
        fallback = statement(periods=["2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31", "2024-12-31"])
    output = merge(primary, fallback)
    assert output["eps_growth_yy"] == 90. and output["sales_growth_yy"] == 80.
    assert gaps(output) == MANDATORY_STATEMENT_FIELDS
    if fault == "invalid_envelope":
        assert fallback["financial_source_evidence"] in archive(output)
    if fault in {"symbol", "market"}:
        assert any(item.get("rejected_source_envelope") == fallback["financial_source_evidence"]
                   for item in archive(output))


@pytest.mark.parametrize("primary_current", [False, True])
def test_equal_numbers_still_select_exact_receipt_owner(primary_current):
    primary = statement("primary", observed="2026-10-01T00:00:00Z" if primary_current else "2026-09-01T00:00:00Z")
    fallback = statement("fallback", observed="2026-10-02T00:00:00Z")
    assert primary["eps_growth_yy"] == fallback["eps_growth_yy"]
    output = merge(primary, fallback)
    expected = primary if primary_current else fallback
    assert receipt(output) == receipt(expected)
    assert {record["capture_id"] for record in output["financial_source_evidence"]["retained_candidates"]["eps_growth_yy"]} == {"primary", "fallback"}


def test_partial_recovery_requests_only_remaining_field():
    primary = {"eps_growth_yy": 90., "sales_growth_yy": 80.}
    fallback = statement()
    fallback.pop("sales_growth_yy")
    fallback["financial_source_evidence"]["fields"].pop("sales_growth_yy")
    output = merge(primary, fallback)
    assert output["eps_growth_yy"] == 25. and output["sales_growth_yy"] == 80.
    assert gaps(output) == ("sales_growth_yy",)


@pytest.mark.parametrize("use_fallback", [False, True])
def test_valid_nonpositive_base_is_acquired_without_promoting_to_ordinary_growth(use_fallback):
    acquired = statement("loss", recent=-.2, baseline=-.4)
    unknown = {"eps_growth_yy": 999., "sales_growth_yy": 999.}
    output = merge(unknown, acquired) if use_fallback else merge(acquired, statement("positive"))
    assert receipt(output) == receipt(acquired)
    assert reasons(output) == {"eps_growth_yy": "f", "sales_growth_yy": "0"}
    assert gaps(output) == ()
    assert gaps(merge(output, {})) == ()


def test_alias_conflict_is_archived_and_replacement_synchronizes_annual_eps():
    primary = statement("conflict", recent=3.)
    primary["eps_growth_annual"] = -10.
    assert reasons(primary)["eps_growth_yy"] == "d"
    fallback = statement()
    output = merge(primary, fallback)
    assert output["eps_growth_yy"] == output["eps_growth_annual"] == 25.
    assert receipt(output) == receipt(fallback)
    assert any(item.get("raw_alias_values", {}).get("eps_growth_annual") == -10.
               for item in archive(output))
    assert primary["financial_source_evidence"] in archive(output)


def test_alias_repair_alone_does_not_certify_a_conflicting_original_owner():
    primary = statement()
    primary["eps_growth_annual"] = 999.
    output = merge(primary, {})
    assert output["eps_growth_annual"] == output["eps_growth_yy"] == 25.
    assert gaps(output) == ("eps_growth_yy",)
    assert receipt(output)["provenance_kind"] == "legacy_canonical_map"


def test_alias_from_other_source_cannot_conflict_with_supported_primary():
    primary = statement()
    fallback = {"eps_growth_annual": 999., "yahoo_statements_refreshed_at": "2026-09-01T00:00:00Z"}
    output = merge(primary, fallback)
    assert output["eps_growth_annual"] == output["eps_growth_yy"] == 25.
    assert receipt(output) == receipt(primary)
    assert any(item.get("raw_alias_values", {}).get("eps_growth_annual") == 999.
               for item in archive(output))
    assert any(item.get("raw_alias_values", {}).get("eps_growth_annual") == 999.
               and item["source_clocks"]["yahoo_statements_refreshed_at"] == fallback["yahoo_statements_refreshed_at"]
               for item in archive(merge(output, {})))


def test_merge_uses_no_new_source_clock_or_input_mutation():
    primary = {"eps_growth_yy": 90., "sales_growth_yy": 80.}
    fallback = statement()
    first = merge(primary, fallback)
    later = merge(primary, fallback, now="2026-10-04T12:00:00Z")
    assert first == later
    first["financial_source_evidence"]["fields"]["eps_growth_yy"]["value"] = -999.
    assert receipt(fallback)["value"] == 25.


@pytest.mark.parametrize("policy,market", [(False, "US"), (False, "HK"), (True, "HK")])
def test_disabled_and_non_us_match_existing_merge_exactly(policy, market):
    symbol = "TEST" if market == "US" else "0700.HK"
    primary = {"eps_growth_yy": 10., "eps_growth_annual": 90., "sales_growth_yy": None, "roe": 0.}
    fallback = {"eps_growth_yy": 25., "sales_growth_yy": 20., "roe": -1., "eps_rating": 95}
    output = merge(primary, fallback, symbol=symbol, market=market, us_mandatory_source_policy=policy)
    assert output == merge_financial_payloads(primary, fallback, symbol=symbol, market=market)
    assert gaps(output, symbol=symbol, market=market, us_mandatory_source_policy=policy) == ()


def test_unrelated_fields_keep_legacy_preference_and_derived_scores_do_not_trigger_refresh():
    primary = {"eps_growth_yy": 90., "roe": 0., "eps_rating": None, "rating": "Watch",
               "profit_margin": None, "field_provenance": {"roe": "finviz"}}
    fallback = {**statement(), "roe": 30., "eps_rating": 95, "profit_margin": -10.,
                "rating": "Strong Buy", "eps_raw_score": 80., "smr_rating": 99}
    output = merge(primary, fallback)
    ordinary = merge_financial_payloads(primary, fallback, symbol="TEST", market="US")
    allowed = {*MANDATORY_STATEMENT_FIELDS, "eps_growth_annual", "financial_source_evidence"}
    assert {key: value for key, value in output.items() if key not in allowed} == {
        key: value for key, value in ordinary.items() if key not in allowed}
    assert gaps(output) == ()


@pytest.mark.parametrize("observed,expected", [("2026-09-26T16:35:00.000Z", ()),
                                               ("2026-09-26T16:34:59.999Z", MANDATORY_STATEMENT_FIELDS),
                                               ("2026-10-03T16:35:00.001Z", MANDATORY_STATEMENT_FIELDS)])
def test_refresh_uses_exact_existing_source_age_policy(observed, expected):
    assert gaps(statement(observed=observed)) == expected


@pytest.mark.parametrize("now,as_of_date,expected", [
    ("2027-01-06T23:59:59.999Z", "2027-01-06", ()),
    ("2027-01-07T00:00:00.000Z", "2027-01-07", MANDATORY_STATEMENT_FIELDS),
])
def test_refresh_uses_existing_190_day_reporting_policy(now, as_of_date, expected):
    assert gaps(statement(observed="2027-01-05T00:00:00Z"), now=now, as_of_date=as_of_date) == expected


@pytest.mark.parametrize("context", [{"now": "2026-10-03T16:35:00"}, {"as_of_date": "2026-10-04"}, {"symbol": ""}])
def test_invalid_evaluation_context_is_not_a_provider_refresh_request(context):
    with pytest.raises(ValueError, match="evaluation time"):
        gaps({}, **context)
    with pytest.raises(ValueError, match="evaluation time"):
        merge({}, {}, **context)


def test_selected_pair_and_refresh_result_survive_canonical_database_redis_and_json_roundtrip(service):
    cache, _, redis = service
    original = merge({"eps_growth_yy": 90., "eps_growth_annual": -10., "sales_growth_yy": 80.}, statement())
    assert cache.store("TEST", original, market="US")
    single, _ = cache._get_from_database("TEST")
    bulk, _ = cache._get_many_from_database(["TEST"])["TEST"]
    redis_row = pickle.loads(redis.values[cache._redis_data_key("TEST", "US")])
    transport = json.loads(json.dumps(original))
    for restored in (single, bulk, redis_row, transport):
        for output in (restored, merge(restored, {})):
            assert gaps(output) == ()
            assert reasons(output) == reasons(original)
            assert output["eps_growth_annual"] == output["eps_growth_yy"] == 25.
            for field in MANDATORY_STATEMENT_FIELDS:
                assert receipt(output, field) == receipt(original, field)
