import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarketIndicatorHistory from './MarketIndicatorHistory';
import { observation, series, payload, invalidMarketObservationCases } from '../../../tools/fixtures/market-history.mjs';

const props = { market: 'US', asOfDate: '2026-10-09' };
describe('market history display without fabricated observations', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-11T12:00:00Z')); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it('uses one labeled card per observation on narrow screens, preserving unknowns and zero', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addListener: vi.fn(), removeListener: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() })));
    render(<MarketIndicatorHistory {...props} history={payload(series('new_highs', { observations: [observation(0, '2026-10-08'), observation(null)] }))} />);
    const history = screen.getByRole('list', { name: '新高値の履歴' });
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    const cards = within(history).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveTextContent('対象日2026-10-09値未確認状態・未確認理由');
    expect(cards[0]).toHaveTextContent('取得日時（UTC）2026-10-10T01:00:00Z');
    expect(cards[1]).toHaveTextContent('対象日2026-10-08値0状態・未確認理由観測値');
  });
  it('shows all six requested categories and nine missing series', () => {
    render(<MarketIndicatorHistory {...props} />);
    expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(6);
    expect(screen.getAllByText(/比較可能な履歴は未取得です/)).toHaveLength(9);
    expect(screen.getByText(/実際の購入者数/)).toBeInTheDocument();
  });
  it('shows actual zero and latest missing separately without falling back', () => {
    render(<MarketIndicatorHistory {...props} history={payload(series('new_highs', { observations: [observation(0, '2026-10-08'), observation(null)] }))} />);
    const table = screen.getByRole('table', { name: '新高値の履歴' });
    expect(within(table).getByText('0')).toBeInTheDocument();
    expect(screen.getByText(/最新対象日 2026-10-09：未確認/)).toBeInTheDocument();
    expect(screen.getByText(/新安値：比較可能な履歴は未取得/)).toBeInTheDocument();
  });
  // Raw JavaScript props retain holes, inherited slots and array properties.
  // They are not equivalent to their JSON serialization at the browser route.
  it.each(invalidMarketObservationCases())('rejects raw malformed observations: $name, while retaining independent zero', ({ observations }) => {
    render(<MarketIndicatorHistory {...props} history={payload(series('new_highs', { observations }), series('new_lows'))} />);
    expect(screen.getByText(/新高値：比較可能な履歴は未取得/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '新高値の履歴' })).not.toBeInTheDocument();
    expect(screen.getByText('市場・母集団・方法・頻度・単位が不明または混在する系列を除外しました。')).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '新安値の履歴' })).getByText('0', { exact: true })).toBeInTheDocument();
  });
  it('rejects an array masquerading as a series through raw JavaScript props', () => {
    render(<MarketIndicatorHistory {...props} history={payload(Object.assign([], series('new_highs')), series('new_lows'))} />);
    expect(screen.getByText(/新高値：比較可能な履歴は未取得/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '新高値の履歴' })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '新安値の履歴' })).getByText('0', { exact: true })).toBeInTheDocument();
  });
  it('rejects the explicit null produced when a sparse observation is serialized to JSON', () => {
    const history = JSON.parse(JSON.stringify(payload(series('new_highs', { observations: Array(1) }))));
    expect(history.series[0].observations).toEqual([null]);
    render(<MarketIndicatorHistory {...props} history={history} />);
    expect(screen.getByText(/新高値：比較可能な履歴は未取得/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '新高値の履歴' })).not.toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('不明または混在する系列を除外');
  });
  it.each([[0.00001, '1E-5'], [0.0000001, '1E-7'], [0.000049, '4.9E-5'], [Number.MIN_VALUE, '5E-324']])('does not display positive ratio %s as observed zero', (value, displayed) => {
    render(<MarketIndicatorHistory {...props} history={payload(series('put_call_ratio', { observations: [observation(value)] }))} />);
    const table = screen.getByRole('table', { name: 'プットコールレシオの履歴' });
    expect(within(table).getByText(displayed, { exact: true })).toBeInTheDocument();
    expect(within(table).queryByText('0', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(`日次観測。最新対象日 2026-10-09：${displayed}`)).toBeInTheDocument();
  });
  it('keeps an observed zero ratio and safe integer counts exact', () => {
    render(<MarketIndicatorHistory {...props} history={payload(series('put_call_ratio'), series('new_highs', { observations: [observation(Number.MAX_SAFE_INTEGER)] }))} />);
    expect(within(screen.getByRole('table', { name: 'プットコールレシオの履歴' })).getByText('0', { exact: true })).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '新高値の履歴' })).getByText('9,007,199,254,740,991', { exact: true })).toBeInTheDocument();
  });
  it('labels old quarterly counts and displays retrieval time separately', () => {
    render(<MarketIndicatorHistory {...props} history={payload(series('institutional_holders', { observations: [observation(10, '2026-03-31'), observation(12, '2026-06-30')] }))} />);
    expect(screen.getByText(/四半期観測（日次ではありません）/)).toHaveTextContent('前四半期比 2');
    expect(screen.getByText(/最新の記録も分析基準日より前/)).toBeInTheDocument();
    expect(screen.getAllByText('2026-10-10T01:00:00Z')).toHaveLength(2);
    expect(screen.getByText(/取得日時は当時の公表済みを証明しません/)).toBeInTheDocument();
  });
  it('keeps unlike population histories separate and excludes other markets', () => {
    render(<MarketIndicatorHistory {...props} history={payload(series(), series('new_highs', { population: 'other-universe' }), series('new_lows', { market: 'HK' }))} />);
    expect(screen.getAllByRole('table', { name: '新高値の履歴' })).toHaveLength(2);
    expect(screen.getByText(/選択市場と異なる履歴を除外/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '新安値の履歴' })).not.toBeInTheDocument();
  });
  it('renders one selected security while preserving independent market-wide series and original source timestamps', () => {
    const security = (instrument, value) => series('institutional_holders', { instrument, observations: [observation(value, '2026-06-30')] });
    const provenance = { sec: { retrieved_at: '2026-10-10T01:00:00.123456Z', publication_cutoff: '2026-08-31' },
      mappings: [{ symbol: 'AAA', retrieved_at: '2026-09-01T02:00:00.987654Z' }, { symbol: 'BBB', retrieved_at: '2026-09-02T02:00:00.567891Z' }] };
    const { rerender } = render(<MarketIndicatorHistory {...props} provenance={provenance} history={payload(series('new_highs'), security('AAA', 111), security('BBB', 222))} />);
    const selector = screen.getByRole('combobox', { name: '銘柄別履歴の対象銘柄' });
    expect(selector).toHaveValue('AAA');
    expect(screen.getAllByRole('table', { name: '13F 報告運用会社数の履歴' })).toHaveLength(1);
    expect(within(screen.getByRole('table', { name: '13F 報告運用会社数の履歴' })).getByText('111', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('222', { exact: true })).not.toBeInTheDocument();
    expect(screen.getByText(/元記録・UTC.*2026-09-01T02:00:00.987654Z/)).toBeInTheDocument();
    expect(screen.getByText(/元記録・UTC.*2026-10-10T01:00:00.123456Z/)).toHaveTextContent('2026-08-31');
    expect(screen.getByText(/保存履歴の分析基準日/)).toHaveTextContent('取得日ではありません');
    fireEvent.change(selector, { target: { value: 'BBB' } });
    expect(screen.queryByText('111', { exact: true })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '13F 報告運用会社数の履歴' })).getByText('222', { exact: true })).toBeInTheDocument();
    expect(screen.getByText(/元記録・UTC.*2026-09-02T02:00:00.567891Z/)).toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '新高値の履歴' })).getByText('0', { exact: true })).toBeInTheDocument();
    rerender(<MarketIndicatorHistory {...props} history={payload(security('CCC', 333))} />);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText('222', { exact: true })).not.toBeInTheDocument();
    expect(within(screen.getByRole('table', { name: '13F 報告運用会社数の履歴' })).getByText('333', { exact: true })).toBeInTheDocument();
  });
  it('marks a security metric missing for the selected symbol instead of showing a different security', () => {
    render(<MarketIndicatorHistory {...props} history={payload(series('institutional_holders', { instrument: 'AAA', observations: [observation(100, '2026-06-30')] }), series('base_count', { instrument: 'BBB' }))} />);
    expect(screen.getByText(/ベース番号：比較可能な履歴は未取得/)).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: 'ベース番号の履歴' })).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'BBB' } });
    expect(screen.getByRole('table', { name: 'ベース番号の履歴' })).toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '13F 報告運用会社数の履歴' })).not.toBeInTheDocument();
    expect(screen.getByText(/13F 報告運用会社数：比較可能な履歴は未取得/)).toBeInTheDocument();
  });
  it('explains excluded requested symbols even when every history is unavailable, without rendering malformed objects', () => {
    render(<MarketIndicatorHistory {...props} history={payload()} provenance={{ selection: { unavailable: [
      { symbol: 'AAA', reason: '保存済み対応表に一意な銘柄対応がありません。' },
      { symbol: 'BBB', reason: '複数CUSIPが同じ銘柄へ対応し、比較対象を確定できません。' },
      null, [], { symbol: {}, reason: [] },
    ] } }} />);
    const excluded = screen.getByRole('list', { name: '履歴を確認できない銘柄' });
    expect(within(excluded).getAllByRole('listitem')).toHaveLength(5);
    expect(excluded).toHaveTextContent('履歴未確認：AAA — 保存済み対応表に一意な銘柄対応がありません。');
    expect(excluded).toHaveTextContent('履歴未確認：BBB — 複数CUSIPが同じ銘柄へ対応');
    expect(within(excluded).getAllByText('履歴未確認：未確認 — 未確認')).toHaveLength(3);
    expect(screen.getAllByText(/比較可能な履歴は未取得です/)).toHaveLength(9);
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });
});
