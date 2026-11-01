"""Compare the published US weekly reference universe with official listings.

Read-only diagnostic. It answers, with counts and examples, how the current
weekly bundle's US universe (historically built from Finviz) relates to the
NASDAQ Trader symbol directory and, when supplied, SEC
``company_tickers_exchange.json`` and the daily price ``required_cohort``:

* which bundle symbols the official directory still lists, and as what class;
* which symbols changed exchange identity;
* which listings are new since the bundle;
* which protected cohort members would be affected by a switch.

Standard library only, so it runs before any backend dependency install.
"""

from __future__ import annotations

import argparse
import gzip
import json
from pathlib import Path
from typing import Any

from app.services.us_listing_directory import UsListing, parse_directory

# Same aliases as app/scripts/stage_daily_price_source.py::exchange.
EXCHANGE_TO_MIC = {
    "NYSE": "XNYS",
    "NASDAQ": "XNAS",
    "AMEX": "XASE",
    "NYSEARCA": "ARCX",
    "NYSE ARCA": "ARCX",
    "ARCA": "ARCX",
    "BATS": "BATS",
    "IEX": "IEXG",
}
EXAMPLES = 25


def mic(value: Any) -> str | None:
    if not isinstance(value, str) or not value.strip():
        return None
    normalized = value.strip().upper()
    return EXCHANGE_TO_MIC.get(normalized, normalized)


def read_json(path: Path) -> Any:
    raw = path.read_bytes()
    if raw[:2] == b"\x1f\x8b":
        raw = gzip.decompress(raw)
    return json.loads(raw)


def _count(values) -> dict[str, int]:
    counts: dict[str, int] = {}
    for value in values:
        key = str(value)
        counts[key] = counts.get(key, 0) + 1
    return dict(sorted(counts.items(), key=lambda item: (-item[1], item[0])))


def _examples(symbols) -> list[str]:
    return sorted(symbols)[:EXAMPLES]


def bundle_universe(bundle: dict[str, Any]) -> dict[str, dict[str, Any]]:
    rows = bundle.get("universe")
    if not isinstance(rows, list):
        raise ValueError("Weekly reference bundle has no universe list")
    universe: dict[str, dict[str, Any]] = {}
    for row in rows:
        symbol = row.get("symbol")
        if isinstance(symbol, str) and symbol and row.get("is_active", True):
            universe[symbol] = row
    return universe


def sec_exchange_by_ticker(payload: dict[str, Any]) -> dict[str, str]:
    fields = payload.get("fields")
    data = payload.get("data")
    if fields != ["cik", "name", "ticker", "exchange"] or not isinstance(data, list):
        raise ValueError("Unexpected company_tickers_exchange.json shape")
    result: dict[str, str] = {}
    for _cik, _name, ticker, exchange in data:
        if isinstance(ticker, str) and ticker:
            result[ticker.upper().replace(".", "-")] = str(exchange or "")
    return result


def compare(
    *,
    bundle: dict[str, Any],
    nasdaq_listed: str,
    other_listed: str,
    sec_tickers: dict[str, Any] | None = None,
    daily_manifest: dict[str, Any] | None = None,
) -> dict[str, Any]:
    directory = parse_directory(nasdaq_listed=nasdaq_listed, other_listed=other_listed)
    official = directory.by_symbol()
    universe = bundle_universe(bundle)

    def official_class(symbol: str) -> str:
        listing = official.get(symbol)
        return "missing" if listing is None else f"{listing.exchange}:{listing.security_class}"

    present = [symbol for symbol in universe if symbol in official]
    missing = [symbol for symbol in universe if symbol not in official]
    exchange_changes: dict[str, list[str]] = {}
    for symbol in present:
        before, after = mic(universe[symbol].get("exchange")), mic(official[symbol].exchange)
        if before != after:
            exchange_changes.setdefault(f"{before}->{after}", []).append(symbol)
    candidates = {listing.symbol: listing for listing in directory.listings if listing.is_equity_candidate}
    new_candidates = [symbol for symbol in candidates if symbol not in universe]

    report: dict[str, Any] = {
        "bundle": {
            "as_of_date": bundle.get("as_of_date"),
            "generated_at": bundle.get("generated_at"),
            "source_revision": bundle.get("source_revision"),
            "active_universe": len(universe),
            "by_exchange": _count(mic(row.get("exchange")) for row in universe.values()),
            "snapshot_rows": len((bundle.get("snapshot") or {}).get("rows") or []),
        },
        "official": {
            "file_created_at": directory.file_created_at,
            "listings": len(directory.listings),
            "equity_candidates": len(candidates),
            "by_exchange_class": directory.class_counts(),
            "duplicate_symbols": list(directory.duplicate_symbols),
        },
        "bundle_vs_official": {
            "bundle_symbols_by_official_class": _count(official_class(symbol) for symbol in universe),
            "missing_from_official": len(missing),
            "missing_examples": _examples(missing),
            "exchange_changes": {pair: {"count": len(symbols), "examples": _examples(symbols)}
                                 for pair, symbols in sorted(exchange_changes.items(), key=lambda item: -len(item[1]))},
            "new_equity_candidates": len(new_candidates),
            "new_candidates_by_exchange": _count(candidates[symbol].exchange for symbol in new_candidates),
            "new_candidate_examples": [
                {"symbol": symbol, "exchange": candidates[symbol].exchange, "name": candidates[symbol].name}
                for symbol in _examples(new_candidates)
            ],
        },
    }
    if sec_tickers is not None:
        sec = sec_exchange_by_ticker(sec_tickers)
        report["sec"] = {
            "tickers": len(sec),
            "by_exchange": _count(sec.values()),
            "equity_candidates_in_sec": sum(1 for symbol in candidates if symbol in sec),
            "equity_candidates_not_in_sec": _examples(symbol for symbol in candidates if symbol not in sec),
            "missing_bundle_symbols_sec_exchange": _count(sec.get(symbol, "absent") for symbol in missing),
        }
    if daily_manifest is not None:
        cohort = daily_manifest.get("required_cohort")
        if isinstance(cohort, dict) and cohort:
            changed = [symbol for symbol, identity in cohort.items()
                       if symbol in official and mic(official[symbol].exchange) != mic(identity)]
            absent = [symbol for symbol in cohort if symbol not in official]
            report["required_cohort"] = {
                "members": len(cohort),
                "by_official_class": _count(official_class(symbol) for symbol in cohort),
                "absent_from_official": len(absent),
                "absent_examples": _examples(absent),
                "exchange_identity_changes": len(changed),
                "exchange_change_examples": _examples(changed),
                "absent_from_bundle": len([symbol for symbol in cohort if symbol not in universe]),
            }
        else:
            report["required_cohort"] = {"members": 0, "note": "manifest has no required_cohort"}
    return report


def markdown(report: dict[str, Any]) -> str:
    bundle, official, diff = report["bundle"], report["official"], report["bundle_vs_official"]
    lines = [
        "## US reference source comparison",
        "",
        f"- Bundle as_of_date: `{bundle['as_of_date']}`; active universe {bundle['active_universe']}; snapshot rows {bundle['snapshot_rows']}",
        f"- Official directory created: `{official['file_created_at']}`; listings {official['listings']}; equity candidates {official['equity_candidates']}",
        f"- Bundle symbols missing from official: {diff['missing_from_official']}",
        f"- New official equity candidates not in bundle: {diff['new_equity_candidates']}",
        "",
        "```json",
        json.dumps(report, indent=1, sort_keys=False)[:60000],
        "```",
    ]
    return "\n".join(lines) + "\n"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--bundle", type=Path, required=True)
    parser.add_argument("--nasdaq-listed", type=Path, required=True)
    parser.add_argument("--other-listed", type=Path, required=True)
    parser.add_argument("--sec-tickers-exchange", type=Path)
    parser.add_argument("--daily-price-manifest", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--summary", type=Path)
    args = parser.parse_args(argv)

    report = compare(
        bundle=read_json(args.bundle),
        nasdaq_listed=args.nasdaq_listed.read_text(encoding="utf-8", errors="replace"),
        other_listed=args.other_listed.read_text(encoding="utf-8", errors="replace"),
        sec_tickers=read_json(args.sec_tickers_exchange) if args.sec_tickers_exchange else None,
        daily_manifest=read_json(args.daily_price_manifest) if args.daily_price_manifest else None,
    )
    args.output.write_text(json.dumps(report, indent=1) + "\n", encoding="utf-8")
    summary = markdown(report)
    if args.summary:
        with args.summary.open("a", encoding="utf-8") as handle:
            handle.write(summary)
    print(summary)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
