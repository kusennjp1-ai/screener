"""Snapshot transport must not restamp or detach field-bound evidence."""
from copy import deepcopy
from datetime import datetime
import json

import pytest

from app.models.provider_snapshot import ProviderSnapshotPointer, ProviderSnapshotRow, ProviderSnapshotRun
from app.models.stock_universe import StockUniverse, UNIVERSE_STATUS_ACTIVE
from app.services.financial_source_evidence import make_capture_context, make_envelope, make_observed_record, merge_financial_payloads, validate_envelope
from app.services.provider_snapshot_service import ProviderSnapshotService, _normalized_payload_sha256
from tests.unit.test_provider_snapshot_service import _make_provider_snapshot_service, _make_session, _StubFundamentalsCache


def _payload(value=-10., field="eps_growth_yy", observed_at="2026-10-01T10:00:00.000Z"):
    context = make_capture_context(symbol="AAPL", market="US", source="yfinance", producer="test.captured_statement/v1", provider_symbol="AAPL", observed_at=observed_at, source_payload={"selected_source_value": value})
    record = make_observed_record(field, value, context, unit="percent_points", basis="comparable_period_yoy/v1", period_end="2026-06-30", comparable_period_end="2025-06-30", cadence="quarterly", metric="Diluted EPS", period_status="supplied")
    return {"symbol": "AAPL", "market": "US", field: value, "financial_source_evidence": make_envelope(symbol="AAPL", market="US", fields={field: record})}


def test_export_import_preserves_source_raw_candidates_and_distinct_hash(tmp_path):
    Session = _make_session()
    db = Session()
    original = _payload()
    fallback = merge_financial_payloads(_payload(7., observed_at="2026-10-02T10:00:00.000Z"), _payload(2., field="profit_margin"), symbol="AAPL", market="US")
    raw_payload = {"quarterly_income": {"Diluted EPS": [0.9, 1.0], "periods": ["2026-06-30", "2025-06-30"]}}
    run = ProviderSnapshotRun(snapshot_key=ProviderSnapshotService.SNAPSHOT_KEY_FUNDAMENTALS, run_mode="publish", status="published", source_revision="source-run-original", created_at=datetime(2026, 10, 1), published_at=datetime(2026, 10, 1), symbols_total=1, symbols_published=1)
    db.add(run)
    db.flush()
    db.add(ProviderSnapshotPointer(snapshot_key=run.snapshot_key, run_id=run.id))
    db.add(StockUniverse(symbol="AAPL", market="US", exchange="NASDAQ", is_active=True, status=UNIVERSE_STATUS_ACTIVE, status_reason="active"))
    db.add(ProviderSnapshotRow(run_id=run.id, symbol="AAPL", exchange="NASDAQ", row_hash="original-source-row-hash", normalized_payload_json=json.dumps(original), raw_payload_json=json.dumps(raw_payload)))
    db.commit()
    cache = _StubFundamentalsCache(cached={"AAPL": fallback})
    cache._merge_fundamentals = merge_financial_payloads
    service = _make_provider_snapshot_service(fundamentals_cache=cache)
    path = tmp_path / "weekly.json.gz"
    service.export_weekly_reference_bundle(db, output_path=path, bundle_asset_name=path.name)
    exported = service._read_bundle_payload(path)
    row = exported["snapshot"]["rows"][0]
    enriched = row["normalized_payload"]
    assert row["row_hash"] == "original-source-row-hash"
    assert row["export_payload_sha256"] == _normalized_payload_sha256(enriched)
    assert row["export_payload_sha256"] != _normalized_payload_sha256(original)
    assert row["raw_payload"] == raw_payload
    assert enriched["eps_growth_yy"] == -10. and enriched["profit_margin"] == 2.
    assert enriched["financial_source_evidence"]["fields"]["eps_growth_yy"]["observed_at"] == "2026-10-01T10:00:00.000Z"
    assert any(item["value"] == 7. for item in enriched["financial_source_evidence"]["retained_candidates"]["eps_growth_yy"])
    # Export enriches the transport object, never the original historical row.
    stored = db.query(ProviderSnapshotRow).filter_by(run_id=run.id).one()
    assert json.loads(stored.normalized_payload_json) == original
    assert json.loads(stored.raw_payload_json) == raw_payload
    target = Session()
    service.import_weekly_reference_bundle(target, input_path=path, hydrate_cache=False)
    imported = target.query(ProviderSnapshotRow).one()
    assert imported.row_hash == "original-source-row-hash"
    assert json.loads(imported.raw_payload_json) == raw_payload
    imported_payload = json.loads(imported.normalized_payload_json)
    assert imported_payload["financial_source_evidence"] == enriched["financial_source_evidence"]
    validate_envelope(imported_payload["financial_source_evidence"])
    target.close()
    db.close()


@pytest.mark.parametrize("tamper", ["value", "clock", "hash"])
def test_export_digest_rejects_changed_values_and_evidence(tamper):
    payload = _payload()
    row = {"symbol": "AAPL", "exchange": "NASDAQ", "row_hash": "legacy", "normalized_payload": payload, "export_payload_sha256": _normalized_payload_sha256(payload)}
    if tamper == "value":
        payload["eps_growth_yy"] = 77.
    elif tamper == "clock":
        payload["financial_source_evidence"]["fields"]["eps_growth_yy"]["observed_at"] = "2026-10-03T10:00:00.000Z"
    else:
        row["export_payload_sha256"] = "bad"
    with pytest.raises(ValueError, match="digest mismatch"):
        ProviderSnapshotService._deserialize_snapshot_rows([row], run_id=1, bundle_market="US")


def test_legacy_transport_without_digest_or_evidence_remains_supported():
    row = {"symbol": "AAPL", "exchange": "NASDAQ", "row_hash": "legacy", "normalized_payload": {"symbol": "AAPL", "eps_growth_yy": 0.}}
    snapshot, payload = ProviderSnapshotService._deserialize_snapshot_rows([row], run_id=1, bundle_market="US")["AAPL"]
    assert payload["eps_growth_yy"] == 0.
    assert "financial_source_evidence" not in payload
    assert snapshot.raw_payload_json is None


def test_canonicalization_never_rewrites_observation_identity():
    payload = _payload()
    original_envelope = deepcopy(payload["financial_source_evidence"])
    # Legacy canonicalization still occurs, but this evidence remains visibly
    # mismatched and cannot certify that other security downstream.
    row = {"symbol": "MSFT", "exchange": "NASDAQ", "row_hash": "legacy", "normalized_payload": payload, "export_payload_sha256": _normalized_payload_sha256(payload)}
    _, restored = ProviderSnapshotService._deserialize_snapshot_rows([row], run_id=1, bundle_market="US")["MSFT"]
    assert restored["symbol"] == "MSFT"
    assert restored["financial_source_evidence"] == original_envelope


def test_inner_unsupported_evidence_schema_is_not_silently_accepted():
    payload = _payload()
    payload["financial_source_evidence"]["schema"] = "financial-source-evidence-v999"
    row = {"symbol": "AAPL", "exchange": "NASDAQ", "row_hash": "legacy", "normalized_payload": payload}
    with pytest.raises(ValueError, match="Unsupported financial evidence"):
        ProviderSnapshotService._deserialize_snapshot_rows([row], run_id=1, bundle_market="US")
