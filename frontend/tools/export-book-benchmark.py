#!/usr/bin/env python3
"""Export real, dated SPY OHLCV for independent book RS evidence.

Dependencies: yfinance, pandas_market_calendars. Never creates sample prices or
substitutes a stale/calibration series when the provider is unavailable.

A failed re-request keeps an already-present file only when it is the same
session's validated series (same as_of_date, every NYSE session, last bar on
that date). Another day's file is never kept: the result is then unavailable.
"""
from __future__ import annotations

import argparse
from datetime import date, datetime, time, timedelta, timezone
import json
import math
import os
from pathlib import Path
from tempfile import NamedTemporaryFile
import time as clock_time
from zoneinfo import ZoneInfo

NEW_YORK = ZoneInfo("America/New_York")
# --allow-unavailable: when no same-session file can be kept, retry this many
# times at this spacing (90 minutes) before writing the explicit unavailable file.
UNAVAILABLE_RETRIES = 9
UNAVAILABLE_RETRY_SECONDS = 600
# --target: an early request is retried at this spacing only until this New York
# time on the target date. Yahoo returned invalid SPY series from 20:00 ET on
# the measured November 2026 days, so the early request stops before that.
EARLY_RETRY_SECONDS = 900
EARLY_RETRY_DEADLINE_ET = time(19, 45)


class ProviderUnavailable(ValueError):
    """The provider gave no valid SPY series this time; a later request may succeed."""


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


def completed_sessions(mcal, target: date, now: datetime):
    """The two-year NYSE sessions ending at target, which must be a closed session."""
    start = target - timedelta(days=730)
    schedule = mcal.get_calendar("NYSE").schedule(start_date=start, end_date=target)
    expected = [stamp.date().isoformat() for stamp in schedule.index]
    if not expected or expected[-1] != target.isoformat():
        raise ValueError("Manifest as_of_date is not a completed NYSE session")
    if schedule.iloc[-1]["market_close"].to_pydatetime() > now:
        raise ValueError("Requested SPY session has not closed yet")
    return start, expected


def fetch_benchmark(target: date, mcal, yf, now: datetime | None = None):
    """One provider request for the closed session target; returns the validated payload.

    Calendar preconditions raise ValueError. Anything wrong with the provider's
    answer raises ProviderUnavailable, the only failure worth requesting again.
    """
    now = now or datetime.now(timezone.utc)
    start, expected = completed_sessions(mcal, target, now)
    try:
        frame = yf.download("SPY", start=start.isoformat(), end=(target + timedelta(days=1)).isoformat(),
                            auto_adjust=False, actions=False, threads=False, progress=False, timeout=30)
    except Exception as error:
        raise ProviderUnavailable(f"Yahoo/yfinance request failed: {type(error).__name__}: {error}") from error
    if frame is None or frame.empty:
        raise ProviderUnavailable("Yahoo/yfinance returned no SPY prices; no substitute was generated")
    try:
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
    except (ValueError, KeyError, TypeError, AttributeError) as error:
        raise ProviderUnavailable(str(error)) from error
    return {"schema_version": "book-benchmark-v1", "symbol": "SPY", "as_of_date": target.isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(), "bars": bars,
            "source": {"provider": "Yahoo Finance via yfinance", "symbol": "SPY", "yfinance_version": yf.__version__},
            "adjustment": {"auto_adjust": False, "price_field": "Close", "dividend_total_return": False,
                           "note": "Provider OHLC without additional dividend adjustment; same auto_adjust=False policy as stock ingestion"},
            "calendar": {"name": "NYSE", "provider": "pandas_market_calendars", "version": mcal.__version__,
                         "exact_session_coverage": True, "start": expected[0], "end": expected[-1]}}


def write_benchmark(destination: Path, result):
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False, separators=(",", ":")), encoding="utf-8")
    temporary.replace(destination)


def summary_of(destination: Path, result):
    return {"path": str(destination), "as_of_date": result["as_of_date"], "bars": len(result["bars"]), "source": result["source"]}


def export_benchmark(root: Path, *, yf=None, now: datetime | None = None):
    # Imports here keep validation tests independent from network dependencies.
    import pandas_market_calendars as mcal

    now = now or datetime.now(timezone.utc)
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    target = date.fromisoformat(manifest["as_of_date"])
    if target > now.astimezone(NEW_YORK).date():
        raise ValueError("Manifest as_of_date is in the future")
    export_session_calendar(root, manifest, mcal, target, now)
    if yf is None:
        import yfinance as yf
    result = fetch_benchmark(target, mcal, yf, now)
    destination = root / "book-benchmark.json"
    write_benchmark(destination, result)
    return summary_of(destination, result)


def same_session_benchmark(raw: bytes | None, as_of_date: str, expected):
    """(payload, reason): the payload only when raw is this same session's validated SPY series."""
    if raw is None:
        return None, "no existing book-benchmark.json"
    try:
        payload = json.loads(raw)
    except (ValueError, UnicodeDecodeError):
        return None, "existing book-benchmark.json is not JSON"
    if not isinstance(payload, dict) or payload.get("schema_version") != "book-benchmark-v1" or payload.get("symbol") != "SPY":
        return None, "existing book-benchmark.json is not a book-benchmark-v1 SPY payload"
    if payload.get("as_of_date") != as_of_date:
        return None, f"existing book-benchmark.json is for {payload.get('as_of_date')}, not {as_of_date}"
    if "unavailable" in payload:
        return None, "existing book-benchmark.json is itself unavailable"
    if not isinstance(payload.get("bars"), list):
        return None, "existing book-benchmark.json has no bar list"
    try:
        validate_bars(payload["bars"], expected, as_of_date)
    except (ValueError, KeyError, TypeError) as error:
        return None, f"existing same-session book-benchmark.json fails validation: {error}"
    return payload, "validated"


def report(text, log=print):
    """A log line, repeated in the job summary when one is available."""
    log(text)
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if path:
        try:
            with open(path, "a", encoding="utf-8") as summary:
                summary.write((text.split("::", 2)[2] if text.startswith("::") else text) + "\n\n")
        except OSError:
            pass  # A summary is a convenience; the log line above is the record.


def bar_text(bar):
    return " ".join(f"{key} {bar.get(key)}" for key in ("date", "open", "high", "low", "close", "volume"))


def compare_same_session(raw: bytes | None, fresh, log=print):
    """Compare a fresh request with the same-session file it replaces. Logging only; never changes the result."""
    try:
        previous = json.loads(raw) if raw is not None else None
    except (ValueError, UnicodeDecodeError):
        return None
    if (not isinstance(previous, dict) or previous.get("as_of_date") != fresh["as_of_date"]
            or not isinstance(previous.get("bars"), list) or not previous["bars"] or not isinstance(previous["bars"][-1], dict)):
        return None
    fields = ("date", "open", "high", "low", "close", "volume")
    old, new = previous["bars"][-1], fresh["bars"][-1]
    differing = [key for key in fields if old.get(key) != new.get(key)]
    by_date = {bar.get("date"): bar for bar in previous["bars"] if isinstance(bar, dict)}
    common = [bar for bar in fresh["bars"] if bar["date"] in by_date]
    changed = sum(1 for bar in common if any(by_date[bar["date"]].get(key) != bar.get(key) for key in fields))
    source = previous.get("source") if isinstance(previous.get("source"), dict) else {}
    text = (f"SPY same-session comparison {fresh['as_of_date']}: last bar {'identical' if not differing else 'differs in ' + ', '.join(differing)}; "
            f"earlier file (generated {previous.get('generated_at')}, yfinance {source.get('yfinance_version')}): {bar_text(old)}; "
            f"fresh request (generated {fresh['generated_at']}, yfinance {fresh['source']['yfinance_version']}): {bar_text(new)}; "
            f"{changed} of {len(common)} common bars differ. The fresh series is written.")
    report(("::warning::" if differing else "") + text, log)
    return {"last_bar_identical": not differing, "differing_fields": differing, "changed_bars": changed, "common_bars": len(common)}


def write_unavailable(root: Path, as_of_date, error, log=print):
    result = {"schema_version": "book-benchmark-v1", "symbol": "SPY", "as_of_date": as_of_date,
              "bars": [], "unavailable": True, "error": str(error), "generated_at": datetime.now(timezone.utc).isoformat()}
    destination = root / "book-benchmark.json"
    temporary = destination.with_suffix(".json.tmp")
    temporary.write_text(json.dumps(result, ensure_ascii=False, allow_nan=False), encoding="utf-8")
    temporary.replace(destination)
    log(f"::warning::Optional SPY evidence unavailable: {error}")
    return result


def export_or_unavailable(root: Path, *, yf=None, clock=None, sleep=clock_time.sleep,
                          retries=UNAVAILABLE_RETRIES, interval=UNAVAILABLE_RETRY_SECONDS, log=print):
    """--allow-unavailable: request SPY; after a provider failure keep this same session's validated
    file unchanged, or else retry and finally write the explicit unavailable file. Never another day's file."""
    clock = clock or (lambda: datetime.now(timezone.utc))
    destination = root / "book-benchmark.json"
    # Read before any request: a successful request replaces this file.
    try:
        existing = destination.read_bytes()
    except FileNotFoundError:
        existing = None
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    as_of_date = manifest["as_of_date"]
    try:
        import pandas_market_calendars as mcal
        now = clock()
        target = date.fromisoformat(as_of_date)
        if target > now.astimezone(NEW_YORK).date():
            raise ValueError("Manifest as_of_date is in the future")
        export_session_calendar(root, manifest, mcal, target, now)
        _, expected = completed_sessions(mcal, target, now)
        if yf is None:
            import yfinance as yf
    except Exception as error:
        return write_unavailable(root, as_of_date, error, log)
    attempt = 0
    while True:
        try:
            result = fetch_benchmark(target, mcal, yf, clock())
            break
        except ProviderUnavailable as error:
            if attempt == 0:
                kept, reason = same_session_benchmark(existing, as_of_date, expected)
                if kept is not None:
                    source = kept.get("source") if isinstance(kept.get("source"), dict) else {}
                    report(f"::warning::SPY re-request failed ({error}); kept this same session's validated SPY unchanged "
                           f"({as_of_date}, generated {kept.get('generated_at')}, yfinance {source.get('yfinance_version')}, {len(kept['bars'])} bars).", log)
                    return {"path": str(destination), "as_of_date": as_of_date, "bars": len(kept["bars"]), "source": kept.get("source"),
                            "retained_same_session": True, "generated_at": kept.get("generated_at"), "request_error": str(error)}
                log(f"No same-session SPY file can be kept: {reason}.")
            if attempt >= retries:
                return write_unavailable(root, as_of_date, error, log)
            attempt += 1
            log(f"::warning::SPY request failed ({error}); retry {attempt} of {retries} in {interval} s.")
            sleep(interval)
        except Exception as error:
            return write_unavailable(root, as_of_date, error, log)
    compare_same_session(existing, result, log)
    write_benchmark(destination, result)
    return summary_of(destination, result)


def prefetch_benchmark(target: date, output: Path, *, yf=None, clock=None, sleep=clock_time.sleep,
                       interval=EARLY_RETRY_SECONDS, deadline: datetime | None = None, log=print):
    """Manifest-free early request for the closed NYSE session target, written to output.

    Retries provider failures until the deadline (19:45 New York time on target by
    default). Writes nothing unless the series validates; never touches a static-data root.
    """
    import pandas_market_calendars as mcal
    if yf is None:
        import yfinance as yf
    clock = clock or (lambda: datetime.now(timezone.utc))
    deadline = deadline or datetime.combine(target, EARLY_RETRY_DEADLINE_ET, tzinfo=NEW_YORK)
    attempt = 1
    while True:
        try:
            result = fetch_benchmark(target, mcal, yf, clock())
            break
        except ProviderUnavailable as error:
            if clock() + timedelta(seconds=interval) > deadline:
                raise ProviderUnavailable(f"{error} (request {attempt}; no retry after {deadline.isoformat()})") from error
            log(f"::warning::Early SPY request {attempt} failed ({error}); retry in {interval} s (until {deadline.isoformat()}).")
            attempt += 1
            sleep(interval)
    output.parent.mkdir(parents=True, exist_ok=True)
    write_benchmark(output, result)
    return {**summary_of(output, result), "requests": attempt, "generated_at": result["generated_at"]}


def place_prefetched(root: Path, source: Path, *, clock=None, log=print):
    """Place an early SPY file byte for byte, only when it validates for this manifest's session
    and no book-benchmark.json exists yet. Returns whether it was placed."""
    import pandas_market_calendars as mcal
    clock = clock or (lambda: datetime.now(timezone.utc))
    destination = root / "book-benchmark.json"
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    as_of_date = manifest["as_of_date"]
    raw = source.read_bytes()
    if destination.exists():
        reason = "book-benchmark.json already exists"
    else:
        try:
            _, expected = completed_sessions(mcal, date.fromisoformat(as_of_date), clock())
        except ValueError as error:
            kept, reason = None, str(error)
        else:
            kept, reason = same_session_benchmark(raw, as_of_date, expected)
        if kept is not None:
            temporary = destination.with_suffix(".json.tmp")
            temporary.write_bytes(raw)
            temporary.replace(destination)
            report(f"Placed the early SPY benchmark for {as_of_date} (generated {kept.get('generated_at')}, {len(kept['bars'])} bars); "
                   "the export request replaces it on success and keeps it after a provider failure.", log)
            return True
    report(f"Early SPY benchmark not placed: {reason}.", log)
    return False


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[1] / "public" / "static-data")
    parser.add_argument("--allow-unavailable", action="store_true", help="Publish explicitly missing optional evidence instead of retaining an old benchmark; only the same session's validated file is kept")
    parser.add_argument("--calendar-only", action="store_true", help="Derive only offline exchange sessions on an unpublished candidate copy; never acquire prices")
    parser.add_argument("--evaluated-at", help="Fixed timezone-aware derivation timestamp, required for --calendar-only replay")
    parser.add_argument("--target", help="Early manifest-free request for the closed NYSE session YYYY-MM-DD; requires --output")
    parser.add_argument("--output", type=Path, help="File written by --target, only when the series validates")
    parser.add_argument("--place", type=Path, help="Place an early --target file into --root only when it validates for the manifest's session")
    args = parser.parse_args()
    if args.calendar_only:
        if not args.evaluated_at or args.allow_unavailable or args.target or args.output or args.place:
            parser.error("--calendar-only requires --evaluated-at and forbids --allow-unavailable, --target, --output and --place")
        result = export_calendar_only(args.root, args.evaluated_at)
        print(json.dumps({"path": str(args.root / "trading-calendar.json"), "as_of_date": result["as_of_date"],
                          "sessions": len(result["sessions"]), "provider": result["provider"],
                          "provider_version": result["provider_version"], "generated_at": result["generated_at"]}))
        raise SystemExit(0)
    if args.evaluated_at:
        parser.error("--evaluated-at is only valid with --calendar-only")
    if args.target or args.output:
        if not (args.target and args.output) or args.allow_unavailable or args.place:
            parser.error("--target and --output go together and forbid --allow-unavailable and --place")
        try:
            target = date.fromisoformat(args.target)
        except ValueError:
            parser.error("--target must be YYYY-MM-DD")
        try:
            result = prefetch_benchmark(target, args.output)
        except Exception as error:
            print(f"::warning::Early SPY benchmark unavailable for {args.target}: {error}")
            raise SystemExit(1)
        print(json.dumps(result, ensure_ascii=False))
        raise SystemExit(0)
    if args.place:
        if args.allow_unavailable:
            parser.error("--place forbids --allow-unavailable")
        print(json.dumps({"placed": place_prefetched(args.root, args.place)}))
        raise SystemExit(0)
    result = export_or_unavailable(args.root) if args.allow_unavailable else export_benchmark(args.root)
    print(json.dumps(result, ensure_ascii=False))
