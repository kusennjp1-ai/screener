import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import AddPositionDialog from './AddPositionDialog';
import { renderWithProviders } from '../../test/renderWithProviders';

describe('AddPositionDialog', () => {
  it('prefills from initialValues when opened (buy-signal bridge)', () => {
    renderWithProviders(
      <AddPositionDialog
        open
        onClose={() => {}}
        onSubmit={() => {}}
        isSubmitting={false}
        submitError={null}
        initialValues={{
          symbol: 'FTNT', entry_price: '149.67', initial_stop: '134.7', entry_date: '2026-07-07',
        }}
      />,
    );
    expect(screen.getByTestId('position-symbol')).toHaveValue('FTNT');
    expect(screen.getByTestId('position-entry')).toHaveValue(149.67);
    expect(screen.getByTestId('position-stop')).toHaveValue(134.7);
    expect(screen.getByTestId('position-date')).toHaveValue('2026-07-07');
    // Prefilled risk % rendered against the Minervini cap
    expect(screen.getByText(/リスク 10\.0%/)).toBeInTheDocument();
    expect(screen.getByTestId('position-submit')).toBeEnabled();
  });

  it('submits the normalized payload', async () => {
    const onSubmit = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(
      <AddPositionDialog
        open onClose={() => {}} onSubmit={onSubmit} isSubmitting={false} submitError={null}
        initialValues={{
          symbol: 'ftnt', entry_price: '149.67', initial_stop: '134.7', entry_date: '2026-07-07',
        }}
      />,
    );
    await user.click(screen.getByTestId('position-submit'));
    expect(onSubmit).toHaveBeenCalledWith({
      symbol: 'FTNT',
      entry_price: 149.67,
      entry_date: '2026-07-07',
      initial_stop: 134.7,
      shares: null,
      notes: null,
    });
  });
});
