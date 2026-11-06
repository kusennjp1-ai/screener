"""Self-contained explain payload builder for Setup Engine gate evaluation.

Pure analysis-layer module: no pandas, no I/O. Encapsulates the 10 readiness
gate evaluations, merges the caller's failed checks (every one fails readiness),
and returns a typed ``ExplainPayload`` with a ``derived_ready`` flag, plus the
detector-level ``diagnostics`` the caller passes apart, which never decide it.

Imports only from analysis layer: ``config``, ``readiness``, ``report``, ``trace``.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.analysis.patterns.config import SetupEngineParameters
from app.analysis.patterns.readiness import (
    BreakoutReadinessFeatures,
    BreakoutReadinessTraceInputs,
)
from app.analysis.patterns.report import ExplainPayload, KeyLevels
from app.analysis.patterns.trace import build_score_trace


@dataclass(frozen=True)
class ExplainBuilderInput:
    """All gate-relevant inputs needed to build the explain payload.

    This frozen dataclass captures the 17 fields that the 8 readiness gates
    inspect, plus pre-existing checks from detectors/policy and score trace
    opt-in controls.
    """

    # Pre-existing checks from the aggregator/policy: every failed one fails readiness
    pre_existing_passed_checks: tuple[str, ...]
    pre_existing_failed_checks: tuple[str, ...]
    key_levels: KeyLevels
    pre_existing_invalidation_flags: tuple[object, ...]

    # Resolved scores (already synthesized upstream)
    setup_score: float | None
    quality_score: float | None
    readiness_score: float | None

    # Gate features (already normalized to float | None upstream)
    distance_to_pivot_pct: float | None
    atr14_pct: float | None
    volume_vs_50d: float | None
    rs_vs_spy_65d: float | None
    rs_line_new_high: bool
    stage: int | None
    ma_alignment_score: float | None
    rs_rating: float | None

    # Thresholds
    parameters: SetupEngineParameters
    readiness_threshold_pct: float

    # Score trace opt-in
    include_score_trace: bool = False
    readiness_features: BreakoutReadinessFeatures | None = None
    readiness_trace_inputs: BreakoutReadinessTraceInputs | None = None

    # Detector-level checks (one detector not finding its own pattern, a stub, a detector
    # short of history), separated where they are produced (the aggregator's
    # ``detector_failed_checks``). They are reported, never counted against readiness.
    diagnostics: tuple[str, ...] = ()


@dataclass(frozen=True)
class ExplainResult:
    """Output of ``build_explain_payload()``: typed explain + derived readiness."""

    explain: ExplainPayload
    derived_ready: bool
    diagnostics: tuple[str, ...] = ()


def build_explain_payload(inp: ExplainBuilderInput) -> ExplainResult:
    """Evaluate 10 readiness gates and build a typed ExplainPayload.

    Gate semantics:
    - Gate 1 (setup_score): score >= setup_score_min_pct
    - Gate 2 (quality_floor): quality_score >= quality_score_min_pct
    - Gate 3 (readiness_floor): readiness_score >= readiness_threshold_pct
    - Gate 4 (early_zone): distance in [min, max] — **non-permissive** (None fails)
    - Gate 5 (ATR14 cap): atr14_pct <= max — **permissive** (None passes)
    - Gate 6 (volume dry-up): volume <= cap — **permissive** (None passes);
      a volume above the cap fails as ``volume_above_dryup_cap``
    - Gate 7 (RS leadership): rs_vs_spy > 0 or rs_line_new_high — **permissive** (both None passes)
    - Gate 8 (stage): stage in (1, 2) — **semi-permissive** (None passes, 3/4 fail)
    - Gate 9 (MA alignment): ma_alignment_score >= min — **permissive** (None passes)
    - Gate 10 (RS rating): rs_rating >= min — **permissive** (None passes)

    ``derived_ready`` is True only when every gate passes and no pre-existing check
    failed: every caller-supplied failed check fails readiness (fail closed). The
    detector-level checks arrive apart, in ``inp.diagnostics``; they are returned in
    ``diagnostics``, never in the failed list, and never fail readiness.
    """
    passed: list[str] = list(inp.pre_existing_passed_checks)
    failed: list[str] = list(inp.pre_existing_failed_checks)
    diagnostics: list[str] = []
    for check in inp.diagnostics:
        if check and check not in diagnostics:
            diagnostics.append(check)
    params = inp.parameters

    if inp.setup_score is None:
        # Insufficient data: skip all context gates, force not ready.
        derived_ready = False
    else:
        # Gate 1: setup_score threshold
        if inp.setup_score >= params.setup_score_min_pct:
            passed.append("setup_score_ok")
        else:
            failed.append("setup_score_below_threshold")

        # Gate 2: quality floor
        if inp.quality_score is not None and inp.quality_score >= params.quality_score_min_pct:
            passed.append("quality_floor_ok")
        else:
            failed.append("quality_below_threshold")

        # Gate 3: readiness floor
        if inp.readiness_score is not None and inp.readiness_score >= inp.readiness_threshold_pct:
            passed.append("readiness_floor_ok")
        else:
            failed.append("readiness_below_threshold")

        # Gate 4: early zone (non-permissive: None -> fails)
        if inp.distance_to_pivot_pct is not None:
            if (
                params.early_zone_distance_to_pivot_pct_min
                <= inp.distance_to_pivot_pct
                <= params.early_zone_distance_to_pivot_pct_max
            ):
                passed.append("in_early_zone")
            else:
                failed.append("outside_early_zone")
        else:
            failed.append("outside_early_zone")

        # Gate 5: ATR14 cap (permissive: None -> passes)
        if inp.atr14_pct is not None:
            if inp.atr14_pct <= params.atr14_pct_max_for_ready:
                passed.append("atr14_within_limit")
            else:
                failed.append("atr14_pct_exceeds_limit")
        else:
            passed.append("atr14_within_limit")

        # Gate 6: Volume dry-up cap (permissive: None -> passes)
        if inp.volume_vs_50d is not None:
            if inp.volume_vs_50d <= params.volume_vs_50d_max_for_ready:
                passed.append("volume_sufficient")
            else:
                failed.append("volume_above_dryup_cap")
        else:
            passed.append("volume_sufficient")

        # Gate 7: RS leadership (permissive: both None -> passes)
        if inp.rs_vs_spy_65d is not None or inp.rs_line_new_high:
            rs_ok = (inp.rs_vs_spy_65d is not None and inp.rs_vs_spy_65d > 0) or inp.rs_line_new_high
            if rs_ok:
                passed.append("rs_leadership_ok")
            else:
                failed.append("rs_leadership_insufficient")
        else:
            passed.append("rs_leadership_ok")

        # Gate 8: Stage (semi-permissive: None passes, stage 1/2 pass, 3/4 fail)
        if inp.stage is None:
            passed.append("stage_ok")
        elif inp.stage in (1, 2):
            passed.append("stage_ok")
        else:
            failed.append("stage_not_ok")

        # Gate 9: MA alignment (permissive: None passes)
        if inp.ma_alignment_score is not None:
            if inp.ma_alignment_score >= params.context_ma_alignment_min_pct:
                passed.append("ma_alignment_ok")
            else:
                failed.append("ma_alignment_insufficient")
        else:
            passed.append("ma_alignment_ok")

        # Gate 10: RS rating (permissive: None passes)
        if inp.rs_rating is not None:
            if inp.rs_rating >= params.context_rs_rating_min:
                passed.append("rs_rating_ok")
            else:
                failed.append("rs_rating_insufficient")
        else:
            passed.append("rs_rating_ok")

        # derived_ready = every gate passed and no pre-existing check failed
        derived_ready = len(failed) == 0

    # Build score trace if opted in
    score_trace = None
    if (
        inp.include_score_trace
        and inp.readiness_trace_inputs is not None
        and inp.readiness_features is not None
    ):
        score_trace = build_score_trace(
            inp.readiness_features,
            inp.readiness_trace_inputs,
            quality_score=inp.quality_score,
            readiness_score=inp.readiness_score,
            setup_score=inp.setup_score,
        )

    explain = ExplainPayload(
        passed_checks=tuple(passed),
        failed_checks=tuple(failed),
        key_levels=inp.key_levels,
        invalidation_flags=tuple(inp.pre_existing_invalidation_flags),
        score_trace=score_trace,
    )

    return ExplainResult(explain=explain, derived_ready=derived_ready, diagnostics=tuple(diagnostics))
