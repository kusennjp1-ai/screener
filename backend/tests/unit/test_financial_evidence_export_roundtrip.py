"""Shadow financial lineage survives scan generations without changing decisions.

Fixtures are synthetic. These tests do not certify a source capture or enable
the later current-use availability projection.
"""
from copy import deepcopy
from datetime import date
import json

import pytest

from app.infra.db.models.feature_store import StockFeatureDaily
from app.infra.db.repositories.feature_store_repo import _map_feature_to_scan_result
from app.infra.db.repositories.scan_result_repo import (
    _map_orchestrator_result,
    _map_row_to_domain,
)
from app.models.scan_result import ScanResult
from app.scanners.base_screener import StockData
from app.scanners.scan_orchestrator import ScanOrchestrator
from app.schemas.scanning import ScanResultItem
from app.services.static_site_export_service import StaticSiteExportService


def _evidence(value):
    return {
        "schema": "financial-source-evidence-v1",
        "symbol": "SYNTHETIC",
        "market": "US",
        "fields": {
            "eps_growth_yy": {
                "value": value,
                "source": "synthetic-fixture",
                "observed_at": "2026-06-13T10:00:00Z",
                "provenance_kind": "legacy_canonical_map",
                "unit": "percent_points",
                "basis": "quarterly_yoy",
            },
        },
        "legacy_statement_context": {"recent_quarter_date": "2026-03-31"},
    }


def _combine(fundamentals):
    stock = StockData(
        symbol="SYNTHETIC", price_data=None, benchmark_data=None,
        fundamentals=fundamentals,
        quarterly_growth={"eps_growth_yy": fundamentals["eps_growth_yy"]},
    )
    return ScanOrchestrator._combine_results(
        None, "SYNTHETIC", stock, {}, 50, "Watch", "weighted_average",
    )


@pytest.mark.parametrize("value", [-10.0, 0.0, 30.0])
def test_shadow_capture_keeps_existing_values_and_decisions_and_detaches_input(value):
    base = {"eps_growth_yy": value, "eps_rating": 80, "smr_rating": 75}
    expected = _combine(base)
    source = {**base, "financial_source_evidence": _evidence(value)}
    unchanged = deepcopy(source)
    actual = _combine(source)
    evidence = actual.pop("financial_source_evidence")
    assert actual == expected
    assert source == unchanged
    assert evidence == unchanged["financial_source_evidence"]
    evidence["fields"]["eps_growth_yy"]["value"] = 999
    assert source == unchanged


@pytest.mark.parametrize("path", ["scan", "feature"])
def test_recorded_generation_evidence_reaches_api_and_static_export_without_live_backfill(path):
    evidence = _evidence(30.0)
    raw = {
        "symbol": "SYNTHETIC", "rating": "Watch", "composite_score": 50,
        "eps_growth_yy": 30.0, "eps_rating": 80, "smr_rating": 75,
        "financial_source_evidence": evidence,
        "screeners_run": [], "screeners_passed": 0, "screeners_total": 0,
    }
    before = deepcopy(raw)
    # Deliberately incompatible current joined metadata must not replace the
    # source evidence stored in this historical scan generation.
    joined = {"financial_source_evidence": _evidence(99.0)}
    if path == "scan":
        stored = ScanResult(**_map_orchestrator_result("synthetic-scan", "SYNTHETIC", raw))
        item = _map_row_to_domain(stored, joined, include_sparklines=False)
    else:
        stored = StockFeatureDaily(
            run_id=1, symbol="SYNTHETIC", as_of_date=date(2026, 10, 2),
            composite_score=50, overall_rating=None, passes_count=0,
            details_json=json.loads(json.dumps(raw)),
        )
        item = _map_feature_to_scan_result(stored, joined, include_sparklines=False)
    api = ScanResultItem.from_domain(item).model_dump(mode="json")
    exported = StaticSiteExportService._serialize_scan_row(None, item)
    for output in (api, exported):
        assert json.loads(json.dumps(output))["financial_source_evidence"] == evidence
        assert output["eps_growth_yy"] == 30.0
        assert output["eps_rating"] == 80
        assert output["rating"] == "Watch"
    assert raw == before


def test_legacy_scan_does_not_invent_source_evidence():
    result = _combine({"eps_growth_yy": 30.0})
    assert "financial_source_evidence" not in result
    stored = ScanResult(**_map_orchestrator_result("legacy", "SYNTHETIC", result))
    item = _map_row_to_domain(stored, {}, include_sparklines=False)
    assert ScanResultItem.from_domain(item).financial_source_evidence is None
