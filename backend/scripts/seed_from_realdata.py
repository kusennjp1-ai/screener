#!/usr/bin/env python3
"""Seed the local DB (stock_universe + stock_prices) from realdata/ CSVs.

Turns the per-symbol OHLCV CSVs that ``fetch_us_universe.py`` writes into a
fully scannable local deployment: one ``stock_universe`` row per symbol
(ETF-classified via ``security_type.classify_is_etf``) and the full daily bar
history bulk-upserted into ``stock_prices`` through the price cache's own
batch writer — the exact write path the ingestion service uses, so the scan
read path (DB-first, cache-only manual scans) works with zero network.

Names/market caps are enriched from the NASDAQ screener API when reachable;
offline it degrades to symbol-only rows (still scannable).

    DATABASE_URL=postgresql://user:pass@localhost/stockscanner \
    PYTHONPATH=. python3 scripts/seed_from_realdata.py --data-dir realdata
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path
from typing import Dict, Optional, Tuple

import pandas as pd

sys.path.insert(0, str(Path(__file__).resolve().parent))
from markets360_band_calibration import _read_csv  # noqa: E402

BENCH_STEM = "spy"


def _fetch_screener_meta() -> Dict[str, Tuple[str, Optional[float]]]:
    """{SYMBOL: (name, market_cap)} from the NASDAQ screener; {} offline."""
    try:
        import requests

        r = requests.get(
            "https://api.nasdaq.com/api/screener/stocks",
            params={"tableonly": "true", "limit": "10000"},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=60,
        )
        rows = r.json()["data"]["table"]["rows"]
    except Exception as e:  # noqa: BLE001
        print(f"  (screener metadata unavailable: {e!r} — seeding symbol-only rows)")
        return {}
    out: Dict[str, Tuple[str, Optional[float]]] = {}
    for x in rows:
        sym = (x.get("symbol") or "").strip().upper()
        cap = (x.get("marketCap") or "").replace(",", "").replace("$", "").strip()
        try:
            mcap: Optional[float] = float(cap) if cap else None
        except ValueError:
            mcap = None
        if sym:
            out[sym] = ((x.get("name") or sym).strip(), mcap)
    return out


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="realdata")
    ap.add_argument("--market", default="US")
    ap.add_argument("--chunk", type=int, default=100)
    ap.add_argument("--warm-redis", action="store_true",
                    help="also pickle recent bars into the Redis price cache")
    args = ap.parse_args()

    d = Path(args.data_dir)
    files = sorted(d.glob("*.csv"))
    if not files:
        raise SystemExit(f"No CSVs in {args.data_dir}")

    from app.database import SessionLocal
    from app.models.stock_universe import StockUniverse
    from app.services.security_type import classify_is_etf
    from app.wiring.bootstrap import get_price_cache, initialize_process_runtime_services

    initialize_process_runtime_services()
    meta = _fetch_screener_meta()
    price_cache = get_price_cache()

    # --- universe rows --------------------------------------------------
    db = SessionLocal()
    try:
        existing = {s for (s,) in db.query(StockUniverse.symbol).all()}
        added = 0
        for p in files:
            sym = "SPY" if p.stem.lower() == BENCH_STEM else p.stem.upper()
            if sym in existing:
                continue
            name, mcap = meta.get(sym, (sym, None))
            if sym == "SPY":
                name, is_etf = "SPDR S&P 500 ETF Trust", True
            else:
                is_etf = bool(classify_is_etf(sym, name))
            db.add(StockUniverse(
                symbol=sym, name=name, market=args.market, market_cap=mcap,
                is_active=True, status="active", is_etf=is_etf, source="manual",
            ))
            added += 1
        db.commit()
        print(f"universe: +{added} rows (had {len(existing)})")
    finally:
        db.close()

    # --- price bars, batched through the cache's own writer --------------
    batch: Dict[str, pd.DataFrame] = {}
    total = 0

    def _flush() -> None:
        nonlocal total
        if not batch:
            return
        price_cache._store_batch_in_database(dict(batch))
        if args.warm_redis:
            price_cache.store_batch_in_cache(dict(batch), also_store_db=False, market=args.market)
        total += len(batch)
        print(f"  prices: {total}/{len(files)} symbols stored")
        batch.clear()

    for p in files:
        sym = "SPY" if p.stem.lower() == BENCH_STEM else p.stem.upper()
        df = _read_csv(str(p))
        if df is None or df.empty or "Close" not in df.columns:
            print(f"  SKIP {sym}: unusable CSV")
            continue
        batch[sym] = df
        if len(batch) >= args.chunk:
            _flush()
    _flush()
    print(f"done: {total} symbols seeded from {args.data_dir}/")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
