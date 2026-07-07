import { MemoryRouter } from 'react-router-dom';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import PositionsPage from './PositionsPage';
import * as positionsApi from '../api/positions';
import { renderWithProviders } from '../test/renderWithProviders';

vi.mock('../api/positions', () => ({
  getPositions: vi.fn(),
  createPosition: vi.fn(),
  updatePosition: vi.fn(),
  closePosition: vi.fn(),
  deletePosition: vi.fn(),
}));

const openPositions = {
  total: 2,
  positions: [
    {
      id: 1,
      symbol: 'NVDA',
      entry_price: 100,
      entry_date: '2026-05-01',
      initial_stop: 92,
      status: 'open',
      last_close: 121.5,
      pnl_pct: 21.5,
      r_multiple: 2.69,
      action: 'raise_stop',
      sell_plan: { action: 'raise_stop', trailing: { r_multiple: 2.69, stop: 108, raised: true } },
      targets: [
        { r_multiple: 2, price: 116, gain_pct: 16 },
        { r_multiple: 3, price: 124, gain_pct: 24 },
      ],
    },
    {
      id: 2,
      symbol: 'CELH',
      entry_price: 50,
      entry_date: '2026-06-10',
      initial_stop: 46,
      status: 'open',
      last_close: 44.2,
      pnl_pct: -11.6,
      r_multiple: -1.45,
      action: 'exit',
      sell_plan: { action: 'exit', trailing: { r_multiple: -1.45, stop: 46, raised: false } },
      targets: [],
    },
  ],
};

const renderPage = () => renderWithProviders(
  <MemoryRouter><PositionsPage /></MemoryRouter>,
);

describe('PositionsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    positionsApi.getPositions.mockResolvedValue(openPositions);
  });

  it('renders open positions with R multiple, ladder stop, and action chips', async () => {
    renderPage();
    expect(await screen.findByTestId('position-row-NVDA')).toBeInTheDocument();
    // Ladder-raised stop shown (108, not the initial 92) with the raise marker
    expect(screen.getByText(/108\.00/)).toBeInTheDocument();
    expect(screen.getByText('+2.69R')).toBeInTheDocument();
    // 2R/3R targets from the original risk unit
    expect(screen.getByText('116.00 / 124.00')).toBeInTheDocument();
    // Action chips for both rows
    expect(screen.getByTestId('action-chip-raise_stop')).toBeInTheDocument();
    expect(screen.getByTestId('action-chip-exit')).toBeInTheDocument();
  });

  it('registers a position through the dialog', async () => {
    positionsApi.createPosition.mockResolvedValue({ id: 3, symbol: 'AAPL', status: 'open' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('position-row-NVDA');

    await user.click(screen.getByTestId('add-position'));
    await user.type(screen.getByTestId('position-symbol'), 'aapl');
    await user.type(screen.getByTestId('position-entry'), '200');
    // jsdom date inputs don't accept user.type — set the value directly
    fireEvent.change(screen.getByTestId('position-date'), { target: { value: '2026-07-01' } });
    await user.type(screen.getByTestId('position-stop'), '185');
    await user.click(screen.getByTestId('position-submit'));

    await waitFor(() => expect(positionsApi.createPosition).toHaveBeenCalled());
    // React Query may append a mutation context arg — pin the payload only.
    expect(positionsApi.createPosition.mock.calls[0][0]).toEqual({
      symbol: 'AAPL',
      entry_price: 200,
      entry_date: '2026-07-01',
      initial_stop: 185,
      shares: null,
      notes: null,
    });
  });

  it('rejects a stop at/above entry before submitting', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('position-row-NVDA');

    await user.click(screen.getByTestId('add-position'));
    await user.type(screen.getByTestId('position-symbol'), 'MSFT');
    await user.type(screen.getByTestId('position-entry'), '100');
    fireEvent.change(screen.getByTestId('position-date'), { target: { value: '2026-07-01' } });
    await user.type(screen.getByTestId('position-stop'), '105');

    expect(screen.getByTestId('position-submit')).toBeDisabled();
    expect(screen.getByText(/損切りは買値より下/)).toBeInTheDocument();
  });

  it('closes a position and refetches', async () => {
    positionsApi.closePosition.mockResolvedValue({ id: 1, status: 'closed' });
    const user = userEvent.setup();
    renderPage();
    await screen.findByTestId('position-row-NVDA');

    await user.click(screen.getByTestId('close-position-1'));
    await waitFor(() => expect(positionsApi.closePosition).toHaveBeenCalledWith(1));
    await waitFor(() => expect(positionsApi.getPositions).toHaveBeenCalledTimes(2));
  });

  it('shows the empty state when nothing is registered', async () => {
    positionsApi.getPositions.mockResolvedValue({ total: 0, positions: [] });
    renderPage();
    expect(await screen.findByText('No open positions')).toBeInTheDocument();
  });
});
