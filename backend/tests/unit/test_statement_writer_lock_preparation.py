"""New reconstruction regression: reserve the lock before freezing retention."""
import os
from pathlib import Path
import stat

import pytest

from app.services import statement_artifact_archive as archive
from tests.unit.test_financial_statement_batch import NOW, plan_for


def test_prepared_lock_is_empty_single_link_and_keeps_identity_across_commit(tmp_path):
    root = tmp_path / "archive"
    root.mkdir()
    archive.prepare_writer_lock(root)
    path = root / ".archive.lock"
    before = path.stat()
    assert stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and path.read_bytes() == b""
    archive.prepare_writer_lock(root)
    plan, base = plan_for(("AAA",))
    digest = archive.create_archive(root, base_bytes=base, cohort=plan["verified_us_cohort"], now=NOW)
    assert (path.stat().st_dev, path.stat().st_ino) == (before.st_dev, before.st_ino)
    assert path.read_bytes() == b"" and len(digest) == 64
    retained = (root / "manifest.json").read_bytes()
    archive.prepare_writer_lock(root)
    assert (root / "manifest.json").read_bytes() == retained


@pytest.mark.parametrize("kind", ["symlink", "hardlink", "nonempty", "directory", "fifo"])
def test_lock_rejects_unsafe_existing_control_without_rewriting_source(tmp_path, kind):
    root = tmp_path / "archive"
    root.mkdir()
    source = root / "manifest.json"
    source.write_bytes(b"immutable source sentinel")
    path = root / ".archive.lock"
    if kind == "symlink": path.symlink_to(source)
    elif kind == "hardlink": os.link(source, path)
    elif kind == "nonempty": path.write_bytes(b"original lock data")
    elif kind == "directory": path.mkdir()
    elif kind == "fifo": os.mkfifo(path)
    with pytest.raises((archive.InvalidArchive, OSError)): archive.prepare_writer_lock(root)
    assert source.read_bytes() == b"immutable source sentinel"
    if kind == "nonempty": assert path.read_bytes() == b"original lock data"


def test_preparation_rejects_missing_or_linked_archive_directory(tmp_path):
    with pytest.raises(archive.InvalidArchive): archive.prepare_writer_lock(tmp_path / "missing")
    alias = tmp_path / "alias"
    alias.symlink_to(tmp_path, target_is_directory=True)
    with pytest.raises(archive.InvalidArchive): archive.prepare_writer_lock(alias)


def test_open_lock_cannot_be_substituted_before_writer_commit(tmp_path):
    archive.prepare_writer_lock(tmp_path)
    path = tmp_path / ".archive.lock"
    with archive._open_writer_lock(tmp_path) as descriptor:
        path.rename(tmp_path / "previous-lock")
        path.write_bytes(b"")
        with pytest.raises(archive.InvalidArchive, match="same empty regular"):
            archive._checked_writer_lock(path, descriptor.fileno())
