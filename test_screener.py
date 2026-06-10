#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
screener.py の独立検証スイート (Verifier)。

スクリーナー本体の実装を信用せず、Minerviniのルールから第一原理で
構築した「正解が自明な」合成ケースに対して判定を採点する。
GitHub Actions ではデータ生成前のゲートとして実行される。
"""

import datetime as dt
import json
import math
import unittest

import numpy as np
import pandas as pd

import screener as sc


# ---------------------------------------------------------------- fixtures

def mkdf(close, vol=None, high=None, low=None):
    n = len(close)
    idx = pd.bdate_range(end=dt.date.today(), periods=n)
    close = pd.Series(np.asarray(close, dtype=float), index=idx)
    high = pd.Series(np.asarray(high, dtype=float), index=idx) if high is not None else close * 1.005
    low = pd.Series(np.asarray(low, dtype=float), index=idx) if low is not None else close * 0.995
    vol = pd.Series(np.asarray(vol, dtype=float), index=idx) if vol is not None else pd.Series(5e6, index=idx)
    return pd.DataFrame({"Open": close, "High": high, "Low": low, "Close": close, "Volume": vol})


def uptrend(days=320, start=50.0, end=100.0):
    """単調上昇 — 教科書通りのStage 2銘柄。"""
    return mkdf(np.geomspace(start, end, days))


def downtrend(days=320, start=100.0, end=50.0):
    return mkdf(np.geomspace(start, end, days))


def flat_spy(days=320, level=500.0):
    return mkdf(np.full(days, level) * np.linspace(0.98, 1.0, days))


def segment(a, b, n):
    return list(np.linspace(a, b, n))


# ---------------------------------------------------------------- tests

class TrendTemplate(unittest.TestCase):
    def test_stage2_passes(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(uptrend(), spy)
        self.assertTrue(m["tt"], "教科書通りの上昇トレンドはテンプレートを通過すべき")
        self.assertTrue(m["above_ma200"])

    def test_downtrend_fails(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(downtrend(), spy)
        self.assertFalse(m["tt"], "ダウントレンドはテンプレートで落とすべき")

    def test_off_high_fails(self):
        # 上昇後に高値から35%下落 → 「52週高値から25%以内」条件で落ちる
        px = segment(50, 100, 250) + segment(100, 65, 70)
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(px), spy)
        self.assertFalse(m["tt"])

    def test_short_history_no_crash(self):
        spy = flat_spy(130)["Close"]
        m = sc.compute_metrics(uptrend(125), spy)  # MA200が計算できない長さ
        self.assertFalse(m["tt"], "MA200が計算不能ならStage2と判定しない")


class Signals(unittest.TestCase):
    def test_vdu_detected(self):
        vol = [5e6] * 315 + [2e6] * 5  # 直近5日の出来高が平常時の40%
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(np.geomspace(50, 100, 320), vol=vol), spy)
        self.assertTrue(m["vdu"])

    def test_no_vdu_on_normal_volume(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(uptrend(), spy)
        self.assertFalse(m["vdu"])

    def test_breakout_volume(self):
        vol = [5e6] * 319 + [9e6]  # 最終日に出来高1.8倍 + 上昇
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(np.geomspace(50, 100, 320), vol=vol), spy)
        self.assertTrue(m["bkt"])

    def test_tight_range(self):
        px = segment(50, 100, 305) + [100.0] * 15  # 直近2週間は完全フラット
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(px), spy)
        self.assertLess(m["range10"], 2.0)

    def test_pivot_stop_sane(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(uptrend(), spy)
        self.assertGreater(m["pivot"], m["stop"])
        self.assertGreaterEqual(m["risk"], 2.9, "リスクは約3%以上に正規化される")
        self.assertLessEqual(m["risk"], 8.1, "Minervini流: ストップは8%以内")

    def test_zero_volume_no_crash(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(np.geomspace(50, 100, 320), vol=[0.0] * 320), spy)
        self.assertFalse(m["vdu"])
        self.assertFalse(m["bkt"])

    def test_nan_volume_no_crash(self):
        vol = [5e6] * 320
        vol[200] = np.nan
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(np.geomspace(50, 100, 320), vol=vol), spy)
        self.assertIsNotNone(m["vol_m"])
        self.assertFalse(math.isnan(m["vol_m"]))


class VCP(unittest.TestCase):
    """ボラティリティ収縮パターン: 押しが 20% → 10% → 5% と縮む。"""

    def _vcp_price(self):
        px = segment(50, 100, 170)          # 上昇
        px += segment(100, 80, 25)          # 押し1: -20%
        px += segment(80, 101, 25)          # 新高値
        px += segment(101, 91, 20)          # 押し2: -9.9%
        px += segment(91, 102, 20)          # 新高値
        px += segment(102, 97.5, 15)        # 押し3: -4.4%
        px += segment(97.5, 101.5, 15)      # 高値圏で保ち合い
        return px

    def test_contractions_detected(self):
        df = mkdf(self._vcp_price())
        depths = sc.contraction_depths(df["High"], df["Low"])
        self.assertGreaterEqual(len(depths), 3)
        # 各収縮が前の収縮より浅い (順序が保存されている)
        sig = [d for d in depths if d >= 0.04]
        self.assertEqual(sig, sorted(sig, reverse=True), f"収縮は浅くなっていくはず: {depths}")

    def test_vcp_flag(self):
        spy = flat_spy(len(self._vcp_price()))["Close"]
        m = sc.compute_metrics(mkdf(self._vcp_price()), spy)
        self.assertTrue(m["vcp"], "教科書通りのVCPはフラグが立つべき")

    def test_no_vcp_on_expanding_volatility(self):
        # 押しがどんどん深くなる: 5% → 10% → 20% は VCP ではない
        px = segment(50, 100, 170)
        px += segment(100, 95, 20) + segment(95, 101, 20)
        px += segment(101, 91, 25) + segment(91, 102, 25)
        px += segment(102, 82, 20) + segment(82, 95, 10)
        spy = flat_spy(len(px))["Close"]
        m = sc.compute_metrics(mkdf(px), spy)
        self.assertFalse(m["vcp"])


class MarketEnv(unittest.TestCase):
    def _metrics(self, n, above_frac, stage2_frac):
        ms = {}
        for i in range(n):
            ms[f"S{i}"] = {"above_ma200": i < n * above_frac,
                           "stage2": i < n * stage2_frac, "rs": 90 if i < n * 0.3 else 40}
        return ms

    def test_bull_market(self):
        spy = mkdf(np.geomspace(400, 500, 320), vol=np.linspace(6e6, 5e6, 320))
        env = sc.market_env(spy, self._metrics(100, 0.8, 0.4), dt.date.today(), prev=None)
        self.assertEqual(env["status"], "BUY MODE")
        self.assertGreaterEqual(env["env_score"], 65)
        self.assertEqual(env["dist_days"], 0)

    def test_bear_market(self):
        spy = mkdf(np.geomspace(500, 380, 320), vol=np.linspace(6e6, 5e6, 320))
        env = sc.market_env(spy, self._metrics(100, 0.1, 0.0), dt.date.today(), prev=None)
        self.assertEqual(env["status"], "DO NOT BUY")

    def test_distribution_days_counted(self):
        # フラットなSPYに、出来高増を伴う-0.5%の日を正確に3日仕込む
        n = 320
        px = [500.0]
        for i in range(1, n):
            px.append(px[-1] * (0.995 if i in (n - 5, n - 10, n - 15) else 1.0005))
        vol = [5e6] * n
        for i in (n - 5, n - 10, n - 15):
            vol[i] = 7e6
        env = sc.market_env(mkdf(px, vol=vol), self._metrics(10, 1.0, 0.5),
                            dt.date.today(), prev=None)
        self.assertEqual(env["dist_days"], 3)

    def test_many_dist_days_demote_buy(self):
        # 強い上昇トレンドでも分配日6日ならBUY MODEにしない
        n = 320
        px = list(np.geomspace(400, 500, n))
        vol = [5e6] * n
        for k in range(1, 7):
            i = n - 3 * k
            px[i] = px[i - 1] * 0.99
            vol[i] = 8e6
        env = sc.market_env(mkdf(px, vol=vol), self._metrics(100, 0.9, 0.5),
                            dt.date.today(), prev=None)
        self.assertGreaterEqual(env["dist_days"], 6)
        self.assertNotEqual(env["status"], "BUY MODE")

    def test_env_history_appended(self):
        spy = mkdf(np.geomspace(400, 500, 320), vol=np.linspace(6e6, 5e6, 320))
        prev = {"env_history": [{"d": "2026-06-01", "s": 50, "st": "CAUTION"}]}
        env = sc.market_env(spy, self._metrics(100, 0.8, 0.4), dt.date.today(), prev=prev)
        hist = env["env_history"]
        self.assertEqual(hist[0]["d"], "2026-06-01")
        self.assertEqual(hist[-1]["d"], f"{dt.date.today():%Y-%m-%d}")
        self.assertEqual(hist[-1]["s"], env["env_score"])

    def test_env_history_same_day_replaced(self):
        spy = mkdf(np.geomspace(400, 500, 320), vol=np.linspace(6e6, 5e6, 320))
        today = f"{dt.date.today():%Y-%m-%d}"
        prev = {"env_history": [{"d": today, "s": 1, "st": "CAUTION"}]}
        env = sc.market_env(spy, self._metrics(100, 0.8, 0.4), dt.date.today(), prev=prev)
        self.assertEqual(len(env["env_history"]), 1, "同じ日付は置き換える (重複させない)")

    def test_env_history_capped(self):
        spy = mkdf(np.geomspace(400, 500, 320), vol=np.linspace(6e6, 5e6, 320))
        prev = {"env_history": [{"d": f"2026-01-{i:02d}", "s": 50, "st": "CAUTION"} for i in range(1, 29)]
                + [{"d": f"2026-02-{i:02d}", "s": 50, "st": "CAUTION"} for i in range(1, 29)]
                + [{"d": f"2026-03-{i:02d}", "s": 50, "st": "CAUTION"} for i in range(1, 29)]}
        env = sc.market_env(spy, self._metrics(100, 0.8, 0.4), dt.date.today(), prev=prev)
        self.assertLessEqual(len(env["env_history"]), 60)


class Pipeline(unittest.TestCase):
    def test_rs_ordering(self):
        days = 320
        data = {
            "SPY": flat_spy(),
            "STRONG": uptrend(days, 50, 120),
            "MID": uptrend(days, 50, 70),
            "WEAK": downtrend(days),
        }
        universe = {"STRONG": "Energy", "MID": "Energy", "WEAK": "Energy"}
        out = sc.run(data, universe, skip_fundamentals=True)
        rs = {}
        for row in out["main"] + out["tight"]:
            rs[row["シンボル"]] = row["RS"]
        # 少なくともSTRONGはリスト入りしRSが高い
        self.assertIn("STRONG", rs)
        self.assertGreaterEqual(rs["STRONG"], 90)

    def test_schema_complete(self):
        data, universe = sc.synthetic_data()
        out = sc.jclean(sc.run(data, universe, skip_fundamentals=True))
        for key in ("env", "main", "tight", "sectors", "env_history"):
            self.assertIn(key, out)
        env_keys = {"status", "date", "env_score", "spy", "spy_ma200_pct", "spy_ma50_pct",
                    "dist_days", "pct_above_ma200", "stage2_count", "updated_at"}
        self.assertTrue(env_keys <= set(out["env"].keys()))
        if out["main"]:
            row_keys = {"シンボル", "セクター", "セクターRS数値", "RS", "★", "ファンダG",
                        "出来高$M", "総合Score", "高値比%", "RSライン52日", "VDU",
                        "BKT出来高", "VCP", "Code33", "有望理由",
                        "ピボット", "ストップ", "RR比", "リスク%", "深さ%", "ADR%"}
            self.assertTrue(row_keys <= set(out["main"][0].keys()),
                            f"missing: {row_keys - set(out['main'][0].keys())}")
        if out["tight"]:
            self.assertIn("値幅%", out["tight"][0])
            self.assertIn("リスト種別", out["tight"][0])
        self.assertEqual(len(out["sectors"]), 11)
        # JSONに NaN が残っていないこと (JSはNaNをパースできない)
        s = json.dumps(out, ensure_ascii=False)
        self.assertNotIn("NaN", s)
        self.assertNotIn("Infinity", s)

    def test_missing_symbols_tolerated(self):
        data = {"SPY": flat_spy(), "AAA": uptrend()}
        out = sc.run(data, {"AAA": "Energy", "GONE": "Energy"}, skip_fundamentals=True)
        self.assertIsInstance(out["main"], list)

    def test_jclean_handles_numpy(self):
        out = sc.jclean({"a": np.int64(3), "b": np.float64(1.5), "c": float("nan"),
                         "d": np.bool_(True), "e": [np.float64("inf")]})
        self.assertEqual(out, {"a": 3, "b": 1.5, "c": None, "d": True, "e": [None]})


class Adversarial(unittest.TestCase):
    """設計時に想定していなかった入力で壊れないかを攻める。"""

    def test_constant_price(self):
        px = np.full(320, 50.0)
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(px, high=px, low=px), spy)
        self.assertFalse(m["tt"], "値動きゼロは52週安値+30%条件で落ちる")
        self.assertFalse(m["vcp"])
        self.assertEqual(m["range10"], 0.0)
        self.assertGreater(m["pivot"], m["stop"], "値動きゼロでもストップ<ピボットを維持")

    def test_huge_gap_up(self):
        # 200日横ばい→翌日2倍ギャップ→100日高値圏維持: 正真正銘のStage 2
        px = [50.0] * 200 + [100.0] * 120
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(px), spy)
        self.assertTrue(m["tt"])
        self.assertLessEqual(m["risk"], 8.1)

    def test_rs_bounds(self):
        data, universe = sc.synthetic_data(n=80)
        out = sc.run(data, universe, skip_fundamentals=True)
        for row in out["main"] + out["tight"]:
            self.assertGreaterEqual(row["RS"], 1)
            self.assertLessEqual(row["RS"], 99)
            self.assertGreaterEqual(row["セクターRS数値"], 0)
            self.assertLessEqual(row["セクターRS数値"], 99)

    def test_env_with_empty_metrics(self):
        spy = mkdf(np.geomspace(400, 500, 320))
        env = sc.market_env(spy, {}, dt.date.today(), prev=None)
        self.assertIn(env["status"], ("BUY MODE", "CAUTION", "DO NOT BUY"))

    def test_penny_stock_excluded_from_lists(self):
        data = {"SPY": flat_spy(), "PENNY": uptrend(320, 2.0, 5.0)}
        out = sc.run(data, {"PENNY": "Energy"}, skip_fundamentals=True)
        syms = [r["シンボル"] for r in out["main"] + out["tight"]]
        self.assertNotIn("PENNY", syms, "12ドル未満はリストから除外")

    def test_consecutive_runs_accumulate_history(self):
        data, universe = sc.synthetic_data(n=20)
        out1 = sc.run(data, universe, skip_fundamentals=True)
        out2 = sc.run(data, universe, skip_fundamentals=True, prev=out1)
        # 同一営業日の再実行では履歴が重複しない
        self.assertEqual(len(out2["env_history"]), len(out1["env_history"]))
        # 別の日付の履歴は引き継がれて伸びる
        fake_prev = {"env_history": [{"d": "2020-01-01", "s": 10, "st": "DO NOT BUY"}]
                     + out1["env_history"]}
        out3 = sc.run(data, universe, skip_fundamentals=True, prev=fake_prev)
        self.assertEqual(len(out3["env_history"]), len(out1["env_history"]) + 1)

    def test_old_format_prev_tolerated(self):
        # 旧フォーマット (env_historyなし・envだけ) のprevでも動く
        data, universe = sc.synthetic_data(n=20)
        out = sc.run(data, universe, skip_fundamentals=True,
                     prev={"env": {"status": "BUY MODE"}, "main": []})
        self.assertEqual(len(out["env_history"]), 1)

    def test_reason_text_is_string(self):
        data, universe = sc.synthetic_data()
        out = sc.run(data, universe, skip_fundamentals=True)
        for row in out["main"] + out["tight"]:
            self.assertIsInstance(row["有望理由"], str)


if __name__ == "__main__":
    unittest.main(verbosity=2)
