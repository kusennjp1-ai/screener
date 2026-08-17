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
import hashlib
import json
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
import pandas as pd

import null_models
from app.scanners.criteria.vcp_detection import VCPDetector
from app.services.markets360.vcp_footprint import _base_anchored
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
CASH_YIELD_PCT = 0.0  # set by --cash-yield-pct: annualised return on idle cash
BASE_ANCHORED = False  # set by --base-anchored: extra VCP detection path
# Alternative SELECTION thesis (--selection). None = the shipped screener.
#   group_leaders : the IBD/MarketSurge idea — own the highest-RS names inside the
#                   top-40 industry groups, entered once the general market is a
#                   CONFIRMED uptrend (i.e. after a follow-through day), with no
#                   VCP/base pattern requirement at all.
SELECTION = None
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
# --- NULL MODELS (opt-in, default OFF) -----------------------------------
# Set by --null. None reproduces every recorded run byte-for-byte: each hook
# below is a no-op branch that is not entered unless NULL_MODE is truthy.
# See scripts/null_models.py for what each null replaces and why.
NULL_MODE = None
NULL_SEED = 0
NULL_EPOCH_LEN = 1     # P, MEASURED from the screener's own watchlist (dump sidecar)
NULL_EPOCH_OFFSET = 0  # = first_valid, so run_variant's day i and the build loop's
                       # panel index agree on epoch boundaries for the same date
SLOT_FIELD = None      # UniformField -> per-day override of _quality_key
FLAT_STOP = False      # --flat-stop: stop forced to entry*(1-MAX_LOSS_PCT)


def _quality_key(item):
    _sym, plan = item
    return (_SOURCE_PRIORITY.get(plan.get("source"), 3), -plan.get("rs", 0), _sym)


def assign_mode(c0, piv, base_low, source, rs, recent_vol_surge):
    """Minervini's two executable states -> a watchlist plan, or None.

    HOISTED VERBATIM from the candidate loop so the SCREENER AND EVERY NULL
    CALL THE IDENTICAL FUNCTION. The armed/early split decides which entry lane
    a name enters, and the campaign has already measured the lanes as having
    opposite expectancy (armed -0.18R / -0.06R, all profit in early). If the
    lane rule were restated inside the null it could drift, and the comparison
    would silently measure the lane mix instead of the stock picking.

      armed — price still at/below the pivot: buy-stop AT the pivot.
      early — 0-5% above the pivot with a volume-confirmed breakout in the
              last 5 sessions: buy the early post-breakout.
    """
    if c0 <= piv:
        mode = "armed"
    elif c0 <= piv * CHASE_CAP and recent_vol_surge:
        mode = "early"
    else:
        return None
    return {"pivot": piv, "base_low": base_low, "mode": mode,
            "source": source, "rs": rs}


def hygiene_panels(close, high, low, volume, vol50):
    """POOL HYGIENE, vectorised — ONE definition of "the eligible pool".

    A restatement of the per-symbol checks the candidate loop applies inline
    (>=200 valid closes in the trailing 252 bars; ADR20 >= MIN_ADR_PCT), plus
    the 5-bar volume surge the lane rule needs. The screener's inline code is
    deliberately left untouched so no recorded run can move; equality of the
    two formulations is checked, not assumed, by --verify-pool.

    Exact-equivalence notes (why the min_periods look odd):
      - ``len(close.iloc[i-251:i+1].dropna()) >= 200`` == a 252-bar rolling
        count of non-NaN closes >= 200.
      - the inline ADR is ``((high/low)-1).mean()`` over the last 20 bars with
        pandas' skipna, and the guard is ``if adr < MIN_ADR_PCT: continue`` —
        so an ALL-NaN window yields NaN and does NOT skip. ``~(adr < MIN)``
        reproduces that three-valued behaviour exactly.
      - the surge divides the last 5 volumes by TODAY's vol50, not by each
        bar's own vol50 — that is what the inline code does
        (``(vols.iloc[-5:] / v50).max()`` with a single ``v50 = vol50[idx]``),
        and dividing per-bar instead would quietly give the two arms different
        lane inputs. ``vol50 <= 0`` / NaN is masked to NaN so the comparison is
        False, matching the inline ``if v50 and v50 == v50`` guard.
        The inline version takes the last 5 NON-NaN volumes while this takes
        the last 5 BARS; they coincide for every symbol a null can draw,
        because pool membership needs a 60-bar rolling mean dollar volume
        (min_periods=60), which is NaN if any of the last 60 volumes is NaN.
    """
    hist_ok = close.notna().rolling(252, min_periods=1).sum() >= 200
    adr20 = ((high / low) - 1).rolling(20, min_periods=1).mean() * 100.0
    hygiene = hist_ok & ~(adr20 < MIN_ADR_PCT)
    v50 = vol50.where(vol50 > 0)
    surge = (volume.rolling(5, min_periods=1).max() / v50) >= BREAKOUT_VOL_RATIO
    return hygiene, surge
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

        # Idle cash accrues at the stated rate BEFORE anything trades, so a
        # day spent fully in cash earns exactly one day of it. Zero unless
        # --cash-yield-pct is given, which keeps the default headline
        # conservative (see the flag's help for why a rate is not assumed).
        if CASH_YIELD_PCT:
            cash *= 1.0 + (CASH_YIELD_PCT / 100.0) / 252.0

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
                                 "mode": p.mode, "source": p.source, "stop0": p.stop0,
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
                                 "mode": p.mode, "source": p.source, "stop0": p.stop0,
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
            # HELD CONSTANT ACROSS ARMS except where it provably cannot be:
            # base_low is an OUTPUT of L2, so a null cannot borrow it without
            # importing the pattern layer it exists to null. That makes stop
            # distance -> position size a confound, not a selection effect.
            # --flat-stop removes it entirely (identical sizing by
            # construction) and is the pre-registered tie-breaker when the
            # arms' median stop distances differ by >1pp of entry.
            stop0 = (entry * (1 - MAX_LOSS_PCT) if FLAT_STOP
                     else max(plan["base_low"], entry * (1 - MAX_LOSS_PCT)))
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
                                 "mode": p.mode, "source": p.source, "stop0": p.stop0,
                                 "reason": "stop"})
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
                if SELECTION == "group_leaders" and market_gate and \
                        regimes[d]["regime"] != "confirmed_uptrend":
                    # "after a follow-through day" -- the confirmed-uptrend label
                    # IS the post-FTD state (market_regime.py). Buying leaders is
                    # only allowed once the general market has confirmed.
                    return False
                if SELECTIVE_PRESSURE and under_pressure and plan.get("rs", 0) < PRESSURE_RS_MIN:
                    return False
                return _risk_ok(sym)

            def _risk_ok(sym):
                # product funnel: Buy Risk green/yellow on the signal day
                # (the breakout barrel's risk_ok half in compute_buy_signal)
                return signal_ok is None or bool(signal_ok.at[d, sym])

            # L3 HOOK (--null slot_shuffle). The ONLY change this null makes to
            # the simulation: the ORDER in which the 10 position slots are
            # offered. Same watchlist, same pivots, same base_low, same lanes,
            # same trigger, same sizing — so a difference isolates the
            # quality-ranked slot allocation and nothing else. Epoch-stable
            # (see null_models.slot_key_factory): a per-day re-lottery would
            # add turnover noise on top of the ordering change being measured.
            if SLOT_FIELD is not None:
                _slot_key = null_models.slot_key_factory(
                    SLOT_FIELD, (i + NULL_EPOCH_OFFSET) // NULL_EPOCH_LEN)
            else:
                _slot_key = _quality_key if QUALITY_RANK else None

            _armed_items = sorted(prev_watch.items(), key=_slot_key) if _slot_key else prev_watch.items()
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
            _early_items = sorted(watch.items(), key=_slot_key) if _slot_key else watch.items()
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
                         "mode": p.mode, "source": p.source, "stop0": p.stop0,
                         "reason": "end"})
    v.equity_curve[-1]["equity"] = cash
    return v


def payoff_distribution(trades):
    """Make the asymmetric payoff visible: cut the left tail small, let the
    right tail (a few big winners) run. Pure measurement — no strategy input,
    no frozen metric. Reports expectancy, the winner/loser payoff ratio, the
    R-multiple histogram, and how concentrated the gross gains are in the top
    trades (the right-tail contribution the Minervini edge lives in)."""
    if not trades:
        return None
    rs = [float(t["r"]) for t in trades]
    pnls = [float(t.get("pnl", t["exit"] - t["entry"])) for t in trades]
    win_r = [r for r in rs if r > 0]
    loss_r = [r for r in rs if r <= 0]
    # R-multiple histogram (the left tail should pile up near -1R, the right
    # tail should have a thin but heavy set of >=3R / >=5R winners).
    edges = [(-99, -1), (-1, 0), (0, 1), (1, 2), (2, 3), (3, 5), (5, 99)]
    labels = ["<=-1R", "-1..0R", "0..1R", "1..2R", "2..3R", "3..5R", ">=5R"]
    hist = {lab: sum(1 for r in rs if lo < r <= hi) for lab, (lo, hi) in zip(labels, edges)}
    # Right-tail concentration: share of total GROSS GAINS from the top trades.
    # NOTE the denominator is ALL trades (losers enter `gains` as 0.0), so
    # "top 5%/10%" means the top slice of the whole trade population, not of the
    # winners — that is the meaningful claim ("a handful of all my trades carry
    # the profits") and the UI label must say so.
    gains = sorted((max(0.0, p) for p in pnls), reverse=True)
    total_gain = sum(gains) or 1e-9
    n = len(gains)
    top5 = sum(gains[:max(1, round(n * 0.05))]) / total_gain
    top10 = sum(gains[:max(1, round(n * 0.10))]) / total_gain
    best_share = (gains[0] / total_gain) if gains else 0.0
    return {
        "expectancy_r": round(float(np.mean(rs)), 2),
        "avg_win_r": round(float(np.mean(win_r)), 2) if win_r else None,
        "avg_loss_r": round(float(np.mean(loss_r)), 2) if loss_r else None,
        # payoff ratio > 1 with a sub-50% win rate is the SEPA signature.
        "payoff_ratio": round(float(np.mean(win_r) / abs(np.mean(loss_r))), 2)
        if win_r and loss_r and np.mean(loss_r) != 0 else None,
        "max_r": round(max(rs), 2),
        "median_r": round(float(np.median(rs)), 2),
        "r_histogram": hist,
        # if these are high, the edge depends on NOT capping winners.
        "top5pct_gain_share": round(top5, 3),
        "top10pct_gain_share": round(top10, 3),
        "best_trade_gain_share": round(best_share, 3),
    }


def metrics(curve, trades, start_equity=100_000.0):
    eq = pd.Series([p["equity"] for p in curve], index=pd.to_datetime([p["date"] for p in curve]))
    ret = eq.pct_change().dropna()
    years = max((eq.index[-1] - eq.index[0]).days / 365.25, 1e-9)
    total = eq.iloc[-1] / start_equity - 1
    cagr = (1 + total) ** (1 / years) - 1
    dd = (eq / eq.cummax() - 1).min()
    sharpe = ret.mean() / ret.std() * np.sqrt(252) if ret.std() > 0 else 0.0
    # Sortino only penalizes DOWNSIDE volatility, so — unlike Sharpe — it does
    # not treat a big upside winner as "risk". That fits a right-tail-preserving
    # trend strategy: we want to keep the fat upside, not be scored against it.
    #
    # Downside deviation is the RMS of shortfalls below the target (0), averaged
    # over ALL periods — not the std of the negative returns about their own
    # mean, which measures how spread the losses are rather than how large, and
    # divides by the count of down days instead of the whole sample.
    shortfall = np.minimum(ret.to_numpy(dtype="float64"), 0.0)
    dstd = float(np.sqrt(np.mean(np.square(shortfall)))) if len(shortfall) else 0.0
    sortino = ret.mean() / dstd * np.sqrt(252) if dstd > 0 else None
    wins = [t for t in trades if t.get("pnl", t["exit"] - t["entry"]) > 0]
    out = {
        "total_return_pct": round(100 * total, 1),
        "cagr_pct": round(100 * cagr, 1),
        "max_drawdown_pct": round(100 * dd, 1),
        "sharpe": round(float(sharpe), 2),
        "sortino": round(float(sortino), 2) if sortino is not None else None,
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
    out["payoff_distribution"] = payoff_distribution(trades)
    # --- null-model confound diagnostics (pure MEASUREMENT, no strategy input)
    # Present in every run, screener or null, so the two confounds a selection
    # null cannot eliminate are VISIBLE rather than argued about afterwards:
    #   lane_mix      — the armed/early split has opposite expectancy by lane,
    #                   so an arm pushed toward `armed` loses for reasons that
    #                   have nothing to do with which stock it picked.
    #   stop_distance — stop = max(base_low, entry-8%) and base_low is an L2
    #                   OUTPUT, so a tighter stop means a bigger position on the
    #                   same move: a SIZING edge, not a stock-picking one.
    out["lane_mix"] = None
    out["stop_distance"] = None
    if trades:
        lanes = {}
        for lane in sorted({str(t.get("mode") or "") for t in trades}):
            sub = [t for t in trades if str(t.get("mode") or "") == lane]
            lanes[lane or "unknown"] = {
                "share": round(len(sub) / len(trades), 3),
                "trades": len(sub),
                "mean_r": round(float(np.mean([t["r"] for t in sub])), 2),
            }
        out["lane_mix"] = lanes
        dist = [(t["entry"] - t["stop0"]) / t["entry"]
                for t in trades if t.get("stop0") is not None and t.get("entry")]
        if dist:
            out["stop_distance"] = {
                "median_pct": round(100 * float(np.median(dist)), 2),
                "p25_pct": round(100 * float(np.percentile(dist, 25)), 2),
                "p75_pct": round(100 * float(np.percentile(dist, 75)), 2),
            }
    yearly = eq.resample("YE").last()
    prev = start_equity
    out["yearly_return_pct"] = {}
    for ts, val in yearly.items():
        out["yearly_return_pct"][str(ts.year)] = round(100 * (val / prev - 1), 1)
        prev = val
    return out


def _verify_pool(close, high, low, volume, ind, week_marks, hygiene_ok, surge_ok,
                 pit_eligible, tradable_set) -> int:
    """PROVE (don't assert) that the null's vectorised inputs == the screener's.

    The fairness of every null rests on both arms drawing from the same
    eligible universe and feeding the shared lane rule the same volume-surge
    flag. The screener computes both inline, per symbol, inside the candidate
    loop (`len(prices) < 200`, `adr < MIN_ADR_PCT`, `recent_vol_surge`); that
    code is deliberately left untouched so recorded runs cannot move, so the
    vectorised panels the nulls use are RESTATEMENTS that have to be checked.

    This replays the inline arithmetic literally, for EVERY symbol in the pool
    (not just the screener's candidates — the nulls draw from the whole pool)
    on a spread of days, and reports any disagreement.
    """
    days = week_marks[:: max(1, len(week_marks) // 40)] or week_marks
    checked = mismatches = surge_checked = surge_mismatches = 0
    bad: list[str] = []
    for d in days:
        idx = close.index.get_loc(d)
        if pit_eligible is not None:
            elig_row = pit_eligible.iloc[idx]
            pool = [s for s in pit_eligible.columns if bool(elig_row.get(s, False))]
        else:
            pool = sorted(tradable_set)
        hyg_row, srg_row = hygiene_ok.iloc[idx], surge_ok.iloc[idx]
        for s in pool:
            # ---- literal transcription of the inline checks ----------------
            prices = close[s].iloc[max(0, idx - 251): idx + 1].dropna()
            inline = len(prices) >= 200
            if inline:
                hi_seg = high[s].iloc[max(0, idx - 19): idx + 1]
                lo_seg = low[s].iloc[max(0, idx - 19): idx + 1]
                adr = float(((hi_seg / lo_seg) - 1).mean() * 100) if len(hi_seg) >= 10 else 0.0
                inline = not (adr < MIN_ADR_PCT)
            # ---------------------------------------------------------------
            checked += 1
            if bool(hyg_row.get(s, False)) != inline:
                mismatches += 1
                if len(bad) < 10:
                    bad.append(f"{d.date()} {s}: hygiene panel={bool(hyg_row.get(s, False))} inline={inline}")
            if not inline:
                continue    # the screener never reaches the surge for these
            vols = volume[s].iloc[max(0, idx - 251): idx + 1].dropna()
            v50 = ind["vol50"][s].iloc[idx]
            inline_surge = bool(v50 and v50 == v50
                                and (vols.iloc[-5:] / v50).max() >= BREAKOUT_VOL_RATIO)
            surge_checked += 1
            if bool(srg_row.get(s, False)) != inline_surge:
                surge_mismatches += 1
                if len(bad) < 10:
                    bad.append(f"{d.date()} {s}: surge panel={bool(srg_row.get(s, False))} inline={inline_surge}")
    print(f"--verify-pool: hygiene {checked} (day, symbol) pairs over {len(days)} "
          f"days, {mismatches} mismatches | vol-surge {surge_checked} pairs, "
          f"{surge_mismatches} mismatches", flush=True)
    for line in bad:
        print("  " + line, flush=True)
    return 0 if (mismatches + surge_mismatches) == 0 else 1


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--bundle", required=True)
    ap.add_argument("--output", required=True)
    ap.add_argument("--selection", choices=["group_leaders"], default=None,
                    help=(
                        "Replace the screener's SELECTION with an alternative "
                        "thesis, holding execution identical (same regime gate, "
                        "same 8%% stop, same trailing ladder, same 50-DMA exit, "
                        "same sizing, same slots, same costs, same fill model). "
                        "group_leaders = own the highest-RS names inside the "
                        "top-40 industry groups (GROUP_LEAD_PCT), entered when "
                        "the market is a CONFIRMED uptrend -- no VCP or base "
                        "pattern required. This is the IBD/MarketSurge "
                        "group-leadership idea, and it is the cleanest test of "
                        "whether the pattern machinery earns its place."
                    ))
    ap.add_argument("--base-anchored", action="store_true",
                    help=(
                        "Add the base-anchored VCP path (C102) as a fallback "
                        "when the legacy detector finds nothing. The legacy "
                        "enumeration measures the last four swings of a 150-bar "
                        "window -- median 105 bars wide, ending a median 15 bars "
                        "BEFORE the entry -- i.e. the prior advance, not the "
                        "base; the final tightening leg that defines the pivot "
                        "is structurally invisible to it. Measured on the "
                        "908-trade ground truth this path reaches 40.3%% recall "
                        "at a 12.8%% control rate (lift 3.14) against the legacy "
                        "36.1%% / 16.0%% (lift 2.26) -- higher recall AND higher "
                        "precision. Off by default so recorded runs are unchanged."
                    ))
    ap.add_argument("--cash-yield-pct", type=float, default=0.0,
                    help=(
                        "Annualised %% earned on IDLE CASH (default 0). The "
                        "simulation otherwise pays nothing on cash, which "
                        "systematically penalises a strategy that holds cash "
                        "against a 100%%-invested benchmark: this book averages "
                        "~36-40%% cash, so at 3%% T-bills that is ~1.2pp/yr of "
                        "CAGR the model simply discards. Off by default because "
                        "no risk-free series ships in the price bundle -- the "
                        "rate must be STATED by whoever runs it, not guessed "
                        "here, and it is recorded in the output so a flattering "
                        "assumption cannot hide."
                    ))
    ap.add_argument("--pit-universe", action="store_true",
                    help="admit a symbol on the first day it clears the "
                         "liquidity/price bar instead of freezing the tradable "
                         "list at the first simulated bar — removes the "
                         "listing-age bias that hides post-start IPOs (the young "
                         "leaders this method targets) from long windows")
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
                    help="treat a market correction as a hard no-buy (0%% "
                         "exposure, like a downtrend) instead of the residual "
                         "20%% cap — wait for the FTD before buying")
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
                    help="under pressure: keep full exposure while >=60%% of "
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
    # --- NULL MODELS (all default OFF; a run without --null is byte-identical
    # to every recorded run). See scripts/null_models.py.
    ap.add_argument("--null", choices=null_models.NULL_KINDS, default=None,
                    help="replace part of the SELECTION stack with a dumb "
                         "baseline and hold everything else identical: "
                         "'random' nulls L1+L2+L3 (uniform draw from the "
                         "eligible pool, 30-bar-high pivot, random slot order); "
                         "'rs_only' nulls the trend template and the pattern "
                         "layer (pure cross-sectional momentum); 'no_pattern' "
                         "nulls the VCP/tight-base layer only (real L1 list, "
                         "naive pivot); 'slot_shuffle' nulls the "
                         "quality-ranked slot fill only (real watchlist "
                         "replayed, random slot order). Requires "
                         "--replay-watchlist: a null draws exactly as many "
                         "names per day as the screener did, otherwise the "
                         "comparison measures opportunity COUNT, not quality.")
    ap.add_argument("--null-seed", type=int, default=0,
                    help="first RNG seed for the seeded nulls (random, "
                         "slot_shuffle). Recorded in the output JSON. The RNG "
                         "is blake2b(seed|symbol|epoch), NOT builtins.hash, so "
                         "a seed reproduces exactly across processes.")
    ap.add_argument("--null-seeds", type=int, default=1,
                    help="how many consecutive seeds to run in ONE process "
                         "(panel/indicators/regimes built once). The seed "
                         "permutation test needs S=200.")
    ap.add_argument("--dump-watchlist", default=None,
                    help="write the screener's daily watchlists (+ a sidecar "
                         "with per-day sizes n_d and the MEASURED persistence "
                         "P) for a later --replay-watchlist null run")
    ap.add_argument("--replay-watchlist", default=None,
                    help="load a --dump-watchlist file. Supplies n_d and P to "
                         "the watchlist nulls; for --null slot_shuffle it "
                         "supplies the REAL watchlists verbatim (no VCP "
                         "recomputation, so L2 is provably untouched).")
    ap.add_argument("--flat-stop", action="store_true",
                    help="force the initial stop to entry*(1-8%%) instead of "
                         "max(base_low, entry*(1-8%%)). base_low is an OUTPUT "
                         "of the pattern layer, so it makes position SIZE a "
                         "confound in any pattern null; this removes it.")
    ap.add_argument("--sim-days", type=int, default=None,
                    help="SMOKE TESTS ONLY: truncate the simulation to the "
                         "first N sessions. Never valid for a recorded result "
                         "(it is stamped into the output as a caveat).")
    ap.add_argument("--verify-pool", action="store_true",
                    help="diagnostic: prove the vectorised pool-hygiene panel "
                         "used by the nulls is elementwise identical to the "
                         "screener's inline per-symbol checks, then exit")
    args = ap.parse_args()
    global PROGRESSIVE_RISK, SELECTIVE_PRESSURE, BREADTH_CONFIRM, NO_CORRECTION_BUYS
    global CASH_YIELD_PCT, BASE_ANCHORED, SELECTION
    global SELL_INTO_STRENGTH
    PROGRESSIVE_RISK = args.progressive_risk
    CASH_YIELD_PCT = args.cash_yield_pct
    BASE_ANCHORED = args.base_anchored
    SELECTION = args.selection
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
    global NULL_MODE, NULL_SEED, FLAT_STOP, SLOT_FIELD, NULL_EPOCH_LEN, NULL_EPOCH_OFFSET
    NULL_MODE = args.null
    NULL_SEED = args.null_seed
    FLAT_STOP = args.flat_stop
    if NULL_MODE and not args.replay_watchlist:
        raise SystemExit(
            "--null requires --replay-watchlist: the null must draw exactly "
            "n_d names per day (the screener's own watchlist size) or the "
            "comparison measures opportunity count, not selection quality. "
            "Produce it first with --dump-watchlist on the same bundle/window."
        )

    fields, as_of = load_panel(Path(args.bundle))
    close, volume, low, high = fields["close"], fields["volume"], fields["low"], fields["high"]

    # liquidity/price/ETF universe hygiene (measured at the start of the sim window)
    print(f"panel: {close.shape[1]} symbols x {close.shape[0]} days (as_of {as_of})", flush=True)
    ind = compute_indicators(close, volume)

    first_valid = 260
    NULL_EPOCH_OFFSET = first_valid   # keeps the two epoch clocks in phase
    sim_dates = list(close.index[first_valid:])
    if args.sim_days:
        # Smoke-test escape hatch ONLY. Truncating the window changes every
        # metric, so it is stamped into the output and into `caveats` below —
        # a truncated run can never be mistaken for a recorded result.
        sim_dates = sim_dates[: args.sim_days]
        print(f"!! --sim-days {args.sim_days}: SMOKE RUN, not a recorded result", flush=True)
    dollar_vol = (close * volume).rolling(60).mean()
    at_start = dollar_vol.iloc[first_valid]
    px_start = close.iloc[first_valid]
    tradable = [
        s for s in close.columns
        if s not in ETF_DENYLIST and at_start.get(s, np.nan) == at_start.get(s, np.nan)
        and at_start[s] >= MIN_DOLLAR_VOL and px_start.get(s, 0) >= MIN_PRICE
    ]
    print(f"tradable universe: {len(tradable)} symbols; sim {sim_dates[0].date()} -> {sim_dates[-1].date()}", flush=True)

    # Point-in-time universe (opt-in). The list above freezes eligibility at the
    # FIRST simulated bar, so a company that lists later is invisible for the
    # whole run — and the longer the window, the more of the young leaders this
    # method is built to buy get excluded (a 9y run only ever sees names already
    # listed 9 years ago). That biases long windows DOWN for reasons that have
    # nothing to do with the strategy. With this flag a symbol becomes buyable on
    # the first day it clears the same liquidity/price bar, which is what the live
    # screener actually sees. Off by default so recorded runs stay reproducible.
    pit_eligible = None
    if args.pit_universe:
        non_etf = [s for s in close.columns if s not in ETF_DENYLIST]
        pit_eligible = (dollar_vol[non_etf] >= MIN_DOLLAR_VOL) & (close[non_etf] >= MIN_PRICE)
        ever = int(pit_eligible.loc[sim_dates].any().sum())
        print(f"point-in-time universe: {ever} symbols ever eligible "
              f"(+{ever - len(tradable)} vs the frozen list)", flush=True)

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
    if GROUP_ROTATION or SELECTION == "group_leaders":
        sym_group = {}
        with open(IBD_CSV, newline="", encoding="utf-8") as fh:
            for parts in csv.reader(fh):
                if len(parts) >= 2 and parts[0].strip() and parts[1].strip() \
                        and parts[1].strip() != ETF_GROUP:
                    sym_group[parts[0].strip().upper()] = parts[1].strip()
        # The group's RS percentile must be computed over every symbol that can
        # ever be a member, not over the frozen first-bar list. Ranking groups
        # from mature members only is the same listing-age bias --pit-universe
        # exists to remove: a group led by 2021 IPOs looks weak because its
        # leaders are invisible to the ranker. (Flagged by the C103 audit as
        # surviving --pit-universe; fixed here.)
        _grp_pool = tradable
        if pit_eligible is not None:
            _grp_pool = sorted(
                set(tradable)
                | {s for s in pit_eligible.columns if bool(pit_eligible.loc[sim_dates, s].any())}
            )
        mapped = [s for s in _grp_pool if s in sym_group]
        grp_of = pd.Series({s: sym_group[s] for s in mapped})
        rs_m = ind["rs"][mapped]
        grp_score = rs_m.T.groupby(grp_of).mean().T           # dates x groups
        grp_n = rs_m.notna().T.groupby(grp_of).sum().T
        grp_score = grp_score.where(grp_n >= GROUP_MIN_MEMBERS)
        group_pct = grp_score.rank(axis=1, pct=True)          # 1.0 = strongest group
        group_mom = group_pct.diff(GROUP_MOM_DAYS)
        print(f"group-rotation: {grp_score.shape[1]} groups, map coverage "
              f"{100 * len(mapped) / max(1, len(_grp_pool)):.0f}% of the ranking pool", flush=True)

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
        # The panel must cover EVERY symbol the candidate loop can propose.
        # It used to be built from `tradable` (the frozen list) while the
        # candidate loop, under --pit-universe, proposes late-listing symbols
        # too — and the gate below reads `tpr_row.get(s, False)`, so every
        # PIT-admitted symbol silently defaulted to False and was dropped.
        # The run then LOOKED point-in-time and BEHAVED frozen, which is the
        # worst possible failure: a wrong number that reports itself as right.
        panel_symbols = tradable
        if pit_eligible is not None:
            ever_eligible = [s for s in pit_eligible.columns if bool(pit_eligible.loc[sim_dates, s].any())]
            panel_symbols = sorted(set(tradable) | set(ever_eligible))
        print(f"computing walk-forward band panels (shipped minervini_bands) "
              f"for {len(panel_symbols)} symbols...", flush=True)
        band_panels = compute_band_panels(fields, panel_symbols, close["SPY"])
        greens = (band_panels[0] & band_panels[1]).loc[sim_dates].sum(axis=1)
        print(f"band panels done: avg {greens.mean():.1f} TPR∧pressure-green names/day", flush=True)
    week_marks = sim_dates
    tradable_set = set(tradable)

    # --- NULL-MODEL SETUP (inert unless --null / --replay-watchlist) --------
    # Everything a null needs is derived from the SAME panels the screener
    # reads. Nothing here runs, and nothing here is even computed, on a default
    # run — so a recorded run cannot move.
    replay = None
    n_by_day: dict = {}
    if args.replay_watchlist:
        replay = json.loads(Path(args.replay_watchlist).read_text())
        n_by_day = replay.get("n_by_day") or {}
        # P is MEASURED from the screener's own watchlist, never chosen.
        NULL_EPOCH_LEN = max(1, int(replay.get("persistence_p") or 1))
        missing = [str(d.date()) for d in week_marks if str(d.date()) not in n_by_day]
        if missing:
            raise SystemExit(
                f"--replay-watchlist covers {len(n_by_day)} days but this run has "
                f"{len(week_marks)} ({len(missing)} missing, first {missing[0]}). "
                "The dump must come from the same bundle and the same window."
            )
        print(f"replay: {len(n_by_day)} days, mean n_d "
              f"{np.mean([n_by_day[str(d.date())] for d in week_marks]):.1f}, "
              f"measured persistence P={NULL_EPOCH_LEN} sessions", flush=True)

    hygiene_ok = surge_ok = naive_piv = naive_low = None
    if NULL_MODE in null_models.WATCHLIST_KINDS or args.verify_pool:
        # HELD CONSTANT: pool hygiene. The nulls read a vectorised restatement
        # of the screener's own inline per-symbol checks (>=200 valid closes in
        # 252 bars, ADR20 >= 1.5%). The inline code is left untouched so no
        # recorded run can move; --verify-pool proves the two agree elementwise
        # on the real bundle rather than asserting it.
        hygiene_ok, surge_ok = hygiene_panels(close, high, low, volume, ind["vol50"])
        naive_piv, naive_low = null_models.naive_pivot_panels(high, low)

    if args.verify_pool:
        return _verify_pool(close, high, low, volume, ind, week_marks, hygiene_ok,
                            surge_ok, pit_eligible, tradable_set)

    def _build_watchlists(field=None):
        """Daily watchlists. With --null, ONLY the selection step changes.

        `pool` and `cands` below are the SAME expressions for the screener and
        for every null — the null branch is taken after they are computed, so
        the eligible universe and the L1 candidate list cannot drift between
        arms. `field` is the seeded random field (None for the screener and
        for the deterministic nulls).
        """
        watch_by_week: dict = {}
        null_diag = {"pool": [], "depth": [], "target": []}
        for d in week_marks:
            idx = close.index.get_loc(d)
            row_t = ind["template"].iloc[idx]
            row_rs = ind["rs"].iloc[idx]
            # RS-descending order: the watchlist dict (and therefore entry-signal
            # priority under the 10-position cap) starts with the strongest names,
            # per Minervini "buy the leaders". Iterating the raw set here made the
            # whole simulation nondeterministic (string-hash order varies per
            # process): two runs of the same bundle differed by tens of pp.
            # Candidate pool: the frozen list, or (opt-in) whatever cleared the
            # liquidity/price bar as of THIS date, so late listings can be bought.
            if pit_eligible is not None:
                elig_row = pit_eligible.iloc[idx]
                pool = [s for s in pit_eligible.columns if bool(elig_row.get(s, False))]
            else:
                pool = tradable_set
            # L1. `random`/`rs_only` null this layer away entirely and never
            # read `cands`, so it is skipped for them (200 seeds x 1250 days of
            # dead work). `no_pattern` and the screener build it identically.
            cands = [] if NULL_MODE in ("random", "rs_only") else sorted(
                (s for s in pool
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

            # --- L1/L2 NULL HOOK -------------------------------------------
            # Taken AFTER `pool` and `cands` are built from the expressions
            # above, so the eligible universe (and, for no_pattern, the real L1
            # candidate list) is literally the same object the screener uses.
            # What changes: which names go on the watchlist and with what
            # pivot. What does NOT change: the lane rule (assign_mode, shared),
            # the number of names drawn (n_d, the screener's own size for this
            # day), and every downstream mechanic in run_variant.
            if NULL_MODE in null_models.WATCHLIST_KINDS:
                hyg_row = hygiene_ok.iloc[idx]
                pool_list = pool if isinstance(pool, list) else sorted(pool)
                pool_ok = [s for s in pool_list if bool(hyg_row.get(s, False))]
                n_target = int(n_by_day.get(str(d.date()), 0))
                wl, depth = null_models.null_watchlist(
                    NULL_MODE,
                    pool_ok=pool_ok, cands=cands, rs_row=row_rs,
                    close_row=close.iloc[idx],
                    piv_row=naive_piv.iloc[idx], low_row=naive_low.iloc[idx],
                    surge_row=surge_ok.iloc[idx],
                    n_target=n_target, field=field,
                    epoch=idx // NULL_EPOCH_LEN,
                    assign_mode=assign_mode,
                )
                watch_by_week[d] = wl
                null_diag["pool"].append(len(pool_ok))
                null_diag["depth"].append(depth)
                null_diag["target"].append(n_target)
                continue

            if SELECTION == "group_leaders":
                # SELECTION swap, execution untouched. Candidates are the
                # highest-RS names whose industry group sits in the top 40
                # (GROUP_LEAD_PCT = 0.80 of ~197 groups). No VCP, no base, no
                # tightness — group leadership plus relative strength is the
                # whole thesis.
                #
                # Entry: "buy it now" rather than "wait for a pivot breakout",
                # so the pivot is set to today's close (the chase cap is then
                # always satisfied) and the stop reference is a plain 20-day
                # low — a rule that encodes no pattern knowledge. The regime
                # gate below still decides WHEN this is allowed to fire, which
                # is how "only in a confirmed uptrend" is enforced.
                wl = {}
                if group_pct is not None:
                    gp_row = group_pct.iloc[idx]
                    ranked = []
                    for s in cands:
                        g = sym_group.get(s)
                        if g is None:
                            continue
                        gp = gp_row.get(g, np.nan)
                        if gp == gp and gp >= GROUP_LEAD_PCT:
                            ranked.append((float(row_rs.get(s, 0)), s))
                    ranked.sort(key=lambda t: (-t[0], t[1]))
                    for rs_v, s in ranked[: MAX_POSITIONS * 3]:
                        prices = close[s].iloc[max(0, idx - 251): idx + 1].dropna()
                        lows = low[s].iloc[max(0, idx - 251): idx + 1].dropna()
                        if len(prices) < 200 or len(lows) < 20:
                            continue
                        c0 = float(prices.iloc[-1])
                        wl[s] = {"pivot": c0, "base_low": float(lows.iloc[-20:].min()),
                                 "mode": "early", "source": "group_leader", "rs": rs_v}
                watch_by_week[d] = wl
                continue

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
                elif BASE_ANCHORED and (
                    (_ba := _base_anchored(pd.DataFrame({
                        "High": high[s].iloc[max(0, idx - 251): idx + 1],
                        "Low": low[s].iloc[max(0, idx - 251): idx + 1],
                        "Close": prices,
                    }).dropna())) is not None
                ):
                    piv, base_low, source = _ba["pivot"], _ba["base_low"], "base_anchored"
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
                else:
                    # HOISTED (behaviour-identical to the former inline
                    # armed/early elif chain) so the screener and every null
                    # assign lanes through ONE function — see assign_mode.
                    _plan = assign_mode(c0, piv, base_low, source,
                                        float(row_rs.get(s, 0)), recent_vol_surge)
                    if _plan is not None:
                        wl[s] = _plan
            watch_by_week[d] = wl
        return watch_by_week, null_diag

    def _report_watchlists(watch_by_week, null_diag, label=""):
        sizes = [len(w) for w in watch_by_week.values()]
        msg = (f"daily watchlists{label}: {len(watch_by_week)} days, "
               f"avg {np.mean(sizes):.1f} names, max {max(sizes)}")
        if null_diag["pool"]:
            # Void conditions #2/#3 made visible: realised watchlist size vs the
            # screener's n_d, and the pool the null drew from. draw_depth says
            # how many names the null had to chew through to find n_d valid
            # setups — a real qualitative finding, never used to adjust a metric.
            msg += (f" | null pool {np.mean(null_diag['pool']):.0f}/day, "
                    f"target n_d {np.mean(null_diag['target']):.1f}, "
                    f"draw_depth {np.mean(null_diag['depth']):.0f}")
        print(msg, flush=True)
        return {
            "mean_watchlist": round(float(np.mean(sizes)), 2),
            "mean_pool": round(float(np.mean(null_diag["pool"])), 1) if null_diag["pool"] else None,
            "mean_target_n_d": round(float(np.mean(null_diag["target"])), 2) if null_diag["target"] else None,
            "mean_draw_depth": round(float(np.mean(null_diag["depth"])), 1) if null_diag["depth"] else None,
        }

    results = {}
    signal_ok = band_panels[2] if band_panels is not None else None
    watch_stats: dict = {}
    seed_results: dict = {}
    _empty_diag = {"pool": [], "depth": [], "target": []}

    if NULL_MODE == "slot_shuffle":
        # L3 null: the REAL watchlist is replayed verbatim from the Phase-0
        # dump — real pivots, real base_low, real sources, zero recomputation.
        # L2 is therefore provably untouched and only the slot ORDER differs.
        watch_by_week = {}
        raw = replay.get("watchlists") or {}
        for d in week_marks:
            watch_by_week[d] = raw.get(str(d.date()), {})
        watch_stats = _report_watchlists(watch_by_week, _empty_diag, " (replayed)")
    elif NULL_MODE is None:
        watch_by_week, _diag = _build_watchlists()
        watch_stats = _report_watchlists(watch_by_week, _diag)
        if args.dump_watchlist:
            # Phase-0 dump: the null's n_d (per-day watchlist size) and the
            # MEASURED persistence P, plus the watchlists themselves for the
            # slot_shuffle replay.
            p_meas = null_models.persistence_p(watch_by_week, week_marks)
            Path(args.dump_watchlist).write_text(json.dumps({
                "bundle": args.bundle,
                "window": {"start": str(week_marks[0].date()), "end": str(week_marks[-1].date())},
                "persistence_p": p_meas,
                "n_by_day": {str(d.date()): len(watch_by_week[d]) for d in week_marks},
                "watchlists": {str(d.date()): watch_by_week[d] for d in week_marks},
            }))
            print(f"watchlist dump -> {args.dump_watchlist} "
                  f"(measured persistence P={p_meas} sessions)", flush=True)

    # Seeded nulls run S seeds in ONE process: panel, indicators, regimes and
    # band panels are built once, outside this loop.
    seeds = (list(range(args.null_seed, args.null_seed + args.null_seeds))
             if NULL_MODE in null_models.SEEDED_KINDS else [args.null_seed])
    if NULL_MODE and NULL_MODE not in null_models.SEEDED_KINDS and args.null_seeds > 1:
        print(f"--null {NULL_MODE} is deterministic; --null-seeds ignored", flush=True)
    # no_market_gate is a diagnostic, not a comparison arm — skipped for nulls.
    variants = ((("full_tactics", True),) if NULL_MODE
                else (("full_tactics", True), ("no_market_gate", False)))

    for seed in seeds:
        field = (null_models.UniformField(seed)
                 if NULL_MODE in null_models.SEEDED_KINDS else None)
        # 'random' nulls L3 as well as L1+L2: leaving _quality_key in place
        # would let momentum leak back in through its -rs tiebreak, so the
        # slot order is randomised too. rs_only / no_pattern keep the real slot
        # rule (all their plans share one source, so _quality_key degenerates
        # to -rs, which is exactly the design's "slot fill by RS").
        SLOT_FIELD = field if NULL_MODE in ("slot_shuffle", "random") else None
        if NULL_MODE in null_models.WATCHLIST_KINDS:
            watch_by_week, _diag = _build_watchlists(field)
            watch_stats = _report_watchlists(watch_by_week, _diag, f" [seed {seed}]")
        for name, gate in variants:
            v = run_variant(name, gate, fields, ind, regimes, watch_by_week, sim_dates,
                            signal_ok=signal_ok)
            m = metrics(v.equity_curve, v.trades)
            results[name] = {"metrics": m, "trades": v.trades,
                             "equity_curve": v.equity_curve}
            if len(seeds) == 1:
                print(f"{name}: {m}", flush=True)
        if NULL_MODE:
            syms = sorted({t["symbol"] for t in results["full_tactics"]["trades"]})
            seed_results[str(seed)] = {
                "metrics": results["full_tactics"]["metrics"],
                "watchlist": watch_stats,
                "traded_symbols": len(syms),
                "traded_symbols_sha1": hashlib.sha1(
                    "|".join(syms).encode("utf-8")).hexdigest(),
                "symbols": syms if len(seeds) == 1 else None,
            }
            print(f"[{NULL_MODE} seed {seed}] cagr {results['full_tactics']['metrics']['cagr_pct']}% "
                  f"dd {results['full_tactics']['metrics']['max_drawdown_pct']}% "
                  f"trades {results['full_tactics']['metrics']['trades']} "
                  f"syms {len(syms)}", flush=True)

    # benchmarks
    spy_c = close["SPY"].loc[sim_dates]
    spy_ret = spy_c.pct_change().fillna(0)
    bh = (1 + spy_ret).cumprod() * 100_000
    exp_series = pd.Series({d: regimes[d]["exposure"] / 100.0 for d in sim_dates}).shift(1).fillna(0)
    # The exposure-matched control must be paid the SAME cash rate on the SAME
    # idle fraction. Crediting the strategy's cash but not its own control would
    # inflate the measured selection alpha by exactly the cash yield — the
    # benchmark that exists to isolate selection would instead be measuring the
    # accounting change.
    _cash_daily = (CASH_YIELD_PCT / 100.0) / 252.0
    timed = (
        1 + spy_ret * exp_series.values + _cash_daily * (1 - exp_series.values)
    ).cumprod() * 100_000
    for label, series in (("spy_buy_hold", bh), ("spy_regime_timed", timed)):
        curve = [{"date": str(d.date()), "equity": float(x), "invested_pct": 100.0}
                 for d, x in series.items()]
        results[label] = {"metrics": metrics(curve, []), "equity_curve": curve}
        print(f"{label}: {results[label]['metrics']}", flush=True)

    out = {
        "as_of": as_of,
        "window": {"start": str(sim_dates[0].date()), "end": str(sim_dates[-1].date())},
        "universe_size": len(tradable),
        "pit_universe": args.pit_universe,
        "cash_yield_pct": args.cash_yield_pct,
        "base_anchored": args.base_anchored,
        "selection": args.selection,
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
        # These three were omitted, which is how the published scorecard became
        # unable to answer "was progressive risk on?". `--progressive-risk` is
        # not a tweak: it is the only setting that reproduces what the product
        # SHIPS (risk.py::account_risk_pct_for_regime scales 1.25% -> 2.5% in a
        # confirmed uptrend). A run without it measures a strategy nobody runs.
        "progressive_risk": args.progressive_risk,
        "selective_pressure": args.selective_pressure,
        "breadth_confirm": args.breadth_confirm,
        # Null-model provenance. The seed is recorded next to the flags so a
        # published null number can be reproduced exactly: the RNG is
        # blake2b(seed|symbol|epoch), not builtins.hash, so it is stable across
        # processes, machines and Python versions.
        "null": args.null,
        "null_seed": args.null_seed if args.null else None,
        "null_seeds": len(seeds) if args.null else None,
        "null_persistence_p": NULL_EPOCH_LEN if args.null else None,
        "naive_pivot_lookback": null_models.NAIVE_PIVOT_LOOKBACK if args.null else None,
        "replay_watchlist": args.replay_watchlist,
        "flat_stop": args.flat_stop,
        "sim_days": args.sim_days,
        "watchlist_stats": watch_stats or None,
        "seeds": seed_results or None,
        "caveats": [
            "survivorship bias: today's listed universe only",
            "technicals only: point-in-time fundamentals unavailable (C43 bonus excluded)",
            "daily bars: entries at next open (later than intraday pivot buys), 10bps/side costs",
        ] + ([] if args.progressive_risk else [
            "sizing mismatch: the shipped product scales per-trade risk with the "
            "regime (risk.py::account_risk_pct_for_regime, 1.25% -> 2.5% in a "
            "confirmed uptrend). This run used flat 1.25%, so it does NOT measure "
            "the shipped strategy. Re-run with --progressive-risk to compare."
        ]) + ([] if args.pit_universe else [
            "listing-age bias: the tradable list is frozen at the first simulated "
            "bar, so companies that listed later are excluded for the entire run. "
            "This penalises LONG windows specifically (a 9y run never sees a 2021 "
            "IPO), and young leaders are exactly what this method buys. Re-run "
            "with --pit-universe for the unbiased comparison."
        ]) + ([] if not args.sim_days else [
            f"SMOKE RUN: --sim-days {args.sim_days} truncated the window. Not a "
            "recorded result and not comparable with any published number."
        ]) + ([] if not args.null else [
            f"NULL MODEL '{args.null}': the selection stack was deliberately "
            "replaced with a dumb baseline. This is a control arm, not a "
            "strategy. The stop distance (base_low is an L2 OUTPUT) and the "
            "armed/early lane mix cannot be held constant across arms — see "
            "`lane_mix` and `stop_distance` in each metrics block before "
            "reading any difference as stock-picking skill."
        ]),
        "results": {k: {"metrics": v["metrics"]} for k, v in results.items()},
    }
    Path(args.output).write_text(json.dumps(out, indent=2))
    full = Path(args.output).with_suffix(".full.json")
    full.write_text(json.dumps(results, indent=2, default=str))
    print(f"report -> {args.output}\nfull -> {full}", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
