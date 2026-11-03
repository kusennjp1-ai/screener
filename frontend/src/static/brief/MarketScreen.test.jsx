import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketScreen from './MarketScreen';

const index = symbol => ({ symbol, available: true, points: [{ date: '2026-10-02', value: 3 }], events: [], latest: { date: '2026-10-02', value: 3 }, lastObserved: { date: '2026-10-02', value: 3 },
  followThrough: { available: false, method: 'rally-attempt-gain1.2-day4-15-decline6-v1', reason: '指数OHLCVに欠測・重複・不正値があります。' } });
const show = trends => render(<MemoryRouter><MarketScreen brief={{ trends, date: '2026-10-02', market: { label: '上昇トレンド（独自判定）', cap: 0.5 }, marketLoading: false }} /></MemoryRouter>);

describe('brief market screen', () => {
  it('names a withdrawn long history in the update disclosure instead of 未取得 or 未確認', () => {
    show({ loading: false, error: false, data: { as_of_date: '2026-10-02', indices: [index('^GSPC'), index('^IXIC')],
      long_history_error: '長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 観測範囲）。', long_history_error_key: 'coverage' } });
    const history = screen.getByRole('region', { name: '市場環境の推移' });
    expect(within(history).getByRole('alert')).toHaveTextContent('長期市場履歴の整合性を確認できないため、長期集計を表示しません（検証項目: 観測範囲）。');
    expect(history.querySelector('[data-update-state]')).toHaveAttribute('data-update-state', 'withdrawn');
    expect(history.querySelector('.market-update-status')).toHaveTextContent('長期履歴は検証で除外');
    for (const label of ['長期履歴の最終日', '長期履歴の取得']) expect(within(history).getByText(label, { selector: 'dt' }).nextElementSibling).toHaveTextContent(/^検証で除外$/);
    expect(history.querySelector('summary')).not.toHaveTextContent(/未取得|未確認|履歴更新待ち/);
  });

  it('opens the long history with what it says today: the count a year earlier, its range and the leading sectors', () => {
    const days = Array.from({ length: 260 }, (_, i) => new Date(Date.UTC(2025, 9, 1) + i * 86400000).toISOString().slice(0, 10));
    const breadth = days.map((date, i) => ({ date, coverage: 100, eligibleUniverse: 100, leaderCount: 10 + (i % 50) }));
    const ranks = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'].map((symbol, j) => ({ symbol, rank: j + 1, relativeIndex: 110 - j }));
    show({ loading: false, error: false, data: { as_of_date: '2026-10-02', indices: [index('^GSPC'), index('^IXIC')],
      long_history: { as_of_date: days.at(-1), retrieved_at: `${days.at(-1)}T21:00:00Z`, universe: { symbols: ['A'] }, breadth, sp500: [], sectorRotation: { frames: [{ date: days.at(-1), ranks }] } } } });
    const history = screen.getByRole('region', { name: '市場環境の推移' });
    expect(within(history).getByText('先導株数（価格条件）は1年前の18から19銘柄（1年の範囲 10〜59）。セクターの上位は素材・通信サービス・エネルギー。')).toBeInTheDocument();
  });

  it('names a fetch failure of the series in the history section by its cause', () => {
    show({ loading: false, error: true, data: undefined, failureReason: new TypeError('Failed to fetch') });
    const history = screen.getByRole('region', { name: '市場環境の推移' });
    expect(within(history).getByRole('alert')).toHaveTextContent(/^長期履歴を取得できません（通信エラー）。$/);
  });
});
