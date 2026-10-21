"""Synthetic CI integration; no provider, GitHub artifact or database I/O."""
from contextlib import nullcontext
import hashlib
import json
from pathlib import Path
import socket
import subprocess
import sys
from types import SimpleNamespace

import pytest

from app.scripts import export_static_site as export
from app.scripts import sync_daily_price_bundle_from_github as sync
from app.scripts import price_diagnostic_summary as diagnostic
from app.services.cache.price_history_diagnostics import observe, observe_input


@pytest.fixture
def ci(monkeypatch, tmp_path):
    env = {
        "GITHUB_ACTIONS": "true", "GITHUB_REPOSITORY": "kusennjp1-ai/screener",
        "GITHUB_WORKFLOW_REF": "kusennjp1-ai/screener/.github/workflows/static-site.yml@refs/heads/main",
        "GITHUB_SHA": "b" * 40, "GITHUB_WORKFLOW_SHA": "b" * 40,
        "GITHUB_REF": "refs/heads/main", "GITHUB_JOB": "build-market",
        "GITHUB_EVENT_NAME": "schedule", "GITHUB_RUN_ID": "123", "GITHUB_RUN_ATTEMPT": "2",
        "RUNNER_TEMP": str(tmp_path / "runner"),
    }
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setattr(diagnostic.subprocess, "run", lambda *_a, **_kw: SimpleNamespace(stdout="b" * 40 + "\n"))
    def forbidden(*_args, **_kwargs):
        pytest.fail("CI diagnostic test attempted network I/O")
    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(sync, "prepare_runtime", lambda: None)
    monkeypatch.setattr(export, "prepare_runtime", lambda: None)
    return diagnostic.static_ci_context("US"), tmp_path / "public"


@pytest.mark.parametrize("event", ["schedule", "workflow_dispatch"])
def test_context_is_observation_only_bound_to_actual_checkout_and_attempt(ci, monkeypatch, event):
    monkeypatch.setenv("GITHUB_EVENT_NAME", event)
    context = diagnostic.static_ci_context("US")
    assert context == ci[0]
    assert context.run_id == "kusennjp1-ai/screener:123:2:US:" + "b" * 40
    monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "3")
    assert diagnostic.static_ci_context("US").run_id != context.run_id
    assert diagnostic.static_ci_context("HK") is None
    assert diagnostic.static_ci_context(None) is None


@pytest.mark.parametrize("key,value", [
    ("GITHUB_ACTIONS", "false"), ("GITHUB_REPOSITORY", "fork/screener"),
    ("GITHUB_WORKFLOW_REF", "kusennjp1-ai/screener/.github/workflows/ci.yml@refs/heads/main"),
    ("GITHUB_REF", "refs/pull/99/merge"), ("GITHUB_JOB", "combine"),
    ("GITHUB_EVENT_NAME", "workflow_run"), ("GITHUB_EVENT_NAME", "pull_request"),
    ("GITHUB_RUN_ID", "01"), ("GITHUB_RUN_ATTEMPT", "0"),
    ("GITHUB_SHA", "a" * 40), ("GITHUB_WORKFLOW_SHA", "a" * 40),
    ("RUNNER_TEMP", "relative"), ("RUNNER_TEMP", "/tmp/static-data/private"),
    ("RUNNER_TEMP", "/tmp/daily-price-promotion/private"),
    ("RUNNER_TEMP", "/tmp/daily-price/private"), ("RUNNER_TEMP", "/tmp/feature-run-out/private"),
    ("RUNNER_TEMP", str(Path(__file__).resolve().parents[3] / "private")),
])
def test_unrelated_or_unbound_context_has_no_automatic_diagnostics(ci, monkeypatch, key, value):
    monkeypatch.setenv(key, value)
    assert diagnostic.static_ci_context("US") is None
    assert not ci[0].root.exists()


@pytest.mark.parametrize("error", [OSError("git unavailable"), subprocess.TimeoutExpired("git", 5)])
def test_context_setup_failure_is_not_product_failure(ci, monkeypatch, error):
    def fail(*_args, **_kwargs):
        raise error
    monkeypatch.setattr(diagnostic.subprocess, "run", fail)
    assert diagnostic.static_ci_context("US") is None


def test_private_tree_must_not_overlap_export_or_a_linked_public_target(ci, monkeypatch):
    context, public = ci
    assert diagnostic.static_ci_context("US", output_dir=context.root.parent) is None
    public.mkdir()
    context.root.parent.mkdir()
    context.root.symlink_to(public, target_is_directory=True)
    assert diagnostic.static_ci_context("US", output_dir=public) is None


@pytest.mark.parametrize("link", ["root", "temporary", "ancestor"])
def test_private_path_cannot_follow_links_to_any_location_including_uploaded_candidate(ci, monkeypatch, tmp_path, link):
    context, _ = ci
    target = Path("/tmp/daily-price-promotion")
    if link == "root":
        context.root.parent.mkdir()
        context.root.symlink_to(target, target_is_directory=True)
    elif link == "temporary":
        context.root.parent.symlink_to(target, target_is_directory=True)
    else:
        (tmp_path / "linked").symlink_to(tmp_path / "real", target_is_directory=True)
        monkeypatch.setenv("RUNNER_TEMP", str(tmp_path / "linked/runner"))
    assert diagnostic.static_ci_context("US") is None


@pytest.mark.parametrize("target", ["private_root", "private_ancestor"])
def test_uploaded_root_alias_to_private_tree_is_also_rejected(ci, monkeypatch, target):
    # Model a fixed upload root resolving to the private tree without editing
    # the runner's real /tmp release paths from a local test.
    context, _ = ci
    original_resolve = Path.resolve
    def resolve(path, *args, **kwargs):
        if str(path) == "/tmp/daily-price-promotion":
            return context.root if target == "private_root" else context.root.parent
        return original_resolve(path, *args, **kwargs)
    monkeypatch.setattr(Path, "resolve", resolve)
    assert diagnostic.static_ci_context("US") is None


@pytest.mark.parametrize("binding", ["verified", "metadata", "wrong_hash", "other_attempt"])
def test_actual_seed_then_export_link_is_private_verified_same_attempt_and_product_invariant(ci, monkeypatch, tmp_path, capsys, binding):
    context, public = ci
    seed = tmp_path / "synthetic-seed.json"
    seed.write_text('{"market":"US","source_revision":"daily_prices_us:20261020010226","as_of_date":"2026-10-19","rows":[]}')
    digest = hashlib.sha256(seed.read_bytes()).hexdigest()
    calls = []
    def sync_from_github(db, *, market, warm_redis_symbols, allow_stale, observations):
        calls.append(("sync", market, warm_redis_symbols, allow_stale))
        observe_input(observations, seed, json.loads(seed.read_text()),
                      verified_sha256=digest if binding != "wrong_hash" else "a" * 64)
        if binding == "metadata":
            observations["input"]["hash_basis"] = "manifest_metadata"
        observe(observations, "db_commit", source="seed_import", status="committed", committed_rows=42)
        return {"status": "success"}
    monkeypatch.setattr(sync, "SessionLocal", lambda: nullcontext(None))
    monkeypatch.setattr(sync, "get_daily_price_bundle_service", lambda: SimpleNamespace(sync_from_github=sync_from_github))
    monkeypatch.setattr(sys, "argv", ["sync", "--market", "US", "--allow-stale"])
    assert sync.main() == 0
    assert context.path.is_file()
    assert not public.exists()
    if binding == "other_attempt":
        monkeypatch.setenv("GITHUB_RUN_ATTEMPT", "3")
    def refresh(*, market, observations):
        calls.append(("refresh", market))
        observe(observations, "refresh_fetch", symbol="PRIVATE_TRACE_MARKER", status="received")
        return {}
    class Export:
        def __init__(self, _factory, *, chart_omissions, pipeline_observations):
            self.omissions, self.trace = chart_omissions, pipeline_observations
        def export(self, output, **kwargs):
            calls.append(("export", kwargs))
            assert ("input" in self.trace) == (binding == "verified")
            assert any(e["stage"] == "db_commit" for e in self.trace["events"]) == (binding == "verified")
            destination = output / "markets/us/charts/index.json"
            destination.parent.mkdir(parents=True)
            destination.write_bytes(b'{"existing":"published bytes"}\n')
            self.omissions["US"] = {"MISSING": "incoherent_history"}
            return SimpleNamespace(output_dir=output, generated_at="2026-10-20T00:00:00Z", as_of_date="2026-10-19", warnings=())
    monkeypatch.setattr(export, "_run_prices_only_refresh", refresh)
    monkeypatch.setattr(export, "StaticSiteExportService", Export)
    monkeypatch.setattr(sys, "argv", ["export", "--market", "US", "--prices-only", "--output-dir", str(public)])
    assert export.main() == 0
    artifact = json.loads((public / "diagnostics/us/cache-only-chart-omissions.json").read_text())
    assert "pipeline_observations" not in artifact
    assert artifact["omissions"] == {"MISSING": "incoherent_history"}
    assert (public / "markets/us/charts/index.json").read_bytes() == b'{"existing":"published bytes"}\n'
    assert all(b"PRIVATE_TRACE_MARKER" not in path.read_bytes() for path in public.rglob("*.json"))
    current = diagnostic.static_ci_context("US")
    report, trace = diagnostic.read_trace(current.path, run_id=current.run_id, market="US")
    assert report["export_completed"] is True
    assert any(e.get("symbol") == "PRIVATE_TRACE_MARKER" for e in trace["events"])
    assert "PRIVATE_TRACE_MARKER" not in capsys.readouterr().out
    assert calls == [("sync", "US", None, True), ("refresh", "US"),
                     ("export", {"clean": True, "markets": ("US",), "write_manifest": False})]


@pytest.mark.parametrize("outcome", ["sync_error", "sync_rejected", "export_error", "interrupt", "skip78", "skip79"])
def test_automatic_observations_preserve_failures_and_export_skip_codes(ci, monkeypatch, outcome):
    context, public = ci
    failure = KeyboardInterrupt("original") if outcome == "interrupt" else RuntimeError("original")
    if outcome.startswith("sync"):
        monkeypatch.setattr(sync, "SessionLocal", lambda: nullcontext(None))
        def sync_call(*_args, observations, **_kwargs):
            observe(observations, "seed_sync", status="error")
            if outcome == "sync_error":
                raise failure
            return {"status": "checksum_mismatch"}
        monkeypatch.setattr(sync, "get_daily_price_bundle_service", lambda: SimpleNamespace(sync_from_github=sync_call))
        monkeypatch.setattr(sys, "argv", ["sync", "--market", "US"])
        call = sync.main
    else:
        class Export:
            def __init__(self, _factory, *, chart_omissions, pipeline_observations):
                pass
            def export(self, *_args, **_kwargs):
                if outcome == "skip79":
                    raise export.NoPublishedStaticMarketArtifact("no current feature run")
                raise failure
        monkeypatch.setattr(export, "StaticSiteExportService", Export)
        monkeypatch.setattr(export, "_run_prices_only_refresh", lambda **_kw: {})
        monkeypatch.setattr(export, "_run_daily_refresh", lambda **_kw: ({"feature_snapshots": {"US": {"status": "skipped", "reason": "not_trading_day"}}}, []))
        flags = ["--refresh-daily"] if outcome == "skip78" else ["--prices-only"]
        monkeypatch.setattr(sys, "argv", ["export", "--market", "US", "--output-dir", str(public), *flags])
        call = export.main
    if outcome in {"sync_error", "export_error", "interrupt"}:
        with pytest.raises(type(failure)) as raised:
            call()
        assert raised.value is failure
    else:
        assert call() == {"sync_rejected": 1, "skip78": 78, "skip79": 79}[outcome]
    assert json.loads(context.path.read_text())["export_completed"] is False
    if public.exists():
        assert "pipeline_observations" not in json.loads((public / "diagnostics/us/cache-only-chart-omissions.json").read_text())


def test_summary_log_failure_never_masks_original_outcome(ci, monkeypatch):
    def fail(*_args, **_kwargs):
        raise BrokenPipeError("private log error")
    monkeypatch.setattr("builtins.print", fail)
    assert diagnostic.log_private_trace(ci[0]) is None


def test_private_write_failure_does_not_mask_export_exception_or_add_public_pipeline(ci, monkeypatch, capsys):
    context, public = ci
    original_writer = export._write_chart_omission_diagnostics
    failure = RuntimeError("original export exception")
    def writer(output, *_args, **_kwargs):
        if output == context.root:
            raise OSError("private disk unavailable")
        return original_writer(output, *_args, **_kwargs)
    class Export:
        def __init__(self, *_args, **_kwargs):
            pass
        def export(self, *_args, **_kwargs):
            raise failure
    monkeypatch.setattr(export, "_write_chart_omission_diagnostics", writer)
    monkeypatch.setattr(export, "StaticSiteExportService", Export)
    monkeypatch.setattr(sys, "argv", ["export", "--market", "US", "--output-dir", str(public)])
    with pytest.raises(RuntimeError) as raised:
        export.main()
    assert raised.value is failure
    assert not context.path.exists()
    assert "pipeline_observations" not in json.loads((public / "diagnostics/us/cache-only-chart-omissions.json").read_text())
    output = capsys.readouterr().out
    assert "Price pipeline summary: unavailable_or_unbound" in output
    assert "private disk unavailable" not in output


def test_explicit_opt_in_keeps_its_existing_sidecar_route_in_ci(ci, monkeypatch):
    context, public = ci
    class Export:
        def __init__(self, *_args, pipeline_observations, **_kwargs):
            assert pipeline_observations["run_id"] == "manual-run"
        def export(self, output, **_kwargs):
            return SimpleNamespace(output_dir=output, generated_at="unchanged", as_of_date="unchanged", warnings=())
    monkeypatch.setattr(export, "StaticSiteExportService", Export)
    monkeypatch.setattr(sys, "argv", ["export", "--market", "US", "--output-dir", str(public),
                                     "--price-pipeline-diagnostics", "--price-diagnostic-run-id", "manual-run"])
    assert export.main() == 0
    assert not context.path.exists()
    assert json.loads((public / "diagnostics/us/cache-only-chart-omissions.json").read_text())["pipeline_observations"]["run_id"] == "manual-run"
