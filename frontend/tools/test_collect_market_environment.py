"""Market-environment series in the long history: trend template count, stage mix, breakouts."""
import importlib.util
from datetime import datetime
import json
from pathlib import Path
import unittest

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('history_collector', Path(__file__).with_name('collect-market-history.py'))
module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
stage_spec = importlib.util.spec_from_file_location('stage_analysis', ROOT / 'backend/app/scanners/criteria/stage_analysis.py')
stage_module = importlib.util.module_from_spec(stage_spec); stage_spec.loader.exec_module(stage_module)


def record(symbol, days, closes, volumes=None, lows=None):
    stamps = [int(datetime.fromisoformat(day + 'T16:00:00+00:00').timestamp()) for day in days]
    volumes = volumes or [10000] * len(days)
    lows = lows or [c * 0.99 for c in closes]
    quote = {'open': list(closes), 'close': list(closes), 'high': [max(c * 1.005, c) for c in closes], 'low': lows, 'volume': volumes}
    raw = json.dumps({'chart': {'result': [{'meta': {'symbol': symbol, 'firstTradeDate': 946684800}, 'timestamp': stamps, 'indicators': {'quote': [quote]}}]}})
    return {'symbol': symbol, 'raw': raw, 'provenance': {'url': f'https://query1.finance.yahoo.com/v8/finance/chart/{symbol}', 'sha256': module.digest(raw.encode()), 'retrieved_at': '2026-10-27T00:00:00+00:00'}}


def path(seed, n, drifts):
    rng = np.random.default_rng(seed)
    values, level = [], 50.0
    for i in range(n):
        drift = drifts[min(len(drifts) - 1, i * len(drifts) // n)]
        level *= 1 + drift + rng.normal(0, 0.012)
        values.append(round(level, 4))
    return values


class StageParityTests(unittest.TestCase):
    def test_vectorised_stage_matches_the_scanner_rules(self):
        analyzer = stage_module.WeinsteinStageAnalyzer() if hasattr(stage_module, 'WeinsteinStageAnalyzer') else stage_module.WeinsteinstageAnalyzer()
        n = module.STAGE_PRICE_TREND_SESSIONS
        weights = np.arange(n - 1, -1, -1, dtype=float); x = np.arange(n, dtype=float); sxx = float(((x - x.mean()) ** 2).sum())
        compared = 0
        for seed, drifts in enumerate([[0.002, -0.002, 0.0, 0.003], [-0.003, 0.0, 0.002], [0.001, 0.0005, -0.001, -0.002], [0.0, 0.0, 0.0]]):
            close = pd.Series(path(seed, 520, drifts))
            ma200 = close.rolling(200, min_periods=200).mean()
            stages = module.classify_stages(close, ma200, weights, sxx)
            for t in range(260, 520, 7):
                newest_first = close.iloc[:t + 1][::-1].reset_index(drop=True)
                ma_newest_first = ma200.iloc[:t + 1][::-1].reset_index(drop=True)
                expected = analyzer.determine_stage(float(close.iloc[t]), float(ma200.iloc[t]), ma_newest_first, newest_first)
                trend = analyzer.calculate_ma_trend(ma_newest_first, lookback=20)
                price_trend = analyzer.calculate_price_trend(newest_first, lookback=60)
                below = not float(close.iloc[t]) > float(ma200.iloc[t])
                if below and trend == 'falling' and price_trend != 'downtrend':
                    continue  # the swing-pattern exception is documented as not replayed
                self.assertEqual(int(stages[t]), expected['stage'], f'seed {seed} index {t}')
                compared += 1
        self.assertGreater(compared, 100)


class EnvironmentSeriesTests(unittest.TestCase):
    def setUp(self):
        self.days = [day.strftime('%Y-%m-%d') for day in pd.bdate_range('2024-01-01', periods=560)]

    def universe(self, count=110):
        symbols = [f'S{i}' for i in range(count)]
        records = {}
        for i, symbol in enumerate(symbols):
            drifts = [0.0025, 0.002] if i % 3 == 0 else [0.0, -0.002] if i % 3 == 1 else [-0.002, 0.001]
            records[symbol] = record(symbol, self.days, path(100 + i, len(self.days), drifts))
        return symbols, records

    def test_stage_counts_partition_the_observed_universe(self):
        symbols, records = self.universe()
        value = module.build(records, {}, symbols, self.days, self.days[-1])
        last = value['breadth'][-1]
        self.assertEqual(sum(last[f'stage{k}'] for k in (1, 2, 3, 4)), last['coverage'])
        self.assertIn('stage', value['indicator_policy'])

    def test_thirty_percent_template_is_stricter_and_rs90_is_a_subset(self):
        symbols, records = self.universe()
        rows = [row for row in module.build(records, {}, symbols, self.days, self.days[-1])['breadth'] if row['trendTemplateCount'] is not None]
        self.assertTrue(rows)
        for row in rows:
            self.assertLessEqual(row['trendTemplateCount'], row['leaderCount'])
            self.assertLessEqual(row['rs90TemplateCount'], row['trendTemplateCount'])
            self.assertAlmostEqual(row['trendTemplatePercent'], 100 * row['trendTemplateCount'] / row['coverage'])
            self.assertLessEqual(row['above200'], row['coverage'])

    def test_unknown_coverage_reports_unknown_not_zero(self):
        symbols, records = self.universe(120)
        for symbol in symbols[100:]:
            del records[symbol]
        last = module.build(records, {}, symbols, self.days, self.days[-1])['breadth'][-1]
        for key in ('trendTemplateCount', 'stage2', 'above200Percent', 'breakoutsJudged', 'breakoutsHeld'):
            self.assertIsNone(last[key], key)

    def test_breakout_is_judged_only_after_ten_later_sessions(self):
        symbols, records = self.universe()
        n = len(self.days)
        # S0 trends up steadily; force a high-volume breakout 25 sessions before the end and a failure after it.
        closes = [round(50 * 1.003 ** i * (1 + 0.004 * np.sin(i / 5)), 4) for i in range(n)]
        b = n - 25
        closes[b] = max(closes[:b]) * 1.04
        for k in range(b + 1, b + 11):
            closes[k] = closes[b] * 0.99
        lows = [c * 0.99 for c in closes]
        lows[b + 4] = closes[b] * 0.90
        volumes = [10000] * n; volumes[b] = 30000
        records['S0'] = record('S0', self.days, closes, volumes, lows)
        rows = {row['date']: row for row in module.build(records, {}, symbols, self.days, self.days[-1])['breadth']}
        breakout_day, judged_day = self.days[b], self.days[b + module.BREAKOUT_HOLD_SESSIONS]
        self.assertGreaterEqual(rows[breakout_day]['breakouts'], 1)
        before = rows[self.days[b + module.BREAKOUT_HOLD_SESSIONS - 1]]
        after = rows[judged_day]
        self.assertEqual(after['breakoutsJudged'] - (before['breakoutsJudged'] or 0) >= 1, True)
        self.assertLess(after['breakoutsHeld'], after['breakoutsJudged'])


if __name__ == '__main__':
    unittest.main()
