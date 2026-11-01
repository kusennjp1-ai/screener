"""Plan the US universe from the official listing directory with continuity.

The weekly US reference universe used to be whatever Finviz's screener
returned. The NASDAQ Trader symbol directory is the official replacement, but
switching sources must not churn identities that downstream gates pin:

* a symbol that is still listed keeps its prior name, classification and,
  when it now trades on a venue the Market Catalog does not model (NYSE Arca,
  Cboe BZX, TXSE), its prior exchange identity. Finviz recorded Arca and BZX
  ETFs as NYSE/AMEX, and the daily price cohort compares exchange identity;
* a genuine move between NYSE, NASDAQ and NYSE American is applied;
* new listings are added only as common stock, ADRs, ETFs or ETNs on those
  three exchanges, because only they resolve to a supported US MIC;
* a prior symbol the directory no longer lists is reported for removal. The
  ingest reconciliation policy, not this planner, decides whether to apply it.

This module is pure: it only transforms its inputs and reports what it did.
"""

from __future__ import annotations

from dataclasses import dataclass
import re
from typing import Any, Mapping

from .us_listing_directory import EQUITY_EXCHANGES, UsListingDirectory

CORE_EXCHANGE_MICS = {"NYSE": "XNYS", "NASDAQ": "XNAS", "AMEX": "XASE"}
_MIC_ALIASES = {**CORE_EXCHANGE_MICS, **{mic: mic for mic in CORE_EXCHANGE_MICS.values()}}
NEW_LISTING_CLASSES = frozenset({"common", "adr", "etf", "etn"})
EXAMPLES = 25

_NAME_SUFFIX_RE = re.compile(
    r"\s+-?\s*(?:(?:Class|Series) [A-Z0-9]+\s+)?"
    r"(?:Common Stock|Common Shares|Ordinary Shares|Subordinate Voting Shares)"
    r"(?:,?\s+(?:par value|no par value)[^,]*)?$",
    re.IGNORECASE,
)


def clean_listing_name(name: str) -> str:
    """Drop the security-type suffix the directory appends to issuer names."""
    cleaned = _NAME_SUFFIX_RE.sub("", (name or "").strip()).strip(" -")
    return cleaned or (name or "").strip()


def core_mic(exchange: Any) -> str | None:
    if not isinstance(exchange, str):
        return None
    return _MIC_ALIASES.get(exchange.strip().upper())


@dataclass(frozen=True)
class PlannedUniverseRow:
    symbol: str
    name: str
    exchange: str  # canonical US MIC
    sector: str
    industry: str
    market_cap: float | None
    security_class: str
    is_etf: bool
    change: str  # "kept" or "added"

    def as_ingest_row(self) -> dict[str, Any]:
        return {
            "symbol": self.symbol,
            "name": self.name,
            "exchange": self.exchange,
            "sector": self.sector,
            "industry": self.industry,
            "market_cap": self.market_cap,
            "security_class": self.security_class,
            "is_etf": self.is_etf,
        }


@dataclass(frozen=True)
class UsUniversePlan:
    rows: tuple[PlannedUniverseRow, ...]
    removed: tuple[str, ...]
    report: dict[str, Any]


def _count(values) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        counts[value] = counts.get(value, 0) + 1
    return dict(sorted(counts.items()))


def plan_us_universe(
    directory: UsListingDirectory,
    prior_rows: Mapping[str, Mapping[str, Any]],
) -> UsUniversePlan:
    """Merge the official directory with the prior active universe."""
    listings = directory.by_symbol()
    rows: list[PlannedUniverseRow] = []
    moves: dict[str, list[str]] = {}
    kept_identity: dict[str, list[str]] = {}
    skipped: dict[str, list[str]] = {}
    unresolvable_prior: list[str] = []

    for symbol, listing in listings.items():
        prior = prior_rows.get(symbol)
        if listing.security_class == "test":
            continue
        if prior is not None:
            prior_mic = core_mic(prior.get("exchange"))
            official_mic = core_mic(listing.exchange)
            if official_mic is not None:
                mic = official_mic
                if prior_mic is not None and prior_mic != official_mic:
                    moves.setdefault(f"{prior_mic}->{official_mic}", []).append(symbol)
            elif prior_mic is not None:
                mic = prior_mic
                kept_identity.setdefault(listing.exchange, []).append(symbol)
            else:
                unresolvable_prior.append(symbol)
                continue
            rows.append(PlannedUniverseRow(
                symbol=symbol,
                name=str(prior.get("name") or "").strip() or clean_listing_name(listing.name),
                exchange=mic,
                sector=str(prior.get("sector") or "").strip(),
                industry=str(prior.get("industry") or "").strip(),
                market_cap=prior.get("market_cap") if isinstance(prior.get("market_cap"), (int, float)) else None,
                security_class=listing.security_class,
                is_etf=listing.is_etf,
                change="kept",
            ))
            continue
        if listing.exchange not in EQUITY_EXCHANGES:
            skipped.setdefault(f"new_{listing.security_class}_on_{listing.exchange}", []).append(symbol)
            continue
        if listing.security_class not in NEW_LISTING_CLASSES:
            skipped.setdefault(f"new_{listing.security_class}", []).append(symbol)
            continue
        rows.append(PlannedUniverseRow(
            symbol=symbol,
            name=clean_listing_name(listing.name),
            exchange=CORE_EXCHANGE_MICS[listing.exchange],
            sector="",
            industry="",
            market_cap=None,
            security_class=listing.security_class,
            is_etf=listing.is_etf,
            change="added",
        ))

    removed = sorted(symbol for symbol in prior_rows if symbol not in listings
                     or listings[symbol].security_class == "test")
    removed.extend(sorted(unresolvable_prior))
    added = [row for row in rows if row.change == "added"]
    report = {
        "source": "nasdaq_trader_symbol_directory",
        "file_created_at": dict(directory.file_created_at),
        "prior_active": len(prior_rows),
        "planned_active": len(rows),
        "kept": len(rows) - len(added),
        "added": len(added),
        "added_by_class": _count(row.security_class for row in added),
        "added_by_exchange": _count(row.exchange for row in added),
        "added_examples": sorted(row.symbol for row in added)[:EXAMPLES],
        "removed": len(removed),
        "removed_examples": removed[:EXAMPLES],
        "exchange_moves": {pair: {"count": len(symbols), "examples": sorted(symbols)[:EXAMPLES]}
                           for pair, symbols in sorted(moves.items())},
        "kept_prior_identity_on_unmodelled_venue": {venue: len(symbols) for venue, symbols in sorted(kept_identity.items())},
        "skipped_new_listings": {reason: len(symbols) for reason, symbols in sorted(skipped.items())},
        "unresolvable_prior_identity": sorted(unresolvable_prior)[:EXAMPLES],
        "duplicate_directory_symbols": list(directory.duplicate_symbols),
    }
    return UsUniversePlan(rows=tuple(sorted(rows, key=lambda row: row.symbol)), removed=tuple(removed), report=report)


def prior_rows_from_universe(rows) -> dict[str, dict[str, Any]]:
    """Index active StockUniverse-like rows (ORM objects or dicts) by symbol."""
    indexed: dict[str, dict[str, Any]] = {}
    for row in rows:
        get = row.get if isinstance(row, Mapping) else (lambda key, _row=row: getattr(_row, key, None))
        symbol = get("symbol")
        if isinstance(symbol, str) and symbol:
            indexed[symbol] = {key: get(key) for key in ("exchange", "name", "sector", "industry", "market_cap")}
    return indexed



# ---------------------------------------------------------------------------
# Weekly snapshot assembly for the official US universe.
# ---------------------------------------------------------------------------

FUND_CLASSES = frozenset({"etf", "etn"})
# Facts that do not go stale. Everything else must come from this run's fetch
# or stay unknown; time-varying values are never carried from a prior bundle.
IMMUTABLE_CARRY_FIELDS = ("ipo_date", "first_trade_date")


def is_fund(row: PlannedUniverseRow | None) -> bool:
    return row is not None and (row.is_etf or row.security_class in FUND_CLASSES)


def fund_reference_payload(*, symbol: str, name: str, sector: str, industry: str) -> dict[str, Any]:
    """Reference-only row for a fund: identity and classification, no fundamentals."""
    return {
        "symbol": symbol,
        "company_name": name,
        "sector": sector or None,
        "industry": industry or None,
        "is_etf": True,
        "fundamentals_applicable": False,
        "reference_source": "nasdaq_trader_symbol_directory",
    }


def carry_immutable_fields(fresh: Mapping[str, Any], prior: Mapping[str, Any] | None) -> dict[str, Any]:
    payload = dict(fresh)
    carried = []
    for field in IMMUTABLE_CARRY_FIELDS:
        if payload.get(field) in (None, "") and prior and prior.get(field) not in (None, ""):
            payload[field] = prior[field]
            carried.append(field)
    if carried:
        payload["carried_immutable_fields"] = carried
    return payload


def us_snapshot_coverage(
    *,
    active_symbols: int,
    fund_symbols: int,
    fresh_equity_symbols: int,
    min_equity_coverage: float,
) -> tuple[dict[str, Any], list[str], bool]:
    """Coverage stats for the unchanged all-symbol gate plus a stricter equity gate.

    Funds carry reference rows, so they always count as covered. Without a
    separate equity check that would let fund rows mask missing company
    fundamentals, so operating companies must independently meet the same
    minimum coverage.
    """
    equities = max(active_symbols - fund_symbols, 0)
    covered = fresh_equity_symbols + fund_symbols
    equity_coverage = (fresh_equity_symbols / equities) if equities else 1.0
    stats = {
        "active_symbols": active_symbols,
        "snapshot_symbols": covered,
        "covered_active_symbols": covered,
        "missing_active_symbols": max(active_symbols - covered, 0),
        "fund_reference_symbols": fund_symbols,
        "equity_symbols": equities,
        "fresh_equity_symbols": fresh_equity_symbols,
        "equity_fundamentals_coverage": round(equity_coverage, 6),
        "min_equity_fundamentals_coverage": min_equity_coverage,
    }
    warnings: list[str] = []
    equity_ok = equity_coverage >= min_equity_coverage
    if not equity_ok:
        warnings.append(
            f"Equity fundamentals coverage {equity_coverage:.2%} below minimum {min_equity_coverage:.2%}"
        )
    return stats, warnings, equity_ok
