import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PortfolioDecision from './PortfolioDecision';
import { withAuditFixture } from '../testAuditFixture';
afterEach(cleanup);
const row = { symbol: 'LEAD', market: 'US', currency: 'USD', gics_sector: 'Tech', market_regime: 'confirmed_uptrend', market_above_50dma: true, market_above_200dma: true, passes_template: true, rs_rating: 95, week_52_low_distance: 50, week_52_high_distance: 3, composite_rating: 95, eps_rating: 90, ibd_group_rank: 10, adv_usd: 50000000, current_price: 101, se_pivot_price: 100, se_pattern_confidence: 80 };
it('shows cash first and reaches order prices and evidence in two actions', () => {
  const inspect = vi.fn();
  render(<PortfolioDecision rows={[withAuditFixture(row)]} date="2026-09-23" now={Date.parse('2026-09-24T14:00:00Z')} onInspect={inspect} />);
  expect(screen.getByRole('heading', { name: '新規購入は保留' })).toBeInTheDocument();
  expect(screen.getByText(/現金100%/)).toBeInTheDocument();
  expect(screen.queryByText('買い指値の上限')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /条件付きの配分・注文計画を見る/ }));
  expect(screen.getByText('買い指値の上限')).toBeInTheDocument();
  expect(screen.getByText('購入後の売り逆指値例')).toBeInTheDocument();
  expect(screen.getByText('利確指値の計算例')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'LEAD の注文根拠を確認' }));
  expect(inspect).toHaveBeenCalledWith('LEAD');
});
it('does not fill cash with unqualified stocks when there are no candidates', () => {
  render(<PortfolioDecision rows={[{ ...row, passes_template: false }]} date="2026-09-23" onInspect={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /条件付きの配分・注文計画を見る/ }));
  expect(screen.getByText(/配分できる候補はありません/)).toBeInTheDocument();
});
