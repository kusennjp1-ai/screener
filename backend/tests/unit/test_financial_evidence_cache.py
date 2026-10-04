"""Real SQLite transaction, migration and Redis tests; no provider requests."""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import datetime
import importlib.util
import json
from pathlib import Path
import pickle
from threading import Barrier
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app.models.stock import StockFundamental
from app.services.fundamentals_cache_service import FundamentalsCacheService
from app.services.financial_source_evidence import make_capture_context, make_envelope, make_observed_record


class Redis:
    def __init__(self):
        self.values, self.writes, self.deleted = {}, [], []
        self.on_write = None
        self.fail = False

    def setex(self, key, ttl, value):
        if self.on_write:
            self.on_write(key, value)
        if self.fail:
            raise RuntimeError("Redis unavailable")
        self.writes.append((key, ttl, value))
        self.values[key] = value

    def get(self, key):
        return self.values.get(key)

    def delete(self, *keys):
        self.deleted.extend(keys)
        for key in keys:
            self.values.pop(key, None)

    def pipeline(self):
        queued = []
        return SimpleNamespace(get=lambda key: queued.append(key), execute=lambda: [self.get(key) for key in queued])


def payload(value=10.5, field="eps_growth_qq", capture_id="capture-1"):
    context = make_capture_context(symbol="ACME", market="US", source="yfinance",
        producer="fixture.statement/v1", provider_symbol="ACME", observed_at="2026-10-03T12:00:00Z",
        source_payload={"value": value, "field": field}, capture_id=capture_id)
    record = make_observed_record(field, value, context, unit="percent_points", basis="test-v1")
    return {"symbol": "ACME", "market": "US", field: value,
            "financial_source_evidence": make_envelope(symbol="ACME", market="US", fields={field: record})}


@pytest.fixture
def service(tmp_path, monkeypatch):
    import app.services.fundamentals_cache_service as module
    monkeypatch.setattr(module, "get_redis_client", lambda: None)
    engine = create_engine(f"sqlite:///{tmp_path / 'test.db'}", connect_args={"timeout": 15})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    redis = Redis()
    svc = FundamentalsCacheService(redis_client=redis, session_factory=factory, fx_service=MagicMock())
    monkeypatch.setattr(svc, "_resolve_market", lambda symbol: "US")
    monkeypatch.setattr(svc, "_enrich_with_quality_metadata", lambda symbol, data, market: market)
    monkeypatch.setattr(svc, "_enrich_with_fx_normalization", lambda *a, **k: None)
    monkeypatch.setattr(svc, "_ensure_field_availability_metadata", lambda *a, **k: False)
    monkeypatch.setattr(svc, "_needs_on_demand_enrichment", lambda *a, **k: False)
    monkeypatch.setattr(svc, "_needs_db_enrichment", lambda *a, **k: False)
    yield svc, factory, redis
    engine.dispose()


def test_all_database_and_redis_read_paths_round_trip_same_pair(service):
    svc, factory, redis = service
    original = payload(0)
    before = deepcopy(original)
    assert svc.store("ACME", original, market="US")
    assert original == before
    single, _ = svc._get_from_database("ACME")
    bulk, _ = svc._get_many_from_database(["ACME"])["ACME"]
    cached_only = svc.get_many_cached_only(["ACME"])["ACME"]
    redis_row = pickle.loads(redis.values[svc._redis_data_key("ACME", "US")])
    read_redis = svc.get_fundamentals("ACME", market="US")
    many_redis = svc.get_many(["ACME"], market="US")["ACME"]
    observation = before["financial_source_evidence"]["fields"]["eps_growth_qq"]
    for row in (single, bulk, cached_only, redis_row, read_redis, many_redis):
        assert row["eps_growth_qq"] == row["eps_growth_quarterly"] == 0
        assert row["financial_source_evidence"]["fields"]["eps_growth_qq"] == observation
        assert row["financial_source_evidence"] == single["financial_source_evidence"]
    assert redis.writes[0][1] == 604800


def test_missing_and_null_fields_keep_existing_pair_and_new_fields_replace_together(service):
    svc, factory, redis = service
    assert svc.store("ACME", payload(), market="US")
    original, _ = svc._get_from_database("ACME")
    assert svc.store("ACME", {"market_cap": 100, "eps_growth_qq": None}, market="US")
    missing, _ = svc._get_from_database("ACME")
    assert missing["eps_growth_qq"] == 10.5
    assert missing["financial_source_evidence"]["fields"]["eps_growth_qq"] == original["financial_source_evidence"]["fields"]["eps_growth_qq"]
    assert svc.store("ACME", payload(-1, capture_id="capture-2"), market="US")
    latest, _ = svc._get_from_database("ACME")
    assert latest["eps_growth_qq"] == -1
    assert latest["financial_source_evidence"]["fields"]["eps_growth_qq"]["capture_id"] == "capture-2"
    assert {r["capture_id"] for r in latest["financial_source_evidence"]["retained_candidates"]["eps_growth_qq"]} == {"capture-1", "capture-2"}


@pytest.mark.parametrize("new_value", [10.5, 0, -1])
def test_explicit_uninstrumented_value_cannot_keep_previous_observation(service, new_value):
    svc, factory, redis = service
    assert svc.store("ACME", payload(), market="US")
    assert svc.store("ACME", {"eps_growth_qq": new_value}, market="US")
    row, _ = svc._get_from_database("ACME")
    record = row["financial_source_evidence"]["fields"]["eps_growth_qq"]
    assert row["eps_growth_qq"] == record["value"] == new_value
    assert record["provenance_kind"] == "legacy_canonical_map"
    assert record["observed_at"] is None
    assert any(r.get("capture_id") == "capture-1" for r in row["financial_source_evidence"]["retained_candidates"]["eps_growth_qq"])


def test_direct_old_writer_mismatch_is_unknown_on_both_db_reads(service):
    svc, factory, redis = service
    assert svc.store("ACME", payload(), market="US")
    with factory() as db:
        row = db.query(StockFundamental).one()
        original = deepcopy(row.financial_source_evidence)
        row.eps_growth_quarterly = 99
        db.commit()
    for row in (svc._get_from_database("ACME")[0], svc._get_many_from_database(["ACME"])["ACME"][0]):
        assert row["eps_growth_qq"] == 99
        record = row["financial_source_evidence"]["fields"]["eps_growth_qq"]
        assert record["value"] == 99 and record["provenance_kind"] == "legacy_canonical_map"
    with factory() as db:
        assert db.query(StockFundamental).one().financial_source_evidence == original


def test_fields_without_scalar_columns_are_retained_in_envelope(service):
    svc, factory, redis = service
    assert svc.store("ACME", payload([0, -2.5, 8], field="annual_eps_growth_3y"), market="US")
    row, _ = svc._get_from_database("ACME")
    assert row["annual_eps_growth_3y"] == [0, -2.5, 8]
    assert svc.get_many_cached_only(["ACME"])["ACME"]["annual_eps_growth_3y"] == row["annual_eps_growth_3y"]


def test_db_failure_never_publishes_or_returns_uncommitted_observation(service, monkeypatch):
    svc, factory, redis = service
    assert svc.store("ACME", payload(10), market="US")
    previous_cache = dict(redis.values)
    writes = len(redis.writes)
    class FailingSession:
        def __init__(self):
            self.db = factory()
        def __getattr__(self, name):
            return getattr(self.db, name)
        def commit(self):
            raise RuntimeError("injected commit failure")
    monkeypatch.setattr(svc, "_session_factory", FailingSession)
    assert not svc.store("ACME", payload(25, capture_id="failed"), market="US")
    assert redis.values == previous_cache and len(redis.writes) == writes
    with factory() as db:
        row = db.query(StockFundamental).one()
        assert row.eps_growth_quarterly == 10
        assert row.financial_source_evidence["fields"]["eps_growth_qq"]["capture_id"] == "capture-1"
    import app.wiring.bootstrap as bootstrap
    monkeypatch.setattr(bootstrap, "get_data_source_service", lambda: SimpleNamespace(get_fundamentals=lambda *a, **k: payload(50, capture_id="fetch-failed")))
    monkeypatch.setattr(svc, "record_on_demand_fallback", lambda: None)
    assert svc._fetch_and_cache("ACME", market="US") is None
    assert redis.values == previous_cache


def test_redis_write_occurs_after_the_database_commit(service):
    svc, factory, redis = service
    def check_committed(key, raw):
        cached = pickle.loads(raw)
        with factory() as db:
            row = db.query(StockFundamental).one()
            assert row.eps_growth_quarterly == cached["eps_growth_qq"]
            assert row.financial_source_evidence["fields"] == cached["financial_source_evidence"]["fields"]
    redis.on_write = check_committed
    assert svc.store("ACME", payload(), market="US")


def test_redis_failure_leaves_previous_observation_clock_unchanged(service):
    svc, factory, redis = service
    assert svc.store("ACME", payload(), market="US")
    before = dict(redis.values)
    redis.fail = True
    assert svc.store("ACME", payload(30, capture_id="new"), market="US")
    assert redis.values == before
    with factory() as db:
        assert db.query(StockFundamental).one().eps_growth_quarterly == 30


def test_invalidate_removes_both_cache_generations(service):
    svc, factory, redis = service
    redis.values = {"fundamentals:US:ACME": b"old", "fundamentals:ACME": b"older", "fundamentals:US:ACME:financial-source-v1": b"new"}
    svc.invalidate_cache("ACME", market="US")
    assert redis.values == {}


def test_legacy_cache_namespace_is_not_read(service):
    svc, factory, redis = service
    redis.values["fundamentals:US:ACME"] = pickle.dumps(payload(99))
    assert svc.get_many(["ACME"], market="US")["ACME"] is None


def test_parallel_partial_writes_preserve_both_pairs_and_candidate_history(service):
    svc, factory, redis = service
    barrier = Barrier(2)
    def write(field, value, capture_id):
        barrier.wait(timeout=10)
        return svc._store_in_database("ACME", payload(value, field=field, capture_id=capture_id), market="US")
    with ThreadPoolExecutor(max_workers=2) as executor:
        a = executor.submit(write, "eps_growth_qq", 1, "eps")
        b = executor.submit(write, "sales_growth_qq", 2, "sales")
        assert a.result(timeout=20) and b.result(timeout=20)
    row, _ = svc._get_from_database("ACME")
    assert row["eps_growth_qq"] == 1 and row["sales_growth_qq"] == 2
    assert set(row["financial_source_evidence"]["fields"]) == {"eps_growth_qq", "sales_growth_qq"}


def test_migration_preserves_old_sqlite_rows_and_is_safe_for_new_metadata(tmp_path):
    path = Path(__file__).resolve().parents[2] / "alembic/versions/20261003_0026_add_financial_source_evidence.py"
    spec = importlib.util.spec_from_file_location("evidence_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(text("CREATE TABLE stock_fundamentals (id INTEGER PRIMARY KEY, symbol TEXT, eps_growth_quarterly FLOAT)"))
        conn.execute(text("INSERT INTO stock_fundamentals VALUES (1, 'ACME', 0)"))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            migration.upgrade()
        row = conn.execute(text("SELECT symbol, eps_growth_quarterly, financial_source_evidence FROM stock_fundamentals")).one()
        assert tuple(row) == ("ACME", 0, None)
        columns = inspect(conn).get_columns("stock_fundamentals")
        assert next(c for c in columns if c["name"] == "financial_source_evidence")["nullable"]
        with Operations.context(MigrationContext.configure(conn)):
            migration.downgrade()
        assert conn.execute(text("SELECT eps_growth_quarterly FROM stock_fundamentals")).scalar() == 0
    new_engine = create_engine(f"sqlite:///{tmp_path / 'new.db'}")
    Base.metadata.create_all(new_engine)
    with new_engine.begin() as conn, Operations.context(MigrationContext.configure(conn)):
        migration.upgrade()
    engine.dispose()
    new_engine.dispose()


def test_legacy_nullable_row_is_raw_unknown_without_a_source_clock(service):
    svc, factory, redis = service
    with factory() as db:
        db.add(StockFundamental(symbol="ACME", eps_growth_quarterly=0))
        db.commit()
    row, _ = svc._get_from_database("ACME")
    assert row["eps_growth_qq"] == 0
    evidence = row["financial_source_evidence"]["fields"]["eps_growth_qq"]
    assert evidence["provenance_kind"] == "legacy_canonical_map" and evidence["observed_at"] is None


def test_delayed_publisher_cannot_overwrite_newer_committed_cache_generation(service):
    svc, factory, redis = service
    # A commits and reads, then pauses before cache publication.
    assert svc._store_in_database("ACME", payload(10, capture_id="a"), market="US")
    older, _ = svc._get_from_database("ACME")
    # B commits/reads/publishes while A is paused.
    assert svc.store("ACME", payload(20, capture_id="b"), market="US")
    newer = dict(redis.values)
    svc._store_in_redis("ACME", older, market="US")
    assert redis.values == newer
    latest = pickle.loads(redis.values[svc._redis_data_key("ACME", "US")])
    assert latest["eps_growth_qq"] == 20
    assert latest["financial_source_evidence"]["storage_revision"] == 2
    assert latest["financial_source_evidence"]["fields"]["eps_growth_qq"]["capture_id"] == "b"
    # After invalidation the database still rejects the delayed publisher.
    svc.invalidate_cache("ACME", market="US")
    svc._store_in_redis("ACME", older, market="US")
    assert svc._redis_data_key("ACME", "US") not in redis.values


def test_imported_storage_revision_does_not_advance_local_generation(service):
    svc, factory, redis = service
    imported = payload()
    imported["financial_source_evidence"]["storage_revision"] = 9000
    assert svc.store("ACME", imported, market="US")
    assert svc._get_from_database("ACME")[0]["financial_source_evidence"]["storage_revision"] == 1


@pytest.mark.parametrize("bad", [[], "future", {"schema": "future-v2", "captures": None},
                                {"schema": "financial-source-evidence-v1", "fields": None, "captures": []}])
def test_malformed_envelope_cannot_break_valid_scalar_storage(service, bad):
    svc, factory, redis = service
    assert svc.store("ACME", {"eps_growth_qq": 7, "financial_source_evidence": bad}, market="US")
    row, _ = svc._get_from_database("ACME")
    assert row["eps_growth_qq"] == 7
    assert row["financial_source_evidence"]["fields"]["eps_growth_qq"]["provenance_kind"] == "legacy_canonical_map"


def test_postgres_advisory_lock_serializes_concurrent_source_pairs(monkeypatch):
    from app.database import engine
    if engine.dialect.name != "postgresql":
        pytest.skip("Runs in the existing PostgreSQL CI harness")
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    import app.services.fundamentals_cache_service as module
    monkeypatch.setattr(module, "get_redis_client", lambda: None)
    svc = FundamentalsCacheService(session_factory=factory, fx_service=MagicMock())
    barrier = Barrier(2)
    def write(field, value, capture_id):
        barrier.wait(timeout=10)
        return svc._store_in_database("ACME", payload(value, field=field, capture_id=capture_id), market="US")
    with ThreadPoolExecutor(max_workers=2) as executor:
        first = executor.submit(write, "eps_growth_qq", 1, "pg-a")
        second = executor.submit(write, "sales_growth_qq", 2, "pg-b")
        assert first.result(timeout=20) and second.result(timeout=20)
    row, _ = svc._get_from_database("ACME")
    assert row["eps_growth_qq"] == 1 and row["sales_growth_qq"] == 2
    assert row["financial_source_evidence"]["storage_revision"] == 2
    assert set(row["financial_source_evidence"]["fields"]) == {"eps_growth_qq", "sales_growth_qq"}


def test_database_rebuild_with_lower_revision_replaces_cache_safely(service):
    svc, factory, redis = service
    assert svc.store("ACME", payload(10, capture_id="a"), market="US")
    assert svc.store("ACME", payload(20, capture_id="b"), market="US")
    older_database_cache = svc._get_from_database("ACME")[0]
    with factory() as db:
        db.query(StockFundamental).filter_by(symbol="ACME").delete()
        db.commit()
    assert svc.store("ACME", payload(30, capture_id="rebuilt"), market="US")
    cached = pickle.loads(redis.values[svc._redis_data_key("ACME", "US")])
    assert cached["eps_growth_qq"] == 30
    assert cached["financial_source_evidence"]["storage_revision"] == 1
    svc._store_in_redis("ACME", older_database_cache, market="US")
    assert pickle.loads(redis.values[svc._redis_data_key("ACME", "US")])["eps_growth_qq"] == 30


def test_old_writer_conflicting_alias_is_preserved_raw_with_unknown_binding(service):
    svc, factory, redis = service
    assert svc.store("ACME", payload(5, field="eps_growth_yy"), market="US")
    with factory() as db:
        row = db.query(StockFundamental).one()
        row.eps_growth_annual = 999
        db.commit()
    row, _ = svc._get_from_database("ACME")
    assert row["eps_growth_annual"] == 999 and row["eps_growth_yy"] == 5
    assert row["financial_source_evidence"]["fields"]["eps_growth_yy"]["provenance_kind"] == "legacy_canonical_map"


def test_postgres_migration_adds_nullable_jsonb_without_rewriting_values():
    from app.database import engine
    if engine.dialect.name != "postgresql":
        pytest.skip("Runs in the existing PostgreSQL CI harness")
    path = Path(__file__).resolve().parents[2] / "alembic/versions/20261003_0026_add_financial_source_evidence.py"
    spec = importlib.util.spec_from_file_location("pg_evidence_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    # The shared harness starts with a fresh model-created schema. Verify that
    # migration is safe there, then exercise a genuinely pre-column table.
    with engine.begin() as conn:
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            migration.downgrade()
        assert "financial_source_evidence" not in {c["name"] for c in inspect(conn).get_columns("stock_fundamentals")}
        conn.execute(text("INSERT INTO stock_fundamentals (symbol, eps_growth_quarterly) VALUES ('ACME', 0)"))
        with Operations.context(MigrationContext.configure(conn)):
            migration.upgrade()
            migration.upgrade()
        column = next(c for c in inspect(conn).get_columns("stock_fundamentals") if c["name"] == "financial_source_evidence")
        assert column["nullable"] is True
        assert column["type"].__class__.__name__ == "JSONB"
        result = conn.execute(text("SELECT eps_growth_quarterly, financial_source_evidence FROM stock_fundamentals WHERE symbol = 'ACME'")).one()
        assert tuple(result) == (0, None)
