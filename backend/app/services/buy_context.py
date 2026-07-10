"""Buy context for ANY symbol's chart — why (and whether) this is a buy.

Packages the Markets 360 signal wiring for the scan-results chart viewer:
the three MM360 color bands (Pressure / Buy Risk / TPR with per-bar
histories), the VCP consolidation box, the staged buy-point annotations,
and the buy-signal card with its three confirmation barrels. One endpoint,
the exact engines the Markets 360 tab uses — the scan view and the 360 view
can never disagree about why a chart is (or isn't) buyable.

Cache-only prices: serving a chart must never trigger an external fetch.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Overlays cover the whole served window (the chart clips to its view).
_WINDOW_DAYS = 372
_PERIOD = "1y"


def _resolve_market(symbol: str) -> Optional[str]:
    try:
        from app.api.v1._price_history import resolve_symbol_market
        from app.database import SessionLocal

        with SessionLocal() as db:
            return resolve_symbol_market(db, symbol)
    except Exception:  # noqa: BLE001 - market is a hint, not a requirement
        return None


def build_buy_context(symbol: str) -> Dict[str, Any]:
    """Bands + VCP + buy points + buy signal for one symbol (cache-only)."""
    symbol = symbol.upper().strip()
    unavailable = {"symbol": symbol, "available": False}
    try:
        from app.services.markets360 import chart as chart_overlays
        from app.services.markets360.signals import compute_buy_signal
        from app.services.minervini_bands import calculate_bands
        from app.wiring.bootstrap import get_benchmark_cache, get_fundamentals_cache, get_price_cache

        price_df = get_price_cache().get_cached_only(symbol, period=_PERIOD)
        if price_df is None or getattr(price_df, "empty", True) or "Close" not in price_df.columns:
            return unavailable

        market = _resolve_market(symbol)
        benchmark_close = None
        try:
            bundle = get_benchmark_cache().get_benchmark_bundle(market=market or "US", period=_PERIOD)
            if bundle is not None and bundle.data is not None and "Close" in bundle.data.columns:
                benchmark_close = bundle.data["Close"]
        except Exception:  # noqa: BLE001 - TPR degrades without the RS leg
            logger.warning("buy-context benchmark load failed for %s", symbol, exc_info=True)

        bands = calculate_bands(price_df, benchmark_close=benchmark_close, with_history=True) or {}
        buy_points = chart_overlays.compute_buy_points(price_df, _WINDOW_DAYS)
        vcp_boxes = chart_overlays.compute_vcp_boxes(price_df, _WINDOW_DAYS)
        signal = compute_buy_signal(
            price_df,
            buy_points=buy_points,
            pressure_state=bands.get("pressure_state"),
            tpr_state=bands.get("tpr_state"),
            buy_risk_state=bands.get("buy_risk_state"),
        )

        # Code 33 (Minervini earnings acceleration) from the cached fundamentals
        # flag — null when not evaluated (non-US / no EDGAR). Cache-only; the
        # buy checklist lights it live from here, not just in the static export.
        code33 = None
        try:
            fundamentals = get_fundamentals_cache().get_fundamentals(symbol, market=market)
            if fundamentals is not None:
                code33 = fundamentals.get("code33")
        except Exception:  # noqa: BLE001 - a bonus flag must not break the viewer
            logger.warning("buy-context code33 load failed for %s", symbol, exc_info=True)

        idx = price_df.index[-1]
        return {
            "symbol": symbol,
            "available": True,
            "as_of": str(getattr(idx, "date", lambda: idx)()),
            "bands": bands,
            "buy_points": buy_points,
            "vcp_boxes": vcp_boxes,
            "signal": signal,
            "code33": code33,
        }
    except Exception:  # noqa: BLE001 - chart decoration must never 500 the viewer
        logger.warning("buy-context failed for %s", symbol, exc_info=True)
        return unavailable
