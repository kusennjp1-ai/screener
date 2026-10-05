"""Opt-in, pure selection of the two required US statement source pairs.

This is preparation for reviewed integration, not a runtime fetch path. It does
not call providers, retry, update a cache, or manufacture acquisition timestamps.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any, Mapping

from .financial_payload_boundary import reconcile_financial_selection
from .financial_source_evidence import (
    FINANCIAL_FIELDS, _audit_json, _digest, merge_financial_payloads,
)
from .static_financial_evidence import PROOF_REASON_CODES, build_static_financial_current

MANDATORY_STATEMENT_FIELDS = ("eps_growth_yy", "sales_growth_yy")


def _reasons(payload: Mapping[str, Any], *, symbol: str, market: str,
             now: datetime | str, as_of_date: str) -> dict[str, str]:
    # An explicit context can fill a missing header, never relabel a foreign
    # provider payload. Original observation identities remain untouched.
    context = {**payload, "symbol": symbol, "market": market}
    proof = build_static_financial_current(context, now=now, as_of_date=as_of_date)
    reasons = {field: proof["r"][FINANCIAL_FIELDS.index(field)]
               for field in MANDATORY_STATEMENT_FIELDS}
    if "c" in reasons.values():
        raise ValueError("An explicit valid symbol, market, evaluation time and as-of date are required")
    if any(payload.get(key) is not None and payload[key] != value
           for key, value in (("symbol", symbol), ("market", market))):
        return {field: "4" for field in MANDATORY_STATEMENT_FIELDS}
    return reasons


def mandatory_statement_refresh_fields(
    payload: Mapping[str, Any], *, symbol: str, market: str,
    now: datetime | str, as_of_date: str, us_mandatory_source_policy: bool = False,
) -> tuple[str, ...]:
    """Return only required US fields whose current statement source is absent.

    Disabled and non-US calls request nothing. The existing static evaluator
    owns source/period/contract validation, including its seven-day receipt and
    190-day quarterly-period policies. Both ``0`` and ``f`` mean acquired; ``f``
    stays ineligible for ordinary growth and must not cause a refresh loop.
    Unsupported derived scores are deliberately outside this query.
    """
    if not us_mandatory_source_policy or market != "US":
        return ()
    reasons = _reasons(payload, symbol=symbol, market=market, now=now, as_of_date=as_of_date)
    return tuple(field for field in MANDATORY_STATEMENT_FIELDS if reasons[field] not in PROOF_REASON_CODES)


def merge_mandatory_statement_payloads(
    primary: Mapping[str, Any], fallback: Mapping[str, Any], *,
    symbol: str, market: str, now: datetime | str, as_of_date: str,
    us_mandatory_source_policy: bool = False,
) -> dict:
    """Select from exactly two inputs; return scalars with their exact receipts.

    Disabled/non-US calls use the existing merge without semantic changes. For
    enabled US calls, a supported current primary wins, even over a newer valid
    fallback. Only a supported current fallback may replace a non-null unproved
    primary. If neither qualifies, normal raw reference values survive and the
    refresh query still reports the gap. All unrelated keys retain normal
    non-null-primary/fallback selection.

    The EPS annual alias follows the selected canonical scalar; original alias
    conflicts, losing candidates and source clocks remain in the boundary's
    archive. A scalar equality is never used to choose an evidence owner.
    """
    if not us_mandatory_source_policy or market != "US":
        return merge_financial_payloads(primary, fallback, symbol=symbol, market=market)

    primary_reasons = _reasons(primary, symbol=symbol, market=market, now=now, as_of_date=as_of_date)
    fallback_reasons = _reasons(fallback, symbol=symbol, market=market, now=now, as_of_date=as_of_date)
    selected = deepcopy(dict(primary))
    owners = {key: 0 for key in primary}
    for key, value in fallback.items():
        if selected.get(key) is None:
            selected[key] = deepcopy(value)
            owners[key] = 1
    selected["symbol"], selected["market"] = symbol, market

    for field in MANDATORY_STATEMENT_FIELDS:
        if primary_reasons[field] in PROOF_REASON_CODES:
            owner = 0
        elif fallback_reasons[field] in PROOF_REASON_CODES:
            owner = 1
        else:
            continue
        selected[field] = deepcopy((primary, fallback)[owner][field])
        owners[field] = owner
    if "eps_growth_yy" in selected:
        selected["eps_growth_annual"] = deepcopy(selected["eps_growth_yy"])
        owners["eps_growth_annual"] = owners["eps_growth_yy"]

    result = reconcile_financial_selection(selected, [primary, fallback], owners,
                                           symbol=symbol, market=market)
    # The generic merger archives scalar-bearing payload contexts. An alias-only
    # input needs its own diagnostic entry before synchronization discards it.
    # Use the same JSON audit encoding and content-addressed raw archive format;
    # this is original input context, never an observation or acquisition clock.
    for source in (primary, fallback):
        if "eps_growth_annual" in source and not any(field in source for field in FINANCIAL_FIELDS):
            original = _audit_json({"symbol": source.get("symbol", symbol),
                                    "market": source.get("market", market),
                                    "raw_alias_values": {"eps_growth_annual": source["eps_growth_annual"]},
                                    "source_clocks": {key: source.get(key) for key in (
                                        "yahoo_statements_refreshed_at", "yahoo_profile_refreshed_at", "finviz_snapshot_at")}})
            result["financial_source_evidence"]["retained_raw_envelopes"][_digest(original)] = original
    return result
