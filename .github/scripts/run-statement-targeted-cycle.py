"""One authenticated, receipt-bound NVDA/AAOI collection; no admission or publish.

The controller authenticates the durable request against GitHub at entry and
again through a token-free parent handshake after full-source preparation.
Local checks do not replace that remote authentication. There is no dry-run,
retry, request-expiry extension or resume mode.
"""
from __future__ import annotations

import argparse
from datetime import datetime, timedelta, timezone
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import sys

from app.scripts.prepare_statement_targeted_preflight import (
    SYMBOLS, TARGETS, bound_input, exact, receipt_bound_attempt, select_due_targets, serializable,
)
from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services import statement_refresh_planning as planning
from app.services.statement_retention_budget import StatementRetentionBudget

REQUEST_SCHEMA = "financial-targeted-recovery-execution-v1"
REPLACEMENT_REQUEST_SCHEMA = "financial-targeted-recovery-execution-v2"
CHAINED_REPLACEMENT_REQUEST_SCHEMA = "financial-targeted-recovery-execution-v3"
RUN8_REPLACEMENT_REQUEST_SCHEMA = "financial-targeted-recovery-execution-v4"
RUN9_REPLACEMENT_REQUEST_SCHEMA = "financial-targeted-recovery-execution-v5"
REVIEWED_ABORT = {"schema_version": "financial-pre-provider-abort-v1", "run_id": 38991458566,
    "run_attempt": 1, "run_number": 5, "head_sha": "afba716470995a59c41043f982e1c09f987b1c53",
    "request_sha256": "7f0bd22ed8fcedb703c9c851b0891512d52dd8c7b781bb2ab8a85c3b6fd06c1d",
    "job_id": 117274547210, "job_log_sha256": "acf29622ccbd3933c1e220ca8f41b1c77beae3320a4f63bdb580a07078066f87"}
REVIEWED_ABORT6 = {"schema_version": "financial-pre-provider-abort-v1", "run_id": 38993132263,
    "run_attempt": 1, "run_number": 6, "head_sha": "12b4e4dba9c847d754b7ec3b47b234984386a1f4",
    "request_sha256": "cf059634ca8e29f3bf4a8ab70ec14a6e9cf76ee76ad3948d0ac619a30def13ca",
    "job_id": 117279659374, "job_log_sha256": "47dabe41056aeb89eb17d2408bb120c10998868eaf4ccfb17597026b6ccfc462"}
REVIEWED_ABORT7 = {"schema_version": "financial-pre-provider-abort-v1", "run_id": 38997227416,
    "run_attempt": 1, "run_number": 7, "head_sha": "b6378b8077b51f18d63e6dbb4d221ac47144bee4",
    "request_sha256": "846a0d2a07e2a43b6eee3837f19dfb01e233866a8b3e1912a57d025d3a043e00",
    "job_id": 117292325413, "job_log_sha256": "5ce16137dfe39a063a3f0903031eb93bdb1f792a08dee1549c97bdf3b152ae56"}
# Closed prepared abort only; the parent verifies its exact retained ZIP bytes.
# It never becomes the completed source and cannot weaken source4 restoration.
REVIEWED_PREPARED_ABORT8 = {"schema_version": "financial-prepared-pre-provider-abort-v1", "run_id": 39013437787,
    "run_attempt": 1, "run_number": 8, "head_sha": "49ca70d2c09dac84ce2ae1100617f9aba3a78527",
    "request_sha256": "13bbc9b0edff90a99f28d111bab483c0f61c9f2efc4f739548dff1e859b08d63",
    "job_id": 117340568549, "job_log_sha256": "37a202f5d7d992b2f61f154715ffd4758f9e2a652c3ecb65805019c9bbd7f1b0",
    "artifact_id": 12093719779, "artifact_bytes": 29737343,
    "artifact_sha256": "3518d1a73c0ec4999fdaa67d6deafd7a19157e69a15f5a184b645aa1cf9c34f5"}
REVIEWED_SOURCE = {"run_id": 37478731832, "run_attempt": 1,
    "head_sha": "4715b218cc25720d1d3be455930554e1e6282136", "artifact_id": 11420873789,
    "artifact_sha256": "266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd",
    "archive_manifest_sha256": "2593d2c737724da007a72091b7b85d6007530e0fb6fc7e4e0765d75692b007d0",
    "base_sha256": "2524eeac36bcb79d3ebe75f7f57d5672e91e1dafcd80a23d180ae39de867b932",
    "cohort_sha256": "36a83c34c33b0158f1d246226d8d538797c6c6e6494669c6feacefa82da12580"}
INVOCATION_SCHEMA = "financial-targeted-recovery-invocation-v1"
REPOSITORY = "kusennjp1-ai/screener"
WORKFLOW = ".github/workflows/financial-statement-recovery.yml"
BRANCH = "improve/mandatory-financial-source-recovery"
LIMITS = {"max_symbols": 2, "max_statement_getter_calls": 4, "max_transport_requests": 1000,
          "acquisition_budget_seconds": 1080, "caller_retries": 0}
SOURCE_FIELDS = ("run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256",
                 "archive_manifest_sha256", "base_sha256", "cohort_sha256")
PRICE_FIELDS = ("run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256",
                "companion_id", "companion_sha256", "manifest_sha256", "research_sha256")


def recovery_helpers():
    spec = importlib.util.spec_from_file_location("targeted_existing_recovery", Path(__file__).with_name("run-statement-recovery-cycle.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha1(value):
    if not isinstance(value, str) or not re.fullmatch(r"[a-f0-9]{40}", value):
        raise ValueError("Invalid code identity")


def positive(value):
    if type(value) is not int or not 0 < value <= 2**53 - 1:
        raise ValueError("Invalid positive run identity")


def validate_request(request, *, now):
    run9 = isinstance(request, dict) and request.get("schema_version") == RUN9_REPLACEMENT_REQUEST_SCHEMA
    run8 = run9 or (isinstance(request, dict) and request.get("schema_version") == RUN8_REPLACEMENT_REQUEST_SCHEMA)
    chained = run8 or (isinstance(request, dict) and request.get("schema_version") == CHAINED_REPLACEMENT_REQUEST_SCHEMA)
    replacement = isinstance(request, dict) and request.get("schema_version") in (
        REPLACEMENT_REQUEST_SCHEMA, CHAINED_REPLACEMENT_REQUEST_SCHEMA, RUN8_REPLACEMENT_REQUEST_SCHEMA, RUN9_REPLACEMENT_REQUEST_SCHEMA)
    fields = ("schema_version", "operation_id", "created_at", "expires_at", "controller",
                    "expected_run_number", "source", "price_source", "selection", "limits",
                    "publication_authority", "financial_admission")
    exact(request, fields + (("abort_continuity",) if replacement else ()), "execution request")
    if (request["schema_version"] not in (REQUEST_SCHEMA, REPLACEMENT_REQUEST_SCHEMA, CHAINED_REPLACEMENT_REQUEST_SCHEMA, RUN8_REPLACEMENT_REQUEST_SCHEMA, RUN9_REPLACEMENT_REQUEST_SCHEMA) or request["publication_authority"] != "none"
            or request["financial_admission"] is not False):
        raise ValueError("Only a new acquisition-only execution request is accepted")
    if replacement:
        # This is a second boundary check. Current GitHub continuity and the
        # exact spent request/log remain authenticated by the parent handshake.
        binding = ({"run8": REVIEWED_PREPARED_ABORT8, "run7": REVIEWED_ABORT7, "run6": REVIEWED_ABORT6, "run5": REVIEWED_ABORT} if run9 else
                   {"run7": REVIEWED_ABORT7, "run6": REVIEWED_ABORT6, "run5": REVIEWED_ABORT} if run8 else
                   {"run6": REVIEWED_ABORT6, "run5": REVIEWED_ABORT} if chained else REVIEWED_ABORT)
        exact(request["abort_continuity"], binding, "reviewed pre-provider abort continuity")
        if (request["abort_continuity"] != binding or request["source"] != REVIEWED_SOURCE
                or type(request["expected_run_number"]) is not int or request["expected_run_number"] != (9 if run9 else 8 if run8 else 7 if chained else 6)):
            raise ValueError("Only the exact reviewed abort continuity may precede this replacement")
        identities = ((request["abort_continuity"]["run8"], request["abort_continuity"]["run7"], request["abort_continuity"]["run6"], request["abort_continuity"]["run5"]) if run9 else
                      (request["abort_continuity"]["run7"], request["abort_continuity"]["run6"], request["abort_continuity"]["run5"]) if run8 else
                      (request["abort_continuity"]["run6"], request["abort_continuity"]["run5"]) if chained else (request["abort_continuity"],))
        for identity in identities:
            if any(type(identity[key]) is not int for key in ("run_id", "run_attempt", "run_number", "job_id")):
                raise ValueError("Reviewed abort identities require exact integer values")
        if run9 and any(type(request["abort_continuity"]["run8"][key]) is not int for key in ("artifact_id", "artifact_bytes")):
            raise ValueError("Prepared abort artifact requires exact integer values")
    if not isinstance(request["operation_id"], str) or not re.fullmatch(r"targeted-nvda-aaoi-[a-z0-9-]{1,64}", request["operation_id"]):
        raise ValueError("Invalid finite operation identity")
    if any(not isinstance(request[key], str) or not request[key].endswith("Z") for key in ("created_at", "expires_at")):
        raise ValueError("Explicit UTC execution clocks are required")
    created, expires = batch.clock(request["created_at"]), batch.clock(request["expires_at"])
    if replacement and (created <= batch.clock("2026-10-17T07:41:58Z" if run9 else "2026-10-17T03:03:22Z" if run8 else "2026-10-17T02:01:05Z" if chained else "2026-10-17T01:37:34Z")
                        or request["operation_id"] == "targeted-nvda-aaoi-20261017t013151z"
                        or (chained and request["operation_id"] == "targeted-nvda-aaoi-20261017t015500z")
                        or (run8 and request["operation_id"] == "targeted-nvda-aaoi-20261017t025809z")
                        or (run9 and request["operation_id"] == "targeted-nvda-aaoi-20261017t071531z-289570b8")):
        raise ValueError("A spent operation cannot be renewed")
    if not created <= now < expires or not timedelta(0) < expires - created <= timedelta(hours=2):
        raise ValueError("Execution request must be current and finite")
    exact(request["controller"], ("parent_sha", "parent_tree"), "controller identity")
    for value in request["controller"].values():
        sha1(value)
    positive(request["expected_run_number"])
    for key, fields in (("source", SOURCE_FIELDS), ("price_source", PRICE_FIELDS)):
        identity = request[key]
        exact(identity, fields, key)
        for name, value in identity.items():
            if name in ("run_id", "run_attempt", "artifact_id", "companion_id"):
                positive(value)
            elif name == "head_sha":
                sha1(value)
            else:
                archive._sha(value)
    exact(request["limits"], LIMITS, "execution limits")
    if request["limits"] != LIMITS or any(type(value) is not int for value in request["limits"].values()):
        raise ValueError("Target execution limits cannot expand")
    entries = request["selection"]
    if not isinstance(entries, list) or len(entries) != 2:
        raise ValueError("Exactly NVDA and AAOI must be selected")
    selected = {}
    for entry in entries:
        exact(entry, ("symbol", "targets", "receipts"), "receipt-bound selection")
        symbol, targets = entry["symbol"], entry["targets"]
        if not isinstance(symbol, str) or symbol not in SYMBOLS or symbol in selected:
            raise ValueError("Only NVDA and AAOI may be selected once")
        if not isinstance(targets, list) or targets != list(TARGETS):
            raise ValueError("Explicit canonical financial targets are required")
        expected_attributes = batch.ATTRIBUTES
        receipts = entry["receipts"]
        if not isinstance(receipts, list) or len(receipts) != len(expected_attributes):
            raise ValueError("Every selected getter needs an original receipt binding")
        for receipt, attribute in zip(receipts, expected_attributes):
            exact(receipt, ("attribute", "receipt_sha256", "attempt_id", "attempt_object_sha256"), "selected receipt")
            if receipt["attribute"] != attribute or not isinstance(receipt["attempt_id"], str) or not 0 < len(receipt["attempt_id"]) <= 100:
                raise ValueError("Selected receipt identity is invalid or unordered")
            archive._sha(receipt["receipt_sha256"])
            archive._sha(receipt["attempt_object_sha256"])
        selected[symbol] = tuple(targets)
    if list(selected) != ["NVDA", "AAOI"]:
        raise ValueError("Execution request selection must name NVDA then AAOI")
    return selected


def validate_invocation(invocation, request, request_bytes, *, now, fresh=True):
    exact(invocation, ("schema_version", "request_sha256", "authenticated_at", "repository", "workflow", "event", "branch",
                       "run_id", "run_attempt", "run_number", "head_sha", "controller_parent_sha", "controller_parent_tree",
                       "source", "price_source", "base_sha256", "cohort_sha256", "publication_authority", "financial_admission"),
          "authenticated invocation")
    if (invocation["schema_version"] != INVOCATION_SCHEMA or invocation["request_sha256"] != batch.digest_bytes(request_bytes)
            or invocation["repository"] != REPOSITORY or invocation["workflow"] != WORKFLOW
            or invocation["event"] != "push" or invocation["branch"] != BRANCH
            or type(invocation["run_attempt"]) is not int or invocation["run_attempt"] != 1
            or invocation["run_number"] != request["expected_run_number"]
            or invocation["controller_parent_sha"] != request["controller"]["parent_sha"]
            or invocation["controller_parent_tree"] != request["controller"]["parent_tree"]
            or batch._json_bytes(invocation["source"]) != batch._json_bytes(request["source"])
            or batch._json_bytes(invocation["price_source"]) != batch._json_bytes(request["price_source"])
            or invocation["publication_authority"] != "none" or invocation["financial_admission"] is not False):
        raise ValueError("Invocation does not bind the authenticated execution request")
    positive(invocation["run_id"])
    positive(invocation["run_number"])
    sha1(invocation["head_sha"])
    for key in ("request_sha256", "base_sha256", "cohort_sha256"):
        archive._sha(invocation[key])
    if not isinstance(invocation["authenticated_at"], str) or not invocation["authenticated_at"].endswith("Z"):
        raise ValueError("Explicit UTC authentication clock is required")
    authenticated = batch.clock(invocation["authenticated_at"])
    if (not batch.clock(request["created_at"]) <= authenticated <= now
            or (fresh and now - authenticated > timedelta(seconds=120))):
        raise ValueError("Authentication clock is missing, future or stale")
    expected_env = {"GITHUB_REPOSITORY": REPOSITORY, "GITHUB_EVENT_NAME": "push", "GITHUB_REF_NAME": BRANCH,
                    "GITHUB_RUN_ID": str(invocation["run_id"]), "GITHUB_RUN_ATTEMPT": "1",
                    "GITHUB_RUN_NUMBER": str(invocation["run_number"]), "GITHUB_SHA": invocation["head_sha"]}
    if any(os.environ.get(key) != value for key, value in expected_env.items()):
        raise ValueError("Invocation differs from this actual Actions run")


def validate_receipts(current, request, targeted, *, now):
    requested = {entry["symbol"]: entry for entry in request["selection"]}
    for item in targeted.batch:
        bound = requested[item.symbol]
        if tuple(bound["targets"]) != item.ready_targets or tuple(r["attribute"] for r in bound["receipts"]) != item.attributes:
            raise ValueError("Due selection differs from the exact requested getters")
        for receipt in bound["receipts"]:
            attribute, sha = receipt["attribute"], receipt["receipt_sha256"]
            if current.manifest["current"].get(f"{item.symbol}/{attribute}") != sha:
                raise ValueError("Requested receipt is not the current original receipt")
            latest, _ = receipt_bound_attempt(current, symbol=item.symbol, attribute=attribute, receipt_sha=sha, now=now)
            if (latest["attempt_id"] != receipt["attempt_id"]
                    or latest["source_object_sha256"] != receipt["attempt_object_sha256"]):
                raise ValueError("Requested receipt differs from its latest actual attempt")


def prepare_archive_lock(root):
    """Own the archive writer's empty lock BEFORE freezing retention inventory.

    Actions uploads may omit hidden files. _commit creates .archive.lock during
    merge; adding it only after before_merge correctly fails the existing guard.
    Never exempt arbitrary files, change the guard, or delete original evidence.
    """
    path = archive._safe(root / ".archive.lock")
    try:
        descriptor = os.open(path, os.O_CREAT | os.O_EXCL | os.O_WRONLY | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size != 0:
            raise ValueError("Archive lock must be an empty unlinked regular file")
    else:
        os.close(descriptor)


def authenticate_provider():
    """Request one fresh read-only authentication from the token-owning parent.

    The fixed marker grants no endpoint selection. Python inherits no GitHub
    token; only the controller performs the already-authorized remote reads.
    Direct execution without this parent handshake fails closed.
    """
    if os.write(3, b"recheck\n") != 8:
        raise ValueError("Incomplete parent authentication request")
    response = sys.stdin.buffer.readline(32769)
    if not response or len(response) > 32768 or not response.endswith(b"\n"):
        raise ValueError("Missing or unbounded parent authentication response")
    try:
        value = json.loads(response, object_pairs_hook=batch._pairs)
    except (ValueError, UnicodeError) as exc:
        raise ValueError("Malformed parent authentication response") from exc
    if not isinstance(value, dict):
        raise ValueError("Parent authentication response must be an invocation")
    return value


def run(inputs, restored, output, *, request_path, job_started_at, collector=None, now_fn=None, authenticator=None):
    if any(key in os.environ for key in ("GH_TOKEN", "GITHUB_TOKEN")):
        raise ValueError("Provider process must not inherit authentication credentials")
    now_fn = now_fn or (lambda: datetime.now(timezone.utc))
    collector = collector or batch.collect
    authenticator = authenticator or authenticate_provider
    paths = (inputs, restored, output, request_path)
    if any(".." in Path(path).parts for path in paths):
        raise ValueError("Parent traversal is not permitted")
    inputs, restored, output, request_path = map(archive._safe, paths)
    controller = Path(__file__).resolve().parents[2]
    if output.exists() or any(output == root or output in root.parents or root in output.parents
                              for root in (inputs, restored, controller, request_path.parent)):
        raise ValueError("Output must be new and separate from inputs and controller")
    now = now_fn()
    request, request_bytes = archive._read(request_path, 32768)
    selected = validate_request(request, now=now)
    _, staged_request = bound_input(inputs / "request.json", batch.digest_bytes(request_bytes), 32768)
    invocation, invocation_bytes = archive._read(inputs / "invocation.json", 32768)
    validate_invocation(invocation, request, request_bytes, now=now)
    helpers = recovery_helpers()
    helpers.bounded_acquisition_budget(job_started_at, now=now)
    source = request["source"]
    provenance, provenance_bytes = archive._read(restored / "restored.json")
    if (provenance.get("schema_version") != "financial-source-restore-v1"
            or provenance.get("kind") != "recovery_archive" or provenance.get("repository") != REPOSITORY
            or any(provenance.get(key) != source[key] for key in ("run_id", "run_attempt", "head_sha", "artifact_id", "artifact_sha256"))):
        raise ValueError("Restored provenance differs from the authenticated source")
    original_files = restored / "files"
    old_base, old_base_bytes = bound_input(original_files / "base.json", source["base_sha256"], batch.MAX_BASE_BYTES)
    old_cohort, old_cohort_bytes = bound_input(original_files / "cohort.json", source["cohort_sha256"])
    old_cycle, old_cycle_bytes = archive._read(original_files / "cycle.json")
    if (old_cycle.get("schema_version") != "financial-recovery-cycle-v1"
            or old_cycle.get("phase") != "completed" or old_cycle.get("dry_run") is not False
            or old_cycle.get("published") is not False or old_cycle.get("archive_manifest_sha256") != source["archive_manifest_sha256"]):
        raise ValueError("Targeted execution requires an authenticated completed source cycle")
    base, base_bytes = bound_input(inputs / "base.json", invocation["base_sha256"], batch.MAX_BASE_BYTES)
    cohort, cohort_bytes = bound_input(inputs / "cohort.json", invocation["cohort_sha256"])
    if cohort.get("symbols") != old_cohort.get("symbols"):
        raise ValueError("The complete original cohort and order must be preserved")
    if batch.day(base["as_of_date"]) < batch.day(old_base["as_of_date"]):
        raise ValueError("Current price input predates the original base")
    archive.verify_base(base_bytes, cohort, now=now)
    original = archive.load_archive(original_files / "archive", source["archive_manifest_sha256"],
                                    base_bytes=old_base_bytes, cohort=old_cohort, now=now)
    if original.manifest["binding"] != archive.verify_base(old_base_bytes, old_cohort, now=now):
        raise ValueError("Original source base does not bind its archive")
    planned, _, _ = archive.plan_archive(original, base_bytes=base_bytes, cohort=cohort, now=now, batch_limit=200)
    targeted = select_due_targets(planned, selected)
    validate_receipts(original, request, targeted, now=now)
    plan = planning.export_statement_batch_plan(targeted, base_artifact_sha256=cohort["base_artifact_sha256"],
        source_data_as_of=base["as_of_date"], batch_allowlist=targeted.symbols)
    plan["verified_us_cohort"] = cohort
    batch.validate_plan(plan, base_bytes)
    output.mkdir(parents=True, exist_ok=False)
    # Root inputs match the next manifest; immutable original inputs remain exact.
    for name, content in (("base.json", base_bytes), ("cohort.json", cohort_bytes),
            ("original-input/base.json", old_base_bytes), ("original-input/cohort.json", old_cohort_bytes),
            ("original-input/cycle.json", old_cycle_bytes), ("request.json", staged_request),
            ("invocation.json", invocation_bytes), ("source-provenance.json", provenance_bytes)):
        archive._write_immutable(output / name, content)
    destination = output / "archive"
    digest, _ = helpers.restore_archive(restored, destination, base=base_bytes, cohort=cohort, now=now)
    if digest != source["archive_manifest_sha256"]:
        raise ValueError("Restore changed the requested source generation")
    current = archive.load_archive(destination, digest, base_bytes=base_bytes, cohort=cohort, now=now)
    plan_sha = batch.write_json(output / "plan.json", plan)
    from dataclasses import asdict
    report_bytes = batch._json_bytes(serializable(asdict(planned)))
    if len(report_bytes) > 32 * 1024 * 1024:
        raise ValueError("Full planning report exceeds the retained member bound")
    archive._write_immutable(output / "planning-report.json", report_bytes)
    prepared = {"schema_version": "financial-recovery-cycle-v1", "phase": "prepared", "dry_run": False,
        "archive_manifest_sha256": digest, "base_artifact_sha256": cohort["base_artifact_sha256"],
        "published": False, "operation_id": request["operation_id"], "request_sha256": batch.digest_bytes(request_bytes)}
    batch.write_json(output / "cycle.json", prepared)
    cache, cache_sha = archive.export_cache(current, plan, base_bytes, output / "selected-cache", now=now)
    prepare_archive_lock(destination)
    # Expensive full-source preparation has finished. Obtain a new actual API
    # observation without changing the initial invocation or request clocks.
    validate_request(request, now=now_fn())
    provider_invocation = authenticator()
    authenticated_now = now_fn()
    validate_request(request, now=authenticated_now)
    validate_invocation(provider_invocation, request, request_bytes, now=authenticated_now)
    without_clock = lambda value: {key: item for key, item in value.items() if key != "authenticated_at"}
    if batch._json_bytes(without_clock(provider_invocation)) != batch._json_bytes(without_clock(invocation)):
        raise ValueError("Provider authentication changed the prepared invocation binding")
    provider_invocation_bytes = batch._json_bytes(provider_invocation)
    archive._write_immutable(output / "provider-invocation.json", provider_invocation_bytes)
    guard = StatementRetentionBudget(output, selected_symbols=2, max_transport_requests=1000)
    guard.check("initial")

    def revalidate(*, fresh):
        check_time = now_fn()
        validate_request(request, now=check_time)
        validate_invocation(invocation, request, request_bytes, now=check_time, fresh=False)
        validate_invocation(provider_invocation, request, request_bytes, now=check_time, fresh=fresh)
        for path, expected, maximum in ((request_path, batch.digest_bytes(request_bytes), 32768),
                (inputs / "request.json", batch.digest_bytes(request_bytes), 32768),
                (inputs / "invocation.json", batch.digest_bytes(invocation_bytes), 32768),
                (output / "provider-invocation.json", batch.digest_bytes(provider_invocation_bytes), 32768),
                (inputs / "base.json", invocation["base_sha256"], batch.MAX_BASE_BYTES),
                (inputs / "cohort.json", invocation["cohort_sha256"], batch.MAX_ARTIFACT_BYTES),
                (output / "plan.json", plan_sha, batch.MAX_ARTIFACT_BYTES),
                (destination / "manifest.json", digest, archive.MAX_MANIFEST_BYTES),
                (cache, cache_sha, batch.MAX_ARTIFACT_BYTES)):
            bound_input(path, expected, maximum)
        select_due_targets(planned, selected)
        validate_receipts(current, request, targeted, now=check_time)
        return check_time

    ready_at = revalidate(fresh=True)
    allowance = helpers.bounded_acquisition_budget(job_started_at, now=ready_at)
    if (batch.clock(request["expires_at"]) - ready_at).total_seconds() < allowance:
        raise ValueError("Execution request does not cover the bounded acquisition allowance")

    class ProviderBoundary:
        def check(self, stage):
            # The guard itself is unchanged and still freezes every retained byte.
            report = guard.check(stage)
            if stage in ("initial", "getter", "transport"):
                revalidate(fresh=False)
            return report

    result, code = collector(plan, base_bytes, output / "batch", cache_manifest=cache, cache_sha256=cache_sha,
        dry_run=False, acquisition_budget_seconds=allowance, max_statement_getter_calls=4,
        max_transport_requests=1000, retention_guard=ProviderBoundary())
    guard.before_merge()
    next_digest = archive.merge_batch(destination, digest, batch_dir=output / "batch",
        summary_sha256=helpers.file_hash(output / "batch" / "summary.json"), base_bytes=base_bytes, cohort=cohort,
        now=now_fn(), maximum_manifest_bytes=guard.maximum_manifest_bytes)
    checked = archive.load_archive(destination, next_digest, base_bytes=base_bytes, cohort=cohort, now=now_fn())
    cycle = {**prepared, "phase": "completed", "archive_manifest_sha256": next_digest,
        "previous_archive_manifest_sha256": digest, "code_revision": invocation["head_sha"],
        "source_data_as_of": base["as_of_date"], "selected_symbols": len(targeted.symbols),
        "selected_symbol_names": list(targeted.symbols), "full_cohort_count": len(cohort["symbols"]),
        "original_base_sha256": source["base_sha256"], "original_cohort_sha256": source["cohort_sha256"],
        "retained_receipts": len(checked.manifest["receipts"]),
        "retained_symbols": len({item["symbol"] for item in checked.manifest["receipts"].values()}),
        "provider_state_before": planned.provider_state, "exit_code": code,
        "publication_authority": "none", "financial_admission": False}
    cycle_sha = batch.write_json(output / "cycle.json", cycle)
    guard.authorize_finalization(archive_manifest_sha256=next_digest, cycle_sha256=cycle_sha,
                                archive_object_sha256s=checked.manifest["objects"])
    retention = guard.verify_final()
    print(json.dumps({**cycle, "acquisition_counts": result.get("counts"), "retention": retention}, sort_keys=True))
    return code


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("inputs", "restored", "request", "output"):
        parser.add_argument(f"--{name}", type=Path, required=True)
    parser.add_argument("--job-started-at", required=True)
    args = parser.parse_args(argv)
    return run(args.inputs, args.restored, args.output, request_path=args.request, job_started_at=args.job_started_at)


if __name__ == "__main__":
    raise SystemExit(main())
