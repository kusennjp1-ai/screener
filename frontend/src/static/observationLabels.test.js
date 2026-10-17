import { observedSignalLabel, observedSourceLabel, observedStopBasisLabel, observationRawValue } from './observationLabels';

it('describes historical signal flags without turning them into purchase advice', () => {
  expect(observedSignalLabel(true)).toBe('有効（記録時点）');
  expect(observedSignalLabel(false)).toBe('無効（記録時点）');
});

it.each([undefined, null, 'true', 'false', 0, 1, {}, []])('keeps malformed signal flag %j unconfirmed', value => {
  expect(observedSignalLabel(value)).toBe('未確認');
});

it.each([
  ['vcp', '値動きの収縮パターン'],
  ['ma_tight', '10日移動平均線付近の持ち合い'],
  ['vol_contract', '値幅の縮小（ATR）'],
])('labels the selected detector %s without inventing another detector', (code, label) => {
  expect(observedSourceLabel(code)).toBe(label);
  expect(observationRawValue(code)).toBe(code);
});

it.each([
  ['initial', '初期モデル'],
  ['max_loss_cap', 'モデルの損失率上限を基準'],
  ['base_low', '直近の底値を基準'],
  ['breakeven', 'モデルの基準価格と同水準'],
  ['half_risk', 'モデルの初期リスクを半減する水準'],
  ['lock_1r', 'モデルの初期リスク1倍分を確保する水準'],
  ['trail_50dma', '50日移動平均線を基準'],
  ['trail_20bar_low', '直近20本の安値を基準'],
])('labels the exported stop basis %s without setting a threshold', (code, label) => {
  expect(observedStopBasisLabel(code)).toBe(label);
  expect(observationRawValue(code)).toBe(code);
});

it.each([undefined, null, '', 'unrecognized', 'toString', '__proto__', 1, true, {}])('does not assign semantics to unknown code %j', value => {
  expect(observedSourceLabel(value)).toBe('未確認');
  expect(observedStopBasisLabel(value)).toBe('未確認');
});

it.each([[undefined, '未記録'], [null, 'null'], [false, 'false'], [0, '0'], [NaN, 'NaN'], ['new_code', 'new_code']])('preserves diagnostic value %j', (value, expected) => {
  expect(observationRawValue(value)).toBe(expected);
});
