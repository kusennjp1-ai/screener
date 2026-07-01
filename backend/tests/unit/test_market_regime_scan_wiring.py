"""W1.1: market-regime fields flow orchestrator-result -> details -> schema.

Covers the two pure mapping seams without a DB or live services:
  * ``_map_orchestrator_result`` persists the top-level market_* keys into the
    stored ``details`` JSON blob.
  * ``ScanResultItem.from_domain`` surfaces market_* from ``extended_fields``.
"""
from app.infra.db.repositories.scan_result_repo import _map_orchestrator_result
from app.schemas.scanning import ScanResultItem
from app.domain.scanning.models import ScanResultItemDomain


_REGIME = {
    "market_regime": "confirmed_uptrend",
    "market_health": 88.5,
    "market_exposure_pct": 100,
    "market_distribution_days": 1,
    "market_above_50dma": True,
    "market_above_200dma": True,
    "market_50_above_200dma": True,
}


def test_orchestrator_result_persists_regime_into_details(monkeypatch):
    # The numpy-type normalization is orthogonal to this seam (and trips over an
    # env numpy-version mismatch); patch it to a passthrough so the test checks
    # only that market_* survives into the stored details blob.
    monkeypatch.setattr(
        "app.infra.db.repositories.scan_result_repo.convert_numpy_types",
        lambda x: x,
    )
    raw = {"symbol": "AAA", "composite_score": 72.0, "rating": "Buy", **_REGIME}
    row = _map_orchestrator_result("scan1", "aaa", raw)
    details = row["details"]
    for k, v in _REGIME.items():
        assert details[k] == v


def test_from_domain_surfaces_regime_fields():
    domain = ScanResultItemDomain(
        symbol="AAA",
        composite_score=72.0,
        rating="Buy",
        current_price=10.0,
        screener_outputs={},
        screeners_run=["minervini"],
        composite_method="weighted_average",
        screeners_passed=1,
        screeners_total=1,
        extended_fields=dict(_REGIME),
    )
    item = ScanResultItem.from_domain(domain)
    assert item.market_regime == "confirmed_uptrend"
    assert item.market_health == 88.5
    assert item.market_exposure_pct == 100
    assert item.market_distribution_days == 1
    assert item.market_above_50dma is True
    assert item.market_50_above_200dma is True


def test_rating_basis_explainability_surfaces():
    domain = ScanResultItemDomain(
        symbol="AAA", composite_score=68.0, rating="Watch", current_price=10.0,
        screener_outputs={}, screeners_run=["minervini", "canslim"],
        composite_method="weighted_average", screeners_passed=1, screeners_total=2,
        extended_fields={
            "rating_basis_score": 85.0,
            "rating_basis_screener": "minervini",
            "rating_explanation": "Rating Watch from best-fit minervini score 85",
        },
    )
    item = ScanResultItem.from_domain(domain)
    assert item.rating_basis_score == 85.0
    assert item.rating_basis_screener == "minervini"
    assert "best-fit minervini" in item.rating_explanation


def test_regime_absent_is_none_not_error():
    domain = ScanResultItemDomain(
        symbol="BBB", composite_score=10.0, rating="Pass", current_price=1.0,
        screener_outputs={}, screeners_run=[], composite_method="weighted_average",
        screeners_passed=0, screeners_total=0, extended_fields={},
    )
    item = ScanResultItem.from_domain(domain)
    assert item.market_regime is None
    assert item.market_exposure_pct is None
