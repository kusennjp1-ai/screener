"""Feature-run bundle round-trip: dump the published run, import into a fresh DB.

Pins the fast-price-publish contract: the fast CI job starts with an empty
feature store, imports the bundle the previous full build uploaded, and
``export_static_site --prices-only`` then finds a published run to re-export.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path
from copy import deepcopy
import gzip
import json

import pytest

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app.infra.db.models.feature_store import (
    Base,
    FeatureRun,
    FeatureRunPointer,
    StockFeatureDaily,
)
import app.scripts.build_feature_run_bundle as build_mod
import app.scripts.import_feature_run_bundle as import_mod


def _session_factory():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return sessionmaker(bind=engine, expire_on_commit=False)


def _seed_published_run(factory) -> None:
    with factory() as db:
        run = FeatureRun(as_of_date=date(2026, 7, 8), run_type="daily_snapshot", status="published")
        db.add(run)
        db.flush()
        db.add_all([
            StockFeatureDaily(
                run_id=run.id, symbol="FTNT", as_of_date=date(2026, 7, 8),
                composite_score=85.8, overall_rating=3, passes_count=2,
                details_json={"fundamental_bonus": 9.0, "rs_rating": 91},
            ),
            StockFeatureDaily(
                run_id=run.id, symbol="LLY", as_of_date=date(2026, 7, 8),
                composite_score=70.1, overall_rating=2, passes_count=1,
                details_json={"rs_rating": 80},
            ),
        ])
        db.add(FeatureRunPointer(key="latest_published_market:US", run_id=run.id))
        db.commit()


def test_round_trip_into_fresh_database(tmp_path: Path, monkeypatch):
    source = _session_factory()
    _seed_published_run(source)
    monkeypatch.setattr(build_mod, "SessionLocal", source)

    result = build_mod.build_bundle("US", tmp_path)
    assert result["status"] == "built"
    assert result["row_count"] == 2

    # fresh database = the fast CI job's world
    target = _session_factory()
    monkeypatch.setattr(import_mod, "SessionLocal", target)
    imported = import_mod.import_bundle(Path(result["bundle_path"]))
    assert imported["status"] == "imported"
    assert imported["row_count"] == 2

    with target() as db:
        pointer = db.query(FeatureRunPointer).filter_by(key="latest_published_market:US").one()
        run = db.get(FeatureRun, pointer.run_id)
        assert run.status == "published"
        assert run.as_of_date == date(2026, 7, 8)
        rows = {r.symbol: r for r in db.query(StockFeatureDaily).filter_by(run_id=run.id)}
        assert rows["FTNT"].details_json["fundamental_bonus"] == 9.0
        assert rows["LLY"].composite_score == 70.1

    # idempotency: importing the same bundle again is a no-op
    again = import_mod.import_bundle(Path(result["bundle_path"]))
    assert again["status"] == "up_to_date"


def test_build_without_published_run_reports_cleanly(tmp_path: Path, monkeypatch):
    empty = _session_factory()
    monkeypatch.setattr(build_mod, "SessionLocal", empty)
    assert build_mod.build_bundle("US", tmp_path)["status"] == "no_published_run"


@pytest.mark.parametrize("change", ["source_evidence", "value", "symbol", "metadata"])
def test_same_date_and_count_with_changed_content_preserves_prior_generation(
    tmp_path: Path, monkeypatch, change,
):
    source = _session_factory()
    _seed_published_run(source)
    monkeypatch.setattr(build_mod, "SessionLocal", source)
    built = build_mod.build_bundle("US", tmp_path)
    path = Path(built["bundle_path"])
    original = json.loads(gzip.decompress(path.read_bytes()))
    target = _session_factory()
    monkeypatch.setattr(import_mod, "SessionLocal", target)
    first = import_mod.import_bundle(path)

    revised = deepcopy(original)
    if change == "source_evidence":
        revised["rows"][0]["details_json"]["financial_source_evidence"] = {
            "schema": "financial-source-evidence-v1", "symbol": "FTNT", "market": "US",
            "fields": {},
            "legacy_statement_context": {"recent_quarter_date": "2026-03-31"},
        }
    elif change == "value":
        revised["rows"][0]["composite_score"] = 84.0
    elif change == "symbol":
        revised["rows"][0]["symbol"] = "SYNTHETIC"
    else:
        revised["run"]["config_json"] = {"source_contract": "synthetic-v1"}
    path.write_bytes(gzip.compress(json.dumps(revised).encode()))
    second = import_mod.import_bundle(path)
    assert second["status"] == "imported"
    assert second["run_id"] != first["run_id"]
    with target() as db:
        old_rows = db.query(StockFeatureDaily).filter_by(run_id=first["run_id"]).order_by(StockFeatureDaily.symbol).all()
        assert [import_mod._stored_row_payload(row) for row in old_rows] == original["rows"]
        pointer = db.query(FeatureRunPointer).filter_by(key="latest_published_market:US").one()
        assert pointer.run_id == second["run_id"]
        current = db.query(StockFeatureDaily).filter_by(run_id=second["run_id"]).order_by(StockFeatureDaily.symbol).all()
        assert [import_mod._stored_row_payload(row) for row in current] == sorted(revised["rows"], key=lambda row: row["symbol"])
    assert import_mod.import_bundle(path)["status"] == "up_to_date"


def test_export_clock_and_row_order_do_not_create_a_new_observation(tmp_path: Path, monkeypatch):
    source = _session_factory()
    _seed_published_run(source)
    monkeypatch.setattr(build_mod, "SessionLocal", source)
    path = Path(build_mod.build_bundle("US", tmp_path)["bundle_path"])
    target = _session_factory()
    monkeypatch.setattr(import_mod, "SessionLocal", target)
    first = import_mod.import_bundle(path)
    payload = json.loads(gzip.decompress(path.read_bytes()))
    payload["generated_at"] = "2030-01-01T00:00:00Z"
    payload["run"]["published_at"] = "2030-01-01T00:00:00Z"
    payload["rows"].reverse()
    path.write_bytes(gzip.compress(json.dumps(payload).encode()))
    again = import_mod.import_bundle(path)
    assert again["status"] == "up_to_date"
    assert again["run_id"] == first["run_id"]


def test_failed_replacement_keeps_old_rows_and_pointer(tmp_path: Path, monkeypatch):
    from sqlalchemy.exc import IntegrityError

    source = _session_factory()
    _seed_published_run(source)
    monkeypatch.setattr(build_mod, "SessionLocal", source)
    path = Path(build_mod.build_bundle("US", tmp_path)["bundle_path"])
    target = _session_factory()
    monkeypatch.setattr(import_mod, "SessionLocal", target)
    first = import_mod.import_bundle(path)
    payload = json.loads(gzip.decompress(path.read_bytes()))
    payload["rows"] = [payload["rows"][0], deepcopy(payload["rows"][0])]
    path.write_bytes(gzip.compress(json.dumps(payload).encode()))
    with pytest.raises(IntegrityError):
        import_mod.import_bundle(path)
    with target() as db:
        pointer = db.query(FeatureRunPointer).filter_by(key="latest_published_market:US").one()
        assert pointer.run_id == first["run_id"]
        assert db.query(FeatureRun).count() == 1
        assert db.query(StockFeatureDaily).count() == 2


@pytest.mark.parametrize("location", ["details", "config", "stats"])
def test_json_boolean_and_number_are_different_generation_content(tmp_path, monkeypatch, location):
    source = _session_factory()
    _seed_published_run(source)
    monkeypatch.setattr(build_mod, "SessionLocal", source)
    path = Path(build_mod.build_bundle("US", tmp_path)["bundle_path"])
    payload = json.loads(gzip.decompress(path.read_bytes()))
    if location == "details":
        container = payload["rows"][0]["details_json"]
    else:
        container = payload["run"][location + "_json"] = {}
    container["financial_source_evidence"] = {"fields": {"eps_growth_yy": {"value": False}}}
    path.write_bytes(gzip.compress(json.dumps(payload).encode()))
    target = _session_factory()
    monkeypatch.setattr(import_mod, "SessionLocal", target)
    first = import_mod.import_bundle(path)
    container["financial_source_evidence"]["fields"]["eps_growth_yy"]["value"] = 0
    path.write_bytes(gzip.compress(json.dumps(payload).encode()))
    second = import_mod.import_bundle(path)
    assert second["status"] == "imported"
    assert second["run_id"] != first["run_id"]
    assert import_mod.import_bundle(path)["status"] == "up_to_date"
