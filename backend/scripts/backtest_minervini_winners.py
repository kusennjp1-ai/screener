"""Backtest the Minervini trend-template screener against known winners.

Given a list of (symbol, entry-date) pairs — e.g. the stocks Mark Minervini
actually bought on his way to winning the US Investing Championship — this
replays the *current* ``MinerviniScanner`` as of each entry date and reports
whether our strict trend template would have flagged the stock at (or near)
the same time.

What is exact vs. approximate
-----------------------------
The structural Minervini legs are computed exactly, on real historical prices:
  * Stage 2 (Weinstein)
  * Full moving-average stack (price > 50 > 150 > 200, 200-day MA rising)
  * >= 30% above the 52-week low
  * within 25% of the 52-week high
  * VCP detection

Only the **RS leg is approximate**. Production ranks a stock's relative
performance as a percentile of the whole scanned universe; reproducing that
needs every universe member's history at each date. By default this script
instead uses the scanner's universe-free fallback (RS = 50 + weighted
out/under-performance vs SPY), which is monotonic but not the exact percentile.
The raw weighted out-performance vs SPY is printed alongside so the RS leg can
be judged directly. Pass ``--universe-csv`` to rank against a real basket.

Network
-------
Requires outbound access to Yahoo Finance (yfinance). It will not run in the
sandboxed app container; run it from CI (see .github/workflows/backtest.yml)
or any host with internet access.

Usage
-----
    python -m scripts.backtest_minervini_winners
    python -m scripts.backtest_minervini_winners --window-before 5 --window-after 20
    python -m scripts.backtest_minervini_winners --markdown report.md
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta

import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.minervini_scanner import MinerviniScanner

# Minervini's USIC entries (from the user-provided list). Dates are the buy
# dates; we test whether our template would have flagged the name at/near then.
WINNERS: list[tuple[str, str]] = [
    ("ANF", "2021-01-04"),
    ("GM", "2021-01-11"),
    ("STAA", "2021-01-12"),
    ("NNOX", "2021-01-20"),
    ("UAVS", "2021-02-09"),
    ("MP", "2021-02-09"),
    ("GBOX", "2021-04-05"),
    ("YETI", "2021-04-06"),
    ("ZIM", "2021-04-08"),
    ("BNTX", "2021-06-02"),
    ("HSKA", "2021-06-04"),
    ("TSP", "2021-06-08"),
    ("AAPL", "2021-06-17"),
    ("MRNA", "2021-06-25"),
    ("SKY", "2021-07-30"),
    ("NUE", "2021-08-09"),
    ("PAG", "2021-09-01"),
    ("TSLA", "2021-09-24"),
    ("OLN", "2021-10-11"),
    ("ASYS", "2021-10-26"),
    ("UPST", "2021-10-12"),
]

BENCHMARK = "SPY"
# 2 years of history are needed for the 200-day MA and 52-week range; pad it.
LOOKBACK_DAYS = 420  # ~2y of *calendar* days is too short; use trading-aware pad
HISTORY_PAD_CALENDAR_DAYS = 900  # fetch this far before the entry date


@dataclass
class LegResult:
    """One stock's evaluation on a single date."""

    date: str
    passes_template: bool
    rs_rating: float | None
    rel_perf_vs_spy: float | None
    stage: int | None
    ma_stack_ok: bool | None
    above_low_pct: float | None
    from_high_pct: float | None
    vcp_detected: bool | None
    error: str | None = None


def _download(symbol: str, start: str, end: str) -> pd.DataFrame | None:
    import yfinance as yf

    try:
        df = yf.download(
            symbol,
            start=start,
            end=end,
            auto_adjust=True,
            progress=False,
            threads=False,
        )
    except Exception as exc:  # noqa: BLE001 - network/parse errors are reported, not fatal
        print(f"  ! download failed for {symbol}: {exc}", file=sys.stderr)
        return None
    if df is None or df.empty:
        return None
    # yfinance may return a column MultiIndex for a single ticker; flatten it.
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = df.columns.get_level_values(0)
    keep = [c for c in ("Open", "High", "Low", "Close", "Volume") if c in df.columns]
    df = df[keep].dropna()
    df.index = pd.to_datetime(df.index)
    return df


def _evaluate_on_date(
    scanner: MinerviniScanner,
    symbol: str,
    price_full: pd.DataFrame,
    bench_full: pd.DataFrame,
    as_of: pd.Timestamp,
) -> LegResult | None:
    """Run the scanner using only data up to and including ``as_of``."""
    price = price_full[price_full.index <= as_of]
    bench = bench_full[bench_full.index <= as_of]
    if len(price) < 240 or len(bench) < 240:
        return None

    stock_data = StockData(
        symbol=symbol,
        price_data=price,
        benchmark_data=bench,
        benchmark_symbol=BENCHMARK,
    )
    result = scanner.scan_stock(symbol, stock_data)
    d = result.details or {}
    if d.get("error"):
        return LegResult(
            date=as_of.date().isoformat(),
            passes_template=False,
            rs_rating=None,
            rel_perf_vs_spy=None,
            stage=None,
            ma_stack_ok=None,
            above_low_pct=None,
            from_high_pct=None,
            vcp_detected=None,
            error=str(d.get("error")),
        )
    full = d.get("full_analysis", {})
    rel_perf = (full.get("rs", {}) or {}).get("relative_performance")
    return LegResult(
        date=as_of.date().isoformat(),
        passes_template=bool(d.get("passes_template")),
        rs_rating=d.get("rs_rating"),
        rel_perf_vs_spy=rel_perf,
        stage=d.get("stage"),
        ma_stack_ok=bool(d.get("ma_alignment")),
        above_low_pct=d.get("above_52w_low_pct"),
        from_high_pct=d.get("from_52w_high_pct"),
        vcp_detected=d.get("vcp_detected"),
    )


def _trading_dates_around(
    index: pd.DatetimeIndex, target: pd.Timestamp, before: int, after: int
) -> list[pd.Timestamp]:
    """Return trading days in [target-before, target+after] present in ``index``."""
    on_or_before = index[index <= target]
    if len(on_or_before) == 0:
        return []
    anchor_pos = len(on_or_before) - 1  # position of the last bar <= target
    lo = max(0, anchor_pos - before)
    hi = min(len(index) - 1, anchor_pos + after)
    return list(index[lo : hi + 1])


@dataclass
class SymbolReport:
    symbol: str
    entry_date: str
    on_date: LegResult | None
    first_pass: LegResult | None  # earliest pass within the window, if any
    note: str | None = None


def backtest(
    winners: list[tuple[str, str]],
    window_before: int,
    window_after: int,
) -> list[SymbolReport]:
    scanner = MinerviniScanner()
    reports: list[SymbolReport] = []

    # SPY history wide enough to cover every entry date's lookback.
    earliest = min(datetime.strptime(d, "%Y-%m-%d") for _, d in winners)
    latest = max(datetime.strptime(d, "%Y-%m-%d") for _, d in winners)
    start = (earliest - timedelta(days=HISTORY_PAD_CALENDAR_DAYS)).strftime("%Y-%m-%d")
    end = (latest + timedelta(days=window_after + 10)).strftime("%Y-%m-%d")

    print(f"Fetching benchmark {BENCHMARK} [{start} .. {end}] ...", file=sys.stderr)
    bench_full = _download(BENCHMARK, start, end)
    if bench_full is None or bench_full.empty:
        raise SystemExit("Could not download benchmark history; aborting.")

    for symbol, entry in winners:
        print(f"Backtesting {symbol} @ {entry} ...", file=sys.stderr)
        target = pd.Timestamp(entry)
        price_full = _download(symbol, start, end)
        if price_full is None or price_full.empty:
            reports.append(SymbolReport(symbol, entry, None, None, note="no price data"))
            continue

        dates = _trading_dates_around(price_full.index, target, window_before, window_after)
        if not dates:
            reports.append(SymbolReport(symbol, entry, None, None, note="date out of range"))
            continue

        # The bar on/just before the entry date.
        on_or_before = [d for d in dates if d <= target]
        anchor = on_or_before[-1] if on_or_before else dates[0]

        on_date = _evaluate_on_date(scanner, symbol, price_full, bench_full, anchor)
        first_pass: LegResult | None = None
        for d in dates:
            leg = _evaluate_on_date(scanner, symbol, price_full, bench_full, d)
            if leg and leg.passes_template:
                first_pass = leg
                break
        reports.append(SymbolReport(symbol, entry, on_date, first_pass))

    return reports


def _fmt(value, suffix="", nd=0):
    if value is None:
        return "-"
    if isinstance(value, bool):
        return "✓" if value else "✗"
    try:
        return f"{float(value):.{nd}f}{suffix}"
    except (TypeError, ValueError):
        return str(value)


def render_markdown(reports: list[SymbolReport], window_before: int, window_after: int) -> str:
    passed_on = sum(1 for r in reports if r.on_date and r.on_date.passes_template)
    passed_window = sum(1 for r in reports if r.first_pass is not None)
    total = len(reports)

    lines: list[str] = []
    lines.append("# Minervini USIC winners — screener backtest\n")
    lines.append(
        f"Replayed the current strict Minervini trend template against "
        f"**{total}** known winners as of their buy dates.\n"
    )
    lines.append(
        f"- **Passed on the buy date:** {passed_on} / {total}\n"
        f"- **Passed within window [-{window_before}, +{window_after}] trading days:** "
        f"{passed_window} / {total}\n"
    )
    lines.append(
        "\n> RS rating is the universe-free fallback (50 + weighted out-performance "
        "vs SPY); the `RelPerf%` column is the exact weighted out-performance so the "
        "RS leg can be judged directly. Stage / MA-stack / 52w-low / 52w-high / VCP "
        "are computed exactly.\n"
    )

    lines.append("\n## On the buy date\n")
    lines.append(
        "| Symbol | Date | Pass | RS | RelPerf% | Stage | MA stack | +%>52wLow | %<52wHigh | VCP | Note |"
    )
    lines.append("|---|---|:--:|--:|--:|:--:|:--:|--:|--:|:--:|---|")
    for r in reports:
        leg = r.on_date
        if leg is None:
            lines.append(
                f"| {r.symbol} | {r.entry_date} | - | - | - | - | - | - | - | - | {r.note or 'insufficient data'} |"
            )
            continue
        note = leg.error or ""
        lines.append(
            f"| {r.symbol} | {leg.date} | {_fmt(leg.passes_template)} | "
            f"{_fmt(leg.rs_rating, nd=0)} | {_fmt(leg.rel_perf_vs_spy, suffix='%', nd=1)} | "
            f"{_fmt(leg.stage)} | {_fmt(leg.ma_stack_ok)} | "
            f"{_fmt(leg.above_low_pct, suffix='%', nd=0)} | {_fmt(leg.from_high_pct, suffix='%', nd=0)} | "
            f"{_fmt(leg.vcp_detected)} | {note} |"
        )

    lines.append("\n## Earliest template pass within the window\n")
    lines.append("| Symbol | Buy date | First pass | Offset (trading days) |")
    lines.append("|---|---|---|--:|")
    for r in reports:
        if r.first_pass is None:
            lines.append(f"| {r.symbol} | {r.entry_date} | — (never in window) | - |")
            continue
        # Offset relative to buy date in calendar days (close enough as a hint).
        offset_days = (pd.Timestamp(r.first_pass.date) - pd.Timestamp(r.entry_date)).days
        sign = "+" if offset_days >= 0 else ""
        lines.append(
            f"| {r.symbol} | {r.entry_date} | {r.first_pass.date} | {sign}{offset_days}d |"
        )

    return "\n".join(lines) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--window-before", type=int, default=5, help="trading days before the buy date to scan")
    parser.add_argument("--window-after", type=int, default=20, help="trading days after the buy date to scan")
    parser.add_argument("--markdown", type=str, default=None, help="write the markdown report to this path")
    args = parser.parse_args()

    reports = backtest(WINNERS, args.window_before, args.window_after)
    markdown = render_markdown(reports, args.window_before, args.window_after)
    print(markdown)
    if args.markdown:
        with open(args.markdown, "w", encoding="utf-8") as fh:
            fh.write(markdown)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
