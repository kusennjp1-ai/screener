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
from pathlib import Path
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


def export_benchmark(root: Path):
    # Imports here keep validation tests independent from network dependencies.
    import pandas_market_calendars as mcal
    import yfinance as yf

    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    target = date.fromisoformat(manifest["as_of_date"])
    today = datetime.now(ZoneInfo("America/New_York")).date()
    if target > today:
        raise ValueError("Manifest as_of_date is in the future")
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
    args = parser.parse_args()
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
