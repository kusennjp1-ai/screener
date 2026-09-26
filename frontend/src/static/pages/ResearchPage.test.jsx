import { act, fireEvent, render, screen, cleanup, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { withAuditFixture } from '../testAuditFixture';

const data = vi.hoisted(() => ({ rows: [], fail: false, charts: true, date: '2026-09-21', generated: new Date().toISOString() }));
vi.mock('../dataClient', () => ({
  useStaticManifest: () => ({ data: { generated_at: data.generated, as_of_date: '2026-09-21' } }),
  resolveStaticMarketEntry: () => ({ pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts.json' } } }),
  fetchStaticJson: async () => { if (data.fail) throw Error('offline'); return { initial_rows: data.rows, chunks: [], as_of_date: data.date }; },
}));
vi.mock('../chartClient', () => ({ useStaticChartIndex: () => ({ data: { symbols: data.charts ? [{ symbol: 'LEAD' }, { symbol: 'FAIL' }] : [] } }) }));
vi.mock('../StaticChartViewerModal', () => ({ default: ({ open, initialSymbol, onClose }) => open ? <div role="dialog" aria-label="日次分析"><span>{initialSymbol}</span><button onClick={onClose}>閉じる</button></div> : null }));
vi.mock('../components/ResearchChart', () => ({ default: ({ entry, onExpand }) => <button disabled={!entry} onClick={onExpand}>日次チャートを分析</button> }));

const leader = { symbol: 'LEAD', company_name: 'Leader Research Fixture', market: 'US', current_price: 102, se_pivot_price: 100, adv_usd: 50000000,
  passes_template: true, rs_rating: 95, eps_rating: 92, composite_rating: 96, ibd_group_rank: 10,
  week_52_low_distance: 50, week_52_high_distance: -2, eps_growth_yy: 30, sales_growth_yy: 30,
  annual_eps_growth_3y: [30, 30, 30], price_change_1d: 2, se_volume_vs_50d: 1.6, institutional_sponsors_increasing: true,
  market_above_50dma: true, market_above_200dma: true };
let client;
beforeEach(() => {
  localStorage.clear(); data.fail = false; data.charts = true; data.date = '2026-09-21';
  data.rows = [withAuditFixture(leader, data.date), { ...leader, symbol: 'FAIL', company_name: 'Weak Fixture', passes_template: false, rs_rating: 10, eps_growth_yy: -20, composite_rating: 10 }, { symbol: 'NONE', market: 'US', company_name: 'Unknown Fixture', current_price: 50, adv_usd: 30000000 }];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.unstubAllGlobals(); });
const mount = () => render(<QueryClientProvider client={client}><ResearchPage /></QueryClientProvider>);

// 100 synthetic task profiles, NOT 100 human participants or independent opinions.
// Each profile operates the real component with controlled fixtures. Browser layout
// checks are separately performed at desktop/mobile widths; jsdom cannot measure layout.
const specialties = ['成長株', '決算', 'モメンタム', 'VCP', '業種', '機関投資家', 'リスク', 'データ品質', '短期売買', '長期運用'];
const tasks = ['手法比較', '銘柄検索', '厳格判定', 'ウォッチ', 'チャート', '欠損値', 'ゼロ件', '価格鮮度', '公式比較', '手法切替'];
const methods = ['ミネルヴィニ', 'オニール / CAN SLIM', 'IBD型リーダー'];
describe('100 virtual expert task profiles', () => {
  specialties.forEach((specialty, s) => tasks.forEach((task, t) => {
    it(`P${String(s * 10 + t + 1).padStart(3, '0')} ${specialty}専門家 / ${task}`, async () => {
      mount();
      await screen.findByRole('button', { name: 'LEAD の分析を表示' });
      fireEvent.click(screen.getByRole('button', { name: methods[s % 3], exact: true }));
      const table = screen.getByRole('table', { name: '投資手法別の銘柄候補' });
      if (t === 0) {
        expect(screen.getByText(`${methods[s % 3]}の判定根拠`)).toBeInTheDocument();
        expect(within(table).getByText(s % 3 === 0 ? '9/9' : s % 3 === 1 ? '8/8' : '10/10')).toBeInTheDocument();
      } else if (t === 1) {
        fireEvent.change(screen.getByLabelText('銘柄・企業名を検索'), { target: { value: s % 2 ? 'lead' : 'Leader Research' } });
        expect(within(table).queryByText('FAIL')).not.toBeInTheDocument();
        expect(within(table).getByText('LEAD')).toBeInTheDocument();
      } else if (t === 2) {
        fireEvent.click(screen.getByLabelText('全条件通過のみ'));
        expect(within(table).queryByText('FAIL')).not.toBeInTheDocument();
        expect(within(table).queryByText('NONE')).not.toBeInTheDocument();
      } else if (t === 3) {
        fireEvent.click(screen.getByRole('button', { name: '☆ ウォッチ' }));
        fireEvent.click(screen.getByLabelText('ウォッチのみ'));
        expect(within(table).queryByText('FAIL')).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('research-watch'))).toEqual(['LEAD']);
      } else if (t === 4) {
        fireEvent.click(screen.getByRole('button', { name: '日次チャートを分析' }));
        expect(within(screen.getByRole('dialog')).getByText('LEAD')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      } else if (t === 5) {
        fireEvent.click(screen.getByRole('button', { name: 'NONE の分析を表示' }));
        expect(screen.getAllByText('— 未確認').length).toBeGreaterThan(0);
        expect(screen.getByRole('button', { name: '日次チャートを分析' })).toBeDisabled();
      } else if (t === 6) {
        fireEvent.change(screen.getByLabelText('銘柄・企業名を検索'), { target: { value: 'NOT-A-STOCK' } });
        expect(screen.getByText(/該当銘柄がありません/)).toBeInTheDocument();
        fireEvent.click(screen.getByText('表示・保存オプション'));
        expect(screen.getByRole('button', { name: /CSV保存/ })).toBeDisabled();
      } else if (t === 7) {
        expect(screen.getByText('未接続')).toBeInTheDocument();
        expect(screen.getByText(/未接続時は日次価格で計算します/)).toBeInTheDocument();
        expect(screen.getByText('場中価格を接続する')).toBeInTheDocument();
        expect(screen.getByText('買いゾーン内')).toBeInTheDocument();
      } else if (t === 8) {
        expect(screen.getByText('IBD公式リストとの一致：未検証')).toBeInTheDocument();
        expect(screen.getByText(/IBD公式の選定銘柄・非公開の計算式を再現したものではありません/)).toBeInTheDocument();
      } else {
        fireEvent.click(screen.getByRole('button', { name: methods[(s + 1) % 3], exact: true }));
        expect(screen.getByText(`${methods[(s + 1) % 3]}の判定根拠`)).toBeInTheDocument();
        expect(screen.getByRole('link', { name: 'TradingView', exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });
  }));
});
it('recovers from a bundle error using retry', async () => {
  data.fail = true; mount();
  await screen.findByText(/データを取得できません/);
  data.fail = false; fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'LEAD の分析を表示' })).toBeInTheDocument());
});
it('warns about old analysis even when publication was just regenerated', async () => {
  data.date = '2000-01-03';
  mount();
  await screen.findByRole('button', { name: 'LEAD の分析を表示' });
  expect(screen.getByText(/公開更新が新しくても、分析データが新しいとは限りません/)).toBeInTheDocument();
});
it('keeps keyboard focus in search after explicitly opening a stock detail', async () => {
  mount();
  fireEvent.click(await screen.findByRole('button', { name: 'LEAD の分析を表示' }));
  await waitFor(() => expect(screen.getByLabelText('銘柄詳細')).toHaveFocus());
  const input = screen.getByLabelText('銘柄・企業名を検索');
  act(() => input.focus());
  fireEvent.change(input, { target: { value: 'FAIL' } });
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: 'NONE' } });
  expect(input).toHaveFocus();
});

it('starts with compact research and opens detailed verification on demand', async () => {
  mount();
  await screen.findByRole('button', { name: 'LEAD の分析を表示' });
  const details = screen.getByText('詳細検証 — 財務・チャート・書籍の条件').closest('details');
  expect(details).not.toHaveAttribute('open');
  fireEvent.click(screen.getByText('詳細検証 — 財務・チャート・書籍の条件'));
  expect(details).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: '候補を確認する →' }));
  expect(screen.getByLabelText('銘柄・企業名を検索')).toHaveFocus();
});
