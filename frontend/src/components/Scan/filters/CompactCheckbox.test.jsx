import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithProviders } from '../../../test/renderWithProviders';
import CompactCheckbox from './CompactCheckbox';

describe('CompactCheckbox', () => {
  it('renders label text', () => {
    renderWithProviders(
      <CompactCheckbox label="SE Ready" value={null} onChange={vi.fn()} />
    );
    expect(screen.getByText('SE Ready')).toBeInTheDocument();
  });

  it('shows Japanese unspecified / yes / no buttons with field names', () => {
    renderWithProviders(
      <CompactCheckbox label="Ready" value={null} onChange={vi.fn()} />
    );
    expect(screen.getByRole('button', { name: 'Readyの指定なし' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Readyあり' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Readyなし' })).toBeInTheDocument();
  });

  it('calls onChange(true) when Yes is clicked', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <CompactCheckbox label="Ready" value={null} onChange={onChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Readyあり' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('calls onChange(false) when No is clicked', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <CompactCheckbox label="Ready" value={null} onChange={onChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Readyなし' }));
    expect(onChange).toHaveBeenCalledWith(false);
  });

  it('calls onChange(null) when already-selected Yes is clicked again', async () => {
    const onChange = vi.fn();
    renderWithProviders(
      <CompactCheckbox label="Ready" value={true} onChange={onChange} />
    );

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Readyあり' }));
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it('highlights Yes button when value={true}', () => {
    renderWithProviders(
      <CompactCheckbox label="Ready" value={true} onChange={vi.fn()} />
    );
    const yesButton = screen.getByRole('button', { name: 'Readyあり' });
    expect(yesButton).toHaveAttribute('aria-pressed', 'true');
  });
});
