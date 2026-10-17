"""CLI persistence stays outside published market assets and export decisions."""

import json
from pathlib import Path
import socket
import sys
from types import SimpleNamespace

import pytest

import app.scripts.export_static_site as script
from app.services.static_site_export_service import StaticSiteExportService, STATIC_SITE_SCHEMA_VERSION


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
