"""Code 33 refresh task: EDGAR compute -> targeted code33 column write."""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

import app.tasks.fundamentals_tasks as ft
from app.config import settings


def test_disabled_by_default(monkeypatch):
    monkeypatch.setattr(settings, "fundamentals_code33_enabled", False)
    assert ft.refresh_code33_flags.run(market="US") == {"status": "disabled"}


def test_non_us_skipped(monkeypatch):
    monkeypatch.setattr(settings, "fundamentals_code33_enabled", True)
    out = ft.refresh_code33_flags.run(market="HK")
    assert out["status"] == "skipped"


def test_stamps_code33_from_edgar(monkeypatch):
    monkeypatch.setattr(settings, "fundamentals_code33_enabled", True)

    captured = {"updates": []}
    fake_db = MagicMock()
    fake_db.query.return_value.all.return_value = [
        SimpleNamespace(symbol="AAPL"), SimpleNamespace(symbol="MSFT"),
    ]

    def _update(values, **kwargs):
        captured["updates"].append(values)
        return 1

    fake_db.query.return_value.filter.return_value.update.side_effect = _update
    monkeypatch.setattr(ft, "SessionLocal", lambda: fake_db)

    fake_client = MagicMock()
    fake_client.code33_map.return_value = {"AAPL": True, "MSFT": False}
    monkeypatch.setattr(
        "app.services.sec_edgar_financials.SecEdgarClient", lambda *a, **k: fake_client
    )
    monkeypatch.setattr(ft, "get_fundamentals_cache", lambda: MagicMock())

    out = ft.refresh_code33_flags.run(market="US")

    assert out == {"status": "ok", "evaluated": 2, "passed": 1}
    assert {"code33": True} in captured["updates"]
    assert {"code33": False} in captured["updates"]
    fake_db.commit.assert_called()
