import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { prepareResearchBundle } from '../researchPreprocess';
import { withAuditFixture } from '../testAuditFixture';

const data = vi.hoisted(() => ({ bundle: null }));
vi.mock('../useResearchBundle', () => ({ useResearchBundle: () => ({ data: data.bundle, isError: false, isLoading: false }) }));
vi.mock('../dataClient', () => ({ useStaticManifest: () => ({ data: { generated_at: '2026-09-30T04:00:00Z' } }), resolveStaticMarketEntry: () => ({ as_of_date: '2026-09-29', assets: { research: { path: 'fixture.json' } } }), fetchStaticJson: vi.fn() }));
vi.mock('../chartClient', async importOriginal => ({ ...await importOriginal(), useStaticChartIndex: () => ({ data: null }) }));
vi.mock('../components/ResearchHero', () => ({ default: () => null }));
vi.mock('../components/ResearchDetail', async () => { const { forwardRef } = await import('react'); return { default: forwardRef(function MockResearchDetail() { return null; }) }; });
vi.mock('../StaticChartViewerModal', () => ({ default: () => null }));
let client;
beforeEach(() => {
  const rows = [['PASS', 90], ['FAIL', 69], ['UNKNOWN', null]].map(([symbol, rs_rating]) => withAuditFixture({ symbol, market: 'US', currency: 'USD', current_price: 102, adv_usd: 25000000, rs_rating }, '2026-09-29'));
  data.bundle = prepareResearchBundle([{ rows, as_of_date: '2026-09-29' }], '2026-09-29');
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  vi.stubGlobal('IntersectionObserver', class { observe() {} disconnect() {} });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });

it('keeps the active comparison method and unqualified one-away state visible after closing filters', () => {
  render(<QueryClientProvider client={client}><ResearchPage compareOnly /></QueryClientProvider>);
  expect(screen.getByRole('heading', { name: '買い位置を比較する' })).toBeInTheDocument();
  expect(screen.getByText('ミネルヴィニ · 価格位置と購入条件は別判定')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '手法・絞り込み' }));
  fireEvent.click(screen.getByLabelText('あと1条件'));
  fireEvent.click(screen.getByRole('button', { name: '絞り込みを閉じる' }));
  expect(screen.getByRole('heading', { name: '選定あと1条件を比較' })).toBeInTheDocument();
  expect(screen.getByText('ミネルヴィニ · 未合格・購入条件は別判定')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: '買い位置を比較する' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '手法・絞り込み' }));
  fireEvent.click(screen.getByRole('button', { name: 'IBD型', exact: true }));
  fireEvent.click(screen.getByRole('button', { name: '絞り込みを閉じる' }));
  expect(screen.getByText('IBD型 · 未合格・購入条件は別判定')).toBeInTheDocument();
  expect(screen.queryByText('ミネルヴィニ · 未合格・購入条件は別判定')).not.toBeInTheDocument();
});

it('keeps full-pass and one-away toggles exclusive and displays failed versus unknown labels', () => {
  render(<QueryClientProvider client={client}><ResearchPage /></QueryClientProvider>);
  fireEvent.click(screen.getByRole('button', { name: '候補を絞り込む' }));
  fireEvent.click(screen.getByLabelText('全条件通過のみ'));
  expect(screen.getByLabelText('全条件通過のみ')).toBeChecked();
  fireEvent.click(screen.getByLabelText('あと1条件'));
  expect(screen.getByLabelText('あと1条件')).toBeChecked();
  expect(screen.getByLabelText('全条件通過のみ')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '絞り込みを閉じる' }));
  expect(screen.getByText('未達：RS ≥ 70')).toBeInTheDocument();
  expect(screen.getByText('未確認：RS ≥ 70')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^PASS の分析/ })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: '候補を絞り込む' }));
  fireEvent.click(screen.getByLabelText('全条件通過のみ'));
  expect(screen.getByLabelText('あと1条件')).not.toBeChecked();
  fireEvent.click(screen.getByRole('button', { name: '絞り込みを閉じる' }));
  expect(screen.getByRole('button', { name: /^PASS の分析/ })).toBeInTheDocument();
  expect(screen.queryByText('未確認：RS ≥ 70')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'あと1条件', exact: true }));
  expect(screen.getByRole('button', { name: 'あと1条件', exact: true })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText('未確認：RS ≥ 70')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^PASS の分析/ })).not.toBeInTheDocument();
});
