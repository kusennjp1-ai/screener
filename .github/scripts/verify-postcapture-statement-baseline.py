"""NEW reconstructed, read-only adapter for the single retained failed source.

The policy is disabled. A direct offline test may supply the same exact policy
with its one already-admitted review; the CLI has no policy override. This is
source retention evidence, never successful producer or publication authority.
"""
from datetime import datetime, timezone
import importlib.util
import os
from pathlib import Path
import stat
import sys
import time
import zipfile

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("postcapture_companion_reader", Path(__file__).with_name("verify-postcapture-correction-archive.py"))
companion = importlib.util.module_from_spec(spec)
spec.loader.exec_module(companion)
require, exact, parse, sha = companion.require, companion.exact, companion.parse, companion.sha
POLICY = parse((ROOT / "contracts/financial_source_postcapture_restore_v1.json").read_bytes())
SOURCE = POLICY["source"]
REFERENCE = POLICY["companion_reference"]
REQUEST = parse((ROOT / "contracts/financial_source_postcapture_request_v1.json").read_bytes())
MAX_SECONDS = 180
FIXED_POLICY = {"schema_version": "financial-source-postcapture-restore-policy-v1",
                "authority": "retained_source_baseline_only", "companion_zip_bytes": 4079616,
                "maximum_source_zip_bytes": 134217728, "maximum_source_expanded_bytes": 536870912,
                "maximum_source_members": 30000, "maximum_source_member_bytes": 33554432}


def admitted_policy(policy=None):
    value = POLICY if policy is None else policy
    exact(value, POLICY, "restore policy")
    require(all(type(value[key]) is type(expected) and value[key] == expected for key, expected in FIXED_POLICY.items()),
            "Fixed restore scope or bounds changed")
    require(all(value[key] == POLICY[key] for key in POLICY if key not in {"restore_enabled", "reviewed_requests"}),
            "Exact restore policy/source/bounds changed")
    entries = value["reviewed_requests"]
    require(value["restore_enabled"] is True and isinstance(entries, list) and len(entries) == 1,
            "Postcapture restore disabled or not independently admitted")
    review = companion.select_review(REFERENCE["receipt_sha256"])
    require(entries[0] == review and review["source"] == SOURCE == REQUEST["source"] and
            review["reference"] == REFERENCE, "Restore review differs from existing exact controller admission")
    contracts, hashes, raw = companion.load_contracts()
    companion.verify_review(review, contracts, hashes, raw)
    return review


def safe(path, directory=False):
    path = Path(os.path.abspath(path))
    for part in (path, *path.parents):
        require(not part.is_symlink(), "Symlink in retained source path")
    info = path.lstat()
    require(stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode) and info.st_nlink == 1,
            "Unsafe retained source file/directory or hardlink")
    return path


def bounded_read(path, maximum, check=lambda: None):
    path = safe(path)
    require(path.stat().st_size <= maximum, "Retained source file exceeds bound")
    with path.open("rb") as stream:
        raw = stream.read(maximum + 1)
    check()
    require(len(raw) <= maximum, "Retained source file grew beyond bound")
    return raw


def verify_source_members(source_zip, source_directory, inventory, policy, check=lambda: None):
    """Compare all ZIP and extracted bytes; this helper cannot confer admission."""
    exact(inventory, {"schema_version", "artifact_sha256", "expanded_bytes", "files", "member_count"}, "captured inventory")
    files = inventory["files"]
    require(isinstance(files, dict) and inventory["schema_version"] == "postcapture-artifact-inventory-v1" and
            type(inventory["member_count"]) is int and inventory["member_count"] == len(files) and
            0 < len(files) <= policy["maximum_source_members"], "Invalid bounded source inventory")
    directories = set()
    for name, item in files.items():
        companion.safe_name(name)
        exact(item, {"bytes", "sha256"}, "captured member")
        require(type(item["bytes"]) is int and 0 <= item["bytes"] <= policy["maximum_source_member_bytes"] and
                companion.valid_hash(item["sha256"]), "Invalid captured member identity")
        directories.update(str(parent) for parent in Path(name).parents if str(parent) != ".")
    require(type(inventory["expanded_bytes"]) is int and inventory["expanded_bytes"] == sum(x["bytes"] for x in files.values())
            <= policy["maximum_source_expanded_bytes"], "Source expanded-byte bound mismatch")
    source_directory = safe(source_directory, directory=True)
    seen_files, seen_dirs, stack = set(), set(), [source_directory]
    while stack:
        check()
        with os.scandir(stack.pop()) as entries:
            for item in entries:
                check()
                relative = str(Path(item.path).relative_to(source_directory))
                require(not item.is_symlink(), "Symlink in extracted source")
                if item.is_dir(follow_symlinks=False):
                    require(relative in directories, "Unreviewed extracted directory")
                    seen_dirs.add(relative)
                    stack.append(Path(item.path))
                else:
                    require(relative in files, "Unreviewed extracted source file")
                    seen_files.add(relative)
                require(len(seen_files) + len(seen_dirs) <= policy["maximum_source_members"], "Extracted source exceeds member bound")
    require(seen_files == set(files) and seen_dirs == directories, "Incomplete extracted source inventory")
    seen, total = set(), 0
    with zipfile.ZipFile(safe(source_zip)) as zipped:
        infos = zipped.infolist()
        require(len(infos) <= policy["maximum_source_members"], "Source ZIP member bound exceeded")
        zipped_files = set()
        for info in infos:
            check()
            name, mode = info.filename, info.external_attr >> 16
            companion.safe_name(name, directory=info.is_dir())
            require(name not in seen and not info.flag_bits & 1 and not stat.S_ISLNK(mode) and
                    (not stat.S_IFMT(mode) or stat.S_ISREG(mode) and not info.is_dir() or stat.S_ISDIR(mode) and info.is_dir()),
                    "Duplicate, encrypted or special source ZIP member")
            seen.add(name)
            if info.is_dir():
                require(name[:-1] in directories and info.file_size == 0, "Unreviewed source ZIP directory")
                continue
            require(name in files and info.file_size == files[name]["bytes"], "Source ZIP member identity/length changed")
            with zipped.open(info) as stream:
                raw = stream.read(files[name]["bytes"] + 1)
            require(len(raw) == files[name]["bytes"] and sha(raw) == files[name]["sha256"], "Source ZIP member bytes changed")
            actual = bounded_read(source_directory / name, files[name]["bytes"], check)
            require(actual == raw, "Extracted source bytes differ from immutable ZIP")
            zipped_files.add(name)
            total += len(raw)
        require(zipped_files == set(files) and total == inventory["expanded_bytes"], "Incomplete source ZIP inventory")


def verify_retention(source_directory, *, now, check):
    """Keep prior manifests, receipts, failures and original journals unchanged."""
    sys.path.insert(0, str(ROOT / "backend"))
    from app.services import statement_artifact_archive as archive
    root = Path(source_directory)
    base = bounded_read(root / "base.json", POLICY["maximum_source_member_bytes"], check)
    cohort_bytes = bounded_read(root / "cohort.json", POLICY["maximum_source_member_bytes"], check)
    require(sha(base) == SOURCE["acquisition_base_sha256"] and sha(cohort_bytes) == SOURCE["cohort_sha256"], "Source base/cohort changed")
    retained = archive.load_archive(root / "archive", SOURCE["archive_manifest_sha256"], base_bytes=base,
                                    cohort=parse(cohort_bytes), now=now)
    check()
    counts = {key: len(retained.manifest[key]) for key in REQUEST["refresh"]["archive_counts"]}
    require(counts == REQUEST["refresh"]["archive_counts"], "Retained archive counts changed")
    for digest in REQUEST["baseline"]["snapshot_sha256"]:
        raw = bounded_read(root / "archive/manifests" / (digest + ".json"), POLICY["maximum_source_member_bytes"], check)
        require(sha(raw) == digest, "Earlier immutable archive snapshot changed")
    prior = parse(bounded_read(root / "archive/manifests" / (REQUEST["baseline"]["manifest_sha256"] + ".json"),
                              POLICY["maximum_source_member_bytes"], check))
    require({key: len(prior[key]) for key in REQUEST["baseline"]["counts"]} == REQUEST["baseline"]["counts"], "Earlier archive counts changed")
    for key in ("objects", "receipts", "attempts", "batches"):
        require(all(retained.manifest[key].get(identity) == value for identity, value in prior[key].items()),
                "Earlier retained " + key + " were lost or changed")
    return counts


def verify_baseline(source_zip, source_directory, companion_zip, *, policy=None, now=None):
    review = admitted_policy(policy)
    started = time.monotonic()
    def check():
        require(time.monotonic() - started <= MAX_SECONDS, "Offline baseline verification time bound exceeded")
    now = datetime.now(timezone.utc) if now is None else now
    require(isinstance(now, datetime) and now.tzinfo is not None, "Explicit aware validation clock required")
    companion_bytes = bounded_read(companion_zip, POLICY["companion_zip_bytes"], check)
    require(len(companion_bytes) == POLICY["companion_zip_bytes"] and sha(companion_bytes) == REFERENCE["artifact_sha256"],
            "Exact companion ZIP length/hash mismatch")
    verified = companion.verify(companion_zip, REFERENCE["receipt_sha256"], review)
    check()
    receipt = verified["receipt"]
    require(receipt["source"] == SOURCE and receipt["authority"] == REQUEST["authority"] and
            all(value is False for value in receipt["authority"].values()), "Companion cannot grant new authority")
    execution = receipt["producer_execution"]
    require(execution == {"failed_step_number": 10, "original_final_guard_result": "failed", "original_outcomes_retained": True,
            "producer_batch_exit_code": 0, "producer_cycle_exit_code": 0, "producer_job_conclusion": "failure",
            "producer_job_id": REQUEST["producer_job_id"], "producer_run_conclusion": "failure"}, "Original failed producer changed")
    require(companion.clock(receipt["evaluated_at"]) <= now, "Companion evaluation is in the future")
    prefix = review["artifact_layout"]["companion_prefix"]
    with zipfile.ZipFile(companion_zip) as zipped:
        raw = zipped.read(prefix + "captured-inventory.json")
    require(sha(raw) == REQUEST["captured_inventory"]["sha256"], "Captured inventory changed")
    inventory = parse(raw)
    require(inventory["artifact_sha256"] == SOURCE["artifact_sha256"] and
            inventory["member_count"] == REQUEST["captured_inventory"]["files"] and
            inventory["expanded_bytes"] == REQUEST["captured_inventory"]["expanded_bytes"], "Captured source inventory differs")
    source_bytes = bounded_read(source_zip, POLICY["maximum_source_zip_bytes"], check)
    require(len(source_bytes) == REQUEST["artifact_size_bytes"] and sha(source_bytes) == SOURCE["artifact_sha256"],
            "Exact source ZIP length/hash mismatch")
    verify_source_members(source_zip, source_directory, inventory, POLICY, check)
    counts = verify_retention(source_directory, now=now, check=check)
    verify_source_members(source_zip, source_directory, inventory, POLICY, check)
    require(sha(bounded_read(source_zip, POLICY["maximum_source_zip_bytes"], check)) == SOURCE["artifact_sha256"] and
            sha(bounded_read(companion_zip, POLICY["companion_zip_bytes"], check)) == REFERENCE["artifact_sha256"],
            "Retained ZIP changed during verification")
    return {"schema_version": "financial-source-postcapture-baseline-v1", "kind": "postcapture_validated_baseline",
            "source": SOURCE, "companion_reference": REFERENCE, "producer_execution": execution,
            "captured_inventory_sha256": REQUEST["captured_inventory"]["sha256"], "retained_archive_counts": counts,
            "github_success_independently_authenticated": False, "publication_authority": "none",
            "provider_work_authorized": False}


if __name__ == "__main__":
    require(len(sys.argv) == 4, "Usage: verify-postcapture-statement-baseline.py SOURCE_ZIP SOURCE_DIRECTORY COMPANION_ZIP")
    sys.stdout.buffer.write(companion.canonical(verify_baseline(*sys.argv[1:])) + b"\n")
