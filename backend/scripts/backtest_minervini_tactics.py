"""Portfolio backtest of the CURRENT Minervini tactics — the strategy, not the signals.

Simulates trading the way the screener says Minervini would:
  - Stock selection : strict 8-condition Trend Template + cross-sectional RS
                      percentile (>=80) + within 25% of the 52w high + a
                      DETECTED VCP base (the shipped ``VCPDetector``).
  - Buy rules       : breakout close above the VCP pivot on >=1.5x volume,
                      chase cap +5%; fill at NEXT open (daily bars — no
                      intraday fills; disclosed as a conservative bias).
  - Risk / sizing   : 1.25% account risk per trade (risk.py), stop = max(base
                      low, entry - 8%) (MAX_LOSS_PCT), position <= 25% of
                      equity, <= 10 open positions.
  - Sell rules      : protective stop (intraday), the shipped trailing ladder
                      (+1R -> half risk, +2R -> breakeven, +3R -> lock +1R and
                      trail 50DMA / 20-bar low), 50-DMA breakdown on >=1.5x
                      volume -> sell next open.
  - Market analysis : assess_market_regime on SPY daily (incl. FTD logic).
                      New buys blocked at 0% exposure; total invested capped
                      at the regime's suggested exposure.

Honest limitations (also in docs/WEAKNESSES.md):
  - survivorship bias (today's listed universe),
  - technicals only (point-in-time fundamentals unavailable -> the C43
    fundamental bonus is deliberately excluded),
  - daily bars (entries at next open, later than intraday pivot buys),
  - window limited by the bundle depth (2y bundle -> ~1y tradable).

Variants reported: full tactics / no-market-gate / SPY buy & hold /
SPY x regime exposure (timing-only), so selection alpha and timing alpha
can be separated.
"""

from __future__ import annotations

import argparse
import csv
import dataclasses
import gzip
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

from app.scanners.criteria.vcp_detection import VCPDetector
from app.services import minervini_bands as mb
from app.services.market_regime import assess_market_regime
from app.services.markets360.exit_signals import (
    LADDER_BREAKEVEN_R,
    LADDER_HALF_RISK_R,
    LADDER_LOCK_GAINS_R,
    detect_climax_run,
)
from app.services.markets360.risk import ACCOUNT_RISK_PCT, MAX_LOSS_PCT

COST_PER_SIDE = 0.001          # 10 bps slippage+commission per side
RS_MIN = 70                    # candidate floor (published minimum; 80-90 preferred)
NEAR_HIGH_MAX_PCT = 25.0       # within 25% of the 52w high (template cond.)
BREAKOUT_VOL_RATIO = 1.5
CHASE_CAP = 1.05               # never pay >5% above the pivot
MAX_POSITIONS = 10
PROGRESSIVE_RISK = False  # set by --progressive-risk: 2x risk in confirmed uptrend
# Minervini under pressure: tighten SELECTION, don't stop buying — leaders
# (RS>=90) may still be bought at full exposure while the trend is intact.
SELECTIVE_PRESSURE = False
PRESSURE_RS_MIN = 90
# Breadth confirmation (O'Neil/Minervini market internals): "under pressure"
# driven by noisy index volume is NOT the same as genuine deterioration. When
# a clear majority of the tradable universe still holds its 200DMA, the bull
# is broadly intact and the pressure cap is lifted; when breadth is broken
# (2022-style), the cap stays. 60% = the conventional healthy-majority line.
BREADTH_CONFIRM = False
BREADTH_MIN = 0.60
# C80: breadth-confirmed REGIME (capability-matrix #2). The index-only regime is
# breadth-blind: a cap-weighted index can print highs on a handful of mega-caps
# while the majority of stocks lose their 200DMA (a classic distribution top).
# When breadth ROTS — fewer than 40% of the tradable universe above its 200DMA,
# the mirror of the conventional 60% healthy-majority line — a confirmed_uptrend
# is downgraded to under-pressure exposure. Single grounded threshold, no sweep.
BREADTH_REGIME = False
BREADTH_ROT = 0.40
# C82: group-rotation overlay (O'Neil: ~half a leader's move is its industry
# group — buy leaders in LEADING or newly-EMERGING groups). Group score =
# mean member RS percentile (shipped ibd_group_rank_service avg_rs, >=3
# valid members/day), ranked across groups daily, walk-forward. New buys
# allowed only when the group is top-20% (IBD Top-40 convention,
# preset_screens.py:168) OR has gained >=0.20 rank-pct over 21 sessions
# (rank_change_1m unit) while in the top half (preset_screens.py:105).
# Unmapped symbols / unranked groups FAIL OPEN (C80 lesson). No exit leg:
# group fade never force-sells (SPEC: sells are stock/market-action; C73).
GROUP_ROTATION = False
GROUP_LEAD_PCT = 0.80     # top 40 of 197 (preset_screens.py:168-173, 358-364)
GROUP_HALF_PCT = 0.50     # avoid-laggards bottom-half line (preset_screens.py:105-107)
GROUP_EMERGE_DELTA = 0.20 # same 0.20*G magnitude as the Top-40 leg — one constant
GROUP_MOM_DAYS = 21       # ibd_group_rank_service rank_change_1m unit
GROUP_MIN_MEMBERS = 3     # ibd_group_rank_service: >=3 valid-RS members
# Pre-registered contingency (C82, decided before the rerun): the first run's
# damage concentrated in post-FTD recovery years (2020 -19.1pp, 2023 -19.9pp)
# — group RS is built from >=63d member returns, so it is structurally BLIND
# to new leadership for ~a quarter after a market turn. Suspend the gate for
# 63 sessions (the repo's canonical quarter: RS shortest leg / control offset)
# after any correction/downtrend -> confirmed_uptrend upgrade. Thresholds
# untouched per the contingency contract.
GROUP_FTD_SUSPEND = 63
IBD_CSV = Path(__file__).resolve().parents[2] / "data" / "IBD_industry_group.csv"
ETF_GROUP = "Finance-ETF / ETN"   # winners-backtest precedent
# C85: uptrend-quality tiering (capability-matrix #21; motivated by the 20y
# evidence — chop years bleed and the gate contributed NEGATIVELY over 2007-26
# via FTD re-entry whipsaw). A confirmed_uptrend is only worth FULL exposure
# while it is a POWER TREND: health >= 80 and fewer than 2 distribution days.
# A mature/deteriorating confirmed uptrend runs at the existing FTD ladder's
# "proven" step (75%) instead — both numbers are existing engine quantities
# (market_regime health, DIST thresholds, FTD_EXPOSURE_PROVEN), no new knobs.
TIERED_UPTREND = False
POWER_HEALTH_MIN = 80.0
POWER_DIST_MAX = 2
MATURE_EXPOSURE = 75          # = market_regime.FTD_EXPOSURE_PROVEN
# Minervini: in a market correction you go to CASH and wait for the FTD; the
# pre-FTD 20% correction exposure is a residual the shipped engine allows.
# This flag makes a correction a hard no-buy (like a downtrend) — buying
# resumes only when the FTD upgrades the regime to confirmed_uptrend.
NO_CORRECTION_BUYS = False
# Minervini "sell into strength": exit a profitable position into a climax run
# (extended + >=2 exhaustion tells) rather than waiting for the trailing stop.
# Uses the shipped exit_signals.detect_climax_run unchanged.
SELL_INTO_STRENGTH = False
# Fraction of the position to unload into a climax (1.0 = whole, 0.5 = sell
# half and let the rest ride the trailing ladder — Minervini's partial
# "sell into strength" that keeps a runner while banking some gains).
CLIMAX_SELL_FRACTION = 1.0
# C71: MA-tightness base path (validated in the product footprint at C70 —
# recall 36->64%, FIRE +/-5 88.6->91.2). Same logic here so the tactics
# watchlist can pick up flat-base / base-on-base setups the cup detector's
# monotonic-depth gate rejects. Article-grounded (2x 'double off lows').
MA_TIGHT = False
# C72: quality-ranked slot allocation. C71 showed that adding MA-tight
# candidates and filling the 10 slots by RS alone DILUTES with lower-PF setups
# (6y -48pp). The design principle (Minervini: "more setups than money -> pick
# the BEST") says: expand the pool with recall, but fill the limited slots with
# the highest-quality setups first. Rank by setup source (VCP is the PF-2.13
# core), then RS, so VCP claims slots before MA-tight/base fallbacks.
QUALITY_RANK = False
_SOURCE_PRIORITY = {"vcp": 0, "tight_base": 1, "high30": 1, "ma_tight": 2}
# C73: confirm the 50DMA trend-exit. The mirror of his 908 picks
# (scripts/exit_leash_diagnostic.py) shows the single-day 50DMA-breakdown exit
# is the binding tightness: requiring TWO consecutive closes below the 50DMA
# (a whipsaw filter Minervini applies by design — a genuine trend break holds
# below the average) kept ~11 more picks in for the >=3R tail and lifted
# expectancy +0.28pp with flat/better PF. Structural rule, not a fitted
# parameter. Validate in BOTH windows before any SellPlanCard change.
CONFIRM_EXIT = False


def _quality_key(item):
    _sym, plan = item
    return (_SOURCE_PRIORITY.get(plan.get("source"), 3), -plan.get("rs", 0), _sym)
_MAT_BASE_MAX, _MAT_TIGHT, _MAT_RANGE = 42, 10, 0.12
_MAT_HUG, _MAT_HUGFRAC, _MAT_NEARHI, _MAT_ADV, _MAT_PRIOR = 0.05, 0.5, 0.85, 2.0, 126


def ma_tight_pivot(close_ser, high_ser, low_ser):
    """Chronological MA-tight base -> (pivot, base_low) or None (see C70)."""
    try:
        if len(close_ser) < _MAT_BASE_MAX + _MAT_PRIOR:
            return None
        piv = float(high_ser.iloc[-_MAT_BASE_MAX:].max())
        last = float(close_ser.iloc[-1])
        if piv <= 0 or last <= 0 or last < _MAT_NEARHI * piv:
            return None
        c = close_ser.iloc[-_MAT_TIGHT:]
        if (c.max() - c.min()) / c.max() > _MAT_RANGE:
            return None
        ma10 = close_ser.rolling(10).mean().iloc[-_MAT_TIGHT:]
        hug = np.abs(c.values - ma10.values) / ma10.values <= _MAT_HUG
        if np.nanmean(hug) < _MAT_HUGFRAC:
            return None
        rng = ((high_ser - low_ser) / close_ser).iloc[-_MAT_BASE_MAX:]
        h = len(rng) // 2
        if not (rng.iloc[h:].mean() < rng.iloc[:h].mean()):
            return None
        prior_low = float(low_ser.iloc[-(_MAT_BASE_MAX + _MAT_PRIOR):-_MAT_BASE_MAX].min())
        if not (prior_low > 0 and (piv / prior_low) >= _MAT_ADV):
            return None
        return piv, float(low_ser.iloc[-_MAT_BASE_MAX:].min())
    except Exception:
        return None
MAX_POSITION_PCT = 0.25
MIN_DOLLAR_VOL = 5e6
MIN_PRICE = 5.0
# Growth-stock method: index/sector funds are definitionally out of scope.
# Funds slip past the name denylist, so ALSO require a minimum average daily
# range — broad ETFs move ~1%/day while Minervini candidates are volatile
# growth names (the USIC preset's "moderate ADR" leg, floor side).
MIN_ADR_PCT = 1.5
ETF_DENYLIST = {
    "SPY", "QQQ", "DIA", "IWM", "IBB", "VOO", "VTI", "GLD", "SLV", "TQQQ",
    "SQQQ", "SOXL", "SOXX", "SMH", "XLF", "XLE", "XLK", "XLV", "XLI", "XLY",
    "XLP", "XLU", "XLB", "XLRE", "XLC", "ARKK", "EEM", "EFA", "HYG", "LQD",
    "TLT", "GDX", "USO", "UNG", "VXX", "UVXY", "BITO", "IBIT", "FBTC",
}


def load_panel(bundle_path: Path):
    """Bundle rows -> aligned (dates x symbols) panels, split-adjusted."""
    payload = json.loads(gzip.open(bundle_path).read())
    frames = {}
    for row in payload["rows"]:
        sym = row["symbol"]
        prices = row.get("prices") or []
        if len(prices) < 400:
            continue
        df = pd.DataFrame(prices)
        if "adj_close" not in df.columns or df["adj_close"].isna().all():
            continue
        df["date"] = pd.to_datetime(df["date"])
        df = df.set_index("date").sort_index()
        factor = df["adj_close"] / df["close"]
        frames[sym] = pd.DataFrame({
            "open": df["open"] * factor,
            "high": df["high"] * factor,
            "low": df["low"] * factor,
            "close": df["adj_close"],
            "volume": df["volume"].astype(float),
        })
    if "SPY" not in frames:
        raise SystemExit("bundle has no SPY — regime assessment impossible")
    calendar = frames["SPY"].index
    fields = {}
    for name in ("open", "high", "low", "close", "volume"):
        fields[name] = pd.DataFrame(
            {sym: f[name] for sym, f in frames.items()}
        ).reindex(calendar)
    return fields, payload.get("as_of_date")


def compute_indicators(close: pd.DataFrame, volume: pd.DataFrame):
    ind = {}
    ind["ma50"] = close.rolling(50).mean()
    ind["ma150"] = close.rolling(150).mean()
    ind["ma200"] = close.rolling(200).mean()
    ind["ma200_prev"] = ind["ma200"].shift(21)
    ind["hi252"] = close.rolling(252, min_periods=200).max()
    ind["lo252"] = close.rolling(252, min_periods=200).min()
    ind["vol50"] = volume.rolling(50).mean()
    r63 = close / close.shift(63) - 1
    r126 = close / close.shift(126) - 1
    r189 = close / close.shift(189) - 1
    r252 = close / close.shift(252) - 1
    raw = 0.4 * r63 + 0.2 * r126 + 0.2 * r189 + 0.2 * r252
    ind["rs"] = raw.rank(axis=1, pct=True) * 99.0   # authentic cross-sectional percentile
    template = (
        (close > ind["ma50"]) & (ind["ma50"] > ind["ma150"]) & (ind["ma150"] > ind["ma200"])
        & (ind["ma200"] > ind["ma200_prev"])
        & (close >= ind["lo252"] * 1.30)
        & (close >= ind["hi252"] * (1 - NEAR_HIGH_MAX_PCT / 100.0))
        & (ind["rs"] >= 70)
    )
    ind["template"] = template
    return ind


def regime_by_day(spy: pd.DataFrame, sim_dates) -> dict:
    """Suggested exposure % per day, from the shipped regime engine (incl. FTD)."""
    out = {}
    for d in sim_dates:
        window = spy.loc[:d]
        r = assess_market_regime(
            window.rename(columns={"open": "Open", "high": "High", "low": "Low",
                                   "close": "Close", "volume": "Volume"})
        )
        exposure = r.get("exposure_pct") if r.get("exposure_pct") is not None else 100
        if (
            TIERED_UPTREND
            and r.get("regime") == "confirmed_uptrend"
            and not (
                (r.get("health") or 0) >= POWER_HEALTH_MIN
                and (r.get("distribution_days") if r.get("distribution_days") is not None else 99) < POWER_DIST_MAX
            )
        ):
            # mature/deteriorating uptrend: cap at the proven step; an
            # FTD-upgraded regime already running 25/50/75 is left alone.
            exposure = min(exposure, MATURE_EXPOSURE)
        out[d] = {
            "regime": r.get("regime"),
            "exposure": exposure,
        }
    return out


def ladder_stop(close_px: float, entry: float, stop0: float, ma50: float, low20: float) -> float:
    """The shipped trailing ladder (exit_signals.compute_trailing_stop), inlined."""
    risk = entry - stop0
    if risk <= 0:
        return stop0
    r_mult = (close_px - entry) / risk
    if r_mult >= LADDER_LOCK_GAINS_R:
        stop = entry + risk
        for level in (ma50, low20 * 0.999 if low20 == low20 else np.nan):
            if level == level and stop < level < close_px:
                stop = level
    elif r_mult >= LADDER_BREAKEVEN_R:
        stop = entry
    elif r_mult >= LADDER_HALF_RISK_R:
        stop = entry - 0.5 * risk
    else:
        stop = stop0
    return max(stop, stop0)


def compute_band_panels(fields, symbols, spy_close):
    """Walk-forward band-state panels from the shipped minervini_bands engine.

    One ``calculate_bands`` call per symbol with ``history_bars`` widened to
    the full panel: the band debounce is strictly causal, so element i of the
    history strip equals the point-in-time badge an operator saw at bar i.
    Returns three boolean (dates x symbols) frames: TPR green, pressure green,
    and Buy Risk green-or-yellow.
    """
    close, opn, high, low, volume = (fields[k] for k in ("close", "open", "high", "low", "volume"))
    idx = close.index
    cfg = dataclasses.replace(mb.DAILY, history_bars=len(idx))
    tpr_g = pd.DataFrame(False, index=idx, columns=list(symbols))
    prs_g = pd.DataFrame(False, index=idx, columns=list(symbols))
    risk_ok = pd.DataFrame(False, index=idx, columns=list(symbols))
    for n, s in enumerate(symbols):
        df = pd.DataFrame({
            "Open": opn[s], "High": high[s], "Low": low[s],
            "Close": close[s], "Volume": volume[s],
        }).dropna(subset=["Close"])
        if len(df) < 260:
            continue
        b = mb.calculate_bands(df, benchmark_close=spy_close,
                               with_history=True, cfg=cfg)
        for key, frame, good in (
            ("tpr_history", tpr_g, ("strong",)),
            ("pressure_history", prs_g, ("buy",)),
            ("buy_risk_history", risk_ok, ("low", "medium")),
        ):
            hist = b.get(key) or []
            if hist:
                dates = df.index[-len(hist):]
                frame.loc[dates, s] = [st in good for st in hist]
        if (n + 1) % 200 == 0:
            print(f"bands: {n + 1}/{len(symbols)} symbols", flush=True)
    return tpr_g, prs_g, risk_ok


@dataclass
class Position:
    symbol: str
    shares: float
    entry: float
    stop0: float
    stop: float
    entry_date: object
    mode: str = ""
    source: str = ""
    below50_prev: bool = False   # prior close was below the 50DMA (--confirm-exit)


@dataclass
class Variant:
    name: str
    market_gate: bool = True
    trades: list = field(default_factory=list)
    equity_curve: list = field(default_factory=list)


def run_variant(name, market_gate, fields, ind, regimes, watch_by_week, sim_dates,
                start_equity=100_000.0, signal_ok=None):
    close, opn, high, low, volume = (fields[k] for k in ("close", "open", "high", "low", "volume"))
    v = Variant(name=name, market_gate=market_gate)
    cash = start_equity
    positions: dict[str, Position] = {}
    pending_sells: set[str] = set()
    sell_reason: dict[str, str] = {}
    pending_partials: dict[str, float] = {}
    pending_buys: dict[str, dict] = {}
    watch: dict[str, dict] = {}

    for i, d in enumerate(sim_dates):
        exposure_pct = regimes[d]["exposure"] if market_gate else 100
        if NO_CORRECTION_BUYS and market_gate and regimes[d]["regime"] == "correction":
            exposure_pct = 0  # cash in a correction; wait for the FTD
        under_pressure = market_gate and regimes[d]["regime"] == "uptrend_under_pressure"
        if SELECTIVE_PRESSURE and under_pressure:
            exposure_pct = 100  # leaders-only buying below replaces the cap
        if BREADTH_CONFIRM and under_pressure and regimes[d].get("breadth", 0.0) >= BREADTH_MIN:
            exposure_pct = 100  # broad participation: index-volume noise, not deterioration

        # --- execute queued exits at the open --------------------------------
        # sorted so float summation order (cash +=) is bitwise-reproducible
        for sym in sorted(pending_sells):
            if sym in positions and opn.at[d, sym] == opn.at[d, sym]:
                p = positions.pop(sym)
                px = opn.at[d, sym] * (1 - COST_PER_SIDE)
                cash += p.shares * px
                v.trades.append({"symbol": sym, "entry": p.entry, "exit": px,
                                 "entry_date": str(p.entry_date), "exit_date": str(d),
                                 "r": (px - p.entry) / (p.entry - p.stop0), "pnl": p.shares * (px - p.entry),
                                 "mode": p.mode, "source": p.source,
                                 "reason": sell_reason.get(sym, "signal")})
            pending_sells.discard(sym)
            sell_reason.pop(sym, None)

        # --- execute queued PARTIAL (climax) sells at the open --------------
        for sym in sorted(pending_partials):
            frac = pending_partials[sym]
            if sym in positions and opn.at[d, sym] == opn.at[d, sym]:
                p = positions[sym]
                sell_sh = p.shares * frac
                px = opn.at[d, sym] * (1 - COST_PER_SIDE)
                cash += sell_sh * px
                v.trades.append({"symbol": sym, "entry": p.entry, "exit": px,
                                 "entry_date": str(p.entry_date), "exit_date": str(d),
                                 "r": (px - p.entry) / (p.entry - p.stop0),
                                 "pnl": sell_sh * (px - p.entry),
                                 "mode": p.mode, "source": p.source,
                                 "reason": "climax_partial"})
                p.shares -= sell_sh
                if p.shares * px < 100:  # dust remainder -> close it out
                    positions.pop(sym)
        pending_partials.clear()

        # --- execute queued buys at the open ---------------------------------
        equity_mark = cash + sum(
            p.shares * (close.at[d, p.symbol] if close.at[d, p.symbol] == close.at[d, p.symbol] else p.entry)
            for p in positions.values()
        )
        invested = equity_mark - cash
        for sym, plan in list(pending_buys.items()):
            del pending_buys[sym]
            if sym in positions or len(positions) >= MAX_POSITIONS or exposure_pct <= 0:
                continue
            o = opn.at[d, sym]
            if o != o or o > plan["pivot"] * CHASE_CAP:
                continue
            entry = o * (1 + COST_PER_SIDE)
            stop0 = max(plan["base_low"], entry * (1 - MAX_LOSS_PCT))
            if stop0 >= entry:
                continue
            # Progressive risk (Minervini): commit harder only when the market
            # has confirmed — 2x account risk in a confirmed uptrend, base
            # risk everywhere else. Gate-off variants keep the base risk so
            # the comparison isolates the regime-linked sizing.
            risk_pct = ACCOUNT_RISK_PCT
            if PROGRESSIVE_RISK and market_gate and regimes[d]["regime"] == "confirmed_uptrend":
                risk_pct = ACCOUNT_RISK_PCT * 2
            risk_dollars = equity_mark * (risk_pct / 100.0)
            shares = risk_dollars / (entry - stop0)
            shares = min(shares, (MAX_POSITION_PCT * equity_mark) / entry, cash / entry)
            headroom = (exposure_pct / 100.0) * equity_mark - invested
            shares = min(shares, max(0.0, headroom) / entry)
            if shares * entry < 1_000:
                continue
            cash -= shares * entry
            invested += shares * entry
            positions[sym] = Position(sym, shares, entry, stop0, stop0, d,
                                      plan.get("mode", ""), plan.get("source", ""))

        # --- intraday protective stops ---------------------------------------
        for sym in list(positions):
            p = positions[sym]
            lo = low.at[d, sym]
            if lo == lo and lo <= p.stop:
                o = opn.at[d, sym]
                px = (min(o, p.stop) if o == o else p.stop) * (1 - COST_PER_SIDE)
                cash += p.shares * px
                v.trades.append({"symbol": sym, "entry": p.entry, "exit": px,
                                 "entry_date": str(p.entry_date), "exit_date": str(d),
                                 "r": (px - p.entry) / (p.entry - p.stop0), "pnl": p.shares * (px - p.entry),
                                 "mode": p.mode, "source": p.source, "reason": "stop"})
                positions.pop(sym)

        # --- close-based management: ladder + 50DMA breakdown ----------------
        for sym, p in positions.items():
            c = close.at[d, sym]
            if c != c:
                continue
            ma50 = ind["ma50"].at[d, sym]
            low20 = low[sym].iloc[max(0, close.index.get_loc(d) - 19): close.index.get_loc(d) + 1].min()
            p.stop = ladder_stop(c, p.entry, p.stop0, ma50 if ma50 == ma50 else np.nan, low20)
            vol_ratio = (volume.at[d, sym] / ind["vol50"].at[d, sym]) if ind["vol50"].at[d, sym] else 0
            below50 = ma50 == ma50 and c < ma50
            fire_50dma = below50 and vol_ratio >= 1.5 and (p.below50_prev or not CONFIRM_EXIT)
            p.below50_prev = below50
            if fire_50dma:
                pending_sells.add(sym)
            elif SELL_INTO_STRENGTH and c > p.entry:
                di = close.index.get_loc(d)
                win = pd.DataFrame({
                    "Close": close[sym].iloc[max(0, di - 219): di + 1],
                    "Open": opn[sym].iloc[max(0, di - 219): di + 1],
                }).dropna()
                if len(win) >= 60 and detect_climax_run(win).get("active"):
                    if CLIMAX_SELL_FRACTION >= 1.0:
                        pending_sells.add(sym)
                        sell_reason[sym] = "climax"
                    elif sym not in pending_partials:
                        pending_partials[sym] = CLIMAX_SELL_FRACTION

        # --- entry signals at the close (fill tomorrow) -----------------------
        # Armed buy-stops must be judged against YESTERDAY's plans: an armed
        # name has close <= pivot on its scan day by definition, so checking
        # the cross against the same day's freshly rebuilt watchlist could
        # never fire (the daily overwrite silently killed the armed path —
        # every historical entry came from the 'early' lane, 1-2 days late
        # and up to 5% above the pivot).
        prev_watch = watch
        wk = watch_by_week.get(d)
        if wk is not None:
            watch = wk
        if exposure_pct > 0 or not market_gate:
            def _entry_allowed(sym, plan):
                if SELECTIVE_PRESSURE and under_pressure and plan.get("rs", 0) < PRESSURE_RS_MIN:
                    return False
                return _risk_ok(sym)

            def _risk_ok(sym):
                # product funnel: Buy Risk green/yellow on the signal day
                # (the breakout barrel's risk_ok half in compute_buy_signal)
                return signal_ok is None or bool(signal_ok.at[d, sym])

            _armed_items = sorted(prev_watch.items(), key=_quality_key) if QUALITY_RANK else prev_watch.items()
            for sym, plan in _armed_items:  # armed stops set before today
                if plan["mode"] != "armed" or sym in positions or sym in pending_buys:
                    continue
                if not _entry_allowed(sym, plan):
                    continue
                c = close.at[d, sym]
                hi = high.at[d, sym]
                vol50 = ind["vol50"].at[d, sym]
                volr = volume.at[d, sym] / vol50 if vol50 and vol50 == vol50 else 0
                if (c == c and hi == hi and hi >= plan["pivot"] and c > plan["pivot"]
                        and c <= plan["pivot"] * CHASE_CAP and volr >= BREAKOUT_VOL_RATIO):
                    pending_buys[sym] = plan
            _early_items = sorted(watch.items(), key=_quality_key) if QUALITY_RANK else watch.items()
            for sym, plan in _early_items:  # early post-breakout, today's scan
                if plan["mode"] != "early" or sym in positions or sym in pending_buys:
                    continue
                if not _entry_allowed(sym, plan):
                    continue
                c = close.at[d, sym]
                # breakout already volume-confirmed at scan; buy next open
                # while the chase cap still holds
                if c == c and c <= plan["pivot"] * CHASE_CAP:
                    pending_buys[sym] = plan

        equity = cash + sum(
            p.shares * (close.at[d, p.symbol] if close.at[d, p.symbol] == close.at[d, p.symbol] else p.entry)
            for p in positions.values()
        )
        v.equity_curve.append({"date": str(d.date()), "equity": equity,
                               "invested_pct": round(100 * (equity - cash) / equity, 1),
                               "exposure_cap": exposure_pct, "positions": len(positions)})

    # liquidate at final close for reporting
    d = sim_dates[-1]
    for sym, p in list(positions.items()):
        c = close.at[d, sym]
        px = (c if c == c else p.entry) * (1 - COST_PER_SIDE)
        cash += p.shares * px
        v.trades.append({"symbol": sym, "entry": p.entry, "exit": px,
                         "entry_date": str(p.entry_date), "exit_date": str(d),
                         "r": (px - p.entry) / (p.entry - p.stop0), "pnl": p.shares * (px - p.entry),
                         "mode": p.mode, "source": p.source, "reason": "end"})
    v.equity_curve[-1]["equity"] = cash
    return v


def metrics(curve, trades, start_equity=100_000.0):
    eq = pd.Series([p["equity"] for p in curve], index=pd.to_datetime([p["date"] for p in curve]))
    ret = eq.pct_change().dropna()
    years = max((eq.index[-1] - eq.index[0]).days / 365.25, 1e-9)
    total = eq.iloc[-1] / start_equity - 1
    cagr = (1 + total) ** (1 / years) - 1
    dd = (eq / eq.cummax() - 1).min()
    sharpe = ret.mean() / ret.std() * np.sqrt(252) if ret.std() > 0 else 0.0
    wins = [t for t in trades if t.get("pnl", t["exit"] - t["entry"]) > 0]
    out = {
        "total_return_pct": round(100 * total, 1),
        "cagr_pct": round(100 * cagr, 1),
        "max_drawdown_pct": round(100 * dd, 1),
        "sharpe": round(float(sharpe), 2),
        "trades": len(trades),
        "win_rate_pct": round(100 * len(wins) / len(trades), 1) if trades else None,
        "avg_r": round(float(np.mean([t["r"] for t in trades])), 2) if trades else None,
        "profit_factor": None,
        "avg_invested_pct": round(float(np.mean([p["invested_pct"] for p in curve])), 1),
    }
    if trades:
        gains = sum(max(0.0, t.get("pnl", t["exit"] - t["entry"])) for t in trades)
        losses = sum(max(0.0, -t.get("pnl", t["exit"] - t["entry"])) for t in trades)
        out["profit_factor"] = round(gains / losses, 2) if losses > 0 else None
    yearly = eq.resample("YE").last()
    prev = start_equity
    out["yearly_return_pct"] = {}
    for ts, val in yearly.items():
        out["yearly_return_pct"][str(ts.year)] = round(100 * (val / prev - 1), 1)
        prev = val
    return out


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--vcp-only", action="store_true",
                    help="diagnostic: drop the tight-base fallback from the "
                         "watchlist so only VCPDetector setups trade")
    ap.add_argument("--sell-into-strength", action="store_true",
                    help="exit profitable positions into a climax run "
                         "(exit_signals.detect_climax_run) instead of only on "
                         "the trailing stop / 50DMA breakdown")
    ap.add_argument("--quality-rank", action="store_true",
                    help="fill the position slots by setup quality (VCP first, "
                         "then RS) instead of RS alone — recall expands the "
                         "pool, quality picks the winners for the limited slots")
    ap.add_argument("--ma-tight", action="store_true",
                    help="add the C70 MA-tightness base path to the watchlist "
                         "(flat-base/base-on-base the cup detector misses)")
    ap.add_argument("--climax-partial", action="store_true",
                    help="with --sell-into-strength, unload only HALF into the "
                         "climax and keep the rest on the trailing ladder")
    ap.add_argument("--no-correction-buys", action="store_true",
                    help="treat a market correction as a hard no-buy (0% "
                         "exposure, like a downtrend) instead of the residual "
                         "20% cap — wait for the FTD before buying")
    ap.add_argument("--tiered-uptrend", action="store_true",
                    help="full 100%% exposure only in POWER trends (health>=80, "
                         "dist<2); mature confirmed uptrends run at the FTD "
                         "ladder's proven 75%% step (chop-bleed control, C85)")
    ap.add_argument("--group-rotation", action="store_true",
                    help="allow new buys only from LEADING (top-20%%) or "
                         "EMERGING (+0.20 rank-pct/21d, top half) IBD groups; "
                         "walk-forward group RS = mean member RS percentile "
                         "(data/IBD_industry_group.csv); fail-open on unmapped")
    ap.add_argument("--breadth-regime", action="store_true",
                    help="downgrade a confirmed_uptrend to under-pressure "
                         "exposure when <40%% of the tradable universe holds "
                         "its 200DMA (breadth-divergence guard)")
    ap.add_argument("--breadth-confirm", action="store_true",
                    help="under pressure: keep full exposure while >=60% of "
                         "the tradable universe holds its 200DMA")
    ap.add_argument("--selective-pressure", action="store_true",
                    help="under pressure: only RS>=90 leaders may be bought, "
                         "but at full exposure (tighten selection, not buying)")
    ap.add_argument("--progressive-risk", action="store_true",
                    help="Minervini progressive risk: 2x account risk per "
                         "trade while the regime is confirmed_uptrend")
    ap.add_argument("--confirm-exit", action="store_true",
                    help="require TWO consecutive closes below the 50DMA before "
                         "the trend-exit fires (whipsaw filter) — the binding "
                         "tightness found in the 908-pick mirror")
    ap.add_argument("--funnel", choices=("legacy", "product"), default="legacy",
                    help="'product' replays the shipped Buy Signal checklist: "
                         "TPR band green + pressure band green as candidate "
                         "gates, VCP pivot else the 30-bar consolidation high "
                         "(signals._breakout_now fallback), and Buy Risk "
                         "green/yellow required on the signal day")
    args = ap.parse_args()
    global PROGRESSIVE_RISK, SELECTIVE_PRESSURE, BREADTH_CONFIRM, NO_CORRECTION_BUYS
    global SELL_INTO_STRENGTH
    PROGRESSIVE_RISK = args.progressive_risk
    SELECTIVE_PRESSURE = args.selective_pressure
    BREADTH_CONFIRM = args.breadth_confirm
    NO_CORRECTION_BUYS = args.no_correction_buys
    SELL_INTO_STRENGTH = args.sell_into_strength
    global CLIMAX_SELL_FRACTION, MA_TIGHT, QUALITY_RANK, CONFIRM_EXIT, BREADTH_REGIME
    global GROUP_ROTATION, TIERED_UPTREND
    CLIMAX_SELL_FRACTION = 0.5 if args.climax_partial else 1.0
    MA_TIGHT = args.ma_tight
    QUALITY_RANK = args.quality_rank
    CONFIRM_EXIT = args.confirm_exit
    BREADTH_REGIME = args.breadth_regime
    GROUP_ROTATION = args.group_rotation
    TIERED_UPTREND = args.tiered_uptrend

    fields, as_of = load_panel(Path(args.bundle))
    close, volume, low, high = fields["close"], fields["volume"], fields["low"], fields["high"]

    # liquidity/price/ETF universe hygiene (measured at the start of the sim window)
    print(f"panel: {close.shape[1]} symbols x {close.shape[0]} days (as_of {as_of})", flush=True)
    ind = compute_indicators(close, volume)

    first_valid = 260
    sim_dates = list(close.index[first_valid:])
    dollar_vol = (close * volume).rolling(60).mean()
    at_start = dollar_vol.iloc[first_valid]
    px_start = close.iloc[first_valid]
    tradable = [
        s for s in close.columns
        if s not in ETF_DENYLIST and at_start.get(s, np.nan) == at_start.get(s, np.nan)
        and at_start[s] >= MIN_DOLLAR_VOL and px_start.get(s, 0) >= MIN_PRICE
    ]
    print(f"tradable universe: {len(tradable)} symbols; sim {sim_dates[0].date()} -> {sim_dates[-1].date()}", flush=True)

    spy = fields["close"]["SPY"].to_frame("close").join(
        fields["open"]["SPY"].rename("open")).join(fields["high"]["SPY"].rename("high")).join(
        fields["low"]["SPY"].rename("low")).join(fields["volume"]["SPY"].rename("volume"))
    regimes = regime_by_day(spy.dropna(), sim_dates)
    # Market breadth: fraction of the tradable universe holding its 200DMA
    # (valid-ma200 names only). Walk-forward by construction.
    above200 = close[tradable].gt(ind["ma200"][tradable])
    valid200 = ind["ma200"][tradable].notna()
    breadth_series = above200.sum(axis=1) / valid200.sum(axis=1).clip(lower=1)
    for d in sim_dates:
        regimes[d]["breadth"] = float(breadth_series.loc[d])
    if BREADTH_REGIME:
        # Breadth-DIVERGENCE downgrade: only when the index is AT ITS HIGHS
        # (within 3% of the 252d high) while <40% of the universe holds its
        # 200DMA — the definition of a narrow distribution top. The first cut
        # omitted the near-highs condition and fired at post-FTD BOTTOMS where
        # breadth is still rebuilding (the most profitable moment to be long):
        # both windows collapsed (6y 112.4->76.5, 10y 97.8->72.1) = that rule
        # punished bottoms, not tops.
        spy_close = spy["close"]
        spy_hi252 = spy_close.rolling(252, min_periods=60).max()
        downgraded = 0
        for d in sim_dates:
            hi = float(spy_hi252.loc[:d].iloc[-1]) if d in spy_hi252.index else float("nan")
            px = float(spy_close.loc[:d].iloc[-1])
            near_high = hi == hi and hi > 0 and (hi - px) / hi <= 0.03
            if (regimes[d]["regime"] == "confirmed_uptrend"
                    and near_high
                    and regimes[d]["breadth"] < BREADTH_ROT):
                regimes[d]["regime"] = "uptrend_under_pressure"
                regimes[d]["exposure"] = 55
                downgraded += 1
        print(f"breadth-regime: downgraded {downgraded}/{len(sim_dates)} days", flush=True)
    print("regime days computed", flush=True)

    # --- group-rotation: walk-forward per-group RS percentile panel ----------
    group_pct = group_mom = None
    sym_group = None
    if GROUP_ROTATION:
        sym_group = {}
        with open(IBD_CSV, newline="", encoding="utf-8") as fh:
            for parts in csv.reader(fh):
                if len(parts) >= 2 and parts[0].strip() and parts[1].strip() \
                        and parts[1].strip() != ETF_GROUP:
                    sym_group[parts[0].strip().upper()] = parts[1].strip()
        mapped = [s for s in tradable if s in sym_group]
        grp_of = pd.Series({s: sym_group[s] for s in mapped})
        rs_m = ind["rs"][mapped]
        grp_score = rs_m.T.groupby(grp_of).mean().T           # dates x groups
        grp_n = rs_m.notna().T.groupby(grp_of).sum().T
        grp_score = grp_score.where(grp_n >= GROUP_MIN_MEMBERS)
        group_pct = grp_score.rank(axis=1, pct=True)          # 1.0 = strongest group
        group_mom = group_pct.diff(GROUP_MOM_DAYS)
        print(f"group-rotation: {grp_score.shape[1]} groups, map coverage "
              f"{100 * len(mapped) / len(tradable):.0f}% of tradable", flush=True)

    # Track market-turn upgrades (correction/downtrend -> confirmed_uptrend) so
    # the group gate can stand down during its structurally-blind first quarter.
    _last_upgrade_idx = {}
    if GROUP_ROTATION:
        prev_reg = None
        for _i, _d in enumerate(close.index):
            r = regimes.get(_d, {}).get("regime")
            if r is None:
                continue
            if prev_reg in ("correction", "downtrend") and r == "confirmed_uptrend":
                _last_upgrade_idx[_i] = True
            prev_reg = r
        _ups = sorted(_last_upgrade_idx)
        _last_upgrade_idx = {"ups": _ups}

    # DAILY watchlists using the REAL VCP detector on template+RS leaders.
    # (Weekly sampling starved the entry funnel: a VCP pivot approach lasts
    # days, and the live product scans daily — the sim must too.)
    det = VCPDetector()
    band_panels = None
    if args.funnel == "product":
        print("computing walk-forward band panels (shipped minervini_bands)...", flush=True)
        band_panels = compute_band_panels(fields, tradable, close["SPY"])
        greens = (band_panels[0] & band_panels[1]).loc[sim_dates].sum(axis=1)
        print(f"band panels done: avg {greens.mean():.1f} TPR∧pressure-green names/day", flush=True)
    watch_by_week: dict = {}
    week_marks = sim_dates
    tradable_set = set(tradable)
    for d in week_marks:
        idx = close.index.get_loc(d)
        row_t = ind["template"].iloc[idx]
        row_rs = ind["rs"].iloc[idx]
        # RS-descending order: the watchlist dict (and therefore entry-signal
        # priority under the 10-position cap) starts with the strongest names,
        # per Minervini "buy the leaders". Iterating the raw set here made the
        # whole simulation nondeterministic (string-hash order varies per
        # process): two runs of the same bundle differed by tens of pp.
        cands = sorted(
            (s for s in tradable_set
             if bool(row_t.get(s, False)) and row_rs.get(s, 0) >= RS_MIN),
            key=lambda s: (-row_rs.get(s, 0), s),
        )
        if band_panels is not None:
            # product funnel: the checklist's first two barrels are candidate
            # gates — TPR band green (strong) and pressure band green (buy)
            tpr_row, prs_row = band_panels[0].iloc[idx], band_panels[1].iloc[idx]
            cands = [s for s in cands if bool(tpr_row.get(s, False)) and bool(prs_row.get(s, False))]
        _ups = _last_upgrade_idx.get("ups", []) if group_pct is not None else []
        _last_up = max((u for u in _ups if u <= idx), default=-10**6)
        if group_pct is not None and (idx - _last_up) >= GROUP_FTD_SUSPEND:
            gp_row, gm_row = group_pct.iloc[idx], group_mom.iloc[idx]

            def _grp_ok(s):
                g = sym_group.get(s)
                if g is None:
                    return True                      # unmapped: fail OPEN
                gp = gp_row.get(g, np.nan)
                if gp != gp:
                    return True                      # unranked group: fail OPEN
                if gp >= GROUP_LEAD_PCT:
                    return True                      # LEADING
                gm = gm_row.get(g, np.nan)
                return gm == gm and gm >= GROUP_EMERGE_DELTA and gp >= GROUP_HALF_PCT  # EMERGING
            cands = [s for s in cands if _grp_ok(s)]
        wl = {}
        for s in cands:
            prices = close[s].iloc[max(0, idx - 251): idx + 1].dropna()
            vols = volume[s].iloc[max(0, idx - 251): idx + 1].dropna()
            if len(prices) < 200:
                continue
            c0 = float(prices.iloc[-1])
            hi_seg = high[s].iloc[max(0, idx - 19): idx + 1]
            lo_seg = low[s].iloc[max(0, idx - 19): idx + 1]
            adr = float(((hi_seg / lo_seg) - 1).mean() * 100) if len(hi_seg) >= 10 else 0.0
            if adr < MIN_ADR_PCT:
                continue
            v50 = ind["vol50"][s].iloc[idx]
            recent_vol_surge = bool(v50 and v50 == v50 and
                                    (vols.iloc[-5:] / v50).max() >= BREAKOUT_VOL_RATIO)

            piv = base_low = None
            source = None
            # detect_vcp expects MOST-RECENT-FIRST series (see vcp_footprint.py,
            # which reverses with iloc[::-1] before calling). Passing
            # chronological order here fed the detector a time-mirrored chart.
            r = det.detect_vcp(prices.iloc[::-1].reset_index(drop=True),
                               vols.iloc[::-1].reset_index(drop=True))
            vpiv = (r.get("pivot_info") or {}).get("pivot")
            if r.get("vcp_detected") and vpiv and r.get("recent_base_low"):
                piv, base_low, source = float(vpiv), float(r["recent_base_low"]), "vcp"
            elif MA_TIGHT and args.funnel != "product" and (
                (mt := ma_tight_pivot(prices, high[s].iloc[:idx + 1], low[s].iloc[:idx + 1])) is not None
            ):
                piv, base_low, source = mt[0], mt[1], "ma_tight"
            elif args.funnel == "product":
                # the shipped signal engine's fallback (signals._breakout_now):
                # pivot = prior 30-bar consolidation high, base low = 30-bar low
                hi30 = high[s].iloc[max(0, idx - 30): idx].dropna()
                lo30 = low[s].iloc[max(0, idx - 30): idx].dropna()
                if len(hi30) >= 20:
                    piv, base_low, source = float(hi30.max()), float(lo30.min()), "high30"
            elif not args.vcp_only:
                # Tight continuation base (published Minervini criteria, no
                # fitting): >=4-week base whose high is >=10 sessions old,
                # depth <=25%, final 10 closes in a <=8% range. He buys these
                # (cup-with-handle etc.) too — VCP-only starved the funnel to
                # <1 name/day across 3,340 stocks (detector recall ~35%).
                lows = low[s].iloc[max(0, idx - 251): idx + 1].dropna()
                if len(prices) >= 22 and len(lows) >= 22:
                    base_closes = prices.iloc[-22:-1]
                    bpiv = float(base_closes.max())
                    age = len(base_closes) - 1 - int(np.argmax(base_closes.to_numpy()))
                    blow = float(lows.iloc[-22:-1].min())
                    depth_ok = bpiv > 0 and (bpiv - blow) / bpiv <= 0.25
                    last10 = prices.iloc[-10:]
                    tight_ok = bpiv > 0 and (last10.max() - last10.min()) / bpiv <= 0.08
                    if age >= 10 and depth_ok and tight_ok:
                        piv, base_low, source = bpiv, blow, "tight_base"
            if piv is None:
                continue

            # Minervini's two executable states (the funnel diagnostic showed
            # 98.6% of template+RS+VCP names are ALREADY past the pivot at
            # scan time — waiting for a fresh crossing almost never fills):
            #   armed  — price still at/below the pivot: buy-stop AT the pivot.
            #   early  — 0-5% above the pivot with a volume-confirmed breakout
            #            in the last 5 sessions: buy the early post-breakout.
            if args.funnel == "product" and c0 > piv:
                # early eligibility per signals._breakout_now: a FRESH pivot
                # cross (prior close still under) on >=1.5x volume within the
                # active window (5 bars). Without this the 30-bar-high fallback
                # marks any name drifting near its highs as buyable and the
                # funnel triples with extended, base-less entries.
                fired = False
                for j in range(max(idx - 4, 31), idx + 1):
                    pj = piv if source in ("vcp", "ma_tight") else float(high[s].iloc[j - 30: j].max())
                    cj = close[s].iloc[j]
                    cjm1 = close[s].iloc[j - 1]
                    vj = volume[s].iloc[j]
                    v50j = ind["vol50"][s].iloc[j]
                    if (cj == cj and cjm1 == cjm1 and vj == vj and v50j and v50j == v50j
                            and cj > pj and cjm1 <= pj and vj / v50j >= BREAKOUT_VOL_RATIO):
                        fired = True
                        break
                if fired and c0 <= piv * CHASE_CAP:
                    wl[s] = {"pivot": piv, "base_low": base_low, "mode": "early", "source": source, "rs": float(row_rs.get(s, 0))}
            elif c0 <= piv:
                wl[s] = {"pivot": piv, "base_low": base_low, "mode": "armed", "source": source, "rs": float(row_rs.get(s, 0))}
            elif c0 <= piv * CHASE_CAP and recent_vol_surge:
                wl[s] = {"pivot": piv, "base_low": base_low, "mode": "early", "source": source, "rs": float(row_rs.get(s, 0))}
        watch_by_week[d] = wl
    sizes = [len(w) for w in watch_by_week.values()]
    print(f"daily watchlists: {len(watch_by_week)} days, avg {np.mean(sizes):.1f} names, max {max(sizes)}", flush=True)

    results = {}
    signal_ok = band_panels[2] if band_panels is not None else None
    for name, gate in (("full_tactics", True), ("no_market_gate", False)):
        v = run_variant(name, gate, fields, ind, regimes, watch_by_week, sim_dates,
                        signal_ok=signal_ok)
        results[name] = {"metrics": metrics(v.equity_curve, v.trades),
                         "trades": v.trades, "equity_curve": v.equity_curve}
        print(f"{name}: {results[name]['metrics']}", flush=True)

    # benchmarks
    spy_c = close["SPY"].loc[sim_dates]
    spy_ret = spy_c.pct_change().fillna(0)
    bh = (1 + spy_ret).cumprod() * 100_000
    exp_series = pd.Series({d: regimes[d]["exposure"] / 100.0 for d in sim_dates}).shift(1).fillna(0)
    timed = (1 + spy_ret * exp_series.values).cumprod() * 100_000
    for label, series in (("spy_buy_hold", bh), ("spy_regime_timed", timed)):
        curve = [{"date": str(d.date()), "equity": float(x), "invested_pct": 100.0}
                 for d, x in series.items()]
        results[label] = {"metrics": metrics(curve, []), "equity_curve": curve}
        print(f"{label}: {results[label]['metrics']}", flush=True)

    out = {
        "as_of": as_of,
        "window": {"start": str(sim_dates[0].date()), "end": str(sim_dates[-1].date())},
        "universe_size": len(tradable),
        "vcp_only": args.vcp_only,
        "funnel": args.funnel,
        "no_correction_buys": args.no_correction_buys,
        "sell_into_strength": args.sell_into_strength,
        "climax_partial": args.climax_partial,
        "ma_tight": args.ma_tight,
        "quality_rank": args.quality_rank,
        "confirm_exit": args.confirm_exit,
        "breadth_regime": args.breadth_regime,
        "group_rotation": args.group_rotation,
        "tiered_uptrend": args.tiered_uptrend,
        "caveats": [
            "survivorship bias: today's listed universe only",
            "technicals only: point-in-time fundamentals unavailable (C43 bonus excluded)",
            "daily bars: entries at next open (later than intraday pivot buys), 10bps/side costs",
        ],
        "results": {k: {"metrics": v["metrics"]} for k, v in results.items()},
    }
    Path(args.output).write_text(json.dumps(out, indent=2))
    full = Path(args.output).with_suffix(".full.json")
    full.write_text(json.dumps(results, indent=2, default=str))
    print(f"report -> {args.output}\nfull -> {full}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
