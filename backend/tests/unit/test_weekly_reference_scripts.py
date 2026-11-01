from __future__ import annotations

import json
from contextlib import contextmanager
from datetime import datetime
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

import app.scripts.build_weekly_reference_bundle as build_script
import app.scripts.import_weekly_reference_bundle as import_script
import app.scripts.load_ibd_industry_groups as load_ibd_script


@contextmanager
def _fake_session(db="db-session"):
    yield db


def test_build_weekly_reference_bundle_requires_market(monkeypatch, tmp_path):
    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(
        "sys.argv",
        ["build_weekly_reference_bundle", "--output-dir", str(tmp_path)],
    )

    with pytest.raises(SystemExit):
        build_script.main()


def test_build_weekly_reference_bundle_runs_us_publish_and_export(monkeypatch, tmp_path, capsys):
    published_at = datetime(2026, 4, 4, 12, 10, 0)
    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", _fake_session)
    stock_universe_service = SimpleNamespace(
        populate_universe=lambda db: {"added": 10},
    )
    provider_snapshot_service = SimpleNamespace(
        create_snapshot_run=lambda db, run_mode, publish, snapshot_key, market, **kwargs: (
            kwargs["progress_callback"](
                {
                    "stage": "snapshot_fetch_complete",
                    "completed_fetches": 1,
                    "total_fetches": 12,
                    "percent_complete": 8.3,
                    "exchange": "NYSE",
                    "category": "overview",
                    "rows": 20,
                }
            )
            or {
                "published": True,
                "source_revision": "fundamentals_v1_us:20260404121000",
                "snapshot_key": snapshot_key,
                "market": market,
                "coverage": {
                    "snapshot_symbols": 20,
                    "active_symbols": 20,
                },
                "coverage_thresholds": {
                    "market": market,
                    "active_coverage": 1.0,
                    "min_active_coverage": 0.98,
                    "missing_ratio": 0.0,
                    "max_missing_ratio": 0.005,
                },
            }
        ),
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_us:20260404121000",
            },
        )(),
        hydrate_published_snapshot=lambda db, snapshot_key, progress_callback=None: {
            "hydrated": 20,
            "yahoo_hydrated": 18,
            "missing_prices": 0,
            "missing_yahoo": 0,
        },
    )
    monkeypatch.setattr(build_script, "get_stock_universe_service", lambda: stock_universe_service)
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)

    export_calls: list[dict[str, object]] = []

    def fake_export(db, **kwargs):
        export_calls.append(kwargs)
        kwargs["latest_manifest_path"].write_text(
            json.dumps({"bundle_asset_name": kwargs["bundle_asset_name"]}),
            encoding="utf-8",
        )
        kwargs["output_path"].write_bytes(b"bundle")
        return {"bundle_path": str(kwargs["output_path"])}

    provider_snapshot_service.export_weekly_reference_bundle = fake_export

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "US",
            "--us-source",
            "finviz",
            "--output-dir",
            str(tmp_path),
        ],
    )

    assert build_script.main() == 0
    assert export_calls[0]["output_path"] == (
        tmp_path / "weekly-reference-us-20260404-fundamentals_v1_us-20260404121000.json.gz"
    )
    assert export_calls[0]["bundle_asset_name"] == (
        "weekly-reference-us-20260404-fundamentals_v1_us-20260404121000.json.gz"
    )
    assert export_calls[0]["latest_manifest_path"] == tmp_path / "weekly-reference-latest-us.json"
    assert export_calls[0]["snapshot_key"] == build_script.ProviderSnapshotService.snapshot_key_for_market("US")
    assert export_calls[0]["market"] == "US"
    stdout = capsys.readouterr().out
    assert "Starting stock universe refresh from Finviz..." in stdout
    assert "[snapshot] 1/12 (8.3%) NYSE overview rows=20" in stdout
    assert "[publish] market=US coverage=100.00% (min=98.00%) missing_ratio=0.00% (max=0.50%)" in stdout
    assert "Starting Yahoo hydration for US published snapshot..." in stdout
    assert "Hydration complete:" in stdout
    # Hydration must run before export so market_cap from stock_fundamentals
    # is available at merge-time in export_weekly_reference_bundle.
    hydrate_idx = stdout.index("Starting Yahoo hydration for US published snapshot...")
    export_idx = stdout.index("Weekly reference bundle complete for US:")
    assert hydrate_idx < export_idx
    assert "Weekly reference bundle complete for US:" in stdout


def test_build_weekly_reference_bundle_writes_summary_when_us_publish_is_blocked(
    monkeypatch,
    tmp_path,
):
    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", _fake_session)
    summary_path = tmp_path / "github-step-summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary_path))
    stock_universe_service = SimpleNamespace(
        populate_universe=lambda db: {"added": 10},
    )
    provider_snapshot_service = SimpleNamespace(
        create_snapshot_run=lambda db, run_mode, publish, snapshot_key, market, **kwargs: {
            "published": False,
            "warnings": ["Active snapshot coverage 80.00% below minimum 98.00%"],
            "source_revision": "fundamentals_v1_us:20260404121000",
            "snapshot_key": snapshot_key,
            "market": market,
            "coverage": {
                "snapshot_symbols": 8,
                "active_symbols": 10,
            },
            "coverage_thresholds": {
                "market": market,
                "active_coverage": 0.8,
                "min_active_coverage": 0.98,
                "missing_ratio": 0.2,
                "max_missing_ratio": 0.005,
            },
        },
    )
    monkeypatch.setattr(build_script, "get_stock_universe_service", lambda: stock_universe_service)
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)
    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "US",
            "--us-source",
            "finviz",
            "--output-dir",
            str(tmp_path),
        ],
    )

    with pytest.raises(RuntimeError, match="Weekly fundamentals snapshot did not publish"):
        build_script.main()

    summary_text = summary_path.read_text(encoding="utf-8")
    assert "## Weekly Reference Bundle: US" in summary_text
    assert "| Active coverage | 80.00% |" in summary_text
    assert "| Minimum coverage | 98.00% |" in summary_text
    assert "| Bundle rows exported | 0 |" in summary_text


def test_build_weekly_reference_bundle_runs_hk_official_path(monkeypatch, tmp_path, capsys):
    published_at = datetime(2026, 4, 4, 12, 10, 0)
    active_rows = [
        SimpleNamespace(
            symbol="0700.HK",
            market="HK",
            exchange="XHKG",
            name="Tencent",
            sector="Technology",
            industry="Internet Content & Information",
            market_cap=456.0,
        )
    ]
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    summary_path = tmp_path / "github-step-summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(summary_path))

    fetch_calls: list[str] = []
    official_service = SimpleNamespace(
        fetch_market_snapshot=lambda market: fetch_calls.append(market)
        or SimpleNamespace(
            market=market,
            source_name="hkex_official",
            snapshot_id="hkex-listofsecurities-2026-04-04",
            snapshot_as_of="2026-04-04",
            source_metadata={"source_urls": ["https://example.com"]},
            rows=(
                {
                    "symbol": "0700.HK",
                    "name": "Tencent",
                    "exchange": "XHKG",
                    "sector": "",
                    "industry": "",
                    "market_cap": None,
                },
            ),
        )
    )
    monkeypatch.setattr(build_script, "OfficialMarketUniverseSourceService", lambda: official_service)

    stock_universe_service = SimpleNamespace(
        ingest_hk_snapshot_rows=lambda db, **kwargs: {"added": 1, "updated": 0, "deactivated": 0},
    )
    monkeypatch.setattr(build_script, "get_stock_universe_service", lambda: stock_universe_service)

    hybrid_calls: list[dict[str, object]] = []

    def fake_fetch_fundamentals_batch(symbols, **kwargs):
        hybrid_calls.append({"symbols": symbols, **kwargs})
        kwargs["progress_callback"](1, len(symbols))
        return {"0700.HK": {"market_cap": 456.0, "sector": "Technology"}}

    hybrid_service = SimpleNamespace(
        yfinance_delay_per_ticker=1.5,
        fetch_fundamentals_batch=fake_fetch_fundamentals_batch,
        store_all_caches=lambda *args, **kwargs: {
            "fundamentals_stored": 1,
            "persisted_symbols": 1,
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {"yahoo_quote_not_found": 2},
        },
    )
    monkeypatch.setattr(build_script, "get_hybrid_fundamentals_service", lambda: hybrid_service)
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: {"0700.HK": {"market_cap": 456.0, "sector": "Technology"}}),
    )

    published_rows: list[dict[str, object]] = []
    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: published_rows.append(kwargs)
        or {
            "published": True,
            "source_revision": "fundamentals_v1_hk:20260404121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": {
                "snapshot_symbols": 1,
                "active_symbols": 1,
            },
            "coverage_thresholds": {
                "market": "HK",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_hk:20260404121000",
            },
        )(),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "HK",
            "--output-dir",
            str(tmp_path),
        ],
    )

    assert build_script.main() == 0
    assert fetch_calls == ["HK"]
    assert hybrid_calls[0]["include_finviz"] is False
    assert hybrid_calls[0]["market_by_symbol"] == {"0700.HK": "HK"}
    assert callable(hybrid_calls[0]["progress_callback"])
    assert hybrid_service.yfinance_delay_per_ticker == build_script._WEEKLY_NON_US_YFINANCE_DELAY_PER_TICKER
    assert published_rows[0]["snapshot_key"] == build_script.ProviderSnapshotService.snapshot_key_for_market("HK")
    assert published_rows[0]["market"] == "HK"
    assert export_calls[0]["output_path"] == (
        tmp_path / "weekly-reference-hk-20260404-fundamentals_v1_hk-20260404121000.json.gz"
    )
    assert export_calls[0]["latest_manifest_path"] == tmp_path / "weekly-reference-latest-hk.json"
    assert export_calls[0]["market"] == "HK"
    stdout = capsys.readouterr().out
    assert "Starting official universe refresh for HK..." in stdout
    assert (
        "Using weekly non-US yfinance per-ticker delay "
        f"{build_script._WEEKLY_NON_US_YFINANCE_DELAY_PER_TICKER:.2f}s for HK"
    ) in stdout
    assert "Starting hybrid fundamentals refresh for HK..." in stdout
    assert "[fundamentals] HK 1/1 (100.0%)" in stdout
    assert "Fundamentals refresh complete:" in stdout
    assert "[publish] market=HK coverage=100.00% (min=70.00%) missing_ratio=0.00% (max=30.00%)" in stdout
    assert "Weekly reference bundle complete for HK:" in stdout
    summary_text = summary_path.read_text(encoding="utf-8")
    assert "## Weekly Reference Bundle: HK" in summary_text
    assert "| Coverage gate market | HK |" in summary_text
    assert "| Minimum coverage | 70.00% |" in summary_text
    assert "| Failed persistence symbols | 0 |" in summary_text
    assert "| `yahoo_quote_not_found` | 2 |" in summary_text


def test_build_weekly_reference_bundle_runs_de_official_path(monkeypatch, tmp_path, capsys):
    """Mirror of the HK official-path test for the new DE fetcher.

    Verifies the build script (1) fetches the DE snapshot via the official
    source service, (2) routes the snapshot to ``ingest_de_snapshot_rows``
    rather than raising on ``Unsupported official weekly reference market``,
    and (3) publishes/exports the resulting bundle.
    """
    published_at = datetime(2026, 5, 9, 12, 10, 0)
    active_rows = [
        SimpleNamespace(
            symbol="SAP.DE",
            market="DE",
            exchange="XETR",
            name="SAP SE",
            sector="Technology",
            industry="Application Software",
            market_cap=200.0,
        )
    ]
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))

    fetch_calls: list[str] = []
    official_service = SimpleNamespace(
        fetch_market_snapshot=lambda market: fetch_calls.append(market)
        or SimpleNamespace(
            market=market,
            source_name="dbg_official",
            snapshot_id="dbg-equity-2026-05-09",
            snapshot_as_of="2026-05-09",
            source_metadata={"source_urls": ["https://api.boerse-frankfurt.de"], "fetch_mode": "live_http"},
            rows=(
                {
                    "symbol": "SAP.DE",
                    "name": "SAP SE",
                    "exchange": "XETR",
                    "sector": "",
                    "industry": "",
                    "market_cap": None,
                    "isin": "DE0007164600",
                    "wkn": "SAP",
                },
            ),
        )
    )
    monkeypatch.setattr(build_script, "OfficialMarketUniverseSourceService", lambda: official_service)

    ingest_calls: list[dict[str, object]] = []
    stock_universe_service = SimpleNamespace(
        ingest_de_snapshot_rows=lambda db, **kwargs: ingest_calls.append(kwargs)
        or {"added": 1, "updated": 0, "deactivated": 0},
    )
    monkeypatch.setattr(build_script, "get_stock_universe_service", lambda: stock_universe_service)

    hybrid_service = SimpleNamespace(
        yfinance_delay_per_ticker=1.5,
        fetch_fundamentals_batch=lambda symbols, **kwargs: (
            kwargs["progress_callback"](1, len(symbols))
            or {"SAP.DE": {"market_cap": 200.0, "sector": "Technology"}}
        ),
        store_all_caches=lambda *args, **kwargs: {
            "fundamentals_stored": 1,
            "persisted_symbols": 1,
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {},
        },
    )
    monkeypatch.setattr(build_script, "get_hybrid_fundamentals_service", lambda: hybrid_service)
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(
            get_many=lambda symbols: {"SAP.DE": {"market_cap": 200.0, "sector": "Technology"}}
        ),
    )

    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: {
            "published": True,
            "source_revision": "fundamentals_v1_de:20260509121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": {"snapshot_symbols": 1, "active_symbols": 1},
            "coverage_thresholds": {
                "market": "DE",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_de:20260509121000",
            },
        )(),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "DE",
            "--output-dir",
            str(tmp_path),
        ],
    )

    assert build_script.main() == 0
    assert fetch_calls == ["DE"]
    assert len(ingest_calls) == 1
    assert ingest_calls[0]["source_name"] == "dbg_official"
    assert ingest_calls[0]["snapshot_id"] == "dbg-equity-2026-05-09"
    assert export_calls[0]["output_path"] == (
        tmp_path / "weekly-reference-de-20260509-fundamentals_v1_de-20260509121000.json.gz"
    )
    assert export_calls[0]["latest_manifest_path"] == tmp_path / "weekly-reference-latest-de.json"
    assert export_calls[0]["market"] == "DE"
    stdout = capsys.readouterr().out
    assert "Starting official universe refresh for DE..." in stdout
    assert "Weekly reference bundle complete for DE:" in stdout


def test_build_weekly_reference_bundle_runs_sg_official_path(monkeypatch, tmp_path, capsys):
    """Mirror of the DE official-path test for the SG fetcher.

    Verifies the build script (1) fetches the SG snapshot via the official
    source service, (2) routes the snapshot to ``ingest_sg_snapshot_rows``
    rather than raising on ``Unsupported official weekly reference market``,
    and (3) publishes/exports the resulting bundle.
    """
    published_at = datetime(2026, 5, 17, 12, 10, 0)
    active_rows = [
        SimpleNamespace(
            symbol="D05.SI",
            market="SG",
            exchange="XSES",
            name="DBS Group Holdings",
            sector="Banks",
            industry="Banks",
            market_cap=95.0,
        )
    ]
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))

    fetch_calls: list[str] = []
    official_service = SimpleNamespace(
        fetch_market_snapshot=lambda market: fetch_calls.append(market)
        or SimpleNamespace(
            market=market,
            source_name="sg_manual_csv",
            snapshot_id="sg-csv-fallback-2026-05-17",
            snapshot_as_of="2026-05-17",
            source_metadata={"source_urls": [], "fetch_mode": "csv_fallback"},
            rows=(
                {
                    "symbol": "D05.SI",
                    "name": "DBS Group Holdings",
                    "exchange": "XSES",
                    "sector": "",
                    "industry": "",
                    "market_cap": None,
                    "isin": "SG1L01001701",
                },
            ),
        )
    )
    monkeypatch.setattr(build_script, "OfficialMarketUniverseSourceService", lambda: official_service)

    ingest_calls: list[dict[str, object]] = []
    stock_universe_service = SimpleNamespace(
        ingest_sg_snapshot_rows=lambda db, **kwargs: ingest_calls.append(kwargs)
        or {"added": 1, "updated": 0, "deactivated": 0},
    )
    monkeypatch.setattr(build_script, "get_stock_universe_service", lambda: stock_universe_service)

    hybrid_service = SimpleNamespace(
        yfinance_delay_per_ticker=1.5,
        fetch_fundamentals_batch=lambda symbols, **kwargs: (
            kwargs["progress_callback"](1, len(symbols))
            or {"D05.SI": {"market_cap": 95.0, "sector": "Banks"}}
        ),
        store_all_caches=lambda *args, **kwargs: {
            "fundamentals_stored": 1,
            "persisted_symbols": 1,
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {},
        },
    )
    monkeypatch.setattr(build_script, "get_hybrid_fundamentals_service", lambda: hybrid_service)
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(
            get_many=lambda symbols: {"D05.SI": {"market_cap": 95.0, "sector": "Banks"}}
        ),
    )

    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: {
            "published": True,
            "source_revision": "fundamentals_v1_sg:20260517121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": {"snapshot_symbols": 1, "active_symbols": 1},
            "coverage_thresholds": {
                "market": "SG",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_sg:20260517121000",
            },
        )(),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "SG",
            "--output-dir",
            str(tmp_path),
        ],
    )

    assert build_script.main() == 0
    assert fetch_calls == ["SG"]
    assert len(ingest_calls) == 1
    assert ingest_calls[0]["source_name"] == "sg_manual_csv"
    assert ingest_calls[0]["snapshot_id"] == "sg-csv-fallback-2026-05-17"
    assert export_calls[0]["output_path"] == (
        tmp_path / "weekly-reference-sg-20260517-fundamentals_v1_sg-20260517121000.json.gz"
    )
    assert export_calls[0]["latest_manifest_path"] == tmp_path / "weekly-reference-latest-sg.json"
    assert export_calls[0]["market"] == "SG"
    stdout = capsys.readouterr().out
    assert "Starting official universe refresh for SG..." in stdout
    assert "Weekly reference bundle complete for SG:" in stdout


def test_build_weekly_reference_bundle_runs_au_official_path(monkeypatch, tmp_path, capsys):
    """AU weekly reference builds must route ASX snapshots into AU ingestion."""
    published_at = datetime(2026, 5, 30, 12, 10, 0)
    active_rows = [
        SimpleNamespace(
            symbol="BHP.AX",
            market="AU",
            exchange="XASX",
            name="BHP Group Limited",
            sector="Basic Materials",
            industry="Other Industrial Metals & Mining",
            market_cap=220.0,
        )
    ]
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))

    fetch_calls: list[str] = []
    official_service = SimpleNamespace(
        fetch_market_snapshot=lambda market: fetch_calls.append(market)
        or SimpleNamespace(
            market=market,
            source_name="asx_official_public_csv",
            snapshot_id="asx-listed-companies-2026-05-30",
            snapshot_as_of="2026-05-30",
            source_metadata={
                "source_urls": ["https://www.asx.com.au/asx/research/ASXListedCompanies.csv"],
                "fetch_mode": "live_http",
            },
            rows=(
                {
                    "symbol": "BHP.AX",
                    "name": "BHP Group Limited",
                    "exchange": "XASX",
                    "sector": "",
                    "industry": "",
                    "market_cap": None,
                    "isin": "AU000000BHP4",
                },
            ),
        )
    )
    monkeypatch.setattr(build_script, "OfficialMarketUniverseSourceService", lambda: official_service)

    ingest_calls: list[dict[str, object]] = []
    stock_universe_service = SimpleNamespace(
        ingest_au_snapshot_rows=lambda db, **kwargs: ingest_calls.append(kwargs)
        or {"added": 1, "updated": 0, "deactivated": 0},
    )
    monkeypatch.setattr(build_script, "get_stock_universe_service", lambda: stock_universe_service)

    hybrid_service = SimpleNamespace(
        yfinance_delay_per_ticker=1.5,
        fetch_fundamentals_batch=lambda symbols, **kwargs: (
            kwargs["progress_callback"](1, len(symbols))
            or {"BHP.AX": {"market_cap": 220.0, "sector": "Basic Materials"}}
        ),
        store_all_caches=lambda *args, **kwargs: {
            "fundamentals_stored": 1,
            "persisted_symbols": 1,
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {},
        },
    )
    monkeypatch.setattr(build_script, "get_hybrid_fundamentals_service", lambda: hybrid_service)
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(
            get_many=lambda symbols: {"BHP.AX": {"market_cap": 220.0, "sector": "Basic Materials"}}
        ),
    )

    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: {
            "published": True,
            "source_revision": "fundamentals_v1_au:20260530121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": {"snapshot_symbols": 1, "active_symbols": 1},
            "coverage_thresholds": {
                "market": "AU",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_au:20260530121000",
            },
        )(),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "AU",
            "--output-dir",
            str(tmp_path),
        ],
    )

    assert build_script.main() == 0
    assert fetch_calls == ["AU"]
    assert len(ingest_calls) == 1
    assert ingest_calls[0]["source_name"] == "asx_official_public_csv"
    assert ingest_calls[0]["snapshot_id"] == "asx-listed-companies-2026-05-30"
    assert export_calls[0]["output_path"] == (
        tmp_path / "weekly-reference-au-20260530-fundamentals_v1_au-20260530121000.json.gz"
    )
    assert export_calls[0]["latest_manifest_path"] == tmp_path / "weekly-reference-latest-au.json"
    assert export_calls[0]["market"] == "AU"
    stdout = capsys.readouterr().out
    assert "Starting official universe refresh for AU..." in stdout
    assert "Weekly reference bundle complete for AU:" in stdout


def _make_universe_row(symbol: str, market: str = "CN") -> SimpleNamespace:
    return SimpleNamespace(
        symbol=symbol,
        market=market,
        exchange="SSE" if symbol.endswith(".SS") else "SZSE",
        name=f"Co-{symbol}",
        sector="Industrials",
        industry="Misc",
        market_cap=1000.0,
    )


def test_build_weekly_reference_bundle_chunked_deadline_force_publishes(
    monkeypatch, tmp_path, capsys
):
    """Asia path stops between chunks once the wall-clock budget is exhausted.

    With --max-runtime-minutes set and the deadline tripping after the first
    chunk, the second chunk is never fetched, the snapshot is published with
    force_publish=True, and warnings record the deadline.
    """

    published_at = datetime(2026, 5, 5, 12, 10, 0)
    active_rows = [
        _make_universe_row("600000.SS"),
        _make_universe_row("600001.SS"),
        _make_universe_row("000001.SZ"),
    ]
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)

    official_service = SimpleNamespace(
        fetch_market_snapshot=lambda market: SimpleNamespace(
            market=market,
            source_name="cn_official",
            snapshot_id="cn-2026-05-05",
            snapshot_as_of="2026-05-05",
            source_metadata={},
            rows=tuple({"symbol": row.symbol} for row in active_rows),
        )
    )
    monkeypatch.setattr(
        build_script, "OfficialMarketUniverseSourceService", lambda: official_service
    )
    monkeypatch.setattr(
        build_script,
        "get_stock_universe_service",
        lambda: SimpleNamespace(
            ingest_cn_snapshot_rows=lambda db, **kwargs: {"added": 3, "updated": 0, "deactivated": 0}
        ),
    )

    # Drive build_script.time.monotonic so the second chunk sees an exhausted
    # deadline. Each call advances by 60 s, so a 1.5-minute (90 s) budget is
    # consumed after the first chunk's start.
    fake_clock = {"value": 0.0}

    def fake_monotonic() -> float:
        fake_clock["value"] += 60.0
        return fake_clock["value"]

    monkeypatch.setattr(build_script.time, "monotonic", fake_monotonic)

    fetch_calls: list[list[str]] = []
    store_calls: list[list[str]] = []

    def fake_fetch_fundamentals_batch(symbols, **kwargs):
        fetch_calls.append(list(symbols))
        kwargs["progress_callback"](len(symbols), len(symbols))
        return {symbol: {"market_cap": 1000.0, "sector": "Industrials"} for symbol in symbols}

    def fake_store_all_caches(data, _cache, **_kwargs):
        store_calls.append(list(data))
        return {
            "fundamentals_stored": len(data),
            "persisted_symbols": len(data),
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {},
        }

    hybrid_service = SimpleNamespace(
        yfinance_delay_per_ticker=1.5,
        fetch_fundamentals_batch=fake_fetch_fundamentals_batch,
        store_all_caches=fake_store_all_caches,
    )
    monkeypatch.setattr(build_script, "get_hybrid_fundamentals_service", lambda: hybrid_service)

    # Cache returns fresh data for both attempted symbols and (simulated)
    # last-week data for the symbol whose chunk was skipped — that's the whole
    # point of force-publish: skipped symbols inherit the prior bundle.
    cached = {
        "600000.SS": {"market_cap": 1000.0, "sector": "Industrials"},
        "600001.SS": {"market_cap": 1000.0, "sector": "Industrials"},
        "000001.SZ": {"market_cap": 999.0, "sector": "Industrials", "data_source": "bundle_import"},
    }
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: cached),
    )

    publish_calls: list[dict[str, object]] = []
    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: publish_calls.append(kwargs)
        or {
            "published": True,
            "force_published": kwargs.get("force_publish", False),
            "source_revision": "fundamentals_v1_cn:20260505121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": dict(kwargs["coverage_stats"]),
            "warnings": list(kwargs["warnings"]),
            "coverage_thresholds": {
                "market": "CN",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_cn:20260505121000",
            },
        )(),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(
        build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service
    )

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
            "--max-runtime-minutes",
            "1.5",
            "--fetch-chunk-size",
            "2",
            "--allow-partial-publish",
        ],
    )

    assert build_script.main() == 0

    # Only the first chunk fetched; the second chunk's deadline check tripped.
    assert fetch_calls == [["600000.SS", "600001.SS"]]
    assert store_calls == [["600000.SS", "600001.SS"]]

    # Snapshot rows still cover all 3 symbols (skipped one inherited from cache).
    publish_kwargs = publish_calls[0]
    assert publish_kwargs["force_publish"] is True
    assert publish_kwargs["coverage_stats"]["partial_run"] is True
    assert publish_kwargs["coverage_stats"]["attempted_symbols"] == 2
    assert publish_kwargs["coverage_stats"]["skipped_due_to_deadline"] == 1
    assert publish_kwargs["coverage_stats"]["snapshot_symbols"] == 3
    deadline_warning = next(
        (w for w in publish_kwargs["warnings"] if "deadline reached" in w), None
    )
    assert deadline_warning is not None, publish_kwargs["warnings"]

    stdout = capsys.readouterr().out
    assert "[fundamentals] CN chunk 1/2" in stdout
    assert "deadline reached before chunk 2/2" in stdout
    assert export_calls, "Bundle export should still run after a partial publish"


def test_build_weekly_reference_bundle_deadline_blocks_when_partial_disabled(
    monkeypatch, tmp_path
):
    """Disabling partial publish blocks deadline-hit runs even when cache coverage passes."""

    active_rows = [
        _make_universe_row("600000.SS"),
        _make_universe_row("600001.SS"),
        _make_universe_row("000001.SZ"),
    ]
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    monkeypatch.setattr(
        build_script,
        "OfficialMarketUniverseSourceService",
        lambda: SimpleNamespace(
            fetch_market_snapshot=lambda market: SimpleNamespace(
                market=market,
                source_name="cn_official",
                snapshot_id="cn-2026-05-05",
                snapshot_as_of="2026-05-05",
                source_metadata={},
                rows=tuple({"symbol": row.symbol} for row in active_rows),
            )
        ),
    )
    monkeypatch.setattr(
        build_script,
        "get_stock_universe_service",
        lambda: SimpleNamespace(
            ingest_cn_snapshot_rows=lambda db, **kwargs: {"added": 3, "updated": 0, "deactivated": 0}
        ),
    )

    fake_clock = {"value": 0.0}

    def fake_monotonic() -> float:
        fake_clock["value"] += 60.0
        return fake_clock["value"]

    monkeypatch.setattr(build_script.time, "monotonic", fake_monotonic)

    monkeypatch.setattr(
        build_script,
        "get_hybrid_fundamentals_service",
        lambda: SimpleNamespace(
            yfinance_delay_per_ticker=1.5,
            fetch_fundamentals_batch=lambda symbols, **kwargs: {
                symbol: {"market_cap": 1000.0, "sector": "Industrials"} for symbol in symbols
            },
            store_all_caches=lambda data, _cache, **_kwargs: {
                "fundamentals_stored": len(data),
                "persisted_symbols": len(data),
                "failed_persistence_symbols": 0,
                "failed": 0,
                "provider_error_counts": {},
            },
        ),
    )
    cached = {
        "600000.SS": {"market_cap": 1000.0, "sector": "Industrials"},
        "600001.SS": {"market_cap": 1000.0, "sector": "Industrials"},
        "000001.SZ": {"market_cap": 999.0, "sector": "Industrials", "data_source": "bundle_import"},
    }
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: cached),
    )

    publish_calls: list[dict[str, object]] = []

    def fake_publish_market_snapshot_run(db, **kwargs):
        publish_calls.append(kwargs)
        return {
            "published": False,
            "source_revision": "fundamentals_v1_cn:20260505121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": dict(kwargs["coverage_stats"]),
            "warnings": list(kwargs["warnings"]),
            "coverage_thresholds": {
                "market": "CN",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        }

    monkeypatch.setattr(
        build_script,
        "get_provider_snapshot_service",
        lambda: SimpleNamespace(
            build_market_snapshot_row=lambda **kwargs: {
                "symbol": kwargs["symbol"],
                "exchange": kwargs["exchange"],
                "row_hash": "row-hash",
                "normalized_payload": kwargs["normalized_payload"],
                "raw_payload": kwargs["raw_payload"],
            },
            publish_market_snapshot_run=fake_publish_market_snapshot_run,
        ),
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
            "--max-runtime-minutes",
            "1.5",
            "--fetch-chunk-size",
            "2",
        ],
    )

    with pytest.raises(RuntimeError, match="Partial publish disabled"):
        build_script.main()

    publish_kwargs = publish_calls[0]
    assert publish_kwargs["publish"] is False
    assert publish_kwargs["force_publish"] is False
    assert publish_kwargs["coverage_stats"]["partial_run"] is True
    assert publish_kwargs["coverage_stats"]["snapshot_symbols"] == 3


def _patch_cn_dependencies(monkeypatch, *, raise_universe: bool, hybrid_failures: int = 0):
    """Wire the supporting Asia-bundle services for stale-universe fallback tests."""

    def fetch(market):
        if raise_universe:
            raise RuntimeError("AKShare CN spot disconnected")
        return SimpleNamespace(
            market=market,
            source_name="cn_official",
            snapshot_id="cn-2026-05-09",
            snapshot_as_of="2026-05-09",
            source_metadata={},
            rows=(),
        )

    monkeypatch.setattr(
        build_script,
        "OfficialMarketUniverseSourceService",
        lambda: SimpleNamespace(fetch_market_snapshot=fetch),
    )
    monkeypatch.setattr(
        build_script,
        "get_stock_universe_service",
        lambda: SimpleNamespace(
            ingest_cn_snapshot_rows=lambda db, **kwargs: {
                "added": 0,
                "updated": 0,
                "deactivated": 0,
            }
        ),
    )

    monkeypatch.setattr(
        build_script,
        "get_hybrid_fundamentals_service",
        lambda: SimpleNamespace(
            yfinance_delay_per_ticker=1.5,
            fetch_fundamentals_batch=lambda symbols, **kwargs: {
                symbol: {"market_cap": 1000.0, "sector": "Industrials"} for symbol in symbols
            },
            store_all_caches=lambda data, _cache, **_kwargs: {
                "fundamentals_stored": len(data),
                "persisted_symbols": len(data),
                "failed_persistence_symbols": 0,
                "failed": hybrid_failures,
                "provider_error_counts": {},
            },
        ),
    )


def _make_cn_db_mock(active_rows: list[SimpleNamespace], *, seeded_count: int | None = None):
    fake_query = MagicMock()
    fake_query.filter.return_value.order_by.return_value.all.return_value = active_rows
    fake_query.filter.return_value.count.return_value = (
        seeded_count if seeded_count is not None else len(active_rows)
    )
    fake_db = MagicMock()
    fake_db.query.return_value = fake_query
    return fake_db


def test_build_asia_bundle_falls_back_to_seeded_universe_when_official_fetch_fails(
    monkeypatch, tmp_path, capsys
):
    """When AKShare listing fails and partial publish is on, reuse seeded rows."""
    published_at = datetime(2026, 5, 9, 12, 10, 0)
    active_rows = [
        _make_universe_row("600000.SS"),
        _make_universe_row("000001.SZ"),
    ]
    fake_db = _make_cn_db_mock(active_rows)

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)

    _patch_cn_dependencies(monkeypatch, raise_universe=True)

    cached = {
        "600000.SS": {"market_cap": 1000.0, "sector": "Industrials"},
        "000001.SZ": {"market_cap": 1000.0, "sector": "Industrials"},
    }
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: cached),
    )

    publish_calls: list[dict[str, object]] = []
    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: publish_calls.append(kwargs)
        or {
            "published": True,
            "force_published": kwargs.get("force_publish", False),
            "source_revision": "fundamentals_v1_cn:20260509121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": dict(kwargs["coverage_stats"]),
            "warnings": list(kwargs["warnings"]),
            "coverage_thresholds": {
                "market": "CN",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: type(
            "Run",
            (),
            {
                "published_at": published_at,
                "created_at": published_at,
                "source_revision": "fundamentals_v1_cn:20260509121000",
            },
        )(),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
            "--allow-partial-publish",
        ],
    )

    assert build_script.main() == 0

    publish_kwargs = publish_calls[0]
    assert publish_kwargs["force_publish"] is True
    assert publish_kwargs["coverage_stats"]["stale_universe"] is True
    assert publish_kwargs["coverage_stats"]["partial_run"] is True
    stale_warning = next(
        (w for w in publish_kwargs["warnings"] if "Official CN universe fetch failed" in w),
        None,
    )
    assert stale_warning is not None, publish_kwargs["warnings"]
    assert "AKShare CN spot disconnected" in stale_warning
    assert export_calls, "Bundle export should still run after a stale-universe fallback"

    stdout = capsys.readouterr().out
    assert "[universe] CN official fetch failed" in stdout
    assert "falling back to 2 seeded prior-week rows" in stdout


def test_build_asia_bundle_reraises_when_no_seeded_universe_rows(monkeypatch, tmp_path):
    """If AKShare fails AND no prior-week rows are seeded, surface the original error."""
    fake_db = _make_cn_db_mock([], seeded_count=0)

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)

    _patch_cn_dependencies(monkeypatch, raise_universe=True)
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: {}),
    )
    monkeypatch.setattr(
        build_script,
        "get_provider_snapshot_service",
        lambda: SimpleNamespace(
            build_market_snapshot_row=lambda **kwargs: {},
            publish_market_snapshot_run=lambda db, **kwargs: {"published": False, "warnings": []},
        ),
    )

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
            "--allow-partial-publish",
        ],
    )

    with pytest.raises(RuntimeError, match="AKShare CN spot disconnected"):
        build_script.main()


def test_build_asia_bundle_reraises_when_partial_publish_disabled(monkeypatch, tmp_path):
    """Without --allow-partial-publish, an AKShare failure must abort the run."""
    active_rows = [_make_universe_row("600000.SS")]
    fake_db = _make_cn_db_mock(active_rows)

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)

    _patch_cn_dependencies(monkeypatch, raise_universe=True)
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: {}),
    )
    monkeypatch.setattr(
        build_script,
        "get_provider_snapshot_service",
        lambda: SimpleNamespace(
            build_market_snapshot_row=lambda **kwargs: {},
            publish_market_snapshot_run=lambda db, **kwargs: {"published": False, "warnings": []},
        ),
    )

    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
        ],
    )

    with pytest.raises(RuntimeError, match="AKShare CN spot disconnected"):
        build_script.main()


def test_build_weekly_reference_bundle_resumes_partial_seed_by_skipping_cached_symbols(
    monkeypatch, tmp_path
):
    active_rows = [
        _make_universe_row("600000.SS"),
        _make_universe_row("600001.SS"),
        _make_universe_row("000001.SZ"),
    ]
    fake_db = _make_cn_db_mock(active_rows)

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    _patch_cn_dependencies(monkeypatch, raise_universe=False)

    fetch_calls: list[list[str]] = []
    cached = {
        "600000.SS": {
            "market_cap": 999.0,
            "sector": "Industrials",
            "data_source": "bundle_import",
        },
    }

    def fake_fetch_fundamentals_batch(symbols, **kwargs):
        fetch_calls.append(list(symbols))
        kwargs["progress_callback"](len(symbols), len(symbols))
        return {symbol: {"market_cap": 1000.0, "sector": "Industrials"} for symbol in symbols}

    def fake_store_all_caches(data, _cache, **_kwargs):
        cached.update(data)
        return {
            "fundamentals_stored": len(data),
            "persisted_symbols": len(data),
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {},
        }

    monkeypatch.setattr(
        build_script,
        "get_hybrid_fundamentals_service",
        lambda: SimpleNamespace(
            yfinance_delay_per_ticker=1.5,
            fetch_fundamentals_batch=fake_fetch_fundamentals_batch,
            store_all_caches=fake_store_all_caches,
        ),
    )
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: {s: cached[s] for s in symbols if s in cached}),
    )

    published_at = datetime(2026, 5, 5, 12, 10, 0)
    publish_calls: list[dict[str, object]] = []
    export_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: publish_calls.append(kwargs)
        or {
            "published": True,
            "force_published": False,
            "source_revision": "fundamentals_v1_cn:20260505121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": dict(kwargs["coverage_stats"]),
            "warnings": list(kwargs["warnings"]),
            "coverage_thresholds": {
                "market": "CN",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: SimpleNamespace(
            published_at=published_at,
            created_at=published_at,
            source_revision="fundamentals_v1_cn:20260505121000",
            coverage_stats_json=(
                '{"partial_run": true, "active_symbols": 3, '
                '"snapshot_symbols": 1, "missing_active_symbols": 2}'
            ),
        ),
        export_weekly_reference_bundle=lambda db, **kwargs: export_calls.append(kwargs)
        or {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(
        build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
            "--fetch-chunk-size",
            "2",
            "--resume-partial-seed",
        ],
    )

    assert build_script.main() == 0

    assert fetch_calls == [["600001.SS", "000001.SZ"]]
    publish_kwargs = publish_calls[0]
    assert publish_kwargs["coverage_stats"]["seeded_symbols"] == 1
    assert publish_kwargs["coverage_stats"]["fetch_symbols"] == 2
    assert publish_kwargs["coverage_stats"]["attempted_symbols"] == 2
    assert publish_kwargs["coverage_stats"]["partial_run"] is False
    assert publish_kwargs["coverage_stats"]["snapshot_symbols"] == 3
    assert export_calls, "Bundle export should run after completing a resumed seed"


def test_build_weekly_reference_bundle_does_not_resume_full_coverage_partial_seed(
    monkeypatch, tmp_path
):
    active_rows = [
        _make_universe_row("600000.SS"),
        _make_universe_row("600001.SS"),
        _make_universe_row("000001.SZ"),
    ]
    fake_db = _make_cn_db_mock(active_rows)

    monkeypatch.setattr(build_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(build_script, "SessionLocal", lambda: _fake_session(fake_db))
    monkeypatch.delenv("GITHUB_STEP_SUMMARY", raising=False)
    _patch_cn_dependencies(monkeypatch, raise_universe=False)

    fetch_calls: list[list[str]] = []
    cached = {
        row.symbol: {
            "market_cap": 999.0,
            "sector": "Industrials",
            "data_source": "bundle_import",
        }
        for row in active_rows
    }

    def fake_fetch_fundamentals_batch(symbols, **kwargs):
        fetch_calls.append(list(symbols))
        kwargs["progress_callback"](len(symbols), len(symbols))
        return {symbol: {"market_cap": 1000.0, "sector": "Industrials"} for symbol in symbols}

    def fake_store_all_caches(data, _cache, **_kwargs):
        cached.update(data)
        return {
            "fundamentals_stored": len(data),
            "persisted_symbols": len(data),
            "failed_persistence_symbols": 0,
            "failed": 0,
            "provider_error_counts": {},
        }

    monkeypatch.setattr(
        build_script,
        "get_hybrid_fundamentals_service",
        lambda: SimpleNamespace(
            yfinance_delay_per_ticker=1.5,
            fetch_fundamentals_batch=fake_fetch_fundamentals_batch,
            store_all_caches=fake_store_all_caches,
        ),
    )
    monkeypatch.setattr(
        build_script,
        "get_fundamentals_cache",
        lambda: SimpleNamespace(get_many=lambda symbols: {s: cached[s] for s in symbols if s in cached}),
    )

    published_at = datetime(2026, 5, 5, 12, 10, 0)
    publish_calls: list[dict[str, object]] = []
    provider_snapshot_service = SimpleNamespace(
        build_market_snapshot_row=lambda **kwargs: {
            "symbol": kwargs["symbol"],
            "exchange": kwargs["exchange"],
            "row_hash": "row-hash",
            "normalized_payload": kwargs["normalized_payload"],
            "raw_payload": kwargs["raw_payload"],
        },
        publish_market_snapshot_run=lambda db, **kwargs: publish_calls.append(kwargs)
        or {
            "published": True,
            "force_published": False,
            "source_revision": "fundamentals_v1_cn:20260505121000",
            "snapshot_key": kwargs["snapshot_key"],
            "coverage": dict(kwargs["coverage_stats"]),
            "warnings": list(kwargs["warnings"]),
            "coverage_thresholds": {
                "market": "CN",
                "active_coverage": 1.0,
                "min_active_coverage": 0.70,
                "missing_ratio": 0.0,
                "max_missing_ratio": 0.30,
            },
        },
        get_published_run=lambda db, snapshot_key: SimpleNamespace(
            published_at=published_at,
            created_at=published_at,
            source_revision="fundamentals_v1_cn:20260505121000",
            coverage_stats_json=(
                '{"partial_run": true, "active_symbols": 3, '
                '"snapshot_symbols": 3, "missing_active_symbols": 0}'
            ),
        ),
        export_weekly_reference_bundle=lambda db, **kwargs: {"bundle_path": str(kwargs["output_path"])},
    )
    monkeypatch.setattr(
        build_script, "get_provider_snapshot_service", lambda: provider_snapshot_service
    )
    monkeypatch.setattr(
        "sys.argv",
        [
            "build_weekly_reference_bundle",
            "--market",
            "CN",
            "--output-dir",
            str(tmp_path),
            "--fetch-chunk-size",
            "2",
            "--resume-partial-seed",
        ],
    )

    assert build_script.main() == 0

    assert fetch_calls == [["600000.SS", "600001.SS"], ["000001.SZ"]]
    publish_kwargs = publish_calls[0]
    assert publish_kwargs["coverage_stats"]["seeded_symbols"] == 0
    assert publish_kwargs["coverage_stats"]["fetch_symbols"] == 3
    assert publish_kwargs["coverage_stats"]["attempted_symbols"] == 3


def test_import_weekly_reference_bundle_script_calls_service(monkeypatch, tmp_path, capsys):
    bundle_path = tmp_path / "weekly-reference.json.gz"
    bundle_path.write_bytes(b"bundle")
    monkeypatch.setattr(import_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(import_script, "SessionLocal", _fake_session)
    import_calls: list[tuple[Path, bool, str]] = []
    provider_snapshot_service = SimpleNamespace(
        import_weekly_reference_bundle=lambda db, input_path, hydrate_cache=True, hydrate_mode="static": (
            import_calls.append((input_path, hydrate_cache, hydrate_mode)) or {"rows": 10}
        ),
    )
    monkeypatch.setattr(import_script, "get_provider_snapshot_service", lambda: provider_snapshot_service)
    monkeypatch.setattr(
        "sys.argv",
        ["import_weekly_reference_bundle", "--input", str(bundle_path)],
    )

    assert import_script.main() == 0
    assert import_calls == [(bundle_path, True, "static")]
    assert "Weekly reference import complete:" in capsys.readouterr().out


def test_load_ibd_industry_groups_script_uses_csv_path(monkeypatch, tmp_path, capsys):
    csv_path = tmp_path / "IBD_industry_group.csv"
    csv_path.write_text("AAPL,Software\n", encoding="utf-8")
    monkeypatch.setattr(load_ibd_script, "prepare_runtime", lambda: None)
    monkeypatch.setattr(load_ibd_script, "SessionLocal", _fake_session)
    load_calls: list[str] = []
    monkeypatch.setattr(
        load_ibd_script.IBDIndustryService,
        "load_from_csv",
        lambda db, csv_path: load_calls.append(csv_path) or 1,
    )
    monkeypatch.setattr(
        "sys.argv",
        ["load_ibd_industry_groups", "--csv", str(csv_path)],
    )

    assert load_ibd_script.main() == 0
    assert load_calls == [str(csv_path)]
    assert "IBD industry group load complete:" in capsys.readouterr().out


# ---------------------------------------------------------------------------
# Official-source US weekly bundle (NASDAQ Trader directory + Yahoo).
# ---------------------------------------------------------------------------

_US_NASDAQ = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
APMD|Apnimed, Inc. - Common Stock|G|N|N|100|N|N
FAILCO|Fail Co - Common Stock|G|N|N|100|N|N
QQQ|Invesco QQQ Trust, Series 1|G|N|N|100|Y|N
File Creation Time: 1030202618:01|||||||
"""
_US_OTHER = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
SPY|SPDR S&P 500 ETF Trust|P|SPY|Y|100|N|SPY
IBM|International Business Machines Corporation Common Stock|N|IBM|N|100|N|IBM
File Creation Time: 1030202618:01||||||
"""


def _official_us_fixture(monkeypatch, tmp_path, *, failing=frozenset({"FAILCO"})):
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker

    from app.database import Base
    from app.domain.universe.ingestion import UniverseReconciliationPolicy
    from app.models.provider_snapshot import ProviderSnapshotPointer, ProviderSnapshotRow, ProviderSnapshotRun
    from app.models.stock import StockFundamental
    from app.models.stock_universe import StockUniverse, UNIVERSE_STATUS_ACTIVE
    from app.services.stock_universe_service import StockUniverseService
    from app.services.us_listing_directory import parse_directory

    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    db = sessionmaker(bind=engine, autocommit=False, autoflush=False)()
    seeded = [
        ("AAPL", "XNAS", "Apple Inc", "Technology", "Consumer Electronics"),
        ("IBM", "XNYS", "IBM", "Technology", "IT Services"),
        ("FAILCO", "XNAS", "Fail Co", "Industrials", "Tools"),
        ("SPY", "XNYS", "SPDR S&P 500 ETF Trust", "Financial", "Exchange Traded Fund"),
        ("QQQ", "XNAS", "Invesco QQQ Trust", "Financial", "Exchange Traded Fund"),
        ("GONE", "XNYS", "Delisted Co", "Energy", "Oil & Gas"),
    ]
    db.add_all([StockUniverse(symbol=s, market="US", exchange=e, name=n, sector=sec, industry=ind,
                              status=UNIVERSE_STATUS_ACTIVE, is_active=True, source="finviz") for s, e, n, sec, ind in seeded])
    run = ProviderSnapshotRun(snapshot_key="fundamentals_v1_us", run_mode="publish", status="published",
                              source_revision="fundamentals_v1_us:20260613143433", published_at=datetime(2026, 6, 13, 14, 34))
    db.add(run)
    db.flush()
    db.add(ProviderSnapshotPointer(snapshot_key="fundamentals_v1_us", run_id=run.id))
    db.add(ProviderSnapshotRow(run_id=run.id, symbol="AAPL", exchange="XNAS", row_hash="h",
                               normalized_payload_json=json.dumps({"ipo_date": "1980-12-12", "market_cap": 1.0,
                                                                   "institutional_ownership": 99.0})))
    # A seeded prior-bundle fundamentals row that must not leak into the fresh snapshot.
    db.add(StockFundamental(symbol="AAPL", market_cap=1.0))
    db.commit()

    service = StockUniverseService()
    policy = UniverseReconciliationPolicy(name="test_us_official", min_count=3, max_removed_percent=25.0,
                                          apply_destructive_enabled=True)
    monkeypatch.setattr(service, "_us_official_reconciliation_policy", lambda: policy)
    monkeypatch.setattr(service, "populate_universe", lambda *a, **k: pytest.fail("Finviz must not be called"))

    store: dict[str, dict] = {}
    fetched_batches: list[list[str]] = []

    class FakeCache:
        def get_many(self, symbols, **kwargs):
            return {symbol: store.get(symbol) for symbol in symbols}

        def invalidate_cache(self, symbol, market=None):
            store.pop(symbol, None)

    class FakeHybrid:
        def fetch_fundamentals_batch(self, symbols, **kwargs):
            assert kwargs["include_finviz"] is False
            fetched_batches.append(list(symbols))
            return {s: ({} if s in failing else {"symbol": s, "market_cap": 2e9, "sector": "Healthcare", "industry": "Biotech"})
                    for s in symbols}

        def store_all_caches(self, data, cache, **kwargs):
            for symbol, payload in data.items():
                if payload:
                    store[symbol] = payload
            return {"persisted_symbols": sum(1 for payload in data.values() if payload), "failed": sum(1 for p in data.values() if not p)}

    published: dict[str, object] = {}

    class FakeSnapshots:
        def get_published_run(self, db_, snapshot_key):
            return db_.query(ProviderSnapshotRun).filter_by(snapshot_key=snapshot_key).order_by(ProviderSnapshotRun.id.desc()).first()

        def build_market_snapshot_row(self, *, market, symbol, exchange, normalized_payload, raw_payload=None):
            return {"symbol": symbol, "exchange": exchange, "normalized_payload": normalized_payload}

        def publish_market_snapshot_run(self, db_, *, rows, coverage_stats, warnings, publish, **kwargs):
            published.update(rows=rows, coverage=coverage_stats, warnings=warnings, publish=publish)
            if publish:
                db_.add(ProviderSnapshotRun(snapshot_key="fundamentals_v1_us", run_mode="publish", status="published",
                                            source_revision=kwargs["source_revision"], published_at=datetime(2026, 11, 1, 3)))
                db_.commit()
            return {"published": publish, "coverage": coverage_stats, "warnings": warnings, "market": "US",
                    "coverage_thresholds": {"market": "US", "active_coverage": 1.0, "min_active_coverage": 0.98,
                                            "missing_ratio": 0.0, "max_missing_ratio": 0.005}}

        def export_weekly_reference_bundle(self, db_, **kwargs):
            kwargs["output_path"].write_bytes(b"bundle")
            kwargs["latest_manifest_path"].write_text("{}", encoding="utf-8")
            return {"bundle_path": str(kwargs["output_path"])}

    directory = parse_directory(nasdaq_listed=_US_NASDAQ, other_listed=_US_OTHER)
    kwargs = dict(
        provider_snapshot_service=FakeSnapshots(),
        stock_universe_service=service,
        output_dir=tmp_path,
        bundle_name=None,
        latest_manifest_name="weekly-reference-latest-us.json",
        fetch_directory=lambda: (directory, {"file_created_at": directory.file_created_at, "sha256": {"nasdaqlisted.txt": "a"}}),
        fundamentals_cache=FakeCache(),
        hybrid_service=FakeHybrid(),
    )
    return db, kwargs, store, fetched_batches, published, StockUniverse, StockFundamental


def test_official_us_bundle_refreshes_equities_without_finviz_or_stale_leaks(monkeypatch, tmp_path):
    db, kwargs, store, fetched, published, StockUniverse, StockFundamental = _official_us_fixture(
        monkeypatch, tmp_path, failing=frozenset())

    summary = build_script._build_us_official_bundle(db, **kwargs)

    universe = {row.symbol: row for row in db.query(StockUniverse).all()}
    assert universe["APMD"].is_active and universe["APMD"].exchange == "XNAS"
    assert not universe["GONE"].is_active
    assert universe["SPY"].exchange == "XNYS"
    # Funds are never sent to the fundamentals fetch.
    assert sorted(symbol for batch in fetched for symbol in batch) == ["AAPL", "APMD", "FAILCO", "IBM"]
    rows = {row["symbol"]: row["normalized_payload"] for row in published["rows"]}
    assert rows["SPY"]["fundamentals_applicable"] is False and rows["SPY"]["industry"] == "Exchange Traded Fund"
    assert rows["AAPL"]["market_cap"] == 2e9
    assert rows["AAPL"]["ipo_date"] == "1980-12-12"
    assert "institutional_ownership" not in rows["AAPL"]
    assert db.query(StockFundamental).filter_by(symbol="AAPL").count() == 0
    # A new listing gets its classification from the fresh fetch.
    assert universe["APMD"].sector == "Healthcare"
    coverage = published["coverage"]
    assert coverage["equity_fundamentals_coverage"] == 1.0
    assert coverage["fund_reference_symbols"] == 2
    assert coverage["universe_source"]["source"] == "nasdaqtrader_symdir"
    assert coverage["universe_source"]["removal"]["deactivated"] == 1
    assert published["publish"] is True
    assert summary["bundle"].name.startswith("weekly-reference-us-20261101-")
    db.close()


def test_official_us_bundle_blocks_when_operating_company_coverage_is_short(monkeypatch, tmp_path):
    db, kwargs, store, fetched, published, *_ = _official_us_fixture(monkeypatch, tmp_path)

    with pytest.raises(RuntimeError, match="did not publish"):
        build_script._build_us_official_bundle(db, **kwargs)

    assert published["publish"] is False
    assert published["coverage"]["fresh_equity_symbols"] == 3
    assert published["warnings"][0] == "Equity fundamentals coverage 75.00% below minimum 98.00%"
    db.close()
