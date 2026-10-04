import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { mergeScanRows } from '../src/static/qualificationAudit.js';
import { filterRanked } from '../src/static/researchPresentation.js';

// P1 release limits and Q1 allowances are independent. A Q1 pass cannot
// override P1. Both the approved default and optional stress use these limits.
export const P1_LIMITS = Object.freeze({ candidate_median_ms: 3500, maximum_switch_ms: 400, longest_initial_task_ms: 200 });
export const Q1_LIMITS = Object.freeze({ candidate_median_ms: 4200, maximum_switch_ms: 480 });
export const PERFORMANCE_SCENARIOS = Object.freeze([
  { label: 'baseline', section: 'performance', page_size: 50, release_criterion: false, route: '', product_default: 'legacy dense 50-row default (cd3a6a2)' },
  { label: 'current', section: 'performance', page_size: 20, release_criterion: true, route: '', product_default: 'approved research-feed 20-card default' },
  { label: 'current-50-stress', section: 'performance_stress', page_size: 50, release_criterion: false, route: '#/?feedSize=50', product_default: 'optional research-feed 50-card stress' },
]);
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

export function performanceResult(scenario, viewport, runs, { cachedResponseCount = 0, observationFailures = [] } = {}) {
  const complete = runs.length === 3 && runs.every(run => ['candidate_ms', 'method_switch_ms', 'longest_initial_task_ms'].every(key => Number.isFinite(run[key]) && run[key] >= 0));
  const metrics = { ...scenario, viewport, cpu_rate: 4, runs,
    candidate_median_ms: complete ? median(runs.map(run => run.candidate_ms)) : null,
    maximum_switch_ms: complete ? Math.max(...runs.map(run => run.method_switch_ms)) : null,
    longest_initial_task_ms: complete ? Math.max(...runs.map(run => run.longest_initial_task_ms)) : null,
    cached_response_count: cachedResponseCount, p1_limits: P1_LIMITS, q1_limits: Q1_LIMITS, observation_failures: [...observationFailures] };
  const limits = (name, thresholds) => Object.entries(thresholds).flatMap(([key, limit]) => metrics[key] === null || metrics[key] > limit ? [`${name} ${key}: ${metrics[key] ?? 'unmeasured'}ms (limit ${limit}ms)`] : []);
  metrics.p1_limit_failures = limits('P1', P1_LIMITS);
  metrics.q1_limit_failures = limits('Q1', Q1_LIMITS);
  metrics.measurement_failures = [...(!complete ? ['requires all 3 finite measured runs, including the cold first run'] : []), ...observationFailures];
  metrics.p1_pass = complete && !metrics.measurement_failures.length && !metrics.p1_limit_failures.length;
  metrics.q1_pass = complete && !metrics.measurement_failures.length && !metrics.q1_limit_failures.length;
  return metrics;
}

// Evaluate this synchronously at the existing second-rAF timing boundary.
// It observes committed DOM, without polling, sleeping or deferring rendering.
export function performanceDomWitness() {
  const collectionStart = performance.now();
  const board = document.querySelector('#candidate-board') || document.querySelector('.research-list');
  const number = value => /^\d+$/.test(value || '') ? Number(value) : null;
  const methods = { 'ミネルヴィニ': 'minervini', '基本と原則': 'minervini2', 'オニール': 'oneil', 'IBD型': 'ibd' };
  const active = document.querySelector('[aria-label="投資手法"] [aria-pressed="true"]')?.textContent.trim().replace(' / CAN SLIM', '').replace('リーダー', '');
  const heading = board?.querySelector('.candidate-board-heading h2')?.textContent.trim() || '';
  const count = /([\d,]+)件/.exec(heading);
  const pageControl = board?.querySelector('[aria-label="1ページの銘柄数"]');
  const legacyPageLabel = /(?:前|次)の(\d+)件/.exec(board?.querySelector('.candidate-pagination')?.textContent || '');
  const pageSize = pageControl ? number(pageControl.value) : legacyPageLabel ? Number(legacyPageLabel[1]) : null;
  const rows = [...(board?.querySelectorAll('.candidate-row, tbody tr') || [])];
  const cards = [...(board?.querySelectorAll('.candidate-feed-card') || [])];
  const witness = { observed_at: Date.now(), time_origin: performance.timeOrigin, navigation_type: performance.getEntriesByType?.('navigation')[0]?.type || null, url: location.href, method: methods[active] || null, active_method_text: active || null, heading,
    total: count ? Number(count[1].replaceAll(',', '')) : null, rendered_count: rows.length, rendered_card_count: cards.length,
    page_size: pageSize, page_size_source: pageControl ? 'visible page-size control' : legacyPageLabel ? 'visible pagination label' : null,
    declared_page_size: number(board?.dataset.feedPageSize), declared_total: number(board?.dataset.feedTotal),
    range_start: number(board?.dataset.feedStart), range_end: number(board?.dataset.feedEnd),
    declared_method: board?.dataset.feedMethod || null, evaluated_at: number(board?.dataset.feedEvaluatedAt),
    rows: rows.map(row => ({ symbol: row.querySelector('.candidate-name strong')?.textContent.trim() || row.querySelector('td button')?.textContent.trim() || null,
      text: row.textContent.trim(), accessible_name: row.getAttribute('aria-label') || row.querySelector('td button')?.getAttribute('aria-label') || '',
      selection: row.closest('.candidate-feed-card')?.querySelector('[data-check="selection"]')?.textContent.trim() || row.querySelector('td:nth-child(2) small')?.textContent.trim() || null,
      declared_symbol: row.closest('[data-feed-symbol]')?.dataset.feedSymbol || null })) };
  // Synchronous read cost stays inside the measured endpoint. Serialization
  // and transport also remain included; this observation is never subtracted.
  witness.collection_ms = performance.now() - collectionStart;
  return witness;
}

export function performanceDomFailures(witness, { method, page_size: pageSize, label }) {
  const failures = [];
  if (!Number.isFinite(witness?.collection_ms) || witness.collection_ms < 0) failures.push('DOM witness collection duration is missing or invalid');
  const names = { minervini: 'ミネルヴィニ', oneil: 'オニール' };
  if (witness?.method !== method || !(label === 'baseline' ? witness?.heading?.startsWith('候補リスト') : witness?.heading?.startsWith(names[method]))) failures.push(`committed method/content is not ${method}`);
  if (!Number.isInteger(witness?.total) || witness.total < 1) failures.push('visible full candidate total is missing');
  if (witness?.page_size !== pageSize) failures.push(`visible page size ${witness?.page_size} is not ${pageSize}`);
  if (witness?.rendered_count !== Math.min(pageSize, witness?.total)) failures.push(`rendered count ${witness?.rendered_count} differs from page size ${pageSize} / total ${witness?.total}`);
  const rows = witness?.rows || [];
  if (!rows.length || rows.length !== witness?.rendered_count || rows.some(row => !row.symbol || !row.text || !row.accessible_name.includes(row.symbol)) || new Set(rows.map(row => row.symbol)).size !== rows.length) failures.push('rendered candidate identity/content is incomplete or duplicated');
  // Both products must commit selection evidence with every candidate. This
  // catches a method header update which left its body unfinished or empty.
  const expectedTotal = { minervini: 9, oneil: 8 }[method];
  if (rows.some(row => {
    const counts = /選定(?:条件)?\s*(\d+)\s*\/\s*(\d+)/.exec(row.selection || row.accessible_name);
    return !counts || Number(counts[2]) !== expectedTotal || Number(counts[1]) > expectedTotal;
  })) failures.push(`rendered selection evidence is incomplete or belongs to another method (expected ${expectedTotal} conditions)`);
  if (label !== 'baseline') {
    if (witness?.declared_method !== method || witness?.declared_page_size !== pageSize || witness?.declared_total !== witness?.total) failures.push('committed feed metadata disagrees with the visible method/count/page size');
    if (witness?.rendered_card_count !== witness?.rendered_count || witness?.range_start !== 1 || witness?.range_end !== witness?.rendered_count) failures.push('actual rendered cards/range differ from the committed feed page');
    if (!Number.isSafeInteger(witness?.evaluated_at) || witness.evaluated_at <= 0 || witness.evaluated_at > witness.observed_at) failures.push('committed financial evaluation epoch is missing or invalid');
    if (rows.some(row => row.declared_symbol !== row.symbol)) failures.push('feed identity metadata disagrees with visible content');
  }
  return failures;
}

export function performanceSummary(items) {
  const dom = value => value ? `${value.rendered_count} rendered rows (${value.rendered_card_count} feed cards), observed page size ${value.page_size}, full candidate total ${value.total}, method ${value.method}, witness collection ${value.collection_ms}ms (included)` : 'unmeasured';
  return items.map(item => `- ${item.label}, ${item.viewport.width}px, ${item.product_default}: candidate median ${item.candidate_median_ms ?? 'unmeasured'}ms, switch maximum ${item.maximum_switch_ms ?? 'unmeasured'}ms, longest task ${item.longest_initial_task_ms ?? 'unmeasured'}ms; P1 ${item.p1_pass ? 'PASS' : 'FAIL'}, Q1 ${item.q1_pass ? 'PASS' : 'FAIL'}.\n${item.runs.map((run, i) => `  - Run ${i + 1}: initial ${dom(run.initial_dom)}; switched ${dom(run.switched_dom)}`).join('\n')}\n${[...item.measurement_failures, ...item.p1_limit_failures, ...item.q1_limit_failures].map(failure => `  - ${failure}`).join('\n')}`).join('\n');
}

// select-release-source exports SOURCE_RUN for the input artifact. It is not
// the run which captured the new browser evidence.
export function designReviewProvenance(env) {
  return { source_run: env.GITHUB_RUN_ID && env.GITHUB_REPOSITORY
    ? `https://github.com/${env.GITHUB_REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`
    : env.CAPTURE_SOURCE_RUN || null, input_source_run: env.SOURCE_RUN || null };
}

// Both cd3a6a2 and current defaults admit US/missing-market rows and use this
// same liquidity predicate, with qualification/search/watch/coverage off. The
// source projection changes financial facts, not market, price or ADV. Use
// each version's complete exported payloads: equal symbols alone do not imply
// identical exported liquidity values or cohort membership.
export function performancePublicationUniverse(payloads, date) {
  const rows = mergeScanRows(payloads.map(decodeResearchIndex), date);
  const ranked = rows.filter(row => row.market === 'US' || !row.market).map(row => ({ row, assessment: {} }));
  return { source_symbols: rows.map(row => row.symbol).sort(),
    symbols: filterRanked(ranked, { liquidOnly: true }).map(({ row }) => row.symbol).sort() };
}

export function performanceUniverseFailures(runs, universe, { referenceTotal, referenceLabel = 'current20' } = {}) {
  if (!Array.isArray(universe?.symbols) || !universe.symbols.length) return ['own complete-publication candidate universe is missing'];
  const expectedTotal = universe.symbols.length, symbols = new Set(universe.symbols);
  const failures = [];
  if (referenceTotal !== undefined && referenceTotal !== expectedTotal) failures.push(`${referenceLabel} full candidate total ${referenceTotal ?? 'unmeasured'} differs from own complete-publication ${expectedTotal}`);
  return [...failures, ...runs.flatMap((run, index) => ['initial_dom', 'switched_dom'].flatMap(phase => {
    const witness = run[phase], errors = [];
    if (witness?.total !== expectedTotal) errors.push(`run ${index + 1} ${phase}: full candidate total ${witness?.total ?? 'unmeasured'} differs from own complete-publication ${expectedTotal}`);
    if (witness?.rows?.some(row => !symbols.has(row.symbol))) errors.push(`run ${index + 1} ${phase}: rendered symbol is outside its own complete-publication cohort`);
    return errors;
  }))];
}

export function coldNavigationFailures(previousTimeOrigin, witness) {
  return Number.isFinite(previousTimeOrigin) && Number.isFinite(witness?.time_origin) && witness.time_origin > previousTimeOrigin && witness.navigation_type === 'reload'
    ? [] : ['measured navigation did not create a fresh document'];
}
