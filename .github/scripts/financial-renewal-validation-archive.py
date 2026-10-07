#!/usr/bin/env python3
"""Local-only authenticated archive preflight; never download or restore a candidate.

The caller verifies GitHub identity and supplies the exact artifact byte binding.
This helper verifies those bytes, materializes one bounded candidate.tar, measures
its safe regular-file closure, and copies only bounded budget metadata. A report
is evidence about local bytes, not a certification or publication authorization.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tarfile
import zipfile
import zlib

BUFFER_BYTES = 1024 * 1024
ARCHIVE_LIMIT = 8 * 1024 ** 3
ENTRY_LIMIT = 200_000
METADATA_LIMIT = 128 * 1024 ** 2
METADATA_MEMBER_LIMIT = 32 * 1024 ** 2
RESERVE_BYTES = 2 * 1024 ** 3
PATH_LIMIT = 4096
TOP_FILES = frozenset((
    "candidate.json", "renewal-request.json", "source-delta.json", "history-inventory.json",
    "release-request.json", "protected-code.json", "preview-receipt.json", "verification.json",
    "request.json", "evidence.json", "target-base.json", "transport.json",
    "certification-registry.json", "certification-controller.json",
))
TOP_DIRS = frozenset((
    "projection", "corrected", "baseline", "predecessor", "original-source",
    "original-certification", "original-predecessor", "original-previous-source",
    "original-previous-certification",
))
TOP_MEMBERS = TOP_FILES | TOP_DIRS
METADATA_FILES = frozenset(("candidate.json", "renewal-request.json", "certification-controller.json",
                            "certification-registry.json", "preview-receipt.json", "transport.json"))
METADATA_ROOTS = tuple(
    f"{side}/{prefix}"
    for side in ("corrected", "predecessor")
    for prefix in ("static-data/_transport/",
                   "static-data/_financial-audit-transport/static-data/_transport/")
)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "Duplicate JSON key")
        result[key] = value
    return result


def canonical_path(value):
    path = Path(value)
    require(path.is_absolute() and str(path) == str(value) and path.resolve() == path,
            "Local paths must be absolute, canonical, and without symlinks")
    return path


def directory_fd(path):
    path = canonical_path(path)
    fd = os.open("/", os.O_RDONLY | os.O_DIRECTORY)
    try:
        for part in path.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd)
            fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def open_regular(path):
    path = canonical_path(path)
    parent = directory_fd(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
    finally:
        os.close(parent)
    try:
        value = os.fstat(fd)
        require(stat.S_ISREG(value.st_mode) and value.st_nlink == 1, "Linked or nonregular input")
        return os.fdopen(fd, "rb")
    except BaseException:
        os.close(fd)
        raise


def assert_unchanged(source, path, initial):
    require(fingerprint(os.fstat(source.fileno())) == initial
            and fingerprint(canonical_path(path).lstat()) == initial,
            "Input changed during preflight")


def create_regular(path):
    path = canonical_path(path)
    parent = directory_fd(path.parent)
    try:
        fd = os.open(path.name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                     0o600, dir_fd=parent)
    finally:
        os.close(parent)
    return os.fdopen(fd, "wb")


def validate_binding(value):
    require(isinstance(value, dict) and set(value) == {"artifact_id", "size_in_bytes", "sha256"},
            "Expected exact artifact binding fields")
    require(type(value["artifact_id"]) is int and 0 < value["artifact_id"] <= 2 ** 53 - 1,
            "Missing positive exact artifact ID")
    require(type(value["size_in_bytes"]) is int and 0 < value["size_in_bytes"] <= ARCHIVE_LIMIT,
            "Missing bounded exact artifact size")
    require(isinstance(value["sha256"], str)
            and re.fullmatch(r"[a-f0-9]{64}", value["sha256"]), "Missing exact artifact SHA256")
    return value


def read_binding(path):
    with open_regular(path) as source:
        initial = fingerprint(os.fstat(source.fileno()))
        require(initial[4] <= 4096, "Artifact binding exceeds bound")
        data = source.read(4097)
        require(len(data) == initial[4], "Artifact binding changed")
        value = json.loads(data, object_pairs_hook=no_duplicates,
                           parse_constant=lambda _: require(False, "Nonfinite JSON"))
        assert_unchanged(source, path, initial)
    return validate_binding(value)


def hash_stream(source, limit):
    digest, count = hashlib.sha256(), 0
    for data in iter(lambda: source.read(BUFFER_BYTES), b""):
        count += len(data)
        require(count <= limit, "Archive exceeds byte bound")
        digest.update(data)
    return count, digest.hexdigest()


def bound_zip_metadata(source, size):
    """Bound zipfile's central-directory allocation before invoking its parser."""
    source.seek(max(0, size - 65557))
    tail = source.read(65557)
    offset = tail.rfind(b"PK\x05\x06")
    require(offset >= 0 and len(tail) - offset >= 22, "Missing ZIP end record")
    end = struct.unpack_from("<4s4H2IH", tail, offset)
    require(len(tail) - offset == 22 + end[-1] and end[1] == end[2] == 0,
            "Trailing bytes or multi-disk ZIP")
    entries, central_bytes, central_offset = end[4:7]
    require(end[3] == entries, "ZIP disk entry count mismatch")
    end_offset = max(0, size - 65557) + offset
    metadata_end = end_offset
    source.seek(max(0, end_offset - 20))
    locator_bytes = source.read(20) if end_offset >= 20 else b""
    if locator_bytes[:4] == b"PK\x06\x07":
        locator = struct.unpack("<4sIQI", locator_bytes)
        require(locator[1] == 0 and locator[3] == 1 and 0 <= locator[2] <= end_offset - 76,
                "Invalid ZIP64 locator")
        source.seek(locator[2])
        record_bytes = source.read(56)
        require(len(record_bytes) == 56, "Truncated ZIP64 record")
        record = struct.unpack("<4sQ2H2I4Q", record_bytes)
        require(record[0] == b"PK\x06\x06" and record[1] == 44
                and record[4] == record[5] == 0 and record[6] == record[7], "Invalid ZIP64 record")
        require(locator[2] + 56 == end_offset - 20, "ZIP64 record offset mismatch")
        require(entries in (record[7], 65535) and central_bytes in (record[8], 0xffffffff)
                and central_offset in (record[9], 0xffffffff), "Conflicting ZIP64 metadata")
        entries, central_bytes, central_offset = record[7:10]
        metadata_end = locator[2]
    require(entries == 1 and 0 < central_bytes <= 4096 and central_offset >= 0
            and central_offset + central_bytes == metadata_end,
            "Expected exactly one bounded ZIP central-directory entry")
    source.seek(0)


def zip_chunks(source, archive, info):
    """Decode complete compressed range, including falsely declared size suffixes."""
    with archive.open(info, "r"):
        pass  # Let zipfile check the local filename against the central record.
    source.seek(info.header_offset)
    local_bytes = source.read(30)
    require(len(local_bytes) == 30, "Truncated ZIP local header")
    local = struct.unpack("<4s5H3I2H", local_bytes)
    require(local[0] == b"PK\x03\x04" and local[2] == info.flag_bits
            and local[3] == info.compress_type, "Conflicting ZIP local header")
    source.read(local[9])
    extra = source.read(local[10])
    require(len(extra) == local[10], "Truncated ZIP local extras")
    if not info.flag_bits & 8:
        compressed, expanded = local[7:9]
        if compressed == 0xffffffff or expanded == 0xffffffff:
            offset, zip64 = 0, None
            while offset + 4 <= len(extra):
                kind, length = struct.unpack_from("<HH", extra, offset)
                require(offset + 4 + length <= len(extra), "Truncated ZIP extra field")
                if kind == 1:
                    require(zip64 is None, "Duplicate ZIP64 local sizes")
                    zip64 = extra[offset + 4:offset + 4 + length]
                offset += 4 + length
            require(offset == len(extra) and zip64 is not None, "Missing ZIP64 local sizes")
            position = 0
            if expanded == 0xffffffff:
                require(len(zip64) >= position + 8, "Truncated ZIP64 expanded size")
                expanded = struct.unpack_from("<Q", zip64, position)[0]
                position += 8
            if compressed == 0xffffffff:
                require(len(zip64) >= position + 8, "Truncated ZIP64 compressed size")
                compressed = struct.unpack_from("<Q", zip64, position)[0]
        require(local[6] == info.CRC and compressed == info.compress_size and expanded == info.file_size,
                "Conflicting ZIP CRC or sizes")
    require(source.tell() + info.compress_size <= archive.start_dir, "ZIP payload overlaps metadata")
    remaining = info.compress_size
    decoder = zlib.decompressobj(-15) if info.compress_type == zipfile.ZIP_DEFLATED else None
    while remaining:
        data = source.read(min(BUFFER_BYTES, remaining))
        require(data, "Truncated ZIP payload")
        remaining -= len(data)
        if decoder is None:
            yield data
            continue
        pending = data
        while pending:
            decoded = decoder.decompress(pending, BUFFER_BYTES)
            pending = decoder.unconsumed_tail
            require(not decoder.unused_data, "Trailing DEFLATE bytes")
            if decoded:
                yield decoded
            if decoder.eof:
                require(not pending and remaining == 0, "DEFLATE ended before compressed range")
    if decoder is not None:
        while not decoder.eof:
            decoded = decoder.decompress(b"", BUFFER_BYTES)
            if not decoded:
                break
            yield decoded
        require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,
                "Truncated or trailing DEFLATE stream")
    descriptor_bytes = archive.start_dir - source.tell()
    if info.flag_bits & 8:
        require(descriptor_bytes in (12, 16, 20, 24), "Invalid ZIP data descriptor size")
        descriptor = source.read(descriptor_bytes)
        if descriptor_bytes in (16, 24):
            require(descriptor[:4] == b"PK\x07\x08", "Invalid ZIP data descriptor signature")
            descriptor = descriptor[4:]
        values = struct.unpack("<III" if len(descriptor) == 12 else "<IQQ", descriptor)
        require(values == (info.CRC, info.compress_size, info.file_size), "ZIP data descriptor mismatch")
    else:
        require(descriptor_bytes == 0, "Unexpected bytes before ZIP central directory")


def materialize_tar(zip_path, binding, tar_path):
    with open_regular(zip_path) as source:
        initial = fingerprint(os.fstat(source.fileno()))
        require(initial[4] == binding["size_in_bytes"], "Artifact ZIP size mismatch")
        count, digest = hash_stream(source, binding["size_in_bytes"])
        require(count == binding["size_in_bytes"] and digest == binding["sha256"],
                "Artifact ZIP SHA256 mismatch")
        bound_zip_metadata(source, count)
        with zipfile.ZipFile(source, "r") as archive:
            members = archive.infolist()
            require(len(members) == 1, "Expected exactly candidate.tar")
            info = members[0]
            require(info.filename == info.orig_filename == "candidate.tar" and info.header_offset == 0,
                    "Unexpected ZIP member or prefixed ZIP")
            require(not info.is_dir() and stat.S_IFMT(info.external_attr >> 16) in (0, stat.S_IFREG),
                    "Linked or special ZIP member")
            require(info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED)
                    and info.flag_bits & ~(8 | 0x800 | 6) == 0, "Unsupported or encrypted ZIP")
            require(0 < info.file_size <= ARCHIVE_LIMIT and 0 < info.compress_size <= count,
                    "Candidate TAR exceeds bound")
            parent_fd = directory_fd(canonical_path(tar_path).parent)
            try:
                disk = os.fstatvfs(parent_fd)
                require(disk.f_bavail * disk.f_frsize >= info.file_size + METADATA_LIMIT + RESERVE_BYTES,
                        "Insufficient measured disk for TAR and metadata preflight")
            finally:
                os.close(parent_fd)
            with create_regular(tar_path) as target:
                # Reserve real TAR storage before decoding. Unsupported reservation
                # fails closed; this is separate from the later complete budget.
                os.posix_fallocate(target.fileno(), 0, info.file_size)
                tar_digest, tar_count, crc = hashlib.sha256(), 0, 0
                for data in zip_chunks(source, archive, info):
                    tar_count += len(data)
                    require(tar_count <= info.file_size and tar_count <= ARCHIVE_LIMIT,
                            "Decoded candidate TAR exceeds declared size")
                    crc = zlib.crc32(data, crc)
                    tar_digest.update(data)
                    target.write(data)
                require(tar_count == info.file_size and crc == info.CRC,
                        "Decoded candidate TAR size or CRC mismatch")
                target.flush()
                os.fsync(target.fileno())
        assert_unchanged(source, zip_path, initial)
    return tar_count, tar_digest.hexdigest()


def safe_member_name(name, is_directory=False):
    require(isinstance(name, str) and 0 < len(name.encode("utf-8")) <= PATH_LIMIT,
            "Invalid TAR member path length")
    if is_directory and name.endswith("/"):
        name = name[:-1]
    require(name and not name.startswith("/") and "\\" not in name
            and all(ord(char) >= 32 and ord(char) != 127 for char in name)
            and all(part not in ("", ".", "..") for part in name.split("/")),
            "Unsafe TAR member path")
    require(name.split("/")[0] in TOP_MEMBERS, "Unknown TAR top-level member")
    return name


def metadata_member(name):
    if name in METADATA_FILES or name in ("corrected/publication.json", "predecessor/publication.json"):
        return True
    return any(name.startswith(prefix)
               and re.fullmatch(r"(?:root|logical)-[a-f0-9]{64}\.json", name[len(prefix):])
               for prefix in METADATA_ROOTS)


def inspect_tar(source, expected_bytes, expected_sha):
    """Parse bounded headers without tarfile's allocating GNU/PAX extension parser."""
    require(0 < expected_bytes <= ARCHIVE_LIMIT and expected_bytes % 512 == 0,
            "Invalid TAR length")
    digest, consumed = hashlib.sha256(), 0

    def take(count):
        nonlocal consumed
        require(0 <= count <= BUFFER_BYTES, "Internal bounded read violation")
        data = source.read(count)
        require(len(data) == count, "Truncated TAR")
        consumed += count
        require(consumed <= expected_bytes, "TAR exceeds expected length")
        digest.update(data)
        return data

    seen, files, implied_dirs, tops, selected = set(), set(), set(), set(), []
    top_level_bytes = {name: 0 for name in sorted(TOP_MEMBERS)}
    extracted_bytes = metadata_bytes = headers = 0
    pending_name = None
    while True:
        block = take(512)
        if block == bytes(512):
            require(pending_name is None and take(512) == bytes(512), "Incomplete TAR terminator")
            while consumed < expected_bytes:
                require(not any(take(min(BUFFER_BYTES, expected_bytes - consumed))),
                        "Nonzero trailing TAR bytes or concatenated TAR")
            break
        headers += 1
        require(headers <= 2 * ENTRY_LIMIT, "TAR header count exceeds bound")
        item = tarfile.TarInfo.frombuf(block, "utf-8", "strict")
        require(type(item.size) is int and 0 <= item.size <= ARCHIVE_LIMIT, "Invalid TAR member size")
        if item.type == tarfile.GNUTYPE_LONGNAME:
            require(pending_name is None and 1 < item.size <= PATH_LIMIT + 1,
                    "Oversized or repeated GNU long name")
            payload = take(item.size)
            require(payload.endswith(b"\x00") and b"\x00" not in payload[:-1], "Invalid GNU long name")
            pending_name = payload[:-1].decode("utf-8", "strict")
            require(not any(take((-item.size) % 512)), "Nonzero TAR member padding")
            continue
        require(item.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE),
                "Linked, sparse, extended, or special TAR member")
        is_dir = item.type == tarfile.DIRTYPE
        require(not item.linkname and (not is_dir or item.size == 0), "Linked or nonempty TAR directory")
        name = safe_member_name(pending_name if pending_name is not None else item.name, is_dir)
        pending_name = None
        require(name not in seen, "Duplicate TAR member")
        parents = ["/".join(name.split("/")[:i]) for i in range(1, len(name.split("/")))]
        require(not any(parent in files for parent in parents), "TAR file used as parent directory")
        require(is_dir or name not in implied_dirs, "TAR directory replaced by file")
        implied_dirs.update(parents)
        seen.add(name)
        require(len(seen) <= ENTRY_LIMIT, "TAR entry count exceeds bound")
        top = name.split("/")[0]
        if "/" not in name:
            require(is_dir == (top in TOP_DIRS), "Incorrect TAR top-level member type")
            tops.add(name)
        require(top not in TOP_FILES or name == top, "TAR top-level file used as directory")
        if not is_dir:
            files.add(name)
            extracted_bytes += item.size
            top_level_bytes[top] += item.size
            require(extracted_bytes <= ARCHIVE_LIMIT, "TAR extracted bytes exceed bound")
            if metadata_member(name):
                metadata_bytes += item.size
                require(item.size <= METADATA_MEMBER_LIMIT and metadata_bytes <= METADATA_LIMIT,
                        "Budget metadata exceeds bounded extraction allowance")
                selected.append({"path": name, "offset": consumed, "bytes": item.size})
        remaining = item.size
        while remaining:
            amount = min(BUFFER_BYTES, remaining)
            take(amount)
            remaining -= amount
        require(not any(take((-item.size) % 512)), "Nonzero TAR member padding")
    require(tops == TOP_MEMBERS, "Missing exact TAR top-level closure")
    require(source.read(1) == b"" and consumed == expected_bytes and digest.hexdigest() == expected_sha,
            "TAR bytes changed after ZIP authentication")
    return {"tar_bytes": consumed, "tar_sha256": digest.hexdigest(),
            "extracted_bytes": extracted_bytes, "file_count": len(files),
            "entry_count": len(seen), "header_count": headers,
            "top_level_bytes": top_level_bytes,
            "metadata_bytes": metadata_bytes, "metadata_file_count": len(selected)}, selected


def extract_metadata(source, destination, selected):
    destination = canonical_path(destination)
    parent = directory_fd(destination.parent)
    try:
        os.mkdir(destination.name, 0o700, dir_fd=parent)
    finally:
        os.close(parent)
    root = directory_fd(destination)
    try:
        for member in selected:
            fd = os.dup(root)
            try:
                parts = member["path"].split("/")
                for part in parts[:-1]:
                    try:
                        os.mkdir(part, 0o700, dir_fd=fd)
                    except FileExistsError:
                        pass
                    child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
                    os.close(fd)
                    fd = child
                target_fd = os.open(parts[-1], os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW,
                                    0o600, dir_fd=fd)
                with os.fdopen(target_fd, "wb") as target:
                    source.seek(member["offset"])
                    remaining = member["bytes"]
                    while remaining:
                        data = source.read(min(BUFFER_BYTES, remaining))
                        require(data, "TAR changed during metadata copy")
                        target.write(data)
                        remaining -= len(data)
            finally:
                os.close(fd)
    finally:
        os.close(root)


def preflight(zip_path, binding_path, tar_path, metadata_path, report_path):
    # Validate all paths and destinations before reading untrusted archive bytes.
    paths = [canonical_path(path) for path in
             (zip_path, binding_path, tar_path, metadata_path, report_path)]
    require(len(set(paths)) == len(paths), "Input/output paths must be distinct")
    output_devices = set()
    for path in paths[2:]:
        require(not path.exists(), "Preflight destination already exists")
        fd = directory_fd(path.parent)
        try:
            output_devices.add(os.fstat(fd).st_dev)
        finally:
            os.close(fd)
    require(len(output_devices) == 1, "Preflight outputs must share the measured filesystem")
    binding = read_binding(binding_path)
    tar_bytes, tar_sha = materialize_tar(zip_path, binding, tar_path)
    with open_regular(tar_path) as source:
        initial = fingerprint(os.fstat(source.fileno()))
        report, selected = inspect_tar(source, tar_bytes, tar_sha)
        assert_unchanged(source, tar_path, initial)
        extract_metadata(source, metadata_path, selected)
        assert_unchanged(source, tar_path, initial)
    report = {"schema_version": "financial-renewal-validation-archive-v1", "status": "verified",
              "artifact": binding, **report,
              "candidate_extracted": False, "authority": "none"}
    with create_regular(report_path) as target:
        target.write((json.dumps(report, sort_keys=True, separators=(",", ":")) + "\n").encode())
    return report


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("zip", "binding", "candidate-tar", "metadata", "report"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args(argv)
    try:
        result = preflight(args.zip, args.binding, args.candidate_tar, args.metadata, args.report)
    except (ValueError, OSError, EOFError, UnicodeError, tarfile.TarError, zipfile.BadZipFile,
            struct.error, zlib.error) as error:
        print(f"Archive preflight failed: {error}", file=sys.stderr)
        return 1
    print(json.dumps(result, sort_keys=True, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
