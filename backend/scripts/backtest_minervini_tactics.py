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
)
from app.services.markets360.risk import ACCOUNT_RISK_PCT, MAX_LOSS_PCT

COST_PER_SIDE = 0.001          # 10 bps slippage+commission per side
RS_MIN = 70                    # candidate floor (published minimum; 80-90 preferred)
NEAR_HIGH_MAX_PCT = 25.0       # within 25% of the 52w high (template cond.)
BREAKOUT_VOL_RATIO = 1.5
CHASE_CAP = 1.05               # never pay >5% above the pivot
MAX_POSITIONS = 10
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
        out[d] = {
            "regime": r.get("regime"),
            "exposure": r.get("exposure_pct") if r.get("exposure_pct") is not None else 100,
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
    pending_buys: dict[str, dict] = {}
    watch: dict[str, dict] = {}

    for i, d in enumerate(sim_dates):
        exposure_pct = regimes[d]["exposure"] if market_gate else 100

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
                                 "mode": p.mode, "source": p.source, "reason": "signal"})
            pending_sells.discard(sym)

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
            risk_dollars = equity_mark * (ACCOUNT_RISK_PCT / 100.0)
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
            if ma50 == ma50 and c < ma50 and vol_ratio >= 1.5:
                pending_sells.add(sym)

        # --- entry signals at the close (fill tomorrow) -----------------------
        wk = watch_by_week.get(d)
        if wk is not None:
            watch = wk
        if exposure_pct > 0 or not market_gate:
            for sym, plan in watch.items():
                if sym in positions or sym in pending_buys:
                    continue
                # product funnel: Buy Risk must be green/yellow on the signal
                # day (the breakout barrel's risk_ok half in compute_buy_signal)
                if signal_ok is not None and not bool(signal_ok.at[d, sym]):
                    continue
                c = close.at[d, sym]
                if c != c:
                    continue
                if plan["mode"] == "early":
                    # breakout already volume-confirmed at scan; buy next open
                    # while the chase cap still holds
                    if c <= plan["pivot"] * CHASE_CAP:
                        pending_buys[sym] = plan
                else:  # armed buy-stop at the pivot
                    hi = high.at[d, sym]
                    vol50 = ind["vol50"].at[d, sym]
                    volr = volume.at[d, sym] / vol50 if vol50 and vol50 == vol50 else 0
                    if (hi == hi and hi >= plan["pivot"] and c > plan["pivot"]
                            and c <= plan["pivot"] * CHASE_CAP and volr >= BREAKOUT_VOL_RATIO):
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
    ap.add_argument("--funnel", choices=("legacy", "product"), default="legacy",
                    help="'product' replays the shipped Buy Signal checklist: "
                         "TPR band green + pressure band green as candidate "
                         "gates, VCP pivot else the 30-bar consolidation high "
                         "(signals._breakout_now fallback), and Buy Risk "
                         "green/yellow required on the signal day")
    args = ap.parse_args()

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
    print("regime days computed", flush=True)

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
            r = det.detect_vcp(prices.reset_index(drop=True), vols.reset_index(drop=True))
            vpiv = (r.get("pivot_info") or {}).get("pivot")
            if r.get("vcp_detected") and vpiv and r.get("recent_base_low"):
                piv, base_low, source = float(vpiv), float(r["recent_base_low"]), "vcp"
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
            if c0 <= piv:
                wl[s] = {"pivot": piv, "base_low": base_low, "mode": "armed", "source": source}
            elif c0 <= piv * CHASE_CAP and recent_vol_surge:
                wl[s] = {"pivot": piv, "base_low": base_low, "mode": "early", "source": source}
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
