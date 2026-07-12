"""Markets 360 screener.

Runs the reverse-engineered MM360 color bands (Pressure / Buy Risk / TPR) plus
the RPR relative-strength rating over a stock and turns them into a standardized
``ScreenerResult``. A stock "passes" when it looks like a Minervini SEPA leader
that is buyable now: a Stage-2 trend (TPR strong), market leadership (RPR >= 70),
institutional accumulation (Pressure buy/neutral) and a non-extended entry
(Buy Risk low/medium).

The band math lives in ``app.services.minervini_bands`` and the ratings in
``app.services.markets360.ratings``; this screener is the thin adapter that wires
them into the multi-screener orchestrator. It supports a daily (default) or
weekly timeframe via ``criteria['timeframe']``.
"""
from __future__ import annotations

import logging
from typing import Dict, Optional

import pandas as pd

from app.services.minervini_bands import calculate_bands, to_weekly, DAILY, WEEKLY
from app.services.markets360 import ratings
from app.services.markets360.vcp_footprint import compute_vcp_footprint
from app.services.markets360.risk import account_risk_pct_for_regime, compute_risk_plan
from app.services.markets360.rs_line import compute_rs_line_signals
from app.services.markets360.entry_signals import compute_entry_signals
from app.services.market_regime import assess_market_regime

from .base_screener import (
    BaseStockScreener,
    DataRequirements,
    ScreenerResult,
    StockData,
)
from .screener_registry import register_screener

logger = logging.getLogger(__name__)

# Minimum daily bars: TPR needs 200 sessions for the 200DMA; weekly needs ~40
# weeks (~200 daily sessions) which the same 2y of daily data supplies.
_MIN_DAILY_BARS = 200

_PRESSURE_SCORE = {"buy": 100.0, "neutral": 50.0, "sell": 0.0}
_BUYRISK_SCORE = {"low": 100.0, "medium": 55.0, "high": 10.0}
_TPR_SCORE = {"strong": 100.0, "transition": 55.0, "weak": 10.0}
_RPR_LEADER = 70  # RPR at/above this = market leader (Minervini threshold)


@register_screener
class Markets360Scanner(BaseStockScreener):
    """Score a stock by the MM360 bands + RPR and flag buyable SEPA leaders."""

    @property
    def screener_name(self) -> str:
        return "markets360"

    def get_data_requirements(self, criteria: Optional[Dict] = None) -> DataRequirements:
        return DataRequirements(
            price_period="2y",          # 200DMA / 52-week window (weekly reuses it)
            needs_benchmark=True,       # RPR + TPR relative-strength condition
            needs_fundamentals=False,   # bands/RPR are price/volume only
            needs_quarterly_growth=False,
            needs_earnings_history=False,
        )

    def scan_stock(
        self,
        symbol: str,
        data: StockData,
        criteria: Optional[Dict] = None,
    ) -> ScreenerResult:
        criteria = criteria or {}
        timeframe = str(criteria.get("timeframe", "daily")).lower()

        price = data.price_data
        if price is None or len(price) < _MIN_DAILY_BARS:
            return self._insufficient(symbol)

        benchmark_close = None
        if data.benchmark_data is not None and "Close" in getattr(data.benchmark_data, "columns", []):
            benchmark_close = data.benchmark_data["Close"]

        if timeframe == "weekly":
            cfg = WEEKLY
            price = to_weekly(price)
            if benchmark_close is not None:
                benchmark_close = benchmark_close.resample("W-FRI").last().dropna()
            if len(price) < cfg.min_bars:
                return self._insufficient(symbol)
        else:
            cfg = DAILY

        try:
            bands = calculate_bands(price, benchmark_close=benchmark_close, cfg=cfg)
        except Exception as exc:  # never let one symbol crash the scan
            logger.debug("markets360 bands failed for %s: %s", symbol, exc)
            return self._insufficient(symbol)

        close = price["Close"]
        # Authentic percentile RPR when the orchestrator supplies the scan
        # universe's recency-weighted outperformance list. The "weighted" list
        # is built by RelativeStrengthCalculator with the SAME lookbacks and
        # 40/20/20/20 weights as compute_rpr's internal score, so the
        # percentile compares like with like. Daily only: a weekly-resampled
        # score is not commensurable with the daily universe distribution.
        universe_perf = None
        if timeframe != "weekly" and data.rs_universe_performances:
            universe_perf = data.rs_universe_performances.get("weighted")
        rpr = ratings.compute_rpr(close, benchmark_close, universe_performances=universe_perf)

        pressure = bands.get("pressure_state")
        buy_risk = bands.get("buy_risk_state")
        tpr = bands.get("tpr_state")

        # Component scores (each 0-100), then a weighted composite.
        rpr_score = float(rpr) if rpr is not None else 50.0
        comp = {
            "tpr": _TPR_SCORE.get(tpr, 40.0),
            "rpr": min(100.0, rpr_score),
            "pressure": _PRESSURE_SCORE.get(pressure, 40.0),
            "buy_risk": _BUYRISK_SCORE.get(buy_risk, 40.0),
        }
        score = round(
            comp["tpr"] * 0.30
            + comp["rpr"] * 0.35
            + comp["pressure"] * 0.20
            + comp["buy_risk"] * 0.15,
            1,
        )

        # A buyable SEPA leader: Stage-2 trend, leader-grade RS, accumulation,
        # and not extended. This is the WATCHLIST condition (stock-level setup).
        passes = (
            tpr == "strong"
            and rpr is not None
            and rpr >= _RPR_LEADER
            and pressure in ("buy", "neutral")
            and buy_risk in ("low", "medium")
        )

        # Minervini's first rule: only pull the trigger when the GENERAL MARKET is
        # in a confirmed uptrend. The benchmark IS the market, so assess its regime
        # (always from daily index data, even on a weekly stock scan) and gate
        # "buyable now" by it — the watchlist (passes) is unchanged.
        regime = assess_market_regime(data.benchmark_data)
        market_ok = regime.get("regime") in ("confirmed_uptrend", "uptrend_under_pressure")
        # Unknown regime (no benchmark) does not block — fall back to setup only.
        if regime.get("regime") is None:
            market_ok = True
        buyable_now = bool(passes and market_ok)

        # Minervini's structural buy setup: a real VCP footprint (tightening
        # pullbacks, volume drying up) coiling under a pivot. The crude vcp_pct
        # chip stays for the chart; this is the actionable footprint. Weekly data
        # is too short for the legacy base finder, so footprint is daily-only.
        vcp = compute_vcp_footprint(price) if timeframe != "weekly" else dict()

        # Minervini's other half: the stop defines the size. Plan entry/stop/
        # targets/position-size off the price structure and the VCP pivot.
        # Progressive risk: the suggested size commits harder only when the
        # general market is a confirmed uptrend (backtest-validated, C61).
        risk_plan = compute_risk_plan(
            price, pivot=vcp.get("pivot"),
            account_risk_pct=account_risk_pct_for_regime(regime.get("regime")),
        )

        # RS line at new high (often before price) — Minervini's leadership tell.
        rs_line = compute_rs_line_signals(close, benchmark_close)

        # Early-entry tells: pocket pivot / power trend / volume surge.
        entry = compute_entry_signals(price)

        details = {
            "timeframe": timeframe,
            "pressure_state": pressure,
            "buy_risk_state": buy_risk,
            "tpr_state": tpr,
            "tpr_letter": ratings.tpr_letter(bands.get("tpr_score"), bands.get("tpr_max")),
            "rpr": rpr,
            "vcp_pct": ratings.compute_vcp_pct(price),
            "vcp": vcp,
            "vcp_detected": bool(vcp.get("detected")),
            "vcp_score": vcp.get("score"),
            "near_pivot": bool(vcp.get("near_pivot")),
            "ready_for_breakout": bool(vcp.get("ready_for_breakout")),
            "pivot": vcp.get("pivot"),
            "risk_plan": risk_plan,
            "rs_line": rs_line,
            "rs_new_high": bool(rs_line.get("rs_new_high")),
            "rs_line_blue_dot": bool(rs_line.get("rs_line_blue_dot")),
            "pocket_pivot": entry.get("pocket_pivot"),
            "power_trend": entry.get("power_trend"),
            "volume_surge": entry.get("volume_surge"),
            "dist_20dma_pct": ratings.compute_dist_20dma(close),
            "last_close": round(float(close.iloc[-1]), 2),
            "buyable_now": buyable_now,
            "market_regime": regime.get("regime"),
            "market_health": regime.get("health"),
            "market_exposure_pct": regime.get("exposure_pct"),
            "market_distribution_days": regime.get("distribution_days"),
        }
        return ScreenerResult(
            score=max(0.0, min(100.0, score)),
            passes=bool(passes),
            rating=self.calculate_rating(score, details),
            breakdown=comp,
            details=details,
            screener_name=self.screener_name,
        )

    def calculate_rating(self, score: float, details: Dict) -> str:
        if details.get("tpr_state") is None:
            return "Insufficient Data"
        rating = "Strong Buy" if score >= 85 else "Buy" if score >= 70 else "Watch" if score >= 55 else "Pass"
        # Market-timing cap: never say "Buy"/"Strong Buy" when the general market is
        # not in an uptrend — a perfect setup in a correction is a Watch, not a buy.
        if rating in ("Strong Buy", "Buy") and details.get("buyable_now") is False:
            return "Watch"
        return rating

    def _insufficient(self, symbol: str) -> ScreenerResult:
        return ScreenerResult(
            score=0.0,
            passes=False,
            rating="Insufficient Data",
            breakdown={},
            details={"reason": "insufficient_price_history"},
            screener_name=self.screener_name,
        )
