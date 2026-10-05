#!/usr/bin/env python3
"""Offline, bounded extraction of one pinned UNAPPROVED diagnostic research file.

No archive paths are ever passed to filesystem writes. The entire archive is
validated before the selected bytes become visible at the explicit output path.
This is review-only evidence, never an accepted release or publication input.
"""
import argparse
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import struct
import sys
import tarfile
import tempfile
from typing import NamedTuple
import zipfile
import zlib


REPOSITORY = "kusennjp1-ai/screener"
ARTIFACT_ID = 11319208142
RUN_ID = 37244922910
RUN_ATTEMPT = 1
OUTER_SHA256 = "2f1de2c2bd4c8107daff636caad2723ec6ac1c5aa97b07af0e0cbaaad08f236a"
WIRE_SHA256 = "10310c30693f0bc80d5ebc3b49428d422fdf64e1e5361fe5d849a058f1642690"
OUTER_BYTES = 361900724
CONTAINER_SHA256 = "3b11e55eeebe5da9f4c886de10ffd921e20b34591bde8edbe4c9df6e0597c616"
RESEARCH_MEMBER = "review-only/corrected/static-data/research-index-10310c30693f0bc8.json"
CONTAINER_MEMBER = "unapproved-financial-diagnostic.tar.gz"
ZIP_MEMBER_SIZES = {CONTAINER_MEMBER: 361899836, "unapproved-financial-diagnostic-metadata.json": 516}
ZIP_MEMBERS = tuple(ZIP_MEMBER_SIZES)
CHUNK = 1024 * 1024


class Limits(NamedTuple):
    zip_bytes: int
    expanded_bytes: int
    tar_members: int
    zip_members: int = 8
    central_directory_bytes: int = 64 * 1024
    selected_bytes: int = 16 * 1024 * 1024
    metadata_bytes: int = 64 * 1024
    path_bytes: int = 1024


# The pinned archive has 19,605 payload files totaling 2,075,054,890 bytes.
# Headroom covers TAR headers/padding/directories; it cannot grow without review.
LIMITS = Limits(zip_bytes=384 * 1024 * 1024, expanded_bytes=2300000000,
                tar_members=22000, zip_members=2, central_directory_bytes=4096)


def require(condition, message):
    if not condition:
        raise ValueError(message)


def fingerprint(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_size,
            info.st_mtime_ns, info.st_ctime_ns)


def safe_name(name, directory, limits):
    require(isinstance(name, str) and 0 < len(name.encode("utf-8")) <= limits.path_bytes,
            "Unsafe archive path length")
    require(not name.startswith("/") and "\\" not in name and ":" not in name
            and all(ord(char) >= 32 and ord(char) != 127 for char in name), "Unsafe archive path")
    while name.startswith("./"):
        name = name[2:]
    if directory and name.endswith("/"):
        name = name[:-1]
    if directory and name in ("", "."):
        return ""
    require(name and all(part not in ("", ".", "..") for part in name.split("/")), "Unsafe archive path")
    return name


class Inventory:
    def __init__(self):
        self.seen = set()
        self.files = set()
        self.parents = set()

    def add(self, name, directory):
        require(name not in self.seen, "Duplicate normalized archive path")
        self.seen.add(name)
        parts = name.split("/")
        parents = {"/".join(parts[:end]) for end in range(1, len(parts))}
        require(not parents & self.files and (directory or name not in self.parents),
                "Conflicting archive file/directory paths")
        self.parents.update(parents)
        if not directory:
            self.files.add(name)


class BoundedReader:
    """Bound actual decompression, independently of untrusted declared sizes."""
    def __init__(self, source, maximum):
        self.source, self.maximum, self.total = source, maximum, 0
        self.hash = hashlib.sha256()

    def read(self, size):
        require(0 <= size <= CHUNK, "Unbounded archive read")
        data = self.source.read(min(size, self.maximum - self.total + 1))
        self.total += len(data)
        self.hash.update(data)
        require(self.total <= self.maximum, "Expanded archive exceeds byte bound")
        return data


def exact_read(source, size):
    require(0 <= size <= CHUNK, "Unbounded archive read")
    data = bytearray()
    while len(data) < size:
        chunk = source.read(size - len(data))
        require(chunk, "Truncated archive stream")
        data.extend(chunk)
    return bytes(data)


def consume(source, size, selected=None):
    while size:
        chunk = exact_read(source, min(CHUNK, size))
        if selected is not None:
            selected.extend(chunk)
        size -= len(chunk)


def drain(source, zeros=False):
    while chunk := source.read(CHUNK):
        require(not zeros or not any(chunk), "Nonzero data after TAR terminator")


def preflight_zip(source, size, limits):
    """Bound the central directory before ZipFile allocates it; include ZIP64."""
    require(22 <= size <= limits.zip_bytes, "ZIP exceeds byte bound or is truncated")
    source.seek(max(0, size - 65557))
    tail = source.read(65557)
    offset = tail.rfind(b"PK\x05\x06")
    require(offset >= 0 and offset + 22 <= len(tail), "Missing ZIP end record")
    record = struct.unpack_from("<4s4H2IH", tail, offset)
    _, disk, directory_disk, disk_count, count, cd_size, cd_offset, comment_size = record
    require(offset + 22 + comment_size == len(tail) and disk == directory_disk == 0
            and disk_count == count, "Unsupported ZIP end record")
    end_offset = size - len(tail) + offset
    directory_end = end_offset
    if end_offset >= 20:
        source.seek(end_offset - 20)
        locator = source.read(20)
        if locator[:4] == b"PK\x06\x07":
            _, zip64_disk, zip64_offset, disks = struct.unpack("<4sIQI", locator)
            require(zip64_disk == 0 and disks == 1 and zip64_offset + 56 == end_offset - 20,
                    "Unsupported ZIP64 locator")
            source.seek(zip64_offset)
            raw = source.read(56)
            require(len(raw) == 56, "Truncated ZIP64 end record")
            z = struct.unpack("<4sQ2H2I4Q", raw)
            require(z[0] == b"PK\x06\x06" and z[1] == 44 and z[4] == z[5] == 0 and z[6] == z[7],
                    "Unsupported ZIP64 end record")
            require(count in (0xFFFF, z[7]) and cd_size in (0xFFFFFFFF, z[8])
                    and cd_offset in (0xFFFFFFFF, z[9]), "Inconsistent ZIP64 end records")
            count, cd_size, cd_offset = z[7:10]
            directory_end = zip64_offset
    require(0 < count <= limits.zip_members and 0 < cd_size <= limits.central_directory_bytes,
            "ZIP inventory exceeds bound")
    require(cd_offset + cd_size == directory_end, "Invalid ZIP central directory bounds")
    source.seek(0)
    require(source.read(4) == b"PK\x03\x04", "Unsupported ZIP prefix")
    source.seek(0)
    return count


def pax_fields(data):
    """Parse only bounded ordinary PAX metadata; never sparse/link extensions."""
    result = {}
    allowed = {"path", "size", "mtime", "atime", "ctime", "uid", "gid", "uname", "gname"}
    offset = 0
    while offset < len(data):
        space = data.find(b" ", offset)
        require(space > offset and space - offset <= 10 and data[offset:space].isdigit(), "Invalid PAX record")
        length = int(data[offset:space])
        end = offset + length
        require(end <= len(data) and end > space + 3 and data[end - 1:end] == b"\n", "Invalid PAX record length")
        key, separator, value = data[space + 1:end - 1].partition(b"=")
        require(separator, "Invalid PAX field")
        key, value = key.decode("utf-8", "strict"), value.decode("utf-8", "strict")
        require(key in allowed and key not in result, "Unsupported or duplicate PAX field")
        result[key] = value
        offset = end
    return result


def read_tar(source, target, limits):
    """Read 512-byte headers directly to bound even PAX/GNU extension payloads.

    TarInfo.frombuf validates ordinary header checksums without following links,
    processing sparse extensions, caching member objects, or allocating payloads.
    """
    reader = BoundedReader(source, limits.expanded_bytes)
    inventory, global_pax, pending = Inventory(), {}, {}
    selected, members = None, 0
    while True:
        header = exact_read(reader, 512)
        if not any(header):
            require(not pending, "Orphaned TAR extension")
            require(not any(exact_read(reader, 512)), "Incomplete TAR terminator")
            drain(reader, zeros=True)
            require(reader.total % 512 == 0, "Truncated TAR padding")
            break
        members += 1
        require(members <= limits.tar_members, "TAR member count exceeds bound")
        item = tarfile.TarInfo.frombuf(header, "utf-8", "strict")
        require(0 <= item.size <= limits.expanded_bytes, "TAR member exceeds byte bound")
        directory = item.type == tarfile.DIRTYPE
        safe_name(item.name, directory, limits)
        require(not item.linkname, "TAR link metadata is forbidden")
        if item.type in (tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.GNUTYPE_LONGNAME):
            require(item.size <= limits.metadata_bytes, "TAR metadata exceeds bound")
            data = exact_read(reader, item.size)
            consume(reader, -item.size % 512)
            if item.type == tarfile.GNUTYPE_LONGNAME:
                require(data.endswith(b"\0") and b"\0" not in data[:-1], "Invalid GNU long name")
                fields = {"path": data[:-1].decode("utf-8", "strict")}
            else:
                fields = pax_fields(data)
            if item.type == tarfile.XGLTYPE:
                require(not ({"path", "size"} & fields.keys()), "Global PAX path/size is forbidden")
                global_pax.update(fields)
            else:
                require(not pending, "Multiple pending TAR extensions")
                pending = fields
            continue
        require(item.type in (tarfile.REGTYPE, tarfile.AREGTYPE, tarfile.DIRTYPE), "Special TAR member is forbidden")
        fields = global_pax | pending
        pending = {}
        name = safe_name(fields.get("path", item.name), directory, limits)
        size = item.size
        if "size" in fields:
            require(re.fullmatch(r"[0-9]{1,12}", fields["size"]), "Invalid PAX size")
            size = int(fields["size"])
        require(0 <= size <= limits.expanded_bytes and (not directory or size == 0), "TAR member exceeds byte bound")
        inventory.add(name, directory)
        output = None
        if name == target:
            require(not directory and selected is None, "Missing or duplicate regular research member")
            require(size <= limits.selected_bytes, "Selected research exceeds byte bound")
            selected = output = bytearray()
        consume(reader, size, output)
        consume(reader, -size % 512)
    require(selected is not None, "Exact research member is missing")
    return selected, members, reader.total


def validate_zip(zipped, expected_members, limits):
    infos = zipped.infolist()
    require(len(infos) <= limits.zip_members, "ZIP member count exceeds bound")
    inventory, expanded = Inventory(), 0
    for info in infos:
        mode = info.external_attr >> 16
        kind = stat.S_IFMT(mode)
        directory = info.is_dir()
        require(info.orig_filename == info.filename, "NUL in ZIP path")
        name = safe_name(info.filename, directory, limits)
        inventory.add(name, directory)
        require(kind in (0, stat.S_IFREG, stat.S_IFDIR) and (kind != stat.S_IFDIR or directory)
                and (kind != stat.S_IFREG or not directory), "Special ZIP member is forbidden")
        # PKWARE Unix extra data can describe hard links; only ZIP64 and ordinary
        # timestamp/uid fields occur in the reviewed artifact format.
        extra = info.extra
        while extra:
            require(len(extra) >= 4, "Truncated ZIP extra field")
            field, length = struct.unpack_from("<HH", extra)
            require(len(extra) >= 4 + length and field in (0x0001, 0x5455, 0x7875), "Unsupported ZIP extra field")
            extra = extra[4 + length:]
        allowed_flags = 0x0808 | (0x0006 if info.compress_type == zipfile.ZIP_DEFLATED else 0)
        require(not info.flag_bits & ~allowed_flags
                and info.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED),
                "Encrypted or unsupported ZIP member")
        require(0 <= info.file_size <= limits.expanded_bytes and (not directory or info.file_size == 0)
                and 0 <= info.compress_size <= limits.zip_bytes, "ZIP member exceeds byte bound")
        expanded += info.file_size
    require(expanded <= limits.expanded_bytes, "Expanded ZIP inventory exceeds byte bound")
    require(inventory.seen == set(expected_members) and len(infos) == len(expected_members), "Unexpected ZIP inventory")
    return infos


def publish(output, data):
    """Publish atomically and exclusively; leave no partial output on failure."""
    parent = output.parent
    require(parent.is_dir() and parent == parent.resolve(), "Output directory contains a link or alias")
    require(not output.exists() and not output.is_symlink(), "Output already exists")
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(prefix=".ranking-diagnostic-", suffix=".partial", dir=parent, delete=False) as stream:
            temporary = Path(stream.name)
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.link(temporary, output, follow_symlinks=False)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def extract(archive, output, *, outer_sha256=OUTER_SHA256, wire_sha256=WIRE_SHA256,
            container=CONTAINER_MEMBER, expected_members=ZIP_MEMBERS,
            target=RESEARCH_MEMBER, limits=LIMITS, outer_bytes=OUTER_BYTES,
            container_sha256=CONTAINER_SHA256, member_sizes=ZIP_MEMBER_SIZES):
    """Parameters other than paths exist for offline fixtures; the CLI pins them."""
    require(all(re.fullmatch(r"[a-f0-9]{64}", digest) for digest in (outer_sha256, wire_sha256)), "Invalid pinned digest")
    require(expected_members and limits.zip_bytes > 0, "Diagnostic inventory is not pinned")
    archive, output = Path(archive).absolute(), Path(output).absolute()
    require(archive != output, "Input and output must differ")
    descriptor = os.open(archive, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as stream:
        before = os.fstat(stream.fileno())
        require(stat.S_ISREG(before.st_mode), "Archive must be a regular file")
        require(before.st_size == outer_bytes, "Outer ZIP byte size mismatch")
        count = preflight_zip(stream, before.st_size, limits)
        hasher = hashlib.sha256()
        while data := stream.read(CHUNK):
            hasher.update(data)
        require(hasher.hexdigest() == outer_sha256, "Outer ZIP SHA256 mismatch")
        stream.seek(0)
        with zipfile.ZipFile(stream) as zipped:
            infos = validate_zip(zipped, expected_members, limits)
            require(len(infos) == count, "ZIP entry count disagrees with end record")
            require({safe_name(info.filename, info.is_dir(), limits): info.file_size for info in infos} == member_sizes,
                    "ZIP member byte sizes differ from pins")
            selected, member_count, expanded_bytes = None, 0, 0
            for info in infos:
                name = safe_name(info.filename, info.is_dir(), limits)
                with zipped.open(info) as raw:
                    source = BoundedReader(raw, info.file_size)
                    if name == container:
                        if container.endswith(".tar.gz"):
                            with gzip.GzipFile(fileobj=source, mode="rb") as uncompressed:
                                selected, member_count, expanded_bytes = read_tar(uncompressed, target, limits)
                        else:
                            require(container.endswith(".tar"), "Unsupported pinned container")
                            selected, member_count, expanded_bytes = read_tar(source, target, limits)
                    elif container is None and name == target:
                        require(info.file_size <= limits.selected_bytes and not info.is_dir(), "Selected research exceeds byte bound")
                        selected = bytearray()
                        consume(source, info.file_size, selected)
                    drain(source)
                    require(source.total == info.file_size, "Truncated ZIP member")
                    if name == container:
                        require(source.hash.hexdigest() == container_sha256, "Container SHA256 mismatch")
        require(fingerprint(os.fstat(stream.fileno())) == fingerprint(before), "Archive changed while reading")
    require(selected is not None, "Exact research member is missing")
    require(hashlib.sha256(selected).hexdigest() == wire_sha256, "Research wire SHA256 mismatch")
    publish(output, selected)
    return {"status": "UNAPPROVED", "purpose": "diagnostic_review_only", "publication_authority": "none",
            "accepted_release_input": False, "repository": REPOSITORY, "artifact_id": ARTIFACT_ID,
            "run_id": RUN_ID, "run_attempt": RUN_ATTEMPT, "outer_sha256": outer_sha256,
            "wire_sha256": wire_sha256, "member": target, "container": container,
            "outer_bytes": outer_bytes, "container_sha256": container_sha256,
            "bytes": len(selected), "tar_headers": member_count, "tar_bytes": expanded_bytes}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    args = parser.parse_args()
    try:
        result = extract(args.archive, args.output)
    except (OSError, ValueError, EOFError, zipfile.BadZipFile, tarfile.TarError, zlib.error) as error:
        parser.exit(1, f"Diagnostic extraction failed: {error}\n")
    print(json.dumps(result, sort_keys=True))


if __name__ == "__main__":
    main()
