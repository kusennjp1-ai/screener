// @vitest-environment node
// Synthetic fixtures prove logic only; they are never publication evidence.
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildLimitedResearchAssessment, measuredPerformanceFailures, LIMITED_RESEARCH_SCOPE } from './limited-research-assessment.mjs';
import { FINANCIAL_DESIGN_CASES, limitedFinancialCaseSource, financialCaseSource, financialCaseCanonicalCsv, parseFinancialCsv } from './financial-design-cases.mjs';
import { researchCsv } from '../src/static/researchEngine.js';
import { previewBuildMetadata, LIMITED_RESEARCH_PREVIEW_NOTICE } from '../src/static/limitedResearchPreview.js';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';

const now = Date.parse('2026-10-04T15:00:00Z'), date = '2026-10-02';
const row = () => withFinancialProof({ symbol: 'NVDA', market: 'US', as_of_date: date, technical_audit: { as_of_date: date }, eps_growth_yy: 30, sales_growth_yy: 30,
  financial_history: { symbol: 'NVDA', as_of_date: date, status: 'available', basis: 'reported_diluted_eps', currency: 'USD', source: 'Synthetic logic fixture only', retrieved_at: '2026-10-04T11:00:00.000Z', annual: [1, 2, 4, 8].map((eps, index) => ({ end: `${2022 + index}-12-31`, eps })), quarterly: [] },
}, now, date);
const performance = () => ({ label: 'current', viewport: { width: 1440 }, runs: Array.from({ length: 3 }, () => ({ candidate_ms: 5000, method_switch_ms: 600, longest_initial_task_ms: 300 })), candidate_median_ms: 5000, maximum_switch_ms: 600, longest_initial_task_ms: 300 });
const report = () => ({ assessment_mode: LIMITED_RESEARCH_SCOPE, commit: 'a'.repeat(40), measured_at: new Date(now).toISOString(), data: { as_of_date: date, research_generation: 'synthetic-only' }, failures: [], performance: [performance()], financial_cases: [] });

describe('disabled explicit limited research assessment', () => {
  it('records actual current states and original demonstration without modifying sources', () => {
    const source = row(), before = JSON.stringify(source);
    const actual = limitedFinancialCaseSource(source, FINANCIAL_DESIGN_CASES[0], date, now);
    expect(actual.original_category).toEqual({ category: 'ordinary-usd', status: 'demonstrated', reason: null });
    expect(actual.annual_observed_at).toBe(source.financial_history.retrieved_at);
    expect(JSON.stringify(source)).toBe(before);
  });
  it('keeps expired evidence unavailable and mandatory unknown rules nonqualifying', () => {
    const source = row(), clock = now + 8 * 86400000;
    const actual = limitedFinancialCaseSource(source, FINANCIAL_DESIGN_CASES[0], date, clock);
    expect(actual.original_category.status).toBe('unavailable');
    expect(actual.original_category.reason).toContain('unavailable or expired');
    expect(actual.annual).toEqual([]);
    expect(actual.unknown).toBeGreaterThan(0);
    expect(actual.qualified).toBe(false);
    expect(actual.annual_observed_at).toBe('2026-10-04T11:00:00.000Z');
    expect(actual.source_history).toEqual(source.financial_history);
    expect(() => financialCaseSource(source, FINANCIAL_DESIGN_CASES[0], date, clock)).toThrow();
  });
  it('never exchanges fixed cases or waives identity, category, or invalid clock failures', () => {
    expect(() => limitedFinancialCaseSource(row(), FINANCIAL_DESIGN_CASES[1], date, now)).toThrow('identity/date');
    expect(() => limitedFinancialCaseSource(row(), { symbol: 'NVDA', category: 'invented' }, date, now)).toThrow('Unknown fixed');
    expect(() => limitedFinancialCaseSource(row(), FINANCIAL_DESIGN_CASES[0], date, NaN)).toThrow('clock');
    const wrongHistory = row(); wrongHistory.financial_history.symbol = 'OTHER';
    expect(() => limitedFinancialCaseSource(wrongHistory, FINANCIAL_DESIGN_CASES[0], date, now)).toThrow('history identity/date');
    const wrongMetadata = row(); wrongMetadata.financial_history.currency = 'HKD';
    expect(() => limitedFinancialCaseSource(wrongMetadata, FINANCIAL_DESIGN_CASES[0], date, now)).toThrow('metadata is inconsistent');
    expect(FINANCIAL_DESIGN_CASES.map(item => item.symbol)).toEqual(['NVDA', 'FUTU', 'AAOI', 'ALH', 'AVT']);
  });
  it('requires explicit mode and explicit exact failure enumeration', () => {
    const source = report(); source.failures = [...measuredPerformanceFailures(source)];
    expect(buildLimitedResearchAssessment(source).accepted_performance_limitations).toEqual([]);
    const output = buildLimitedResearchAssessment(source, [source.failures[0]]);
    expect(output.accepted_performance_limitations).toEqual([source.failures[0]]);
    expect(output.original_design_failures).toEqual(source.failures);
    expect(output.blocking_failures).toContain(source.failures[1]);
    expect(output.publication_authority).toBe('none');
    expect(output.performance_measurements).toEqual(source.performance);
    expect(output.radar_measurements).toEqual([]);
    delete source.assessment_mode;
    expect(() => buildLimitedResearchAssessment(source)).toThrow('Explicit');
  });
  it('rejects arbitrary matching-looking failures, incomplete measurements and forged summaries', () => {
    const source = report(), failure = '1440: Q1 candidate median 5000ms > 4200ms';
    source.failures = [failure, 'home/1440/dark: axe 1 rule violations', '1440: performance requires all 3 runs', 'NVDA: source identity mismatch'];
    source.performance[0].runs.pop();
    expect(buildLimitedResearchAssessment(source, source.failures).accepted_performance_limitations).toEqual([]);
    source.performance = [performance()]; source.performance[0].candidate_median_ms = 6000;
    expect(measuredPerformanceFailures(source).size).toBe(0);
    source.performance = [performance()];
    expect(buildLimitedResearchAssessment(source, source.failures).accepted_performance_limitations).toEqual([failure]);
  });
  it('records radar timing only and never waives pixel or visibility failures', () => {
    const source = report(); source.radar = [{ viewport: { width: 390 }, runs: [60, 70, 80].map(first_frame_ms => ({ first_frame_ms })) }];
    source.failures = ['390: D9 first paint opportunity 80.0ms > 50ms', '390: D9 run 1: first frame 60ms (limit 50ms)', '390: D9 run 1: CSS/DPR pixel alignment is unfinished at the first-frame boundary'];
    expect(buildLimitedResearchAssessment(source, source.failures).accepted_performance_limitations).toEqual(source.failures.slice(0, 2));
    expect(buildLimitedResearchAssessment(source, source.failures).blocking_failures).toContain(source.failures[2]);
  });
  it('requires all ten real observations and does not infer evidence from category status', () => {
    const source = report();
    source.financial_cases = FINANCIAL_DESIGN_CASES.flatMap(item => [[1440, 'dark'], [390, 'light']].map(([width, theme]) => ({ ...item, viewport: { width }, theme, source: { original_category: { category: item.category, status: 'unavailable', reason: 'synthetic' } } })));
    expect(buildLimitedResearchAssessment(source).blocking_failures.filter(value => value.includes('incomplete or inconsistent'))).toHaveLength(10);
  });
  it('binds the complete screenshot inventory and rejects missing, duplicate or unhashed captures', () => {
    const source = report();
    expect(buildLimitedResearchAssessment(source).blocking_failures).toContain('Required financial screenshot missing: financial-NVDA-evidence/1440/dark');
    source.screens = [{ key: 'home/1440/dark', sha256: 'b'.repeat(64), metrics: { synthetic: true } }];
    expect(buildLimitedResearchAssessment(source).screens).toEqual([{ key: 'home/1440/dark', sha256: 'b'.repeat(64) }]);
    source.screens.push(source.screens[0]);
    expect(buildLimitedResearchAssessment(source).blocking_failures.some(value => value.includes('nonempty unique screenshot'))).toBe(true);
    source.screens = [{ key: 'home/1440/dark' }];
    expect(buildLimitedResearchAssessment(source).blocking_failures.some(value => value.includes('nonempty unique screenshot'))).toBe(true);
  });
  it('matches real preview CSV metadata from plain Node canonical without changing full mode', () => {
    const source = row();
    const plain = financialCaseCanonicalCsv(source, date, now);
    expect(plain.headers).not.toContain('release_scope');
    const canonical = financialCaseCanonicalCsv(source, date, now, true);
    vi.stubGlobal('__LIMITED_RESEARCH_PREVIEW__', previewBuildMetadata('v1'));
    try {
      const browser = parseFinancialCsv(researchCsv([{ row: source }], 'oneil', date, now));
      expect(canonical).toEqual(browser);
      expect(browser.rows[0].release_scope_notice).toBe(LIMITED_RESEARCH_PREVIEW_NOTICE);
      expect(browser.rows[0].release_scope_version).toBe(LIMITED_RESEARCH_SCOPE);
    } finally { vi.unstubAllGlobals(); }
    expect(financialCaseCanonicalCsv(source, date, now)).toEqual(plain);
  });
  it('preserves ordinary Design failure exit and separate output defaults', () => {
    const script = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
    expect(script).toContain("process.argv.includes('--limited-research-preview')");
    expect(script).toContain("limitedAssessment ? 'test-results/limited-research-preview' : 'test-results/design-review'");
    expect(script).toContain('if (report.failures.length) process.exitCode = 1;');
    const checker = readFileSync(new URL('./check-design-review.mjs', import.meta.url), 'utf8');
    expect(checker).toContain("if (actual.failures.length) throw Error");
  });
});
