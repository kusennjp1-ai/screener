"""Diagnostic: dump our "earnings line" (収益ライン) for given tickers vs price.

Reproduces the production earnings-line maths (static_site_export_service.
_earnings_line_points) standalone so the result can be eyeballed against an
IBD/MarketSurge chart for the same ticker (e.g. NBIS, SNDK): the fitted P/E
multiple, the line value vs price (rich/cheap), and a few sampled points so the
SHAPE can be compared. Helps decide whether our line matches IBD's and how to
tune it.

Network: needs SEC EDGAR (EPS) + Yahoo Finance (price). CI-only.

Usage:
    python -m scripts.check_earnings_line NBIS SNDK
"""
from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from app.services.earnings_line import compute_earnings_line
from app.services.sec_edgar_financials import SecEdgarClient, dated_quarterly_eps

HISTORY_DAYS = 820
TTM_WINDOW_DAYS = 400


def _price(symbol: str):
    import yfinance as yf

    end = (pd.Timestamp(datetime.utcnow().date()) + timedelta(days=2)).strftime("%Y-%m-%d")
    start = (pd.Timestamp(datetime.utcnow().date()) - timedelta(days=HISTORY_DAYS)).strftime("%Y-%m-%d")
    try:
        df = yf.download(symbol, start=start, end=end, auto_adjust=True, progress=False, threads=False)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! price download failed for {symbol}: {exc}", file=sys.stderr)
        return None
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    return df.dropna()


def _forward_eps(symbol: str) -> dict:
    """What forward-EPS data yfinance exposes for this ticker (for feasibility)."""
    import yfinance as yf

    out: dict = {}
    try:
        info = yf.Ticker(symbol).get_info()
        for k in ("trailingEps", "forwardEps", "forwardPE", "trailingPE"):
            if info.get(k) is not None:
                out[k] = info.get(k)
    except Exception as exc:  # noqa: BLE001
        out["error"] = str(exc)[:60]
    return out


def _earnings_line(price_df, pairs, *, ttm_window_days: int = TTM_WINDOW_DAYS):
    """Wrap the shared production helper; returns (line_series, multiple, ttm_series)."""
    res = compute_earnings_line(
        price_df.index, price_df["Close"].to_numpy(dtype="float64"), pairs,
        ttm_window_days=ttm_window_days,
    )
    if res is None:
        return None, None, None
    return (
        pd.Series(res["line"], index=price_df.index),
        res["multiple"],
        pd.Series(res["ttm_daily"], index=price_df.index),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tickers", nargs="*", default=["NBIS", "SNDK"])
    parser.add_argument("--markdown", type=str, default=None)
    args = parser.parse_args()
    tickers = args.tickers or ["NBIS", "SNDK"]

    client = SecEdgarClient()
    lines = ["# Earnings-line (収益ライン) check vs IBD\n"]
    for t in tickers:
        print(f"{t} ...", file=sys.stderr)
        px = _price(t)
        facts = None
        try:
            facts = client.company_facts(t)
        except Exception as exc:  # noqa: BLE001
            print(f"  ! EDGAR failed for {t}: {exc}", file=sys.stderr)
        # Forward EPS availability (yfinance) — to decide if a forward-based line
        # (IBD-style) is feasible, esp. for names with negative TTM (e.g. NBIS).
        fwd = _forward_eps(t)
        if px is None or not facts:
            lines.append(f"## {t}\n\n_missing price or EDGAR facts_  (yf forward: {fwd})\n")
            continue
        pairs = dated_quarterly_eps(facts)
        line, mult, ttm = _earnings_line(px, pairs)
        if line is None:
            lines.append(f"## {t}\n\n_could not fit TTM line (insufficient positive TTM EPS)_  "
                         f"— yfinance forward EPS: **{fwd}**\n")
            continue
        last_price = float(px["Close"].iloc[-1])
        last_line = float(line.dropna().iloc[-1]) if line.dropna().size else float("nan")
        ratio = last_price / last_line if last_line and not np.isnan(last_line) else float("nan")
        verdict = "RICH (price above line)" if ratio > 1.05 else "CHEAP (price below line)" if ratio < 0.95 else "FAIR (~on line)"
        # sample line vs price at ~quarterly points across the window
        samp = line.dropna()
        idxs = np.linspace(0, len(samp) - 1, min(6, len(samp))).astype(int) if len(samp) else []
        lines.append(f"## {t}\n")
        lines.append(f"- yfinance forward EPS: {fwd}")
        lines.append(f"- fitted multiple M = median(close/TTM_EPS) = **{round(mult,1)}**")
        lines.append(f"- latest: price **{round(last_price,2)}** vs line **{round(last_line,2)}** "
                     f"-> ratio **{round(ratio,2)}** = **{verdict}**")
        lines.append(f"- TTM EPS latest: {round(float(ttm.dropna().iloc[-1]),2) if ttm.dropna().size else 'n/a'}")
        if len(idxs):
            lines.append("- sampled line vs price (oldest→newest):")
            for k in idxs:
                d = samp.index[k]
                pv = float(px['Close'].asof(d))
                lines.append(f"    - {pd.Timestamp(d).date()}: line {round(float(samp.iloc[k]),1)} / price {round(pv,1)} "
                             f"({'rich' if pv> samp.iloc[k] else 'cheap'})")
        lines.append("")

    out = "\n".join(lines) + "\n"
    print(out)
    if args.markdown:
        from pathlib import Path
        Path(args.markdown).write_text(out, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
