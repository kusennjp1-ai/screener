"""Positions API — register a buy, then let the sell engine watch it.

CRUD on the ``positions`` journal plus a live status list: every open
position is re-evaluated on read with the Markets 360 sell engine (climax
tells, 50-DMA breakdown, trailing-stop ladder) against CACHE-ONLY prices —
listing positions never triggers an external fetch.
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...database import get_db
from ...models.position import Position
from ...schemas.position import (
    PositionClose,
    PositionCreate,
    PositionListResponse,
    PositionResponse,
    PositionUpdate,
    PositionWithStatus,
)
from ...services.position_status import compute_position_status
from ...services.symbol_format import normalize_symbol

logger = logging.getLogger(__name__)
router = APIRouter()

PRICE_PERIOD = "1y"  # enough history for the 50-DMA / 20-bar structure reads


def _price_df(symbol: str):
    try:
        from app.wiring.bootstrap import get_price_cache

        return get_price_cache().get_cached_only(symbol, period=PRICE_PERIOD)
    except Exception:  # noqa: BLE001 - status degrades to no_data, list must render
        logger.warning("cached price load failed for %s", symbol, exc_info=True)
        return None


def _resolve_market(db: Session, symbol: str) -> str | None:
    try:
        from ._price_history import resolve_symbol_market

        return resolve_symbol_market(db, symbol)
    except Exception:  # noqa: BLE001
        return None


def _with_status(position: Position) -> PositionWithStatus:
    base = PositionResponse.model_validate(position).model_dump()
    if position.status != "open":
        return PositionWithStatus(**base)
    status = compute_position_status(
        _price_df(position.symbol), position.entry_price, position.initial_stop
    )
    return PositionWithStatus(**base, **status)


@router.get("", response_model=PositionListResponse, include_in_schema=False)
@router.get("/", response_model=PositionListResponse)
async def list_positions(
    status: str = Query("open", pattern="^(open|closed|all)$"),
    db: Session = Depends(get_db),
):
    """Positions with the live sell-engine readout (open ones)."""
    query = db.query(Position)
    if status != "all":
        query = query.filter(Position.status == status)
    rows = query.order_by(Position.entry_date.desc(), Position.id.desc()).all()
    return PositionListResponse(positions=[_with_status(p) for p in rows], total=len(rows))


@router.post("", response_model=PositionWithStatus, include_in_schema=False)
@router.post("/", response_model=PositionWithStatus)
async def create_position(payload: PositionCreate, db: Session = Depends(get_db)):
    symbol = normalize_symbol(payload.symbol)
    if not symbol:
        raise HTTPException(status_code=422, detail="Invalid symbol")
    if payload.initial_stop is not None and payload.initial_stop >= payload.entry_price:
        raise HTTPException(status_code=422, detail="initial_stop must be below entry_price")
    position = Position(
        symbol=symbol,
        market=_resolve_market(db, symbol),
        entry_price=payload.entry_price,
        entry_date=payload.entry_date,
        initial_stop=payload.initial_stop,
        shares=payload.shares,
        notes=payload.notes,
        status="open",
    )
    db.add(position)
    db.commit()
    db.refresh(position)
    return _with_status(position)


@router.patch("/{position_id}", response_model=PositionWithStatus)
async def update_position(position_id: int, payload: PositionUpdate, db: Session = Depends(get_db)):
    position = db.query(Position).filter(Position.id == position_id).first()
    if position is None:
        raise HTTPException(status_code=404, detail="Position not found")
    updates = payload.model_dump(exclude_unset=True)
    entry = updates.get("entry_price", position.entry_price)
    stop = updates.get("initial_stop", position.initial_stop)
    if stop is not None and entry is not None and stop >= entry:
        raise HTTPException(status_code=422, detail="initial_stop must be below entry_price")
    for field, value in updates.items():
        setattr(position, field, value)
    db.commit()
    db.refresh(position)
    return _with_status(position)


@router.post("/{position_id}/close", response_model=PositionResponse)
async def close_position(position_id: int, payload: PositionClose, db: Session = Depends(get_db)):
    position = db.query(Position).filter(Position.id == position_id).first()
    if position is None:
        raise HTTPException(status_code=404, detail="Position not found")
    if position.status == "closed":
        raise HTTPException(status_code=409, detail="Position already closed")
    close_price = payload.close_price
    if close_price is None:
        status = compute_position_status(
            _price_df(position.symbol), position.entry_price, position.initial_stop
        )
        close_price = status.get("last_close")
    position.status = "closed"
    position.close_price = close_price
    position.closed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(position)
    return PositionResponse.model_validate(position)


@router.delete("/{position_id}")
async def delete_position(position_id: int, db: Session = Depends(get_db)):
    position = db.query(Position).filter(Position.id == position_id).first()
    if position is None:
        raise HTTPException(status_code=404, detail="Position not found")
    db.delete(position)
    db.commit()
    return {"deleted": position_id}
