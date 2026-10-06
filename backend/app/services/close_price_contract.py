"""Offline close-session admission contracts; no scheduling or publication.

The required cohort must come from a separately pinned universe, never from
the rows that happened to download. This audit is necessary, not sufficient:
provider provenance, adjusted-history coherence and frontend/financial gates
remain independently required. A deadline is an operational target, not an SLA.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
import hashlib
import json
import math
from typing import Any


def _utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("An explicit timezone is required")
    return value.astimezone(timezone.utc)


def _instant(value: str) -> datetime:
    return _utc(datetime.fromisoformat(value.replace("Z", "+00:00")))


def _digest(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()).hexdigest()


@dataclass(frozen=True)
class CloseSession:
    session: date
    close_at: datetime
    collect_after: datetime
    deadline_at: datetime

    @classmethod
    def for_us(cls, session: date, calendar) -> CloseSession:
        close = calendar.session_close("US", session)
        if close is None:
            raise ValueError(f"{session} is not a US trading session")
        close = _utc(close)
        return cls(session, close, close + timedelta(minutes=5), close + timedelta(hours=1))

    def status(self, now: datetime) -> dict[str, Any]:
        now = _utc(now)
        return {
            "schema_version": "us-close-session-v1", "market": "US", "calendar": "XNYS",
            "session": self.session.isoformat(), "close_at": self.close_at.isoformat(),
            "collect_after": self.collect_after.isoformat(), "deadline_at": self.deadline_at.isoformat(),
            "eligible_to_collect": now >= self.collect_after,
            "deadline_exceeded": now > self.deadline_at,
            "remaining_seconds": max(0, int((self.deadline_at - now).total_seconds())),
        }


def audit_required_closes(
    *, bundle: dict[str, Any], manifest: dict[str, Any],
    required_cohort: dict[str, str], required_cohort_sha256: str,
    session: CloseSession, now: datetime, previous_session: date | None = None,
) -> dict[str, Any]:
    """Reject partial/incorrect date or identity before downstream admission.

    Callers must separately verify compressed bundle bytes against the manifest
    hash and verify the externally supplied cohort hash against a trusted pin.
    The generated clock is checked but is not relabeled as provider observation.
    """
    now = _utc(now)
    if now < session.collect_after:
        raise ValueError("Close collection window has not opened")
    if previous_session is not None and session.session < previous_session:
        raise ValueError("Session would regress the previous price publication")
    if not required_cohort or any(
        not isinstance(symbol, str) or not symbol or symbol != symbol.strip().upper()
        or not isinstance(exchange, str) or not exchange.strip()
        for symbol, exchange in required_cohort.items()
    ):
        raise ValueError("An explicit, nonempty required cohort with exchange identity is required")
    if _digest(required_cohort) != required_cohort_sha256:
        raise ValueError("Required cohort does not match its pinned identity")
    if bundle.get("schema_version") != "daily-price-bundle-v1" or manifest.get("schema_version") != "daily-price-manifest-v1":
        raise ValueError("Unsupported price contract")
    for key, expected in (("market", "US"), ("as_of_date", session.session.isoformat()), ("bar_period", "2y")):
        if bundle.get(key) != expected or manifest.get(key) != expected:
            raise ValueError(f"Price {key} does not match the target session")
    if not isinstance(bundle.get("source_revision"), str) or not bundle["source_revision"] or bundle["source_revision"] != manifest.get("source_revision"):
        raise ValueError("Bundle and manifest source identity disagree")
    if bundle.get("generated_at") != manifest.get("generated_at"):
        raise ValueError("Bundle and manifest clocks disagree")
    generated = _instant(bundle["generated_at"])
    if not session.collect_after <= generated <= now:
        raise ValueError("Price bundle clock is before collection or in the future")
    rows = bundle.get("rows")
    if not isinstance(rows, list):
        raise ValueError("Price rows are missing")
    by_symbol = {}
    for row in rows:
        if not isinstance(row, dict) or not isinstance(row.get("symbol"), str):
            raise ValueError("Invalid price row identity")
        symbol = row["symbol"]
        if symbol in by_symbol:
            raise ValueError(f"Duplicate price identity: {symbol}")
        by_symbol[symbol] = row
    missing = sorted(set(required_cohort) - set(by_symbol))
    if missing:
        raise ValueError(f"Required close cohort incomplete: {len(missing)} missing; {missing[:10]}")
    closes = []
    for symbol, exchange in sorted(required_cohort.items()):
        row = by_symbol[symbol]
        if row.get("exchange") != exchange:
            raise ValueError(f"Exchange identity changed: {symbol}")
        prices = row.get("prices")
        if not isinstance(prices, list) or not prices:
            raise ValueError(f"Required history missing: {symbol}")
        previous = None
        previous_close = None
        for bar in prices:
            day = date.fromisoformat(bar["date"])
            if (previous is not None and day <= previous) or day > session.session or day.weekday() >= 5:
                raise ValueError(f"Unordered, duplicate or future price date: {symbol}")
            previous = day
            values = [bar.get(key) for key in ("open", "high", "low", "close", "volume")]
            if any(type(value) not in (int, float) or not math.isfinite(value) for value in values):
                raise ValueError(f"Invalid OHLCV number: {symbol}")
            op, hi, lo, cl, volume = values
            if min(op, hi, lo, cl) <= 0 or volume < 0 or hi < max(op, lo, cl) or lo > min(op, cl):
                raise ValueError(f"Invalid OHLCV envelope: {symbol}")
            if previous_close is not None and not .55 < cl / previous_close < 1.8:
                raise ValueError(f"Unverified price adjustment continuity: {symbol}")
            previous_close = cl
        if previous != session.session:
            raise ValueError(f"Required close is stale: {symbol}")
        closes.append({"symbol": symbol, "exchange": exchange, "session": previous.isoformat(), "close": prices[-1]["close"]})
    return {
        **session.status(now), "required_cohort_sha256": required_cohort_sha256,
        "required_count": len(required_cohort), "fresh_count": len(closes),
        "source_revision": bundle["source_revision"], "close_observations_sha256": _digest(closes),
        "audit_scope": "required_close_date_identity_ohlcv_only",
    }
