"""Tests for thesis_review.py — review, postmortem, and MAE/MFE."""

from pathlib import Path

import pytest
import thesis_review
import thesis_store

# -- Helpers -------------------------------------------------------------------


def _make_thesis_data(**overrides):
    data = {
        "ticker": "AAPL",
        "thesis_type": "dividend_income",
        "thesis_statement": "AAPL dividend test thesis",
        "origin": {"skill": "test", "output_file": "test.json"},
    }
    data.update(overrides)
    return data


_ACTIVE_COUNTER = 0


def _create_active_thesis(
    state_dir: Path, entry_price=150.0, entry_date="2026-03-01T10:00:00+00:00"
):
    """Create a thesis in ACTIVE state with entry data."""
    global _ACTIVE_COUNTER
    _ACTIVE_COUNTER += 1
    data = _make_thesis_data(thesis_statement=f"test thesis #{_ACTIVE_COUNTER}")
    tid = thesis_store.register(state_dir, data)
    thesis_store.transition(state_dir, tid, "ENTRY_READY", "ok")
    thesis_store.open_position(state_dir, tid, entry_price, entry_date)
    return tid


def _create_closed_thesis(state_dir: Path, entry_price=150.0, exit_price=165.0, pnl_pct=10.0):
    """Create a thesis in CLOSED state."""
    tid = _create_active_thesis(state_dir, entry_price)
    thesis_store.close(state_dir, tid, "target_hit", exit_price, "2026-04-01T10:00:00+00:00")
    return tid


class MockPriceAdapter:
    """Mock adapter returning fixed prices."""

    def __init__(self, prices):
        self.prices = prices

    def get_daily_closes(self, ticker, from_date, to_date):
        return self.prices


# -- Tests: list_review_due ---------------------------------------------------


def test_list_review_due_filters_correctly(tmp_path: Path):
    """list_review_due: in-range returned, out-of-range excluded."""
    state_dir = tmp_path / "theses"

    tid1 = thesis_store.register(state_dir, _make_thesis_data(ticker="AAPL"))
    tid2 = thesis_store.register(state_dir, _make_thesis_data(ticker="MSFT"))

    # Set tid1 as due, tid2 as not due
    thesis_store.update(state_dir, tid1, {"monitoring": {"next_review_date": "2026-03-01"}})
    thesis_store.update(state_dir, tid2, {"monitoring": {"next_review_date": "2026-06-01"}})

    due = thesis_store.list_review_due(state_dir, "2026-03-14")
    tids = [d["thesis_id"] for d in due]
    assert tid1 in tids
    assert tid2 not in tids


# -- Tests: compute_mae_mfe ---------------------------------------------------


def test_compute_mae_mfe_with_mock_adapter(tmp_path: Path):
    """compute_mae_mfe: mock adapter → correct MAE/MFE values."""
    state_dir = tmp_path / "theses"
    tid = _create_closed_thesis(state_dir, entry_price=150.0, exit_price=165.0)
    thesis = thesis_store.get(state_dir, tid)

    adapter = MockPriceAdapter(
        [
            {"date": "2026-03-01", "close": 150.0},
            {"date": "2026-03-05", "close": 145.0},  # MAE: -3.33%
            {"date": "2026-03-15", "close": 170.0},  # MFE: +13.33%
            {"date": "2026-04-01", "close": 165.0},
        ]
    )

    result = thesis_review.compute_mae_mfe(thesis, adapter)
    assert result["mae_pct"] == pytest.approx(-3.33, abs=0.01)
    assert result["mfe_pct"] == pytest.approx(13.33, abs=0.01)
    assert result["mae_mfe_source"] == "fmp_eod"


def test_compute_mae_mfe_no_adapter_returns_nulls(tmp_path: Path):
    """compute_mae_mfe: adapter=None → null values, no error."""
    state_dir = tmp_path / "theses"
    tid = _create_closed_thesis(state_dir)
    thesis = thesis_store.get(state_dir, tid)

    result = thesis_review.compute_mae_mfe(thesis, None)
    assert result["mae_pct"] is None
    assert result["mfe_pct"] is None
    assert result["mae_mfe_source"] is None


# -- Tests: generate_postmortem ------------------------------------------------


def test_generate_postmortem_rejects_active(tmp_path: Path):
    """generate_postmortem should reject non-CLOSED/INVALIDATED theses."""
    state_dir = tmp_path / "theses"
    tid = _create_active_thesis(state_dir)

    with pytest.raises(ValueError, match="CLOSED or INVALIDATED"):
        thesis_review.generate_postmortem(tid, str(state_dir))


def test_generate_postmortem_allows_invalidated(tmp_path: Path):
    """generate_postmortem should work for INVALIDATED theses."""
    state_dir = tmp_path / "theses"
    journal_dir = tmp_path / "journal"
    tid = thesis_store.register(state_dir, _make_thesis_data())
    thesis_store.terminate(state_dir, tid, "INVALIDATED", "kill criteria")

    pm_path = thesis_review.generate_postmortem(tid, str(state_dir), journal_dir=str(journal_dir))
    content = Path(pm_path).read_text()
    assert "INVALIDATED" in content


def test_generate_postmortem_contains_pnl(tmp_path: Path):
    """generate_postmortem: output contains pnl and holding_days."""
    state_dir = tmp_path / "theses"
    journal_dir = tmp_path / "journal"

    tid = _create_closed_thesis(state_dir, entry_price=150.0, exit_price=165.0)

    pm_path = thesis_review.generate_postmortem(tid, str(state_dir), journal_dir=str(journal_dir))

    content = Path(pm_path).read_text()
    assert "Postmortem:" in content
    assert "AAPL" in content
    assert "10.0%" in content  # pnl_pct
    assert "target_hit" in content
    assert "31" in content  # holding_days


def test_generate_postmortem_with_adapter(tmp_path: Path):
    """generate_postmortem: with price adapter updates MAE/MFE."""
    state_dir = tmp_path / "theses"
    journal_dir = tmp_path / "journal"

    tid = _create_closed_thesis(state_dir, entry_price=150.0, exit_price=165.0)

    adapter = MockPriceAdapter(
        [
            {"date": "2026-03-01", "close": 150.0},
            {"date": "2026-03-10", "close": 140.0},
            {"date": "2026-03-20", "close": 172.0},
        ]
    )

    thesis_review.generate_postmortem(
        tid, str(state_dir), price_adapter=adapter, journal_dir=str(journal_dir)
    )

    # Verify thesis was updated
    thesis = thesis_store.get(state_dir, tid)
    assert thesis["outcome"]["mae_pct"] is not None
    assert thesis["outcome"]["mfe_pct"] is not None


# -- Tests: summary_stats -----------------------------------------------------


def test_summary_stats_three_theses(tmp_path: Path):
    """summary_stats: 3 closed theses → correct win rate."""
    state_dir = tmp_path / "theses"

    # Win (10%)
    _create_closed_thesis(state_dir, entry_price=100.0, exit_price=110.0)
    # Win (5%)
    _create_closed_thesis(state_dir, entry_price=100.0, exit_price=105.0)
    # Loss (-10%)
    tid3 = _create_active_thesis(state_dir, entry_price=100.0)
    thesis_store.close(state_dir, tid3, "stop_hit", 90.0, "2026-04-01T10:00:00+00:00")

    stats = thesis_review.summary_stats(str(state_dir))
    assert stats["count"] == 3
    assert stats["win_rate"] == pytest.approx(0.6667, abs=0.001)
    assert stats["avg_pnl_pct"] == pytest.approx(1.67, abs=0.01)


def test_summary_stats_includes_invalidated_with_pnl(tmp_path: Path):
    """summary_stats should include INVALIDATED theses that have P&L."""
    state_dir = tmp_path / "theses"

    # 1 closed win (+10%)
    _create_closed_thesis(state_dir, entry_price=100.0, exit_price=110.0)

    # 1 invalidated with P&L (-5%)
    tid2 = _create_active_thesis(state_dir, entry_price=100.0)
    thesis_store.terminate(
        state_dir,
        tid2,
        "INVALIDATED",
        "kill criteria",
        actual_price=95.0,
        actual_date="2026-04-01T10:00:00+00:00",
    )

    # 1 invalidated without P&L (IDEA → INVALIDATED, no position)
    data = _make_thesis_data(thesis_statement="no position thesis")
    tid3 = thesis_store.register(state_dir, data)
    thesis_store.terminate(state_dir, tid3, "INVALIDATED", "not interested")

    stats = thesis_review.summary_stats(str(state_dir))
    assert stats["count"] == 2  # only those with P&L
    assert stats["win_rate"] == 0.5  # 1 win, 1 loss
    assert stats["avg_pnl_pct"] == pytest.approx(2.5, abs=0.01)  # (10 + -5) / 2


# -- Position exhaustion -------------------------------------------------------


def _active_thesis(entry_date="2026-03-01T00:00:00+00:00", entry_price=100.0, **extra):
    t = {
        "status": "ACTIVE",
        "entry": {"actual_date": entry_date, "actual_price": entry_price,
                  "target_price": extra.pop("target_price", None)},
        "exit": extra.pop("exit", {}),
    }
    t.update(extra)
    return t


def test_exhaustion_active_window():
    t = _active_thesis()
    r = thesis_review.position_exhaustion(t, as_of="2026-03-06")  # 5 days held
    assert r["applicable"] is True
    assert r["hold_duration_days"] == 5
    assert r["days_to_exhaustion"] == 23
    assert r["exhaustion_status"] == "active"
    assert r["recommended_action"] == "none"


def test_exhaustion_warning_window():
    t = _active_thesis()
    r = thesis_review.position_exhaustion(t, as_of="2026-03-24")  # 23 days (>= 28-7)
    assert r["exhaustion_status"] == "warning"
    assert r["recommended_action"] == "tighten_stop"


def test_exhaustion_critical_exits_when_stalled():
    t = _active_thesis()
    r = thesis_review.position_exhaustion(t, as_of="2026-04-05")  # 35 days
    assert r["exhaustion_status"] == "critical"
    assert r["recommended_action"] == "exit"
    assert r["days_to_exhaustion"] == 0


def test_exhaustion_critical_but_near_target_tightens():
    t = _active_thesis(target_price=120.0)
    # 35 days held but price is 90% of the way to target -> tighten, don't dump
    r = thesis_review.position_exhaustion(t, as_of="2026-04-05", current_price=118.0)
    assert r["exhaustion_status"] == "critical"
    assert r["progression_to_target_pct"] == 90.0
    assert r["recommended_action"] == "tighten_stop"


def test_exhaustion_respects_thesis_time_stop_days():
    t = _active_thesis(exit={"time_stop_days": 10})
    r = thesis_review.position_exhaustion(t, as_of="2026-03-13")  # 12 days, window 10
    assert r["exhaustion_days"] == 10
    assert r["exhaustion_status"] == "critical"


def test_exhaustion_not_applicable_for_non_active():
    assert thesis_review.position_exhaustion({"status": "IDEA"})["applicable"] is False
    assert thesis_review.position_exhaustion(
        {"status": "ACTIVE", "entry": {}})["applicable"] is False


def test_list_exhaustion_alerts_flags_stale_active(tmp_path):
    state_dir = tmp_path / "theses"
    state_dir.mkdir()
    # one fresh, one stale ACTIVE thesis
    _create_active_thesis(state_dir, entry_date="2026-06-01T00:00:00+00:00")  # fresh
    _create_active_thesis(state_dir, entry_date="2026-03-01T00:00:00+00:00")  # stale
    alerts = thesis_review.list_exhaustion_alerts(str(state_dir), as_of="2026-06-20")
    assert len(alerts) == 1
    assert alerts[0]["exhaustion_status"] == "critical"
    assert alerts[0]["ticker"] == "AAPL"
