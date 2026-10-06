"""Passive, bounded financial-source capture for the pinned vendor adapters.

This module does not fetch data. Yahoo's statement HTTP cache is shared across
Ticker instances, so getter completion is not an acquisition clock. Receipts
are attached only after a successful, recognized transport call; cache hits
reuse that receipt. Previously populated objects/responses remain unverified.
"""
from __future__ import annotations

from contextvars import ContextVar
from copy import deepcopy
from datetime import datetime, timezone
from functools import wraps
import hashlib
import inspect
import json
import logging
import math
import re
from threading import RLock
from typing import Any
from urllib.parse import parse_qs, unquote, urlsplit
from uuid import uuid4

import pandas as pd
import yfinance as yf

from .financial_source_evidence import (
    make_capture_context,
    make_derived_record,
    make_envelope,
    make_observed_record,
)
from .security_master_service import security_master_resolver

logger = logging.getLogger(__name__)
_RECEIPT_ATTR = "_financial_source_receipt_v1"
_TICKER_ATTR = "_financial_source_contexts_v1"
_ACTIVE_RECEIPTS: ContextVar[list | None] = ContextVar("financial_source_receipts", default=None)
_INSTALL_LOCK = RLock()
_INFO_KEYS = {"roe": "returnOnEquity", "profit_margin": "profitMargins", "revenue_growth": "revenueGrowth"}
_MAX_CAPTURE_BYTES = 4 * 1024 * 1024
_MAX_SOURCE_SUBSET_BYTES = 128 * 1024
_STATEMENT_METRICS = frozenset({
    "NormalizedDilutedEPS", "NormalizedBasicEPS", "ReconciledCostOfRevenue",
    "ContinuingAndDiscontinuedDilutedEPS", "ContinuingAndDiscontinuedBasicEPS",
    "ReportedNormalizedDilutedEPS", "ReportedNormalizedBasicEPS", "DilutedEPS",
    "DilutedEPSOtherGainsLosses", "TaxLossCarryforwardDilutedEPS", "BasicEPS",
    "BasicEPSOtherGainsLosses", "TaxLossCarryforwardBasicEPS", "CostOfRevenue",
    "TotalRevenue", "OperatingRevenue",
})


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _json_digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _request_identity(url: Any, params: Any = None) -> tuple[str, str] | None:
    """Recognize only endpoints whose transformations are reviewed for 0.2.66."""
    if not isinstance(url, str):
        return None
    parsed = urlsplit(url)
    if parsed.hostname not in {"query1.finance.yahoo.com", "query2.finance.yahoo.com"}:
        return None
    query = parse_qs(parsed.query)
    query.update({k: [str(v)] for k, v in (params or {}).items()})
    if parsed.path.startswith("/v10/finance/quoteSummary/"):
        return "quoteSummary", unquote(parsed.path.rsplit("/", 1)[-1]).upper()
    if parsed.path == "/v7/finance/quote":
        symbols = query.get("symbols", [""])[0]
        return ("quoteResponse", symbols.upper()) if symbols and "," not in symbols else None
    if parsed.path.startswith("/ws/fundamentals-timeseries/v1/finance/timeseries/"):
        types = query.get("type", [""])[0].split(",")
        for prefix, attribute in (("annual", "income_stmt"), ("quarterly", "quarterly_income_stmt")):
            if prefix + "TotalRevenue" in types and all(t.startswith(prefix) for t in types):
                return attribute, unquote(parsed.path.rsplit("/", 1)[-1]).upper()
    return None


def _collect_response(response: Any) -> None:
    collector = _ACTIVE_RECEIPTS.get()
    receipt = getattr(response, _RECEIPT_ATTR, None)
    if collector is not None and isinstance(receipt, dict):
        if not any(item["capture_id"] == receipt["capture_id"] for item in collector):
            collector.append(receipt)


def _receipt_source(body: Any, identity: tuple[str, str]) -> dict | None:
    """Retain a bounded financial subset, never arbitrary vendor profile data."""
    kind, symbol = identity
    if not isinstance(body, dict):
        return None
    if kind in {"quoteSummary", "quoteResponse"}:
        document = body.get(kind, {})
        results = document.get("result") or []
        if document.get("error") is not None or len(results) != 1:
            return None
        row = results[0]
        if row.get("symbol", symbol) != symbol or row.get("quoteType", {}).get("symbol", symbol) != symbol:
            return None
        financial_data = row.get("financialData", {}) if kind == "quoteSummary" else {}
        selected_values = {}
        for key in _INFO_KEYS.values():
            raw = financial_data.get(key)
            raw = raw.get("raw") if isinstance(raw, dict) and "fmt" in raw else raw
            if _finite(raw):
                selected_values[key] = raw
        return {
            "financial_data": selected_values,
            "field_counts": {key: _count_key(row, key) for key in _INFO_KEYS.values()},
        }
    document = body.get("timeseries", {})
    rows = document.get("result") or []
    if document.get("error") is not None or not isinstance(rows, list) or not 0 < len(rows) <= 500:
        return None
    prefix = "annual" if kind == "income_stmt" else "quarterly"
    timestamps, selected = set(), {}
    for row in rows:
        meta = row.get("meta", {})
        types = meta.get("type")
        if meta.get("symbol") != [symbol] or not isinstance(types, list) or len(types) != 1:
            return None
        key = types[0]
        if not isinstance(key, str) or not key.startswith(prefix):
            return None
        timestamps.update(row.get("timestamp", []))
        metric = key[len(prefix):]
        if "eps" not in metric.lower() and "revenue" not in metric.lower():
            continue
        if metric not in _STATEMENT_METRICS:
            return None
        points = row.get(key, [])
        if not isinstance(points, list) or len(points) > 64:
            return None
        normalized = metric.lower()
        if normalized in selected:
            return None
        values = {}
        currencies = set()
        for point in points:
            period = pd.Timestamp(point["asOfDate"]).date().isoformat()
            raw = point.get("reportedValue", {}).get("raw")
            if raw is not None and not _finite(raw):
                return None
            values[period] = raw
            if point.get("currencyCode"):
                if not isinstance(point["currencyCode"], str) or not re.fullmatch(r"[A-Z]{3}", point["currencyCode"]):
                    return None
                currencies.add(point["currencyCode"])
        selected[normalized] = {"provider_metric": key, "values": values, "currencies": sorted(currencies)}
    if len(timestamps) > 64 or not selected or not timestamps:
        return None
    columns = [str(pd.Timestamp(t, unit="s")) for t in sorted(timestamps, reverse=True)]
    return {"columns": columns, "rows": selected}


def _statement_matches_source(subset: dict, source: dict) -> bool:
    if subset["columns"] != source.get("columns"):
        return False
    seen = set()
    for row in subset["rows"]:
        metric = row["metric"].lower().replace(" ", "")
        if metric in seen or metric not in source.get("rows", {}):
            return False
        seen.add(metric)
        source_values = source["rows"][metric]["values"]
        for period, value in zip(subset["columns"], row["values"]):
            if source_values.get(pd.Timestamp(period).date().isoformat()) != value:
                return False
    return bool(seen)


def _install_yahoo_transport_hooks() -> bool:
    """Install idempotent passive hooks, preserving vendor calls and failures.

    Unsupported versions/signatures deliberately keep the ordinary fetch path
    working without certified evidence. No cache is cleared or bypassed.
    """
    if yf.__version__ != "0.2.66":
        return False
    from yfinance.data import YfData

    with _INSTALL_LOCK:
        if getattr(YfData.get, "_financial_source_hook_v1", False):
            return bool(getattr(YfData.cache_get, "_financial_source_hook_v1", False))
        for method in (YfData.get, YfData.cache_get):
            if tuple(inspect.signature(method).parameters) != ("self", "url", "params", "timeout"):
                return False
        original_get, original_cache_get = YfData.get, YfData.cache_get

        @wraps(original_get)
        def captured_get(*args, **kwargs):
            # Exact argument forwarding matters: functools.lru_cache distinguishes
            # omitted defaults and positional/keyword spellings.
            response = original_get(*args, **kwargs)
            if _ACTIVE_RECEIPTS.get() is not None:
                try:
                    url = args[1] if len(args) > 1 else kwargs.get("url")
                    params = args[2] if len(args) > 2 else kwargs.get("params")
                    identity = _request_identity(url, params)
                    status = response.status_code
                    if identity and isinstance(status, int) and 200 <= status < 300:
                        observed_at = _utc_now()
                        content = response.content
                        if not isinstance(content, bytes) or len(content) > _MAX_CAPTURE_BYTES:
                            return response
                        body = json.loads(content)
                        source = _receipt_source(body, identity)
                        if source is None or len(json.dumps(source, allow_nan=False).encode()) > _MAX_SOURCE_SUBSET_BYTES:
                            return response
                        receipt = {
                            "kind": identity[0], "provider_symbol": identity[1],
                            "observed_at": observed_at,
                            "capture_id": str(uuid4()),
                            "transport_payload_sha256": hashlib.sha256(content).hexdigest(),
                            "source": source,
                        }
                        setattr(response, _RECEIPT_ATTR, receipt)
                        _collect_response(response)
                except Exception:
                    # Optional evidence must not change vendor behavior.
                    logger.debug("Yahoo response could not be captured", exc_info=True)
            return response

        @wraps(original_cache_get)
        def captured_cache_get(*args, **kwargs):
            response = original_cache_get(*args, **kwargs)
            try:
                _collect_response(response)
            except Exception:
                logger.debug("Cached Yahoo receipt unavailable", exc_info=True)
            return response

        captured_get._financial_source_hook_v1 = True
        captured_cache_get._financial_source_hook_v1 = True
        for name in ("cache_info", "cache_clear", "cache_parameters"):
            if hasattr(original_cache_get, name):
                setattr(captured_cache_get, name, getattr(original_cache_get, name))
        YfData.get, YfData.cache_get = captured_get, captured_cache_get
    return True


def _statement_subset(value: Any) -> dict | None:
    if not isinstance(value, pd.DataFrame) or value.empty:
        return None
    rows = []
    for position, label in enumerate(value.index):
        key = str(label).lower().replace(" ", "")
        if "eps" not in key and "revenue" not in key:
            continue
        values = []
        for raw in value.iloc[position].tolist():
            try:
                number = float(raw)
                values.append(number if math.isfinite(number) else None)
            except (TypeError, ValueError):
                values.append(None)
        rows.append({"metric": str(label), "values": values})
    if not rows:
        return None
    return {"format": "yfinance-income-selected-rows-v1", "columns": [str(c) for c in value.columns], "rows": rows}


def _info_subset(value: Any) -> dict | None:
    if not isinstance(value, dict):
        return None
    subset = {key: value[key] for key in _INFO_KEYS.values() if _finite(value.get(key))}
    return subset or None


def _count_key(value: Any, key: str) -> int:
    if isinstance(value, dict):
        return int(key in value) + sum(_count_key(v, key) for v in value.values())
    if isinstance(value, list):
        return sum(_count_key(v, key) for v in value)
    return 0


def acquire_yahoo_value(ticker: Any, attribute: str, *, symbol: str | None = None, market: str | None = None) -> tuple[Any, dict]:
    """Read the ordinary getter and return only transport-bound contexts.

    Contexts are keyed by info source key, or by statement attribute. Retained
    contexts are reused only for exactly unchanged selected source contents.
    """
    try:
        enabled = _install_yahoo_transport_hooks()
    except Exception:
        enabled = False
        logger.debug("Yahoo capture contract unavailable", exc_info=True)
    receipts: list[dict] = []
    token = _ACTIVE_RECEIPTS.set(receipts if enabled else None)
    try:
        value = getattr(ticker, attribute)
    finally:
        _ACTIVE_RECEIPTS.reset(token)
    if not enabled:
        return value, {}
    try:
        provider_symbol = str(getattr(ticker, "ticker", None) or symbol or "").strip().upper()
        if not provider_symbol:
            return value, {}
        identity = security_master_resolver.resolve_identity(symbol=symbol or provider_symbol, market=market)
        provider_identity = security_master_resolver.resolve_identity(symbol=provider_symbol)
        if (identity.canonical_symbol, identity.market) != (provider_identity.canonical_symbol, provider_identity.market):
            return value, {}
        subset = _info_subset(value) if attribute == "info" else _statement_subset(value)
        if not subset:
            return value, {}
        subset_digest = _json_digest(subset)
        stored = getattr(ticker, _TICKER_ATTR, {})
        old = stored.get(attribute, {}) if isinstance(stored, dict) else {}
        if not receipts:
            if old.get("subset_digest") == subset_digest and old.get("symbol") == identity.canonical_symbol and old.get("market") == identity.market:
                return value, deepcopy(old["contexts"])
            return value, {}
        matching = [r for r in receipts if r["provider_symbol"] == provider_symbol]
        contexts = {}

        def context(receipt, payload):
            result = make_capture_context(
                symbol=identity.canonical_symbol, market=identity.market, source="yfinance",
                producer=f"yfinance.{attribute}/transport-capture-v1", provider_symbol=provider_symbol,
                observed_at=receipt["observed_at"], source_payload=payload, capture_id=receipt["capture_id"],
            )
            result["transport_payload_sha256"] = receipt["transport_payload_sha256"]
            return result

        if attribute == "info":
            summaries = [r for r in matching if r["kind"] == "quoteSummary"]
            quotes = [r for r in matching if r["kind"] == "quoteResponse"]
            # 0.2.66 always merges quoteResponse over quoteSummary. A missing or
            # rejected second response cannot prove which response owned a field.
            if len(summaries) == 1 and len(quotes) == 1:
                receipt = summaries[0]
                data = receipt["source"]["financial_data"]
                source_subset = {"format": "yfinance-financialData-subset-v1"}
                for key in _INFO_KEYS.values():
                    raw = data.get(key)
                    raw = raw.get("raw") if isinstance(raw, dict) and "fmt" in raw else raw
                    if _finite(raw):
                        source_subset[key] = raw
                for key, normalized in subset.items():
                    # Only the reviewed financialData origin, with no competing
                    # source occurrence. Equality checks integrity, not ownership.
                    if sum(r["source"].get("field_counts", {}).get(key, 0) for r in matching) != 1 or key not in data:
                        continue
                    raw = data[key]
                    raw = raw.get("raw") if isinstance(raw, dict) and "fmt" in raw else raw
                    if _finite(raw) and raw == normalized:
                        contexts[key] = context(receipt, source_subset)
        else:
            candidates = [r for r in matching if r["kind"] == attribute]
            if len(candidates) == 1:
                receipt = candidates[0]
                if _statement_matches_source(subset, receipt["source"]):
                    contexts[attribute] = context(receipt, {**subset, "source_rows": receipt["source"]["rows"]})
        stored = dict(stored) if isinstance(stored, dict) else {}
        stored[attribute] = {"subset_digest": subset_digest, "symbol": identity.canonical_symbol, "market": identity.market, "contexts": deepcopy(contexts)}
        setattr(ticker, _TICKER_ATTR, stored)
        return value, contexts
    except Exception:
        logger.debug("Yahoo source context unavailable", exc_info=True)
        return value, {}


def _optional_evidence(builder):
    """A shadow capture failure may remove proof, never legacy scalar output."""
    @wraps(builder)
    def wrapped(*args, **kwargs):
        try:
            return builder(*args, **kwargs)
        except Exception:
            logger.debug("Financial shadow evidence unavailable", exc_info=True)
            return {}
    return wrapped


@_optional_evidence
def info_evidence(payload: dict, contexts: dict, *, percent_points: bool) -> dict:
    fields = {}
    for field, key in _INFO_KEYS.items():
        context = contexts.get(key)
        value = payload.get(field)
        if context and _finite(value):
            source_value = context["source_payload"][key]
            expected = round(source_value * 100, 2) if percent_points else source_value
            if value != expected:
                continue
            fields[field] = make_observed_record(
                field, value, context, unit="percent_points" if percent_points else "fraction",
                basis=f"yfinance.financialData.{key}/v1", metric=key,
                source_value=source_value, source_unit="fraction",
                conversion="multiply_100_round_2dp" if percent_points else "identity",
                transport_payload_sha256=context.get("transport_payload_sha256"),
            )
    return fields


@_optional_evidence
def statement_evidence(payload: dict, source_contexts: dict, acquisitions: dict) -> dict:
    """Bind arithmetic's selected columns to that statement's acquisition."""
    fields = {}
    for field, metadata in source_contexts.items():
        if field == "eps_raw_score" or not _finite(payload.get(field)):
            continue
        attribute = "income_stmt" if field == "eps_5yr_cagr" else "quarterly_income_stmt"
        context = acquisitions.get(attribute)
        if not context:
            continue
        details = dict(metadata)
        basis = details.pop("basis")
        details.pop("provenance_kind", None)
        details.setdefault("period_status", "not_supplied")
        fields[field] = make_observed_record(
            field, payload[field], context, unit="percent_points", basis=basis,
            transport_payload_sha256=context.get("transport_payload_sha256"), **details,
        )
    raw_metadata = source_contexts.get("eps_raw_score", {})
    inputs = raw_metadata.get("input_fields", [])
    if inputs and all(field in fields for field in inputs) and _finite(payload.get("eps_raw_score")):
        identity = next(iter(acquisitions.values()))
        fields["eps_raw_score"] = make_derived_record(
            "eps_raw_score", payload["eps_raw_score"], symbol=identity["symbol"], market=identity["market"],
            source="yfinance", producer="EPSRatingService.calculate_raw_score/v1", unit="score",
            basis=raw_metadata["basis"], dependencies=[fields[name]["observation_id"] for name in inputs],
            algorithm_version=raw_metadata["algorithm"], computed_at=_utc_now(),
            input_fields=inputs,
        )
    return fields


def attach_evidence(payload: dict, fields: dict, *, symbol: str, market: str | None = None) -> dict:
    """Attach an explicit empty envelope for unsupported/unobserved fields."""
    try:
        if market and security_master_resolver.normalize_market(market) is None:
            raise ValueError("Unsupported shadow market")
        identity = security_master_resolver.resolve_identity(symbol=symbol, market=market)
        envelope = make_envelope(symbol=identity.canonical_symbol, market=identity.market, fields=fields)
    except Exception:
        logger.debug("Financial shadow identity/evidence unavailable", exc_info=True)
        # Preserve any rejected source context without claiming a new identity.
        envelope = make_envelope(symbol=symbol, market=market, fields={})
        envelope["unverified_source_fields"] = deepcopy(fields)
    else:
        payload.setdefault("symbol", identity.canonical_symbol)
        payload.setdefault("market", identity.market)
    payload["financial_source_evidence"] = envelope
    return payload
