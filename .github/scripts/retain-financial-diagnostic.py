"""Retain prepared bytes for review only. This script has no release authority."""
import gzip
import hashlib
import io
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tarfile
import tempfile


REPO = Path(__file__).resolve().parents[2]
MEMBERS = (
    "corrected", "projection", "preview-receipt.json", "release-request.json",
    "protected-code.json", "verification.json", "request.json", "evidence.json",
    "target-base.json",
)
AUTHORITY_FILES = {
    "candidate.json", "captured-candidate.json", "activation-candidate.json",
    "financial-activation-candidate.json", "publication.json",
}
DATA_FILES = {"research-daily.json", "portfolio-model.json", "qualification-audit.json", "ibd-reference.json"}
CHUNK = 1024 * 1024


def require(condition, message):
    if not condition:
        raise ValueError(message)


def canonical(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True).encode()


def digest(value):
    return hashlib.sha256(canonical(value)).hexdigest()


def fingerprint(value):
    return (value.st_dev, value.st_ino, value.st_mode, value.st_nlink,
            value.st_size, value.st_mtime_ns, value.st_ctime_ns)


def plain_directory(path):
    require(path.is_absolute() and path == path.resolve(), "Directory path contains a link or alias")
    require(stat.S_ISDIR(path.lstat().st_mode), "Expected a real directory")


def inventory(root, limits):
    result = {}
    total = 0

    def visit(path):
        nonlocal total
        name = path.relative_to(root).as_posix()
        require(re.fullmatch(r"[A-Za-z0-9._/-]+", name) and
                all(part not in ("", ".", "..") for part in name.split("/")), "Unsafe diagnostic path")
        require(path.name not in AUTHORITY_FILES, "Authority file is not a diagnostic input")
        info = path.lstat()
        require(stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode), "Linked or special diagnostic input")
        require(not stat.S_ISREG(info.st_mode) or info.st_nlink == 1, "Hard-linked diagnostic input")
        result[name] = info
        require(len(result) + 2 <= limits["maximum_archive_files"], "Diagnostic file count exceeds bound")
        if stat.S_ISDIR(info.st_mode):
            for child in sorted(path.iterdir()):
                visit(child)
        else:
            total += info.st_size
            require(total <= limits["maximum_archive_bytes"], "Diagnostic bytes exceed bound")

    for member in MEMBERS:
        visit(root / member)
    require(stat.S_ISDIR(result["corrected"].st_mode) and stat.S_ISDIR(result["projection"].st_mode),
            "Corrected build and projection must be directories")
    for member in MEMBERS[2:]:
        require(stat.S_ISREG(result[member].st_mode), "Diagnostic audit input must be a file")
    return result


class HashReader:
    def __init__(self, source):
        self.source = source
        self.hash = hashlib.sha256()

    def read(self, size=-1):
        data = self.source.read(size)
        self.hash.update(data)
        return data


class BoundedWriter:
    def __init__(self, output, limit):
        self.output, self.limit, self.size = output, limit, 0
        self.hash = hashlib.sha256()

    def write(self, data):
        self.size += len(data)
        require(self.size <= self.limit, "Diagnostic archive exceeds byte bound")
        self.hash.update(data)
        return self.output.write(data)


def retain(root, output, context, limits):
    require(context["preparation_outcome"] == "success" and context["candidate"] == "true" and
            context["design_status"] in ("failure", "cancelled"), "Diagnostic requires successful preparation and unsuccessful Design")
    require(re.fullmatch(r"[a-f0-9]{40}", context["head_sha"]) and
            all(re.fullmatch(r"[1-9][0-9]*", context[key]) for key in ("run_id", "run_attempt")), "Invalid diagnostic run identity")
    bootstrap = json.loads((REPO / ".github/scripts/approved-ui-bootstrap.json").read_text())
    require(context["repository"] == bootstrap["repository"], "Unexpected diagnostic repository")
    plain_directory(root)
    plain_directory(output.parent)
    require(root not in output.parents and not output.exists() and not output.is_symlink(), "Unsafe diagnostic output")
    before = inventory(root, limits)
    require(before["preview-receipt.json"].st_size <= 4 * CHUNK, "Preview receipt exceeds bound")
    receipt_bytes = (root / "preview-receipt.json").read_bytes()
    receipt = json.loads(receipt_bytes)
    require(receipt["schema_version"] == "financial-candidate-preview-v2" and
            receipt["kind"] == "unpublished_financial_candidate" and
            receipt["publication_authority"] == "none", "Diagnostic requires an unpublished certified preview")
    entries = {}
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".unapproved-financial-", suffix=".partial", dir=output.parent, delete=False) as raw:
            temporary = Path(raw.name)
            writer = BoundedWriter(raw, limits["maximum_archive_bytes"])
            with gzip.GzipFile(fileobj=writer, mode="wb", compresslevel=6, mtime=0) as compressed:
                with tarfile.open(fileobj=compressed, mode="w|", format=tarfile.PAX_FORMAT, copybufsize=CHUNK) as archive:
                    warning = b"UNAPPROVED. REVIEW ONLY. Design has not passed. No activation or publication authority. This archive does not certify release approval or a completed durable backup. Not an accepted release input.\n"
                    member = tarfile.TarInfo("UNAPPROVED.txt")
                    member.size, member.mode = len(warning), 0o644
                    archive.addfile(member, io.BytesIO(warning))
                    for name, info in sorted(before.items()):
                        member = tarfile.TarInfo("review-only/" + name)
                        member.mode = 0o755 if stat.S_ISDIR(info.st_mode) else 0o644
                        if stat.S_ISDIR(info.st_mode):
                            member.type = tarfile.DIRTYPE
                            archive.addfile(member)
                            continue
                        member.size = info.st_size
                        # Never follow dist or any input link; archive the real corrected directory.
                        fd = os.open(root / name, os.O_RDONLY | os.O_NOFOLLOW)
                        with os.fdopen(fd, "rb") as source:
                            require(fingerprint(os.fstat(source.fileno())) == fingerprint(info), "Diagnostic input changed before reading")
                            reader = HashReader(source)
                            archive.addfile(member, reader)
                            require(fingerprint(os.fstat(source.fileno())) == fingerprint(info), "Diagnostic input changed while reading")
                        entries[name] = {"sha256": reader.hash.hexdigest(), "bytes": member.size}
                    require(entries["preview-receipt.json"]["sha256"] == hashlib.sha256(receipt_bytes).hexdigest(), "Preview receipt changed")
                    corrected = {name.removeprefix("corrected/"): entry["sha256"] for name, entry in entries.items() if name.startswith("corrected/")}
                    is_data = lambda name: name.startswith("static-data/") or name in DATA_FILES
                    require(digest({name: value for name, value in corrected.items() if is_data(name)}) == receipt["bundles"]["corrected_data_sha256"] and
                            digest({name: value for name, value in corrected.items() if not is_data(name)}) == receipt["candidate_ui"]["digest"], "Corrected build changed from original preview")
                    require("index.html" in corrected and "static-data/manifest.json" in corrected, "Incomplete corrected build")
                    for projection_hash in (receipt["financial"]["projection_sha256"], receipt["destination_projection"]["derivation"]["source_projection_sha256"]):
                        require(sum(name.startswith("projection/") and item["sha256"] == projection_hash for name, item in entries.items()) == 1,
                                "Original projection missing or ambiguous")
                    for name, field in (("verification.json", "verification_sha256"), ("evidence.json", "source_evidence_sha256")):
                        require(entries[name]["sha256"] == receipt[field], "Original preview evidence changed")
                    after = inventory(root, limits)
                    require({key: fingerprint(value) for key, value in before.items()} ==
                            {key: fingerprint(value) for key, value in after.items()}, "Diagnostic input tree changed")
                    metadata = {
                        "schema_version": "unapproved-financial-diagnostic-v1", "status": "UNAPPROVED",
                        "purpose": "diagnostic_review_only", "publication_authority": "none",
                        "archive_format": "tar+gzip", "original_payload_bytes": sum(item["bytes"] for item in entries.values()),
                        "design_accepted": False, "activation_eligible": False,
                        "producer": {key: context[key] for key in ("repository", "head_sha", "run_id", "run_attempt")},
                        "workflow": ".github/workflows/design-acceptance.yml", "design_status": context["design_status"],
                        "captured_ui": receipt["candidate_ui"],
                        "preview_receipt_sha256": entries["preview-receipt.json"]["sha256"],
                        "projection_sha256": receipt["financial"]["projection_sha256"],
                        "corrected_inventory_sha256": digest(corrected), "inventory_sha256": digest(entries),
                        "files": entries,
                    }
                    data = canonical(metadata)
                    member = tarfile.TarInfo("UNAPPROVED.json")
                    member.size, member.mode = len(data), 0o644
                    archive.addfile(member, io.BytesIO(data))
            raw.flush()
            os.fsync(raw.fileno())
        # Publish only a complete checked diagnostic; never overwrite any artifact.
        os.link(temporary, output)
        return {"archive": output.name, "archive_format": "tar+gzip", "sha256": writer.hash.hexdigest(),
                "bytes": writer.size, "status": "UNAPPROVED", "publication_authority": "none",
                "design_accepted": False, "activation_eligible": False,
                "producer": metadata["producer"], "preview_receipt_sha256": metadata["preview_receipt_sha256"]}
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def main():
    context = {key: os.environ.get(env, "") for key, env in {
        "repository": "GITHUB_REPOSITORY", "head_sha": "GITHUB_SHA", "run_id": "GITHUB_RUN_ID",
        "run_attempt": "GITHUB_RUN_ATTEMPT", "preparation_outcome": "FINANCIAL_PREPARATION_OUTCOME",
        "candidate": "FINANCIAL_CANDIDATE", "design_status": "DESIGN_JOB_STATUS",
    }.items()}
    workspace = os.environ["GITHUB_WORKSPACE"]
    head = subprocess.check_output(["git", "-C", workspace, "rev-parse", "HEAD"], text=True).strip()
    require(head == context["head_sha"], "Diagnostic head differs from the prepared checkout")
    root = Path(os.environ["FINANCIAL_CANDIDATE_DIR"])
    parent = Path(os.environ["RUNNER_TEMP"]) / "financial-release-candidate"
    require(root == parent / "prepared", "Unexpected prepared candidate path")
    limits = json.loads((REPO / "contracts/financial_release_v1.json").read_text())
    output = parent / "unapproved-financial-diagnostic.tar.gz"
    result = retain(root, output, context, limits)
    metadata_path = parent / "unapproved-financial-diagnostic-metadata.json"
    metadata_created = False
    try:
        metadata = metadata_path.open("xb")
        metadata_created = True
        with metadata:
            metadata.write(canonical(result))
    except BaseException:
        output.unlink()
        if metadata_created:
            metadata_path.unlink(missing_ok=True)
        raise
    print(json.dumps(result))


if __name__ == "__main__":
    main()
