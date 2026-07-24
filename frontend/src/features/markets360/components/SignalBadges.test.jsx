import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import SignalBadges from './SignalBadges';
import { renderWithProviders } from '../../../test/renderWithProviders';

const activeSignal = {
  active: true,
  headline: 'Buying Now!',
  trigger_price: 149.67,
  stop: 134.7,
};

describe('SignalBadges', () => {
  it('renders nothing only when there is neither a buy nor any sell plan', () => {
    const { container } = renderWithProviders(
      <SignalBadges signal={{ active: false }} sellPlan={null} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('always shows the protective stop on a hold (C97: the exit is never hidden)', () => {
    renderWithProviders(
      <SignalBadges signal={{ active: false }} sellPlan={{ action: 'hold', stop_level: 118.25 }} />,
    );
    expect(screen.getByTestId('signal-badge-hold')).toBeInTheDocument();
    expect(screen.getByText('保有継続 @ 118.25')).toBeInTheDocument();
  });

  it('shows the buy badge for an active signal', () => {
    renderWithProviders(<SignalBadges signal={activeSignal} sellPlan={null} />);
    expect(screen.getByTestId('signal-badge-buy')).toBeInTheDocument();
    expect(screen.getByText('Buying Now!')).toBeInTheDocument();
  });

  it('shows the sell badge with the raised ladder stop in the label', () => {
    renderWithProviders(
      <SignalBadges
        signal={null}
        sellPlan={{ action: 'raise_stop', trailing: { raised: true, stop: 128.87 } }}
      />,
    );
    expect(screen.getByTestId('signal-badge-raise_stop')).toBeInTheDocument();
    expect(screen.getByText('Raise Stop @ 128.87')).toBeInTheDocument();
  });

  it('shows both badges when buy and sell signals coexist', () => {
    renderWithProviders(
      <SignalBadges signal={activeSignal} sellPlan={{ action: 'exit' }} />,
    );
    expect(screen.getByTestId('signal-badge-buy')).toBeInTheDocument();
    expect(screen.getByTestId('signal-badge-exit')).toBeInTheDocument();
    expect(screen.getByText('SELL')).toBeInTheDocument();
  });
});
