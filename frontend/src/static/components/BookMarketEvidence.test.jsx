import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import BookMarketEvidence from './BookMarketEvidence';
import { BOOK_MARKET_VERSION } from '../bookMarketEvidence';
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }) => <div>{children}</div>, LineChart: ({ children }) => <div>{children}</div>,
  CartesianGrid: () => null, Legend: () => null, Line: () => null, Tooltip: () => null, XAxis: () => null, YAxis: () => null,
}));
const date = '2026-09-21';
const latest = { date, coverage: 100, expectedUniverseSize: 1000, coveragePct: 10,
  newHighs: 5, newLows: 2, leaderCount: 10, setupProxyCount: 3, breakoutProxyCount: 1,
  upVolume: 1000, downVolume: 500, upDollarVolume: 100000, downDollarVolume: 50000,
  cohort: { selectedAt: '2026-07-01', size: 12, observed: 10, missing: 2, below50: 4, lostLeaderStatus: 3, meanReturnPct: 2, indexReturnPct: null } };
const evidence = { version: BOOK_MARKET_VERSION, as_of_date: date, currentSnapshotComplete: true, latest,
  series: [latest], breakoutEvents: [], methods: {}, unknowns: [] };
describe('book market evidence display', () => {
  it('does not show old evidence as matching a newer manifest', () => {
    render(<BookMarketEvidence evidence={evidence} expectedDate="2026-09-22" />);
    expect(screen.getByText(/分析日が一致しません/)).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: '先導株と市場の内訳' })).not.toBeInTheDocument();
  });
  it('displays partial coverage, missing cohort members and unknown index explicitly', () => {
    render(<BookMarketEvidence evidence={evidence} expectedDate={date} />);
    expect(screen.getByText(/100 \/ 1,000銘柄/)).toBeInTheDocument();
    expect(screen.getByText(/観測 10、欠測 2/)).toBeInTheDocument();
    expect(screen.getByText(/同日の指数OHLCVが不足/)).toBeInTheDocument();
    expect(screen.getByText(/実際のVCP完成・初回ブレイク/)).toBeInTheDocument();
  });
});
