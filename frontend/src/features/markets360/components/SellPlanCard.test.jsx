import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import SellPlanCard from './SellPlanCard';

describe('SellPlanCard', () => {
  it('renders nothing only when the plan is entirely absent', () => {
    const { container } = renderWithProviders(<SellPlanCard sellPlan={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows a hold with its protective stop and targets (C97: exit never hidden)', () => {
    renderWithProviders(
      <SellPlanCard sellPlan={{ action: 'hold', stop_level: 118.25, targets: { two_r: 150, three_r: 165 } }} />
    );
    expect(screen.getByText('保有継続')).toBeInTheDocument();
    expect(screen.getByTestId('sell-plan-levels')).toHaveTextContent('損切り 118.25');
    expect(screen.getByTestId('sell-plan-levels')).toHaveTextContent('利確 150.00 / 165.00');
  });

  it('shows stop-hit as the top-urgency exit with the stop level', () => {
    renderWithProviders(
      <SellPlanCard sellPlan={{
        action: 'stop_hit',
        breakdown: null,
        climax: { active: false, flags: [] },
        trailing: { stop: 96.0, r_multiple: -1.02, raised: false },
      }} />
    );
    expect(screen.getByText('Sell — Stop Hit')).toBeInTheDocument();
    // the level appears on the urgent stop-hit line and the always-on footer
    expect(screen.getAllByText(/96\.00/).length).toBeGreaterThan(0);
    // the green "new stop" raise line must NOT render under a stop-hit card
    expect(screen.queryByText(/new stop/)).not.toBeInTheDocument();
  });

  it('shows the trend-broken exit with volume context', () => {
    renderWithProviders(
      <SellPlanCard sellPlan={{
        action: 'exit',
        breakdown: { breakdown_detected: true, volume_multiple: 2.5, confidence: 0.8 },
        climax: { active: false, flags: [] },
        trailing: {},
      }} />
    );
    expect(screen.getByText('Sell — Trend Broken')).toBeInTheDocument();
    expect(screen.getByText(/2\.5x/)).toBeInTheDocument();
    expect(screen.getByText(/80%/)).toBeInTheDocument();
  });

  it('shows climax flags in Japanese for sell-into-strength', () => {
    renderWithProviders(
      <SellPlanCard sellPlan={{
        action: 'sell_into_strength',
        climax: {
          active: true, score: 75, extension_200dma_pct: 82.3,
          flags: ['extended_above_200dma', 'up_day_frenzy'],
        },
        breakdown: null,
        trailing: {},
      }} />
    );
    expect(screen.getByText('Sell Into Strength')).toBeInTheDocument();
    expect(screen.getByText(/200日線から70%以上の乖離/)).toBeInTheDocument();
    expect(screen.getByText(/直近10日中8日以上が上昇/)).toBeInTheDocument();
    expect(screen.getByText(/\+82\.3%/)).toBeInTheDocument();
  });

  it('shows the raised trailing stop with its R multiple', () => {
    renderWithProviders(
      <SellPlanCard sellPlan={{
        action: 'raise_stop',
        climax: { active: false, flags: [] },
        breakdown: null,
        trailing: { r_multiple: 2.13, stop: 100, basis: 'breakeven', raised: true },
      }} />
    );
    expect(screen.getByText('Raise Stop')).toBeInTheDocument();
    expect(screen.getByText('+2.13R')).toBeInTheDocument();
    expect(screen.getByText(/new stop @/)).toBeInTheDocument();
    expect(screen.getByText('100.00')).toBeInTheDocument();
  });
});
