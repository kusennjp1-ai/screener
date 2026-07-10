"""Fast post-close publish: prices-only refresh + close-buffer semantics."""
from __future__ import annotations

from datetime import date, datetime
from unittest.mock import MagicMock, patch
from zoneinfo import ZoneInfo

from app.wiring.bootstrap import get_market_calendar_service


NY = ZoneInfo("America/New_York")


def _ny(hour: int, minute: int) -> datetime:
    # Wednesday 2026-07-08 — a regular NYSE session.
    return datetime(2026, 7, 8, hour, minute, tzinfo=NY)


class TestCloseBuffer:
    def test_default_buffer_still_counts_today_only_after_1630(self):
        svc = get_market_calendar_service()
        assert svc.last_completed_trading_day("US", now=_ny(16, 6)) == date(2026, 7, 7)
        assert svc.last_completed_trading_day("US", now=_ny(16, 31)) == date(2026, 7, 8)

    def test_small_buffer_counts_today_minutes_after_the_bell(self):
        svc = get_market_calendar_service()
        assert svc.last_completed_trading_day(
            "US", now=_ny(16, 6), close_buffer_minutes=5
        ) == date(2026, 7, 8)
        # before the buffer elapses the session is still "incomplete"
        assert svc.last_completed_trading_day(
            "US", now=_ny(16, 4), close_buffer_minutes=5
        ) == date(2026, 7, 7)


class TestPricesOnlyRefresh:
    def test_uses_short_buffer_and_calls_price_refresh(self):
        from app.scripts import export_static_site as mod

        fake_refresh = MagicMock(return_value={"status": "completed"})
        fake_resolve = MagicMock(return_value=date(2026, 7, 8))
        fake_subset = MagicMock(return_value=["AAPL", "MSFT"])
        with patch.object(mod, "_refresh_static_daily_prices", fake_refresh), \
             patch.object(mod, "_resolve_latest_completed_trading_date", fake_resolve), \
             patch.object(mod, "_chart_relevant_symbols", fake_subset):
            out = mod._run_prices_only_refresh(market="US")

        fake_resolve.assert_called_once_with(
            "US", close_buffer_minutes=mod.PRICES_ONLY_CLOSE_BUFFER_MINUTES
        )
        fake_subset.assert_called_once_with(
            "US", limit=mod.PRICES_ONLY_REFRESH_SYMBOL_LIMIT
        )
        fake_refresh.assert_called_once_with(
            as_of_date=date(2026, 7, 8), market="US", symbols=["AAPL", "MSFT"]
        )
        assert out["as_of_date"] == "2026-07-08"
        assert out["refresh_symbol_subset"] == 2
        assert mod.PRICES_ONLY_CLOSE_BUFFER_MINUTES < 30

    def test_cli_guards(self):
        import subprocess
        import sys

        # --prices-only without --market must be rejected before any DB work.
        proc = subprocess.run(
            [sys.executable, "-m", "app.scripts.export_static_site", "--prices-only"],
            capture_output=True, text=True,
        )
        assert proc.returncode != 0
        assert "--prices-only requires --market" in (proc.stderr + proc.stdout)
