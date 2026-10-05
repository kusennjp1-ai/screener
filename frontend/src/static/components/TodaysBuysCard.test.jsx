import { act, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../test/renderWithProviders';
import TodaysBuysCard from './TodaysBuysCard';
import { dailyObservationIndex } from '../testDailyObservationFixture';

const entries = dailyObservationIndex.symbols;
const renderCard = (props = {}) => renderWithProviders(<MemoryRouter><TodaysBuysCard indexData={dailyObservationIndex} {...props} /></MemoryRouter>);
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-02T22:00:00Z')); });
afterEach(() => { localStorage.clear(); vi.useRealTimers(); });

it('keeps exact CDNA and TER observations without joining incompatible trade models', () => {
  const before = JSON.stringify(dailyObservationIndex);
  localStorage.setItem('todaysBuysEquity', '100000');
  renderCard({ scanRows: [{ market_regime: 'confirmed_uptrend' }] });
  const card = screen.getByTestId('todays-buys-card');
  expect(card).toHaveTextContent('テクニカル観測記録');
  expect(card).toHaveTextContent('2銘柄 · 基準日 2026-10-01');
  const cdna = screen.getByTestId('todays-buys-row-CDNA'), ter = screen.getByTestId('todays-buys-row-TER');
  expect(cdna).toHaveTextContent('記録終値 66.23 · シグナル基準値 65.63 · 基準値比 +0.9%');
  expect(ter).toHaveTextContent('記録終値 415.79 · シグナル基準値 403.56 · 基準値比 +3.0%');
  expect(cdna).toHaveTextContent('モデル停止水準 59.07 · 初期モデル');
  expect(ter).toHaveTextContent('モデル停止水準 377.33 · 初期モデル');
  expect(card).toHaveTextContent('別の売却モデルの参考値');
  expect(card.textContent).not.toMatch(/BUY NOW|今日の買い候補|買い2|now |STOP|2R|3R|risk |size |株数|資金|43\.59|407\.69|78\.76|85\.32|456\.03|482\.26|15\.6%|1\.25%|8\.0%/);
  expect(JSON.stringify(dailyObservationIndex)).toBe(before);
  expect(localStorage.getItem('todaysBuysEquity')).toBe('100000');
});

it.each([undefined, null, 0, 1, 2, 3])('does not turn unknown market or barrel count %j into a purchase verdict', barrels => {
  renderCard({ scanRows: [], indexData: { ...dailyObservationIndex, symbols: [{ ...entries[0], buy: { ...entries[0].buy, barrels_passed: barrels } }] } });
  expect(screen.getByTestId('todays-buys-market-context')).toHaveTextContent('未確認');
  expect(screen.getByTestId('todays-buys-position-CDNA')).toHaveTextContent('基準値より上');
  expect(screen.getByTestId('todays-buys-row-CDNA')).toHaveTextContent(`旧モデル確認数（barrels） ${barrels == null ? '未確認' : `${barrels}/3（記録値）`}`);
  expect(screen.getByTestId('todays-buys-card')).toHaveTextContent('現在の購入条件通過を示しません');
  expect(screen.getByTestId('todays-buys-card').textContent).not.toMatch(/BUY NOW|WAIT|EXTENDED|買い1/);
});

it.each(['correction', 'downtrend', 'uptrend_under_pressure', 'confirmed_uptrend'])('keeps the exported records and factual market context for %s', regime => {
  renderCard({ scanRows: [{ market_regime: regime, market_distribution_days: 8 }] });
  expect(screen.getByTestId('todays-buys-market-context')).toHaveTextContent('分配日 8');
  expect(screen.getByTestId('todays-buys-row-CDNA')).toBeInTheDocument();
  expect(screen.getByTestId('todays-buys-card').textContent).not.toMatch(/新規買い停止|SEPAルール1|数を絞る|弱い時は少なく/);
});

it.each([[undefined, 'unknown'], ['invalid', 'unknown'], ['2026-02-30', 'unknown'], ['2026-10-03', 'future'], ['2020-01-02', 'old']])('propagates snapshot date %j as %s to every exit-model reference', (asOf, expected) => {
  renderCard({ indexData: { ...dailyObservationIndex, as_of_date: asOf } });
  expect(screen.getByTestId('todays-buys-card')).toHaveAttribute('data-freshness', expected);
  for (const reference of screen.getAllByTestId('sell-timing')) expect(reference).toHaveAttribute('data-freshness', expected);
  expect(screen.getByTestId('todays-buys-card')).toHaveTextContent('未確認');
});

it('updates calendar age and child references while the same snapshot remains mounted', () => {
  vi.setSystemTime(new Date('2026-10-05T03:59:30Z'));
  renderCard();
  expect(screen.getByTestId('todays-buys-card')).toHaveAttribute('data-freshness', 'unverified');
  act(() => vi.advanceTimersByTime(60_000));
  expect(screen.getByTestId('todays-buys-card')).toHaveAttribute('data-freshness', 'old');
  for (const reference of screen.getAllByTestId('sell-timing')) {
    expect(reference).toHaveAttribute('data-freshness', 'old');
    expect(reference).toHaveTextContent('4暦日・最新取引日は未確認');
  }
});

it('retains source order and honest missing prices when some records have no buy block', () => {
  renderCard({ indexData: { ...dailyObservationIndex, symbols: [entries[1], { symbol: 'MISSING' }, entries[0]] } });
  expect(screen.getAllByTestId(/^todays-buys-row-/).map(row => row.dataset.testid)).toEqual(['todays-buys-row-TER', 'todays-buys-row-MISSING', 'todays-buys-row-CDNA']);
  expect(screen.getByTestId('todays-buys-row-MISSING')).toHaveTextContent('記録終値 未確認 · シグナル基準値 未確認');
});
it('renders nothing for a legacy index without observations', () => {
  const { container } = renderCard({ indexData: { symbols: [{ symbol: 'NO_DATA' }] } });
  expect(container.firstChild).toBeNull();
});
it('expands all rows with a real button without changing order', () => {
  renderCard({ indexData: { ...dailyObservationIndex, symbols: Array.from({ length: 21 }, (_, i) => ({ ...entries[0], symbol: `ROW${i}` })) } });
  expect(screen.queryByTestId('todays-buys-row-ROW20')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'すべて表示（21件）' }));
  expect(screen.getAllByTestId(/^todays-buys-row-/)).toHaveLength(21);
});
it('keeps watch and chart actions separate from the Research link', () => {
  const onOpenChart = vi.fn();
  renderCard({ onOpenChart });
  fireEvent.click(screen.getByRole('button', { name: 'CDNAを監視リストに追加' }));
  expect(JSON.parse(localStorage.getItem('todaysWatchlist'))).toEqual(['CDNA']);
  expect(onOpenChart).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'CDNAの記録チャートを開く' }));
  expect(onOpenChart).toHaveBeenCalledWith('CDNA');
  expect(screen.getByRole('link', { name: 'TERの購入条件をResearchで確認' })).toHaveAttribute('href', '/?symbol=TER');
});
it('navigates to the selected Research symbol by keyboard using the supported router route', async () => {
  vi.useRealTimers();
  const user = userEvent.setup();
  function ResearchRoute() { return <div data-testid="destination">{useLocation().search}</div>; }
  renderWithProviders(<MemoryRouter initialEntries={['/daily']}><Routes>
    <Route path="/daily" element={<TodaysBuysCard indexData={dailyObservationIndex} />} />
    <Route path="/" element={<ResearchRoute />} />
  </Routes></MemoryRouter>);
  within(screen.getByTestId('todays-buys-row-TER')).getByRole('link', { name: 'TERの購入条件をResearchで確認' }).focus();
  await user.keyboard('{Enter}');
  expect(screen.getByTestId('destination')).toHaveTextContent('?symbol=TER');
});

it('preserves distinct source dates and a negative difference without current-price or sizing claims', () => {
  renderCard({ marketAsOf: '2026-09-30', scanRows: [{ market_regime: 'confirmed_uptrend' }],
    indexData: { ...dailyObservationIndex, symbols: [{ ...entries[0], buy: { ...entries[0].buy, trigger_price: 100, last_close: 99, signal_as_of: '2026-09-29T00:00:00', barrels_passed: undefined } }] } });
  const card = screen.getByTestId('todays-buys-card');
  expect(card).toHaveTextContent('スキャン基準日 2026-09-30');
  expect(card).toHaveTextContent('配信基準日 2026-10-01 · シグナル基準日 2026-09-29');
  expect(card).toHaveTextContent('基準値比 −1.0%');
  expect(card).toHaveTextContent('旧モデル参考帯（基準値〜+5%） 100.00〜105.00 · 参考帯より下');
  expect(card).toHaveTextContent('検出元 未確認');
  expect(card.textContent).not.toMatch(/-1\.0%|BUY NOW|now |size |資金|株数/);
});

it('keeps native watch and chart controls keyboard-operable and separate', async () => {
  vi.useRealTimers();
  const user = userEvent.setup(), onOpenChart = vi.fn();
  renderCard({ onOpenChart });
  act(() => screen.getByRole('button', { name: 'CDNAを監視リストに追加' }).focus());
  await user.keyboard(' ');
  expect(JSON.parse(localStorage.getItem('todaysWatchlist'))).toEqual(['CDNA']);
  expect(onOpenChart).not.toHaveBeenCalled();
  act(() => screen.getByRole('button', { name: 'CDNAの記録チャートを開く' }).focus());
  await user.keyboard('{Enter}');
  expect(onOpenChart).toHaveBeenCalledExactlyOnceWith('CDNA');
});
it('does not route non-US symbols into the US-only Research page', () => {
  renderCard({ market: 'HK' });
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it.each(['JP', 'HK'])('does not apply the US future-date test to %s scan and signal labels', market => {
  vi.setSystemTime(new Date('2026-10-02T03:00:00Z'));
  renderCard({ market, marketAsOf: '2026-10-02', scanRows: [{ market_regime: 'confirmed_uptrend' }],
    indexData: { as_of_date: '2026-10-02', symbols: [{ ...entries[0], buy: { ...entries[0].buy, signal_as_of: '2026-10-02T00:00:00' } }] } });
  const card = screen.getByTestId('todays-buys-card');
  expect(card).toHaveAttribute('data-freshness', 'unverified');
  expect(card).toHaveTextContent('最新取引日は未確認');
  expect(card).toHaveTextContent('シグナル基準日 2026-10-02');
  expect(screen.getByTestId('todays-buys-market-context')).toHaveTextContent('スキャン基準日 2026-10-02');
  expect(card).not.toHaveTextContent('未来');
});
