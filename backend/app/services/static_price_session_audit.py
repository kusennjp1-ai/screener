"""Independent, conservative prices-only coverage over emitted daily bars.

This checks the approved ohlcv-v1 predicate before nullable current observations
can shrink a later consumer's current-liquid view. It never fetches or repairs.
"""
from __future__ import annotations

from datetime import date
from hashlib import sha256
import json
import math
from numbers import Real
from typing import Any

MINIMUM_PRICE_USD = 10
MINIMUM_ADV_USD = 20_000_000
MINIMUM_COVERAGE = 0.9
AUDIT_VERSION = "ohlcv-v1"


def _number(value: Any) -> bool:
    if isinstance(value, bool) or not isinstance(value, Real):
        return False
    try:
        return math.isfinite(value)
    except (OverflowError, TypeError, ValueError):
        return False


def _positive(value: Any) -> bool:
    return _number(value) and value > 0


def _date(value: Any) -> date | None:
    if not isinstance(value, str) or len(value) != 10:
        return None
    try:
        parsed = date.fromisoformat(value)
        return parsed if parsed.isoformat() == value else None
    except ValueError:
        return None


def liquid_price_observation(row: dict[str, Any]) -> bool:
    return (_number(row.get("current_price")) and row["current_price"] >= MINIMUM_PRICE_USD
            and _number(row.get("adv_usd")) and row["adv_usd"] >= MINIMUM_ADV_USD)


def audit_price_history(row: dict[str, Any], payload: Any, as_of_date: str) -> dict[str, Any]:
    """Match the unchanged approved auditDailyBars validity predicate."""
    errors: list[str] = []
    if _date(as_of_date) is None:
        errors.append("invalid_analysis_date")
    if not isinstance(payload, dict):
        errors.append("missing_history")
        payload = {}
    elif payload.get("symbol") != row.get("symbol") or payload.get("as_of_date") != as_of_date:
        errors.append("identity_or_date_mismatch")
    bars = payload.get("bars")
    bars = bars if isinstance(bars, list) else []
    if len(bars) < 252:
        errors.append("insufficient_sessions")
    malformed = False
    discontinuity = False
    for index, bar in enumerate(bars):
        if not isinstance(bar, dict):
            malformed = True
            continue
        parsed = _date(bar.get("date"))
        prices = [bar.get(key) for key in ("open", "high", "low", "close")]
        previous = bars[index - 1] if index else None
        if (parsed is None or parsed.weekday() >= 5 or not isinstance(as_of_date, str) or bar.get("date", "") > as_of_date
                or not all(_positive(value) for value in prices)
                or not _number(bar.get("volume")) or bar.get("volume", -1) < 0):
            malformed = True
        elif bar["high"] < max(bar["open"], bar["close"], bar["low"]) or bar["low"] > min(bar["open"], bar["close"]):
            malformed = True
        if previous is not None:
            if not isinstance(previous, dict) or not isinstance(previous.get("date"), str) or not isinstance(bar.get("date"), str):
                malformed = True
            elif bar["date"] <= previous["date"]:
                malformed = True
            if isinstance(previous, dict) and _positive(previous.get("close")) and _positive(bar.get("close")):
                ratio = bar["close"] / previous["close"]
                if ratio >= 1.8 or ratio <= 0.55:
                    discontinuity = True
    if malformed:
        errors.append("invalid_order_date_or_ohlcv")
    last = bars[-1] if bars and isinstance(bars[-1], dict) else {}
    if last.get("date") != as_of_date:
        errors.append("final_session_mismatch")
    if discontinuity:
        errors.append("price_discontinuity")
    price = row.get("current_price")
    if (not _positive(price) or not _positive(last.get("close"))
            or abs(price - last["close"]) > max(0.02, price * 0.0001)):
        errors.append("scan_close_mismatch")
    try:
        digest = sha256(json.dumps(bars, allow_nan=False, sort_keys=True,
                                   separators=(",", ":")).encode("utf-8")).hexdigest()
    except (TypeError, ValueError):
        digest = None
    valid = not errors
    values: dict[str, Any] = {}
    if valid:
        values = {
            "current_price": last["close"],
            "adv_usd": sum(bar["close"] * bar["volume"] for bar in bars[-50:]) / 50,
        }
    return {"version": AUDIT_VERSION, "symbol": row.get("symbol"), "as_of_date": as_of_date,
            "bars": len(bars), "bars_sha256": digest, "errors": errors, "valid": valid, "values": values}


def build_price_session_audit(
    *, rows: list[dict[str, Any]], charts: dict[str, Any], market: str,
    price_as_of_date: str, feature_run_id: int, feature_as_of_date: str,
) -> dict[str, Any]:
    """All source stocks are diagnosed; known required failures remain counted.

    Valid emitted bars may prove that a formerly liquid stock really exited the
    unchanged price/ADV thresholds. Failed current observations cannot do so.
    """
    if market != "US":
        raise ValueError("The approved USD liquidity coverage audit is US-only")
    if _date(price_as_of_date) is None or _date(feature_as_of_date) is None or price_as_of_date < feature_as_of_date:
        raise ValueError("Invalid price/feature session identity")
    if isinstance(feature_run_id, bool) or not isinstance(feature_run_id, int) or feature_run_id < 1:
        raise ValueError("Invalid published feature-run identity")
    symbols = [row.get("symbol") for row in rows]
    if (not symbols or any(not isinstance(symbol, str) or not symbol.strip() for symbol in symbols)
            or len(set(symbols)) != len(symbols)):
        raise ValueError("Empty or duplicate published stock universe")
    records = []
    for row in sorted(rows, key=lambda value: value["symbol"]):
        baseline = row.get("feature_price_snapshot")
        if (not isinstance(baseline, dict) or baseline.get("role") != "published_export_baseline"
                or baseline.get("feature_run_id") != feature_run_id
                or baseline.get("feature_as_of_date") != feature_as_of_date):
            raise ValueError("Missing or mismatched baseline price facts: " + row["symbol"])
        for facts in (row, baseline):
            for field in ("current_price", "adv_usd"):
                value = facts.get(field)
                if value is not None and not _number(value):
                    raise ValueError("Non-numeric liquidity input: " + row["symbol"] + "/" + field)
        observed = audit_price_history(row, charts.get(row["symbol"]), price_as_of_date)
        baseline_liquid = liquid_price_observation(baseline)
        current_liquid = liquid_price_observation(row)
        verified_price_liquid = observed["valid"] and liquid_price_observation(observed["values"])
        required = verified_price_liquid if observed["valid"] else (current_liquid or baseline_liquid)
        records.append({**observed, "baseline_liquid": baseline_liquid, "current_liquid": current_liquid,
                        "verified_price_liquid": verified_price_liquid, "required": required})
    required = [record for record in records if record["required"]]
    verified = sum(record["valid"] for record in required)
    universe_bytes = json.dumps(sorted(symbols), separators=(",", ":")).encode("utf-8")
    required_bytes = json.dumps([record["symbol"] for record in required], separators=(",", ":")).encode("utf-8")
    reasons: dict[str, int] = {}
    for record in required:
        for reason in record["errors"]:
            reasons[reason] = reasons.get(reason, 0) + 1
    return {
        "schema_version": "static-price-session-audit-v1", "audit_version": AUDIT_VERSION,
        "market": market, "as_of_date": price_as_of_date, "feature_run_id": feature_run_id,
        "feature_as_of_date": feature_as_of_date,
        "source_universe_count": len(symbols), "source_universe_sha256": sha256(universe_bytes).hexdigest(),
        "required_symbols_sha256": sha256(required_bytes).hexdigest(),
        "liquidity": {"min_price_usd": MINIMUM_PRICE_USD, "min_average_dollar_volume": MINIMUM_ADV_USD},
        "minimum_target": MINIMUM_COVERAGE, "total": len(required), "verified": verified,
        "unverified_current_histories": sum(not record["valid"] for record in records),
        "passed": bool(required) and verified / len(required) >= MINIMUM_COVERAGE,
        "policy": "fail_before_consumer_mutation_or_vendor_rescue",
        "reasons": reasons, "results": records,
    }


def require_price_session_coverage(audit: dict[str, Any]) -> None:
    total, verified = audit.get("total"), audit.get("verified")
    valid_counts = (isinstance(total, int) and not isinstance(total, bool) and total > 0
                    and isinstance(verified, int) and not isinstance(verified, bool)
                    and 0 <= verified <= total)
    passed = valid_counts and verified / total >= MINIMUM_COVERAGE
    if (audit.get("schema_version") != "static-price-session-audit-v1"
            or audit.get("minimum_target") != MINIMUM_COVERAGE
            or audit.get("passed") is not True or not passed):
        raise ValueError(
            f"Prices-only verification below 90%: {verified or 0}/{total or 0}. "
            "Keep the last good publication; repair the source without relaxing coverage."
        )
