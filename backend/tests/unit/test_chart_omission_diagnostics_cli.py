"""CLI persistence stays outside published market assets and export decisions."""

import json
from pathlib import Path
import socket
import sys
import shutil
from types import SimpleNamespace

import pytest

import app.scripts.export_static_site as script
from app.services.static_site_export_service import StaticSiteExportService, STATIC_SITE_SCHEMA_VERSION
from app.services.cache.price_history_diagnostics import new_observations, observe, load_prior_observations


@pytest.fixture(autouse=True)
def no_external_io(monkeypatch):
    def forbidden(*_args, **_kwargs):
        pytest.fail("Diagnostic CLI test attempted network I/O")

    monkeypatch.setattr(socket.socket, "connect", forbidden)
    monkeypatch.setattr(socket, "create_connection", forbidden)
    monkeypatch.setattr(script, "prepare_runtime", lambda: None)


def _report_path(output, market="US"):
    return output / "diagnostics" / market.lower() / "cache-only-chart-omissions.json"


def _result(output):
    return SimpleNamespace(output_dir=output, generated_at="2026-10-14T00:00:00Z",
                           as_of_date="2026-10-13", warnings=(), manifest={})


def _argv(monkeypatch, output, *extra):
    monkeypatch.setattr(sys, "argv", ["export_static_site.py", "--output-dir", str(output), *extra])


def test_sidecar_is_scoped_has_fixed_counts_and_does_not_copy_other_market_data(tmp_path):
    reasons = {"US": {"A": "no_rows_in_window", "B": "insufficient_rows", "C": "insufficient_rows"},
               "HK": {"PRIVATE_OTHER_MARKET": "incoherent_history"}}
    path = script._write_chart_omission_diagnostics(tmp_path, "us", reasons, export_completed=True)
    payload = json.loads(path.read_text())
    assert path == _report_path(tmp_path)
    assert payload["schema_version"] == "cache-only-chart-omissions-v1"
    assert payload["market"] == "US"
    assert payload["chart_bundle_started"] is payload["export_completed"] is True
    assert payload["omissions"] == reasons["US"]
    assert payload["omitted_symbols_count"] == 3
    assert payload["counts_by_reason"] == {
        "no_rows_in_window": 1, "insufficient_rows": 2, "incoherent_history": 0,
        "bulk_read_error": 0, "no_serializable_bars": 0,
    }
    assert sum(payload["counts_by_reason"].values()) == payload["omitted_symbols_count"]
    assert "PRIVATE_OTHER_MARKET" not in path.read_text()
    assert payload["observed_at"].endswith("+00:00")
    assert not list(path.parent.glob("*.tmp"))


@pytest.mark.parametrize("reasons,started", [({}, False), ({"US": {}}, True)])
def test_empty_diagnostics_distinguish_unstarted_from_started_bundle(tmp_path, reasons, started):
    script._write_chart_omission_diagnostics(tmp_path, "US", reasons, export_completed=False)
    payload = json.loads(_report_path(tmp_path).read_text())
    assert payload["chart_bundle_started"] is started
    assert payload["export_completed"] is False
    assert payload["omitted_symbols_count"] == sum(payload["counts_by_reason"].values()) == 0


@pytest.mark.parametrize("market", ["../markets/us", "US/../../markets", "", "ZZ"])
def test_diagnostic_market_cannot_escape_its_directory(tmp_path, market):
    with pytest.raises(ValueError, match="Unsupported chart diagnostic market"):
        script._write_chart_omission_diagnostics(tmp_path, market, {}, export_completed=True)
    assert not list(tmp_path.iterdir())


def test_unknown_reason_cannot_leak_arbitrary_exception_text(tmp_path):
    with pytest.raises(ValueError, match="Unsupported chart omission reason"):
        script._write_chart_omission_diagnostics(
            tmp_path, "US", {"US": {"A": "connection details and secrets"}}, export_completed=False,
        )
    assert not list(tmp_path.iterdir())


@pytest.mark.parametrize("level", ["root", "market", "file"])
def test_diagnostic_symlink_cannot_write_into_published_assets(tmp_path, level):
    published = tmp_path / "markets" / "us"
    published.mkdir(parents=True)
    destination = published / "untouched.json"
    destination.write_text("untouched")
    report = _report_path(tmp_path)
    if level == "root":
        (tmp_path / "diagnostics").symlink_to(tmp_path / "markets", target_is_directory=True)
    elif level == "market":
        report.parent.parent.mkdir(parents=True)
        report.parent.symlink_to(published, target_is_directory=True)
    else:
        report.parent.mkdir(parents=True)
        report.symlink_to(destination)
    with pytest.raises(ValueError, match="must not be a symlink"):
        script._write_chart_omission_diagnostics(tmp_path, "US", {}, export_completed=False)
    assert {p.name: p.read_text() for p in published.iterdir()} == {"untouched.json": "untouched"}


@pytest.mark.parametrize("mode", [[], ["--prices-only"], ["--refresh-daily"]])
def test_existing_single_market_cli_modes_collect_without_changing_published_bytes(
    monkeypatch, tmp_path, mode,
):
    calls = []
    published_bytes = b'{"existing":"published bytes"}\n'

    class Export:
        def __init__(self, factory, *, chart_omissions):
            assert factory is script.SessionLocal
            self.omissions = chart_omissions

        def export(self, output, **kwargs):
            calls.append(kwargs)
            destination = output / "markets" / "us" / "charts" / "index.json"
            destination.parent.mkdir(parents=True)
            destination.write_bytes(published_bytes)
            self.omissions["US"] = {"MISSING": "no_rows_in_window"}
            return _result(output)

    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    monkeypatch.setattr(script, "_run_prices_only_refresh", lambda **_kwargs: {})
    monkeypatch.setattr(script, "_run_daily_refresh", lambda **_kwargs: ({}, []))
    _argv(monkeypatch, tmp_path, "--market", "US", *mode)
    assert script.main() == 0
    assert calls == [{"clean": True, "markets": ("US",), "write_manifest": False}]
    assert (tmp_path / "markets" / "us" / "charts" / "index.json").read_bytes() == published_bytes
    report = json.loads(_report_path(tmp_path).read_text())
    assert report["export_completed"] is True
    assert report["omissions"] == {"MISSING": "no_rows_in_window"}
    assert not list((tmp_path / "markets").rglob("cache-only-chart-omissions.json"))


@pytest.mark.parametrize("stage", ["constructor", "before_chart", "partial_chart"])
def test_failed_export_preserves_exception_and_replaces_stale_no_clean_report(
    monkeypatch, tmp_path, stage,
):
    failure = RuntimeError("original export error")
    script._write_chart_omission_diagnostics(tmp_path, "US", {"US": {"OLD": "bulk_read_error"}}, export_completed=True)

    class Export:
        def __init__(self, _factory, *, chart_omissions):
            if stage == "constructor":
                raise failure
            self.omissions = chart_omissions

        def export(self, _output, **_kwargs):
            if stage == "partial_chart":
                self.omissions["US"] = {"NEW": "insufficient_rows"}
            raise failure

    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    _argv(monkeypatch, tmp_path, "--market", "US", "--no-clean")
    with pytest.raises(RuntimeError) as raised:
        script.main()
    assert raised.value is failure
    report = json.loads(_report_path(tmp_path).read_text())
    assert report["export_completed"] is False
    assert report["chart_bundle_started"] is (stage == "partial_chart")
    assert report["omissions"] == ({"NEW": "insufficient_rows"} if stage == "partial_chart" else {})


@pytest.mark.parametrize("stage", ["runtime", "refresh_daily", "prices_only", "non_trading_day"])
def test_early_failures_and_skips_replace_previous_success_report(monkeypatch, tmp_path, stage):
    script._write_chart_omission_diagnostics(
        tmp_path, "US", {"US": {"OLD": "incoherent_history"}}, export_completed=True,
    )
    failure = RuntimeError("original early failure")

    def fail(*_args, **_kwargs):
        raise failure

    flags = ["--market", "US", "--no-clean"]
    if stage == "runtime":
        monkeypatch.setattr(script, "prepare_runtime", fail)
    elif stage == "prices_only":
        monkeypatch.setattr(script, "_run_prices_only_refresh", fail)
        flags.append("--prices-only")
    elif stage == "refresh_daily":
        monkeypatch.setattr(script, "_run_daily_refresh", fail)
        flags.append("--refresh-daily")
    else:
        monkeypatch.setattr(script, "_run_daily_refresh", lambda **_kwargs: (
            {"feature_snapshots": {"US": {"status": "skipped", "reason": "not_trading_day"}}}, [],
        ))
        flags.append("--refresh-daily")
    _argv(monkeypatch, tmp_path, *flags)
    if stage == "non_trading_day":
        assert script.main() == 78
    else:
        with pytest.raises(RuntimeError) as raised:
            script.main()
        assert raised.value is failure
    report = json.loads(_report_path(tmp_path).read_text())
    assert report["export_completed"] is report["chart_bundle_started"] is False
    assert report["omissions"] == {}


def test_report_and_warning_failures_never_escape_best_effort_helper(monkeypatch, tmp_path):
    def cannot_write(*_args, **_kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(script, "_write_chart_omission_diagnostics", cannot_write)
    monkeypatch.setattr("builtins.print", cannot_write)
    script._try_write_chart_omission_diagnostics(tmp_path, "US", {}, export_completed=False)


@pytest.mark.parametrize("outcome", ["success", "error", "no_artifact"])
def test_report_write_failure_never_changes_export_result(monkeypatch, tmp_path, outcome):
    failure = RuntimeError("original export failure")

    class Export:
        def __init__(self, *_args, **_kwargs):
            pass

        def export(self, output, **_kwargs):
            if outcome == "error":
                raise failure
            if outcome == "no_artifact":
                raise script.NoPublishedStaticMarketArtifact("none", markets=("US",))
            return _result(output)

    def cannot_write(*_args, **_kwargs):
        raise OSError("simulated disk full")

    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    monkeypatch.setattr(script, "_write_chart_omission_diagnostics", cannot_write)
    monkeypatch.setattr(script, "_run_prices_only_refresh", lambda **_kwargs: {})
    _argv(monkeypatch, tmp_path, "--market", "US", "--prices-only")
    if outcome == "error":
        with pytest.raises(RuntimeError) as raised:
            script.main()
        assert raised.value is failure
    else:
        assert script.main() == (0 if outcome == "success" else 79)


def test_unscoped_multi_market_cli_keeps_legacy_constructor_and_no_sidecar(monkeypatch, tmp_path):
    class Export:
        def __init__(self, factory):
            assert factory is script.SessionLocal

        def export(self, output, **kwargs):
            assert kwargs == {"clean": True, "markets": None, "write_manifest": True}
            return _result(output)

    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    _argv(monkeypatch, tmp_path)
    assert script.main() == 0
    assert not (tmp_path / "diagnostics").exists()


def test_combiner_ignores_separately_uploaded_diagnostic_artifact(tmp_path):
    artifacts, output = tmp_path / "artifacts", tmp_path / "combined"
    market_dir = artifacts / "static-market-US"
    market_dir.mkdir(parents=True)
    metadata = {
        "schema_version": STATIC_SITE_SCHEMA_VERSION, "market": "US", "warnings": [],
        "entry": {"as_of_date": "2026-10-13", "features": {}, "pages": {}, "assets": {}},
    }
    (market_dir / "manifest.market.json").write_text(json.dumps(metadata))
    diagnostic_dir = artifacts / "static-market-diagnostics-US"
    diagnostic_dir.mkdir()
    (diagnostic_dir / "cache-only-chart-omissions.json").write_text('{"omissions":{"A":"no_rows_in_window"}}')
    result = StaticSiteExportService.combine_market_artifacts(artifacts, output)
    assert result.manifest["supported_markets"] == ["US"]
    assert sorted(p.relative_to(output).as_posix() for p in output.rglob("*.json")) == [
        "manifest.json", "markets/us/manifest.market.json",
    ]


def test_pipeline_seed_and_refresh_survive_clean_without_changing_published_bytes(monkeypatch, tmp_path):
    published = b'{"same":"published bytes"}\n'
    prior = new_observations("US", "123")
    prior["input"] = {"market":"US", "sha256":"a"*64, "source_revision":"fixed-seed",
                      "download_hash_verified":True}
    observe(prior, "db_commit", status="committed", committed_rows=50)
    class Export:
        def __init__(self, _factory, *, chart_omissions, pipeline_observations=None):
            self.omissions, self.pipeline = chart_omissions, pipeline_observations
        def export(self, output, **kwargs):
            assert kwargs["clean"] is True
            if self.pipeline is not None:
                assert any(e["stage"]=="db_commit" for e in self.pipeline["events"])
                assert any(e["stage"]=="refresh_fetch" for e in self.pipeline["events"])
            shutil.rmtree(output)
            destination = output / "markets/us/charts/index.json"
            destination.parent.mkdir(parents=True)
            destination.write_bytes(published)
            self.omissions["US"] = {"NEW":"no_rows_in_window"}
            return _result(output)
    def refresh(*, market, observations=None):
        observe(observations, "refresh_fetch", symbol="NEW", status="failed", failure_kind="transient")
        return {}
    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    monkeypatch.setattr(script, "_run_prices_only_refresh", refresh)
    outputs = []
    for enabled in [False, True]:
        output = tmp_path / str(enabled)
        script._write_chart_omission_diagnostics(
            output, "US", {"US":{"OLD":"insufficient_rows"}}, export_completed=True,
            pipeline_observations=prior,
        )
        flags = ["--market","US","--prices-only"]
        if enabled:
            flags += ["--price-pipeline-diagnostics","--price-diagnostic-run-id","123",
                      "--price-diagnostic-input-sha256","a"*64,
                      "--price-diagnostic-source-revision","fixed-seed"]
        _argv(monkeypatch, output, *flags)
        assert script.main() == 0
        outputs.append({p.relative_to(output/"markets").as_posix():p.read_bytes()
                        for p in (output/"markets").rglob("*.json")})
        report = json.loads(_report_path(output).read_text())
        assert report["omissions"] == {"NEW":"no_rows_in_window"}
        assert report["export_completed"] is True
        if enabled:
            trace = report["pipeline_observations"]
            assert trace["input"] == prior["input"]
            assert [e["stage"] for e in trace["events"]] == ["db_commit","prior_link","refresh_fetch"]
        else:
            assert "pipeline_observations" not in report
    assert outputs[0] == outputs[1]


@pytest.mark.parametrize("failure_type", [RuntimeError, script.NoPublishedStaticMarketArtifact])
def test_pipeline_refresh_failure_is_preserved_and_not_caught_as_export_failure(monkeypatch, tmp_path, failure_type):
    failure = failure_type("injected refresh failure")
    def refresh(*, market, observations=None):
        observe(observations, "refresh_fetch", symbol="A", status="received")
        raise failure
    monkeypatch.setattr(script, "_run_prices_only_refresh", refresh)
    for enabled in [False, True]:
        output = tmp_path / str(enabled)
        flags = ["--market","US","--prices-only"]
        if enabled:
            flags.append("--price-pipeline-diagnostics")
        _argv(monkeypatch, output, *flags)
        with pytest.raises(failure_type) as raised:
            script.main()
        assert raised.value is failure
        report = json.loads(_report_path(output).read_text())
        assert report["export_completed"] is report["chart_bundle_started"] is False
        if enabled:
            assert report["pipeline_observations"]["events"][0]["stage"] == "refresh_fetch"


@pytest.mark.parametrize("mismatch", ["run_id", "sha256", "source_revision", "market"])
def test_pipeline_does_not_reuse_unbound_earlier_evidence(tmp_path, mismatch):
    prior = new_observations("US", "previous-run" if mismatch=="run_id" else "same-run")
    prior["input"] = {
        "market":"US", "sha256":("b" if mismatch=="sha256" else "a")*64,
        "source_revision":"old" if mismatch=="source_revision" else "fixed-seed",
    }
    prior["events"] = [{"stage":"seed_prepare","symbol":"PRIVATE_OLD_EVIDENCE"}]
    report = {"market":"HK" if mismatch=="market" else "US","pipeline_observations":prior}
    path = _report_path(tmp_path); path.parent.mkdir(parents=True)
    path.write_text(json.dumps(report))
    current = new_observations("US", "same-run")
    load_prior_observations(tmp_path,current,sha256="a"*64,source_revision="fixed-seed")
    assert "PRIVATE_OLD_EVIDENCE" not in json.dumps(current)
    assert "input" not in current
    assert current["events"] == [{"stage":"prior_link","status":"context_mismatch"}]


@pytest.mark.parametrize("mode", [[], ["--prices-only"], ["--refresh-daily"]])
def test_private_trace_survives_clean_but_is_never_in_uploaded_or_published_output(monkeypatch, tmp_path, mode):
    private = tmp_path / "runner-private"
    public = tmp_path / "static-data"
    original_bytes = b'{"unchanged":"market data"}\n'
    prior = new_observations("US", "repo:run:attempt:US:checkout")
    prior["input"] = {"market": "US", "sha256": "a" * 64,
                      "source_revision": "daily_prices_us:20261017230242", "download_hash_verified": True}
    observe(prior, "db_commit", source="seed_import", status="committed", committed_rows=42)
    script._write_chart_omission_diagnostics(private, "US", {}, export_completed=False, pipeline_observations=prior)

    class Export:
        def __init__(self, _factory, *, chart_omissions, pipeline_observations):
            self.omissions, self.trace = chart_omissions, pipeline_observations

        def export(self, output, **kwargs):
            assert self.trace["input"] == prior["input"]
            assert any(event["stage"] == "prior_link" for event in self.trace["events"])
            shutil.rmtree(output)
            path = output / "markets/us/charts/index.json"
            path.parent.mkdir(parents=True)
            path.write_bytes(original_bytes)
            self.omissions["US"] = {"MISSING": "incoherent_history"}
            observe(self.trace, "chart_output", symbol="PRIVATE_TRACE_MARKER", status="omitted", reason="incoherent_history")
            return _result(output)

    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    monkeypatch.setattr(script, "_run_prices_only_refresh", lambda **_kwargs: {})
    monkeypatch.setattr(script, "_run_daily_refresh", lambda **_kwargs: ({}, []))
    _argv(monkeypatch, public, "--market", "US", *mode, "--price-pipeline-diagnostics",
          "--price-diagnostic-sidecar-root", str(private), "--price-diagnostic-run-id", prior["run_id"],
          "--price-diagnostic-input-sha256", "a" * 64, "--price-diagnostic-source-revision", prior["input"]["source_revision"])
    assert script.main() == 0
    artifact = json.loads(_report_path(public).read_text())
    assert "pipeline_observations" not in artifact
    assert artifact["omissions"] == {"MISSING": "incoherent_history"}
    assert (public / "markets/us/charts/index.json").read_bytes() == original_bytes
    assert all(b"PRIVATE_TRACE_MARKER" not in path.read_bytes() for path in public.rglob("*.json"))
    trace = json.loads(_report_path(private).read_text())["pipeline_observations"]
    assert trace["input"] == prior["input"]
    assert any(event.get("symbol") == "PRIVATE_TRACE_MARKER" for event in trace["events"])


@pytest.mark.parametrize("exception_type", [RuntimeError, KeyboardInterrupt])
def test_private_trace_is_separated_even_when_export_is_interrupted(monkeypatch, tmp_path, exception_type):
    failure = exception_type("original interruption")
    private, public = tmp_path / "private", tmp_path / "public"

    class Export:
        def __init__(self, _factory, *, chart_omissions, pipeline_observations):
            self.trace = pipeline_observations

        def export(self, *_args, **_kwargs):
            observe(self.trace, "refresh_fetch", symbol="PRIVATE_TRACE_MARKER", status="received")
            raise failure

    monkeypatch.setattr(script, "StaticSiteExportService", Export)
    _argv(monkeypatch, public, "--market", "US", "--price-pipeline-diagnostics",
          "--price-diagnostic-sidecar-root", str(private))
    with pytest.raises(exception_type) as raised:
        script.main()
    assert raised.value is failure
    assert "pipeline_observations" not in json.loads(_report_path(public).read_text())
    assert json.loads(_report_path(private).read_text())["export_completed"] is False
    assert b"PRIVATE_TRACE_MARKER" not in _report_path(public).read_bytes()


@pytest.mark.parametrize("relative", [".", "private", "../"])
def test_private_trace_root_cannot_overlap_static_output(monkeypatch, tmp_path, relative):
    public = tmp_path / "public"
    private = public / relative
    _argv(monkeypatch, public, "--market", "US", "--price-pipeline-diagnostics",
          "--price-diagnostic-sidecar-root", str(private))
    with pytest.raises(SystemExit, match="outside the static output tree"):
        script.main()
    assert not list(tmp_path.rglob("*.json"))
