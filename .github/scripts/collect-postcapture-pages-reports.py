"""Retain bounded diagnostic metadata; never package a deployable Pages tree."""
from __future__ import annotations
import hashlib
import json
from pathlib import Path
import stat
import sys

MAX_REPORT_FILE = 64 * 1024 * 1024
MAX_REPORT_TOTAL = 128 * 1024 * 1024
CONTROL_HASHES = {
    ".github/financial-performance-candidate-v2.json": "7e73949f1eefa54c8b9dcd623c47e7aef050b646aa5dce98fc87796c1d018cc5",
    ".github/financial-performance-release-v2.json": "32b5dc0bac39c593dadb580044bbb983d9e409971f796e25154b9aacbf8c3300",
    ".github/financial-release-request.json": "d6dea1fd567c58569b0816e100310fa55b96189594894b20212d151401c62882",
}
FIXED_REPORTS = [
    "postcapture-pages-inputs/storage-preflight.json",
    "postcapture-pages-inputs/api-evidence.json",
    "postcapture-pages-inputs/retrieval-provenance.json",
    "postcapture-pages-inputs/inputs.json",
    "postcapture-pages-supervisor/supervisor.json",
    "postcapture-pages-supervisor/heartbeat.jsonl",
    "postcapture-pages-supervisor/console.log",
    "postcapture-pages-fixture/report.json",
    "postcapture-pages-fixture/checkpoint/checkpoint.json",
    "postcapture-pages-fixture/phases.jsonl",
    "postcapture-pages-fixture/last-failure.json",
    "postcapture-pages-fixture/source-delta-summary.json",
    "postcapture-pages-fixture/lineage-summary.json",
    "postcapture-pages-fixture/nested-byte-proof-990400-published.json",
    "postcapture-pages-fixture/carry-retained-byte-proof.json",
    "postcapture-pages-fixture/carry-expiry-proof.json",
    "postcapture-pages-fixture/request-target-base.json",
    "postcapture-pages-fixture/certified-target-base.json",
    "postcapture-pages-fixture/target-base-binding.json",
    "postcapture-pages-fixture/target-base-comparison.json",
    "postcapture-pages-fixture/child-process-phases.jsonl",
]


def sha(path):
    with path.open("rb") as handle:
        return hashlib.file_digest(handle, "sha256").hexdigest()


def verify_controls(root: Path) -> dict:
    result = {}
    for name, expected in CONTROL_HASHES.items():
        path = root / name
        if path.is_symlink() or not path.is_file() or sha(path) != expected:
            raise ValueError(f"Committed live control changed: {name}")
        result[name] = expected
    trust = json.loads((root / "contracts/financial_source_postcapture_trust_v1.json").read_text())
    renewal = json.loads((root / "contracts/financial_source_renewal_v1.json").read_text())
    if trust["reviewed_requests"] != [] or renewal["publication_enabled"] is not False or renewal["reviewed_controllers"] != [] or renewal["reviewed_consumer_transitions"] != []:
        raise ValueError("Diagnostic checkout acquired production source or renewal authority")
    for name in ("request", "candidate", "release"):
        if (root / f".github/financial-source-renewal-{name}.json").exists():
            raise ValueError("Synthetic renewal control escaped disposable fixture")
    return result


def collect(temp: Path, output: Path, checkout: Path) -> dict:
    output.mkdir(parents=True, exist_ok=False)
    report = {"schema_version": "postcapture-pages-diagnostic-reports-v1", "authority": "none",
              "production_controls": None, "files": {}, "missing": [], "errors": []}
    try:
        report["production_controls"] = verify_controls(checkout)
    except (OSError, ValueError, KeyError) as error:
        report["errors"].append(str(error))
    names = list(FIXED_REPORTS)
    commands = temp / "postcapture-pages-fixture/commands"
    if commands.exists():
        if commands.is_symlink():
            report["errors"].append("Linked diagnostic command directory")
        else:
            names.extend(str(path.relative_to(temp)) for path in sorted(commands.glob("*.log")))
    total = 0
    for name in names:
        source = temp / name
        if not source.exists():
            report["missing"].append(name)
            continue
        info = source.lstat()
        # Logs are produced locally; no symlink, hardlink, or special file is a
        # report. Walk parents too so a substituted directory cannot escape.
        unsafe = not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
        unsafe |= any(parent.is_symlink() for parent in source.parents if parent != temp and temp in parent.parents)
        if unsafe or info.st_size > MAX_REPORT_FILE or total + info.st_size > MAX_REPORT_TOTAL:
            report["errors"].append(f"Unsafe or over-limit diagnostic report: {name}")
            continue
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        data = source.read_bytes()
        destination.write_bytes(data)
        report["files"][name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
        total += len(data)
    report["bytes"] = total
    (output / "report-inventory.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: collect-postcapture-pages-reports.py RUNNER_TEMP NEW_REPORT_DIRECTORY")
    result = collect(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve(), Path(__file__).resolve().parents[2])
    print(json.dumps({"reports": len(result["files"]), "bytes": result["bytes"], "errors": result["errors"]}))
    raise SystemExit(1 if result["errors"] else 0)
