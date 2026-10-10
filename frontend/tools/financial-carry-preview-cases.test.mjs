// @vitest-environment node
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CARRY_PREVIEW_BASIS, CARRY_PREVIEW_LABEL, readCarryPreviewContext, financialCarryPreviewScreens, carryPreviewEvidence } from './financial-carry-preview-cases.mjs';
import { FINANCIAL_DESIGN_CASES, financialCaseSource, financialDesignScreens } from './financial-design-cases.mjs';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../src/test/fixtures/nativeAnnual.js';

// Synthetic unit contracts only; no fixtures enter the browser harness.
const now = Date.parse('2026-10-04T15:00:00Z'), date = '2026-10-02';
const context = time => ({ symbol: 'NVDA', date, generation: 'test-generation', now: time });
const source = () => withFinancialProof({ symbol: 'NVDA', market: 'US', as_of_date: date,
  technical_audit: { as_of_date: date }, eps_growth_yy: 30, sales_growth_yy: 30,
  financial_history: { symbol: 'NVDA', as_of_date: date, status: 'available', basis: 'reported_diluted_eps', currency: 'USD',
    source: 'Synthetic test provider', retrieved_at: '2026-10-04T11:00:00.000Z',
    annual: [1, 2, 4, 8].map((eps, index) => ({ end: `${2022 + index}-12-31`, eps })), quarterly: [] },
}, now, date);
const row = (observed, id) => observed.presentation.rows.find(value => value.id === id);
const temporary = [];
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }); });

describe('explicit verified carry measurement context', () => {
  it('leaves ordinary and repaired-financial modes without supplementary captures', async () => {
    for (const inputBasis of ['same_verified_input', 'same_prices_repaired_financials']) {
      expect(await readCarryPreviewContext({ inputBasis })).toBeNull();
      expect(financialCarryPreviewScreens({ width: 1440 }, 'dark', null)).toEqual([]);
      await expect(readCarryPreviewContext({ inputBasis, receiptPath: '/tmp/untrusted-receipt.json' })).rejects.toThrow('explicit carried-financial comparison basis');
    }
  });
  it('requires a receipt and both candidate/baseline roots for explicit preview', async () => {
    const valid = { inputBasis: CARRY_PREVIEW_BASIS, receiptPath: '/tmp/receipt.json', currentRoot: '/tmp/current', baselineRoot: '/tmp/baseline' };
    for (const key of ['receiptPath', 'currentRoot', 'baselineRoot']) {
      await expect(readCarryPreviewContext({ ...valid, [key]: undefined })).rejects.toThrow('verified receipt and both absolute build roots');
      await expect(readCarryPreviewContext({ ...valid, [key]: 'relative' })).rejects.toThrow('verified receipt and both absolute build roots');
    }
  });
  it('rejects missing and linked receipt files before granting a context', async () => {
    const root = mkdtempSync(join(tmpdir(), 'carry-measurement-')); temporary.push(root);
    const args = { inputBasis: CARRY_PREVIEW_BASIS, currentRoot: join(root, 'current'), baselineRoot: join(root, 'baseline') };
    await expect(readCarryPreviewContext({ ...args, receiptPath: join(root, 'missing.json') })).rejects.toThrow();
    writeFileSync(join(root, 'receipt.json'), '{}'); symlinkSync(join(root, 'receipt.json'), join(root, 'linked.json'));
    await expect(readCarryPreviewContext({ ...args, receiptPath: join(root, 'linked.json') })).rejects.toThrow('invalid receipt file');
  });
  it('uses the real controller to reject forged receipt authority before browser work', async () => {
    const root = mkdtempSync(join(tmpdir(), 'carry-measurement-')); temporary.push(root);
    const receiptPath = join(root, 'receipt.json');
    writeFileSync(receiptPath, JSON.stringify({ schema: 'design-financial-carry-preview-v1', publication_authority: 'release', release_accepted: true, comparison_basis: CARRY_PREVIEW_BASIS }));
    await expect(readCarryPreviewContext({ inputBasis: CARRY_PREVIEW_BASIS, receiptPath, currentRoot: join(root, 'current'), baselineRoot: join(root, 'baseline') })).rejects.toThrow('cannot grant release authority');
  });
  it('does not treat serialized schema, false release acceptance, or a hash as verification', () => {
    const forged = { receipt: { schema: 'design-financial-carry-preview-v1', publication_authority: 'none', release_accepted: false, comparison_basis: CARRY_PREVIEW_BASIS }, receipt_sha256: 'a'.repeat(64) };
    expect(() => financialCarryPreviewScreens({ width: 1440 }, 'dark', forged)).toThrow('unverified receipt context');
    expect(() => financialCarryPreviewScreens({ width: 800 }, 'dark', forged)).toThrow('unverified receipt context');
    expect(CARRY_PREVIEW_LABEL).toBe('same prices / different carried financial input');
  });
});

describe('carried financial observations use unchanged current/history semantics', () => {
  it('reports current values without restamping the source clock or changing its input', () => {
    const input = source(), before = structuredClone(input);
    const observed = carryPreviewEvidence(input, context(now));
    expect(observed.source).toMatchObject({ financial_source_evaluated_at: '2026-10-04T15:00:00.000Z', annual_observed_at: '2026-10-04T11:00:00.000Z', annual_current: true });
    expect(row(observed, 'eps_growth_yy')).toMatchObject({ state: 'pass', actual: '30%' });
    expect(row(observed, 'annual_eps_growth_3y')).toMatchObject({ state: 'pass' });
    expect(input).toEqual(before);
  });
  it('captures expired history as unknown while the original strict case still rejects it', () => {
    const input = source(), later = now + 4 * 86400000;
    const observed = carryPreviewEvidence(input, context(later));
    expect(row(observed, 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'invalid_history' });
    expect(row(observed, 'annual_eps_growth_3y').explanation).toBeTruthy();
    expect(row(observed, 'eps_growth_yy')).toMatchObject({ state: 'pass' });
    expect(observed.source).toMatchObject({ annual_current: false, annual_growth: null, annual_comparisons: [], required_unknown: 1, annual_observed_at: '2026-10-04T11:00:00.000Z' });
    expect(() => financialCaseSource(input, FINANCIAL_DESIGN_CASES[0], date, later)).toThrow('unavailable or expired');
  });
  it('does not turn expired scalar financial proofs into current data or a pass', () => {
    const observed = carryPreviewEvidence(source(), context(now + 8 * 86400000));
    expect(observed.source.quarterly_eps).toMatchObject({ availability: 'unknown', value: null, reason: 'stale_source' });
    expect(row(observed, 'eps_growth_yy')).toMatchObject({ state: 'unknown', actual: '未確認', reason: 'stale_source' });
    expect(observed.source.required_unknown).toBe(3);
    expect(observed.source.financial_source_evaluated_at).toBe('2026-10-04T15:00:00.000Z');
  });
  it('keeps missing evidence and tampered values unknown without manufacturing a source', () => {
    const missing = source(); delete missing.financial_current; delete missing.financial_history;
    const unavailable = carryPreviewEvidence(missing, context(now));
    expect(unavailable.source.financial_source_evaluated_at).toBeNull();
    expect(unavailable.source.annual_observed_at).toBeNull();
    expect(unavailable.source.required_unknown).toBe(3);
    expect(row(unavailable, 'eps_growth_yy')).toMatchObject({ state: 'unknown', reason: 'missing_evidence' });
    const tampered = source(); tampered.eps_growth_yy = 500;
    expect(row(carryPreviewEvidence(tampered, context(now)), 'eps_growth_yy')).toMatchObject({ state: 'unknown', reason: 'value_mismatch', actual: '未確認' });
  });
  it('preserves native annual receipt clocks and does not relabel expired HKD history as USD', () => {
    const input = source(); input.financial_history = nativeAnnualFixture('HKD');
    input.financial_history.symbol = input.financial_history.annual_source.symbol = 'NVDA';
    const observed = carryPreviewEvidence(input, context(now + 4 * 86400000));
    expect(observed.source.annual_source).toEqual(input.financial_history.annual_source);
    expect(observed.source.annual_observed_at).toBe(input.financial_history.annual_source.observed_at);
    expect(row(observed, 'annual_eps_growth_3y')).toMatchObject({ state: 'unknown', reason: 'invalid_history' });
    expect(row(observed, 'annual_eps_growth_3y').basis).toContain('HKD');
  });
  it('rejects wrong identity, date, missing row, invalid clock, and missing generation', () => {
    for (const input of [null, { ...source(), symbol: 'OTHER' }, { ...source(), as_of_date: '2026-10-03' }]) {
      expect(() => carryPreviewEvidence(input, context(now))).toThrow('source identity/date mismatch');
    }
    for (const invalid of [{ now: NaN }, { now: Date.parse('2026-10-01') }, { generation: '' }]) {
      expect(() => carryPreviewEvidence(source(), { ...context(now), ...invalid })).toThrow('invalid observation context');
    }
  });
});

describe('supplementary capture cannot weaken ordinary Design accounting', () => {
  const harness = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
  const cases = readFileSync(new URL('./financial-carry-preview-cases.mjs', import.meta.url), 'utf8');
  const checker = readFileSync(new URL('./check-design-review.mjs', import.meta.url), 'utf8');
  it('verifies the controller receipt before browser launch and records its exact digest', () => {
    expect(harness.indexOf('await readCarryPreviewContext(')).toBeLessThan(harness.indexOf('await chromium.launch()'));
    expect(cases).toContain('await verifyDesignCarryPreview({ receiptPath, currentRoot, baselineRoot })');
    expect(cases).toContain('digest(before) === digest(after)');
    expect(cases).toContain('isDeepStrictEqual(receipt, JSON.parse(after))');
    expect(harness).toContain('receipt_sha256: carryPreview.receipt_sha256');
    expect(harness.match(/await readCarryPreviewContext\(/g)).toHaveLength(2);
    expect(harness).toContain('rechecked.receipt_sha256 === carryPreview.receipt_sha256');
    expect(harness).toContain('check(false, `Design carry preview final integrity verification failed: ${error.message}`)');
    expect(cases).toContain('manifest.financial_generation === receipt.financial.generation');
  });
  it('captures real supplementary views before all unchanged strict current-source cases', () => {
    const supplement = 'await verifyFinancialCarryPreviewCases({ page, viewport, theme, capture, check, report, currentUrl: current.url, context: carryPreview });';
    const strict = 'await verifyFinancialCases({ page, viewport, theme, capture, check, report, currentUrl: current.url });';
    expect(harness).toContain(`${supplement}\n  ${strict}`);
    expect(harness).toContain('...financialCarryPreviewScreens(viewport, theme, carryPreview), ...financialDesignScreens(viewport, theme)');
    expect(cases).toContain('for (const { symbol } of FINANCIAL_DESIGN_CASES)');
    expect(cases).toContain('await capture(page, viewport, theme, screen, { scope: \'scrolled-viewport\', viewportTargets });');
    expect(cases).toContain('await page.evaluate(() => Date.now())');
    expect(cases).not.toContain('addInitScript');
    expect(cases).not.toContain('clock.install');
    expect(cases).not.toContain('page.route');
    expect(cases).not.toContain('catch { return');
    expect([1440, 390].flatMap(width => ['dark', 'light'].flatMap(theme => financialDesignScreens({ width }, theme)))).toHaveLength(28);
  });
  it('retains threshold, review, required capture, and failure gates', () => {
    for (const original of ['metrics.candidate_median_ms <= 4200', 'metrics.maximum_switch_ms <= 480', 'metrics.candidate_median_ms <= 3500', 'metrics.maximum_switch_ms <= 400', 'metrics.longest_initial_task_ms <= 200', 'check(metrics.p1_pass,', 'if (report.failures.length) process.exitCode = 1;', 'required capture was not completed', 'report.screens.push({ key, screenshot,']) expect(harness).toContain(original);
    expect(checker).toContain('actual.screens.some(screen => !reviewedKeys.has(screen.key))');
    expect(cases).toContain('check(false, `${key}: supplementary verification interrupted: ${error.message}`)');
    expect(harness).toContain("release_accepted: false, publication_authority: 'none'");
    expect(harness).toContain('ui_only_same_data: false');
  });
});
