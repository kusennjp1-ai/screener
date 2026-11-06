"""Tests for SetupEngineScanner — the runtime entrypoint for the Setup Engine pipeline.

Covers:
- Registration in screener_registry
- Data requirements declaration
- Insufficient data paths (short bars, policy rejection)
- Full pipeline scan with synthetic data
- Error handling
- Rating calculation thresholds
- Weekly OHLCV propagation to detectors
- Scanner-level timing observability (SE-E9)
- Per-detector elapsed_ms in DetectorExecutionTrace (SE-E9)
"""

from __future__ import annotations

import logging
from unittest.mock import patch

import numpy as np
import pandas as pd
import pytest

from app.analysis.patterns.aggregator import DetectorExecutionTrace, SetupEngineAggregator
from app.analysis.patterns.config import DEFAULT_SETUP_ENGINE_PARAMETERS
from app.analysis.patterns.detectors.base import PatternDetector, PatternDetectorResult
from app.analysis.patterns.models import PatternCandidateModel, validate_setup_engine_payload
from app.scanners.base_screener import DataRequirements, ScreenerResult, StockData
from app.scanners.screener_registry import screener_registry
from app.scanners.setup_engine_screener import SetupEngineScanner, _count_current_week_sessions


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _make_price_data(num_days: int, start_price: float = 50.0) -> pd.DataFrame:
    """Generate synthetic OHLCV data with a mild uptrend."""
    dates = pd.bdate_range(end=pd.Timestamp("2025-12-19"), periods=num_days)
    np.random.seed(42)
    close = start_price + np.cumsum(np.random.randn(num_days) * 0.5 + 0.05)
    close = np.maximum(close, 1.0)  # keep prices positive
    return pd.DataFrame(
        {
            "Open": close * (1 - np.random.uniform(0, 0.02, num_days)),
            "High": close * (1 + np.random.uniform(0, 0.03, num_days)),
            "Low": close * (1 - np.random.uniform(0, 0.03, num_days)),
            "Close": close,
            "Volume": np.random.randint(100_000, 5_000_000, size=num_days).astype(float),
        },
        index=dates,
    )


def _make_stock_data(
    symbol: str = "TEST",
    num_days: int = 350,
    with_benchmark: bool = True,
) -> StockData:
    """Build a StockData object with synthetic price and benchmark data."""
    price_data = _make_price_data(num_days)
    benchmark_data = _make_price_data(num_days, start_price=400.0) if with_benchmark else pd.DataFrame()
    return StockData(
        symbol=symbol,
        price_data=price_data,
        benchmark_data=benchmark_data,
    )


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------


class TestRegistration:
    """SetupEngineScanner must be discoverable via the global registry."""

    def test_is_registered(self):
        assert screener_registry.is_registered("setup_engine")

    def test_get_returns_instance(self):
        instance = screener_registry.get("setup_engine")
        assert instance is not None
        assert isinstance(instance, SetupEngineScanner)

    def test_screener_name(self):
        scanner = SetupEngineScanner()
        assert scanner.screener_name == "setup_engine"


class TestDataRequirements:
    """Data requirements should request 2y price data and benchmark."""

    def test_requirements(self):
        scanner = SetupEngineScanner()
        reqs = scanner.get_data_requirements()
        assert isinstance(reqs, DataRequirements)
        assert reqs.price_period == "2y"
        assert reqs.needs_benchmark is True
        assert reqs.needs_fundamentals is False
        assert reqs.needs_quarterly_growth is False
        assert reqs.needs_earnings_history is False


class TestInsufficientData:
    """Early-return paths for stocks with too little history."""

    def test_short_bars_returns_insufficient(self):
        """<100 daily bars should short-circuit before the policy check."""
        data = _make_stock_data(num_days=50)
        scanner = SetupEngineScanner()
        result = scanner.scan_stock("SHORT", data)

        assert isinstance(result, ScreenerResult)
        assert result.score == 0.0
        assert result.passes is False
        assert result.rating == "Insufficient Data"
        assert result.screener_name == "setup_engine"
        # No payload — just a reason string
        assert "reason" in result.details

    def test_policy_insufficient_returns_payload(self):
        """200 bars pass the quick guard (>=100) but fail the 252-bar policy.

        This path should build a real payload documenting the insufficiency.
        """
        data = _make_stock_data(num_days=200)
        scanner = SetupEngineScanner()
        result = scanner.scan_stock("POLICY_FAIL", data)

        assert result.score == 0.0
        assert result.passes is False
        assert result.rating == "Insufficient Data"
        # Payload exists with null scores
        assert "setup_engine" in result.details
        payload = result.details["setup_engine"]
        assert payload["setup_score"] is None
        assert payload["quality_score"] is None
        assert payload["readiness_score"] is None
        # Explain should document the failure
        assert "explain" in payload
        assert len(payload["explain"]["failed_checks"]) > 0


class TestScanWithSyntheticData:
    """Full pipeline scan with enough synthetic data to run all stages."""

    def test_valid_screener_result(self):
        data = _make_stock_data(num_days=350)
        scanner = SetupEngineScanner()
        result = scanner.scan_stock("SYNTH", data)

        assert isinstance(result, ScreenerResult)
        assert 0 <= result.score <= 100
        assert result.screener_name == "setup_engine"
        assert result.rating in ("Strong Buy", "Buy", "Watch", "Pass")

    def test_payload_exists_and_validates(self):
        data = _make_stock_data(num_days=350)
        scanner = SetupEngineScanner()
        result = scanner.scan_stock("SYNTH", data)

        assert "setup_engine" in result.details
        payload = result.details["setup_engine"]
        errors = validate_setup_engine_payload(payload)
        assert errors == [], f"Payload validation errors: {errors}"

    def test_passes_matches_setup_ready(self):
        data = _make_stock_data(num_days=350)
        scanner = SetupEngineScanner()
        result = scanner.scan_stock("SYNTH", data)

        assert result.passes == result.details["setup_engine"]["setup_ready"]

    def test_candidates_is_list(self):
        """Verifies weekly OHLCV was passed — detectors that need weekly data
        return insufficient_data without it, producing no candidates list.
        """
        data = _make_stock_data(num_days=350)
        scanner = SetupEngineScanner()
        result = scanner.scan_stock("SYNTH", data)

        payload = result.details["setup_engine"]
        assert isinstance(payload["candidates"], list)


class TestErrorHandling:
    """scan_stock must catch exceptions and return Error result."""

    def test_exception_returns_error_result(self):
        scanner = SetupEngineScanner()
        data = _make_stock_data(num_days=350)

        with patch.object(
            scanner._aggregator,
            "aggregate",
            side_effect=RuntimeError("detector exploded"),
        ):
            result = scanner.scan_stock("BOOM", data)

        assert result.score == 0.0
        assert result.passes is False
        assert result.rating == "Error"
        assert "error" in result.details


class TestCalculateRating:
    """Rating thresholds: score=0 should be 'Pass', never 'Insufficient Data'."""

    def test_strong_buy(self):
        scanner = SetupEngineScanner()
        details = {"setup_engine": {"setup_ready": True}}
        assert scanner.calculate_rating(85.0, details) == "Strong Buy"

    def test_buy(self):
        scanner = SetupEngineScanner()
        details = {"setup_engine": {"setup_ready": True}}
        assert scanner.calculate_rating(70.0, details) == "Buy"

    def test_watch(self):
        scanner = SetupEngineScanner()
        details = {"setup_engine": {"setup_ready": False}}
        assert scanner.calculate_rating(55.0, details) == "Watch"

    def test_pass_low_score(self):
        scanner = SetupEngineScanner()
        details = {"setup_engine": {"setup_ready": False}}
        assert scanner.calculate_rating(30.0, details) == "Pass"

    def test_zero_score_is_pass_not_insufficient(self):
        """Score=0 via calculate_rating must return 'Pass', not 'Insufficient Data'."""
        scanner = SetupEngineScanner()
        details = {"setup_engine": {"setup_ready": False}}
        assert scanner.calculate_rating(0.0, details) == "Pass"

    def test_high_score_not_ready_is_watch(self):
        """Score >= 80 but setup_ready=False should be Watch, not Strong Buy."""
        scanner = SetupEngineScanner()
        details = {"setup_engine": {"setup_ready": False}}
        assert scanner.calculate_rating(85.0, details) == "Watch"


class TestCountCurrentWeekSessions:
    """Unit tests for the _count_current_week_sessions helper."""

    def test_empty_dataframe(self):
        assert _count_current_week_sessions(pd.DataFrame()) == 0

    def test_single_day(self):
        dates = pd.DatetimeIndex([pd.Timestamp("2025-12-19")])
        df = pd.DataFrame({"Close": [100.0]}, index=dates)
        assert _count_current_week_sessions(df) == 1

    def test_full_week(self):
        dates = pd.bdate_range("2025-12-15", "2025-12-19")  # Mon-Fri
        df = pd.DataFrame({"Close": range(len(dates))}, index=dates)
        assert _count_current_week_sessions(df) == 5


class TestTimingObservability:
    """SE-E9: Scanner-level timing and per-detector elapsed_ms."""

    def test_scanner_emits_timing_log(self, caplog):
        """INFO-level timing line should appear for a valid scan."""
        data = _make_stock_data(num_days=350)
        scanner = SetupEngineScanner()

        with caplog.at_level(logging.INFO, logger="app.scanners.setup_engine_screener"):
            scanner.scan_stock("TIMING", data)

        timing_lines = [r for r in caplog.records if "SE timing TIMING" in r.message]
        assert len(timing_lines) == 1
        msg = timing_lines[0].message
        assert "prep=" in msg
        assert "detectors=" in msg
        assert "readiness=" in msg
        assert "total=" in msg
        assert "score=" in msg

    def test_detector_traces_have_elapsed_ms(self):
        """Every DetectorExecutionTrace should have a non-negative elapsed_ms."""
        from app.analysis.patterns.aggregator import SetupEngineAggregator
        from app.analysis.patterns.config import DEFAULT_SETUP_ENGINE_PARAMETERS
        from app.analysis.patterns.detectors import PatternDetectorInput

        price_data = _make_price_data(350)
        from app.analysis.patterns.technicals import resample_ohlcv
        weekly_data = resample_ohlcv(price_data, exclude_incomplete_last_period=True)

        detector_input = PatternDetectorInput(
            symbol="TRACE",
            timeframe="daily",
            daily_bars=len(price_data),
            weekly_bars=len(weekly_data),
            features={
                "daily_ohlcv": price_data,
                "weekly_ohlcv": weekly_data,
            },
        )

        aggregator = SetupEngineAggregator()
        output = aggregator.aggregate(detector_input, parameters=DEFAULT_SETUP_ENGINE_PARAMETERS)

        assert len(output.detector_traces) > 0
        for trace in output.detector_traces:
            assert isinstance(trace, DetectorExecutionTrace)
            assert trace.elapsed_ms >= 0.0

    def test_per_detector_debug_logs(self, caplog):
        """DEBUG-level per-detector lines should appear for each detector."""
        data = _make_stock_data(num_days=350)
        scanner = SetupEngineScanner()

        with caplog.at_level(logging.DEBUG, logger="app.scanners.setup_engine_screener"):
            scanner.scan_stock("DETLOG", data)

        debug_lines = [r for r in caplog.records if "SE detector" in r.message and "DETLOG" in r.message]
        assert len(debug_lines) > 0
        for line in debug_lines:
            assert "elapsed=" in line.message
            assert "outcome=" in line.message

    def test_slow_detector_summary_logs_at_info(self, caplog):
        """Slow detector phases should expose top detector timings at INFO."""
        from app.scanners.setup_engine_screener import _log_slow_detector_summary

        traces = (
            DetectorExecutionTrace(
                execution_index=0,
                detector_name="fast",
                outcome="success",
                candidate_count=0,
                passed_checks=(),
                failed_checks=(),
                warnings=(),
                error_detail=None,
                elapsed_ms=12.3,
            ),
            DetectorExecutionTrace(
                execution_index=1,
                detector_name="slow",
                outcome="success",
                candidate_count=2,
                passed_checks=(),
                failed_checks=(),
                warnings=(),
                error_detail=None,
                elapsed_ms=812.4,
            ),
        )

        with caplog.at_level(logging.INFO, logger="app.scanners.setup_engine_screener"):
            _log_slow_detector_summary(
                "SLOW",
                traces,
                detectors_ms=930.0,
                threshold_ms=500.0,
            )

        messages = [r.message for r in caplog.records]
        assert any("SE slow detectors SLOW" in msg for msg in messages)
        assert any("slow=812.4ms/2/success" in msg for msg in messages)
        assert all("fast=12.3ms" not in msg for msg in messages)


class TestOperationalFlagsIntegration:
    """SE-E7: Operational invalidation flags wired through full pipeline."""

    def test_low_liquidity_flag_in_full_pipeline(self):
        """Synthetic stock with tiny volume should trigger low_liquidity flag."""
        num_days = 350
        dates = pd.bdate_range(end=pd.Timestamp("2025-12-19"), periods=num_days)
        np.random.seed(42)
        close = 50.0 + np.cumsum(np.random.randn(num_days) * 0.5 + 0.05)
        close = np.maximum(close, 1.0)
        price_data = pd.DataFrame(
            {
                "Open": close * 0.99,
                "High": close * 1.02,
                "Low": close * 0.98,
                "Close": close,
                "Volume": np.full(num_days, 100.0),  # Tiny volume → tiny ADTV
            },
            index=dates,
        )
        benchmark_data = _make_price_data(num_days, start_price=400.0)
        data = StockData(
            symbol="ILLIQUID",
            price_data=price_data,
            benchmark_data=benchmark_data,
        )

        scanner = SetupEngineScanner()
        result = scanner.scan_stock("ILLIQUID", data)

        assert "setup_engine" in result.details
        payload = result.details["setup_engine"]
        flags = payload["explain"]["invalidation_flags"]
        flag_codes = {flag["code"] for flag in flags}
        assert "low_liquidity" in flag_codes

    def test_breaks_50d_flag_in_full_pipeline(self):
        """Last bar collapsed below 50d MA should trigger breaks_50d_support."""
        num_days = 350
        dates = pd.bdate_range(end=pd.Timestamp("2025-12-19"), periods=num_days)
        np.random.seed(42)
        close = 50.0 + np.cumsum(np.random.randn(num_days) * 0.5 + 0.05)
        close = np.maximum(close, 1.0)
        # Crash the last bar way below the 50d MA
        close[-1] = close[-50:].mean() * 0.80
        price_data = pd.DataFrame(
            {
                "Open": close * 0.99,
                "High": close * 1.02,
                "Low": close * 0.98,
                "Close": close,
                "Volume": np.random.randint(100_000, 5_000_000, size=num_days).astype(float),
            },
            index=dates,
        )
        benchmark_data = _make_price_data(num_days, start_price=400.0)
        data = StockData(
            symbol="CRASHED",
            price_data=price_data,
            benchmark_data=benchmark_data,
        )

        scanner = SetupEngineScanner()
        result = scanner.scan_stock("CRASHED", data)

        assert "setup_engine" in result.details
        payload = result.details["setup_engine"]
        flags = payload["explain"]["invalidation_flags"]
        flag_codes = {flag["code"] for flag in flags}
        assert "breaks_50d_support" in flag_codes

    def test_no_operational_flags_on_clean_uptrend(self):
        """Deterministic uptrend above 50d MA with healthy volume → no operational flags."""
        num_days = 350
        dates = pd.bdate_range(end=pd.Timestamp("2025-12-19"), periods=num_days)
        # Deterministic steady uptrend — guarantees close > 50d MA
        close = np.linspace(50.0, 100.0, num_days)
        price_data = pd.DataFrame(
            {
                "Open": close * 0.995,
                "High": close * 1.02,
                "Low": close * 0.98,
                "Close": close,
                "Volume": np.full(num_days, 2_000_000.0),
            },
            index=dates,
        )
        benchmark_data = _make_price_data(num_days, start_price=400.0)
        data = StockData(
            symbol="UPTREND",
            price_data=price_data,
            benchmark_data=benchmark_data,
        )

        scanner = SetupEngineScanner()
        result = scanner.scan_stock("UPTREND", data)

        assert "setup_engine" in result.details
        payload = result.details["setup_engine"]
        flags = payload["explain"]["invalidation_flags"]
        operational_flag_names = {"too_extended", "breaks_50d_support", "low_liquidity", "earnings_soon"}
        operational_present = [
            f["code"] for f in flags if f.get("code") in operational_flag_names
        ]
        assert operational_present == [], f"Unexpected operational flags: {operational_present}"


class TestConfidenceFloorContract:
    """The check name and floor the brief's base check reads (round 2, plan section 2.2).

    ``frontend/tools/recalculate-setups.py`` writes ``setup_recalculation.reason`` as
    ``' / '.join(payload['explain']['failed_checks'])`` from this scanner's payload, so the
    name is pinned where that reason is built, not only in the aggregator's own list.
    """

    @staticmethod
    def _payload(confidence: float) -> dict:
        class _OneCandidateDetector(PatternDetector):
            name = "detector_floor"

            def detect(self, detector_input, parameters):
                del detector_input, parameters
                return PatternDetectorResult.detected(
                    self.name,
                    PatternCandidateModel(
                        pattern="detector_floor",
                        timeframe="daily",
                        source_detector=self.name,
                        quality_score=None,
                        readiness_score=None,
                        confidence=confidence,
                    ),
                )

        scanner = SetupEngineScanner()
        scanner._aggregator = SetupEngineAggregator(detectors=[_OneCandidateDetector()])
        result = scanner.scan_stock("FLOOR", _make_stock_data(num_days=350))
        return result.details["setup_engine"]

    def test_floor_is_55(self):
        assert DEFAULT_SETUP_ENGINE_PARAMETERS.pattern_confidence_min_pct == 55.0

    def test_below_floor_fallback_names_the_check_in_the_explain_failed_checks(self):
        payload = self._payload(0.20)
        failed = payload["explain"]["failed_checks"]

        assert payload["pattern_confidence"] < 55.0
        assert payload["setup_ready"] is False
        assert "primary_pattern_below_confidence_floor" in failed
        assert "primary_pattern_below_confidence_floor" in " / ".join(failed)

    def test_selected_primary_does_not_name_the_check(self):
        payload = self._payload(0.95)

        assert payload["pattern_confidence"] >= 55.0
        assert "primary_pattern_below_confidence_floor" not in payload["explain"]["failed_checks"]


class TestSetupReadinessRegressions:
    """Round 2 (setup-ready-always-false): readiness comes from the 10 gates and the
    primary-pattern checks only. Before, every detector that did not find its own
    pattern (``not_detected``, ``cup_structure_not_found``) and the DoubleBottom stub
    (``not_implemented``) were counted as failures, so no stock could ever be ready.
    """

    @staticmethod
    def _frames(num_days: int = 350) -> tuple[pd.DataFrame, pd.DataFrame]:
        """A steady leader (+0.3%/day, quiet last 10 sessions) against a flat benchmark."""
        index = pd.bdate_range(end=pd.Timestamp("2025-12-19"), periods=num_days)
        rng = np.random.default_rng(7)
        close = 50 * 1.003 ** np.arange(num_days) * (1 + rng.normal(0, 0.002, num_days))
        volume = np.full(num_days, 2_000_000.0)
        volume[-10:] = 900_000.0
        stock = pd.DataFrame(
            {"Open": close * 0.998, "High": close * 1.008, "Low": close * 0.992, "Close": close, "Volume": volume},
            index=index,
        )
        spy_close = 400 * (1 + rng.normal(0, 0.002, num_days))
        spy = pd.DataFrame(
            {"Open": spy_close, "High": spy_close * 1.004, "Low": spy_close * 0.996, "Close": spy_close,
             "Volume": np.full(num_days, 5e7)},
            index=index,
        )
        return stock, spy

    def _payload(self, *, distance_pct: float, confidence: float = 0.8) -> dict:
        from app.analysis.patterns.detectors import DoubleBottomDetector

        stock, spy = self._frames()
        pivot = float(stock["Close"].iloc[-1]) / (1 + distance_pct / 100)

        class _IdealVcp(PatternDetector):
            name = "vcp"

            def detect(self, detector_input, parameters):
                del detector_input, parameters
                return PatternDetectorResult.detected(
                    self.name,
                    PatternCandidateModel(
                        pattern="vcp", timeframe="daily", source_detector=self.name, pivot_price=pivot,
                        pivot_type="vcp_pivot", quality_score=85.0, readiness_score=88.0, confidence=confidence,
                    ),
                )

        class _NoCup(PatternDetector):
            name = "cup_with_handle"

            def detect(self, detector_input, parameters):
                del detector_input, parameters
                return PatternDetectorResult.no_detection(
                    self.name, failed_checks=("not_detected", "cup_structure_not_found"),
                )

        scanner = SetupEngineScanner()
        scanner._aggregator = SetupEngineAggregator(detectors=[_IdealVcp(), _NoCup(), DoubleBottomDetector()])
        result = scanner.scan_stock("IDEAL", StockData(symbol="IDEAL", price_data=stock, benchmark_data=spy))
        payload = result.details["setup_engine"]
        assert result.passes is payload["setup_ready"]
        return payload

    def test_an_ideal_vcp_is_ready_whatever_the_other_detectors_found(self):
        payload = self._payload(distance_pct=-1.0)
        explain = payload["explain"]

        assert payload["pattern_primary"] == "vcp"
        assert payload["pattern_confidence"] >= 55.0
        assert payload["setup_ready"] is True
        assert explain["failed_checks"] == []
        # The other detectors' misses and the stub are kept as diagnostics, inside explain.
        assert set(explain["diagnostics"]) == {"not_detected", "cup_structure_not_found", "not_implemented"}
        assert "not_implemented" not in explain["failed_checks"]

    def test_the_same_vcp_six_percent_past_the_pivot_is_not_ready(self):
        payload = self._payload(distance_pct=6.0)

        assert payload["setup_ready"] is False
        assert payload["explain"]["failed_checks"] == ["outside_early_zone"]
        # The scores do not depend on readiness.
        assert payload["setup_score"] == self._payload(distance_pct=-1.0)["setup_score"]

    def test_a_below_floor_fallback_is_not_ready(self):
        payload = self._payload(distance_pct=-1.0, confidence=0.2)

        assert payload["pattern_confidence"] < 55.0
        assert payload["setup_ready"] is False
        assert payload["explain"]["failed_checks"] == ["primary_pattern_below_confidence_floor"]
