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

from app.services.sec_edgar_financials import (
    EPS_TAGS,
    NET_INCOME_TAGS,
    REVENUE_TAGS,
    SecEdgarClient,
    quarterly_series_dated,
)

_REPO_ROOT = Path(__file__).resolve().parents[2]
TRADE_IDEAS_CSV = _REPO_ROOT / "data" / "minervini_trade_ideas.csv"
DEFAULT_TICKERS = ["NVDA", "AAPL", "MSFT", "NUE", "ANF", "YETI", "OLN", "ASYS", "MRNA", "STAA"]


def _idea_rows(limit: int | None) -> list[tuple[str, str]]:
    """``[(ticker, idea_date), ...]`` from the trade-ideas CSV, most recent
    first (the CSV's native order). One row per idea, duplicates kept — the
    as-of catch rate is a per-idea statistic."""
    rows: list[tuple[str, str]] = []
    if not TRADE_IDEAS_CSV.exists():
        return []
    with open(TRADE_IDEAS_CSV, newline="", encoding="utf-8") as fh:
        for row in csv.DictReader(fh):
            t = (row.get("Ticker") or "").strip().upper()
            d = (row.get("Date") or "").strip()
            if t and d:
                rows.append((t, d))
    return rows[:limit] if limit else rows


def _evaluable(reason: str) -> bool:
    """True when there was enough (point-in-time) EDGAR history to judge."""
    return reason == "ok" or reason.startswith("not accelerating")


def _run_as_of_idea_dates(client, limit: int | None, require_margin: bool, markdown_path: str | None) -> int:
    """Historical catch rate: was Code 33 on AT each trade idea's date?

    CONTROL = the same ticker evaluated one year before the idea date. If
    Code 33 carries signal, the pass rate at idea dates should exceed the
    control rate — the raw rate alone is not the headline (same discipline
    as the 908-trade price harness: report DISCRIMINATION).
    Only pairs where BOTH vantages are evaluable count, so the two rates
    share a denominator.
    """
    from datetime import date, timedelta

    ideas = _idea_rows(limit)
    facts_cache: dict[str, dict | None] = {}
    per_year: dict[int, list[int]] = {}  # year -> [pairs, pass_entry, pass_ctrl]
    no_facts = 0
    insufficient = 0

    for i, (ticker, idea_date) in enumerate(ideas, 1):
        print(f"[{i}/{len(ideas)}] {ticker} @ {idea_date} ...", file=sys.stderr)
        if ticker not in facts_cache:
            try:
                facts_cache[ticker] = client.company_facts(ticker)
            except Exception:  # noqa: BLE001 - one bad symbol must not abort the batch
                facts_cache[ticker] = None
        facts = facts_cache[ticker]
        if not facts:
            no_facts += 1
            continue
        from app.services.sec_edgar_financials import compute_code33_from_facts

        y, m, d = (int(p) for p in idea_date.split("-"))
        ctrl_date = (date(y, m, d) - timedelta(days=365)).isoformat()
        entry = compute_code33_from_facts(facts, require_margin=require_margin, as_of=idea_date)
        ctrl = compute_code33_from_facts(facts, require_margin=require_margin, as_of=ctrl_date)
        if not (_evaluable(entry.reason) and _evaluable(ctrl.reason)):
            insufficient += 1
            continue
        stats = per_year.setdefault(y, [0, 0, 0])
        stats[0] += 1
        stats[1] += int(entry.passes)
        stats[2] += int(ctrl.passes)

    pairs = sum(s[0] for s in per_year.values())
    p_entry = sum(s[1] for s in per_year.values())
    p_ctrl = sum(s[2] for s in per_year.values())
    pct = lambda n, d: f"{n / d * 100:.1f}%" if d else "-"  # noqa: E731

    mode = "strict" if require_margin else "relaxed (live)"
    lines = ["# Code 33 catch rate AT idea dates (point-in-time EDGAR)\n"]
    lines.append(
        f"Mode: **{mode}**. {len(ideas)} ideas; {no_facts} without EDGAR facts, "
        f"{insufficient} with insufficient point-in-time history (XBRL starts ~2009-2011). "
        f"**{pairs} idea/control pairs evaluable.**\n"
    )
    if pairs:
        disc = (p_entry - p_ctrl) / pairs * 100
        lines.append(
            f"Pass at idea date: **{pct(p_entry, pairs)}** vs control (1y earlier, same stock): "
            f"**{pct(p_ctrl, pairs)}** — discrimination **{disc:+.1f}pp**.\n"
        )
    lines.append("| Idea year | pairs | pass@idea | pass@control |")
    lines.append("|---|---|---|---|")
    for y in sorted(per_year, reverse=True):
        n, pe, pc = per_year[y]
        lines.append(f"| {y} | {n} | {pct(pe, n)} | {pct(pc, n)} |")
    markdown = "\n".join(lines) + "\n"

    print(markdown)
    if markdown_path:
        Path(markdown_path).write_text(markdown, encoding="utf-8")
    return 0


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
        "--dump",
        action="store_true",
        help="Diagnostics: print each ticker's dated quarterly series (end=value[label]) "
        "per metric to stderr, to see exactly which quarter-ends/YoY bases exist.",
    )
    parser.add_argument(
        "--as-of-idea-dates",
        action="store_true",
        help="Evaluate each trade idea point-in-time (filings filed on or before its "
        "idea date) against a 1-year-earlier control, and report the catch rate.",
    )
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Require net-margin acceleration too (literal Code 33). Default is the "
        "relaxed EPS+sales screen used live in the static build.",
    )
    args = parser.parse_args()
    require_margin = args.strict

    if args.as_of_idea_dates:
        client = SecEdgarClient(user_agent=args.user_agent)
        return _run_as_of_idea_dates(client, args.limit, require_margin, args.markdown)

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
        if args.dump:
            facts = client.company_facts(ticker) or {}
            for name, tags, is_eps in (("EPS", EPS_TAGS, True), ("REV", REVENUE_TAGS, False), ("NI", NET_INCOME_TAGS, False)):
                dated = quarterly_series_dated(facts, tags, is_eps=is_eps)
                tail = ", ".join(f"{end}={val:.6g}[{label}]" for end, val, label in dated[-10:])
                print(f"  DUMP {ticker} {name}: {tail or '(empty)'}", file=sys.stderr)
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
