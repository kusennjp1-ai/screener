"""Security-type classification — distinguishing ETFs/funds from common stocks.

The authoritative signal is the data source's own type field (Finviz exposes a
"Type" column; some feeds set "ETF"/"Fund"). When that is present we trust it.
When it is absent (manual adds, older snapshots) we fall back to a name/symbol
heuristic so an ETF-excluded universe stays clean.

Used by the universe ingestion (to populate ``StockUniverse.is_etf``) and by the
Markets 360 screener demo to filter a fixture universe.
"""
from __future__ import annotations

from typing import Optional

# Source "Type" values that mean "not a common stock".
_FUND_SOURCE_TYPES = {"etf", "fund", "etn", "etc", "closed-end fund", "mutual fund", "trust"}

# Issuer / product tokens that almost always indicate an ETF/ETN/fund. Matched
# as whole words (case-insensitive) against the security name.
_FUND_NAME_TOKENS = (
    "etf", "etn", "ishares", "spdr", "invesco qqq", "proshares", "vanguard",
    "direxion", "wisdomtree", "vaneck", "ark ", "global x", "first trust",
    "index fund", "index trust", "select sector", "bond fund", "ucits",
)

# A small curated set of well-known ETF/fund symbols, used as a backstop when no
# name/type is available (e.g. the screener demo's fixture universe).
_KNOWN_ETF_SYMBOLS = {
    "SPY", "QQQ", "IWM", "DIA", "VOO", "VTI", "IBB", "XBI", "SMH", "SOXX",
    "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLI", "XLU", "XLB", "XLRE",
    "GLD", "SLV", "USO", "TLT", "HYG", "LQD", "EEM", "EFA", "ARKK", "ARKG",
    "GDX", "GDXJ", "KWEB", "FXI", "VEA", "VWO", "AGG", "BND", "VUG", "VTV",
}


def classify_is_etf(
    symbol: Optional[str],
    name: Optional[str] = None,
    source_type: Optional[str] = None,
) -> bool:
    """Return True if the security looks like an ETF/ETN/fund rather than a stock.

    Precedence: explicit source type -> name tokens -> known-symbol backstop.
    """
    if source_type:
        st = source_type.strip().lower()
        if st in _FUND_SOURCE_TYPES:
            return True
        if st in ("stock", "common stock", "equity", "share", "ordinary shares"):
            return False
        if "etf" in st or "fund" in st or "etn" in st:
            return True

    if name:
        low = f" {name.lower()} "
        for tok in _FUND_NAME_TOKENS:
            if tok in low:
                return True

    if symbol and symbol.strip().upper() in _KNOWN_ETF_SYMBOLS:
        return True

    return False
