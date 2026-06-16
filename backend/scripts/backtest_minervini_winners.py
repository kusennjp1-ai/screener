"""Backtest the Minervini screener against Mark Minervini's real trade ideas.

Ground truth is ``data/minervini_trade_ideas.csv`` — ~900 tickers/dates Mark
Minervini shared on Twitter (compiled by @traderCharlieM). For each idea this
replays the *current* ``MinerviniScanner`` as of that date and measures whether
our screen would have flagged the name at, or shortly around, the same time.

Two bars are reported per pick:
  * **template** — the canonical 8-point trend template (``passes_template``).
  * **strict**   — the tightened Minervini *preset* now used in the app on top
                   of the template: RS >= 80 and within 15% of the 52-week high.

Structural legs (Stage 2, MA stack, 52w-low, 52w-high, VCP) are computed exactly
on real historical prices. The RS leg uses the scanner's universe-free fallback
(50 + weighted out-performance vs SPY), which is a monotonic proxy for the app's
universe percentile — directionally consistent for "is this a strong leader",
but not the exact percentile, so treat strict catch-rates as approximate.

ETF/ETN ideas (XLE, IBB, SOXX, SLV, GBTC, ...) are flagged from the IBD seed and
excluded from the stock catch-rate, since the app's stock screen excludes funds.

Network: needs Yahoo Finance (yfinance); run from CI, not the app sandbox.

Usage:
    python -m scripts.backtest_minervini_winners                 # since 2017
    python -m scripts.backtest_minervini_winners --since 2010-01-01
    python -m scripts.backtest_minervini_winners --limit 50 --markdown out.md
"""
from __future__ import annotations

import argparse
import csv
import sys
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.minervini_scanner import MinerviniScanner

BENCHMARK = "SPY"
HISTORY_PAD_CALENDAR_DAYS = 820  # ~2.2y before the idea date (covers the 200-day MA)
MIN_BARS = 240
STRICT_RS_MIN = 80
STRICT_FROM_HIGH_MIN = -15.0  # within 15% of the 52-week high (distance is negative)

_REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_CSV = _REPO_ROOT / "data" / "minervini_trade_ideas.csv"
IBD_CSV = _REPO_ROOT / "data" / "IBD_industry_group.csv"
ETF_GROUP = "Finance-ETF / ETN"


def _load_trade_ideas(csv_path: Path, since: str | None, until: str | None, limit: int | None):
    ideas: list[tuple[str, str]] = []
    with open(csv_path, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            ticker = (row.get("Ticker") or "").strip().upper()
            date = (row.get("Date") or "").strip()
            if not ticker or not date:
                continue
            if since and date < since:
                continue
            if until and date > until:
                continue
            ideas.append((ticker, date))
    # De-duplicate (ticker, date) while preserving order.
    seen: set[tuple[str, str]] = set()
    deduped = []
    for item in ideas:
        if item in seen:
            continue
        seen.add(item)
        deduped.append(item)
    deduped.sort(key=lambda x: x[1])
    if limit:
        deduped = deduped[:limit]
    return deduped


def _load_etf_tickers() -> set[str]:
    etfs: set[str] = set()
    if not IBD_CSV.exists():
        return etfs
    with open(IBD_CSV, newline="", encoding="utf-8") as fh:
        for parts in csv.reader(fh):
            if len(parts) >= 2 and parts[1].strip() == ETF_GROUP:
                etfs.add(parts[0].strip().upper())
    return etfs


def _download(symbol: str, start: str, end: str) -> pd.DataFrame | None:
    import yfinance as yf

    try:
        df = yf.download(symbol, start=start, end=end, auto_adjust=True, progress=False, threads=False)
    except Exception as exc:  # noqa: BLE001
        print(f"  ! download failed for {symbol}: {exc}", file=sys.stderr)
        return None
    if df is None or df.empty:
        return None
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    df.index = pd.to_datetime(df.index)
    return df


@dataclass
class Eval:
    passes_template: bool
    passes_strict: bool
    rs_rating: float | None
    stage: int | None
    from_high_pct: float | None


def _evaluate(scanner, symbol, price_full, bench_full, as_of) -> Eval | None:
    price = price_full[price_full.index <= as_of]
    bench = bench_full[bench_full.index <= as_of]
    if len(price) < MIN_BARS or len(bench) < MIN_BARS:
        return None
    result = scanner.scan_stock(
        symbol,
        StockData(symbol=symbol, price_data=price, benchmark_data=bench, benchmark_symbol=BENCHMARK),
    )
    d = result.details or {}
    if d.get("error"):
        return None
    template = bool(d.get("passes_template"))
    rs = d.get("rs_rating")
    from_high = d.get("from_52w_high_pct")
    strict = bool(
        template
        and rs is not None
        and rs >= STRICT_RS_MIN
        and from_high is not None
        and from_high >= STRICT_FROM_HIGH_MIN
    )
    return Eval(template, strict, rs, d.get("stage"), from_high)


@dataclass
class PickResult:
    ticker: str
    date: str
    year: int
    is_etf: bool
    has_data: bool
    template_on: bool
    template_win: bool
    strict_on: bool
    strict_win: bool


def _trading_window(index: pd.DatetimeIndex, target: pd.Timestamp, before: int, after: int):
    on_or_before = index[index <= target]
    if len(on_or_before) == 0:
        return []
    anchor = len(on_or_before) - 1
    lo = max(0, anchor - before)
    hi = min(len(index) - 1, anchor + after)
    return list(index[lo:hi + 1]), index[anchor]


def backtest(ideas, etfs, window_before, window_after):
    scanner = MinerviniScanner()
    dates = [datetime.strptime(d, "%Y-%m-%d") for _, d in ideas]
    start = (min(dates) - timedelta(days=HISTORY_PAD_CALENDAR_DAYS)).strftime("%Y-%m-%d")
    end = (max(dates) + timedelta(days=window_after + 10)).strftime("%Y-%m-%d")

    print(f"Fetching benchmark {BENCHMARK} [{start} .. {end}] ...", file=sys.stderr)
    bench_full = _download(BENCHMARK, start, end)
    if bench_full is None or bench_full.empty:
        raise SystemExit("Could not download benchmark history; aborting.")

    results: list[PickResult] = []
    for i, (ticker, date) in enumerate(ideas, 1):
        if i % 25 == 0:
            print(f"  ... {i}/{len(ideas)}", file=sys.stderr)
        target = pd.Timestamp(date)
        is_etf = ticker in etfs
        # Per-ticker window keeps downloads small even across a 25-year file.
        t_start = (target - timedelta(days=HISTORY_PAD_CALENDAR_DAYS)).strftime("%Y-%m-%d")
        t_end = (target + timedelta(days=window_after + 10)).strftime("%Y-%m-%d")
        price_full = _download(ticker, t_start, t_end)
        if price_full is None or price_full.empty:
            results.append(PickResult(ticker, date, target.year, is_etf, False, False, False, False, False))
            continue

        win = _trading_window(price_full.index, target, window_before, window_after)
        if not win:
            results.append(PickResult(ticker, date, target.year, is_etf, False, False, False, False, False))
            continue
        window_dates, anchor = win

        on = _evaluate(scanner, ticker, price_full, bench_full, anchor)
        template_on = bool(on and on.passes_template)
        strict_on = bool(on and on.passes_strict)
        template_win = template_on
        strict_win = strict_on
        if not (template_on and strict_on):
            for d in window_dates:
                ev = _evaluate(scanner, ticker, price_full, bench_full, d)
                if not ev:
                    continue
                template_win = template_win or ev.passes_template
                strict_win = strict_win or ev.passes_strict
                if template_win and strict_win:
                    break
        has_data = on is not None or any(
            _evaluate(scanner, ticker, price_full, bench_full, d) is not None for d in window_dates[:1]
        )
        results.append(
            PickResult(ticker, date, target.year, is_etf, has_data, template_on, template_win, strict_on, strict_win)
        )
    return results


def _pct(n, d):
    return f"{(100.0 * n / d):.0f}%" if d else "-"


def render_markdown(results, window_before, window_after, since, until) -> str:
    stocks = [r for r in results if not r.is_etf]
    stocks_data = [r for r in stocks if r.has_data]
    etfs = [r for r in results if r.is_etf]

    L: list[str] = []
    L.append("# Minervini trade-ideas backtest\n")
    span = f"{since or 'start'} .. {until or 'latest'}"
    L.append(
        f"Replayed the current screener against **{len(results)}** Minervini trade ideas "
        f"({span}). ETFs/ETNs ({len(etfs)}) are flagged and excluded from the stock catch-rate.\n"
    )
    L.append(
        f"- **Stock ideas with usable history:** {len(stocks_data)} / {len(stocks)}\n"
        f"- **Trend template — caught within [-{window_before}, +{window_after}] trading days:** "
        f"{sum(r.template_win for r in stocks_data)} / {len(stocks_data)} "
        f"({_pct(sum(r.template_win for r in stocks_data), len(stocks_data))}); "
        f"on the exact date {_pct(sum(r.template_on for r in stocks_data), len(stocks_data))}\n"
        f"- **Strict preset (RS>=80, within 15% of high) — caught within window:** "
        f"{sum(r.strict_win for r in stocks_data)} / {len(stocks_data)} "
        f"({_pct(sum(r.strict_win for r in stocks_data), len(stocks_data))}); "
        f"on the exact date {_pct(sum(r.strict_on for r in stocks_data), len(stocks_data))}\n"
    )
    L.append(
        "\n> RS uses the universe-free fallback (proxy for the app's percentile), so strict "
        "catch-rates are approximate. Stage / MA-stack / 52w legs are exact.\n"
    )

    # By-year.
    by_year = defaultdict(list)
    for r in stocks_data:
        by_year[r.year].append(r)
    L.append("\n## By year (stocks with data)\n")
    L.append("| Year | Ideas | Template caught | Strict caught |")
    L.append("|---|--:|--:|--:|")
    for year in sorted(by_year):
        rs = by_year[year]
        L.append(
            f"| {year} | {len(rs)} | {sum(r.template_win for r in rs)} ({_pct(sum(r.template_win for r in rs), len(rs))}) "
            f"| {sum(r.strict_win for r in rs)} ({_pct(sum(r.strict_win for r in rs), len(rs))}) |"
        )

    # Template misses (real blind spots: had data, stock, never passed in window).
    misses = [r for r in stocks_data if not r.template_win]
    L.append(f"\n## Template misses ({len(misses)} of {len(stocks_data)})\n")
    if misses:
        L.append("Stocks Minervini bought that never passed the trend template in the window "
                 "(recent IPO with <240 bars, deep base, or genuinely weak at that moment):\n")
        L.append("| Ticker | Date |")
        L.append("|---|---|")
        for r in misses[:40]:
            L.append(f"| {r.ticker} | {r.date} |")
        if len(misses) > 40:
            L.append(f"| … | +{len(misses) - 40} more |")

    # Strict-only drops (caught by template but the tightening dropped them).
    drops = [r for r in stocks_data if r.template_win and not r.strict_win]
    L.append(f"\n## Dropped by the RS>=80 / within-15% tightening ({len(drops)})\n")
    L.append("Picks the template caught but the stricter preset excluded — the cost of selectivity:\n")
    if drops:
        L.append("| Ticker | Date |")
        L.append("|---|---|")
        for r in drops[:30]:
            L.append(f"| {r.ticker} | {r.date} |")
        if len(drops) > 30:
            L.append(f"| … | +{len(drops) - 30} more |")

    return "\n".join(L) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--csv", type=str, default=str(DEFAULT_CSV))
    parser.add_argument("--since", type=str, default="2017-01-01", help="only ideas on/after this date (YYYY-MM-DD)")
    parser.add_argument("--until", type=str, default=None, help="only ideas on/before this date")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--window-before", type=int, default=5)
    parser.add_argument("--window-after", type=int, default=15)
    parser.add_argument("--markdown", type=str, default=None)
    args = parser.parse_args()

    ideas = _load_trade_ideas(Path(args.csv), args.since, args.until, args.limit)
    if not ideas:
        raise SystemExit("No trade ideas matched the filters.")
    etfs = _load_etf_tickers()
    print(f"Loaded {len(ideas)} ideas ({sum(t in etfs for t, _ in ideas)} ETFs); benchmarking...", file=sys.stderr)

    results = backtest(ideas, etfs, args.window_before, args.window_after)
    markdown = render_markdown(results, args.window_before, args.window_after, args.since, args.until)
    print(markdown)
    if args.markdown:
        Path(args.markdown).write_text(markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
