import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MarketCard from './MarketCard';

const point = (date, over = {}) => ({ date, coverage: 200, eligibleUniverse: 200, trendTemplateCount: 30, rs90TemplateCount: 8, above200: 90, above200Percent: 45, stage1: 50, stage2: 70, stage3: 40, stage4: 40, breakoutsJudged: 8, breakoutsHeld: 6, newHighs: 40, newLows: 12, ...over });
const trends = asOf => ({ data: { indices: [{ symbol: '^GSPC', latest: { date: asOf, value: 3 }, events: [] }, { symbol: '^IXIC', latest: { date: asOf, value: 4 }, events: [] }],
  long_history: { as_of_date: asOf, breadth: [point('2026-09-30'), point(asOf)], sp500: [] } } });
const show = (asOf, date) => render(<MemoryRouter><MarketCard market={{ label: '上昇トレンド（独自判定）', cap: 0.5 }} trends={trends(asOf)} date={date} /></MemoryRouter>);

describe('brief market card', () => {
  it('shows the environment counts for the analysis date without an as-of note', () => {
    show('2026-10-02', '2026-10-02');
    expect(screen.getByText('30銘柄')).toBeInTheDocument();
    expect(screen.getByText('3・4')).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('40・12')).toBeInTheDocument();
    expect(screen.getByText('差 +28')).toBeInTheDocument();
    expect(screen.getByText('8銘柄')).toBeInTheDocument();
    expect(screen.queryByRole('note', { name: '' })).toBeNull();
    expect(screen.queryByText(/時点（分析基準日/)).toBeNull();
  });

  it('labels an older long history and index observation with its own date', () => {
    show('2026-10-01', '2026-10-02');
    expect(screen.getByText(/長期集計は 2026-10-01 時点・分配日は 2026-10-01 時点（分析基準日 2026-10-02 の再集計待ち）/)).toBeInTheDocument();
  });

  it('keeps unknown values unknown when the history has no environment fields', () => {
    render(<MemoryRouter><MarketCard market={{ state: 'unknown', label: '市場未確認', cap: 0 }} trends={{ data: null }} date="2026-10-02" /></MemoryRouter>);
    expect(screen.getAllByText('未取得').length).toBeGreaterThan(0);
    expect(screen.getByText('市場未確認')).toBeInTheDocument();
    expect(screen.getAllByText('未確認').length).toBeGreaterThan(0);
    expect(screen.queryByText(/^0・0$/)).toBeNull();
  });
});
