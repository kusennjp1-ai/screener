"""Synthetic parity/coverage checks; no providers or publication payloads."""
from copy import deepcopy
from datetime import date, timedelta
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess

import pytest

from app.services.static_price_session_audit import (
    audit_price_history, build_price_session_audit, liquid_price_observation,
    require_price_session_coverage,
)

TARGET = "2026-10-07"
FEATURE = "2026-10-06"
RUN = 7


def bars(close=20, volume=2_000_000, count=253):
    result = []
    day = date.fromisoformat(TARGET)
    while len(result) < count:
        if day.weekday() < 5:
            result.append({"date": day.isoformat(), "open": close, "high": close + 1,
                           "low": close - 1, "close": close, "volume": volume})
        day -= timedelta(days=1)
    return list(reversed(result))


def row(symbol="A", price=20, adv=40_000_000, baseline_price=20, baseline_adv=40_000_000):
    return {"symbol": symbol, "current_price": price, "adv_usd": adv,
            "feature_price_snapshot": {"role": "published_export_baseline",
                "feature_run_id": RUN, "feature_as_of_date": FEATURE,
                "current_price": baseline_price, "adv_usd": baseline_adv}}


def payload(symbol="A", price=20, volume=2_000_000, count=253):
    return {"symbol": symbol, "as_of_date": TARGET, "bars": bars(price, volume, count)}


def fixture_cases():
    cases = []
    def add(name, mutate=None, *, r=None, p=None, expected=True, target=TARGET):
        value = {"name": name, "row": row() if r is None else r,
                 "payload": payload() if p is None else p, "date": target, "expected": expected}
        if mutate:
            mutate(value)
        cases.append(value)
    add("valid")
    add("252_sessions", p=payload(count=252))
    add("251_sessions", p=payload(count=251), expected=False)
    add("missing_weekday_still_252", lambda c: c["payload"]["bars"].pop(10))
    add("wrong_symbol", lambda c: c["payload"].update(symbol="B"), expected=False)
    add("wrong_envelope_date", lambda c: c["payload"].update(as_of_date=FEATURE), expected=False)
    add("future_bar", lambda c: c["payload"]["bars"][-1].update(date="2026-10-08"), expected=False)
    add("stale_final", lambda c: c["payload"]["bars"].pop(), expected=False)
    add("duplicate_day", lambda c: c["payload"]["bars"][10].update(date=c["payload"]["bars"][9]["date"]), expected=False)
    add("weekend", lambda c: c["payload"]["bars"][10].update(date="2025-10-04"), expected=False)
    add("invalid_calendar_day", lambda c: c["payload"]["bars"][10].update(date="2026-02-30"), expected=False)
    add("invalid_analysis_day", expected=False, target="2026-02-30")
    add("incoherent_high", lambda c: c["payload"]["bars"][-1].update(high=19), expected=False)
    add("zero_open", lambda c: c["payload"]["bars"][-1].update(open=0), expected=False)
    add("negative_volume", lambda c: c["payload"]["bars"][-1].update(volume=-1), expected=False)
    add("boolean_volume", lambda c: c["payload"]["bars"][-1].update(volume=True), expected=False)
    add("missing_close", lambda c: c["payload"]["bars"][-1].pop("close"), expected=False)
    add("scan_close_mismatch", r=row(price=21), expected=False)
    add("scan_close_tolerance", r=row(price=20.019))
    add("boolean_scan_price", r=row(price=True), expected=False)
    add("null_scan_price", r=row(price=None), expected=False)
    add("liquid_threshold", r=row(price=10, adv=20_000_000), p=payload(price=10))
    add("price_below_threshold", r=row(price=9), p=payload(price=9))
    add("adv_below_threshold", r=row(adv=19_999_999))
    for name, close in (("jump_1_8", 36), ("drop_0_55", 11)):
        add(name, lambda c, close=close: c["payload"]["bars"][-1].update(
            open=close, high=close + 1, low=close - 1, close=close),
            r=row(price=close), expected=False)
    return cases


@pytest.mark.parametrize("case", fixture_cases(), ids=lambda value: value["name"])
def test_approved_price_validity_cases(case):
    observed = audit_price_history(case["row"], case["payload"], case["date"])
    assert observed["valid"] is case["expected"]
    assert observed["bars"] == len(case["payload"]["bars"])


def test_missing_history_nonfinite_values_and_zero_volume():
    assert not audit_price_history(row(), None, TARGET)["valid"]
    malformed = payload()
    malformed["bars"][-1]["close"] = float("nan")
    assert not audit_price_history(row(), malformed, TARGET)["valid"]
    assert audit_price_history(row(), payload(volume=0), TARGET)["valid"]


def test_exact_approved_javascript_audit_and_liquid_predicate_parity():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node is needed for approved-source parity")
    repo = Path(__file__).resolve().parents[3]
    audit_path = repo / "frontend/src/static/qualificationAudit.js"
    raw = audit_path.read_bytes()
    assert hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest() == "73dc1b9ac9c51d03bc2f63e2ffd2f6240e3a5502"
    exporter_path = repo / "frontend/tools/export-research.mjs"
    exporter = exporter_path.read_bytes()
    assert hashlib.sha1(b"blob " + str(len(exporter)).encode() + b"\0" + exporter).hexdigest() == "dac7f8784a0bc836ab6977e1e88ca643c49c01ed"
    predicate = re.search(r"const liquid=\[\.\.\.rows\.values\(\)\]\.filter\((r=>[^;]+)\);", exporter.decode())
    assert predicate, "Actual approved liquidity predicate missing"
    script = (
        "import {readFileSync} from 'node:fs';"
        + "import {auditDailyBars} from " + json.dumps(audit_path.as_uri()) + ";"
        + "const liquid=(" + predicate.group(1) + ");"
        + "const cases=JSON.parse(readFileSync(0,'utf8'));"
        + "console.log(JSON.stringify(cases.map(c=>({name:c.name,"
        + "valid:auditDailyBars(c.row,c.payload,c.date).valid,liquid:liquid(c.row)}))));"
    )
    cases = fixture_cases()
    result = subprocess.run([node, "--input-type=module", "-e", script], input=json.dumps(cases),
                            text=True, capture_output=True, timeout=15, check=True)
    actual = json.loads(result.stdout)
    assert len(actual) == len(cases)
    for case, observed in zip(cases, actual, strict=True):
        assert observed["name"] == case["name"]
        assert observed["valid"] == audit_price_history(case["row"], case["payload"], case["date"])["valid"]
        assert observed["liquid"] == liquid_price_observation(case["row"])


def test_missing_baseline_liquid_observation_cannot_shrink_and_verified_exit_is_real():
    source_rows = [row("A", price=None, adv=None), row("B", baseline_price=9, baseline_adv=1_000_000),
                   row("C", price=9, adv=9_000_000)]
    charts = {"B": payload("B"), "C": payload("C", price=9, volume=1_000_000)}
    before = deepcopy((source_rows, charts))
    audit = build_price_session_audit(rows=source_rows, charts=charts, market="US",
        price_as_of_date=TARGET, feature_run_id=RUN, feature_as_of_date=FEATURE)
    assert (audit["source_universe_count"], audit["total"], audit["verified"]) == (3, 2, 1)
    records = {record["symbol"]: record for record in audit["results"]}
    assert records["A"]["required"] and not records["A"]["valid"]
    assert records["B"]["required"] and records["B"]["verified_price_liquid"]
    assert records["C"]["valid"] and not records["C"]["required"]
    assert audit["unverified_current_histories"] == 1
    assert not audit["passed"]
    with pytest.raises(ValueError, match="below 90%"):
        require_price_session_coverage(audit)
    assert (source_rows, charts) == before


def test_post_recalculation_price_threshold_crossing_uses_emitted_close():
    source = row(price=9.999, adv=20_000_000, baseline_price=9, baseline_adv=1_000_000)
    audit = build_price_session_audit(rows=[source], charts={"A": payload(price=10)}, market="US",
        price_as_of_date=TARGET, feature_run_id=RUN, feature_as_of_date=FEATURE)
    assert not audit["results"][0]["current_liquid"]
    assert audit["results"][0]["verified_price_liquid"]
    assert audit["total"] == audit["verified"] == 1
    require_price_session_coverage(audit)


@pytest.mark.parametrize("verified,passed", [(804, False), (1714, False), (1715, True)])
def test_original_1905_cohort_keeps_literal_90_percent_boundary(verified, passed):
    audit = {"schema_version": "static-price-session-audit-v1", "minimum_target": .9,
             "total": 1905, "verified": verified, "passed": passed}
    if passed:
        require_price_session_coverage(audit)
    else:
        with pytest.raises(ValueError, match="below 90%"):
            require_price_session_coverage(audit)
    audit["passed"] = True
    if not passed:
        with pytest.raises(ValueError, match="below 90%"):
            require_price_session_coverage(audit)


@pytest.mark.parametrize("mutate", [
    lambda r: r.update(symbol=""),
    lambda r: r.pop("feature_price_snapshot"),
    lambda r: r["feature_price_snapshot"].update(feature_run_id=99),
    lambda r: r["feature_price_snapshot"].update(feature_as_of_date=TARGET),
    lambda r: r.update(current_price="20"),
    lambda r: r.update(adv_usd=float("inf")),
])
def test_bad_identity_or_liquidity_type_fails_closed(mutate):
    source = row()
    mutate(source)
    with pytest.raises(ValueError):
        build_price_session_audit(rows=[source], charts={"A": payload()}, market="US",
            price_as_of_date=TARGET, feature_run_id=RUN, feature_as_of_date=FEATURE)


def test_empty_duplicate_wrong_market_and_reverse_sessions_fail_closed():
    for sources in ([], [row(), row()]):
        with pytest.raises(ValueError):
            build_price_session_audit(rows=sources, charts={"A": payload()}, market="US",
                price_as_of_date=TARGET, feature_run_id=RUN, feature_as_of_date=FEATURE)
    with pytest.raises(ValueError, match="US-only"):
        build_price_session_audit(rows=[row()], charts={"A": payload()}, market="HK",
            price_as_of_date=TARGET, feature_run_id=RUN, feature_as_of_date=FEATURE)
    with pytest.raises(ValueError, match="session identity"):
        build_price_session_audit(rows=[row()], charts={"A": payload()}, market="US",
            price_as_of_date=FEATURE, feature_run_id=RUN, feature_as_of_date=TARGET)


def test_valid_emitted_price_facts_prevent_stale_adv_from_padding_the_verified_cohort():
    source = row(price=20, adv=40_000_000, baseline_price=20, baseline_adv=40_000_000)
    audit = build_price_session_audit(rows=[source], charts={"A": payload(volume=100_000)}, market="US",
        price_as_of_date=TARGET, feature_run_id=RUN, feature_as_of_date=FEATURE)
    record = audit["results"][0]
    assert record["valid"] and record["current_liquid"]
    assert not record["verified_price_liquid"] and not record["required"]
    assert audit["total"] == audit["verified"] == 0
    assert not audit["passed"]
    with pytest.raises(ValueError, match="below 90%"):
        require_price_session_coverage(audit)
