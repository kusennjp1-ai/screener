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
import sys
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


class UniverseParser(unittest.TestCase):
    """NASDAQ Trader シンボルディレクトリのパース — Minervini級フルユニバースの入口。"""

    NASDAQ_SAMPLE = """Symbol|Security Name|Market Category|Test Issue|Financial Status|Round Lot Size|ETF|NextShares
AAPL|Apple Inc. - Common Stock|Q|N|N|100|N|N
ZWZZT|NASDAQ TEST STOCK|Q|Y|N|100|N|N
TQQQ|ProShares UltraPro QQQ|G|N|N|100|Y|N
ABCDW|ABC Corp - Warrant|Q|N|N|100|N|N
ABCDR|ABC Corp - Rights|Q|N|N|100|N|N
ABCDU|ABC Corp - Units|Q|N|N|100|N|N
GFND|Global Growth Fund Inc.|Q|N|N|100|N|N
NVDA|NVIDIA Corporation - Common Stock|Q|N|N|100|N|N
ARM|Arm Holdings plc - American Depositary Shares|Q|N|N|100|N|N
BNKR|Bankrupt Corp - Common Stock|Q|N|Q|100|N|N
File Creation Time: 0610202622:01|||||||"""

    OTHER_SAMPLE = """ACT Symbol|Security Name|Exchange|CQS Symbol|ETF|Round Lot Size|Test Issue|NASDAQ Symbol
BRK.B|Berkshire Hathaway Inc. Class B Common Stock|N|BRK B|N|100|N|BRK=B
XYZ$A|XYZ Corp 5.25% Preferred Series A|N|XYZpA|N|100|N|XYZ-A
SPYX|SPDR Something ETF|P|SPYX|Y|100|N|SPYX
GM|General Motors Company Common Stock|N|GM|N|100|N|GM
TSM|Taiwan Semiconductor Manufacturing Company Ltd. American Depositary Shares|N|TSM|N|100|N|TSM
DPN|ABC Corp Depositary Shares Each Representing 1/1000th Interest in 5.00% Preferred Series A|N|DPN|N|100|N|DPN
File Creation Time: 0610202622:01|||||||"""

    def test_nasdaq_file(self):
        syms = sc.parse_listed_file(self.NASDAQ_SAMPLE, "Symbol")
        self.assertIn("AAPL", syms)
        self.assertIn("NVDA", syms)
        self.assertIn("ARM", syms, "ADR (American Depositary Shares) は普通株として含める")
        self.assertNotIn("BNKR", syms, "Financial Status異常 (破産等) は除外")
        self.assertNotIn("ZWZZT", syms, "テスト銘柄は除外")
        self.assertNotIn("TQQQ", syms, "ETFは除外")
        self.assertNotIn("ABCDW", syms, "ワラントは除外")
        self.assertNotIn("ABCDR", syms, "ライツは除外")
        self.assertNotIn("ABCDU", syms, "ユニットは除外")
        self.assertNotIn("GFND", syms, "ファンドは除外")

    def test_other_file(self):
        syms = sc.parse_listed_file(self.OTHER_SAMPLE, "ACT Symbol")
        self.assertIn("BRK-B", syms, "クラス株はYahoo形式(BRK-B)に変換")
        self.assertIn("GM", syms)
        self.assertIn("TSM", syms, "NYSE上場のADRも含める")
        self.assertNotIn("XYZ$A", syms, "優先株シンボルは除外")
        self.assertNotIn("SPYX", syms, "ETFは除外")
        self.assertNotIn("DPN", syms, "預託証券は除外")

    def test_yahoo_sector_mapping(self):
        # yfinanceが返すセクター名(GICSと微妙に違う)もマップできる
        for ya in ("Technology", "Healthcare", "Financial Services",
                   "Consumer Cyclical", "Consumer Defensive", "Basic Materials"):
            etf, ja = sc.SECTOR_MAP[ya]
            self.assertTrue(etf.startswith("XL"))
            self.assertTrue(ja)


class IBDEnvironment(unittest.TestCase):
    """IBD流: 分配日の5%ルール失効・フォロースルー日・Market Pulse。"""

    def test_distribution_day_expires_after_5pct_rally(self):
        # 分配日(-0.5%・出来高増)のあと株価が5%以上上昇 → カウントから失効
        n = 320
        px = [500.0] * (n - 20)
        vol = [5e6] * n
        px.append(px[-1] * 0.995)          # 分配日
        vol[len(px) - 1] = 8e6
        for _ in range(19):                # その後 +6% 上昇
            px.append(px[-1] * 1.003)
        dd = sc.distribution_days(mkdf(px[:n], vol=vol))
        self.assertEqual(dd, 0, "5%上昇で分配日は失効すべき")

    def test_distribution_day_counted_without_rally(self):
        n = 320
        px = [500.0] * n
        vol = [5e6] * n
        i = n - 10
        px[i] = px[i - 1] * 0.994          # 分配日、その後横ばい
        for j in range(i + 1, n):
            px[j] = px[i]
        vol[i] = 8e6
        dd = sc.distribution_days(mkdf(px, vol=vol))
        self.assertEqual(dd, 1)

    def _ftd_series(self, undercut=False, no_ftd=False):
        """上昇 → -10%調整 → 底 → 4日目以降に+1.6%出来高増(FTD)のシナリオ。"""
        px = list(np.linspace(400, 500, 280))           # 上昇
        px += list(np.linspace(500, 450, 12))           # -10% 調整
        rally = [450 * (1 + 0.002 * k) for k in range(1, 5)]   # 弱い立ち直り day1-4
        px += rally
        vol = [5e6] * len(px)
        if not no_ftd:
            px.append(px[-1] * 1.016)                   # day5: +1.6% = FTD
            vol.append(8e6)
        for _ in range(320 - len(px) - (6 if undercut else 0)):
            px.append(px[-1] * 1.001)
            vol.append(5e6)
        if undercut:
            for _ in range(6):                          # FTD後に底割れ
                px.append(440.0)
                vol.append(5e6)
        return mkdf(px[:320], vol=vol[:320])

    def test_ftd_confirmed(self):
        state, since = sc.detect_ftd(self._ftd_series())
        self.assertEqual(state, "confirmed")
        self.assertIsNotNone(since)

    def test_ftd_undercut_invalidates(self):
        state, _ = sc.detect_ftd(self._ftd_series(undercut=True))
        self.assertEqual(state, "correction")

    def test_no_ftd_is_rally_attempt(self):
        # 底から戻しているがFTD条件の日がない
        px = list(np.linspace(400, 500, 290)) + list(np.linspace(500, 440, 15))
        px += [440 * (1 + 0.003 * k) for k in range(1, 16)]   # 弱い戻り
        state, _ = sc.detect_ftd(mkdf(px[:320]))
        self.assertEqual(state, "rally_attempt")

    def test_plain_uptrend(self):
        state, _ = sc.detect_ftd(mkdf(np.geomspace(400, 500, 320)))
        self.assertEqual(state, "uptrend")

    def test_crash_is_correction(self):
        px = list(np.linspace(400, 500, 290)) + list(np.linspace(500, 420, 30))
        state, _ = sc.detect_ftd(mkdf(px[:320]))
        self.assertEqual(state, "correction")

    def test_market_pulse_confirmed_uptrend(self):
        status, pulse = sc.market_pulse(90, True, 0, "uptrend", "uptrend", None)
        self.assertEqual(status, "BUY MODE")
        self.assertIn("確認済み上昇トレンド", pulse)

    def test_market_pulse_under_pressure(self):
        status, pulse = sc.market_pulse(80, True, 4, "uptrend", "uptrend", None)
        self.assertEqual(status, "CAUTION")
        self.assertIn("圧力下", pulse)

    def test_market_pulse_correction(self):
        status, pulse = sc.market_pulse(30, False, 6, "correction", "correction", None)
        self.assertEqual(status, "DO NOT BUY")
        self.assertIn("調整局面", pulse)

    def test_market_pulse_ftd_overrides_low_ma(self):
        # FTD確認直後はSPYがまだMA200の下でもCAUTION以上(調整局面とはしない)
        status, pulse = sc.market_pulse(55, False, 2, "confirmed", "rally_attempt", 3)
        self.assertNotEqual(status, "DO NOT BUY")

    def test_market_pulse_ftd_upgrades_even_at_bear_bottom_score(self):
        # 本物の底打ち時はスコアが構造的に低い(30前後)。それでもFTD直後は
        # DO NOT BUYにしない — これがFTDの存在意義
        status, pulse = sc.market_pulse(30, False, 2, "confirmed", "confirmed", 1)
        self.assertEqual(status, "CAUTION")
        self.assertIn("フォロースルー", pulse)

    def test_market_pulse_no_buy_without_ftd_after_correction(self):
        # 調整入り後、FTDなしの静かな戻りでは「確認済み上昇トレンド」に戻れない
        for s_spy, s_qqq in (("correction", "uptrend"), ("rally_attempt", "rally_attempt"),
                             ("rally_attempt", "correction"), ("correction", "rally_attempt")):
            status, _ = sc.market_pulse(70, True, 2, s_spy, s_qqq, None)
            self.assertNotEqual(status, "BUY MODE",
                                f"FTDなしでBUYは不可: {s_spy}/{s_qqq}")

    def test_env_includes_ibd_fields(self):
        data, universe = sc.synthetic_data(n=20)
        out = sc.run(data, universe, skip_fundamentals=True)
        e = out["env"]
        for key in ("pulse", "dist_spy", "dist_qqq", "qqq", "qqq_ma200_pct", "nh", "nl"):
            self.assertIn(key, e, f"env missing {key}")


class MinerviniFidelity(unittest.TestCase):
    def test_extended_flag(self):
        # 3日で12%上放れ → EXT(追いかけ買い禁止ゾーン)
        px = list(np.geomspace(50, 100, 317))
        px += [px[-1] * 1.04, px[-1] * 1.08, px[-1] * 1.12]
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(px), spy)
        self.assertTrue(m["ext"])
        # EXT時は表示ピボット(=ベース上限)と整合: 株価は実際に買いゾーン上方
        self.assertGreater(m["close"], m["pivot"] * 1.05)
        self.assertLess(m["stop"], m["pivot"])

    def test_not_extended_on_steady_climb(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(uptrend(), spy)
        self.assertFalse(m["ext"], "緩やかな上昇はEXTではない")

    def test_new_high_low_flags(self):
        spy = flat_spy()["Close"]
        self.assertTrue(sc.compute_metrics(uptrend(), spy)["new_high"])
        self.assertTrue(sc.compute_metrics(downtrend(), spy)["new_low"])

    def test_rows_carry_chart_and_ext(self):
        data, universe = sc.synthetic_data()
        out = sc.jclean(sc.run(data, universe, skip_fundamentals=True))
        for row in out["main"] + out["tight"]:
            self.assertIn("px", row)
            self.assertLessEqual(len(row["px"]), 60)
            self.assertGreaterEqual(len(row["px"]), 10)
            self.assertIn("EXT", row)


class Ratings(unittest.TestCase):
    """MarketSurge流レーティング群の既知正解テスト。"""

    def test_accdis_raw_buying_vs_selling(self):
        # 毎日高値引け(買い集め) > 毎日安値引け(売り抜け)
        n = 320
        idx = pd.bdate_range(end=dt.date.today(), periods=n)
        close_at_high = pd.DataFrame({
            "Open": 100.0, "High": 101.0, "Low": 99.0, "Close": 100.9,
            "Volume": 5e6}, index=idx)
        close_at_low = pd.DataFrame({
            "Open": 100.0, "High": 101.0, "Low": 99.0, "Close": 99.1,
            "Volume": 5e6}, index=idx)
        acc = sc.accdis_raw(close_at_high)
        dis = sc.accdis_raw(close_at_low)
        self.assertGreater(acc, 0.5)
        self.assertLess(dis, -0.5)
        self.assertGreater(acc, dis)

    def test_accdis_letter_quintiles(self):
        self.assertEqual(sc.accdis_letter(0.95), "A")
        self.assertEqual(sc.accdis_letter(0.65), "B")
        self.assertEqual(sc.accdis_letter(0.50), "C")
        self.assertEqual(sc.accdis_letter(0.25), "D")
        self.assertEqual(sc.accdis_letter(0.05), "E")

    def test_up_down_volume_ratio(self):
        # 上昇日に大出来高・下落日に小出来高 → 比率 > 1
        n = 320
        px, vol = [100.0], [5e6]
        for i in range(1, n):
            if i % 2:
                px.append(px[-1] * 1.01); vol.append(9e6)
            else:
                px.append(px[-1] * 0.995); vol.append(3e6)
        ud = sc.up_down_volume(mkdf(px, vol=vol))
        self.assertGreater(ud, 1.5)
        # 逆 → 1未満
        px2, vol2 = [100.0], [5e6]
        for i in range(1, n):
            if i % 2:
                px2.append(px2[-1] * 1.01); vol2.append(3e6)
            else:
                px2.append(px2[-1] * 0.995); vol2.append(9e6)
        self.assertLess(sc.up_down_volume(mkdf(px2, vol=vol2)), 1.0)

    def test_up_down_volume_no_down_days(self):
        ud = sc.up_down_volume(uptrend())
        self.assertEqual(ud, 9.9, "下落日ゼロ(上昇日出来高あり)はキャップ値ちょうど")

    def test_up_down_volume_no_information(self):
        # 全日同値 (売買停止級) — 最強扱いせずNone
        px = np.full(320, 50.0)
        ud = sc.up_down_volume(mkdf(px, high=px, low=px))
        self.assertIsNone(ud)

    def test_smr_partial_data_not_penalized(self):
        # 売上成長50%だがmargin/ROE欠損 → 欠損を悪材料扱いしない
        self.assertIn(sc.smr_rating(0.50, None, None), ("A", "B"))

    def test_handle_requires_5plus_bars(self):
        # 3本足の小押しはハンドルではない → ただのカップ
        base = segment(98, 75, 28) + segment(75, 96, 29) + [96, 95.5, 95]
        lead = list(np.linspace(50, 100, 320 - len(base)))
        b = sc.classify_base(mkdf(lead + base))
        self.assertEqual(b["type"], "カップ")

    def test_drifting_decline_not_praised(self):
        # 1年かけて-28%ジリ下げ → 「保ち合い」はreason好材料に載らない
        px = list(np.linspace(100, 72, 320))
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(mkdf(px), spy)
        m.update({"rs": 40, "sec_rs": 50, "score": 30,
                  "accdis_pct": 0.5, "accdis_letter": "C"})
        reason = sc.build_reason(m, {})
        self.assertNotIn("保ち合い形成中", reason)

    def test_eps_rating_monotonic_and_bounded(self):
        weak = sc.eps_rating(5, 0, 0)
        mid = sc.eps_rating(30, 20, 15)
        strong = sc.eps_rating(100, 80, 40)
        self.assertLess(weak, mid)
        self.assertLess(mid, strong)
        for v in (sc.eps_rating(-50, -50, -50), sc.eps_rating(500, 500, 500)):
            self.assertGreaterEqual(v, 1)
            self.assertLessEqual(v, 99)
        self.assertIsNone(sc.eps_rating(None, None, None), "データなしはNone")

    def test_smr_rating(self):
        self.assertEqual(sc.smr_rating(0.25, 0.20, 0.30), "A")
        self.assertEqual(sc.smr_rating(0.02, 0.01, 0.02), "E")
        self.assertEqual(sc.smr_rating(None, None, None), "N")
        # 中間はB〜Dのどれか
        self.assertIn(sc.smr_rating(0.12, 0.08, 0.18), ("B", "C", "D"))

    def test_composite_rating_ordering_and_bounds(self):
        strong = sc.composite_rating(rs=95, eps_r=90, accdis_pct=0.9, sec_rs=85, dist_high=2)
        weak = sc.composite_rating(rs=30, eps_r=20, accdis_pct=0.2, sec_rs=30, dist_high=20)
        self.assertGreater(strong, weak)
        self.assertGreaterEqual(weak, 1)
        self.assertLessEqual(strong, 99)
        # EPS欠損時は中立値で計算され、Noneにはならない
        self.assertIsInstance(sc.composite_rating(95, None, 0.9, 85, 2), int)

    def test_rows_carry_ratings(self):
        data, universe = sc.synthetic_data()
        out = sc.jclean(sc.run(data, universe, skip_fundamentals=True))
        for row in out["main"] + out["tight"]:
            self.assertIn("Comp", row)
            self.assertIn("AccDis", row)
            self.assertIn("UD比", row)
            self.assertIn(row["AccDis"], ("A", "B", "C", "D", "E"))
            self.assertGreaterEqual(row["Comp"], 1)
            self.assertLessEqual(row["Comp"], 99)


class BaseDetection(unittest.TestCase):
    """MarketSurge流ベース自動判定 (フラット/カップ/カップウィズハンドル)。"""

    def _with_base(self, base):
        """50→100の上昇に続けてベース部分を貼り付けて320日にする。"""
        lead = list(np.linspace(50, 100, 320 - len(base)))
        return mkdf(lead + base)

    def test_flat_base(self):
        # 高値100のあと7週間 (35日) を93〜99で横ばい — 深さ7%
        base = [96 + (i % 5) * 0.7 for i in range(35)]
        b = sc.classify_base(self._with_base(base))
        self.assertEqual(b["type"], "フラットベース")
        self.assertGreaterEqual(b["weeks"], 5)
        self.assertLessEqual(b["depth"], 15)

    def test_cup(self):
        # 100 → 75 (-25%) → 98 のU字、12週
        base = segment(98, 75, 30) + segment(75, 98, 30)
        b = sc.classify_base(self._with_base(base))
        self.assertEqual(b["type"], "カップ")
        self.assertGreater(b["depth"], 15)

    def test_cup_with_handle(self):
        # カップ完成後、上部で小さな押し (ハンドル -5%)
        base = segment(98, 75, 28) + segment(75, 97, 28) + segment(97, 92.5, 5) + [92.5, 93]
        b = sc.classify_base(self._with_base(base))
        self.assertEqual(b["type"], "カップウィズハンドル")

    def test_too_short_is_no_base(self):
        base = segment(98, 92, 6) + segment(92, 97, 6)  # 2.4週しかない
        b = sc.classify_base(self._with_base(base))
        self.assertEqual(b["type"], "")

    def test_too_deep_is_no_base(self):
        base = segment(98, 55, 30) + segment(55, 80, 30)  # -44%は崩壊でありベースではない
        b = sc.classify_base(self._with_base(base))
        self.assertEqual(b["type"], "")

    def test_base_stage_counting(self):
        # 階段状に2回ベース→ブレイクした銘柄 → 現在は第3ステージ近辺
        px = segment(50, 70, 60) + [70 - (i % 5) * 0.5 for i in range(35)]   # ベース1
        px += segment(70, 90, 40) + [90 - (i % 5) * 0.6 for i in range(35)]  # ベース2
        px += segment(90, 110, 40) + [110 - (i % 5) * 0.7 for i in range(40)]  # 現ベース
        px = px[:320] if len(px) >= 320 else px + [px[-1]] * (320 - len(px))
        stage = sc.base_stage(mkdf(px)["High"])
        self.assertGreaterEqual(stage, 2)
        self.assertLessEqual(stage, 4)

    def test_uptrend_has_chart_arrays(self):
        data, universe = sc.synthetic_data()
        out = sc.jclean(sc.run(data, universe, skip_fundamentals=True))
        for row in out["main"][:3] + out["tight"][:3]:
            self.assertIn("vols", row)
            self.assertIn("ma50px", row)
            self.assertEqual(len(row["vols"]), len(row["px"]))
            self.assertEqual(len(row["ma50px"]), len(row["px"]))


class IndustryGroups(unittest.TestCase):
    """IBD流145業種グループRS。"""

    def _metrics(self, spec):
        # spec: {sym: (wret, rs)}
        return {s: {"wret": w, "rs": r} for s, (w, r) in spec.items()}

    def test_group_rs_ranking(self):
        metrics = self._metrics({
            "A1": (2.0, 95), "A2": (1.8, 92), "A3": (1.9, 93),   # 強い業種
            "B1": (0.1, 40), "B2": (0.2, 45), "B3": (0.0, 35),   # 弱い業種
            "C1": (1.0, 70),                                       # 2銘柄 → 対象外
            "C2": (1.0, 70),
        })
        imap = {"A1": "semiconductors", "A2": "semiconductors", "A3": "semiconductors",
                "B1": "banks—regional", "B2": "banks—regional", "B3": "banks—regional",
                "C1": "gold", "C2": "gold"}
        groups, sym_info = sc.compute_group_rs(metrics, imap)
        self.assertEqual(len(groups), 2, "3銘柄未満の業種は対象外")
        self.assertEqual(groups[0]["key"], "semiconductors")
        self.assertEqual(groups[0]["rank"], 1)
        self.assertGreater(groups[0]["rs"], groups[1]["rs"])
        self.assertEqual(groups[0]["top"], "A1", "代表銘柄はRS最高の銘柄")
        self.assertIn("A1", sym_info)
        self.assertNotIn("C1", sym_info)

    def test_group_rs_empty(self):
        groups, sym_info = sc.compute_group_rs(self._metrics({"X": (1.0, 50)}), {})
        self.assertEqual(groups, [])
        self.assertEqual(sym_info, {})

    def test_industry_map_merge(self):
        merged = sc.merge_industry_maps(
            {"AAPL": "consumer-electronics", "OLD": "gold"},
            {"AAPL": "computer-hardware", "NVDA": "semiconductors"})
        self.assertEqual(merged["AAPL"], "computer-hardware", "新しい取得が優先")
        self.assertEqual(merged["OLD"], "gold", "前回分は保持")
        self.assertEqual(merged["NVDA"], "semiconductors")

    def test_industry_ja_full_coverage(self):
        from yfinance.const import SECTOR_INDUSTY_MAPPING_LC
        for sec, inds in SECTOR_INDUSTY_MAPPING_LC.items():
            for key in inds:
                name = sc.industry_ja(key)
                self.assertTrue(name and isinstance(name, str), f"no name for {key}")

    def test_run_applies_group_rs_to_rows(self):
        data, universe = sc.synthetic_data()
        # 候補入りしやすい強い銘柄に業種を付与
        imap = {f"TST{i:03d}": "semiconductors" for i in range(0, 20)}
        imap.update({f"TST{i:03d}": "gold" for i in range(20, 40)})
        imap["VCPX"] = "semiconductors"
        out = sc.jclean(sc.run(data, universe, skip_fundamentals=True, industry_map=imap))
        self.assertIn("groups", out)
        self.assertGreaterEqual(len(out["groups"]), 2)
        g = out["groups"][0]
        for k in ("rank", "key", "name", "rs", "count", "top", "total"):
            self.assertIn(k, g)
        vrow = next(r for r in out["main"] + out["tight"] if r["シンボル"] == "VCPX")
        self.assertEqual(vrow["業種"], sc.industry_ja("semiconductors"))
        self.assertIsNotNone(vrow["業種順位"])

    def test_fundamentals_backfill_keeps_group_rs(self):
        # フルユニバース銘柄 (セクター未付与) のセクター補完が、
        # 先に付与された細分の業種グループRSを粗いETFセクターRSで上書きしない
        data, universe = sc.synthetic_data()
        universe = {s: "" for s in universe}
        imap = {f"TST{i:03d}": "semiconductors" for i in range(0, 20)}
        imap.update({f"TST{i:03d}": "gold" for i in range(20, 40)})
        imap["VCPX"] = "semiconductors"
        orig_fund, orig_sleep = sc.fetch_fundamentals, sc.time.sleep
        sc.fetch_fundamentals = lambda sym: {"_sector": "Technology", "_industry_key": ""}
        sc.time.sleep = lambda s: None
        try:
            out = sc.jclean(sc.run(data, universe, skip_fundamentals=False,
                                   industry_map=imap))
        finally:
            sc.fetch_fundamentals, sc.time.sleep = orig_fund, orig_sleep
        grs = {g["key"]: g["rs"] for g in out["groups"]}
        grouped = [r for r in out["main"] + out["tight"]
                   if r["シンボル"] in imap and r["業種順位"] is not None]
        self.assertTrue(grouped, "業種グループ付き候補が出ること")
        for r in grouped:
            self.assertEqual(r["セクターRS数値"], grs[imap[r["シンボル"]]],
                             f"{r['シンボル']}: セクター補完が業種RSを上書きした")


class ChartPayload(unittest.TestCase):
    """本格チャート用の個別JSON (日足/週足/RSライン)。"""

    def test_weekly_resample_correct(self):
        # 月〜金きっかり2週間: 週足OHLCVが手計算と一致する
        idx = pd.bdate_range("2026-05-25", periods=10)  # 月曜始まり2週
        o = list(range(10, 20)); h = [x + 2 for x in o]
        l = [x - 2 for x in o]; c = [x + 1 for x in o]
        v = [1e6] * 10
        df = pd.DataFrame({"Open": o, "High": h, "Low": l, "Close": c, "Volume": v},
                          index=idx, dtype=float)
        spy = pd.Series(100.0, index=idx)
        p = sc.build_chart_payload(df, spy_close=spy)
        w = p["w"]
        self.assertEqual(len(w["c"]), 2)
        self.assertEqual(w["o"][0], 10.0)   # 週1の始値 = 月曜Open
        self.assertEqual(w["h"][0], 16.0)   # 週1の高値 = max(High[0:5])
        self.assertEqual(w["l"][0], 8.0)    # 週1の安値
        self.assertEqual(w["c"][0], 15.0)   # 週1の終値 = 金曜Close
        self.assertEqual(w["v"][0], 5.0)    # 出来高合計 5e6 → 5 (百万株)
        self.assertEqual(w["c"][1], 20.0)

    def test_chart_payload_schema(self):
        data, universe = sc.synthetic_data()
        spy = data["SPY"]["Close"]
        p = sc.build_chart_payload(data["VCPX"], spy_close=spy, pivot=130.0, stop=124.0)
        for tf in ("d", "w"):
            sub = p[tf]
            n = len(sub["c"])
            for k in ("t", "o", "h", "l", "c", "v"):
                self.assertEqual(len(sub[k]), n, f"{tf}.{k} length")
            self.assertGreater(n, 10)
        self.assertEqual(len(p["d"]["ma"]), len(p["d"]["c"]))
        self.assertEqual(len(p["w"]["ma"]), len(p["w"]["c"]))
        self.assertEqual(len(p["rs"]), len(p["d"]["c"]))
        self.assertEqual(p["pivot"], 130.0)
        # NaNはJSONに残さない (None化される)
        s = json.dumps(sc.jclean(p))
        self.assertNotIn("NaN", s)

    def test_chart_short_history(self):
        spy = flat_spy(130)["Close"]
        p = sc.build_chart_payload(uptrend(125), spy_close=spy)
        self.assertGreater(len(p["d"]["c"]), 10)
        self.assertGreater(len(p["w"]["c"]), 5)

    def test_chart_files_written_by_selftest(self):
        import subprocess, glob, os
        subprocess.run([sys.executable, "screener.py", "--selftest"],
                       cwd=os.path.dirname(os.path.abspath(sc.__file__)), check=True,
                       capture_output=True)
        files = glob.glob(os.path.join(os.path.dirname(os.path.abspath(sc.__file__)),
                                       "data", "charts", "*.json"))
        self.assertGreater(len(files), 5, "selftestで候補銘柄のチャートJSONが生成される")
        with open(files[0]) as f:
            p = json.load(f)
        self.assertIn("d", p)
        self.assertIn("w", p)


class Buyability(unittest.TestCase):
    """Minervini買付適格性審査 — 「ミネルヴィニはこのチャートを本当に買うか」。

    KALV/CNTA型 (バイナリーイベントで2倍になったバイオ株等) がメイン候補の
    上位に出ないことを第一原理から検証する。
    """

    @staticmethod
    def _event_rocket(days=320, gap_mult=2.0, post_days=55, wob=0.055):
        """1年横ばい→1日でgap_mult倍→荒い値動きで高値追い (KALV型)。"""
        pre = segment(5.8, 6.2, days - post_days)
        start = pre[-1] * gap_mult
        targets = np.geomspace(start, 27.0, post_days)
        post = []
        for i, t in enumerate(targets):
            z = 0.0 if i >= post_days - 10 else (wob if i % 2 == 0 else -wob)
            post.append(t * (1 + z))
        close = np.array(pre + post)
        spread = np.concatenate([np.full(days - post_days, 0.006),
                                 np.full(post_days, 0.05)])
        return mkdf(close, high=close * (1 + spread), low=close * (1 - spread))

    @staticmethod
    def _earnings_gap_leader(days=320, gap=0.20, post_days=30):
        """確立した上昇トレンド中の決算ギャップ — Minerviniが普通に買う形。"""
        pre = segment(50, 100, days - post_days)
        start = pre[-1] * (1 + gap)
        close = np.array(pre + segment(start, start * 1.05, post_days))
        return mkdf(close)

    def _qm(self, **over):
        """buyability() 単体テスト用の素点。デフォルトは健全な主導株。"""
        m = {"max_up60": 4.0, "max_dn60": -3.5, "n_chop60": 0,
             "gap_from_base": None, "adr": 3.0, "ext200": 30.0,
             "depth60": 15.0,
             "base": {"type": "フラットベース", "weeks": 6, "depth": 15.0}}
        m.update(over)
        return m

    # ----- 単体: 拒否条件 (veto)
    def test_binary_event_vetoed(self):
        v, p, w = sc.buyability(self._qm(max_up60=95.0, gap_from_base=False))
        self.assertTrue(v, "1日+95%のバイナリーイベントは拒否")

    def test_gap_without_prior_trend_vetoed(self):
        v, _, _ = sc.buyability(self._qm(max_up60=22.0, gap_from_base=False))
        self.assertTrue(v, "トレンド不在からの急騰ギャップはイベント主導 — 拒否")

    def test_earnings_gap_from_uptrend_allowed(self):
        v, _, _ = sc.buyability(self._qm(max_up60=22.0, gap_from_base=True))
        self.assertFalse(v, "上昇トレンド中の+22%決算ギャップは正当 (NVDA型) — 拒否しない")

    def test_huge_gap_vetoed_even_from_uptrend(self):
        v, _, _ = sc.buyability(self._qm(max_up60=40.0, gap_from_base=True))
        self.assertTrue(v, "+35%超の1日急騰は出自を問わず新ベース形成まで見送り")

    def test_crash_day_vetoed(self):
        v, _, _ = sc.buyability(self._qm(max_dn60=-22.0))
        self.assertTrue(v, "直近60日に-22%日があれば破損銘柄 — 拒否")

    def test_wide_loose_adr_vetoed(self):
        v, _, _ = sc.buyability(self._qm(adr=9.5))
        self.assertTrue(v, "ADR 9.5%はwide & loose — 拒否")

    def test_climax_extension_vetoed(self):
        v, _, _ = sc.buyability(self._qm(ext200=140.0))
        self.assertTrue(v, "200日線+140%乖離はクライマックス圏 — 拒否")

    # ----- 単体: 減点 (penalty) と警告
    def test_moderate_extension_penalized_not_vetoed(self):
        v, p, w = sc.buyability(self._qm(ext200=85.0))
        self.assertFalse(v)
        self.assertGreater(p, 0)
        self.assertTrue(any("乖離" in x or "過熱" in x for x in w))

    def test_elevated_adr_penalized(self):
        v, p, _ = sc.buyability(self._qm(adr=7.0))
        self.assertFalse(v)
        self.assertGreater(p, 0)

    def test_choppiness_penalized(self):
        v, p, _ = sc.buyability(self._qm(n_chop60=8))
        self.assertFalse(v)
        self.assertGreater(p, 0)

    def test_v_shape_recovery_penalized(self):
        v, p, w = sc.buyability(self._qm(depth60=42.0, base={"type": "保ち合い"}))
        self.assertFalse(v)
        self.assertGreater(p, 0)
        self.assertTrue(any("V字" in x or "ベース未形成" in x for x in w))

    def test_clean_leader_passes_clean(self):
        v, p, w = sc.buyability(self._qm())
        self.assertEqual((v, p, w), ([], 0, []))

    def test_final_score_floor(self):
        m = self._qm(n_chop60=20, ext200=85.0, adr=7.9)
        m.update({"rs": 1, "sec_rs": 1, "dist_high": 50.0, "range10": 20.0})
        _, p, _ = sc.buyability(m)
        m["q_penalty"] = p
        self.assertGreaterEqual(sc.final_score(m), 1)

    # ----- 価格パスからの統合検証
    def test_event_rocket_metrics_and_veto(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(self._event_rocket(), spy)
        self.assertGreaterEqual(m["max_up60"], 35, "ギャップ日が検出される")
        v, _, _ = sc.buyability(m)
        self.assertTrue(v, "KALV型イベントロケットは買付不適格")

    def test_earnings_gap_leader_metrics_not_vetoed(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(self._earnings_gap_leader(), spy)
        self.assertGreaterEqual(m["max_up60"], 18)
        self.assertTrue(m["gap_from_base"], "ギャップ前から上昇トレンド確立済み")
        v, _, _ = sc.buyability(m)
        self.assertFalse(v, "上昇トレンド中の決算ギャップ銘柄を捨てない")

    def test_orderly_uptrend_clean_from_path(self):
        spy = flat_spy()["Close"]
        m = sc.compute_metrics(uptrend(), spy)
        v, p, _ = sc.buyability(m)
        self.assertEqual(v, [])
        self.assertEqual(p, 0, "整然とした上昇トレンドは無減点")

    def test_event_rocket_excluded_from_lists(self):
        data, universe = sc.synthetic_data()
        df = self._event_rocket()
        df.index = data["SPY"].index
        data["EVNT"] = df
        universe["EVNT"] = "Health Care"
        out = sc.jclean(sc.run(data, universe, skip_fundamentals=True))
        syms = [r["シンボル"] for r in out["main"] + out["tight"]]
        # RS最上位・高値圏でもイベント型は両リストから締め出される
        m = sc.compute_metrics(data["EVNT"], data["SPY"]["Close"])
        self.assertTrue(m["tt"], "前提: テンプレート自体は通過してしまう形")
        self.assertNotIn("EVNT", syms, "Minervini審査がEVNTを除外する")

    def test_quality_warning_in_reason(self):
        m = self._qm(ext200=85.0)
        m.update({"rs": 95, "dist_high": 3.0, "rs_line_high": False, "vcp": False,
                  "vdu": False, "bkt": False, "sec_rs": 50, "accdis_letter": "C",
                  "ud": None, "ext": False, "stage": 2, "vol_m": 50.0,
                  "n_contractions": 0, "range10": 5.0})
        _, p, w = sc.buyability(m)
        m["q_warns"] = w
        txt = sc.build_reason(m, {})
        self.assertTrue(any(x in txt for x in ("乖離", "過熱")),
                        "品質警告が有望理由の【注意】に表示される")


if __name__ == "__main__":
    unittest.main(verbosity=2)
