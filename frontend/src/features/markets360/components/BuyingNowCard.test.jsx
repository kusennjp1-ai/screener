import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import BuyingNowCard from './BuyingNowCard';
import { renderWithProviders } from '../../../test/renderWithProviders';

const signal = {
  active: true,
  headline: 'Buying Now!',
  trigger_price: 149.67,
  stop: 134.7,
  risk_pct: 10.0,
  as_of: '2026-06-26T00:00:00Z',
};

describe('BuyingNowCard', () => {
  it('renders nothing when the signal is inactive', () => {
    const { container } = renderWithProviders(<BuyingNowCard signal={{ active: false }} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the register bridge only when onRegister is wired', () => {
    const { rerender } = renderWithProviders(<BuyingNowCard signal={signal} />);
    expect(screen.queryByTestId('register-from-signal')).not.toBeInTheDocument();

    const onRegister = vi.fn();
    rerender(<BuyingNowCard signal={signal} onRegister={onRegister} />);
    expect(screen.getByTestId('register-from-signal')).toBeInTheDocument();
  });

  it('fires onRegister on click', async () => {
    const onRegister = vi.fn();
    const user = userEvent.setup();
    renderWithProviders(<BuyingNowCard signal={signal} onRegister={onRegister} />);
    await user.click(screen.getByTestId('register-from-signal'));
    expect(onRegister).toHaveBeenCalledTimes(1);
  });
});
