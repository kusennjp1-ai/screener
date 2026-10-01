import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

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
  for (const screen of review.screens) for (const key of required) {
    if (typeof screen.scores?.[key]?.value !== 'number' || screen.scores[key].value < 8 || screen.scores[key].value > 10 || !screen.scores[key].reason || !screen.screenshot) throw Error(`${name}/${screen.key}: ${key} requires a reviewed score >= 8.0 and its reason`);
  }
  const actual = JSON.parse(await readFile(resolve('test-results/design-review/report.json'), 'utf8'));
  const reviewedKeys = new Set(review.screens.map(screen => screen.key));
  if (!actual.screens.length || actual.screens.some(screen => !reviewedKeys.has(screen.key))) throw Error('The subjective review does not cover every captured screen/theme/viewport');
  if (actual.failures.length) throw Error('Objective design/performance failures remain; subjective scores cannot override them');
  console.log(`Design score gate passed: ${name}, ${review.screens.length} reviewed captures. Scores are a documented internal review, not an award or human-user survey.`);
  reviewed = true;
  break;
}
if (!reviewed) throw Error('No screenshot-based design review matches the current UI. Record four scores and reasons for every captured screen in docs/design-review/YYYY-MM-DD.json after inspecting the CI artifacts.');
