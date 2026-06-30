"""
Markets 360 — payload orchestrator.

``Markets360Service`` loads the data a single symbol needs (cached OHLCV, the
market benchmark, cached fundamentals, and — when explicitly enabled — SEC
EDGAR quarterly financials) and assembles the full Markets 360 payload: quote,
proprietary-style rating chips, band states, chart overlays, the buy-signal
card, and the quarterly EPS/Sales strip.

It is deliberately standalone: it reuses pure shared calculators and the
existing cache factories, but does not touch the screener scan pipeline.
"""
from __future__ import annotations

import logging
import os
from typing import Any, Dict, List, Optional

import pandas as pd

from app.services.minervini_bands import calculate_bands
from app.wiring.bootstrap import (
    get_benchmark_cache,
    get_fundamentals_cache,
    get_price_cache,
)

from . import chart as chart_overlays
from . import quarters as quarter_table
from . import ratings
from .signals import compute_buy_signal

logger = logging.getLogger(__name__)

# Env gate for the (network) SEC EDGAR quarterly lookup. Off by default so the
# endpoint is cache-only and side-effect-free unless the operator opts in.
EDGAR_ENV_FLAG = "MARKETS360_EDGAR"

# period -> (cache period to load, display window in days)
PERIOD_WINDOWS: Dict[str, tuple[str, int]] = {
    "1mo": ("1y", 31),
    "3mo": ("1y", 93),
    "6mo": ("1y", 186),
    "1y": ("2y", 372),
    "2y": ("2y", 744),
    "5y": ("5y", 1860),
}
DEFAULT_PERIOD = "1y"


class Markets360Service:
    def __init__(self) -> None:
        self._price = get_price_cache()
        self._benchmark = get_benchmark_cache()
        self._fundamentals = get_fundamentals_cache()

    # -- public API ---------------------------------------------------------
    def build(self, symbol: str, period: str = DEFAULT_PERIOD) -> Dict[str, Any]:
        symbol = symbol.upper().strip()
        cache_period, window_days = PERIOD_WINDOWS.get(period, PERIOD_WINDOWS[DEFAULT_PERIOD])

        market = self._resolve_market(symbol)
        price_df = self._load_price(symbol, cache_period, market)
        benchmark_symbol, benchmark_df = self._load_benchmark(market, cache_period)
        fundamentals = self._safe(lambda: self._fundamentals.get_fundamentals(symbol, market=market)) or {}

        degraded: List[str] = []
        if price_df is None or getattr(price_df, "empty", True):
            degraded.append("no_price_history")
            return self._degraded_payload(symbol, market, degraded)

        # --- bands (states + per-bar history for the strips) ---------------
        bands = self._safe(lambda: calculate_bands(
            price_df,
            benchmark_close=(benchmark_df["Close"] if self._has_close(benchmark_df) else None),
            with_history=True,
        )) or {}

        # --- chart overlays ------------------------------------------------
        edgar = self._load_edgar(symbol, market)
        earnings_dates = edgar.get("earnings_dates") if edgar else None

        chart = {
            "period": period,
            "window_days": window_days,
            "benchmark_symbol": benchmark_symbol,
            "bars": chart_overlays.serialize_bars(price_df, window_days),
            "moving_averages": chart_overlays.serialize_moving_averages(price_df, window_days),
            "spy_overlay": chart_overlays.serialize_overlay(benchmark_df, window_days),
            "bands": bands,
            "buy_points": chart_overlays.compute_buy_points(price_df, window_days),
            "vcp_boxes": chart_overlays.compute_vcp_boxes(price_df, window_days),
            "rpr_pane": chart_overlays.serialize_rpr_pane(price_df, benchmark_df, window_days),
            "earnings_markers": chart_overlays.earnings_markers(earnings_dates, price_df, window_days),
            "monalert": ratings.compute_monalert_net(price_df).get("monalert_history", []),
            # No news feed is wired yet; the pane renders an empty 0-count row.
            "news_markers": [],
        }
        rs_line, blue_dots = chart_overlays.serialize_rs_line(price_df, benchmark_df, window_days)
        chart["rs_line"] = rs_line
        chart["blue_dots"] = blue_dots

        # --- ratings chips -------------------------------------------------
        bench_close = benchmark_df["Close"] if self._has_close(benchmark_df) else None
        quarterly_eps_growth = edgar.get("eps_yoy_series") if edgar else None
        rating_block = {
            "er": ratings.compute_er(fundamentals),
            "sr": ratings.compute_sr(fundamentals),
            "rpr": ratings.compute_rpr(price_df["Close"], bench_close),
            "tpr": ratings.tpr_letter(bands.get("tpr_score"), bands.get("tpr_max")),
            "esr": ratings.compute_esr(fundamentals, quarterly_eps_growth),
            "vcp_pct": ratings.compute_vcp_pct(price_df),
            "vcp_score": ratings.compute_vcp_score(price_df),
            "vrr_pct": ratings.compute_vrr(price_df["Volume"]) if "Volume" in price_df.columns else None,
            "dist_20dma_pct": ratings.compute_dist_20dma(price_df["Close"]),
        }
        monalert = ratings.compute_monalert_net(price_df)

        # --- band/trend states ---------------------------------------------
        states = {
            "trend_stage": self._stage_from_bands(bands, price_df),
            "pressure": {"state": bands.get("pressure_state"), "value": bands.get("pressure_value")},
            "buy_risk": {"state": bands.get("buy_risk_state"), "atr": bands.get("buy_risk_atr")},
            "tpr": {"state": bands.get("tpr_state"), "score": bands.get("tpr_score"), "max": bands.get("tpr_max")},
            "monalert_net": monalert.get("monalert_net"),
        }

        # --- buy-signal card ----------------------------------------------
        signal = compute_buy_signal(
            price_df,
            buy_points=chart["buy_points"],
            pressure_state=bands.get("pressure_state"),
            tpr_state=bands.get("tpr_state"),
            buy_risk_state=bands.get("buy_risk_state"),
        )

        # --- quarterly strip ----------------------------------------------
        quarters = self._build_quarters(edgar, fundamentals)

        return {
            "symbol": symbol,
            "name": fundamentals.get("company_name") or fundamentals.get("name") or symbol,
            "exchange": fundamentals.get("exchange") or self._exchange_for(market),
            "market": market or "US",
            "as_of": chart["bars"][-1]["date"] if chart["bars"] else None,
            "quote": self._build_quote(price_df),
            "ratings": rating_block,
            "states": states,
            "chart": chart,
            "signal": signal,
            "quarters": quarters,
            "degraded_reasons": degraded,
        }

    # -- data loading -------------------------------------------------------
    def _resolve_market(self, symbol: str) -> Optional[str]:
        def _resolve() -> Optional[str]:
            from app.database import SessionLocal
            from app.api.v1._price_history import resolve_symbol_market

            with SessionLocal() as db:
                return resolve_symbol_market(db, symbol)

        return self._safe(_resolve)

    def _load_price(self, symbol: str, cache_period: str, market: Optional[str]) -> Optional[pd.DataFrame]:
        return self._safe(lambda: self._price.get_historical_data(symbol, period=cache_period, market=market))

    def _load_benchmark(self, market: Optional[str], cache_period: str) -> tuple[Optional[str], Optional[pd.DataFrame]]:
        def _load():
            bundle = self._benchmark.get_benchmark_bundle(market=market or "US", period=cache_period)
            if bundle is None:
                return None, None
            return bundle.benchmark_symbol, bundle.data

        result = self._safe(_load)
        if not result:
            return None, None
        return result

    def _load_edgar(self, symbol: str, market: Optional[str]) -> Optional[Dict[str, Any]]:
        """Optional SEC EDGAR quarterly EPS/revenue + report dates (US only).

        Gated behind ``MARKETS360_EDGAR`` because it makes network calls. Returns
        ``None`` when disabled, non-US, or on any failure.
        """
        if os.environ.get(EDGAR_ENV_FLAG, "").strip().lower() not in {"1", "true", "yes", "on"}:
            return None
        if (market or "US") != "US":
            return None

        def _load():
            from app.services.sec_edgar_financials import (
                EPS_TAGS,
                REVENUE_TAGS,
                SecEdgarClient,
                dated_quarterly_eps,
                quarterly_series,
            )

            facts = SecEdgarClient().company_facts(symbol)
            if not facts:
                return None
            eps = quarterly_series(facts, EPS_TAGS, is_eps=True)
            rev = quarterly_series(facts, REVENUE_TAGS, is_eps=False)
            dated = dated_quarterly_eps(facts)
            eps_yoy_series = self._recent_yoy(eps)
            return {
                "eps": eps,
                "revenue": rev,
                "earnings_dates": [d for d, _ in dated] if dated else [],
                "eps_yoy_series": eps_yoy_series,
            }

        return self._safe(_load)

    # -- assembly helpers ---------------------------------------------------
    def _build_quote(self, price_df: pd.DataFrame) -> Dict[str, Any]:
        close = price_df["Close"]
        last = float(close.iloc[-1])
        prev = float(close.iloc[-2]) if len(close) > 1 else last
        change = last - prev
        volume = int(price_df["Volume"].iloc[-1]) if "Volume" in price_df.columns else None
        return {
            "last": round(last, 2),
            "bid": None,   # no live L1 quote feed; chips fall back to last
            "ask": None,
            "change": round(change, 2),
            "change_pct": round((change / prev * 100.0) if prev else 0.0, 2),
            "volume": volume,
        }

    def _build_quarters(self, edgar: Optional[Dict[str, Any]], fundamentals: Dict[str, Any]) -> List[Dict[str, Any]]:
        if edgar and edgar.get("eps") and edgar.get("revenue"):
            estimate = self._estimate_column(fundamentals)
            return quarter_table.build_quarter_table(
                edgar["eps"], edgar["revenue"], max_quarters=4, estimate=estimate
            )
        return quarter_table.fallback_from_fundamentals(fundamentals)

    def _estimate_column(self, fundamentals: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        date = fundamentals.get("next_earnings_date") or fundamentals.get("earnings_date")
        eps_growth = fundamentals.get("eps_growth_next_q") or fundamentals.get("eps_growth_next_y")
        if not date and eps_growth is None:
            return None
        return {
            "label": "Next Q (Est.)",
            "earnings_date": str(date) if date else None,
            "earnings_timing": fundamentals.get("earnings_timing"),
            "eps_est_growth": _num(eps_growth),
            "sales_est_growth": _num(fundamentals.get("sales_growth_next_q")),
        }

    def _stage_from_bands(self, bands: Dict[str, Any], price_df: pd.DataFrame) -> Dict[str, Any]:
        """Map the Trend Template into a Weinstein-style stage label.

        TPR strong + price above a rising 50DMA => Stage 2 (advancing). Weak +
        below => Stage 4 (declining). The transitional reads map to Stage 1/3.
        """
        tpr = bands.get("tpr_state")
        close = price_df["Close"]
        sma50 = close.rolling(50).mean()
        above_50 = len(close) >= 50 and float(close.iloc[-1]) > float(sma50.iloc[-1])
        rising_50 = (
            len(sma50.dropna()) > 22
            and float(sma50.iloc[-1]) > float(sma50.iloc[-22])
        )
        if tpr == "strong" and above_50:
            stage, label = 2, "Stage 2 — Advancing"
        elif tpr == "weak" and not above_50:
            stage, label = 4, "Stage 4 — Declining"
        elif above_50 and rising_50:
            stage, label = 1, "Stage 1 — Basing"
        else:
            stage, label = 3, "Stage 3 — Topping"
        return {"stage": stage, "label": label, "active": stage == 2}

    @staticmethod
    def _recent_yoy(eps: Dict[Any, float], count: int = 6) -> List[float]:
        keys = sorted(eps.keys(), key=lambda k: (k[0], k[1]), reverse=True)[:count]
        out: List[float] = []
        for k in keys:
            prior = (k[0] - 1, k[1])
            a, p = eps.get(k), eps.get(prior)
            if a is not None and p not in (None, 0):
                out.append((a - p) / abs(p) * 100.0)
        return out

    @staticmethod
    def _exchange_for(market: Optional[str]) -> Optional[str]:
        return {"US": "XNAS", "HK": "XHKG", "JP": "XTKS", "TW": "XTAI"}.get(market or "US")

    @staticmethod
    def _has_close(df: Optional[pd.DataFrame]) -> bool:
        return df is not None and not getattr(df, "empty", True) and "Close" in df.columns

    def _degraded_payload(self, symbol: str, market: Optional[str], reasons: List[str]) -> Dict[str, Any]:
        return {
            "symbol": symbol,
            "name": symbol,
            "exchange": self._exchange_for(market),
            "market": market or "US",
            "as_of": None,
            "quote": {"last": None, "bid": None, "ask": None, "change": None, "change_pct": None, "volume": None},
            "ratings": {},
            "states": {},
            "chart": {"bars": []},
            "signal": {"active": False, "type": None, "label": None},
            "quarters": [],
            "degraded_reasons": reasons,
        }

    @staticmethod
    def _safe(fn):
        try:
            return fn()
        except Exception:  # noqa: BLE001 - any loader failure degrades, never 500s
            logger.warning("markets360 loader step failed", exc_info=True)
            return None


def _num(value) -> Optional[float]:
    if value is None:
        return None
    try:
        return round(float(value), 1)
    except (TypeError, ValueError):
        return None
