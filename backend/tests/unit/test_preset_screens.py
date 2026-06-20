from app.services.preset_screens import (
    PRESET_SCREENS,
    _matches_preset_filters,
    get_preset_chart_symbols,
    resolve_preset_screens_for_defaults,
)


def _leaders_screen():
    return next(
        screen
        for screen in PRESET_SCREENS
        if screen["id"] == "leaders_in_leading_groups"
    )


def test_leaders_in_leading_groups_preset_filters_for_v1_contract():
    screen = _leaders_screen()

    matching = {
        "symbol": "LEAD",
        "ibd_group_rank": 40,
        "rs_rating": 80,
        "composite_score": 64.23,
        "volume": 1_500_000,
    }

    assert screen["name"] == "Leaders in Leading Groups"
    assert screen["sort_by"] == "composite_score"
    assert screen["sort_order"] == "desc"
    assert "apply_default_filters" not in screen
    assert "compositeScore" not in screen["filters"]
    assert "minVolume" not in screen["filters"]
    assert _matches_preset_filters(matching, screen["filters"]) is True
    assert _matches_preset_filters(
        {**matching, "ibd_group_rank": 41},
        screen["filters"],
    ) is False
    assert _matches_preset_filters(
        {**matching, "rs_rating": 79},
        screen["filters"],
    ) is False


def test_resolved_leaders_filters_materialize_market_defaults():
    screen = _leaders_screen()

    [resolved_screen] = resolve_preset_screens_for_defaults(
        [screen],
        {"minVolume": 1_300_000},
    )

    assert resolved_screen["filters"] == {
        "minVolume": 1_300_000,
        "ibdGroupRank": {"min": None, "max": 40},
        "rsRating": {"min": 80, "max": None},
    }
    assert "minVolume" not in screen["filters"]


def test_preset_chart_symbols_use_resolved_market_defaults():
    screen = _leaders_screen()
    [resolved_screen] = resolve_preset_screens_for_defaults(
        [screen],
        {"minVolume": 1_300_000},
    )
    rows = [
        {
            "symbol": "LIQUID",
            "ibd_group_rank": 10,
            "rs_rating": 90,
            "volume": 2_000_000,
            "composite_score": 64.0,
        },
        {
            "symbol": "THIN",
            "ibd_group_rank": 5,
            "rs_rating": 99,
            "volume": 900_000,
            "composite_score": 99.0,
        },
    ]

    assert get_preset_chart_symbols(
        rows,
        presets=[resolved_screen],
        top_n=5,
    ) == {"LIQUID"}


def test_noop_scalar_and_range_filters_match_like_frontend():
    row = {"symbol": "ROW", "volume": None, "composite_score": None}

    assert _matches_preset_filters(row, {"minVolume": None}) is True
    assert _matches_preset_filters(
        row,
        {"compositeScore": {"min": None, "max": None}},
    ) is True


def _preset(screen_id):
    return next(screen for screen in PRESET_SCREENS if screen["id"] == screen_id)


def test_minervini_preset_gates_on_strict_template_flag():
    """The Minervini preset gates on the strict boolean trend-template flag
    (passes_template) AND the elite-leader thresholds (RS>=90, within 10% of the
    52-week high, top-half IBD group), so it is a tight leaders-in-leading-groups
    short-list rather than every textbook-minimum pass."""
    screen = _preset("minervini")

    assert screen["filters"]["passesTemplate"] is True
    assert screen["filters"]["rsRating"] == {"min": 90, "max": None}
    assert screen["filters"]["week52HighDistance"] == {"min": -10, "max": None}
    assert screen["filters"]["ibdGroupRank"] == {"min": None, "max": 98}
    assert screen["filters"]["code33"] is True

    leader = {
        "symbol": "PASS",
        "passes_template": True,
        "rs_rating": 93,
        "week_52_high_distance": -6,
        "ibd_group_rank": 25,
        "code33": True,
    }
    assert _matches_preset_filters(leader, screen["filters"]) is True
    # A high composite/minervini score is no longer enough on its own.
    assert _matches_preset_filters(
        {"symbol": "SOFT", "passes_template": False, "minervini_score": 95},
        screen["filters"],
    ) is False
    # Passes the template but not a top-decile leader (RS 84) -> excluded now.
    assert _matches_preset_filters(
        {**leader, "rs_rating": 84}, screen["filters"]
    ) is False
    # Passes the template but extended >10% below the highs -> excluded.
    assert _matches_preset_filters(
        {**leader, "week_52_high_distance": -14}, screen["filters"]
    ) is False
    # Passes the template but sits in a bottom-half IBD group -> excluded.
    assert _matches_preset_filters(
        {**leader, "ibd_group_rank": 150}, screen["filters"]
    ) is False
    # Passes the template and the leader thresholds but Code 33 earnings
    # acceleration does not hold -> excluded.
    assert _matches_preset_filters(
        {**leader, "code33": False}, screen["filters"]
    ) is False


def test_minervini_vcp_preset_is_minervini_subset_requiring_a_vcp():
    """The 'Minervini + VCP' premium preset gates on the same elite Minervini
    legs PLUS a detected VCP base, so it is a strict subset of the Minervini
    short-list (a buyable pivot rather than an extended leader)."""
    screen = _preset("minervini_vcp")
    minervini = _preset("minervini")

    # It carries every Minervini leg...
    for key, value in minervini["filters"].items():
        assert screen["filters"][key] == value
    # ...plus the VCP requirement, and ranks by base quality.
    assert screen["filters"]["vcpDetected"] is True
    assert screen["sort_by"] == "vcp_score"

    leader_in_base = {
        "symbol": "BASE",
        "passes_template": True,
        "rs_rating": 93,
        "week_52_high_distance": -6,
        "ibd_group_rank": 25,
        "code33": True,
        "vcp_detected": True,
    }
    assert _matches_preset_filters(leader_in_base, screen["filters"]) is True
    # A Minervini leader that is NOT in a VCP base is excluded here (it still
    # shows in the plain Minervini list).
    assert _matches_preset_filters(
        {**leader_in_base, "vcp_detected": False}, screen["filters"]
    ) is False
    assert _matches_preset_filters(
        {**leader_in_base, "vcp_detected": True, "code33": False}, screen["filters"]
    ) is False


def test_minervini_usic_preset_gates_on_momentum_tight_to_highs():
    """The 'Minervini USIC-style' preset encodes the DNA of his real championship
    entries: a passing template, tight to the 52w high (within 5%), strong
    6-month momentum (>=25%), and a moderate ADR — ranked by momentum."""
    screen = _preset("minervini_usic")

    assert screen["filters"]["passesTemplate"] is True
    assert screen["filters"]["ibdGroupRank"] == {"min": None, "max": 40}
    assert screen["filters"]["week52HighDistance"] == {"min": -5, "max": None}
    assert screen["filters"]["perf6m"] == {"min": 25, "max": None}
    assert screen["filters"]["adrPercent"] == {"min": 2.5, "max": 6.0}
    assert screen["sort_by"] == "perf_6m"

    usic_style = {
        "symbol": "RUN",
        "passes_template": True,
        "ibd_group_rank": 12,           # leading group
        "week_52_high_distance": -2.0,  # tight to the high
        "perf_6m": 60.0,                # strong prior momentum
        "adr_percent": 3.8,
    }
    assert _matches_preset_filters(usic_style, screen["filters"]) is True
    # A template-passer with weak momentum is excluded (the distinguishing leg).
    assert _matches_preset_filters({**usic_style, "perf_6m": 5.0}, screen["filters"]) is False
    # Too far below the highs is excluded.
    assert _matches_preset_filters({**usic_style, "week_52_high_distance": -12.0}, screen["filters"]) is False
    # Too low / too high ADR is excluded.
    assert _matches_preset_filters({**usic_style, "adr_percent": 1.0}, screen["filters"]) is False
    # Outside a leading industry group is excluded (Minervini's group-strength leg).
    assert _matches_preset_filters({**usic_style, "ibd_group_rank": 120}, screen["filters"]) is False


def test_canslim_preset_enforces_annual_eps_and_new_high():
    """CANSLIM must hard-gate annual EPS (A) and new-high proximity (N), not
    only the soft score plus quarterly EPS and RS."""
    screen = _preset("canslim")
    filters = screen["filters"]

    assert filters["epsGrowthYy"] == {"min": 25, "max": None}
    # week_52_high_distance is % BELOW the high (negative); >= -15 == within 15%.
    assert filters["week52HighDistance"] == {"min": -15, "max": None}

    near_high_grower = {
        "symbol": "OK",
        "canslim_score": 80,
        "eps_growth_qq": 30,
        "eps_growth_yy": 30,
        "rs_rating": 85,
        "week_52_high_distance": -5,
    }
    assert _matches_preset_filters(near_high_grower, filters) is True
    assert _matches_preset_filters(
        {**near_high_grower, "eps_growth_yy": 10}, filters
    ) is False  # weak annual earnings
    assert _matches_preset_filters(
        {**near_high_grower, "week_52_high_distance": -40}, filters
    ) is False  # far below the 52-week high


def test_vcp_preset_requires_passing_trend_template():
    """A VCP only counts inside a passing Stage 2 trend template."""
    screen = _preset("vcp")
    filters = screen["filters"]

    assert filters["vcpDetected"] is True
    assert filters["passesTemplate"] is True
    assert _matches_preset_filters(
        {"symbol": "OK", "vcp_detected": True, "passes_template": True}, filters
    ) is True
    assert _matches_preset_filters(
        {"symbol": "NOTREND", "vcp_detected": True, "passes_template": False},
        filters,
    ) is False
