#!/usr/bin/env python3
"""Export real, dated SPY OHLCV for independent book RS evidence.

Dependencies: yfinance, pandas_market_calendars. Never creates sample prices or
substitutes a stale/calibration series when the provider is unavailable.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, timedelta, timezone
import json
import math
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
from zoneinfo import ZoneInfo


def validate_bars(bars, expected_sessions, as_of_date):
    """Exact exchange-session coverage, finite OHLCV and requested closing date."""
    if not bars or len(bars) < 400:
        raise ValueError("SPY requires at least 400 actual daily bars for the two-year export")
    actual_dates = [b["date"] for b in bars]
    if actual_dates != expected_sessions:
        missing = sorted(set(expected_sessions) - set(actual_dates))[:8]
        extra = sorted(set(actual_dates) - set(expected_sessions))[:8]
        raise ValueError(f"SPY exchange-session gaps/order/duplicates: missing={missing}, extra={extra}")
    if actual_dates[-1] != as_of_date:
        raise ValueError("SPY final session differs from manifest as_of_date")
    for bar in bars:
        if date.fromisoformat(bar["date"]).isoformat() != bar["date"] or bar["date"] > as_of_date:
            raise ValueError("Invalid/future SPY bar date")
        prices = [bar[k] for k in ("open", "high", "low", "close")]
        if not all(isinstance(x, (float, int)) and not isinstance(x, bool) and math.isfinite(x) and x > 0 for x in prices):
            raise ValueError(f"Invalid SPY OHLC at {bar['date']}")
        if bar["high"] < max(bar["open"], bar["close"], bar["low"]) or bar["low"] > min(bar["open"], bar["close"]):
            raise ValueError(f"Inconsistent SPY OHLC at {bar['date']}")
        volume = bar["volume"]
        if not isinstance(volume, (float, int)) or isinstance(volume, bool) or not math.isfinite(volume) or volume <= 0:
            raise ValueError(f"Invalid SPY volume at {bar['date']}")


def export_session_calendar(root: Path, manifest, mcal, target, now=None):
    """Publish provider sessions independently of whether any SPY prices arrive."""
    now = now or datetime.now(timezone.utc)
    start = target - timedelta(days=730)
    entry = manifest.get("markets", {}).get("US", manifest)
    index_path = entry.get("assets", {}).get("charts", {}).get("path")
    # Price dates only widen the requested calendar interval. They never define
    # which days were sessions, so missing prices cannot erase an expected day.
    if index_path:
        root = root.resolve()
        def read_payload(relative):
            path = (root / relative).resolve()
            if not path.is_relative_to(root):
                raise ValueError("Calendar input path escapes static-data root")
            return json.loads(path.read_text(encoding="utf-8"))
        index = read_payload(index_path)
        for item in index.get("symbols", []):
            try:
                chart = read_payload(item["path"])
            except FileNotFoundError:
                continue
            first = next(iter(chart.get("bars", [])), {})
            try:
                first_day = date.fromisoformat(first.get("date", ""))
            except (ValueError, TypeError, AttributeError):
                continue
            start = min(start, first_day)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=start, end_date=target)
    sessions = [stamp.date().isoformat() for stamp in schedule.index]
    if not sessions or sessions[-1] != target.isoformat() or schedule.iloc[-1]["market_close"].to_pydatetime() > now:
        raise ValueError("Calendar target is not a completed NYSE session")
    calendar = {"schema_version": "market-sessions-v1", "market": "US", "exchange": "XNYS",
                "provider": "pandas_market_calendars", "provider_version": mcal.__version__,
                "as_of_date": target.isoformat(), "range_start": start.isoformat(), "range_end": target.isoformat(),
                "sessions": sessions, "generated_at": now.isoformat(),
                "completed_session_close": schedule.iloc[-1]["market_close"].isoformat()}
    destination = root / "trading-calendar.json"
    # An authenticated input may already contain a similarly named file. Use
    # exclusive fresh staging, never overwrite or follow a fixed .tmp path.
    with NamedTemporaryFile(mode="w", encoding="utf-8", dir=root, prefix=".trading-calendar-", suffix=".tmp", delete=False) as output:
        temporary = Path(output.name)
        output.write(json.dumps(calendar, allow_nan=False, separators=(",", ":")))
        os.fchmod(output.fileno(), 0o644)  # Preserve ordinary public-asset readability.
    try:
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return calendar



def export_calendar_only(root: Path, evaluated_at: str):
    """Offline derivation for a candidate copy; never fetch or alter price evidence."""
    import pandas_market_calendars as mcal

    evaluated = datetime.fromisoformat(evaluated_at.replace("Z", "+00:00"))
    if evaluated.tzinfo is None or evaluated > datetime.now(timezone.utc):
        raise ValueError("Calendar derivation requires a fixed, nonfuture timezone-aware evaluation time")
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    market_day = manifest.get("markets", {}).get("US", {}).get("as_of_date")
    target_day = market_day or manifest.get("as_of_date")
    if market_day and manifest.get("as_of_date", market_day) != market_day:
        raise ValueError("Calendar manifest and US price dates disagree")
    target = date.fromisoformat(target_day)
    return export_session_calendar(root, manifest, mcal, target, evaluated)


def export_benchmark(root: Path):
    # Imports here keep validation tests independent from network dependencies.
    import pandas_market_calendars as mcal

    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    target = date.fromisoformat(manifest["as_of_date"])
    today = datetime.now(ZoneInfo("America/New_York")).date()
    if target > today:
        raise ValueError("Manifest as_of_date is in the future")
    export_session_calendar(root, manifest, mcal, target)
    import yfinance as yf
    start = target - timedelta(days=730)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=start, end_date=target)
    expected = [stamp.date().isoformat() for stamp in schedule.index]
    if not expected or expected[-1] != target.isoformat():
        raise ValueError("Manifest as_of_date is not a completed NYSE session")
    if schedule.iloc[-1]["market_close"].to_pydatetime() > datetime.now(timezone.utc):
        raise ValueError("Requested SPY session has not closed yet")
    frame = yf.download("SPY", start=start.isoformat(), end=(target + timedelta(days=1)).isoformat(),
                        auto_adjust=False, actions=False, threads=False, progress=False, timeout=30)
    if frame is None or frame.empty:
        raise ValueError("Yahoo/yfinance returned no SPY prices; no substitute was generated")
    if getattr(frame.columns, "nlevels", 1) > 1:
        # yf.download's single-ticker MultiIndex is (field, symbol).
        if "SPY" not in frame.columns.get_level_values(-1):
            raise ValueError("Provider returned an unexpected symbol")
        frame = frame.xs("SPY", axis=1, level=-1)
    bars = []
    for timestamp, row in frame.iterrows():
        if timestamp.tzinfo is not None:
            timestamp = timestamp.tz_convert("America/New_York")
        day = timestamp.date().isoformat()
        # Requested range is authoritative; never include data from later sessions.
        if day > target.isoformat():
            raise ValueError("Provider returned future bars beyond the requested snapshot")
        bars.append({"date": day, **{key.lower(): round(float(row[key]), 8) for key in ("Open", "High", "Low", "Close", "Volume")}})
    validate_bars(bars, expected, target.isoformat())
    result = {"schema_version": "book-benchmark-v1", "symbol": "SPY", "as_of_date": target.isoformat(),
              "generated_at": datetime.now(timezone.utc).isoformat(), "bars": bars,
              "source": {"provider": "Yahoo Finance via yfinance", "symbol": "SPY", "yfinance_version": yf.__version__},
              "adjustment": {"auto_adjust": False, "price_field": "Close", "dividend_total_return": False,
                             "note": "Provider OHLC without additional dividend adjustment; same auto_adjust=False policy as stock ingestion"},
              "calendar": {"name": "NYSE", "provider": "pandas_market_calendars", "version": mcal.__version__,
                           "exact_session_coverage": True, "start": expected[0], "end": expected[-1]}}
    destination = root / "book-benchmark.json"
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(destination)
    return {"path": str(destination), "as_of_date": result["as_of_date"], "bars": len(bars), "source": result["source"]}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "static-data")
    parser.add_argument("--allow-unavailable", action="store_true", help="Publish explicitly missing optional evidence instead of retaining an old benchmark")
    parser.add_argument("--calendar-only", action="store_true", help="Derive only offline exchange sessions on an unpublished candidate copy; never acquire prices")
    parser.add_argument("--evaluated-at", help="Fixed timezone-aware derivation timestamp, required for --calendar-only replay")
    args = parser.parse_args()
    if args.calendar_only:
        if not args.evaluated_at or args.allow_unavailable:
            parser.error("--calendar-only requires --evaluated-at and forbids --allow-unavailable")
        result = export_calendar_only(args.root, args.evaluated_at)
        print(json.dumps({"path": str(args.root / "trading-calendar.json"), "as_of_date": result["as_of_date"],
                          "sessions": len(result["sessions"]), "provider": result["provider"],
                          "provider_version": result["provider_version"], "generated_at": result["generated_at"]}))
        raise SystemExit(0)
    if args.evaluated_at:
        parser.error("--evaluated-at is only valid with --calendar-only")
    try:
        result = export_benchmark(args.root)
    except Exception as error:
        if not args.allow_unavailable:
            raise
        manifest = json.loads((args.root / "manifest.json").read_text(encoding="utf-8"))
        result = {"schema_version": "book-benchmark-v1", "symbol": "SPY", "as_of_date": manifest["as_of_date"],
                  "bars": [], "unavailable": True, "error": str(error), "generated_at": datetime.now(timezone.utc).isoformat()}
        destination = args.root / "book-benchmark.json"
        temporary = destination.with_suffix(".json.tmp")
        temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
        temporary.replace(destination)
        print(f"::warning::Optional SPY evidence unavailable: {error}")
    print(json.dumps(result, ensure_ascii=False))
