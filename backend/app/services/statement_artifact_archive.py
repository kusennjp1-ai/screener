"""Local, cumulative statement receipts and a verified pure-planner adapter.

The trusted input is the manifest digest, never a directory timestamp or a
cached availability flag. Objects retain exact original bytes. A manifest swap
is the only visibility boundary; old objects and manifests are never deleted.
No function in this module constructs a provider, writes a DB or publishes.
"""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, replace
from datetime import datetime, time, timedelta, timezone
import fcntl
import json
import os
from pathlib import Path
import re
import stat
import tempfile

from . import financial_statement_batch as batch
from . import statement_refresh_planning as planning

SCHEMA = "financial-statement-archive-v1"
MAX_MANIFEST_BYTES = 32 * 1024 * 1024
MAX_OBJECTS = 50000
MAX_TOTAL_BYTES = 2 * 1024 * 1024 * 1024
MAX_RECEIPTS = 40000
MAX_ATTEMPTS = 40000
MAX_ARCHIVE_FILES = 60000
MAX_ARCHIVE_BYTES = 3 * 1024 * 1024 * 1024
_HASH = re.compile(r"[a-f0-9]{64}")


class InvalidArchive(ValueError):
    pass


def _sha(value):
    if not isinstance(value, str) or not _HASH.fullmatch(value):
        raise InvalidArchive("An explicit lowercase SHA-256 digest is required")
    return value


def _safe(path):
    """Reject symlinks in every component, including an otherwise safe parent."""
    path = Path(path).absolute()
    for part in (path, *path.parents):
        if part.is_symlink():
            raise InvalidArchive("Symlinks are not permitted in archive inputs or outputs")
        if part.exists():
            mode = part.stat().st_mode
            if not (stat.S_ISREG(mode) or stat.S_ISDIR(mode)):
                raise InvalidArchive("Only regular files and directories are permitted")
    return path


def _read(path, maximum=batch.MAX_ARTIFACT_BYTES):
    try:
        value, content = batch.read_json(_safe(path), maximum)
        if not isinstance(value, dict):
            raise InvalidArchive("Archive artifacts must be JSON objects")
        return value, content
    except (OSError, TypeError, ValueError) as exc:
        raise InvalidArchive(f"Unreadable or malformed bounded artifact: {Path(path).name}") from exc


def _physical_size(root):
    """Include old manifests and crash-orphan objects in the hard disk budget."""
    count = total = 0
    if root.exists():
        for path in root.rglob("*"):
            _safe(path)
            if path.is_file():
                count += 1
                total += path.stat().st_size
                if count > MAX_ARCHIVE_FILES or total > MAX_ARCHIVE_BYTES:
                    raise InvalidArchive("Physical archive capacity exceeded; audit data was not removed")
            elif not path.is_dir():
                raise InvalidArchive("Only regular archive files and directories are permitted")
    return count, total


def _binding(value):
    if not isinstance(value, dict) or set(value) != {"base_artifact_sha256", "source_data_as_of"}:
        raise InvalidArchive("Malformed original base binding")
    _sha(value["base_artifact_sha256"])
    batch.day(value["source_data_as_of"])
    return value


def verify_base(base_bytes, cohort, *, now):
    """Verify the full explicit cohort against original current base bytes."""
    planning._clock(now, "now")
    if not isinstance(cohort, dict) or set(cohort) != {"symbols", "base_artifact_sha256"}:
        raise InvalidArchive("Expected explicit symbols and base_artifact_sha256")
    if not isinstance(base_bytes, bytes) or len(base_bytes) > batch.MAX_BASE_BYTES:
        raise InvalidArchive("Base bytes exceed the bound")
    try:
        base = json.loads(base_bytes, object_pairs_hook=batch._pairs)
        symbols = batch._symbols(cohort["symbols"], maximum=20000)
        probe = {"schema_version": batch.PLAN_SCHEMA, "verified_us_cohort": cohort,
                 "evaluation_time": batch.timestamp(now), "source_data_as_of": base["as_of_date"],
                 "batch_allowlist": symbols[:1],
                 "selected": [{"symbol": symbols[0], "attributes": list(batch.ATTRIBUTES)}]}
        batch.validate_plan(probe, base_bytes)
    except (ValueError, KeyError, TypeError) as exc:
        raise InvalidArchive("Current base/cohort verification failed") from exc
    return {"base_artifact_sha256": cohort["base_artifact_sha256"], "source_data_as_of": base["as_of_date"]}


@dataclass(frozen=True)
class VerifiedArchive:
    root: Path
    sha256: str
    manifest: dict
    objects: dict
    acquisitions: dict


def _validate_attempt(value, *, now):
    if not isinstance(value, dict):
        raise InvalidArchive("Malformed acquisition attempt")
    try:
        attributes = tuple(value["attributes"])
        result = planning.AcquisitionAttempt(
            symbol=value["symbol"], attempt_id=value["attempt_id"],
            attempted_at=batch.clock(value["attempted_at"]), outcome=value["outcome"],
            retry_not_before=batch.clock(value["retry_not_before"]) if value.get("retry_not_before") else None,
            http_status=value.get("http_status"), attributes=attributes)
        if (not batch.canonical_symbol(result.symbol) or not result.attempt_id
                or not isinstance(result.attempt_id, str) or result.attempted_at > now
                or result.outcome not in {"in_flight", "failed", "succeeded", "source_period_missing", "provider_blocked"}
                or not attributes or attributes != tuple(a for a in batch.ATTRIBUTES if a in attributes)
                or (result.http_status is not None and (type(result.http_status) is not int or not 100 <= result.http_status <= 599))
                or (result.retry_not_before is not None and result.retry_not_before <= result.attempted_at)):
            raise InvalidArchive("Invalid acquisition attempt metadata")
        return result
    except (TypeError, KeyError, ValueError) as exc:
        raise InvalidArchive("Invalid acquisition attempt metadata") from exc


def _adapt_attempt(original, source_sha):
    """Keep the original journal separately; expose only planner-owned fields."""
    return {"attempt_id": original["attempt_id"], "symbol": original["symbol"],
            "attributes": original["attributes"], "attempted_at": original["attempted_at"],
            "outcome": "in_flight" if original["outcome"] == "budget_stopped" else original["outcome"],
            "http_status": original.get("http_status"), "source_object_sha256": source_sha}


def load_archive(root, expected_sha256, *, base_bytes, cohort, now):
    """Audit every retained object and original receipt, including old cohorts."""
    _sha(expected_sha256)
    root = _safe(root)
    _physical_size(root)
    current_binding = verify_base(base_bytes, cohort, now=now)
    manifest, content = _read(root / "manifest.json", MAX_MANIFEST_BYTES)
    if batch.digest_bytes(content) != expected_sha256 or manifest.get("schema_version") != SCHEMA:
        raise InvalidArchive("Trusted archive manifest digest/schema mismatch")
    _binding(manifest.get("binding"))
    if batch.clock(manifest.get("committed_at")) > now:
        raise InvalidArchive("Archive commit is in the future")
    objects, receipts, current, attempts = (manifest.get(k) for k in ("objects", "receipts", "current", "attempts"))
    if (not all(isinstance(v, dict) for v in (objects, receipts, current, attempts))
            or len(objects) > MAX_OBJECTS or len(receipts) > MAX_RECEIPTS or len(attempts) > MAX_ATTEMPTS
            or len(current) > 40000):
        raise InvalidArchive("Archive count bound exceeded or malformed indexes")
    total, loaded = 0, {}
    for sha, entry in objects.items():
        _sha(sha)
        if (not isinstance(entry, dict) or set(entry) != {"kind", "bytes"}
                or not isinstance(entry["kind"], str) or type(entry["bytes"]) is not int
                or not 0 < entry["bytes"] <= batch.MAX_ARTIFACT_BYTES):
            raise InvalidArchive("Invalid archive object index")
        total += entry["bytes"]
        if total > MAX_TOTAL_BYTES:
            raise InvalidArchive("Archive total byte bound exceeded")
        value, raw_bytes = _read(root / "objects" / f"{sha}.json")
        if len(raw_bytes) != entry["bytes"] or batch.digest_bytes(raw_bytes) != sha:
            raise InvalidArchive("Archive object digest or length mismatch")
        loaded[sha] = (value, raw_bytes)
    acquisitions = {}
    receipt_ids = {}
    for sha, entry in receipts.items():
        if sha not in loaded or objects[sha]["kind"] != "acquisition" or not isinstance(entry, dict):
            raise InvalidArchive("Unbound receipt object")
        symbol, attribute = entry.get("symbol"), entry.get("attribute")
        if not batch.canonical_symbol(symbol) or attribute not in batch.ATTRIBUTES:
            raise InvalidArchive("Malformed archive receipt identity")
        origin = _binding(entry.get("origin_binding"))
        raw, raw_bytes = loaded[sha]
        try:
            _, context, _ = batch.validate_acquisition(raw, symbol, attribute, now=now, as_of=batch.day(origin["source_data_as_of"]))
            # Out-of-cohort receipts are still audited at their original binding.
            # A current cohort receipt must also be applicable to the new base.
            effective_asof = current_binding["source_data_as_of"] if symbol in cohort["symbols"] else origin["source_data_as_of"]
            frame, context, state = batch.validate_acquisition(raw, symbol, attribute, now=now, as_of=batch.day(effective_asof))
        except ValueError as exc:
            raise InvalidArchive("Original receipt validation failed") from exc
        if (context["observed_at"] != entry.get("observed_at") or context["capture_id"] != entry.get("capture_id")
                or batch.clock(context["observed_at"]) > now or batch.clock(raw["getter_completed_at"]) > now):
            raise InvalidArchive("Archive index does not bind original receipt clock/identity")
        identity = (symbol, attribute, context["capture_id"])
        previous = receipt_ids.setdefault(identity, sha)
        if previous != sha:
            raise InvalidArchive("An original capture ID was rewritten with different acquisition bytes")
        acquisitions[sha] = {"raw": raw, "bytes": raw_bytes, "frame": frame, "context": context,
                             "reason": state, "origin_binding": origin}
    for key, sha in current.items():
        if sha not in receipts or key != f"{receipts[sha]['symbol']}/{receipts[sha]['attribute']}":
            raise InvalidArchive("Current reference does not bind a retained acquisition")
    for entry in receipts.values():
        key = f"{entry['symbol']}/{entry['attribute']}"
        if key not in current or batch.clock(receipts[current[key]]["observed_at"]) < batch.clock(entry["observed_at"]):
            raise InvalidArchive("Current reference drops a retained newer acquisition")
    for attempt_id, event in attempts.items():
        attempt = _validate_attempt(event, now=now)
        if attempt_id != attempt.attempt_id:
            raise InvalidArchive("Attempt index identity mismatch")
        source_sha = event.get("source_object_sha256")
        if source_sha not in loaded:
            raise InvalidArchive("Attempt lacks retained original metadata")
        source = loaded[source_sha][0]
        original = [item for item in source.get("attempts", []) if item.get("attempt_id") == attempt_id]
        if len(original) != 1 or _adapt_attempt(original[0], source_sha) != event:
            raise InvalidArchive("Attempt metadata differs from the retained original journal")
    return VerifiedArchive(root, expected_sha256, manifest, loaded, acquisitions)


def _empty(binding, now):
    return {"schema_version": SCHEMA, "binding": binding, "committed_at": batch.timestamp(now),
            "objects": {}, "receipts": {}, "current": {}, "attempts": {}, "batches": {}}


def _put(manifest, pending, raw_bytes, kind):
    sha = batch.digest_bytes(raw_bytes)
    if not 0 < len(raw_bytes) <= batch.MAX_ARTIFACT_BYTES:
        raise InvalidArchive("Object exceeds 2 MiB bound")
    entry = {"kind": kind, "bytes": len(raw_bytes)}
    if sha in manifest["objects"] and manifest["objects"][sha] != entry:
        raise InvalidArchive("Conflicting object type")
    manifest["objects"][sha] = entry
    pending[sha] = raw_bytes
    return sha


def _add_receipt(manifest, pending, cached, symbol, attribute, *, now):
    if (batch.clock(cached["context"]["observed_at"]) > now
            or batch.clock(cached["raw"]["getter_completed_at"]) > now):
        raise InvalidArchive("A future source receipt cannot be committed")
    sha = _put(manifest, pending, cached["bytes"], "acquisition")
    context = cached["context"]
    entry = {"symbol": symbol, "attribute": attribute, "capture_id": context["capture_id"],
             "observed_at": context["observed_at"], "origin_binding": cached["origin_binding"]}
    for old_sha, old in manifest["receipts"].items():
        if (old["symbol"], old["attribute"], old["capture_id"]) == (symbol, attribute, entry["capture_id"]) and old_sha != sha:
            raise InvalidArchive("Original acquisition bytes cannot be rewritten")
    if sha in manifest["receipts"] and manifest["receipts"][sha] != entry:
        raise InvalidArchive("Original receipt metadata cannot be rewritten")
    manifest["receipts"][sha] = entry
    key = f"{symbol}/{attribute}"
    previous = manifest["receipts"].get(manifest["current"].get(key))
    if previous is None or batch.clock(previous["observed_at"]) < batch.clock(entry["observed_at"]):
        manifest["current"][key] = sha
    elif batch.clock(previous["observed_at"]) == batch.clock(entry["observed_at"]) and previous["capture_id"] != entry["capture_id"]:
        raise InvalidArchive("Ambiguous acquisitions at the same original clock")
    return sha


def _write_immutable(path, raw_bytes):
    path = _safe(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        if path.read_bytes() != raw_bytes:
            raise InvalidArchive("Immutable object collision")
        return
    with path.open("xb") as output:
        output.write(raw_bytes)
        output.flush()
        os.fsync(output.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _commit(root, manifest, pending, expected_sha256):
    if (len(manifest["objects"]) > MAX_OBJECTS or len(manifest["receipts"]) > MAX_RECEIPTS
            or len(manifest["attempts"]) > MAX_ATTEMPTS
            or sum(item["bytes"] for item in manifest["objects"].values()) > MAX_TOTAL_BYTES):
        raise InvalidArchive("Archive capacity exhausted; preserve audit receipts and choose a new explicit retention policy")
    content = batch._json_bytes(manifest)
    if len(content) > MAX_MANIFEST_BYTES:
        raise InvalidArchive("Archive manifest size bound exceeded")
    root = _safe(root)
    root.mkdir(parents=True, exist_ok=True)
    lock_path = _safe(root / ".archive.lock")
    with lock_path.open("a+b") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        target = _safe(root / "manifest.json")
        if expected_sha256 is None:
            if target.exists():
                raise InvalidArchive("Archive already exists; an explicit trusted digest is required")
        elif not target.exists() or batch.digest_bytes(target.read_bytes()) != expected_sha256:
            raise InvalidArchive("Archive changed concurrently; reload the trusted generation")
        count, total = _physical_size(root)
        additions = [data for sha, data in pending.items() if not (root / "objects" / f"{sha}.json").exists()]
        # Include both immutable snapshot and the atomic replacement temporary.
        if count + len(additions) + 2 > MAX_ARCHIVE_FILES or total + sum(map(len, additions)) + 2 * len(content) > MAX_ARCHIVE_BYTES:
            raise InvalidArchive("Physical archive capacity exhausted; audit data was not removed")
        for sha, raw_bytes in pending.items():
            _write_immutable(root / "objects" / f"{sha}.json", raw_bytes)
        sha = batch.digest_bytes(content)
        _write_immutable(root / "manifests" / f"{sha}.json", content)
        fd, temporary = tempfile.mkstemp(prefix=".manifest-", dir=root)
        try:
            with os.fdopen(fd, "wb") as output:
                output.write(content)
                output.flush()
                os.fsync(output.fileno())
            os.replace(temporary, target)
            descriptor = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
            try:
                os.fsync(descriptor)
            finally:
                os.close(descriptor)
        finally:
            if os.path.exists(temporary):
                os.unlink(temporary)
        return sha


def create_archive(root, *, base_bytes, cohort, now):
    return _commit(root, _empty(verify_base(base_bytes, cohort, now=now), now), {}, None)


def import_cache(root, expected_sha256, *, cache_manifest, cache_sha256, plan, base_bytes, now):
    """Import a bounded verified cache/pilot index, without synthesizing attempts."""
    batch.validate_plan(plan, base_bytes)
    archive = load_archive(root, expected_sha256, base_bytes=base_bytes, cohort=plan["verified_us_cohort"], now=now)
    cache_manifest = _safe(cache_manifest)
    document, content = _read(cache_manifest)
    for entry in document.get("acquisitions", {}).values():
        relative = entry.get("file")
        if not isinstance(relative, str) or Path(relative).is_absolute() or ".." in Path(relative).parts:
            raise InvalidArchive("Unsafe cache path")
        _safe(cache_manifest.parent / relative)
    cached = batch.load_cache(cache_manifest, cache_sha256, plan, now=now)
    manifest, pending = deepcopy(archive.manifest), {}
    for (symbol, attribute), value in cached.items():
        _add_receipt(manifest, pending, value, symbol, attribute, now=now)
    _put(manifest, pending, content, "cache_manifest")
    manifest.update(binding=verify_base(base_bytes, plan["verified_us_cohort"], now=now), committed_at=batch.timestamp(now))
    return _commit(root, manifest, pending, expected_sha256)


def seed_retained_acquisitions(root, expected_sha256, *, artifact_dir, plan, base_bytes, now):
    """Index reviewed original pilot files locally, preserving exact bytes.

    The selected subset is explicit in plan. The indexer is read-only; no file
    is written into the original pilot directory and no provider is created.
    """
    directory = _safe(artifact_dir)
    for item in plan.get("selected", []):
        for attribute in batch.ATTRIBUTES:
            _safe(directory / "acquisitions" / f"{item['symbol']}-{attribute}.json")
    index = batch.index_retained_acquisitions(directory, plan, base_bytes, now=now)
    current = load_archive(root, expected_sha256, base_bytes=base_bytes, cohort=plan["verified_us_cohort"], now=now)
    manifest, pending = deepcopy(current.manifest), {}
    for entry in index["acquisitions"].values():
        raw, content = _read(_relative(directory, entry["file"]))
        frame, context, reason = batch.validate_acquisition(raw, entry["symbol"], entry["attribute"],
            now=now, as_of=batch.day(plan["source_data_as_of"]))
        _add_receipt(manifest, pending, {"raw": raw, "bytes": content, "frame": frame, "context": context,
            "reason": reason, "origin_binding": entry["origin_binding"]}, entry["symbol"], entry["attribute"], now=now)
    _put(manifest, pending, batch._json_bytes(index), "cache_manifest")
    manifest.update(binding=verify_base(base_bytes, plan["verified_us_cohort"], now=now), committed_at=batch.timestamp(now))
    return _commit(root, manifest, pending, expected_sha256)


def export_cache(archive, plan, base_bytes, output_dir, *, now):
    """Copy <=400 verified ORIGINAL byte objects into a new bounded cache view."""
    batch.validate_plan(plan, base_bytes)
    # Re-audit bytes at export; a stale in-memory object is not filesystem trust.
    archive = load_archive(archive.root, archive.sha256, base_bytes=base_bytes, cohort=plan["verified_us_cohort"], now=now)
    out = _safe(output_dir)
    if out.exists():
        raise InvalidArchive("Cache view output must be new")
    result = {"schema_version": batch.CACHE_SCHEMA,
              "binding": verify_base(base_bytes, plan["verified_us_cohort"], now=now), "acquisitions": {}}
    copies = []
    for item in plan["selected"]:
        symbol = item["symbol"]
        for attribute in batch.ATTRIBUTES:
            key = f"{symbol}/{attribute}"
            sha = archive.manifest["current"].get(key)
            if sha is None:
                continue
            entry = archive.manifest["receipts"][sha]
            relative = f"acquisitions/{symbol}-{attribute}.json"
            result["acquisitions"][key] = {**entry, "sha256": sha, "file": relative}
            copies.append((out / relative, archive.acquisitions[sha]["bytes"]))
    out.mkdir(parents=True)
    for path, content in copies:
        _write_immutable(path, content)
    manifest_path = out / "cache-manifest.json"
    _write_immutable(manifest_path, batch._json_bytes(result))
    sha = batch.digest_bytes(manifest_path.read_bytes())
    batch.load_cache(manifest_path, sha, plan, now=now)
    return manifest_path, sha


def _relative(root, relative):
    if (not isinstance(relative, str) or Path(relative).is_absolute()
            or ".." in Path(relative).parts or "\\" in relative):
        raise InvalidArchive("Unsafe batch artifact path")
    return _safe(root / relative)


def merge_batch(root, expected_sha256, *, batch_dir, summary_sha256=None,
                plan_sha256=None, attempts_sha256=None, cache_sha256=None,
                base_bytes, cohort, now):
    """Atomically retain a completed batch or explicitly trusted crash journal.

    Complete batches require their trusted summary SHA. Interrupted batches
    require all three trusted plan, attempts and cache manifest SHAs. Neither
    path trusts generated status/proof/history flags as source availability.
    Failed acquisitions and all previous receipts stay in the immutable store.
    """
    archive = load_archive(root, expected_sha256, base_bytes=base_bytes, cohort=cohort, now=now)
    directory = _safe(batch_dir)
    manifest, pending = deepcopy(archive.manifest), {}
    summary = None
    if summary_sha256 is not None:
        _sha(summary_sha256)
        summary, content = _read(directory / "summary.json")
        if batch.digest_bytes(content) != summary_sha256 or summary.get("schema_version") != "financial-statement-batch-summary-v1":
            raise InvalidArchive("Trusted batch summary digest/schema mismatch")
        plan_sha256, attempts_sha256, cache_sha256 = (summary.get(key) for key in ("plan_sha256", "attempts_sha256", "cache_manifest_sha256"))
        _put(manifest, pending, content, "batch_summary")
    for value in (plan_sha256, attempts_sha256, cache_sha256):
        _sha(value)
    plan, plan_bytes = _read(directory / "plan.json")
    journal, journal_bytes = _read(directory / "attempts.json")
    cache, cache_bytes = _read(directory / "cache-manifest.json")
    if (batch.digest_bytes(plan_bytes) != plan_sha256 or batch.digest_bytes(journal_bytes) != attempts_sha256
            or batch.digest_bytes(cache_bytes) != cache_sha256):
        raise InvalidArchive("Batch plan/journal/cache digest mismatch")
    batch.validate_plan(plan, base_bytes)
    if (plan["verified_us_cohort"]["base_artifact_sha256"] != cohort["base_artifact_sha256"]
            or set(plan["verified_us_cohort"]["symbols"]) != set(cohort["symbols"])):
        raise InvalidArchive("Batch cohort differs from explicitly verified current cohort")
    selected = {item["symbol"]: item for item in plan["selected"]}
    if (journal.get("schema_version") != "financial-statement-attempts-v1"
            or journal.get("plan_sha256") != plan_sha256 or journal.get("run_id") != plan.get("run_id")
            or not isinstance(journal.get("run_id"), str) or not journal["run_id"]
            or not isinstance(journal.get("attempts"), list) or len(journal["attempts"]) > 400):
        raise InvalidArchive("Attempt journal is not bound to this batch plan")
    for entry in cache.get("acquisitions", {}).values():
        _relative(directory, entry.get("file"))
        if entry.get("symbol") not in selected:
            raise InvalidArchive("Batch cache contains an unselected symbol")
    cached = batch.load_cache(directory / "cache-manifest.json", cache_sha256, plan, now=now)
    for (symbol, attribute), value in cached.items():
        _add_receipt(manifest, pending, value, symbol, attribute, now=now)
    _put(manifest, pending, plan_bytes, "batch_plan")
    _put(manifest, pending, cache_bytes, "cache_manifest")
    source_sha = _put(manifest, pending, journal_bytes, "attempt_journal")
    seen, seen_attributes = set(), set()
    for original in journal["attempts"]:
        try:
            event = _adapt_attempt(original, source_sha)
            attempt = _validate_attempt(event, now=now)
            attribute = original["attribute"]
            if (original["outcome"] not in {"in_flight", "succeeded", "failed", "provider_blocked", "budget_stopped"}
                    or attempt.symbol not in selected or attribute not in selected[attempt.symbol]["attributes"]
                    or original["attributes"] != [attribute] or original["attempt_id"] in seen
                    or (attempt.symbol, attribute) in seen_attributes
                    or not attempt.attempt_id.startswith(journal["run_id"] + ":")
                    or attempt.attempted_at < batch.clock(plan["run_started_at"])):
                raise InvalidArchive("Journal attempt exceeds original selected work")
            seen.add(attempt.attempt_id)
            seen_attributes.add((attempt.symbol, attribute))
            if original["outcome"] != "in_flight":
                completed = batch.clock(original.get("completed_at"))
                if not attempt.attempted_at <= completed <= now:
                    raise InvalidArchive("Invalid terminal attempt clock")
                relative = original.get("acquisition_file")
                if relative != f"acquisitions/{attempt.symbol}-{attribute}.json":
                    raise InvalidArchive("Attempt acquisition path identity mismatch")
                raw, content = _read(_relative(directory, relative))
                if raw.get("symbol") != attempt.symbol or raw.get("attribute") != attribute:
                    raise InvalidArchive("Attempt acquisition identity mismatch")
                if original["outcome"] == "succeeded":
                    value = cached.get((attempt.symbol, attribute))
                    if (value is None or value["bytes"] != content or original.get("capture_id") != value["context"]["capture_id"]
                            or not attempt.attempted_at <= batch.clock(value["context"]["observed_at"]) <= completed):
                        raise InvalidArchive("Successful attempt is not bound to original receipt")
                else:
                    _put(manifest, pending, content, "failed_acquisition")
            previous = manifest["attempts"].get(attempt.attempt_id)
            if previous is not None:
                old_source = archive.objects[previous["source_object_sha256"]][0]
                old_original = next(item for item in old_source["attempts"] if item["attempt_id"] == attempt.attempt_id)
                if old_original != original:
                    if (old_original["outcome"] != "in_flight" or original["outcome"] == "in_flight"
                            or any(old_original[key] != original.get(key) for key in ("attempt_id", "symbol", "attribute", "attributes", "attempted_at"))):
                        raise InvalidArchive("A completed attempt cannot be rewritten")
            manifest["attempts"][attempt.attempt_id] = event
        except (TypeError, KeyError, ValueError) as exc:
            raise InvalidArchive("Invalid original attempt journal") from exc
    if summary is not None:
        binding = verify_base(base_bytes, cohort, now=now)
        if (summary.get("base_artifact_sha256") != binding["base_artifact_sha256"]
                or summary.get("source_data_as_of") != binding["source_data_as_of"]
                or set(summary.get("results", {})) != set(selected)
                or summary.get("statement_getter_calls") != len(journal["attempts"])):
            raise InvalidArchive("Summary does not match the selected batch and actual attempts")
        stop = summary.get("provider_stop")
        if isinstance(stop, dict) and stop.get("http_status", stop.get("detected_http_status")) in (403, 429):
            if not any(item.get("http_status") == stop.get("http_status", stop.get("detected_http_status")) for item in journal["attempts"]):
                raise InvalidArchive("Provider stop is missing from the original attempt journal")
        for symbol, entry in summary["results"].items():
            result, content = _read(_relative(directory, entry.get("file")))
            if batch.digest_bytes(content) != entry.get("sha256") or result.get("symbol") != symbol:
                raise InvalidArchive("Batch result hash/identity mismatch")
            _put(manifest, pending, content, "batch_result")
            if result.get("envelope_file") is not None:
                _, content = _read(_relative(directory, result["envelope_file"]))
                if batch.digest_bytes(content) != result.get("envelope_sha256"):
                    raise InvalidArchive("Batch envelope hash mismatch")
                _put(manifest, pending, content, "batch_envelope")
    manifest["batches"][source_sha] = {"plan_sha256": plan_sha256, "cache_sha256": cache_sha256,
        "summary_sha256": summary_sha256, "provider_stop": summary.get("provider_stop") if summary else None,
        "execution_stop": summary.get("execution_stop") if summary else None}
    manifest.update(binding=verify_base(base_bytes, cohort, now=now), committed_at=batch.timestamp(now))
    return _commit(root, manifest, pending, expected_sha256)


def _verified(context, contract):
    attribute = next(attribute for attribute in batch.ATTRIBUTES
                     if context["producer"] == f"yfinance.{attribute}/transport-capture-v1")
    return planning.VerifiedAcquisition(
        symbol=context["symbol"], market="US", contract=contract, receipt_id=context["capture_id"],
        payload_sha256=context["raw_payload_sha256"], observed_at=batch.clock(context["observed_at"]),
        original_receipt_verified=True, identity_verified=True, contract_verified=True, attribute=attribute)


def _period_expiry(context, max_age_days):
    latest = batch.day(context["source_payload"]["columns"][0][:10])
    return datetime.combine(latest + timedelta(days=max_age_days + 1), time.min, timezone.utc) - timedelta(milliseconds=1)


def _unproved_source_reason(acquisition, target):
    """Distinguish absent reported inputs from complete but unusable semantics."""
    source = acquisition["context"]["source_payload"]
    periods = [column[:10] for column in source["columns"]]
    rows = source["source_rows"]
    keys = ("dilutedeps", "basiceps") if target == "eps" else ("totalrevenue", "operatingrevenue")
    metric = next((rows[key] for key in keys if key in rows and rows[key].get("values")), None)
    if metric is None or len(periods) < 5 or acquisition["reason"] == "reporting_period_gap":
        return "source_period_missing", "missing_reported_comparison_inputs"
    recent, baseline = metric["values"].get(periods[0]), metric["values"].get(periods[4])
    if not batch.finite(recent) or not batch.finite(baseline):
        return "source_period_missing", "missing_reported_comparison_inputs"
    if baseline <= 0:
        return "source_limited", "nonpositive_comparison_base"
    if target == "eps" and baseline <= 0.05:
        return "source_limited", "comparison_base_below_minimum"
    return "source_limited", "unsupported_source_contract"


def project_symbol(symbol, acquisitions, *, now, as_of):
    """Recompute arithmetic, envelope, proofs and history from audited frames."""
    from . import financial_source_capture as capture
    from .eps_rating_service import EPSRatingService
    from .financial_source_evidence import FINANCIAL_FIELDS, validate_envelope
    from .growth_cadence_service import compute_cadence_aware_growth
    from .static_financial_evidence import build_static_financial_current, QUARTER_MAX_AGE_DAYS, ANNUAL_MAX_AGE_DAYS
    frames = {attribute: item["frame"] for attribute, item in acquisitions.items()}
    contexts = {attribute: item["context"] for attribute, item in acquisitions.items()}
    raw = {attribute: item["raw"] for attribute, item in acquisitions.items()}
    growth = compute_cadence_aware_growth(frames.get("quarterly_income_stmt"), market="US", include_source_context=True)
    eps = EPSRatingService().calculate_eps_rating_data(frames.get("income_stmt"), frames.get("quarterly_income_stmt"), include_source_context=True)
    source_context = {**growth.pop("_financial_source_context", {}), **eps.pop("_financial_source_context", {})}
    payload = {**growth, **eps, "symbol": symbol, "market": "US"}
    capture.attach_evidence(payload, capture.statement_evidence(payload, source_context, contexts), symbol=symbol, market="US")
    validate_envelope(payload["financial_source_evidence"])
    proof = build_static_financial_current(payload, now=now, as_of_date=as_of, market="US")
    history, history_diagnostics = batch.history_projection(symbol, raw, now=now, as_of=batch.day(as_of))
    diagnostics = batch.source_diagnostics(raw, proof, history_diagnostics)
    states = {}
    quarterly = acquisitions.get("quarterly_income_stmt")
    for target, field in (("eps", "eps_growth_yy"), ("sales", "sales_growth_yy")):
        if quarterly is None:
            states[target] = planning.ProofStatus()
            continue
        receipt = _verified(quarterly["context"], planning.PROOF_CONTRACT)
        field_id = str(FINANCIAL_FIELDS.index(field))
        current = proof
        # Recover exact expiry from the original supported proof, so expiration
        # becomes new work instead of an unresolved-success retry loop.
        if current["r"][int(field_id)] not in {"0", "f"}:
            origin_asof = quarterly["origin_binding"]["source_data_as_of"]
            current = build_static_financial_current(payload, now=max(receipt.observed_at,
                datetime.combine(batch.day(origin_asof), time.min, timezone.utc)), as_of_date=origin_asof, market="US")
        code = current["r"][int(field_id)]
        if code in {"0", "f"} and field_id in current["p"]:
            expiry = datetime.fromtimestamp(current["p"][field_id][5] / 1000, timezone.utc)
            states[target] = planning.ProofStatus("nonpositive_proved" if code == "f" else "proved", (receipt,), expiry)
        else:
            state, reason = _unproved_source_reason(quarterly, target)
            if state == "source_limited":
                expiry = min(receipt.observed_at + planning.SOURCE_TTL,
                    _period_expiry(quarterly["context"], QUARTER_MAX_AGE_DAYS))
                states[target] = (planning.ProofStatus(state, (receipt,), expiry, source_reason=reason)
                    if expiry >= receipt.observed_at else planning.ProofStatus("source_period_missing", (receipt,)))
            else:
                states[target] = planning.ProofStatus(state, (receipt,))
    annual = acquisitions.get("income_stmt")
    history_status = planning.HistoryStatus()
    if annual is not None:
        annual_observed = batch.clock(annual["context"]["observed_at"])
        historical, historical_diagnostics = batch.history_projection(symbol, {"income_stmt": annual["raw"]},
            now=annual_observed, as_of=batch.day(annual["origin_binding"]["source_data_as_of"]))
        annual_valid = historical_diagnostics["reasons"]["annual"] in {"available", "nonpositive_comparison_base"}
        # A nonpositive comparison changes growth semantics, not structure.
        # Only sources actually included in the current projection own its TTL.
        included = history_diagnostics["original_receipts"]
        history_contexts = [contexts[entry["attribute"]] for entry in included]
        if not history_contexts or not history["annual"]:
            history_contexts = [annual["context"]]
        oldest = min(history_contexts, key=lambda context: batch.clock(context["observed_at"]))
        if not annual_valid:
            # The missing annual input decision binds the annual acquisition;
            # an optional older quarterly receipt cannot stand in for it.
            oldest = annual["context"]
            history_contexts = [oldest]
        history_status = planning.HistoryStatus("available" if annual_valid else "source_period_missing",
            _verified(oldest, planning.HISTORY_CONTRACT),
            expires_at=_period_expiry(annual["context"], ANNUAL_MAX_AGE_DAYS) if annual_valid else None,
            receipts=tuple(_verified(context, planning.HISTORY_CONTRACT) for context in history_contexts))
    status = planning.SymbolStatus(states["eps"], states["sales"], history_status,
        quarantined_derived_rating=any(payload.get(field) is not None for field in FINANCIAL_FIELDS[-4:]))
    return status, {"envelope": payload, "financial_current": proof, "financial_history": history,
                    "history_source_diagnostics": history_diagnostics, "source_diagnostics": diagnostics}


def plan_archive(archive, *, base_bytes, cohort, now, batch_limit=200, refresh_through=None,
                 retry_decisions=None, source_rechecks=None, provider_resume=None):
    """Plan the FULL verified cohort; return collector allowlist only afterwards.

    retry_decisions maps retained attempt IDs to explicit RFC3339 deadlines.
    source_rechecks maps SYMBOL/target to an exact receipt_id and recheck_after,
    supporting reviewed pilot receipts with no retained getter attempt journal.
    Decisions are caller inputs, never guessed cooldowns or cache metadata.
    """
    archive = load_archive(archive.root, archive.sha256, base_bytes=base_bytes, cohort=cohort, now=now)
    binding = verify_base(base_bytes, cohort, now=now)
    statuses, projections = {}, {}
    for symbol in cohort["symbols"]:
        acquisitions = {attribute: archive.acquisitions[sha] for attribute in batch.ATTRIBUTES
                        if (sha := archive.manifest["current"].get(f"{symbol}/{attribute}")) is not None}
        if acquisitions:
            statuses[symbol], projections[symbol] = project_symbol(symbol, acquisitions, now=now, as_of=binding["source_data_as_of"])
    decisions = retry_decisions or {}
    if set(decisions) - set(archive.manifest["attempts"]):
        raise InvalidArchive("Retry decision must bind a retained actual attempt")
    attempts, blocked = [], []
    for event in archive.manifest["attempts"].values():
        event = {**event, **({"retry_not_before": decisions[event["attempt_id"]]} if event["attempt_id"] in decisions else {})}
        attempt = _validate_attempt(event, now=now)
        if attempt.http_status in (403, 429):
            blocked.append(attempt)
        if attempt.symbol in cohort["symbols"]:
            attempts.append(attempt)
    rechecks = source_rechecks or {}
    consumed = set()
    for symbol, status in list(statuses.items()):
        replacements = {}
        for target, field in (("eps", "eps"), ("sales", "sales"), ("annual_history", "annual_history")):
            value = getattr(status, field)
            key = f"{symbol}/{target}"
            if value.state != "source_period_missing":
                continue
            receipts = value.receipts if target != "annual_history" else (value.receipt,)
            attributes = value.attributes if target != "annual_history" else batch.ATTRIBUTES
            relevant = [a for a in attempts if a.symbol == symbol and set(a.attributes).intersection(attributes)]
            latest = max(relevant, key=lambda a: (a.attempted_at, a.attempt_id), default=None)
            deadline = latest.retry_not_before if latest else None
            if key in rechecks:
                decision = rechecks[key]
                if (not isinstance(decision, dict) or set(decision) != {"receipt_id", "recheck_after"}
                        or decision["receipt_id"] not in {r.receipt_id for r in receipts if r is not None}):
                    raise InvalidArchive("Source recheck must bind this missing-period original receipt")
                deadline = batch.clock(decision["recheck_after"])
                consumed.add(key)
            if deadline is not None:
                if deadline <= max(r.observed_at for r in receipts if r is not None):
                    raise InvalidArchive("Source recheck must follow the original source observation")
                replacements[field] = replace(value, recheck_after=deadline)
        statuses[symbol] = replace(status, **replacements)
    if set(rechecks) != consumed:
        raise InvalidArchive("Source recheck does not bind a current missing-period target")
    stop = None
    if blocked:
        latest = max(blocked, key=lambda a: (a.attempted_at, a.attempt_id))
        stop = planning.ProviderStop(latest.attempt_id, latest.attempted_at, latest.http_status, latest.retry_not_before)
    result = planning.plan_statement_refresh(eligible_symbols=cohort["symbols"], market="US", statuses=statuses,
        attempts=attempts, now=now, batch_limit=batch_limit, refresh_through=refresh_through,
        provider_resume=provider_resume, provider_stop=stop)
    exported = planning.export_statement_batch_plan(result, base_artifact_sha256=binding["base_artifact_sha256"],
        source_data_as_of=binding["source_data_as_of"], batch_allowlist=result.symbols)
    return result, exported, projections
