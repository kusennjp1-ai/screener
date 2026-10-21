"""Synthetic trace tests; diagnostic bindings never certify price quality."""
import json
import os
from pathlib import Path
import subprocess
import sys
import textwrap

import pytest

from app.scripts import price_diagnostic_summary as script


def payload():
    return {"schema_version": "cache-only-chart-omissions-v1", "market": "US",
            "export_completed": True, "chart_bundle_started": True,
            "omissions": {"PRIVATE_SYMBOL": "no_rows_in_window"},
            "counts_by_reason": {"no_rows_in_window": 1, "insufficient_rows": 0,
                                  "incoherent_history": 0, "bulk_read_error": 0, "no_serializable_bars": 0},
            "pipeline_observations": {"schema_version": "price-pipeline-observations-v1",
                "market": "US", "run_id": "repo:run:attempt:US:checkout",
                "input": {"sha256": "a" * 64, "source_revision": "daily_prices_us:20261017230242",
                          "market": "US", "as_of_date": "2026-10-16", "hash_basis": "local_file_after_parse",
                          "download_hash_verified": True},
                "events": [{"stage": "seed_prepare", "status": "accepted", "source": "seed_import", "symbol": "PRIVATE_SYMBOL"},
                           {"stage": "db_prepare", "status": "accepted", "source": "refresh", "symbol": "PRIVATE_SYMBOL"},
                           {"stage": "db_commit", "status": "attempted"},
                           {"stage": "db_commit", "status": "committed", "committed_rows": 42},
                           {"stage": "db_commit", "status": "failed", "committed_rows": None,
                            "error": "PRIVATE_RAW_PROVIDER_ERROR"}]}}


def write_report(root, report):
    path = root / "diagnostics/us/cache-only-chart-omissions.json"
    path.parent.mkdir(parents=True)
    path.write_text(json.dumps(report))
    return path


def test_exact_verified_seed_revision_is_not_mistaken_for_checkout_sha():
    trace = payload()["pipeline_observations"]
    assert script.verified_binding(trace) == ("a" * 64, "daily_prices_us:20261017230242")


@pytest.mark.parametrize("field,value", [
    ("download_hash_verified", False), ("download_hash_verified", 1),
    ("hash_basis", "manifest_metadata"), ("market", "HK"),
    ("sha256", "unverified"), ("source_revision", "PRIVATE_PROVIDER_TEXT"),
    ("source_revision", "daily_prices_hk:20261017230242"),
    ("source_revision", "daily_prices_us:20261317230242"),
])
def test_metadata_hash_or_wrong_seed_identity_does_not_link(field, value):
    trace = payload()["pipeline_observations"]
    trace["input"][field] = value
    assert script.verified_binding(trace) is None


@pytest.mark.parametrize("field,value", [
    ("run_id", "old-attempt"), ("market", "HK"),
    ("schema_version", "old-schema"), ("events", {}),
])
def test_previous_run_market_or_schema_is_not_reused(tmp_path, field, value):
    report = payload()
    report["pipeline_observations"][field] = value
    path = write_report(tmp_path, report)
    with pytest.raises(ValueError, match="context_mismatch"):
        script.read_trace(path, run_id="repo:run:attempt:US:checkout", market="US")


def test_log_summary_has_no_raw_prices_symbols_or_errors_and_retains_unknown_commit_count():
    report = payload()
    trace = report["pipeline_observations"]
    trace["events"].append({"stage": "PRIVATE_UNKNOWN_STAGE", "status": "PRIVATE_UNKNOWN_ERROR",
                            "rejection": "PRIVATE_UNKNOWN_REJECTION", "close": 123.456789})
    before = json.dumps(report)
    result = script.summarize(report, trace)
    serialized = json.dumps(result)
    assert "PRIVATE_" not in serialized and "123.456789" not in serialized
    assert result["stages"]["seed_prepare"]["by_source"]["seed_import"]["events"] == 1
    assert result["stages"]["db_prepare"]["by_source"]["refresh"]["events"] == 1
    assert result["counts_are_per_stage_observations_not_global_coverage"] is True
    commits = result["stages"]["db_commit"]["by_source"]["unspecified"]
    assert commits["committed_rows_known_sum"] == 42
    assert commits["committed_rows_unknown_events"] == 1
    assert commits["committed_rows_not_recorded_events"] == 1
    assert result["omission_counts_by_reason"]["no_rows_in_window"] == 1
    assert result["publication_authority"] == "none"
    assert result["input"]["source_revision"] == "daily_prices_us:20261017230242"
    assert json.dumps(report) == before


def test_same_stage_sources_are_separate_and_normal_absent_status_is_not_an_error():
    report = payload()
    trace = report["pipeline_observations"]
    trace["events"] = [
        {"stage": "db_commit", "source": source, "status": "committed", "committed_rows": rows}
        for source, rows in [("seed_import", 5), ("refresh", 7), ("UNTRUSTED_SOURCE", 11)]
    ] + [{"stage": "chart_snapshot"},
         {"stage": "chart_output", "status": "omitted", "reason": "incoherent_history"},
         {"stage": "db_commit", "status": "attempted", "committed_rows": 1000}]
    result = script.summarize(report, trace)
    commits = result["stages"]["db_commit"]["by_source"]
    assert commits["seed_import"]["committed_rows_known_sum"] == 5
    assert commits["refresh"]["committed_rows_known_sum"] == 7
    assert commits["unclassified"]["committed_rows_known_sum"] == 11
    assert commits["unspecified"]["committed_rows_known_sum"] == 0
    assert commits["unspecified"]["committed_rows_unconfirmed_events"] == 1
    assert result["stages"]["chart_snapshot"]["by_source"]["unspecified"]["status_counts"] == {"not_recorded": 1}
    assert result["stages"]["chart_output"]["by_source"]["unspecified"]["reason_counts"] == {"incoherent_history": 1}


def test_cli_prints_only_bound_pair_and_summary_without_writing_files(tmp_path, monkeypatch, capsys):
    report = payload()
    path = write_report(tmp_path, report)
    before = path.read_bytes()
    def run(command):
        monkeypatch.setattr(sys, "argv", ["price_diagnostic_summary", command, "--root", str(tmp_path),
                                           "--market", "US", "--run-id", "repo:run:attempt:US:checkout"])
        assert script.main() == 0
        return capsys.readouterr().out
    assert run("binding") == "a" * 64 + "\ndaily_prices_us:20261017230242\n"
    output = run("summary")
    assert output.startswith("Price pipeline summary: ") and "PRIVATE_" not in output
    assert path.read_bytes() == before and list(tmp_path.rglob("*.json")) == [path]
    path.unlink()
    assert run("binding") == ""
    assert run("summary") == "Price pipeline summary: unavailable_or_unbound\n"


def test_oversize_or_symlink_trace_never_produces_binding(tmp_path, monkeypatch):
    path = write_report(tmp_path, payload())
    link = tmp_path / "linked.json"
    link.symlink_to(path)
    with pytest.raises(ValueError, match="missing_or_oversize"):
        script.read_trace(link, run_id="repo:run:attempt:US:checkout", market="US")
    monkeypatch.setattr(script, "MAX_TRACE_BYTES", 1)
    with pytest.raises(ValueError, match="missing_or_oversize"):
        script.read_trace(path, run_id="repo:run:attempt:US:checkout", market="US")


def test_log_budget_does_not_dump_or_alter_the_trace(tmp_path, monkeypatch, capsys):
    path = write_report(tmp_path, payload())
    before = path.read_bytes()
    monkeypatch.setattr(script, "MAX_LOG_BYTES", 1)
    monkeypatch.setattr(sys, "argv", ["price_diagnostic_summary", "summary", "--root", str(tmp_path),
                                       "--market", "US", "--run-id", "repo:run:attempt:US:checkout"])
    assert script.main() == 0
    assert capsys.readouterr().out == "Price pipeline summary: log_budget_exceeded\n"
    assert path.read_bytes() == before


def run_workflow_step(tmp_path, name, *, market="US", mode="full", original_exit=0, binding=True, summary_exit=0):
    repo = Path(__file__).resolve().parents[3]
    workflow = (repo / ".github/workflows/static-site.yml").read_text()
    step = workflow.split("      - name: " + name + "\n", 1)[1].split("\n      - ", 1)[0]
    command = textwrap.dedent(step.split("        run: |\n", 1)[1])
    command = command.replace("${{ matrix.market }}", market).replace("${{ needs.select-markets.outputs.mode }}", mode)
    assert "${{" not in command
    binary = tmp_path / "bin"
    binary.mkdir()
    stub = binary / "python"
    stub.write_text("#!" + sys.executable + "\n" + textwrap.dedent('''\
        import json, os, sys
        with open(os.environ['CALL_RECORD'], 'a') as handle:
            handle.write(json.dumps(sys.argv[1:]) + '\\n')
        module = sys.argv[2]
        if module == 'app.scripts.price_diagnostic_summary':
            if sys.argv[3] == 'binding':
                if os.environ['VERIFIED_BINDING'] == 'true':
                    print('a' * 64)
                    print('daily_prices_us:20261017230242')
                sys.exit(0)
            sys.exit(int(os.environ['SUMMARY_EXIT']))
        if module in ['app.scripts.sync_daily_price_bundle_from_github', 'app.scripts.export_static_site']:
            sys.exit(int(os.environ['ORIGINAL_EXIT']))
        sys.exit(97)
    '''))
    stub.chmod(0o755)
    env = dict(os.environ, PATH=str(binary) + os.pathsep + os.environ['PATH'],
               RUNNER_TEMP=str(tmp_path / "runner"), GITHUB_REPOSITORY="kusennjp1-ai/screener",
               GITHUB_RUN_ID="123", GITHUB_RUN_ATTEMPT="2", GITHUB_OUTPUT=str(tmp_path / "github-output"),
               CALL_RECORD=str(tmp_path / "calls"), ORIGINAL_EXIT=str(original_exit),
               VERIFIED_BINDING="true" if binding else "false", SUMMARY_EXIT=str(summary_exit))
    result = subprocess.run(["bash", "-e", "-o", "pipefail", "-c", command], cwd=repo, env=env,
                            capture_output=True, text=True, timeout=15)
    calls = [json.loads(line) for line in (tmp_path / "calls").read_text().splitlines()]
    return result, calls, Path(env['GITHUB_OUTPUT'])


@pytest.mark.parametrize("market", ["US", "HK"])
@pytest.mark.parametrize("mode", ["full", "prices_only"])
@pytest.mark.parametrize("original_exit", [0, 7, 78, 79])
def test_actual_workflow_export_preserves_original_exit_special_cases_and_non_us_route(tmp_path, market, mode, original_exit):
    result, calls, output = run_workflow_step(tmp_path, "Export market static data bundle", market=market,
                                             mode=mode, original_exit=original_exit, summary_exit=1)
    assert result.returncode == (0 if original_exit in [0, 78, 79] else original_exit), result.stderr
    exports = [call for call in calls if call[1] == 'app.scripts.export_static_site']
    assert len(exports) == 1
    assert ('--prices-only' in exports[0]) == (mode == "prices_only")
    assert len(calls) == 1
    assert not any('diagnostic' in arg for arg in exports[0])
    if original_exit != 7:
        assert output.read_text() == 'has_artifact=' + ('true' if original_exit == 0 else 'false') + '\n'


@pytest.mark.parametrize("market", ["US", "HK"])
@pytest.mark.parametrize("original_exit", [0, 1])
def test_actual_workflow_seed_exit_is_not_replaced_by_summary_result(tmp_path, market, original_exit):
    result, calls, _ = run_workflow_step(tmp_path, "Seed daily price bundle from GitHub", market=market,
                                        original_exit=original_exit, summary_exit=1)
    assert result.returncode == original_exit
    main = calls[0]
    assert main[1] == 'app.scripts.sync_daily_price_bundle_from_github'
    assert '--chart-diagnostics-output-dir' not in main
    assert len(calls) == 1


def test_frozen_workflow_does_not_supply_observation_binding_or_extra_commands(tmp_path):
    result, calls, _ = run_workflow_step(tmp_path, "Export market static data bundle", binding=False)
    assert result.returncode == 0
    main = next(call for call in calls if call[1] == 'app.scripts.export_static_site')
    assert len(calls) == 1 and '--price-pipeline-diagnostics' not in main
    assert '--price-diagnostic-input-sha256' not in main and '--price-diagnostic-source-revision' not in main
