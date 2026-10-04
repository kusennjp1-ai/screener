import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import FinancialEvidencePanel from './FinancialEvidencePanel';
import { FINANCIAL_PRESENTATION_SCHEMA } from '../financialEvidencePresentation';

afterEach(cleanup);
const props = { symbol: 'TEST', date: '2026-10-02', generation: 'fixture', method: 'oneil', now: Date.parse('2026-10-03T12:00:00Z') };
const observation = { value: 30, unit: 'percent_points', availability: 'current', source: 'Test provider', basis: 'selected-quarter-yoy',
  period_end: '2026-06-30', comparable_period_end: '2025-06-30', observed_at: '2026-10-03T11:00:00Z', valid_until: '2026-10-10T11:00:00Z',
  condition: { label: 'C：四半期 EPS 前年同期比 ≥ 25%', state: 'pass', value: 30 } };
const evidence = { schema: FINANCIAL_PRESENTATION_SCHEMA, symbol: 'TEST', as_of_date: props.date, generation: 'fixture', method: 'oneil',
  evaluated_at: '2026-10-03T12:00:00Z', valid_until: '2026-10-10T11:00:00Z', metrics: { eps_growth_yy: observation },
  historical: [{ ...observation, id: 'eps_growth_yy', value: 282.48, observed_at: '2026-06-13T12:00:00Z', reason: 'stale_source' }] };

it('shows actual, threshold, period, source, acquisition time and result without opening disclosures', () => {
  render(<FinancialEvidencePanel {...props} evidence={evidence}/>);
  const row = screen.getByRole('heading', { name: '四半期 EPS 前年同期比', exact: true }).closest('li');
  expect(row.closest('details')).toBeNull();
  for (const content of ['30%', '≥ 25%', '2026-06-30', '2025-06-30', 'Test provider', '2026-10-03T11:00:00Z', '✓ 通過', '必須']) expect(row).toHaveTextContent(content);
  expect(within(row).getByText('✓ 通過')).toHaveClass('financial-evidence-status-pass');
  const old = screen.getByText(/282.48%/).closest('details');
  expect(old).not.toHaveAttribute('open');
  expect(old.querySelector('summary')).toHaveTextContent('過去の参考記録（現在の判定には不使用）');
  expect(old).not.toHaveTextContent('✓ 通過');
});

it('never presents a stale positive value as a current pass', () => {
  render(<FinancialEvidencePanel {...props} now={props.now + 8 * 86400000} evidence={evidence}/>);
  const current = screen.getByRole('heading', { name: '四半期 EPS 前年同期比', exact: true }).closest('li');
  expect(current).toHaveTextContent('? 未確認');
  expect(current).toHaveTextContent('有効期限を過ぎています');
  expect(current).not.toHaveTextContent('30%');
  expect(screen.queryByText('✓ 通過')).not.toBeInTheDocument();
});

it('keeps absent evidence honest and references out of the pass/fail count', () => {
  render(<FinancialEvidencePanel {...props} method="minervini"/>);
  expect(screen.getByText('財務は参考確認・トレンド選定の点数には含めません')).toBeInTheDocument();
  expect(screen.queryByText('必須')).not.toBeInTheDocument();
  expect(screen.queryByText('✓ 通過')).not.toBeInTheDocument();
  expect(screen.getAllByText('? 未確認')).toHaveLength(7);
});

it('keeps ambiguous historical units visibly raw and current percentage units unknown', () => {
  render(<FinancialEvidencePanel {...props} evidence={{ ...evidence,
    metrics: { eps_growth_yy: { ...observation, unit: 'fraction', value: 0.3 } },
    historical: [{ ...observation, id: 'roe', value: 0.3, unit: undefined }],
  }}/>);
  const current = screen.getByRole('heading', { name: '四半期 EPS 前年同期比', exact: true }).closest('li');
  expect(current).toHaveTextContent('? 未確認');
  expect(current).not.toHaveTextContent('0.3%');
  expect(screen.getByText('0.3（単位未確認・原値）').closest('details')).not.toHaveAttribute('open');
});


it('separates the price snapshot, current evaluation, and actual acquisition time', () => {
  render(<FinancialEvidencePanel {...props} evidence={evidence}/>);
  expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('価格の基準日 2026-10-02 · 財務の確認時刻 2026-10-03T12:00:00.000Z');
  expect(screen.getByRole('region',{name:'財務の判定根拠'})).toHaveTextContent('基準日当時に公表済みだったことの証明ではありません');
  const current = screen.getByRole('heading',{name:'四半期 EPS 前年同期比',exact:true}).closest('li');
  expect(current).toHaveTextContent('2026-10-03T11:00:00Z');
  expect(current).toHaveTextContent('✓ 通過');
});


it.each([['Basic EPS','基本EPS（報告値）'],['Diluted EPS','希薄化EPS（報告値）']])('shows the actual %s source metric separately from annual diluted history', (metric,label) => {
  render(<FinancialEvidencePanel {...props} evidence={{...evidence,metrics:{eps_growth_yy:{...observation,metric,basis:'comparable_period_yoy/v1'}}}}/>);
  const current=screen.getByRole('heading',{name:'四半期 EPS 前年同期比',exact:true}).closest('li');
  expect(current).toHaveTextContent(label);
  expect(current).toHaveTextContent('比較可能な四半期の前年同期比（報告値）');
  expect(current).not.toHaveTextContent('comparable_period_yoy/v1');
  expect(current).toHaveTextContent('30%');
  expect(current).toHaveTextContent('✓ 通過');
  const annual=screen.getByRole('heading',{name:'直近3年の年次 EPS',exact:true}).closest('li');
  expect(annual).toHaveTextContent('希薄化EPS（報告値・年次）');
  expect(annual).not.toHaveTextContent('基本EPS');
});
