#!/usr/bin/env python3
"""Real-database end-to-end verification of the Markets 360 screener + ETF exclusion.

Seeds a small US universe (stocks + ETFs) and their OHLCV into a real Postgres,
then exercises the ACTUAL code paths:
  1. get_active_symbols(exclude_etfs=True/False)  -> real SQL is_etf filter
  2. resolve_symbols(MARKET=US, exclude_etfs=True) -> real universe resolver
  3. Markets360Scanner over the resolved ex-ETF symbols, reading prices back from
     the DB -> the registered screener runs over the real resolved universe.

This proves the production path works after data ingestion; in production the same
query runs over the full US universe and the ScanOrchestrator wraps the scanner.

  DATABASE_URL=postgresql://... PYTHONPATH=. python3 scripts/markets360_db_verify.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import pandas as pd

from app.database import Base, engine, SessionLocal
import app.models  # noqa: F401  (register all models on Base)
from app.models.stock import StockPrice
from app.models.stock_universe import StockUniverse
from app.services.security_type import classify_is_etf
from app.wiring.bootstrap import get_stock_universe_service, initialize_process_runtime_services
from app.services.universe_resolver import resolve_symbols
from app.schemas.universe import UniverseDefinition, UniverseType
from app.scanners.markets360_scanner import Markets360Scanner
from app.scanners.base_screener import StockData

sys.path.insert(0, str(Path(__file__).resolve().parent))
from markets360_band_calibration import _read_csv  # noqa: E402

FIX = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "markets360"
UNIVERSE = [
    ("LLY", "Eli Lilly & Co.", "NYSE", 7.0e11), ("FTNT", "Fortinet Inc.", "NASDAQ", 1.0e11),
    ("CYRX", "CryoPort Inc.", "NASDAQ", 8.0e8), ("MRVL", "Marvell Technology", "NASDAQ", 6.0e10),
    ("AA", "Alcoa Corp.", "NYSE", 9.0e9), ("COIN", "Coinbase Global", "NASDAQ", 6.0e10),
    ("GEV", "GE Vernova", "NYSE", 1.3e11), ("PRAX", "Praxis Precision", "NASDAQ", 1.5e9),
    ("MSFT", "Microsoft Corp.", "NASDAQ", 3.3e12), ("QURE", "uniQure NV", "NASDAQ", 1.0e9),
    ("SPY", "SPDR S&P 500 ETF Trust", "NYSE", 5.0e11),
    ("QQQ", "Invesco QQQ Trust", "NASDAQ", 3.0e11),
    ("IBB", "iShares Biotechnology ETF", "NASDAQ", 8.0e9),
]


def _ohlcv(symbol: str) -> pd.DataFrame:
    return _read_csv(str(FIX / f"{symbol.lower()}.csv"))


def seed(db) -> None:
    db.query(StockPrice).delete()
    db.query(StockUniverse).delete()
    db.commit()
    for symbol, name, exch, mcap in UNIVERSE:
        is_etf = classify_is_etf(symbol, name)
        db.add(StockUniverse(
            symbol=symbol, name=name, market="US", exchange=exch, market_cap=mcap,
            is_active=True, status="active", is_etf=is_etf, source="manual",
        ))
        df = _ohlcv(symbol)
        for ts, r in df.iterrows():
            db.add(StockPrice(
                symbol=symbol, date=ts.date(), open=float(r.Open), high=float(r.High),
                low=float(r.Low), close=float(r.Close), volume=int(r.Volume), adj_close=float(r.Close),
            ))
    db.commit()


def _prices_from_db(db, symbol: str) -> pd.DataFrame:
    rows = (db.query(StockPrice).filter(StockPrice.symbol == symbol)
            .order_by(StockPrice.date.asc()).all())
    if not rows:
        return pd.DataFrame()
    idx = pd.to_datetime([r.date for r in rows])
    return pd.DataFrame({
        "Open": [r.open for r in rows], "High": [r.high for r in rows],
        "Low": [r.low for r in rows], "Close": [r.close for r in rows],
        "Volume": [r.volume for r in rows],
    }, index=idx)


def main() -> int:
    Base.metadata.create_all(engine)
    initialize_process_runtime_services()   # bind the DI container (as app startup does)
    db = SessionLocal()
    try:
        seed(db)
        svc = get_stock_universe_service()

        # 1) Real SQL is_etf filter
        all_syms = set(svc.get_active_symbols(db, market="US", exclude_etfs=False))
        ex_etf = set(svc.get_active_symbols(db, market="US", exclude_etfs=True))
        etfs_in_db = {s for s, n, *_ in UNIVERSE if classify_is_etf(s, n)}
        print("=== 1. get_active_symbols (real SQL) ===")
        print(f"  total US active:        {len(all_syms)}  -> {sorted(all_syms)}")
        print(f"  ETFs flagged is_etf:    {sorted(etfs_in_db)}")
        print(f"  exclude_etfs=True:      {len(ex_etf)}  -> {sorted(ex_etf)}")
        assert etfs_in_db.issubset(all_syms), "ETFs missing from full universe"
        assert ex_etf == all_syms - etfs_in_db, "exclude_etfs did not drop exactly the ETFs"
        print("  PASS: exclude_etfs drops exactly the ETF rows\n")

        # 2) Real resolver (MARKET=US)
        udef = UniverseDefinition(type=UniverseType.MARKET, market="US")
        resolved = resolve_symbols(db, udef, exclude_etfs=True)
        print("=== 2. resolve_symbols(MARKET=US, exclude_etfs=True) ===")
        print(f"  resolved {len(resolved)} symbols: {sorted(resolved)}")
        assert not (set(resolved) & etfs_in_db), "resolver leaked an ETF"
        print("  PASS: resolver returns the ex-ETF US universe\n")

        # 3) Run the registered screener over the resolved universe (prices from DB)
        spy = _prices_from_db(db, "SPY")  # benchmark (an ETF, used only as benchmark)
        scanner = Markets360Scanner()
        results = []
        for symbol in resolved:
            price = _prices_from_db(db, symbol)
            data = StockData(symbol=symbol, price_data=price, benchmark_data=spy, market="US")
            results.append((symbol, scanner.scan_stock(symbol, data)))
        results.sort(key=lambda r: r[1].score, reverse=True)
        print("=== 3. Markets360Scanner over the resolved ex-ETF universe (DB prices) ===")
        print(f"  {'SYM':6s}{'SCORE':>6s}  {'RATING':12s}{'PASS':>5s}  TPR PRESS  RISK  RPR")
        for symbol, r in results:
            d = r.details
            print(f"  {symbol:6s}{r.score:6.1f}  {r.rating:12s}{'YES' if r.passes else '  -':>5s}  "
                  f"{str(d.get('tpr_state','?'))[:4]:5s}{str(d.get('pressure_state','?')):7s}"
                  f"{str(d.get('buy_risk_state','?')):6s}{str(d.get('rpr','-')):>4s}")
        passed = [s for s, r in results if r.passes]
        assert results, "scanner produced no results"
        print(f"\n  PASS: screener ran over {len(results)} ex-ETF symbols; buyable leaders: {passed}")
        print("\nALL CHECKS PASSED — real DB universe + ETF exclusion + markets360 screener.")
        return 0
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
