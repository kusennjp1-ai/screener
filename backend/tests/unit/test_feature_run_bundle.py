"""Feature-run bundle round-trip: dump the published run, import into a fresh DB.

Pins the fast-price-publish contract: the fast CI job starts with an empty
feature store, imports the bundle the previous full build uploaded, and
``export_static_site --prices-only`` then finds a published run to re-export.
"""
from __future__ import annotations

from datetime import date
from pathlib import Path

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
