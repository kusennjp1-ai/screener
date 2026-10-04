import { act, fireEvent, render, screen, cleanup, waitFor, within, configure } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { HashRouter } from 'react-router-dom';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import ResearchPage from './ResearchPage';
import { withAuditFixture } from '../testAuditFixture';

// Allow actual async query/render completion under concurrent CI load.
configure({asyncUtilTimeout:5000});
const data = vi.hoisted(() => ({ rows: [], fail: false, charts: true, date: '2026-09-21', generated: new Date().toISOString(), modalRenders:0 }));
vi.mock('../dataClient', () => ({
  useStaticManifest: () => ({ data: { generated_at: data.generated, as_of_date: '2026-09-21' } }),
  resolveStaticMarketEntry: () => ({ pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts.json' } } }),
  fetchStaticJson: async () => { if (data.fail) throw Error('offline'); return { initial_rows: data.rows, chunks: [], as_of_date: data.date }; },
}));
vi.mock('../chartClient', () => ({ useStaticChartIndex: () => ({ data: { symbols: data.charts ? [{ symbol: 'LEAD' }, { symbol: 'FAIL' }] : [] } }) }));
vi.mock('../StaticChartViewerModal', () => ({ default: ({ open, initialSymbol, onClose }) => {data.modalRenders++;return open ? <div role="dialog" aria-label="日次分析"><span>{initialSymbol}</span><button onClick={onClose}>閉じる</button></div> : null;} }));
vi.mock('../components/ResearchChart', () => ({ default: ({ entry, onExpand }) => <button disabled={!entry} onClick={onExpand}>日次チャートを分析</button> }));

const leader = { symbol: 'LEAD', company_name: 'Leader Research Fixture', market: 'US', current_price: 102, se_pivot_price: 100, adv_usd: 50000000,
  passes_template: true, rs_rating: 95, eps_rating: 92, composite_rating: 96, ibd_group_rank: 10,
  week_52_low_distance: 50, week_52_high_distance: -2, eps_growth_yy: 30, sales_growth_yy: 30,
  annual_eps_growth_3y: [30, 30, 30], price_change_1d: 2, se_volume_vs_50d: 1.6, institutional_sponsors_increasing: true,
  institutional_evidence:{symbol:'LEAD',status:'available',unit:'13f_reporting_manager_cik',publication_cutoff:'2026-08-31',observations:[
    {period:'2026-03-31',manager_count:100,filing_date_first:'2026-04-10',filing_date_last:'2026-05-15'},
    {period:'2026-06-30',manager_count:110,filing_date_first:'2026-07-10',filing_date_last:'2026-08-15'},
  ]},
  market_above_50dma: true, market_above_200dma: true };
let client;
beforeEach(() => {
  window.history.replaceState(null, '', '#/');
  localStorage.clear(); data.fail = false; data.charts = true; data.date = '2026-09-21'; data.modalRenders=0;
  data.rows = [withAuditFixture(leader, data.date), { ...leader, symbol: 'FAIL', company_name: 'Weak Fixture', passes_template: false, rs_rating: 10, eps_growth_yy: -20, composite_rating: 10 }, { symbol: 'NONE', market: 'US', company_name: 'Unknown Fixture', current_price: 50, adv_usd: 30000000 }];
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const mount = () => render(<QueryClientProvider client={client}><HashRouter><ResearchPage /></HashRouter></QueryClientProvider>);

// 100 synthetic task profiles, NOT 100 human participants or independent opinions.
// Each profile operates the real component with controlled fixtures. Browser layout
// checks are separately performed at desktop/mobile widths; jsdom cannot measure layout.
const specialties = ['成長株', '決算', 'モメンタム', 'VCP', '業種', '機関投資家', 'リスク', 'データ品質', '短期売買', '長期運用'];
const tasks = ['手法比較', '銘柄検索', '厳格判定', 'ウォッチ', 'チャート', '欠損値', 'ゼロ件', '価格鮮度', '公式比較', '手法切替'];
const methods = ['ミネルヴィニ', 'オニール', 'IBD型'];
const candidates = () => screen.getByRole('list', {name:'投資手法別の銘柄候補'});
const openFilters = () => { fireEvent.click(screen.getByRole('button', {name:'候補を絞り込む'})); return screen.getByRole('dialog', {name:'候補を絞り込む'}); };
const closeFilters = () => fireEvent.click(screen.getByRole('button', {name:'絞り込みを閉じる'}));
it('opens an initial symbol link at the selected detail once its data arrives', async () => {
  const previousHash = window.location.hash;
  const previousScroll = Element.prototype.scrollIntoView;
  const scroll = vi.fn();
  Element.prototype.scrollIntoView = scroll;
  window.history.replaceState(null, '', '#/?symbol=FAIL');
  try {
    mount();
    await screen.findByRole('button', { name: /^FAIL の分析/ });
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' }));
    expect(document.activeElement).toHaveClass('research-detail');
    expect(document.activeElement).toHaveTextContent('FAIL');
    const count = scroll.mock.calls.length;
    fireEvent.click(screen.getByRole('tab', { name: 'メモ' }));
    expect(scroll).toHaveBeenCalledTimes(count);
  } finally {
    window.history.replaceState(null, '', previousHash || '#/');
    Element.prototype.scrollIntoView = previousScroll;
  }
});
it('renders the mobile chart only in detail, preserving row selection and focus on entry',async()=>{
  vi.stubGlobal('matchMedia',vi.fn(query=>({matches:/max-width:\s*700px/.test(query),media:query,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn()})));
  mount();
  const leaderRow=await screen.findByRole('button',{name:/^LEAD の分析を表示/});
  expect(screen.queryByRole('button',{name:'日次チャートを分析'})).not.toBeInTheDocument();
  fireEvent.click(leaderRow);
  expect(await screen.findByRole('button',{name:'日次チャートを分析'})).toBeInTheDocument();
  await waitFor(()=>expect(screen.getByRole('region',{name:'銘柄詳細'})).toHaveFocus());
  expect(screen.getByRole('heading',{name:'LEAD'})).toBeInTheDocument();
  act(()=>window.dispatchEvent(new Event('research:back')));
  expect(screen.queryByRole('button',{name:'日次チャートを分析'})).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:/^FAIL の分析を表示/}));
  expect(await screen.findByRole('heading',{name:'FAIL'})).toBeInTheDocument();
  expect(screen.queryByRole('heading',{name:'LEAD'})).not.toBeInTheDocument();
});
it('does not construct a closed expanded chart during method changes and opens the chosen symbol',async()=>{
  mount();await screen.findByRole('button',{name:/^LEAD の分析を表示/});
  fireEvent.click(screen.getByRole('button',{name:'オニール',exact:true}));
  expect(data.modalRenders).toBe(0);
  fireEvent.click(screen.getByRole('button',{name:'日次チャートを分析'}));
  expect(screen.getByRole('dialog',{name:'日次分析'})).toHaveTextContent('LEAD');
  fireEvent.click(screen.getByRole('button',{name:'閉じる'}));
  const previous=data.modalRenders;
  fireEvent.click(screen.getByRole('button',{name:'ミネルヴィニ',exact:true}));
  expect(data.modalRenders).toBe(previous);
  fireEvent.click(screen.getByRole('button',{name:/^FAIL の分析を表示/}));
  fireEvent.click(screen.getByRole('button',{name:'日次チャートを分析'}));
  expect(screen.getByRole('dialog',{name:'日次分析'})).toHaveTextContent('FAIL');
});
describe('100 virtual expert task profiles', () => {
  specialties.forEach((specialty, s) => tasks.forEach((task, t) => {
    it(`P${String(s * 10 + t + 1).padStart(3, '0')} ${specialty}専門家 / ${task}`, async () => {
      mount();
      await screen.findByRole('button', { name: /^LEAD の分析を表示/  });
      fireEvent.click(screen.getByRole('button', { name: methods[s % 3], exact: true }));
      const table = candidates();
      if (t === 0) {
        const expected=s % 3 === 0 ? '9/9' : s % 3 === 1 ? '5/8' : '5/10';
        expect(screen.getByRole('tab', {name:'判定根拠'})).toHaveAttribute('aria-selected','true');
        expect(within(table).getByRole('button',{name:/^LEAD の分析/})).toHaveAccessibleName(new RegExp(`選定 ${expected}`));
        expect(screen.getByRole('tabpanel')).toHaveTextContent(`選定 ${expected} · 未確認 ${s % 3 === 0 ? 0 : s % 3 === 1 ? 3 : 5}`);
      } else if (t === 1) {
        openFilters();
        fireEvent.change(screen.getByLabelText('銘柄・企業名を検索'), { target: { value: s % 2 ? 'lead' : 'Leader Research' } });
        closeFilters();
        await waitFor(()=>expect(within(table).queryByText('FAIL')).not.toBeInTheDocument());
        expect(within(table).getByText('LEAD')).toBeInTheDocument();
      } else if (t === 2) {
        openFilters();
        fireEvent.click(screen.getByLabelText('全条件通過のみ'));
        closeFilters();
        expect(within(table).queryByText('FAIL')).not.toBeInTheDocument();
        expect(within(table).queryByText('NONE')).not.toBeInTheDocument();
      } else if (t === 3) {
        fireEvent.click(screen.getByRole('button', { name: 'LEAD ウォッチに保存' }));
        openFilters();
        fireEvent.click(screen.getByLabelText('ウォッチのみ'));
        closeFilters();
        expect(within(table).queryByText('FAIL')).not.toBeInTheDocument();
        expect(JSON.parse(localStorage.getItem('research-watch'))).toEqual(['LEAD']);
      } else if (t === 4) {
        fireEvent.click(screen.getByRole('button', { name: '日次チャートを分析' }));
        expect(within(screen.getByRole('dialog')).getByText('LEAD')).toBeInTheDocument();
        fireEvent.click(screen.getByRole('button', { name: '閉じる' }));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      } else if (t === 5) {
        fireEvent.click(screen.getByRole('button', { name: /^NONE の分析を表示/  }));
        expect(screen.getByRole('tabpanel')).toHaveTextContent('? 未確認');
        expect(screen.getByRole('tab',{name:'判定根拠'})).toHaveAttribute('aria-selected','true');
        expect(screen.getByRole('button', { name: '日次チャートを分析' })).toBeDisabled();
      } else if (t === 6) {
        const filters=openFilters();
        fireEvent.change(screen.getByLabelText('銘柄・企業名を検索'), { target: { value: 'NOT-A-STOCK' } });
        await waitFor(()=>expect(within(filters).getByRole('button', {name:/CSV保存/})).toBeDisabled());
        closeFilters();
        await screen.findByText(/該当銘柄がありません/);
      } else if (t === 7) {
        fireEvent.click(screen.getByRole('tab', {name:'購入条件'}));
        expect(screen.getByRole('tabpanel')).toHaveTextContent('未接続');
        expect(screen.getByText(/未接続時は日次価格で計算します/)).toBeInTheDocument();
        expect(screen.getByText('場中価格を接続する')).toBeInTheDocument();
        expect(within(screen.getByRole('button',{name:/^LEAD の分析を表示/})).getByText(/買いゾーン内/)).toBeInTheDocument();
      } else if (t === 8) {
        expect(screen.getByText('公開ルールに基づく独自スクリーナー')).toBeInTheDocument();
        expect(screen.getByText(/IBD公式の選定銘柄・非公開の計算式を再現したものではありません/)).toBeInTheDocument();
      } else {
        fireEvent.click(screen.getByRole('button', { name: methods[(s + 1) % 3], exact: true }));
        expect(screen.getByRole('button', {name:methods[(s+1)%3],exact:true})).toHaveAttribute('aria-pressed','true');
        expect(screen.getByRole('tabpanel')).toHaveTextContent('選定');
        expect(screen.getByRole('link', { name: 'TradingViewで確認 ↗', exact: true })).toHaveAttribute('rel', 'noopener noreferrer');
      }
    });
  }));
});
it('recovers from a bundle error using retry', async () => {
  data.fail = true; mount();
  await screen.findByText(/データを取得できません/);
  data.fail = false; fireEvent.click(screen.getByRole('button', { name: '再試行' }));
  await waitFor(() => expect(screen.getByRole('button', { name: /^LEAD の分析を表示/  })).toBeInTheDocument());
});
it('warns about old analysis even when publication was just regenerated', async () => {
  data.date = '2000-01-03';
  mount();
  await screen.findByRole('button', { name: /^LEAD の分析を表示/  });
  expect(screen.getByText(/更新日時と価格の基準日は別です/)).toBeInTheDocument();
});
it('keeps search focus while narrowing results in the filter drawer', async () => {
  mount();
  await screen.findByRole('button', {name:/^LEAD の分析を表示/});
  openFilters();
  const input=screen.getByLabelText('銘柄・企業名を検索');
  act(()=>input.focus());
  fireEvent.change(input,{target:{value:'FAIL'}});
  expect(input).toHaveFocus();
  fireEvent.change(input,{target:{value:'NONE'}});
  expect(input).toHaveFocus();
  closeFilters();
  await waitFor(()=>expect(within(candidates()).getAllByRole('button')).toHaveLength(1));
  expect(within(candidates()).getByRole('button',{name:/^NONE の分析/})).toBeInTheDocument();
});

it('opens detailed verification from its tab and returns filter focus to the candidate region', async () => {
  mount();
  await screen.findByRole('button', {name:/^LEAD の分析を表示/});
  expect(screen.getByRole('tab',{name:'書籍検証'})).toHaveAttribute('aria-selected','false');
  fireEvent.click(screen.getByRole('tab',{name:'書籍検証'}));
  expect(screen.getByRole('tab',{name:'書籍検証'})).toHaveAttribute('aria-selected','true');
  expect(screen.getByRole('tabpanel')).toHaveAccessibleName('書籍検証');
  openFilters();
  fireEvent.click(screen.getByRole('button',{name:'候補を確認する →'}));
  await waitFor(()=>expect(screen.getByRole('region',{name:'対象銘柄',exact:true})).toHaveFocus());
  expect(screen.queryByLabelText('銘柄・企業名を検索')).not.toHaveFocus();
});

it('preserves canonical entry prices and unknown conditions while switching detail tabs by keyboard', async () => {
  mount();
  await screen.findByRole('button',{name:/^LEAD の分析を表示/});
  const gauge=screen.getByRole('img',{name:/現在価格.*共通ピボット/});
  expect(gauge).toHaveAccessibleName(/現在価格 \$102.00、共通ピボット \$100.00、アプリ買い上限 \$105.00/);
  const evidence=screen.getByRole('tab',{name:'判定根拠'});
  act(()=>evidence.focus());
  fireEvent.keyDown(evidence,{key:'ArrowRight'});
  expect(screen.getByRole('tab',{name:'購入条件'})).toHaveFocus();
  expect(screen.getByRole('tabpanel')).toHaveTextContent('未確認');
  fireEvent.keyDown(screen.getByRole('tab',{name:'購入条件'}),{key:'End'});
  expect(screen.getByRole('tab',{name:'メモ'})).toHaveFocus();
  fireEvent.keyDown(screen.getByRole('tab',{name:'メモ'}),{key:'Home'});
  expect(evidence).toHaveFocus();
  expect(gauge).toHaveAccessibleName(/共通ピボット \$100.00、アプリ買い上限 \$105.00/);
});

it('moves candidate focus with arrow keys and opens the focused stock with Enter', async () => {
  mount();
  const lead=await screen.findByRole('button',{name:/^LEAD の分析を表示/});
  act(()=>lead.focus());
  fireEvent.keyDown(lead,{key:'ArrowDown'});
  const next=screen.getByRole('button',{name:/^FAIL の分析を表示/});
  await waitFor(()=>expect(next).toHaveFocus());
  expect(next).toHaveAttribute('aria-current','true');
  fireEvent.keyDown(next,{key:'Enter'});
  expect(within(screen.getByRole('dialog',{name:'日次分析'})).getByText('FAIL')).toBeInTheDocument();
});

it('keeps all rows available to CSV and search beyond the first 50 rendered candidates', async () => {
  data.rows=Array.from({length:58},(_,i)=>withAuditFixture({...leader,symbol:`TEST${String(i).padStart(2,'0')}`,company_name:`Fixture ${i}`},data.date));
  const createObjectURL=vi.fn(()=> 'blob:fixture-csv');
  vi.stubGlobal('URL',Object.assign(class extends URL {},{createObjectURL,revokeObjectURL:vi.fn()}));
  vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});
  mount();
  await screen.findByRole('button',{name:/^TEST00 の分析/});
  expect(within(candidates()).getAllByRole('button')).toHaveLength(50);
  expect(within(candidates()).queryByText('TEST57')).not.toBeInTheDocument();
  openFilters();
  fireEvent.click(screen.getByRole('button',{name:/全検索結果をCSV保存/}));
  const blob=createObjectURL.mock.calls[0][0];
  let csv;
  await act(async()=>{csv=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsText(blob);});});
  expect(csv.trim().split(/\r?\n/)).toHaveLength(59);
  for(let i=0;i<58;i++)expect(csv).toContain(`TEST${String(i).padStart(2,'0')}`);
  fireEvent.change(screen.getByLabelText('銘柄・企業名を検索'),{target:{value:'TEST57'}});
  closeFilters();
  await waitFor(()=>expect(within(candidates()).getAllByRole('button')).toHaveLength(1));
  expect(within(candidates()).getByRole('button',{name:/^TEST57 の分析/})).toBeInTheDocument();
});

it('retains the watch for this screen and reports denied persistence', async () => {
  mount();
  await screen.findByRole('button',{name:/^LEAD の分析を表示/});
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new DOMException('Denied','SecurityError');});
  fireEvent.click(screen.getByRole('button',{name:'LEAD ウォッチに保存'}));
  expect(screen.getByRole('button',{name:'LEAD ウォッチ解除'})).toHaveAttribute('aria-pressed','true');
  expect(screen.getByText(/ウォッチはこの画面のみ保持されます/)).toBeInTheDocument();
  openFilters();
  fireEvent.click(screen.getByLabelText('ウォッチのみ'));
  closeFilters();
  expect(within(candidates()).getAllByRole('button')).toHaveLength(1);
});
