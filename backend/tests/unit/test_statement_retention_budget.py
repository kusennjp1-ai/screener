"""One-visit retention bounds and genuine offline collector stop behavior."""
import hashlib
import os
from pathlib import Path
import shutil
from unittest.mock import patch

import pytest

from app.services import financial_statement_batch as batch
from app.services import statement_artifact_archive as archive
from app.services import statement_retention_budget as retention
from tests.unit import test_financial_statement_batch as fixtures


@pytest.fixture
def collector():
    harness = fixtures.TestFinancialStatementBatch(methodName="runTest")
    harness.setUp()
    try:
        yield harness
    finally:
        harness.doCleanups()


def budget_tree(tmp_path):
    root = tmp_path / "output"
    (root / "archive").mkdir(parents=True)
    (root / "archive/manifest.json").write_bytes(b'{"fixture":true}\n')
    return root, retention.StatementRetentionBudget(root)


def test_exact_known_compression_and_future_bound_are_independent(tmp_path):
    root, guard = budget_tree(tmp_path)
    (root / "original").write_bytes(b"original clock remains unchanged\n" * 10000)
    initial = guard.check("initial")
    assert initial["compressed_bound_bytes"] < initial["expanded_bytes"]
    assert initial["reserved_compressed_bytes"] > 50 * 1024 * 1024
    original = (root / "original").read_bytes()
    result = guard.verify_final()
    assert result["canonical_zip_bytes"] <= result["compressed_bound_bytes"]
    assert result["actual_actions_artifact_readback_required"] is True
    assert (root / "original").read_bytes() == original
    assert not list(tmp_path.glob("statement-package-*"))


def test_incompressible_growth_stops_before_existing_package_caps(tmp_path, monkeypatch):
    root, guard = budget_tree(tmp_path)
    before = guard.check("initial")
    monkeypatch.setattr(retention, "ZIP_COMPRESSED_LIMIT",
                        before["compressed_bound_bytes"] + before["reserved_compressed_bytes"] + 1000)
    (root / "batch").mkdir()
    (root / "batch/raw.bin").write_bytes(os.urandom(4096))
    with pytest.raises(retention.RetentionBudgetExceeded) as error:
        guard.check("transport")
    assert error.value.report["compressed_headroom_bytes"] < 0
    assert (root / "batch/raw.bin").stat().st_size == 4096


@pytest.mark.parametrize("limit,key", [("ZIP_EXPANDED_LIMIT", "expanded_bytes"),
                                      ("ZIP_FILE_LIMIT", "member_count"),
                                      ("ZIP_MEMBER_LIMIT", "maximum_member_bytes")])
def test_each_physical_package_cap_is_enforced(tmp_path, monkeypatch, limit, key):
    _, guard = budget_tree(tmp_path)
    measured = guard.snapshot()
    monkeypatch.setattr(retention, limit, measured[key] - 1)
    with pytest.raises(retention.RetentionBudgetExceeded):
        guard.check("getter")
    with pytest.raises(retention.RetentionBudgetExceeded):
        guard.verify_final()


@pytest.mark.parametrize("kind", ["symlink", "hardlink", "fifo", "long_path"])
def test_link_special_and_unbounded_path_rejected(tmp_path, kind):
    root, guard = budget_tree(tmp_path)
    path = root / "unsafe"
    if kind == "symlink":
        path.symlink_to(root / "archive/manifest.json")
    elif kind == "hardlink":
        os.link(root / "archive/manifest.json", path)
    elif kind == "fifo":
        os.mkfifo(path)
    else:
        path = root / ("a" * 200) / ("b" * 200) / ("c" * 200)
        path.parent.mkdir(parents=True)
        path.write_bytes(b"x")
    with pytest.raises(retention.RetentionIntegrityError):
        guard.check("initial")


def test_changed_bytes_between_measurement_and_zip_fail_readback(tmp_path, monkeypatch):
    root, guard = budget_tree(tmp_path)
    original = retention.zipfile.ZipFile.write
    def changed(writer, filename, *args, **kwargs):
        Path(filename).write_bytes(b"rewritten")
        return original(writer, filename, *args, **kwargs)
    monkeypatch.setattr(retention.zipfile.ZipFile, "write", changed)
    with pytest.raises(retention.RetentionIntegrityError, match="changed original bytes"):
        guard.verify_final()


class StopAt:
    """Test-only direct dependency. There is no CLI or environment bypass."""
    def __init__(self, stage, ordinal=1):
        self.stage, self.ordinal, self.seen = stage, ordinal, 0
    def check(self, stage):
        if stage == self.stage:
            self.seen += 1
            if self.seen >= self.ordinal:
                raise retention.RetentionBudgetExceeded({"stage": stage, "compressed_headroom_bytes": -1})


def test_initial_budget_rejection_constructs_no_provider(collector):
    with pytest.raises(retention.RetentionBudgetExceeded):
        collector.run_batch(retention_guard=StopAt("initial"))
    assert collector.calls == collector.tickers == []
    assert not collector.output.exists()


def test_initial_measurement_is_charged_to_collector_deadline(collector, monkeypatch):
    clock = [100.0]
    monkeypatch.setattr(batch.time, "monotonic", lambda: clock[0])
    class SlowGuard:
        def check(self, stage):
            if stage == "initial":
                clock[0] += 11
    summary, code = collector.run_batch(retention_guard=SlowGuard(), acquisition_budget_seconds=10)
    assert code == 4
    assert summary["execution_stop"]["budget"] == "wall_time"
    assert collector.calls == collector.tickers == []


@pytest.mark.parametrize("stage,ordinal,expected_calls,expected_getters", [
    ("getter", 1, 0, 0), ("getter", 2, 1, 1),
    ("transport", 2, 1, 2), ("result", 1, 2, 2)])
def test_retention_stop_preserves_real_attempts_and_full_selected_result_set(
        collector, stage, ordinal, expected_calls, expected_getters):
    collector.plan, collector.base = fixtures.plan_for(tuple(f"S{i}" for i in range(200)))
    summary, code = collector.run_batch(retention_guard=StopAt(stage, ordinal))
    assert code == 4
    assert summary["provider_stop"] is None
    assert summary["execution_stop"]["budget"] == "retention"
    assert summary["statement_getter_calls"] == expected_getters
    assert len(collector.calls) == expected_calls
    assert set(summary["results"]) == set(collector.plan["batch_allowlist"])
    journal = fixtures.read(collector.output / "attempts.json")
    assert len(journal["attempts"]) == expected_getters
    assert all(item["outcome"] != "in_flight" for item in journal["attempts"])
    assert all(path.stat().st_size <= retention.STOPPED_PROJECTION_LIMIT
               for path in (collector.output / "results").glob("*.json"))
    assert len(list((collector.output / "envelopes").glob("*.json"))) == 200
    assert all(fixtures.read(path)["status"] in {"captured", "unverified_or_unavailable"}
               for path in (collector.output / "results").glob("*.json"))
    for item in journal["attempts"]:
        assert (collector.output / item["acquisition_file"]).is_file()
    # A stopped complete summary must remain importable without invented work.
    root = collector.root / "archive"
    sha = archive.create_archive(root, base_bytes=collector.base,
                                 cohort=collector.plan["verified_us_cohort"], now=collector.now)
    updated = archive.merge_batch(root, sha, batch_dir=collector.output,
        summary_sha256=batch.digest_bytes((collector.output / "summary.json").read_bytes()),
        base_bytes=collector.base, cohort=collector.plan["verified_us_cohort"], now=collector.now)
    loaded = archive.load_archive(root, updated, base_bytes=collector.base,
                                 cohort=collector.plan["verified_us_cohort"], now=collector.now)
    assert len(loaded.manifest["attempts"]) == expected_getters


@pytest.mark.parametrize("status", [403, 429])
def test_provider_barrier_remains_distinct_from_retention(collector, status):
    collector.reply = lambda *_: (status, {"error": "blocked"})
    summary, code = collector.run_batch(retention_guard=StopAt("getter", 999))
    assert code == 2
    assert summary["execution_stop"] is None
    assert summary["provider_stop"]["http_status"] == status
    assert len(collector.calls) == 1


def test_manifest_reservation_failure_is_atomic_and_preserves_batch(collector):
    root = collector.root / "archive"
    sha = archive.create_archive(root, base_bytes=collector.base,
                                 cohort=collector.plan["verified_us_cohort"], now=collector.now)
    summary, code = collector.run_batch()
    assert code == 0
    def snapshot(path):
        return {item.relative_to(path).as_posix(): hashlib.sha256(item.read_bytes()).hexdigest()
                for item in path.rglob("*") if item.is_file()}
    prior, partial = snapshot(root), snapshot(collector.output)
    with pytest.raises(archive.InvalidArchive, match="reservation exhausted"):
        archive.merge_batch(root, sha, batch_dir=collector.output,
            summary_sha256=batch.digest_bytes((collector.output / "summary.json").read_bytes()),
            base_bytes=collector.base, cohort=collector.plan["verified_us_cohort"], now=collector.now,
            maximum_manifest_bytes=(root / "manifest.json").stat().st_size)
    assert snapshot(root) == prior
    assert snapshot(collector.output) == partial


@pytest.mark.parametrize("mutation", ["delete", "rename", "rewrite", "manifest", "cycle", "extra", "directory"])
def test_warm_inventory_preserves_every_original_member(tmp_path, mutation):
    root, guard = budget_tree(tmp_path)
    original = root / "original.json"
    original.write_bytes(b"original")
    (root / "cycle.json").write_bytes(b"prepared")
    guard.check("initial")
    if mutation == "delete":
        original.unlink()
    elif mutation == "rename":
        original.rename(root / "renamed.json")
    elif mutation == "rewrite":
        original.write_bytes(b"rewritte")
    elif mutation == "manifest":
        (root / "archive/manifest.json").write_bytes(b"changed")
    elif mutation == "cycle":
        (root / "cycle.json").write_bytes(b"changed")
    elif mutation == "directory":
        (root / "unowned").mkdir()
    else:
        (root / "unowned.json").write_bytes(b"extra")
    with pytest.raises(retention.RetentionIntegrityError):
        guard.check("transport")
    # An integrity failure remains fatal even if the caller restores the bytes.
    original.write_bytes(b"original")
    with pytest.raises(retention.RetentionIntegrityError):
        guard.before_merge()


@pytest.mark.parametrize("mutation", ["root", "parent_symlink", "hardlink", "fifo"])
def test_warm_inventory_checks_root_parent_and_link_identity(tmp_path, mutation):
    root, guard = budget_tree(tmp_path)
    guard.check("initial")
    if mutation == "root":
        root.rename(tmp_path / "old-root")
        shutil.copytree(tmp_path / "old-root", root)
    elif mutation == "parent_symlink":
        (root / "archive").rename(root / "retained-archive")
        (root / "archive").symlink_to(root / "retained-archive", target_is_directory=True)
    elif mutation == "hardlink":
        os.link(root / "archive/manifest.json", tmp_path / "outside-hardlink")
    else:
        os.mkfifo(root / "unsafe")
    with pytest.raises(retention.RetentionIntegrityError):
        guard.check("getter")


def test_before_merge_forces_hashing_even_with_poisoned_signature_cache(tmp_path):
    root, guard = budget_tree(tmp_path)
    guard.check("initial")
    path = root / "archive/manifest.json"
    original = guard.cache['archive/manifest.json']
    path.write_bytes(b"changed")
    info = path.stat()
    signature = (info.st_dev, info.st_ino, info.st_size, info.st_mtime_ns, info.st_ctime_ns)
    guard.cache['archive/manifest.json'] = retention.FileMeasure(signature, original.size, original.compressed, original.sha256)
    with pytest.raises(retention.RetentionIntegrityError, match="bytes changed"):
        guard.before_merge()


@pytest.mark.parametrize("mutation", ["add", "delete", "replace"])
def test_full_post_zip_inventory_detects_members_changed_after_packaging(tmp_path, monkeypatch, mutation):
    root, guard = budget_tree(tmp_path)
    target = root / "original"
    target.write_bytes(b"original")
    guard.check("initial")
    testzip = retention.zipfile.ZipFile.testzip
    def changed(reader):
        result = testzip(reader)
        if mutation == "add":
            (root / "batch").mkdir()
            (root / "batch/new.json").write_bytes(b"new")
        elif mutation == "delete":
            target.unlink()
        else:
            content = target.read_bytes()
            target.unlink()
            target.write_bytes(content)
        return result
    monkeypatch.setattr(retention.zipfile.ZipFile, 'testzip', changed)
    with pytest.raises(retention.RetentionIntegrityError):
        guard.verify_final()


def test_real_collector_merge_and_final_exact_metadata_binding(collector):
    collector.output = collector.root / 'batch'
    cohort = collector.plan['verified_us_cohort']
    root = collector.root / 'archive'
    sha = archive.create_archive(root, base_bytes=collector.base, cohort=cohort, now=collector.now)
    cycle = collector.root / 'cycle.json'
    cycle.write_bytes(b'prepared')
    guard = retention.StatementRetentionBudget(collector.root)
    guard.check('initial')
    summary, code = collector.run_batch(retention_guard=guard)
    assert code == 0
    guard.before_merge()
    sha = archive.merge_batch(root, sha, batch_dir=collector.output,
        summary_sha256=batch.digest_bytes((collector.output / 'summary.json').read_bytes()),
        base_bytes=collector.base, cohort=cohort, now=collector.now,
        maximum_manifest_bytes=guard.maximum_manifest_bytes)
    cycle.write_bytes(b'completed')
    with pytest.raises(retention.RetentionIntegrityError, match='not bound'):
        guard.verify_final()
    guard.authorize_finalization(archive_manifest_sha256=sha, cycle_sha256=batch.digest_bytes(cycle.read_bytes()),
                                 archive_object_sha256s=fixtures.read(root / 'manifest.json')['objects'])
    assert guard.verify_final()['canonical_zip_bytes'] > 0
    cycle.write_bytes(b'changed')
    with pytest.raises(retention.RetentionIntegrityError, match='authorized replacement'):
        guard.verify_final()


@pytest.mark.parametrize('stage,ordinal,calls', [('getter',2,1), ('transport',2,1), ('result',1,2)])
def test_transient_integrity_failure_cannot_be_swallowed_into_more_provider_work(collector, stage, ordinal, calls):
    collector.output = collector.root / 'batch'
    (collector.root / 'archive').mkdir()
    original = collector.root / 'archive/manifest.json'
    original.write_bytes(b'original')
    class MutatedGuard(retention.StatementRetentionBudget):
        seen = 0
        def check(self, current):
            if current == stage:
                self.seen += 1
                if self.seen == ordinal:
                    original.write_bytes(b'changed')
            try:
                return super().check(current)
            except retention.RetentionIntegrityError:
                original.write_bytes(b'original')
                raise
    guard = MutatedGuard(collector.root)
    with pytest.raises(retention.RetentionIntegrityError):
        collector.run_batch(retention_guard=guard)
    assert len(collector.calls) == calls
    assert not (collector.output / 'summary.json').exists()


@pytest.mark.parametrize('limit,key', [('ZIP_FILE_LIMIT','member_count'),
                                      ('ZIP_EXPANDED_LIMIT','expanded_bytes'),
                                      ('ZIP_COMPRESSED_LIMIT','compressed_bound_bytes'),
                                      ('ZIP_MEMBER_LIMIT','maximum_member_bytes')])
def test_before_merge_enforces_all_caps_before_changing_phase(tmp_path, monkeypatch, limit, key):
    _, guard = budget_tree(tmp_path)
    guard.check('initial')
    measured = guard.snapshot()
    monkeypatch.setattr(retention, limit, measured[key] - 1)
    with pytest.raises(retention.RetentionBudgetExceeded):
        guard.before_merge()
    assert guard.phase == 'acquisition'


def test_before_merge_reserves_finalization_without_another_provider_step(tmp_path, monkeypatch):
    _, guard = budget_tree(tmp_path)
    original = guard.check('initial')
    # The next getter cannot fit, but completed evidence and immutable merge can.
    monkeypatch.setattr(retention, 'ZIP_COMPRESSED_LIMIT',
                        original['compressed_bound_bytes'] + original['reserved_compressed_bytes'] - 1)
    with pytest.raises(retention.RetentionBudgetExceeded):
        guard.check('getter')
    guard.before_merge()
    assert guard.phase == 'finalization'
    assert guard.last_report['stage'] == 'before_merge'
    assert guard.last_report['compressed_headroom_bytes'] > 0


@pytest.mark.parametrize('attack', ['orphan','wrong_bytes','extra_manifest','missing_object','missing_manifest'])
def test_final_archive_additions_bind_validated_inventory_and_actual_digests(tmp_path, attack):
    root, guard = budget_tree(tmp_path)
    cycle = root / 'cycle.json'
    cycle.write_bytes(b'prepared')
    guard.check('initial')
    guard.before_merge()
    objects = root / 'archive/objects'
    objects.mkdir()
    manifests = root / 'archive/manifests'
    manifests.mkdir()
    manifest_bytes = (root / 'archive/manifest.json').read_bytes()
    if attack != 'missing_manifest':
        (manifests / f'{hashlib.sha256(manifest_bytes).hexdigest()}.json').write_bytes(manifest_bytes)
    expected = hashlib.sha256(b'expected').hexdigest()
    allowed = []
    if attack == 'orphan':
        (objects / f"{'0'*64}.json").write_bytes(b'arbitrary orphan bytes')
    elif attack == 'wrong_bytes':
        allowed = [expected]
        (objects / f'{expected}.json').write_bytes(b'wrong bytes')
    elif attack == 'missing_object':
        allowed = [expected]
    elif attack == 'extra_manifest':
        (manifests / f'{expected}.json').write_bytes(b'expected')
    guard.authorize_finalization(
        archive_manifest_sha256=hashlib.sha256((root/'archive/manifest.json').read_bytes()).hexdigest(),
        cycle_sha256=hashlib.sha256(cycle.read_bytes()).hexdigest(), archive_object_sha256s=allowed)
    with pytest.raises(retention.RetentionIntegrityError):
        guard.verify_final()


def test_finalization_keeps_original_unindexed_crash_objects_without_granting_new_ones(tmp_path):
    root, guard = budget_tree(tmp_path)
    objects, manifests = root / 'archive/objects', root / 'archive/manifests'
    objects.mkdir()
    manifests.mkdir()
    original = b'original crash evidence'
    path = objects / f'{hashlib.sha256(original).hexdigest()}.json'
    path.write_bytes(original)
    manifest = (root / 'archive/manifest.json').read_bytes()
    manifest_sha = hashlib.sha256(manifest).hexdigest()
    (manifests / f'{manifest_sha}.json').write_bytes(manifest)
    (root / 'cycle.json').write_bytes(b'prepared')
    guard.check('initial')
    guard.before_merge()
    guard.authorize_finalization(archive_manifest_sha256=manifest_sha,
        cycle_sha256=hashlib.sha256(b'prepared').hexdigest(), archive_object_sha256s=[])
    assert guard.verify_final()['canonical_zip_bytes'] > 0
    assert path.read_bytes() == original
    unowned = b'new orphan'
    (objects / f'{hashlib.sha256(unowned).hexdigest()}.json').write_bytes(unowned)
    with pytest.raises(retention.RetentionIntegrityError):
        guard.verify_final()
