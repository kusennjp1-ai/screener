"""Unit tests for the standalone Markets 360 analytics module.

Covers the pure rating estimators, the quarterly-growth table builder, and the
buy-signal engine against values read off the reference Markets 360 screenshots
(EPS +61%, Sales +38%, CYRX loss-base -800%, TPR A–E mapping, etc.).
"""
import numpy as np
import pandas as pd
import pytest

from app.services.markets360 import quarters, ratings
from app.services.markets360.signals import compute_buy_signal


# --------------------------------------------------------------------------- #
# Ratings
# --------------------------------------------------------------------------- #
class TestRatings:
    def test_tpr_letter_grades_span_a_to_e(self):
        assert ratings.tpr_letter(8, 8) == "A"
        assert ratings.tpr_letter(7, 8) == "B"
        assert ratings.tpr_letter(5, 8) == "C"
        assert ratings.tpr_letter(3, 8) == "D"
        assert ratings.tpr_letter(1, 8) == "E"
        assert ratings.tpr_letter(None, 8) is None

    def test_tpr_normalises_seven_condition_scale(self):
        # 7/7 (no benchmark RS leg) should still grade strong (A).
        assert ratings.tpr_letter(7, 7) == "A"

    def test_er_rewards_high_accelerating_growth(self):
        strong = ratings.compute_er({"eps_q1_yoy": 61, "eps_q2_yoy": 40, "eps_5yr_cagr": 30})
        weak = ratings.compute_er({"eps_q1_yoy": 2, "eps_q2_yoy": 3, "eps_5yr_cagr": 1})
        assert strong is not None and weak is not None
        assert 0 <= weak < strong <= 99
        assert strong >= 80

    def test_er_none_without_inputs(self):
        assert ratings.compute_er({}) is None
        assert ratings.compute_er(None) is None

    def test_sr_monotonic_in_sales_growth(self):
        low = ratings.compute_sr({"sales_growth_qq": 5})
        high = ratings.compute_sr({"sales_growth_qq": 55})
        assert low is not None and high is not None
        assert high > low

    def test_curve_clamps_and_interpolates(self):
        pts = [(-60, 1), (0, 55), (80, 99)]
        assert ratings._curve(-200, pts) == 1
        assert ratings._curve(200, pts) == 99
        assert ratings._curve(0, pts) == 55
        assert ratings._curve(None, pts) is None
        assert ratings._curve(float("nan"), pts) is None

    def test_vrr_signed_relative_volume(self):
        vol = pd.Series([1_000_000] * 50 + [1_540_000])
        assert ratings.compute_vrr(vol) == pytest.approx(54.0, abs=0.5)

    def test_dist_20dma(self):
        close = pd.Series([100.0] * 19 + [110.0])
        # mean of last 20 = (19*100 + 110)/20 = 100.5 -> +9.45%
        assert ratings.compute_dist_20dma(close) == pytest.approx(9.45, abs=0.1)

    def test_monalert_net_oscillates_around_zero(self):
        idx = pd.bdate_range("2024-01-01", periods=60)
        close = pd.Series(np.linspace(100, 130, 60), index=idx)
        df = pd.DataFrame({
            "Open": close, "High": close * 1.01, "Low": close * 0.99,
            "Close": close, "Volume": [1_000_000] * 60,
        }, index=idx)
        out = ratings.compute_monalert_net(df)
        assert "monalert_net" in out
        assert isinstance(out["monalert_history"], list)


# --------------------------------------------------------------------------- #
# Quarterly table
# --------------------------------------------------------------------------- #
class TestQuarters:
    def test_yoy_basic(self):
        assert quarters._yoy(6.31, 3.92) == pytest.approx(61.0, abs=0.5)

    def test_yoy_loss_base_matches_screenshot(self):
        # CYRX 2025 Q3: -0.18 vs -0.02 displays as -800%.
        assert quarters._yoy(-0.18, -0.02) == pytest.approx(-800.0, abs=1)

    def test_yoy_guards_zero_and_none(self):
        assert quarters._yoy(1.0, 0) is None
        assert quarters._yoy(None, 1.0) is None

    def test_build_table_orders_oldest_to_newest_with_growth(self):
        eps = {(2025, 2): 6.31, (2024, 2): 3.92}
        rev = {(2025, 2): 15.6e9, (2024, 2): 11.3e9}
        table = quarters.build_quarter_table(eps, rev)
        assert [c["label"] for c in table] == ["2024 Q2", "2025 Q2"]
        latest = table[-1]
        assert latest["eps_growth"] == pytest.approx(61.0, abs=0.5)
        assert latest["sales_growth"] == pytest.approx(38.1, abs=0.5)

    def test_build_table_appends_estimate_column(self):
        eps = {(2025, 2): 6.31, (2024, 2): 3.92}
        rev = {(2025, 2): 15.6e9, (2024, 2): 11.3e9}
        est = {"label": "Next Q (Est.)", "earnings_date": "2026-08-06",
               "earnings_timing": "B", "eps_est_growth": 40.0, "sales_est_growth": 32.0}
        table = quarters.build_quarter_table(eps, rev, estimate=est)
        assert table[-1]["estimate"] is True
        assert table[-1]["earnings_date"] == "2026-08-06"
        assert table[-1]["eps_est_growth"] == 40.0

    def test_fallback_from_fundamentals(self):
        cols = quarters.fallback_from_fundamentals({"eps_q1_yoy": 61, "sales_growth_qq": 38})
        assert cols and cols[0]["eps_growth"] == 61.0
        assert quarters.fallback_from_fundamentals(None) == []


# --------------------------------------------------------------------------- #
# Buy-signal engine
# --------------------------------------------------------------------------- #
class TestBuySignal:
    @staticmethod
    def _frame(n=200):
        idx = pd.bdate_range("2024-01-01", periods=n)
        base = np.linspace(80, 160, n)
        return pd.DataFrame({
            "Open": base, "High": base + 1.5, "Low": base - 1.5,
            "Close": base, "Volume": [1_000_000] * n,
        }, index=idx)

    def test_inactive_on_short_data(self):
        df = self._frame(20)
        sig = compute_buy_signal(df)
        assert sig["active"] is False

    def test_triple_barrel_requires_three_confirmations(self):
        df = self._frame()
        # Force a fresh, high-volume breakout bar.
        df.loc[df.index[-1], "Close"] = float(df["High"].iloc[:-1].max()) + 10
        df.loc[df.index[-1], "High"] = float(df["Close"].iloc[-1]) + 1
        df.loc[df.index[-1], "Volume"] = 5_000_000
        sig = compute_buy_signal(
            df, buy_points=[], pressure_state="buy", tpr_state="strong", buy_risk_state="low"
        )
        assert sig["barrels_passed"] == 3
        assert sig["type"] == "triple_barrel"
        assert sig["active"] is True
        assert sig["label"] == "Triple Barrel Behavioral Analytic Buy Signal"
        # Stop is below the trigger, within the max-loss floor.
        assert sig["stop"] is not None and sig["stop"] < sig["trigger_price"]
        assert 0 < sig["risk_pct"] <= 10.1

    def test_partial_barrels_not_triple(self):
        df = self._frame()
        sig = compute_buy_signal(
            df, buy_points=[], pressure_state="sell", tpr_state="strong", buy_risk_state="high"
        )
        assert sig["type"] != "triple_barrel"
