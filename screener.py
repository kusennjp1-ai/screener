#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Minervini-style daily stock screener.

GitHub Actions から毎営業日実行され、data/screener_latest.json を生成する。
出力スキーマは index.html (RS Screener) が読む形式に合わせている。

  - ユニバース: S&P500 + NASDAQ-100 (Wikipedia から取得、失敗時は同梱CSV)
  - RSレーティング: IBD流 加重リターン (3ヶ月x2 + 6/9/12ヶ月) のユニバース内百分位 1-99
  - トレンドテンプレート: Minervini 8条件 (Stage 2 判定)
  - 市場環境: SPY の MA50/200・MA200傾き・分配日・ブレッドスで 0-100 スコア化
  - セクターRS: SPDR 11セクターETF
"""

import argparse
import datetime as dt
import io
import json
import math
import os
import sys
import time

import numpy as np
import pandas as pd

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "screener_latest.json")
FALLBACK_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "universe_fallback.csv")

WIKI_SP500 = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
WIKI_NDX = "https://en.wikipedia.org/wiki/Nasdaq-100"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

# GICS英語セクター名 -> (SPDRセクターETF, 日本語名)
SECTOR_MAP = {
    "Information Technology": ("XLK", "情報技術"),
    "Technology": ("XLK", "情報技術"),
    "Health Care": ("XLV", "ヘルスケア"),
    "Healthcare": ("XLV", "ヘルスケア"),
    "Financials": ("XLF", "金融"),
    "Financial Services": ("XLF", "金融"),
    "Consumer Discretionary": ("XLY", "一般消費財"),
    "Consumer Cyclical": ("XLY", "一般消費財"),
    "Communication Services": ("XLC", "通信サービス"),
    "Industrials": ("XLI", "資本財"),
    "Consumer Staples": ("XLP", "生活必需品"),
    "Consumer Defensive": ("XLP", "生活必需品"),
    "Energy": ("XLE", "エネルギー"),
    "Utilities": ("XLU", "公益事業"),
    "Real Estate": ("XLRE", "不動産"),
    "Materials": ("XLB", "素材"),
    "Basic Materials": ("XLB", "素材"),
}
ETF_JA = {
    "XLK": "情報技術", "XLV": "ヘルスケア", "XLF": "金融", "XLY": "一般消費財",
    "XLC": "通信サービス", "XLI": "資本財", "XLP": "生活必需品", "XLE": "エネルギー",
    "XLU": "公益事業", "XLRE": "不動産", "XLB": "素材",
}

MAIN_LIST_SIZE = 20
TIGHT_LIST_SIZE = 30
FUNDAMENTALS_LIMIT = 35  # yfinanceへの追加リクエストを抑えるため上位のみ


def log(*args):
    print("[screener]", *args, flush=True)


# ---------------------------------------------------------------- universe

def universe_from_wikipedia():
    import requests
    tickers = {}
    html = requests.get(WIKI_SP500, headers=UA, timeout=30).text
    for tbl in pd.read_html(io.StringIO(html)):
        if "Symbol" in tbl.columns and "GICS Sector" in tbl.columns:
            for _, row in tbl.iterrows():
                sym = str(row["Symbol"]).strip().replace(".", "-")
                if sym and sym != "nan":
                    tickers[sym] = str(row["GICS Sector"]).strip()
            break
    html = requests.get(WIKI_NDX, headers=UA, timeout=30).text
    for tbl in pd.read_html(io.StringIO(html)):
        cols = [str(c) for c in tbl.columns]
        if "Ticker" in cols and any("GICS Sector" in c for c in cols):
            sec_col = [c for c in cols if "GICS Sector" in c][0]
            for _, row in tbl.iterrows():
                sym = str(row["Ticker"]).strip().replace(".", "-")
                if sym and sym != "nan" and sym not in tickers:
                    tickers[sym] = str(row[sec_col]).strip()
            break
    return tickers


def universe_from_fallback():
    df = pd.read_csv(FALLBACK_CSV)
    return {str(r["ticker"]).strip(): str(r["sector"]).strip() for _, r in df.iterrows()}


def get_universe():
    try:
        u = universe_from_wikipedia()
        if len(u) >= 300:
            log(f"universe from Wikipedia: {len(u)} tickers")
            return u
        log(f"Wikipedia universe too small ({len(u)}), using fallback")
    except Exception as e:
        log("Wikipedia fetch failed:", e)
    u = universe_from_fallback()
    log(f"universe from fallback CSV: {len(u)} tickers")
    return u


# ---------------------------------------------------------------- prices

def batch_download(symbols, period="15mo", chunk=100):
    import yfinance as yf
    out = {}
    symbols = list(symbols)
    for i in range(0, len(symbols), chunk):
        batch = symbols[i:i + chunk]
        df = None
        for attempt in range(3):
            try:
                df = yf.download(batch, period=period, interval="1d",
                                 auto_adjust=True, group_by="ticker",
                                 threads=True, progress=False)
                break
            except Exception as e:
                log(f"download batch {i} attempt {attempt} failed:", e)
                time.sleep(5 * (attempt + 1))
        if df is None or df.empty:
            continue
        if not isinstance(df.columns, pd.MultiIndex):
            df = pd.concat({batch[0]: df}, axis=1)
        for s in batch:
            try:
                sub = df[s][["Open", "High", "Low", "Close", "Volume"]].dropna(subset=["Close"])
            except Exception:
                continue
            if len(sub) >= 120:
                out[s] = sub
        log(f"downloaded {min(i + chunk, len(symbols))}/{len(symbols)}")
    return out


# ---------------------------------------------------------------- metrics

def weighted_return(close):
    """IBD流: 直近3ヶ月を2倍加重した 3/6/9/12ヶ月リターン合成。"""
    def ret(d):
        d = min(d, len(close) - 1)
        prev = close.iloc[-1 - d]
        return float(close.iloc[-1] / prev - 1) if prev else 0.0
    return 2 * ret(63) + ret(126) + ret(189) + ret(252)


def compute_metrics(df, spy_close):
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    close = float(c.iloc[-1])
    ma50 = float(c.rolling(50).mean().iloc[-1])
    ma150 = float(c.rolling(150).mean().iloc[-1]) if len(c) >= 150 else np.nan
    ma200_s = c.rolling(200).mean()
    ma200 = float(ma200_s.iloc[-1]) if len(c) >= 200 else np.nan
    ma200_22 = float(ma200_s.iloc[-23]) if len(c) >= 223 else np.nan
    lookback = min(len(c), 252)
    hi52 = float(h.iloc[-lookback:].max())
    lo52 = float(l.iloc[-lookback:].min())

    # Minervini トレンドテンプレート (RS条件は百分位確定後に追加)
    tt = (
        not math.isnan(ma200) and close > ma150 and close > ma200
        and ma150 > ma200
        and (not math.isnan(ma200_22) and ma200 > ma200_22)
        and ma50 > ma150 > ma200
        and close > ma50
        and close >= lo52 * 1.30
        and close >= hi52 * 0.75
    )

    dist_high = (hi52 - close) / hi52 * 100 if hi52 else np.nan
    rng10 = (float(h.iloc[-10:].max()) - float(l.iloc[-10:].min())) / close * 100
    vol50 = float(v.iloc[-50:].mean())
    vdu = float(v.iloc[-5:].mean()) < 0.65 * vol50 if vol50 else False
    bkt = vol50 > 0 and float(v.iloc[-1]) > 1.4 * vol50 and float(c.iloc[-1]) > float(c.iloc[-2])
    vol_m = vol50 * close / 1e6

    # RSライン (対SPY相対線) が52日新高値か
    rs_line_high = False
    try:
        ratio = (c / spy_close.reindex(c.index)).dropna()
        if len(ratio) >= 52:
            rs_line_high = float(ratio.iloc[-1]) >= float(ratio.iloc[-52:].max()) * 0.999
    except Exception:
        pass

    # ピボット/ストップ (直近20日高値ブレイク想定、リスク3〜8%に収める)
    pivot = float(h.iloc[-20:].max())
    stop = max(float(l.iloc[-10:].min()), pivot * 0.92)
    stop = min(stop, pivot * 0.97)
    risk = (pivot - stop) / pivot * 100
    rr = round(20 / risk, 1) if risk > 0 else None  # 利確目標+20%想定

    depth60 = float((h.iloc[-60:].max() - l.iloc[-60:].min()) / h.iloc[-60:].max() * 100)

    return {
        "close": close, "ma200": ma200, "tt": tt,
        "above_ma200": not math.isnan(ma200) and close > ma200,
        "dist_high": dist_high, "range10": rng10,
        "vdu": vdu, "bkt": bkt, "vol_m": vol_m,
        "rs_line_high": rs_line_high,
        "pivot": pivot, "stop": stop, "risk": risk, "rr": rr,
        "depth60": depth60,
        "wret": weighted_return(c),
    }


# ---------------------------------------------------------------- env

def market_env(spy_df, metrics, last_date):
    c, v = spy_df["Close"], spy_df["Volume"]
    spy = float(c.iloc[-1])
    ma50 = float(c.rolling(50).mean().iloc[-1])
    ma200_s = c.rolling(200).mean()
    ma200 = float(ma200_s.iloc[-1])
    ma200_22 = float(ma200_s.iloc[-23])
    ma200_pct = round((spy / ma200 - 1) * 100, 1)
    ma50_pct = round((spy / ma50 - 1) * 100, 1)

    # 分配日: 直近25営業日で前日比-0.2%以下かつ出来高増の日 (機関の売り抜け)
    dist_days = 0
    chg = c.pct_change()
    for i in range(-25, 0):
        try:
            if float(chg.iloc[i]) <= -0.002 and float(v.iloc[i]) > float(v.iloc[i - 1]):
                dist_days += 1
        except Exception:
            pass

    total = len(metrics)
    above = sum(1 for m in metrics.values() if m["above_ma200"])
    stage2 = sum(1 for m in metrics.values() if m.get("stage2"))
    rs70 = sum(1 for m in metrics.values() if m.get("rs", 0) >= 70)
    breadth = above / total * 100 if total else 0

    score = 0
    score += 25 if spy > ma200 else 0
    score += 10 if spy > ma50 else 0
    score += 10 if ma50 > ma200 else 0
    score += 10 if ma200 > ma200_22 else 0
    score += breadth * 0.25
    score += max(0, 20 - 4 * dist_days)
    score = int(round(min(100, score)))

    if score >= 65 and spy > ma200:
        status = "BUY MODE"
    elif score >= 40:
        status = "CAUTION"
    else:
        status = "DO NOT BUY"
    if dist_days >= 6 and status == "BUY MODE":
        status = "CAUTION"

    return {
        "status": status,
        "date": f"{last_date:%Y-%m-%d} 米国市場終値ベース（毎営業日 自動更新）",
        "env_score": score,
        "spy": round(spy, 2),
        "spy_ma200_pct": ma200_pct,
        "spy_ma50_pct": ma50_pct,
        "dist_days": dist_days,
        "pct_above_ma200": round(breadth, 1),
        "stage2_count": stage2,
        "rs70_count": rs70,
        "rs70_total": total,
        "universe_size": total,
        "updated_at": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    }


# ---------------------------------------------------------------- fundamentals

def fetch_fundamentals(sym):
    import yfinance as yf
    res = {"EPS成長%": None, "売上成長%": None, "Code33": "", "次回決算": "", "ファンダG": "N"}
    try:
        t = yf.Ticker(sym)
        eps_g = rev_g = None
        eps_hist = [None, None, None]
        try:
            q = t.quarterly_income_stmt
        except Exception:
            q = None
        if q is not None and not q.empty:
            def yoy(s, i):
                try:
                    cur, prev = s.iloc[i], s.iloc[i + 4]
                    if pd.isna(cur) or pd.isna(prev) or prev == 0:
                        return None
                    return round(float((cur - prev) / abs(prev) * 100), 1)
                except Exception:
                    return None
            eps = q.loc["Diluted EPS"] if "Diluted EPS" in q.index else None
            rev = q.loc["Total Revenue"] if "Total Revenue" in q.index else None
            if eps is not None:
                eps_g = yoy(eps, 0)
                eps_hist = [yoy(eps, i) for i in range(3)]
            if rev is not None:
                rev_g = yoy(rev, 0)
        res["EPS成長%"] = eps_g
        res["売上成長%"] = rev_g
        if eps_g is not None:
            if eps_g >= 40 and (rev_g or 0) >= 15:
                res["ファンダG"] = "A+"
            elif eps_g >= 25:
                res["ファンダG"] = "A"
            elif eps_g >= 10:
                res["ファンダG"] = "B"
            else:
                res["ファンダG"] = "C"
        # Code33近似: EPS成長が3四半期加速 + 直近30%以上 + 増収
        if (all(x is not None for x in eps_hist)
                and eps_hist[0] > eps_hist[1] > eps_hist[2]
                and eps_hist[0] >= 30 and (rev_g or 0) > 0):
            res["Code33"] = "✓"
        try:
            cal = t.calendar
            d = cal.get("Earnings Date") if isinstance(cal, dict) else None
            if d:
                d0 = d[0] if isinstance(d, (list, tuple)) else d
                res["次回決算"] = str(d0)[:10]
        except Exception:
            pass
    except Exception as e:
        log(f"fundamentals failed for {sym}:", e)
    return res


# ---------------------------------------------------------------- rows

def stars(score):
    return "★★★" if score >= 85 else "★★" if score >= 72 else "★"


def total_score(m):
    s = (0.45 * m["rs"]
         + 0.20 * m["sec_rs"]
         + 0.20 * max(0, 100 - min(float(m["dist_high"]) * 4, 100))
         + 0.15 * max(0, 100 - min(float(m["range10"]) * 10, 100)))
    return int(round(s))


def build_reason(m, fund):
    good, warn = [], []
    if m["rs"] >= 90:
        good.append(f"RS {m['rs']}と市場屈指の相対強度")
    if m["dist_high"] <= 5:
        good.append(f"52週高値まで{m['dist_high']:.1f}%と目前")
    if m["rs_line_high"]:
        good.append("RSライン52日新高値（株価に先行する強気サイン）")
    if m["vdu"]:
        good.append("出来高枯渇（VDU）でブレイク前の静けさ")
    if m["bkt"]:
        good.append("直近で出来高を伴う上昇")
    if m["sec_rs"] >= 80:
        good.append("所属セクターが市場をリード")
    eps_g = fund.get("EPS成長%")
    if eps_g is not None and eps_g >= 25:
        good.append(f"EPS成長+{eps_g:.0f}%")
    if m["vol_m"] < 20:
        warn.append("売買代金がやや薄い")
    if m["depth60"] > 20:
        warn.append(f"ベースが深め（{m['depth60']:.0f}%）")
    nxt = fund.get("次回決算") or ""
    if len(nxt) >= 10:
        try:
            days = (dt.date.fromisoformat(nxt) - dt.date.today()).days
            if 0 <= days <= 14:
                warn.append(f"決算発表が{days}日後に接近")
        except Exception:
            pass
    parts = []
    if good:
        parts.append("【好材料】" + "、".join(good))
    if warn:
        parts.append("【注意】" + "、".join(warn))
    return "\n".join(parts)


def make_row(sym, m, fund, mode):
    base = {
        "シンボル": sym,
        "セクター": m["sector_ja"],
        "セクターRS数値": m["sec_rs"],
        "RS": m["rs"],
        "★": stars(m["score"]),
        "ファンダG": fund.get("ファンダG", "N"),
        "出来高$M": round(m["vol_m"], 1),
        "総合Score": m["score"],
        "高値比%": round(float(m["dist_high"]), 1),
        "RSライン52日": "★" if m["rs_line_high"] else "",
        "VDU": "YES" if m["vdu"] else "",
        "BKT出来高": "✓" if m["bkt"] else "",
        "Code33": fund.get("Code33", ""),
        "EPS成長%": fund.get("EPS成長%"),
        "売上成長%": fund.get("売上成長%"),
        "次回決算": fund.get("次回決算", ""),
        "有望理由": build_reason(m, fund),
    }
    if mode == "main":
        base.update({
            "ピボット": round(m["pivot"], 2),
            "ストップ": round(m["stop"], 2),
            "RR比": m["rr"],
            "リスク%": round(m["risk"], 1),
            "深さ%": round(m["depth60"], 1),
        })
    else:
        base.update({
            "値幅%": round(float(m["range10"]), 1),
            "リスト種別": "救済枠" if m["rs"] < 80 else "通常",
        })
    return base


# ---------------------------------------------------------------- main pipeline

def run(data, universe, skip_fundamentals=False):
    """data: {symbol: OHLCV DataFrame} — SPY とセクターETF を含むこと。"""
    spy_df = data["SPY"]
    spy_close = spy_df["Close"]
    last_date = spy_df.index[-1]
    if hasattr(last_date, "date"):
        last_date = last_date.date()

    metrics = {}
    for sym, sec_en in universe.items():
        if sym not in data:
            continue
        try:
            m = compute_metrics(data[sym], spy_close)
        except Exception as e:
            log(f"metrics failed for {sym}:", e)
            continue
        etf, ja = SECTOR_MAP.get(sec_en, ("", sec_en))
        m["sector_etf"] = etf
        m["sector_ja"] = ja
        metrics[sym] = m

    if not metrics:
        raise RuntimeError("no metrics computed — aborting")

    # RSレーティング: 加重リターンのユニバース内百分位 (1-99)
    wret = pd.Series({s: m["wret"] for s, m in metrics.items()})
    rs_rank = (wret.rank(pct=True) * 98 + 1).round().astype(int)
    for s, m in metrics.items():
        m["rs"] = int(rs_rank[s])
        m["stage2"] = bool(m["tt"] and m["rs"] >= 70)

    # セクターETFのRS: 同じ加重リターンを株式分布の百分位に当てはめる
    sorted_wret = np.sort(wret.values)
    sec_rs = {}
    for etf in ETF_JA:
        if etf in data:
            w = weighted_return(data[etf]["Close"])
            pct = np.searchsorted(sorted_wret, w) / len(sorted_wret)
            sec_rs[etf] = int(round(pct * 98 + 1))
        else:
            sec_rs[etf] = 0
    for m in metrics.values():
        m["sec_rs"] = sec_rs.get(m["sector_etf"], 50)
    for m in metrics.values():
        m["score"] = total_score(m)

    env = market_env(spy_df, metrics, last_date)

    sectors = [
        {"rank": i + 1, "etf": etf, "sector": ETF_JA[etf], "rs": rs}
        for i, (etf, rs) in enumerate(sorted(sec_rs.items(), key=lambda x: -x[1]))
    ]

    # メイン: Stage2 + RS80+ + 高値圏 + 流動性
    main_syms = [s for s, m in metrics.items()
                 if m["stage2"] and m["rs"] >= 80 and m["dist_high"] <= 25
                 and m["vol_m"] >= 15 and m["close"] >= 12]
    main_syms.sort(key=lambda s: -metrics[s]["score"])
    main_syms = main_syms[:MAIN_LIST_SIZE]

    # 高値保ち合い: Stage2 + 高値から15%以内 + 直近10日の値幅が小さい
    tight_syms = [s for s, m in metrics.items()
                  if m["stage2"] and m["dist_high"] <= 15 and m["range10"] <= 7.5
                  and m["vol_m"] >= 10 and m["close"] >= 12]
    tight_syms.sort(key=lambda s: -metrics[s]["score"])
    tight_syms = tight_syms[:TIGHT_LIST_SIZE]

    fund_syms = list(dict.fromkeys(main_syms + tight_syms))[:FUNDAMENTALS_LIMIT]
    funds = {}
    if not skip_fundamentals:
        log(f"fetching fundamentals for {len(fund_syms)} symbols")
        for sym in fund_syms:
            funds[sym] = fetch_fundamentals(sym)
            time.sleep(0.4)

    out = {
        "env": env,
        "main": [make_row(s, metrics[s], funds.get(s, {}), "main") for s in main_syms],
        "tight": [make_row(s, metrics[s], funds.get(s, {}), "tight") for s in tight_syms],
        "sectors": sectors,
    }
    return out


def jclean(o):
    if isinstance(o, dict):
        return {k: jclean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [jclean(v) for v in o]
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.floating, float)):
        f = float(o)
        return None if math.isnan(f) or math.isinf(f) else f
    if isinstance(o, np.bool_):
        return bool(o)
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--selftest", action="store_true", help="合成データでパイプラインを検証")
    ap.add_argument("--max-tickers", type=int, default=int(os.environ.get("MAX_TICKERS", "0")))
    args = ap.parse_args()

    if args.selftest:
        data, universe = synthetic_data()
        out = run(data, universe, skip_fundamentals=True)
    else:
        universe = get_universe()
        if args.max_tickers:
            universe = dict(list(universe.items())[:args.max_tickers])
        symbols = list(universe.keys()) + ["SPY"] + list(ETF_JA.keys())
        data = batch_download(symbols)
        if "SPY" not in data:
            raise RuntimeError("SPY data missing — aborting")
        log(f"price data for {len(data)} symbols")
        out = run(data, universe)

    out = jclean(out)
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    log(f"wrote {OUT_PATH}")
    log(f"env: {out['env']['status']} score={out['env']['env_score']} "
        f"stage2={out['env']['stage2_count']} main={len(out['main'])} tight={len(out['tight'])}")


# ---------------------------------------------------------------- selftest

def synthetic_data(n=60, days=320, seed=42):
    """ネットワークなしでパイプライン全体を検証するための合成OHLCV。"""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=dt.date.today(), periods=days)
    sectors_en = list({k for k in SECTOR_MAP if SECTOR_MAP[k][0]})

    def walk(drift, vol=0.015, tight_tail=False):
        r = rng.normal(drift, vol, days)
        if tight_tail:
            r[-15:] = rng.normal(0.0002, 0.004, 15)
        close = 100 * np.exp(np.cumsum(r))
        high = close * (1 + np.abs(rng.normal(0, 0.008, days)))
        low = close * (1 - np.abs(rng.normal(0, 0.008, days)))
        op = close * (1 + rng.normal(0, 0.004, days))
        volu = rng.integers(2_000_000, 9_000_000, days).astype(float)
        return pd.DataFrame({"Open": op, "High": high, "Low": low,
                             "Close": close, "Volume": volu}, index=idx)

    data = {"SPY": walk(0.0006)}
    for etf in ETF_JA:
        data[etf] = walk(rng.uniform(-0.0005, 0.0015))
    universe = {}
    for i in range(n):
        sym = f"TST{i:03d}"
        drift = rng.uniform(-0.001, 0.0035)
        data[sym] = walk(drift, tight_tail=(i % 3 == 0))
        universe[sym] = sectors_en[i % len(sectors_en)]
    return data, universe


if __name__ == "__main__":
    main()
