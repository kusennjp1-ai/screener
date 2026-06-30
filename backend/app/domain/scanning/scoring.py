"""Pure scoring and rating policies for the scanning domain.

Extracted from scan_orchestrator.py so that core business rules
live inside the domain layer with zero infrastructure dependencies.

All functions are pure: no I/O, no side effects, fully deterministic.

Quality-aware fallback (T4)
---------------------------
The ``apply_quality_policy`` function adjusts the overall rating when the
underlying fundamentals are incomplete (per T2's
``field_completeness_score``). The policy has three explicit behaviours:

- **Exclusion**: completeness below ``QUALITY_EXCLUSION_THRESHOLD``
  forces ``RatingCategory.PASS``. Rows this sparse cannot be trusted
  to rank against fuller peers; they are scored out.
- **Downgrade**: completeness between ``QUALITY_EXCLUSION_THRESHOLD``
  and ``QUALITY_DOWNGRADE_THRESHOLD`` drops the rating one tier
  (STRONG_BUY → BUY, BUY → WATCH, WATCH → WATCH).
- **Tie-break**: rows with equal ``composite_score`` should break by
  higher ``field_completeness_score``. Consumers enforce this via an
  ``ORDER BY composite_score DESC, field_completeness_score DESC``
  secondary sort; this module documents the semantics but does not
  mutate the score itself (keeps the displayed score honest).

Unknown completeness (``None``) is a pass-through: legacy rows from
before the T2 migration are treated as "unknown quality" rather than
forced into PASS, so the rollout doesn't regress existing results.
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Optional

from .models import CompositeMethod, RatingCategory, ScreenerOutputDomain

# ---------------------------------------------------------------------------
# Scoring thresholds (centralised so they can be referenced by tests)
# ---------------------------------------------------------------------------

STRONG_BUY_THRESHOLD: float = 80.0
BUY_THRESHOLD: float = 70.0
WATCH_THRESHOLD: float = 60.0

# Downgrade map: current rating → downgraded rating (one level lower)
_DOWNGRADE: dict[RatingCategory, RatingCategory] = {
    RatingCategory.STRONG_BUY: RatingCategory.BUY,
    RatingCategory.BUY: RatingCategory.WATCH,
    RatingCategory.WATCH: RatingCategory.WATCH,
    RatingCategory.PASS: RatingCategory.PASS,
}


# ---------------------------------------------------------------------------
# Composite score
# ---------------------------------------------------------------------------


def calculate_composite_score(
    screener_outputs: dict[str, ScreenerOutputDomain],
    method: CompositeMethod,
    weights: dict[str, float] | None = None,
) -> float:
    """Combine per-screener scores into a single composite score.

    Args:
        screener_outputs: Mapping of screener name → result.
        method: Aggregation strategy (weighted_average, maximum, minimum).
        weights: Optional per-screener weights (keyed by screener name).
                 If ``None`` or missing keys, equal weight is assumed.

    Returns:
        Composite score in the range 0-100.
    """
    if not screener_outputs:
        return 0.0

    if method is CompositeMethod.MAXIMUM:
        return max(o.score for o in screener_outputs.values())

    if method is CompositeMethod.MINIMUM:
        return min(o.score for o in screener_outputs.values())

    # weighted_average (default)
    if weights:
        total_weight = 0.0
        weighted_sum = 0.0
        for name, output in screener_outputs.items():
            w = weights.get(name, 1.0)
            weighted_sum += output.score * w
            total_weight += w
        return weighted_sum / total_weight if total_weight else 0.0

    # equal-weight average (original behaviour)
    scores = [o.score for o in screener_outputs.values()]
    return sum(scores) / len(scores)


# ---------------------------------------------------------------------------
# Overall rating
# ---------------------------------------------------------------------------


def calculate_overall_rating(
    composite_score: float,
    screener_outputs: dict[str, ScreenerOutputDomain],
) -> RatingCategory:
    """Derive a human-readable rating from the composite score.

    Two-step policy:
      1. Map composite score to a base rating via thresholds.
      2. If fewer than half of the screeners passed, downgrade one level.
         If *none* passed, force ``PASS`` regardless of score.

    Args:
        composite_score: Composite score (0-100).
        screener_outputs: Per-screener results (used for pass-rate check).

    Returns:
        A :class:`RatingCategory` enum member.
    """
    # --- Step 1: threshold-based base rating ---
    if composite_score >= STRONG_BUY_THRESHOLD:
        base = RatingCategory.STRONG_BUY
    elif composite_score >= BUY_THRESHOLD:
        base = RatingCategory.BUY
    elif composite_score >= WATCH_THRESHOLD:
        base = RatingCategory.WATCH
    else:
        base = RatingCategory.PASS

    # --- Step 2: pass-rate adjustment ---
    pass_count = sum(1 for o in screener_outputs.values() if o.passes)
    total_count = len(screener_outputs)

    if pass_count == 0:
        return RatingCategory.PASS

    if pass_count < total_count / 2:
        return _DOWNGRADE[base]

    return base


# ---------------------------------------------------------------------------
# Quality-aware fallback (T4)
# ---------------------------------------------------------------------------
#
# CALIBRATION NOTE: the two thresholds below (and the execution-state caps) are
# hand-set first-pass values, not empirically validated. Per the audit roadmap
# they must NOT be retuned by intuition — that risks overfitting. Validate them
# with scripts/validate_forward_returns.py on real screener output (stratify by
# completeness band, compare forward Sharpe/return), and only then adjust, citing
# the stats. Until that runs on production data, keep the defaults.

QUALITY_EXCLUSION_THRESHOLD: int = 30
"""Below this ``field_completeness_score``, force rating to PASS.

Rationale: with fewer than ~30% of tier-weighted core fields present,
the composite score is effectively noise — downgrading to WATCH would
still let the row compete with fuller peers in the same tier.
"""

QUALITY_DOWNGRADE_THRESHOLD: int = 60
"""Below this ``field_completeness_score`` (but above exclusion), drop
one rating tier. Rows in this band have usable but partial data; the
displayed score is retained and the rating carries the quality signal.

Note: this value coincidentally equals ``WATCH_THRESHOLD`` (60), but the
semantics are orthogonal — WATCH_THRESHOLD is a 0-100 composite-score
cutoff, this is a 0-100 completeness-score cutoff. Changing one does
not imply changing the other.
"""


@dataclass(frozen=True)
class QualityAdjustment:
    """Result of applying quality-aware fallback to a rating.

    - ``rating``: the adjusted rating (may equal the input if no
      adjustment was needed).
    - ``reason``: human-readable explanation when an adjustment was
      made, or ``None`` when the rating passed through unchanged.
      Surfaced in the scan result so operators can trace *why* a row
      was downgraded.
    """
    rating: RatingCategory
    reason: Optional[str]


def apply_quality_policy(
    rating: RatingCategory,
    field_completeness_score: Optional[int],
) -> QualityAdjustment:
    """Downgrade or exclude ``rating`` based on ``field_completeness_score``.

    See module docstring for full policy semantics. Exhaustive behaviour:

    - ``None`` completeness → pass-through (unknown quality, don't penalise).
    - ``score < QUALITY_EXCLUSION_THRESHOLD`` → force ``PASS``.
    - ``QUALITY_EXCLUSION_THRESHOLD <= score < QUALITY_DOWNGRADE_THRESHOLD``
      → one tier down via ``_DOWNGRADE``.
    - ``score >= QUALITY_DOWNGRADE_THRESHOLD`` → pass-through.

    This function is a *further* adjustment applied after
    :func:`calculate_overall_rating`; the pass-rate downgrade happens
    first, then the quality-based downgrade refines it.
    """
    if field_completeness_score is None:
        return QualityAdjustment(rating=rating, reason=None)

    if field_completeness_score < QUALITY_EXCLUSION_THRESHOLD:
        if rating is RatingCategory.PASS:
            # Row was already PASS for other reasons (low composite score
            # or pass-rate downgrade). Don't attribute the PASS to the
            # quality policy — misleading. Floor-case consistent with
            # the downgrade branch below.
            return QualityAdjustment(rating=rating, reason=None)
        return QualityAdjustment(
            rating=RatingCategory.PASS,
            reason=(
                f"completeness {field_completeness_score} below "
                f"exclusion threshold {QUALITY_EXCLUSION_THRESHOLD}"
            ),
        )

    if field_completeness_score < QUALITY_DOWNGRADE_THRESHOLD:
        downgraded = _DOWNGRADE[rating]
        if downgraded is rating:
            # Already at the floor (WATCH/PASS) — no reason to record a
            # downgrade that didn't happen.
            return QualityAdjustment(rating=rating, reason=None)
        return QualityAdjustment(
            rating=downgraded,
            reason=(
                f"completeness {field_completeness_score} below "
                f"downgrade threshold {QUALITY_DOWNGRADE_THRESHOLD}"
            ),
        )

    return QualityAdjustment(rating=rating, reason=None)


# ---------------------------------------------------------------------------
# Execution state (quality vs execution split)
# ---------------------------------------------------------------------------
#
# The composite score above measures *pattern quality* (how good the setup is).
# It says nothing about *where price is relative to a buyable pivot* — so a
# textbook base that has already run 30% past its pivot scores just as high as
# one sitting at the pivot. ``compute_execution_state`` adds that second,
# orthogonal axis: a pure decision tree that classifies *executability* from
# price vs the pivot / SMA50 / SMA200 / recent contraction low + breakout
# volume. ``apply_execution_cap`` then lets the execution state cap the final
# rating (an Overextended name cannot rate Strong Buy no matter how clean the
# pattern), mirroring how ``apply_quality_policy`` caps on data completeness.
#
# This function is pure and per-symbol: the orchestrator's existing per-symbol
# loop calls it once per stock, so a bad/missing input for one name yields
# ``UNKNOWN`` (a no-op pass-through in the cap) rather than aborting the scan.


class ExecutionState(str, Enum):
    """Where price sits relative to a buyable pivot — the execution axis.

    Ordered worst→best for documentation; the cap table below encodes the
    rating ceiling each state imposes.
    """

    INVALID = "invalid"                      # not a Stage-2 structure
    DAMAGED = "damaged"                       # lost the 50-day / undercut the base
    OVEREXTENDED = "overextended"             # way past the pivot / SMA200
    EXTENDED = "extended"                     # 5-10% past the pivot
    EARLY_POST_BREAKOUT = "early_post_breakout"  # 3-5% past, or 0-3% unconfirmed
    BREAKOUT = "breakout"                     # 0-3% past pivot + volume confirmed
    PRE_BREAKOUT = "pre_breakout"             # at/below pivot — the ideal entry
    UNKNOWN = "unknown"                       # inputs missing — do not penalise


# --- Decision-tree thresholds (centralised + tunable) ----------------------
EXEC_VOLUME_CONFIRM_RATIO: float = 1.5
"""Breakout needs today's volume >= this multiple of the 50-day average."""

EXEC_OVEREXTENDED_PIVOT_PCT: float = 10.0
"""Price more than this % above the pivot is Overextended."""

EXEC_EXTENDED_PIVOT_PCT: float = 5.0
"""Price 5-10% above the pivot is Extended."""

EXEC_EARLY_POST_PIVOT_PCT: float = 3.0
"""Price 3-5% above the pivot is Early-post-breakout."""

EXEC_OVEREXTENDED_SMA200_PCT: float = 100.0
"""Price more than this % above the SMA200 is Overextended even without a
pivot read. NOTE: this default (+100% above the 200-day) is a first pass —
it is the one number in the tree the spec left open, so confirm/tune it."""


def compute_execution_state(
    *,
    price: Optional[float],
    sma50: Optional[float],
    sma200: Optional[float],
    pivot: Optional[float],
    contraction_low: Optional[float],
    volume_ratio: Optional[float],
    overextended_sma200_pct: float = EXEC_OVEREXTENDED_SMA200_PCT,
) -> ExecutionState:
    """Classify one stock's execution state via a top-down decision tree.

    Top-down, first-match-wins (priority matters — Invalid/Damaged are checked
    before the pivot bands so a broken base is never reported as a Breakout):

    1. **Invalid**      — ``price < SMA50 < SMA200`` (bearish stack; not Stage 2).
    2. **Damaged**      — below the 50-day, or undercut the recent contraction low.
    3. **Overextended** — > ``overextended_sma200_pct``% above the SMA200, or
                          > 10% above the pivot.
    4. **Extended**     — 5-10% above the pivot.
    5. **Early-post**   — 3-5% above the pivot, or 0-3% above with volume NOT
                          confirmed (< 1.5x average).
    6. **Breakout**     — 0-3% above the pivot WITH volume confirmed (>= 1.5x).
    7. **Pre-breakout** — at or below the pivot (the ideal entry zone).

    ``pivot`` distance uses ``(price - pivot) / pivot`` so price *above* the
    pivot is positive. Missing core inputs (price/SMA50/SMA200) → ``UNKNOWN``.
    """
    if price is None or sma50 is None or sma200 is None:
        return ExecutionState.UNKNOWN

    # 1. Invalid — bearish MA stack with price beneath it.
    if price < sma50 < sma200:
        return ExecutionState.INVALID

    # 2. Damaged — lost the 50-day, or undercut the last contraction low.
    if price < sma50:
        return ExecutionState.DAMAGED
    if contraction_low is not None and price < contraction_low:
        return ExecutionState.DAMAGED

    # 3a. Overextended — parabolic vs the 200-day even without a pivot read.
    if sma200 > 0:
        above_sma200_pct = (price - sma200) / sma200 * 100.0
        if above_sma200_pct > overextended_sma200_pct:
            return ExecutionState.OVEREXTENDED

    # 3b-7. Pivot-relative bands (need a usable pivot).
    if pivot is not None and pivot > 0:
        above_pivot_pct = (price - pivot) / pivot * 100.0
        if above_pivot_pct > EXEC_OVEREXTENDED_PIVOT_PCT:
            return ExecutionState.OVEREXTENDED
        if above_pivot_pct > EXEC_EXTENDED_PIVOT_PCT:
            return ExecutionState.EXTENDED
        if above_pivot_pct > EXEC_EARLY_POST_PIVOT_PCT:
            return ExecutionState.EARLY_POST_BREAKOUT
        if above_pivot_pct >= 0.0:
            if volume_ratio is not None and volume_ratio >= EXEC_VOLUME_CONFIRM_RATIO:
                return ExecutionState.BREAKOUT
            return ExecutionState.EARLY_POST_BREAKOUT
        return ExecutionState.PRE_BREAKOUT

    # Structure intact and not overextended, but no pivot to break yet: there is
    # no actionable breakout band, so this is a pre-breakout (base-building) name.
    return ExecutionState.PRE_BREAKOUT


# --- State Cap: execution state imposes a rating ceiling -------------------
# Maps each state to the HIGHEST rating it may hold (``None`` = uncapped).
# DEFAULT mapping (confirm before wiring): the three "capped" tiers below the
# uncapped Strong-Buy top are Strong=Buy, Developing=Watch, Weak=Pass.
EXECUTION_STATE_CAP: dict[ExecutionState, Optional[RatingCategory]] = {
    ExecutionState.PRE_BREAKOUT: None,                       # uncapped
    ExecutionState.BREAKOUT: None,                           # uncapped
    ExecutionState.EARLY_POST_BREAKOUT: RatingCategory.BUY,   # "Strong"
    ExecutionState.EXTENDED: RatingCategory.WATCH,            # "Developing"
    ExecutionState.OVEREXTENDED: RatingCategory.PASS,         # "Weak"
    ExecutionState.DAMAGED: RatingCategory.PASS,
    ExecutionState.INVALID: RatingCategory.PASS,
    ExecutionState.UNKNOWN: None,                            # don't penalise
}

_RATING_RANK: dict[RatingCategory, int] = {
    RatingCategory.PASS: 0,
    RatingCategory.WATCH: 1,
    RatingCategory.BUY: 2,
    RatingCategory.STRONG_BUY: 3,
}


@dataclass(frozen=True)
class ExecutionCap:
    """Result of capping a rating by execution state.

    - ``rating``: the post-cap rating (== input when no cap applied).
    - ``capped``: whether the cap actually lowered the rating.
    - ``reason``: human-readable explanation when capped, else ``None``.
    """

    rating: RatingCategory
    capped: bool
    reason: Optional[str]


def apply_execution_cap(
    rating: RatingCategory,
    execution_state: ExecutionState,
) -> ExecutionCap:
    """Cap ``rating`` at the ceiling its ``execution_state`` allows.

    Only ever *lowers* a rating: a state whose ceiling is at or above the
    incoming rating is a pass-through. Quality (the composite score and the
    rating it produced) is never mutated — only the final displayed rating is
    capped, with the reason recorded so the dashboard can explain the downgrade.
    Applied *after* :func:`apply_quality_policy`.
    """
    cap = EXECUTION_STATE_CAP.get(execution_state)
    if cap is None or _RATING_RANK[rating] <= _RATING_RANK[cap]:
        return ExecutionCap(rating=rating, capped=False, reason=None)
    return ExecutionCap(
        rating=cap,
        capped=True,
        reason=f"execution_state {execution_state.value} caps rating at {cap.value}",
    )


__all__ = [
    "STRONG_BUY_THRESHOLD",
    "BUY_THRESHOLD",
    "WATCH_THRESHOLD",
    "QUALITY_EXCLUSION_THRESHOLD",
    "QUALITY_DOWNGRADE_THRESHOLD",
    "QualityAdjustment",
    "calculate_composite_score",
    "calculate_overall_rating",
    "apply_quality_policy",
    "ExecutionState",
    "ExecutionCap",
    "EXECUTION_STATE_CAP",
    "EXEC_VOLUME_CONFIRM_RATIO",
    "EXEC_OVEREXTENDED_PIVOT_PCT",
    "EXEC_EXTENDED_PIVOT_PCT",
    "EXEC_EARLY_POST_PIVOT_PCT",
    "EXEC_OVEREXTENDED_SMA200_PCT",
    "compute_execution_state",
    "apply_execution_cap",
]
