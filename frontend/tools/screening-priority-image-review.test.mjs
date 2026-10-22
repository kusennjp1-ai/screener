// @vitest-environment node
// Synthetic classification fixtures. These are not real image/CI/source reviews.
import { test } from 'vitest';
import assert from 'node:assert/strict';
import { assessScreeningImageReview, SCREENING_IMAGE_REVIEW_POLICY, REVIEW_AXES, VISUAL_CHECKS } from './screening-priority-image-review.mjs';

const objectivePolicy = 'ordinary-carry-screening-priority-2026-10-21-v1';
function fixture(scope = 'carry') {
  const commit = 'a'.repeat(40), screens = Array.from({ length: scope === 'carry' ? 162 : 134 }, (_, i) => ({ key: 'synthetic-' + i, screenshot: 'synthetic-' + i + '.png', sha256: 'b'.repeat(64) }));
  return {
    binding: { policy: objectivePolicy, scope, commit },
    report: { commit, input_basis: 'same_verified_input', screens },
    assessment: { policy: objectivePolicy, scope, functional_acceptance: 'passed', policy_exit: 0, blocking_failures: [], strict_result: 'failed' },
    review: { review_policy: SCREENING_IMAGE_REVIEW_POLICY, observed_commit: commit, reviewer: 'Synthetic fixture, not a real review', evidence_run: 'https://github.com/kusennjp1-ai/screener/actions/runs/123', screens: screens.map(screen => ({ ...screen,
      scores: Object.fromEntries(REVIEW_AXES.map(axis => [axis, { value: 8, reason: 'Synthetic raw score' }])),
      visualChecks: Object.fromEntries(VISUAL_CHECKS.map(check => [check, { status: 'pass', reason: 'Synthetic visible-only check: ' + check }])), findings: [] })) }
  };
}
function aesthetic(f, axis = 'originality') {
  const screen = f.review.screens[0]; screen.scores[axis].value = 7;
  screen.findings.push({ axis, category: 'originality', screeningImpact: 'non_screening_aesthetic', reason: 'Synthetic conventional layout, no material visible defect' });
  return f;
}
for (const scope of ['ordinary', 'carry']) test(scope + ' exact complete image set preserves genuine scores and strict failure', () => {
  const f = aesthetic(fixture(scope)), before = JSON.stringify(f), result = assessScreeningImageReview(f);
  assert.equal(result.policy_exit, 0); assert.equal(result.strict_image_result, 'failed'); assert.equal(result.strict_result, 'failed');
  assert.equal(result.image_acceptance, 'deferred_aesthetic_warning'); assert.equal(result.original_scores.find(s => s.axis === 'originality').value, 7);
  assert.equal(result.publication_authority, 'none'); assert.equal(result.financial_admission, false); assert.equal(JSON.stringify(f), before);
});
test('all original scores >=8 can pass only with explicit visible checks', () => {
  const f = fixture(); f.assessment.strict_result = 'passed'; const r = assessScreeningImageReview(f);
  assert.equal(r.strict_image_result, 'passed'); assert.equal(r.strict_result, 'passed'); assert.equal(r.image_acceptance, 'within_original_limits');
});
for (const category of ['readability', 'clipping', 'navigation', 'incorrect_content', 'accessibility', 'other']) test('material category cannot be relabeled aesthetic: ' + category, () => {
  const f = aesthetic(fixture()); f.review.screens[0].findings[0].category = category;
  assert.equal(assessScreeningImageReview(f).policy_exit, 1);
});
for (const impact of ['screening_material', 'unknown']) test('explicit ' + impact + ' blocks even a high score/cosmetic category', () => {
  const f = aesthetic(fixture()); f.review.screens[0].scores.originality.value = 9; f.review.screens[0].findings[0].screeningImpact = impact;
  assert.equal(assessScreeningImageReview(f).policy_exit, 1);
});
for (const check of VISUAL_CHECKS) for (const status of ['fail', 'unknown']) test(check + ' ' + status + ' blocks independent of scores', () => {
  const f = fixture(); f.review.screens[0].visualChecks[check].status = status;
  assert.equal(assessScreeningImageReview(f).policy_exit, 1);
});
for (const axis of REVIEW_AXES) test('every low ' + axis + ' score needs its own classified finding', () => {
  const f = aesthetic(fixture()); f.review.screens[1].scores[axis].value = 7.5;
  assert.equal(assessScreeningImageReview(f).policy_exit, 1);
});
for (const [name, mutate] of [
  ['missing policy', f => delete f.review.review_policy], ['unknown policy', f => f.review.review_policy += '-unknown'],
  ['nonordinary scope', f => f.binding.scope = 'renewal'], ['missing binding', f => delete f.binding],
  ['limited assessment', f => f.report.assessment_mode = 'limited'], ['wrong source', f => f.report.commit = 'c'.repeat(40)],
  ['wrong input', f => f.report.input_basis = 'different_input'], ['failed objective', f => f.assessment.functional_acceptance = 'failed'],
  ['objective blocker', f => f.assessment.blocking_failures.push('Unknown included in purchase')], ['objective exit', f => f.assessment.policy_exit = 1],
  ['mismatched objective scope', f => f.assessment.scope = 'ordinary'], ['no real run link', f => f.review.evidence_run = 'synthetic'],
  ['missing image', f => f.review.screens.pop()], ['duplicate image', f => f.review.screens[1] = f.review.screens[0]],
  ['extra image', f => f.review.screens.push(structuredClone(f.review.screens[0]))], ['missing capture', f => f.report.screens.pop()],
  ['stale hash', f => f.review.screens[0].sha256 = 'd'.repeat(64)], ['different path', f => f.review.screens[0].screenshot = 'other.png'],
  ['wrong key', f => f.review.screens[0].key = 'other'], ['missing hash', f => delete f.review.screens[0].sha256],
  ['missing visual checks', f => delete f.review.screens[0].visualChecks], ['missing visible check', f => delete f.review.screens[0].visualChecks.text_and_labels],
  ['unknown check field', f => f.review.screens[0].visualChecks.future = { status: 'pass', reason: 'synthetic' }],
  ['ambiguous status', f => f.review.screens[0].visualChecks.text_and_labels.status = 'maybe'],
  ['empty check reason', f => f.review.screens[0].visualChecks.text_and_labels.reason = ' '], ['missing findings', f => delete f.review.screens[0].findings],
  ['missing finding impact', f => delete f.review.screens[0].findings[0].screeningImpact], ['ambiguous finding impact', f => f.review.screens[0].findings[0].screeningImpact = 'low'],
  ['unknown category', f => f.review.screens[0].findings[0].category = 'probably-ok'], ['unknown axis', f => f.review.screens[0].findings[0].axis = 'other'],
  ['empty finding reason', f => f.review.screens[0].findings[0].reason = ''], ['extra finding authority', f => f.review.screens[0].findings[0].publish = true],
  ['NaN score', f => f.review.screens[0].scores.design.value = NaN], ['string score', f => f.review.screens[0].scores.design.value = '8'],
  ['negative score', f => f.review.screens[0].scores.design.value = -1], ['score >10', f => f.review.screens[0].scores.design.value = 11],
  ['missing score reason', f => delete f.review.screens[0].scores.design.reason], ['missing axis', f => delete f.review.screens[0].scores.design]
]) test('fail closed: ' + name, () => { const f = aesthetic(fixture()); mutate(f); assert.throws(() => assessScreeningImageReview(f)); });
