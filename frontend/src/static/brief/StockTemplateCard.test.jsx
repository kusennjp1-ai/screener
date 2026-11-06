import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import TemplateCard from './StockTemplateCard';

afterEach(cleanup);

const template = states => ({ passed: states.filter(s => s === 'pass').length, failed: states.filter(s => s === 'fail').length, unknown: states.filter(s => s === 'unknown').length,
  rules: states.map((state, i) => ({ label: `条件${i + 1}`, state, evidence: '' })) });
const summary = () => screen.getByRole('heading', { level: 2 }).nextSibling.textContent;

describe('the trend-template card', () => {
  it('counts the unmet and the unknown rules, leaving out a part that is 0', () => {
    render(<TemplateCard template={template(['pass', 'unknown', 'pass', 'unknown', 'pass', 'pass', 'pass', 'pass'])} />);
    expect(summary()).toBe('2項目が未確認');
    cleanup();
    render(<TemplateCard template={template(['pass', 'fail', 'pass', 'unknown', 'pass', 'pass', 'pass', 'pass'])} />);
    expect(summary()).toBe('1項目が未達・1項目が未確認');
    cleanup();
    render(<TemplateCard template={template(['pass', 'fail', 'fail', 'pass', 'pass', 'pass', 'pass', 'pass'])} />);
    expect(summary()).toBe('2項目が未達');
    cleanup();
    render(<TemplateCard template={template(Array(8).fill('pass'))} />);
    expect(summary()).toBe('すべての条件を満たしています');
  });

  it('adds the 200-day line\'s 4- and 5-month rise to its rule from valid evidence of the analysis date; anything else reads 未確認', () => {
    const DATE = '2026-10-02';
    const sma200 = { label: 'SMA200が21営業日前より上（1か月の上向き判定）', state: 'pass', evidence: '120.00 > 118.00' };
    const rules = [sma200, ...Array.from({ length: 7 }, (_, i) => ({ label: `条件${i + 2}`, state: 'pass', evidence: '' }))];
    const t = { passed: 8, failed: 0, unknown: 0, rules };
    const line = (technical, date = DATE) => { render(<TemplateCard template={t} technical={technical} date={date} wide />); const text = screen.queryByTestId('brief-tt-sma200')?.textContent ?? null; cleanup(); return text; };
    const span = (state, downSteps = 3) => state && { sessions: 84, state, upSteps: 80, downSteps: state === 'mixed' ? downSteps : 0 };
    const evidence = (four, five, extra = {}) => ({ valid: true, as_of_date: DATE, sma200: { oneMonth: { state: 'sustained-up' }, preferredFourMonths: span(four), preferredFiveMonths: span(five) }, ...extra });
    expect(line(evidence('sustained-up', 'unknown'))).toBe('上向き：1か月 ✓・4か月 ✓・5か月 未確認');
    expect(line(evidence('mixed', 'sustained-down'))).toBe('上向き：1か月 ✓・4か月 一部下落・5か月 ✕');
    // A window that only paused (flat sessions, no fall) never claims a fall.
    const flat = evidence('sustained-up', 'sustained-up');
    flat.sma200.preferredFiveMonths = { sessions: 105, state: 'mixed', upSteps: 100, downSteps: 0, flatSteps: 5 };
    expect(line(flat)).toBe('上向き：1か月 ✓・4か月 ✓・5か月 一部横ばい');
    expect(line(evidence(null, null))).toBe('上向き：1か月 ✓・4か月 未確認・5か月 未確認');
    expect(line(null)).toBe('上向き：1か月 ✓・4か月 未確認・5か月 未確認');
    // Evidence that is not valid, of another day, or without the analysis date is never read.
    expect(line(evidence('sustained-up', 'sustained-up', { valid: false }))).toBe('上向き：1か月 ✓・4か月 未確認・5か月 未確認');
    expect(line(evidence('sustained-up', 'sustained-up', { as_of_date: '2026-10-01' }))).toBe('上向き：1か月 ✓・4か月 未確認・5か月 未確認');
    expect(line(evidence('sustained-up', 'sustained-up'), null)).toBe('上向き：1か月 ✓・4か月 未確認・5か月 未確認');
    // The month is the rule's own state.
    rules[0] = { ...sma200, state: 'unknown' };
    expect(line(evidence('sustained-up', 'sustained-up'))).toBe('上向き：1か月 未確認・4か月 ✓・5か月 ✓');
    rules[0] = { ...sma200, state: 'fail' };
    expect(line(evidence('sustained-up', 'sustained-up'))).toBe('上向き：1か月 ✕・4か月 ✓・5か月 ✓');
    // Without the evidence handed in, nothing is claimed; only the SMA200 rule carries the line.
    render(<TemplateCard template={t} wide />);
    expect(screen.queryByTestId('brief-tt-sma200')).toBeNull();
    cleanup();
    render(<TemplateCard template={t} technical={evidence('sustained-up', 'sustained-up')} date={DATE} wide />);
    expect(screen.getAllByTestId('brief-tt-sma200')).toHaveLength(1);
    expect(screen.getByTestId('brief-tt-sma200').closest('li')).toHaveTextContent('SMA200が21営業日前より上');
  });
});
