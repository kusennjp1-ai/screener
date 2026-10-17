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
  it('hides unrelated old events instead of accepting a nonempty event array', () => {
    render(<BookMarketEvidence evidence={{ ...evidence, series: [{ ...latest, breakoutProxyCount: 0 }], breakoutEvents: [{ date: '2025-01-02', symbol: 'UNRELATED' }] }} expectedDate={date} />);
    expect(screen.getByText(/日別件数が履歴と一致しません/)).toBeInTheDocument();
    expect(screen.queryByText('UNRELATED')).not.toBeInTheDocument();
    expect(screen.queryByRole('table', { name: '上放れ代理条件の発生履歴' })).not.toBeInTheDocument();
  });
  it('masks legacy whole-cohort zeros when some members are missing and labels observed zeros', () => {
    const partial = { ...latest, cohort: { ...latest.cohort, below50: 0, lostLeaderStatus: 0, observedBelow50: 0, observedLostLeaderStatus: 0 } };
    render(<BookMarketEvidence evidence={{ ...evidence, latest: partial }} expectedDate={date} />);
    expect(screen.getByText(/固定した母集団全体/)).toHaveTextContent('50日線割れ 未確認 ／ 先導条件から外れた銘柄 未確認');
    expect(screen.getByText(/観測できた 10銘柄だけの内訳/)).toHaveTextContent('50日線割れ 0 ／ 先導条件外 0');
    expect(screen.getByText(/この部分集計の0件は/)).toBeInTheDocument();
  });
  it('does not describe missing proxy evaluations as no events', () => {
    render(<BookMarketEvidence evidence={{ ...evidence, series: [{ ...latest, breakoutProxyCount: null }] }} expectedDate={date} />);
    expect(screen.getByText(/この期間の発生件数は未確認/)).toBeInTheDocument();
    expect(screen.getByText(/未確認を0件として扱いません/)).toBeInTheDocument();
  });
  it.each([
    { observed: 0, missing: 12, observedBelow50: null, observedLostLeaderStatus: null },
    { observed: 10, missing: 2, observedBelow50: null, observedLostLeaderStatus: null },
    { observed: 10, missing: 2, observedBelow50: 2, observedLostLeaderStatus: 1 },
  ])('does not use the zero warning without an observed zero: %j', counts => {
    const partial = { ...latest, cohort: { ...latest.cohort, ...counts } };
    render(<BookMarketEvidence evidence={{ ...evidence, latest: partial }} expectedDate={date} />);
    expect(screen.queryByText(/この部分集計の0件は/)).not.toBeInTheDocument();
    if (counts.observed === 0) {
      expect(screen.getByText(/対象日の構成銘柄データを取得できていない/)).toHaveTextContent('50日線割れ 未確認 ／ 先導条件外 未確認');
    } else {
      expect(screen.getByText(/部分集計から欠測銘柄の状態は判断できません/)).toBeInTheDocument();
    }
  });
  it('labels measured zero as applying only to the observed population', () => {
    render(<BookMarketEvidence evidence={{ ...evidence, series: [{ ...latest, breakoutProxyCount: 0 }] }} expectedDate={date} />);
    expect(screen.getByText(/観測できた母集団では.*0件/)).toBeInTheDocument();
  });
  it('warns on old latest dates even if the payload completeness flag is true', () => {
    render(<BookMarketEvidence evidence={{ ...evidence, latest: { ...latest, date: '2026-09-18' } }} expectedDate={date} />);
    expect(screen.getByText(/表示は 2026-09-18 時点/)).toBeInTheDocument();
  });
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
