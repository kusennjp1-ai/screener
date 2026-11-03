// Gate for the brief Design Acceptance report. Objective evidence comes first and
// nothing overrides it: every required capture with a non-empty PNG, every group
// completed and no objective failure. Then the subjective side: either a committed
// dated review of this UI (four scores >= 8 with reasons for every capture) or the
// owner's committed waiver of those scores. Measured timing overruns are printed
// as deferred warnings and pass only under the owner's recorded timing approval.
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { readOwnerWaiver, requireObjectiveEvidence } from './design-owner-waiver.mjs';

const root = execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
const directory = resolve(root, 'docs/design-review');
const output = resolve(process.env.DESIGN_REVIEW_OUTPUT || 'test-results/design-review');
const actual = JSON.parse(await readFile(resolve(output, 'report.json'), 'utf8'));
const waiver = await readOwnerWaiver(directory);
const { captures, warnings } = await requireObjectiveEvidence(actual, output, waiver);

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
  const reviewedKeys = new Set(review.screens.map(screen => screen.key));
  if (actual.screens.some(screen => !reviewedKeys.has(screen.key))) throw Error('The subjective review does not cover every captured screen/theme/viewport');
  if (lowScores.length) throw Error(lowScores.join('; '));
  console.log(`Design score gate passed: ${name}, ${review.screens.length} reviewed captures. Scores are a documented internal review, not an award or human-user survey.`);
  reviewed = true;
  break;
}
if (!reviewed && waiver) {
  console.log(`Subjective screenshot scores waived by ${waiver.granted_by} (${waiver.granted_at}); objective checks passed for ${captures} captures${warnings.length ? ` with ${warnings.length} deferred timing warnings` : ''}. No scores were recorded.`);
  reviewed = true;
}
if (!reviewed) throw Error('No screenshot-based design review matches the current UI. Record four scores and reasons for every captured screen in docs/design-review/YYYY-MM-DD.json after inspecting the CI artifacts.');
for (const warning of warnings) console.warn(`::warning title=Deferred measured timing under the owner waiver::${warning}`);
