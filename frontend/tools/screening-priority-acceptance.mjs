// User-approved ordinary/carry acceptance policy, 2026-10-21. Original Design
// failures and timing limits are evidence, never rewritten as performance passes.
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync, renameSync, appendFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, inventoryDigest, uiInventory, safePath } from '../../.github/scripts/publication-state.mjs';
import { completeInventory } from '../../.github/scripts/financial-release-activation.mjs';
import { validateTransportPreview } from '../../.github/scripts/static-transport-publication.mjs';
import { validateDesignCarryPreview } from '../../.github/scripts/design-financial-carry.mjs';
import { CHART_DESIGN_SYMBOLS } from './chart-design-cases.mjs';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens } from './financial-design-cases.mjs';
import { financialCarryDesignScreens } from './financial-carry-design-cases.mjs';
import { dailyObservationDesignScreens } from './daily-observation-design-cases.mjs';
import { measuredPerformanceFailures } from './limited-research-assessment.mjs';
import { radarMeasurementFailures } from './radar-benchmark-context.mjs';

export const SCREENING_PRIORITY_POLICY = 'ordinary-carry-screening-priority-2026-10-21-v1';
export const DESIGN_GROUPS = ['1440/dark', '1440/light', '390/dark', '390/light'];
const repository = 'kusennjp1-ai/screener';
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positive = value => Number.isSafeInteger(value) && value > 0;
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (path, cap = 16 * 1024 * 1024) => {
  const stat = lstatSync(path);
  assert(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1 && stat.size <= cap, 'Unbounded or linked Design evidence');
  return readFileSync(path);
};
const json = path => JSON.parse(read(path));
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8' }).trim();
const write = (path, value) => { const temporary = path + '.new'; writeFileSync(temporary, JSON.stringify(value, null, 2), { flag: 'wx' }); renameSync(temporary, path); };

export function requiredScreeningCaptures(scope) {
  const result = [];
  for (const group of DESIGN_GROUPS) {
    const [width, theme] = group.split('/'), viewport = { width: Number(width) };
    const names = ['home', 'near-pass', 'detail', 'chart', 'portfolio', 'comparison', 'comparison-near-pass', 'market', 'breadth', 'scan',
      ...(viewport.width === 1440 ? ['compact'] : []),
      ...CHART_DESIGN_SYMBOLS.flatMap(symbol => ['inline', 'inline-annotations', 'expanded', 'expanded-annotations', 'expanded-short'].map(view => `case-${symbol}-${view}`)),
      ...financialDesignScreens(viewport, theme), ...(scope === 'carry' ? financialCarryDesignScreens(viewport, theme) : []), ...dailyObservationDesignScreens(viewport, theme)];
    result.push(...names.map(name => `${name}/${group}`));
  }
  return result;
}

// This context selects a policy; the existing CI/provenance/transport checks
// remain the authority. It cannot authenticate a candidate or admit new data.
export function screeningPriorityBinding({ currentRoot, baselineRoot, commit, inputBasis, limited = false, env = process.env }) {
  if (limited || env.FINANCIAL_CANDIDATE_DIR || inputBasis !== 'same_verified_input') return null;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REPOSITORY !== repository || env.GITHUB_JOB !== 'design-acceptance'
      || env.GITHUB_WORKFLOW_REF !== `${repository}/.github/workflows/design-acceptance.yml@${env.GITHUB_REF}`
      || !['pull_request', 'push', 'workflow_dispatch'].includes(env.GITHUB_EVENT_NAME)) return null;
  assert(/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ID || '') && /^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || ''), 'Missing current Design attempt');
  assert(env.GITHUB_SHA === commit && git('rev-parse', 'HEAD') === commit, 'Design checkout differs from current attempt');
  assert(baselineRoot && env.RUNNER_TEMP && resolve(env.RUNNER_TEMP) === env.RUNNER_TEMP, 'Missing fixed Design comparison/provenance root');
  const provenanceBytes = read(resolve(env.RUNNER_TEMP, 'design-input-provenance.json')), state = JSON.parse(provenanceBytes);
  // Known certified financial receipt schemas are always strict, even if a
  // candidate environment variable was accidentally omitted.
  if (typeof state.schema_version === 'string' && state.schema_version.startsWith('financial-')) return null;
  let scope;
  if (state.schema === 'design-financial-carry-preview-v1') {
    validateDesignCarryPreview(state);
    assert(state.ui_sha === commit && state.ui_tree === git('rev-parse', 'HEAD^{tree}'), 'Carry provenance belongs to another checkout');
    assert(state.caller.repository === repository && String(state.caller.run_id) === env.GITHUB_RUN_ID
      && String(state.caller.run_attempt) === env.GITHUB_RUN_ATTEMPT && state.caller.event === env.GITHUB_EVENT_NAME
      && state.caller.checkout_sha === commit, 'Carry provenance belongs to another Design run/attempt');
    scope = 'carry';
  } else {
    assert(state.decision?.mode === 'design' && state.sourceSha === commit && state.controllerSha === commit
      && !state.activation && !state.correction && !state.carry && !state.renewal
      && !Object.hasOwn(state, 'schema') && !Object.hasOwn(state, 'schema_version')
      && !Object.hasOwn(state, 'publication_authority') && !Object.hasOwn(state, 'financial_admission')
      && positive(state.source?.artifact?.id) && /^sha256:[a-f0-9]{64}$/.test(state.source.artifact.digest || '')
      && positive(state.source.runId) && positive(state.source.attempt) && hash(state.source.manifestHash), 'Unknown or inconsistent ordinary Design provenance');
    scope = 'ordinary';
  }
  const publicationBytes = read(resolve(currentRoot, 'publication.json')), publication = validateTransportPreview(JSON.parse(publicationBytes));
  const manifestBytes = read(resolve(currentRoot, 'static-data/manifest.json')), manifest = JSON.parse(manifestBytes);
  const bindings = publication.transport.root.bindings, uiDigest = inventoryDigest(uiInventory(currentRoot));
  assert(publication.ui_sha === commit && publication.ui_digest === uiDigest && publication.data_manifest_sha256 === sha256(manifestBytes)
    && bindings.appCommit === commit && bindings.sourceCommit === commit && bindings.candidateId === sha256(provenanceBytes), 'Design UI/input/provenance transport binding differs');
  const generation = manifest.financial_generation ?? null;
  if (scope === 'carry') {
    assert(state.publication_authority === 'none' && state.financial_admission === false
      && state.financial_generation === generation && state.financial_lineage_sha256 === bindings.financialLineageSha256
      && state.logical_data_inventory_sha256 === publication.transport.logical_data_inventory_sha256, 'Carry input generation differs');
  } else if (generation !== null || state.live?.financialRelease) {
    assert(hash(generation) && state.live?.financialRelease?.financial_generation === generation && state.live?.receipt?.financial_generation === generation
      && hash(state.live.financialRelease.lineage_sha256) && state.live.financialRelease.lineage_sha256 === state.live.receipt.financial_lineage_sha256
      && bindings.financialLineageSha256 === state.live.financialRelease.lineage_sha256, 'Ordinary input lacks its active financial lineage');
  }
  assert(bindings.financialGeneration === generation, 'Design financial generation differs');
  return { policy: SCREENING_PRIORITY_POLICY, scope, commit, tree: git('rev-parse', 'HEAD^{tree}'), run_id: env.GITHUB_RUN_ID, run_attempt: env.GITHUB_RUN_ATTEMPT,
    provenance_sha256: sha256(provenanceBytes), publication_sha256: sha256(publicationBytes), manifest_sha256: sha256(manifestBytes),
    ui_digest: uiDigest, logical_data_inventory_sha256: publication.transport.logical_data_inventory_sha256,
    physical_inventory_sha256: publication.transport.physical_inventory_sha256,
    current_inventory_sha256: inventoryDigest(completeInventory(currentRoot)), baseline_inventory_sha256: inventoryDigest(completeInventory(baselineRoot)),
    as_of_date: (manifest.markets?.US || manifest).as_of_date, research_generation: manifest.research_generation };
}

export function assessScreeningPriority(report, binding, completedGroups) {
  assert(binding?.policy === SCREENING_PRIORITY_POLICY && ['ordinary', 'carry'].includes(binding.scope), 'Explicit ordinary/carry policy required');
  assert(report.commit === binding.commit && report.input_basis === 'same_verified_input' && !report.assessment_mode, 'Report scope differs');
  assert(Array.isArray(report.failures) && report.failures.every(failure => typeof failure === 'string'), 'Original Design failures required');
  const blocking = [], original = [...report.failures];
  let timingComplete = true;
  if (report.performance?.length !== 4) { blocking.push('Exactly four baseline/current performance groups must complete'); timingComplete = false; }
  if (!isDeepStrictEqual(completedGroups, DESIGN_GROUPS)) blocking.push('All route/operation/financial groups must finish');
  if (report.data?.as_of_date !== binding.as_of_date || report.data?.research_generation !== binding.research_generation) blocking.push('Measured data identity differs from bound input');
  const expected = requiredScreeningCaptures(binding.scope), keys = (report.screens || []).map(screen => screen.key);
  if (keys.length !== expected.length || new Set(keys).size !== keys.length || expected.some(key => !keys.includes(key)) || report.screens?.some(screen => !safePath(screen.screenshot) || !hash(screen.sha256))) blocking.push('Every required current screenshot must complete');
  const exactCases = (records, named) => [1440, 390].every(width => named.every(item => records.filter(record => record.symbol === item.symbol && record.viewport?.width === width && record.theme === (width === 1440 ? 'dark' : 'light')
    && !record.error && record.source && record.financial_rows?.length && record.selection && record.purchase && record.csv).length === 1));
  if (report.financial_cases?.length !== 10 || !exactCases(report.financial_cases || [], FINANCIAL_DESIGN_CASES)) blocking.push('All actual financial/unknown/selection/purchase/CSV guards must complete');
  if (binding.scope === 'carry' && (report.financial_carry_cases?.length !== 10 || !exactCases(report.financial_carry_cases || [], FINANCIAL_DESIGN_CASES))) blocking.push('All carry financial/unknown/CSV guards must complete');
  if (report.chart_cases?.length !== 12 || report.chart_cases.some(record => !record.expanded_scrolled_geometry || !record.expanded_reopened_geometry || !record.selected_one_month_range)) blocking.push('All chart geometry/scroll/range/focus operations must complete');
  if (report.daily_observations?.length !== 2 || report.daily_observations.some(record => record.error || !record.watch_keyboard_added || !record.watch_keyboard_removed || record.table_keyboard_scroll?.length !== 4 || !record.research_keyboard_destination)) blocking.push('All Daily navigation/watch/table keyboard operations must complete');
  for (const width of [1440, 390]) {
    const baseline = (report.performance || []).filter(item => item.label === 'baseline' && item.viewport?.width === width), base = baseline[0], trials = base?.runs;
    if (baseline.length !== 1 || trials?.length !== 3 || !trials.every(run => ['candidate_ms', 'method_switch_ms', 'longest_initial_task_ms'].every(key => finite(run[key])))) { blocking.push(`${width}: incomplete baseline measurement`); timingComplete = false; }
    else if (base.candidate_median_ms !== [...trials.map(run => run.candidate_ms)].sort((a, b) => a - b)[1] || base.maximum_switch_ms !== Math.max(...trials.map(run => run.method_switch_ms)) || base.longest_initial_task_ms !== Math.max(...trials.map(run => run.longest_initial_task_ms))) { blocking.push(`${width}: baseline aggregates differ from raw trials`); timingComplete = false; }
    const items = (report.performance || []).filter(item => item.label === 'current' && item.viewport?.width === width), item = items[0], runs = item?.runs;
    if (items.length !== 1 || runs?.length !== 3 || !runs.every(run => ['candidate_ms', 'method_switch_ms', 'longest_initial_task_ms'].every(key => finite(run[key])))) { blocking.push(`${width}: incomplete performance measurement`); timingComplete = false; }
    else {
      const median = [...runs.map(run => run.candidate_ms)].sort((a, b) => a - b)[1], switching = Math.max(...runs.map(run => run.method_switch_ms)), longest = Math.max(...runs.map(run => run.longest_initial_task_ms));
      if (item.candidate_median_ms !== median || item.maximum_switch_ms !== switching || item.longest_initial_task_ms !== longest || item.p1_pass !== (median <= 3500 && switching <= 400 && longest <= 200)) { blocking.push(`${width}: timing aggregates/P1 differ from raw trials`); timingComplete = false; }
    }
    const radar = (report.radar || []).filter(item => item.viewport?.width === width);
    if (radar.length !== 1 || radar[0].runs?.length !== 3 || !radar[0].runs.every(run => finite(run.first_frame_ms))) { blocking.push(`${width}: incomplete D9 measurement`); timingComplete = false; }
    else for (const [index, run] of radar[0].runs.entries()) for (const failure of radarMeasurementFailures(run, { timing: false })) blocking.push(`${width}: D9 run ${index + 1}: ${failure}`);
  }
  const measured = measuredPerformanceFailures(report), warnings = original.filter(failure => measured.has(failure));
  for (const failure of measured) if (!original.includes(failure)) { blocking.push(`Measured timing failure missing from original report: ${failure}`); timingComplete = false; }
  blocking.push(...original.filter(failure => !warnings.includes(failure)));
  const uniqueBlocking = [...new Set(blocking)];
  return { policy: SCREENING_PRIORITY_POLICY, scope: binding.scope, publication_authority: 'none',
    strict_result: original.length ? 'failed' : 'passed', performance_acceptance: !timingComplete ? 'unverified' : warnings.length ? 'deferred_warning' : 'within_original_limits',
    functional_acceptance: uniqueBlocking.length ? 'failed' : 'passed', policy_exit: uniqueBlocking.length ? 1 : 0,
    original_design_failures: original, warnings, blocking_failures: uniqueBlocking };
}

const files = output => ({ completion: resolve(output, 'screening-priority-completion.json'), assessment: resolve(output, 'screening-priority-assessment.json'), report: resolve(output, 'report.json') });

function carrySealHash(output, binding, report, reportHash) {
  if (binding.scope !== 'carry') return null;
  const bytes = read(resolve(output, 'financial-carry-evidence.json')), evidence = JSON.parse(bytes);
  assert(evidence.report_sha256 === reportHash && evidence.ui_sha === binding.commit && evidence.preview_provenance_sha256 === binding.provenance_sha256
    && evidence.publication_sha256 === binding.publication_sha256 && evidence.physical_inventory_sha256 === binding.physical_inventory_sha256, 'Final carry seal differs from measured inputs/report');
  const artifacts = report.financial_carry_cases.filter(item => item.csv?.artifact).map(item => item.csv.artifact).sort();
  assert.deepEqual(Object.keys(evidence.downloads).sort(), artifacts);
  for (const path of artifacts) {
    assert(safePath(path), 'Invalid carry CSV path');
    const actual = read(resolve(output, path), 32 * 1024 * 1024), expected = evidence.downloads[path];
    assert(expected.sha256 === sha256(actual) && expected.bytes === actual.length, 'Carry CSV changed after final measurement');
  }
  return sha256(bytes);
}

export function finishScreeningPriority({ report, output, before, currentRoot, baselineRoot, inputBasis, completedGroups, env = process.env }) {
  const after = screeningPriorityBinding({ currentRoot, baselineRoot, commit: report.commit, inputBasis, env });
  assert(isDeepStrictEqual(before, after), 'Design input, UI, run or attempt changed during measurement');
  const assessment = assessScreeningPriority(report, after, completedGroups), paths = files(output), reportBytes = read(paths.report, 64 * 1024 * 1024);
  assert(isDeepStrictEqual(JSON.parse(reportBytes), report), 'Final report differs from measured report');
  const screenshots = {};
  for (const screen of report.screens) {
    assert(safePath(screen.screenshot), 'Invalid screenshot path');
    const digest = sha256(read(resolve(output, screen.screenshot), 32 * 1024 * 1024));
    assert(digest === screen.sha256 && !Object.hasOwn(screenshots, screen.key), 'Screenshot changed after capture');
    screenshots[screen.key] = digest;
  }
  const carryHash = carrySealHash(output, after, report, sha256(reportBytes));
  const completedAt = new Date().toISOString();
  assert(Number.isFinite(Date.parse(report.measured_at)) && Date.parse(report.measured_at) <= Date.parse(completedAt), 'Invalid actual measurement clock');
  appendFileSync(resolve(output, 'summary.md'), `\n## User-approved screening priority\n\nPolicy: ${assessment.policy}. Original strict result: ${assessment.strict_result}. Performance: ${assessment.performance_acceptance}. Functional acceptance: ${assessment.functional_acceptance}. Policy exit: ${assessment.policy_exit}.\n\n${assessment.warnings.map(failure => `- WARNING — deferred timing; original threshold unchanged: ${failure}`).join('\n')}\n\nThe original report failures and P1 results remain unchanged. Screenshot review and every functional/data gate remain mandatory.\n`);
  write(paths.assessment, assessment);
  // Last write, after all operations, final carry rebind/seal and report. A
  // partial/progress report cannot create this manifest through the harness.
  write(paths.completion, { schema: 'screening-priority-completion-v1', publication_authority: 'none', financial_admission: false,
    binding: after, completed_groups: completedGroups, carry_seal_sha256: carryHash,
    completed_at: completedAt, report_sha256: sha256(reportBytes), assessment_sha256: sha256(read(paths.assessment)), screenshots });
  return assessment;
}

export function checkedScreeningPriority({ report, output, currentRoot, baselineRoot, inputBasis, env = process.env }) {
  const binding = screeningPriorityBinding({ currentRoot, baselineRoot, commit: report.commit, inputBasis, limited: Boolean(report.assessment_mode), env });
  assert(binding, 'Only bound ordinary/carry Design may defer measured timing failures');
  const paths = files(output), completion = json(paths.completion), assessment = json(paths.assessment);
  assert.deepEqual(Object.keys(completion).sort(), ['schema', 'publication_authority', 'financial_admission', 'binding', 'completed_groups', 'carry_seal_sha256', 'completed_at', 'report_sha256', 'assessment_sha256', 'screenshots'].sort());
  assert(completion.publication_authority === 'none' && completion.financial_admission === false, 'Completion cannot grant publication/financial authority');
  assert(completion.schema === 'screening-priority-completion-v1' && isDeepStrictEqual(completion.binding, binding), 'Final Design manifest belongs to another UI/input/run/attempt');
  assert(Number.isFinite(Date.parse(completion.completed_at)) && Date.parse(report.measured_at) <= Date.parse(completion.completed_at) && Date.parse(completion.completed_at) <= Date.now(), 'Design completion clock is invalid');
  assert(completion.report_sha256 === sha256(read(paths.report, 64 * 1024 * 1024)) && completion.assessment_sha256 === sha256(read(paths.assessment)), 'Final Design report or assessment changed');
  const recomputed = assessScreeningPriority(report, binding, completion.completed_groups);
  assert(isDeepStrictEqual(recomputed, assessment), 'Design acceptance classification changed');
  assert.deepEqual(completion.screenshots, Object.fromEntries(report.screens.map(screen => [screen.key, screen.sha256])));
  for (const screen of report.screens) assert(sha256(read(resolve(output, screen.screenshot), 32 * 1024 * 1024)) === screen.sha256, 'Current screenshot bytes changed');
  assert(completion.carry_seal_sha256 === carrySealHash(output, binding, report, completion.report_sha256), 'Final carry seal changed');
  return assessment;
}

export function requireWarningReviewImages(review, report) {
  const reviewed = new Map(review.screens.map(screen => [screen.key, screen]));
  for (const screen of report.screens) assert(reviewed.get(screen.key)?.sha256 === screen.sha256, 'Deferred timing requires reviewed current screenshot byte hashes; old ancestry alone is insufficient');
}
