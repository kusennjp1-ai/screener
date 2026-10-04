"""Static metadata parity and old-UI compatibility at real export seams."""
from copy import deepcopy
from datetime import date
import json
from types import SimpleNamespace

import pandas as pd

from app.schemas.scanning import ScanResultItem
from app.services import static_site_export_service as export_module
from app.services.static_financial_evidence import add_static_financial_metadata
from tests.unit.test_static_financial_evidence import source_row, NOW, AS_OF, summary
from tests.unit.test_static_site_export_service import service_and_session_factory  # noqa: F401


def _domain(payload):
    return SimpleNamespace(symbol=payload["symbol"], composite_score=payload["composite_score"],
                           rating=payload["rating"], current_price=100., screeners_run=["minervini"],
                           extended_fields=deepcopy(payload))


def _run():
    return SimpleNamespace(id=77, as_of_date=date.fromisoformat(AS_OF), config_json={"universe": {"market": "US"}})


def test_scan_metadata_does_not_change_any_old_artifact_value(service_and_session_factory, monkeypatch, tmp_path):
    service, _ = service_and_session_factory
    payload = {**source_row(), "volume": 200_000_000, "rs_rating": 92., "ibd_industry_group": "Semiconductors"}
    original = deepcopy(payload)
    rows = [SimpleNamespace(payload=payload)]
    monkeypatch.setattr(service, "_serialize_scan_row", lambda row: deepcopy(row.payload))
    monkeypatch.setattr(service, "_code33_enabled", lambda: False)
    arguments = dict(db=None, generated_at=NOW, run=_run(), rows=rows,
                     filter_options=SimpleNamespace(ibd_industries=[], gics_sectors=[], ratings=[]), market="US")
    baseline = tmp_path / "baseline"
    updated = tmp_path / "updated"
    with monkeypatch.context() as patch:
        patch.setattr(export_module, "add_static_financial_metadata", lambda row, **kwargs: deepcopy(row))
        old_manifest, old_rows = service._export_scan_bundle(output_dir=baseline, **arguments)
    manifest, exported = service._export_scan_bundle(output_dir=updated, **arguments)

    def strip(value):
        if isinstance(value, dict):
            return {key: strip(item) for key, item in value.items() if key not in {"financial_current", "financial_reference"}}
        return [strip(item) for item in value] if isinstance(value, list) else value

    assert json.dumps(strip(exported), sort_keys=True) == json.dumps(old_rows, sort_keys=True)
    assert json.dumps(strip(manifest), sort_keys=True) == json.dumps(old_manifest, sort_keys=True)
    for path in baseline.rglob("*.json"):
        new = json.loads((updated / path.relative_to(baseline)).read_text())
        assert strip(new) == json.loads(path.read_text())
    proof = exported[0]["financial_current"]
    assert proof == summary(payload)
    assert manifest["initial_rows"][0]["financial_current"] == proof
    assert payload == original


def test_chart_cache_proof_is_independent_and_verification_only_chart_has_metadata(service_and_session_factory, monkeypatch, tmp_path):
    service, _ = service_and_session_factory
    payload = source_row()
    second = {**payload, "symbol": "SECOND"}
    rows = [_domain(payload), _domain(second)]
    original_rows = deepcopy([row.extended_fields for row in rows])
    cached = {"symbol": "TEST", "market": "US", "eps_growth_yy": payload["eps_growth_yy"], "eps_rating": 99}
    cached_original = deepcopy(cached)
    monkeypatch.setattr(service, "_serialize_scan_row", lambda row: deepcopy(row.extended_fields))
    monkeypatch.setattr(export_module, "STATIC_CHART_LIMIT", 1)
    frame = pd.DataFrame({"Open": [10., 11.], "High": [11., 12.], "Low": [9., 10.], "Close": [10., 11.], "Volume": [10000, 20000]}, index=pd.to_datetime([AS_OF, "2026-10-03"]))
    service._price_cache = SimpleNamespace(get_many_cached_only=lambda symbols, **kwargs: {symbol: frame for symbol in symbols})
    service._fundamentals_cache = SimpleNamespace(get_many_cached_only=lambda symbols: {symbol: cached for symbol in symbols})
    monkeypatch.setattr(service, "_get_market_benchmark_history", lambda *args, **kwargs: ("SPY", None))
    monkeypatch.setattr(service, "_serialize_rs_line", lambda *args: ([], []))
    for name in ["_compute_buy_points", "_compute_eps_line", "_compute_vcp_boxes"]:
        monkeypatch.setattr(service, name, lambda *args, **kwargs: [])
    for name in ["_compute_chart_bands", "_compute_m360_signals", "_compute_trend_template"]:
        monkeypatch.setattr(service, name, lambda *args, **kwargs: {})
    manifest = service._export_chart_bundle(output_dir=tmp_path, generated_at=NOW, run=_run(), rows=rows)
    chart = json.loads((tmp_path / "charts/TEST.json").read_text())
    other = json.loads((tmp_path / "charts/SECOND.json").read_text())
    assert manifest["symbols_total"] == 2
    assert chart["stock_data"]["financial_current"] == summary(payload)
    assert chart["fundamentals"]["financial_current"]["p"] == {}
    assert chart["fundamentals"]["eps_growth_yy"] == cached["eps_growth_yy"]
    assert chart["stock_data"]["financial_source_evidence"] == payload["financial_source_evidence"]
    assert other["verification_only"] is True
    assert other["stock_data"]["financial_current"]["p"] == {}
    assert other["stock_data"]["eps_rating"] == payload["eps_rating"]
    assert cached == cached_original
    assert [row.extended_fields for row in rows] == original_rows


def test_group_current_proof_survives_shared_schema_without_api_schema_change(service_and_session_factory):
    service, _ = service_and_session_factory
    payload = {**source_row(), "ibd_industry_group": "Semiconductors", "company_name": "Test", "rs_rating": 90.}
    enriched = add_static_financial_metadata(payload, now=NOW, as_of_date=AS_OF)
    rankings = service._compute_group_rankings_from_serialized_rows([enriched], ranking_date=date.fromisoformat(AS_OF))
    result = service._build_group_details(rankings=rankings, serialized_rows=[enriched], market_runs=[], historical_rankings={})
    member = result["Semiconductors"]["stocks"][0]
    assert set(member["financial_current"]["p"]) == {"0", "1", "2", "3"}
    for index in range(4):
        assert member["financial_current"]["p"][str(index)] == enriched["financial_current"]["p"][str(index)]
    assert member["eps_growth_qq"] == 0.
    assert member["composite_score"] == 90.
    assert "financial_current" not in ScanResultItem.model_fields
    domain = _domain(payload)
    item = ScanResultItem.from_domain(domain).model_dump(mode="json")
    assert "financial_current" not in item
    assert item["eps_growth_yy"] == -50.
    assert item["eps_rating"] == 95
    assert item["financial_source_evidence"] == payload["financial_source_evidence"]
