import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import MarketPulse from './MarketPulse';

describe('MarketPulse', () => {
  it('separates the exported ten-day ratio from the latest daily counts', () => {
    const { container } = render(<MarketPulse current={{ date: '2026-09-30', ratio_10day: .82, stocks_up_4pct: 198, stocks_down_4pct: 235 }} history={[]} range="1M" onRangeChange={() => {}} />);
    expect(screen.getByRole('heading', { name: '下落の広がりに注意' })).toBeInTheDocument();
    expect(screen.getByLabelText('10日上昇下落レシオ')).toHaveTextContent('0.82倍');
    const daily = screen.getByRole('group', { name: '直近取引日の4%以上騰落銘柄数' });
    expect(daily).toHaveTextContent('直近1日 · 2026-09-30');
    expect(daily).toHaveTextContent('上昇198銘柄下落235銘柄差し引き−37銘柄');
    expect(daily).not.toHaveTextContent('0.82');
    const bar = container.querySelector('.breadth-pulse-balance > span');
    expect(parseFloat(bar.style.width)).toBeCloseTo(198 / (198 + 235) * 100);
    const details = screen.getByText('指標の読み方と注意点').closest('details');
    expect(details).not.toHaveAttribute('open');
    fireEvent.click(screen.getByText('指標の読み方と注意点'));
    expect(details).toHaveAttribute('open');
    expect(within(details).getByText(/直近1日の銘柄数を割った値ではありません/)).toBeVisible();
    expect(within(details).getByText(/総合的な買い判定ではありません/)).toBeVisible();
  });

  it('preserves missing values rather than implying a flat or balanced market', () => {
    const { container } = render(<MarketPulse current={{ date: '2026-09-30' }} history={[]} range="1M" onRangeChange={() => {}} />);
    expect(screen.getByRole('heading', { name: '市場の広がりは未確認' })).toBeInTheDocument();
    expect(screen.getByLabelText('10日上昇下落レシオ')).toHaveTextContent('—倍');
    const daily = screen.getByRole('group', { name: '直近取引日の4%以上騰落銘柄数' });
    expect(daily).toHaveTextContent('上昇—銘柄下落—銘柄差し引き—銘柄');
    expect(container.querySelector('.breadth-pulse-balance')).toBeNull();
    expect(screen.getByText('推移データが不足しています。')).toBeInTheDocument();
  });

  it('retains period controls and distinguishes genuine zero counts from missing data', () => {
    const change = vi.fn();
    const { container } = render(<MarketPulse current={{ date: '2026-09-30', ratio_10day: 1, stocks_up_4pct: 0, stocks_down_4pct: 0 }} history={[]} range="1M" onRangeChange={change} />);
    expect(screen.getByRole('heading', { name: '上昇・下落が拮抗' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '直近取引日の4%以上騰落銘柄数' })).toHaveTextContent('上昇0銘柄下落0銘柄差し引き±0銘柄');
    expect(container.querySelector('.breadth-pulse-balance')).toBeNull();
    expect(screen.getByRole('button', { name: '1か月' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '3か月' }));
    expect(change).toHaveBeenCalledWith('3M');
  });
});
