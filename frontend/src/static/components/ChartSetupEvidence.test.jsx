import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ChartSetupEvidence from './ChartSetupEvidence';
import { buildBookAnnotations } from '../../components/Charts/bookAnnotations';

afterEach(cleanup);

// Synthetic OHLCV is confined to this test. It exercises the existing detector,
// so the UI cannot obtain its displayed measurements from a separate heuristic.
function bars(widening = false) {
  const points = widening ? [[0, 50], [60, 100], [70, 92], [80, 98], [88, 86], [96, 96], [104, 80], [110, 94]]
    : [[0, 50], [60, 100], [70, 80], [80, 98], [88, 88], [96, 96], [104, 91], [110, 95]];
  const days = [], date = new Date('2025-01-01');
  while (days.length < 111) { if (![0, 6].includes(date.getUTCDay())) days.push(date.toISOString().slice(0, 10)); date.setUTCDate(date.getUTCDate() + 1); }
  return days.map((day, index) => {
    let point = 1; while (points[point][0] < index) point++;
    const [start, from] = points[point - 1], [end, to] = points[point];
    const close = from + (to - from) * (index - start) / (end - start);
    return { date: day, open: close, high: close + .2, low: close - .2, close, volume: 10000 - index * 40 };
  });
}

it('shows measured contraction depths and focuses the exact selected chart leg', () => {
  const source = bars(), annotations = buildBookAnnotations(source), onFocus = vi.fn(), onToggle = vi.fn();
  render(<ChartSetupEvidence symbol="TEST" date={source.at(-1).date} annotations={annotations} detailed={false} onFocus={onFocus} onToggle={onToggle} />);
  expect(screen.getByText(/VCP候補を検出/)).toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'TEST のVCP分析' })).toHaveTextContent(source.at(-1).date);
  const first = screen.getByRole('button', { name: 'C1 の収縮区間を表示' });
  expect(first).toHaveTextContent(`${annotations.legs[0].depthPct.toFixed(1)}%`);
  fireEvent.click(first);
  expect(onFocus).toHaveBeenCalledWith(annotations.legs[0], 0);
  expect(first).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByText(/高値 100.2/)).toHaveTextContent('安値 79.8');
  fireEvent.click(screen.getByRole('button', { name: '図上にガイドを表示' }));
  expect(onToggle).toHaveBeenCalledOnce();
  expect(screen.getByText(/最終日の出来高枯渇とは別/)).toBeInTheDocument();
});

it('keeps widening shapes unconfirmed without invented contractions', () => {
  render(<ChartSetupEvidence symbol="TEST" annotations={buildBookAnnotations(bars(true))} />);
  expect(screen.getByText(/ベース候補のみ/, { selector: '.chart-setup-status' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /の収縮区間を表示/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/VCP候補を検出/)).not.toBeInTheDocument();
});

it.each([{ warning: 'split mismatch' }, { daily: false }])('withholds previously computed evidence while the chart cannot show it: %j', props => {
  render(<ChartSetupEvidence symbol="TEST" annotations={buildBookAnnotations(bars())} {...props} />);
  expect(screen.queryByRole('button', { name: /の収縮区間を表示/ })).not.toBeInTheDocument();
  expect(screen.queryByText(/VCP候補を検出/)).not.toBeInTheDocument();
  expect(screen.queryByText('20.4%')).not.toBeInTheDocument();
});

it('does not infer declining volume from shrinking prices alone', () => {
  const source = bars().map(bar => ({ ...bar, volume: 10000 }));
  render(<ChartSetupEvidence symbol="TEST" annotations={buildBookAnnotations(source)} onFocus={vi.fn()} />);
  expect(screen.getByText('C1比 · 順次減少は未確認')).toBeInTheDocument();
  expect(screen.queryByText('C1比 · 各区間で減少')).not.toBeInTheDocument();
});

it('drops the selected interval when the bound annotation data changes', () => {
  const view = render(<ChartSetupEvidence symbol="AAA" annotations={buildBookAnnotations(bars())} onFocus={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'C1 の収縮区間を表示' }));
  view.rerender(<ChartSetupEvidence symbol="BBB" annotations={buildBookAnnotations([])} onFocus={vi.fn()} />);
  expect(screen.queryByRole('region', { name: 'AAA のVCP分析' })).not.toBeInTheDocument();
  expect(screen.getByRole('region', { name: 'BBB のVCP分析' })).not.toHaveTextContent('高値 100.2');
  expect(screen.queryByRole('button', { name: /の収縮区間を表示/ })).not.toBeInTheDocument();
});
