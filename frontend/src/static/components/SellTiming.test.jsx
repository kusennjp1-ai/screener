import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../test/renderWithProviders';
import SellTiming, { normalizeSell } from './SellTiming';

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
