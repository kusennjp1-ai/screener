#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Minervini売買ルールのバックテスト。

スクリーナーと同じ判定 (トレンドテンプレート8条件・RS百分位・買付適格性審査・
買いゾーン) を過去の各時点に適用し、「出力された価格で買い、ルール通りに売却」
した場合の成績を検証する。

制約: yfinanceでは過去時点のファンダメンタルズ時系列が取得できないため、
本テストは技術面のみの近似 (本番スクリーナーはさらにファンダで絞るため、
実運用の銘柄選別はこれより厳しい)。市場環境も日次で再現できる簡易版
(SPY vs MA200・MA200の傾き・分配日) を使う。

売買ルール (Minerviniの公開手法の数値化):
- 市場環境がBUY相当の日のみ新規買い。買いゾーン (ベース上限+5%以内、EXT追いかけ禁止)
- シグナル翌営業日の寄付で約定 (スクリーナーは引け後に読むため当日終値では買えない)
- 1銘柄 = 資金の10% (最大10銘柄)、損切りはスクリーナーと同じストップ (3〜8%)
- +12%で損切りを建値へ引き上げ / +22%で利確 (強さへの売り)
- 60営業日で停滞手仕舞い / 市場環境悪化 (日次判定) で全ポジション清算
- 取引停止/上場廃止 (価格NaNが5日継続) は最終有効終値で手仕舞い
"""

import argparse
import datetime as dt
import json
import os
import time

import numpy as np
import pandas as pd

from screener import (ETF_JA, batch_download, distribution_days, get_universe,
                      jclean, log, synthetic_data)

SLOTS = 10            # 最大保有数 (1銘柄=資金の1/SLOTS)
TARGET = 0.22         # 利確 +22%
BE_TRIGGER = 0.12     # 建値ストップへの引き上げ閾値 +12%
MAX_HOLD = 60         # 停滞手仕舞い (営業日)
EVAL_STEP = 5         # 新規買い判定の間隔 (営業日、zoneモードのみ)
RS_PCT = 0.80         # RS百分位の下限 (RS80相当)
FAST_GAIN = 0.20      # 大化け候補の判定: この利益率を…
FAST_WINDOW = 15      # …この営業日数以内に達成したら (≒3週間で+20%)
FAST_HOLD = 40        # 8週間 (≒40営業日) は+22%利確を保留して保有する


def build_matrices(data, bench=("SPY", "QQQ")):
    """銘柄×日付の行列群と派生指標を一括構築 (ETF・指数は候補から除外)。"""
    skip = set(bench) | set(ETF_JA)
    syms = [s for s in data if s not in skip]
    closes = pd.DataFrame({s: data[s]["Close"] for s in syms}).sort_index()
    highs = pd.DataFrame({s: data[s]["High"] for s in syms}).reindex(closes.index)
    lows = pd.DataFrame({s: data[s]["Low"] for s in syms}).reindex(closes.index)
    vols = pd.DataFrame({s: data[s]["Volume"] for s in syms}).reindex(closes.index)
    opens = pd.DataFrame({s: data[s]["Open"] for s in syms}).reindex(closes.index)
    m = {
        "closes": closes, "highs": highs, "lows": lows, "opens": opens,
        "ma50": closes.rolling(50).mean(),
        "ma150": closes.rolling(150).mean(),
        "ma200": closes.rolling(200).mean(),
        "hi52": highs.rolling(252, min_periods=120).max(),
        "lo52": lows.rolling(252, min_periods=120).min(),
        "h20": highs.rolling(20).max(),
        # ベース上限: 直近5日 (急騰分) を除いた20日高値 — 本番スクリーナーの
        # EXT判定と同じ基準。当日を含むh20では「c <= h20*1.05」が恒真になる
        "base20_5": highs.shift(5).rolling(20).max(),
        "l10": lows.rolling(10).min(),
        "adr20": ((highs / lows.where(lows > 0)) - 1).rolling(20).mean() * 100,
        "vols": vols,
        "vol50": vols.rolling(50).mean(),
        "dollar": (vols * closes).rolling(50).mean() / 1e6,
        "absret60": (closes.pct_change(fill_method=None).abs() * 100)
                    .rolling(60).max(),
    }
    # VCP品質ゲート用の派生指標 (vcpモード)
    spy_c = data["SPY"]["Close"].reindex(closes.index).ffill()
    rs_line = closes.div(spy_c, axis=0)            # RSライン (対SPY相対力)
    m["rs_line"] = rs_line
    m["rs_line_hi"] = rs_line.rolling(252, min_periods=120).max()
    m["l40"] = lows.rolling(40).min()              # ベースの深さ判定用
    # ピボット手前10日の値幅 (当日を除く) — タイトな収縮を要求
    m["tight10"] = (highs.shift(1).rolling(10).max()
                    / lows.shift(1).rolling(10).min() - 1)
    m["vol10p"] = vols.shift(1).rolling(10).mean()  # 直前10日の出来高 (枯れ判定)
    # masterモード用: 決算サプライズの足跡 (+8%以上の上昇日が出来高3倍以上) と
    # シグナル日の引けの強さ (日中レンジ内の終値位置)
    power = ((closes.pct_change(fill_method=None) >= 0.08)
             & (vols >= 3 * m["vol50"])).astype(float)
    m["power70"] = power.rolling(70, min_periods=1).max()
    rng = (highs - lows)
    m["clrange"] = (closes - lows).div(rng.where(rng > 0))
    return m


def peer_strength(m, i, sym):
    """業種文脈の代理: 過去126日の日次リターン相関の上位20銘柄 (疑似同業) の
    63日リターン百分位の平均。過去時点の業種マップが存在しないため、値動きの
    連動性で同業グループを近似する。判定不能 (小さな宇宙・データ不足) はNone。"""
    cl = m["closes"]
    if cl.shape[1] < 100 or i < 130:
        return None
    rets = cl.iloc[i - 126:i + 1].pct_change(fill_method=None)
    r = rets[sym]
    if r.count() < 60:
        return None
    cors = rets.corrwith(r).drop(sym).dropna()
    if len(cors) < 30:
        return None
    peers = cors.nlargest(20).index
    p63 = (cl.iloc[i] / cl.iloc[i - 63] - 1).rank(pct=True)
    return float(p63[peers].mean())


def env_state(spy, i):
    """簡易市場環境: BUY / CAUTION / DONT。
    BUYは確認済み上昇トレンドのみ: SPY > MA50 > MA200・MA200上向き・分配日4以下。"""
    c = spy["Close"]
    if i < 222:
        return "CAUTION"
    px = float(c.iloc[i])
    ma50 = float(c.iloc[i - 49:i + 1].mean())
    ma200 = float(c.iloc[i - 199:i + 1].mean())
    ma200_22 = float(c.iloc[i - 221:i - 21].mean())
    if px < ma200:
        return "DONT"
    dd = distribution_days(spy.iloc[:i + 1])
    if px > ma50 > ma200 and ma200 > ma200_22 and dd <= 4:
        return "BUY"
    return "CAUTION"


def candidates_at(m, i, mode="breakout"):
    """i日時点の買い候補をスコア順で返す [(sym, close, stop), ...]。

    mode="breakout": Minervini本来の買い方 — ベース上限 (ピボット) を当日
      出来高1.4倍以上でブレイクした銘柄のみ (前日終値はピボット以下)。
    mode="vcp": breakoutに加えて入口の質を要求 — RS90以上・RSラインが高値圏・
      ベース深さ25%以内・ピボット手前の値幅タイト化・ボラ収縮・出来高の枯れ。
      (Minerviniの勝率を支える銘柄選別のうち株価・出来高で再現可能な部分)
    mode="master": vcpに加えてテスト不能だった要素の代理ゲート — 決算サプライズ
      の足跡 (直近70日に+8%×出来高3倍の日)・疑似同業の強さ (相関上位20銘柄の
      リターン百分位60%以上)・シグナル日の強い引け (レンジ上半分)。
    mode="zone": 買いゾーン (ピボット+5%以内) に居る銘柄を全て返す旧方式。
      ブレイクの瞬間を要求しないぶん緩く、忠実度は低い (比較検証用)。"""
    c = m["closes"].iloc[i]
    ma50, ma150, ma200 = m["ma50"].iloc[i], m["ma150"].iloc[i], m["ma200"].iloc[i]
    ma200p = m["ma200"].iloc[i - 22]
    hi52, lo52 = m["hi52"].iloc[i], m["lo52"].iloc[i]
    h20 = m["h20"].iloc[i]
    # トレンドテンプレート (スクリーナーのttと同じ式)
    tt = ((c >= ma150) & (c >= ma200) & (ma150 > ma200) & (ma200 > ma200p)
          & (ma50 >= ma150) & (c >= ma50)
          & (c >= lo52 * 1.30) & (c >= hi52 * 0.75))
    # RS百分位 (加重リターン)
    cl = m["closes"]
    wret = (2 * (c / cl.iloc[max(0, i - 63)] - 1) + (c / cl.iloc[max(0, i - 126)] - 1)
            + (c / cl.iloc[max(0, i - 189)] - 1) + (c / cl.iloc[max(0, i - 252)] - 1))
    rs_pct = wret.rank(pct=True)
    dist_high = (hi52 - c) / hi52 * 100
    ok = (tt.fillna(False) & (rs_pct >= RS_PCT) & (dist_high <= 25)
          & (m["dollar"].iloc[i] >= 15) & (c >= 12)
          # 買付適格性審査 (簡易): イベント急騰・ADR過大・クライマックス乖離なし
          & (m["absret60"].iloc[i] < 18) & (m["adr20"].iloc[i] < 8)
          & (c / ma200 - 1 < 1.2)
          # 買いゾーン: ベース上限+5%以内 (EXT=上放れは追いかけない)
          & (c <= m["base20_5"].iloc[i] * 1.05))
    if mode in ("breakout", "vcp", "master"):
        base = m["base20_5"].iloc[i]
        prev_c = m["closes"].iloc[i - 1]
        ok = (ok & (c > base) & (prev_c <= base)          # 当日ピボット越え
              & (m["vols"].iloc[i] >= 1.4 * m["vol50"].iloc[i]))  # 出来高確認
    if mode in ("vcp", "master"):
        ok = (ok & (rs_pct >= 0.90)                       # 真のリーダーのみ (RS90)
              # 相対力の文脈: RSラインが52週高値圏 (市場をリードしてブレイク)
              & (m["rs_line"].iloc[i] >= m["rs_line_hi"].iloc[i] * 0.95)
              # ベースの深さ25%以内 (深い修正からのブレイクは失敗しやすい)
              & ((base - m["l40"].iloc[i]) / base <= 0.25)
              # 収縮の質: ピボット手前10日の値幅がタイト + ボラが40日前より縮小
              & (m["tight10"].iloc[i] <= 0.12)
              & (m["adr20"].iloc[i] <= m["adr20"].iloc[i - 40] * 1.001)
              # 出来高の枯れ: 直前10日の出来高が50日平均を下回る
              & (m["vol10p"].iloc[i] <= 0.95 * m["vol50"].iloc[i]))
    if mode == "master":
        ok = (ok & (m["power70"].iloc[i] >= 1)            # 決算サプライズの足跡
              & (m["clrange"].iloc[i].fillna(1.0) >= 0.5))  # 強い引け (レンジ上半分)
        # 疑似同業の強さ (業種文脈の代理) — 残った候補だけ個別に判定
        keep = [sym for sym in ok.index[ok.fillna(False)]
                if (ps := peer_strength(m, i, sym)) is None or ps >= 0.60]
        ok = ok & pd.Series(ok.index.isin(keep), index=ok.index)
    score = (0.45 * rs_pct * 99 + 0.20 * 50
             + 0.20 * (100 - np.minimum(dist_high * 4, 100)))
    out = []
    for sym in ok.index[ok.fillna(False)]:
        px = float(c[sym])
        pivot = float(h20[sym])
        stop = max(float(m["l10"].iloc[i][sym]), pivot * 0.92)
        stop = min(stop, pivot * 0.97)
        if stop < px:
            out.append((float(score[sym]), sym, px, stop))
    out.sort(reverse=True)
    return [(sym, px, stop) for _, sym, px, stop in out]


def collect_candidates(data, mode="breakout"):
    """全期間のシグナル候補銘柄の和集合 (ポートフォリオ状態に依存しない)。
    ファンダ履歴の取得対象を事前に決めるためのプレスキャン。"""
    from collections import Counter
    m = build_matrices(data)
    spy = data["SPY"].reindex(m["closes"].index).ffill()
    step = EVAL_STEP if mode == "zone" else 1
    cnt = Counter()
    for i in range(260, len(m["closes"].index)):
        if (i - 260) % step:
            continue
        if env_state(spy, i) == "BUY":
            cnt.update(s for s, _p, _st in candidates_at(m, i, mode))
    # シグナル頻度の高い順 — 取得が途中で失敗しても主要銘柄からカバーされる
    return [s for s, _ in cnt.most_common()]


def fetch_eps_history(symbols, sleep=0.3):
    """報告日付きのReported EPS実績を取得 {sym: [(報告日, EPS), ...] 新しい順}。
    シグナル日時点で判明していたEPSだけを使うための素材 (先読み防止)。"""
    import yfinance as yf
    out = {}

    def fetch_one(sym):
        ed = yf.Ticker(sym).get_earnings_dates(limit=24)
        if ed is not None and not ed.empty and "Reported EPS" in ed.columns:
            s = ed["Reported EPS"].dropna()
            if len(s):
                out[sym] = sorted(
                    ((d.date() if hasattr(d, "date") else d, float(v))
                     for d, v in s.items()), reverse=True)

    failed = []
    for sym in symbols:
        try:
            fetch_one(sym)
        except Exception:
            failed.append(sym)
        time.sleep(sleep)
    # レート制限 (429) でまとめて失敗した場合は一呼吸おいて再試行 (頻度上位のみ)
    if failed:
        time.sleep(60)
        still = []
        for sym in failed[:400]:
            try:
                fetch_one(sym)
            except Exception:
                still.append(sym)
            time.sleep(0.8)
        failed = still + failed[400:]
    log(f"eps history: {len(out)}/{len(symbols)} symbols fetched"
        + (f", {len(failed)} failed" if failed else ""))
    return out


def eps_yoy_asof(hist, asof):
    """asof日時点で報告済みだった直近四半期EPSのYoY成長率 (%)。
    4四半期前の実績が必要 — 不足はNone (本番同様、欠損では落とさない)。"""
    past = [(d, v) for d, v in (hist or []) if d < asof]
    if len(past) < 5:
        return None
    cur, prev = past[0][1], past[4][1]
    if prev == 0:
        return None
    return (cur - prev) / abs(prev) * 100


def simulate(data, capital=1_000_000.0, slots=SLOTS, target=TARGET,
             be_trigger=BE_TRIGGER, max_hold=MAX_HOLD, eval_step=None,
             mode="breakout", eps_hist=None):
    """日次ウォークフォワード・シミュレーション。
    breakoutモードはブレイクの瞬間を逃さないようシグナル判定も日次。
    eps_hist (fetch_eps_historyの結果) を渡すと、シグナル日時点で減益が
    判明していた銘柄の買いを見送る (本番スクリーナーのファンダゲート相当)。"""
    if eval_step is None:
        eval_step = EVAL_STEP if mode == "zone" else 1
    m = build_matrices(data)
    dates = m["closes"].index
    # SPYを銘柄群と同じ日付軸に揃える (位置ズレによる先読みを防ぐ)
    spy = data["SPY"].reindex(dates).ffill()
    spy_c = spy["Close"]
    start = 260
    if len(dates) <= start + 10:
        raise RuntimeError("backtest needs > 270 bars")

    cash = capital
    positions = {}   # sym -> dict(entry, stop, shares, entry_i, be_done, ...)
    pending = []     # 前回シグナル [(sym, stop)] — 翌営業日の寄付で約定
    trades = []
    equity_curve = []

    def equity(i):
        val = cash
        for sym, p in positions.items():
            px = m["closes"].iat[i, m["closes"].columns.get_loc(sym)]
            val += p["shares"] * (float(px) if px == px else p["last_close"])
        return val

    def close_pos(sym, i, price, reason):
        nonlocal cash
        p = positions.pop(sym)
        cash += p["shares"] * price
        trades.append({
            "sym": sym, "entry_date": str(dates[p["entry_i"]].date()),
            "exit_date": str(dates[i].date()),
            "entry": round(p["entry"], 2), "exit": round(price, 2),
            "pnl_pct": round((price / p["entry"] - 1) * 100, 2),
            "days": int(i - p["entry_i"]), "reason": reason,
        })

    for i in range(start, len(dates)):
        # --- 寄付: 前回シグナルの約定 (引け後のスクリーナーで当日終値では買えない)
        for sym, stop, pivot in pending:
            if len(positions) >= slots or sym in positions:
                continue
            col = m["closes"].columns.get_loc(sym)
            o = float(m["opens"].iat[i, col])
            if not o == o or o <= stop:
                continue
            eq = equity(i - 1)
            alloc = min(eq / slots, cash)
            if alloc < eq / slots * 0.5:
                break
            shares = alloc / o
            cash -= shares * o
            positions[sym] = {"entry": o, "stop": stop, "shares": shares,
                              "entry_i": i, "be_done": False, "fast": False,
                              "pivot": pivot, "trail": False,
                              "last_close": o, "nan_days": 0}
        pending = []

        # --- 保有ポジションの日次管理 (約定当日は除く)
        for sym in list(positions):
            p = positions[sym]
            if p["entry_i"] == i:
                continue
            col = m["closes"].columns.get_loc(sym)
            o = float(m["opens"].iat[i, col])
            h = float(m["highs"].iat[i, col])
            l = float(m["lows"].iat[i, col])
            c = float(m["closes"].iat[i, col])
            if not (c == c and l == l):
                # 取引停止/上場廃止: 5日続いたら最終有効終値で手仕舞い
                p["nan_days"] += 1
                if p["nan_days"] >= 5:
                    close_pos(sym, i, p["last_close"], "取引停止/廃止")
                continue
            p["nan_days"] = 0
            p["last_close"] = c
            held = i - p["entry_i"]
            # 3週間で+20%の急騰銘柄は大化け候補 — 8週間は+22%利確を保留して保有
            if not p["fast"] and held <= FAST_WINDOW and c >= p["entry"] * (1 + FAST_GAIN):
                p["fast"] = True
            in_fast_hold = p["fast"] and held < FAST_HOLD
            tgt = p["entry"] * (1 + target)
            stop_label = ("トレール利確" if p.get("trail")
                          else "建値撤退" if p["be_done"] else None)
            if o == o and o <= p["stop"]:
                close_pos(sym, i, o, stop_label or "損切り(寄付GD)")
            elif l <= p["stop"]:
                close_pos(sym, i, p["stop"], stop_label or "損切り")
            elif mode == "master" and held <= 5 and c < p["pivot"]:
                # 売りの裁量(1): ブレイクが続かずピボット下で引けたら即撤退
                close_pos(sym, i, c, "ブレイク失敗")
            elif p["fast"] and held >= FAST_HOLD:
                close_pos(sym, i, c, "8週保有後利確")
            elif not in_fast_hold and h >= tgt:
                close_pos(sym, i, tgt, "利確+22%")
            elif held >= max_hold:
                close_pos(sym, i, c, "停滞60日")
            elif not p["be_done"] and c >= p["entry"] * (1 + be_trigger):
                p["stop"] = max(p["stop"], p["entry"])
                p["be_done"] = True
            # 売りの裁量(2): +15%到達後は10日安値でトレール (強さの中で守る)
            if (sym in positions and mode == "master"
                    and c >= p["entry"] * 1.15):
                l10 = float(m["l10"].iat[i, col])
                if l10 == l10 and l10 > p["stop"]:
                    p["stop"] = l10
                    if l10 > p["entry"]:
                        p["trail"] = True

        # --- 市場環境は日次で判定 (悪化時の清算を遅らせない)
        env = env_state(spy, i)
        if env == "DONT" and positions:
            for sym in list(positions):
                col = m["closes"].columns.get_loc(sym)
                c = float(m["closes"].iat[i, col])
                close_pos(sym, i, c if c == c else positions[sym]["last_close"],
                          "市場環境悪化")
        # --- 新規買いシグナルは週次 (翌日寄付で約定)
        elif (i - start) % eval_step == 0 and env == "BUY" and len(positions) < slots:
            pending = []
            asof = dates[i].date()
            for sym, _px, stop in candidates_at(m, i, mode):
                if eps_hist is not None:
                    g = eps_yoy_asof(eps_hist.get(sym), asof)
                    if g is not None and g < 0:
                        continue  # シグナル時点で減益が判明 → 本番同様に見送り
                pivot = float(m["base20_5"].iat[i, m["closes"].columns.get_loc(sym)])
                pending.append((sym, stop, pivot))
        equity_curve.append((str(dates[i].date()), round(equity(i), 0)))

    # 末日清算 (未決済分の評価確定 — 統計では「未完了」として別集計)
    last = len(dates) - 1
    for sym in list(positions):
        col = m["closes"].columns.get_loc(sym)
        c = float(m["closes"].iat[last, col])
        close_pos(sym, last, c if c == c else positions[sym]["last_close"], "末日清算")

    return summarize(trades, equity_curve, capital, spy_c, dates, start, mode,
                     fund_gated=eps_hist is not None and len(eps_hist) > 0)


def summarize(trades, equity_curve, capital, spy_c, dates, start,
              mode="breakout", fund_gated=False):
    # 勝率・期待値等は「ルール通りに完了した」トレードのみで計算する。
    # 末日清算 (未完了の評価替え) を混ぜると成績が歪む
    closed = [t for t in trades if t["reason"] != "末日清算"]
    wins = [t for t in closed if t["pnl_pct"] > 0]
    losses = [t for t in closed if t["pnl_pct"] <= 0]
    eq = np.array([v for _, v in equity_curve], dtype=float)
    peak = np.maximum.accumulate(eq)
    max_dd = float(((eq - peak) / peak).min() * 100) if len(eq) else 0.0
    spy_ret = float(spy_c.iloc[-1] / spy_c.iloc[start] - 1) * 100
    total_ret = float(eq[-1] / capital - 1) * 100 if len(eq) else 0.0
    avg_win = float(np.mean([t["pnl_pct"] for t in wins])) if wins else 0.0
    avg_loss = float(np.mean([t["pnl_pct"] for t in losses])) if losses else 0.0
    win_rate = len(wins) / len(closed) * 100 if closed else 0.0
    expectancy = (win_rate / 100 * avg_win + (1 - win_rate / 100) * avg_loss)
    gross_w = sum(t["pnl_pct"] for t in wins)
    gross_l = abs(sum(t["pnl_pct"] for t in losses))
    stats = {
        "方式": {"breakout": "ブレイクアウト型 (ピボット越え+出来高確認)",
               "vcp": "VCP型 (ブレイクアウト+収縮の質+RS90+RSライン高値圏)",
               "master": "マスター型 (VCP+決算足跡+疑似同業+引けの質+売り裁量)",
               "zone": "ゾーン型 (買いゾーン内を週次バスケット買い)"}[mode],
        "ファンダゲート": ("有効 (シグナル日時点のEPS実績で減益を除外)"
                    if fund_gated else "無効 (技術面のみ)"),
        "期間": f"{equity_curve[0][0]} 〜 {equity_curve[-1][0]}" if equity_curve else "",
        "トレード数": len(closed),
        "未完了(末日清算)": len(trades) - len(closed),
        "勝率%": round(win_rate, 1),
        "平均利益%": round(avg_win, 2), "平均損失%": round(avg_loss, 2),
        "ペイオフレシオ": round(abs(avg_win / avg_loss), 2) if avg_loss else None,
        "期待値%": round(expectancy, 2),
        "プロフィットファクター": round(gross_w / gross_l, 2) if gross_l else None,
        "合計リターン%": round(total_ret, 2),
        "SPY同期間%": round(spy_ret, 2),
        "最大ドローダウン%": round(max_dd, 2),
        "出口内訳": {r: sum(1 for t in trades if t["reason"] == r)
                  for r in sorted({t["reason"] for t in trades})},
    }
    eq5 = equity_curve[::5]
    if equity_curve and (not eq5 or eq5[-1] != equity_curve[-1]):
        eq5.append(equity_curve[-1])  # 最終日を必ず含める
    return {"stats": stats, "trades": trades, "equity": eq5}


def report(result):
    s = result["stats"]
    log("=" * 56)
    log("Minervini売買ルール バックテスト結果 (技術面のみの近似)")
    log("=" * 56)
    for k, v in s.items():
        log(f"  {k}: {v}")
    log("-" * 56)
    for t in result["trades"][-15:]:
        log(f"  {t['entry_date']} {t['sym']:<6} {t['entry']:>8.2f}→{t['exit']:>8.2f} "
            f"{t['pnl_pct']:+6.1f}% {t['days']:>3}日 {t['reason']}")


def run_check(data, spec):
    """実在トレード (例: Minervini USIC 2021の公開エントリー) との答え合わせ。
    SYM:YYYY-MM-DD → その日±3営業日に各モードのゲートを通るか。
    SYM:YYYY → その年に通った日付を列挙 (エントリー日が不明な銘柄用)。"""
    m = build_matrices(data)
    dates = m["closes"].index
    modes = ("breakout", "vcp", "master")
    for item in spec.split(","):
        sym, _, ds = item.strip().partition(":")
        if sym not in m["closes"].columns:
            log(f"check {sym}: データなし")
            continue
        if len(ds) == 4:  # 年指定 → その年のヒット日を列挙
            hits = {md: [] for md in modes}
            for i in range(260, len(dates)):
                if str(dates[i].year) != ds:
                    continue
                for md in modes:
                    if any(s == sym for s, _p, _st in candidates_at(m, i, md)):
                        hits[md].append(str(dates[i].date()))
            log(f"check {sym} ({ds}年): " + " / ".join(
                f"{md}={','.join(h) if (h := hits[md]) else '×'}" for md in modes))
        else:
            d = pd.Timestamp(ds)
            base_i = int(dates.searchsorted(d))
            res = {}
            for md in modes:
                hit = ""
                for off in range(-3, 4):
                    j = base_i + off
                    if 260 <= j < len(dates) and any(
                            s == sym for s, _p, _st in candidates_at(m, j, md)):
                        hit = str(dates[j].date())
                        break
                res[md] = hit or "×"
            log(f"check {sym} @{ds}: " + " / ".join(
                f"{md}={res[md]}" for md in modes))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=float, default=2.0, help="検証期間 (年)")
    ap.add_argument("--mode", choices=("breakout", "vcp", "master", "zone"),
                    default="breakout",
                    help="breakout=ピボット越え+出来高確認 / vcp=+収縮の質とRS90 / "
                         "master=+決算足跡・疑似同業・売り裁量 / zone=旧ゾーン買い")
    ap.add_argument("--check", default="",
                    help="SYM:YYYY-MM-DD または SYM:YYYY をカンマ区切りで指定し、"
                         "実在トレードが各モードのゲートを通るか検査")
    ap.add_argument("--fund", choices=("on", "off"), default="on",
                    help="on=シグナル日時点のEPS実績で減益銘柄を除外 (2パス)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        data, _ = synthetic_data(n=40, days=600)
        result = simulate(data, mode=args.mode)
    else:
        universe = get_universe()
        months = int(args.years * 12 + 14)  # ウォームアップ約260営業日分を上乗せ
        symbols = list(universe.keys()) + ["SPY", "QQQ"] + list(ETF_JA.keys())
        data = batch_download(symbols, period=f"{months}mo")
        if "SPY" not in data:
            raise RuntimeError("SPY data missing")
        log(f"backtest: price data for {len(data)} symbols, "
            f"{args.years} years, mode={args.mode}, fund={args.fund}")
        eps_hist = None
        if args.fund == "on":
            # 2パス方式: 全期間のシグナル候補を先に集め、その銘柄だけ
            # 報告日付きEPS実績を取得する (シグナル日時点の判明分のみ使用)
            cand = collect_candidates(data, mode=args.mode)
            log(f"fund gate: fetching EPS history for {len(cand)} signal candidates")
            # 価格一括ダウンロード直後はレート枠が枯渇している (run #5で800中794失敗)
            time.sleep(90)
            eps_hist = fetch_eps_history(cand[:800], sleep=0.5)
        result = simulate(data, mode=args.mode, eps_hist=eps_hist)
        if args.check:
            run_check(data, args.check)

    report(result)
    os.makedirs("data", exist_ok=True)
    with open(os.path.join("data", "backtest.json"), "w", encoding="utf-8") as f:
        json.dump(jclean(result), f, ensure_ascii=False, separators=(",", ":"))
    log("wrote data/backtest.json")


if __name__ == "__main__":
    main()
