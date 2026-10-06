"""Prepare or explicitly execute the local four-symbol price recovery pilot.

Default admission is offline. Execution needs --execute and a separately pinned
capture approval for this exact controller. There is no source/database publish.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.util
import importlib.metadata
import json
import math
from pathlib import Path
import signal
import subprocess
import tarfile
import time
import zipfile

from app.services.bounded_price_recovery import (
    CaptureTransport, PilotStopped, SYMBOLS, TARGET, PROPOSAL_SHA256, MAX_JSON,
    encoded, sha, read_pinned_proposal, immutable_write, normalize_history,
    validate_history_join, verify_identity_record,
)

CURL_VERSION = "0.16.3"
CURL_SOURCE_PINS = {
    "curl.py": "5d0bb4f8fd99446c3a99edf145ab935252fad7c3d074c0800921d9e96fc4dd52",
    "requests/session.py": "ff3152f6e1c37078c21f9cca11da1adbed8ce7bbb67d88846597df329b940c55",
    "requests/utils.py": "bb61f6493a70f0524a10d27a74983ef85de92526ad873bc226a55c69ebb749d4",
}


def read_approval(path, expected_sha, proposal):
    raw = Path(path).read_bytes()
    if sha(raw) != expected_sha:
        raise ValueError("Admission document hash changed")
    value = json.loads(raw)
    if value.get("schema_version") != "four-symbol-price-pilot-admission-v1" or value.get("proposal_sha256") != PROPOSAL_SHA256:
        raise ValueError("Admission targets another proposal")
    records = value.get("identity_records", [])
    if len(records) != 4 or {r.get("provider_symbol") for r in records} != set(SYMBOLS):
        raise ValueError("Admission changed the four-instrument cohort")
    if type(value.get("capture_approved")) is not bool:
        raise ValueError("Capture approval must be an explicit boolean")
    # Identity approval is separate from permission to collect quarantined raw
    # observations. No pending identity can authorize normalization or a join.
    for record in records:
        transition = next(t for t in proposal["identity_transitions"] if t["proposed_provider_symbol"] == record["provider_symbol"])
        if record.get("review_status") == "approved_for_price_identity_validation":
            verify_identity_record(record, transition)
    return value


def prior_charts(archive_path, proposal):
    with Path(archive_path).open("rb") as handle:
        if hashlib.file_digest(handle, "sha256").hexdigest() != proposal["evidence"]["prior_release_zip_sha256"]:
            raise ValueError("Prior release archive hash changed")
    required = {t["retained_chart_sha256"]: t["proposed_provider_symbol"]
                for t in proposal["identity_transitions"] if t["retained_chart_sha256"]}
    result = {}
    with zipfile.ZipFile(archive_path) as archive:
        with archive.open("artifact.tar") as handle, tarfile.open(fileobj=handle, mode="r|") as tar:
            for member in tar:
                name = member.name.removeprefix("./")
                if not name.startswith("static-data/verified-charts/") or not name.endswith(".json"):
                    continue
                if not any(name.rsplit("/", 1)[-1].startswith(s + "-") for s in ("ET", "SUN", "DDS")):
                    continue
                if not member.isfile() or member.size > MAX_JSON:
                    raise ValueError("Invalid retained chart entry")
                raw = tar.extractfile(member).read(MAX_JSON + 1)
                symbol = required.get(sha(raw))
                if symbol is None or symbol in result:
                    raise ValueError("Retained chart hash/identity is ambiguous")
                result[symbol] = raw
    if set(result) != {"ET", "SUN", "DDS"}:
        raise ValueError("One of the three prior histories is absent")
    return result


# Use the same Redis keys as the existing rate/circuit controls, but do not use
# their permissive local fallback. Reserve all budgets atomically before egress.
STRICT_RESERVE = """
local function finite(n) return n and n == n and n ~= math.huge and n ~= -math.huge end
local remaining = tonumber(ARGV[1])
if not finite(remaining) or remaining < 0 then return '-3' end
for i=2,#KEYS do
  local interval=tonumber(ARGV[i])
  if not finite(interval) or interval <= 0 or interval > 86400 then return '-3' end
end
local state = redis.call('HGET', KEYS[1], 'state')
if state and state ~= 'closed' then return '-1' end
local t = redis.call('TIME')
local now = tonumber(t[1]) + tonumber(t[2]) / 1000000
local slot = now
for i=2,#KEYS do
  local old=tonumber(redis.call('GET',KEYS[i]) or '0')
  if not finite(old) or old < 0 then return '-3' end
  slot=math.max(slot,old)
end
local wait = slot-now
if wait > remaining then return '-2' end
for i=2,#KEYS do
  local interval=tonumber(ARGV[i])
  redis.call('SET',KEYS[i],tostring(slot+interval),'EX',math.ceil(wait+interval*2+10))
end
return tostring(wait)
"""


class StrictSharedBudget:
    def __init__(self, client, intervals, sleep=time.sleep):
        self.client, self.intervals, self.sleep = client, intervals, sleep

    def __call__(self, guard):
        guard.check()
        keys = ["circuit:yfinance:us", "ratelimit:yfinance", "ratelimit:yfinance:us",
                "ratelimit:yfinance:batch", "ratelimit:yfinance:batch:us"]
        remaining = 300 - (guard.monotonic() - guard.started)
        try:
            self.client.ping()
            delay = float(self.client.eval(STRICT_RESERVE, len(keys), *keys, remaining, *self.intervals))
        except Exception:
            guard.stop("shared_rate_or_circuit_control_unavailable")
        if not math.isfinite(delay) or delay < 0:
            guard.stop("shared_circuit_open_or_wait_exceeds_budget")
        until = guard.monotonic() + delay
        while guard.monotonic() < until:
            guard.check()
            self.sleep(min(.1, until - guard.monotonic()))
        guard.check()
        try:
            state = self.client.hget(keys[0], 'state')
        except Exception:
            guard.stop("shared_rate_or_circuit_control_unavailable")
        if state not in (None, b'closed', 'closed'):
            guard.stop("shared_circuit_open_after_wait")


def live_rate_gate():
    from app.config import settings
    if settings.redis_enabled is not True:
        raise ValueError("Redis controls are disabled; unchanged Static Site cannot run this pilot")
    from app.services.redis_pool import get_redis_client
    from app.services.rate_budget_policy import get_rate_budget_policy
    client = get_redis_client()
    if client is None:
        raise ValueError("Shared provider controls are unavailable")
    policy = get_rate_budget_policy()
    intervals = [max(1., policy.get_rate_interval(provider, market))
                 for provider, market in (("yfinance", None), ("yfinance", "US"),
                                         ("yfinance:batch", None), ("yfinance:batch", "US"))]
    return StrictSharedBudget(client, intervals)


def verify_vendor_sources(proposal):
    spec = importlib.util.find_spec("yfinance")
    if spec is None:
        raise ValueError("pinned_yfinance_unavailable")
    root = Path(spec.origin).parent
    for name, expected in proposal["evidence"]["inspected_vendor_file_sha256"].items():
        if sha((root / name).read_bytes()) != expected:
            raise ValueError("pinned_vendor_source_changed")
    curl_spec = importlib.util.find_spec('curl_cffi')
    if curl_spec is None or importlib.metadata.version('curl_cffi') != CURL_VERSION:
        raise ValueError("reviewed_transport_runtime_unavailable")
    curl_root = Path(curl_spec.origin).parent
    for name, expected in CURL_SOURCE_PINS.items():
        if sha((curl_root / name).read_bytes()) != expected:
            raise ValueError("reviewed_transport_source_changed")


def vendor_download(guard, proposal):
    """The only provider execution route; called exclusively by explicit run."""
    try:
        verify_vendor_sources(proposal)
    except ValueError as exc:
        guard.stop(str(exc))
    import yfinance as yf
    from yfinance import cache
    from yfinance.data import YfData
    from curl_cffi import requests
    if yf.__version__ != "0.2.66" or YfData in type(YfData)._instances:
        guard.stop("vendor_version_or_fresh_process_contract_failed")
    # Keep normal bootstrap state in memory for this process only. A dummy
    # cookie cache would trigger repeated bootstrap calls even within one run.
    # Never read/save cookie state on disk or reuse pre-populated price frames.
    class MemoryCookieCache:
        def __init__(self): self.values = {}
        def lookup(self, key): return self.values.get(key)
        def store(self, key, value): self.values[key] = {"cookie": value}
    cookie_cache = MemoryCookieCache()
    cache.get_cookie_cache = lambda: cookie_cache
    cache.get_tz_cache = lambda: cache._TzCacheDummy()
    class BoundedSession(requests.Session):
        def request(self, method, url, **kwargs):
            return guard.request(super().request, method, url, **kwargs)
    from app.config import settings
    with BoundedSession(impersonate=settings.yfinance_curl_cffi_impersonate, retry=0) as session:
        if session.retry.count != 0:
            guard.stop("transport_retries_not_disabled")
        # No debug vendor logs: cookie/crumb values may appear in them.
        import logging
        logging.getLogger("yfinance").disabled = True
        for group in proposal["groups"]:
            guard.check()
            yf.download(tickers=group["symbols"],
                start=datetime.fromisoformat(group["start_inclusive"]["local"]),
                end=datetime.fromisoformat(group["end_exclusive"]["local"]),
                session=session, **proposal["common_download_options"])
            guard.check()


def admit_captures(guard, proposal, approval, charts, is_session):
    results = []
    for transition in proposal["identity_transitions"]:
        symbol = transition["proposed_provider_symbol"]
        record = next(r for r in approval["identity_records"] if r["provider_symbol"] == symbol)
        receipts = [r for r in guard.receipts if r["provider_symbol"] == symbol and r["role"] == "history" and r["status"] == "captured"]
        try:
            if len(receipts) != 1:
                raise ValueError("No unique captured bounded history response")
            receipt = receipts[0]
            raw = (guard.output / receipt["raw_path"]).read_bytes()
            if sha(raw) != receipt["body_sha256"]:
                raise ValueError("Raw response changed before replay")
            bars = normalize_history(raw, transition=transition, identity=record, is_session=is_session)
            joined = validate_history_join(symbol, bars, charts.get(symbol), transition)
            evidence = {"schema_version": "pilot-price-observation-v1", "provider_symbol": symbol,
                "prior_required_symbol": transition["protected_prior_symbol"], "target_session": TARGET.isoformat(),
                "observed_at": receipt["response_completed_at"], "source_payload_sha256": receipt["body_sha256"],
                "identity_binding": "reviewed_official_mapping_plus_provider_metadata",
                "provider_identifier_limitation": "Chart metadata does not itself certify CIK/class identifiers.",
                "official_identifiers": record["official_identifiers"], "instrument_classes": record["instrument_classes"],
                "financial_identity_reassigned": False, "publication_authority": False,
                "bars": joined, "technical_history_252_available": len(joined) >= 252}
            path = f"observation-{symbol}.json"
            immutable_write(guard.output / path, encoded(evidence), MAX_JSON)
            results.append({"symbol": symbol, "status": "validated_local_observation", "path": path,
                            "sha256": sha(encoded(evidence)), "bar_count": len(joined)})
        except (ValueError, KeyError, TypeError, IndexError) as exc:
            results.append({"symbol": symbol, "status": "quarantined", "reason": str(exc)})
    return results


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("admit", "run"), nargs="?", default="admit")
    parser.add_argument("--proposal", required=True, type=Path)
    parser.add_argument("--admission", required=True, type=Path)
    parser.add_argument("--admission-sha256", required=True)
    parser.add_argument("--prior-release", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args(argv)
    proposal = read_pinned_proposal(args.proposal)
    approval = read_approval(args.admission, args.admission_sha256, proposal)
    charts = prior_charts(args.prior_release, proposal)
    missing = [name for name in ('pandas', 'yfinance', 'curl_cffi', 'redis', 'pydantic', 'pydantic_settings', 'sqlalchemy', 'exchange_calendars')
               if importlib.util.find_spec(name) is None]
    try:
        verify_vendor_sources(proposal)
        vendor_contract = 'verified'
    except (ValueError, OSError, importlib.metadata.PackageNotFoundError) as exc:
        vendor_contract = type(exc).__name__ + ': ' + str(exc)
    summary = {"execution_enabled": False, "capture_approved": approval["capture_approved"],
               "target_session": TARGET.isoformat(), "symbols": list(SYMBOLS), "max_requests": 10,
               "max_retained_bytes": 38 * 1024 * 1024,
               "prior_histories_verified": sorted(charts), "output_must_be_new": str(args.output),
               "missing_runtime_modules": missing, "vendor_source_contract": vendor_contract,
               "required_module_precheck_passed": not missing,
               "identity_admission": {r['provider_symbol']: r.get('review_status') for r in approval['identity_records']},
               "provider_budget_scope": approval.get('provider_budget', {}).get('scope', 'unreviewed'),
               "finite_github_admission": approval.get('github_admission', {}).get('review_status', 'unreviewed'),
               "publication_authority": False}
    if args.command == "admit":
        if args.execute:
            parser.error("admit is offline; --execute is not accepted")
        print(json.dumps(summary)); return 0
    if not args.execute or approval["capture_approved"] is not True:
        parser.error("Provider execution requires --execute and an exact separately approved admission file")
    budget = approval.get('provider_budget', {})
    if (budget.get('review_status') != 'approved_for_ten_request_pilot'
            or budget.get('scope') not in ('existing_shared_redis', 'isolated_ci_job')
            or not isinstance(budget.get('review_note'), str) or not budget['review_note'].strip()):
        parser.error("Provider coordination/isolation scope requires separate review")
    if missing:
        parser.error("Full backend runtime is required before provider execution: " + ', '.join(missing))
    if vendor_contract != 'verified':
        parser.error("Reviewed vendor transport source contract is unavailable")
    controller = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    if approval.get("controller_sha") != controller or subprocess.check_output(["git", "status", "--porcelain"], text=True).strip():
        parser.error("Controller commit is unapproved or the worktree is dirty")
    # All prior reads above are local. Only this explicitly admitted branch can
    # initialize shared controls and the vendor adapter.
    from app.services.market_calendar_service import MarketCalendarService
    from app.services.close_price_contract import CloseSession
    calendar = MarketCalendarService()
    if datetime.now(timezone.utc) < CloseSession.for_us(TARGET, calendar).collect_after:
        parser.error("The requested completed-session collection window has not opened")
    gate = live_rate_gate()
    from app.services.price_pilot_admission import consume_attempt, terminal_record
    claim = consume_attempt(approval, args.admission_sha256)
    guard = CaptureTransport(args.output, rate_gate=gate,
        bindings={"controller_sha": controller, "admission_sha256": args.admission_sha256,
                  "provider_budget_scope": budget['scope'], "cross_job_global_budget_proven": False,
                  "attempt_claim_sha256": sha(encoded(claim)), "github_attempt": claim['context']})
    immutable_write(guard.output / 'price-pilot-claim.json', encoded(claim), 64 * 1024)
    previous = {}
    def cancelled(signum, frame):
        guard.stop("cancelled")
    try:
        for signum in (signal.SIGINT, signal.SIGTERM):
            previous[signum] = signal.signal(signum, cancelled)
        vendor_download(guard, proposal)
        results = admit_captures(guard, proposal, approval, charts,
            lambda day: calendar.session_close("US", day) is not None)
        outcome = {"observations": results}
    except BaseException:
        guard.stopped = guard.stopped or "pilot_execution_aborted"
        outcome = {"observations": [], "status": "aborted"}
    finally:
        for signum, handler in previous.items():
            signal.signal(signum, handler)
    report = guard.finish({**outcome, 'attempt_claim_sha256': sha(encoded(claim)), 'admission_consumed': True})
    immutable_write(guard.output / 'price-pilot-attempt.json', encoded(terminal_record(claim, report)), 64 * 1024)
    print(json.dumps({"request_count": report["request_count"], "stopped": report["stopped"],
                      "output": str(args.output), "publication_authority": False}))
    return 2 if report["stopped"] or any(r["status"] == "quarantined" for r in report["observations"]) else 0


if __name__ == "__main__":
    raise SystemExit(main())
