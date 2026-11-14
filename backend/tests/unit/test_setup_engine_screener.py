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

    def _scan(self, *, distance_pct: float = -1.0, confidence: float = 0.8, others=None) -> ScreenerResult:
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

        detectors = [_IdealVcp(), *(others if others is not None else (_NoCup(), DoubleBottomDetector()))]
        scanner = SetupEngineScanner()
        scanner._aggregator = SetupEngineAggregator(detectors=detectors)
        return scanner.scan_stock("IDEAL", StockData(symbol="IDEAL", price_data=stock, benchmark_data=spy))

    def _payload(self, *, distance_pct: float, confidence: float = 0.8, others=None) -> dict:
        result = self._scan(distance_pct=distance_pct, confidence=confidence, others=others)
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
        # The other detectors' misses and the stub are kept as diagnostics, inside explain,
        # each named after its detector. A steady advance has no measured contraction, so the
        # round-3 setup diagnostic follows them; it never fails readiness either.
        assert explain["diagnostics"] == [
            "cup_with_handle:not_detected",
            "cup_with_handle:cup_structure_not_found",
            "double_bottom:not_implemented",
            "contraction_unconfirmed",
        ]
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

    def test_one_detector_short_of_history_does_not_block_a_ready_vcp(self):
        """A detector reporting insufficient_data (its own history need, not the data policy's)
        is a diagnostic: the policy passed, so a qualified VCP primary stays ready."""

        class _NeedsMoreHistory(PatternDetector):
            name = "needs_more_history"

            def detect(self, detector_input, parameters):
                del detector_input, parameters
                return PatternDetectorResult.insufficient_data(self.name, failed_checks=("daily_bars_lt_400",))

        payload = self._payload(distance_pct=-1.0, others=[_NeedsMoreHistory()])
        explain = payload["explain"]

        assert payload["setup_ready"] is True
        assert explain["failed_checks"] == []
        assert explain["diagnostics"] == [
            "needs_more_history:insufficient_data",
            "needs_more_history:daily_bars_lt_400",
            "contraction_unconfirmed",
        ]

    def test_a_detector_that_raises_makes_the_scan_an_error_not_a_ready_row(self):
        """A crash means one detector never evaluated the stock: the scan is an Error (as at
        db8e297, now stated explicitly), never a Strong Buy from the detectors that ran."""

        class _Boom(PatternDetector):
            name = "cup_with_handle"

            def detect(self, detector_input, parameters):
                del detector_input, parameters
                raise RuntimeError("boom")

        result = self._scan(distance_pct=-1.0, others=[_Boom()])

        assert result.rating == "Error"
        assert result.passes is False
        assert "setup_engine" not in result.details
        assert result.details["error"] == "cup_with_handle: RuntimeError: boom"

    def test_a_caller_failed_check_fails_readiness_whatever_its_name(self):
        """Fail closed: every failed check a caller passes blocks readiness; only the
        aggregator's separated detector checks (``diagnostics``) never do."""
        from app.scanners.setup_engine_scanner import build_setup_engine_payload

        ready = dict(
            setup_score=80, quality_score=80, readiness_score=95, distance_to_pivot_pct=0,
            pattern_primary="vcp", pattern_confidence=70,
        )
        assert build_setup_engine_payload(**ready)["setup_ready"] is True
        blocked = build_setup_engine_payload(**ready, failed_checks=["trend_break"])
        assert blocked["setup_ready"] is False
        assert blocked["explain"]["failed_checks"][0] == "trend_break"
        noted = build_setup_engine_payload(**ready, diagnostics=["cup_with_handle:not_detected"])
        assert noted["setup_ready"] is True
        assert noted["explain"]["diagnostics"] == ["cup_with_handle:not_detected"]


class TestSetupDiagnostics:
    """Round 3 R3c: three setup diagnostics for ``explain.diagnostics``. Each fires on its
    shape, is absent when its input is missing (unknown is not a finding), and never fails
    readiness."""

    @staticmethod
    def _frame(closes, *, spread: float = 0.005, end: str = "2025-12-19") -> pd.DataFrame:
        closes = np.asarray(closes, dtype=float)
        index = pd.bdate_range(end=pd.Timestamp(end), periods=len(closes))
        return pd.DataFrame(
            {"Open": closes, "High": closes * (1 + spread), "Low": closes * (1 - spread),
             "Close": closes, "Volume": np.full(len(closes), 1e6)},
            index=index,
        )

    @staticmethod
    def _ramp(*legs):
        """Piecewise-linear closes: legs of (target, sessions) from a start value."""
        out = [float(legs[0])]
        for target, sessions in legs[1:]:
            start = out[-1]
            out.extend(start + (target - start) * (k + 1) / sessions for k in range(sessions))
        return out

    def _diagnostics(self, frame, *, pattern, timeframe, pivot, pivot_date, **candidate):
        from app.analysis.patterns.readiness import setup_diagnostics

        cand = {"pattern": pattern, "timeframe": timeframe, "pivot_price": pivot, "pivot_date": pivot_date, **candidate}
        return setup_diagnostics(
            frame, pattern_primary=pattern, pivot_price=pivot, pivot_date=pivot_date, candidates=[cand],
        )

    def test_constants_are_named_and_unchanged(self):
        from app.analysis.patterns import config

        assert config.PIVOT_ALREADY_CROSSED_PCT == 3.0
        assert config.PIVOT_BELOW_BASE_HIGH_PCT == 5.0

    # -- pivot_already_crossed ------------------------------------------------

    def _pivot_frame(self, after_close: float):
        """A daily pivot on bar 99 (high = pivot), then one close at ``after_close`` on bar 100."""
        closes = [50.0] * 99 + [50.0, after_close, 50.0]
        frame = self._frame(closes, spread=0.0)
        frame.iloc[99, frame.columns.get_loc("High")] = 51.0
        return frame, frame.index[99].date().isoformat()

    def test_pivot_already_crossed_fires_on_a_close_above_pivot_plus_three_percent_after_its_bar(self):
        frame, day = self._pivot_frame(after_close=51.0 * 1.031)
        found = self._diagnostics(frame, pattern="nr7_inside_day", timeframe="daily", pivot=51.0, pivot_date=day)
        assert "pivot_already_crossed" in found

    def test_pivot_already_crossed_needs_more_than_three_percent(self):
        frame, day = self._pivot_frame(after_close=51.0 * 1.029)
        found = self._diagnostics(frame, pattern="nr7_inside_day", timeframe="daily", pivot=51.0, pivot_date=day)
        assert "pivot_already_crossed" not in found

    def test_pivot_already_crossed_is_absent_without_the_pivots_bar(self):
        frame, day = self._pivot_frame(after_close=60.0)
        for pivot_date, timeframe, pivot in ((None, "daily", 51.0), ("2025-13-01", "daily", 51.0),
                                             (day, "daily", 51.5), (day, "daily", None)):
            found = self._diagnostics(frame, pattern="nr7_inside_day", timeframe=timeframe, pivot=pivot,
                                      pivot_date=pivot_date)
            assert "pivot_already_crossed" not in found, (pivot_date, timeframe, pivot)
        # No candidate of the primary's pattern: its timeframe (and so its pivot's bar) is unknown.
        from app.analysis.patterns.readiness import setup_diagnostics

        assert "pivot_already_crossed" not in setup_diagnostics(
            frame, pattern_primary="nr7_inside_day", pivot_price=51.0, pivot_date=day, candidates=[])

    def test_a_weekly_label_bounds_at_the_latest_bar_of_its_week_with_the_pivots_high(self):
        """The W-FRI label is the week's Friday; the pivot's bar is Wednesday (its high in cents).
        A close far above the pivot on the Tuesday before it is not a crossing; Thursday's is."""
        from app.analysis.patterns.readiness import daily_bars_from_frame, pivot_bar_index

        closes = [50.0] * 100
        frame = self._frame(closes, spread=0.0, end="2025-12-19")  # ends on a Friday
        tue, wed, thu = frame.index[-4], frame.index[-3], frame.index[-2]
        frame.loc[wed, "High"] = 51.0
        frame.loc[tue, "Close"] = 60.0
        frame.loc[tue, "High"] = 60.0
        label = frame.index[-1].date().isoformat()
        bars = daily_bars_from_frame(frame)
        assert pivot_bar_index(bars, pivot_price=51.0, pivot_date=label, timeframe="weekly") == len(frame) - 3
        found = self._diagnostics(frame, pattern="cup_with_handle", timeframe="weekly", pivot=51.0, pivot_date=label)
        assert "pivot_already_crossed" not in found
        frame.loc[thu, "Close"] = 53.0
        found = self._diagnostics(frame, pattern="cup_with_handle", timeframe="weekly", pivot=51.0, pivot_date=label)
        assert "pivot_already_crossed" in found

    def test_cents_round_half_up_as_javascript_does(self):
        """pivotBar.js compares Math.round(price × 100): 10.125 is 1013 cents (Python's round gives 1012)."""
        from app.analysis.patterns.readiness import _cents, daily_bars_from_frame, pivot_bar_index

        assert _cents(10.125) == 1013 and round(10.125 * 100) == 1012
        frame = self._frame([10.0] * 30, spread=0.0)
        frame.iloc[-1, frame.columns.get_loc("High")] = 10.13
        bars = daily_bars_from_frame(frame)
        day = frame.index[-1].date().isoformat()
        assert pivot_bar_index(bars, pivot_price=10.125, pivot_date=day, timeframe="daily") == len(frame) - 1

    # -- pivot_below_base_high ------------------------------------------------

    def _cup_frame(self, pivot_high: float):
        """A left lip at 100 (a Friday), a cup, then a handle whose high is the pivot."""
        closes = self._ramp(80.0, (100.0, 40), (75.0, 30), (pivot_high, 30), (pivot_high - 3, 5), (pivot_high - 1, 5))
        frame = self._frame(closes, spread=0.0)
        top = frame.index[40]
        frame.loc[top, "High"] = 100.0
        handle = frame.index[100]
        return frame, top, handle

    def test_pivot_below_base_high_fires_more_than_five_percent_under_the_left_lip(self):
        frame, top, handle = self._cup_frame(pivot_high=94.0)
        day = handle.date().isoformat()
        found = self._diagnostics(frame, pattern="first_pullback", timeframe="daily", pivot=94.0, pivot_date=day,
                                  start_date=handle.date().isoformat(), metrics={"left_lip_date": top.date().isoformat()})
        assert "pivot_below_base_high" in found

    def test_pivot_below_base_high_is_absent_within_five_percent_or_without_a_base_start(self):
        frame, top, handle = self._cup_frame(pivot_high=96.0)
        day = handle.date().isoformat()
        found = self._diagnostics(frame, pattern="first_pullback", timeframe="daily", pivot=96.0, pivot_date=day,
                                  metrics={"left_lip_date": top.date().isoformat()})
        assert "pivot_below_base_high" not in found
        frame, top, handle = self._cup_frame(pivot_high=94.0)
        day = handle.date().isoformat()
        # The handle's own start is the start: no left lip, no finding (the window holds the handle only).
        found = self._diagnostics(frame, pattern="first_pullback", timeframe="daily", pivot=94.0, pivot_date=day,
                                  start_date=day)
        assert "pivot_below_base_high" not in found
        found = self._diagnostics(frame, pattern="first_pullback", timeframe="daily", pivot=94.0, pivot_date=day)
        assert "pivot_below_base_high" not in found

    # -- contraction_unconfirmed ----------------------------------------------

    def _contracting(self):
        """An advance to 100, then three progressively shallower contractions (20%, 10%, 4%)."""
        return self._ramp(70.0, (100.0, 60), (80.0, 15), (97.0, 15), (87.0, 10), (95.0, 10), (91.0, 6),
                          (94.0, 4), (93.6, 5))

    def test_contraction_measurement_finds_three_contractions_so_no_diagnostic(self):
        from app.analysis.patterns.readiness import contraction_measurements_valid, daily_bars_from_frame

        frame = self._frame(self._contracting())
        assert contraction_measurements_valid(daily_bars_from_frame(frame), None) is True
        assert "contraction_unconfirmed" not in self._diagnostics(
            frame, pattern="vcp", timeframe="daily", pivot=None, pivot_date=None)

    def test_contraction_unconfirmed_fires_on_a_steady_advance(self):
        frame = self._frame(self._ramp(50.0, (90.0, 200)))
        assert "contraction_unconfirmed" in self._diagnostics(
            frame, pattern="vcp", timeframe="daily", pivot=None, pivot_date=None)

    def test_contraction_unconfirmed_is_absent_when_a_bar_is_missing(self):
        from app.analysis.patterns.readiness import contraction_measurements_valid, daily_bars_from_frame

        frame = self._frame(self._ramp(50.0, (90.0, 200)))
        frame.iloc[150, frame.columns.get_loc("High")] = np.nan
        assert contraction_measurements_valid(daily_bars_from_frame(frame), None) is None
        assert "contraction_unconfirmed" not in self._diagnostics(
            frame, pattern="vcp", timeframe="daily", pivot=None, pivot_date=None)

    # -- never readiness ------------------------------------------------------

    def test_the_diagnostics_never_fail_readiness(self):
        from app.analysis.patterns.readiness import SETUP_DIAGNOSTICS
        from app.scanners.setup_engine_scanner import build_setup_engine_payload

        ready = dict(
            setup_score=80, quality_score=80, readiness_score=95, distance_to_pivot_pct=0,
            pattern_primary="vcp", pattern_confidence=70,
        )
        noted = build_setup_engine_payload(**ready, diagnostics=list(SETUP_DIAGNOSTICS))
        assert noted["setup_ready"] is True
        assert noted["explain"]["failed_checks"] == []
        assert noted["explain"]["diagnostics"] == [
            "contraction_unconfirmed", "pivot_already_crossed", "pivot_below_base_high",
        ]

    def test_contraction_reads_the_setup_engine_base_as_the_payload_publishes_its_dates(self):
        """The brief anchors the base on the primary's published start/end dates (a cup's handle
        dates are lifted from its metrics). Anchored on the last 3% of the base, no sequence is
        found, so the diagnostic fires although the algorithm alone finds three contractions."""
        frame = self._frame(self._contracting())
        start, end = frame.index[-12].date().isoformat(), frame.index[-6].date().isoformat()
        found = self._diagnostics(frame, pattern="cup_with_handle", timeframe="weekly", pivot=None, pivot_date=None,
                                  metrics={"handle_start_date": start, "handle_end_date": end})
        assert "contraction_unconfirmed" in found
        assert "contraction_unconfirmed" not in self._diagnostics(
            frame, pattern="cup_with_handle", timeframe="weekly", pivot=None, pivot_date=None)
