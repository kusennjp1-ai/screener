"""Stage/publish US daily sources only after downstream validation.

Immutable release assets hold the bytes. A GitHub Contents update guarded by
the previous blob SHA owns the latest pointer; release-asset clobber is never
used. The dedicated pointer branch must be bootstrapped by a reviewed change.
"""
from __future__ import annotations

import argparse
import base64
from datetime import date, datetime, timezone
import gzip
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
from urllib.parse import quote

from app.scripts.publish_daily_price_bundle import validate_promotion
from app.services.close_price_contract import CloseSession, audit_required_closes


def sha(data):
    return hashlib.sha256(data).hexdigest()


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()


def read(path):
    return json.loads(Path(path).read_bytes())


def write(path, value):
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_bytes(encoded(value))


def exchange(value):
    aliases = {"NYSE": "XNYS", "NASDAQ": "XNAS", "AMEX": "XASE", "NYSEARCA": "ARCX", "NYSE ARCA": "ARCX", "ARCA": "ARCX", "BATS": "BATS"}
    if not isinstance(value, str) or not value:
        raise ValueError("Missing exchange identity")
    return aliases.get(value.upper(), value.upper())


def required_cohort(previous, rows, target):
    """Retain every prior required member; add newly liquid final export rows.

    This first activation admits no new nontrading exclusions. Such exclusions
    need a separately reviewed dated evidence contract, not a missing bar.
    """
    prior = previous.get("required_cohort")
    if not isinstance(prior, dict) or not prior or previous.get("required_cohort_sha256") != sha(encoded(prior)):
        raise ValueError("Prior independently pinned required cohort is missing or changed")
    if previous.get("nontrading_exclusions"):
        raise ValueError("Nontrading exclusions require a reviewed dated-evidence contract")
    result = dict(prior)
    seen = set()
    for row in rows:
        symbol = row.get("symbol")
        if not isinstance(symbol, str) or not symbol or symbol in seen:
            raise ValueError("Duplicate or invalid downstream symbol")
        seen.add(symbol)
        if row.get("market") != "US" or row.get("as_of_date", target) != target:
            raise ValueError("Downstream row market/date mismatch")
        identity = exchange(row.get("exchange"))
        if symbol in result and result[symbol] != identity:
            raise ValueError(f"Required exchange identity changed: {symbol}")
        price, adv = row.get("current_price"), row.get("adv_usd")
        if type(price) in (int, float) and type(adv) in (int, float) and price >= 10 and adv >= 20_000_000:
            result[symbol] = identity
    if set(prior) - seen:
        raise ValueError("Downstream export dropped protected prior members")
    return dict(sorted(result.items()))


def validate_candidate(*, bundle_path, manifest_path, capture, downstream, session, now):
    manifest = read(manifest_path)
    floor = validate_promotion(manifest, mode="full")
    previous = capture["manifest"]
    if previous.get("schema_version") != "daily-price-manifest-v1" or previous.get("market") != "US" or previous.get("bar_period") != "2y":
        raise ValueError("Previous source market/schema contract is invalid")
    if datetime.fromisoformat(manifest["generated_at"].replace("Z", "+00:00")) < datetime.fromisoformat(previous["generated_at"].replace("Z", "+00:00")):
        raise ValueError("Candidate source generation would regress")
    previous_floor = previous.get("min_symbol_coverage")
    if previous_floor is None and previous.get("require_complete") is True:
        previous_floor = 1.0
    if type(previous_floor) not in (int, float) or not 0 < previous_floor <= 1 or floor < previous_floor:
        raise ValueError("Unknown or weakened previous source coverage policy")
    if manifest["allow_stale_complete"] or previous.get("allow_stale_complete") is not False:
        raise ValueError("US close promotion requires an explicit fresh-only source policy")
    raw = Path(bundle_path).read_bytes()
    if sha(raw) != manifest.get("sha256"):
        raise ValueError("Source bundle bytes changed")
    bundle = json.loads(gzip.decompress(raw))
    for key in ("symbol_count", "missing_symbol_count", "stale_symbol_count", "covered_symbol_count", "symbol_universe_count", "symbol_coverage", "require_complete", "symbol_scope", "min_symbol_coverage", "allow_stale_complete"):
        if bundle.get(key) != manifest.get(key):
            raise ValueError(f"Bundle/manifest coverage mismatch: {key}")
    actual_rows = bundle.get("rows")
    if not isinstance(actual_rows, list) or len(actual_rows) != manifest["symbol_count"]:
        raise ValueError("Bundle row count disagrees with its coverage policy")
    fresh = sum(bool(row.get("prices")) and row["prices"][-1].get("date") == session.session.isoformat() for row in actual_rows)
    if fresh != manifest["covered_symbol_count"]:
        raise ValueError("Bundle fresh count disagrees with its coverage policy")
    if downstream.get("schema_version") != "daily-source-downstream-v1" or downstream.get("as_of_date") != session.session.isoformat():
        raise ValueError("Downstream session contract is missing or mismatched")
    if downstream.get("quality_passed") is not True:
        raise ValueError("Downstream quality gates have not passed")
    cohort = required_cohort(previous, downstream["rows"], session.session.isoformat())
    for row in bundle["rows"]:
        row["exchange"] = exchange(row.get("exchange"))
    report = audit_required_closes(bundle=bundle, manifest=manifest, required_cohort=cohort,
        required_cohort_sha256=sha(encoded(cohort)), session=session, now=now,
        previous_session=date.fromisoformat(previous["as_of_date"]))
    report["validated_at"] = now.isoformat()
    report["validation_deadline_exceeded"] = report.pop("deadline_exceeded")
    report["validation_remaining_seconds"] = report.pop("remaining_seconds")
    report["publication_status"] = "not_yet_published"
    source = {row["symbol"]: row for row in bundle["rows"]}
    exported = {row["symbol"]: row for row in downstream["rows"]}
    for symbol in cohort:
        row = exported[symbol]
        close = source[symbol]["prices"][-1]["close"]
        chart = row.get("chart_close")
        if row.get("chart_as_of") != session.session.isoformat() or row.get("chart_last_date") != session.session.isoformat():
            raise ValueError(f"Downstream chart date mismatch: {symbol}")
        for value in (row.get("current_price"), chart):
            if type(value) not in (int, float) or not abs(value - close) <= max(.02, abs(close) * .0001):
                raise ValueError(f"Downstream/source price mismatch: {symbol}")
    name = f"daily-price-us-{session.session:%Y%m%d}-{manifest['sha256']}.json.gz"
    promoted = {**manifest, "bundle_asset_name": name, "required_cohort": cohort,
        "required_cohort_sha256": sha(encoded(cohort)), "nontrading_exclusions": [],
        "previous_manifest_sha256": capture["manifest_sha256"],
        "downstream_sha256": sha(encoded(downstream)), "close_audit": report}
    return promoted


class GitHubStore:
    def __init__(self, repository, ref, path):
        if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository) or ref != "data/daily-price-pointers" or path != "daily-price-latest-us.json":
            raise ValueError("Unexpected pointer destination")
        self.repository, self.ref, self.path = repository, ref, path
        self.endpoint = f"repos/{repository}/contents/{path}"

    def api(self, endpoint, payload=None):
        args = ["gh", "api", endpoint]
        if payload is None:
            return json.loads(subprocess.check_output(args + ["--header", "Cache-Control: no-cache"]))
        with tempfile.NamedTemporaryFile(mode="wb") as handle:
            handle.write(encoded(payload)); handle.flush()
            return json.loads(subprocess.check_output(args + ["--method", "PUT", "--input", handle.name]))

    def controller_authority(self, expected_sha, expected_ref):
        """Read live main/policy authority, never the old workflow's outputs.

        The policy is fetched at its exact Git commit, with fresh main reads
        bracketing it. A newer controller requires a new run even when its
        rollout remains enabled. This read is repeated at each write boundary.
        """
        if expected_ref != "refs/heads/main" or not re.fullmatch(r"[0-9a-f]{40}", expected_sha):
            raise ValueError("Source promotion requires the workflow's exact main controller commit/ref")
        endpoint = f"repos/{self.repository}/git/ref/heads/main"
        def check_head():
            value = self.api(endpoint)
            if (value.get("ref"), value.get("object", {}).get("type"), value.get("object", {}).get("sha")) != (expected_ref, "commit", expected_sha):
                raise ValueError("Current main controller advanced or is unverified; start a new run")
        check_head()
        value = self.api(f"repos/{self.repository}/contents/.github/daily-price-promotion.json?ref={expected_sha}")
        if value.get("encoding") != "base64" or value.get("type") != "file":
            raise ValueError("Current controller rollout policy is unavailable")
        raw = base64.b64decode(value["content"], validate=False)
        blob = hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()
        if blob != value.get("sha"):
            raise ValueError("Current rollout policy and Git object disagree")
        policy = json.loads(raw)
        if policy.get("schema_version") != "daily-price-promotion-rollout-v1" or policy.get("enabled") is not True:
            raise ValueError("Current controller rollout is disabled or invalid")
        if (policy.get("pointer_ref"), policy.get("pointer_path")) != (self.ref, self.path):
            raise ValueError("Current controller rollout pointer destination changed")
        check_head()
        return {"repository": self.repository, "ref": expected_ref, "commit": expected_sha,
            "rollout_blob_sha": blob, "rollout_sha256": sha(raw)}

    def capture(self):
        value = self.api(f"{self.endpoint}?ref={quote(self.ref, safe='')}")
        if value.get("encoding") != "base64" or value.get("type") != "file":
            raise ValueError("Reviewed predecessor pointer does not exist")
        raw = base64.b64decode(value["content"], validate=False)
        blob = hashlib.sha1(f"blob {len(raw)}\0".encode() + raw).hexdigest()
        if blob != value.get("sha"):
            raise ValueError("Pointer content and Git object disagree")
        return {"schema_version": "daily-price-predecessor-v1", "repository": self.repository,
            "ref": self.ref, "path": self.path, "content_sha": blob, "manifest_sha256": sha(raw), "manifest": json.loads(raw)}

    def immutable(self, path, name, expected):
        assets = self.api(f"repos/{self.repository}/releases/tags/daily-price-data")["assets"]
        matching = [item for item in assets if item["name"] == name]
        if len(matching) > 1:
            raise ValueError("Ambiguous immutable source asset")
        if not matching:
            with tempfile.TemporaryDirectory() as directory:
                staged = Path(directory) / name
                staged.write_bytes(Path(path).read_bytes())
                subprocess.run(["gh", "release", "upload", "daily-price-data", str(staged), "--repo", self.repository], check=True)
        # Download and hash the actual stored bytes, even when a retry finds it.
        with tempfile.TemporaryDirectory() as directory:
            subprocess.run(["gh", "release", "download", "daily-price-data", "--repo", self.repository,
                "--pattern", name, "--dir", directory], check=True)
            if sha((Path(directory) / name).read_bytes()) != expected:
                raise ValueError("Immutable source readback mismatch")

    def replace_pointer(self, capture, manifest, pre_write_check=lambda: None):
        if self.capture() != capture:
            raise ValueError("Predecessor was superseded before pointer update")
        pre_write_check()
        # Contents API compares the expected blob SHA on the server. A race or
        # failed request leaves the old pointer; there is no delete/upload gap.
        self.api(self.endpoint, {"message": f"Promote verified US close {manifest['as_of_date']}",
            "branch": self.ref, "sha": capture["content_sha"], "content": base64.b64encode(encoded(manifest)).decode()})
        actual = self.capture()
        if actual["manifest_sha256"] != sha(encoded(manifest)):
            raise ValueError("Pointer update outcome is unverified; do not retry blindly")


def latest_completed_session(now):
    from app.services.market_calendar_service import MarketCalendarService
    return MarketCalendarService().last_completed_trading_day("US", now=now, close_buffer_minutes=5)


def promote(*, store, capture, bundle_path, manifest_path, downstream, session, now,
            controller_sha, controller_ref,
            clock=lambda: datetime.now(timezone.utc), session_resolver=latest_completed_session):
    if (capture.get("repository"), capture.get("ref"), capture.get("path")) != (store.repository, store.ref, store.path):
        raise ValueError("Captured pointer destination changed")
    if store.capture() != capture:
        raise ValueError("Predecessor changed before validation")
    manifest = validate_candidate(bundle_path=bundle_path, manifest_path=manifest_path,
        capture=capture, downstream=downstream, session=session, now=now)
    authority = store.controller_authority(controller_sha, controller_ref)
    manifest["controller_authority"] = authority
    store.immutable(bundle_path, manifest["bundle_asset_name"], manifest["sha256"])
    before_write = None
    def check_write_authority_and_clock():
        nonlocal before_write
        if store.controller_authority(controller_sha, controller_ref) != authority:
            raise ValueError("Current controller authority changed before pointer write")
        before_write = clock()
        if before_write.tzinfo is None or before_write < now:
            raise ValueError("Publication clock rolled back or lost its timezone")
        if session_resolver(before_write) != session.session:
            raise ValueError("Completed session advanced before pointer write; rebuild the target")
    store.replace_pointer(capture, manifest, pre_write_check=check_write_authority_and_clock)
    if before_write is None:
        raise ValueError("Pointer adapter did not enforce the last completed session")
    completed_at = clock()
    if completed_at.tzinfo is None or completed_at < before_write:
        raise ValueError("Publication completion clock is invalid; outcome needs reconciliation")
    completion = {"schema_version": "daily-source-publication-completion-v1",
        "scope": "authoritative_daily_source_pointer",
        "controller_authority": authority,
        "session": session.session.isoformat(), "validated_at": now.isoformat(),
        "verified_pointer_at": completed_at.isoformat(), "pointer_manifest_sha256": sha(encoded(manifest)),
        "source_sha256": manifest["sha256"], "deadline_at": session.deadline_at.isoformat(),
        "deadline_exceeded": completed_at > session.deadline_at,
        "latest_completed_session_at_completion": session_resolver(completed_at).isoformat(),
        "target_still_latest_at_completion": session_resolver(completed_at) == session.session}
    return {"manifest": manifest, "publication_receipt": completion}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("capture", "publish"))
    parser.add_argument("--repository", required=True)
    parser.add_argument("--ref", default="data/daily-price-pointers")
    parser.add_argument("--path", default="daily-price-latest-us.json")
    parser.add_argument("--capture", required=True, type=Path)
    parser.add_argument("--bundle", type=Path)
    parser.add_argument("--manifest", type=Path)
    parser.add_argument("--downstream", type=Path)
    parser.add_argument("--completion-receipt", type=Path)
    parser.add_argument("--controller-sha")
    parser.add_argument("--controller-ref")
    args = parser.parse_args()
    store = GitHubStore(args.repository, args.ref, args.path)
    if args.command == "capture":
        write(args.capture, store.capture()); return 0
    if not args.controller_sha or not args.controller_ref:
        parser.error("publish requires --controller-sha and --controller-ref from the workflow context")
    from app.services.market_calendar_service import MarketCalendarService
    now = datetime.now(timezone.utc)
    calendar = MarketCalendarService()
    # Latest genuinely closed session, including intraday catch-up; never use
    # a candidate's self-reported date as the expected date.
    target = calendar.last_completed_trading_day("US", now=now, close_buffer_minutes=5)
    session = CloseSession.for_us(target, calendar)
    result = promote(store=store, capture=read(args.capture), bundle_path=args.bundle,
        manifest_path=args.manifest, downstream=read(args.downstream), session=session, now=now,
        controller_sha=args.controller_sha, controller_ref=args.controller_ref)
    if args.completion_receipt:
        write(args.completion_receipt, result["publication_receipt"])
    print(json.dumps({"promoted": True, **result["publication_receipt"]}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
