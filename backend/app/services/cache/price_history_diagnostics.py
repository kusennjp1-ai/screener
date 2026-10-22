"""Caller-owned, best-effort observations for the existing chart sidecar."""

from __future__ import annotations

import hashlib
import json
import os
import uuid
from pathlib import Path

from .price_history_integrity import _coherent_history_decision
from ..price_fetch_failures import classify_price_fetch_error


def new_observations(market, run_id=None):
    return {
        "schema_version": "price-pipeline-observations-v1",
        "market": str(market).upper(),
        "run_id": str(run_id or os.environ.get("GITHUB_RUN_ID") or uuid.uuid4().hex),
        "events": [],
    }


def scoped(observations, **context):
    if observations is None:
        return None
    try:
        return {"events": observations["events"],
                "context": {**observations.get("context", {}), **context}}
    except Exception:
        return None


def observe(observations, stage, *, frame=None, rows=None, **fields):
    """No prices, raw provider/DB error text, queries, or writes to product data."""
    if observations is None:
        return
    try:
        event = {**observations.get("context", {}), "stage": stage, **fields}
        for key, value in tuple(event.items()):
            if hasattr(value, "isoformat"):
                event[key] = value.isoformat()
        if frame is not None:
            try:
                event["row_count"] = len(frame)
                if not frame.empty:
                    event["min_date"] = str(frame.index.min())
                    event["max_date"] = str(frame.index.max())
            except Exception:
                event["frame_summary_unavailable"] = True
        if rows is not None:
            event["row_count"] = len(rows)
            if rows:
                event["min_date"] = str(rows[0].date)
                event["max_date"] = str(rows[-1].date)
        observations["events"].append(event)
    except Exception:
        pass


def observe_fetch_failure(observations, symbol, payload):
    if observations is None:
        return
    try:
        kind = classify_price_fetch_error(str(payload.get("error") or ""))
        observe(observations, "refresh_fetch", symbol=symbol, status="failed",
                failure_kind=kind.value if kind else None)
    except Exception:
        pass


def observe_missing_responses(observations, symbols, results):
    if observations is None:
        return
    try:
        for symbol in symbols:
            if symbol not in results:
                kind = classify_price_fetch_error("missing from results")
                observe(observations, "refresh_fetch", symbol=symbol,
                        status="missing_response", failure_kind=kind.value)
    except Exception:
        pass


def observe_manifest(observations, manifest):
    if observations is None or not isinstance(manifest, dict):
        return
    try:
        observations["input"] = {
            "sha256": manifest.get("sha256"), "source_revision": manifest.get("source_revision"),
            "market": manifest.get("market"), "as_of_date": manifest.get("as_of_date"),
            "hash_basis": "manifest_metadata", "download_hash_verified": False,
        }
    except Exception:
        pass


def observed_coherent_batch(batch_data, observations, stage):
    """Replace each existing predicate call once; retain order and exceptions."""
    accepted = {}
    for symbol, frame in batch_data.items():
        try:
            valid, rejection = _coherent_history_decision(frame)
        except Exception as error:
            observe(observations, stage, symbol=symbol, status="predicate_error",
                    exception_type=type(error).__name__)
            raise
        observe(observations, stage, symbol=symbol, frame=frame,
                status="accepted" if valid else "rejected", rejection=rejection)
        if valid:
            accepted[symbol] = frame
    return accepted


def observe_input(observations, path, payload, *, verified_sha256=None):
    if observations is None:
        return
    try:
        digest = hashlib.sha256()
        size = 0
        with Path(path).open("rb") as handle:
            for chunk in iter(lambda: handle.read(1024 * 1024), b""):
                digest.update(chunk)
                size += len(chunk)
        observations["input"] = {
            "sha256": digest.hexdigest(), "bytes": size,
            "source_revision": payload.get("source_revision"),
            "market": payload.get("market"), "as_of_date": payload.get("as_of_date"),
            "hash_basis": "local_file_after_parse",
            "download_hash_verified": verified_sha256 == digest.hexdigest(),
        }
        observe(observations, "seed_input", status="parsed",
                input_symbols=len(payload.get("rows") or []))
    except Exception:
        observe(observations, "seed_input", status="hash_observation_unavailable")


def load_prior_observations(output_dir, observations, *, sha256=None, source_revision=None):
    """Carry only explicitly bound same-run/market/seed evidence across clean."""
    if observations is None:
        return
    try:
        market = observations["market"]
        root = Path(output_dir) / "diagnostics"
        directory = root / market.lower()
        path = directory / "cache-only-chart-omissions.json"
        if not sha256 or not source_revision or not path.exists():
            return
        if any(p.is_symlink() for p in (root, directory, path)):
            return
        report = json.loads(path.read_text())
        previous = report.get("pipeline_observations", {})
        identity = previous.get("input", {})
        if (report.get("market") != market
                or previous.get("schema_version") != observations["schema_version"]
                or previous.get("market") != market
                or previous.get("run_id") != observations["run_id"]
                or identity.get("market") != market
                or identity.get("sha256") != sha256
                or identity.get("source_revision") != source_revision):
            observe(observations, "prior_link", status="context_mismatch")
            return
        # Only this market's same-run evidence is carried. The old omission map
        # and old export success are deliberately not inherited.
        observations["input"] = identity
        observations["events"].extend(previous.get("events", []))
        observe(observations, "prior_link", status="matched")
    except Exception:
        observe(observations, "prior_link", status="unavailable")
