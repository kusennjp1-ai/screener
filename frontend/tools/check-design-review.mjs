import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { screeningPriorityBinding, checkedScreeningPriority, requireWarningReviewImages } from './screening-priority-acceptance.mjs';
import { assessScreeningImageReview } from './screening-priority-image-review.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const directory = resolve(root, 'docs/design-review');
const reports = (await readdir(directory).catch(() => [])).filter(name => /^\d{4}-\d{2}-\d{2}.*\.json$/.test(name)).sort().reverse();
let reviewed = false;
for (const name of reports) {
  const review = JSON.parse(await readFile(resolve(directory, name), 'utf8'));
  if (!/^[a-f0-9]{40}$/.test(review.observed_commit || '') || !review.reviewer || !review.evidence_run || !Array.isArray(review.screens) || !review.screens.length) continue;
  try {
    execFileSync('git', ['merge-base', '--is-ancestor', review.observed_commit, 'HEAD'], { cwd: root, stdio: 'ignore' });
    execFileSync('git', ['diff', '--exit-code', review.observed_commit, 'HEAD', '--', 'frontend/src', 'frontend/index.html', 'frontend/vite.config.js'], { cwd: root, stdio: 'ignore' });
  } catch { continue; }
  const required = ['design', 'usability', 'originality', 'content'];
  const lowScores = [];
  for (const screen of review.screens) for (const key of required) {
    if (!Number.isFinite(screen.scores?.[key]?.value) || screen.scores[key].value < 0 || screen.scores[key].value > 10 || !screen.scores[key].reason || !screen.screenshot) throw Error(`${name}/${screen.key}: ${key} requires a genuine reviewed score and its reason`);
    if (screen.scores[key].value < 8) lowScores.push(`${name}/${screen.key}: ${key} requires a reviewed score >= 8.0 and its reason`);
  }
  const actual = JSON.parse(await readFile(resolve('test-results/design-review/report.json'), 'utf8'));
  const reviewedKeys = new Set(review.screens.map(screen => screen.key));
  if (!actual.screens.length || actual.screens.some(screen => !reviewedKeys.has(screen.key))) throw Error('The subjective review does not cover every captured screen/theme/viewport');
  const policyOptions = { report: actual, output: resolve('test-results/design-review'), currentRoot: resolve('dist'),
    baselineRoot: resolve(process.env.RUNNER_TEMP || '.', 'design-baseline/frontend/dist'), inputBasis: process.env.DESIGN_INPUT_BASIS || actual.input_basis };
  const binding = screeningPriorityBinding({ ...policyOptions, commit: actual.commit, limited: Boolean(actual.assessment_mode) });
  let imageAssessment = null;
  if (binding) {
    const assessment = checkedScreeningPriority(policyOptions);
    if (assessment.blocking_failures.length) throw Error('Objective functional/design failures remain; subjective scores cannot override them');
    if (assessment.warnings.length) requireWarningReviewImages(review, actual);
    if (review.review_policy !== undefined) {
      imageAssessment = assessScreeningImageReview({ review, report: actual, binding, assessment });
      await writeFile(resolve('test-results/design-review/screening-priority-image-assessment.json'), JSON.stringify(imageAssessment, null, 2) + '\n');
      if (imageAssessment.blocking_failures.length) throw Error('Material or unclassified visible screening findings remain: ' + imageAssessment.blocking_failures.join('; '));
      for (const warning of imageAssessment.warnings) console.warn(`::warning title=Deferred non-screening aesthetics::${warning}`);
      console.log(`Image policy ${imageAssessment.policy}: strict_image_result=${imageAssessment.strict_image_result}; strict_result=${imageAssessment.strict_result}; images=${imageAssessment.image_acceptance}; visible_screening=${imageAssessment.visible_screening_acceptance}. Original scores remain unchanged.`);
    }
    for (const warning of assessment.warnings) console.warn(`::warning title=Deferred measured timing::${warning}`);
    console.log(`Screening policy ${assessment.policy}: strict_result=${assessment.strict_result}; performance=${assessment.performance_acceptance}; functional=${assessment.functional_acceptance}.`);
  } else {
    if (review.review_policy !== undefined) throw Error('Image-priority policy is only valid for authenticated ordinary/carry Design');
    if (actual.failures.length) throw Error('Objective design/performance failures remain; subjective scores cannot override them');
  }
  if (!imageAssessment && lowScores.length) throw Error(lowScores.join('; '));
  console.log(`${imageAssessment ? 'Scoped screenshot review accepted' : 'Design score gate passed'}: ${name}, ${review.screens.length} reviewed captures. Scores are a documented internal review, not an award or human-user survey.`);
  reviewed = true;
  break;
}
if (!reviewed) throw Error('No screenshot-based design review matches the current UI. Record four scores and reasons for every captured screen in docs/design-review/YYYY-MM-DD.json after inspecting the CI artifacts.');

