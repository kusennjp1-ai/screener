"""Unit tests for the chart buy-context service (scan viewer's MM360 wiring)."""
import numpy as np
import pandas as pd

import app.services.buy_context as buy_context_module
from app.services.buy_context import build_buy_context


def _df(n=260, start=80.0, end=120.0):
    closes = np.linspace(start, end, n)
    return pd.DataFrame(
        {
            "Open": closes,
            "High": closes * 1.01,
            "Low": closes * 0.99,
            "Close": closes,
            "Volume": np.full(n, 1_000_000.0),
        },
        index=pd.date_range("2025-07-01", periods=n, freq="B"),
    )


class _FakePriceCache:
    def __init__(self, frame):
        self._frame = frame

    def get_cached_only(self, symbol, period="1y"):
        return self._frame


class _FakeBundle:
    def __init__(self, frame):
        self.data = frame
        self.benchmark_symbol = "SPY"


class _FakeBenchmarkCache:
    def __init__(self, frame):
        self._frame = frame

    def get_benchmark_bundle(self, market=None, period="1y"):
        return _FakeBundle(self._frame)


class _FakeFundamentalsCache:
    def __init__(self, payload):
        self._payload = payload

    def get_fundamentals(self, symbol, market=None):
        return self._payload


def _wire(monkeypatch, price_frame, benchmark_frame, fundamentals=None):
    import app.wiring.bootstrap as bootstrap

    monkeypatch.setattr(bootstrap, "get_price_cache", lambda: _FakePriceCache(price_frame))
    monkeypatch.setattr(bootstrap, "get_benchmark_cache", lambda: _FakeBenchmarkCache(benchmark_frame))
    monkeypatch.setattr(bootstrap, "get_fundamentals_cache", lambda: _FakeFundamentalsCache(fundamentals))
    monkeypatch.setattr(buy_context_module, "_resolve_market", lambda symbol: "US")


def test_buy_context_packages_bands_overlays_and_signal(monkeypatch):
    _wire(monkeypatch, _df(), _df(end=100.0))
    ctx = build_buy_context("ftnt")
    assert ctx["symbol"] == "FTNT"
    assert ctx["available"] is True
    assert ctx["as_of"]  # last bar date
    # Bands carry both the current states and per-bar histories for the strips.
    assert ctx["bands"].get("pressure_state") in ("buy", "neutral", "sell")
    assert len(ctx["bands"].get("pressure_history") or []) > 0
    # The buy signal always reports its three confirmation barrels.
    assert set(ctx["signal"]["barrels"]) == {"trend", "pressure", "breakout"}
    assert isinstance(ctx["vcp_boxes"], list)
    assert isinstance(ctx["buy_points"], list)


def test_buy_context_surfaces_code33_from_fundamentals(monkeypatch):
    _wire(monkeypatch, _df(), _df(end=100.0), fundamentals={"code33": True})
    assert build_buy_context("FTNT")["code33"] is True


def test_buy_context_code33_null_when_not_evaluated(monkeypatch):
    _wire(monkeypatch, _df(), _df(end=100.0), fundamentals={"code33": None})
    assert build_buy_context("FTNT")["code33"] is None
    # and when there is no fundamentals row at all
    _wire(monkeypatch, _df(), _df(end=100.0), fundamentals=None)
    assert build_buy_context("FTNT")["code33"] is None


def test_buy_context_degrades_without_cached_prices(monkeypatch):
    _wire(monkeypatch, None, _df())
    assert build_buy_context("ZZZZ") == {"symbol": "ZZZZ", "available": False}


def test_buy_context_survives_a_dead_benchmark(monkeypatch):
    import app.wiring.bootstrap as bootstrap

    _wire(monkeypatch, _df(), _df())

    def _boom():
        raise RuntimeError("no benchmark")

    monkeypatch.setattr(bootstrap, "get_benchmark_cache", _boom)
    ctx = build_buy_context("FTNT")
    assert ctx["available"] is True  # TPR degrades, everything else serves
