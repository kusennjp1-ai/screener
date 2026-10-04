import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setupEvidenceFixture } from '../../test/fixtures/setupEvidence';
import SetupEvidencePanel from './SetupEvidencePanel';
import ResearchChart from './ResearchChart';

const fetchPayload = vi.hoisted(() => vi.fn());
vi.mock('../chartClient', () => ({ fetchStaticChartPayload: fetchPayload, staticChartKeys: { payload: (symbol, path) => ['chart', symbol, path] } }));
vi.mock('../../components/Charts/CandlestickChart', () => ({ default: ({ symbol }) => <div data-testid="daily-chart">{symbol}</div> }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

function setup(fixture = setupEvidenceFixture(), options = {}) {
  fetchPayload.mockResolvedValue(fixture.payload);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0, placeholderData: previous => previous } } });
  const props = { ...fixture, payload: undefined, chartEntry: { path: 'chart.json' }, generation: 'g1', ...options };
  const wrap = values => <QueryClientProvider client={client}><SetupEvidencePanel {...values} /></QueryClientProvider>;
  const view = render(wrap(props));
  return { ...view, props, client, update: values => view.rerender(wrap(values)) };
}

describe('setup evidence panel', () => {
  it('shows qualified pre-pivot shares without implying a ready purchase or historical progression', async () => {
    setup();
    await screen.findByText('$150.00');
    expect(screen.getByText('9/9 通過')).toBeInTheDocument();
    expect(screen.getByText('ピボット待ち')).toBeInTheDocument();
    expect(screen.getByText(/過去からの進行順やVCP成立の証明ではありません/)).toBeInTheDocument();
    expect(screen.queryByText('日次の買い条件通過')).not.toBeInTheDocument();
  });

  it('separates formation dry-up and latest-day volume with measured windows and baselines', async () => {
    const fixture = setupEvidenceFixture({ lastClose: 141, lastVolume: 2000 });
    setup(fixture);
    await screen.findByText('$150.00');
    const formation = screen.getByRole('region', { name: '形成中の売り枯れの確認' });
    const breakout = screen.getByRole('region', { name: '上放れ時の出来高の確認' });
    expect(formation).toHaveTextContent('0.50倍');
    expect(formation).toHaveTextContent(`${fixture.payload.bars[304].date}〜${fixture.payload.bars[305].date}`);
    expect(formation).toHaveTextContent('売り枯れ・最終収縮の成立は未認定');
    expect(breakout).toHaveTextContent('2.04倍');
    expect(breakout).toHaveTextContent(fixture.date);
    expect(breakout).toHaveTextContent('1.4倍以上はアプリの代理条件');
    const measurement = screen.getByText('測定期間・比較元と書籍の目安').closest('details');
    expect(measurement).toHaveTextContent(`${fixture.payload.bars[254].date}〜${fixture.payload.bars[303].date}`);
    expect(measurement).toHaveTextContent(`${fixture.payload.bars.at(-51).date}〜${fixture.payload.bars.at(-2).date}`);
    expect(measurement).toHaveTextContent('場中価格では更新しません');
  });

  it('explicitly refuses the pre-breakout label for a window touching the pivot', async () => {
    const fixture = setupEvidenceFixture(); fixture.row.se_pivot_price = 130;
    setup(fixture);
    await screen.findByText('$150.00');
    expect(screen.getByRole('region', { name: '形成中の売り枯れの確認' })).toHaveTextContent('上放れ前の区間とは扱いません');
  });

  it('reports down-day high volume as not meeting the existing proxy', async () => {
    setup(setupEvidenceFixture({ lastClose: 122, lastVolume: 2000 }));
    await screen.findByText('$150.00');
    const breakout = screen.getByRole('region', { name: '上放れ時の出来高の確認' });
    expect(breakout).toHaveTextContent('2.04倍');
    expect(breakout).toHaveTextContent('増加の代理条件に非該当');
    expect(breakout).toHaveTextContent('上放れ成立の認定ではありません');
  });

  it('distinguishes the canonical local pivot from the dated major high', async () => {
    setup();
    await screen.findByText('$150.00');
    expect(screen.getByText('共通ピボット（局所的な買い水準）')).toBeInTheDocument();
    expect(screen.getByText('$140.00')).toBeInTheDocument();
    expect(screen.getByText('252営業日高値（当日含む）')).toBeInTheDocument();
    expect(screen.getByText(/局所ピボットの上に252営業日高値があります/)).toHaveTextContent('ベース抵抗線の認定ではありません');
  });

  it('leaves the pivot unknown when only the major high is verified', async () => {
    const fixture = setupEvidenceFixture(); fixture.row.se_pivot_price = 0;
    setup(fixture);
    await screen.findByText('$150.00');
    expect(screen.getByText(/252営業日高値を買い水準の代わりには使いません/)).toBeInTheDocument();
    expect(screen.queryByText('$140.00')).not.toBeInTheDocument();
  });

  it.each([['minervini', '0〜5%', '約2〜3%'], ['minervini2', '0〜3%', '第2方式の3%は既存アプリ設定']])('keeps book proximity and app zones separate for %s', async (method, zone, disclosure) => {
    setup(setupEvidenceFixture(), { method });
    await screen.findByText('$150.00');
    const measurement = screen.getByText('測定期間・比較元と書籍の目安').closest('details');
    expect(measurement).toHaveTextContent(zone);
    expect(measurement).toHaveTextContent(disclosure);
  });

  it('does not fetch another resource when no selected chart exists', () => {
    render(<SetupEvidencePanel {...setupEvidenceFixture()} chartEntry={undefined} />);
    expect(fetchPayload).not.toHaveBeenCalled();
    expect(screen.getByText('検証用の日足は未取得です')).toBeInTheDocument();
    expect(screen.queryByText('$150.00')).not.toBeInTheDocument();
  });

  it('shares the current chart request and cache rather than adding a provider request', async () => {
    const fixture = setupEvidenceFixture(); fetchPayload.mockResolvedValue(fixture.payload);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const entry = { path: 'shared-chart.json' };
    render(<QueryClientProvider client={client}>
      <ResearchChart row={fixture.row} method={fixture.method} symbol={fixture.row.symbol} entry={entry} date={fixture.date} generation="g1" />
      <SetupEvidencePanel {...fixture} chartEntry={entry} generation="g1" />
    </QueryClientProvider>);
    await screen.findByText('$150.00');
    expect(screen.getByTestId('daily-chart')).toHaveTextContent(fixture.row.symbol);
    expect(fetchPayload).toHaveBeenCalledTimes(1);
    expect(fetchPayload).toHaveBeenCalledWith(entry.path);
  });

  it('hides prior-stock and prior-generation volume and high while new data is pending', async () => {
    const view = setup(); await screen.findByText('$150.00');
    fetchPayload.mockImplementation(() => new Promise(() => {}));
    view.update({ ...view.props, generation: 'g2' });
    expect(screen.queryByText('$150.00')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
    expect(screen.getByRole('region', { name: '形成中の売り枯れの確認' })).not.toHaveTextContent('0.50倍');
    view.update({ ...view.props, row: { ...view.props.row, symbol: 'OTHER' }, chartEntry: { path: 'other.json' }, generation: 'g2' });
    expect(screen.queryByText('$150.00')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('読み込み中');
  });

  it.each(['wrong symbol', 'wrong date', 'network error'])('withholds stale evidence after %s', async reason => {
    const view = setup(); await screen.findByText('$150.00');
    if (reason === 'network error') fetchPayload.mockRejectedValue(Error('offline'));
    else fetchPayload.mockResolvedValue({ ...view.props.payload, ...setupEvidenceFixture().payload,
      ...(reason === 'wrong symbol' ? { symbol: 'OTHER' } : { as_of_date: '2026-01-01' }) });
    view.update({ ...view.props, generation: 'g2' });
    await waitFor(() => expect(screen.getByText(/日足を取得・照合できません/)).toBeInTheDocument());
    expect(screen.queryByText('$150.00')).not.toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: '上放れ時の出来高の確認' })).getByText(/同じ基準日の検証済み出来高/)).toBeInTheDocument();
  });

  it('revalidates cached chart identity when expected date changes even with the same path and generation', async () => {
    const view = setup(); await screen.findByText('$150.00');
    view.update({ ...view.props, date: '2026-10-01' });
    await screen.findByText(/日足を取得・照合できません/);
    expect(screen.queryByText('$150.00')).not.toBeInTheDocument();
    expect(fetchPayload).toHaveBeenCalledTimes(1);
  });
});
