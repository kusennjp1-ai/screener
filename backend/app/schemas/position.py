"""Pydantic schemas for the positions (trade management) API."""
from __future__ import annotations

from datetime import date, datetime
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field


class PositionCreate(BaseModel):
    symbol: str = Field(..., min_length=1, max_length=20)
    entry_price: float = Field(..., gt=0)
    entry_date: date
    initial_stop: Optional[float] = Field(None, gt=0)
    shares: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = None


class PositionUpdate(BaseModel):
    entry_price: Optional[float] = Field(None, gt=0)
    entry_date: Optional[date] = None
    initial_stop: Optional[float] = Field(None, gt=0)
    shares: Optional[float] = Field(None, gt=0)
    notes: Optional[str] = None


class PositionClose(BaseModel):
    close_price: Optional[float] = Field(None, gt=0)


class PositionResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    symbol: str
    market: Optional[str] = None
    entry_price: float
    entry_date: date
    initial_stop: Optional[float] = None
    shares: Optional[float] = None
    status: str
    close_price: Optional[float] = None
    closed_at: Optional[datetime] = None
    notes: Optional[str] = None
    created_at: Optional[datetime] = None


class PositionWithStatus(PositionResponse):
    """A position plus the live sell-engine readout (open positions only)."""

    last_close: Optional[float] = None
    last_date: Optional[str] = None
    pnl_pct: Optional[float] = None
    r_multiple: Optional[float] = None
    action: str = "no_data"
    sell_plan: Optional[Dict[str, Any]] = None
    targets: List[Dict[str, Any]] = []


class PositionListResponse(BaseModel):
    positions: List[PositionWithStatus]
    total: int
