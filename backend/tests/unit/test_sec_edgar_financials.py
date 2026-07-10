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


def _relabeled_facts(eps, rev, ni):
    """EDGAR quirk: fy/fp describe the FILING's fiscal frame, so prior-year
    comparative rows inside a newer 10-Q carry the NEWER fy. Build facts where
    the 2024 quarters exist ONLY as comparatives labeled fy=2025 (filed with
    the matching 2025 10-Q) — the shape that made the old (fy, q) keying lose
    every YoY base ("missing/invalid YoY base" across large caps in CI)."""
    filed_by_q = {1: "2025-05-01", 2: "2025-08-01", 3: "2025-11-01"}

    def entries(values):
        out = []
        for (fy, q), val in values.items():
            start, end = _QPERIODS[q]
            out.append(_q(start.format(y=fy), end.format(y=fy), val,
                          2025, f"Q{q}", filed=filed_by_q[q]))
        return out

    return {"facts": {"us-gaap": {
        "EarningsPerShareDiluted": {"units": {"USD/shares": entries(eps)}},
        "Revenues": {"units": {"USD": entries(rev)}},
        "NetIncomeLoss": {"units": {"USD": entries(ni)}},
    }}}


def test_code33_survives_relabeled_comparatives():
    facts = _relabeled_facts(_EPS, _REV, _NI)
    # The old (fy, q) keying collapses each 2024 comparative onto its 2025
    # sibling's key, so no year-ago quarter survives:
    assert (2024, 1) not in quarterly_series(facts, EPS_TAGS, is_eps=True)
    # Date-keyed Code 33 still finds every YoY base and the acceleration.
    result = compute_code33_from_facts(facts)
    assert result.passes is True, result.reason
    assert result.quarters == ["FY2025Q3", "FY2025Q2", "FY2025Q1"]
    assert result.eps_yoy[0] > result.eps_yoy[1] > result.eps_yoy[2]


def test_quarterly_series_dated_dedupes_restatements_latest_filed_wins():
    from app.services.sec_edgar_financials import quarterly_series_dated
    facts = _facts(_EPS, _REV, _NI)
    # A later-filed restatement of 2025 Q1 revenue (same period, new value).
    facts["facts"]["us-gaap"]["Revenues"]["units"]["USD"].append(
        _q("2025-01-01", "2025-03-31", 111, 2025, "Q1", filed="2026-02-15")
    )
    dated = quarterly_series_dated(facts, REVENUE_TAGS, is_eps=False)
    by_end = {end: (val, label) for end, val, label in dated}
    assert by_end["2025-03-31"] == (111, "FY2025Q1")  # restated value, original label


# Three years of Q1-Q3 where YoY growth strictly accelerates chronologically
# (+10/+20/+40/+80/+160/+320%), so EVERY 3-quarter vantage point passes Code 33.
_EPS3 = {(2023, 1): 1.0, (2023, 2): 1.0, (2023, 3): 1.0,
         (2024, 1): 1.1, (2024, 2): 1.2, (2024, 3): 1.4,
         (2025, 1): 1.98, (2025, 2): 3.12, (2025, 3): 5.88}
_REV3 = {k: v * 100 for k, v in _EPS3.items()}
# Margins follow the same accelerating pattern (2023 = 10%, then 11/12/14,
# 19.8/31.2/58.8%), so ni = rev * margin also passes the strict screen.
_MARGIN3 = {(2023, 1): 0.10, (2023, 2): 0.10, (2023, 3): 0.10,
            (2024, 1): 0.11, (2024, 2): 0.12, (2024, 3): 0.14,
            (2025, 1): 0.198, (2025, 2): 0.312, (2025, 3): 0.588}
_NI3 = {k: _REV3[k] * _MARGIN3[k] for k in _REV3}


def _pit_facts():
    """Facts where each quarter is filed ~1 month after its period ends
    (Q1 -> 05-01, Q2 -> 08-01, Q3 -> 11-01 of its own year)."""
    def entries(values):
        return [
            _q(_QPERIODS[q][0].format(y=fy), _QPERIODS[q][1].format(y=fy),
               val, fy, f"Q{q}", filed=f"{fy}-{q * 3 + 2:02d}-01")
            for (fy, q), val in values.items()
        ]
    return {"facts": {"us-gaap": {
        "EarningsPerShareDiluted": {"units": {"USD/shares": entries(_EPS3)}},
        "Revenues": {"units": {"USD": entries(_REV3)}},
        "NetIncomeLoss": {"units": {"USD": entries(_NI3)}},
    }}}


def test_negative_yoy_base_is_a_fail_not_missing_data():
    # 2024 Q1 is a LOSS quarter: the 2025 Q1 YoY comparison is undefined.
    # That's a legitimate Code 33 fail (loss quarter), not "cannot judge" —
    # the GM/OXY/Z/SSTK/NATR shape from the CI diagnostics run.
    eps = dict(_EPS)
    eps[(2024, 1)] = -0.5
    result = compute_code33_from_facts(_facts(eps, _REV, _NI))
    assert result.passes is False
    assert result.reason.startswith("YoY base <= 0")
    # A genuinely absent quarter still reads as missing data.
    gone = {k: v for k, v in _EPS.items() if k != (2024, 1)}
    result2 = compute_code33_from_facts(_facts(gone, _REV, _NI))
    assert result2.passes is False
    assert result2.reason.startswith("missing YoY base")


def test_derived_q4_label_uses_period_end_year():
    from app.services.sec_edgar_financials import quarterly_series_dated
    facts = _facts(_EPS, _REV, _NI)
    # A 2024 annual arriving inside a LATER filing frame (fy=2025, the GM
    # shape) must still label the derived Q4 by its period end year.
    facts["facts"]["us-gaap"]["Revenues"]["units"]["USD"].append(
        {"start": "2024-01-01", "end": "2024-12-31", "val": 460, "fy": 2025, "fp": "FY",
         "form": "10-K", "filed": "2026-02-15"}
    )
    dated = quarterly_series_dated(facts, REVENUE_TAGS, is_eps=False)
    by_end = {end: (val, label) for end, val, label in dated}
    assert by_end["2024-12-31"] == (460 - (100 + 100 + 100), "FY2024Q4")


def test_code33_as_of_evaluates_point_in_time():
    facts = _pit_facts()
    # Live: the three 2025 quarters.
    live = compute_code33_from_facts(facts)
    assert live.passes is True, live.reason
    assert live.quarters == ["FY2025Q3", "FY2025Q2", "FY2025Q1"]
    # As of mid-June 2025 only the Q1 filing (05-01) is public — the vantage
    # shifts back to [2025Q1, 2024Q3, 2024Q2] and still passes.
    pit = compute_code33_from_facts(facts, as_of="2025-06-15")
    assert pit.passes is True, pit.reason
    assert pit.quarters == ["FY2025Q1", "FY2024Q3", "FY2024Q2"]
    # Before any 2024 filing there is no accelerating triple to see.
    early = compute_code33_from_facts(facts, as_of="2024-01-15")
    assert early.passes is False


def test_code33_as_of_ignores_later_filed_restatements():
    facts = _pit_facts()
    # A 2026-filed restatement slashes 2025 Q1 revenue; point-in-time at the
    # 2025 idea date must still see the originally filed value.
    facts["facts"]["us-gaap"]["Revenues"]["units"]["USD"].append(
        _q("2025-01-01", "2025-03-31", 1.0, 2025, "Q1", filed="2026-02-15")
    )
    pit = compute_code33_from_facts(facts, as_of="2025-06-15")
    assert pit.passes is True, pit.reason
    # Without as_of the restated value wins and the acceleration breaks.
    assert compute_code33_from_facts(facts).passes is False


def test_dated_quarterly_eps_returns_quarter_end_dates_excluding_annual():
    from app.services.sec_edgar_financials import dated_quarterly_eps
    facts = _facts(_EPS, _REV, _NI)
    # add an annual (12-month) EPS entry that must be excluded from the dated line
    facts["facts"]["us-gaap"]["EarningsPerShareDiluted"]["units"]["USD/shares"].append(
        {"start": "2025-01-01", "end": "2025-12-31", "val": 9.9, "fy": 2025, "fp": "FY",
         "form": "10-K", "filed": "2026-02-15"}
    )
    out = dated_quarterly_eps(facts)
    assert all(isinstance(d, str) and isinstance(v, float) for d, v in out)
    assert ("2025-09-30", 1.6) in out          # a quarterly point
    assert all(d != "2025-12-31" for d, _ in out)  # annual excluded
    # chronological
    assert [d for d, _ in out] == sorted(d for d, _ in out)
