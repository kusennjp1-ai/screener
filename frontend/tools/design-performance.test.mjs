import { afterEach, describe, expect, it, vi } from 'vitest';
import { assess } from '../src/static/researchEngine.js';
import { PERFORMANCE_SCENARIOS, P1_LIMITS, Q1_LIMITS, performanceDomWitness, performanceDomFailures, performanceResult, performanceSummary, performancePublicationUniverse, performanceUniverseFailures, coldNavigationFailures, designReviewProvenance } from './design-performance.mjs';

const viewport = { width: 1440, height: 900 };
const defaultScenario = PERFORMANCE_SCENARIOS.find(item => item.label === 'current');
const stressScenario = PERFORMANCE_SCENARIOS.find(item => item.label === 'current-50-stress');
const baselineScenario = PERFORMANCE_SCENARIOS.find(item => item.label === 'baseline');
const run = (values = {}) => ({ candidate_ms: 3000, method_switch_ms: 350, longest_initial_task_ms: 180, ...values });

describe('unchanged P1/Q1 reporting for default20 and optional50', () => {
  it('gates the approved default and gives the cold50 option a separate section with the same budgets', () => {
    expect(P1_LIMITS).toEqual({ candidate_median_ms: 3500, maximum_switch_ms: 400, longest_initial_task_ms: 200 });
    expect(Q1_LIMITS).toEqual({ candidate_median_ms: 4200, maximum_switch_ms: 480 });
    expect(defaultScenario).toMatchObject({ page_size: 20, route: '', release_criterion: true, section: 'performance' });
    expect(stressScenario).toMatchObject({ page_size: 50, route: '#/?feedSize=50', release_criterion: false, section: 'performance_stress' });
    expect(PERFORMANCE_SCENARIOS.filter(item => item.label === 'baseline')).toHaveLength(1);
    expect(baselineScenario.product_default).toContain('legacy dense 50');
  });
  it('reports an optional50 P1 miss even when Q1 passes and the approved default passes', () => {
    const good = performanceResult(defaultScenario, viewport, [run(), run(), run()]);
    const stress = performanceResult(stressScenario, viewport, [run({ method_switch_ms: 401 }), run(), run()]);
    expect(good.p1_pass).toBe(true);
    expect(stress.p1_pass).toBe(false);
    expect(stress.q1_pass).toBe(true);
    expect(stress.p1_limit_failures).toEqual(['P1 maximum_switch_ms: 401ms (limit 400ms)']);
    expect(performanceSummary([stress])).toContain('P1 FAIL, Q1 PASS');
    expect(performanceSummary([stress])).toContain('401ms (limit 400ms)');
  });
  it('retains the cold first run and each original limit rather than averaging away a miss', () => {
    const result = performanceResult(defaultScenario, viewport, [run({ candidate_ms: 5000, method_switch_ms: 481, longest_initial_task_ms: 201 }), run(), run()]);
    expect(result.runs).toHaveLength(3);
    expect(result.runs[0].candidate_ms).toBe(5000);
    expect(result.candidate_median_ms).toBe(3000);
    expect(result.maximum_switch_ms).toBe(481);
    expect(result.longest_initial_task_ms).toBe(201);
    expect(result.p1_pass).toBe(false);
    expect(result.q1_pass).toBe(false);
    expect(result.p1_limit_failures).toHaveLength(2);
  });
  it.each([{ runs: [] }, { runs: [run(), run()] }, { runs: [run(), run(), run({ method_switch_ms: NaN })] }])('never passes missing or invalid measured runs', ({ runs }) => {
    const result = performanceResult(defaultScenario, viewport, runs);
    expect(result.p1_pass).toBe(false);
    expect(result.q1_pass).toBe(false);
    expect(result.candidate_median_ms).toBeNull();
    expect(result.measurement_failures).not.toHaveLength(0);
  });
  it('fails fast timings when the committed DOM is unfinished', () => {
    const result = performanceResult(defaultScenario, viewport, [run(), run(), run()], { observationFailures: ['method body is stale'] });
    expect(result.p1_limit_failures).toHaveLength(0);
    expect(result.p1_pass).toBe(false);
    expect(result.q1_pass).toBe(false);
    expect(result.measurement_failures).toContain('method body is stale');
  });
  it('keeps inclusive exact limits and the 20% Q1 allowance separate', () => {
    const result = performanceResult(defaultScenario, viewport, Array.from({ length: 3 }, () => run({ candidate_ms: 3500, method_switch_ms: 400, longest_initial_task_ms: 200 })));
    expect(result.p1_pass).toBe(true);
    const allowance = performanceResult(defaultScenario, viewport, Array.from({ length: 3 }, () => run({ candidate_ms: 4200, method_switch_ms: 480, longest_initial_task_ms: 200 })));
    expect(allowance.q1_pass).toBe(true);
    expect(allowance.p1_pass).toBe(false);
  });
});

function mount(scenario, { method = 'minervini', count = scenario.page_size, total = 2671, selectionTotal = method === 'minervini' ? 9 : 8 } = {}) {
  const name = method === 'minervini' ? 'ミネルヴィニ' : 'オニール';
  const table = scenario.label === 'baseline';
  const rows = Array.from({ length: count }, (_, i) => table
    ? `<tr><td><button aria-label="SYM${i} の分析を表示">SYM${i}</button><small>$20</small></td><td><span>ピボット待ち</span><small>選定 <span>4/${selectionTotal}</span> · 未確認1</small></td></tr>`
    : `<div role="listitem" data-feed-symbol="SYM${i}"><article class="candidate-feed-card"><button class="candidate-row" aria-label="SYM${i} の分析を表示"><span class="candidate-name"><strong>SYM${i}</strong></span></button><div data-check="selection">選定条件 4/${selectionTotal}未達 1 · 未確認 3</div></article></div>`).join('');
  document.body.innerHTML = `<main class="research-workbench"><div aria-label="投資手法"><button aria-pressed="true">${name}${table && method === 'oneil' ? ' / CAN SLIM' : ''}</button></div><section id="candidate-board" class="research-list" ${table ? '' : `data-feed-method="${method}" data-feed-page-size="${scenario.page_size}" data-feed-total="${total}" data-feed-start="1" data-feed-end="${count}" data-feed-evaluated-at="1"`}><div class="candidate-board-heading"><h2>${table ? '候補リスト' : name + ' 候補'} <small>${total.toLocaleString('en-US')}件</small></h2></div>${table ? `<table><tbody>${rows}</tbody></table>` : rows}<div class="candidate-pagination">${table ? '<button>前の50件</button><span>1 / 54</span><button>次の50件</button>' : `<select aria-label="1ページの銘柄数"><option value="${scenario.page_size}" selected>${scenario.page_size}件</option></select>`}</div></section></main>`;
  return performanceDomWitness();
}
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('equivalent committed method/count/content witnesses for both products', () => {
  it.each(PERFORMANCE_SCENARIOS)('reads actual $label DOM size and full total', scenario => {
    const witness = mount(scenario);
    expect(witness.rendered_count).toBe(scenario.page_size);
    expect(witness.rendered_card_count).toBe(scenario.label === 'baseline' ? 0 : scenario.page_size);
    expect(witness.total).toBe(2671);
    expect(witness.page_size).toBe(scenario.page_size);
    expect(witness.rows.at(-1).symbol).toBe(`SYM${scenario.page_size - 1}`);
    expect(performanceDomFailures(witness, { ...scenario, method: 'minervini' })).toEqual([]);
  });
  it.each(PERFORMANCE_SCENARIOS)('rejects $label partial render despite a ready first row and correct declared total', scenario => {
    const witness = mount(scenario, { count: scenario.page_size - 1 });
    expect(performanceDomFailures(witness, { ...scenario, method: 'minervini' })).toContain(`rendered count ${scenario.page_size - 1} differs from page size ${scenario.page_size} / total 2671`);
  });
  it.each(PERFORMANCE_SCENARIOS)('rejects $label switched controls with unfinished previous method content', scenario => {
    const witness = mount(scenario, { method: 'oneil', selectionTotal: 9 });
    expect(witness.method).toBe('oneil');
    expect(performanceDomFailures(witness, { ...scenario, method: 'oneil' })).toContain('rendered selection evidence is incomplete or belongs to another method (expected 8 conditions)');
    expect(performanceDomFailures(mount(scenario, { method: 'oneil' }), { ...scenario, method: 'oneil' })).toEqual([]);
  });
  it('checks the method content discriminator against actual unchanged method rules', () => {
    expect(assess({}, 'minervini').total).toBe(9);
    expect(assess({}, 'oneil').total).toBe(8);
  });
  it('does not treat feed metadata as rendered card evidence', () => {
    mount(defaultScenario);
    document.querySelector('.candidate-name strong').textContent = '';
    expect(performanceDomFailures(performanceDomWitness(), { ...defaultScenario, method: 'minervini' })).toContain('rendered candidate identity/content is incomplete or duplicated');
  });
});

describe('capture versus publication-source provenance', () => {
  it('binds captures to this GitHub run even when input selection exported SOURCE_RUN', () => {
    expect(designReviewProvenance({ GITHUB_RUN_ID: '37185249269', GITHUB_REPOSITORY: 'owner/screener', SOURCE_RUN: '37178754997' }))
      .toEqual({ source_run: 'https://github.com/owner/screener/actions/runs/37185249269', input_source_run: '37178754997' });
  });
  it('never invents a capture run from the publication artifact run', () => {
    expect(designReviewProvenance({ SOURCE_RUN: '37178754997' })).toEqual({ source_run: null, input_source_run: '37178754997' });
    expect(designReviewProvenance({ CAPTURE_SOURCE_RUN: 'explicit-capture', SOURCE_RUN: 'input' })).toEqual({ source_run: 'explicit-capture', input_source_run: 'input' });
  });
});

describe('full-universe control across page sizes', () => {
  const date = '2026-10-02';
  const row = (symbol, extra = {}) => ({ symbol, market: 'US', current_price: 20, adv_usd: 30000000, ...extra });
  it('derives the canonical complete default cohort, including chunks and unique repeated initial rows', () => {
    const a = row('A'), b = row('B', { current_price: 9 }), c = row('C', { market: 'JP' });
    const universe = performancePublicationUniverse([{ as_of_date: date, initial_rows: [a, b] },
      { as_of_date: date, rows: [a, b, c, row('D', { market: undefined }), row('E', { adv_usd: 20000000 }), row('F', { current_price: null })] }], date);
    expect(universe.source_symbols).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
    expect(universe.symbols).toEqual(['A', 'D', 'E']);
    expect(() => performancePublicationUniverse([{ as_of_date: '2026-10-01', rows: [a] }], date)).toThrow('Mixed or missing snapshot dates');
  });
  it('rejects truncation and out-of-cohort symbols even when the smaller page itself is complete', () => {
    const universe = { symbols: ['A', 'B', 'C'] };
    const full = { initial_dom: { total: 3, rows: [{ symbol: 'A' }] }, switched_dom: { total: 3, rows: [{ symbol: 'B' }] } };
    expect(performanceUniverseFailures([full, full, full], universe)).toEqual([]);
    expect(performanceUniverseFailures([full, { ...full, switched_dom: { total: 1 } }, full], universe)).toContain('run 2 switched_dom: full candidate total 1 differs from own complete-publication 3');
    expect(performanceUniverseFailures([{ ...full, switched_dom: { total: 3, rows: [{ symbol: 'OUTSIDE' }] } }], universe)).toContain('run 1 switched_dom: rendered symbol is outside its own complete-publication cohort');
    expect(performanceUniverseFailures([full], null)).toContain('own complete-publication candidate universe is missing');
  });
  it('allows a legitimate legacy cohort difference but requires current50/current20 parity', () => {
    const current = performancePublicationUniverse([{ as_of_date: date, rows: [row('A'), row('B')] }], date);
    const legacy = performancePublicationUniverse([{ as_of_date: date, rows: [row('A'), row('B', { adv_usd: 1 })] }], date);
    expect(current.source_symbols).toEqual(legacy.source_symbols);
    const runFor = total => ({ initial_dom: { total }, switched_dom: { total } });
    expect(performanceUniverseFailures([runFor(1)], legacy)).toEqual([]);
    expect(performanceUniverseFailures([runFor(2)], current)).toEqual([]);
    expect(performanceUniverseFailures([runFor(2)], current, { referenceTotal: 2 })).toEqual([]);
    expect(performanceUniverseFailures([runFor(2)], current, { referenceTotal: 1 })).toContain('current20 full candidate total 1 differs from own complete-publication 2');
  });
});

describe('cold route navigation evidence', () => {
  it('requires a newer document and a real reload for every product workload', () => {
    expect(coldNavigationFailures(1000, { time_origin: 2000, navigation_type: 'reload' })).toEqual([]);
    expect(coldNavigationFailures(1000, { time_origin: 1000, navigation_type: 'reload' })).not.toHaveLength(0);
    expect(coldNavigationFailures(1000, { time_origin: 2000, navigation_type: 'navigate' })).not.toHaveLength(0);
    expect(coldNavigationFailures(null, { time_origin: 2000, navigation_type: 'reload' })).not.toHaveLength(0);
  });
});


describe('included DOM witness observation cost', () => {
  it('records synchronous collection duration without altering the observed DOM', () => {
    mount(defaultScenario);
    const before = document.body.innerHTML;
    vi.spyOn(performance, 'now').mockReturnValueOnce(100).mockReturnValueOnce(102.25);
    const witness = performanceDomWitness();
    expect(witness.collection_ms).toBe(2.25);
    expect(document.body.innerHTML).toBe(before);
  });
  it('does not subtract observer cost to turn a measured budget failure into a pass', () => {
    const runs = [run({ method_switch_ms: 401, switched_dom: { collection_ms: 20 } }), run(), run()];
    const result = performanceResult(defaultScenario, viewport, runs);
    expect(result.maximum_switch_ms).toBe(401);
    expect(result.p1_pass).toBe(false);
    expect(result.runs[0].switched_dom.collection_ms).toBe(20);
  });
});
