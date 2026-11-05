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
});
