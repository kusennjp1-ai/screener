import { fireEvent, render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import ChartNumericData from './ChartNumericData';

it('labels each daily value and preserves unknowns separately from observed zero', () => {
  render(<ChartNumericData symbol="SYNTH" asOfDate="2026-10-02" generatedAt="2026-10-03T10:00:00Z" currency="USD" bars={[
    { date:'2026-10-01', open:100, high:102, low:98, close:101, volume:4000 },
    { date:'2026-10-02', open:null, high:'102', low:NaN, close:100, volume:0 },
  ]}/>);
  const disclosure = screen.getByText('日足の数値を確認').closest('details');
  fireEvent.click(screen.getByText('日足の数値を確認'));
  expect(disclosure).toHaveAttribute('open');
  expect(screen.getByLabelText('SYNTH の日付')).toHaveValue('2026-10-02');
  expect(screen.getByText(/分析基準日/)).toHaveTextContent('2026-10-02 ／ 配信データ作成日時 2026-10-03T10:00:00Z');
  expect(screen.getAllByText('未確認')).toHaveLength(3);
  expect(within(screen.getByText('出来高').parentElement).getByText('0')).toBeInTheDocument();
  openHistory();
  fireEvent.change(screen.getByLabelText('SYNTH の日付'), { target: { value:'2026-10-01' } });
  expect(disclosure).toHaveTextContent('対象日 2026-10-01');
  expect(within(screen.getByText('終値').parentElement).getByText('101')).toBeInTheDocument();
  expect(screen.queryByText('未確認')).not.toBeInTheDocument();
});

const dailyBars = [
  { date:'2026-09-29', close:99, volume:10 },
  { date:'2026-09-30', close:100, volume:20 },
  { date:'2026-10-01', close:101, volume:30 },
];
const props = { symbol:'SYNTH', asOfDate:'2026-10-02', generatedAt:'same-publication' };
const openHistory = () => { const disclosure=screen.getByText('日足の数値を確認').closest('details'); disclosure.open=true; fireEvent(disclosure,new Event('toggle')); };
const choose = date => { openHistory(); fireEvent.change(screen.getByLabelText('SYNTH の日付'), { target:{value:date} }); };
const expectPoint = (date, close) => {
  expect(screen.getByLabelText('SYNTH の日付')).toHaveValue(date);
  expect(screen.getByText(/価格の通貨/)).toHaveTextContent(`対象日 ${date}`);
  expect(within(screen.getByText('終値').parentElement).getByText(String(close))).toBeInTheDocument();
};

it('keeps a selected calendar date when the same publication gains a newer bar', () => {
  const view = render(<ChartNumericData {...props} bars={dailyBars}/>);
  choose('2026-09-30');
  view.rerender(<ChartNumericData {...props} bars={[...dailyBars, {date:'2026-10-02',close:102}]}/>);
  expectPoint('2026-09-30', 100);
  expect(screen.queryByText(/戻しました/)).not.toBeInTheDocument();
});

it('uses only the newest supplied date by default, then keeps an explicitly selected latest date', () => {
  const view = render(<ChartNumericData {...props} bars={dailyBars.slice(0, 2)}/>);
  expectPoint('2026-09-30', 100);
  expect(screen.queryByRole('option', {name:'2026-10-02'})).not.toBeInTheDocument();
  view.rerender(<ChartNumericData {...props} bars={dailyBars}/>);
  expectPoint('2026-10-01', 101);
  choose('2026-10-01');
  view.rerender(<ChartNumericData {...props} bars={[...dailyBars, {date:'2026-10-02',close:102}]}/>);
  expectPoint('2026-10-01', 101);
});

it('keeps the date when history shrinks but the selection still exists', () => {
  const view = render(<ChartNumericData {...props} bars={dailyBars}/>);
  choose('2026-09-30');
  view.rerender(<ChartNumericData {...props} bars={dailyBars.slice(0, 2)}/>);
  expectPoint('2026-09-30', 100);
  expect(screen.queryByText(/戻しました/)).not.toBeInTheDocument();
});

it('explicitly resets a removed selection to the newest supplied date without resurrecting it', () => {
  const view = render(<ChartNumericData {...props} bars={dailyBars}/>);
  choose('2026-09-29');
  view.rerender(<ChartNumericData {...props} bars={dailyBars.slice(1)}/>);
  expectPoint('2026-10-01', 101);
  expect(screen.getByText(/選択していた 2026-09-29/)).toHaveTextContent('配信内の最新日 2026-10-01 に戻しました');
  view.rerender(<ChartNumericData {...props} bars={dailyBars}/>);
  expectPoint('2026-10-01', 101);
  choose('2026-09-30');
  expect(screen.queryByText(/戻しました/)).not.toBeInTheDocument();
});

it('recovers from empty data without keeping an out-of-range selection', () => {
  const view = render(<ChartNumericData {...props} bars={[]}/>);
  expect(screen.queryByLabelText('SYNTH の日付')).not.toBeInTheDocument();
  view.rerender(<ChartNumericData {...props} bars={dailyBars}/>);
  expectPoint('2026-10-01', 101);
  choose('2026-09-29');
  view.rerender(<ChartNumericData {...props} bars={[]}/>);
  expect(screen.queryByText(/対象日/)).not.toBeInTheDocument();
  view.rerender(<ChartNumericData {...props} bars={dailyBars}/>);
  expectPoint('2026-10-01', 101);
});

it('keeps date/value alignment after a reorder without mutating the chart bars', () => {
  const view = render(<ChartNumericData {...props} bars={dailyBars}/>);
  choose('2026-09-30');
  const reordered = Object.freeze([dailyBars[1], dailyBars[0], dailyBars[2]]);
  view.rerender(<ChartNumericData {...props} bars={reordered}/>);
  expectPoint('2026-09-30', 100);
  expect(screen.getAllByRole('option').map(option => option.value)).toEqual(['2026-10-01','2026-09-30','2026-09-29']);
  expect(reordered.map(bar => bar.date)).toEqual(['2026-09-30','2026-09-29','2026-10-01']);
});

it('finds the newest supplied date independently of array position', () => {
  render(<ChartNumericData {...props} bars={[dailyBars[2], dailyBars[0], dailyBars[1]]}/>);
  expectPoint('2026-10-01', 101);
  expect(screen.getAllByRole('option')[0]).toHaveTextContent('2026-10-01');
});

it('updates zero and missing observations on the selected date without borrowing another day', () => {
  const view = render(<ChartNumericData {...props} bars={dailyBars}/>);
  choose('2026-09-30');
  view.rerender(<ChartNumericData {...props} bars={[dailyBars[0], {...dailyBars[1],close:0,volume:null},dailyBars[2]]}/>);
  expectPoint('2026-09-30', 0);
  expect(within(screen.getByText('出来高').parentElement).getByText('未確認')).toBeInTheDocument();
  view.rerender(<ChartNumericData {...props} bars={[dailyBars[0], {...dailyBars[1],close:null,volume:0},dailyBars[2]]}/>);
  expectPoint('2026-09-30', '未確認');
  expect(within(screen.getByText('出来高').parentElement).getByText('0')).toBeInTheDocument();
});

it('does not fabricate currency, generation time or absent daily observations', () => {
  const view = render(<ChartNumericData symbol="SYNTH" bars={[]}/>);
  expect(screen.queryByText('日足の数値を確認')).not.toBeInTheDocument();
  view.rerender(<ChartNumericData symbol="SYNTH" bars={[{date:'2026-10-02',close:0}]}/>);
  expect(screen.getByText(/配信データ作成日時/)).toHaveTextContent('分析基準日 未確認 ／ 配信データ作成日時 未確認');
  expect(screen.getByText(/価格の通貨/)).toHaveTextContent('価格の通貨 未確認');
  expect(within(screen.getByText('終値').parentElement).getByText('0')).toBeInTheDocument();
});

it('mounts history options only while expanded and preserves the selected day across close and reopen', () => {
 render(<ChartNumericData {...props} bars={dailyBars}/>);
 const disclosure=screen.getByText('日足の数値を確認').closest('details');
 expect(disclosure.querySelectorAll('option')).toHaveLength(1);
 openHistory();
 expect(disclosure.querySelectorAll('option')).toHaveLength(dailyBars.length);
 choose('2026-09-30');
 disclosure.open=false;fireEvent(disclosure,new Event('toggle'));
 expect(disclosure.querySelectorAll('option')).toHaveLength(1);
 expectPoint('2026-09-30',100);
 openHistory();
 expect(disclosure.querySelectorAll('option')).toHaveLength(dailyBars.length);
 expectPoint('2026-09-30',100);
});

it('does not remount hidden history options after an empty payload interrupts an expanded disclosure', () => {
 const view=render(<ChartNumericData {...props} bars={dailyBars}/>);
 openHistory();
 view.rerender(<ChartNumericData {...props} bars={[]}/>);
 view.rerender(<ChartNumericData {...props} bars={dailyBars}/>);
 const disclosure=screen.getByText('日足の数値を確認').closest('details');
 expect(disclosure).not.toHaveAttribute('open');
 expect(disclosure.querySelectorAll('option')).toHaveLength(1);
 openHistory();expect(disclosure.querySelectorAll('option')).toHaveLength(dailyBars.length);
});
