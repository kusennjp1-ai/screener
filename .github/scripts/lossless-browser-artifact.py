"""Read-only intake of one pinned artifact; extract its exact corrected/ bytes.

This diagnostic grants no financial, publication, activation, or provider authority.
Only prepare is exposed by the CLI, and it requires the exact diagnostic CI push.
Tests inject small, offline streams and metadata through the Python functions.
"""
import argparse
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import shutil
import stat
import struct
import subprocess
import sys
import tarfile
import time
import zipfile
import zlib

REPOSITORY = "kusennjp1-ai/screener"
BRANCH = "diagnostic/lossless-transport-browser-20261006"
WORKFLOW = ".github/workflows/lossless-browser-diagnostic.yml"
SOURCE = {
    "repository": REPOSITORY,
    "workflow": ".github/workflows/financial-performance-certification.yml",
    "workflow_name": "Financial Performance Certification",
    "head_sha": "0ab45896dd825e05e5ef3e28b0d51e25e2928cf7",
    "head_branch": "main",
    "run_id": 37389108358,
    "run_attempt": 1,
    "job_id": 112029676592,
    "job_name": "Certify exact financial performance exception",
    "artifact_id": 11381411253,
    "artifact_name": "financial-performance-candidate-37389108358-1",
    "size_in_bytes": 1057593973,
    "sha256": "63a7ac2e5e0046789c0a5ade8e78a9af6aa05ff2f6053143bf112dbff19fc11e",
}
COMPILED_UI_SHA = "34ecbf507a4270f796078d669c21c373c0d1279a"
BUFFER_BYTES = 1024 * 1024
MANIFEST_LIMIT = 64 * 1024
PREFIX = f"repos/{REPOSITORY}/actions/"


@dataclass(frozen=True)
class Bounds:
    tar_bytes: int = 8 * 1024 ** 3
    members: int = 100000
    file_bytes: int = 8 * 1024 ** 3
    corrected_bytes: int = 2100000000
    corrected_files: int = 20000
    expected_corrected_bytes: int = 1980197848
    expected_corrected_files: int = 19596
    path_bytes: int = 4096
    path_depth: int = 32


BOUNDS = Bounds()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def positive(value):
    return type(value) is int and value > 0


def directory(path):
    path = Path(path)
    require(path.is_absolute() and path == path.resolve(), "Directory contains an alias or symlink")
    require(stat.S_ISDIR(path.lstat().st_mode), "Expected a real directory")
    return path


def file_path(root, name):
    directory(root)
    require(isinstance(name, str) and re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.-]*", name), "Unsafe filename")
    return root / name


def directory_fd(root):
    directory(root)
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for component in root.parts[1:]:
            child = os.open(component, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def open_file(root, name, writing=False):
    file_path(root, name)
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL if writing else os.O_RDONLY
    parent = directory_fd(root)
    try:
        fd = os.open(name, flags | os.O_NOFOLLOW | os.O_NONBLOCK, 0o600, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        info = os.fstat(fd)
        require(stat.S_ISREG(info.st_mode) and info.st_nlink == 1, "Linked or special file")
        return os.fdopen(fd, "wb" if writing else "rb")
    except BaseException:
        os.close(fd)
        raise


def write_json(root, name, value):
    data = (json.dumps(value, indent=2, sort_keys=True) + "\n").encode()
    require(len(data) <= MANIFEST_LIMIT, "Manifest exceeds bound")
    with open_file(root, name, writing=True) as output:
        output.write(data)


def command_chunks(command, limit, seconds):
    """Bound stdout, elapsed time, and memory; never expose CLI stderr/redirects."""
    env = {key: value for key, value in os.environ.items() if key not in ("GH_DEBUG", "DEBUG")}
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env=env)
    deadline, total = time.monotonic() + seconds, 0
    try:
        with selectors.DefaultSelector() as selector:
            selector.register(process.stdout, selectors.EVENT_READ)
            while True:
                remaining = deadline - time.monotonic()
                require(remaining > 0, "GitHub read exceeded time bound")
                require(selector.select(remaining), "GitHub read exceeded time bound")
                data = os.read(process.stdout.fileno(), BUFFER_BYTES)
                if not data:
                    break
                total += len(data)
                require(total <= limit, "GitHub response exceeds byte bound")
                yield data
        require(process.wait(timeout=max(0.001, deadline - time.monotonic())) == 0, "GitHub read failed")
    finally:
        if process.poll() is None:
            process.kill()
        process.wait()
        process.stdout.close()


def gh_chunks(endpoint, limit, seconds):
    require(endpoint.startswith(PREFIX), "Unexpected API repository")
    return command_chunks([
        "gh", "api", "--hostname", "github.com", "--method", "GET",
        "-H", "Accept: application/vnd.github+json",
        "-H", "X-GitHub-Api-Version: 2022-11-28", endpoint,
    ], limit, seconds)


def gh_json(endpoint):
    return json.loads(b"".join(gh_chunks(endpoint, BUFFER_BYTES, 30)))


def verify_source(artifact, run, job, workflow, expected=SOURCE):
    s = expected
    require(all(isinstance(value, dict) for value in (artifact, run, job, workflow)), "Invalid GitHub metadata object")
    require(artifact.get("id") == s["artifact_id"] and artifact.get("name") == s["artifact_name"], "Source artifact identity mismatch")
    require(artifact.get("expired") is False and artifact.get("size_in_bytes") == s["size_in_bytes"]
            and artifact.get("digest") == "sha256:" + s["sha256"], "Source artifact length/hash/expiry mismatch")
    require(run.get("id") == s["run_id"] and run.get("run_attempt") == s["run_attempt"]
            and run.get("path") == s["workflow"] and run.get("name") == s["workflow_name"]
            and run.get("head_sha") == s["head_sha"] and run.get("head_branch") == s["head_branch"]
            and run.get("event") == "workflow_run" and run.get("status") == "completed"
            and run.get("conclusion") == "success", "Source workflow attempt identity/success mismatch")
    repo, head_repo = run.get("repository", {}), run.get("head_repository", {})
    require(repo.get("full_name") == s["repository"] and head_repo.get("full_name") == s["repository"]
            and positive(repo.get("id")) and repo.get("id") == head_repo.get("id"), "Source repository mismatch")
    binding = artifact.get("workflow_run", {})
    require(binding.get("id") == s["run_id"] and binding.get("head_sha") == s["head_sha"]
            and binding.get("head_branch") == s["head_branch"]
            and binding.get("repository_id") == repo["id"] and binding.get("head_repository_id") == repo["id"],
            "Source artifact run/head/repository mismatch")
    require(positive(workflow.get("id")) and workflow.get("id") == run.get("workflow_id")
            and workflow.get("path") == s["workflow"] and workflow.get("name") == s["workflow_name"], "Source workflow mismatch")
    require(job.get("id") == s["job_id"] and job.get("run_id") == s["run_id"]
            and job.get("run_attempt") == s["run_attempt"] and job.get("head_sha") == s["head_sha"]
            and job.get("name") == s["job_name"] and job.get("status") == "completed"
            and job.get("conclusion") == "success", "Source job identity/success mismatch")
    for name in ("Verify exact approval and immutable capture", "Recheck financial proofs and seal exact exception candidate",
                 "Retain exact exception candidate and unchanged failed Design evidence"):
        steps = [step for step in job.get("steps", []) if step.get("name") == name]
        require(len(steps) == 1 and steps[0].get("conclusion") == "success", "Source artifact-producing step was not successful")


def diagnostic_context(env):
    require(env.get("GITHUB_REPOSITORY") == REPOSITORY
            and env.get("GITHUB_REF") == "refs/heads/" + BRANCH
            and env.get("GITHUB_EVENT_NAME") == "push", "Requires the exact diagnostic branch push")
    require(env.get("GITHUB_WORKFLOW_REF") == f"{REPOSITORY}/{WORKFLOW}@refs/heads/{BRANCH}",
            "Unexpected diagnostic workflow")
    require(re.fullmatch(r"[0-9a-f]{40}", env.get("GITHUB_SHA", "")), "Invalid diagnostic head")
    require(all(re.fullmatch(r"[1-9][0-9]*", env.get(k, ""))
                for k in ("GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT")), "Invalid diagnostic run")
    return {"repository": REPOSITORY, "workflow": WORKFLOW, "head_sha": env["GITHUB_SHA"],
            "head_branch": BRANCH, "run_id": int(env["GITHUB_RUN_ID"]),
            "run_attempt": int(env["GITHUB_RUN_ATTEMPT"])}


def authenticate(source, expected):
    """Finish whole-file authentication before parsing any archive metadata."""
    source.seek(0)
    digest, size = hashlib.sha256(), 0
    for block in iter(lambda: source.read(BUFFER_BYTES), b""):
        size += len(block)
        require(size <= expected["size_in_bytes"], "ZIP exceeds pinned length")
        digest.update(block)
    require(size == expected["size_in_bytes"], "ZIP pinned length mismatch")
    require(digest.hexdigest() == expected["sha256"], "ZIP pinned SHA256 mismatch")
    source.seek(0)


def exact_read(source, size):
    require(0 <= size <= BUFFER_BYTES, "Unbounded read")
    pieces, remaining = [], size
    while remaining:
        piece = source.read(remaining)
        require(piece, "Truncated archive")
        pieces.append(piece)
        remaining -= len(piece)
    return b"".join(pieces)


def central_directory(source, size):
    """Bound ZIP and ZIP64 central metadata before zipfile constructs objects."""
    start = max(0, size - 65557)
    source.seek(start)
    tail = source.read(65557)
    index = tail.rfind(b"PK\x05\x06")
    require(index >= 0 and len(tail) - index >= 22, "Missing ZIP end record")
    end = struct.unpack_from("<4s4H2IH", tail, index)
    require(len(tail) - index == 22 + end[-1] and end[1] == end[2] == 0,
            "Invalid or multi-disk ZIP")
    end_offset = start + index
    entries, central_bytes, central_offset = end[4:7]
    require(end[3] == entries, "Multi-disk ZIP entry count")
    boundary = end_offset
    if end_offset >= 20:
        source.seek(end_offset - 20)
        locator_bytes = exact_read(source, 20)
    else:
        locator_bytes = b""
    if locator_bytes.startswith(b"PK\x06\x07"):
        locator = struct.unpack("<4sIQI", locator_bytes)
        require(locator[1] == 0 and locator[3] == 1 and locator[2] < end_offset - 20,
                "Invalid ZIP64 locator")
        source.seek(locator[2])
        record = struct.unpack("<4sQ2H2I4Q", exact_read(source, 56))
        require(record[0] == b"PK\x06\x06" and 44 <= record[1] <= 65536
                and locator[2] + 12 + record[1] == end_offset - 20
                and record[4] == record[5] == 0 and record[6] == record[7], "Invalid ZIP64 end record")
        for value, full, sentinel in zip((entries, central_bytes, central_offset), record[7:10],
                                         (65535, 0xffffffff, 0xffffffff)):
            require(value in (full, sentinel), "Inconsistent ZIP64 metadata")
        entries, central_bytes, central_offset = record[7:10]
        boundary = locator[2]
    else:
        require(entries != 65535 and central_bytes != 0xffffffff and central_offset != 0xffffffff,
                "Missing ZIP64 locator")
    require(entries == 1 and 0 < central_bytes <= 65536 and central_offset > 0
            and central_offset + central_bytes == boundary, "Unexpected or unbounded ZIP directory")
    return central_offset


def zip_member(source, expected, bounds):
    central_offset = central_directory(source, expected["size_in_bytes"])
    source.seek(0)
    with zipfile.ZipFile(source) as archive:
        infos = archive.infolist()
        require(len(infos) == 1, "Unexpected ZIP members")
        info = infos[0]
        require(info.filename == info.orig_filename == "candidate.tar" and info.header_offset == 0 and info.volume == 0
                and not info.is_dir() and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                "Unsafe ZIP member")
        require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                and not info.flag_bits & ~0x080e, "Unsupported or encrypted ZIP member")
        require(info.compress_type != zipfile.ZIP_STORED or not info.flag_bits & 6,
                "Invalid stored ZIP flags")
        require(1024 <= info.file_size <= bounds.tar_bytes and 0 < info.compress_size <= expected["size_in_bytes"],
                "ZIP expansion exceeds bound")
    source.seek(0)
    header = struct.unpack("<4s5H3I2H", exact_read(source, 30))
    require(header[0] == b"PK\x03\x04" and header[2] == info.flag_bits
            and header[3] == info.compress_type and header[9] == len(b"candidate.tar"),
            "Inconsistent local ZIP header")
    require(exact_read(source, header[9]) == b"candidate.tar", "Unsafe local ZIP name")
    extra = exact_read(source, header[10])
    extras = {}
    while extra:
        require(len(extra) >= 4, "Truncated ZIP extra field")
        kind, count = struct.unpack_from("<HH", extra)
        require(count <= len(extra) - 4 and kind not in extras, "Invalid ZIP extra field")
        extras[kind], extra = extra[4:4 + count], extra[4 + count:]
    local_sizes = [header[8], header[7]]
    zip64 = extras.get(1, b"")
    for index, value in enumerate(local_sizes):
        if value == 0xffffffff:
            require(len(zip64) >= 8, "Missing local ZIP64 size")
            local_sizes[index], zip64 = struct.unpack_from("<Q", zip64)[0], zip64[8:]
    descriptor = bool(info.flag_bits & 8)
    require(header[6] in ((0, info.CRC) if descriptor else (info.CRC,)), "Local ZIP CRC mismatch")
    for local, actual in zip(local_sizes, (info.file_size, info.compress_size)):
        require(local in ((0, actual) if descriptor else (actual,)), "Local ZIP size mismatch")
    data_offset = source.tell()
    gap = central_offset - data_offset - info.compress_size
    require(gap in ((12, 16, 20, 24) if descriptor else (0,)), "Unexpected ZIP data or members")
    if descriptor:
        source.seek(data_offset + info.compress_size)
        data = exact_read(source, gap)
        if gap in (16, 24):
            require(data[:4] == b"PK\x07\x08", "Invalid ZIP descriptor")
            data = data[4:]
        values = struct.unpack("<III" if len(data) == 12 else "<IQQ", data)
        require(values == (info.CRC, info.compress_size, info.file_size), "ZIP descriptor mismatch")
    source.seek(data_offset)
    return info


def member_chunks(source, info, bounds):
    """Inflate with a hard output cap; reject trailing/unfinished deflate streams."""
    remaining, expanded, crc = info.compress_size, 0, 0
    decoder = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
    while remaining:
        compressed = exact_read(source, min(BUFFER_BYTES, remaining))
        remaining -= len(compressed)
        pending = compressed
        while pending:
            if decoder:
                block = decoder.decompress(pending, BUFFER_BYTES)
                pending = decoder.unconsumed_tail
                require(not decoder.unused_data, "Trailing compressed data")
            else:
                block, pending = pending, b""
            expanded += len(block)
            require(expanded <= info.file_size and expanded <= bounds.tar_bytes, "ZIP expansion exceeds bound")
            crc = zlib.crc32(block, crc)
            if block:
                yield block
    if decoder:
        while True:
            block = decoder.decompress(b"", BUFFER_BYTES)
            if not block:
                break
            expanded += len(block)
            require(expanded <= info.file_size and expanded <= bounds.tar_bytes, "ZIP expansion exceeds bound")
            crc = zlib.crc32(block, crc)
            yield block
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail, "Truncated compressed stream")
    require(expanded == info.file_size and crc == info.CRC, "ZIP expanded length or CRC mismatch")


class ChunkReader:
    def __init__(self, chunks):
        self.chunks, self.pending = iter(chunks), b""

    def read(self, size):
        require(0 < size <= BUFFER_BYTES, "Unbounded stream read")
        while not self.pending:
            self.pending = next(self.chunks, b"")
            if not self.pending:
                return b""
        result, self.pending = self.pending[:size], self.pending[size:]
        return result


def safe_parts(name, bounds):
    require(isinstance(name, str) and 0 < len(name.encode("utf-8")) <= bounds.path_bytes
            and not any(ord(c) < 32 or ord(c) == 127 for c in name) and "\\" not in name,
            "Unsafe TAR path")
    parts = name.split("/")
    require(len(parts) <= bounds.path_depth and all(part not in ("", ".", "..")
            and len(part.encode("utf-8")) <= 255 for part in parts), "Unsafe TAR path components")
    return parts


def create_parents(root_fd, parts):
    fd = os.dup(root_fd)
    try:
        for part in parts:
            try:
                os.mkdir(part, 0o700, dir_fd=fd)
            except FileExistsError:
                pass
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def extract_tar(source, root, bounds=BOUNDS):
    """Parse one GNU TAR stream; never delegate filesystem writes to tarfile."""
    nodes, explicit, inventory = {}, set(), []
    members = files = file_bytes = selected_bytes = 0
    longname = None
    root_fd = directory_fd(directory(root))
    try:
        while True:
            block = exact_read(source, 512)
            if block == bytes(512):
                require(longname is None and exact_read(source, 512) == bytes(512), "Invalid TAR end marker")
                # Drain every remaining ZIP byte, including its final CRC/length check.
                for padding in iter(lambda: source.read(BUFFER_BYTES), b""):
                    require(not any(padding), "Nonzero data after TAR end")
                break
            member = tarfile.TarInfo.frombuf(block, "utf-8", "strict")
            members += 1
            require(members <= bounds.members and member.size >= 0, "TAR member bound exceeded")
            if member.type == tarfile.GNUTYPE_LONGNAME:
                require(longname is None and member.name == "././@LongLink"
                        and 1 < member.size <= bounds.path_bytes + 1, "Unsafe GNU long name")
                raw = exact_read(source, member.size)
                require(raw.endswith(b"\0") and b"\0" not in raw[:-1], "Malformed GNU long name")
                longname = raw[:-1].decode("utf-8", "strict")
                require(not any(exact_read(source, (-member.size) % 512)), "Nonzero TAR padding")
                continue
            require(member.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE)
                    and not member.linkname, "Unsupported TAR member type or link target")
            name, longname = longname if longname is not None else member.name, None
            if member.isdir():
                require(not name.endswith("//") and not block[:100].split(b"\0", 1)[0].endswith(b"//"),
                        "Unsafe TAR directory path")
                name = name.removesuffix("/")
            parts = safe_parts(name, bounds)
            kind = "directory" if member.isdir() else "file"
            require(name not in explicit, "Duplicate TAR member")
            require(name not in nodes or (kind == "directory" and nodes[name] == kind), "TAR path conflict")
            for index in range(1, len(parts)):
                parent = "/".join(parts[:index])
                require(nodes.get(parent, "directory") == "directory", "TAR parent is a file")
                nodes[parent] = "directory"
            nodes[name] = kind
            explicit.add(name)
            require(len(nodes) <= bounds.members, "TAR path inventory exceeds bound")
            selected = parts[0] == "corrected"
            if member.isdir():
                require(member.size == 0, "Nonempty TAR directory")
                if selected:
                    os.close(create_parents(root_fd, parts))
                continue
            require(name != "corrected", "corrected must be a directory")
            files += 1
            file_bytes += member.size
            require(files <= bounds.members and file_bytes <= bounds.file_bytes, "TAR file bound exceeded")
            output = None
            digest = hashlib.sha256() if selected else None
            if selected:
                selected_bytes += member.size
                require(len(inventory) + 1 <= bounds.corrected_files and selected_bytes <= bounds.corrected_bytes,
                        "Corrected extraction exceeds bound")
                parent = create_parents(root_fd, parts[:-1])
                try:
                    fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                 0o600, dir_fd=parent)
                    output = os.fdopen(fd, "wb")
                finally:
                    os.close(parent)
            try:
                remaining = member.size
                while remaining:
                    data = exact_read(source, min(BUFFER_BYTES, remaining))
                    remaining -= len(data)
                    if output:
                        output.write(data)
                        digest.update(data)
            finally:
                if output:
                    output.close()
            require(not any(exact_read(source, (-member.size) % 512)), "Nonzero TAR padding")
            if selected:
                inventory.append(["/".join(parts[1:]), member.size, digest.hexdigest()])
        require(len(inventory) == bounds.expected_corrected_files
                and selected_bytes == bounds.expected_corrected_bytes, "Corrected exact inventory totals mismatch")
        require(nodes.get("corrected") == "directory", "Missing corrected directory")
    finally:
        os.close(root_fd)
    inventory.sort(key=lambda item: item[0])
    digest = hashlib.sha256(json.dumps(inventory, ensure_ascii=True, separators=(",", ":")).encode()).hexdigest()
    return {"tar_members": members, "tar_files": files, "tar_file_bytes": file_bytes,
            "corrected_files": len(inventory), "corrected_bytes": selected_bytes,
            "corrected_inventory_sha256": digest,
            "inventory_encoding": "SHA256 of UTF-8 compact JSON sorted [relative_path,bytes,sha256] tuples"}


def extract_archive(source, root, expected=SOURCE, bounds=BOUNDS, progress=lambda stage: None):
    progress("authenticate_whole_zip")
    authenticate(source, expected)
    progress("validate_zip_structure")
    info = zip_member(source, expected, bounds)
    progress("stream_and_validate_tar")
    result = extract_tar(ChunkReader(member_chunks(source, info, bounds)), root, bounds)
    result.update(tar_stream_bytes=info.file_size, zip_compressed_bytes=info.compress_size)
    return result


def source_evidence(artifact, run, job, workflow):
    """Preserve public metadata fields, excluding credentials, URLs and identities."""
    fields = {
        "artifact": ("id", "name", "size_in_bytes", "digest", "expired", "created_at", "updated_at", "expires_at"),
        "run": ("id", "run_attempt", "run_number", "workflow_id", "name", "path", "event", "head_sha", "head_branch",
                "status", "conclusion", "created_at", "updated_at", "run_started_at"),
        "job": ("id", "run_id", "run_attempt", "name", "head_sha", "head_branch", "status", "conclusion", "started_at", "completed_at"),
        "workflow": ("id", "name", "path", "state", "created_at", "updated_at"),
    }
    result = {key: {field: value[field] for field in fields[key] if field in value}
              for key, value in zip(fields, (artifact, run, job, workflow))}
    result["artifact"]["workflow_run"] = {key: artifact["workflow_run"].get(key) for key in
        ("id", "repository_id", "head_repository_id", "head_branch", "head_sha")}
    for key in ("repository", "head_repository"):
        result["run"][key] = {field: run[key].get(field) for field in ("id", "full_name")}
    result["job"]["steps"] = [{key: step[key] for key in
        ("number", "name", "status", "conclusion", "started_at", "completed_at") if key in step}
        for step in job.get("steps", [])]
    require(len(json.dumps(result).encode()) <= MANIFEST_LIMIT // 2, "Source evidence exceeds bound")
    return result


def prepare(root, context, api=gh_json, download=gh_chunks, expected=SOURCE, bounds=BOUNDS,
            progress=lambda stage: None):
    """Create a fresh intake only; rollback that directory on any failure."""
    root = Path(root)
    require(root.is_absolute() and root == root.resolve(), "Intake path must be canonical")
    parent = directory(root.parent)
    progress("verify_source_metadata")
    metadata = (api(PREFIX + f"artifacts/{expected['artifact_id']}"),
                api(PREFIX + f"runs/{expected['run_id']}/attempts/{expected['run_attempt']}"),
                api(PREFIX + f"jobs/{expected['job_id']}"),
                api(PREFIX + "workflows/financial-performance-certification.yml"))
    verify_source(*metadata, expected=expected)
    evidence = source_evidence(*metadata)
    parent_fd = directory_fd(parent)
    try:
        os.mkdir(root.name, mode=0o700, dir_fd=parent_fd)
    finally:
        os.close(parent_fd)
    try:
        progress("download_pinned_archive")
        with open_file(root, "original-artifact.zip", writing=True) as output:
            total = 0
            for block in download(PREFIX + f"artifacts/{expected['artifact_id']}/zip", expected["size_in_bytes"], 600):
                require(isinstance(block, bytes) and 0 < len(block) <= BUFFER_BYTES, "Invalid download chunk")
                total += len(block)
                require(total <= expected["size_in_bytes"], "ZIP download exceeds pinned bound")
                output.write(block)
        with open_file(root, "original-artifact.zip") as source:
            totals = extract_archive(source, root, expected, bounds, progress=progress)
        progress("write_intake_receipt")
        receipt = {"schema_version": "lossless-browser-intake-v1", "purpose": "READ-ONLY BROWSER DIAGNOSTIC",
                   "publication_authority": "none", "source": dict(expected), "source_metadata": evidence,
                   "compiled_ui_sha": COMPILED_UI_SHA, "diagnostic": context, "extraction": totals}
        write_json(root, "intake-receipt.json", receipt)
        return receipt
    except BaseException:
        # The root was exclusively created above; pre-existing files are never removed.
        shutil.rmtree(root)
        raise


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare",))
    parser.add_argument("--directory", type=Path, required=True)
    args = parser.parse_args()
    context = diagnostic_context(os.environ)
    runner = directory(Path(os.environ.get("RUNNER_TEMP", "")))
    require(args.directory.is_absolute() and args.directory == args.directory.resolve()
            and args.directory != runner and runner in args.directory.parents, "Intake must be fresh runner temp")
    result = prepare(args.directory, context,
                     progress=lambda stage: print(json.dumps({"intake_phase": stage}), file=sys.stderr, flush=True))
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, OSError, KeyError, TypeError, AttributeError, struct.error,
            zipfile.BadZipFile, tarfile.TarError, UnicodeError, zlib.error, subprocess.SubprocessError):
        raise SystemExit("READ-ONLY DIAGNOSTIC: intake validation or bounded GitHub read failed") from None
