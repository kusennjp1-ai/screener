"""C44: fundamental bonus survives orchestrator flatten -> details JSON -> API domain."""
from __future__ import annotations

from app.infra.db.repositories.scan_result_repo import _map_orchestrator_result

BONUS_DETAIL = {
    "bonus": 9.0,
    "max_bonus": 10.0,
    "available": True,
    "components": {
        "code33": {"points": 4.0, "value": True, "met": True},
        "eps_growth_qq": {"points": 2.5, "value": 45.0, "met": True},
    },
}


def test_map_orchestrator_result_keeps_bonus_in_details():
    raw = {
        "symbol": "FTNT",
        "minervini_score": 85.83,
        "fundamental_bonus": 9.0,
        "fundamental_bonus_detail": BONUS_DETAIL,
    }
    mapped = _map_orchestrator_result("scan-1", "FTNT", raw)
    assert mapped["details"]["fundamental_bonus"] == 9.0
    assert mapped["details"]["fundamental_bonus_detail"]["components"]["code33"]["met"] is True


def test_schema_exposes_bonus_fields():
    from app.schemas.scanning import ScanResultItem

    item = ScanResultItem(
        symbol="FTNT",
        composite_score=85.83,
        rating="Buy",
        fundamental_bonus=9.0,
        fundamental_bonus_detail=BONUS_DETAIL,
    )
    assert item.fundamental_bonus == 9.0
    assert item.fundamental_bonus_detail["bonus"] == 9.0
