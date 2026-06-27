"""Markets 360 — standalone single-symbol analytics endpoint.

Serves the consolidated payload (quote, proprietary-style ratings, band states,
chart overlays, buy-signal card, quarterly growth strip) that the Markets 360
chart view renders. Decoupled from the scan pipeline; reuses only cached data
and pure calculators via ``Markets360Service``.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query

from ...services.markets360.service import PERIOD_WINDOWS, Markets360Service
from ...services.symbol_format import require_valid_symbol

logger = logging.getLogger(__name__)
router = APIRouter()

_VALID_PERIODS = tuple(PERIOD_WINDOWS.keys())


@router.get("/{symbol}")
async def get_markets360(
    symbol: str,
    period: str = Query("1y", description=f"One of: {', '.join(_VALID_PERIODS)}"),
):
    """Full Markets 360 payload for one symbol.

    Always returns 200 with a payload; transient data gaps surface as
    ``degraded_reasons`` rather than errors so the view can render partially.
    """
    symbol = require_valid_symbol(symbol)
    if period not in PERIOD_WINDOWS:
        raise HTTPException(status_code=422, detail=f"Unsupported period '{period}'. Use one of {_VALID_PERIODS}.")
    try:
        return Markets360Service().build(symbol, period=period)
    except Exception:  # noqa: BLE001
        logger.exception("markets360 payload build failed for %s", symbol)
        raise HTTPException(status_code=500, detail="Failed to build Markets 360 payload.")
