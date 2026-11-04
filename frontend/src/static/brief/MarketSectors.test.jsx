import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import MarketSectors from './MarketSectors';

const SYMBOLS = ['XLB', 'XLC', 'XLE', 'XLF', 'XLI', 'XLK', 'XLP', 'XLRE', 'XLU', 'XLV', 'XLY'];
const days = n => Array.from({ length: n }, (_, i) => new Date(Date.parse('2026-10-23T00:00:00Z') - (n - 1 - i) * 86400000).toISOString().slice(0, 10));
const frame = (date, order) => ({ date, ranks: order.map((symbol, i) => ({ symbol, rank: i + 1, relativeIndex: 120 - i * 4 })) });

describe('brief sector ranks', () => {
  it('ranks the newest frame with each value as published and the rank a month earlier, said in words', () => {
    const dates = days(30), earlier = [...SYMBOLS].reverse();
    render(<MarketSectors history={{ sectorRotation: { frames: dates.map((date, i) => frame(date, i < 9 ? earlier : SYMBOLS)) } }} date="2026-10-23" />);
    expect(screen.getByRole('heading', { level: 3 }).closest('header')).toHaveTextContent('セクターの強さ対SPYの相対価格（126営業日・独自RS）◷ 10/23 引け');
    const items = within(screen.getByRole('list', { name: '2026-10-23のセクター順位。126営業日の対SPY相対価格。' })).getAllByRole('listitem');
    expect(items).toHaveLength(11);
    // XLB was 11th 21 frames earlier and is 1st now; XLY moved the other way.
    expect(items[0]).toHaveAccessibleName('1位 素材 XLB 相対価格 120.0・1か月前は11位');
    expect(items[0]).toHaveTextContent('▲10');
    expect(items[10]).toHaveTextContent('▼10');
    // The value is the published one (100 = SPY), never relabelled as a return; the bar is that value against 100.
    expect(items[0]).toHaveTextContent('120.0');
    expect(items[0].querySelector('.brief-sector-bar i')).toHaveClass('is-up');
    expect(items[10].querySelector('.brief-sector-bar i')).toHaveClass('is-down');
    expect(screen.getByText(/▲▼は1か月前（10\/2）からの順位の変化です。/)).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/[+−]\d+\.\d%/);
  });

  it('dates an older frame and never invents ranks or moves it does not have', () => {
    const { unmount } = render(<MarketSectors history={{ sectorRotation: { frames: [frame('2026-10-22', SYMBOLS)] } }} date="2026-10-23" />);
    expect(screen.getByText('10/22時点')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')[0]).not.toHaveTextContent(/[▲▼]/);
    expect(screen.getByText(/1か月前の順位はまだありません。/)).toBeInTheDocument();
    unmount();
    render(<MarketSectors history={{ sectorRotation: { frames: [frame('2026-10-23', SYMBOLS.slice(0, 10))] } }} date="2026-10-23" />);
    expect(screen.getByText('この日の11セクターすべてを確認できません。')).toBeInTheDocument();
    expect(screen.queryByRole('list')).toBeNull();
  });
});
