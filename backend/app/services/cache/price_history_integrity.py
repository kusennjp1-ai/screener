"""Ingestion guards. Corrections must come from a provider, not invented bars."""
import numpy as np
import pandas as pd


def coherent_history(data):
    if data is None or data.empty:
        return False
    required = ['Open', 'High', 'Low', 'Close', 'Volume']
    if any(c not in data for c in required):
        return False
    values = data[required]
    if not np.isfinite(values.to_numpy(dtype=float)).all():
        return False
    if not data.index.is_unique or not data.index.is_monotonic_increasing:
        return False
    ratios=data['Close'].iloc[1:].to_numpy()/data['Close'].iloc[:-1].to_numpy()
    # Quarantine discontinuities; do not infer a split ratio from the price gap.
    # Same boundary as publication validation; a provider must supply history.
    if not ((ratios > .55) & (ratios < 1.8)).all():
        return False
    return bool((data['Low'] > 0).all() and (data['Volume'] >= 0).all()
                and (data['High'] >= data[['Open','Close','Low']].max(axis=1)).all()
                and (data['Low'] <= data[['Open','Close']].min(axis=1)).all())


def requires_full_history(cached, recent):
    if not coherent_history(cached) or not coherent_history(recent):
        return True
    left, right = cached.copy(), recent.copy()
    left.index = pd.to_datetime(left.index).tz_localize(None)
    right.index = pd.to_datetime(right.index).tz_localize(None)
    overlap = left.index.intersection(right.index)
    # A changed historical close may represent a split/dividend adjustment or
    # provider correction. Fetch the full history rather than joining bases.
    overlap = overlap[overlap < left.index.max()]
    return bool(len(overlap) and not np.allclose(left.loc[overlap,'Close'], right.loc[overlap,'Close'], rtol=1e-5, atol=.0001))
