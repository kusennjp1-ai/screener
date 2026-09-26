"""Unit tests for the Code 33 (Minervini earnings-acceleration) engine.

These exercise the pure parse/compute path against a synthetic EDGAR
companyfacts dict — no network. Code 33 = diluted EPS, sales, AND net margin
provide four quarterly observations: three increases in EPS/sales YoY and
net-margin LEVELS. Quarterly EPS must be directly reported.
"""
import pytest

from app.services.sec_edgar_financials import (
    compute_code33_from_facts,
    quarterly_series,
    quarterly_series_dated,
    SecEdgarClient,
    EPS_TAGS,
    REVENUE_TAGS,
)


def _q(start, end, val, fy, fp, filed="2025-11-01"):
    return {"start": start, "end": end, "val": val, "fy": fy, "fp": fp, "form": "10-Q", "filed": filed}


_QPERIODS = {
    1: ("{y}-01-01", "{y}-03-31"),
    2: ("{y}-04-01", "{y}-06-30"),
    3: ("{y}-07-01", "{y}-09-30"),
    4: ("{y}-10-01", "{y}-12-31"),
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
_EPS = {(2023, 4): 1.0, (2024, 4): 1.0, (2024, 1): 1.0, (2024, 2): 1.0, (2024, 3): 1.0,
        (2025, 1): 1.1, (2025, 2): 1.3, (2025, 3): 1.6}
# Revenue YoY: +10/+25/+45  -> accelerating
_REV = {(2023, 4): 100, (2024, 4): 100, (2024, 1): 100, (2024, 2): 100, (2024, 3): 100,
        (2025, 1): 110, (2025, 2): 125, (2025, 3): 145}
# Net income chosen so margin YoY = +10/+25/+45 -> accelerating
# margin_2024 = 10%; margin_2025 = 11% / 12.5% / 14.5%
_NI = {(2023, 4): 10.0, (2024, 4): 10.0, (2024, 1): 10.0, (2024, 2): 10.0, (2024, 3): 10.0,
       (2025, 1): 12.1, (2025, 2): 15.625, (2025, 3): 21.025}


def test_code33_passes_when_all_three_accelerate():
    result = compute_code33_from_facts(_facts(_EPS, _REV, _NI))
    assert result.passes is True, result.reason
    assert result.quarters == ["FY2025Q3", "FY2025Q2", "FY2025Q1", "FY2024Q4"]
    # Most-recent-first, strictly decreasing as we go back == accelerating.
    assert result.eps_yoy[0] > result.eps_yoy[1] > result.eps_yoy[2]
    assert result.sales_yoy[0] > result.sales_yoy[1] > result.sales_yoy[2]
    assert result.margin_levels[0] > result.margin_levels[1] > result.margin_levels[2] > result.margin_levels[3]


def test_code33_fails_when_one_metric_flat():
    # Flat revenue YoY (all +10%) -> not accelerating.
    flat_rev = {**_REV, (2025, 1): 110, (2025, 2): 110, (2025, 3): 110}
    result = compute_code33_from_facts(_facts(_EPS, flat_rev, _NI))
    assert result.passes is False


def test_relaxed_code33_ignores_margin():
    # EPS + sales accelerate, but net income is flat so margin does NOT rise.
    # Literal Code 33 fails; the relaxed (EPS+sales) screen passes.
    flat_ni = {**_NI, (2025, 1): 11.0, (2025, 2): 11.0, (2025, 3): 11.0}
    facts = _facts(_EPS, _REV, flat_ni)
    assert compute_code33_from_facts(facts, require_margin=True).passes is False
    assert compute_code33_from_facts(facts, require_margin=False).passes is True


def test_code33_fails_when_decelerating():
    # EPS YoY decelerating (+60/+30/+10 from recent to old is required; reverse it).
    dec_eps = {**_EPS, (2025, 1): 1.6, (2025, 2): 1.3, (2025, 3): 1.1}
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
    filed_by_q = {1: "2025-05-01", 2: "2025-08-01", 3: "2025-11-01", 4: "2025-02-15"}

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
    assert result.quarters == ["FY2025Q3", "FY2025Q2", "FY2025Q1", "FY2024Q4"]
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


# Contiguous quarters: Q4 is explicitly reported rather than skipped.
_EPS3 = {(2023, 1): 1.0, (2023, 2): 1.0, (2023, 3): 1.0, (2023, 4): 1.0,
         (2024, 1): 1.1, (2024, 2): 1.2, (2024, 3): 1.4, (2024, 4): 1.6,
         (2025, 1): 1.98, (2025, 2): 3.12, (2025, 3): 5.88}
_REV3 = {k: v * 100 for k, v in _EPS3.items()}
# Margins follow the same accelerating pattern (2023 = 10%, then 11/12/14,
# 19.8/31.2/58.8%), so ni = rev * margin also passes the strict screen.
_MARGIN3 = {(2023, 1): 0.10, (2023, 2): 0.10, (2023, 3): 0.10, (2023, 4): 0.10,
            (2024, 1): 0.11, (2024, 2): 0.12, (2024, 3): 0.14, (2024, 4): 0.16,
            (2025, 1): 0.198, (2025, 2): 0.312, (2025, 3): 0.588}
_NI3 = {k: _REV3[k] * _MARGIN3[k] for k in _REV3}


def _pit_facts():
    """Facts where each quarter is filed ~1 month after its period ends
    (Q1 -> 05-01, Q2 -> 08-01, Q3 -> 11-01 of its own year)."""
    def entries(values):
        return [
            _q(_QPERIODS[q][0].format(y=fy), _QPERIODS[q][1].format(y=fy),
               val, fy, f"Q{q}", filed=f"{fy + (q == 4)}-{2 if q == 4 else q * 3 + 2:02d}-01")
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
    facts = _facts(_EPS, {k: v for k, v in _REV.items() if k != (2024, 4)}, _NI)
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
    # Live: four contiguous quarters, starting with 2024Q4.
    live = compute_code33_from_facts(facts)
    assert live.passes is True, live.reason
    assert live.quarters == ["FY2025Q3", "FY2025Q2", "FY2025Q1", "FY2024Q4"]
    # As of mid-June 2025 only the Q1 filing (05-01) is public — the vantage
    # shifts back to [2025Q1, 2024Q4, 2024Q3, 2024Q2] and still passes.
    pit = compute_code33_from_facts(facts, as_of="2025-06-15")
    assert pit.passes is True, pit.reason
    assert pit.quarters == ["FY2025Q1", "FY2024Q4", "FY2024Q3", "FY2024Q2"]
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


def test_book_figure_8_10_requires_margin_levels_not_margin_yoy():
    # Source work/book-review/067.25.jpg: the four displayed columns.
    eps, rev, ni = {}, {}, {}
    for q, eg, sg, margin, prior_margin in zip(
        range(1, 5), [-34, 12, 44, 83], [-22, 3, 16, 38],
        [4.5, 4.9, 5.8, 6.6], [2, 4, 6, 8],
    ):
        eps[2024, q], eps[2025, q] = 1, 1 + eg / 100
        rev[2024, q], rev[2025, q] = 100, 100 + sg
        ni[2024, q] = prior_margin
        ni[2025, q] = rev[2025, q] * margin / 100
    facts = _facts(eps, rev, ni)
    for fact in facts["facts"]["us-gaap"].values():
        for entries in fact["units"].values():
            for entry in entries:
                entry["filed"] = "2026-02-15"
    result = compute_code33_from_facts(facts)
    assert result.passes, result.reason
    assert result.eps_yoy == pytest.approx([.83, .44, .12, -.34])
    assert result.sales_yoy == pytest.approx([.38, .16, .03, -.22])
    assert result.margin_levels == pytest.approx([.066, .058, .049, .045])
    assert result.margin_yoy[0] < result.margin_yoy[-1]


def test_three_growth_points_cannot_establish_three_increases():
    # Remove prior Q4: old three-point implementation incorrectly passed.
    result = compute_code33_from_facts(_facts(
        {k: v for k, v in _EPS.items() if k[1] != 4},
        {k: v for k, v in _REV.items() if k[1] != 4},
        {k: v for k, v in _NI.items() if k[1] != 4},
    ))
    assert not result.passes
    assert result.reason == "nonconsecutive quarterly periods"


def test_missing_latest_metric_must_not_silently_shift_review_back():
    facts = _pit_facts()
    facts["facts"]["us-gaap"]["NetIncomeLoss"]["units"]["USD"] = [
        e for e in facts["facts"]["us-gaap"]["NetIncomeLoss"]["units"]["USD"]
        if e["end"] != "2025-09-30"
    ]
    result = compute_code33_from_facts(facts)
    assert not result.passes
    assert result.reason == "missing current quarterly metric at 2025-09-30"


def test_annual_minus_quarters_eps_cannot_certify_q4():
    eps = {k: v for k, v in _EPS.items() if k != (2024, 4)}
    facts = _facts(eps, _REV, _NI)
    facts["facts"]["us-gaap"]["EarningsPerShareDiluted"]["units"]["USD/shares"].append(
        _q("2024-01-01", "2024-12-31", 4, 2024, "FY", "2025-02-15")
    )
    assert (2024, 4) not in quarterly_series(facts, EPS_TAGS, is_eps=True)
    assert "2024-12-31" not in {r[0] for r in quarterly_series_dated(facts, EPS_TAGS, is_eps=True)}
    assert not compute_code33_from_facts(facts).passes


def test_same_end_with_different_metric_duration_is_not_comparable():
    facts = _facts(_EPS, _REV, _NI)
    entries = facts["facts"]["us-gaap"]["NetIncomeLoss"]["units"]["USD"]
    next(e for e in entries if e["end"] == "2025-09-30")["start"] = "2025-07-08"
    result = compute_code33_from_facts(facts)
    assert not result.passes
    assert result.reason == "quarter duration mismatch at 2025-09-30"


@pytest.mark.parametrize("filed", [None, "2026-02-15", "2025-09-01", "bad-date"])
def test_asof_cannot_use_missing_future_or_impossible_filing_dates(filed):
    facts = _facts(_EPS, _REV, _NI)
    entries = facts["facts"]["us-gaap"]["EarningsPerShareDiluted"]["units"]["USD/shares"]
    target = next(e for e in entries if e["end"] == "2025-09-30")
    if filed is None:
        target.pop("filed")
    else:
        target["filed"] = filed
    result = compute_code33_from_facts(facts, as_of="2025-11-01")
    assert not result.passes


@pytest.mark.parametrize("value", [float("nan"), float("inf"), True])
def test_invalid_numeric_eps_cannot_pass(value):
    facts = _facts({**_EPS, (2025, 3): value}, _REV, _NI)
    assert not compute_code33_from_facts(facts).passes


def test_flag_api_rejects_relaxed_mode_without_network():
    with pytest.raises(ValueError, match="all three"):
        SecEdgarClient().code33_map(["TEST"], require_margin=False)
    result = compute_code33_from_facts(_facts(_EPS, _REV, _NI), require_margin=False)
    assert result.mode == "relaxed-eps-sales-only"
    assert "not full Code 33" in result.reason


def test_year_ago_stub_cannot_act_as_comparable_growth_base():
    facts = _facts(_EPS, _REV, _NI)
    entries = facts["facts"]["us-gaap"]["EarningsPerShareDiluted"]["units"]["USD/shares"]
    next(e for e in entries if e["end"] == "2024-09-30")["start"] = "2024-07-16"
    result = compute_code33_from_facts(facts)
    assert not result.passes
    assert result.reason.startswith("missing YoY base")


def test_revenue_annual_derivation_rejects_noncontiguous_quarters():
    facts = _facts(_EPS, {(2024, 1): 100, (2024, 2): 110, (2024, 3): 120}, _NI)
    entries = facts["facts"]["us-gaap"]["Revenues"]["units"]["USD"]
    entries[1]["start"] = "2024-04-08"
    entries.append(_q("2024-01-01", "2024-12-31", 460, 2024, "FY", "2025-02-15"))
    dated = quarterly_series_dated(facts, REVENUE_TAGS, is_eps=False)
    assert "2024-12-31" not in {r[0] for r in dated}
