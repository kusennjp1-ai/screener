"""Bounded offline certification of exact producer artifacts, never acquisition.

A successful certificate asserts integrity and replay only. It preserves failed
producer conclusions, provider blocks, missing fields and original source clocks.
It cannot authorize publication, a stock qualification or further provider work.
"""
from __future__ import annotations

from collections import Counter
from copy import deepcopy
import json
from pathlib import Path, PurePosixPath
import re
import stat
import tempfile
from types import FunctionType
import zipfile

from . import financial_statement_batch as batch
from . import statement_artifact_archive as archive
from .financial_source_evidence import FINANCIAL_FIELDS, observation_id, validate_envelope

ROOT = Path(__file__).resolve().parents[3]
CONTRACT_PATH = ROOT / "contracts/financial_source_certification_v1.json"
SCHEMA = "financial-source-certification-v1"
PROJECTION_SCHEMA = "financial-source-certified-projection-v1"
POLICY = "original-receipts-current-availability-v1"
KNOWLEDGE = "current_observation_at_source_capture"
SOURCE_KEYS = {"repository", "workflow", "head_sha", "run_id", "run_attempt", "artifact_id",
               "artifact_name", "artifact_sha256", "archive_manifest_sha256", "acquisition_base_sha256", "cohort_sha256"}
CODE_FILES = (
    ".github/scripts/prepare-statement-certification.mjs",
    ".github/workflows/financial-source-certification.yml",
    "backend/app/services/statement_source_certification.py",
    "backend/app/scripts/certify_statement_source.py",
    "backend/app/services/statement_artifact_archive.py",
    "backend/app/services/financial_statement_batch.py",
    "backend/app/services/financial_source_capture.py",
    "backend/app/services/financial_source_evidence.py",
    "backend/app/services/static_financial_evidence.py",
    "backend/app/services/growth_cadence_service.py",
    "backend/app/services/eps_rating_service.py",
    "backend/app/services/quarterly_eps_selection.py",
    "backend/app/services/statement_refresh_planning.py",
    "contracts/financial_source_certification_v1.json",
    "contracts/financial_source_certification_v1.schema.json",
    "contracts/financial_source_reviewed_migrations_v1.json",
    "contracts/static_financial_current_v1.json",
    "contracts/financial_source_evidence_v1.json",
)


class InvalidCertification(ValueError):
    pass


def require(condition, message):
    if not condition:
        raise InvalidCertification(message)


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def digest(value):
    return batch.digest_bytes(canonical(value))


def read(path, maximum=archive.MAX_MANIFEST_BYTES):
    return archive._read(path, maximum)


def positive(value):
    return type(value) is int and 0 < value <= 9007199254740991


def parse_request(request):
    require(isinstance(request, dict) and set(request) == {"schema_version", "source"}
            and request["schema_version"] == SCHEMA, "Invalid closed certification request")
    source = request["source"]
    require(isinstance(source, dict) and set(source) == SOURCE_KEYS, "Invalid closed source identity")
    require(source["repository"] == "kusennjp1-ai/screener"
            and source["workflow"] == ".github/workflows/financial-statement-recovery.yml"
            and isinstance(source["head_sha"], str) and re.fullmatch(r"[a-f0-9]{40}", source["head_sha"])
            and all(positive(source[key]) for key in ("run_id", "run_attempt", "artifact_id")), "Invalid exact producer identity")
    require(source["artifact_name"] == f"financial-statement-recovery-{source['head_sha']}-{source['run_attempt']}",
            "Artifact name does not bind exact producer attempt")
    for key in ("artifact_sha256", "archive_manifest_sha256", "acquisition_base_sha256", "cohort_sha256"):
        archive._sha(source[key])
    return source


def verify_source_api(source, evidence, now):
    """Validate saved GitHub reads. CI must retrieve them using its read-only token.

    A local certificate does not authenticate a caller-supplied API transcript.
    The release guard must independently verify the successful certifier attempt
    and these exact source identities before treating its receipt as authority.
    """
    require(isinstance(evidence, dict) and set(evidence) == {"run", "jobs", "artifacts"}, "Incomplete API evidence")
    run, jobs, artifacts = (evidence[key] for key in ("run", "jobs", "artifacts"))
    require(isinstance(run, dict) and isinstance(jobs, list) and isinstance(artifacts, list)
            and len(jobs) <= 100 and len(artifacts) <= 100, "Unbounded API evidence")
    require(run.get("id") == source["run_id"] and run.get("run_attempt") == source["run_attempt"]
            and run.get("head_sha") == source["head_sha"] and run.get("path") == source["workflow"]
            and run.get("head_branch") in {"main", "improve/mandatory-financial-source-recovery"}
            and run.get("event") == "push" and run.get("status") == "completed"
            and run.get("conclusion") in {"success", "failure"}
            and run.get("repository", {}).get("full_name") == source["repository"]
            and run.get("head_repository", {}).get("full_name") == source["repository"]
            and positive(run.get("repository", {}).get("id"))
            and run.get("repository", {}).get("id") == run.get("head_repository", {}).get("id"),
            "Producer attempt identity or conclusion mismatch")
    matches = [job for job in jobs if job.get("name") == "statement-recovery"]
    require(len(matches) == 1, "Missing or ambiguous producer job")
    job = matches[0]
    require(positive(job.get("id")) and job.get("run_id") == source["run_id"]
            and job.get("run_attempt") == source["run_attempt"] and job.get("head_sha") == source["head_sha"]
            and job.get("status") == "completed" and job.get("conclusion") == run["conclusion"],
            "Producer job identity or conclusion mismatch")
    started, completed = batch.clock(job.get("started_at")), batch.clock(job.get("completed_at"))
    require(batch.clock(run["run_started_at"]) <= started <= completed <= now, "Invalid producer execution clocks")
    matches = [item for item in artifacts if item.get("name") == source["artifact_name"]]
    require(len(matches) == 1, "Missing or ambiguous producer artifact")
    item = matches[0]
    binding = item.get("workflow_run", {})
    require(item.get("id") == source["artifact_id"] and item.get("expired") is False
            and item.get("digest") == "sha256:" + source["artifact_sha256"]
            and positive(item.get("size_in_bytes")) and item["size_in_bytes"] <= 128 * 1024 * 1024
            and binding.get("id") == source["run_id"] and binding.get("head_sha") == source["head_sha"]
            and binding.get("head_branch") == run["head_branch"]
            and binding.get("repository_id") == run["repository"]["id"]
            and binding.get("head_repository_id") == run["repository"]["id"]
            and started <= batch.clock(item.get("created_at")) <= completed
            and (item.get("expires_at") is None or now < batch.clock(item["expires_at"])), "Producer artifact identity/attempt interval mismatch")
    return run, job, item


def extract_zip(path, target, expected):
    path = archive._safe(path)
    require(path.stat().st_size <= 128 * 1024 * 1024, "Source ZIP exceeds bound")
    require(batch.digest_bytes(path.read_bytes()) == expected, "Source ZIP digest mismatch")
    with zipfile.ZipFile(path) as zipped:
        infos, seen, total = zipped.infolist(), set(), 0
        require(len(infos) <= 30000, "Source ZIP file count exceeds bound")
        for info in infos:
            name, mode = info.filename, info.external_attr >> 16
            pure = PurePosixPath(name)
            require(not pure.is_absolute() and "\\" not in name and name not in seen
                    and all(part not in {"", ".", ".."} for part in name.rstrip("/").split("/"))
                    and not stat.S_ISLNK(mode)
                    and (not stat.S_IFMT(mode) or stat.S_ISREG(mode) or stat.S_ISDIR(mode)), "Unsafe source ZIP member")
            seen.add(name)
            total += info.file_size
            require(info.file_size <= 32 * 1024 * 1024 and total <= 512 * 1024 * 1024, "Source ZIP expanded size exceeds bound")
        zipped.extractall(target)


def _transport(raw, *, now):
    """Audit failure receipts too; emptiness cannot erase an HTTP provider stop."""
    symbol, attribute = raw.get("symbol"), raw.get("attribute")
    require(batch.canonical_symbol(symbol) and attribute in batch.ATTRIBUTES, "Acquisition identity invalid")
    completed = batch.clock(raw.get("getter_completed_at"))
    require(completed <= now and raw.get("point_in_time") is False and raw.get("source_publication_date") is None,
            "Acquisition clock/knowledge claim invalid")
    events = raw.get("transport_events")
    require(isinstance(events, list) and len(events) <= 1000, "Invalid transport event inventory")
    for event in events:
        require(isinstance(event, dict) and event.get("symbol") == symbol and event.get("attribute") == attribute,
                "Transport event identity contradicts acquisition")
        start, end = batch.clock(event.get("started_at")), batch.clock(event.get("completed_at"))
        require(start <= end <= completed, "Transport event clock contradicts acquisition")
        for key in ("http_status", "detected_http_status"):
            status = event.get(key)
            require(status is None or type(status) is int and 100 <= status <= 599, "Invalid transport HTTP status")
        if event.get("transport_payload_sha256") is not None:
            archive._sha(event["transport_payload_sha256"])
    return {event[key] for event in events for key in ("http_status", "detected_http_status") if event.get(key) is not None}


def _stable_payload(payload, *, anchor=None, original=None, evaluated=None):
    result = deepcopy(payload)
    envelope = validate_envelope(result["financial_source_evidence"])
    for field, record in envelope["fields"].items():
        if record.get("provenance_kind") != "derived":
            continue
        if original is not None:
            previous = original["financial_source_evidence"]["fields"].get(field, {})
            require(previous.get("provenance_kind") == "derived", "Derived evidence changed provenance")
            timestamp = previous.get("computed_at")
            require(batch.clock(timestamp) <= evaluated, "Derived evidence is from the future")
        else:
            require(anchor is not None, "Derived evidence lacks source receipts")
            timestamp = anchor
        record["computed_at"] = timestamp
        record["observation_id"] = observation_id(record)
    result["financial_source_evidence"] = validate_envelope(envelope)
    return result


def _object(loaded, sha, kind):
    require(sha in loaded.objects and loaded.manifest["objects"][sha]["kind"] == kind,
            f"Missing or mistyped retained {kind}")
    return loaded.objects[sha][0]


def _legacy_projection(symbol, acquisitions, *, now, as_of):
    """Replay only the reviewed pre-fallback selector, without global mutation."""
    from . import financial_source_capture as capture
    from .eps_rating_service import EPSRatingService
    from .growth_cadence_service import compute_cadence_aware_growth
    from .static_financial_evidence import build_static_financial_current

    def preferred(frame, row, recent, baseline):
        return row if recent is not None and baseline is not None else None

    def bound(fn):
        result = FunctionType(fn.__code__, {**fn.__globals__, "select_quarterly_eps_pair_row": preferred},
                              fn.__name__, fn.__defaults__, fn.__closure__)
        result.__kwdefaults__ = fn.__kwdefaults__
        return result

    class OriginalSelector(EPSRatingService):
        extract_quarterly_yoy_growth = bound(EPSRatingService.extract_quarterly_yoy_growth)

    frames = {attribute: value["frame"] for attribute, value in acquisitions.items()}
    contexts = {attribute: value["context"] for attribute, value in acquisitions.items()}
    raw = {attribute: value["raw"] for attribute, value in acquisitions.items()}
    growth = bound(compute_cadence_aware_growth)(frames.get("quarterly_income_stmt"), market="US", include_source_context=True)
    eps = OriginalSelector().calculate_eps_rating_data(frames.get("income_stmt"), frames.get("quarterly_income_stmt"), include_source_context=True)
    context = {**growth.pop("_financial_source_context", {}), **eps.pop("_financial_source_context", {})}
    payload = {**growth, **eps, "symbol": symbol, "market": "US"}
    capture.attach_evidence(payload, capture.statement_evidence(payload, context, contexts), symbol=symbol, market="US")
    proof = build_static_financial_current(payload, now=now, as_of_date=as_of, market="US")
    history, history_diagnostics = batch.history_projection(symbol, raw, now=now, as_of=batch.day(as_of))
    return {"envelope": payload, "financial_current": proof, "financial_history": history,
            "history_source_diagnostics": history_diagnostics,
            "source_diagnostics": batch.source_diagnostics(raw, proof, history_diagnostics)}


def reviewed_migration(original, projected, acquisitions, *, symbol, summary_sha, envelope_sha, evaluated, as_of, derivation_deadline):
    migration, _ = read(ROOT / "contracts/financial_source_reviewed_migrations_v1.json")
    require(summary_sha == migration["original_batch_summary_sha256"] and symbol in migration["symbols"],
            f"Unreviewed historical projection difference: {symbol}")
    allowed = migration["symbols"][symbol]
    require(envelope_sha == allowed["original_envelope_sha256"], "Reviewed migration original envelope hash changed")
    changes = [{"symbol": symbol, "field": field, "before": original.get(field), "after": projected["envelope"].get(field)}
               for field in FINANCIAL_FIELDS if original.get(field) != projected["envelope"].get(field)]
    require(changes == allowed["scalar_changes"], "Unlisted field/value delta in reviewed projection migration")
    old_fields, new_fields = original["financial_source_evidence"]["fields"], projected["envelope"]["financial_source_evidence"]["fields"]
    observed_fields = {entry["field"] for entry in allowed["observed_changes"]}
    changed_fields = {field for field in set(old_fields) | set(new_fields) if old_fields.get(field) != new_fields.get(field)}
    # Derivation computation clocks are explicitly reanchored, but no other
    # observed record or source capture is allowed to change.
    require(changed_fields <= observed_fields | {"eps_raw_score"}, "Unlisted source evidence change in reviewed migration")
    require(original["financial_source_evidence"]["captures"] == projected["envelope"]["financial_source_evidence"]["captures"],
            "Reviewed migration changed original source receipts")
    for entry in allowed["observed_changes"]:
        field = entry["field"]
        record = new_fields.get(field, {})
        require(original.get(field) is None and old_fields.get(field) is None
                and record.get("metric") == entry["metric"] and record.get("basis") == entry["basis"]
                and all(record.get(key) == value for key, value in entry["source_identity"].items()),
                "Reviewed migration changed source input, metric, period or clock")
    legacy = _legacy_projection(symbol, acquisitions, now=evaluated, as_of=as_of)
    legacy["envelope"] = _stable_payload(legacy["envelope"], original=original, evaluated=derivation_deadline)
    require(canonical(legacy["envelope"]) == canonical(original), "Historical projection fails original-selector replay")
    return legacy, {"migration_id": migration["migration_id"], "original_batch_summary_sha256": summary_sha,
                    "symbol": symbol, "original_envelope_sha256": envelope_sha, "scalar_changes": changes,
                    "original_source_clocks_preserved": True, "derived_ratings_remain_quarantined": True}


def audit_archive_storage(loaded):
    """Audit retained generations and reject orphan or unindexed byte objects."""
    objects = list((loaded.root / "objects").iterdir())
    require(all(path.is_file() and path.suffix == ".json" for path in objects)
            and {path.stem for path in objects} == set(loaded.manifest["objects"]), "Orphan or missing archive object file")
    snapshots = list((loaded.root / "manifests").iterdir())
    require(any(path.name == loaded.sha256 + ".json" for path in snapshots), "Current immutable manifest snapshot missing")
    for path in snapshots:
        require(path.is_file() and path.suffix == ".json", "Invalid archive manifest snapshot file")
        archive._sha(path.stem)
        previous, content = read(path)
        require(batch.digest_bytes(content) == path.stem and previous.get("schema_version") == archive.SCHEMA,
                "Retained manifest snapshot hash/schema mismatch")
        for key in ("objects", "receipts"):
            require(isinstance(previous.get(key), dict)
                    and all(loaded.manifest[key].get(sha) == value for sha, value in previous[key].items()),
                    "Archive dropped or rewrote a retained generation")
        if path.stem == loaded.sha256:
            require(previous == loaded.manifest, "Current snapshot disagrees with manifest")


def audit_batches(loaded, *, now):
    """Replay historical stored projections at their actual evaluation clocks.

    Current load_archive audits every receipt and digest; this second pass checks
    retained batch links, failure objects, journal completeness and projections.
    Historical base bytes are not retained by v1 archives; their immutable hash
    is cross-bound between plan, cache and summary, never invented or renewed.
    """
    batches = loaded.manifest.get("batches")
    require(isinstance(batches, dict) and len(batches) <= 40000, "Missing batch inventory")
    failures, all_attempts, audited_results, referenced, migrations = [], {}, set(), set(), []
    historical_unavailable = set()
    meta_references = {kind: set() for kind in ("batch_plan", "batch_summary", "attempt_journal", "batch_envelope")}
    kinds = {entry["kind"] for entry in loaded.manifest["objects"].values()}
    require(kinds <= {"acquisition", "failed_acquisition", "cache_manifest", "batch_result", *meta_references}, "Unknown archive object kind")
    require({sha for sha, entry in loaded.manifest["objects"].items() if entry["kind"] == "acquisition"}
            == set(loaded.manifest["receipts"]), "Unindexed or missing retained acquisition")
    failed_index = {}
    receipt_clocks = {}
    for sha, receipt in loaded.manifest["receipts"].items():
        key = (receipt["symbol"], receipt["attribute"], receipt["observed_at"])
        require(receipt_clocks.setdefault(key, sha) == sha, "Ambiguous acquisitions at one source clock")
    for sha, entry in loaded.manifest["objects"].items():
        if entry["kind"] in {"acquisition", "failed_acquisition"}:
            raw = loaded.objects[sha][0]
            statuses = _transport(raw, now=now)
            if entry["kind"] == "acquisition":
                require(not statuses.intersection({403, 429}), "Successful receipt contains a provider block")
                context = raw["source_acquisition_contexts"][raw["attribute"]]
                matched = [event for event in raw["transport_events"] if event.get("transport_payload_sha256") == context["transport_payload_sha256"]]
                require(len(matched) == 1 and batch.clock(matched[0]["completed_at"]) <= batch.clock(context["observed_at"]),
                        "Source observation predates its completed transport")
            else:
                key = (raw["symbol"], raw["attribute"], raw["getter_completed_at"])
                require(key not in failed_index, "Ambiguous failed acquisition identity")
                failed_index[key] = (sha, raw, statuses)
    for sha, entry in loaded.manifest["objects"].items():
        if entry["kind"] != "cache_manifest":
            continue
        cached = loaded.objects[sha][0]
        require(cached.get("schema_version") == batch.CACHE_SCHEMA and isinstance(cached.get("acquisitions"), dict), "Invalid retained cache manifest")
        archive._binding(cached.get("binding"))
        for key, item in cached["acquisitions"].items():
            receipt = loaded.manifest["receipts"].get(item.get("sha256"))
            require(receipt is not None and key == f"{receipt['symbol']}/{receipt['attribute']}"
                    and all(item.get(field) == receipt[field] for field in ("symbol", "attribute", "capture_id", "observed_at", "origin_binding")),
                    "Unbound or contradictory original cache receipt")
    for journal_sha, index in batches.items():
        require(isinstance(index, dict) and set(index) == {"plan_sha256", "cache_sha256", "summary_sha256", "provider_stop", "execution_stop"}, "Malformed batch binding")
        require(index["summary_sha256"] is not None, "Incomplete batch cannot be certified")
        journal = _object(loaded, journal_sha, "attempt_journal")
        plan = _object(loaded, index["plan_sha256"], "batch_plan")
        cache = _object(loaded, index["cache_sha256"], "cache_manifest")
        summary = _object(loaded, index["summary_sha256"], "batch_summary")
        for kind, sha in (("attempt_journal", journal_sha), ("batch_plan", index["plan_sha256"]), ("batch_summary", index["summary_sha256"])):
            meta_references[kind].add(sha)
        require(batch.clock(plan["evaluation_time"]) <= batch.clock(plan["run_started_at"])
                <= batch.clock(summary["evaluation_time"]) <= now, "Retained batch plan/evaluation clock contradiction")
        selected = plan.get("selected", [])
        require(isinstance(selected, list) and 0 < len(selected) <= 200, "Malformed retained batch selection")
        symbols = [item.get("symbol") for item in selected]
        require(len(set(symbols)) == len(symbols) and all(batch.canonical_symbol(s) for s in symbols), "Ambiguous selected identity")
        require(set(symbols) <= set(plan.get("batch_allowlist", [])) <= set(plan.get("verified_us_cohort", {}).get("symbols", [])), "Retained batch exceeds cohort")
        base_sha = plan["verified_us_cohort"].get("base_artifact_sha256")
        archive._sha(base_sha)
        as_of = batch.day(plan.get("source_data_as_of"))
        require(cache.get("schema_version") == batch.CACHE_SCHEMA
                and cache.get("binding") == {"base_artifact_sha256": base_sha, "source_data_as_of": as_of.isoformat()}
                and summary.get("schema_version") == "financial-statement-batch-summary-v1"
                and summary.get("base_artifact_sha256") == base_sha and summary.get("source_data_as_of") == as_of.isoformat()
                and summary.get("plan_sha256") == index["plan_sha256"]
                and summary.get("attempts_sha256") == journal_sha and summary.get("cache_manifest_sha256") == index["cache_sha256"]
                and journal.get("schema_version") == "financial-statement-attempts-v1"
                and journal.get("plan_sha256") == index["plan_sha256"] and journal.get("run_id") == plan.get("run_id")
                and summary.get("provider_stop") == index["provider_stop"] and summary.get("execution_stop") == index["execution_stop"],
                "Retained plan/cache/journal/summary binding mismatch")
        require(summary.get("point_in_time") is False and summary.get("source_publication_date") is None,
                "Retained summary claims historical knowledge")
        attempts = journal.get("attempts")
        require(isinstance(attempts, list) and len(attempts) <= 400
                and summary.get("statement_getter_calls") == len(attempts), "Incomplete retained journal")
        by_symbol, seen_pairs = {}, set()
        for attempt in attempts:
            symbol, attribute = attempt.get("symbol"), attempt.get("attribute")
            pair = (symbol, attribute)
            require(symbol in symbols and attribute in next(item["attributes"] for item in selected if item["symbol"] == symbol)
                    and attempt.get("attributes") == [attribute] and pair not in seen_pairs
                    and isinstance(attempt.get("attempt_id"), str) and attempt["attempt_id"].startswith(journal["run_id"] + ":"),
                    "Attempt exceeds exact retained selected work")
            seen_pairs.add(pair)
            started, completed = batch.clock(attempt.get("attempted_at")), batch.clock(attempt.get("completed_at"))
            require(batch.clock(plan["run_started_at"]) <= started <= completed <= now, "Attempt clock invalid")
            require(attempt.get("acquisition_file") == f"acquisitions/{symbol}-{attribute}.json", "Attempt path identity mismatch")
            old = all_attempts.setdefault(attempt["attempt_id"], attempt)
            require(old == attempt, "Original terminal attempt was rewritten")
            event = loaded.manifest["attempts"].get(attempt["attempt_id"])
            require(event == archive._adapt_attempt(attempt, journal_sha), "Retained journal attempt omitted or changed")
            by_symbol.setdefault(symbol, {})[attribute] = attempt
            if attempt.get("outcome") == "succeeded":
                entry = cache.get("acquisitions", {}).get(f"{symbol}/{attribute}")
                require(entry is not None and entry.get("sha256") in loaded.acquisitions, "Successful attempt lacks retained receipt")
                value = loaded.acquisitions[entry["sha256"]]
                context = value["context"]
                require(attempt.get("capture_id") == context["capture_id"]
                        and started <= batch.clock(context["observed_at"]) <= batch.clock(value["raw"]["getter_completed_at"]) <= completed
                        and all(started <= batch.clock(event["started_at"]) for event in value["raw"]["transport_events"]),
                        "Successful attempt renews or contradicts original source clock")
            else:
                require(attempt.get("outcome") in {"failed", "provider_blocked", "budget_stopped"}, "Incomplete or invalid producer outcome")
                matches = [item for (s, a, clock), item in failed_index.items()
                           if s == symbol and a == attribute and started <= batch.clock(clock) <= completed]
                require(len(matches) == 1, "Failed attempt lacks one original failure artifact")
                sha, raw, statuses = matches[0]
                require(all(started <= batch.clock(event["started_at"]) for event in raw["transport_events"]), "Failure transport precedes attempt")
                referenced.add(sha)
                failure = raw.get("failure")
                require(isinstance(failure, dict) and failure.get("kind") == attempt.get("failure_kind")
                        and failure.get("kind") in {"getter_exception", "empty_getter_result", "provider_stopped", "acquisition_budget_stopped", "invalid_captured_evidence", "no_transport_bound_context"},
                        "Failure journal contradicts original artifact")
                if failure["kind"] == "empty_getter_result":
                    cells = raw.get("original_frame_cells")
                    empty = cells is None or cells == {"format": "original-yfinance-frame-cells-v1", "columns": [], "rows": []}
                    require((empty or batch.restore_frame(cells).empty)
                            and raw.get("source_acquisition_contexts") == {}, "Empty getter failure contains a nonempty or captured statement")
                require(failure["kind"] not in {"invalid_captured_evidence", "no_transport_bound_context"}, "Normalization contradiction in original acquisition")
                blocked = failure["kind"] == "provider_stopped" or bool(statuses.intersection({403, 429})) or attempt.get("http_status") in {403, 429}
                require(blocked == (attempt["outcome"] == "provider_blocked"), "Provider block was hidden or invented")
                if blocked:
                    require(failure["kind"] == "provider_stopped" and isinstance(failure.get("reason"), dict)
                            and failure["reason"] == summary.get("provider_stop"), "Provider stop omitted or changed in summary")
                    stop_status = failure["reason"].get("http_status", failure["reason"].get("detected_http_status"))
                    require(stop_status == attempt.get("http_status")
                            and (not statuses.intersection({403, 429}) or stop_status in statuses.intersection({403, 429})),
                            "HTTP provider block differs between transport, failure and journal")
                category = ("provider_blocked" if blocked else "ordinary_empty_statement" if failure["kind"] == "empty_getter_result"
                            and statuses and all(200 <= status < 300 for status in statuses) else "budget_stopped" if attempt["outcome"] == "budget_stopped" else "unknown_failure")
                failures.append({"attempt_id": attempt["attempt_id"], "symbol": symbol, "attribute": attribute,
                                 "outcome": attempt["outcome"], "failure_kind": failure["kind"], "category": category,
                                 "http_statuses": sorted(statuses), "attempted_at": attempt["attempted_at"],
                                 "completed_at": attempt["completed_at"], "source_object_sha256": sha})
        acquisitions = {}
        for key, entry in cache.get("acquisitions", {}).items():
            sha = entry.get("sha256")
            require(sha in loaded.acquisitions and key == f"{entry.get('symbol')}/{entry.get('attribute')}"
                    and entry.get("symbol") in symbols, "Retained cache identity mismatch")
            receipt = loaded.manifest["receipts"][sha]
            require(all(entry.get(k) == receipt[k] for k in ("symbol", "attribute", "capture_id", "observed_at", "origin_binding")), "Cache renews original receipt identity")
            acquisitions.setdefault(entry["symbol"], {})[entry["attribute"]] = loaded.acquisitions[sha]
        require(set(summary.get("results", {})) == set(symbols), "Incomplete batch result inventory")
        provider_attempts = [attempt for attempt in attempts if attempt["outcome"] == "provider_blocked"]
        require(bool(summary.get("provider_stop")) == bool(provider_attempts), "Provider stop summary contradicts actual attempts")
        if provider_attempts:
            stop = summary["provider_stop"]
            require(len(provider_attempts) == 1 and attempts[-1] == provider_attempts[0]
                    and stop.get("http_status", stop.get("detected_http_status")) == provider_attempts[0].get("http_status"),
                    "Provider work continued after block or stop status changed")
        failed = bool([a for a in attempts if a["outcome"] in {"failed", "provider_blocked"}])
        expected_exit = 4 if summary.get("execution_stop") is not None else 2 if summary.get("provider_stop") is not None else 3 if failed else 0
        require(summary.get("exit_code") == expected_exit, "Producer exit code contradicts retained outcomes")
        for symbol, entry in summary["results"].items():
            result = _object(loaded, entry.get("sha256"), "batch_result")
            require(entry.get("file") == f"results/{symbol}.json" and result.get("symbol") == symbol
                    and result.get("status") in {"captured", "unverified_or_unavailable"}
                    and result.get("status") == entry.get("status") and result.get("market") == "US"
                    and result.get("source_data_as_of") == as_of.isoformat(), "Batch result identity/normalization contradiction")
            attributes = result.get("attributes")
            require(isinstance(attributes, dict) and set(attributes) == set(batch.ATTRIBUTES), "Incomplete result attribute inventory")
            for attribute, detail in attributes.items():
                attempt = by_symbol.get(symbol, {}).get(attribute)
                acquisition = acquisitions.get(symbol, {}).get(attribute)
                state = detail.get("status")
                if attempt is not None:
                    expected_status = "captured" if attempt["outcome"] == "succeeded" else "budget_stopped" if attempt["outcome"] == "budget_stopped" else "fetch_failed"
                    require(state == expected_status, "Result hides actual getter failure/outcome")
                elif acquisition is not None:
                    require(state == "reused", "Unattempted receipt falsely claims new capture")
                else:
                    selected_attributes = next(item["attributes"] for item in selected if item["symbol"] == symbol)
                    allowed = ({"not_selected"} if attribute not in selected_attributes else
                               {"not_attempted_after_provider_stop"} if summary.get("provider_stop") is not None else
                               {"not_attempted_after_budget_stop"} if summary.get("execution_stop") is not None else set())
                    require(state in allowed, "Selected acquisition is missing without an explicit stop")
                if acquisition is not None:
                    require(detail.get("capture_id") == acquisition["context"]["capture_id"]
                            and detail.get("observed_at") == acquisition["context"]["observed_at"], "Result renews source clock or capture identity")
            evaluated = batch.clock(result.get("evaluation_time"))
            require(batch.clock(plan["evaluation_time"]) <= evaluated <= batch.clock(summary["evaluation_time"]) <= now,
                    "Result evaluation clock invalid")
            require(all(batch.clock(attempt["completed_at"]) <= evaluated for attempt in by_symbol.get(symbol, {}).values())
                    and all(batch.clock(value["context"]["observed_at"]) <= batch.clock(value["raw"]["getter_completed_at"]) <= evaluated
                            for value in acquisitions.get(symbol, {}).values()), "Result precedes original receipt or terminal attempt")
            _, projected = archive.project_symbol(symbol, acquisitions.get(symbol, {}), now=evaluated, as_of=as_of.isoformat())
            require(result.get("envelope_file") == f"envelopes/{symbol}.json", "Envelope path identity mismatch")
            original = _object(loaded, result.get("envelope_sha256"), "batch_envelope")
            meta_references["batch_envelope"].add(result["envelope_sha256"])
            validate_envelope(original.get("financial_source_evidence"))
            # A missing legacy derived field cannot be clock-aligned until the
            # explicitly reviewed selector migration is checked below.
            try:
                replay = _stable_payload(projected["envelope"], original=original, evaluated=batch.clock(summary["evaluation_time"]))
            except InvalidCertification:
                replay = projected["envelope"]
            stored_projection = projected
            if canonical(replay) != canonical(original):
                stored_projection, migration = reviewed_migration(
                    original, projected, acquisitions.get(symbol, {}), symbol=symbol,
                    summary_sha=index["summary_sha256"], envelope_sha=result["envelope_sha256"],
                    evaluated=evaluated, as_of=as_of.isoformat(), derivation_deadline=batch.clock(summary["evaluation_time"]))
                migrations.append(migration)
            for key in ("financial_current", "financial_history", "history_source_diagnostics", "source_diagnostics"):
                require(canonical(result.get(key)) == canonical(stored_projection[key]), f"Retained {key} differs from receipt replay: {symbol}")
            for position, field in enumerate(FINANCIAL_FIELDS):
                capture_id = original["financial_source_evidence"]["fields"].get(field, {}).get("capture_id")
                if result["financial_current"]["r"][position] == "e" and str(position) not in result["financial_current"]["p"] and capture_id:
                    historical_unavailable.add((symbol, field, capture_id))
            audited_results.add(entry["sha256"])
    for kind, referenced_hashes in meta_references.items():
        require(referenced_hashes == {sha for sha, item in loaded.manifest["objects"].items() if item["kind"] == kind}, f"Unbound retained {kind}")
    require(set(all_attempts) == set(loaded.manifest["attempts"]), "Unbound retained attempt")
    require(audited_results == {sha for sha, item in loaded.manifest["objects"].items() if item["kind"] == "batch_result"}, "Unbound retained batch result")
    require(referenced == {sha for sha, item in loaded.manifest["objects"].items() if item["kind"] == "failed_acquisition"}, "Unbound retained failure artifact")
    return sorted(failures, key=lambda item: item["attempt_id"]), all_attempts, migrations, historical_unavailable


def currency_only_limitation(field, projection, *, now, as_of):
    """Prove why a valid recorded value remains unusable, never grant a proof.

    The source actually declares zero/multiple currencies. A private diagnostic
    copy with a single placeholder unit must pass all other input and arithmetic
    checks. Original source bytes, source metadata and output proofs stay intact.
    """
    from .static_financial_evidence import _statement_proof
    envelope = deepcopy(projection["envelope"]["financial_source_evidence"])
    record = envelope["fields"].get(field)
    if not isinstance(record, dict) or record.get("provenance_kind") != "observed":
        return False
    context = envelope["captures"].get(record.get("capture_id"), {})
    source = record.get("source_payload", context.get("source_payload", {}))
    row = source.get("source_rows", {}).get(record.get("metric", "").lower().replace(" ", ""))
    if not isinstance(row, dict) or not isinstance(row.get("currencies"), list) or len(row["currencies"]) == 1:
        return False
    row["currencies"] = ["XXX"]
    reason, proof = _statement_proof(field, record, envelope, now=now, as_of=batch.day(as_of))
    return reason in {"0", "f"} and proof is not None


def current_projection(loaded, cohort, *, now, as_of, historical_unavailable=()):
    counts = {target: {key: 0 for key in ("ordinary", "nonpositive", "source_limited", "unknown")}
              for target in ("eps_growth_yy", "sales_growth_yy", "annual_history")}
    symbols, inventory, clocks = {}, [], []
    for sha, entry in sorted(loaded.manifest["receipts"].items()):
        inventory.append({"sha256": sha, **entry})
        clocks.append(entry["observed_at"])
    for symbol in cohort["symbols"]:
        acquisitions = {attribute: loaded.acquisitions[sha] for attribute in batch.ATTRIBUTES
                        if (sha := loaded.manifest["current"].get(f"{symbol}/{attribute}")) is not None}
        status, projection = archive.project_symbol(symbol, acquisitions, now=now, as_of=as_of)
        anchor = max((item["context"]["observed_at"] for item in acquisitions.values()), default=None)
        projection["envelope"] = _stable_payload(projection["envelope"], anchor=anchor)
        classified, limitations = {}, {}
        for field, state in (("eps_growth_yy", status.eps), ("sales_growth_yy", status.sales)):
            reason = projection["financial_current"]["r"][FINANCIAL_FIELDS.index(field)]
            currency_limited = False
            if reason == "e":
                capture_id = projection["envelope"]["financial_source_evidence"]["fields"].get(field, {}).get("capture_id")
                currency_limited = ((symbol, field, capture_id) in historical_unavailable
                                    and str(FINANCIAL_FIELDS.index(field)) not in projection["financial_current"]["p"]
                                    and currency_only_limitation(field, projection, now=now, as_of=as_of))
                require(currency_limited, f"Contradictory current proof: {symbol}/{field}")
                limitations[field] = "mixed_or_missing_source_currency; audit_reference_only"
            require(reason not in {"3", "4", "5", "6", "c", "d"}, f"Contradictory current proof: {symbol}/{field}")
            category = ("unknown" if currency_limited else "ordinary" if reason == "0" else "nonpositive" if reason == "f" else "source_limited"
                        if state.state == "source_limited" and state.expires_at is not None and now <= state.expires_at else "unknown")
            classified[field] = category
        annual_reason = projection["history_source_diagnostics"]["reasons"]["annual"]
        classified["annual_history"] = ("ordinary" if annual_reason == "available" else "nonpositive" if annual_reason == "nonpositive_comparison_base" else "unknown")
        for target, category in classified.items():
            counts[target][category] += 1
        projection["availability_classification"] = classified
        projection["certification_limitations"] = limitations
        symbols[symbol] = projection
    return {"schema_version": PROJECTION_SCHEMA, "evaluated_at": batch.timestamp(now),
            "source_data_as_of": as_of, "knowledge_basis": KNOWLEDGE, "point_in_time": False,
            "source_publication_date": None, "qualification_authority": False,
            "symbols": symbols, "receipt_inventory": inventory}, counts, {
                "earliest": min(clocks, key=batch.clock) if clocks else None,
                "latest": max(clocks, key=batch.clock) if clocks else None}


def certify_directory(root, request, evidence, *, now, code_sha, api_evidence_sha256):
    source = parse_request(request)
    run, job, artifact = verify_source_api(source, evidence, now)
    require(isinstance(code_sha, str) and re.fullmatch(r"[a-f0-9]{40}", code_sha), "Exact validation code SHA required")
    cycle, cycle_bytes = read(root / "cycle.json")
    base, base_bytes = read(root / "base.json", batch.MAX_BASE_BYTES)
    cohort, cohort_bytes = read(root / "cohort.json")
    require(batch.digest_bytes(base_bytes) == source["acquisition_base_sha256"]
            and batch.digest_bytes(cohort_bytes) == source["cohort_sha256"], "Base/cohort digest mismatch")
    require(cycle.get("schema_version") == "financial-recovery-cycle-v1" and cycle.get("phase") == "completed"
            and cycle.get("dry_run") is False and cycle.get("published") is False
            and cycle.get("code_revision") == source["head_sha"]
            and cycle.get("archive_manifest_sha256") == source["archive_manifest_sha256"]
            and cycle.get("base_artifact_sha256") == source["acquisition_base_sha256"]
            and cycle.get("source_data_as_of") == base.get("as_of_date"), "Incomplete or contradictory recovery cycle")
    require(type(cycle.get("exit_code")) is int and cycle["exit_code"] in {0, 2, 3, 4}
            and (cycle["exit_code"] == 0) == (run["conclusion"] == "success"), "Producer conclusion must retain actual cycle failure")
    loaded = archive.load_archive(root / "archive", source["archive_manifest_sha256"], base_bytes=base_bytes, cohort=cohort, now=now)
    audit_archive_storage(loaded)
    require(cycle.get("retained_receipts") == len(loaded.manifest["receipts"])
            and cycle.get("retained_symbols") == len({entry["symbol"] for entry in loaded.manifest["receipts"].values()}), "Cycle inventory disagrees with archive")
    require(loaded.manifest["binding"] == {"base_artifact_sha256": source["acquisition_base_sha256"], "source_data_as_of": base["as_of_date"]}, "Archive current base binding differs from producer cycle")
    failures, attempts, migrations, historical_unavailable = audit_batches(loaded, now=now)
    require(type(cycle.get("selected_symbols")) is int and 1 <= cycle["selected_symbols"] <= 200,
            "Certification requires an explicit completed producer batch; no-op cycles are unsupported")
    if cycle["selected_symbols"]:
        latest, latest_bytes = read(root / "batch/summary.json")
        latest_sha = batch.digest_bytes(latest_bytes)
        require(latest_sha in loaded.objects and loaded.objects[latest_sha][1] == latest_bytes
                and latest.get("exit_code") == cycle["exit_code"]
                and latest.get("selected_symbols") == cycle["selected_symbols"], "Latest producer summary is missing or contradictory")
        latest_plan = _object(loaded, latest["plan_sha256"], "batch_plan")
        batch.validate_plan(latest_plan, base_bytes)
        require(batch.clock(job["started_at"]) <= batch.clock(latest_plan["run_started_at"])
                <= batch.clock(latest["evaluation_time"]) <= batch.clock(loaded.manifest["committed_at"])
                <= batch.clock(artifact["created_at"]), "Latest batch clocks do not bind the exact producer attempt")
        require(latest_plan["verified_us_cohort"]["base_artifact_sha256"] == cohort["base_artifact_sha256"]
                and set(latest_plan["verified_us_cohort"]["symbols"]) == set(cohort["symbols"]),
                "Current full cohort differs from exact producer batch")
    latest_attempts = _object(loaded, latest["attempts_sha256"], "attempt_journal")["attempts"]
    latest_ids = {attempt["attempt_id"] for attempt in latest_attempts}
    latest_failures = [failure for failure in failures if failure["attempt_id"] in latest_ids]
    projection, counts, bounds = current_projection(loaded, cohort, now=now, as_of=base["as_of_date"], historical_unavailable=historical_unavailable)
    projection["bindings"] = {key: source[key] for key in ("archive_manifest_sha256", "acquisition_base_sha256", "cohort_sha256")}
    projection_bytes = canonical(projection)
    require(len(projection_bytes) <= 256 * 1024 * 1024, "Projection exceeds bound")
    projection_sha = batch.digest_bytes(projection_bytes)
    contract, contract_bytes = read(CONTRACT_PATH)
    require(contract.get("schema_version") == SCHEMA and contract.get("projection_policy") == POLICY, "Certification contract mismatch")
    code_hashes = {path: batch.digest_bytes(archive._safe(ROOT / path).read_bytes()) for path in CODE_FILES}
    blocked = [failure for failure in failures if failure["category"] == "provider_blocked"]
    attempted_symbols = {item["symbol"] for item in attempts.values()} | {item["symbol"] for item in loaded.manifest["receipts"].values()}
    certificate = {
        "schema_version": SCHEMA, "kind": "source_artifact_validation", "result": "certified",
        "evaluated_at": batch.timestamp(now),
        "validation": {"code_sha": code_sha, "contract_version": SCHEMA, "contract_sha256": batch.digest_bytes(contract_bytes),
                       "projection_policy": POLICY, "policy_sha256": digest(code_hashes), "reviewed_projector_migrations": migrations},
        "source": source,
        "bindings": {"cycle_sha256": batch.digest_bytes(cycle_bytes), "archive_manifest_sha256": loaded.sha256,
                     "acquisition_base_sha256": source["acquisition_base_sha256"], "cohort_sha256": source["cohort_sha256"],
                     "source_api_evidence_sha256": api_evidence_sha256, "request_sha256": digest(request)},
        "projection": {"schema_version": PROJECTION_SCHEMA, "path": f"projections/{projection_sha}.json", "sha256": projection_sha,
                       "receipt_inventory_sha256": digest(projection["receipt_inventory"]), "source_timestamp_bounds": bounds,
                       "counts": counts, "cohort_count": len(cohort["symbols"]), "retained_receipts": len(loaded.manifest["receipts"]),
                       "retained_symbols": len({entry["symbol"] for entry in loaded.manifest["receipts"].values()}),
                       "attempted_symbols": len(attempted_symbols & set(cohort["symbols"])), "source_data_as_of": base["as_of_date"],
                       "knowledge_basis": KNOWLEDGE, "point_in_time": False, "source_publication_date": None,
                       "qualification_authority": False, "complete_availability_required": False},
        "source_execution": {"producer_run_conclusion": run["conclusion"], "producer_job_conclusion": job["conclusion"],
                             "producer_job_id": job["id"], "producer_exit_code": cycle["exit_code"],
                             "failure_inventory_scope": "cumulative_archive",
                             "producer_batch": {"summary_sha256": latest_sha, "plan_sha256": latest["plan_sha256"],
                                                "attempts_sha256": latest["attempts_sha256"],
                                                "statement_getter_calls": len(latest_attempts),
                                                "attempt_outcome_counts": dict(sorted(Counter(a["outcome"] for a in latest_attempts).items())),
                                                "empty_getter_count": sum(f["category"] == "ordinary_empty_statement" for f in latest_failures),
                                                "unknown_failure_count": sum(f["category"] == "unknown_failure" for f in latest_failures)},
                             "provider_state": "blocked" if blocked else "no_block_observed",
                             "provider_failures": blocked, "failures": failures,
                             "empty_getter_count": sum(f["category"] == "ordinary_empty_statement" for f in failures),
                             "unknown_failure_count": sum(f["category"] == "unknown_failure" for f in failures),
                             "attempt_outcome_counts": dict(sorted(Counter(a["outcome"] for a in attempts.values()).items())),
                             "further_provider_work_allowed": False,
                             "original_outcomes_retained": True,
                             "certification_is_complete_availability": False},
        "published": False,
    }
    return certificate, projection_bytes


def certify(*, request_path, api_evidence_path, source_zip, output_dir, evaluated_at, code_sha):
    request, _ = read(request_path)
    source = parse_request(request)
    evidence, evidence_bytes = read(api_evidence_path)
    now = batch.clock(evaluated_at)
    _, _, artifact = verify_source_api(source, evidence, now)
    require(archive._safe(source_zip).stat().st_size == artifact["size_in_bytes"], "ZIP length disagrees with GitHub artifact metadata")
    output_dir = archive._safe(output_dir)
    require(not output_dir.exists(), "Certification output must be new")
    with tempfile.TemporaryDirectory(prefix="statement-certification-") as temporary:
        root = Path(temporary)
        extract_zip(source_zip, root, source["artifact_sha256"])
        certificate, projection_bytes = certify_directory(root, request, evidence, now=now, code_sha=code_sha,
                                                           api_evidence_sha256=batch.digest_bytes(evidence_bytes))
    output_dir.mkdir(parents=True)
    (output_dir / "source-api-evidence.json").write_bytes(evidence_bytes)
    (output_dir / "request.json").write_bytes(canonical(request))
    code_manifest = {path: batch.digest_bytes(archive._safe(ROOT / path).read_bytes()) for path in CODE_FILES}
    require(digest(code_manifest) == certificate["validation"]["policy_sha256"], "Validation code changed during certification")
    (output_dir / "validation-code-manifest.json").write_bytes(canonical(code_manifest))
    projection_path = output_dir / certificate["projection"]["path"]
    projection_path.parent.mkdir()
    projection_path.write_bytes(projection_bytes)
    certificate_bytes = canonical(certificate)
    path = output_dir / "certificate.json"
    path.write_bytes(certificate_bytes)
    return {"certificate_path": str(path), "certificate_sha256": batch.digest_bytes(certificate_bytes), **certificate}
