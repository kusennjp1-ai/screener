"""Offline checks of the bounded pilot against real yfinance 0.2.66.

All HTTP transport is replaced with synthetic responses. The low-level curl
perform and socket connect functions are also blocked. No provider is contacted.
"""
from datetime import datetime, timezone
from contextlib import ExitStack, contextmanager, redirect_stdout
import importlib.util
from io import StringIO
import json
import os
from pathlib import Path
import socket
import sys
from tempfile import TemporaryDirectory
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import curl_cffi
from curl_cffi import requests
import pandas as pd
import yfinance as yf
from yfinance.data import YfData

ROOT = Path(__file__).resolve().parent
REPO = (Path(os.environ["PILOT_REPO"]).resolve() if os.environ.get("PILOT_REPO")
        else next((p for p in [Path.cwd(), *ROOT.parents]
                   if (p / "backend/app/services/financial_source_capture.py").is_file()), None))
if REPO is None:
    raise RuntimeError("Run from the repository root or set PILOT_REPO to its path")
sys.path.insert(0, str(REPO / "backend"))
from app.services import financial_source_capture as capture
from app.services.financial_source_evidence import FINANCIAL_FIELDS, validate_envelope
from app.services.static_financial_evidence import build_static_financial_current

spec = importlib.util.spec_from_file_location("pilot_actual_sources", ROOT / "pilot_actual_sources.py")
pilot = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)
OBSERVED = datetime(2026, 10, 4, 10, 0, 0, tzinfo=timezone.utc)
EVALUATED = datetime(2026, 10, 4, 10, 1, 0, tzinfo=timezone.utc)


def body(symbol, attribute):
    annual = attribute == "income_stmt"
    prefix = "annual" if annual else "quarterly"
    periods = (["2025-12-31", "2024-12-31", "2023-12-31", "2022-12-31", "2021-12-31"]
               if annual else ["2026-06-30", "2026-03-31", "2025-12-31", "2025-09-30", "2025-06-30", "2025-03-31"])
    eps = [5., 4., 3., 2., 1.] if annual else [6., 5., 4., 3., 2., 1.]
    return {"timeseries": {"error": None, "result": [
        {"meta": {"symbol": [symbol], "type": [prefix + metric]},
         "timestamp": [int(pd.Timestamp(period, tz="UTC").timestamp()) for period in periods],
         prefix + metric: [{"asOfDate": period, "currencyCode": "USD", "reportedValue": {"raw": value}}
                           for period, value in zip(periods, values)]}
        for metric, values in [("DilutedEPS", eps), ("TotalRevenue", [v * 100 for v in eps])]
    ]}}


@contextmanager
def offline(monkeypatch, tmp_path):
    state = {"status": 200, "calls": [], "bodies": [], "constructed_symbols": []}

    def forbidden(*args, **kwargs):
        raise AssertionError("Network is forbidden in the offline pilot tests")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    monkeypatch.setattr(curl_cffi.Curl, "perform", forbidden)
    # Avoid ordinary anonymous cookie acquisition while keeping the vendor's
    # real statement request, parsing, DataFrame and producer-capture behavior.
    monkeypatch.setattr(YfData, "_get_cookie_and_crumb", lambda self, *a, **k: ("synthetic-crumb", "basic"))

    def transport(self, method, url, *args, **kwargs):
        identity = capture._request_identity(url, kwargs.get("params"))
        assert identity is not None and identity[0] in pilot.ATTRIBUTES
        state["calls"].append(identity)
        response_body = body(identity[1], identity[0]) if state["status"] == 200 else {"error": "synthetic denial"}
        state["bodies"].append(response_body)
        text = json.dumps(response_body)
        return SimpleNamespace(status_code=state["status"], url=url, text=text,
                               content=text.encode(), json=lambda: json.loads(text),
                               raise_for_status=lambda: None)

    monkeypatch.setattr(requests.Session, "request", transport)
    original_ticker = yf.Ticker

    def ticker(symbol, **kwargs):
        state["constructed_symbols"].append(symbol)
        return original_ticker(symbol, **kwargs)

    monkeypatch.setattr(yf, "Ticker", ticker)
    monkeypatch.setattr(pilot.time, "sleep", lambda *a: None)
    monkeypatch.setattr(capture, "_utc_now", lambda: OBSERVED)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return EVALUATED if tz is not None else EVALUATED.replace(tzinfo=None)

    monkeypatch.setattr(pilot, "datetime", Clock)
    YfData().cache_get.cache_clear()
    state["out"] = tmp_path / "actual-output"

    def run(*extra):
        monkeypatch.setattr(sys, "argv", [str(ROOT / "pilot_actual_sources.py"), "--repo", str(REPO),
                                         "--output-dir", str(state["out"]), *extra])
        return pilot.main()

    state["run"] = run
    yield state
    YfData().cache_get.cache_clear()


def read(path):
    return json.loads(path.read_text())


def test_dry_run_never_constructs_provider_or_output(offline):
    output = StringIO()
    with redirect_stdout(output):
        assert offline["run"]("--dry-run") == 0
    plan = json.loads(output.getvalue())
    assert plan["symbols"] == ["NVDA", "AMD", "VIRT"]
    assert plan["maximum_statement_getter_calls"] == 6
    assert plan["imports_and_supported_transport_signatures"] == "passed"
    assert offline["calls"] == offline["constructed_symbols"] == []
    assert not offline["out"].exists()


def test_denial_stops_transport_despite_swallowed_getter_and_second_attempt(offline, monkeypatch, status):
    offline["status"] = status
    acquire = capture.acquire_yahoo_value
    swallowed, blocked_attempts = [], []

    def getter_that_swallows_and_retries(ticker, attribute, **kwargs):
        try:
            frame, contexts = acquire(ticker, attribute, **kwargs)
            assert frame.empty and not contexts
            swallowed.append("getter_returned_empty_after_denial")
        except Exception as exc:
            swallowed.append(type(exc).__name__)
        # Deliberately simulate a library getter swallowing the first failure
        # and attempting another request. The pilot must reject before transport.
        try:
            ticker.session.get("https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries/NVDA?type=quarterlyTotalRevenue,quarterlyDilutedEPS")
        except Exception as exc:
            blocked_attempts.append(type(exc).__name__)
        return pd.DataFrame(), {}

    monkeypatch.setattr(capture, "acquire_yahoo_value", getter_that_swallows_and_retries)
    assert offline["run"]() == 2
    assert swallowed in (["ProviderStopped"], ["getter_returned_empty_after_denial"])
    assert blocked_attempts == ["ProviderStopped"]
    assert len(offline["calls"]) == 1
    assert offline["constructed_symbols"] == ["NVDA"]
    summary = read(offline["out"] / "summary.json")
    assert summary["provider_stop"]["http_status"] == status
    assert summary["results"]["AMD"]["status"] == "not_attempted_after_provider_stop"
    assert summary["results"]["VIRT"]["status"] == "not_attempted_after_provider_stop"
    raw = read(offline["out"] / "acquisitions/NVDA-quarterly_income_stmt.json")
    assert raw["failure"]["kind"] == "provider_stopped"
    assert raw["failure"]["reason"]["http_status"] == status
    assert raw["source_acquisition_contexts"] == {}
    assert len(list((offline["out"] / "transport").glob("*.json"))) == 1
    assert not (offline["out"] / "acquisitions/NVDA-income_stmt.json").exists()


def test_raw_source_acquisitions_survive_deliberately_failed_normalization(offline, monkeypatch):
    imports = pilot.imports
    failures = []

    def failing_growth(*args, **kwargs):
        # All acquisition persistence must precede every financial calculation.
        for symbol in pilot.SYMBOLS:
            for attribute in pilot.ATTRIBUTES:
                raw = read(offline["out"] / "acquisitions" / f"{symbol}-{attribute}.json")
                context = raw["source_acquisition_contexts"][attribute]
                assert raw["original_frame_cells"]["rows"]
                assert context["observed_at"] == "2026-10-04T10:00:00.000Z"
                assert context["source_payload"]["source_rows"]["dilutedeps"]["currencies"] == ["USD"]
                assert raw["transport_events"][0]["retained_source_subset"]["rows"]["totalrevenue"]["values"]
                assert raw["transport_events"][0]["transport_payload_sha256"] == context["transport_payload_sha256"]
        failures.append("intentional_normalization_failure")
        raise ValueError("synthetic normalization failure after preservation")

    def replaced_imports(repo):
        components = list(imports(repo))
        components[4] = failing_growth
        return tuple(components)

    monkeypatch.setattr(pilot, "imports", replaced_imports)
    assert offline["run"]() == 3
    assert len(offline["calls"]) == 6
    assert len(failures) == 3
    summary = read(offline["out"] / "summary.json")
    assert all(item["status"] == "normalization_failed" and item["raw_acquisitions_preserved"] for item in summary["results"].values())
    assert len(list((offline["out"] / "acquisitions").glob("*.json"))) == 6
    assert len(list((offline["out"] / "transport").glob("*.json"))) == 6
    assert not (offline["out"] / "envelopes").exists()


def test_success_preserves_raw_cells_units_and_current_not_historical_timing(offline):
    assert offline["run"]() == 0
    summary = read(offline["out"] / "summary.json")
    assert len(offline["calls"]) == 6
    assert summary["current_at_evaluation"] == EVALUATED.isoformat()
    assert summary["price_snapshot_date"] == "2026-10-02"
    assert summary["source_publication_date"] is None
    assert summary["point_in_time"] is False
    assert summary["full_http_bodies_archived"] is False
    for symbol in pilot.SYMBOLS:
        result = summary["results"][symbol]
        assert result["status"] == "captured"
        assert result["acquisition_failures"] == {}
        payload = read(offline["out"] / result["envelope_file"])
        envelope = validate_envelope(payload["financial_source_evidence"])
        assert len(envelope["captures"]) == 2
        assert len(result["financial_current"]["p"]) == 7
        for history in result["reported_history"].values():
            assert history["source_publication_date"] is None
            assert history["source_publication_date_status"] == "unknown"
            assert history["point_in_time"] is False
            assert history["observed_at"] == "2026-10-04T10:00:00.000Z"
            assert history["metrics"]["dilutedeps"]["unit"] == "currency_per_share"
            assert history["metrics"]["totalrevenue"]["unit"] == "currency"
            assert history["metrics"]["dilutedeps"]["currencies"] == ["USD"]
        for record in envelope["fields"].values():
            if record["provenance_kind"] == "observed":
                assert record["observed_at"] == "2026-10-04T10:00:00.000Z"
                assert record["unit"] == "percent_points"
                assert record["period_end"] <= "2026-10-02"
                assert record["source_inputs"]
        historical = build_static_financial_current(payload, now="2026-10-02T23:59:59Z", as_of_date="2026-10-02", market="US")
        assert historical["p"] == {}
        for field in ("eps_growth_qq", "sales_growth_qq", "eps_growth_yy", "sales_growth_yy", "eps_5yr_cagr", "eps_q1_yoy", "eps_q2_yoy"):
            assert historical["r"][FINANCIAL_FIELDS.index(field)] == "6"  # future_source_timestamp
    # The transport archive contains only sanitized endpoints, never the
    # synthetic cookie/crumb values or complete response bodies.
    for path in (offline["out"] / "transport").glob("*.json"):
        assert "synthetic-crumb" not in path.read_text()
        event = read(path)
        assert "?" not in event["endpoint"]
        assert "content" not in event and "body" not in event
        assert event["source_subset_status"] == "retained"


class Patches:
    def __init__(self, stack):
        self.stack = stack

    def setattr(self, target, name, value):
        self.stack.enter_context(patch.object(target, name, value))


class TestPilotActualSources(unittest.TestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.monkeypatch = Patches(self.stack)
        directory = self.stack.enter_context(TemporaryDirectory(prefix="offline-financial-pilot-"))
        self.offline = self.stack.enter_context(offline(self.monkeypatch, Path(directory)))
        self.stack.enter_context(redirect_stdout(StringIO()))

    def test_dry_run(self):
        test_dry_run_never_constructs_provider_or_output(self.offline)

    def test_403_latches_before_any_further_transport(self):
        test_denial_stops_transport_despite_swallowed_getter_and_second_attempt(self.offline, self.monkeypatch, 403)

    def test_429_latches_before_any_further_transport(self):
        test_denial_stops_transport_despite_swallowed_getter_and_second_attempt(self.offline, self.monkeypatch, 429)

    def test_normalization_failure_preserves_sources_and_exits_three(self):
        test_raw_source_acquisitions_survive_deliberately_failed_normalization(self.offline, self.monkeypatch)

    def test_current_and_historical_timing(self):
        test_success_preserves_raw_cells_units_and_current_not_historical_timing(self.offline)

    def test_partial_acquisition_missing_receipt_exits_three(self):
        acquire = capture.acquire_yahoo_value

        def missing_annual_receipt(ticker, attribute, **kwargs):
            frame, contexts = acquire(ticker, attribute, **kwargs)
            return frame, {} if attribute == "income_stmt" else contexts

        self.monkeypatch.setattr(capture, "acquire_yahoo_value", missing_annual_receipt)
        assert self.offline["run"]() == 3
        assert len(self.offline["calls"]) == 6
        summary = read(self.offline["out"] / "summary.json")
        for symbol in pilot.SYMBOLS:
            item = summary["results"][symbol]
            assert item["status"] == "captured"  # Partial capture is retained.
            assert item["acquisition_failures"]["income_stmt"]["kind"] == "no_transport_bound_context"
            assert len(item["financial_current"]["p"]) == 6
            raw = read(self.offline["out"] / "acquisitions" / f"{symbol}-income_stmt.json")
            assert raw["original_frame_cells"]["rows"]
            assert raw["source_acquisition_contexts"] == {}


if __name__ == "__main__":
    unittest.main()
