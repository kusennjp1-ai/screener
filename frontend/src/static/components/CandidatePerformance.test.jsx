import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import CandidatePerformance from './CandidatePerformance';

const fetchStaticJson = vi.hoisted(() => vi.fn());
vi.mock('../dataClient', () => ({ fetchStaticJson }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });
const entry = { as_of_date: '2026-09-14', assets: { candidate_performance: { path: 'performance.json', sha256: 'test-hash' } } };
const result = { n: 2, cohort_count: 3, pending: 0, unavailable: 1, observed_sessions_min: 0, observed_sessions_max: 5, median_return_pct: -1, median_spy_return_pct: 5, median_max_drawdown_pct: -12, win_rate: .5, sample_insufficient: true };
const data = { as_of: entry.as_of_date, history_first_as_of: '2026-09-04', cohorts: [], definition: '売買実績ではありません。', summary: { minervini: { 5: result, 20: { ...result, n: 0, pending: 2, median_return_pct: null, median_spy_return_pct: null, median_max_drawdown_pct: null, win_rate: null }, 60: result } } };
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  render(<QueryClientProvider client={client}><CandidatePerformance entry={entry} /></QueryClientProvider>);
  const disclosure = screen.getByText(/過去の通過銘柄を検証する/).closest('details');
  disclosure.open = true;
  fireEvent(disclosure, new Event('toggle', { bubbles: true }));
}

it('discloses publication timing and missing-sample bias beside observed-only statistics', async () => {
  fetchStaticJson.mockResolvedValue(data);
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('実際の公開時刻は未確認');
  expect(screen.getByRole('alert')).toHaveTextContent('公開前の値動きが含まれる場合');
  expect(screen.getByText(/観測済みの標本 n だけで計算/)).toHaveTextContent('上場廃止などで観測できない銘柄');
  const mature = within(screen.getByRole('region', { name: '5営業日後の成績' }));
  expect(mature.getByText(/標本 n=2/)).toHaveTextContent('対象 3');
  expect(mature.getByText('観測済み標本の上昇割合')).toBeInTheDocument();
  expect(mature.getByText('50.0%')).toBeInTheDocument();
  expect(mature.getByText('観測待ち 0 / 欠損・未検証 1')).toBeInTheDocument();
  const immature = within(screen.getByRole('region', { name: '20営業日後の成績' }));
  expect(immature.getAllByText('—')).toHaveLength(4);
  expect(immature.queryByText('0.0%')).not.toBeInTheDocument();
});

it('does not display statistics from a mismatched analysis date', async () => {
  fetchStaticJson.mockResolvedValue({ ...data, as_of: '2026-09-11' });
  mount();
  expect(await screen.findByRole('alert')).toHaveTextContent('成績データを取得できません');
  expect(screen.queryByRole('region', { name: '5営業日後の成績' })).not.toBeInTheDocument();
});
