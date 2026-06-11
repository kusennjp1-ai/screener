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

import numpy as np
import pandas as pd

from screener import (ETF_JA, batch_download, distribution_days, get_universe,
                      jclean, log, synthetic_data)

SLOTS = 10            # 最大保有数 (1銘柄=資金の1/SLOTS)
TARGET = 0.22         # 利確 +22%
BE_TRIGGER = 0.12     # 建値ストップへの引き上げ閾値 +12%
MAX_HOLD = 60         # 停滞手仕舞い (営業日)
EVAL_STEP = 5         # 新規買い判定の間隔 (営業日)
RS_PCT = 0.80         # RS百分位の下限 (RS80相当)


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
    return m


def env_state(spy, i):
    """簡易市場環境: BUY / CAUTION / DONT。"""
    c = spy["Close"]
    if i < 222:
        return "CAUTION"
    px = float(c.iloc[i])
    ma200 = float(c.iloc[i - 199:i + 1].mean())
    ma200_22 = float(c.iloc[i - 221:i - 21].mean())
    if px < ma200:
        return "DONT"
    dd = distribution_days(spy.iloc[:i + 1])
    if ma200 > ma200_22 and dd <= 5:
        return "BUY"
    return "CAUTION"


def candidates_at(m, i, mode="breakout"):
    """i日時点の買い候補をスコア順で返す [(sym, close, stop), ...]。

    mode="breakout": Minervini本来の買い方 — ベース上限 (ピボット) を当日
      出来高1.4倍以上でブレイクした銘柄のみ (前日終値はピボット以下)。
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
    if mode == "breakout":
        base = m["base20_5"].iloc[i]
        prev_c = m["closes"].iloc[i - 1]
        ok = (ok & (c > base) & (prev_c <= base)          # 当日ピボット越え
              & (m["vols"].iloc[i] >= 1.4 * m["vol50"].iloc[i]))  # 出来高確認
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


def simulate(data, capital=1_000_000.0, slots=SLOTS, target=TARGET,
             be_trigger=BE_TRIGGER, max_hold=MAX_HOLD, eval_step=None,
             mode="breakout"):
    """日次ウォークフォワード・シミュレーション。
    breakoutモードはブレイクの瞬間を逃さないようシグナル判定も日次。"""
    if eval_step is None:
        eval_step = 1 if mode == "breakout" else EVAL_STEP
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
        for sym, stop in pending:
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
                              "entry_i": i, "be_done": False,
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
            tgt = p["entry"] * (1 + target)
            if o == o and o <= p["stop"]:
                close_pos(sym, i, o, "建値撤退" if p["be_done"] else "損切り(寄付GD)")
            elif l <= p["stop"]:
                close_pos(sym, i, p["stop"], "建値撤退" if p["be_done"] else "損切り")
            elif h >= tgt:
                close_pos(sym, i, tgt, "利確+22%")
            elif i - p["entry_i"] >= max_hold:
                close_pos(sym, i, c, "停滞60日")
            elif not p["be_done"] and c >= p["entry"] * (1 + be_trigger):
                p["stop"] = max(p["stop"], p["entry"])
                p["be_done"] = True

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
            pending = [(sym, stop) for sym, _px, stop in candidates_at(m, i, mode)]
        equity_curve.append((str(dates[i].date()), round(equity(i), 0)))

    # 末日清算 (未決済分の評価確定 — 統計では「未完了」として別集計)
    last = len(dates) - 1
    for sym in list(positions):
        col = m["closes"].columns.get_loc(sym)
        c = float(m["closes"].iat[last, col])
        close_pos(sym, last, c if c == c else positions[sym]["last_close"], "末日清算")

    return summarize(trades, equity_curve, capital, spy_c, dates, start, mode)


def summarize(trades, equity_curve, capital, spy_c, dates, start, mode="breakout"):
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
        "方式": ("ブレイクアウト型 (ピボット越え+出来高確認)" if mode == "breakout"
               else "ゾーン型 (買いゾーン内を週次バスケット買い)"),
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


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--years", type=float, default=2.0, help="検証期間 (年)")
    ap.add_argument("--mode", choices=("breakout", "zone"), default="breakout",
                    help="breakout=ピボット越え+出来高確認 / zone=旧ゾーン買い (比較用)")
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
            f"{args.years} years, mode={args.mode}")
        result = simulate(data, mode=args.mode)

    report(result)
    os.makedirs("data", exist_ok=True)
    with open(os.path.join("data", "backtest.json"), "w", encoding="utf-8") as f:
        json.dump(jclean(result), f, ensure_ascii=False, separators=(",", ":"))
    log("wrote data/backtest.json")


if __name__ == "__main__":
    main()
