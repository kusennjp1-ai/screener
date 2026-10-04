#!/usr/bin/env python3
"""Bounded NVDA/AMD/VIRT Yahoo statement pilot. Never run implicitly.

--dry-run imports the reviewed producers and validates their versions/signatures;
it creates no session, ticker, output directory or provider request.

The only transport customization is an explicit fail-stop subclass of the
vendor's normal curl_cffi Session (same default chrome impersonation). It records
responses and latches HTTP 403/429 before yfinance can switch cookies/retry. Once
latched, every subsequent request fails before transport, including library
attempts hidden by a getter. Endpoints, rate settings and routing are unchanged.
There are no caller retries, alternative sources, database writes or UI writes.
Exit status is 0 for complete capture, 2 for a latched provider stop, and 3 for
an acquisition/proof-capture or financial-processing failure. Semantic proof
outcomes (such as nonpositive growth bases) do not themselves cause failure.

Successful transport archives retain reviewed bounded EPS/revenue source subsets
and full-response SHA-256 hashes, NOT complete HTTP bodies. Original acquisition
contexts and DataFrame cells are persisted before financial calculations. Filing
and publication dates remain unknown. These are current observations, never facts
known at the 2026-10-02 price snapshot. An allowed Yahoo execution environment is
required; this script does not grant network permission.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import importlib.metadata
import inspect
import json
import math
from pathlib import Path
import re
import sys
import time
from urllib.parse import urlsplit

SYMBOLS = ("NVDA", "AMD", "VIRT")
ATTRIBUTES = ("quarterly_income_stmt", "income_stmt")
PRICE_SNAPSHOT_DATE = "2026-10-02"
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024


def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds")


def write_json(path, value):
    data = json.dumps(value, allow_nan=False, ensure_ascii=False, sort_keys=True, indent=2).encode()
    if len(data) > MAX_ARTIFACT_BYTES:
        raise ValueError("Bounded pilot artifact exceeds 2 MiB")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)


def frame_cells(frame):
    if frame is None:
        return None
    def cell(value):
        if hasattr(value, "item"):
            value = value.item()
        if isinstance(value, float) and not math.isfinite(value):
            return {"non_finite_number": "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"}
        if value is None or isinstance(value, (str, bool, int, float)):
            return value
        return {"python_type": type(value).__name__, "representation": str(value)}
    return {"format": "original-yfinance-frame-cells-v1",
            "columns": [str(column) for column in frame.columns],
            "rows": [{"metric": str(label), "values": [cell(v) for v in frame.iloc[i].tolist()]}
                     for i, label in enumerate(frame.index)]}


def imports(repo):
    sys.path.insert(0, str(repo / "backend"))
    import yfinance as yf
    from curl_cffi import requests
    from yfinance.data import YfData
    from app.services import financial_source_capture as capture
    from app.services.financial_source_evidence import validate_envelope
    from app.services.growth_cadence_service import compute_cadence_aware_growth
    from app.services.eps_rating_service import EPSRatingService
    from app.services.static_financial_evidence import build_static_financial_current
    if yf.__version__ != "0.2.66":
        raise RuntimeError("Capture contract requires exactly yfinance 0.2.66")
    for method in (YfData.get, YfData.cache_get):
        if tuple(inspect.signature(method).parameters) != ("self", "url", "params", "timeout"):
            raise RuntimeError("Unsupported Yahoo transport signature")
    return yf, requests, capture, validate_envelope, compute_cadence_aware_growth, EPSRatingService, build_static_financial_current


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    yf, requests, capture, validate, growth_fn, EPSRatingService, proof_fn = imports(args.repo.resolve())
    versions = {name: importlib.metadata.version(name) for name in
                ("yfinance", "curl_cffi", "pandas", "numpy", "requests")}
    plan = {"mode": "dry_run" if args.dry_run else "actual_provider_acquisition",
            "symbols": SYMBOLS, "statement_getters": ATTRIBUTES,
            "maximum_statement_getter_calls": 6,
            "provider_http_count_may_include_normal_anonymous_cookie_and_crumb_requests": True,
            "caller_retries": 0, "stop_http_statuses": [403, 429],
            "source_publication_date": None, "point_in_time": False,
            "price_snapshot_date": PRICE_SNAPSHOT_DATE, "dependency_versions": versions,
            "full_http_bodies_archived": False,
            "output_dir": str(args.output_dir.resolve()),
            "imports_and_supported_transport_signatures": "passed"}
    if args.dry_run:
        print(json.dumps(plan, indent=2))
        return 0

    out = args.output_dir.resolve()
    if out.exists():
        raise RuntimeError("Output directory must be new; existing evidence will not be overwritten")
    out.mkdir(parents=True)
    write_json(out / "plan.json", plan)
    events, acquisitions, frames_by_symbol, acquisition_errors = [], {}, {}, {}
    stop = {"reason": None}
    active = {"symbol": None, "attribute": None}

    class ProviderStopped(RuntimeError):
        pass

    class FailStopSession(requests.Session):
        def request(self, method, url, *request_args, **kwargs):
            if stop["reason"] is not None:
                raise ProviderStopped("Provider work already stopped")
            parsed = urlsplit(str(url))
            # Do not archive query strings, cookies, headers, crumbs or tokens.
            event = {"sequence": len(events) + 1, **active,
                     "endpoint": f"{parsed.scheme}://{parsed.netloc}{parsed.path}",
                     "method": str(method), "started_at": utc_now()}
            try:
                response = super().request(method, url, *request_args, **kwargs)
            except Exception as exc:
                event.update(completed_at=utc_now(), error_type=type(exc).__name__)
                match = re.search(r"\b(403|429)\b", str(exc))
                if match:
                    event["detected_http_status"] = int(match.group(1))
                stop["reason"] = {"kind": "transport_exception", **event}
                events.append(event)
                write_json(out / "transport" / f"{event['sequence']:03d}.json", event)
                raise ProviderStopped("Transport exception; provider work stopped") from None
            event.update(completed_at=utc_now(), http_status=response.status_code)
            if response.status_code in (403, 429):
                stop["reason"] = {"kind": "provider_http_stop", **event}
            # Preserve selected actual response cells before yfinance builds a frame.
            identity = capture._request_identity(url, kwargs.get("params"))
            if identity and identity[0] in ATTRIBUTES and 200 <= response.status_code < 300:
                content = response.content
                if isinstance(content, bytes):
                    event["transport_payload_sha256"] = hashlib.sha256(content).hexdigest()
                    event["transport_payload_bytes"] = len(content)
                    if len(content) <= capture._MAX_CAPTURE_BYTES:
                        try:
                            subset = capture._receipt_source(json.loads(content), identity)
                            if subset is not None and len(json.dumps(subset, allow_nan=False).encode()) <= capture._MAX_SOURCE_SUBSET_BYTES:
                                event["retained_source_subset"] = subset
                                event["source_subset_status"] = "retained"
                            else:
                                event["source_subset_status"] = "unrecognized_or_out_of_bounds"
                        except Exception as exc:
                            event["source_subset_status"] = "invalid_provider_payload"
                            event["source_subset_error_type"] = type(exc).__name__
                    else:
                        event["source_subset_status"] = "response_exceeds_capture_bound"
            events.append(event)
            try:
                write_json(out / "transport" / f"{event['sequence']:03d}.json", event)
            except Exception:
                stop["reason"] = {"kind": "transport_archive_failed", "sequence": event["sequence"]}
                raise ProviderStopped("Failed to preserve transport evidence") from None
            if stop["reason"] is not None:
                raise ProviderStopped(f"HTTP {response.status_code}; provider work stopped")
            return response

    # This is the default session type and fingerprint used by the pinned vendor.
    with FailStopSession(impersonate="chrome") as session:
        for symbol in SYMBOLS:
            if stop["reason"] is not None:
                break
            ticker = yf.Ticker(symbol, session=session)
            frames_by_symbol[symbol], acquisitions[symbol], acquisition_errors[symbol] = {}, {}, {}
            for attribute in ATTRIBUTES:
                if stop["reason"] is not None:
                    break
                active.update(symbol=symbol, attribute=attribute)
                event_start = len(events)
                frame, contexts, failure = None, {}, None
                try:
                    frame, contexts = capture.acquire_yahoo_value(ticker, attribute, symbol=symbol, market="US")
                except Exception as exc:
                    failure = {"kind": "getter_exception", "error_type": type(exc).__name__}
                observed_events = events[event_start:]
                if stop["reason"] is not None:
                    failure = {"kind": "provider_stopped", "reason": stop["reason"]}
                elif frame is None or frame.empty:
                    failure = failure or {"kind": "empty_getter_result", "may_include_swallowed_provider_error": True}
                elif attribute not in contexts:
                    failure = {"kind": "no_transport_bound_context", "value_received_but_unverified": True}
                raw = {"symbol": symbol, "attribute": attribute,
                       "getter_completed_at": utc_now(),
                       "source_publication_date": None, "source_publication_date_status": "unknown",
                       "point_in_time": False, "source_acquisition_contexts": contexts,
                       "original_frame_cells": frame_cells(frame),
                       "transport_events": observed_events, "failure": failure,
                       "full_http_bodies_archived": False}
                write_json(out / "acquisitions" / f"{symbol}-{attribute}.json", raw)
                frames_by_symbol[symbol][attribute] = frame
                acquisitions[symbol].update(contexts)
                if failure:
                    acquisition_errors[symbol][attribute] = failure
                if stop["reason"] is not None:
                    break
                # Fixed pilot pacing. No dynamic rate adjustment or retry.
                time.sleep(1.5)

    # No provider objects/getters are used from this point onward.
    evaluation = datetime.now(timezone.utc)
    summary = {**plan, "current_at_evaluation": evaluation.isoformat(),
               "temporal_semantics": "current observations evaluated now; not known at historical price snapshot",
               "provider_stop": stop["reason"], "results": {}}
    calculator = EPSRatingService()
    for symbol in SYMBOLS:
        if symbol not in frames_by_symbol:
            summary["results"][symbol] = {"status": "not_attempted_after_provider_stop"}
            continue
        frames = frames_by_symbol[symbol]
        try:
            growth = growth_fn(frames.get("quarterly_income_stmt"), market="US", include_source_context=True)
            eps = calculator.calculate_eps_rating_data(frames.get("income_stmt"), frames.get("quarterly_income_stmt"), include_source_context=True)
            source_context = {**growth.pop("_financial_source_context", {}), **eps.pop("_financial_source_context", {})}
            payload = {**growth, **eps, "symbol": symbol, "market": "US"}
            capture.attach_evidence(payload, capture.statement_evidence(payload, source_context, acquisitions[symbol]), symbol=symbol, market="US")
            validate(payload["financial_source_evidence"])
            write_json(out / "envelopes" / f"{symbol}.json", payload)
            history = {}
            for attribute, context in acquisitions[symbol].items():
                rows = context.get("source_payload", {}).get("source_rows", {})
                history[attribute] = {"observed_at": context["observed_at"], "capture_id": context["capture_id"],
                    "source_publication_date": None, "source_publication_date_status": "unknown", "point_in_time": False,
                    "metrics": {key: {**row, "unit": "currency_per_share" if "eps" in key else "currency",
                                      "currency_source": "provider currencyCode"} for key, row in rows.items()}}
            summary["results"][symbol] = {"status": "captured" if acquisitions[symbol] else "unverified_or_unavailable",
                "acquisition_failures": acquisition_errors[symbol], "reported_history": history,
                "financial_current": proof_fn(payload, now=evaluation, as_of_date=PRICE_SNAPSHOT_DATE, market="US"),
                "envelope_file": f"envelopes/{symbol}.json"}
        except Exception as exc:
            summary["results"][symbol] = {"status": "normalization_failed", "error_type": type(exc).__name__,
                "acquisition_failures": acquisition_errors[symbol], "raw_acquisitions_preserved": True}
    write_json(out / "summary.json", summary)
    print(json.dumps({"summary_file": str(out / "summary.json"), "provider_stop": stop["reason"],
                      "statuses": {symbol: item["status"] for symbol, item in summary["results"].items()}}, indent=2))
    if stop["reason"] is not None:
        return 2
    if any(item["status"] != "captured" or item.get("acquisition_failures")
           for item in summary["results"].values()):
        return 3
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
