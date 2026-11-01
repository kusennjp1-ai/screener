import { describe, it, expect, afterEach } from 'vitest';
import { fireEvent, render, screen, cleanup } from '@testing-library/react';
import { HistoricalBreadth } from './MarketHistoryExplorer';
import { bifurcation, environmentPoint } from '../marketLongHistory';

const base = { coverage: 200, eligibleUniverse: 200, leaderCount: 40, above50Percent: 55 };
const point = (date, extra) => ({ date, ...base, trendTemplateCount: 30, rs90TemplateCount: 6, trendTemplatePercent: 15, above150: 110, above150Percent: 55, above200: 90, above200Percent: 45,
  stage1: 50, stage2: 70, stage3: 40, stage4: 40, breakouts: 3, breakoutsJudged: 8, breakoutsHeld: 6, ...extra });
const history = { as_of_date: '2026-10-23', retrieved_at: '2026-10-27', universe: { symbols: Array.from({ length: 200 }, (_, i) => `S${i}`) },
  breadth: [point('2026-09-23', { trendTemplateCount: 20 }), point('2026-10-23')], sectorRotation: { frames: [] } };
afterEach(cleanup);

describe('market environment history', () => {
  it('derives stage shares and keeps a small breakout sample unknown', () => {
    const value = environmentPoint(point('2026-10-23', { breakoutsJudged: 4, breakoutsHeld: 4 }));
    expect(value.stage2Percent).toBe(35);
    expect(value.breakoutHoldPercent).toBeNull();
    expect(environmentPoint(point('2026-10-23')).breakoutHoldPercent).toBe(75);
    expect(environmentPoint({ date: '2026-10-23', coverage: 0, stage2: null }).stage2Percent).toBeNull();
  });

  it('flags an index near its high while few stocks are above the 200-day line', () => {
    const sp500 = Array.from({ length: 260 }, (_, i) => ({ date: `d${i}`, close: 100 + i * 0.1 }));
    expect(bifurcation({ sp500, breadth: [point('2026-10-23')] }).warning).toBe(true);
    expect(bifurcation({ sp500, breadth: [point('2026-10-23', { above200Percent: 62 })] }).warning).toBe(false);
    expect(bifurcation({ sp500: sp500.slice(0, 100), breadth: [point('2026-10-23')] })).toBeNull();
  });

  it('opens on the trend template count and shows the stage mix', () => {
    render(<HistoricalBreadth history={history} />);
    expect(screen.getByRole('button', { name: 'トレンドテンプレート達成数' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('30銘柄')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ステージ構成' }));
    expect(screen.getByRole('img', { name: /ステージ構成の長期推移/ })).toBeInTheDocument();
    expect(screen.getByText(/^35(\.0)?%$/)).toBeInTheDocument();
  });
});
