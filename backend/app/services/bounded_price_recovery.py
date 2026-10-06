"""Local, bounded price proof collection. No database or publication writes.

The transport is injected. Importing this module cannot contact a provider.
Every abort is latched because yfinance can catch per-ticker exceptions.
"""
from __future__ import annotations

from datetime import date, datetime, time as daytime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import threading
import time
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

PROPOSAL_SHA256 = "ccf04ed6343203eb9e3fafd06fb7f468f42d96205457bdf06ff330223b62c01c"
SYMBOLS = ("ET", "SUN", "DDS", "VMRK")
TARGET = date(2026, 10, 5)
CAPTURE_DATE = date(2026, 10, 6)
NY = ZoneInfo("America/New_York")
MAX_REQUESTS = 10
MAX_BODY = 8 * 1024 * 1024
MAX_RAW = 32 * 1024 * 1024
MAX_JSON = 1024 * 1024
# curl_cffi's callback wrapper treats zero as success; only this libcurl
# sentinel aborts transfer immediately when the size/time/cancellation cap hits.
WRITEFUNC_ERROR = 0xFFFFFFFF


class PilotStopped(RuntimeError):
    pass


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def epoch_midnight(day):
    return int(datetime.combine(day, daytime(), NY).timestamp())


def exclusive_end(session):
    return epoch_midnight(session + timedelta(days=1))


def request_bounds(symbol):
    start = date(2024, 10, 6) if symbol == "VMRK" else date(2026, 9, 29)
    return epoch_midnight(start), exclusive_end(TARGET)


def read_pinned_proposal(path):
    raw = Path(path).read_bytes()
    if sha(raw) != PROPOSAL_SHA256:
        raise ValueError("Proposal does not match the reviewed four-symbol envelope")
    return json.loads(raw)


def immutable_write(path, raw, maximum):
    if len(raw) > maximum:
        raise ValueError("Output exceeds its declared size bound")
    with Path(path).open("xb") as handle:
        handle.write(raw)


class CaptureTransport:
    """Guard every session request, including vendor bootstrap/discovery calls."""

    def __init__(self, output, *, rate_gate, clock=lambda: datetime.now(timezone.utc),
                 monotonic=time.monotonic, cancelled=lambda: False, bindings=None):
        self.output = Path(output)
        self.output.mkdir(parents=False, exist_ok=False)
        (self.output / "raw").mkdir()
        (self.output / "receipts").mkdir()
        self.rate_gate, self.clock, self.monotonic = rate_gate, clock, monotonic
        self.cancelled = cancelled
        self.bindings = dict(bindings or {})
        self.started = monotonic()
        self.last_clock = None
        self.stopped = None
        self.calls = 0
        self.raw_bytes = 0
        self.seen = set()
        self.receipts = []
        self.lock = threading.Lock()

    def stop(self, reason):
        self.stopped = self.stopped or reason
        raise PilotStopped(self.stopped)

    def check(self):
        if self.stopped:
            raise PilotStopped(self.stopped)
        if self.cancelled():
            self.stop("cancelled")
        if self.monotonic() - self.started >= 300:
            self.stop("pilot_wall_clock_exhausted")
        now = self.clock()
        if now.tzinfo is None or now.astimezone(timezone.utc).date() != CAPTURE_DATE:
            self.stop("capture_day_or_timezone_changed")
        if self.last_clock is not None and now < self.last_clock:
            self.stop("observation_clock_rolled_back")
        self.last_clock = now
        return now

    def classify(self, method, url, params):
        parsed = urlsplit(url)
        if method.upper() != "GET" or parsed.scheme != "https" or parsed.query or parsed.fragment or parsed.username or parsed.port:
            self.stop("unexpected_transport_target")
        params = dict(params or {})
        # Cookies and crumb remain transient vendor state and never enter proof.
        params.pop("crumb", None)
        if parsed.netloc == "fc.yahoo.com" and parsed.path in ("", "/") and not params:
            return "cookie", None, {}, ("cookie", None)
        if parsed.netloc == "query1.finance.yahoo.com" and parsed.path == "/v1/test/getcrumb" and not params:
            return "crumb", None, {}, ("crumb", None)
        if parsed.netloc not in ("query1.finance.yahoo.com", "query2.finance.yahoo.com"):
            self.stop("unexpected_transport_host")
        prefix = "/v8/finance/chart/"
        symbol = parsed.path.removeprefix(prefix)
        if not parsed.path.startswith(prefix) or symbol not in SYMBOLS:
            self.stop("unexpected_transport_endpoint_or_symbol")
        if params == {"range": "1d", "interval": "1d"}:
            return "metadata_only", symbol, params, ("metadata_only", symbol)
        start, end = request_bounds(symbol)
        expected = {"period1": start, "period2": end, "interval": "1d",
                    "includePrePost": False, "events": "div,splits,capitalGains"}
        if params != expected:
            self.stop("history_request_outside_frozen_bounds")
        return "history", symbol, params, ("history", symbol)

    def request(self, send, method, url, **kwargs):
        if not self.lock.acquire(blocking=False):
            self.stop("concurrent_transport_rejected")
        receipt = None
        try:
            began = self.check()
            if self.calls >= MAX_REQUESTS:
                self.stop("request_budget_exhausted")
            role, symbol, public_params, key = self.classify(method, url, kwargs.get("params"))
            if key in self.seen:
                self.stop("hidden_retry_rejected")
            allowed = {"params", "timeout", "allow_redirects", "expire_after"}
            if set(kwargs) - allowed:
                self.stop("unexpected_transport_options")
            self.rate_gate(self)
            began = self.check()
            self.seen.add(key)
            self.calls += 1
            receipt = {"schema_version": "bounded-price-response-v1", "sequence": self.calls,
                "role": role, "provider_symbol": symbol, "origin_path": url,
                "query": public_params, "request_started_at": began.isoformat(),
                "proposal_sha256": PROPOSAL_SHA256, "bindings": self.bindings, "status": "in_flight"}
            chunks, size = [], 0
            limit = MAX_BODY if symbol else 64 * 1024
            def collect(chunk):
                nonlocal size
                try:
                    self.check()
                    size += len(chunk)
                    if size > limit or (symbol and self.raw_bytes + size > MAX_RAW):
                        self.stopped = "response_size_budget_exhausted"
                        return WRITEFUNC_ERROR
                    chunks.append(bytes(chunk))
                    return len(chunk)
                except PilotStopped:
                    return WRITEFUNC_ERROR
            options = {"params": kwargs.get("params"), "timeout": min(10, 300 - (self.monotonic() - self.started)),
                       "allow_redirects": False, "max_redirects": 0, "stream": False,
                       "content_callback": collect}
            response = send(method, url, **options)
            self.check()
            raw = b"".join(chunks)
            response.content = raw
            status = response.status_code
            receipt.update(status_code=status, response_completed_at=self.check().isoformat())
            if symbol:
                self.raw_bytes += len(raw)
                digest = sha(raw)
                name = f"{self.calls:02d}-{symbol}-{role}-{digest}.json"
                immutable_write(self.output / "raw" / name, raw, MAX_BODY)
                receipt.update(body_sha256=digest, body_bytes=len(raw), raw_path="raw/" + name)
            # fc.yahoo.com's ordinary cookie bootstrap can return 404; it is
            # never price evidence. Every chart error stops before vendor retry.
            if status in (401, 403, 429):
                self.stop(f"provider_denied_{status}")
            if not (200 <= status < 300 or (role == "cookie" and status == 404)):
                self.stop("unexpected_http_status")
            if getattr(response, "history", None):
                self.stop("hidden_redirect_rejected")
            receipt["status"] = "captured" if symbol else "helper_complete_no_body_retained"
            return response
        except BaseException as exc:
            if not self.stopped:
                self.stopped = "cancelled" if isinstance(exc, (KeyboardInterrupt, SystemExit)) else "transport_or_capture_failure"
            if receipt is not None:
                receipt.update(status="aborted", reason=self.stopped)
            raise PilotStopped(self.stopped) from None
        finally:
            try:
                if receipt is not None:
                    self.receipts.append(receipt)
                    immutable_write(self.output / "receipts" / f"{receipt['sequence']:02d}.json", encoded(receipt), 16 * 1024)
            except BaseException:
                self.stopped = self.stopped or "receipt_capture_failed"
                raise PilotStopped(self.stopped) from None
            finally:
                self.lock.release()

    def finish(self, result):
        report = {"schema_version": "bounded-price-pilot-v1", "target_session": TARGET.isoformat(),
                  "publication_authority": False, "stopped": self.stopped, "request_count": self.calls,
                  "raw_bytes": self.raw_bytes, "receipts": self.receipts, **result}
        immutable_write(self.output / "report.json", encoded(report), MAX_JSON)
        return report


def verify_identity_record(record, transition):
    """A separately reviewed mapping is necessary; a matching ticker is not."""
    expected = {"provider_symbol": transition["proposed_provider_symbol"],
                "prior_symbol": transition["protected_prior_symbol"],
                "issuer": transition["issuer"],
                "official_identifiers": transition["official_identifiers"],
                "instrument_classes": transition["instrument_classes"],
                "target_mic": transition["target_mic"],
                "effective_transition": transition["effective_transition"],
                "official_sources": transition["official_sources"]}
    if record.get("review_status") != "approved_for_price_identity_validation":
        raise ValueError("Issuer/class mapping is not reviewed")
    if any(record.get(k) != v for k, v in expected.items()):
        raise ValueError("Issuer/class or dated instrument mapping changed")
    if not record["official_identifiers"].get("cik") or not record["instrument_classes"]:
        raise ValueError("Ticker-only identity cannot authorize price history")
    meta = record.get("provider_metadata") or {}
    for key in ("names", "exchange_names"):
        if not isinstance(meta.get(key), list) or not meta[key] or any(not isinstance(x, str) or not x for x in meta[key]):
            raise ValueError("Reviewed provider identity metadata is missing")
    if meta.get("instrument_type") != "EQUITY":
        raise ValueError("Instrument class is not the reviewed equity/common-unit scope")
    if transition["target_mic"] == "TXSE" and set(meta["exchange_names"]) & {"NYSE", "XNYS", "NYQ", "NYS"}:
        raise ValueError("A TXSE transition cannot retain a stale NYSE provider venue")


def normalize_history(raw, *, transition, identity, is_session):
    verify_identity_record(identity, transition)
    body = json.loads(raw)
    chart = body.get("chart", {})
    result = chart.get("result")
    if chart.get("error") is not None or not isinstance(result, list) or len(result) != 1:
        raise ValueError("Chart payload has an error or ambiguous instrument")
    row, symbol = result[0], transition["proposed_provider_symbol"]
    meta = row.get("meta", {})
    for key, expected in transition["official_identifiers"].items():
        if key in meta and str(meta[key]).zfill(10) != str(expected).zfill(10):
            raise ValueError("Provider instrument identifier contradicts official mapping")
    expected_meta = identity["provider_metadata"]
    if (meta.get("symbol") != symbol or meta.get("currency") != "USD"
            or meta.get("dataGranularity") != "1d"
            or meta.get("exchangeTimezoneName") != "America/New_York"
            or meta.get("instrumentType") != expected_meta["instrument_type"]
            or meta.get("exchangeName") not in expected_meta["exchange_names"]
            or meta.get("longName") not in expected_meta["names"]):
        raise ValueError("Provider issuer/class/venue/currency metadata does not match reviewed mapping")
    times = row.get("timestamp")
    quotes = row.get("indicators", {}).get("quote", [])
    if not isinstance(times, list) or not 0 < len(times) <= 550 or len(quotes) != 1:
        raise ValueError("Missing or oversized history")
    quote = quotes[0]
    fields = ("open", "high", "low", "close", "volume")
    if any(not isinstance(quote.get(k), list) or len(quote[k]) != len(times) for k in fields):
        raise ValueError("Price arrays do not match their timestamps")
    bars = []
    start, end = request_bounds(symbol)
    previous = None
    for i, timestamp in enumerate(times):
        if type(timestamp) is not int or not start <= timestamp < end:
            raise ValueError("Price timestamp is outside the exclusive request boundary")
        session = datetime.fromtimestamp(timestamp, timezone.utc).astimezone(NY).date()
        if session > TARGET or (previous is not None and session <= previous) or not is_session(session):
            raise ValueError("Future, duplicate, unordered or non-session bar")
        previous = session
        values = {key: quote[key][i] for key in fields}
        if any(type(v) not in (int, float) or not math.isfinite(v) for v in values.values()):
            raise ValueError("Missing/nonfinite OHLCV")
        bars.append({"date": session.isoformat(), **values})
    if previous != TARGET:
        raise ValueError("Oct 5 close missing")
    return bars


def validate_history_join(symbol, bars, prior_chart, transition):
    import pandas as pd
    from .cache.price_history_integrity import coherent_history, requires_full_history
    def frame(items):
        return pd.DataFrame(items).rename(columns={x: x.title() for x in ("open", "high", "low", "close", "volume")}).set_index("date")
    recent = frame(bars)
    if not coherent_history(recent):
        raise ValueError("Incoherent provider history or split/adjustment discontinuity")
    if symbol == "VMRK":
        if prior_chart is not None or transition["retained_chart_sha256"] is not None:
            raise ValueError("VMRK cannot splice a legacy EQR chart or scalar")
        return bars
    if prior_chart is None or sha(prior_chart) != transition["retained_chart_sha256"]:
        raise ValueError("Prior chart missing or hash changed")
    prior = json.loads(prior_chart)
    if prior.get("symbol") != symbol or prior.get("as_of_date") != "2026-10-02":
        raise ValueError("Prior chart identity/session changed")
    old = frame(prior["bars"])
    old.index = pd.to_datetime(old.index)
    recent.index = pd.to_datetime(recent.index)
    overlap = old.index.intersection(recent.index)
    required = pd.to_datetime(["2026-09-29", "2026-09-30", "2026-10-01", "2026-10-02"])
    if not all(day in overlap for day in required) or requires_full_history(old, recent):
        raise ValueError("Overlap/adjustment mismatch; separate full-history review required")
    for day in required:
        for key in ("Open", "High", "Low", "Close"):
            if not math.isclose(float(old.loc[day, key]), float(recent.loc[day, key]), rel_tol=1e-5, abs_tol=.0001):
                raise ValueError("Overlap OHLC mismatch; separate full-history review required")
        if old.loc[day, "Volume"] != recent.loc[day, "Volume"]:
            raise ValueError("Overlap volume changed; review provider correction")
    merged = {bar["date"]: bar for bar in prior["bars"]}
    merged.update({bar["date"]: bar for bar in bars})
    return [merged[day] for day in sorted(merged)]
