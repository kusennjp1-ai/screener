"""Offline ordinary-source compiler contract; never contacts a provider.

The four cases run the production market exporter and genuine SQL feature
source/group builders, then the unchanged scanner and approved JS compiler
twice. The observation check is the pure extractor, not authenticated release
admission. No Vite, artifact, publication, or external account is involved.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time

# The copied direct driver must verify process guards before importing app
# modules. Ordinary pytest collection does not execute the fixture driver.
if __name__ == "__main__":
    import socket
    from curl_cffi import requests as guarded_curl
    assert os.environ.get("ORDINARY_NETWORK_GUARD_ACTIVE") == "python-v1"
    assert os.environ.get("ORDINARY_NATIVE_HTTP_GUARD_ACTIVE") == "curl-cffi-v1"
    assert socket.socket.connect.__module__ == "sitecustomize"
    assert guarded_curl.Session.request.__module__ == "sitecustomize"
    assert guarded_curl.AsyncSession.request.__module__ == "sitecustomize"

import pandas as pd
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.infra.db.models.feature_store import (
    FeatureRun, FeatureRunPointer, FeatureRunUniverseSymbol, StockFeatureDaily,
)
from app.models.stock import StockFundamental, StockPrice
from app.models.stock_universe import StockUniverse
from app.services import static_site_export_service as export_module
from app.services.eps_rating_service import EPSRatingService
from app.services.financial_source_capture import _statement_subset, statement_evidence
from app.services.financial_source_evidence import make_capture_context, make_envelope
from app.services.growth_cadence_service import compute_cadence_aware_growth

REPO = Path(__file__).resolve().parents[3]
SOURCE_COMMIT = "cb62a4795edae492ab8dfa77bf5e23e019e4b319"
NODE_VERSION = "v22.23.3"
FEATURE_DATE = date(2026, 10, 6)
FIXTURE_EXPORT_INSTANT = "2026-10-08T00:00:00Z"
CAPTURED_AT = "2026-10-06T18:00:00.000Z"
VALID_SYMBOLS = tuple(f"SYN{index:03d}" for index in range(100))
REMAINDER = "SYNREMAINDER"
SYMBOLS = (*VALID_SYMBOLS, REMAINDER)
WITHHELD_FIELDS = (
    "market_regime", "market_health", "market_exposure_pct",
    "market_distribution_days", "market_ftd_date", "market_ftd_days_since",
    "market_above_50dma", "market_above_200dma", "market_50_above_200dma",
    "ibd_group_rank", "acc_dis_rating",
)
SOURCE_PINS = {
    "backend/app/scripts/export_static_site.py": "74b8a15ac0d70cb1c3881eebc7da807c2a487526",
    "backend/app/services/static_price_session_audit.py": "6038dedff09a317dc1ec5f8a1a723a24596ad40c",
    "backend/app/infra/db/repositories/feature_store_repo.py": "45114e237a22414469db939f6bfd881ee6fb0ac0",
    "backend/app/schemas/scanning.py": "1de0aa3732f0e2d6a4eba02ecc863ef38fdb9566",
    "backend/app/services/static_financial_evidence.py": "d5fdd07f86ad2b53921681abaf8adf7707388fd5",
    "frontend/tools/recalculate-setups.py": "38bfd5d4f031818924dd92683700ed44059bb4ae",
    "frontend/tools/export-research.mjs": "dac7f8784a0bc836ab6977e1e88ca643c49c01ed",
    "frontend/src/static/financialCurrent.js": "5c7a2b16b09149cab4498f1bc0d4d210a65a6a65",
    "frontend/src/static/qualificationAudit.js": "73dc1b9ac9c51d03bc2f63e2ffd2f6240e3a5502",
    ".github/scripts/price-observations.mjs": "df8650fb08c80c3108602901dece6247ac476da6",
    "frontend/tools/check-data-quality.mjs": "46cdf998cca32f5d052774a18ae48ace87e28bed",
    "frontend/tools/check-data-quality-core.mjs": "6035cab1a3c0e20cba063f7b0502e8668c429be5",
    "frontend/tools/check-data-quality-financial.mjs": "57618d3271b500c29b502f63a01779184000c2b7",
    ".github/workflows/static-site.yml": "e56f50517a7c4a001f50f9d1d82591963e685cc9",
}

PYTHON_GUARD = r"""
import os
import socket
def denied(*args, **kwargs):
    with open(os.environ["ORDINARY_NETWORK_GUARD_LOG"], "a", encoding="utf-8") as out:
        out.write("python network denied\n")
    raise RuntimeError("offline ordinary-source integration forbids network")
original_connect = socket.socket.connect
original_connect_ex = socket.socket.connect_ex
def connect(self, *args, **kwargs):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        return denied(*args, **kwargs)
    return original_connect(self, *args, **kwargs)
def connect_ex(self, *args, **kwargs):
    if self.family in (socket.AF_INET, socket.AF_INET6):
        return denied(*args, **kwargs)
    return original_connect_ex(self, *args, **kwargs)
socket.socket.connect = connect
socket.socket.connect_ex = connect_ex
socket.create_connection = denied
socket.getaddrinfo = denied
# Native libcurl bypasses Python socket wrappers. Match the original isolated
# workflow's Session/AsyncSession fail-before-I/O boundary.
try:
    from curl_cffi import requests as _curl_requests
except ImportError:
    _curl_requests = None
if _curl_requests is not None:
    def _curl_request(*args, **kwargs):
        return denied(*args, **kwargs)
    async def _curl_async_request(*args, **kwargs):
        return denied(*args, **kwargs)
    _curl_requests.Session.request = _curl_request
    if hasattr(_curl_requests, "AsyncSession"):
        _curl_requests.AsyncSession.request = _curl_async_request
    os.environ["ORDINARY_NATIVE_HTTP_GUARD_ACTIVE"] = "curl-cffi-v1"
os.environ["ORDINARY_NETWORK_GUARD_ACTIVE"] = "python-v1"
"""

NODE_GUARD = r"""
const fs = require('node:fs');
const denied = () => {
  fs.appendFileSync(process.env.ORDINARY_NETWORK_GUARD_LOG, 'node network denied\n');
  throw Error('offline ordinary-source integration forbids network');
};
for (const name of ['node:http', 'node:https']) {
  const module = require(name);
  module.request = denied;
  module.get = denied;
}
require('node:net').Socket.prototype.connect = denied;
require('node:tls').connect = denied;
require('node:dns').lookup = denied;
require('node:dns').resolve = denied;
globalThis.fetch = denied;
process.env.ORDINARY_NETWORK_GUARD_ACTIVE = 'node-v1';
"""

NODE_RECEIPT = r"""
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodeResearchIndex } from './frontend/src/static/researchTransport.js';
import { extractPriceObservations } from './.github/scripts/price-observations.mjs';
if (process.env.ORDINARY_NETWORK_GUARD_ACTIVE !== 'node-v1') throw Error('Node guard not active');
const root = resolve('frontend/public/static-data');
const read = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'));
const manifest = read('manifest.json'), entry = manifest.markets.US;
const index = decodeResearchIndex(read(entry.assets.research.path));
const rows = index.rows.map(summary => read(summary.research_detail_path));
let observations;
try {
  const value = extractPriceObservations({dataRoot:root, manifest});
  observations = {status:'passed', chart_count:Object.keys(value).filter(key=>JSON.parse(key)[1]==='chart').length};
} catch (error) {
  observations = {status:'rejected', error:error.message};
}
const audit = read(entry.assets.price_session_audit.path);
const groups = read(entry.pages.groups.path);
const home = read(entry.pages.home.path);
const first = rows.find(row => row.symbol === 'SYN000');
const remainder = rows.find(row => row.symbol === 'SYNREMAINDER');
console.log(JSON.stringify({
  symbols:rows.map(row=>row.symbol).sort(),
  fresh_rs_count:rows.filter(row=>row.technical_audit?.valid === true && typeof row.rs_rating === 'number' && row.rs_as_of_date === index.as_of_date && row.rs_universe_size === 100).length,
  fresh_rs_values:rows.filter(row=>row.technical_audit?.valid === true).map(row=>row.rs_rating),
  source_rs_values:rows.filter(row=>row.technical_audit?.valid === true).map(row=>row.source_rs_rating),
  first:{as_of_date:first.as_of_date, financial_current:first.financial_current,
    financial_historical:first.financial_historical,
    financial_state:first.financial_current_state.fields.eps_growth_qq,
    withheld:Object.fromEntries(JSON.parse(process.env.ORDINARY_WITHHELD_FIELDS).map(key=>[key,Object.hasOwn(first,key)?first[key]:'__missing__']))},
  remainder:{current_price:remainder.current_price, adv_usd:remainder.adv_usd,
    valid:remainder.technical_audit.valid, setup_status:remainder.setup_recalculation.status},
  group_date:groups.payload.rankings.date,
  group_rs:groups.payload.rankings.rankings.map(row=>row.avg_rs_rating),
  home_scan_date:home.freshness.scan_as_of_date,
  entry:{price_as_of_date:entry.price_as_of_date,feature_as_of_date:entry.feature_as_of_date},
  backend:{total:audit.total,verified:audit.verified,passed:audit.passed,
    remainder:audit.results.find(row=>row.symbol==='SYNREMAINDER')},
  consumer:read('data-quality.json'),
  observations
}));
"""


def _blob(path: Path) -> str:
    content = path.read_bytes()
    return hashlib.sha1(b"blob " + str(len(content)).encode() + b"\0" + content).hexdigest()


def _write(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, allow_nan=False, separators=(",", ":")), encoding="utf-8")


def _read(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def _financial_source(symbol: str) -> dict:
    """Call the genuine statement arithmetic and source-capture producers."""
    quarterly = pd.DataFrame(
        [[3.0, 2.0, 1.7, 1.6, 2.0, 1.5], [150.0, 125.0, 120.0, 110.0, 100.0, 95.0]],
        index=["Diluted EPS", "Total Revenue"],
        columns=pd.to_datetime(["2026-06-30", "2026-03-31", "2025-12-31",
                                "2025-09-30", "2025-06-30", "2025-03-31"]),
    )
    annual = pd.DataFrame(
        [[5.0, 4.0, 3.0, 2.0, 1.0]], index=["Diluted EPS"],
        columns=pd.to_datetime(["2025-12-31", "2024-12-31", "2023-12-31",
                                "2022-12-31", "2021-12-31"]),
    )
    acquisitions = {}
    for attribute, frame in (("quarterly_income_stmt", quarterly), ("income_stmt", annual)):
        subset = _statement_subset(frame)
        prefix = "annual" if attribute == "income_stmt" else "quarterly"
        subset["source_rows"] = {
            row["metric"].lower().replace(" ", ""): {
                "provider_metric": prefix + row["metric"].replace(" ", ""),
                "values": {pd.Timestamp(column).date().isoformat(): value
                           for column, value in zip(subset["columns"], row["values"])},
                "currencies": ["USD"],
            } for row in subset["rows"]
        }
        acquisitions[attribute] = make_capture_context(
            symbol=symbol, market="US", source="yfinance",
            producer=f"yfinance.{attribute}/transport-capture-v1",
            provider_symbol=symbol, observed_at=CAPTURED_AT,
            source_payload=subset, capture_id=attribute,
        )
    growth = compute_cadence_aware_growth(quarterly, market="US", include_source_context=True)
    eps = EPSRatingService().calculate_eps_rating_data(annual, quarterly, include_source_context=True)
    contexts = {**growth.pop("_financial_source_context"), **eps.pop("_financial_source_context")}
    row = {**growth, **eps, "symbol": symbol, "market": "US"}
    row["financial_source_evidence"] = make_envelope(
        symbol=symbol, market="US", fields=statement_evidence(row, contexts, acquisitions),
    )
    return row


class _SyntheticPrices:
    def __init__(self, histories, benchmark):
        self.histories = histories
        self.benchmark = benchmark

    def get_many_cached_only(self, symbols, period="2y"):
        return {symbol: self.get_cached_only(symbol, period=period) for symbol in symbols}

    def get_cached_only(self, symbol, period="2y"):
        # Published stocks never borrow benchmark/fallback data.
        if symbol in SYMBOLS:
            return self.histories.get(symbol)
        return self.benchmark


class _SyntheticFundamentals:
    def get_many_cached_only(self, symbols):
        return {symbol: None for symbol in symbols}


class _SyntheticBenchmark:
    def get_benchmark_candidates(self, market):
        return ("SPY",)

    def get_benchmark_symbol(self, market):
        return "SPY"


def _history(target: date, index: int) -> pd.DataFrame:
    dates = pd.bdate_range(end=target, periods=280, tz="UTC")
    closes = [30.0 + index * 0.7 + offset * (index + 5) / 1500.0
              + 0.03 * math.sin(offset / 8.0) for offset in range(len(dates))]
    return pd.DataFrame({
        "Open": [value - 0.08 for value in closes],
        "High": [value + 0.25 for value in closes],
        "Low": [value - 0.25 for value in closes],
        "Close": closes,
        "Volume": [1_000_000.0] * len(dates),
    }, index=dates)


def _copy_compiler(repo: Path) -> None:
    for relative in ("backend/app", "frontend/src", "frontend/tools",
                     "frontend/contracts", "contracts", ".github/scripts"):
        shutil.copytree(REPO / relative, repo / relative)
    shutil.copy2(REPO / "frontend/package.json", repo / "frontend/package.json")
    (repo / ".github/workflows").mkdir(parents=True)
    shutil.copy2(REPO / ".github/workflows/static-site.yml", repo / ".github/workflows/static-site.yml")
    own_path = Path("backend/tests/unit/test_price_session_ordinary_source_integration.py")
    (repo / own_path).parent.mkdir(parents=True)
    shutil.copy2(REPO / own_path, repo / own_path)
    assert (repo / own_path).read_bytes() == (REPO / own_path).read_bytes()
    (repo / "data/ibd_reference/ibd50").mkdir(parents=True)
    (repo / "integration-receipt.mjs").write_text(NODE_RECEIPT, encoding="utf-8")
    for path, expected in SOURCE_PINS.items():
        assert _blob(repo / path) == expected, f"Copied source pin drift: {path}"


def _guards(root: Path, repo: Path) -> dict:
    guard = root / "network-guard"
    guard.mkdir()
    (guard / "sitecustomize.py").write_text(PYTHON_GUARD, encoding="utf-8")
    (guard / "node-guard.cjs").write_text(NODE_GUARD, encoding="utf-8")
    log = guard / "denied.log"
    log.touch()
    for binary in ("curl", "wget"):
        script = guard / binary
        script.write_text(
            '#!/bin/sh\nprintf "shell network denied\\n" >> "$ORDINARY_NETWORK_GUARD_LOG"\nexit 97\n',
            encoding="utf-8",
        )
        script.chmod(0o700)
    env = os.environ.copy()
    for key in list(env):
        if key.startswith(("FINANCIAL_CORRECTION_", "FINANCIAL_CARRY_", "FINANCIAL_GENERATION_")):
            env.pop(key)
    env.update({
        "PYTHONPATH": os.pathsep.join((str(guard), str(repo / "backend"))),
        "NODE_OPTIONS": f"--require={guard / 'node-guard.cjs'}",
        "PATH": os.pathsep.join((str(guard), env.get("PATH", ""))),
        "ORDINARY_NETWORK_GUARD_LOG": str(log),
        "ORDINARY_WITHHELD_FIELDS": json.dumps(WITHHELD_FIELDS),
        "REDIS_ENABLED": "false",
        "STATIC_SITE_CODE33": "0",
    })
    return env


def _run(args, *, cwd: Path, env: dict, deadline: float):
    remaining = deadline - time.monotonic()
    assert remaining > 0, "Ordinary-source per-case 110-second budget exhausted"
    result = subprocess.run(args, cwd=cwd, env=env, text=True, capture_output=True,
                            timeout=remaining, check=False)
    assert result.returncode == 0, (
        f"{args[0]} {args[1:]} exited {result.returncode}\n"
        f"stdout tail: {result.stdout[-3000:]}\nstderr tail: {result.stderr[-3000:]}"
    )
    return result


class _FixtureExportDateTime(datetime):
    """A test-only containing/export clock; original source clocks stay intact."""
    @classmethod
    def utcnow(cls):
        return cls(2026, 10, 8, 0, 0, 0)


def _build_backend_fixture(tmp_path: Path, session: str, remainder_kind: str) -> None:
    assert session in ("later", "same") and remainder_kind in ("missing", "duplicate")
    assert os.environ.get("ORDINARY_NETWORK_GUARD_ACTIVE") == "python-v1"
    assert os.environ.get("ORDINARY_NATIVE_HTTP_GUARD_ACTIVE") == "curl-cffi-v1"
    assert Path(export_module.__file__).resolve() == (REPO / "backend/app/services/static_site_export_service.py").resolve()
    for path, expected in SOURCE_PINS.items():
        assert _blob(REPO / path) == expected, f"Backend fixture source pin drift: {path}"
    with pytest.MonkeyPatch.context() as monkeypatch:
        monkeypatch.setattr(export_module, "datetime", _FixtureExportDateTime)
        target = date(2026, 10, 7) if session == "later" else FEATURE_DATE
        histories = {symbol: _history(target, index) for index, symbol in enumerate(VALID_SYMBOLS)}
        if remainder_kind == "duplicate":
            frame = _history(target, 100)
            histories[REMAINDER] = pd.concat((frame.iloc[:30], frame.iloc[29:]))
        benchmark = _history(target, 0)
        monkeypatch.setattr(export_module, "get_price_cache", lambda: _SyntheticPrices(histories, benchmark))
        monkeypatch.setattr(export_module, "get_fundamentals_cache", _SyntheticFundamentals)
        monkeypatch.setattr(export_module, "get_benchmark_cache", _SyntheticBenchmark)
        # Only optional rendering selection is bounded; all cached scan histories,
        # actual serialization, coverage, groups, breadth and home remain genuine.
        monkeypatch.setattr(export_module, "STATIC_CHART_LIMIT", 0)
        monkeypatch.setattr(export_module, "STATIC_CHART_PRESET_TOP_N", 0)
        monkeypatch.setattr(export_module, "STATIC_CHART_TOP_N_GROUPS", 0)

        engine = create_engine("sqlite:///:memory:")
        Base.metadata.create_all(engine, tables=[
            FeatureRun.__table__, FeatureRunPointer.__table__,
            FeatureRunUniverseSymbol.__table__, StockFeatureDaily.__table__,
            StockUniverse.__table__, StockFundamental.__table__, StockPrice.__table__,
        ])
        factory = sessionmaker(bind=engine, expire_on_commit=False)
        source_envelopes = {}
        try:
            with factory() as db:
                db.add(FeatureRun(
                    id=42, as_of_date=FEATURE_DATE, run_type="daily_snapshot", status="published",
                    published_at=datetime(2026, 10, 6, 21, tzinfo=timezone.utc),
                    config_json={"universe": {"market": "US"}},
                ))
                db.add(FeatureRunPointer(key="latest_published_market:US", run_id=42))
                for index, symbol in enumerate(SYMBOLS):
                    details = _financial_source(symbol)
                    source_envelopes[symbol] = deepcopy(details["financial_source_evidence"])
                    details.update({
                        "current_price": 100.0, "avg_dollar_volume": 100_000_000.0,
                        "rs_rating": 95.0, "rs_rating_1m": 94.0, "rs_rating_3m": 93.0,
                        "rs_rating_12m": 92.0, "ibd_industry_group": "Software" if index % 2 else "Semiconductors",
                        "gics_sector": "Technology", "market_cap": 1_000_000_000.0,
                        "minervini_score": 95.0, "canslim_score": 93.0, "composite_method": "weighted_average",
                        "passes_template": True, "stage": 2, "data_status": "full", "is_scannable": True,
                        "scan_mode": "full", "history_bars": 280,
                        "market_regime": "confirmed_uptrend", "market_health": 90.0, "market_exposure_pct": 100,
                        "market_distribution_days": 0, "market_ftd_date": "2026-10-01", "market_ftd_days_since": 3,
                        "market_above_50dma": True, "market_above_200dma": True, "market_50_above_200dma": True,
                        "ibd_group_rank": 1, "acc_dis_rating": 95,
                        "setup_engine": {"setup_score": 95.0, "pivot_price": 110.0, "setup_ready": True},
                    })
                    db.add(StockUniverse(symbol=symbol, name=f"{symbol} common stock", market="US",
                                         exchange="NASDAQ", currency="USD", source="synthetic", is_etf=False))
                    db.add(StockFundamental(symbol=symbol, adv_usd=25_000_000.0,
                                            market_cap_usd=1_000_000_000.0))
                    db.add(StockFeatureDaily(run_id=42, symbol=symbol, as_of_date=FEATURE_DATE,
                                            composite_score=95.0, overall_rating=5, details_json=details))
                    db.add(FeatureRunUniverseSymbol(run_id=42, symbol=symbol))
                db.commit()

            service = export_module.StaticSiteExportService(factory)
            market_root = tmp_path / "market-artifacts/static-market-US"
            result = service.export(market_root, markets=("US",), write_manifest=False, price_as_of_date=target)
            assert result.manifest["markets"]["US"]["as_of_date"] == target.isoformat()
            entry = result.manifest["markets"]["US"]
            audit_ref = deepcopy(entry["assets"]["price_session_audit"])
            audit_bytes = (market_root / audit_ref["path"]).read_bytes()
            assert hashlib.sha256(audit_bytes).hexdigest() == audit_ref["sha256"]
            audit = json.loads(audit_bytes)
            assert (audit["source_universe_count"], audit["total"], audit["verified"], audit["passed"]) == (101, 101, 100, True)
            required = next(record for record in audit["results"] if record["symbol"] == REMAINDER)
            assert required["baseline_liquid"] and required["required"] and not required["valid"]

            scan = _read(market_root / entry["pages"]["scan"]["path"])
            backend_rows = {
                row["symbol"]: row for ref in scan["chunks"]
                for row in _read(market_root / ref["path"])["rows"]
            }
            assert set(backend_rows) == set(SYMBOLS)
            for row in backend_rows.values():
                assert row["as_of_date"] == target.isoformat()
                assert row["feature_as_of_date"] == FEATURE_DATE.isoformat()
                assert row["price_as_of_date"] == target.isoformat()
                assert row["source_rs_rating"] == 95.0 and row["rs_rating"] is None
                assert all(field in row and row[field] is None for field in WITHHELD_FIELDS)
                assert row["financial_current"]["a"] == FEATURE_DATE.isoformat()
                assert row["financial_source_evidence"] == source_envelopes[row["symbol"]]
            initial_financial = deepcopy(backend_rows[VALID_SYMBOLS[0]]["financial_current"])
            assert initial_financial["r"][0] == "0", "Fixture must contain genuine source-valid EPS proof"
            assert backend_rows[REMAINDER]["current_price"] is None
            assert backend_rows[REMAINDER]["adv_usd"] is None
            original_groups = _read(market_root / entry["pages"]["groups"]["path"])
            assert original_groups["available"] is True, "Real original-date groups must not silently disappear"
            assert original_groups["payload"]["rankings"]["date"] == FEATURE_DATE.isoformat()
            assert original_groups["payload"]["rankings"]["rankings"]
            assert all(row["avg_rs_rating"] == 95.0 for row in original_groups["payload"]["rankings"]["rankings"])


            copied_data = REPO / "frontend/public/static-data"
            export_module.StaticSiteExportService.combine_market_artifacts(tmp_path / "market-artifacts", copied_data)
            combined_entry = _read(copied_data / "manifest.json")["markets"]["US"]
            assert combined_entry["assets"]["price_session_audit"] == audit_ref
            assert (copied_data / audit_ref["path"]).read_bytes() == audit_bytes
            assert _read(copied_data / entry["pages"]["groups"]["path"]) == original_groups
            _write(tmp_path / "benchmark-bars.json", service._serialize_chart_bars(benchmark))
            _write(tmp_path / "fixture.json", {
                "audit_ref": audit_ref, "initial_financial": initial_financial,
                "first_source_envelope": source_envelopes[VALID_SYMBOLS[0]],
                "group_path": entry["pages"]["groups"]["path"],
                "group_sha256": hashlib.sha256((market_root / entry["pages"]["groups"]["path"]).read_bytes()).hexdigest(),
                "actual_service_blob": _blob(Path(export_module.__file__)),
            })
            with factory() as db:
                assert db.get(FeatureRun, 42).as_of_date == FEATURE_DATE
                for feature in db.query(StockFeatureDaily).filter(StockFeatureDaily.run_id == 42):
                    assert feature.details_json["financial_source_evidence"] == source_envelopes[feature.symbol]
                    assert feature.details_json["rs_rating"] == 95.0
        finally:
            engine.dispose()


@pytest.mark.parametrize(
    ("session", "remainder_kind"),
    [("later", "missing"), ("later", "duplicate"), ("same", "missing"), ("same", "duplicate")],
    ids=["later-missing", "later-duplicate", "same-missing", "same-duplicate"],
)
def test_ordinary_price_session_compiler_contract(tmp_path, session, remainder_kind):
    """101 source stocks survive both compiler passes; no fake quality pass."""
    deadline = time.monotonic() + 110
    node = shutil.which("node")
    assert node is not None, f"Required exact Node runtime {NODE_VERSION} is missing"
    for path, expected in SOURCE_PINS.items():
        assert _blob(REPO / path) == expected, f"Approved source pin drift: {path}"
    workflow = (REPO / ".github/workflows/static-site.yml").read_text(encoding="utf-8")
    assert "path: /tmp/static-data/diagnostics/" in workflow
    assert "node tools/export-research.mjs" in workflow
    assert "npm run build" in workflow
    assert "node tools/export-research.mjs" in json.loads((REPO / "frontend/package.json").read_text())["scripts"]["build"]

    copied_repo = tmp_path / "repo"
    _copy_compiler(copied_repo)
    frontend = copied_repo / "frontend"
    data = frontend / "public/static-data"
    env = _guards(tmp_path, copied_repo)
    assert _run([node, "--version"], cwd=copied_repo, env=env, deadline=deadline).stdout.strip() == NODE_VERSION
    _run([sys.executable, str(copied_repo / "backend/tests/unit/test_price_session_ordinary_source_integration.py"),
          "--fixture", str(tmp_path), session, remainder_kind],
         cwd=copied_repo, env=env, deadline=deadline)
    target = date(2026, 10, 7) if session == "later" else FEATURE_DATE
    fixture = _read(tmp_path / "fixture.json")
    audit_ref = fixture["audit_ref"]
    audit_bytes = (data / audit_ref["path"]).read_bytes()
    initial_financial = fixture["initial_financial"]
    first_source_envelope = fixture["first_source_envelope"]
    group_path, group_sha256 = fixture["group_path"], fixture["group_sha256"]
    bars = _read(tmp_path / "benchmark-bars.json")
    _write(data / "book-benchmark.json", {
        "schema_version": "book-benchmark-v1", "symbol": "SPY",
        "as_of_date": target.isoformat(), "bars": bars, "source": "synthetic offline fixture",
    })
    _write(data / "sector-prices.json", {
        "as_of_date": target.isoformat(), "calendar": "NYSE",
        "adjustment": "split-adjusted-close-no-dividend", "series": {"SPY": bars},
        "sessions": [bar["date"] for bar in bars], "source": "synthetic offline fixture",
        "retrieved_at": CAPTURED_AT,
    })
    _write(data / "entry-context.json", {"as_of_date": target.isoformat(), "calendar": None, "earnings": {}})
    _write(data / "institutional-holdings.json", {"as_of_date": target.isoformat(), "results": {}})
    env["FINANCIAL_EVALUATED_AT"] = datetime.fromtimestamp(
        (initial_financial["t"] + 1000) / 1000, timezone.utc,
    ).isoformat()
    _run([sys.executable, str(frontend / "tools/recalculate-setups.py"), "--workers", "1"],
         cwd=frontend, env=env, deadline=deadline)
    setup_report = _read(data / "setup-recalculation-report.json")
    setups = {row["symbol"]: row for row in setup_report["results"]}
    assert set(setups) == set(SYMBOLS)
    assert all(setups[symbol]["status"] == "calculated" for symbol in VALID_SYMBOLS)
    assert setups[REMAINDER]["status"] == "unavailable"

    compiler_receipts = []
    for compiler_pass in (1, 2):
        _run([node, "tools/export-research.mjs"], cwd=frontend, env=env, deadline=deadline)
        output = _run([node, "integration-receipt.mjs"], cwd=copied_repo, env=env, deadline=deadline)
        receipt = json.loads(output.stdout)
        assert set(receipt["symbols"]) == set(SYMBOLS)
        assert receipt["fresh_rs_count"] == 100
        assert len(set(receipt["fresh_rs_values"])) > 90
        assert all(value == 95.0 for value in receipt["source_rs_values"])
        assert any(value != 95.0 for value in receipt["fresh_rs_values"])
        assert receipt["group_date"] == receipt["home_scan_date"] == FEATURE_DATE.isoformat()
        assert all(value == 95.0 for value in receipt["group_rs"])
        assert receipt["entry"] == {
            "price_as_of_date": target.isoformat(), "feature_as_of_date": FEATURE_DATE.isoformat(),
        }
        assert receipt["first"]["financial_current"] == initial_financial
        assert receipt["first"]["financial_historical"]["source_evidence"] == first_source_envelope
        assert all(value is None for value in receipt["first"]["withheld"].values())
        state = receipt["first"]["financial_state"]
        if session == "later":
            assert state["value"] is None and state["reason"] == "identity_mismatch"
            assert state.get("source_validated") is not True
        else:
            assert state["source_validated"] is True and state["availability"] == "current"
        assert receipt["remainder"] == {
            "current_price": None, "adv_usd": None, "valid": False, "setup_status": "unavailable",
        }
        assert (receipt["backend"]["total"], receipt["backend"]["verified"], receipt["backend"]["passed"]) == (101, 100, True)
        assert receipt["backend"]["remainder"]["baseline_liquid"]
        assert receipt["backend"]["remainder"]["required"]
        # The unchanged consumer's current-liquid view honestly differs
        # from the separately retained conservative backend denominator.
        assert receipt["consumer"]["total"] == receipt["consumer"]["verified"] == 100
        if remainder_kind == "missing":
            assert receipt["observations"] == {"status": "passed", "chart_count": 100}
        else:
            assert receipt["observations"]["status"] == "rejected"
            assert receipt["observations"]["error"] == "Duplicate price observation date"
        final_entry = _read(data / "manifest.json")["markets"]["US"]
        assert final_entry["assets"]["price_session_audit"] == audit_ref
        assert (data / audit_ref["path"]).read_bytes() == audit_bytes
        assert hashlib.sha256((data / group_path).read_bytes()).hexdigest() == group_sha256
        compiler_receipts.append({"pass": compiler_pass, "fresh_rs_count": 100,
                                  "strict_observations": receipt["observations"]["status"]})

    gate = _run([node, "tools/check-data-quality.mjs"], cwd=frontend, env=env, deadline=deadline)
    assert "Quality gate passed: 100/100 verified" in gate.stdout
    assert "Workbench gate passed:" in gate.stdout
    assert (tmp_path / "network-guard/denied.log").read_text(encoding="utf-8") == ""
    print(json.dumps({
        "case": f"{session}-{remainder_kind}", "approved_source_pins_from": SOURCE_COMMIT,
        "actual_service_blob": fixture["actual_service_blob"],
        "fixture_export_instant": FIXTURE_EXPORT_INSTANT,
        "source_universe": 101, "backend_required": 101, "backend_verified": 100,
        "consumer_current_liquid": 100, "fresh_rs_count": 100,
        "feature_date": FEATURE_DATE.isoformat(), "price_date": target.isoformat(),
        "financial_proof_date": initial_financial["a"], "source_capture": CAPTURED_AT,
        "original_group_date": FEATURE_DATE.isoformat(),
        "compiler_passes": compiler_receipts, "data_quality": "actually-executed-and-passed",
        "consumer_counts": {"total": receipt["consumer"]["total"], "verified": receipt["consumer"]["verified"]},
        "strict_observations": receipt["observations"],
        "network_attempts": 0,
    }, sort_keys=True))


if __name__ == "__main__":
    assert len(sys.argv) == 5 and sys.argv[1] == "--fixture", "Only the bounded synthetic fixture driver is supported"
    _build_backend_fixture(Path(sys.argv[2]), sys.argv[3], sys.argv[4])
