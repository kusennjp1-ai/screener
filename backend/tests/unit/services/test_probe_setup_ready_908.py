"""Mechanics tests for the auxiliary 908 readiness probe (scripts/probe_setup_ready_908.py).

They pin the probe's own correctness without the 908 bundle: zero look-ahead
(no scanner sees a bar after T0), the control rule (same stock 63 bars before
T0, kept only with >= 210 prior bars), the gate table against the readiness
gates, and that missing values are never counted as passes or fails.
"""
import gzip
import json
import logging
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import pandas as pd
import pytest

_SCRIPTS = Path(__file__).resolve().parents[3] / "scripts"
sys.path.insert(0, str(_SCRIPTS))

import probe_setup_ready_908 as probe  # noqa: E402

from app.analysis.patterns.config import DEFAULT_SETUP_ENGINE_PARAMETERS  # noqa: E402
from app.analysis.patterns.explain_builder import (  # noqa: E402
    ExplainBuilderInput,
    build_explain_payload,
)
from app.analysis.patterns.report import KeyLevels  # noqa: E402


def _frame(n=320, start="2021-01-04", trend=0.001, seed=7):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(start, periods=n)
    close = 50 * np.cumprod(1 + trend + rng.normal(0, 0.005, n))
    open_ = np.concatenate([[close[0]], close[:-1]])
    return pd.DataFrame(
        {
            "Open": open_,
            "High": np.maximum(open_, close) * 1.01,
            "Low": np.minimum(open_, close) * 0.99,
            "Close": close,
            "Volume": rng.integers(8e5, 1.2e6, n).astype(float),
        },
        index=idx,
    )


class _Recorder:
    """Stub scanner factories that record the last bar each scanner was shown."""

    def __init__(self, se_payload=None):
        self.seen = []
        self.se_payload = se_payload if se_payload is not None else {
            "setup_ready": False,
            "setup_score": 50.0,
            "stage": 2,
            "pattern_primary": "vcp",
            "pivot_price": 10.0,
            "volume_vs_50d": 0.7,
            "distance_to_pivot_pct": -2.0,
            "explain": {"failed_checks": ["outside_early_zone"]},
        }

    def _scanner(self, details):
        recorder = self

        class _S:
            def scan_stock(self, symbol, data):
                recorder.seen.append(
                    (data.price_data.index.max(), data.benchmark_data.index.max())
                )
                return SimpleNamespace(details=details)

        return _S

    def factories(self):
        return (
            self._scanner({"stage": 2, "passes_template": True}),
            self._scanner({"setup_engine": self.se_payload}),
        )


# ── look-ahead truncation ───────────────────────


def test_truncate_at_keeps_bars_on_or_before_t0_only():
    df = _frame(n=40)
    t0 = df.index[25]
    cut = probe.truncate_at(df, t0)
    assert cut.index.max() == t0
    assert len(cut) == 26


def test_no_scanner_sees_a_stock_or_benchmark_bar_after_t0():
    df, spy = _frame(), _frame(trend=0.0004, seed=11)
    t0 = df.index[250]
    rec = _Recorder()
    record, reason = probe.evaluate_point(df, spy, t0, rec.factories())
    assert reason is None and record["as_of"] == t0.date().isoformat()
    assert rec.seen and all(p <= t0 and b <= t0 for p, b in rec.seen)


def test_future_bars_do_not_change_the_result_with_the_real_scanners():
    df, spy = _frame(), _frame(trend=0.0004, seed=11)
    t0 = df.index[260]
    full, _ = probe.evaluate_point(df, spy, t0)
    cut, _ = probe.evaluate_point(df.iloc[:261], spy.iloc[:261], t0)
    assert full is not None and full["se_status"] == "ok"
    assert full == cut


def test_short_stock_or_benchmark_history_is_skipped_not_scored():
    df, spy = _frame(), _frame(trend=0.0004, seed=11)
    rec = _Recorder()
    assert probe.evaluate_point(df, spy, df.index[probe.MIN_PRIOR_BARS - 2], rec.factories()) == (
        None, probe.SKIP_SHORT_HISTORY)
    late_spy = spy.iloc[100:]
    assert probe.evaluate_point(df, late_spy, df.index[250], rec.factories()) == (
        None, probe.SKIP_SHORT_SPY)
    assert rec.seen == []


# ── control selection ───────────────────────────


def test_control_is_63_bars_before_t0():
    idx = _frame(n=400).index
    assert probe.CONTROL_OFFSET_BARS == 63 and probe.MIN_PRIOR_BARS == 210
    assert probe.control_t0(idx, idx[300]) == idx[237]


def test_control_from_a_non_trading_t0_counts_from_the_last_bar_before_it():
    idx = _frame(n=400).index
    friday = next(d for d in idx[290:] if d.weekday() == 4)
    saturday = friday + pd.Timedelta(days=1)
    pos = idx.get_loc(friday)
    assert probe.control_t0(idx, saturday) == idx[pos - 63]


def test_no_control_when_it_would_have_fewer_than_210_prior_bars():
    idx = _frame(n=400).index
    assert probe.control_t0(idx, idx[272]) is None  # 272 - 63 = 209
    assert probe.control_t0(idx, idx[273]) == idx[210]


def _write_gz(path, df):
    path.write_bytes(gzip.compress(df.rename_axis("Date").to_csv().encode("utf-8")))


def test_run_probe_pairs_each_entry_with_its_control(tmp_path):
    df, spy = _frame(n=400), _frame(n=400, trend=0.0004, seed=11)
    _write_gz(tmp_path / "AAA.csv.gz", df)
    ideas = [
        {"Ticker": "aaa ", "Date": str(df.index[300].date())},  # entry + control
        {"Ticker": "AAA", "Date": str(df.index[260].date())},  # entry, control too early
        {"Ticker": "AAA", "Date": str(df.index[100].date())},  # short history
        {"Ticker": "ZZZ", "Date": str(df.index[300].date())},  # not in the bundle
    ]
    rec = _Recorder()
    out = probe.run_probe(ideas, tmp_path, spy, rec.factories())
    assert out["attempted"] == 4
    assert [r["as_of"] for r in out["rows"]["entry"]] == [
        str(df.index[300].date()), str(df.index[260].date())]
    assert [r["as_of"] for r in out["rows"]["control"]] == [str(df.index[237].date())]
    assert out["rows"]["control"][0]["idea_date"] == ideas[0]["Date"]
    assert dict(out["skips"]["entry"]) == {
        probe.SKIP_SHORT_HISTORY: 1, probe.SKIP_NO_BUNDLE_FILE: 1}
    assert dict(out["skips"]["control"]) == {probe.SKIP_CONTROL_TOO_EARLY: 1}


# ── gate table and missing values ───────────────


def test_gate_table_names_every_readiness_gate_failure():
    failing = ExplainBuilderInput(
        pre_existing_passed_checks=(),
        pre_existing_failed_checks=(),
        key_levels=KeyLevels(),
        pre_existing_invalidation_flags=(),
        setup_score=0.0,
        quality_score=0.0,
        readiness_score=0.0,
        distance_to_pivot_pct=None,
        atr14_pct=99.0,
        volume_vs_50d=99.0,
        rs_vs_spy_65d=-5.0,
        rs_line_new_high=False,
        stage=4,
        ma_alignment_score=0.0,
        rs_rating=0.0,
        parameters=DEFAULT_SETUP_ENGINE_PARAMETERS,
        readiness_threshold_pct=70.0,
    )
    failed = build_explain_payload(failing).explain.failed_checks
    assert sorted(probe.GATE_OF_CHECK[c] for c in failed) == list(probe.GATES)


def _row(**kw):
    base = dict(ready=False, failed=[], setup_score=50.0, se_stage=2, mv_stage=2,
                tt=True, primary="vcp", vol=0.5, dist=-1.0, se_status="ok")
    base.update(kw)
    return base


def test_missing_values_are_counted_apart_never_as_pass_or_fail():
    rows = [
        _row(ready=True, vol=0.6, dist=-1.0),
        _row(ready=None, se_status="error", setup_score=None, se_stage=None,
             vol=None, dist=None, failed=[]),
        _row(ready=False, vol=2.0, dist=1.5, failed=["volume_above_dryup_cap"]),
        _row(ready=False, failed=["volume_below_minimum", "some_policy_check"]),
    ]
    s = probe.summarize_side(rows)
    assert (s["n"], s["ready_n"], s["ready_unknown_n"]) == (4, 1, 1)
    assert s["gate_fail_n"]["6"] == 2
    assert s["other_failed_checks"] == {"some_policy_check": 1}
    assert (s["breakout_day_n"], s["breakout_day_unknown_n"], s["ready_on_breakout_day_n"]) == (1, 1, 0)
    assert s["se_stage_unknown_n"] == 1 and s["se_status"] == {"ok": 3, "error": 1}


def test_discrimination_uses_raw_counts():
    assert probe._delta_pp(28, 588, 23, 575) == 0.8
    assert probe._delta_pp(1, 0, 1, 1) is None


def test_missing_bundle_exits_2_and_writes_no_json(tmp_path, capsys):
    out = tmp_path / "probe.json"
    before = logging.root.manager.disable
    assert probe.main(["--bundle", str(tmp_path / "absent"), "--json", str(out)]) == 2
    assert not out.exists()
    assert "未検証" in capsys.readouterr().err
    assert logging.root.manager.disable == before


def test_main_restores_logging_and_writes_json_with_unknown_rates(tmp_path):
    _write_gz(tmp_path / "_SPY.csv.gz", _frame(n=400, trend=0.0004, seed=11))
    out = tmp_path / "probe.json"
    before = logging.root.manager.disable
    assert probe.main(["--bundle", str(tmp_path), "--limit", "3", "--json", str(out)]) == 0
    assert logging.root.manager.disable == before
    report = json.loads(out.read_text(encoding="utf-8"))
    assert report["skips"]["entry"] == {probe.SKIP_NO_BUNDLE_FILE: 3}
    assert report["entry"]["n"] == 0 and report["entry"]["ready_pct"] is None
    assert report["discrimination_pp"]["setup_ready"] is None


@pytest.mark.parametrize("value,expected", [
    (True, True), (np.bool_(False), False), (None, None), (1, None), ("yes", None)])
def test_flag_keeps_only_real_booleans(value, expected):
    assert probe._flag(value) is expected
