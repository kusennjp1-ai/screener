"""Prove a cumulative statement-source renewal using retained local bytes.

The caller authenticates the source artifacts independently. This offline helper
binds those artifacts to projection receipts; it grants no source, publication,
or provider authority and does not refresh any acquisition clock.
"""
from __future__ import annotations

import argparse

from app.scripts import export_statement_projection as projector
from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive

SCHEMA = "financial-statement-source-renewal-v1"
MAX_REPORT_BYTES = 16 * 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def _source(directory, projection_path, base_path, cohort_path, *, now):
    root = archive._safe(directory)
    if not (root / "manifest.json").exists():
        root = archive._safe(root / "archive")
    projection, content = archive._read(projection_path, projector.MAX_PROJECTION_BYTES)
    require(projection.get("schema_version") == projector.SCHEMA,
            "Unsupported statement projection schema")
    bindings = projection.get("bindings")
    require(isinstance(bindings, dict), "Missing projection source bindings")
    base, base_bytes = projector._bound_input(
        base_path or root.parent / "base.json", bindings.get("acquisition_base_sha256"), batch.MAX_BASE_BYTES)
    cohort, _ = projector._bound_input(
        cohort_path or root.parent / "cohort.json", bindings.get("cohort_sha256"), batch.MAX_ARTIFACT_BYTES)
    verified = archive.load_archive(root, bindings.get("archive_manifest_sha256"),
                                    base_bytes=base_bytes, cohort=cohort, now=now)
    require(verified.manifest["binding"] == archive.verify_base(base_bytes, cohort, now=now),
            "Archive and original acquisition base disagree")
    evaluated = batch.clock(projection.get("financial_evaluated_at"))
    require(batch.clock(verified.manifest["committed_at"]) <= evaluated <= now,
            "Projection evaluation does not follow its original archive")
    symbols = projection.get("symbols")
    require(isinstance(symbols, dict) and set(symbols) == set(cohort["symbols"]),
            "Projection does not retain the complete original cohort")
    inventory = []
    for symbol in sorted(cohort["symbols"]):
        receipts = []
        for attribute in batch.ATTRIBUTES:
            sha = verified.manifest["current"].get(f"{symbol}/{attribute}")
            if sha is None:
                continue
            context = verified.acquisitions[sha]["context"]
            require(batch.clock(context["observed_at"]) <= evaluated,
                    "Projection source observation is in its future")
            receipt = {"attribute": attribute, "receipt_sha256": sha,
                       "capture_id": context["capture_id"],
                       "raw_payload_sha256": context["raw_payload_sha256"],
                       "observed_at": context["observed_at"]}
            receipts.append(receipt)
            inventory.append({"symbol": symbol, **receipt})
        item = symbols[symbol]
        require(isinstance(item, dict) and item.get("source_receipts") == receipts
                and item.get("market") == "US" and item.get("as_of_date") == base["as_of_date"],
                "Projection symbol receipts differ from original archive current receipts")
    require(projection.get("receipt_inventory") == inventory
            and projection.get("receipt_inventory_sha256") == projector.content_digest(inventory),
            "Projection receipt inventory differs from original archive current receipts")
    require(projection.get("financial_generation") == projector.financial_generation(projection),
            "Projection financial generation digest mismatch")
    return verified, projection, base_bytes, cohort, {
        "archive_manifest_sha256": verified.sha256,
        "projection_sha256": batch.digest_bytes(content),
        "receipt_inventory_sha256": projector.content_digest(inventory),
    }


def _preserved(previous, current):
    for name in ("objects", "receipts", "attempts", "batches"):
        old, new = previous.manifest.get(name), current.manifest.get(name)
        require(isinstance(old, dict) and isinstance(new, dict), f"Malformed retained {name} index")
        require(all(key in new and new[key] == value for key, value in old.items()),
                f"Renewal dropped or rewrote prior {name}")
    require(all(current.objects[sha][1] == value[1] for sha, value in previous.objects.items()),
            "Renewal changed prior object bytes")


def _journal(verified, sha, *, base_bytes, cohort, now):
    """Reuse archive/collector validators and bind original journal material.

    load_archive already audits every original receipt and attempt adaptation.
    These are the successful-attempt checks from merge_batch applied to retained
    content-addressed objects, plus the raw getter/transport completion clocks.
    """
    objects, manifest = verified.objects, verified.manifest
    require(sha in objects and manifest["objects"][sha]["kind"] == "attempt_journal",
            "Renewal attempt lacks its retained original journal")
    journal = objects[sha][0]
    metadata = manifest["batches"].get(sha)
    require(isinstance(metadata, dict), "Renewal journal lacks retained batch bindings")
    plan_sha, cache_sha = metadata.get("plan_sha256"), metadata.get("cache_sha256")
    require(plan_sha in objects and manifest["objects"][plan_sha]["kind"] == "batch_plan"
            and cache_sha in objects and manifest["objects"][cache_sha]["kind"] == "cache_manifest",
            "Renewal journal lacks its retained plan/cache")
    plan, cache = objects[plan_sha][0], objects[cache_sha][0]
    batch.validate_plan(plan, base_bytes)
    require(plan["verified_us_cohort"] == cohort, "Renewal plan changes the original source cohort")
    require(journal.get("schema_version") == "financial-statement-attempts-v1"
            and journal.get("plan_sha256") == plan_sha
            and isinstance(journal.get("run_id"), str) and bool(journal["run_id"])
            and journal["run_id"] == plan.get("run_id")
            and isinstance(journal.get("attempts"), list) and len(journal["attempts"]) <= 400,
            "Renewal journal is not bound to its original plan")
    require(cache.get("schema_version") == batch.CACHE_SCHEMA
            and cache.get("binding") == manifest["binding"]
            and isinstance(cache.get("acquisitions"), dict)
            and len(cache["acquisitions"]) <= batch.MAX_BATCH * 2,
            "Malformed renewal cache binding")
    summary_sha = metadata.get("summary_sha256")
    if summary_sha is not None:
        require(summary_sha in objects and manifest["objects"][summary_sha]["kind"] == "batch_summary",
                "Renewal batch summary is not retained")
        summary = objects[summary_sha][0]
        require(summary.get("schema_version") == "financial-statement-batch-summary-v1"
                and summary.get("plan_sha256") == plan_sha and summary.get("attempts_sha256") == sha
                and summary.get("cache_manifest_sha256") == cache_sha
                and summary.get("base_artifact_sha256") == cohort["base_artifact_sha256"]
                and summary.get("source_data_as_of") == plan["source_data_as_of"]
                and summary.get("statement_getter_calls") == len(journal["attempts"]),
                "Renewal batch summary differs from its original journal")
    selected = {item["symbol"]: item for item in plan["selected"]}
    seen, seen_attributes, successful = set(), set(), {}
    for original in journal["attempts"]:
        require(isinstance(original, dict), "Malformed original renewal attempt")
        event = archive._adapt_attempt(original, sha)
        attempt = archive._validate_attempt(event, now=now)
        attribute = original.get("attribute")
        key = (attempt.symbol, attribute)
        require(original["outcome"] in {"in_flight", "succeeded", "failed", "provider_blocked", "budget_stopped"}
                and attempt.symbol in selected and attribute in selected[attempt.symbol]["attributes"]
                and original["attributes"] == [attribute] and attempt.attempt_id not in seen
                and key not in seen_attributes and attempt.attempt_id.startswith(journal["run_id"] + ":")
                and attempt.attempted_at >= batch.clock(plan.get("run_started_at"))
                and manifest["attempts"].get(attempt.attempt_id) == event,
                "Renewal attempt exceeds or differs from its original journal")
        seen.add(attempt.attempt_id)
        seen_attributes.add(key)
        if original["outcome"] == "in_flight":
            continue
        completed = batch.clock(original.get("completed_at"))
        require(attempt.attempted_at <= completed <= now
                and original.get("acquisition_file") == f"acquisitions/{attempt.symbol}-{attribute}.json",
                "Invalid original renewal attempt completion")
        if original["outcome"] != "succeeded":
            continue
        entry = cache["acquisitions"].get(f"{attempt.symbol}/{attribute}")
        require(isinstance(entry, dict), "Successful renewal attempt lacks a receipt cache binding")
        receipt_sha = entry.get("sha256")
        require(receipt_sha in verified.acquisitions, "Successful renewal receipt is not retained")
        acquired = verified.acquisitions[receipt_sha]
        raw, context = acquired["raw"], acquired["context"]
        require(entry.get("file") == original["acquisition_file"]
                and entry.get("symbol") == attempt.symbol and entry.get("attribute") == attribute
                and raw["symbol"] == attempt.symbol and raw["attribute"] == attribute
                and entry.get("capture_id") == original.get("capture_id") == context["capture_id"]
                and entry.get("observed_at") == context["observed_at"]
                and entry.get("origin_binding", cache["binding"]) == acquired["origin_binding"],
                "Successful renewal attempt differs from its original receipt")
        observed, getter_completed = batch.clock(context["observed_at"]), batch.clock(raw["getter_completed_at"])
        matches = [item for item in raw["transport_events"] if isinstance(item, dict)
                   and item.get("transport_payload_sha256") == context["transport_payload_sha256"]
                   and item.get("symbol") == attempt.symbol and item.get("attribute") == attribute
                   and type(item.get("http_status")) is int and 200 <= item["http_status"] < 300]
        require(len(matches) == 1, "Successful renewal lacks unique retained transport evidence")
        transport = matches[0]
        require(transport.get("source_subset_status") == "retained"
                and type(transport.get("transport_payload_bytes")) is int and transport["transport_payload_bytes"] > 0
                and attempt.attempted_at <= batch.clock(transport.get("started_at"))
                <= batch.clock(transport.get("completed_at")) <= observed <= getter_completed <= completed,
                "Renewal source clock is not bounded by original transport/getter/attempt completion")
        require(receipt_sha not in successful, "Renewal receipt has ambiguous successful attempts")
        successful[receipt_sha] = {
            "attempt_id": attempt.attempt_id, "attempt_completed_at": original["completed_at"],
            "attempt_journal_sha256": sha, "plan_sha256": plan_sha,
            "getter_completed_at": raw["getter_completed_at"],
            "transport_payload_sha256": context["transport_payload_sha256"],
            "transport_evidence_sha256": projector.content_digest(transport),
        }
    return successful


def verify_renewal(*, previous_archive, archive_dir, previous_projection, projection,
                   evaluated_at, previous_base=None, previous_cohort=None, base=None, cohort=None):
    now = batch.clock(evaluated_at)
    old, old_projection, _, _, old_binding = _source(
        previous_archive, previous_projection, previous_base, previous_cohort, now=now)
    current, new_projection, base_bytes, current_cohort, new_binding = _source(
        archive_dir, projection, base, cohort, now=now)
    require(batch.clock(new_projection["financial_evaluated_at"]) == now,
            "Renewal evaluation differs from the supplied projection")
    require(set(old_projection["symbols"]) == set(new_projection["symbols"]),
            "Renewal changed the projected full cohort")
    _preserved(old, current)
    previous_receipts, current_receipts = old.manifest["receipts"], current.manifest["receipts"]
    added = sorted(set(current_receipts) - set(previous_receipts))
    require(added, "Renewal has no genuinely new original source receipts")
    old_inventory = {item["receipt_sha256"] for item in old_projection["receipt_inventory"]}
    new_inventory = {item["receipt_sha256"] for item in new_projection["receipt_inventory"]}
    renewed = sorted(new_inventory - old_inventory)
    require(renewed and set(renewed) <= set(added),
            "Renewal projection has no newly acquired current source receipts")
    old_capture_ids = {item["capture_id"] for item in previous_receipts.values()}
    journals = {}
    for attempt_id, event in current.manifest["attempts"].items():
        if attempt_id not in old.manifest["attempts"] and event["outcome"] == "succeeded":
            sha = event["source_object_sha256"]
            if sha not in journals:
                require(sha not in old.objects, "Renewal reused a previously retained acquisition journal")
                journals[sha] = _journal(current, sha, base_bytes=base_bytes, cohort=current_cohort, now=now)
    successes = {}
    for journal in journals.values():
        for sha, proof in journal.items():
            require(sha not in successes, "Renewal receipt is claimed by multiple acquisition journals")
            successes[sha] = proof
    delta, captures = [], set()
    for sha in added:
        receipt = current_receipts[sha]
        key = f"{receipt['symbol']}/{receipt['attribute']}"
        previous_sha = old.manifest["current"].get(key)
        capture_id = receipt["capture_id"]
        require(capture_id not in old_capture_ids and capture_id not in captures,
                "Renewal reused an original capture identity")
        captures.add(capture_id)
        require(previous_sha is None or batch.clock(receipt["observed_at"])
                > batch.clock(previous_receipts[previous_sha]["observed_at"]),
                "Renewal receipt does not have a strictly newer original source clock")
        require(sha in successes, "New source receipt lacks a successful retained acquisition journal")
        delta.append({"symbol": receipt["symbol"], "attribute": receipt["attribute"],
                      "previous_receipt_sha256": previous_sha, "receipt_sha256": sha,
                      "capture_id": capture_id, "observed_at": receipt["observed_at"], **successes[sha]})
    report = {
        "schema_version": SCHEMA, "status": "verified", "evaluated_at": batch.timestamp(now),
        "previous": old_binding, "current": new_binding,
        "preserved": {key: len(old.manifest[key]) for key in ("objects", "receipts", "attempts")},
        "new_receipt_count": len(delta),
        "new_receipts": delta, "new_receipts_sha256": projector.content_digest(delta),
        "journal_sha256": sorted({item["attempt_journal_sha256"] for item in delta}),
        "renewed_current_receipts": renewed,
        "unchanged_current_receipts": sorted(new_inventory & old_inventory),
    }
    require(len(projector.canonical_bytes(report)) + 1 <= MAX_REPORT_BYTES, "Renewal report exceeds output bound")
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for flag in ("previous-archive", "archive", "previous-projection", "projection", "evaluated-at"):
        parser.add_argument(f"--{flag}", required=True)
    for flag in ("previous-base", "previous-cohort", "base", "cohort"):
        parser.add_argument(f"--{flag}")
    args = parser.parse_args(argv)
    try:
        report = verify_renewal(
            previous_archive=args.previous_archive, archive_dir=args.archive,
            previous_projection=args.previous_projection, projection=args.projection,
            evaluated_at=args.evaluated_at, previous_base=args.previous_base,
            previous_cohort=args.previous_cohort, base=args.base, cohort=args.cohort)
        print(projector.canonical_bytes(report).decode("utf-8"))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        parser.exit(2, f"Statement source renewal rejected: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
