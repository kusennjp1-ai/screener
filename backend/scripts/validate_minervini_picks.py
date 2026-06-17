"""Validate that screened names genuinely fit Minervini's style — per ticker.

Given a list of tickers (default: the live Minervini preset short-list), this
loops over each name and scores it against Minervini's two pillars using *real*
data, then prints a per-ticker scorecard and an overall verdict:

  * **Technical** — the actual ``MinerviniScanner`` on fresh Yahoo prices:
    trend template pass, Stage, RS rating, distance from the 52-week high, %
    above the 52-week low, the 50>150>200 MA stack, VCP, ADR%. This is exactly
    the engine the app screens with, so "passes" here means the same thing.
  * **Fundamental** — Code 33 (relaxed) from SEC EDGAR XBRL: diluted EPS and
    sales YoY growth for the three most recent quarters, so you can see whether
    earnings/sales are *genuinely accelerating* (each quarter's YoY higher than
    the last) rather than merely positive.

Each ticker gets a verdict that flags concerns (extended above the 50-day,
late-stage, thin acceleration) so you can judge "clean Stage-2 leader with
accelerating fundamentals" vs "passes the mechanical filter but looks marginal".

Network: needs Yahoo Finance (yfinance) + data.sec.gov (EDGAR). Run from CI, not
the app sandbox.

Usage:
    python -m scripts.validate_minervini_picks
    python -m scripts.validate_minervini_picks AMKR FORM NXPI --markdown out.md
"""
from __future__ import annotations

import argparse
import sys
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

import pandas as pd

from app.scanners.base_screener import StockData
from app.scanners.minervini_scanner import MinerviniScanner
from app.services.sec_edgar_financials import SecEdgarClient

BENCHMARK = "SPY"
HISTORY_PAD_CALENDAR_DAYS = 820  # ~2.2y so the 200-day MA + RS have history
MIN_BARS = 240

# The live Minervini preset short-list (RS>=90, within 10% of high, top-half IBD
# group, Code 33) as of the 2026-06-16 build — the names this script defaults to.
DEFAULT_TICKERS = [
    "PGC", "RS", "AMKR", "ARW", "CVLG", "HLIO", "JBL", "FORM",
    "WDC", "FTNT", "TKR", "SNX", "HBB", "AAON", "NXPI",
]

# Minervini preset thresholds (mirror preset_screens.py).
RS_MIN = 90
FROM_HIGH_MIN = -10.0   # within 10% of the 52-week high (distance is negative)
ABOVE_LOW_MIN = 30.0    # >=30% above the 52-week low
EXTENDED_ABOVE_50 = 15.0  # >15% above the 50-day == buying-extended risk


def _download(symbol: str, start: str, end: str) -> Optional[pd.DataFrame]:
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
class Scorecard:
    ticker: str
    has_price: bool = False
    passes_template: Optional[bool] = None
    stage: Optional[int] = None
    rs_rating: Optional[float] = None
    from_high_pct: Optional[float] = None
    above_low_pct: Optional[float] = None
    ma_stack_ok: Optional[bool] = None
    ema_50_distance: Optional[float] = None
    vcp_detected: Optional[bool] = None
    adr_percent: Optional[float] = None
    code33_pass: Optional[bool] = None
    eps_yoy: Optional[list] = None
    sales_yoy: Optional[list] = None
    code33_note: str = ""

    def flags(self) -> list[str]:
        out: list[str] = []
        if self.passes_template is False:
            out.append("FAILS template")
        if self.stage is not None and self.stage != 2:
            out.append(f"Stage {self.stage} (not 2)")
        if self.rs_rating is not None and self.rs_rating < RS_MIN:
            out.append(f"RS {self.rs_rating:.0f}<90")
        if self.from_high_pct is not None and self.from_high_pct < FROM_HIGH_MIN:
            out.append(f">{abs(FROM_HIGH_MIN):.0f}% below high")
        if self.above_low_pct is not None and self.above_low_pct < ABOVE_LOW_MIN:
            out.append(f"only {self.above_low_pct:.0f}% above low")
        if self.ma_stack_ok is False:
            out.append("MA stack broken")
        if self.ema_50_distance is not None and self.ema_50_distance > EXTENDED_ABOVE_50:
            out.append(f"extended +{self.ema_50_distance:.0f}% vs 50d")
        if self.code33_pass is False:
            out.append("no Code 33 accel")
        return out

    def verdict(self) -> str:
        if not self.has_price or self.passes_template is None:
            return "NO DATA"
        flags = self.flags()
        # A clean fit: template + Stage 2 + RS>=90 + buyable range + accel, no flags.
        if not flags and self.code33_pass:
            return "✅ clean fit"
        # Hard misses (would not be a Minervini buy at all).
        hard = [f for f in flags if f.startswith("FAILS") or "not 2" in f or "below high" in f]
        if hard:
            return "❌ off-style: " + "; ".join(flags)
        return "⚠ marginal: " + "; ".join(flags)


def _fmt_series(series: Optional[list]) -> str:
    if not series:
        return "-"
    return " → ".join(f"{v * 100:+.0f}%" for v in series)


def _evaluate_technical(scanner: MinerviniScanner, ticker: str, card: Scorecard,
                        bench: pd.DataFrame) -> None:
    target = pd.Timestamp(datetime.utcnow().date())
    start = (target - timedelta(days=HISTORY_PAD_CALENDAR_DAYS)).strftime("%Y-%m-%d")
    end = (target + timedelta(days=2)).strftime("%Y-%m-%d")
    price = _download(ticker, start, end)
    if price is None or len(price) < MIN_BARS:
        return
    card.has_price = True
    result = scanner.scan_stock(
        ticker,
        StockData(symbol=ticker, price_data=price, benchmark_data=bench, benchmark_symbol=BENCHMARK),
    )
    d = result.details or {}
    if d.get("error"):
        return
    card.passes_template = bool(d.get("passes_template"))
    card.stage = d.get("stage")
    card.rs_rating = d.get("rs_rating")
    card.from_high_pct = d.get("from_52w_high_pct")
    card.above_low_pct = d.get("above_52w_low_pct")
    card.ema_50_distance = d.get("ema_50_distance")
    card.vcp_detected = d.get("vcp_detected")
    card.adr_percent = d.get("adr_percent")
    ma_50, ma_150, ma_200 = d.get("ma_50"), d.get("ma_150"), d.get("ma_200")
    if None not in (ma_50, ma_150, ma_200):
        card.ma_stack_ok = ma_50 > ma_150 > ma_200


def _evaluate_fundamental(client: SecEdgarClient, ticker: str, card: Scorecard) -> None:
    try:
        res = client.code33(ticker, require_margin=False)
    except Exception as exc:  # noqa: BLE001
        card.code33_note = f"EDGAR error: {str(exc)[:40]}"
        return
    card.code33_pass = res.passes
    card.eps_yoy = res.eps_yoy or None
    card.sales_yoy = res.sales_yoy or None
    card.code33_note = res.reason


def _render_table(cards: list[Scorecard], header: list[str]) -> str:
    L = list(header)
    for c in cards:
        def b(v):
            return "✓" if v else ("✗" if v is False else "-")
        rs = f"{c.rs_rating:.0f}" if c.rs_rating is not None else "-"
        fh = f"{c.from_high_pct:.1f}%" if c.from_high_pct is not None else "-"
        al = f"{c.above_low_pct:.0f}%" if c.above_low_pct is not None else "-"
        e50 = f"{c.ema_50_distance:+.0f}%" if c.ema_50_distance is not None else "-"
        adr = f"{c.adr_percent:.1f}" if c.adr_percent is not None else "-"
        stage = str(c.stage) if c.stage is not None else "-"
        L.append(
            f"| **{c.ticker}** | {c.verdict()} | {b(c.passes_template)} | {stage} | {rs} | "
            f"{fh} | {al} | {b(c.ma_stack_ok)} | {e50} | {b(c.vcp_detected)} | {adr} | "
            f"{_fmt_series(c.eps_yoy)} | {_fmt_series(c.sales_yoy)} | {b(c.code33_pass)} |"
        )
    return "\n".join(L) + "\n"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tickers", nargs="*", help="tickers to validate (default: live preset list)")
    parser.add_argument("--user-agent", type=str, default="screener-research validate (research@example.com)")
    parser.add_argument("--markdown", type=str, default=None)
    args = parser.parse_args()

    tickers = list(dict.fromkeys(t.upper() for t in args.tickers)) or DEFAULT_TICKERS

    target = pd.Timestamp(datetime.utcnow().date())
    start = (target - timedelta(days=HISTORY_PAD_CALENDAR_DAYS)).strftime("%Y-%m-%d")
    end = (target + timedelta(days=2)).strftime("%Y-%m-%d")
    print(f"Fetching benchmark {BENCHMARK} ...", file=sys.stderr)
    bench = _download(BENCHMARK, start, end)
    if bench is None or bench.empty:
        raise SystemExit("Could not download benchmark history; aborting.")

    scanner = MinerviniScanner()
    client = SecEdgarClient(user_agent=args.user_agent)

    cards: list[Scorecard] = []
    for i, ticker in enumerate(tickers, 1):
        print(f"[{i}/{len(tickers)}] {ticker} ...", file=sys.stderr)
        card = Scorecard(ticker=ticker)
        _evaluate_technical(scanner, ticker, card, bench)
        _evaluate_fundamental(client, ticker, card)
        cards.append(card)

    header = [
        "# Minervini pick validation\n",
        (
            f"Evaluated **{len(cards)}** names against the trend template (live "
            f"`MinerviniScanner` on Yahoo prices) and Code 33 (EDGAR EPS+sales YoY "
            f"acceleration over the 3 most recent quarters).\n"
        ),
        (
            f"- ✅ clean fit: **{sum(1 for c in cards if c.verdict().startswith('✅'))}**\n"
            f"- ⚠ marginal: **{sum(1 for c in cards if c.verdict().startswith('⚠'))}**\n"
            f"- ❌ off-style: **{sum(1 for c in cards if c.verdict().startswith('❌'))}**\n"
            f"- no data: **{sum(1 for c in cards if c.verdict() == 'NO DATA')}**\n"
        ),
        (
            "\n> `% vs 52wH` is distance below the high (0 = at highs). `+vs50d` is "
            "how far price sits above the 50-day (large = extended/chase risk). EPS/Sales "
            "YoY shows the 3 most recent quarters recent→older; rising magnitude = accelerating.\n"
        ),
        (
            "\n| Ticker | Verdict | Tmpl | Stage | RS | % vs 52wH | % above 52wL | "
            "MA stk | +vs50d | VCP | ADR% | EPS YoY (recent→older) | Sales YoY | C33 |"
        ),
        "|---|---|:--:|:--:|--:|--:|--:|:--:|--:|:--:|--:|---|---|:--:|",
    ]
    markdown = _render_table(cards, header)
    print(markdown)
    if args.markdown:
        Path(args.markdown).write_text(markdown, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
