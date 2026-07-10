"""Build a LONG-history price bundle for the tactics backtest (CI-only fetch).

The daily-price release carries 2 years of bars — enough for one tradable
year after indicator warmup, which cannot show the strategy's cycle value
(bear protection). This script fetches ``--period`` (default 6y) of daily
OHLCV for the committed ex-ETF >= $2B universe (plus SPY for the regime
engine) and writes a gzip bundle in the same row schema the backtest's
``load_panel`` reads. Yahoo egress exists only in GitHub Actions — run this
from ``backtest-tactics.yml``, which uploads the bundle to the
``daily-price-data`` release for offline reruns.
"""

from __future__ import annotations

import argparse
import gzip
import json
from datetime import datetime, timezone
from pathlib import Path

from app.scripts._runtime import prepare_runtime


def _read_universe(path: Path) -> list[str]:
    symbols = []
    for line in path.read_text().splitlines():
        line = line.strip().upper()
        if line and not line.startswith("#"):
            symbols.append(line)
    return symbols


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--universe-file", default="scripts/us_universe_full.txt")
    ap.add_argument("--period", default="6y")
    ap.add_argument("--output", required=True)
    args = ap.parse_args()

    prepare_runtime()
    from app.services.bulk_data_fetcher import BulkDataFetcher

    symbols = _read_universe(Path(args.universe_file))
    if "SPY" not in symbols:
        symbols.append("SPY")  # the regime engine needs the benchmark
    print(f"fetching {len(symbols)} symbols x {args.period}", flush=True)

    fetcher = BulkDataFetcher()
    results = fetcher.fetch_prices_in_batches(symbols, period=args.period, market="US")

    rows = []
    failed = 0
    for sym, payload in results.items():
        df = payload.get("price_data")
        if payload.get("has_error") or df is None or df.empty:
            failed += 1
            continue
        df = df.reset_index()
        date_col = "Date" if "Date" in df.columns else df.columns[0]
        adj = df["Adj Close"] if "Adj Close" in df.columns else df["Close"]
        rows.append({
            "symbol": sym,
            "prices": [
                {
                    "date": str(d)[:10],
                    "open": float(o), "high": float(h), "low": float(l),
                    "close": float(c), "adj_close": float(a),
                    "volume": int(v) if v == v else 0,
                }
                for d, o, h, l, c, a, v in zip(
                    df[date_col], df["Open"], df["High"], df["Low"],
                    df["Close"], adj, df["Volume"],
                )
                if c == c
            ],
        })

    bundle = {
        "schema_version": "backtest-price-bundle-v1",
        "bar_period": args.period,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "as_of_date": max((r["prices"][-1]["date"] for r in rows if r["prices"]), default=None),
        "symbol_count": len(rows),
        "failed_symbols": failed,
        "rows": rows,
    }
    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(gzip.compress(json.dumps(bundle, separators=(",", ":")).encode()))
    print(f"bundle: {len(rows)} symbols ({failed} failed) -> {out} "
          f"({out.stat().st_size / 1e6:.0f} MB, as_of {bundle['as_of_date']})", flush=True)
    return 0 if rows else 1


if __name__ == "__main__":
    raise SystemExit(main())
