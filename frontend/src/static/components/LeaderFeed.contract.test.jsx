import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ResearchHero from './ResearchHero';
import LeaderPost, { DailyConditionStrip, RSRing, PriceSparkline, FeedMiniChart } from './LeaderPost';
import { entryPlan, assess } from '../researchEngine';
import { entryReadiness } from '../entryReadiness';
import { verifiedVolumeRatio } from '../qualificationAudit';
import { withAuditFixture } from '../testAuditFixture';
import registry from '../../../contracts/financial_instrument_applicability_v1.json';

// Deliberately contradictory synthetic UI fixtures, never production data.
// These assertions bind the feed to existing canonical calculations, not a
// second UI-side formula. Chart loading is independently tested below.
const queryFixture = vi.hoisted(() => ({ payload: undefined }));
vi.mock('@tanstack/react-query', () => ({ useQuery: options => {
  try { return { data: queryFixture.payload ? options.select(queryFixture.payload) : undefined, isLoading: false }; }
  catch { return { data: undefined, isError: true, isLoading: false }; }
} }));
vi.mock('./PortfolioDecision', () => ({ default: () => null }));
vi.mock('./SetupRadar', () => ({ default: () => null }));
vi.mock('../useWorkbench', () => ({ useWorkbenchDetails: () => ({ isLoading: true }) }));
afterEach(() => { cleanup(); queryFixture.payload = undefined; });
const date = '2026-09-25';
const now = Date.parse('2026-09-26T10:00:00Z');
const market = { cap: .5, label: '上昇' };
const rowFixture = (extra = {}) => withAuditFixture({
  symbol: 'LEAD', company_name: 'Contract fixture', market: 'US', current_price: 104,
  se_pivot_price: 100, rs_rating: 95, se_volume_vs_50d: 9, adv_usd: 50000000,
  entry_evidence: { as_of_date: date, volumeRatio: 8,
    calendar: { latest_completed_session: date, evaluated_at: '2026-09-26T09:00:00Z', valid_until: '2026-09-28T20:00:00Z' },
    earnings: { date: '2026-10-20', checked_at: '2026-09-26T09:00:00Z' },
    shape: { candidate: true } }, ...extra,
}, date);
const itemFor = (row, method = 'minervini') => ({ row, assessment: assess(row, method, now),
  plan: entryPlan(row, null, method), readiness: entryReadiness(row, date, market, now, method),
  volume: verifiedVolumeRatio(row, date) });

describe('LEADER feed preserves canonical screening contracts', () => {
  it('uses audited exact volume, not the copied entry or legacy ratios', () => {
    const row = rowFixture(); row.technical_audit.values.volumeRatio = 1.399999;
    const item = itemFor(row);
    expect(item.volume).toBe(1.399999);
    expect(item.readiness.rules.find(rule => rule.id === 'volume').state).toBe('fail');
    const before = structuredClone(item);
    const { container } = render(<LeaderPost item={item} date={date} method="minervini" />);
    expect(container.textContent).not.toMatch(/9\.00倍|8\.00倍/);
    expect(container.textContent).toMatch(/1\.40/); // Display rounding must not turn the condition into a pass.
    expect(item).toEqual(before);
  });
  it.each(['minervini', 'minervini2', 'oneil', 'ibd'])('keeps %s zone boundaries and daily conditions', method => {
    const item = itemFor(rowFixture(), method);
    const expectedZone = method === 'minervini2' ? 3 : 5;
    expect(item.plan.upper).toBe(100 * (1 + expectedZone / 100));
    expect(item.plan.state).toBe(method === 'minervini2' ? '買いゾーン超過' : '買いゾーン内');
    expect(item.readiness.rules.find(rule => rule.id === 'price').state).toBe(method === 'minervini2' ? 'fail' : 'pass');
    const { container } = render(<LeaderPost item={item} date={date} method={method} />);
    expect(container.textContent).toContain(item.plan.state);
    expect(item.readiness.total).toBe(7);
  });
  it('does not substitute a zero ring for missing or malformed RS', () => {
    for (const value of [null, undefined, NaN, '95']) {
      const { container, unmount } = render(<RSRing value={value} />);
      expect(container.textContent).toContain('データなし');
      expect(container.textContent).not.toMatch(/\b0\b/);
      unmount();
    }
  });
  it('retains the exact seven conditions, including pass, fail and unknown', () => {
    const row = rowFixture(); row.entry_evidence.shape.candidate = false;
    row.entry_evidence.earnings = null;
    const readiness = itemFor(row).readiness;
    expect(readiness.rules.map(rule => rule.id)).toEqual(['selection', 'market', 'date', 'price', 'volume', 'shape', 'earnings']);
    const { container } = render(<DailyConditionStrip readiness={readiness} />);
    for (const state of ['pass', 'fail', 'unknown']) {
      expect(container.querySelectorAll(`[data-state="${state}"]`).length).toBe(readiness.rules.filter(rule => rule.state === state).length);
    }
    expect(readiness.ready).toBe(false);
  });
  it('keeps verified fund exclusion not-applicable, never pass or missing', () => {
    const record = registry.records[0];
    const row = rowFixture({ symbol: record.symbol, company_name: record.name, market: record.market });
    const readiness = itemFor(row).readiness;
    expect(readiness.rules[0].state).toBe('not_applicable');
    expect(readiness.ready).toBe(false);
    const { container } = render(<DailyConditionStrip readiness={readiness} />);
    expect(container.querySelectorAll('[data-state="not_applicable"]')).toHaveLength(1);
    expect(container.innerHTML).toContain('対象外');
  });
  it('makes missing daily evidence explicit instead of rendering seven green successes', () => {
    const { container } = render(<DailyConditionStrip readiness={null} />);
    expect(container.querySelectorAll('[data-state="pass"]')).toHaveLength(0);
    expect(container.textContent).toMatch(/未確認|データなし/);
  });
});

// The pinned post is intentionally the unfiltered Minervini overview. A user
// switching another strategy must not mistake it for that strategy's counts.
it('labels summary scope and keeps counts tied to supplied canonical ranked rows', () => {
  const ranked = [
    { row: rowFixture(), assessment: { qualified: true } },
    { row: rowFixture({ symbol: 'WAIT', current_price: 99 }), assessment: { qualified: true } },
    { row: rowFixture({ symbol: 'FAIL' }), assessment: { qualified: false } },
  ];
  const { container } = render(<ResearchHero rows={[]} ranked={ranked} date={date}
    plan={{ allocationCap: 0, market: { label: '市場未確認' } }} workbench={{}} method="oneil" />);
  expect(container.textContent).toContain('ミネルヴィニ全候補');
  expect(container.querySelector('h1')).toHaveTextContent('選定候補は 2 銘柄。');
  expect(container.querySelector('.zone-text')).toHaveTextContent('1 銘柄');
});

// Three actual published AAPL sessions, copied from the 2026-10-23 immutable
// chart payload AAPL-edda9bde9241c0ac.json. Historical fixtures, not live quotes.
const publishedBars = [
  { date: '2026-10-21', open: 339.36, high: 345.25, low: 338.83, close: 343.99, volume: 35614100 },
  { date: '2026-10-22', open: 344.94, high: 348.36, low: 342.28, close: 348.22, volume: 46898900 },
  { date: '2026-10-23', open: 349.11, high: 351.73, low: 345.75, close: 347.73, volume: 39450857 },
];
it('draws exactly the actual closing-price points without invented or smoothed data', () => {
  const { container } = render(<PriceSparkline bars={publishedBars} symbol="AAPL" />);
  const points = container.querySelector('polyline').getAttribute('points').split(' ').map(point => point.split(',').map(Number));
  expect(points).toHaveLength(3);
  expect(points.map(point => point[0])).toEqual([4, 140, 276]);
  expect(points[0][1]).toBe(48); expect(points[1][1]).toBe(8);
  expect(points[2][1]).toBeCloseTo(48 - (347.73 - 343.99) / (348.22 - 343.99) * 40, 12);
  expect(container.querySelector('svg')).toHaveAccessibleName(/2026-10-21〜2026-10-23/);
});
it.each([[], [{ date, close: null }], [{ date, close: 4 }, { date, close: NaN }]])('does not invent a sparkline for missing bars', bars => {
  const { container } = render(<PriceSparkline bars={bars} symbol="NONE" />);
  expect(container.querySelector('polyline')).toBeNull();
  expect(container.textContent).toContain('データなし');
});
it.each(['symbol', 'snapshot', 'lastSession', 'order', 'audit'])('rejects cached chart %s mismatch before SVG rendering', mismatch => {
  const snapshot = '2026-10-23';
  const row = withAuditFixture({ symbol: 'AAPL', current_price: 347.73, chart_path: 'fixture.json' }, snapshot);
  queryFixture.payload = { symbol: 'AAPL', as_of_date: snapshot, bars: structuredClone(publishedBars) };
  if (mismatch === 'symbol') queryFixture.payload.symbol = 'WRONG';
  if (mismatch === 'snapshot') queryFixture.payload.as_of_date = '2026-10-22';
  if (mismatch === 'lastSession') queryFixture.payload.bars.pop();
  if (mismatch === 'order') queryFixture.payload.bars[1].date = '2026-10-20';
  if (mismatch === 'audit') row.technical_audit.as_of_date = '2026-10-22';
  const { container } = render(<FeedMiniChart row={row} date={snapshot} />);
  expect(container.querySelector('polyline')).toBeNull();
  expect(container.textContent).toContain('データなし');
});
it('uses the same-day audited change instead of a conflicting copied percent', () => {
  const row = rowFixture({ price_change_1d: -77 });
  row.technical_audit.values.change = 2.125;
  const { container } = render(<LeaderPost item={itemFor(row)} date={date} />);
  expect(container.querySelector('.leader-post-change')).toHaveTextContent('+2.1%');
  expect(container.querySelector('.leader-post-change')).not.toHaveTextContent('77');
});
it('does not fall back to the copied change when the daily audit is stale', () => {
  const row = rowFixture({ price_change_1d: 77 });
  row.technical_audit.as_of_date = '2026-09-24';
  const { container } = render(<LeaderPost item={itemFor(row)} date={date} />);
  expect(container.querySelector('.leader-post-change')).toHaveTextContent('データなし');
});
it('renders a valid cached same-symbol same-session chart from actual bars', () => {
  const snapshot = '2026-10-23';
  const row = withAuditFixture({ symbol: 'AAPL', current_price: 347.73, chart_path: 'fixture.json' }, snapshot);
  queryFixture.payload = { symbol: 'AAPL', as_of_date: snapshot, bars: publishedBars };
  const { container } = render(<FeedMiniChart row={row} date={snapshot} />);
  expect(container.querySelector('polyline')).not.toBeNull();
});
it('renders flat real closes as a flat line rather than adding decorative volatility', () => {
  const bars = publishedBars.map(bar => ({ ...bar, close: 100 }));
  const { container } = render(<PriceSparkline bars={bars} symbol="FLAT" />);
  const points = container.querySelector('polyline').getAttribute('points').split(' ');
  expect(points).toEqual(['4,28', '140,28', '276,28']);
});
