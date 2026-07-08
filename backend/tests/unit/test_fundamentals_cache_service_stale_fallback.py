"""Stale-fundamentals fallback: a failed refresh must not blank the panel.

When a DB row is stale (>7d) and the live refresh fails — the common case, as
providers 403/429/go down — get_fundamentals must serve the still-usable stale
row rather than the failed refresh's None (which surfaces as a 404 and blanks
the whole fundamentals panel). A day-old fundamental beats nothing.
"""
from __future__ import annotations

from datetime import datetime, timedelta
from unittest.mock import MagicMock

from app.services.fundamentals_cache_service import FundamentalsCacheService


def _service():
    return FundamentalsCacheService(
        redis_client=None,  # skip Redis; exercise the DB path directly
        session_factory=lambda: MagicMock(),
        fx_service=MagicMock(),
    )


def _stale_row():
    return {"symbol": "FTNT", "pe_ratio": 45.2, "eps_growth_quarterly": 0.31, "roe": 0.34}


def test_stale_row_served_when_refresh_fails(monkeypatch):
    svc = _service()
    stale_dt = datetime.utcnow() - timedelta(days=30)
    monkeypatch.setattr(svc, "_get_from_database", lambda symbol: (_stale_row(), stale_dt))
    monkeypatch.setattr(svc, "_is_data_fresh", lambda last_update: False)
    monkeypatch.setattr(svc, "_ensure_field_availability_metadata", lambda *a, **k: False)
    # Refresh fails (provider down / 403 / rate limited).
    fetch = MagicMock(return_value=None)
    monkeypatch.setattr(svc, "_fetch_and_cache", fetch)

    result = svc.get_fundamentals("FTNT", market="US")

    assert result is not None, "a failed refresh must not blank a stale-but-usable row"
    assert result["pe_ratio"] == 45.2
    assert result["is_stale"] is True
    fetch.assert_called_once()  # it DID try to refresh first


def test_fresh_refresh_wins_over_stale_row(monkeypatch):
    svc = _service()
    stale_dt = datetime.utcnow() - timedelta(days=30)
    monkeypatch.setattr(svc, "_get_from_database", lambda symbol: (_stale_row(), stale_dt))
    monkeypatch.setattr(svc, "_is_data_fresh", lambda last_update: False)
    monkeypatch.setattr(
        svc, "_fetch_and_cache", lambda symbol, market=None: {"symbol": "FTNT", "pe_ratio": 50.0}
    )

    result = svc.get_fundamentals("FTNT", market="US")

    assert result["pe_ratio"] == 50.0  # fresh data wins
    assert "is_stale" not in result


def test_true_cache_miss_still_returns_none_on_failure(monkeypatch):
    svc = _service()
    monkeypatch.setattr(svc, "_get_from_database", lambda symbol: (None, None))
    monkeypatch.setattr(svc, "_fetch_and_cache", lambda symbol, market=None: None)

    # No stale row to fall back to → the miss legitimately yields None (→404).
    assert svc.get_fundamentals("ZZZZ", market="US") is None
