import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import ExitSignalCard from './ExitSignalCard';

const breakdown = {
  breakdown_detected: true,
  breakdown_price: 187.42,
  breakdown_date: '2026-06-30',
  volume_multiple: 2.3,
  below_50dma: true,
  recommended_action: 'reduce_or_exit',
  confidence: 0.8,
};

describe('Markets360 ExitSignalCard', () => {
  it('renders the breakdown warning with price, volume and action', () => {
    renderWithProviders(<ExitSignalCard exitSignal={breakdown} />);
    expect(screen.getByText('50-DMA Breakdown')).toBeInTheDocument();
    expect(screen.getByText('187.42')).toBeInTheDocument();
    expect(screen.getByText('2.3×')).toBeInTheDocument();
    expect(screen.getByText('2026-06-30')).toBeInTheDocument();
    expect(screen.getByText('reduce or exit')).toBeInTheDocument();
  });

  it('renders nothing when no breakdown is detected', () => {
    const { container } = renderWithProviders(
      <ExitSignalCard exitSignal={{ ...breakdown, breakdown_detected: false }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for a null payload', () => {
    const { container } = renderWithProviders(<ExitSignalCard exitSignal={null} />);
    expect(container).toBeEmptyDOMElement();
  });
});
