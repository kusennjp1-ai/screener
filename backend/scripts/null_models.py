"""Null models for ``backtest_minervini_tactics.py`` — does the selection stack
beat a dumb baseline?

The screener's claimed edge decomposes into four layers:

  L1  candidate filter : 8-condition trend template AND cross-sectional RS >= 70
  L2  pattern          : VCPDetector pivot / tight-base fallback -> (pivot, base_low)
  L2b lane             : armed (close <= pivot) vs early (0-5% above, vol surge)
  L3  slot allocation  : ``_quality_key`` = (source priority, -RS, symbol)

Every null here replaces ONE OR MORE of those layers and NOTHING ELSE. The
entry trigger, position sizing, protective stop, trailing ladder, 50-DMA exit,
regime gate, exposure cap, cost model and market calendar are the SAME objects
flowing through the SAME ``run_variant`` call, so a measured difference is
attributable to selection alone.

  random       L1+L2+L3 nulled : uniform draw from the eligible pool, naive
                                 pivot, random slot order.
  rs_only      L1+L2   nulled  : pool ranked by RS percentile only — no trend
                                 template, no pattern. Cross-sectional
                                 momentum, the most robust equity anomaly, run
                                 through identical risk management.
  no_pattern   L2      nulled  : the REAL L1 candidate list, naive pivot.
  slot_shuffle L3      nulled  : the REAL watchlist (real pivots, real
                                 base_low, replayed — zero recomputation) with
                                 ``_quality_key`` replaced by a seeded shuffle.

Two fairness devices that are NOT obvious (see the campaign design):

  n_d matching     — a null draws exactly as many names per day as the screener
                     put on its watchlist that day (read from a Phase-0 dump).
                     Without it the comparison measures opportunity COUNT, not
                     name quality.
  epoch persistence — armed buy-stops are checked against YESTERDAY's watchlist
                     (backtest_minervini_tactics.py:520-536), so a real VCP base
                     that persists for weeks gets many chances to trigger. A
                     null that re-drew independently every day would get exactly
                     one shot per name — an invisible handicap unrelated to
                     selection quality. The random field is therefore constant
                     within an epoch of P sessions, where P is MEASURED from the
                     screener's own watchlist (median consecutive-membership run
                     length), not chosen.

No parameter in this module is swept. ``NAIVE_PIVOT_LOOKBACK`` is the shipped
``signals._breakout_now`` window, already mirrored verbatim in the harness's
product-funnel fallback; P is measured. Tuning a null until the screener wins
is the same sin as tuning the screener until it beats a benchmark.
"""

from __future__ import annotations

import hashlib

# The shipped signals._breakout_now consolidation window, already mirrored at
# backtest_minervini_tactics.py:999-1002 as the product funnel's no-VCP
# fallback. NOT a chosen number, and PRE-REGISTERED as never-swept: a null
# whose parameter is tuned until the screener wins is fitting in reverse.
NAIVE_PIVOT_LOOKBACK = 30
NAIVE_PIVOT_MIN_BARS = 20   # == the `len(hi30) >= 20` guard at :1001

NULL_KINDS = ("random", "rs_only", "no_pattern", "slot_shuffle")
SEEDED_KINDS = ("random", "slot_shuffle")          # a seed actually moves these
WATCHLIST_KINDS = ("random", "rs_only", "no_pattern")  # these rebuild the watchlist


def seeded_uniform(seed: int, symbol: str, epoch: int) -> float:
    """Deterministic U[0,1) from blake2b(seed|symbol|epoch).

    NOT ``builtins.hash``: that is PYTHONHASHSEED-salted, and
    backtest_minervini_tactics.py:919-923 records that exactly this class of
    nondeterminism once moved this backtest by tens of percentage points
    between two runs of the same bundle. blake2b is stable across processes,
    machines and Python versions, so a seed is a reproducible experiment.
    """
    digest = hashlib.blake2b(
        f"{seed}|{symbol}|{epoch}".encode("utf-8"), digest_size=8
    ).digest()
    return int.from_bytes(digest, "big") / 18446744073709551616.0  # 2**64


class UniformField:
    """Memoised ``seeded_uniform`` for one seed (≈60 epochs x ~1500 symbols)."""

    __slots__ = ("seed", "_cache")

    def __init__(self, seed: int):
        self.seed = int(seed)
        self._cache: dict[tuple[str, int], float] = {}

    def __call__(self, symbol: str, epoch: int) -> float:
        key = (symbol, epoch)
        hit = self._cache.get(key)
        if hit is None:
            hit = seeded_uniform(self.seed, symbol, epoch)
            self._cache[key] = hit
        return hit


def naive_pivot_panels(high, low):
    """Vectorised naive pivot: (pivot, base_low) = (30-bar high, 30-bar low)
    over the bars STRICTLY BEFORE the current one.

    Excluding the current bar is deliberate and load-bearing. It is what the
    shipped ``high30`` fallback (:999-1000) and the ``tight_base`` fallback
    (:1011-1014) both do. Including today would force ``close <= pivot`` on
    every name and dump every null entry into the ``armed`` lane — which the
    campaign has already measured as the LOSING lane (-0.18R / -0.06R, all
    profit in ``early``). That would rig the test in the screener's favour.

    ``rolling(30).shift(1)`` at position i covers positions i-30 .. i-1, which
    is exactly ``iloc[max(0, i-30):i]``. ``min_periods`` mirrors the harness:
    >= 20 valid highs required, the low taken from whatever is there.

    Contains no volatility-contraction, no base-depth, no base-age and no
    MA-hug test. It is "the top of the last six weeks" and nothing more.
    """
    piv = high.rolling(NAIVE_PIVOT_LOOKBACK, min_periods=NAIVE_PIVOT_MIN_BARS).max().shift(1)
    blow = low.rolling(NAIVE_PIVOT_LOOKBACK, min_periods=1).min().shift(1)
    return piv, blow


def draw_order(kind, *, pool_ok, cands, rs_row, field: UniformField | None, epoch: int):
    """The ONLY thing a watchlist null changes: which names are looked at, and
    in what order. Everything downstream is the harness's own code."""
    if kind == "random":
        # L1+L2+L3 nulled. Uniform over the eligible pool; the symbol tiebreak
        # keeps ties deterministic.
        return sorted(pool_ok, key=lambda s: (field(s, epoch), s))
    if kind == "rs_only":
        # L1's template and all of L2 nulled; pure cross-sectional momentum.
        # No RS_MIN floor is applied — it is moot anyway (n_d ~ 10-40 names out
        # of a ~1500-name pool cuts above the 97th percentile) and imposing it
        # would import part of L1 into the null.
        return sorted(pool_ok, key=lambda s: (-float(rs_row.get(s, 0.0)), s))
    if kind == "no_pattern":
        # L2 only nulled: the REAL L1 candidate list, in the harness's own
        # (-rs, symbol) order, intersected with the shared pool.
        ok = set(pool_ok)
        return [s for s in cands if s in ok]
    raise ValueError(f"not a watchlist null: {kind!r}")


def null_watchlist(kind, *, pool_ok, cands, rs_row, close_row, piv_row, low_row,
                   surge_row, n_target, field, epoch, assign_mode):
    """Build one day's null watchlist. Returns ``(watchlist, draw_depth)``.

    ``n_target`` is the screener's OWN watchlist size for this day (Phase-0
    dump). The null keeps drawing until ``n_target`` entries have a valid lane
    rather than drawing ``n_target`` candidates and keeping the survivors —
    the choice that is MORE GENEROUS to the null, because it removes an
    opportunity deficit the screener would otherwise win for free.

    ``draw_depth`` (how many names had to be chewed through) is reported, never
    used to adjust a metric: if a null needs 5x n_target draws to find n_target
    valid setups, that is a real qualitative finding about what the pattern
    layer concentrates.

    ``assign_mode`` is the harness's own lane function — the identical
    armed/early thresholds the screener uses, so the lane rule cannot drift
    between arms.
    """
    wl: dict = {}
    depth = 0
    if n_target <= 0:
        return wl, depth
    for s in draw_order(kind, pool_ok=pool_ok, cands=cands, rs_row=rs_row,
                        field=field, epoch=epoch):
        depth += 1
        c0 = close_row.get(s)
        piv = piv_row.get(s)
        blow = low_row.get(s)
        # NaN-safe: a name not trading today, or without 20 prior highs, has no
        # executable setup.
        if c0 is None or piv is None or blow is None:
            continue
        c0 = float(c0); piv = float(piv); blow = float(blow)
        if c0 != c0 or piv != piv or blow != blow or piv <= 0:
            continue
        plan = assign_mode(c0, piv, blow, kind, float(rs_row.get(s, 0.0)),
                           bool(surge_row.get(s, False)))
        if plan is None:
            continue
        wl[s] = plan
        if len(wl) >= n_target:
            break
    return wl, depth


def slot_key_factory(field: UniformField, epoch: int):
    """Replacement for ``_quality_key`` that nulls L3 alone.

    Same shape as ``_quality_key`` (a key over ``(symbol, plan)`` items) so the
    two sort call sites are otherwise untouched. Epoch-stable for the same
    reason the draw field is: a per-day re-lottery would add turnover noise on
    top of the ordering change this null exists to measure.
    """
    def _key(item):
        return (field(item[0], epoch), item[0])
    return _key


def persistence_p(watch_by_week, sim_dates) -> int:
    """MEASURED epoch length P: the median consecutive-membership run length of
    the screener's own watchlist.

    Setting the null's persistence from the screener's own structure is the
    only defensible choice; a round number would be a free parameter.
    """
    runs: list[int] = []
    open_runs: dict[str, int] = {}
    for d in sim_dates:
        wl = watch_by_week.get(d) or {}
        for sym in list(open_runs):
            if sym not in wl:
                runs.append(open_runs.pop(sym))
        for sym in wl:
            open_runs[sym] = open_runs.get(sym, 0) + 1
    runs.extend(open_runs.values())
    if not runs:
        return 1
    runs.sort()
    n = len(runs)
    med = runs[n // 2] if n % 2 else (runs[n // 2 - 1] + runs[n // 2]) / 2.0
    return max(1, int(round(med)))
