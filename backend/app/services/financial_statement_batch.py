"""Bounded, artifact-only Yahoo statement acquisition and current projections.

The CLI is an executor for an explicitly bound plan, never a universe selector.
It preserves transport subsets, original frames and receipts before arithmetic,
then commits one result per symbol. Resume explicitly trusts a hash-bound cache
manifest; no filesystem/cache-write clock is an acquisition timestamp.
"""
from __future__ import annotations

from collections import Counter
from contextlib import ExitStack
from datetime import date, datetime, timezone
import hashlib
import inspect
import json
import math
from pathlib import Path
import re
import time
from urllib.parse import urlsplit
from uuid import uuid4

PLAN_SCHEMA = "financial-statement-batch-plan-v1"
CACHE_SCHEMA = "financial-statement-cache-v1"
ATTRIBUTES = ("quarterly_income_stmt", "income_stmt")
MAX_BATCH = 200
MAX_ARTIFACT_BYTES = 2 * 1024 * 1024
MAX_BASE_BYTES = 64 * 1024 * 1024
PACING_SECONDS = 1.5
DEFAULT_ACQUISITION_BUDGET_SECONDS = 18 * 60
DEFAULT_MAX_TRANSPORT_REQUESTS = 1000
MAX_AGE_SECONDS = {"quarterly_income_stmt": 7 * 86400, "income_stmt": 72 * 3600}
PERIOD_MAX_AGE_DAYS = {"quarterly_income_stmt": 190, "income_stmt": 550}


class InvalidPlan(ValueError):
    pass


class InvalidCache(ValueError):
    pass


class ProviderStopped(RuntimeError):
    pass


def utc_now():
    return datetime.now(timezone.utc)


def timestamp(value):
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clock(value):
    from .financial_source_evidence import source_timestamp
    parsed = source_timestamp(value)
    if parsed is None:
        raise ValueError("An explicit RFC3339 timestamp is required")
    return parsed


def day(value):
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise ValueError("An ISO calendar date is required")
    return date.fromisoformat(value)


def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()


def _json_bytes(value):
    return json.dumps(value, allow_nan=False, ensure_ascii=False, sort_keys=True, indent=2).encode()


def write_json(path, value):
    return write_bytes(path, _json_bytes(value))


def write_bytes(path, data):
    if len(data) > MAX_ARTIFACT_BYTES:
        raise ValueError("Bounded statement artifact exceeds 2 MiB")
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + ".tmp")
    temporary.write_bytes(data)
    temporary.replace(path)
    return digest_bytes(data)


def _pairs(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON object key")
        result[key] = value
    return result


def read_json(path, maximum=MAX_ARTIFACT_BYTES):
    if path.stat().st_size > maximum:
        raise ValueError("Input exceeds artifact bound")
    data = path.read_bytes()
    return json.loads(data, object_pairs_hook=_pairs, parse_constant=lambda _: (_ for _ in ()).throw(ValueError("Nonfinite JSON"))), data


def canonical_symbol(symbol):
    # Yahoo US share classes use BRK-B, not BRK.B; foreign suffixes are excluded.
    return (isinstance(symbol, str)
            and bool(re.fullmatch(r"[A-Z][A-Z0-9]{0,14}(?:-[A-Z0-9]{1,4})?", symbol))
            and not re.fullmatch(r"[A-Z]{2}[A-Z0-9]{9}[0-9]", symbol))


def _symbols(value, *, maximum):
    if (not isinstance(value, list) or not 1 <= len(value) <= maximum
            or any(not canonical_symbol(symbol) for symbol in value)
            or len(set(value)) != len(value)):
        raise InvalidPlan("Symbols must be unique canonical US symbols within the bound")
    return value


def validate_plan(plan, base_bytes):
    """Validate all authorization/identity boundaries before any provider exists.

    Base input is the explicit original research artifact with as_of_date and
    rows (or results) containing symbol and market=US. A top-level market=US is
    also accepted when individual rows do not declare another market.
    """
    try:
        if not isinstance(base_bytes, bytes) or len(base_bytes) > MAX_BASE_BYTES:
            raise InvalidPlan("Base artifact bytes exceed the bound")
        if not isinstance(plan, dict) or plan.get("schema_version") != PLAN_SCHEMA:
            raise InvalidPlan("Unsupported statement plan")
        evaluated, as_of = clock(plan.get("evaluation_time")), day(plan.get("source_data_as_of"))
        required_through = clock(plan.get("required_valid_through", plan.get("evaluation_time")))
        if required_through < evaluated:
            raise InvalidPlan("Required validity precedes plan evaluation")
        if as_of > evaluated.date():
            raise InvalidPlan("Source as-of is after plan evaluation")
        cohort = plan.get("verified_us_cohort")
        if not isinstance(cohort, dict):
            raise InvalidPlan("A verified US cohort is required")
        symbols = _symbols(cohort.get("symbols"), maximum=20000)
        sha = cohort.get("base_artifact_sha256")
        if not isinstance(sha, str) or not re.fullmatch(r"[a-f0-9]{64}", sha) or digest_bytes(base_bytes) != sha:
            raise InvalidPlan("Base artifact digest mismatch")
        base = json.loads(base_bytes, object_pairs_hook=_pairs)
        if not isinstance(base, dict) or base.get("as_of_date") != as_of.isoformat():
            raise InvalidPlan("Base artifact as-of mismatch")
        rows = base.get("rows", base.get("results"))
        if not isinstance(rows, list):
            raise InvalidPlan("Base artifact must contain explicit security rows")
        seen, verified = set(), set()
        for row in rows:
            if not isinstance(row, dict):
                raise InvalidPlan("Malformed base security row")
            symbol = row.get("symbol")
            if not isinstance(symbol, str) or symbol in seen:
                raise InvalidPlan("Duplicate or malformed base security identity")
            seen.add(symbol)
            if canonical_symbol(symbol) and row.get("market", base.get("market")) == "US":
                verified.add(symbol)
        if not set(symbols) <= verified:
            raise InvalidPlan("Cohort contains an unverified US security")
        allowed = _symbols(plan.get("batch_allowlist"), maximum=MAX_BATCH)
        if not set(allowed) <= set(symbols):
            raise InvalidPlan("Batch allowlist exceeds verified cohort")
        selected = plan.get("selected")
        if not isinstance(selected, list) or not 1 <= len(selected) <= MAX_BATCH:
            raise InvalidPlan("Selected batch must contain 1 to 200 securities")
        selected_symbols = []
        for item in selected:
            if (not isinstance(item, dict) or not {"symbol", "attributes"} <= set(item)
                    or set(item) - {"symbol", "attributes", "targets"}):
                raise InvalidPlan("Malformed selected work item")
            selected_symbols.append(item["symbol"])
            attrs = item["attributes"]
            if (not isinstance(attrs, list) or not attrs
                    or attrs != [attribute for attribute in ATTRIBUTES if attribute in attrs]):
                raise InvalidPlan("Only the two ordered statement attributes are allowed")
            targets = item.get("targets", [])
            if (not isinstance(targets, list)
                    or targets != [target for target in ("eps", "sales", "annual_history") if target in targets]):
                raise InvalidPlan("Malformed required-validity targets")
            if "annual_history" in targets and attrs != list(ATTRIBUTES):
                raise InvalidPlan("Annual history requires both statement attributes")
            minimum_ttl = min(72 * 3600 if "annual_history" in targets else MAX_AGE_SECONDS[attribute] for attribute in attrs)
            if (required_through-evaluated).total_seconds() > minimum_ttl:
                raise InvalidPlan("Required validity exceeds the selected source policy")
        _symbols(selected_symbols, maximum=MAX_BATCH)
        if not set(selected_symbols) <= set(allowed):
            raise InvalidPlan("Selected symbol is outside approved batch")
        return plan
    except (KeyError, TypeError, OverflowError, ValueError) as exc:
        if isinstance(exc, InvalidPlan):
            raise
        raise InvalidPlan("Malformed statement plan or base identity") from None


def runtime():
    # Imports are lazy. Plan/cache rejection must never construct a provider.
    import yfinance as yf
    from curl_cffi import requests
    from yfinance.data import YfData
    from . import financial_source_capture as capture
    from .financial_source_evidence import validate_envelope
    from .growth_cadence_service import compute_cadence_aware_growth
    from .eps_rating_service import EPSRatingService
    from .static_financial_evidence import build_static_financial_current
    if yf.__version__ != "0.2.66":
        raise RuntimeError("Statement capture requires exactly yfinance 0.2.66")
    for method in (YfData.get, YfData.cache_get):
        if tuple(inspect.signature(method).parameters) != ("self", "url", "params", "timeout"):
            raise RuntimeError("Unsupported Yahoo transport signature")
    return yf, requests, capture, validate_envelope, compute_cadence_aware_growth, EPSRatingService, build_static_financial_current


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


def restore_frame(raw):
    import pandas as pd
    if not isinstance(raw, dict) or raw.get("format") != "original-yfinance-frame-cells-v1":
        raise InvalidCache("Missing original frame cells")
    columns, rows = raw.get("columns"), raw.get("rows")
    if not isinstance(columns, list) or not 1 <= len(columns) <= 64 or not isinstance(rows, list) or len(rows) > 500:
        raise InvalidCache("Malformed original frame")
    values, labels = [], []
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("metric"), str) or not isinstance(row.get("values"), list) or len(row["values"]) != len(columns):
            raise InvalidCache("Malformed original frame row")
        cells = []
        for value in row["values"]:
            if isinstance(value, dict):
                if set(value) != {"non_finite_number"} or value["non_finite_number"] not in {"NaN", "Infinity", "-Infinity"}:
                    raise InvalidCache("Unsupported original frame cell")
                value = float(value["non_finite_number"])
            elif value is not None and not isinstance(value, (str, bool, int, float)):
                raise InvalidCache("Unsupported original frame cell")
            cells.append(value)
        labels.append(row["metric"])
        values.append(cells)
    try:
        return pd.DataFrame(values, index=labels, columns=[pd.Timestamp(column) for column in columns])
    except (TypeError, ValueError):
        raise InvalidCache("Invalid original frame columns") from None


def validate_acquisition(raw, symbol, attribute, *, now, as_of):
    """Return (frame, context, reuse_reason); integrity failures are fatal.

    A valid old receipt may be stale; that is an ordinary refetch, not corruption.
    Cache hits retain the receipt, frame and source bytes without rewriting time.
    """
    from . import financial_source_capture as capture
    from .financial_source_evidence import _digest
    from .static_financial_evidence import _period
    try:
        if not isinstance(raw, dict):
            raise InvalidCache("Malformed acquisition artifact")
        if raw.get("symbol") != symbol or raw.get("attribute") != attribute or raw.get("failure") is not None:
            raise InvalidCache("Acquisition identity or success mismatch")
        contexts = raw.get("source_acquisition_contexts")
        if not isinstance(contexts, dict) or set(contexts) != {attribute}:
            raise InvalidCache("Missing original acquisition context")
        context = contexts[attribute]
        expected = {"symbol": symbol, "provider_symbol": symbol, "market": "US", "source": "yfinance",
                    "producer": f"yfinance.{attribute}/transport-capture-v1", "raw_payload_availability": "retained_normalized_subset"}
        if any(context.get(key) != value for key, value in expected.items()) or not context.get("capture_id"):
            raise InvalidCache("Acquisition context identity mismatch")
        source = context.get("source_payload")
        if not isinstance(source, dict) or context.get("raw_payload_sha256") != _digest(source):
            raise InvalidCache("Source subset digest mismatch")
        transport_hash = context.get("transport_payload_sha256")
        if not isinstance(transport_hash, str) or not re.fullmatch(r"[a-f0-9]{64}", transport_hash):
            raise InvalidCache("Missing transport digest")
        observed = clock(context.get("observed_at"))
        completed = clock(raw.get("getter_completed_at"))
        if observed > completed:
            raise InvalidCache("Source observation follows getter completion")
        events = raw.get("transport_events")
        matches = [event for event in events if isinstance(event, dict)
                   and event.get("transport_payload_sha256") == transport_hash
                   and event.get("symbol") == symbol and event.get("attribute") == attribute
                   and isinstance(event.get("http_status"), int) and 200 <= event["http_status"] < 300]
        if len(matches) != 1:
            raise InvalidCache("Original transport receipt is missing or ambiguous")
        event = matches[0]
        if (event.get("retained_source_subset") != {"columns": source.get("columns"), "rows": source.get("source_rows")}
                or clock(event.get("started_at")) > observed):
            raise InvalidCache("Transport subset mismatch")
        frame = restore_frame(raw.get("original_frame_cells"))
        subset = capture._statement_subset(frame)
        if subset is None or source != {**subset, "source_rows": source.get("source_rows")} or not capture._statement_matches_source(subset, event["retained_source_subset"]):
            raise InvalidCache("Original frame does not match captured source")
        periods = [_period(column) for column in source.get("columns", [])]
        if not periods or any(period is None for period in periods) or len(set(periods)) != len(periods) or periods != sorted(periods, reverse=True):
            raise InvalidCache("Malformed reporting periods")
        if any(period > as_of or period > observed.date() or period > now.date() for period in periods):
            raise InvalidCache("Reporting period exceeds source/evaluation/as-of identity")
        gaps = (345, 385) if attribute == "income_stmt" else (70, 130)
        if any(not gaps[0] <= (a-b).days <= gaps[1] for a, b in zip(periods, periods[1:])):
            return frame, context, "reporting_period_gap"
        if observed > now:
            return frame, context, "future_source_timestamp"
        if (now - observed).total_seconds() > MAX_AGE_SECONDS[attribute]:
            return frame, context, "stale_source"
        if max((as_of-periods[0]).days, (now.date()-periods[0]).days) > PERIOD_MAX_AGE_DAYS[attribute]:
            return frame, context, "stale_reporting_period"
        return frame, context, "current"
    except (KeyError, TypeError, ValueError, OverflowError) as exc:
        if isinstance(exc, InvalidCache):
            raise
        raise InvalidCache("Malformed original acquisition") from None


def load_cache(manifest_path, expected_sha256, plan, *, now):
    if manifest_path is None:
        if expected_sha256 is not None:
            raise InvalidCache("Cache digest supplied without manifest")
        return {}
    manifest_path = Path(manifest_path)
    document, data = read_json(manifest_path)
    if not isinstance(document, dict):
        raise InvalidCache("Malformed cache manifest")
    if not isinstance(expected_sha256, str) or digest_bytes(data) != expected_sha256:
        raise InvalidCache("Trusted cache manifest digest mismatch")
    def origin_binding(value):
        if (not isinstance(value, dict) or set(value) != {"base_artifact_sha256", "source_data_as_of"}
                or not isinstance(value["base_artifact_sha256"], str)
                or not re.fullmatch(r"[a-f0-9]{64}", value["base_artifact_sha256"])):
            raise InvalidCache("Malformed original cache base identity")
        try:
            day(value["source_data_as_of"])
        except (ValueError, TypeError):
            raise InvalidCache("Malformed original cache as-of identity") from None
        return value
    if document.get("schema_version") != CACHE_SCHEMA:
        raise InvalidCache("Unsupported original cache schema")
    binding = origin_binding(document.get("binding"))
    entries = document.get("acquisitions")
    if not isinstance(entries, dict) or len(entries) > MAX_BATCH * 2:
        raise InvalidCache("Malformed cache acquisition index")
    selected = {item["symbol"] for item in plan["selected"]}
    result = {}
    for key, entry in entries.items():
        if not isinstance(entry, dict):
            raise InvalidCache("Malformed cache entry")
        symbol, attribute = entry.get("symbol"), entry.get("attribute")
        if not canonical_symbol(symbol) or attribute not in ATTRIBUTES or key != f"{symbol}/{attribute}":
            raise InvalidCache("Malformed cache entry identity")
        if symbol not in selected:
            continue
        relative = entry.get("file")
        if not isinstance(relative, str) or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise InvalidCache("Unsafe cache artifact path")
        path = manifest_path.parent / relative
        if not path.resolve().is_relative_to(manifest_path.parent.resolve()):
            raise InvalidCache("Cache path escapes its artifact directory")
        raw, content = read_json(path)
        if digest_bytes(content) != entry.get("sha256"):
            raise InvalidCache("Cached acquisition file digest mismatch")
        origin = origin_binding(entry.get("origin_binding", binding))
        # Original receipt validity and the new evaluation are separate checks.
        # A new price snapshot does not create a new acquisition clock.
        validate_acquisition(raw, symbol, attribute, now=now, as_of=day(origin["source_data_as_of"]))
        frame, context, reason = validate_acquisition(raw, symbol, attribute, now=now, as_of=day(plan["source_data_as_of"]))
        if entry.get("capture_id") != context["capture_id"] or entry.get("observed_at") != context["observed_at"]:
            raise InvalidCache("Cache index does not bind original receipt")
        result[(symbol, attribute)] = {"raw": raw, "bytes": content, "frame": frame, "context": context, "reason": reason, "origin_binding": origin}
    return result




def required_validity_state(raw, symbol, attribute, item, plan, *, now):
    """Evaluate explicit selected maintenance intent using original clocks."""
    selected = attribute in item["attributes"]
    horizon = max(now, clock(plan.get("required_valid_through", plan["evaluation_time"]))) if selected else now
    _, context, state = validate_acquisition(raw, symbol, attribute, now=horizon,
                                             as_of=day(plan["source_data_as_of"]))
    ttl = 72 * 3600 if selected and "annual_history" in item.get("targets", []) else MAX_AGE_SECONDS[attribute]
    if state == "current" and (horizon-clock(context["observed_at"])).total_seconds() > ttl:
        state = "stale_source"
    return {"state": state, "required_valid_through": timestamp(horizon), "source_max_age_seconds": ttl}


def index_retained_acquisitions(artifact_dir, plan, base_bytes, *, now=None):
    """Build a manifest for reviewed pilot files without changing original bytes.

    The caller explicitly trusts the retained artifact directory. Only selected
    symbol files with successful, valid original receipts are indexed. Return a
    JSON value; the caller chooses the new manifest path and hashes it afterward.
    Existing failed/missing acquisitions are ordinary gaps and are not indexed.
    """
    validate_plan(plan, base_bytes)
    evaluated = now or utc_now()
    root = Path(artifact_dir)
    manifest = {"schema_version": CACHE_SCHEMA, "binding": {
        "base_artifact_sha256": plan["verified_us_cohort"]["base_artifact_sha256"],
        "source_data_as_of": plan["source_data_as_of"]}, "acquisitions": {}}
    for item in plan["selected"]:
        symbol = item["symbol"]
        for attribute in ATTRIBUTES:
            relative = f"acquisitions/{symbol}-{attribute}.json"
            path = root / relative
            if not path.is_file():
                continue
            raw, content = read_json(path)
            if raw.get("failure") is not None:
                continue
            _, context, _ = validate_acquisition(raw, symbol, attribute, now=evaluated,
                                                 as_of=day(plan["source_data_as_of"]))
            manifest["acquisitions"][f"{symbol}/{attribute}"] = {
                "symbol": symbol, "attribute": attribute, "file": relative,
                "sha256": digest_bytes(content), "capture_id": context["capture_id"],
                "observed_at": context["observed_at"], "origin_binding": dict(manifest["binding"])}
    return manifest


def history_projection(symbol, acquisitions, *, now, as_of):
    """Project exact captured USD cells into the existing history contract.

    No fallback to Basic EPS, no Q4 subtraction, currency conversion or inferred
    publication dates. The oldest included original receipt owns retrieved_at.
    """
    history = {"symbol": symbol, "as_of_date": as_of.isoformat(), "source": "Yahoo Finance via yfinance 0.2.66 transport capture",
               "source_url": f"https://finance.yahoo.com/quote/{symbol}/financials/", "basis": "reported_diluted_eps",
               "currency": "USD", "point_in_time": False, "source_publication_date": None,
               "source_publication_date_status": "unknown", "retrieved_at": None, "status": "unavailable", "annual": [], "quarterly": []}
    reasons, clocks, receipts = {}, [], []
    for attribute, key in (("income_stmt", "annual"), ("quarterly_income_stmt", "quarterly")):
        raw = acquisitions.get(attribute)
        if raw is None:
            reasons[key] = "fetch_gap"
            continue
        _, context, reason = validate_acquisition(raw, symbol, attribute, now=now, as_of=as_of)
        observed = clock(context["observed_at"])
        if reason != "current" or (now-observed).total_seconds() > 72 * 3600:
            reasons[key] = reason if reason != "current" else "stale_source"
            continue
        source = context["source_payload"]
        rows = source["source_rows"]
        eps, revenue = rows.get("dilutedeps"), rows.get("totalrevenue")
        prefix = "annual" if key == "annual" else "quarterly"
        if not isinstance(eps, dict) or eps.get("provider_metric") != prefix + "DilutedEPS":
            reasons[key] = "unsupported_eps_basis"
            continue
        if eps.get("currencies") != ["USD"]:
            reasons[key] = "unsupported_currency"
            continue
        revenue_valid = isinstance(revenue, dict) and revenue.get("provider_metric") == prefix + "TotalRevenue" and revenue.get("currencies") == ["USD"]
        periods = sorted(str(column)[:10] for column in source["columns"])
        values = [{"end": period, "eps": eps["values"].get(period),
                   "revenue": revenue["values"].get(period) if revenue_valid else None, "netIncome": None} for period in periods]
        history[key] = values
        clocks.append(observed)
        receipts.append({"attribute": attribute, "capture_id": context["capture_id"], "observed_at": context["observed_at"], "raw_payload_sha256": context["raw_payload_sha256"]})
        relevant = values[-4:] if key == "annual" else values
        if key == "annual" and (len(relevant) < 4 or any(not finite(point["eps"]) for point in relevant)):
            reasons[key] = "insufficient_annual_eps_points"
        elif key == "annual" and any(point["eps"] <= 0 for point in relevant[:-1]):
            reasons[key] = "nonpositive_comparison_base"
        else:
            reasons[key] = "available"
    if clocks:
        history.update(status="available", retrieved_at=timestamp(min(clocks)))
    return history, {"reasons": reasons, "original_receipts": receipts}


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def source_diagnostics(acquisitions, proof, history_diagnostics):
    from .financial_source_evidence import FINANCIAL_FIELDS
    from .static_financial_evidence import REASON_CODES
    details = {field: REASON_CODES[proof["r"][index]] for index, field in enumerate(FINANCIAL_FIELDS)}
    quarter = acquisitions.get("quarterly_income_stmt")
    if quarter:
        source = quarter["source_acquisition_contexts"]["quarterly_income_stmt"]["source_payload"]
        periods = [column[:10] for column in source["columns"]]
        rows = source["source_rows"]
        eps = next((rows[key] for key in ("dilutedeps", "basiceps") if key in rows and rows[key].get("values")), None)
        evaluated = datetime.fromtimestamp(proof["t"] / 1000, timezone.utc)
        _, _, source_state = validate_acquisition(quarter, quarter["symbol"], "quarterly_income_stmt",
                                                  now=evaluated, as_of=day(proof["a"]))
        if source_state == "current":
            if len(periods) == 5 and eps and all(finite(eps["values"].get(period)) for period in periods):
                details["eps_q2_yoy"] = "insufficient_reported_quarters_missing_sixth_point"
            # Zero bases produce no scalar in the unchanged arithmetic. The raw
            # source still establishes the semantic limitation, not a fetch gap.
            for field, recent, baseline, keys in (
                ("eps_growth_qq", 0, 1, ("dilutedeps", "basiceps")),
                ("eps_growth_yy", 0, 4, ("dilutedeps", "basiceps")),
                ("sales_growth_qq", 0, 1, ("totalrevenue", "operatingrevenue")),
                ("sales_growth_yy", 0, 4, ("totalrevenue", "operatingrevenue")),
                ("eps_q1_yoy", 0, 4, ("dilutedeps", "basiceps")),
                ("eps_q2_yoy", 1, 5, ("dilutedeps", "basiceps")),
            ):
                metric = next((rows[key] for key in keys if key in rows and rows[key].get("values")), None)
                if (metric is not None and len(periods) > baseline and len(metric.get("currencies", [])) == 1
                        and details[field] in {"missing_or_invalid_value", "nonpositive_comparison_base"}):
                    latest, base = (metric["values"].get(periods[position]) for position in (recent, baseline))
                    if finite(latest) and finite(base) and base <= 0:
                        details[field] = "nonpositive_comparison_base"
    else:
        for field in ("eps_growth_qq", "eps_growth_yy", "sales_growth_qq", "sales_growth_yy", "eps_q1_yoy", "eps_q2_yoy"):
            details[field] = "fetch_gap"
    if "income_stmt" not in acquisitions:
        details["eps_5yr_cagr"] = "fetch_gap"
    return {"fields": details, "annual_history": history_diagnostics["reasons"]["annual"]}


def _check_retention(guard, stage, stop):
    if guard is None or stop["reason"] is not None:
        return
    from .statement_retention_budget import RetentionBudgetExceeded
    try:
        guard.check(stage)
    except RetentionBudgetExceeded as exc:
        stop["reason"] = {"kind": "acquisition_budget_stop", "budget": "retention",
                          "completed_at": timestamp(utc_now()), "reservation": exc.report}


def make_session(requests, capture, out, events, stop, active, budget):
    """The reviewed pilot's fail-stop session, with sanitized disk receipts."""
    class FailStopSession(requests.Session):
        def request(self, method, url, *request_args, **kwargs):
            if stop["reason"] is not None:
                raise ProviderStopped("Provider work already stopped")
            _check_retention(budget.get("retention_guard"), "transport", stop)
            if stop["reason"] is not None:
                raise ProviderStopped("Retention exhausted before transport")
            remaining = budget["deadline"] - time.monotonic()
            exhausted = "wall_time" if remaining <= 0 else "transport_requests" if len(events) >= budget["max_transport_requests"] else None
            if exhausted:
                stop["reason"] = {"kind": "acquisition_budget_stop", "budget": exhausted,
                                  "completed_at": timestamp(utc_now())}
                raise ProviderStopped("Acquisition budget exhausted before transport")
            # A request already in progress must not consume the upload reserve.
            timeout = kwargs.get("timeout", remaining)
            if isinstance(timeout, tuple):
                kwargs["timeout"] = min([remaining, *(value for value in timeout if isinstance(value, (int, float)) and value > 0)])
            else:
                kwargs["timeout"] = min(timeout, remaining) if isinstance(timeout, (int, float)) and timeout > 0 else remaining
            parsed = urlsplit(str(url))
            event = {"sequence": len(events) + 1, **active,
                     "endpoint": f"{parsed.scheme}://{parsed.hostname}{parsed.path}",
                     "method": str(method), "started_at": timestamp(utc_now())}
            try:
                response = super().request(method, url, *request_args, **kwargs)
            except Exception as exc:
                event.update(completed_at=timestamp(utc_now()), error_type=type(exc).__name__)
                match = re.search(r"\b(403|429)\b", str(exc))
                if match:
                    event["detected_http_status"] = int(match.group(1))
                stop["reason"] = ({"kind": "acquisition_budget_stop", "budget": "wall_time", **event}
                                  if time.monotonic() >= budget["deadline"] else {"kind": "transport_exception", **event})
                events.append(event)
                write_json(out / "transport" / f"{event['sequence']:04d}.json", event)
                raise ProviderStopped("Transport exception; provider work stopped") from None
            event.update(completed_at=timestamp(utc_now()), http_status=response.status_code)
            if response.status_code in (403, 429):
                stop["reason"] = {"kind": "provider_http_stop", **event}
            identity = capture._request_identity(url, kwargs.get("params"))
            if identity and identity[0] in ATTRIBUTES and 200 <= response.status_code < 300:
                content = response.content
                if isinstance(content, bytes):
                    event["transport_payload_sha256"] = digest_bytes(content)
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
                write_json(out / "transport" / f"{event['sequence']:04d}.json", event)
            except Exception:
                stop["reason"] = {"kind": "transport_archive_failed", "sequence": event["sequence"]}
                raise ProviderStopped("Failed to preserve transport evidence") from None
            if stop["reason"] is not None:
                raise ProviderStopped("Provider response stopped further work")
            return response
    return FailStopSession(impersonate="chrome")


def collect(plan, base_bytes, output_dir, *, cache_manifest=None, cache_sha256=None, dry_run=False,
            acquisition_budget_seconds=DEFAULT_ACQUISITION_BUDGET_SECONDS,
            max_statement_getter_calls=MAX_BATCH * 2, max_transport_requests=DEFAULT_MAX_TRANSPORT_REQUESTS,
            retention_guard=None):
    validate_plan(plan, base_bytes)
    if (not finite(acquisition_budget_seconds) or not 0 < acquisition_budget_seconds <= 24 * 3600
            or type(max_statement_getter_calls) is not int or not 1 <= max_statement_getter_calls <= MAX_BATCH * 2
            or type(max_transport_requests) is not int or not 1 <= max_transport_requests <= 10000):
        raise InvalidPlan("Acquisition budgets must be explicit positive bounded values")
    deadline = time.monotonic() + acquisition_budget_seconds
    if retention_guard is not None:
        retention_guard.check("initial")
    budget = {"deadline": deadline, "max_transport_requests": max_transport_requests,
              "retention_guard": retention_guard}
    started = utc_now()
    if clock(plan["evaluation_time"]) > started:
        raise InvalidPlan("Plan evaluation is in the future")
    out = Path(output_dir)
    if out.exists():
        raise InvalidPlan("Output directory must be new; original evidence is immutable")
    components = runtime()
    yf, requests, capture, validate, growth_fn, EPSRatingService, proof_fn = components
    cached = load_cache(cache_manifest, cache_sha256, plan, now=started)
    run_id = str(uuid4())
    run_plan = {**plan, "run_id": run_id, "run_started_at": timestamp(started), "yfinance_version": yf.__version__, "caller_retries": 0,
                "maximum_statement_getter_calls": min(max_statement_getter_calls, sum(len(item["attributes"]) for item in plan["selected"])),
                "acquisition_budget_seconds": acquisition_budget_seconds, "maximum_transport_requests": max_transport_requests,
                "stop_http_statuses": [403, 429], "pacing_seconds": PACING_SECONDS,
                "source_publication_date": None, "point_in_time": False,
                "provider_http_count_may_include_normal_anonymous_cookie_and_crumb_requests": True}
    if dry_run:
        return {"mode": "dry_run", **run_plan, "cache_reusable_attributes": sum(item["reason"] == "current" for item in cached.values())}, 0
    out.mkdir(parents=True)
    plan_sha = write_json(out / "plan.json", run_plan)
    journal = {"schema_version": "financial-statement-attempts-v1", "run_id": run_id,
               "plan_sha256": plan_sha, "attempts": []}
    write_json(out / "attempts.json", journal)
    manifest = {"schema_version": CACHE_SCHEMA, "binding": {"base_artifact_sha256": plan["verified_us_cohort"]["base_artifact_sha256"],
                "source_data_as_of": plan["source_data_as_of"]}, "acquisitions": {}}
    write_json(out / "cache-manifest.json", manifest)
    events, stop, active = [], {"reason": None}, {"symbol": None, "attribute": None}
    statuses, reasons = {}, Counter()
    counts = Counter({key: 0 for key in ("captured_attributes", "reused_attributes", "failed_attributes",
                                       "not_attempted_attributes", "budget_stopped_attributes", "source_valid_field_proofs", "annual_history_available",
                                       "annual_history_complete", "annual_growth_comparable", "annual_growth_nonpositive_base",
                                       "current_comparable_field_proofs", "source_reference_field_proofs")})
    result_index = {}
    provider_getters = 0
    processing_failed = False
    as_of = day(plan["source_data_as_of"])

    def preserve(raw, symbol, attribute, origin_binding=None, original_bytes=None):
        file = f"acquisitions/{symbol}-{attribute}.json"
        sha = write_json(out / file, raw) if original_bytes is None else write_bytes(out / file, original_bytes)
        if raw.get("failure") is None:
            context = raw["source_acquisition_contexts"][attribute]
            manifest["acquisitions"][f"{symbol}/{attribute}"] = {"symbol": symbol, "attribute": attribute,
                "file": file, "sha256": sha, "capture_id": context["capture_id"], "observed_at": context["observed_at"],
                "origin_binding": dict(origin_binding or manifest["binding"])}
            write_json(out / "cache-manifest.json", manifest)

    with ExitStack() as stack:
        session = None
        for item in plan["selected"]:
            symbol = item["symbol"]
            frames, contexts, acquisitions, attribute_results = {}, {}, {}, {}
            ticker = None
            for attribute in ATTRIBUTES:
                old = cached.get((symbol, attribute))
                if old:
                    # A long sequential batch may cross a receipt's expiry after
                    # preflight; decide reuse at the actual use time as well.
                    use_time = utc_now()
                    _, _, old["reason"] = validate_acquisition(old["raw"], symbol, attribute,
                                                               now=use_time, as_of=as_of)
                    old["required_validity"] = required_validity_state(old["raw"], symbol, attribute, item, plan, now=use_time)
                    if old["reason"] == "current" and old["required_validity"]["state"] != "current":
                        old["reason"] = "renewal_due"
                if old and old["reason"] == "current":
                    preserve(old["raw"], symbol, attribute, old["origin_binding"], old["bytes"])
                    frames[attribute], contexts[attribute], acquisitions[attribute] = old["frame"], old["context"], old["raw"]
                    attribute_results[attribute] = {"status": "reused", "observed_at": old["context"]["observed_at"], "capture_id": old["context"]["capture_id"], "origin_binding": old["origin_binding"],
                                                    "required_validity": old["required_validity"]}
                    counts["reused_attributes"] += 1
                    continue
                if attribute not in item["attributes"]:
                    attribute_results[attribute] = {"status": "not_selected"}
                    continue
                if stop["reason"] is None:
                    _check_retention(retention_guard, "getter", stop)
                    exhausted = ("wall_time" if time.monotonic() >= budget["deadline"] else
                                 "statement_getters" if provider_getters >= max_statement_getter_calls else None)
                    if exhausted and stop["reason"] is None:
                        stop["reason"] = {"kind": "acquisition_budget_stop", "budget": exhausted,
                                          "completed_at": timestamp(utc_now())}
                if stop["reason"] is not None:
                    is_budget_stop = stop["reason"]["kind"] == "acquisition_budget_stop"
                    attribute_results[attribute] = {"status": "not_attempted_after_budget_stop" if is_budget_stop else "not_attempted_after_provider_stop"}
                    counts["not_attempted_attributes"] += 1
                    continue
                if session is None:
                    session = stack.enter_context(make_session(requests, capture, out, events, stop, active, budget))
                if ticker is None:
                    ticker = yf.Ticker(symbol, session=session)
                active.update(symbol=symbol, attribute=attribute)
                event_start = len(events)
                frame, acquired, failure = None, {}, None
                provider_getters += 1
                attempt = {"attempt_id": f"{run_id}:{provider_getters:04d}", "symbol": symbol,
                           "attribute": attribute, "attributes": [attribute], "attempted_at": timestamp(utc_now()),
                           "outcome": "in_flight"}
                journal["attempts"].append(attempt)
                write_json(out / "attempts.json", journal)
                try:
                    frame, acquired = capture.acquire_yahoo_value(ticker, attribute, symbol=symbol, market="US")
                except Exception as exc:
                    failure = {"kind": "getter_exception", "error_type": type(exc).__name__}
                if stop["reason"] is not None:
                    failure = {"kind": "acquisition_budget_stopped" if stop["reason"]["kind"] == "acquisition_budget_stop" else "provider_stopped",
                               "reason": stop["reason"]}
                elif frame is None or frame.empty:
                    failure = failure or {"kind": "empty_getter_result", "may_include_swallowed_provider_error": True}
                elif attribute not in acquired:
                    failure = {"kind": "no_transport_bound_context", "value_received_but_unverified": True}
                raw = {"symbol": symbol, "attribute": attribute, "getter_completed_at": timestamp(utc_now()),
                       "source_publication_date": None, "source_publication_date_status": "unknown", "point_in_time": False,
                       "source_acquisition_contexts": acquired, "original_frame_cells": frame_cells(frame),
                       "transport_events": events[event_start:], "failure": failure, "full_http_bodies_archived": False}
                # Persist raw material before validation, calculations, or another getter.
                preserve(raw, symbol, attribute)
                if failure is None:
                    try:
                        _, context, freshness = validate_acquisition(raw, symbol, attribute, now=utc_now(), as_of=as_of)
                        frames[attribute], contexts[attribute], acquisitions[attribute] = frame, context, raw
                        attribute_results[attribute] = {"status": "captured", "source_state": freshness,
                            "observed_at": context["observed_at"], "capture_id": context["capture_id"],
                            "required_validity": required_validity_state(raw, symbol, attribute, item, plan, now=utc_now())}
                        counts["captured_attributes"] += 1
                    except Exception as exc:
                        failure = {"kind": "invalid_captured_evidence", "error_type": type(exc).__name__}
                        # Keep raw evidence for diagnosis, remove only its cache eligibility.
                        manifest["acquisitions"].pop(f"{symbol}/{attribute}", None)
                        write_json(out / "cache-manifest.json", manifest)
                if failure is not None:
                    is_budget_stop = failure["kind"] == "acquisition_budget_stopped"
                    attribute_results[attribute] = {"status": "budget_stopped" if is_budget_stop else "fetch_failed", "failure": failure}
                    counts["budget_stopped_attributes" if is_budget_stop else "failed_attributes"] += 1
                    processing_failed = processing_failed or not is_budget_stop
                if old:
                    attribute_results[attribute]["previous_cache_state"] = old["reason"]
                attempt.update(completed_at=timestamp(utc_now()), acquisition_file=f"acquisitions/{symbol}-{attribute}.json")
                if failure is None:
                    attempt.update(outcome="succeeded", capture_id=contexts[attribute]["capture_id"])
                else:
                    attempt.update(outcome="budget_stopped" if failure["kind"] == "acquisition_budget_stopped" else
                                   "provider_blocked" if failure["kind"] == "provider_stopped" else "failed",
                                   failure_kind=failure["kind"])
                    reason = failure.get("reason", {})
                    http_status = reason.get("http_status", reason.get("detected_http_status"))
                    if http_status is not None:
                        attempt["http_status"] = http_status
                write_json(out / "attempts.json", journal)
                if stop["reason"] is None:
                    time.sleep(min(PACING_SECONDS, max(0, budget["deadline"] - time.monotonic())))
            result = {"symbol": symbol, "market": "US", "source_data_as_of": plan["source_data_as_of"],
                      "evaluation_time": timestamp(utc_now()), "attributes": attribute_results,
                      "source_publication_date": None, "point_in_time": False}
            _check_retention(retention_guard, "result", stop)
            bounded_empty = retention_guard is not None and stop["reason"] is not None and not acquisitions
            try:
                growth = growth_fn(frames.get("quarterly_income_stmt"), market="US", include_source_context=True)
                eps = EPSRatingService().calculate_eps_rating_data(frames.get("income_stmt"), frames.get("quarterly_income_stmt"), include_source_context=True)
                source_context = {**growth.pop("_financial_source_context", {}), **eps.pop("_financial_source_context", {})}
                payload = {**growth, **eps, "symbol": symbol, "market": "US"}
                capture.attach_evidence(payload, capture.statement_evidence(payload, source_context, contexts), symbol=symbol, market="US")
                validate(payload["financial_source_evidence"])
                envelope_file = f"envelopes/{symbol}.json"
                if bounded_empty:
                    from .statement_retention_budget import STOPPED_PROJECTION_LIMIT, RetentionIntegrityError
                    if len(_json_bytes(payload)) > STOPPED_PROJECTION_LIMIT:
                        raise RetentionIntegrityError("Stopped empty envelope exceeds its reservation")
                envelope_sha = write_json(out / envelope_file, payload)
                evaluated = clock(result["evaluation_time"])
                proof = proof_fn(payload, now=evaluated, as_of_date=plan["source_data_as_of"], market="US")
                history, history_diagnostics = history_projection(symbol, acquisitions, now=evaluated, as_of=as_of)
                diagnostics = source_diagnostics(acquisitions, proof, history_diagnostics)
                reasons.update(diagnostics["fields"].values())
                reasons["annual_history:" + diagnostics["annual_history"]] += 1
                result.update(status="captured" if acquisitions else "unverified_or_unavailable", envelope_file=envelope_file,
                              envelope_sha256=envelope_sha, financial_current=proof, financial_history=history,
                              history_source_diagnostics=history_diagnostics, source_diagnostics=diagnostics)
                counts["source_valid_field_proofs"] += len(proof["p"])
                counts["current_comparable_field_proofs"] += proof["r"].count("0")
                counts["source_reference_field_proofs"] += proof["r"].count("f")
                # The original key counted comparable growth, not all complete
                # histories. Keep it for old artifact readers and expose both
                # source completeness and comparison semantics explicitly.
                annual_reason = diagnostics["annual_history"]
                counts["annual_history_available"] += annual_reason == "available"
                counts["annual_growth_comparable"] += annual_reason == "available"
                counts["annual_growth_nonpositive_base"] += annual_reason == "nonpositive_comparison_base"
                counts["annual_history_complete"] += annual_reason in {"available", "nonpositive_comparison_base"}
            except Exception as exc:
                if bounded_empty:
                    from .statement_retention_budget import RetentionIntegrityError
                    if isinstance(exc, RetentionIntegrityError):
                        raise
                result.update(status="normalization_failed", error_type=type(exc).__name__, raw_acquisitions_preserved=True)
                processing_failed = True
            if bounded_empty:
                from .statement_retention_budget import STOPPED_PROJECTION_LIMIT, RetentionIntegrityError
                if len(_json_bytes(result)) > STOPPED_PROJECTION_LIMIT:
                    raise RetentionIntegrityError("Stopped empty result exceeds its reservation")
            result_file = f"results/{symbol}.json"
            result_index[symbol] = {"file": result_file, "sha256": write_json(out / result_file, result), "status": result["status"]}
            statuses[symbol] = result["status"]
            # Each completed symbol and all its original receipts are durable now.
    budget_stopped = stop["reason"] is not None and stop["reason"]["kind"] == "acquisition_budget_stop"
    exit_code = 4 if budget_stopped else 2 if stop["reason"] is not None else 3 if processing_failed else 0
    summary = {"schema_version": "financial-statement-batch-summary-v1", "source_data_as_of": plan["source_data_as_of"],
               "plan_evaluation_time": plan["evaluation_time"], "evaluation_time": timestamp(utc_now()),
               "base_artifact_sha256": plan["verified_us_cohort"]["base_artifact_sha256"],
               "plan_sha256": plan_sha, "attempts_sha256": digest_bytes((out / "attempts.json").read_bytes()),
               "source_publication_date": None, "point_in_time": False,
               "temporal_semantics": "Current observations; not facts known at the historical price snapshot",
               "provider_stop": None if budget_stopped else stop["reason"],
               "execution_stop": stop["reason"] if budget_stopped else None, "exit_code": exit_code,
               "selected_symbols": len(plan["selected"]), "statement_getter_calls": provider_getters, "transport_calls": len(events),
               "counts": dict(counts), "source_reason_counts": dict(reasons), "symbol_status_counts": dict(Counter(statuses.values())),
               "results": result_index, "cache_manifest_sha256": digest_bytes((out / "cache-manifest.json").read_bytes()),
               "capture_completion_is_source_availability": False}
    write_json(out / "summary.json", summary)
    return summary, exit_code
