"""Unit tests for the Code 33 (Minervini earnings-acceleration) engine.

These exercise the pure parse/compute path against a synthetic EDGAR
companyfacts dict — no network. Code 33 = diluted EPS, sales, AND net margin
each show rising YoY growth for three consecutive quarters.
"""
from app.services.sec_edgar_financials import (
    compute_code33_from_facts,
    quarterly_series,
    EPS_TAGS,
    REVENUE_TAGS,
)


def _q(start, end, val, fy, fp, filed="2025-11-01"):
    return {"start": start, "end": end, "val": val, "fy": fy, "fp": fp, "form": "10-Q", "filed": filed}


_QPERIODS = {
    1: ("{y}-01-01", "{y}-03-31"),
    2: ("{y}-04-01", "{y}-06-30"),
    3: ("{y}-07-01", "{y}-09-30"),
}


def _quarter_entries(values: dict[tuple[int, int], float]):
    out = []
    for (fy, q), val in values.items():
        start, end = _QPERIODS[q]
        out.append(_q(start.format(y=fy), end.format(y=fy), val, fy, f"Q{q}"))
    return out


def _facts(eps, rev, ni, *, extra=None):
    gaap = {
        "EarningsPerShareDiluted": {"units": {"USD/shares": _quarter_entries(eps)}},
        "Revenues": {"units": {"USD": _quarter_entries(rev)}},
        "NetIncomeLoss": {"units": {"USD": _quarter_entries(ni)}},
    }
    if extra:
        gaap.update(extra)
    return {"facts": {"us-gaap": gaap}}


# EPS YoY: 2025 Q1 +10%, Q2 +30%, Q3 +60%  -> accelerating
_EPS = {(2024, 1): 1.0, (2024, 2): 1.0, (2024, 3): 1.0,
        (2025, 1): 1.1, (2025, 2): 1.3, (2025, 3): 1.6}
# Revenue YoY: +10/+25/+45  -> accelerating
_REV = {(2024, 1): 100, (2024, 2): 100, (2024, 3): 100,
        (2025, 1): 110, (2025, 2): 125, (2025, 3): 145}
# Net income chosen so margin YoY = +10/+25/+45 -> accelerating
# margin_2024 = 10%; margin_2025 = 11% / 12.5% / 14.5%
_NI = {(2024, 1): 10.0, (2024, 2): 10.0, (2024, 3): 10.0,
       (2025, 1): 12.1, (2025, 2): 15.625, (2025, 3): 21.025}


def test_code33_passes_when_all_three_accelerate():
    result = compute_code33_from_facts(_facts(_EPS, _REV, _NI))
    assert result.passes is True, result.reason
    assert result.quarters == ["FY2025Q3", "FY2025Q2", "FY2025Q1"]
    # Most-recent-first, strictly decreasing as we go back == accelerating.
    assert result.eps_yoy[0] > result.eps_yoy[1] > result.eps_yoy[2]
    assert result.sales_yoy[0] > result.sales_yoy[1] > result.sales_yoy[2]
    assert result.margin_yoy[0] > result.margin_yoy[1] > result.margin_yoy[2]


def test_code33_fails_when_one_metric_flat():
    # Flat revenue YoY (all +10%) -> not accelerating.
    flat_rev = {(2024, 1): 100, (2024, 2): 100, (2024, 3): 100,
                (2025, 1): 110, (2025, 2): 110, (2025, 3): 110}
    result = compute_code33_from_facts(_facts(_EPS, flat_rev, _NI))
    assert result.passes is False


def test_relaxed_code33_ignores_margin():
    # EPS + sales accelerate, but net income is flat so margin does NOT rise.
    # Literal Code 33 fails; the relaxed (EPS+sales) screen passes.
    flat_ni = {(2024, 1): 10.0, (2024, 2): 10.0, (2024, 3): 10.0,
               (2025, 1): 11.0, (2025, 2): 11.0, (2025, 3): 11.0}
    facts = _facts(_EPS, _REV, flat_ni)
    assert compute_code33_from_facts(facts, require_margin=True).passes is False
    assert compute_code33_from_facts(facts, require_margin=False).passes is True


def test_code33_fails_when_decelerating():
    # EPS YoY decelerating (+60/+30/+10 from recent to old is required; reverse it).
    dec_eps = {(2024, 1): 1.0, (2024, 2): 1.0, (2024, 3): 1.0,
               (2025, 1): 1.6, (2025, 2): 1.3, (2025, 3): 1.1}
    result = compute_code33_from_facts(_facts(dec_eps, _REV, _NI))
    assert result.passes is False


def test_code33_fails_with_insufficient_history():
    short = {(2025, 1): 1.1, (2025, 2): 1.3, (2025, 3): 1.6}  # no prior-year quarters
    result = compute_code33_from_facts(_facts(short, short, short))
    assert result.passes is False
    assert "comparable" in result.reason or "YoY" in result.reason


def test_quarterly_series_derives_q4_from_annual():
    # Q1-3 reported quarterly; FY reported as a 12-month annual -> Q4 = FY - sum.
    rev = {(2024, 1): 100, (2024, 2): 110, (2024, 3): 120}
    facts = _facts(_EPS, rev, _NI)
    facts["facts"]["us-gaap"]["Revenues"]["units"]["USD"].append(
        {"start": "2024-01-01", "end": "2024-12-31", "val": 460, "fy": 2024, "fp": "FY",
         "form": "10-K", "filed": "2025-02-15"}
    )
    series = quarterly_series(facts, REVENUE_TAGS, is_eps=False)
    assert series[(2024, 4)] == 130  # 460 - (100+110+120)


def test_quarterly_series_picks_first_available_tag():
    # When EarningsPerShareDiluted is absent, fall back to the next EPS tag.
    facts = _facts(_EPS, _REV, _NI)
    facts["facts"]["us-gaap"]["EarningsPerShareBasicAndDiluted"] = facts["facts"]["us-gaap"].pop(
        "EarningsPerShareDiluted"
    )
    series = quarterly_series(facts, EPS_TAGS, is_eps=True)
    assert series[(2025, 3)] == 1.6
