"""Parse the NASDAQ Trader symbol directory into classified US listings.

NASDAQ Trader publishes two pipe-delimited files that together list every
security traded on US exchanges: ``nasdaqlisted.txt`` (Nasdaq-listed) and
``otherlisted.txt`` (NYSE, NYSE American, NYSE Arca, Cboe BZX and IEX).
Both end with a ``File Creation Time: MMDDYYYYHH:MM`` trailer, which is the
source's own as-of time.

This module is deliberately standard-library only and side-effect free so the
same code can classify fixtures offline, compare sources in CI, and feed the
universe ingest. Classification never guesses silently: every listing gets a
``security_class`` and, when it is not an operating-company equity, a
``reason``.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import re
from typing import Iterable

NASDAQ_LISTED_HEADER = (
    "Symbol",
    "Security Name",
    "Market Category",
    "Test Issue",
    "Financial Status",
    "Round Lot Size",
    "ETF",
    "NextShares",
)
OTHER_LISTED_HEADER = (
    "ACT Symbol",
    "Security Name",
    "Exchange",
    "CQS Symbol",
    "ETF",
    "Round Lot Size",
    "Test Issue",
    "NASDAQ Symbol",
)

# otherlisted.txt exchange codes (NASDAQ Trader symbol directory definitions).
OTHER_LISTED_EXCHANGES = {
    "N": "NYSE",
    "A": "AMEX",  # NYSE American, historically AMEX; the repo alias is XASE.
    "P": "NYSEARCA",
    "Z": "BATS",
    "V": "IEX",
    "TXSE": "TXSE",  # Texas Stock Exchange, listed in the directory since 2026.
}

# The equity universe has always been NYSE, NASDAQ and NYSE American.
EQUITY_EXCHANGES = frozenset({"NYSE", "NASDAQ", "AMEX"})

_TRAILER_RE = re.compile(r"^File Creation Time:\s*(\d{2})(\d{2})(\d{4})(\d{2}):(\d{2})")
_CANONICAL_SYMBOL_RE = re.compile(r"^[A-Z][A-Z0-9]{0,14}(?:-[A-Z0-9]{1,4})?$")
_SPECIAL_SYMBOL_CHARS = frozenset("$^=+#*!/")
# ACT/CQS suffixes that denote a derivative or non-common line.
_DERIVATIVE_SUFFIXES = {
    "WS": "warrant",
    "W": "warrant",
    "U": "unit",
    "R": "right",
    "RT": "right",
    "WI": "when_issued",
    "WD": "when_distributed",
}

_NAME_RULES: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("preferred", re.compile(r"\bpreferred\b|\bpfd\b|\bpreference shares?\b", re.I)),
    ("warrant", re.compile(r"\bwarrants?\b", re.I)),
    ("right", re.compile(r"\brights?\b", re.I)),
    ("note", re.compile(r"\bnotes?\b|\bdebentures?\b|\bbonds?\b|\bsubordinated\b|\bbaby bonds?\b", re.I)),
    ("contingent_value_right", re.compile(r"\bcontingent value\b", re.I)),
    ("etn", re.compile(r"\bETNs?\b|\bexchange[- ]traded notes?\b", re.I)),
)
_UNIT_RE = re.compile(r"\bunits?\b", re.I)
# Partnership common units are the listed equity of MLPs, not SPAC units.
_EQUITY_UNIT_RE = re.compile(r"\bcommon units?\b|\blimited partner(?:ship)?\b|\bpartnership units?\b", re.I)
_ADR_RE = re.compile(r"\bamerican depositary\b|\bADS\b|\bADRs?\b", re.I)


@dataclass(frozen=True)
class UsListing:
    """One classified line of the NASDAQ Trader symbol directory."""

    symbol: str
    source_symbol: str
    name: str
    exchange: str
    source_file: str
    security_class: str
    reason: str | None = None
    is_etf: bool = False
    financial_status: str | None = None
    market_category: str | None = None

    @property
    def is_equity_candidate(self) -> bool:
        """True for operating-company equity (common stock or ADR) on a core exchange."""
        return self.security_class in {"common", "adr"} and self.exchange in EQUITY_EXCHANGES


@dataclass(frozen=True)
class UsListingDirectory:
    listings: tuple[UsListing, ...]
    file_created_at: dict[str, str]
    duplicate_symbols: tuple[str, ...]

    def by_symbol(self) -> dict[str, UsListing]:
        return {listing.symbol: listing for listing in self.listings}

    def class_counts(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for listing in self.listings:
            key = f"{listing.exchange}:{listing.security_class}"
            counts[key] = counts.get(key, 0) + 1
        return dict(sorted(counts.items()))


def _parse_trailer(line: str) -> str:
    match = _TRAILER_RE.match(line.strip())
    if not match:
        raise ValueError("Missing NASDAQ Trader 'File Creation Time' trailer")
    month, day, year, hour, minute = (int(part) for part in match.groups())
    # NASDAQ Trader stamps files in US Eastern time; keep the naive local value.
    return datetime(year, month, day, hour, minute).isoformat(timespec="minutes")


def _split_rows(text: str, header: tuple[str, ...], source_file: str) -> tuple[list[dict[str, str]], str]:
    lines = [line for line in text.replace("\r\n", "\n").split("\n") if line.strip()]
    if len(lines) < 2:
        raise ValueError(f"{source_file} is empty or truncated")
    columns = tuple(part.strip() for part in lines[0].split("|"))
    if columns != header:
        raise ValueError(f"Unexpected {source_file} header: {columns!r}")
    created_at = _parse_trailer(lines[-1])
    rows: list[dict[str, str]] = []
    for number, line in enumerate(lines[1:-1], start=2):
        parts = line.split("|")
        if len(parts) != len(header):
            raise ValueError(f"{source_file} line {number} has {len(parts)} fields, expected {len(header)}")
        rows.append({column: value.strip() for column, value in zip(header, parts)})
    return rows, created_at


def _classify_name(name: str) -> tuple[str, str] | None:
    for security_class, pattern in _NAME_RULES:
        if pattern.search(name):
            return security_class, f"security name matches {security_class}"
    if _UNIT_RE.search(name) and not _EQUITY_UNIT_RE.search(name):
        return "unit", "security name matches unit"
    return None


def _canonicalize_act_symbol(raw: str) -> tuple[str | None, tuple[str, str] | None]:
    """Return (canonical symbol, exclusion) for an ACT/CQS style symbol."""
    symbol = raw.strip().upper()
    if not symbol:
        return None, ("invalid", "missing symbol")
    if any(char in _SPECIAL_SYMBOL_CHARS for char in symbol):
        return None, ("preferred_or_special", f"special symbol character in {symbol!r}")
    if "." in symbol:
        base, _, suffix = symbol.partition(".")
        derivative = _DERIVATIVE_SUFFIXES.get(suffix)
        if derivative:
            return None, (derivative, f"symbol suffix .{suffix}")
        symbol = f"{base}-{suffix}"
    if not _CANONICAL_SYMBOL_RE.match(symbol):
        return None, ("invalid", f"non-canonical symbol {symbol!r}")
    return symbol, None


def _listing(
    *,
    raw_symbol: str,
    symbol: str | None,
    exclusion: tuple[str, str] | None,
    name: str,
    exchange: str,
    source_file: str,
    is_etf: bool,
    is_test: bool,
    financial_status: str | None = None,
    market_category: str | None = None,
) -> UsListing:
    security_class, reason = "common", None
    if is_test:
        security_class, reason = "test", "test issue flag"
    elif exclusion:
        security_class, reason = exclusion
    elif is_etf:
        security_class, reason = "etf", "ETF flag"
    else:
        by_name = _classify_name(name)
        if by_name:
            security_class, reason = by_name
        elif _ADR_RE.search(name):
            security_class = "adr"
    if security_class == "etn":
        is_etf = True
    return UsListing(
        symbol=symbol or raw_symbol.strip().upper(),
        source_symbol=raw_symbol.strip(),
        name=name,
        exchange=exchange,
        source_file=source_file,
        security_class=security_class,
        reason=reason,
        is_etf=is_etf,
        financial_status=financial_status,
        market_category=market_category,
    )


def parse_nasdaq_listed(text: str) -> tuple[list[UsListing], str]:
    rows, created_at = _split_rows(text, NASDAQ_LISTED_HEADER, "nasdaqlisted.txt")
    listings = []
    for row in rows:
        raw = row["Symbol"]
        symbol, exclusion = _canonicalize_act_symbol(raw)
        listings.append(
            _listing(
                raw_symbol=raw,
                symbol=symbol,
                exclusion=exclusion,
                name=row["Security Name"],
                exchange="NASDAQ",
                source_file="nasdaqlisted.txt",
                is_etf=row["ETF"] == "Y" or row["NextShares"] == "Y",
                is_test=row["Test Issue"] == "Y",
                financial_status=row["Financial Status"] or None,
                market_category=row["Market Category"] or None,
            )
        )
    return listings, created_at


def parse_other_listed(text: str) -> tuple[list[UsListing], str]:
    rows, created_at = _split_rows(text, OTHER_LISTED_HEADER, "otherlisted.txt")
    listings = []
    for row in rows:
        raw = row["ACT Symbol"]
        code = row["Exchange"]
        exchange = OTHER_LISTED_EXCHANGES.get(code)
        symbol, exclusion = _canonicalize_act_symbol(raw)
        if exchange is None:
            # A new venue must not silently join the equity universe, and must
            # not abort the whole directory either: keep it visible and counted.
            exchange = f"UNKNOWN:{code}"
            exclusion = exclusion or ("unknown_exchange", f"unknown otherlisted.txt exchange code {code!r}")
        listings.append(
            _listing(
                raw_symbol=raw,
                symbol=symbol,
                exclusion=exclusion,
                name=row["Security Name"],
                exchange=exchange,
                source_file="otherlisted.txt",
                is_etf=row["ETF"] == "Y",
                is_test=row["Test Issue"] == "Y",
            )
        )
    return listings, created_at


def parse_directory(*, nasdaq_listed: str, other_listed: str) -> UsListingDirectory:
    """Parse both files; a symbol present twice is kept once and reported."""
    nasdaq, nasdaq_created = parse_nasdaq_listed(nasdaq_listed)
    other, other_created = parse_other_listed(other_listed)
    seen: dict[str, UsListing] = {}
    duplicates: list[str] = []
    for listing in [*nasdaq, *other]:
        if listing.symbol in seen:
            duplicates.append(listing.symbol)
            continue
        seen[listing.symbol] = listing
    return UsListingDirectory(
        listings=tuple(sorted(seen.values(), key=lambda listing: listing.symbol)),
        file_created_at={"nasdaqlisted.txt": nasdaq_created, "otherlisted.txt": other_created},
        duplicate_symbols=tuple(sorted(set(duplicates))),
    )


def equity_candidates(directory: UsListingDirectory) -> list[UsListing]:
    return [listing for listing in directory.listings if listing.is_equity_candidate]


def summarize(listings: Iterable[UsListing]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for listing in listings:
        counts[listing.security_class] = counts.get(listing.security_class, 0) + 1
    return dict(sorted(counts.items()))
