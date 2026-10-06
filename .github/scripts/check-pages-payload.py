#!/usr/bin/env python3
"""Read-only, fail-closed preflight for the Linux upload-pages-artifact@v4 tree."""

import argparse
import contextlib
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile

# Decimal GB deliberately errs on the conservative side of GitHub's "1 GB".
# These are independent of source/certification/audit archive limits.
SITE_LIMIT_BYTES = 1_000_000_000
TAR_LIMIT_BYTES = 1_000_000_000


class PayloadError(Exception):
    def __init__(self, message, report=None):
        super().__init__(message)
        self.report = report or {}


def _fingerprint(info):
    # atime is intentionally excluded: our own TAR read can change it.
    return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
            info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _safe_name(name):
    if (name in ("", ".", "..") or "\\" in name
            or any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise PayloadError(f"Unsafe payload path component: {name!r}")
    try:
        name.encode("utf-8", errors="strict")
    except UnicodeError as error:
        raise PayloadError(f"Non-UTF-8 payload path component: {name!r}") from error


@contextlib.contextmanager
def _open_root(root):
    """Pin the tree without following a symlink in any input path component."""
    path = Path(root)
    if not str(root) or ".." in path.parts:
        raise PayloadError("Payload path must be nonempty and may not contain '..'")
    absolute = path.absolute()
    if absolute == Path("/"):
        raise PayloadError("The filesystem root is not a payload directory")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    descriptor = os.open("/", flags)
    ancestors = []
    try:
        for component in absolute.parts[1:]:
            _safe_name(component)
            child = os.open(component, flags, dir_fd=descriptor)
            os.close(descriptor)
            descriptor = child
            info = os.fstat(descriptor)
            ancestors.append((info.st_dev, info.st_ino))
        yield descriptor, tuple(ancestors)
    finally:
        os.close(descriptor)


def _snapshot(root_fd):
    entries = {}
    seen_files = set()

    def visit(directory_fd, relative):
        before = os.fstat(directory_fd)
        entries[relative] = _fingerprint(before)
        for name in sorted(os.listdir(directory_fd)):
            _safe_name(name)
            path = f"{relative}/{name}" if relative else name
            info = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)):
                raise PayloadError(f"Symlink or special file is forbidden: {path!r}")
            if stat.S_ISREG(info.st_mode):
                if info.st_nlink != 1 or (info.st_dev, info.st_ino) in seen_files:
                    raise PayloadError(f"Hard-linked file is forbidden: {path!r}")
                seen_files.add((info.st_dev, info.st_ino))
            flags = os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK
            if stat.S_ISDIR(info.st_mode):
                flags |= os.O_DIRECTORY
            child = os.open(name, flags, dir_fd=directory_fd)
            try:
                if _fingerprint(os.fstat(child)) != _fingerprint(info):
                    raise PayloadError(f"Payload changed while opening: {path!r}")
                if stat.S_ISDIR(info.st_mode):
                    visit(child, path)
                else:
                    entries[path] = _fingerprint(info)
            finally:
                os.close(child)
        if _fingerprint(os.fstat(directory_fd)) != _fingerprint(before):
            raise PayloadError(f"Directory changed while measuring: {relative or '.'!r}")

    visit(root_fd, "")
    return entries


def _measure_tar_bytes(root_fd):
    """Count actual uncompressed GNU TAR output, including names/headers/padding.

    v4's --dereference/--hard-dereference are intentionally omitted: a stable
    link-free tree produces the same archive size, and a racing symlink must
    never cause this preflight to read outside the tree. Snapshots reject links
    or mutations. No TAR or report is added to the measured payload.
    """
    version = subprocess.run(["tar", "--version"], check=True,
                             capture_output=True, text=True).stdout
    if not version.startswith("tar (GNU tar)"):
        raise PayloadError("The Pages payload guard requires GNU tar on Linux")
    command = ["tar", "--directory", f"/proc/self/fd/{root_fd}",
               "--create", "--file=-", "--exclude=.git", "--exclude=.github",
               "--exclude=.[^/]*", "."]
    total = 0
    # A file-backed stderr prevents a pipe deadlock on a changing large tree.
    with tempfile.TemporaryFile() as errors:
        with subprocess.Popen(command, stdout=subprocess.PIPE, stderr=errors,
                              pass_fds=(root_fd,)) as process:
            while chunk := process.stdout.read(1024 * 1024):
                total += len(chunk)
            status = process.wait()
        errors.seek(0)
        diagnostic = errors.read(8192).decode("utf-8", errors="replace")
    if status != 0 or diagnostic:
        raise PayloadError(f"TAR measurement failed (exit {status}): {diagnostic}")
    return total


def check_payload(root):
    report = {
        "schema_version": "pages-payload-size-v1",
        "root": str(root),
        "site_limit_bytes": SITE_LIMIT_BYTES,
        "tar_limit_bytes": TAR_LIMIT_BYTES,
        "measurement": "sum of regular-file logical sizes, including hidden files; "
                       "separate uncompressed GNU TAR matching v4 exclusions",
        "tar_bytes": None,
    }
    try:
        # These alter GNU TAR's format/selection. Never let an environment flag
        # silently change what the preflight or following upload would measure.
        if "TAR_OPTIONS" in os.environ or "POSIXLY_CORRECT" in os.environ:
            raise PayloadError("TAR_OPTIONS and POSIXLY_CORRECT must be absent")
        with _open_root(root) as (root_fd, ancestors):
            before = _snapshot(root_fd)
            files = [(path, info[4]) for path, info in before.items()
                     if stat.S_ISREG(info[2])]
            report.update(
                file_bytes=sum(size for _, size in files),
                file_count=len(files),
                directory_count=len(before) - len(files),  # Includes root.
                path_bytes=sum(len(path.encode("utf-8")) for path in before),
                largest_files=[{"path": path, "bytes": size} for path, size in
                               sorted(files, key=lambda item: (-item[1], item[0]))[:10]],
            )
            # Oversized file payloads need no second 1+ GB TAR read to reject.
            if report["file_bytes"] <= SITE_LIMIT_BYTES:
                report["tar_bytes"] = _measure_tar_bytes(root_fd)
            with _open_root(root) as (current_fd, current_ancestors):
                if ancestors != current_ancestors or before != _snapshot(current_fd):
                    raise PayloadError("Payload changed during measurement; upload refused")
        if report["file_bytes"] > SITE_LIMIT_BYTES:
            raise PayloadError("Uncompressed site file bytes exceed the 1 GB Pages limit; "
                               "TAR measurement skipped")
        if report["tar_bytes"] > TAR_LIMIT_BYTES:
            raise PayloadError("Uncompressed Pages TAR exceeds the 1 GB supported limit")
        return {**report, "ok": True}
    except (PayloadError, OSError, subprocess.SubprocessError, RecursionError) as error:
        raise PayloadError(str(error), {**report, "ok": False, "error": str(error)}) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("root", help="Exact directory passed to upload-pages-artifact")
    args = parser.parse_args()
    try:
        report = check_payload(args.root)
    except PayloadError as error:
        print(json.dumps(error.report, indent=2, ensure_ascii=True))
        return 1
    print(json.dumps(report, indent=2, ensure_ascii=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
