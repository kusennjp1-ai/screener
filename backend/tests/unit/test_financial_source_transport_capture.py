"""Offline tests of the passive hook, independent of producer wiring."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from functools import lru_cache
import inspect
import json
from threading import Barrier
from types import SimpleNamespace

import pandas as pd
import pytest
import yfinance.data

from app.services import financial_source_capture as capture


def statement_url(symbol="AAPL", cadence="quarterly"):
    return f"https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/{symbol}?type={cadence}TotalRevenue,{cadence}DilutedEPS"


def response(body=None, status=200):
    return SimpleNamespace(status_code=status, content=json.dumps(body or {"timeseries": {"result": [{"data": [1]}]}}).encode())


def statement_body(symbol="AAPL", prefix="quarterly"):
    periods = ["2026-06-30", "2026-03-31"]
    timestamps = [int(pd.Timestamp(p).timestamp()) for p in periods]
    return {"timeseries": {"error": None, "result": [
        {"meta": {"symbol": [symbol], "type": [prefix + metric]}, "timestamp": timestamps,
         prefix + metric: [{"asOfDate": period, "reportedValue": {"raw": value}, "currencyCode": "USD"} for period, value in zip(periods, values)]}
        for metric, values in [("DilutedEPS", [2.0, 1.0]), ("TotalRevenue", [200.0, 100.0])]
    ]}}


@pytest.fixture
def transport(monkeypatch):
    class FakeData:
        def __init__(self):
            self.calls = []
            self.result = None
            self.error = None
            self.barrier = None

        def get(self, url, params=None, timeout=30):
            self.calls.append((url, params, timeout))
            if self.barrier:
                self.barrier.wait(timeout=5)
            if self.error:
                raise self.error
            # A real transport returns a distinct object for each acquisition.
            result = self.result
            if result is None:
                identity = capture._request_identity(url, params)
                result = response(statement_body(identity[1], "annual" if identity[0] == "income_stmt" else "quarterly"))
            return SimpleNamespace(**vars(result))

        @lru_cache(maxsize=64)
        def cache_get(self, url, params=None, timeout=30):
            return self.get(url, params=params, timeout=timeout)

    monkeypatch.setattr(yfinance.data, "YfData", FakeData)
    monkeypatch.setattr(capture.yf, "__version__", "0.2.66")
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 1, tzinfo=timezone.utc))
    return FakeData()


class StatementTicker:
    def __init__(self, transport, symbol="AAPL"):
        self.ticker = symbol
        self.transport = transport
        self.cached = {}

    def _statement(self, attribute, cadence):
        if attribute not in self.cached:
            self.transport.cache_get(statement_url(self.ticker, cadence))
            self.cached[attribute] = pd.DataFrame([[2.0, 1.0], [200.0, 100.0]], index=["Diluted EPS", "Total Revenue"], columns=pd.to_datetime(["2026-06-30", "2026-03-31"]))
        return self.cached[attribute]

    @property
    def quarterly_income_stmt(self):
        return self._statement("quarterly_income_stmt", "quarterly")

    @property
    def income_stmt(self):
        return self._statement("income_stmt", "annual")


def test_cached_getter_and_shared_http_cache_keep_original_acquisition(transport, monkeypatch):
    ticker = StatementTicker(transport)
    value, first = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 3, tzinfo=timezone.utc))
    retained_value, second = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    _, third = capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt")
    assert retained_value is value
    assert first == second == third
    assert first["quarterly_income_stmt"]["observed_at"] == "2026-10-01T00:00:00.000Z"
    assert len(transport.calls) == 1


def test_preexisting_http_cache_and_untracked_getter_are_unknown(transport):
    transport.cache_get(statement_url())
    _, contexts = capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt")
    assert contexts == {}
    assert len(transport.calls) == 1
    ticker = StatementTicker(transport, "MSFT")
    ticker.cached["quarterly_income_stmt"] = pd.DataFrame([[1, 2]], index=["Diluted EPS"])
    _, contexts = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    assert contexts == {}


def test_changed_cached_contents_do_not_borrow_original_receipt(transport):
    ticker = StatementTicker(transport)
    _, contexts = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    assert contexts
    ticker.cached["quarterly_income_stmt"].iloc[0, 0] = 99
    _, contexts = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    assert contexts == {}


def test_each_statement_uses_its_own_receipt(transport, monkeypatch):
    ticker = StatementTicker(transport)
    _, quarterly = capture.acquire_yahoo_value(ticker, "quarterly_income_stmt")
    monkeypatch.setattr(capture, "_utc_now", lambda: datetime(2026, 10, 2, tzinfo=timezone.utc))
    _, annual = capture.acquire_yahoo_value(ticker, "income_stmt")
    assert quarterly["quarterly_income_stmt"]["observed_at"] != annual["income_stmt"]["observed_at"]
    assert quarterly["quarterly_income_stmt"]["capture_id"] != annual["income_stmt"]["capture_id"]


def test_hook_preserves_cache_methods_signatures_and_is_idempotent(transport):
    expected = inspect.signature(type(transport).get)
    assert capture._install_yahoo_transport_hooks()
    installed = type(transport).get
    assert capture._install_yahoo_transport_hooks()
    assert type(transport).get is installed
    assert inspect.signature(installed) == expected
    assert inspect.signature(type(transport).cache_get) == expected
    transport.cache_get(statement_url())
    transport.cache_get(statement_url())
    assert transport.cache_get.cache_info().hits == 1
    transport.cache_get.cache_clear()
    assert transport.cache_get.cache_info().currsize == 0


@pytest.mark.parametrize("status,body", [(403, None), (200, {"timeseries": {"result": []}})])
def test_failed_and_empty_acquisition_cannot_certify_value(transport, status, body):
    transport.result = response(body, status)
    _, contexts = capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt")
    assert contexts == {}


def test_transport_exception_propagates_without_retry_and_context_resets(transport):
    error = RuntimeError("offline vendor failure")
    transport.error = error
    with pytest.raises(RuntimeError) as caught:
        capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt")
    assert caught.value is error
    assert len(transport.calls) == 1
    assert capture._ACTIVE_RECEIPTS.get() is None


def test_bad_json_and_unsupported_version_preserve_getter_results(transport, monkeypatch):
    transport.result = response()
    transport.result.content = b"not JSON"
    value, contexts = capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt")
    assert not value.empty and contexts == {}
    monkeypatch.setattr(capture.yf, "__version__", "0.2.99")
    value, contexts = capture.acquire_yahoo_value(StatementTicker(transport, "MSFT"), "quarterly_income_stmt")
    assert not value.empty and contexts == {}


def test_contexts_are_isolated_between_threads(transport):
    transport.barrier = Barrier(2)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda s: capture.acquire_yahoo_value(StatementTicker(transport, s), "quarterly_income_stmt")[1], ["AAPL", "MSFT"]))
    assert [r["quarterly_income_stmt"]["provider_symbol"] for r in results] == ["AAPL", "MSFT"]
    assert capture._ACTIVE_RECEIPTS.get() is None


class InfoTicker:
    ticker = "AAPL"

    def __init__(self, transport, *, duplicate=False):
        self.transport = transport
        self.duplicate = duplicate
        self._info = None

    @property
    def info(self):
        if self._info is None:
            self.transport.result = response({"quoteSummary": {"result": [{"financialData": {"profitMargins": {"raw": -0.1, "fmt": "-10%"}, "returnOnEquity": {"raw": 0.0, "fmt": "0%"}}}]}})
            self.transport.get("https://query2.finance.yahoo.com/v10/finance/quoteSummary/AAPL", params={"crumb": "must-never-be-saved"})
            self.transport.result = response({"quoteResponse": {"result": [{"symbol": "AAPL", **({"profitMargins": -0.1} if self.duplicate else {})}]}})
            self.transport.get("https://query1.finance.yahoo.com/v7/finance/quote?", params={"symbols": "AAPL"})
            self._info = {"profitMargins": -0.1, "returnOnEquity": 0.0}
        return self._info


def test_info_binds_financial_data_origin_and_retains_zero_negative(transport):
    ticker = InfoTicker(transport)
    values, contexts = capture.acquire_yahoo_value(ticker, "info")
    assert set(contexts) == {"profitMargins", "returnOnEquity"}
    assert contexts["returnOnEquity"]["source_payload"]["returnOnEquity"] == 0
    assert "crumb" not in json.dumps(contexts)
    fields = capture.info_evidence({"profit_margin": values["profitMargins"], "roe": 0.0}, contexts, percent_points=False)
    assert fields["profit_margin"]["value"] == -0.1
    assert fields["profit_margin"]["unit"] == "fraction"
    assert fields["roe"]["value"] == 0
    _, retained = capture.acquire_yahoo_value(ticker, "info")
    assert retained == contexts


def test_equal_values_from_competing_info_origins_are_not_proof(transport):
    _, contexts = capture.acquire_yahoo_value(InfoTicker(transport, duplicate=True), "info")
    assert "profitMargins" not in contexts
    assert "returnOnEquity" in contexts


@pytest.mark.parametrize("corruption", ["wrong_symbol", "upstream_error", "wrong_type", "wrong_value", "missing_meta", "wrong_period"])
def test_statement_must_match_exact_receipt(transport, corruption):
    body = statement_body()
    first = body["timeseries"]["result"][0]
    if corruption == "wrong_symbol":
        first["meta"]["symbol"] = ["MSFT"]
    elif corruption == "upstream_error":
        body["timeseries"]["error"] = {"code": "not found"}
    elif corruption == "wrong_type":
        first["meta"]["type"] = ["annualDilutedEPS"]
    elif corruption == "wrong_value":
        first["quarterlyDilutedEPS"][0]["reportedValue"]["raw"] = 55
    elif corruption == "missing_meta":
        del first["meta"]
    else:
        first["quarterlyDilutedEPS"][0]["asOfDate"] = "2025-06-30"
    transport.result = response(body)
    _, contexts = capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt")
    assert contexts == {}


def test_request_identity_cannot_certify_another_symbol(transport):
    _, contexts = capture.acquire_yahoo_value(StatementTicker(transport), "quarterly_income_stmt", symbol="MSFT")
    assert contexts == {}
