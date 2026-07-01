import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import StatusBar from './StatusBar';
import QuarterlyStrip from './QuarterlyStrip';

const sample = {
  quote: { last: 1208.54, bid: 1207.83, ask: 1209.24, change: 1.41, change_pct: 0.12, volume: 3_970_000 },
  ratings: { er: 90, sr: 96, rpr: 87, tpr: 'B', esr: 97, vcp_pct: 13.7, vrr_pct: 54, dist_20dma_pct: 8.1 },
  states: {
    trend_stage: { stage: 2, label: 'Stage 2', active: true },
    pressure: { state: 'buy' },
    buy_risk: { state: 'low' },
    monalert_net: 0,
  },
};

describe('Markets360 StatusBar', () => {
  it('renders the headline rating chips and quote', () => {
    renderWithProviders(<StatusBar data={sample} />);
    expect(screen.getByText('ER')).toBeInTheDocument();
    expect(screen.getByText('90')).toBeInTheDocument();   // ER value
    expect(screen.getByText('96')).toBeInTheDocument();   // SR value
    expect(screen.getByText('87')).toBeInTheDocument();   // RPR value
    expect(screen.getByText('TPR')).toBeInTheDocument();  // TPR chip label
    expect(screen.getAllByText('B').length).toBeGreaterThanOrEqual(1); // TPR letter (and Bid label)
    expect(screen.getByText('1208.54')).toBeInTheDocument(); // last
    expect(screen.getByText('+0.12%')).toBeInTheDocument();  // change %
  });

  it('renders the second-row rate chips', () => {
    renderWithProviders(<StatusBar data={sample} />);
    expect(screen.getByText('VRR')).toBeInTheDocument();
    expect(screen.getByText('+54.0%')).toBeInTheDocument();
    expect(screen.getByText('ESR')).toBeInTheDocument();
  });

  it('tolerates an empty payload', () => {
    renderWithProviders(<StatusBar data={null} />);
    expect(screen.getByText('ER')).toBeInTheDocument();
  });
});

describe('Markets360 QuarterlyStrip', () => {
  const quarters = [
    { label: '2025 Q2', estimate: false, eps_actual: 6.31, eps_prior: 3.92, eps_growth: 61, sales_actual: 15.6e9, sales_prior: 11.3e9, sales_growth: 38 },
    { label: 'Next Q (Est.)', estimate: true, earnings_date: '08/06', earnings_timing: 'B', eps_est_growth: 40, sales_est_growth: 32 },
  ];

  it('renders actual and estimate columns', () => {
    renderWithProviders(<QuarterlyStrip quarters={quarters} />);
    expect(screen.getByText('2025 Q2')).toBeInTheDocument();
    expect(screen.getByText('+61%')).toBeInTheDocument();
    expect(screen.getByText('08/06')).toBeInTheDocument();
    expect(screen.getByText('+40%')).toBeInTheDocument();
  });

  it('renders nothing when empty', () => {
    const { container } = renderWithProviders(<QuarterlyStrip quarters={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
