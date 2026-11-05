import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { APP_RULES } from './market-regime-study.mjs';
import { BREADTH_RULES, buildReference, compareReferences, fromResults, main, parseStudyMarkdown, refusals, serialize, studyDefinitions, REFERENCE_VERSION, STATE_IDS } from './market-regime-reference.mjs';

const SOURCE = resolve('tools/reference-sources/market-regime-study-v2/ci-results-run41844557380.md');
const REFERENCE = resolve('src/static/reference/market-regime-reference-v1.json');
const markdown = () => readFileSync(SOURCE, 'utf8');
const committed = () => JSON.parse(readFileSync(REFERENCE, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const SOURCE_META = { sha256: '4fc7dcbee932df388e16990b178bf704e1c710b76ae2e33e5afe4c57ce9bb0c6', ciRun: 41844557380, artifact: 13331791935, path: 'frontend/tools/reference-sources/market-regime-study-v2/ci-results-run41844557380.md' };

/**
 * A synthetic results.json in runStudy's shape: every indicator the reference needs, with the study's own bucket
 * labels and rule text, exact shares (fractions) and the contrast's labels on the first state only.
 */
function syntheticResults(edit = study => study) {
  const indicators = Object.entries(studyDefinitions()).map(([key, definition], k) => {
    const two = definition.buckets.length === 2;
    const buckets = definition.buckets.map((label, g) => ({ key: label, label, role: two ? (g === 0 ? 'contrast' : 'complement') : 'vs-baseline', n: 1000 + g, episodes: 40 + g,
      meanReturn: 0.01, median: 0.01, pUp: 0.6, pDd5: 0.1012 + 0.01 * g + 0.001 * k, pDd10: 0.02, h1n: 500, h2n: 500 + g, firstHalfShare: 0.4712,
      mean: two && g === 1 ? null : { est: 0.001, label: 'weak' }, dd5: two && g === 1 ? null : { est: -0.05, label: g === 0 ? 'robust' : 'unstable' } }));
    return { panel: definition.symbol ? `index:${definition.symbol}` : 'breadth', key, label: key, rule: definition.rule ?? 'breadth rule', outcome: 'x', inputs: [], buckets: definition.buckets.map(label => ({ key: label, label })),
      judged: 9000, available: true, firstJudged: '1990-10-15', lastJudged: '2026-11-10', windows: { 21: { n: 9000, baseline: { n: 9000, pDd5: 0.1634 }, buckets } } };
  });
  return edit({ schema_version: 'market-regime-study-v2', as_of_date: '2026-11-10', method: { appRules: JSON.parse(JSON.stringify(APP_RULES)) },
    inputs: { history: { first: '2021-10-14', last: '2026-11-10', sessions: 1274, basis: 'current-published-universe-retrospective' },
      indices: ['^GSPC', '^IXIC'].map(symbol => ({ symbol, first: '1990-01-02', last: '2026-11-10', sessions: 9283, source: 'Yahoo Finance index OHLCV' })) },
    tests: { chance: { available: true, actual: 120, robust: { median: 50, p95: 100 }, panels: [{ panel: 'breadth', actual: 12, robust: { median: 30, p95: 90 } }] } }, indicators });
}

describe('the committed source and reference', () => {
  it('keeps the CI study markdown byte-identical: run 41844557380, artifact 13331791935', () => {
    expect(sha(readFileSync(SOURCE))).toBe(SOURCE_META.sha256);
    expect(committed().source).toEqual({ kind: 'ci-markdown', sha256: SOURCE_META.sha256, ci_run: 41844557380, artifact: 13331791935, precision: 'rounded-1pt', path: SOURCE_META.path });
    expect(committed()).toMatchObject({ schema_version: REFERENCE_VERSION, study_version: 'market-regime-study-v2', study_as_of: '2026-11-03',
      methods: { distribution: 'index-down-strictly-over-0.2-higher-volume-age25-high5-v1', followThrough: 'rally-attempt-gain1.2-day4-15-decline6-v1' }, outcome: { horizonSessions: 21, drawdownPercent: -5 } });
  });

  it('is exactly what the builder makes from that markdown (no hand edits)', () => {
    expect(serialize(buildReference(parseStudyMarkdown(markdown()), SOURCE_META))).toBe(readFileSync(REFERENCE, 'utf8'));
  });

  it('reads the study\'s 21-session drawdown shares and comparators', () => {
    const ref = buildReference(parseStudyMarkdown(markdown()), SOURCE_META), state = (key, id) => ref.indicators[key].states[id];
    expect(state('^GSPC.ma.quadrant', 'above_both')).toMatchObject({ pDd5: 10, comparator: 'baseline', comparatorPDd5: 16, labelDd5: 'robust', n: 5500, episodes: 40, firstHalfShare: 47 });
    expect(state('^GSPC.ma.quadrant', 'below_both')).toMatchObject({ pDd5: 35, comparator: 'baseline', comparatorPDd5: 16, labelDd5: 'robust' });
    expect(state('^GSPC.high.near', 'below')).toMatchObject({ pDd5: 29, comparator: 'other_state', comparatorState: 'near', comparatorPDd5: 11 });
    expect(state('^IXIC.ma.quadrant', 'below_both')).toMatchObject({ pDd5: 46, comparator: 'baseline', comparatorPDd5: 26, firstHalfShare: 60 });
    expect(ref.indicators['^GSPC.ma.quadrant'].baseline).toEqual({ n: 9058, pDd5: 16 });
    expect(ref.samples['^GSPC']).toMatchObject({ first: '1990-01-02', last: '2026-11-03', sessions: 9278 });
    expect(ref.samples.breadth).toMatchObject({ first: '2021-10-14', last: '2026-11-03', sessions: 1269, basis: 'current-published-universe-retrospective' });
    expect(ref.chance).toMatchObject({ all: { actual: 121, median: 51, p95: 102.5 }, breadth: { actual: 13, median: 32, p95: 91.5 } });
    // A state with no sessions keeps no share: never 0.
    expect(state('^GSPC.ftd.state', 'no_correction_pending')).toMatchObject({ n: 0, pDd5: null, firstHalfShare: null, labelDd5: 'insufficient' });
    expect(Object.keys(ref.breadth)).toEqual([...BREADTH_RULES]);
    expect(ref.breadth['rule.lows']).toEqual({ labelDd5: 'insufficient', labelMean: 'insufficient' });
  });

  it('gives a two-state indicator\'s second state the contrast row\'s labels', () => {
    const ref = committed();
    expect(ref.indicators['^GSPC.high.near'].states.below).toMatchObject({ labelDd5: 'robust', labelMean: 'unstable' });
    expect(ref.indicators['^GSPC.high.near'].states.near).toMatchObject({ labelDd5: 'robust', labelMean: 'unstable' });
    expect(ref.indicators['^IXIC.dd.binary'].states.below_warn).toMatchObject({ labelDd5: 'weak', comparatorState: 'warn', comparatorPDd5: 30 });
    for (const [key, indicator] of Object.entries(ref.indicators)) expect(Object.keys(indicator.states), key).toEqual([...STATE_IDS[key.replace(/^\^(GSPC|IXIC)\./, '')]]);
  });
});

describe('refusals', () => {
  it('refuses a markdown whose distribution or follow-through method is not the app\'s', () => {
    const dd = markdown().replaceAll(APP_RULES.DISTRIBUTION_METHOD, 'index-down-other-v9');
    expect(refusals(parseStudyMarkdown(dd)).join(' ')).toMatch(/\^GSPC\.dd\.binary rule .*index-down-other-v9/);
    expect(() => buildReference(parseStudyMarkdown(dd), SOURCE_META)).toThrow(/refused/);
    const ftd = markdown().replaceAll(`${APP_RULES.FOLLOW_THROUGH_METHOD} on the trailing 280 sessions`, `${APP_RULES.FOLLOW_THROUGH_METHOD} on the trailing 250 sessions`);
    expect(() => buildReference(parseStudyMarkdown(ftd), SOURCE_META)).toThrow(/ftd\.state rule/);
  });

  it('refuses another study version, a changed state definition or a missing indicator', () => {
    expect(() => buildReference(parseStudyMarkdown(markdown().replace('market-regime-study-v2 (pre-registered', 'market-regime-study-v3 (pre-registered')), SOURCE_META)).toThrow(/study version/);
    expect(() => buildReference(parseStudyMarkdown(markdown().replaceAll('| 7+ | 21 |', '| 8+ | 21 |')), SOURCE_META)).toThrow(/dd\.graded states differ/);
    expect(() => buildReference(parseStudyMarkdown(markdown().replace('— `^IXIC.high.near`', '— `^IXIC.high.far`')), SOURCE_META)).toThrow(/\^IXIC\.high\.near is missing/);
  });

  it('refuses a results.json whose app rules differ from the app\'s', () => {
    for (const edit of [
      study => { study.method.appRules.ENV_RULES.leaderHealthBelow = 55; return study; },
      study => { study.method.appRules.DISTRIBUTION_WARN = 4; return study; },
      study => { study.method.appRules.SPLIT_RULE.nearHighPercent = 3; return study; },
      study => { study.method.appRules.FOLLOW_THROUGH_METHOD = 'other-v1'; return study; },
    ]) expect(() => buildReference(fromResults(syntheticResults(edit)), { sha256: 'a'.repeat(64) })).toThrow(/refused: .*(appRules|method)/);
  });
});

describe('results.json input', () => {
  it('takes the exact path: unrounded shares, the contrast\'s labels and its own sample', () => {
    const ref = buildReference(fromResults(syntheticResults()), { sha256: 'b'.repeat(64), ciRun: 1 });
    expect(ref.source).toEqual({ kind: 'results-json', sha256: 'b'.repeat(64), ci_run: 1, artifact: null, precision: 'exact', path: null });
    expect(ref.study_as_of).toBe('2026-11-10');
    const near = ref.indicators['^GSPC.high.near'].states;
    expect(near.near.pDd5).toBeCloseTo(100 * (0.1012 + Object.keys(studyDefinitions()).indexOf('^GSPC.high.near') * 0.001), 2);
    expect(near.near.firstHalfShare).toBe(47.12);
    expect(near.below).toMatchObject({ labelDd5: 'robust', labelMean: 'weak', comparatorState: 'near', comparatorPDd5: near.near.pDd5 });
    expect(ref.indicators['^GSPC.ma.quadrant'].states.above_both).toMatchObject({ comparator: 'baseline', comparatorPDd5: 16.34 });
    expect(ref.samples['^IXIC']).toMatchObject({ last: '2026-11-10', sessions: 9283 });
  });
});

describe('--check', () => {
  const base = () => committed();
  it('passes labels that agree and shares within ±1 pt, and names everything else', () => {
    const fresh = base();
    fresh.indicators['^GSPC.ma.quadrant'].states.above_both.pDd5 = 10.9;
    fresh.indicators['^GSPC.ma.quadrant'].states.below_both.comparatorPDd5 = 15.1;
    const within = compareReferences(base(), fresh);
    expect(within.ok).toBe(true);
    expect(within.drift.map(d => [d.state, d.field, d.within])).toEqual([['above_both', 'pDd5', true], ['below_both', 'comparatorPDd5', true]]);
    fresh.indicators['^GSPC.ma.quadrant'].states.above_both.pDd5 = 11.5;
    fresh.indicators['^IXIC.dd.binary'].states.warn.labelDd5 = 'robust';
    fresh.breadth['rule.lows'].labelDd5 = 'weak';
    const outside = compareReferences(base(), fresh);
    expect(outside.ok).toBe(false);
    expect(outside.drift.filter(d => !d.within).map(d => [d.key, d.state, d.field])).toEqual([['^GSPC.ma.quadrant', 'above_both', 'pDd5'], ['^IXIC.dd.binary', 'warn', 'labelDd5'], ['rule.lows', 'warning', 'labelDd5']]);
    expect(compareReferences(base(), base())).toEqual({ ok: true, drift: [] });
  });

  it('runs from the command line against a committed reference and appends the drift to a summary', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'regime-reference-'));
    try {
      const summary = join(dir, 'summary.md');
      writeFileSync(summary, '# before\n');
      await main(['--markdown', SOURCE, '--check', REFERENCE, '--summary', summary]);
      expect(process.exitCode ?? 0).toBe(0);
      expect(readFileSync(summary, 'utf8')).toMatch(/^# before\n### Market-regime reference drift \(diagnostic, never a gate\)[\s\S]*No drift: every label and share matches\.\n$/);
      const out = join(dir, 'reference.json');
      await main(['--markdown', SOURCE, '--ci-run', '41844557380', '--artifact', '13331791935', '--out', out]);
      expect(readFileSync(out, 'utf8')).toBe(readFileSync(REFERENCE, 'utf8'));
      await expect(main(['--markdown', SOURCE, '--results', SOURCE])).rejects.toThrow(/exactly one/);
    } finally { rmSync(dir, { recursive: true, force: true }); process.exitCode = undefined; }
  });
});
