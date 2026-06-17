"""Diagnostic: compute Code 33 from live SEC EDGAR for a set of tickers.

Validates end-to-end that EDGAR company-facts fetching + the Code 33 engine work
on real filings, before wiring Code 33 into the universe scan. Prints a markdown
table (ticker, pass, the three YoY series, reason).

Network: needs outbound data.sec.gov / www.sec.gov (available in CI, not in the
app sandbox). SEC asks for a descriptive User-Agent and <=10 req/sec.

Usage:
    python -m scripts.check_code33 NVDA AAPL NVO ANF NUE
    python -m scripts.check_code33 --from-trade-ideas --limit 40
    python -m scripts.check_code33 --markdown report.md NVDA AAPL
"""
from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from app.services.sec_edgar_financials import SecEdgarClient

_REPO_ROOT = Path(__file__).resolve().parents[2]
TRADE_IDEAS_CSV = _REPO_ROOT / "data" / "minervini_trade_ideas.csv"
DEFAULT_TICKERS = ["NVDA", "AAPL", "MSFT", "NUE", "ANF", "YETI", "OLN", "ASYS", "MRNA", "STAA"]


def _from_trade_ideas(limit: int | None) -> list[str]:
    seen: list[str] = []
    if not TRADE_IDEAS_CSV.exists():
        return []
    with open(TRADE_IDEAS_CSV, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            t = (row.get("Ticker") or "").strip().upper()
            if t and t not in seen:
                seen.append(t)
    # CSV is already ordered most-recent idea first; keep that order so the
    # sample is recent, still-listed names (older tickers are often delisted).
    return seen[:limit] if limit else seen


def _fmt_series(series: list[float]) -> str:
    if not series:
        return "-"
    return " > ".join(f"{v * 100:.0f}%" for v in series)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tickers", nargs="*", help="tickers to check")
    parser.add_argument("--from-trade-ideas", action="store_true", help="use data/minervini_trade_ideas.csv")
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--user-agent", type=str, default="screener-research code33 (research@example.com)")
    parser.add_argument("--markdown", type=str, default=None)
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Require net-margin acceleration too (literal Code 33). Default is the "
        "relaxed EPS+sales screen used live in the static build.",
    )
    args = parser.parse_args()
    require_margin = args.strict

    tickers = list(dict.fromkeys(args.tickers))
    if args.from_trade_ideas:
        tickers = list(dict.fromkeys(tickers + _from_trade_ideas(args.limit)))
    if not tickers:
        tickers = DEFAULT_TICKERS

    client = SecEdgarClient(user_agent=args.user_agent)

    rows: list[tuple[str, str, str, str, str, str]] = []
    passes = 0
    evaluated = 0
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] {ticker} ...", file=sys.stderr)
        try:
            res = client.code33(ticker, require_margin=require_margin)
        except Exception as exc:  # noqa: BLE001
            rows.append((ticker, "ERR", "-", "-", "-", str(exc)[:60]))
            continue
        if res.reason not in ("no EDGAR facts", "missing EPS/revenue/net-income series",
                              "fewer than 3 comparable quarters"):
            evaluated += 1
        if res.passes:
            passes += 1
        rows.append((
            ticker,
            "✓" if res.passes else "✗",
            _fmt_series(res.eps_yoy),
            _fmt_series(res.sales_yoy),
            _fmt_series(res.margin_yoy),
            res.reason,
        ))

    mode_label = (
        "diluted EPS, sales, and net margin"
        if require_margin
        else "diluted EPS and sales"
    )
    lines = ["# Code 33 (EDGAR) check\n"]
    lines.append(
        f"Mode: **{'strict' if require_margin else 'relaxed (live)'}**. "
        f"Evaluated {len(tickers)} tickers; **{passes}** pass Code 33 "
        f"(3 consecutive quarters of rising YoY growth in {mode_label}). "
        f"{evaluated} had enough EDGAR history to judge.\n"
    )
    lines.append("| Ticker | Code 33 | EPS YoY (recent→older) | Sales YoY | Margin YoY | Note |")
    lines.append("|---|:--:|---|---|---|---|")
    for r in rows:
        lines.append(f"| {r[0]} | {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} |")
    markdown = "\n".join(lines) + "\n"

    print(markdown)
    if args.markdown:
        Path(args.markdown).write_text(markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
