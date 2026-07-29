import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SellTiming, { ACTION_META, normalizeSell } from './SellTiming';
import { C, T, TEXT_MIN_PX } from '../designTokens';

describe('SellTiming', () => {
  it('never returns null — even with no sell data it shows an explicit state', () => {
    renderWithProviders(<SellTiming sell={null} />);
    const el = screen.getByTestId('sell-timing');
    expect(el).toHaveAttribute('data-action', 'no_data');
    expect(el).toHaveTextContent('エグジット未計算');
  });

  it('renders a hold with its protective stop and targets', () => {
    renderWithProviders(<SellTiming sell={{ action: 'hold', stop: 118.2, target_2r: 150, target_3r: 165 }} />);
    const el = screen.getByTestId('sell-timing');
    expect(el).toHaveAttribute('data-action', 'hold');
    expect(el).toHaveTextContent('保有継続');
    expect(el).toHaveTextContent('損切り 118.20');
    expect(el).toHaveTextContent('利確 150.00 / 165.00');
  });

  it('surfaces a stop_hit prominently with its level', () => {
    renderWithProviders(<SellTiming sell={{ action: 'stop_hit', stop: 122.5 }} />);
    const el = screen.getByTestId('sell-timing');
    expect(el).toHaveTextContent('即売却');
    expect(el).toHaveTextContent('損切り 122.50');
  });

  it('normalizes the chart sell_plan shape (stop_level + targets object)', () => {
    const n = normalizeSell({ action: 'raise_stop', stop_level: 130.4, targets: { two_r: 160, three_r: 180 } });
    expect(n).toMatchObject({ action: 'raise_stop', stop: 130.4, target2r: 160, target3r: 180 });
  });

  it('marks a stale (last-known) reading', () => {
    renderWithProviders(<SellTiming sell={{ action: 'exit', stop: 100 }} stale />);
    expect(screen.getByTestId('sell-timing')).toHaveTextContent('前回');
  });
});

// Every rendered text node, with the font size the cascade actually gives it.
const textSizes = (root) => {
  const out = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node = walker.nextNode();
  while (node) {
    const text = (node.textContent || '').trim();
    if (text) {
      out.push({ text, size: parseFloat(window.getComputedStyle(node.parentElement).fontSize) });
    }
    node = walker.nextNode();
  }
  return out;
};

describe('SellTiming type scale (B6/B11)', () => {
  const CASES = [
    ['stop_hit', { action: 'stop_hit', stop: 122.5 }, false],
    ['hold + targets', { action: 'hold', stop: 118.2, target_2r: 150, target_3r: 165 }, false],
    ['compact hold', { action: 'hold', stop: 118.2 }, true],
    ['no data', null, false],
  ];

  it.each(CASES)('%s renders no text below the 12px floor', (_name, sell, compact) => {
    renderWithProviders(<SellTiming sell={sell} compact={compact} stale />);
    const under = textSizes(screen.getByTestId('sell-timing')).filter((n) => n.size < TEXT_MIN_PX);
    expect(under).toEqual([]);
  });

  it('draws only from the exported scale — no ad-hoc sizes', () => {
    const steps = new Set(Object.values(T));
    const sizes = new Set();
    CASES.forEach(([, sell, compact]) => {
      const { unmount } = renderWithProviders(<SellTiming sell={sell} compact={compact} stale />);
      textSizes(screen.getByTestId('sell-timing')).forEach((n) => sizes.add(n.size));
      unmount();
    });
    expect([...sizes].filter((s) => !steps.has(s))).toEqual([]);
    // the whole component lives on two steps: micro (12) and body (13).
    expect([...sizes].sort((a, b) => a - b)).toEqual([T.micro, T.body]);
  });

  it('the urgent (rank<=1) pill is a solid fill with near-black text, not a low-contrast tint', () => {
    renderWithProviders(<SellTiming sell={{ action: 'stop_hit', stop: 1 }} />);
    const label = screen.getByText(ACTION_META.stop_hit.label);
    // measured: #0c0c11 on #f23645 = 5.01:1 (AA); the old 13% tint was 4.19:1.
    expect(window.getComputedStyle(label).color).toBe('rgb(12, 12, 17)');
  });

  it('uses the one semantic down colour for every sell action', () => {
    expect(ACTION_META.stop_hit.color).toBe(C.down);
    expect(ACTION_META.exit.color).toBe(C.down);
    expect(ACTION_META.raise_stop.color).toBe(C.up);
    expect(C.down).not.toBe('#d32f2f'); // MUI error.main — 3.67:1, fails AA
  });
});
