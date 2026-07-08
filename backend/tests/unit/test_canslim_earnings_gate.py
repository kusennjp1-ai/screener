"""W2.1: CANSLIM earnings-proximity blackout gate + the yfinance plumbing."""
from datetime import date, timedelta

from app.scanners.canslim_scanner import (
    CANSLIMScanner,
    EARNINGS_BLACKOUT_DAYS,
    EARNINGS_PENALTY_POINTS,
    _coerce_date,
)


TODAY = date(2026, 6, 30)


def _gate(days_out, key="next_earnings_date"):
    scanner = CANSLIMScanner()
    fundamentals = None if days_out is None else {key: (TODAY + timedelta(days=days_out)).isoformat()}
    return scanner._check_earnings_proximity(fundamentals, today=TODAY)


def test_blackout_window_hard_avoids():
    g = _gate(3)
    assert g["blackout"] is True
    assert g["penalty"] == 0.0
    assert g["days_to_next_earnings"] == 3
    assert "pre-earnings blackout" in g["reason"]


def test_blackout_boundary_inclusive():
    assert _gate(EARNINGS_BLACKOUT_DAYS)["blackout"] is True
    assert _gate(EARNINGS_BLACKOUT_DAYS + 1)["blackout"] is False


def test_penalty_window_soft_penalizes():
    g = _gate(10)
    assert g["blackout"] is False
    assert g["penalty"] == EARNINGS_PENALTY_POINTS
    assert g["days_to_next_earnings"] == 10


def test_far_out_is_no_op():
    g = _gate(40)
    assert g["blackout"] is False and g["penalty"] == 0.0
    assert g["days_to_next_earnings"] == 40
    assert g["reason"] is None


def test_past_earnings_is_no_op():
    g = _gate(-3)
    assert g["blackout"] is False and g["penalty"] == 0.0
    assert g["days_to_next_earnings"] is None


def test_missing_data_is_permissive():
    assert _gate(None)["blackout"] is False
    # fundamentals present but no earnings key -> no-op
    g = CANSLIMScanner()._check_earnings_proximity({"institutional_ownership": 55}, today=TODAY)
    assert g["blackout"] is False and g["days_to_next_earnings"] is None


def test_earnings_date_fallback_key():
    scanner = CANSLIMScanner()
    g = scanner._check_earnings_proximity(
        {"earnings_date": (TODAY + timedelta(days=2)).isoformat()}, today=TODAY
    )
    assert g["blackout"] is True


def test_coerce_date_handles_varied_inputs():
    assert _coerce_date("2026-07-01") == date(2026, 7, 1)
    assert _coerce_date(date(2026, 7, 1)) == date(2026, 7, 1)
    assert _coerce_date(None) is None
    assert _coerce_date("not-a-date") is None
    # epoch seconds for 2026-07-01
    epoch = 1782950400
    assert _coerce_date(epoch).year == 2026


# --- Data plumbing: next_earnings_date must survive the DB round-trip -----
# The gate logic above was always sound, but the field was fetched by yfinance
# and then DROPPED (no DB column), so the cached fundamentals dict handed to
# the gate never contained it and the gate was a permanent no-op. These pin
# that the column now carries the value through store + read.

def test_store_persists_next_earnings_date():
    from unittest.mock import MagicMock
    from app.models.stock import StockFundamental
    from app.services.fundamentals_cache_service import FundamentalsCacheService

    captured = {"record": None}
    fake_db = MagicMock()
    fake_db.query.return_value.filter.return_value.first.return_value = None  # insert path

    def _capture(record):
        if isinstance(record, StockFundamental):
            captured["record"] = record

    fake_db.add.side_effect = _capture
    svc = FundamentalsCacheService(redis_client=None, session_factory=lambda: fake_db)

    svc._store_in_database(
        "AAPL",
        {"market_cap": 3_000_000_000_000, "next_earnings_date": "2026-07-31"},
        data_source="yfinance",
        market="US",
    )
    assert captured["record"] is not None
    assert captured["record"].next_earnings_date == "2026-07-31"


def test_model_exposes_next_earnings_date_column():
    from app.models.stock import StockFundamental

    assert "next_earnings_date" in StockFundamental.__table__.columns
    rec = StockFundamental(symbol="X", next_earnings_date="2026-07-03")
    assert rec.next_earnings_date == "2026-07-03"


def test_store_persists_code33_flag():
    from unittest.mock import MagicMock
    from app.models.stock import StockFundamental
    from app.services.fundamentals_cache_service import FundamentalsCacheService

    captured = {"record": None}
    fake_db = MagicMock()
    fake_db.query.return_value.filter.return_value.first.return_value = None

    def _capture(record):
        if isinstance(record, StockFundamental):
            captured["record"] = record

    fake_db.add.side_effect = _capture
    svc = FundamentalsCacheService(redis_client=None, session_factory=lambda: fake_db)
    svc._store_in_database("AAPL", {"market_cap": 1, "code33": True}, data_source="edgar", market="US")
    assert captured["record"].code33 is True
