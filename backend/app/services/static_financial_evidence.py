"""Metadata-only financial proof for public static artifacts.

This module never changes a scalar, scanner decision, database row or API. The
new browser may withhold current values using this compact, versioned result.
Python validates the original Python JSON digests; browsers do not recreate them.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone
import math
import re
from typing import Any, Mapping

from .financial_source_evidence import (
    ALIASES, FINANCIAL_FIELDS, SOURCE_POLICY, equal_value, source_timestamp,
    valid_value, validate_envelope,
)
from .security_master_service import security_master_resolver

VERSION = 1
QUARTER_MAX_AGE_DAYS = 190
ANNUAL_MAX_AGE_DAYS = 550
YEAR_GAP_DAYS = (345, 385)
REASON_CODES = {
    "0": "available", "1": "missing_or_invalid_value", "2": "missing_evidence",
    "3": "invalid_envelope", "4": "identity_mismatch", "5": "value_mismatch",
    "6": "future_source_timestamp", "7": "stale_source", "8": "unsupported_contract",
    "9": "invalid_reporting_period", "a": "stale_reporting_period",
    "b": "unverified_derivation_and_cohort", "c": "invalid_evaluation_context",
    "d": "alias_conflict", "e": "invalid_source_inputs",
}
METRICS = {"eps": ["Diluted EPS", "Basic EPS"], "sales": ["Total Revenue", "Operating Revenue"]}
_QUARTER_PRODUCER = "yfinance.quarterly_income_stmt/transport-capture-v1"
CONTRACTS = {
    "0": {"fields": ["eps_growth_qq", "sales_growth_qq"], "source": "yfinance", "producer": _QUARTER_PRODUCER,
          "basis": "quarterly_qoq/v1", "unit": "percent_points", "cadence": "quarterly", "quarter_gap_days": [70, 130],
          "period_count": [2, 2], "comparison": "quarter_over_quarter"},
    "1": {"fields": ["eps_growth_yy", "sales_growth_yy"], "source": "yfinance", "producer": _QUARTER_PRODUCER,
          "basis": "comparable_period_yoy/v1", "unit": "percent_points", "cadence": "quarterly", "quarter_gap_days": [70, 130],
          "period_count": [5, 5], "comparison": "quarter_year_over_year"},
    "2": {"fields": ["eps_q1_yoy", "eps_q2_yoy"], "source": "yfinance", "producer": _QUARTER_PRODUCER,
          "basis": "quarterly_eps_yoy/v1", "unit": "percent_points", "cadence": "quarterly", "quarter_gap_days": [70, 110],
          "period_count": [5, 5], "comparison": "quarter_year_over_year"},
    "3": {"fields": ["eps_5yr_cagr"], "source": "yfinance", "producer": "yfinance.income_stmt/transport-capture-v1",
          "basis": "annual_eps_cagr/v1", "unit": "percent_points", "cadence": "annual",
          "period_count": [2, 5], "comparison": "positive_annual_eps_cagr"},
}
_DERIVED = frozenset((*FINANCIAL_FIELDS[-4:], "eps_raw_score"))


def _day(value: Any) -> date | None:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def _clock(value: datetime | str) -> datetime | None:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc) if value.tzinfo is not None and value.utcoffset() is not None else None
    return source_timestamp(value)


def _ms(value: datetime) -> int:
    return math.floor(value.timestamp() * 1000)


def _finite(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _valid_value(field: str, value: Any) -> bool:
    try:
        return valid_value(field, value)
    except (ValueError, TypeError, OverflowError):
        return False


def _period(column: Any) -> date | None:
    """Only capture's explicit midnight statement columns, never year labels."""
    if not isinstance(column, str):
        return None
    if _day(column):
        return _day(column)
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})[ T]00:00:00(?:\.0+)?(?:\+00:00|Z)?", column)
    return _day(match[1]) if match else None


def _source_inputs(record: dict, captures: dict) -> tuple[list[date], dict[date, float]] | None:
    """Rebind arithmetic inputs to captured normalized and provider metric cells."""
    if not isinstance(captures, dict):
        return None
    capture = captures.get(record.get("capture_id"), {})
    if "source_payload" in record:
        subset = record["source_payload"]
    else:
        subset = capture.get("source_payload") if isinstance(capture, dict) else None
    if not isinstance(subset, dict) or subset.get("format") != "yfinance-income-selected-rows-v1":
        return None
    columns, rows = subset.get("columns"), subset.get("rows")
    if not isinstance(columns, list) or not isinstance(rows, list) or not 2 <= len(columns) <= 64:
        return None
    periods = [_period(column) for column in columns]
    if any(period is None for period in periods) or len(set(periods)) != len(periods):
        return None
    if any(left <= right for left, right in zip(periods, periods[1:])):
        return None
    matches = [row for row in rows if isinstance(row, dict) and row.get("metric") == record.get("metric")]
    if len(matches) != 1 or not isinstance(matches[0].get("values"), list) or len(matches[0]["values"]) != len(periods):
        return None
    cells = dict(zip(periods, matches[0]["values"]))
    metric_key = record["metric"].lower().replace(" ", "")
    source_rows = subset.get("source_rows")
    source = source_rows.get(metric_key) if isinstance(source_rows, dict) else None
    prefix = "annual" if record.get("cadence") == "annual" else "quarterly"
    if (not isinstance(source, dict) or not isinstance(source.get("provider_metric"), str)
            or source["provider_metric"].lower() != prefix + metric_key):
        return None
    currencies = source.get("currencies")
    # A ratio cannot silently compare differently denominated statement cells.
    if (not isinstance(currencies, list) or len(currencies) != 1
            or not isinstance(currencies[0], str) or not re.fullmatch(r"[A-Z]{3}", currencies[0])):
        return None
    values = source.get("values")
    if not isinstance(values, dict) or any(not equal_value(value, values.get(period.isoformat())) for period, value in cells.items() if value is not None):
        return None
    inputs = record.get("source_inputs")
    if not isinstance(inputs, list) or not inputs:
        return None
    for item in inputs:
        if not isinstance(item, dict):
            return None
        period = _day(item.get("period_end"))
        if period is None or _period(item.get("column")) != period or not _finite(item.get("value")) or not equal_value(item["value"], cells.get(period)):
            return None
    return periods, cells


def _statement_proof(field: str, record: dict, envelope: dict, *, now: datetime, as_of: date) -> tuple[str, list | None]:
    provider_identity = security_master_resolver.resolve_identity(symbol=record.get("provider_symbol"))
    if (provider_identity.canonical_symbol, provider_identity.market) != (envelope["symbol"], envelope["market"]):
        return "4", None
    contract_id = next((key for key, contract in CONTRACTS.items() if field in contract["fields"] and
                        all(record.get(name) == contract[name] for name in ("source", "producer", "basis", "unit", "cadence"))), None)
    if contract_id is None or record.get("provenance_kind") != "observed":
        return "8", None
    contract = CONTRACTS[contract_id]
    metric_type = "sales" if field.startswith("sales_") else "eps"
    if record.get("metric") not in METRICS[metric_type]:
        return "8", None
    observed = source_timestamp(record.get("observed_at"))
    if observed is None:
        return "3", None
    if observed > now:
        return "6", None
    if _ms(now) - _ms(observed) > SOURCE_POLICY["max_age_ms"]:
        return "7", None
    if record.get("period_status") != "supplied":
        return "9", None
    first, last = _day(record.get("period_end")), _day(record.get("comparable_period_end"))
    used = record.get("periods_used")
    if first is None or last is None or not isinstance(used, list) or not used or any(_day(value) is None for value in used):
        return "9", None
    parsed = _source_inputs(record, envelope.get("captures", {}))
    if parsed is None:
        return "e", None
    statement_periods, cells = parsed
    if first not in statement_periods or last not in statement_periods or first <= last:
        return "9", None
    start, end = statement_periods.index(first), statement_periods.index(last)
    chain = statement_periods[start:end + 1]
    minimum, maximum = contract["period_count"]
    if not minimum <= len(chain) <= maximum or any(period > as_of or period > now.date() or period > observed.date() for period in chain):
        return "9", None
    annual = contract_id == "3"
    low, high = YEAR_GAP_DAYS if annual else contract["quarter_gap_days"]
    if any(not low <= (left - right).days <= high for left, right in zip(chain, chain[1:])):
        return "9", None
    if contract_id in {"1", "2"} and not YEAR_GAP_DAYS[0] <= (first - last).days <= YEAR_GAP_DAYS[1]:
        return "9", None
    if used != [period.isoformat() for period in (chain if annual else [first, last])]:
        return "9", None
    # The original actual column positions are part of the reviewed EPS path.
    if contract_id == "2":
        positions = [0, 4] if field == "eps_q1_yoy" else [1, 5]
        if (record.get("column_positions") != positions or [start, end] != positions
                or record.get("statement_periods") != [period.isoformat() for period in chain]
                or record.get("statement_gap_days") != [(left-right).days for left, right in zip(chain, chain[1:])]
                or record.get("reference_gap_days") != (first-last).days):
            return "9", None
    elif start != 0 or (annual and chain != statement_periods[:5]):
        return "9", None
    max_age = ANNUAL_MAX_AGE_DAYS if annual else QUARTER_MAX_AGE_DAYS
    if (as_of - first).days > max_age or (now.date() - first).days > max_age:
        return "a", None
    expected_inputs = chain if annual else [first, last]
    if ([item["period_end"] for item in record["source_inputs"]] != [period.isoformat() for period in expected_inputs]
            or any(not _finite(cells[period]) for period in expected_inputs)):
        return "e", None
    recent, baseline = cells[first], cells[last]
    if record.get("rounding") != {"decimal_places": 2}:
        return "8", None
    if annual:
        if (record.get("algorithm") != "eps-rating-cagr-v1" or record.get("calculation_method") != "positive_cagr"
                or recent <= 0 or baseline < 0.01 or record.get("elapsed_years") != first.year - last.year):
            return "8", None
        expected = (pow(recent / baseline, 1 / (first.year - last.year)) - 1) * 100
    else:
        minimum_baseline = 0.01 if contract_id == "2" else 0.05 if metric_type == "eps" else 0.0
        expected_algorithm = "eps-rating-quarterly-yoy-v1" if contract_id == "2" else "growth-cadence-v1"
        if record.get("algorithm") != expected_algorithm or record.get("minimum_absolute_baseline") != minimum_baseline or abs(baseline) <= minimum_baseline:
            return "8", None
        if contract_id in {"0", "1"} and record.get("remapped_to_qq") is not False:
            return "8", None
        expected = ((recent - baseline) / abs(baseline)) * 100
    if contract_id in {"2", "3"}:
        if record.get("clipping") != {"minimum": -100.0, "maximum": 500.0}:
            return "8", None
        expected = max(-100.0, min(500.0, expected))
    if not equal_value(record["value"], round(expected, 2)):
        return "e", None
    period_expiry = _ms(datetime.combine(first + timedelta(days=max_age + 1), time.min, timezone.utc)) - 1
    expiry = min(_ms(observed) + SOURCE_POLICY["max_age_ms"], period_expiry)
    return "0", [deepcopy(record["value"]), contract_id, record["metric"], [period.isoformat() for period in chain], _ms(observed), expiry]


def build_static_financial_current(row: Mapping[str, Any], *, now: datetime | str,
                                   as_of_date: str, market: str | None = None) -> dict:
    """Certify supported static fields without projecting or mutating ``row``."""
    stamp, as_of = _clock(now), _day(as_of_date)
    symbol, resolved_market = row.get("symbol"), row.get("market") or market
    result = {"v": VERSION, "t": _ms(stamp) if stamp else None, "s": symbol,
              "m": resolved_market, "a": as_of_date, "r": "", "p": {}}
    context_ok = (stamp is not None and as_of is not None and as_of <= stamp.date()
                  and isinstance(symbol, str) and bool(symbol.strip())
                  and isinstance(resolved_market, str)
                  and security_master_resolver.normalize_market(resolved_market) == resolved_market)
    envelope = None
    envelope_reason = "2"
    if row.get("financial_source_evidence") is not None:
        try:
            envelope = validate_envelope(row["financial_source_evidence"])
            if not isinstance(envelope.get("captures", {}), dict):
                raise ValueError("Malformed capture container")
            if envelope.get("symbol") != symbol or envelope.get("market") != resolved_market:
                envelope, envelope_reason = None, "4"
        except (ValueError, TypeError, OverflowError, RecursionError, UnicodeError):
            envelope, envelope_reason = None, "3"
    reasons = []
    for index, field in enumerate(FINANCIAL_FIELDS):
        proof = None
        if field in _DERIVED:
            reason = "b"
        elif not context_ok:
            reason = "c"
        elif not _valid_value(field, row.get(field)):
            reason = "1"
        elif envelope is None:
            reason = envelope_reason
        else:
            record = envelope["fields"].get(field)
            if not isinstance(record, dict):
                reason = "2"
            elif not equal_value(row[field], record["value"]):
                reason = "5"
            elif any(alias in row and row[alias] is not None and not equal_value(row[alias], row[field]) for alias, canonical in ALIASES.items() if canonical == field):
                reason = "d"
            else:
                try:
                    reason, proof = _statement_proof(field, record, envelope, now=stamp, as_of=as_of)
                except (ValueError, TypeError, KeyError, OverflowError, ZeroDivisionError):
                    reason = "e"
        reasons.append(reason)
        if proof is not None:
            result["p"][str(index)] = proof
    result["r"] = "".join(reasons)
    return result


def add_static_financial_metadata(row: Mapping[str, Any] | None, *, now: datetime | str,
                                  as_of_date: str, market: str | None = None,
                                  symbol: str | None = None, include_reference: bool = True) -> dict | None:
    """Return an enriched copy. Every pre-existing scalar/classification survives."""
    if row is None:
        return None
    output = deepcopy(dict(row))
    context = dict(row)
    if "symbol" not in context and symbol is not None:
        context["symbol"] = symbol
    output["financial_current"] = build_static_financial_current(context, now=now, as_of_date=as_of_date, market=market)
    if include_reference:
        # Unknown units stay absent. Original evidence is retained separately;
        # copying legacy scalars here never certifies them or changes their unit.
        output["financial_reference"] = {
            "v": VERSION, "s": context.get("symbol"), "m": context.get("market") or market, "a": as_of_date,
            "values": {field: deepcopy(row[field]) for field in (*FINANCIAL_FIELDS, *ALIASES) if field in row},
        }
    return output


def subset_static_financial_current(summary: dict, row: Mapping[str, Any]) -> dict:
    """Carry proof into narrower group exports without introducing raw fields."""
    result = deepcopy(summary)
    reasons = list(result["r"])
    for index, field in enumerate(FINANCIAL_FIELDS):
        key = str(index)
        proof = result["p"].get(key)
        if not _valid_value(field, row.get(field)):
            reasons[index] = "b" if field in _DERIVED else "1"
            result["p"].pop(key, None)
        elif proof is not None and not equal_value(proof[0], row[field]):
            reasons[index] = "5"
            result["p"].pop(key, None)
    result["r"] = "".join(reasons)
    return result
