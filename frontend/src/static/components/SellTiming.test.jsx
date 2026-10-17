import { fireEvent, screen, within } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SellTiming, { ACTION_META, normalizeSell } from './SellTiming';
import { observationFreshness } from '../technicalObservation';

it('renders an explicitly unverified reference even with no sell data', () => {
  renderWithProviders(<SellTiming sell={null} />);
  const el = screen.getByTestId('sell-timing');
  expect(el).toHaveAttribute('data-action', 'no_data');
  expect(el).toHaveAttribute('data-freshness', 'unknown');
  expect(el).toHaveTextContent('売却モデル未計算');
  expect(el).toHaveTextContent('基準日未確認・鮮度未確認');
});
it('shows a separate initial model stop without interpreting holdings, profit or targets', () => {
  renderWithProviders(<SellTiming sell={{ action: 'hold', stop: 59.07, stop_basis: 'initial', target_2r: 78.76, target_3r: 85.32, r_multiple: 0.09 }} />);
  const el = screen.getByTestId('sell-timing');
  expect(el).toHaveTextContent('売却条件の検出なし（モデル記録）');
  expect(el).toHaveTextContent('モデル停止水準 59.07 · 初期モデル');
  expect(el.textContent).not.toMatch(/利確 |損切り |78\.76|85\.32|0\.09R/);
  expect(el).toHaveTextContent('別の売却モデルの参考値');
  expect(el).toHaveTextContent('あなたの保有・注文・約定を確認したものではありません');
});
it.each(Object.keys(ACTION_META))('labels %s as model evidence, never a current-action instruction', action => {
  renderWithProviders(<SellTiming sell={{ action, stop: 122.5 }} compact />);
  const el = screen.getByTestId('sell-timing');
  expect(el).toHaveTextContent(ACTION_META[action].label);
  expect(el.textContent).not.toMatch(/執行を確認|売り —|強さへ利確|ストップ引き上げ|ストップ上げ|保有継続/);
});
it('normalizes the chart sell_plan shape without changing the source record', () => {
  const sell = { action: 'raise_stop', stop_level: 130.4, targets: { two_r: 160, three_r: 180 } };
  expect(normalizeSell(sell)).toMatchObject({ action: 'raise_stop', stop: 130.4, target2r: 160, target3r: 180 });
  expect(sell).toEqual({ action: 'raise_stop', stop_level: 130.4, targets: { two_r: 160, three_r: 180 } });
});
it('marks a stale saved reading independently of calendar date', () => {
  renderWithProviders(<SellTiming sell={{ action: 'exit', stop: 100 }} stale />);
  expect(screen.getByTestId('sell-timing')).toHaveTextContent('前回の保存記録・鮮度未確認');
  expect(screen.getByTestId('sell-timing')).toHaveAttribute('data-freshness', 'unknown');
  expect(screen.getByTestId('sell-timing')).toHaveAttribute('data-record-source', 'saved');
});
it.each([undefined, 'invalid', '2026-02-30', '2026-10-03', '2020-01-02'])('preserves date limitations for %j in compact view', date => {
  const freshness = observationFreshness(date, Date.parse('2026-10-02T22:00:00Z'));
  renderWithProviders(<SellTiming sell={{ action: 'exit', stop: 100 }} freshness={freshness} compact />);
  expect(screen.getByTestId('sell-timing')).toHaveAttribute('data-freshness', freshness.state);
  expect(screen.getByTestId('sell-timing')).toHaveTextContent(freshness.label);
});
it.each([{}, { action: 'unexpected' }, { action: null }])('does not infer hold from unknown action %j', sell => {
  renderWithProviders(<SellTiming sell={sell} />);
  expect(screen.getByTestId('sell-timing')).toHaveAttribute('data-action', 'no_data');
  expect(screen.getByText('売却モデル未計算')).toBeInTheDocument();
});
it.each([NaN, Infinity, '', ' ', 'invalid', -1, 0, true])('hides invalid levels %j', value => {
  expect(normalizeSell({ action: 'hold', stop: value, target_2r: value, target_3r: value })).toMatchObject({ stop: null, target2r: null, target3r: null });
});
it('preserves a numeric model level without inventing price or execution evidence', () => {
  expect(normalizeSell({ action: 'hold', stop: '118.2', r_multiple: 0 })).toMatchObject({ stop: 118.2, rMultiple: 0 });
});

it('preserves a future-date warning even for a saved model record', () => {
  const freshness = observationFreshness('2026-10-03', Date.parse('2026-10-02T22:00:00Z'));
  renderWithProviders(<SellTiming sell={{ action: 'hold', stop: 59.07 }} freshness={freshness} stale compact />);
  const el = screen.getByTestId('sell-timing');
  expect(el).toHaveAttribute('data-freshness', 'future');
  expect(el).toHaveTextContent('前回の保存記録・鮮度未確認');
  expect(el).toHaveTextContent('基準日が未来・鮮度未確認');
});

it.each([false, true])('explains the loss-cap code while preserving model values and warnings (compact=%s)', compact => {
  const sell = { action: 'hold', stop: 82.52, stop_basis: 'max_loss_cap', stop_pct: 8 };
  const before = JSON.stringify(sell);
  const freshness = observationFreshness('2026-10-01', Date.parse('2026-10-02T22:00:00Z'));
  renderWithProviders(<SellTiming sell={sell} compact={compact} freshness={freshness} />);
  expect(screen.getByText('モデル停止水準 82.52 · モデルの損失率上限を基準')).toBeVisible();
  expect(screen.getByText('売却条件の検出なし（モデル記録）')).toBeVisible();
  expect(screen.getByText(/配信基準日 2026-10-01 · 基準日から1暦日・最新取引日は未確認/)).toBeVisible();
  const details = screen.getByText('売却モデルの説明・元の値').closest('details');
  expect(details).not.toHaveAttribute('open');
  expect(within(details).getByText('stop_basis: max_loss_cap')).not.toBeVisible();
  fireEvent.click(within(details).getByText('売却モデルの説明・元の値'));
  expect(within(details).getByText('stop_basis: max_loss_cap')).toBeVisible();
  expect(within(details).getByText('action: hold')).toBeVisible();
  expect(JSON.stringify(sell)).toBe(before);
});

it('keeps unsupported action and stop-basis codes unconfirmed and inspectable', () => {
  renderWithProviders(<SellTiming sell={{ action: 'future_action', stop: 82.52, stop_basis: 'future_basis' }} compact />);
  expect(screen.getByText('売却モデル未計算')).toBeVisible();
  expect(screen.getByText('モデル停止水準 82.52 · 未確認')).toBeVisible();
  expect(screen.getByText('action: future_action')).not.toBeVisible();
  expect(screen.getByText('stop_basis: future_basis')).not.toBeVisible();
  expect(screen.getByText('実際の保有・注文は未確認')).toBeVisible();
});
