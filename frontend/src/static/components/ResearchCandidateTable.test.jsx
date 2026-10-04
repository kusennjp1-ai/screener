import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ResearchCandidateTable from './ResearchCandidateTable';

// Rendering must never create a second assessment or financial evidence path.
vi.mock('../researchEngine', () => ({ assess: () => { throw new Error('Table reevaluated selection'); }, entryPlan: () => { throw new Error('Table rebuilt an entry plan'); } }));
vi.mock('../entryReadiness', () => ({ entryReadiness: () => { throw new Error('Table reevaluated daily readiness'); } }));
vi.mock('../financialEvidencePresentation', () => ({ buildFinancialEvidencePresentation: () => { throw new Error('Table rebuilt financial evidence'); }, financialEvidencePresentation: () => { throw new Error('Table reformatted financial evidence'); } }));

afterEach(() => cleanup());

const makeItem = (symbol = 'ZED') => ({
  row: { symbol, company_name: `${symbol} fixture`, current_price: 999, price_change_1d: 1.2, rs_rating: 92, eps_growth_yy: 999, sales_growth_yy: 999 },
  assessment: { qualified: false, passed: 5, total: 8, failed: 1, unknown: 2 },
  selectionRules: [{ label: '四半期 EPS ≥ 25%', state: 'fail', detail: '選定条件の判定根拠' }],
  plan: { state: '買いゾーン内', price: 102, distance: 2 },
  readiness: { ready: false, passed: 5, total: 7, failed: 0, unknown: 2, rules: [
    { id: 'selection', label: '共通購入モデルへの適合', state: 'unknown', detail: '選択中の手法とは別に両方を確認' },
    { id: 'market', label: '市場環境', state: 'pass', detail: '市場の準備済み根拠' },
    { id: 'earnings', label: '決算までの余裕', state: 'unknown', detail: '決算予定日が未取得' },
  ] },
  volume: 1.5,
  growth: [
    { id: 'eps_growth_yy', label: '四半期 EPS 前年同期比', actual: '14%', required: true, state: 'fail', condition: '四半期 EPS ≥ 25%', period: '2026-06-30 / 比較 2025-06-30', source: 'Synthetic EPS source', observedAt: '2026-10-03T11:00:00Z', metric: '希薄化EPS（報告値）', basis: '四半期EPSの前年同期比（報告値）' },
    { id: 'sales_growth_yy', label: '売上高 前年同期比', actual: '40%', required: true, state: 'pass', condition: '売上高 前年比 ≥ 25%', period: '2026-07-31 / 比較 2025-07-31', source: 'Synthetic sales source', observedAt: '2026-10-03T11:30:00Z' },
  ],
  annual: { id: 'annual_eps_growth_3y', label: '直近3年の年次 EPS', required: true, state: 'unknown', actual: '未確認', condition: '3年 EPS > 25%', period: '決算期 未確認', source: '提供元 未確認', explanation: '連続4期の年次EPSが揃っていません。' },
});
const props = { method: 'oneil', date: '2026-10-02', onSelect: vi.fn() };

it('renders semantic, labelled table columns in its own keyboard-accessible horizontal scroll region', () => {
  render(<ResearchCandidateTable {...props} items={[makeItem()]}/>);
  const region = screen.getByRole('region', { name: '銘柄候補の比較表' });
  expect(region).toHaveAttribute('tabindex', '0');
  expect(region).toHaveAccessibleDescription('横にスクロールして比較。対象期・提供元は各行のボタンから確認できます。');
  expect(within(region).getByRole('table', { name: 'オニールの候補 · 価格 2026-10-02 終値' })).toBeInTheDocument();
  expect(screen.getAllByRole('columnheader')).toHaveLength(8);
  for (const label of ['選択手法の選定条件', '日次確認', '価格位置 · アプリ', '四半期EPS前年比', '売上前年比', '共通購入モデルで次に確認']) {
    expect(screen.getByRole('columnheader', { name: label })).toHaveAttribute('scope', 'col');
  }
  expect(screen.getByRole('rowheader')).toHaveAttribute('scope', 'row');
  expect(screen.queryByRole('list')).not.toBeInTheDocument();
});

it('preserves the prepared universe and order without paging, sorting, filtering or falling back to raw scalar values', () => {
  const items = [makeItem('ZED'), makeItem('ALFA'), ...Array.from({ length: 19 }, (_, index) => makeItem(`ROW${index}`))];
  const { container } = render(<ResearchCandidateTable {...props} items={items} selectedSymbol="ALFA"/>);
  expect([...container.querySelectorAll('[data-feed-symbol]')].map(row => row.dataset.feedSymbol)).toEqual(items.map(item => item.row.symbol));
  expect(container.querySelectorAll('.candidate-row')).toHaveLength(21);
  expect(container.querySelector('[data-feed-symbol="ALFA"]')).toHaveAttribute('data-selected', 'true');
  const selected = screen.getByRole('button', { name: /^ALFA の分析を表示/ });
  expect(selected).toHaveAttribute('aria-current', 'true');
  expect(selected.querySelector('.candidate-name strong')).toHaveTextContent('ALFA');
  expect(selected).toHaveTextContent('$102.00');
  expect(container).not.toHaveTextContent('999');
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
});

it('keeps method qualification, common-model daily checks, price position and required annual unknown visibly independent', () => {
  const { container } = render(<ResearchCandidateTable {...props} items={[makeItem()]}/>);
  const row = container.querySelector('[data-feed-symbol="ZED"]');
  expect(row.querySelector('[data-check="selection"]')).toHaveTextContent('5/8 未達未達 1 · 未確認 2');
  expect(row.querySelector('[data-check="daily"]')).toHaveTextContent('日次確認 5/7 未確認');
  expect(row.querySelector('[data-check="daily"]')).toHaveTextContent('選定条件とは別の共通購入モデル');
  expect(row.querySelector('[data-check="price"]')).toHaveTextContent('買いゾーン内');
  expect(row.querySelector('[data-check="next"]')).toHaveTextContent('共通購入モデルへの適合：未確認');
  expect(within(row).getByRole('rowheader')).toHaveTextContent('必須 年次EPS 未確認');
  const eps = row.querySelector('[data-metric="eps_growth_yy"]');
  expect(eps).toHaveTextContent('14%必須 未達四半期 EPS ≥ 25%');
  expect(eps).toHaveAttribute('data-state', 'fail');
  expect(row.querySelector('[data-metric="sales_growth_yy"]')).toHaveTextContent('40%必須 通過売上高 前年比 ≥ 25%');
});

it('reveals exact financial periods, sources and independent rule details with one action, and closes on repeated use', () => {
  const item = makeItem();
  const onSelect = vi.fn();
  render(<ResearchCandidateTable {...props} onSelect={onSelect} items={[item]}/>);
  expect(screen.queryByText(item.growth[0].source)).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'ZED の対象期・提供元と判定根拠を見る' });
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'true');
  const detail = screen.getByRole('region', { name: 'ZED の対象期・提供元と判定根拠' });
  expect(detail).toHaveAttribute('id', toggle.getAttribute('aria-controls'));
  for (const metric of [...item.growth, item.annual]) {
    expect(detail).toHaveTextContent(metric.period);
    expect(detail).toHaveTextContent(metric.source);
    expect(detail).toHaveTextContent(metric.condition);
  }
  expect(detail).toHaveTextContent('2026-10-03T11:30:00Z');
  expect(detail).toHaveTextContent('選定条件の判定根拠');
  expect(detail).toHaveTextContent('選択中の手法とは別に両方を確認');
  expect(onSelect).not.toHaveBeenCalled();
  fireEvent.click(within(detail).getByRole('button', { name: 'ZED の詳しい分析を開く' }));
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('ZED');
  fireEvent.click(toggle);
  expect(toggle).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByRole('region', { name: 'ZED の対象期・提供元と判定根拠' })).not.toBeInTheDocument();
});

it('preserves loss-comparison unknown and reference-only states without converting them to passes', () => {
  const item = makeItem();
  item.growth[0] = { ...item.growth[0], actual: '赤字縮小', state: 'unknown', referenceActual: '50%（比較期の絶対値を分母とした参考値）', explanation: '通常の成長率条件は未確認です。' };
  item.growth[1] = { ...item.growth[1], required: false, state: 'reference', condition: '選定の数値条件なし・参考' };
  const { container } = render(<ResearchCandidateTable {...props} items={[item]}/>);
  const eps = container.querySelector('[data-metric="eps_growth_yy"]');
  expect(eps).toHaveTextContent('赤字縮小必須 未確認');
  expect(eps).toHaveTextContent('参考計算：50%');
  expect(eps).not.toHaveTextContent('通過');
  expect(container.querySelector('[data-metric="sales_growth_yy"]')).toHaveTextContent('選定の数値条件なし・参考');
  expect(container.querySelector('[data-metric="sales_growth_yy"]')).not.toHaveTextContent('必須');
});

it('updates an open evidence row when the board replaces prepared current values with unknown evidence', () => {
  const item = makeItem();
  const { rerender, container } = render(<ResearchCandidateTable {...props} items={[item]} selectedSymbol="ZED"/>);
  fireEvent.click(screen.getByRole('button', { name: 'ZED の対象期・提供元と判定根拠を見る' }));
  const expired = { ...item, growth: item.growth.map(metric => ({ ...metric, actual: '未確認', state: 'unknown', explanation: '根拠の有効期限を過ぎています。再確認が必要です。' })) };
  rerender(<ResearchCandidateTable {...props} items={[expired]} selectedSymbol="ZED"/>);
  const detail = screen.getByRole('region', { name: 'ZED の対象期・提供元と判定根拠' });
  expect(detail).toHaveTextContent('根拠の有効期限を過ぎています。再確認が必要です。');
  expect(container).not.toHaveTextContent('14%');
  expect(container).not.toHaveTextContent('40%');
  expect(container.querySelector('[data-metric="eps_growth_yy"]')).toHaveAttribute('data-state', 'unknown');
  expect(screen.getByRole('button', { name: /^ZED の分析を表示/ })).toHaveAttribute('aria-current', 'true');
});

it('retains row-button keyboard hooks and independent selection, chart and watch actions', () => {
  const onSelect = vi.fn(), onCompare = vi.fn(), onMove = vi.fn(), onWatch = vi.fn();
  const { container } = render(<ResearchCandidateTable {...props} items={[makeItem()]} watch={['ZED']} {...{ onSelect, onCompare, onMove, onWatch }}/>);
  const button = screen.getByRole('button', { name: /^ZED の分析を表示/ });
  fireEvent.click(button);
  expect(onSelect).toHaveBeenCalledExactlyOnceWith('ZED');
  fireEvent.keyDown(button, { key: 'ArrowDown' });
  fireEvent.keyDown(button, { key: 'ArrowUp' });
  expect(onMove).toHaveBeenNthCalledWith(1, 'ZED', 1, button);
  expect(onMove).toHaveBeenNthCalledWith(2, 'ZED', -1, button);
  fireEvent.keyDown(button, { key: 'Enter' });
  expect(onCompare).toHaveBeenCalledExactlyOnceWith('ZED');
  fireEvent.click(screen.getByRole('button', { name: 'ZED のチャートを開く' }));
  expect(onCompare).toHaveBeenCalledTimes(2);
  const watchButton = screen.getByRole('button', { name: 'ZED ウォッチ解除' });
  expect(watchButton).toHaveAttribute('aria-pressed', 'true');
  fireEvent.click(watchButton);
  expect(onWatch).toHaveBeenCalledExactlyOnceWith('ZED');
  expect(container.querySelector('button button')).toBeNull();
});

it('uses visible unknown wording when prepared evidence or daily checks are missing', () => {
  const item = { ...makeItem(), readiness: null, volume: null, growth: [], annual: null, plan: { state: '未確認', price: null, distance: null } };
  const { container } = render(<ResearchCandidateTable {...props} date={null} items={[item]}/>);
  expect(screen.getByRole('rowheader')).toHaveTextContent('価格 未確認');
  expect(container.querySelector('[data-check="daily"]')).toHaveTextContent('日次確認 未確認');
  expect(container.querySelector('[data-check="price"]')).toHaveTextContent('未確認・判定不可ピボット比 未確認');
  expect(container.querySelector('[data-check="price"]')).toHaveTextContent('出来高 未確認');
  expect(container.querySelectorAll('.research-table-growth')).toHaveLength(2);
  for (const growth of container.querySelectorAll('.research-table-growth')) {
    expect(growth).toHaveTextContent('未確認役割 未確認 未確認選定条件の根拠待ち');
  }
  expect(container).not.toHaveTextContent('999');
});
