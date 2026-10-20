"""Snapshot charts must use only retained prices through their declared day."""
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
import json
import socket

import pandas as pd
import pytest

from app.services import static_site_export_service as module
from tests.unit.test_static_site_export_service import service_and_session_factory  # noqa: F401


@pytest.mark.parametrize("timezone", [None, "UTC", "America/New_York"])
def test_all_chart_passes_bound_prices_and_benchmark_before_computation(
    service_and_session_factory, monkeypatch, tmp_path, timezone,
):
    service, _ = service_and_session_factory
    dates = pd.DatetimeIndex(["2026-10-15", "2026-10-16", "2026-10-19"], tz=timezone)
    prices = pd.DataFrame({"Open": [98., 99., 999.], "High": [100., 101., 1001.],
                           "Low": [97., 98., 998.], "Close": [99., 100., 1000.],
                           "Volume": [1000000, 1000001, 900000000]}, index=dates)
    benchmark = prices * 2
    original_prices, original_benchmark = prices.copy(deep=True), benchmark.copy(deep=True)
    rows = [SimpleNamespace(symbol=symbol, payload={"symbol": symbol, "market": "US",
             "current_price": 100., "adv_usd": 35000000})
            for symbol in ["PRIMARY", "PRESET", "GROUP", "VERIFY", "MISSING"]]
    original_rows = deepcopy([row.payload for row in rows])
    calls = []

    def forbidden(*_args, **_kwargs):
        pytest.fail("Snapshot export attempted external I/O")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(module, "STATIC_CHART_LIMIT", 1)
    monkeypatch.setattr(module, "get_preset_chart_symbols", lambda *_args: {"PRESET"})
    monkeypatch.setattr(service, "_collect_top_group_constituent_symbols", lambda **_kwargs: {"GROUP"})

    def cached(symbols, period="2y"):
        calls.append((tuple(symbols), period))
        return {symbol: None if symbol == "MISSING" else prices for symbol in symbols}

    service._price_cache = SimpleNamespace(get_many_cached_only=cached)
    service._fundamentals_cache = SimpleNamespace(get_many_cached_only=lambda symbols: dict.fromkeys(symbols))
    monkeypatch.setattr(service, "_get_market_benchmark_history", lambda *_a, **_k: ("SPY", benchmark))
    monkeypatch.setattr(service, "_serialize_scan_row", lambda row: deepcopy(row.payload))
    # Pin the existing display-window clock independently of the snapshot cap.
    # Otherwise this 2026 observation would disappear from a future test run.
    cutoff = pd.Timestamp("2026-10-19T23:44:51Z") - pd.Timedelta(days=450)
    monkeypatch.setattr(service, "_static_chart_cutoff", lambda index:
                        cutoff.tz_convert(index.tz) if index.tz is not None else cutoff.tz_localize(None))
    observed = []

    def inspect(name, frame, comparison=None):
        assert list(frame.index.strftime("%Y-%m-%d")) == ["2026-10-15", "2026-10-16"]
        assert frame.Close.iloc[-1] == 100.
        if comparison is not None:
            assert list(comparison.index.strftime("%Y-%m-%d")) == ["2026-10-15", "2026-10-16"]
            assert comparison.Close.iloc[-1] == 200.
        observed.append(name)

    def rs(frame, comparison):
        inspect("rs", frame, comparison)
        return [{"time": "2026-10-16", "value": float(frame.Close.iloc[-1])}], []

    monkeypatch.setattr(service, "_serialize_rs_line", rs)
    for name in ["_compute_buy_points", "_compute_vcp_boxes"]:
        monkeypatch.setattr(service, name, lambda frame, _name=name: (inspect(_name, frame), [])[1])
    for name in ["_compute_chart_bands", "_compute_trend_template"]:
        monkeypatch.setattr(service, name, lambda frame, comparison, _name=name:
                            (inspect(_name, frame, comparison), {})[1])
    monkeypatch.setattr(service, "_compute_m360_signals", lambda frame, **_kwargs:
                        (inspect("m360", frame), {})[1])
    monkeypatch.setattr(service, "_compute_eps_line", lambda _symbol, frame:
                        (inspect("eps", frame), [])[1])
    run = SimpleNamespace(as_of_date=date(2026, 10, 16), config_json={"universe": {"market": "US"}})
    manifest = service._export_chart_bundle(output_dir=tmp_path, generated_at="2026-10-19T23:44:51Z",
        run=run, rows=rows, serialized_rows=[row.payload for row in rows])

    assert manifest["symbols_total"] == 4
    assert manifest["skipped_symbols"] == ["MISSING"]
    for symbol in ["PRIMARY", "PRESET", "GROUP", "VERIFY"]:
        payload = json.loads((tmp_path / "charts" / (symbol + ".json")).read_text())
        assert payload["as_of_date"] == "2026-10-16"
        assert [b["date"] for b in payload["bars"]] == ["2026-10-15", "2026-10-16"]
        assert payload["bars"][-1]["close"] == 100.
        assert payload["stock_data"]["current_price"] == 100.
        assert payload["stock_data"]["adv_usd"] == 35000000
    assert json.loads((tmp_path / "charts/VERIFY.json").read_text())["verification_only"] is True
    assert len(observed) == 3 * 7
    assert all(period == "2y" for _, period in calls)
    pd.testing.assert_frame_equal(prices, original_prices)
    pd.testing.assert_frame_equal(benchmark, original_benchmark)
    assert [row.payload for row in rows] == original_rows


def test_history_bound_preserves_stale_short_and_empty_input():
    # The boundary never fills absent sessions or promotes a stale tail.
    from app.services.static_site_export_service import StaticSiteExportService
    stale = pd.DataFrame({"Close": [10.]}, index=pd.to_datetime(["2026-10-05"]))
    future = pd.DataFrame({"Close": [20.]}, index=pd.to_datetime(["2026-10-19"]))
    bound = StaticSiteExportService._chart_history_through
    pd.testing.assert_frame_equal(bound(stale, date(2026, 10, 16)), stale)
    assert bound(future, date(2026, 10, 16)).empty
    assert bound(None, date(2026, 10, 16)) is None
