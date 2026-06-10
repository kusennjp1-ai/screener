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
import re
import sys
import time

import numpy as np
import pandas as pd

OUT_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "screener_latest.json")
FALLBACK_CSV = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "universe_fallback.csv")

WIKI_SP500 = "https://en.wikipedia.org/wiki/List_of_S%26P_500_companies"
WIKI_NDX = "https://en.wikipedia.org/wiki/Nasdaq-100"
# NASDAQ Trader 公式シンボルディレクトリ — 米国全上場銘柄 (Minervini級フルユニバース)
NASDAQ_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt"
OTHER_LISTED = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"}

# 普通株以外 (ワラント・ライツ・ユニット・優先株・債券・ファンド類) を銘柄名で除外。
# 注意: "depositary" 単体は除外しない — ADR (TSM/ARM/BABA等の
# "American Depositary Shares") は重要な主導株。優先株の預託証券は
# "preferred" や $付きシンボルで別途除外される。
EXCLUDE_NAME_RE = re.compile(
    r"\bwarrants?\b|\brights?\b|\bunits?\b|\bpreferred\b"
    r"|\bnotes?\b|\bdebentures?\b|\bETN\b|\bfunds?\b",
    re.I,
)
SYMBOL_RE = re.compile(r"[A-Z]{1,5}([.\-][A-Z])?")

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
FUNDAMENTALS_LIMIT = 50  # yfinanceへの追加リクエストを抑えるため上位のみ


def log(*args):
    print("[screener]", *args, flush=True)


# ---------------------------------------------------------------- universe

def parse_listed_file(text, sym_field):
    """NASDAQ Trader のパイプ区切りリストから普通株シンボルを抽出する。"""
    lines = [l for l in text.splitlines() if l.strip()]
    if not lines:
        return []
    header = lines[0].split("|")
    col = {name.strip(): i for i, name in enumerate(header)}
    out = []
    for line in lines[1:]:
        if "File Creation Time" in line:
            continue
        p = line.split("|")
        if len(p) < len(header):
            continue

        def g(name):
            i = col.get(name)
            return p[i].strip() if i is not None and i < len(p) else ""

        if g("ETF") == "Y" or g("Test Issue") == "Y":
            continue
        fin = g("Financial Status")  # NASDAQ上場のみ: N=正常以外(欠損/破産等)は除外
        if fin and fin != "N":
            continue
        if EXCLUDE_NAME_RE.search(g("Security Name")):
            continue
        sym = g(sym_field)
        if not SYMBOL_RE.fullmatch(sym):
            continue
        out.append(sym.replace(".", "-"))
    return out


def universe_from_nasdaqtrader():
    """米国全上場普通株 (NASDAQ + NYSE/AMEX/ARCA)。セクターは未付与 ("")。"""
    import requests
    syms = set()
    for url, field in ((NASDAQ_LISTED, "Symbol"), (OTHER_LISTED, "ACT Symbol")):
        text = requests.get(url, headers=UA, timeout=60).text
        syms |= set(parse_listed_file(text, field))
    syms -= set(ETF_JA) | {"SPY", "QQQ", "DIA", "IWM"}
    return {s: "" for s in sorted(syms)}


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
    """フルユニバース優先。既知セクター (S&P500/NDX) はWikipediaから補完。
    取得失敗時は Wikipedia → 同梱CSV へフォールバック。"""
    u = {}
    try:
        u = universe_from_nasdaqtrader()
        if len(u) >= 3000:
            log(f"universe from NASDAQ Trader: {len(u)} tickers")
        else:
            log(f"NASDAQ Trader universe too small ({len(u)})")
            u = {}
    except Exception as e:
        log("NASDAQ Trader fetch failed:", e)
        u = {}

    wiki = {}
    try:
        wiki = universe_from_wikipedia()
    except Exception as e:
        log("Wikipedia fetch failed:", e)

    if u:
        # フルユニバースに既知セクターを焼き込む (残りは候補確定後にyfinanceで補完)
        for s, sec in wiki.items():
            if s in u:
                u[s] = sec
        return u
    if len(wiki) >= 300:
        log(f"universe from Wikipedia: {len(wiki)} tickers")
        return wiki
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
        if (i // chunk) % 5 == 4 or i + chunk >= len(symbols):
            log(f"downloaded {min(i + chunk, len(symbols))}/{len(symbols)}")
        time.sleep(0.3)  # フルユニバースでのレート制限対策
    return out


# ---------------------------------------------------------------- metrics

def weighted_return(close):
    """IBD流: 直近3ヶ月を2倍加重した 3/6/9/12ヶ月リターン合成。"""
    def ret(d):
        d = min(d, len(close) - 1)
        prev = close.iloc[-1 - d]
        return float(close.iloc[-1] / prev - 1) if prev else 0.0
    return 2 * ret(63) + ret(126) + ret(189) + ret(252)


def contraction_depths(h, l, lookback=130, min_depth=0.03):
    """ベース内の押し(収縮)の深さを時系列順に返す。VCP判定の素材。

    高値を更新するたびに「直前の高値→その後の安値」の下落率を1収縮として記録する。
    """
    hh = h.iloc[-lookback:].to_numpy(dtype=float)
    ll = l.iloc[-lookback:].to_numpy(dtype=float)
    depths = []
    peak, trough = hh[0], ll[0]
    for i in range(1, len(hh)):
        if hh[i] >= peak:
            d = (peak - trough) / peak if peak else 0.0
            if d >= min_depth:
                depths.append(d)
            peak, trough = hh[i], ll[i]
        else:
            trough = min(trough, ll[i])
    d = (peak - trough) / peak if peak else 0.0
    if d >= min_depth:
        depths.append(d)
    return depths


def detect_vcp(depths):
    """Minervini流VCP: 収縮が2回以上、後の収縮ほど浅く(前の8割以下)、
    直近の収縮が12%以内なら成立とみなす近似。"""
    sig = [d for d in depths if d >= 0.04]
    if len(sig) < 2:
        return False
    if any(sig[i + 1] > sig[i] * 0.8 for i in range(len(sig) - 1)):
        return False
    return sig[-1] <= 0.12


def compute_metrics(df, spy_close):
    c, h, l, v = df["Close"], df["High"], df["Low"], df["Volume"]
    close = float(c.iloc[-1])
    ma50_s = c.rolling(50).mean()
    ma50 = float(ma50_s.iloc[-1])
    ma150 = float(c.rolling(150).mean().iloc[-1]) if len(c) >= 150 else np.nan
    ma200_s = c.rolling(200).mean()
    ma200 = float(ma200_s.iloc[-1]) if len(c) >= 200 else np.nan
    ma200_22 = float(ma200_s.iloc[-23]) if len(c) >= 223 else np.nan
    lookback = min(len(c), 252)
    hi52 = float(h.iloc[-lookback:].max())
    lo52 = float(l.iloc[-lookback:].min())

    # Minervini トレンドテンプレート (RS条件は百分位確定後に追加)
    # 株価 vs MA は >= で判定 (高値圏で完全に横ばいだと株価とMAが一致し、
    # 厳密な > では本物のStage 2を境界値で弾いてしまう)
    tt = (
        not math.isnan(ma200) and close >= ma150 and close >= ma200
        and ma150 > ma200
        and (not math.isnan(ma200_22) and ma200 > ma200_22)
        and ma50 >= ma150 > ma200
        and close >= ma50
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

    # EXT: ベース上限 (直近の急騰5日を除く20日高値) から5%超の上放れ = 追いかけ買い禁止
    ext = False
    base_high = float(h.iloc[-25:-5].max()) if len(h) >= 25 else float(h.iloc[-20:].max())
    if base_high > 0:
        ext = close > base_high * 1.05

    # ピボット/ストップ (直近20日高値ブレイク想定、リスク3〜8%に収める)
    # EXT時は表示の整合性のためベース上限をピボットとする (株価はゾーン上方)
    pivot = base_high if ext else float(h.iloc[-20:].max())
    stop = max(float(l.iloc[-10:].min()), pivot * 0.92)
    stop = min(stop, pivot * 0.97)
    risk = (pivot - stop) / pivot * 100
    rr = round(20 / risk, 1) if risk > 0 else None  # 利確目標+20%想定

    depth60 = float((h.iloc[-60:].max() - l.iloc[-60:].min()) / h.iloc[-60:].max() * 100)

    # VCP (ボラティリティ収縮パターン)
    depths = contraction_depths(h, l)
    vcp = detect_vcp(depths)

    # ADR% (直近20日の日中変動率平均) — 値動きの質の目安
    adr = float(((h.iloc[-20:] / l.iloc[-20:]) - 1).mean() * 100)

    # 買付適格性審査の素点 (buyability用): イベント急騰/急落・荒い日の頻度・MA200乖離
    ret = c.pct_change() * 100
    rseg = ret.iloc[-60:].dropna()
    max_up60 = float(rseg.max()) if len(rseg) else 0.0
    max_dn60 = float(rseg.min()) if len(rseg) else 0.0
    n_chop60 = int((rseg.abs() >= 6).sum()) if len(rseg) else 0
    # 急騰ギャップが「確立した上昇トレンド中」で起きたか (決算ギャップとイベント株の区別)
    gap_from_base = None
    if max_up60 >= 18:
        gap_from_base = False
        pos = c.index.get_loc(rseg.idxmax())
        if pos >= 1:
            prev = float(c.iloc[pos - 1])
            m50p = float(ma50_s.iloc[pos - 1])
            m200p = float(ma200_s.iloc[pos - 1])
            gap_from_base = (m50p == m50p and prev >= m50p
                             and (m200p != m200p or prev >= m200p))
    ext200 = (close / ma200 - 1) * 100 if (ma200 == ma200 and ma200 > 0) else None

    # 本日の52週新高値 / 新安値 (市場ブレッドス用)
    new_high = float(h.iloc[-1]) >= hi52 * 0.999
    new_low = float(l.iloc[-1]) <= lo52 * 1.001

    # ミニチャート用: 直近の終値・出来高・MA50を同じ間隔で最大60点に間引き
    tail = c.iloc[-90:]
    step = max(1, len(tail) // 60)
    spark = [round(float(x), 2) for x in tail.iloc[::step][-60:]]
    vols = [round(float(x) / 1e6, 2) for x in v.iloc[-90:].iloc[::step][-60:]]
    ma50_t = ma50_s.iloc[-90:].iloc[::step][-60:]
    ma50px = [round(float(x), 2) if x == x else None for x in ma50_t]

    # MarketSurge流レーティング素点・ベース判定
    accdis = accdis_raw(df)
    ud = up_down_volume(df)
    base = classify_base(df)
    stage = base_stage(h)

    return {
        "close": close, "ma200": ma200, "tt": tt,
        "above_ma200": not math.isnan(ma200) and close > ma200,
        "dist_high": dist_high, "range10": rng10,
        "vdu": vdu, "bkt": bkt, "vol_m": vol_m,
        "rs_line_high": rs_line_high,
        "pivot": pivot, "stop": stop, "risk": risk, "rr": rr,
        "depth60": depth60,
        "vcp": vcp, "n_contractions": len(depths), "adr": adr,
        "max_up60": max_up60, "max_dn60": max_dn60, "n_chop60": n_chop60,
        "gap_from_base": gap_from_base, "ext200": ext200,
        "ext": ext, "new_high": new_high, "new_low": new_low,
        "spark": spark, "vols": vols, "ma50px": ma50px,
        "accdis": accdis, "ud": ud, "base": base, "stage": stage,
        "wret": weighted_return(c),
    }


# ---------------------------------------------------------------- industry groups (IBD流145業種)

# yfinance業種キー → 日本語名 (一般的なカテゴリ名の独自訳。未収載キーは英語整形にフォールバック)
INDUSTRY_JA = {
    # Basic Materials
    "agricultural-inputs": "農業資材", "aluminum": "アルミニウム",
    "building-materials": "建材", "chemicals": "総合化学",
    "coking-coal": "原料炭", "copper": "銅", "gold": "金鉱",
    "lumber-wood-production": "木材・林産", "other-industrial-metals-mining": "産業用金属鉱業",
    "other-precious-metals-mining": "貴金属鉱業", "paper-paper-products": "紙・紙製品",
    "silver": "銀鉱", "specialty-chemicals": "特殊化学", "steel": "鉄鋼",
    # Communication Services
    "advertising-agencies": "広告代理店", "broadcasting": "放送",
    "electronic-gaming-multimedia": "ゲーム・マルチメディア", "entertainment": "エンターテインメント",
    "internet-content-information": "ネットコンテンツ・情報", "publishing": "出版",
    "telecom-services": "通信サービス",
    # Consumer Cyclical
    "apparel-manufacturing": "アパレル製造", "apparel-retail": "アパレル小売",
    "auto-manufacturers": "自動車メーカー", "auto-parts": "自動車部品",
    "auto-truck-dealerships": "自動車販売", "department-stores": "百貨店",
    "footwear-accessories": "靴・服飾雑貨", "furnishings-fixtures-appliances": "家具・家電",
    "gambling": "ギャンブル", "home-improvement-retail": "ホームセンター",
    "internet-retail": "ネット通販", "leisure": "レジャー用品", "lodging": "宿泊",
    "luxury-goods": "高級品", "packaging-containers": "包装・容器",
    "personal-services": "対個人サービス", "recreational-vehicles": "RV・レジャー車両",
    "residential-construction": "住宅建設", "resorts-casinos": "リゾート・カジノ",
    "restaurants": "外食", "specialty-retail": "専門小売",
    "textile-manufacturing": "繊維", "travel-services": "旅行サービス",
    # Consumer Defensive
    "beverages—brewers": "ビール", "beverages—non-alcoholic": "清涼飲料",
    "beverages—wineries-distilleries": "ワイン・蒸留酒", "confectioners": "菓子",
    "discount-stores": "ディスカウントストア", "education-training-services": "教育・研修",
    "farm-products": "農産物", "food-distribution": "食品卸",
    "grocery-stores": "食品スーパー", "household-personal-products": "日用品・トイレタリー",
    "packaged-foods": "加工食品", "tobacco": "たばこ",
    # Energy
    "oil-gas-drilling": "石油・ガス掘削", "oil-gas-e&p": "石油・ガス開発生産(E&P)",
    "oil-gas-equipment-services": "石油・ガス機器サービス", "oil-gas-integrated": "総合石油",
    "oil-gas-midstream": "石油・ガス中流(パイプライン)", "oil-gas-refining-marketing": "石油精製・販売",
    "thermal-coal": "一般炭", "uranium": "ウラン",
    # Financial Services
    "asset-management": "資産運用", "banks—diversified": "大手銀行",
    "banks—regional": "地方銀行", "capital-markets": "証券・投資銀行",
    "credit-services": "クレジットサービス", "financial-conglomerates": "金融コングロマリット",
    "financial-data-stock-exchanges": "金融データ・取引所", "insurance-brokers": "保険ブローカー",
    "insurance—diversified": "総合保険", "insurance—life": "生命保険",
    "insurance—property-casualty": "損害保険", "insurance—reinsurance": "再保険",
    "insurance—specialty": "特殊保険", "mortgage-finance": "住宅ローン金融",
    "shell-companies": "SPAC・ペーパーカンパニー",
    # Healthcare
    "biotechnology": "バイオテクノロジー", "diagnostics-research": "診断・研究受託",
    "drug-manufacturers—general": "大手製薬", "drug-manufacturers—specialty-generic": "特殊・後発医薬品",
    "health-information-services": "医療情報サービス", "healthcare-plans": "医療保険",
    "medical-care-facilities": "医療施設", "medical-devices": "医療機器",
    "medical-distribution": "医薬品卸", "medical-instruments-supplies": "医療器具・消耗品",
    "pharmaceutical-retailers": "ドラッグストア",
    # Industrials
    "aerospace-defense": "航空宇宙・防衛", "airlines": "航空会社",
    "airports-air-services": "空港・航空サービス", "building-products-equipment": "建築資材・設備",
    "business-equipment-supplies": "業務用機器・備品", "conglomerates": "コングロマリット",
    "consulting-services": "コンサルティング", "electrical-equipment-parts": "電気機器・部品",
    "engineering-construction": "エンジニアリング・建設",
    "farm-heavy-construction-machinery": "農機・建機",
    "industrial-distribution": "産業用品卸", "infrastructure-operations": "インフラ運営",
    "integrated-freight-logistics": "総合物流", "marine-shipping": "海運",
    "metal-fabrication": "金属加工", "pollution-treatment-controls": "環境・公害対策",
    "railroads": "鉄道", "rental-leasing-services": "レンタル・リース",
    "security-protection-services": "警備・セキュリティ",
    "specialty-business-services": "専門ビジネスサービス",
    "specialty-industrial-machinery": "産業機械",
    "staffing-employment-services": "人材サービス", "tools-accessories": "工具",
    "trucking": "トラック輸送", "waste-management": "廃棄物処理",
    # Real Estate
    "real-estate-services": "不動産サービス", "real-estate—development": "不動産開発",
    "real-estate—diversified": "総合不動産", "reit—diversified": "REIT(総合)",
    "reit—healthcare-facilities": "REIT(ヘルスケア)", "reit—hotel-motel": "REIT(ホテル)",
    "reit—industrial": "REIT(産業・物流)", "reit—mortgage": "モーゲージREIT",
    "reit—office": "REIT(オフィス)", "reit—residential": "REIT(住宅)",
    "reit—retail": "REIT(商業施設)", "reit—specialty": "REIT(特化型)",
    # Technology
    "communication-equipment": "通信機器", "computer-hardware": "コンピュータハードウェア",
    "consumer-electronics": "コンシューマ電子機器", "electronic-components": "電子部品",
    "electronics-computer-distribution": "電子機器卸",
    "information-technology-services": "ITサービス",
    "scientific-technical-instruments": "計測・精密機器",
    "semiconductor-equipment-materials": "半導体製造装置・材料",
    "semiconductors": "半導体", "software—application": "ソフトウェア(アプリ)",
    "software—infrastructure": "ソフトウェア(インフラ)", "solar": "太陽光",
    # Utilities
    "utilities—diversified": "総合公益", "utilities—independent-power-producers": "独立系発電",
    "utilities—regulated-electric": "電力", "utilities—regulated-gas": "ガス",
    "utilities—regulated-water": "水道", "utilities—renewable": "再生可能エネルギー",
}


def industry_ja(key):
    """業種キーの日本語名。未収載キーは英語を整形して返す。"""
    if not key:
        return ""
    name = INDUSTRY_JA.get(key)
    if name:
        return name
    return key.replace("—", " ").replace("-", " ").title()


def merge_industry_maps(prev, new):
    """業種マップのマージ: 前回分を保持しつつ、新規取得分で上書き。"""
    out = dict(prev or {})
    out.update({k: v for k, v in (new or {}).items() if v})
    return out


def fetch_industry_map(prev_map=None):
    """yfinanceの145業種を巡回し {シンボル: 業種キー} を構築。
    top_companiesは業種上位銘柄のみなので、前回マップ+候補銘柄のinfo取得で
    日々カバレッジが蓄積されていく。"""
    import yfinance as yf
    try:
        from yfinance.const import SECTOR_INDUSTY_MAPPING_LC as MAPPING
    except ImportError:
        log("industry mapping const not available")
        return dict(prev_map or {})
    fresh = {}
    n_ok = 0
    for sec_key, ind_keys in MAPPING.items():
        for key in ind_keys:
            try:
                tc = yf.Industry(key).top_companies
                if tc is None or len(tc) == 0:
                    continue
                if "symbol" in getattr(tc, "columns", []):
                    syms = list(tc["symbol"])
                else:
                    syms = list(tc.index)
                for sym in syms:
                    s = str(sym).strip().upper().replace(".", "-")
                    if s and s != "NAN":
                        fresh[s] = key
                n_ok += 1
            except Exception:
                pass
            time.sleep(0.2)
    log(f"industry map: {n_ok} industries fetched, {len(fresh)} fresh symbols, "
        f"{len(prev_map or {})} carried over")
    return merge_industry_maps(prev_map, fresh)


def compute_group_rs(metrics, industry_map, min_members=3):
    """業種グループRS: メンバー3銘柄以上の業種ごとに加重リターン中央値を取り、
    業種間順位から RS(1-99) を付与。(groupsリスト, sym→グループ情報) を返す。"""
    by_ind = {}
    for sym, m in metrics.items():
        key = (industry_map or {}).get(sym)
        if key:
            by_ind.setdefault(key, []).append((sym, m["wret"], m.get("rs", 0)))
    rows = []
    for key, members in by_ind.items():
        if len(members) < min_members:
            continue
        med = float(np.median([w for _, w, _ in members]))
        top = max(members, key=lambda x: x[2])[0]
        rows.append({"key": key, "med": med, "count": len(members), "top": top})
    if not rows:
        return [], {}
    rows.sort(key=lambda r: -r["med"])
    total = len(rows)
    groups = []
    for i, r in enumerate(rows):
        rs = int(round((1 - i / (total - 1)) * 98 + 1)) if total > 1 else 99
        groups.append({"rank": i + 1, "key": r["key"], "name": industry_ja(r["key"]),
                       "rs": rs, "count": r["count"], "top": r["top"], "total": total})
    ginfo = {g["key"]: g for g in groups}
    sym_info = {sym: ginfo[k] for sym, k in (industry_map or {}).items()
                if sym in metrics and k in ginfo}
    return groups, sym_info


# ---------------------------------------------------------------- ratings (MarketSurge流)

def accdis_raw(df, window=65):
    """Acc/Dis素点: 13週の出来高加重CLV (-1〜+1)。終値が日中レンジの
    どこで引けたかに出来高を掛け、機関の買い集め/売り抜けを測る。"""
    h = df["High"].iloc[-window:]
    l = df["Low"].iloc[-window:]
    c = df["Close"].iloc[-window:]
    v = df["Volume"].iloc[-window:]
    rng = (h - l).replace(0, np.nan)
    clv = (((c - l) - (h - c)) / rng).fillna(0.0)
    tv = float(v.sum())
    return float((clv * v).sum() / tv) if tv > 0 else 0.0


def accdis_letter(pct):
    """ユニバース内百分位 (0-1) を IBD流 A〜E に変換。"""
    if pct >= 0.8:
        return "A"
    if pct >= 0.6:
        return "B"
    if pct >= 0.4:
        return "C"
    if pct >= 0.2:
        return "D"
    return "E"


def up_down_volume(df, window=50):
    """Up/Down Volume比 (50日): 上昇日出来高 ÷ 下落日出来高。1.0超=買い優勢。"""
    c = df["Close"].iloc[-window - 1:]
    v = df["Volume"].iloc[-window - 1:]
    chg = c.diff().iloc[1:]
    vv = v.iloc[1:]
    up = float(vv[chg > 0].sum())
    down = float(vv[chg < 0].sum())
    if down <= 0:
        # 下落日出来高ゼロ: 上昇日出来高があれば最強、情報ゼロならNone
        return 9.9 if up > 0 else None
    return round(min(9.9, up / down), 2)


def eps_rating(q1_growth, q2_growth, annual_growth):
    """EPS Rating (1-99) 近似: 直近2四半期のEPS成長 + 年次成長の合成。
    IBDの百分位方式と違い式ベースだが、同じ序列性を持つ。"""
    if q1_growth is None and q2_growth is None and annual_growth is None:
        return None

    def clip(x, lo, hi):
        return max(lo, min(hi, x)) if x is not None else 0.0

    score = (1 + 25
             + clip(q1_growth, -50, 150) * 0.35
             + clip(q2_growth, -50, 150) * 0.15
             + clip(annual_growth, -50, 100) * 0.25)
    return int(max(1, min(99, round(score))))


def smr_rating(rev_growth, margin, roe):
    """SMR Rating (A-E): 売上成長・利益率・ROE (yfinanceは小数表記)。
    欠損項目は「悪い」扱いせず、取得できた項目だけの達成率で評価する。"""
    checks = [(rev_growth, 0.20, 0.08), (margin, 0.15, 0.05), (roe, 0.25, 0.15)]
    avail = [(v, hi, lo) for v, hi, lo in checks if v is not None]
    if not avail:
        return "N"
    pts = sum(2 if v >= hi else 1 if v >= lo else 0 for v, hi, lo in avail)
    frac = pts / (2 * len(avail))
    if frac >= 0.85:
        return "A"
    if frac >= 0.65:
        return "B"
    if frac >= 0.45:
        return "C"
    if frac >= 0.25:
        return "D"
    return "E"


def composite_rating(rs, eps_r, accdis_pct, sec_rs, dist_high):
    """Composite Rating (1-99): RS 40% + EPS 20% + Acc/Dis 15%
    + セクターRS 10% + 52週高値への近さ 15%。EPS欠損は中立50で計算。"""
    eps = eps_r if eps_r is not None else 50
    off_high = max(0.0, 100 - min(float(dist_high) * 4, 100))
    raw = (0.40 * rs + 0.20 * eps + 0.15 * accdis_pct * 100
           + 0.10 * sec_rs + 0.15 * off_high)
    return int(max(1, min(99, round(raw))))


# ---------------------------------------------------------------- base detection (MarketSurge流)

def classify_base(df, lookback=252):
    """ベース自動判定: フラットベース / カップ / カップウィズハンドル。

    ベース起点 = 直近52週高値。5週(25日)未満はベース未形成、
    深さ35%超は崩壊とみなしベースと認めない (Minervini/IBD基準)。
    """
    h, l = df["High"], df["Low"]
    n = min(len(h), lookback)
    hh = h.iloc[-n:].to_numpy(dtype=float)
    ll = l.iloc[-n:].to_numpy(dtype=float)
    out = {"type": "", "weeks": 0, "depth": 0.0}
    peak_pos = int(np.argmax(hh))
    base_len = (n - 1) - peak_pos
    if base_len < 25:
        return out
    peak = hh[peak_pos]
    seg_l = ll[peak_pos + 1:]
    seg_h = hh[peak_pos + 1:]
    trough_rel = int(np.argmin(seg_l))
    depth = (peak - seg_l[trough_rel]) / peak if peak else 0.0
    out["weeks"] = int(base_len // 5)
    out["depth"] = round(float(depth * 100), 1)
    if depth > 0.35 or depth <= 0:
        return out

    # ハンドル: ベース終盤に「高値→小さな押し(12%以内)」がベース上半分で発生
    handle = False
    if base_len >= 35:
        hw = min(15, base_len // 3)
        win_h = seg_h[-hw:]
        am = int(np.argmax(win_h))
        # ハンドルは高値+押し5本以上 (IBD基準)。3本程度の押しはハンドルではない
        if am <= hw - 6:
            h_high = float(win_h[am])
            h_low = float(np.min(ll[-(hw - am):]))
            h_depth = (h_high - h_low) / h_high if h_high else 0.0
            in_upper = h_low > peak * (1 - depth * 0.5)
            handle = 0.0 < h_depth <= 0.12 and in_upper

    if depth <= 0.15:
        out["type"] = "フラットベース"
        return out
    pos = trough_rel / max(1, len(seg_l) - 1)
    if 0.15 <= pos <= 0.80:  # U字 (底が中央寄り)
        out["type"] = "カップウィズハンドル" if handle else "カップ"
    else:
        out["type"] = "保ち合い"
    return out


def base_stage(h, lookback=252, gap=25):
    """ベース段階 (第Nステージ): 25日以上の非新高値期間を挟んで新高値を
    更新するたびに+1。後期ステージ (4以降) のベースは失敗率が高い。"""
    hh = h.iloc[-lookback:].to_numpy(dtype=float)
    stage = 1
    run_max = hh[0]
    days_since_high = 0
    for x in hh[1:]:
        # 新高値は厳密超え。同値タッチはブレイクではない (カウンタ維持)
        if x > run_max:
            if days_since_high >= gap:
                stage += 1
            run_max = x
            days_since_high = 0
        else:
            days_since_high += 1
    return min(stage, 9)


# ---------------------------------------------------------------- chart payload

def _bars(df, ma_window, n):
    """OHLCV+MAをチャート用の並列配列に変換 (出来高は百万株、NaNはNone)。"""
    tail = df.iloc[-n:]
    ma = df["Close"].rolling(ma_window).mean().iloc[-n:]
    rnd = lambda x: round(float(x), 2)
    return {
        "t": [f"{d:%y/%m/%d}" for d in tail.index],
        "o": [rnd(x) for x in tail["Open"]],
        "h": [rnd(x) for x in tail["High"]],
        "l": [rnd(x) for x in tail["Low"]],
        "c": [rnd(x) for x in tail["Close"]],
        "v": [round(float(x) / 1e6, 2) if x == x else 0.0 for x in tail["Volume"]],
        "ma": [rnd(x) if x == x else None for x in ma],
    }


def build_chart_payload(df, spy_close=None, pivot=None, stop=None,
                        daily_bars=90, weekly_bars=52):
    """候補銘柄1つ分のチャートJSON: 日足90本 + 週足52本 + RSライン。"""
    daily = _bars(df, 50, daily_bars)

    weekly_df = df.resample("W-FRI").agg(
        {"Open": "first", "High": "max", "Low": "min",
         "Close": "last", "Volume": "sum"}).dropna(subset=["Close"])
    weekly = _bars(weekly_df, 10, weekly_bars)

    rs = []
    if spy_close is not None:
        ratio = (df["Close"] / spy_close.reindex(df.index).ffill().bfill()).iloc[-daily_bars:]
        rs = [round(float(x), 4) if x == x else None for x in ratio]
    out = {"d": daily, "w": weekly, "rs": rs}
    if pivot is not None:
        out["pivot"] = round(float(pivot), 2)
    if stop is not None:
        out["stop"] = round(float(stop), 2)
    return out


def write_chart_files(out, data, spy_close, charts_dir):
    """main/tight候補のチャートJSONを data/charts/ に書き出す。"""
    import shutil
    shutil.rmtree(charts_dir, ignore_errors=True)
    os.makedirs(charts_dir, exist_ok=True)
    pivots = {r["シンボル"]: (r.get("ピボット"), r.get("ストップ")) for r in out["main"]}
    written = 0
    for row in out["main"] + out["tight"]:
        sym = row["シンボル"]
        path = os.path.join(charts_dir, f"{sym}.json")
        if os.path.exists(path) or sym not in data:
            continue
        pvt, stp = pivots.get(sym, (None, None))
        try:
            payload = jclean(build_chart_payload(data[sym], spy_close=spy_close,
                                                 pivot=pvt, stop=stp))
            with open(path, "w", encoding="utf-8") as f:
                json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
            written += 1
        except Exception as e:
            log(f"chart write failed for {sym}:", e)
    log(f"wrote {written} chart files to {charts_dir}")


# ---------------------------------------------------------------- env (IBD流)

def distribution_days(df, window=25):
    """IBD流 分配日カウント: 前日比-0.2%以下かつ出来高増の日。
    その後 終値が分配日終値から5%以上上昇したら失効 (IBDの5%ルール)。"""
    c, v = df["Close"], df["Volume"]
    chg = c.pct_change()
    count = 0
    for i in range(-window, 0):
        try:
            if float(chg.iloc[i]) <= -0.002 and float(v.iloc[i]) > float(v.iloc[i - 1]):
                future_max = float(c.iloc[i:].max())
                if future_max < float(c.iloc[i]) * 1.05:
                    count += 1
        except Exception:
            pass
    return count


def detect_ftd(df, lookback=80, correction_pct=0.06):
    """IBD流 フォロースルー日(FTD)検出。

    直近lookback日の高値から6%以上の調整があった場合、安値からの立ち直り
    4日目以降に「前日比+1.25%以上かつ出来高増」の日があれば上昇トレンド確認。

    Returns (state, days_since_ftd):
      state: 'uptrend' (調整なし) / 'correction' (調整中・FTD無効化含む)
             / 'rally_attempt' (底打ち試行中) / 'confirmed' (FTD確認済み)
    """
    c, v = df["Close"], df["Volume"]
    win = c.iloc[-lookback:]
    arr = win.to_numpy(dtype=float)
    peak_pos = int(np.argmax(arr))
    peak = arr[peak_pos]
    after = arr[peak_pos:]
    trough_rel = int(np.argmin(after))
    trough = after[trough_rel]
    if peak <= 0 or (1 - trough / peak) < correction_pct:
        return ("uptrend", None)

    trough_abs = len(c) - lookback + peak_pos + trough_rel
    rally_c = c.iloc[trough_abs:]
    rally_v = v.iloc[trough_abs:]
    last = float(c.iloc[-1])
    if len(rally_c) < 2 or last <= trough * 1.001:
        return ("correction", None)

    ftd_k = None
    for k in range(4, len(rally_c)):
        day_chg = float(rally_c.iloc[k] / rally_c.iloc[k - 1] - 1)
        if day_chg >= 0.0125 and float(rally_v.iloc[k]) > float(rally_v.iloc[k - 1]):
            ftd_k = k
            break
    if ftd_k is None:
        return ("rally_attempt", None)
    # FTD後の底割れは、troughが「ピーク以降の最安値」である構造上、
    # 新しいtroughとしてラリー起点が引き直されることで自然に無効化される
    return ("confirmed", len(rally_c) - 1 - ftd_k)


def market_pulse(score, spy_above_ma200, dd, state_spy, state_qqq, days_since_ftd):
    """IBD Market Pulse風の3状態判定。(status, pulse文言) を返す。

    IBDルールに合わせた制約:
      - 調整入り後はFTDなしに「確認済み上昇トレンド」へは戻れない
      - FTD確認直後は環境スコアが低くてもCAUTIONまで格上げ (底打ち時の
        スコアは構造的に低いため、ここで弾くとFTDが機能しない)
    """
    states = (state_spy, state_qqq)
    confirmed = "confirmed" in states
    ftd_fresh = confirmed and days_since_ftd is not None and days_since_ftd <= 25
    healthy = (state_spy in ("uptrend", "confirmed")
               and state_qqq in ("uptrend", "confirmed"))

    if not confirmed:
        if (states == ("correction", "correction")) or (not spy_above_ma200) or score < 40:
            if "rally_attempt" in states:
                return ("DO NOT BUY", "調整局面 — ラリー試行中（フォロースルー日待ち）")
            if healthy and score >= 40:
                return ("CAUTION", "圧力下の上昇トレンド（Uptrend Under Pressure）")
            return ("DO NOT BUY", "調整局面（Market in Correction）")
    if score < 40:
        if ftd_fresh:
            return ("CAUTION",
                    f"フォロースルー日確認（{days_since_ftd}営業日前）— 環境は脆弱、試験的買いのみ")
        return ("DO NOT BUY", "調整局面（Market in Correction）")
    if not healthy:
        return ("CAUTION", "調整からの戻り — フォロースルー日待ち（Uptrend Under Pressure）")
    if dd >= 4 or score < 65:
        return ("CAUTION", "圧力下の上昇トレンド（Uptrend Under Pressure）")
    label = "確認済み上昇トレンド（Confirmed Uptrend）"
    if days_since_ftd is not None and days_since_ftd <= 25:
        label += f"｜FTD確認から{days_since_ftd}営業日"
    return ("BUY MODE", label)


def market_env(spy_df, metrics, last_date, prev=None, qqq_df=None):
    c = spy_df["Close"]
    spy = float(c.iloc[-1])
    ma50 = float(c.rolling(50).mean().iloc[-1])
    ma200_s = c.rolling(200).mean()
    ma200 = float(ma200_s.iloc[-1])
    ma200_22 = float(ma200_s.iloc[-23])
    ma200_pct = round((spy / ma200 - 1) * 100, 1)
    ma50_pct = round((spy / ma50 - 1) * 100, 1)

    # 分配日 (5%失効ルール付き) と FTD は SPY / QQQ 両指数で評価
    dist_spy = distribution_days(spy_df)
    state_spy, since_spy = detect_ftd(spy_df)
    if qqq_df is not None and len(qqq_df) >= 200:
        dist_qqq = distribution_days(qqq_df)
        state_qqq, since_qqq = detect_ftd(qqq_df)
        qqq = round(float(qqq_df["Close"].iloc[-1]), 2)
        qqq_ma200 = float(qqq_df["Close"].rolling(200).mean().iloc[-1])
        qqq_ma200_pct = round((qqq / qqq_ma200 - 1) * 100, 1)
    else:
        # QQQデータなし: 分配日は捏造せずNone (UIは単一表示にフォールバック)
        dist_qqq = None
        state_qqq, since_qqq = state_spy, since_spy
        qqq, qqq_ma200_pct = None, None
    dist_days = max(dist_spy, dist_qqq) if dist_qqq is not None else dist_spy
    days_since_ftd = min((d for d in (since_spy, since_qqq) if d is not None), default=None)

    total = len(metrics)
    above = sum(1 for m in metrics.values() if m["above_ma200"])
    stage2 = sum(1 for m in metrics.values() if m.get("stage2"))
    rs70 = sum(1 for m in metrics.values() if m.get("rs", 0) >= 70)
    nh = sum(1 for m in metrics.values() if m.get("new_high"))
    nl = sum(1 for m in metrics.values() if m.get("new_low"))
    breadth = above / total * 100 if total else 0

    score = 0
    score += 25 if spy > ma200 else 0
    score += 10 if spy > ma50 else 0
    score += 10 if ma50 > ma200 else 0
    score += 10 if ma200 > ma200_22 else 0
    score += breadth * 0.25
    score += max(0, 20 - 4 * dist_days)
    score = int(round(min(100, score)))

    status, pulse = market_pulse(score, spy > ma200, dist_days,
                                 state_spy, state_qqq, days_since_ftd)

    # ENVスコア履歴 (前回データから引き継いで蓄積 — 環境の変化を可視化する)
    today_str = f"{last_date:%Y-%m-%d}"
    hist = list((prev or {}).get("env_history") or [])
    hist = [h for h in hist if h.get("d") != today_str]
    hist.append({"d": today_str, "s": score, "st": status})
    hist = hist[-60:]

    return {
        "env_history": hist,
        "status": status,
        "date": f"{last_date:%Y-%m-%d} 米国市場終値ベース（毎営業日 自動更新）",
        "env_score": score,
        "spy": round(spy, 2),
        "spy_ma200_pct": ma200_pct,
        "spy_ma50_pct": ma50_pct,
        "pulse": pulse,
        "market_state_spy": state_spy,
        "market_state_qqq": state_qqq,
        "days_since_ftd": days_since_ftd,
        "qqq": qqq,
        "qqq_ma200_pct": qqq_ma200_pct,
        "dist_days": dist_days,
        "dist_spy": dist_spy,
        "dist_qqq": dist_qqq,
        "nh": nh,
        "nl": nl,
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
    res = {"EPS成長%": None, "売上成長%": None, "Code33": "", "次回決算": "",
           "ファンダG": "N", "_sector": ""}
    try:
        t = yf.Ticker(sym)
        # フルユニバース銘柄はセクター未付与なのでここで補完する
        try:
            info = t.info or {}
            res["_sector"] = str(info.get("sector") or "")
            res["_industry_key"] = str(info.get("industryKey") or "")
            # SMR Rating (売上成長・利益率・ROE)
            res["_smr"] = smr_rating(info.get("revenueGrowth"),
                                     info.get("profitMargins"),
                                     info.get("returnOnEquity"))
        except Exception:
            pass
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
        # EPS Rating用の追加成長指標: 前四半期yoy + 年次EPS成長
        res["_eps_q2"] = eps_hist[1]
        try:
            a = t.income_stmt
            if a is not None and not a.empty and "Diluted EPS" in a.index:
                s = a.loc["Diluted EPS"].dropna()
                if len(s) >= 2 and not pd.isna(s.iloc[1]) and abs(float(s.iloc[1])) > 0:
                    res["_annual_g"] = round(
                        float((s.iloc[0] - s.iloc[1]) / abs(s.iloc[1]) * 100), 1)
        except Exception:
            pass
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


def buyability(m):
    """Minervini買付適格性審査 — 「ミネルヴィニはこのチャートを本当に買うか」。

    RS・高値圏・トレンドテンプレートの条件だけなら通過してしまう
    「買えないチャート」(バイナリーイベントで急騰したバイオ株、wide & loose、
    クライマックス的乖離) を拒否し、グレーゾーンは減点+警告にとどめる。
    返り値: (拒否理由list, スコア減点int, 警告list)。
    拒否理由が1つでもあればメイン/高値保ち合いの両リストから除外する。"""
    vetoes, warns, penalty = [], [], 0

    # 1) イベント型急騰: 1日±18%超は機関の継続的な買い集めでは起きない値動き。
    #    確立した上昇トレンド中の決算ギャップ (NVDA型) だけは正当なので拒否しない。
    if m["max_up60"] >= 35:
        vetoes.append(f"直近60日に1日+{m['max_up60']:.0f}%のイベント急騰 — 新ベース形成まで見送り")
    elif m["max_up60"] >= 18 and not m.get("gap_from_base"):
        vetoes.append(f"+{m['max_up60']:.0f}%の急騰ギャップ以前に上昇トレンド不在 — イベント主導の値動き")
    if m["max_dn60"] <= -18:
        vetoes.append(f"直近60日に1日{m['max_dn60']:.0f}%の急落 — 破損チャート")

    # 2) 値動きの荒さ: wide & loose はベースとして機能しない
    if m["adr"] >= 8:
        vetoes.append(f"ADR {m['adr']:.1f}%と値動きが荒すぎる (wide & loose)")
    elif m["adr"] >= 6:
        penalty += int(round((m["adr"] - 6) * 5))
        warns.append(f"ADR {m['adr']:.1f}%とやや荒い値動き")

    # 3) 200日線からの乖離: 急伸後の異常乖離はクライマックス圏 (買い場ではなく売り場)
    ext200 = m.get("ext200")
    if ext200 is not None and ext200 == ext200:
        if ext200 >= 120:
            vetoes.append(f"200日線から+{ext200:.0f}%の異常乖離 — クライマックス圏")
        elif ext200 >= 70:
            penalty += 10
            warns.append(f"200日線から+{ext200:.0f}%乖離と過熱気味 — 押し目を待つ")

    # 4) 荒い日の頻発 / ベース未形成のV字回復
    if m["n_chop60"] > 2:
        penalty += min(15, (m["n_chop60"] - 2) * 3)
        if m["n_chop60"] >= 5:
            warns.append(f"±6%超の値動きが直近60日で{m['n_chop60']}日と荒い")
    base = m.get("base") or {}
    if m["depth60"] >= 35 and base.get("type", "") in ("", "保ち合い"):
        penalty += 8
        warns.append(f"深さ{m['depth60']:.0f}%の調整からベース未形成のV字回復")

    return vetoes, penalty, warns


def final_score(m):
    """総合Score = total_score - 買付適格性の減点 (下限1)。"""
    return max(1, total_score(m) - m.get("q_penalty", 0))


def build_reason(m, fund):
    good, warn = [], []
    if m["rs"] >= 90:
        good.append(f"RS {m['rs']}と市場屈指の相対強度")
    if m["dist_high"] <= 5:
        good.append(f"52週高値まで{m['dist_high']:.1f}%と目前")
    if m["rs_line_high"]:
        good.append("RSライン52日新高値（株価に先行する強気サイン）")
    if m["vcp"]:
        good.append(f"VCP形成中（{m['n_contractions']}段階のボラ収縮）")
    if m["vdu"]:
        good.append("出来高枯渇（VDU）でブレイク前の静けさ")
    if m["bkt"]:
        good.append("直近で出来高を伴う上昇")
    if m["sec_rs"] >= 80:
        good.append("所属セクターが市場をリード")
    base = m.get("base") or {}
    if base.get("type") and base["type"] != "保ち合い":
        # 名前のあるベース (フラット/カップ系) のみ好材料扱い。
        # ただの保ち合いは下落継続中でも付くため評価しない
        good.append(f"{base['type']}形成中（{base['weeks']}週・深さ{base['depth']:.0f}%）")
    if m.get("accdis_letter") in ("A", "B"):
        ud_txt = f"・U/D比{m['ud']:.1f}" if m.get("ud") is not None else ""
        good.append(f"機関投資家の買い集め優勢（Acc/Dis {m['accdis_letter']}{ud_txt}）")
    eps_g = fund.get("EPS成長%")
    if eps_g is not None and eps_g >= 25:
        good.append(f"EPS成長+{eps_g:.0f}%")
    if m["ext"]:
        warn.append("ピボットから5%以上の上放れ（EXT）— 追いかけ買いは避け、押しを待つ")
    if m.get("stage", 0) >= 4:
        warn.append(f"第{m['stage']}ステージの後期ベース — 失敗率が高まる段階")
    if m.get("accdis_letter") in ("D", "E"):
        warn.append(f"出来高面で売り抜け気味（Acc/Dis {m['accdis_letter']}）")
    if m["vol_m"] < 20:
        warn.append("売買代金がやや薄い")
    if m["depth60"] > 20:
        warn.append(f"ベースが深め（{m['depth60']:.0f}%）")
    warn.extend(m.get("q_warns", []))
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
    # 次回決算までの暦日数 (10日以内なら警戒タグ用)
    earnings_days = None
    nxt = fund.get("次回決算") or ""
    if len(nxt) >= 10:
        try:
            earnings_days = (dt.date.fromisoformat(nxt[:10]) - dt.date.today()).days
        except Exception:
            pass

    # MarketSurge流レーティング
    eps_r = eps_rating(fund.get("EPS成長%"), fund.get("_eps_q2"), fund.get("_annual_g"))
    comp = composite_rating(m["rs"], eps_r, m.get("accdis_pct", 0.5),
                            m["sec_rs"], m["dist_high"])
    binfo = m.get("base") or {}

    base = {
        "業種": m.get("industry_ja", ""),
        "業種順位": m.get("grp_rank"),
        "業種総数": m.get("grp_total"),
        "Comp": comp,
        "EPSレート": eps_r,
        "SMR": fund.get("_smr", "N"),
        "AccDis": m.get("accdis_letter", "C"),
        "UD比": round(m["ud"], 2) if m.get("ud") is not None else None,
        "ベース": binfo.get("type", ""),
        "ベース週数": binfo.get("weeks", 0),
        "ベース深さ%": binfo.get("depth", 0),
        "ベース段階": m.get("stage", 1),
        "vols": m["vols"],
        "ma50px": m["ma50px"],
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
        "VCP": "✓" if m["vcp"] else "",
        "EXT": "✓" if m["ext"] else "",
        "収縮回数": m["n_contractions"],
        "ADR%": round(m["adr"], 1),
        "px": m["spark"],
        "決算日数": earnings_days,
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

def run(data, universe, skip_fundamentals=False, prev=None, industry_map=None):
    """data: {symbol: OHLCV DataFrame} — SPY とセクターETF を含むこと。
    prev: 前回出力JSON (env_history引き継ぎ用、なければNone)。
    industry_map: {symbol: 業種キー} — 業種グループRS算出用 (なければETFセクターのみ)。"""
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
    # Acc/Dis: 出来高加重CLVのユニバース内百分位 → A〜E
    accdis_rank = pd.Series({s: m["accdis"] for s, m in metrics.items()}).rank(pct=True)
    for s, m in metrics.items():
        m["rs"] = int(rs_rank[s])
        m["stage2"] = bool(m["tt"] and m["rs"] >= 70)
        m["accdis_pct"] = float(accdis_rank[s])
        m["accdis_letter"] = accdis_letter(m["accdis_pct"])

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

    # IBD流145業種グループRS: 判明している銘柄はETFセクターより細かい業種RSで上書き
    groups, sym_grp = compute_group_rs(metrics, industry_map)
    for sym, g in sym_grp.items():
        metrics[sym]["sec_rs"] = g["rs"]
        metrics[sym]["industry_ja"] = g["name"]
        metrics[sym]["grp_rank"] = g["rank"]
        metrics[sym]["grp_total"] = g["total"]

    # Minervini買付適格性審査: イベント急騰・荒い値動き・クライマックス乖離を排除
    n_veto = 0
    for m in metrics.values():
        vetoes, q_pen, q_warns = buyability(m)
        m["veto"] = vetoes
        m["q_penalty"] = q_pen
        m["q_warns"] = q_warns
        n_veto += bool(vetoes)
        m["score"] = final_score(m)
    if n_veto:
        log(f"buyability veto: {n_veto} symbols excluded from candidate lists")

    env = market_env(spy_df, metrics, last_date, prev=prev, qqq_df=data.get("QQQ"))
    env_history = env.pop("env_history")

    sectors = [
        {"rank": i + 1, "etf": etf, "sector": ETF_JA[etf], "rs": rs}
        for i, (etf, rs) in enumerate(sorted(sec_rs.items(), key=lambda x: -x[1]))
    ]

    # メイン: Stage2 + RS80+ + 高値圏 + 流動性
    main_syms = [s for s, m in metrics.items()
                 if m["stage2"] and m["rs"] >= 80 and m["dist_high"] <= 25
                 and m["vol_m"] >= 15 and m["close"] >= 12 and not m["veto"]]
    main_syms.sort(key=lambda s: -metrics[s]["score"])
    main_syms = main_syms[:MAIN_LIST_SIZE]

    # 高値保ち合い: Stage2 + 高値から15%以内 + 直近10日の値幅が小さい
    tight_syms = [s for s, m in metrics.items()
                  if m["stage2"] and m["dist_high"] <= 15 and m["range10"] <= 7.5
                  and m["vol_m"] >= 10 and m["close"] >= 12 and not m["veto"]]
    tight_syms.sort(key=lambda s: -metrics[s]["score"])
    tight_syms = tight_syms[:TIGHT_LIST_SIZE]

    fund_syms = list(dict.fromkeys(main_syms + tight_syms))[:FUNDAMENTALS_LIMIT]
    funds = {}
    if not skip_fundamentals:
        log(f"fetching fundamentals for {len(fund_syms)} symbols")
        for sym in fund_syms:
            funds[sym] = fetch_fundamentals(sym)
            time.sleep(0.4)
        # フルユニバース銘柄 (セクター未付与) にyfinanceのセクターを反映
        for sym, f in funds.items():
            # 業種キーをマップに蓄積 (top_companies未収載の中小型を日々補完)
            ikey = f.pop("_industry_key", "")
            if ikey and industry_map is not None and sym not in industry_map:
                industry_map[sym] = ikey
            sec_en = f.pop("_sector", "")
            if sec_en and not metrics[sym]["sector_etf"]:
                etf, ja = SECTOR_MAP.get(sec_en, ("", sec_en))
                if etf:
                    metrics[sym]["sector_etf"] = etf
                    metrics[sym]["sector_ja"] = ja
                    # 業種グループRSが付いている銘柄は細分RSを優先し、
                    # 粗いETFセクターRSで上書きしない
                    if sym not in sym_grp:
                        metrics[sym]["sec_rs"] = sec_rs.get(etf, 50)
                        # SecRSは総合Scoreの20%を占めるため表示の整合性を保つ
                        metrics[sym]["score"] = final_score(metrics[sym])

    out = {
        "env": env,
        "env_history": env_history,
        "main": [make_row(s, metrics[s], funds.get(s, {}), "main") for s in main_syms],
        "tight": [make_row(s, metrics[s], funds.get(s, {}), "tight") for s in tight_syms],
        "sectors": sectors,
        "groups": groups[:60],
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

    # 前回出力 (ワークフローが公開サイトからダウンロードしてくれる) — ENV履歴の引き継ぎ
    prev = None
    prev_path = os.path.join(os.path.dirname(OUT_PATH), "screener_prev.json")
    if os.path.exists(prev_path):
        try:
            with open(prev_path, encoding="utf-8") as f:
                prev = json.load(f)
            log(f"loaded previous data ({len(prev.get('env_history') or [])} history entries)")
        except Exception as e:
            log("failed to load previous data:", e)

    # 業種マップ: 前回分 (ワークフローがダウンロード) を引き継いで毎日蓄積
    data_dir = os.path.dirname(OUT_PATH)
    prev_industry = {}
    imap_prev_path = os.path.join(data_dir, "industry_map_prev.json")
    if os.path.exists(imap_prev_path):
        try:
            with open(imap_prev_path, encoding="utf-8") as f:
                prev_industry = json.load(f)
            log(f"loaded previous industry map ({len(prev_industry)} symbols)")
        except Exception as e:
            log("failed to load previous industry map:", e)

    if args.selftest:
        data, universe = synthetic_data()
        # 合成業種マップでグループRS〜チャート生成まで全経路を通す
        imap = {f"TST{i:03d}": ("semiconductors" if i % 2 else "gold") for i in range(30)}
        imap["VCPX"] = "semiconductors"
        out = run(data, universe, skip_fundamentals=True, prev=prev, industry_map=imap)
        industry_map = imap
    else:
        universe = get_universe()
        if args.max_tickers:
            universe = dict(list(universe.items())[:args.max_tickers])
        symbols = list(universe.keys()) + ["SPY", "QQQ"] + list(ETF_JA.keys())
        data = batch_download(symbols)
        if "SPY" not in data:
            raise RuntimeError("SPY data missing — aborting")
        log(f"price data for {len(data)} symbols")
        try:
            industry_map = fetch_industry_map(prev_industry)
        except Exception as e:
            log("industry map fetch failed, using previous:", e)
            industry_map = prev_industry
        # run()内のファンダ取得が industry_map を直接補完する (中小型のカバレッジ蓄積)
        out = run(data, universe, prev=prev, industry_map=industry_map)

    out = jclean(out)
    os.makedirs(data_dir, exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(data_dir, "industry_map.json"), "w", encoding="utf-8") as f:
        json.dump(industry_map, f, ensure_ascii=False, separators=(",", ":"))
    write_chart_files(out, data, data["SPY"]["Close"],
                      os.path.join(data_dir, "charts"))
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

    data = {"SPY": walk(0.0006), "QQQ": walk(0.0007)}
    for etf in ETF_JA:
        data[etf] = walk(rng.uniform(-0.0005, 0.0015))
    universe = {}
    for i in range(n):
        sym = f"TST{i:03d}"
        drift = rng.uniform(-0.001, 0.0035)
        data[sym] = walk(drift, tight_tail=(i % 3 == 0))
        universe[sym] = sectors_en[i % len(sectors_en)]

    # 教科書通りのVCP形状を1銘柄入れて、検出〜表示のパイプライン全体を検証できるようにする
    seg = lambda a, b, m: list(np.linspace(a, b, m))
    px = (seg(50, 130, days - 120) + seg(130, 106, 25) + seg(106, 131, 25)
          + seg(131, 119, 20) + seg(119, 132, 20) + seg(132, 126, 15)
          + seg(126, 131.5, 15))
    # 全体に上昇ドリフトを掛けてRS上位の主導株プロファイルにする
    px = np.array(px[:days]) * np.exp(0.002 * np.arange(days))
    vol = np.full(days, 5e6)
    vol[-5:] = 2.5e6  # VDU
    data["VCPX"] = pd.DataFrame({
        "Open": px, "High": px * 1.004, "Low": px * 0.996,
        "Close": px, "Volume": vol,
    }, index=idx)
    universe["VCPX"] = "Information Technology"
    return data, universe


if __name__ == "__main__":
    main()
