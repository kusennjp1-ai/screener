"""When the scan freshness gate is disabled, scans read the cache AS-IS.

SCAN_FRESHNESS_GATE_ENABLED=false means the operator opted into scanning
whatever cached data exists. The bulk price-read seam must honor that with
cached-only reads (no vendor refresh) — otherwise a network-restricted
deployment fails the whole scan after download retries instead of degrading
to the cache it was promised.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import app.scanners.data_preparation as dp


def _layer(monkeypatch):
    # The constructor resolves process-runtime services (yfinance, rate
    # limiter) that don't exist in a unit context; stub them out.
    monkeypatch.setattr(dp, "get_yfinance_service", lambda: MagicMock())
    monkeypatch.setattr(dp, "get_rate_limiter", lambda: MagicMock())
    price_cache = MagicMock()
    price_cache.get_many.return_value = {}
    price_cache.get_many_cached_only.return_value = {}
    layer = dp.DataPreparationLayer(
        price_cache=price_cache,
        benchmark_cache=MagicMock(),
        fundamentals_cache=MagicMock(),
    )
    return layer, price_cache


@pytest.mark.parametrize("gate_enabled,expect_cached_only", [(True, False), (False, True)])
def test_gate_setting_selects_the_price_read_path(monkeypatch, gate_enabled, expect_cached_only):
    # patch the exact seam _read_prices_bulk reads
    monkeypatch.setattr(dp, "app_settings", SimpleNamespace(scan_freshness_gate_enabled=gate_enabled))
    layer, price_cache = _layer(monkeypatch)

    layer._read_prices_bulk(["AAPL"], period="2y", market_by_symbol={"AAPL": "US"})

    assert price_cache.get_many_cached_only.called is expect_cached_only
    assert price_cache.get_many.called is (not expect_cached_only)
