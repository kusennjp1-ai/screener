"""Offline contract tests against installed yfinance 0.2.66, no vendor fetch."""
from datetime import datetime, timezone
import json
from types import SimpleNamespace

from curl_cffi import requests
import pytest
import yfinance as yf
from yfinance.data import YfData

from app.services import financial_source_capture as capture


def statement_body(symbol="AAPL", error=None):
    return {"timeseries": {"error": error, "result": [
        {"meta": {"symbol": [symbol], "type": ["quarterly" + metric]},
         "timestamp": [1782777600, 1774915200],
         "quarterly" + metric: [
             {"asOfDate": date, "currencyCode": "USD", "reportedValue": {"raw": value}}
             for date, value in zip(["2026-06-30", "2026-03-31"], values)]}
        for metric, values in [("DilutedEPS", [2., 1.]), ("TotalRevenue", [200., 100.])]
    ]}}


@pytest.fixture
def real_transport(monkeypatch):
    assert yf.__version__ == "0.2.66"
    state = {"statement": statement_body(), "calls": [],
             "summary": {"quoteSummary": {"error": None, "result": [{
                 "symbol": "AAPL", "quoteType": {"symbol": "AAPL"},
                 "financialData": {"profitMargins": {"raw": -.1, "fmt": "-10%"},
                                   "returnOnEquity": {"raw": 0., "fmt": "0%"}}}]}},
             "quote": {"quoteResponse": {"error": None, "result": [{"symbol": "AAPL"}]}}}

    def forbidden(*args, **kwargs):
        raise AssertionError("Network is forbidden in offline vendor contract tests")

    def request(self, url, **kwargs):
        state["calls"].append((url, kwargs))
        if "/v10/finance/quoteSummary/" in url:
            body = state["summary"]
        elif "/v7/finance/quote" in url:
            body = state["quote"]
        elif "type=trailingPegRatio" in url:
            body = {"timeseries": {"error": None, "result": [{}]}}
        elif "type=annual" in url:
            body = state.get("annual_statement", state["statement"])
        else:
            body = state["statement"]
        text = json.dumps(body)
        return SimpleNamespace(status_code=200, url=url, text=text,
                               content=text.encode(), json=lambda: json.loads(text),
                               raise_for_status=lambda: None)

    monkeypatch.setattr(requests.Session, "request", forbidden)
    monkeypatch.setattr(requests.Session, "get", forbidden)
    monkeypatch.setattr(YfData, "_make_request", request)
    YfData().cache_get.cache_clear()
    yield state
    YfData().cache_get.cache_clear()


def test_real_statement_cache_retains_original_receipt(real_transport, monkeypatch):
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 1, tzinfo=timezone.utc))
    ticker = yf.Ticker("AAPL")
    value, first = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    assert list(value.index) == ["Diluted EPS", "Total Revenue"]
    assert first
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 3, tzinfo=timezone.utc))
    _, second = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    _, third = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "quarterly_income_stmt")
    assert first == second == third
    assert first["quarterly_income_stmt"]["observed_at"] == "2026-10-01T00:00:00.000Z"
    assert len(real_transport["calls"]) == 1


def test_real_precapture_cache_stays_unknown(real_transport):
    assert not yf.Ticker("AAPL").quarterly_income_stmt.empty
    _, contexts = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "quarterly_income_stmt")
    assert contexts == {}
    assert len(real_transport["calls"]) == 1


@pytest.mark.parametrize("failure", ["wrong_symbol", "partial_error", "wrong_identity"])
def test_real_invalid_statement_origin_is_not_certified(real_transport, failure):
    requested_symbol = "AAPL"
    if failure == "wrong_symbol":
        real_transport["statement"] = statement_body("MSFT")
    elif failure == "partial_error":
        real_transport["statement"] = statement_body(error={"code": "partial", "description": "Incomplete result"})
    else:
        requested_symbol = "MSFT"
    value, contexts = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "quarterly_income_stmt", symbol=requested_symbol)
    assert not value.empty  # Preserve vendor's ordinary result even when proof is rejected.
    assert contexts == {}


def test_real_modified_getter_cannot_borrow_receipt(real_transport, monkeypatch):
    original = yf.Ticker.get_income_stmt
    def modified(self, *args, **kwargs):
        value = original(self, *args, **kwargs).copy()
        value.iloc[0, 0] = 999.
        return value
    monkeypatch.setattr(yf.Ticker, "get_income_stmt", modified)
    value, contexts = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "quarterly_income_stmt")
    assert value.iloc[0, 0] == 999.
    assert contexts == {}


def test_real_info_merge_normal_path(real_transport):
    value, contexts = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "info")
    assert value["profitMargins"] == -.1
    assert value["returnOnEquity"] == 0.
    assert set(contexts) == {"profitMargins", "returnOnEquity"}
    assert len(real_transport["calls"]) == 3


@pytest.mark.parametrize("failure", ["equal_competitor", "wrong_symbol", "partial_error", "oversized"])
def test_real_unverifiable_competitor_cannot_leave_false_summary_binding(real_transport, failure):
    quote = real_transport["quote"]["quoteResponse"]
    quote["result"][0]["profitMargins"] = -.1
    if failure == "wrong_symbol":
        quote["result"][0]["symbol"] = "MSFT"
    elif failure == "partial_error":
        quote["error"] = {"code": "partial", "description": "Incomplete result"}
    elif failure == "oversized":
        quote["result"][0]["unexpected"] = "x" * (5 * 1024 * 1024)
    value, contexts = capture.acquire_yahoo_value(yf.Ticker("AAPL"), "info")
    assert value["profitMargins"] == -.1
    assert "profitMargins" not in contexts
