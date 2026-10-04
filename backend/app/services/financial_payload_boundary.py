"""Preserve adapter-specific scalar choices while reconciling shadow evidence.

The core merger deliberately has one strict scalar/identity contract. Adapters
with key-existence or dict.update semantics select their values first, then use
that merger only to archive sources and bind evidence to each actual owner.
"""
from __future__ import annotations

from copy import deepcopy
from typing import Any, Mapping

from .financial_source_evidence import FINANCIAL_FIELDS, merge_financial_payloads
from .security_master_service import security_master_resolver

EVIDENCE = "financial_source_evidence"


def _identity(symbol: str | None, market: str | None) -> tuple[str | None, str | None]:
    if not symbol or (market and security_master_resolver.normalize_market(market) is None):
        raise ValueError("Unsupported shadow identity")
    resolved = security_master_resolver.resolve_identity(symbol=symbol, market=market)
    return resolved.canonical_symbol, resolved.market


def reconcile_financial_selection(
    selected: Mapping[str, Any], sources: list[Mapping[str, Any]], owners: Mapping[str, int],
    *, symbol: str | None = None, market: str | None = None,
) -> dict:
    """Return selected scalars unchanged, retaining every source's raw evidence.

    ``owners`` maps selected financial keys to their source index. Identity
    normalization applies to temporary payload headers only, never observations.
    Rejected identities keep their original envelope as unverified diagnostics.
    """
    result = dict(selected)
    symbol = symbol or selected.get("symbol") or next((s.get("symbol") for s in sources if s.get("symbol")), None)
    market = market or selected.get("market") or next((s.get("market") for s in sources if s.get("market")), None)
    try:
        identity = _identity(symbol, market)
        supported = True
    except Exception:
        identity, supported = (symbol, market), False

    def normalized(source):
        owner = deepcopy(dict(source))
        try:
            if not supported or _identity(owner.get("symbol") or symbol, owner.get("market") or market) != identity:
                raise ValueError("Different or unsupported shadow identity")
        except Exception:
            owner[EVIDENCE] = {
                "unverified_adapter_identity": {"symbol": source.get("symbol"), "market": source.get("market")},
                "rejected_source_envelope": source.get(EVIDENCE),
            }
        owner["symbol"], owner["market"] = identity
        return owner

    normalized_sources = [normalized(source) for source in sources]
    archived: dict = {}
    chosen: dict = {}
    for index, source in enumerate(normalized_sources):
        archived = merge_financial_payloads(source, archived, symbol=identity[0], market=identity[1])
        owned = dict(source)
        for field in FINANCIAL_FIELDS:
            if owners.get(field) != index:
                owned.pop(field, None)
        chosen = merge_financial_payloads(owned, chosen, symbol=identity[0], market=identity[1])
    envelope = archived[EVIDENCE]
    envelope["fields"] = chosen[EVIDENCE]["fields"]
    # Force reconciliation against the exact final scalars and aliases, including
    # present None and conflicting aliases supplied by different providers.
    envelope.pop("raw_values", None)
    proof_input = {**result, "symbol": identity[0], "market": identity[1], EVIDENCE: envelope}
    result[EVIDENCE] = merge_financial_payloads(proof_input, {}, symbol=identity[0], market=identity[1])[EVIDENCE]
    return result


def overlay_financial_payload(
    target: Mapping[str, Any], incoming: Mapping[str, Any], *, missing_only: bool = False,
    skip_none: bool = True, symbol: str | None = None, market: str | None = None,
) -> dict:
    """Apply the adapter's exact per-key overlay and reconcile its chosen owners."""
    selected = dict(target)
    owners = {key: 0 for key in target}
    for key, value in incoming.items():
        if key == EVIDENCE or (skip_none and value is None) or (missing_only and key in target):
            continue
        selected[key] = value
        owners[key] = 1
    return reconcile_financial_selection(selected, [target, incoming], owners, symbol=symbol, market=market)
