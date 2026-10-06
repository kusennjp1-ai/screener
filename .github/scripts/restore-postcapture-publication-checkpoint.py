"""Restore only the digest-authenticated diagnostic physical Pages checkpoint.

Never evaluates code or decodes the logical tree. Production readers subsequently
recheck its complete physical/logical inventory and historical source authority.
"""
from pathlib import Path
import shutil
import stat
import sys
import tarfile
import zipfile


def restore(archive: Path, root: Path) -> None:
    root.mkdir()
    seen = set()
    total = 0
    with zipfile.ZipFile(archive) as source:
        members = source.infolist()
        if len(members) != 1 or members[0].filename != "artifact.tar" or stat.S_ISLNK(members[0].external_attr >> 16):
            raise ValueError("Unexpected checkpoint ZIP member")
        if members[0].file_size > 1_000_000_000:
            raise ValueError("Checkpoint TAR exceeds physical Pages bound")
        with source.open(members[0]) as stream, tarfile.open(fileobj=stream, mode="r|") as tar:
            for member in tar:
                name = member.name.removeprefix("./").rstrip("/")
                if not name or name == ".":
                    continue
                if name.startswith("/") or "\\" in name or ":" in name or any(ord(c) < 32 or ord(c) == 127 for c in name) or any(p in ("", ".", "..") for p in name.split("/")) or name in seen or not (member.isdir() or member.isfile()):
                    raise ValueError("Unsafe checkpoint TAR member")
                seen.add(name)
                total += member.size
                if total > 1_000_000_000 or len(seen) > 100_000:
                    raise ValueError("Checkpoint physical Pages inventory exceeds bound")
                destination = root / name
                if member.isdir():
                    destination.mkdir(parents=True, exist_ok=True)
                else:
                    destination.parent.mkdir(parents=True, exist_ok=True)
                    with tar.extractfile(member) as incoming, destination.open("xb") as outgoing:
                        shutil.copyfileobj(incoming, outgoing, 1024 * 1024)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        raise SystemExit("Usage: restore-postcapture-publication-checkpoint.py EXACT_ZIP NEW_ROOT")
    restore(Path(sys.argv[1]), Path(sys.argv[2]))
