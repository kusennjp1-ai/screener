"""Export an immutable financial correction from a pinned local statement archive.

This adapter replays original frames; it never constructs a provider, reads a
collector result cache, refreshes a source clock, or selects a smaller universe.
Run from backend with ``python -m app.scripts.export_statement_projection``.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
import json
from pathlib import Path
import re
import unicodedata

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services.financial_source_evidence import (
    ALIASES, CONTEXT_KEYS, FINANCIAL_FIELDS, observation_id, validate_envelope,
)
from app.services.static_financial_evidence import build_static_financial_current

SCHEMA = "financial-statement-projection-v1"
KNOWLEDGE_BASIS = "current_observation_at_source_capture"
OWNED_FIELDS = (*FINANCIAL_FIELDS, *ALIASES, *CONTEXT_KEYS)
MAX_PROJECTION_BYTES = 256 * 1024 * 1024
ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "contracts" / "financial_correction_v1.json"
APPLICABILITY_PATH = ROOT / "contracts" / "financial_instrument_applicability_v1.json"
_PUBLICATION_ID = re.compile(r"[1-9][0-9]*/[1-9][0-9]*/[a-f0-9]{64}/[a-f0-9]{64}")
# Bind the arithmetic, source validation, projection and policy, not just this
# thin command wrapper. The controller separately binds the exact source SHA.
PROJECTOR_FILES = (
    "backend/app/scripts/export_statement_projection.py",
    "backend/app/services/statement_artifact_archive.py",
    "backend/app/services/financial_statement_batch.py",
    "backend/app/services/financial_source_capture.py",
    "backend/app/services/financial_source_evidence.py",
    "backend/app/services/static_financial_evidence.py",
    "backend/app/services/growth_cadence_service.py",
    "backend/app/services/eps_rating_service.py",
    "backend/app/services/quarterly_eps_selection.py",
    "backend/app/services/statement_refresh_planning.py",
    "contracts/static_financial_current_v1.json",
    "contracts/financial_source_evidence_v1.json",
    "contracts/financial_instrument_applicability_v1.json",
)


def canonical_bytes(value):
    return json.dumps(value, allow_nan=False, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":")).encode("utf-8")


def content_digest(value):
    return batch.digest_bytes(canonical_bytes(value))


def instrument_registry():
    registry, _ = archive._read(APPLICABILITY_PATH)
    if registry.get("schema_version") != "financial-instrument-applicability-v1":
        raise ValueError("Unsupported financial instrument applicability registry")
    records = {}
    for item in registry.get("records", []):
        if (item.get("symbol") in records or item.get("market") != "US"
                or not batch.canonical_symbol(item.get("symbol"))
                or item.get("corporate_growth_screen_applicability") != "not_applicable"
                or item.get("instrument_class") not in {"exchange_traded_fund", "exchange_traded_product"}
                or not isinstance(item.get("name"), str)
                or not isinstance(item.get("source"), str) or not item["source"].startswith("https://")):
            raise ValueError("Malformed reviewed financial applicability record")
        records[item["symbol"]] = {**item, "registry_verified_at": registry["verified_at"]}
    return records


def instrument_context(symbol, records, target_row):
    record = records.get(symbol)
    target_name = target_row.get("company_name", target_row.get("name"))
    applicability = {
        "version": "financial-instrument-applicability-v1", "status": "unverified",
        "instrument_class": "unknown", "reason": "instrument_type_unverified", "identity_binding": "unverified",
    }
    supplied_ids = {key: target_row.get(key, target_row.get("issuer_cik") if key == "cik" else None)
                    for key in ("cusip", "isin", "cik")}
    identity = {
        "status": "ticker_only", "market": "US", "symbol": symbol,
        "observed_name": target_name if isinstance(target_name, str) else None,
        "registry_name": record["name"] if record else None,
        "registry_identifiers": {key: record[key] for key in ("cik", "cusip", "isin") if key in record} if record else {},
        "observed_identifiers": {key: value for key, value in supplied_ids.items() if value is not None},
        "identifiers_bound_to_price": False,
        "identifiers_bound_to_financial_receipts": False,
        "identity_match_limit": record["identity_match_limit"] if record else (
            "Symbol and market match only. No reviewed instrument identifier binds the price series or financial receipts; issuer identity is unverified."),
    }
    if record:
        contexts = [target_row, target_row.get("financial_identity"), target_row.get("instrument_identity"),
                    (target_row.get("financial_source_evidence") or {}).get("identity"),
                    target_row.get("financial_history"), target_row.get("book_financials"),
                    target_row.get("institutional_evidence")]
        contexts = [value for value in contexts if isinstance(value, dict)]
        text = lambda value: isinstance(value, str) and bool(value.strip())
        normalize_name = lambda value: " ".join(unicodedata.normalize("NFKC", value).split()).lower()
        names = [name for value in contexts for name in (
            value.get("company_name"), value.get("product_name"), value.get("observed_name"),
            value.get("name") if value is target_row or value is target_row.get("instrument_identity") else None) if text(name)]
        conflicts = []
        if target_row.get("market") != record["market"] or any(value.get("market") not in (None, record["market"]) for value in contexts):
            conflicts.append("market_conflict")
        if any(value.get("symbol") not in (None, record["symbol"]) for value in contexts):
            conflicts.append("symbol_conflict")
        if not names:
            conflicts.append("missing_product_name")
        elif any(normalize_name(value) != normalize_name(record["name"]) for value in names):
            conflicts.append("product_name_conflict")
        matched = []
        for kind in ("cusip", "isin", "cik"):
            def identifier(value):
                if not text(value) and not (kind == "cik" and type(value) is int and 0 <= value <= 9007199254740991):
                    return None
                normalized = str(value).strip().upper()
                return normalized.zfill(10) if kind == "cik" and re.fullmatch(r"[0-9]{1,10}", normalized) else normalized
            expected = identifier(record.get(kind))
            values = [entry for value in contexts for entry in (
                value.get(kind), value.get("issuer_cik") if kind == "cik" else None,
                (value.get("observed_identifiers") or {}).get(kind)) if entry is not None and entry != ""]
            if expected and any(identifier(value) != expected for value in values):
                conflicts.append(f"{kind}_conflict")
            elif expected and values:
                matched.append(kind)
        applicability.update(source=record["source"], verified_at=record["registry_verified_at"],
                             registry_name=record["name"], identity_match_limit=record["identity_match_limit"])
        if conflicts:
            applicability.update(status="quarantined", reason="instrument_identity_conflict", identity_conflicts=conflicts)
        else:
            applicability.update(status="not_applicable", instrument_class=record["instrument_class"],
                                 reason="verified_fund_not_corporate_growth",
                                 identity_binding="ticker_name_and_available_identifiers" if matched else "ticker_name_only",
                                 matched_identifiers=matched)
    return applicability, identity


def apply_instrument_context(item, symbol, records, *, target_row, now, as_of):
    applicability, identity = instrument_context(symbol, records, target_row)
    item.update(instrument_applicability=applicability, financial_identity=identity)
    if applicability["status"] == "unverified":
        return
    item["financial_values"] = {field: None for field in OWNED_FIELDS}
    item["financial_current"] = build_static_financial_current(
        {"symbol": symbol, "market": "US", **item["financial_values"]}, now=now, as_of_date=as_of, market="US")
    item["financial_history"].update(status="unavailable", retrieved_at=None, annual=[], quarterly=[])
    reason = "not_applicable" if applicability["status"] == "not_applicable" else "instrument_identity_conflict"
    item["source_diagnostics"] = {
        "fields": {field: reason for field in FINANCIAL_FIELDS}, "annual_history": reason}
    item["history_source_diagnostics"] = {
        "reasons": {"annual": reason, "quarterly": reason}, "original_receipts": []}


def policy_identity():
    contract, content = archive._read(CONTRACT_PATH)
    if (contract.get("schema_version") != "financial-correction-v1"
            or contract.get("projection_schema") != SCHEMA
            or contract.get("knowledge_basis") != KNOWLEDGE_BASIS
            or contract.get("financial_fields") != list(OWNED_FIELDS)
            or not isinstance(contract.get("policy_id"), str)
            or not contract["policy_id"]):
        raise ValueError("Correction contract and projector ownership disagree")
    hashes = {path: batch.digest_bytes(archive._safe(ROOT / path).read_bytes())
              for path in PROJECTOR_FILES}
    return contract, {"id": contract["policy_id"],
                      "contract_sha256": batch.digest_bytes(content),
                      "projector_sha256": content_digest(hashes)}


def _bound_input(path, expected_sha256, maximum):
    archive._sha(expected_sha256)
    value, content = archive._read(path, maximum)
    if batch.digest_bytes(content) != expected_sha256:
        raise ValueError(f"Input digest mismatch: {Path(path).name}")
    return value, content


def _base_semantics(base, contract):
    """Index all original unowned row inputs, including price/liquidity aliases."""
    rows = base.get("rows", base.get("results"))
    if not isinstance(rows, list) or ("rows" in base and "results" in base):
        raise ValueError("Base requires one unambiguous full security row list")
    as_of = batch.day(base.get("as_of_date")).isoformat()
    financial = set(OWNED_FIELDS) | set(contract["financial_context_fields"]) | set(contract["financial_derived_fields"])
    indexed = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Malformed base security row")
        symbol, market = row.get("symbol"), row.get("market", base.get("market"))
        if (not isinstance(symbol, str) or not symbol or symbol in indexed
                or not isinstance(market, str) or not market):
            raise ValueError("Duplicate or malformed base symbol/market identity")
        row_date = batch.day(row.get("as_of_date", as_of)).isoformat()
        indexed[symbol] = {**{key: value for key, value in row.items() if key not in financial},
                           "symbol": symbol, "market": market, "as_of_date": row_date}
    markets = {row["market"] for row in indexed.values()}
    market = base.get("market", next(iter(markets)) if len(markets) == 1 else None)
    return {"as_of_date": as_of, "market": market, "rows": indexed}


def verify_target_base(base, target, contract):
    """Prove the full source universe and its original inputs survive promotion.

    Acquisition base rows are a reduced projection of the published research
    index (currently symbol, market, current_price and adv_usd). The target can
    add consumer metadata, but cannot drop/change any original nonfinancial
    input or identity, including symbols outside the acquisition cohort. The
    controller separately compares all target predecessor-to-final semantics.
    """
    original, current = _base_semantics(base, contract), _base_semantics(target, contract)
    if (original["as_of_date"] != current["as_of_date"]
            or original["market"] != current["market"]
            or original["rows"].keys() != current["rows"].keys()):
        raise ValueError("Target base changes full symbol/market/date identity")
    for symbol, row in original["rows"].items():
        target_row = current["rows"][symbol]
        if (not row.keys() <= target_row.keys()
                or canonical_bytes(row) != canonical_bytes({key: target_row[key] for key in row})):
            raise ValueError("Target base changes original symbol/market/date or nonfinancial price/liquidity inputs")


def _stable_envelope(envelope, receipts):
    """Replay the quarantined derivation at its latest input receipt clock.

    project_symbol's derived audit uses a wall clock. A replay's deterministic
    derivation anchor is the latest selected acquisition, never a new source
    observation; actual evaluation is separately explicit in the proof/output.
    Observed records and captures are copied without any clock substitution.
    """
    result = deepcopy(envelope)
    for record in result["fields"].values():
        if record.get("provenance_kind") == "derived":
            if not receipts:
                raise ValueError("Derived evidence lacks original source receipts")
            record["computed_at"] = max(receipts, key=lambda item: batch.clock(item["observed_at"]))["observed_at"]
            record["observation_id"] = observation_id(record)
    return validate_envelope(result)


def financial_generation(projection):
    """Exclude evaluation-only clocks, preserving actual availability changes."""
    semantic = deepcopy(projection)
    semantic.pop("financial_evaluated_at", None)
    semantic.pop("financial_generation", None)
    # Exact publication/acquisition bindings certify this artifact's destination;
    # they are not financial progress. Rewrapping identical receipts or promoting
    # a consumer cannot create a new financial generation on its own.
    semantic.pop("bindings", None)
    for symbol in semantic["symbols"].values():
        symbol["financial_current"].pop("t", None)
    return content_digest(semantic)


def export_projection(*, archive_dir, archive_sha256, base_path, cohort_path,
                      cohort_sha256, target_base_path, target_base_sha256,
                      target_publication_identity, evaluated_at, output_dir):
    """Verify every binding before writing one content-addressed artifact."""
    now = batch.clock(evaluated_at)
    if (not isinstance(target_publication_identity, str)
            or not _PUBLICATION_ID.fullmatch(target_publication_identity)):
        raise ValueError("An exact target publication run/attempt/receipt/manifest identity is required")
    contract, policy = policy_identity()
    instruments = instrument_registry()
    cohort, _ = _bound_input(cohort_path, cohort_sha256, batch.MAX_ARTIFACT_BYTES)
    base, base_bytes = _bound_input(base_path, cohort.get("base_artifact_sha256"), batch.MAX_BASE_BYTES)
    target, target_bytes = _bound_input(target_base_path, target_base_sha256, batch.MAX_BASE_BYTES)
    binding = archive.verify_base(base_bytes, cohort, now=now)
    target_cohort = {"symbols": cohort["symbols"], "base_artifact_sha256": target_base_sha256}
    archive.verify_base(target_bytes, target_cohort, now=now)
    verify_target_base(base, target, contract)
    target_rows = {row["symbol"]: row for row in target.get("rows", target.get("results"))}
    verified = archive.load_archive(archive_dir, archive_sha256, base_bytes=base_bytes, cohort=cohort, now=now)
    if verified.manifest["binding"] != binding:
        raise ValueError("Archive original acquisition base binding differs from the supplied base")
    result = {
        "schema_version": SCHEMA,
        "financial_evaluated_at": batch.timestamp(now),
        "knowledge_basis": KNOWLEDGE_BASIS, "point_in_time": False,
        "source_publication_date": None,
        "bindings": {"archive_manifest_sha256": archive_sha256,
                     "acquisition_base_sha256": binding["base_artifact_sha256"],
                     "cohort_sha256": cohort_sha256,
                     "target_publication_identity": target_publication_identity,
                     "target_base_sha256": target_base_sha256},
        "policy": policy, "receipt_inventory": [], "symbols": {},
    }
    for symbol in sorted(cohort["symbols"]):
        acquisitions, receipts = {}, []
        for attribute in batch.ATTRIBUTES:
            sha = verified.manifest["current"].get(f"{symbol}/{attribute}")
            if sha is None:
                continue
            item = verified.acquisitions[sha]
            acquisitions[attribute] = item
            context = item["context"]
            receipt = {"attribute": attribute, "receipt_sha256": sha,
                       "capture_id": context["capture_id"],
                       "raw_payload_sha256": context["raw_payload_sha256"],
                       "observed_at": context["observed_at"]}
            receipts.append(receipt)
            result["receipt_inventory"].append({"symbol": symbol, **receipt})
        # Empty acquisition sets deliberately produce unavailable values and
        # empty history too. The prior base is never a fallback source.
        _, projected = archive.project_symbol(symbol, acquisitions, now=now, as_of=binding["source_data_as_of"])
        payload = projected["envelope"]
        values = {field: deepcopy(payload.get(field)) for field in OWNED_FIELDS}
        for alias, canonical in ALIASES.items():
            values[alias] = deepcopy(values[canonical])
        result["symbols"][symbol] = {
            "market": "US", "as_of_date": binding["source_data_as_of"],
            "financial_values": values,
            "financial_source_evidence": _stable_envelope(payload["financial_source_evidence"], receipts),
            "financial_current": projected["financial_current"],
            "financial_history": projected["financial_history"],
            "source_diagnostics": projected["source_diagnostics"],
            "history_source_diagnostics": projected["history_source_diagnostics"],
            "source_receipts": receipts,
        }
        apply_instrument_context(result["symbols"][symbol], symbol, instruments,
                                 target_row={"market": "US", **target_rows[symbol]}, now=now, as_of=binding["source_data_as_of"])
    result["receipt_inventory_sha256"] = content_digest(result["receipt_inventory"])
    result["financial_generation"] = financial_generation(result)
    content = canonical_bytes(result)
    if len(content) > MAX_PROJECTION_BYTES:
        raise ValueError("Projection exceeds the bounded output size")
    sha = batch.digest_bytes(content)
    output = archive._safe(output_dir) / f"statement-projection-{sha}.json"
    archive._write_immutable(output, content)
    return {"projection_path": str(output), "projection_sha256": sha,
            "financial_generation": result["financial_generation"],
            "receipt_inventory_sha256": result["receipt_inventory_sha256"],
            "symbol_count": len(result["symbols"])}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("archive", "archive-sha256", "base", "cohort", "cohort-sha256",
                 "target-base", "target-base-sha256", "target-publication-identity",
                 "evaluated-at", "output-dir"):
        parser.add_argument(f"--{flag}", required=True)
    args = parser.parse_args(argv)
    try:
        summary = export_projection(
            archive_dir=args.archive, archive_sha256=args.archive_sha256,
            base_path=args.base, cohort_path=args.cohort, cohort_sha256=args.cohort_sha256,
            target_base_path=args.target_base, target_base_sha256=args.target_base_sha256,
            target_publication_identity=args.target_publication_identity,
            evaluated_at=args.evaluated_at, output_dir=args.output_dir)
        print(json.dumps(summary, sort_keys=True))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f"Statement projection rejected: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
