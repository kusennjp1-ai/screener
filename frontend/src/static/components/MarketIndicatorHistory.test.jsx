import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import MarketIndicatorHistory from './MarketIndicatorHistory';
import { observation, series, payload } from '../../../tools/fixtures/market-history.mjs';

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
});
