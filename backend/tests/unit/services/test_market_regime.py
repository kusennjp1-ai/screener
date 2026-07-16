"""Tests for the general-market regime engine (Minervini's first rule)."""
import numpy as np
import pandas as pd

from app.services.market_regime import assess_market_regime


def _index(close: np.ndarray, vol: np.ndarray | None = None) -> pd.DataFrame:
    n = len(close)
    idx = pd.bdate_range("2023-01-02", periods=n)
    close = np.asarray(close, dtype="float64")
    if vol is None:
        vol = np.full(n, 1_000_000.0)
    return pd.DataFrame(
        {"Open": close, "High": close * 1.002, "Low": close * 0.998, "Close": close, "Volume": vol},
        index=idx,
    )


def test_confirmed_uptrend():
    # steady advance, no distribution -> confirmed uptrend, full exposure
    r = assess_market_regime(_index(np.linspace(300, 460, 300)))
    assert r["regime"] == "confirmed_uptrend"
    assert r["exposure_pct"] == 100
    assert r["above_50dma"] and r["above_200dma"] and r["fifty_above_200"]
    assert r["distribution_days"] <= 1


def test_breadth_rot_downgrades_a_confirmed_uptrend():
    """C80: index trend intact but <40% of the universe above its 200DMA — a
    narrow rally reads under-pressure, not confirmed."""
    df = _index(np.linspace(300, 460, 300))
    r = assess_market_regime(df, breadth_pct_above_200dma=32.0)
    assert r["regime"] == "uptrend_under_pressure"
    assert r["exposure_pct"] == 55
    assert r["breadth_pct_above_200dma"] == 32.0


def test_healthy_breadth_keeps_the_uptrend_confirmed():
    df = _index(np.linspace(300, 460, 300))
    r = assess_market_regime(df, breadth_pct_above_200dma=68.0)
    assert r["regime"] == "confirmed_uptrend"
    assert r["exposure_pct"] == 100


def test_missing_breadth_is_neutral():
    """None = index-only behaviour, byte-identical (the 908 GATE path)."""
    df = _index(np.linspace(300, 460, 300))
    base = assess_market_regime(df)
    assert base["regime"] == "confirmed_uptrend"
    assert base["breadth_pct_above_200dma"] is None


def test_downtrend():
    # below the 200DMA with 50<200 -> downtrend, zero exposure
    r = assess_market_regime(_index(np.linspace(460, 300, 300)))
    assert r["regime"] == "downtrend"
    assert r["exposure_pct"] == 0


def test_distribution_days_push_uptrend_under_pressure():
    # a rising tape, but recent down-on-volume days pile up -> not fully confirmed
    n = 300
    close = np.linspace(300, 430, n)
    vol = np.full(n, 1_000_000.0)
    # inject 5 distribution days into the last 25 sessions: down >=0.2% on higher vol
    for k in (4, 8, 12, 16, 20):
        i = n - k
        close[i] = close[i - 1] * 0.99      # down ~1%
        vol[i] = vol[i - 1] * 1.5           # on higher volume
    r = assess_market_regime(_index(close, vol))
    assert r["distribution_days"] >= 4
    assert r["regime"] in ("uptrend_under_pressure", "correction")
    assert r["exposure_pct"] < 100


def test_insufficient_data_returns_none():
    r = assess_market_regime(_index(np.linspace(100, 110, 50)))
    assert r["regime"] is None


# --- follow-through day (O'Neil bottom confirmation) -------------------------

def _correction_with_rally(ftd_day: int, ftd_gain: float, ftd_vol_mult: float,
                           rally_days: int = 10, drift: float = 0.003) -> pd.DataFrame:
    """A long uptrend, a ~15% correction, then a rally attempt. On attempt day
    ``ftd_day`` the index gains ``ftd_gain`` on ``ftd_vol_mult``x prior volume;
    other rally days drift ``drift`` on flat volume."""
    up = np.linspace(300, 460, 220)
    down = np.linspace(460, 391, 40)          # -15% correction into the low
    closes = list(up) + list(down)
    vols = [1_000_000.0] * len(closes)
    c = closes[-1]
    for d in range(1, rally_days + 1):
        gain = ftd_gain if d == ftd_day else drift
        c *= 1 + gain
        closes.append(c)
        vols.append(vols[-1] * (ftd_vol_mult if d == ftd_day else 1.0))
    return _index(np.asarray(closes), np.asarray(vols))


def test_ftd_upgrades_correction_to_pilot_uptrend():
    """+1.5% on higher volume on rally-attempt day 5 = a follow-through day:
    the regime leaves correction/downtrend at PILOT exposure, weeks before the
    MAs could recover."""
    r = assess_market_regime(_correction_with_rally(ftd_day=5, ftd_gain=0.015, ftd_vol_mult=1.6))
    assert r["regime"] == "confirmed_uptrend"
    assert r["exposure_pct"] == 50  # one week in: half exposure, not 100
    ftd = r["components"]["follow_through"]
    assert ftd is not None and ftd["attempt_day"] == 5
    assert ftd["gain_pct"] >= 1.2


def test_progressive_exposure_ladder_after_the_ftd():
    """Exposure steps up as the new rally proves itself: 25% in the first
    sessions after the FTD, 50% after a week, 75% after three clean weeks."""
    fresh = assess_market_regime(_correction_with_rally(
        ftd_day=5, ftd_gain=0.015, ftd_vol_mult=1.6, rally_days=7))    # 2 sessions after
    week = assess_market_regime(_correction_with_rally(
        ftd_day=5, ftd_gain=0.015, ftd_vol_mult=1.6, rally_days=12))   # 7 sessions after
    # low drift keeps the MA structure broken (still 'correction' by MAs) so
    # the 3-weeks-proven rung is exercised — deep-bear shape (2009/2020-like)
    proven = assess_market_regime(_correction_with_rally(
        ftd_day=5, ftd_gain=0.015, ftd_vol_mult=1.6, rally_days=25, drift=0.0005))
    assert fresh["exposure_pct"] == 25
    assert week["exposure_pct"] == 50
    assert proven["exposure_pct"] == 75
    for r in (fresh, week, proven):
        assert r["regime"] == "confirmed_uptrend"


def test_no_ftd_before_attempt_day_4():
    """A big up day on attempt day 2 is a bounce, not a follow-through."""
    r = assess_market_regime(_correction_with_rally(ftd_day=2, ftd_gain=0.015, ftd_vol_mult=1.6))
    assert r["components"]["follow_through"] is None
    assert r["regime"] in ("correction", "downtrend")


def test_no_ftd_on_lower_volume():
    """+1.5% on LOWER volume than the prior session does not confirm."""
    r = assess_market_regime(_correction_with_rally(ftd_day=5, ftd_gain=0.015, ftd_vol_mult=0.7))
    assert r["components"]["follow_through"] is None
    assert r["regime"] in ("correction", "downtrend")


def test_failed_ftd_undercut_is_circuit_broken():
    """A close below the FTD session's low invalidates the confirmation."""
    df = _correction_with_rally(ftd_day=5, ftd_gain=0.015, ftd_vol_mult=1.6, rally_days=6)
    closes = df["Close"].to_numpy().tolist()
    vols = df["Volume"].to_numpy().tolist()
    # crash well below the FTD day's low right after it
    closes.append(closes[-1] * 0.90)
    vols.append(vols[-1])
    r = assess_market_regime(_index(np.asarray(closes), np.asarray(vols)))
    assert r["components"]["follow_through"] is None
    assert r["regime"] in ("correction", "downtrend")


def test_healthy_uptrend_never_takes_the_ftd_path():
    r = assess_market_regime(_index(np.linspace(300, 460, 300)))
    assert r["regime"] == "confirmed_uptrend"
    assert r["exposure_pct"] == 100
    assert r["components"]["follow_through"] is None


# --- distribution-day counting fidelity (O'Neil) -----------------------------

def test_distribution_day_expires_after_a_5pct_rally():
    """A distribution day stops counting once the index rallies 5% above its
    close — absorbed selling is no longer a warning."""
    from app.services.market_regime import _distribution_days

    n = 40
    close = np.full(n, 100.0)
    vol = np.full(n, 1_000_000.0)
    close[20] = 99.0        # -1% inside the 25-session window ...
    vol[20] = 1_500_000.0   # ... on higher volume = distribution
    # without a rally it still counts
    assert _distribution_days(pd.Series(close), pd.Series(vol)) >= 1
    # rally 6% above the distribution day's close -> expired
    close[30:] = 99.0 * 1.06
    assert _distribution_days(pd.Series(close), pd.Series(vol)) == 0


def test_stalling_day_counts_as_distribution():
    """Churn near highs — an up session making no headway (<= +0.2%) on higher
    volume, closing in the lower half of its range — is distribution."""
    from app.services.market_regime import _distribution_days

    n = 30
    close = np.linspace(100, 110, n)
    vol = np.full(n, 1_000_000.0)
    high = close * 1.001
    low = close * 0.999
    # stall on the last bar: +0.1% close, big volume, wide range, close near low
    close[-1] = close[-2] * 1.001
    vol[-1] = 2_000_000.0
    high[-1] = close[-2] * 1.02   # ran 2% intraday...
    low[-1] = close[-2] * 0.999   # ...and gave it all back
    count = _distribution_days(
        pd.Series(close), pd.Series(vol), high=pd.Series(high), low=pd.Series(low)
    )
    assert count >= 1


def test_heavy_distribution_at_highs_is_pressure_not_correction():
    """C55: distribution clustering while the trend is INTACT (price above a
    rising 50-day, near the highs) downgrades to under-pressure — it must NOT
    read as a 20%-exposure correction. Correction requires price damage."""
    n = 300
    close = np.linspace(300, 460, n)
    vol = np.full(n, 1_000_000.0)
    # 7 distribution days in the last 25 sessions: small down closes on
    # rising volume, while the uptrend stays fully intact.
    for k in range(1, 8):
        i = n - 2 * k
        close[i] = close[i - 1] * 0.995
        vol[i] = 1_600_000.0 + k * 10_000
    r = assess_market_regime(_index(close, vol))
    assert r["distribution_days"] >= 5
    assert r["above_50dma"] is True
    assert r["regime"] == "uptrend_under_pressure"
    assert r["exposure_pct"] == 55


def test_losing_the_50day_with_distribution_is_a_correction():
    """Price damage (below the 50-day) plus distribution = correction."""
    n = 300
    close = np.concatenate([np.linspace(300, 460, n - 30), np.linspace(460, 420, 30)])
    vol = np.full(n, 1_000_000.0)
    for k in range(1, 8):
        i = n - 2 * k
        vol[i] = 1_700_000.0
    r = assess_market_regime(_index(close, vol))
    assert r["above_50dma"] is False
    assert r["regime"] in ("correction", "downtrend")
    assert r["exposure_pct"] <= 25
