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
  expect(screen.getByLabelText('SYNTH の日付')).toHaveValue('0');
  expect(screen.getByText(/分析基準日/)).toHaveTextContent('2026-10-02 ／ 配信データ作成日時 2026-10-03T10:00:00Z');
  expect(screen.getAllByText('未確認')).toHaveLength(3);
  expect(within(screen.getByText('出来高').parentElement).getByText('0')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('SYNTH の日付'), { target: { value:'1' } });
  expect(disclosure).toHaveTextContent('対象日 2026-10-01');
  expect(within(screen.getByText('終値').parentElement).getByText('101')).toBeInTheDocument();
  expect(screen.queryByText('未確認')).not.toBeInTheDocument();
});

it('does not fabricate currency, generation time or absent daily observations', () => {
  const view = render(<ChartNumericData symbol="SYNTH" bars={[]}/>);
  expect(screen.queryByText('日足の数値を確認')).not.toBeInTheDocument();
  view.rerender(<ChartNumericData symbol="SYNTH" bars={[{date:'2026-10-02',close:0}]}/>);
  expect(screen.getByText(/配信データ作成日時/)).toHaveTextContent('分析基準日 未確認 ／ 配信データ作成日時 未確認');
  expect(screen.getByText(/価格の通貨/)).toHaveTextContent('価格の通貨 未確認');
  expect(within(screen.getByText('終値').parentElement).getByText('0')).toBeInTheDocument();
});
