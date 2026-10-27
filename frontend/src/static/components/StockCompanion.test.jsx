import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import StockCompanion from './StockCompanion';
import { companionState } from '../stockCompanionState';
afterEach(cleanup);
const ready = { ready: true, passed: 7, total: 7, failed: 0, unknown: 0, notApplicable: 0 };
it('shows a positive expression only for complete applicable evidence', () => {
  expect(companionState({}, ready).mood).toBe('bright');
  expect(companionState({method_status:'unknown'}, ready).mood).toBe('curious');
  expect(companionState({}, {...ready, ready:false, passed:6, unknown:1}).mood).toBe('curious');
});
it('gives exclusions precedence over even a complete supplied count', () => {
  const exclusion = companionState({financial_exclusion:{label:'財務未確認・判定対象外'}}, ready);
  expect(exclusion.mood).toBe('resting');
  expect(exclusion.detail).toContain('財務未確認・判定対象外');
  expect(companionState({}, {...ready, notApplicable:1}).mood).toBe('resting');
});
it('preserves both failures and unknowns in the expression explanation', () => {
  const input={...ready, ready:false, passed:2, failed:1, unknown:4};
  const {container}=render(<StockCompanion checks={{}} readiness={input} symbol="TEST"/>);
  expect(container.querySelector('details')).toHaveAttribute('data-mood','concerned');
  expect(container.querySelector('details')).not.toHaveAttribute('open');
  expect(screen.getByText(/通過 2\/7・未達 1・未確認 4/)).toBeInTheDocument();
  expect(screen.getByText('条件を待とう')).toBeInTheDocument();
  expect(screen.getByLabelText('TEST の状態：条件を待とう。表情の根拠を表示')).toBeInTheDocument();
  expect(container.querySelector('.stock-companion-character')).toHaveAttribute('aria-hidden','true');
});
it('does not convert absent evidence to a cheerful zero-state', () => {
  expect(companionState(null,null)).toMatchObject({mood:'curious',title:'まだ確認中'});
});
