"""Pure, versioned financial observation storage (shadow stage).

Nothing in this module fetches data or supplies a source clock. Merging keeps the
legacy non-null-primary scalar choice; current-use projection is opt-in and is
not called by the cache. Original envelopes and losing observations are retained.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
import math
import re
from typing import Any, Mapping
from uuid import uuid4

SCHEMA = "financial-source-evidence-v1"
SOURCE_POLICY = {"id": "fundamentals-source-7d-v1", "max_age_ms": 604800000}
FINANCIAL_FIELDS = (
    "eps_growth_qq", "eps_growth_yy", "sales_growth_qq", "sales_growth_yy",
    "annual_eps_growth_3y", "eps_5yr_cagr", "eps_q1_yoy", "eps_q2_yoy",
    "eps_raw_score", "revenue_growth", "profit_margin", "roe", "eps_rating",
    "smr_rating", "composite_rating", "composite_rating_score",
)
QUARANTINED_FIELDS = frozenset(FINANCIAL_FIELDS[-4:])
ALIASES = {"eps_growth_quarterly": "eps_growth_qq", "eps_growth_annual": "eps_growth_yy"}
CONTEXT_KEYS = (
    "recent_quarter_date", "previous_quarter_date", "growth_comparable_period_date",
    "growth_reporting_cadence", "growth_metric_basis", "growth_reference_gap_days",
)
_STATEMENT_FIELDS = frozenset(FINANCIAL_FIELDS[:9])
_TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$")


def _json_copy(value: Any) -> Any:
    """Reject values JSON cannot faithfully carry, including NaN and infinity."""
    return json.loads(json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":")))



def _audit_json(value: Any) -> Any:
    """JSON-safe diagnostic encoding; never used as an observed financial value."""
    if isinstance(value, float) and not math.isfinite(value):
        label = "NaN" if math.isnan(value) else "Infinity" if value > 0 else "-Infinity"
        return {"non_finite_number": label}
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): _audit_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_audit_json(item) for item in value]
    if value is None or isinstance(value, (str, bool, int, float)):
        return value
    return {"unsupported_python_type": type(value).__name__, "representation": str(value)}

def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, allow_nan=False, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def valid_value(field: str, value: Any) -> bool:
    def finite(v: Any) -> bool:
        return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)
    return (isinstance(value, list) and len(value) == 3 and all(finite(v) for v in value)) if field == "annual_eps_growth_3y" else finite(value)


def equal_value(left: Any, right: Any) -> bool:
    # bool == 1 in Python must never bind an observation.
    if isinstance(left, bool) or isinstance(right, bool):
        return False
    if isinstance(left, list) or isinstance(right, list):
        return (isinstance(left, list) and isinstance(right, list) and len(left) == len(right)
                and all(equal_value(a, b) for a, b in zip(left, right)))
    return type(left) is type(right) and left == right or (
        isinstance(left, (float, int)) and isinstance(right, (float, int)) and left == right
    )


def source_timestamp(value: Any, *, legacy: bool = False) -> datetime | None:
    if not isinstance(value, str):
        return None
    if legacy and re.fullmatch(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?", value):
        value += "Z"
    if not _TIMESTAMP.fullmatch(value):
        return None
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return result.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        return None


def _utc_timestamp(value: datetime | str) -> str:
    if isinstance(value, datetime):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("An explicit source timezone is required")
        result = value.astimezone(timezone.utc)
    else:
        result = source_timestamp(value)
    if result is None:
        raise ValueError("An explicit RFC3339 source timestamp is required")
    return result.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def make_capture_context(*, symbol: str, market: str | None, source: str, producer: str,
                         provider_symbol: str, observed_at: datetime | str,
                         source_payload: Any, source_revision: Any = None,
                         capture_id: str | None = None) -> dict:
    """Call only after an actual acquisition; pass its retained source subset."""
    if not all(isinstance(v, str) and v.strip() for v in (symbol, source, producer, provider_symbol)):
        raise ValueError("Capture security, source, producer and provider symbol are required")
    payload = _json_copy(source_payload)
    return {"symbol": symbol, "market": market, "source": source, "producer": producer,
            "provider_symbol": provider_symbol, "observed_at": _utc_timestamp(observed_at),
            "source_revision": _json_copy(source_revision), "capture_id": capture_id or str(uuid4()),
            "raw_payload_sha256": _digest(payload), "source_payload": payload,
            "raw_payload_availability": "retained_normalized_subset"}


def observation_id(record: Mapping[str, Any]) -> str:
    """Bind all record semantics and original source subset; exclude audit labels."""
    return "sha256:" + _digest({k: v for k, v in record.items() if k not in {"observation_id", "selection_reasons", "source_payload"}})


def make_observed_record(field: str, value: Any, context: Mapping[str, Any], *,
                         unit: str | None, basis: str | None, period_end: str | None = None,
                         comparable_period_end: str | None = None, cadence: str | None = None,
                         metric: str | None = None, periods_used: Any = None,
                         period_status: str = "not_supplied", **extra: Any) -> dict:
    if field not in FINANCIAL_FIELDS or not valid_value(field, value):
        raise ValueError("Unsupported field or non-finite financial value")
    protected = {"field", "value", "symbol", "market", "source", "producer", "provider_symbol",
                 "observed_at", "provenance_kind", "observation_id", "capture_id", "raw_payload_sha256"}
    if protected.intersection(extra):
        raise ValueError("Extra metadata cannot replace observation identity")
    record = {**_json_copy(dict(context)), **_json_copy(extra), "field": field,
              "value": _json_copy(value), "unit": unit, "basis": basis,
              "period_end": period_end, "comparable_period_end": comparable_period_end,
              "cadence": cadence, "metric": metric, "periods_used": _json_copy(periods_used),
              "period_status": period_status, "provenance_kind": "observed"}
    record["observation_id"] = observation_id(record)
    _validate_record(field, record)
    return record


def make_derived_record(field: str, value: Any, *, symbol: str, market: str | None,
                        source: str, producer: str, unit: str | None, basis: str | None,
                        dependencies: Any, algorithm_version: str,
                        computed_at: datetime | str, **extra: Any) -> dict:
    if field not in FINANCIAL_FIELDS or not valid_value(field, value):
        raise ValueError("Unsupported field or non-finite financial value")
    record = {**_json_copy(extra), "field": field, "value": _json_copy(value), "symbol": symbol,
              "market": market, "source": source, "producer": producer, "unit": unit,
              "basis": basis, "dependencies": _json_copy(dependencies),
              "algorithm_version": algorithm_version, "computed_at": _utc_timestamp(computed_at),
              "observed_at": None, "provenance_kind": "derived"}
    record["observation_id"] = observation_id(record)
    _validate_record(field, record)
    return record


def _validate_record(field: str, record: Any) -> None:
    if not isinstance(record, dict) or record.get("field") != field or not valid_value(field, record.get("value")):
        raise ValueError("Invalid financial observation value/field")
    if record.get("observation_id") != observation_id(record):
        raise ValueError("Financial observation digest mismatch")
    if not isinstance(record.get("symbol"), str) or not record["symbol"].strip():
        raise ValueError("Financial observation has no security identity")
    kind = record.get("provenance_kind")
    if kind == "observed":
        if source_timestamp(record.get("observed_at")) is None:
            raise ValueError("Observed records require an explicit source timestamp")
        for key in ("source", "producer", "provider_symbol", "capture_id", "raw_payload_sha256"):
            if not isinstance(record.get(key), str) or not record[key].strip():
                raise ValueError(f"Observed record requires {key}")
        if not re.fullmatch(r"[a-f0-9]{64}", record["raw_payload_sha256"]):
            raise ValueError("Invalid source subset digest")
        if "source_payload" in record and _digest(record["source_payload"]) != record["raw_payload_sha256"]:
            raise ValueError("Source subset does not match acquisition digest")
    elif kind == "derived":
        if record.get("observed_at") is not None or not record.get("algorithm_version") or not record.get("dependencies"):
            raise ValueError("Derived records require dependencies, algorithm and no observation clock")
        if source_timestamp(record.get("computed_at")) is None:
            raise ValueError("Derived records require an explicit calculation timestamp")
    elif kind != "legacy_canonical_map":
        raise ValueError("Unsupported financial provenance kind")


def make_envelope(*, symbol: str | None, market: str | None, fields: dict,
                  legacy_statement_context: dict | None = None) -> dict:
    envelope = {"schema": SCHEMA, "symbol": symbol, "market": market,
                "fields": _json_copy(fields), "retained_candidates": {}}
    envelope["captures"] = {}
    for record in envelope["fields"].values():
        _compact_capture(record, envelope["captures"])
    if legacy_statement_context is not None:
        envelope["legacy_statement_context"] = _json_copy(legacy_statement_context)
    validate_envelope(envelope)
    return envelope



def _compact_capture(record: dict, captures: dict) -> None:
    if record.get("provenance_kind") != "observed" or "source_payload" not in record:
        return
    capture_id = record["capture_id"]
    capture = {"source_payload": record.pop("source_payload"), "raw_payload_sha256": record["raw_payload_sha256"]}
    if capture_id in captures and captures[capture_id] != capture:
        raise ValueError("Conflicting source subsets for capture_id")
    captures[capture_id] = capture


def _validate_capture(record: dict, captures: dict) -> None:
    if record.get("provenance_kind") != "observed" or "source_payload" in record:
        return
    capture = captures.get(record.get("capture_id")) if isinstance(captures, dict) else None
    if not isinstance(capture, dict) or capture.get("raw_payload_sha256") != record.get("raw_payload_sha256") or _digest(capture.get("source_payload")) != record.get("raw_payload_sha256"):
        raise ValueError("Missing or mismatched retained source subset")

def validate_envelope(envelope: Any) -> dict:
    """Strict constructor/transport validation; semantic qualification is separate."""
    clean = _json_copy(envelope)
    if not isinstance(clean, dict) or clean.get("schema") != SCHEMA or not isinstance(clean.get("fields"), dict):
        raise ValueError("Unsupported financial evidence envelope")
    for field, record in clean["fields"].items():
        if field not in FINANCIAL_FIELDS:
            raise ValueError("Unsupported selected financial field")
        _validate_record(field, record)
        _validate_capture(record, clean.get("captures", {}))
        if record.get("symbol") != clean.get("symbol") or record.get("market") != clean.get("market"):
            raise ValueError("Observation/envelope security mismatch")
    candidates = clean.get("retained_candidates", {})
    if not isinstance(candidates, dict):
        raise ValueError("Candidates must be a field map")
    for field, records in candidates.items():
        if field not in FINANCIAL_FIELDS or not isinstance(records, list):
            raise ValueError("Invalid candidate field/list")
        for record in records:
            _validate_record(field, record)
            _validate_capture(record, clean.get("captures", {}))
    return clean


def _value(payload: Mapping[str, Any], field: str) -> Any:
    return payload.get(field)


def _has_value(payload: Mapping[str, Any], field: str) -> bool:
    return field in payload


def legacy_financial_evidence(payload: Mapping[str, Any], *, symbol: str | None = None,
                              market: str | None = None) -> dict:
    """Diagnostic adapter only. Never guess units, periods, basis or a new clock."""
    fields = {}
    symbol = symbol or payload.get("symbol")
    for field in FINANCIAL_FIELDS:
        value = _value(payload, field)
        if not symbol or not valid_value(field, value):
            continue
        provenance = payload.get("field_provenance")
        source = provenance.get(field) if isinstance(provenance, dict) else None
        timestamp_key = ("yahoo_statements_refreshed_at" if field in _STATEMENT_FIELDS else "yahoo_profile_refreshed_at") if source == "yfinance" else "finviz_snapshot_at" if source == "finviz" else None
        record = {"field": field, "value": _json_copy(value), "symbol": symbol, "market": market,
                  "source": source, "producer": None, "provider_symbol": None,
                  "observed_at": payload.get(timestamp_key) if timestamp_key else None,
                  "timestamp_key": timestamp_key, "unit": None, "basis": None,
                  "period_end": None, "comparable_period_end": None, "period_status": "not_supplied",
                  "provenance_kind": "legacy_canonical_map"}
        if isinstance(record["observed_at"], datetime):
            record["observed_at"] = record["observed_at"].isoformat()
        record["observation_id"] = observation_id(record)
        fields[field] = record
    return make_envelope(symbol=symbol, market=market, fields=fields,
                         legacy_statement_context={k: payload.get(k) for k in CONTEXT_KEYS})


def _bound_record(payload: Mapping[str, Any], field: str, symbol: str | None, market: str | None) -> dict | None:
    envelope = payload.get("financial_source_evidence")
    if not isinstance(envelope, dict) or envelope.get("schema") != SCHEMA or envelope.get("symbol") != symbol or envelope.get("market") != market:
        return None
    record = envelope.get("fields", {}).get(field) if isinstance(envelope.get("fields"), dict) else None
    try:
        _validate_record(field, record)
        _validate_capture(record, envelope.get("captures", {}))
    except (ValueError, TypeError):
        return None
    if record.get("symbol") != symbol or record.get("market") != market or not equal_value(record.get("value"), _value(payload, field)):
        return None
    for alias, canonical in ALIASES.items():
        if canonical == field and alias in payload and payload[alias] is not None and not equal_value(payload[alias], payload.get(field)):
            return None  # conflicting legacy aliases cannot qualify a source pair
    return deepcopy(record)



def restore_retained_raw_envelope(envelope: Mapping[str, Any], artifact_id: str) -> Any:
    """Reconstruct an original source envelope from the same stored JSON object."""
    artifact = deepcopy(envelope["retained_raw_envelopes"][artifact_id])
    if not isinstance(artifact, dict) or artifact.get("archive_encoding") != "inline-capture-references-v1":
        return artifact
    original = artifact["envelope"]
    original["captures"] = {}
    for capture_id, digest in artifact["capture_references"].items():
        capture = envelope.get("captures", {}).get(capture_id)
        if not isinstance(capture, dict) or _digest(capture) != digest:
            capture = envelope.get("retained_capture_variants", {}).get(digest)
        if not isinstance(capture, dict) or _digest(capture) != digest:
            raise ValueError("Retained source envelope has an unresolved capture reference")
        original["captures"][capture_id] = deepcopy(capture)
    return original


def _archive_source_envelope(original: Any) -> Any:
    """Reference source subsets locally; do not duplicate a table per archive."""
    if not isinstance(original, dict):
        return original
    original = deepcopy(original)
    original.pop("storage_revision", None)  # operational state is not source identity
    captures = original.get("captures")
    if isinstance(captures, dict) and all(isinstance(c, dict) for c in captures.values()):
        original.pop("captures")
        return {"archive_encoding": "inline-capture-references-v1", "envelope": original,
                "capture_references": {capture_id: _digest(capture) for capture_id, capture in captures.items()}}
    return original

def merge_financial_payloads(primary: Mapping[str, Any], fallback: Mapping[str, Any], *,
                             symbol: str | None = None, market: str | None = None) -> dict:
    """Select value/evidence together without changing legacy scalar preference.

    Missing/null primary values use fallback. New explicit raw values without a
    matching observation become legacy unknown, including equal-number overlays.
    Originals remain reconstructible from retained_raw_envelopes and the shared
    capture pool. Non-finite legacy scalars remain raw in the returned payload;
    their audit JSON uses an explicit non_finite_number diagnostic object.
    """
    symbol = symbol or primary.get("symbol") or fallback.get("symbol")
    market = market or primary.get("market") or fallback.get("market")
    for owner in (primary, fallback):
        if owner.get("symbol") is not None and symbol is not None and owner["symbol"] != symbol:
            raise ValueError("Cannot merge financial payloads for different symbols")
        if owner.get("market") is not None and market is not None and owner["market"] != market:
            raise ValueError("Cannot merge financial payloads for different markets")
    merged = deepcopy(dict(primary))
    for key, value in fallback.items():
        if merged.get(key) is None:
            merged[key] = deepcopy(value)
    if symbol is not None:
        merged["symbol"] = symbol
    if market is not None:
        merged["market"] = market
    if not fallback and isinstance(primary.get("financial_source_evidence"), dict):
        try:
            existing = validate_envelope(primary["financial_source_evidence"])
            raw = existing.get("raw_values")
            if (existing.get("symbol") == symbol and existing.get("market") == market
                    and isinstance(raw, dict)
                    and all(equal_value(raw.get(field), _value(primary, field))
                            or raw.get(field) is None and _value(primary, field) is None
                            for field in FINANCIAL_FIELDS if _has_value(primary, field))
                    and all(_bound_record(primary, field, symbol, market) is not None
                            for field in existing["fields"])):
                return merged
        except (ValueError, TypeError):
            pass
    fields, candidates, raw_envelopes, captures, capture_variants = {}, {}, {}, {}, {}
    legacy = [legacy_financial_evidence(owner, symbol=symbol, market=market) for owner in (primary, fallback)]
    for owner in (primary, fallback):
        envelope = owner.get("financial_source_evidence")
        if envelope is not None:
            original = _audit_json(envelope)
            if isinstance(original, dict):
                original_variants = original.get("retained_capture_variants")
                if isinstance(original_variants, dict):
                    capture_variants.update(deepcopy(original_variants))
                original_captures = original.get("captures")
                if isinstance(original_captures, dict):
                    for capture_id, capture in original_captures.items():
                        if capture_id in captures and captures[capture_id] != capture:
                            for variant in (captures[capture_id], capture):
                                if isinstance(variant, dict):
                                    capture_variants[_digest(variant)] = deepcopy(variant)
                            captures[capture_id] = None
                        else:
                            captures[capture_id] = deepcopy(capture)
                prior_raw = original.get("retained_raw_envelopes")
                if isinstance(prior_raw, dict):
                    for raw in prior_raw.values():
                        raw_envelopes[_digest(raw)] = deepcopy(raw)
                # A merge result already carries all its original source
                # envelopes. Archiving that cumulative result is quadratic.
                is_merged = original.get("merge_policy") == "shadow-non-null-primary-v1" and isinstance(prior_raw, dict)
            else:
                is_merged = False
            if not is_merged:
                archived = _archive_source_envelope(original)
                raw_envelopes[_digest(archived)] = archived
        context = {"symbol": owner.get("symbol", symbol), "market": owner.get("market", market),
                   "raw_values": {field: _value(owner, field) for field in FINANCIAL_FIELDS if _has_value(owner, field)},
                   "raw_alias_values": {key: owner[key] for key in ALIASES if key in owner},
                   "legacy_statement_context": {k: owner.get(k) for k in CONTEXT_KEYS},
                   "field_provenance": owner.get("field_provenance"),
                   "source_clocks": {k: owner.get(k) for k in ("yahoo_statements_refreshed_at", "yahoo_profile_refreshed_at", "finviz_snapshot_at")}}
        # Operational payload datetimes are context only, never promoted.
        context = _audit_json(context)
        if context["raw_values"]:
            raw_envelopes[_digest(context)] = context
    raw_values = {}
    for field in FINANCIAL_FIELDS:
        owner_index = 0 if _value(primary, field) is not None else 1
        owner = (primary, fallback)[owner_index]
        if _has_value(owner, field):
            merged[field] = deepcopy(_value(owner, field))
            raw_values[field] = _audit_json(merged[field])
        selected = _bound_record(owner, field, symbol, market) or legacy[owner_index]["fields"].get(field)
        if selected is not None:
            try:
                _compact_capture(selected, captures)
                _validate_capture(selected, captures)
            except (ValueError, TypeError):
                selected = legacy[owner_index]["fields"].get(field)
            if selected is not None:
                fields[field] = selected
        retained = {}
        for index, source_owner in enumerate((primary, fallback)):
            envelope = source_owner.get("financial_source_evidence")
            prior = envelope.get("retained_candidates", {}).get(field, []) if isinstance(envelope, dict) and isinstance(envelope.get("retained_candidates"), dict) else []
            record = _bound_record(source_owner, field, symbol, market) or legacy[index]["fields"].get(field)
            if not isinstance(prior, list):
                prior = []
            for candidate in [*prior, *([record] if record else [])]:
                try:
                    _validate_record(field, candidate)
                except (ValueError, TypeError):
                    continue  # original invalid record remains in raw envelope
                item = deepcopy(candidate)
                try:
                    _compact_capture(item, captures)
                    _validate_capture(item, captures)
                except (ValueError, TypeError):
                    continue
                key = item["observation_id"]
                reason = "selected_primary" if owner_index == index == 0 else "selected_fallback" if owner_index == index == 1 else "retained_shadow_candidate"
                prior_reasons = item.get("selection_reasons")
                prior_reasons = [r for r in prior_reasons if isinstance(r, str)] if isinstance(prior_reasons, list) else []
                reasons = set(prior_reasons) | set(retained.get(key, {}).get("selection_reasons", [])) | {reason}
                item["selection_reasons"] = sorted(reasons)
                retained[key] = item
        if retained:
            candidates[field] = list(retained.values())
    envelope = {"schema": SCHEMA, "symbol": symbol, "market": market, "fields": fields,
                "retained_candidates": candidates, "raw_values": raw_values,
                "retained_raw_envelopes": raw_envelopes, "captures": captures,
                "retained_capture_variants": capture_variants, "merge_policy": "shadow-non-null-primary-v1"}
    # Selected legacy context remains context; all originals are also retained.
    context_owner = primary if any(k in primary for k in CONTEXT_KEYS) else fallback
    envelope["legacy_statement_context"] = _audit_json({k: context_owner.get(k) for k in CONTEXT_KEYS})
    merged["financial_source_evidence"] = validate_envelope(envelope)
    return merged


def field_availability(field: str, value: Any, record: dict | None, now: datetime | str,
                       *, approved_contracts: Mapping[str, set[tuple[str, str, str]]] | None = None,
                       observations: Mapping[str, dict] | None = None,
                       captures: Mapping[str, dict] | None = None,
                       _visited: frozenset[str] = frozenset()) -> dict:
    """Optional pure evaluation. Stage 1 enables no producer/basis/unit contracts."""
    def unavailable(reason: str) -> dict:
        return {"status": "unknown", "reason": reason}
    if field in QUARANTINED_FIELDS:
        return unavailable("unverified_derivation_and_cohort")
    if not valid_value(field, value):
        return unavailable("missing_or_invalid_value")
    try:
        _validate_record(field, record)
        _validate_capture(record, captures)
    except (ValueError, TypeError):
        return unavailable("missing_or_mismatched_evidence")
    if not equal_value(value, record["value"]):
        return unavailable("missing_or_mismatched_evidence")
    try:
        evaluated_at = source_timestamp(_utc_timestamp(now))
    except (ValueError, TypeError):
        return unavailable("invalid_evaluation_time")
    kind = record["provenance_kind"]
    if field == "eps_raw_score" and kind != "derived":
        return unavailable("unverified_derivation")
    if not isinstance(record.get("source"), str) or not record["source"].strip() or record["source"] == "unknown":
        return unavailable("missing_source")
    if kind == "derived":
        if record["observation_id"] in _visited:
            return unavailable("cyclic_dependencies")
        dependencies = record.get("dependencies")
        if not isinstance(dependencies, list) or not dependencies:
            return unavailable("unverified_dependencies")
        for dependency_id in dependencies:
            dependency = (observations or {}).get(dependency_id)
            if not isinstance(dependency, dict):
                return unavailable("unverified_dependencies")
            if dependency.get("symbol") != record.get("symbol") or dependency.get("market") != record.get("market"):
                return unavailable("unverified_dependency_identity")
            result = field_availability(dependency.get("field"), dependency.get("value"), dependency, now,
                                        approved_contracts=approved_contracts, observations=observations,
                                        captures=captures,
                                        _visited=_visited | {record["observation_id"]})
            if result["status"] != "available":
                return unavailable("unavailable_dependency")
    else:
        stamp = source_timestamp(record.get("observed_at"), legacy=kind == "legacy_canonical_map")
        if stamp is None:
            return unavailable("missing_or_invalid_source_timestamp")
        age_ms = (evaluated_at - stamp).total_seconds() * 1000
        if age_ms < 0:
            return unavailable("future_source_timestamp")
        if age_ms > SOURCE_POLICY["max_age_ms"]:
            return unavailable("stale_source")
        if kind != "observed":
            return unavailable("unverified_source_lineage")
    if not record.get("market"):
        return unavailable("unverified_market_identity")
    contract = (record.get("producer"), record.get("basis"), record.get("unit"))
    if contract not in (approved_contracts or {}).get(field, set()):
        return unavailable("unapproved_semantic_contract")
    if kind == "observed" and field in _STATEMENT_FIELDS:
        def valid_date(value: Any) -> bool:
            if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
                return False
            try:
                date.fromisoformat(value)
                return True
            except ValueError:
                return False
        if record.get("period_status") != "supplied" or not record.get("metric") or not record.get("cadence"):
            return unavailable("unverified_reporting_period")
        if field in {"annual_eps_growth_3y", "eps_5yr_cagr"}:
            periods = record.get("periods_used")
            if not isinstance(periods, list) or not periods or not all(valid_date(v) for v in periods):
                return unavailable("unverified_reporting_period")
        elif not valid_date(record.get("period_end")) or not valid_date(record.get("comparable_period_end")):
            return unavailable("unverified_reporting_period")
    return {"status": "available", "reason": None}


def project_current_financials(row: Mapping[str, Any], *, now: datetime | str,
                               approved_contracts: Mapping[str, set[tuple[str, str, str]]] | None = None) -> dict:
    """Pure test/review seam only. Never invoked by the stage-1 cache or producers."""
    current, availability, raw = deepcopy(dict(row)), {}, {}
    envelope = row.get("financial_source_evidence")
    observations = {}
    if isinstance(envelope, dict):
        selected = envelope.get("fields")
        for record in (selected.values() if isinstance(selected, dict) else []):
            if isinstance(record, dict):
                observations[record.get("observation_id")] = record
        retained = envelope.get("retained_candidates")
        for records in (retained.values() if isinstance(retained, dict) else []):
            for record in (records if isinstance(records, list) else []):
                if isinstance(record, dict):
                    observations[record.get("observation_id")] = record
    for field in FINANCIAL_FIELDS:
        value = _value(row, field)
        if _has_value(row, field):
            raw[field] = deepcopy(value)
        record = _bound_record(row, field, row.get("symbol"), row.get("market"))
        availability[field] = field_availability(field, value, record, now,
                                                  approved_contracts=approved_contracts, observations=observations,
                                                  captures=envelope.get("captures") if isinstance(envelope, dict) else None)
        current[field] = value if availability[field]["status"] == "available" else None
    for alias, canonical in ALIASES.items():
        current[alias] = current[canonical]
    current.pop("method_summary", None)
    try:
        evaluated_at = _utc_timestamp(now)
    except (ValueError, TypeError):
        evaluated_at = None
    return {"current": current, "audit": {"policy": SOURCE_POLICY["id"], "evaluated_at": evaluated_at,
                                            "raw_values": raw, "availability": availability,
                                            "source_evidence": deepcopy(envelope)}}
