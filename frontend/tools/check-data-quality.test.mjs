// @vitest-environment node
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import { encodeAssessment } from '../src/static/assessmentEncoding.js';
import { assess, assessmentSummary, rankCandidates, RULE_SUMMARY_VERSION } from '../src/static/researchEngine.js';
import { encodeResearchIndex, decodeResearchIndex, RESEARCH_METHODS } from '../src/static/researchTransport.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';
import { withAuditFixture } from '../src/static/testAuditFixture.js';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../src/static/testFinancialFixture.js';
import { researchEvaluation, validatePublishedSummaries, validateResearchListSummaries, validateResearchParity } from './research-quality.mjs';

const metadata = { financial_evaluated_at: now, financial_semantics: 'current_at_evaluation_not_historical_publication', assessment_version: RULE_SUMMARY_VERSION };
const sample = (extra = {}) => withFinancialProof(withAuditFixture({ symbol: 'TEST', market: 'US', currency: 'USD', current_price: 100,
  adv_usd: 30e6, rs_rating: 90, eps_growth_yy: 30, sales_growth_yy: 30, ...extra }, date), now, date);
const stamped = row => ({ ...row, method_summary: { version: RULE_SUMMARY_VERSION, evaluated_at: now,
  ...Object.fromEntries(RESEARCH_METHODS.map(method => [method, assessmentSummary(row, method, now)])) } });
const pack = rows => encodeResearchIndex({ as_of_date: date, ...metadata, rows: rows.map(row => ({ ...row,
  method_summary: { ...row.method_summary, ...Object.fromEntries(RESEARCH_METHODS.map(method => [method, encodeAssessment(row.method_summary[method])])) } })) });

describe('publication summaries and current canonical decisions', () => {
  it('selects the smaller compressed lossless column form without changing decoded inputs', () => {
    const rows = Array.from({ length: 1000 }, (_, i) => ({ symbol: `T${i}`, value: i < 200 ? i / 100 + 1e-12 : null }));
    const index = { as_of_date: date, rows };
    const rawChoice = encodeResearchIndex(index);
    const compact = encodeResearchIndex(index, undefined, { columnBytes: column => gzipSync(JSON.stringify(column)).length });
    expect(decodeResearchIndex(compact)).toEqual(decodeResearchIndex(rawChoice));
    expect(gzipSync(JSON.stringify(compact)).length).toBeLessThan(gzipSync(JSON.stringify(rawChoice)).length);
  });
  it('omits only explicitly signaled list summaries and independently checks canonical decisions', () => {
    const details = [stamped(sample({ symbol: 'A' })), stamped(sample({ symbol: 'B', eps_growth_yy: -10 }))];
    const rows = details.map(({ method_summary, ...row }) => { void method_summary; return row; });
    const wire = encodeResearchIndex({ ...metadata, as_of_date: date, summary_storage: 'canonical-detail-v1', rows });
    const index = decodeResearchIndex(wire);
    expect(() => validateResearchListSummaries(wire, index.rows, now)).not.toThrow();
    expect(() => validatePublishedSummaries(details, now)).not.toThrow();
    expect(() => validateResearchParity(wire, details, now)).not.toThrow();
    const expired = details[0].financial_current.p['1'][5] + 1;
    expect(() => validateResearchParity(wire, details, expired)).not.toThrow();
    expect(() => validateResearchListSummaries({ ...wire, summary_storage: undefined }, index.rows, now)).toThrow('summary evaluation mismatch');
    expect(() => validateResearchListSummaries({ ...wire, schema: 'research-table-v1' }, index.rows, now)).toThrow('summary storage');
    expect(() => validateResearchListSummaries({ ...wire, summary_storage: 'ignore-everything' }, index.rows, now)).toThrow('summary storage');
    expect(() => validateResearchListSummaries(wire, details, now)).toThrow('summary storage');
    const corrupted = structuredClone(details);
    corrupted[0].method_summary.minervini.passed = 0;
    expect(() => validatePublishedSummaries(corrupted, now)).toThrow('Rule summary mismatch');
    corrupted[0].technical_audit.values.sma50 = 200;
    expect(() => validateResearchParity(wire, corrupted, now)).toThrow('Canonical detail rule mismatch');
  });
  it('runs the complete export and quality gate against one coherent static bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'quality-export-replay-'));
    try {
      const frontend = join(root, 'frontend'), data = join(frontend, 'public/static-data');
      await mkdir(data, { recursive: true }); await mkdir(join(root, 'data/ibd_reference/ibd50'), { recursive: true });
      const write = (name, value) => writeFile(join(data, name), JSON.stringify(value));
      const days = [];
      for (let day = Date.parse(date); days.length < 280; day -= 86400000) if (![0, 6].includes(new Date(day).getUTCDay())) days.unshift(new Date(day).toISOString().slice(0, 10));
      const bars = days.map((date, index) => { const close = 50 + index * .25; return { date, open: close, close, low: close - 1, high: close + 1, volume: 1e6 }; });
      const row = sample({ current_price: bars.at(-1).close, se_pivot_price: null, vcp_pivot: null, se_setup_ready: false });
      await write('manifest.json', { generated_at: '2026-10-02T20:00:00Z', markets: { US: { market: 'US', as_of_date: date, pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts-index.json' } } } } });
      await write('scan.json', { as_of_date: date, initial_rows: [row], chunks: [{ path: 'chunk.json' }] });
      await write('chunk.json', { as_of_date: date, rows: [row] });
      await write('charts-index.json', { symbols: [{ symbol: row.symbol, path: 'chart.json' }] });
      await write('chart.json', { symbol: row.symbol, as_of_date: date, bars });
      await write('book-benchmark.json', { symbol: 'SPY', as_of_date: date, bars });
      await write('sector-prices.json', { as_of_date: date, series: {} });
      const run = tool => execFileSync(process.execPath, [fileURLToPath(new URL(tool, import.meta.url))], { cwd: frontend,
        env: { ...process.env, FINANCIAL_EVALUATED_AT: new Date(now).toISOString() }, encoding: 'utf8', stdio: 'pipe' });
      run('./export-research.mjs');
      const output = run('./check-data-quality.mjs');
      expect(output).toContain('Quality gate passed: 1/1 verified');
      expect(output).toContain('Research transport gate passed');
      expect(output).toContain('Workbench gate passed: 1 saved observations');
      const manifest = JSON.parse(await readFile(join(data, 'manifest.json'), 'utf8'));
      expect(manifest.markets.US.assets.research.financial_evaluated_at).toBe(now);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('retains the explicit evaluation epoch through packed transport and rejects mixed or absent metadata', () => {
    const index = decodeResearchIndex(pack([stamped(sample())]));
    expect(researchEvaluation(index, metadata)).toBe(now);
    expect(() => researchEvaluation({ ...index, financial_evaluated_at: undefined }, metadata)).toThrow('evaluation metadata');
    expect(() => researchEvaluation(index, { ...metadata, financial_evaluated_at: now + 1 })).toThrow('metadata mismatch');
    expect(() => validatePublishedSummaries(index.rows, now + 1)).toThrow('summary evaluation mismatch');
    expect(() => validatePublishedSummaries(index.rows, now)).not.toThrow();
  });

  it('rejects structurally valid but corrupted encoded counts even though runtime decisions ignore them', async () => {
    const row = stamped(sample()), wire = pack([row]);
    const field = wire.fields.findIndex(path => path.join('.') === 'method_summary.minervini');
    wire.columns[field] = { values: [[0, 0, 9, 9, 0]] };
    const index = decodeResearchIndex(wire);
    expect(assessmentSummary(index.rows[0], 'minervini', now).qualified).toBe(true);
    expect(() => validatePublishedSummaries(index.rows, now)).toThrow('Rule summary mismatch: TEST/minervini');
    // Exercise the actual CI entry point, not just its validation helper.
    const root = await mkdtemp(join(tmpdir(), 'quality-summary-corruption-'));
    try {
      const data = join(root, 'public/static-data'); await mkdir(data, { recursive: true });
      await writeFile(join(data, 'manifest.json'), JSON.stringify({ assets: { research: { path: 'research.json', ...metadata } } }));
      await writeFile(join(data, 'research.json'), JSON.stringify(wire));
      await writeFile(join(data, 'data-quality.json'), JSON.stringify({ total: 1, verified: 1, as_of_date: date }));
      let error;
      try { execFileSync(process.execPath, [fileURLToPath(new URL('./check-data-quality.mjs', import.meta.url))], { cwd: root, stdio: 'pipe' }); } catch (caught) { error = caught; }
      expect(error?.status).toBe(1);
      expect(error?.stderr.toString()).toContain('Rule summary mismatch: TEST/minervini');
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('replays a declared publication instant after the real source expires while current rules and rankings change', () => {
    const rows = [stamped(sample({ symbol: 'A', rs_rating: 90 })), stamped(sample({ symbol: 'B', rs_rating: 95, eps_growth_yy: -10, sales_growth_yy: -10 }))];
    const wire = pack(rows), index = decodeResearchIndex(wire);
    const expiry = rows[0].financial_current.p['1'][5];
    expect(assess(index.rows[0], 'oneil', expiry).rules[0].state).toBe('pass');
    expect(assess(index.rows[0], 'oneil', expiry + 1).rules[0].state).toBe('unknown');
    expect(rankCandidates(index.rows, 'oneil', { now }).map(item => item.row.symbol)).toEqual(['A', 'B']);
    expect(rankCandidates(index.rows, 'oneil', { now: expiry + 1 }).map(item => item.row.symbol)).toEqual(['B', 'A']);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(expiry + 1);
    try {
      expect(() => validatePublishedSummaries(index.rows, now)).not.toThrow();
      expect(() => validateResearchParity(wire, rows, now)).not.toThrow();
      expect(() => validateResearchParity(wire, rows, expiry + 1)).not.toThrow();
      expect(clock).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
    // Old pass summaries and cached permutations never become decision authority.
    wire.orders = Object.fromEntries(RESEARCH_METHODS.map(method => [method, [0, 1]]));
    expect(prepareResearchBundle([wire], date, { now: expiry + 1 }).rankings.oneil.map(item => item.row.symbol)).toEqual(['B', 'A']);
  });

  it('uses one explicit clock for CSV, detail, ranking and portfolio comparisons even as Date.now advances', () => {
    const rows = [stamped(sample())], wire = pack(rows);
    let ticking = now;
    const clock = vi.spyOn(Date, 'now').mockImplementation(() => ticking++);
    try {
      expect(() => validateResearchParity(wire, rows, now)).not.toThrow();
      expect(clock).not.toHaveBeenCalled();
    } finally { clock.mockRestore(); }
    const corrupted = structuredClone(rows); corrupted[0].technical_audit.values.sma50 = 200;
    expect(() => validateResearchParity(wire, corrupted, now)).toThrow('Canonical detail rule mismatch');
  });

  it('keeps public static financial fields unknown when only legacy raw numbers and cached passes are available', () => {
    const row = sample({ eps_rating: 99, composite_rating: 99 }); delete row.financial_current;
    row.method_summary = { version: RULE_SUMMARY_VERSION, oneil: [8, 0, 0, 8, 0], ibd: [10, 0, 0, 10, 0] };
    expect(assess(row, 'oneil', now).rules.slice(0, 3).map(rule => rule.state)).toEqual(['unknown', 'unknown', 'unknown']);
    expect(assessmentSummary(row, 'ibd', now).qualified).toBe(false);
    const rows = [stamped(row)], wire = pack(rows);
    expect(() => validatePublishedSummaries(decodeResearchIndex(wire).rows, now)).not.toThrow();
    expect(() => validateResearchParity(wire, rows, now)).not.toThrow();
    expect(prepareResearchBundle([wire], date, { now }).prepared.candidates).toEqual([]);
  });
});
