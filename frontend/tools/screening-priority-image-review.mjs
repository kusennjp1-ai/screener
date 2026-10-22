// Scoped review classification, not a data/source/financial admission.
// Scores and original strict results are evidence and are never rewritten.
import assert from 'node:assert/strict';

export const SCREENING_IMAGE_REVIEW_POLICY = 'ordinary-carry-image-review-2026-10-22-v1';
const acceptancePolicy = 'ordinary-carry-screening-priority-2026-10-21-v1';
export const REVIEW_AXES = ['design', 'usability', 'originality', 'content'];
// Visible pixels only. Interaction, axe and financial correctness remain in
// the separately authenticated objective assessment, not inferred from PNGs.
export const VISUAL_CHECKS = ['text_and_labels', 'clipping_and_occlusion', 'visible_navigation_affordances', 'visible_content_consistency'];
export const FINDING_CATEGORIES = ['cosmetic', 'originality', 'readability', 'clipping', 'navigation', 'incorrect_content', 'accessibility', 'other'];
const impacts = ['non_screening_aesthetic', 'screening_material', 'unknown'];
const meaningful = value => typeof value === 'string' && value.trim().length > 0;
const exactKeys = (object, keys, label) => {
  assert(object && typeof object === 'object' && !Array.isArray(object), label + ' must be an object');
  assert.deepEqual(Object.keys(object).sort(), [...keys].sort(), label + ' has missing or unknown fields');
};

// The caller must first run checkedScreeningPriority (including the immutable
// completion, input provenance, image bytes, financial cases and original
// objective failures) and its normal Git ancestry/unchanged-UI checks. This
// pure classifier cannot turn an unbound or failed measurement into a pass.
export function assessScreeningImageReview({ review, report, binding, assessment }) {
  assert(review?.review_policy === SCREENING_IMAGE_REVIEW_POLICY, 'Explicit image-review policy required');
  assert(binding?.policy === acceptancePolicy && ['ordinary', 'carry'].includes(binding.scope), 'Only bound ordinary/carry image review is eligible');
  assert(report?.commit === binding.commit && report.input_basis === 'same_verified_input' && !report.assessment_mode, 'Image review report scope differs');
  assert(assessment?.policy === acceptancePolicy && assessment.scope === binding.scope
    && assessment.functional_acceptance === 'passed' && assessment.policy_exit === 0
    && Array.isArray(assessment.blocking_failures) && assessment.blocking_failures.length === 0, 'Objective screening acceptance is not complete and passing');
  assert(/^[a-f0-9]{40}$/.test(review.observed_commit || '') && meaningful(review.reviewer)
    && /^https:\/\/github\.com\/kusennjp1-ai\/screener\/actions\/runs\/[1-9][0-9]*(?:\/attempts\/[1-9][0-9]*)?$/.test(review.evidence_run || ''), 'Real source and evidence-run review identity required');
  const expected = binding.scope === 'carry' ? 162 : 134;
  assert(Array.isArray(report.screens) && report.screens.length === expected
    && new Set(report.screens.map(screen => screen.key)).size === expected, 'Complete unique scoped captures required');
  assert(Array.isArray(review.screens) && review.screens.length === expected
    && new Set(review.screens.map(screen => screen.key)).size === expected, 'Complete unique scoped image reviews required');
  const byKey = new Map(review.screens.map(screen => [screen.key, screen]));
  const warnings = [], blocking = [], originalScores = [];
  for (const actual of report.screens) {
    const screen = byKey.get(actual.key), label = actual.key;
    assert(screen && /^[a-f0-9]{64}$/.test(actual.sha256 || '') && screen.sha256 === actual.sha256
      && screen.screenshot === actual.screenshot, label + ': exact current screenshot identity/hash required');
    exactKeys(screen.scores, REVIEW_AXES, label + ' scores');
    for (const axis of REVIEW_AXES) {
      const score = screen.scores[axis];
      exactKeys(score, ['value', 'reason'], label + '/' + axis);
      assert(Number.isFinite(score.value) && score.value >= 0 && score.value <= 10 && meaningful(score.reason), label + '/' + axis + ': genuine score and reason required');
      originalScores.push({ key: label, axis, value: score.value, reason: score.reason });
    }
    exactKeys(screen.visualChecks, VISUAL_CHECKS, label + ' visible-scope checks');
    for (const check of VISUAL_CHECKS) {
      const evidence = screen.visualChecks[check];
      exactKeys(evidence, ['status', 'reason'], label + '/' + check);
      assert(['pass', 'fail', 'unknown'].includes(evidence.status) && meaningful(evidence.reason), label + '/' + check + ': explicit screening impact required');
      if (evidence.status !== 'pass') blocking.push(label + '/' + check + ': ' + evidence.status + ': ' + evidence.reason);
    }
    assert(Array.isArray(screen.findings), label + ': explicit findings array required');
    for (const finding of screen.findings) {
      exactKeys(finding, ['axis', 'category', 'screeningImpact', 'reason'], label + ' finding');
      assert(REVIEW_AXES.includes(finding.axis) && FINDING_CATEGORIES.includes(finding.category)
        && impacts.includes(finding.screeningImpact) && meaningful(finding.reason), label + ': missing, ambiguous or unrecognized finding classification');
      const message = label + '/' + finding.axis + ' (' + screen.scores[finding.axis].value + '): ' + finding.category + ': ' + finding.reason;
      if (finding.screeningImpact === 'non_screening_aesthetic' && ['cosmetic', 'originality'].includes(finding.category)) warnings.push(message);
      else blocking.push(message + ' [screeningImpact=' + finding.screeningImpact + ']');
    }
    for (const axis of REVIEW_AXES) if (screen.scores[axis].value < 8 && !screen.findings.some(finding => finding.axis === axis)) {
      blocking.push(label + '/' + axis + ': sub-8 score has no explicit finding/impact classification');
    }
  }
  const strictImageResult = originalScores.some(score => score.value < 8) ? 'failed' : 'passed';
  return { schema: 'screening-priority-image-assessment-v1', policy: SCREENING_IMAGE_REVIEW_POLICY,
    publication_authority: 'none', financial_admission: false, scope: binding.scope,
    strict_image_result: strictImageResult,
    strict_result: strictImageResult === 'failed' || assessment.strict_result === 'failed' ? 'failed' : 'passed',
    objective_functional_acceptance: assessment.functional_acceptance,
    visible_screening_acceptance: blocking.length ? 'blocked' : 'passed',
    image_acceptance: blocking.length ? 'blocked' : warnings.length ? 'deferred_aesthetic_warning' : 'within_original_limits',
    original_scores: originalScores, warnings, blocking_failures: blocking, policy_exit: blocking.length ? 1 : 0 };
}
