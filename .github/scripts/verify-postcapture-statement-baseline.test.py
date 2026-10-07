"""New bounded synthetic boundary tests; never evidence of real acquisition."""
from copy import deepcopy
from datetime import datetime, timezone
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import zipfile

import pytest

PATH = Path(__file__).with_name("verify-postcapture-statement-baseline.py")
spec = importlib.util.spec_from_file_location("new_baseline_reader", PATH)
reader = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reader)
ENTRY = reader.parse((PATH.parent / "fixtures/postcapture-restore-review.fixture.json").read_bytes())


@pytest.fixture(autouse=True)
def deny_network(monkeypatch):
    def forbidden(*args, **kwargs):
        raise AssertionError("Network forbidden in baseline tests")
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket.socket, "connect_ex", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)


def enabled():
    return {**deepcopy(reader.POLICY), "restore_enabled": True, "reviewed_requests": [deepcopy(ENTRY)]}


def source_fixture(tmp_path, entries=None):
    """Small arbitrary byte fixture for the inventory helper, not admission."""
    entries = [("archive/objects/journal.json", b'{"attempts":[]}'), ("base.json", b'{"fixture":true}')] if entries is None else entries
    root = tmp_path / "source"
    root.mkdir()
    path = tmp_path / "source.zip"
    files = {}
    with zipfile.ZipFile(path, "w") as zipped:
        for name, raw in entries:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(raw)
            zipped.writestr(name, raw)
            files[name] = {"bytes": len(raw), "sha256": reader.sha(raw)}
    inventory = {"schema_version": "postcapture-artifact-inventory-v1", "artifact_sha256": reader.sha(path.read_bytes()),
                 "expanded_bytes": sum(x["bytes"] for x in files.values()), "files": files, "member_count": len(files)}
    return path, root, inventory


def test_reconstructed_policy_preserves_disabled_exact_historical_identity():
    assert reader.POLICY["restore_enabled"] is False
    assert reader.POLICY["reviewed_requests"] == []
    assert reader.SOURCE == reader.REQUEST["source"] == ENTRY["source"]
    assert reader.REFERENCE == ENTRY["reference"]
    assert reader.admitted_policy(enabled()) == ENTRY
    assert ENTRY == reader.companion.select_review(reader.REFERENCE["receipt_sha256"])


@pytest.mark.parametrize("change", [
    lambda p: p.update(restore_enabled=False), lambda p: p.update(restore_enabled=1),
    lambda p: p.update(reviewed_requests=[]), lambda p: p["reviewed_requests"].append(deepcopy(ENTRY)),
    lambda p: p.update(allow_failure=True), lambda p: p.update(authority="publication"),
    lambda p: p.update(maximum_source_zip_bytes=2**31), lambda p: p.update(companion_zip_bytes=1),
    lambda p: p["source"].update(run_id=1), lambda p: p["companion_reference"].update(job_id=1),
    lambda p: p["reviewed_requests"][0].update(tree_sha="0"*40),
    lambda p: p["reviewed_requests"][0]["code_manifest"].pop(next(iter(p["reviewed_requests"][0]["code_manifest"]))),
])
def test_policy_cannot_expand_scope_admit_another_review_or_use_environment(change, monkeypatch):
    monkeypatch.setenv("RESTORE_ENABLED", "true")
    monkeypatch.setenv("EXECUTION_ENABLED", "true")
    value = enabled()
    change(value)
    with pytest.raises(ValueError):
        reader.admitted_policy(value)


def test_default_disabled_before_paths_or_network():
    with pytest.raises(ValueError, match="disabled or not independently admitted"):
        reader.verify_baseline("missing", "missing", "missing")


def test_exact_companion_identity_fails_before_source_inspection(tmp_path):
    path = tmp_path / "companion.zip"
    path.write_bytes(b"synthetic invalid companion")
    with pytest.raises(ValueError, match="Exact companion ZIP length/hash mismatch"):
        reader.verify_baseline("missing-source", "missing-directory", path, policy=enabled())


def test_inventory_helper_accepts_exact_arbitrary_fixture_without_authority(tmp_path):
    args = source_fixture(tmp_path)
    assert reader.verify_source_members(*args, reader.POLICY) is None


@pytest.mark.parametrize("mutation", ["changed", "deleted", "extra", "extra_directory", "symlink", "hardlink", "parent_symlink"])
def test_complete_extracted_inventory_rejects_mutation(tmp_path, mutation):
    zipped, root, inventory = source_fixture(tmp_path)
    target = root / "archive/objects/journal.json"
    if mutation == "changed": target.write_bytes(b"x" * target.stat().st_size)
    elif mutation == "deleted": target.unlink()
    elif mutation == "extra": (root / "extra").write_bytes(b"")
    elif mutation == "extra_directory": (root / "extra").mkdir()
    elif mutation == "symlink":
        target.unlink()
        target.symlink_to(root / "base.json")
    elif mutation == "hardlink": os.link(target, tmp_path / "hardlink")
    elif mutation == "parent_symlink":
        alias = tmp_path / "alias"
        alias.symlink_to(root, target_is_directory=True)
        root = alias
    with pytest.raises(ValueError): reader.verify_source_members(zipped, root, inventory, reader.POLICY)


@pytest.mark.parametrize("mutation", ["duplicate", "traversal", "absolute", "backslash", "extra", "missing", "bytes", "special"])
def test_zip_rejects_mutation_even_if_outer_fixture_hash_is_rebound(tmp_path, mutation):
    zipped, root, inventory = source_fixture(tmp_path)
    entries = [(name, (root / name).read_bytes()) for name in inventory["files"]]
    if mutation == "duplicate": entries.append(entries[0])
    elif mutation == "traversal": entries.append(("../outside", b""))
    elif mutation == "absolute": entries.append(("/absolute", b""))
    elif mutation == "backslash": entries.append(("a\\b", b""))
    elif mutation == "extra": entries.append(("extra", b""))
    elif mutation == "missing": entries.pop()
    elif mutation == "bytes": entries[0] = (entries[0][0], b"x"*len(entries[0][1]))
    with zipfile.ZipFile(zipped, "w") as archive:
        for index, (name, raw) in enumerate(entries):
            info = zipfile.ZipInfo(name)
            if mutation == "special" and index == 0:
                info.create_system = 3
                info.external_attr = 0o120777 << 16
            archive.writestr(info, raw)
    inventory["artifact_sha256"] = reader.sha(zipped.read_bytes())
    with pytest.raises(ValueError): reader.verify_source_members(zipped, root, inventory, reader.POLICY)


@pytest.mark.parametrize("change", [
    lambda i: i.update(member_count=30001), lambda i: i.update(expanded_bytes=1),
    lambda i: i["files"]["base.json"].update(bytes=33554433),
    lambda i: i["files"]["base.json"].update(sha256="bad"),
    lambda i: i["files"].update({"../outside": {"bytes": 0, "sha256": "0"*64}}),
    lambda i: i.update(trust_override=True),
])
def test_inventory_bounds_are_closed(tmp_path, change):
    zipped, root, inventory = source_fixture(tmp_path)
    change(inventory)
    with pytest.raises(ValueError): reader.verify_source_members(zipped, root, inventory, reader.POLICY)


def test_budget_checked_during_scan_and_member_read(tmp_path):
    args = source_fixture(tmp_path)
    calls = []
    def deadline():
        calls.append(1)
        if len(calls) == 4: raise ValueError("test deadline")
    with pytest.raises(ValueError, match="test deadline"): reader.verify_source_members(*args, reader.POLICY, deadline)
    assert len(calls) == 4


def test_cli_cannot_enable_policy_or_choose_review(tmp_path):
    result = subprocess.run([sys.executable, str(PATH), "source", "files", "companion", "--policy", "enabled.json"],
                            capture_output=True, text=True, timeout=20)
    assert result.returncode != 0 and "Usage:" in result.stderr
    result = subprocess.run([sys.executable, str(PATH), "source", "files", "companion"],
                            capture_output=True, text=True, timeout=20)
    assert result.returncode != 0 and "disabled or not independently admitted" in result.stderr
