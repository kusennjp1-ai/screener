import { describe, it, expect } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test/renderWithProviders';
import { modelMarket } from '../../../static/portfolioPlan';
import MarketRegimeBanner from './MarketRegimeBanner';

describe('MarketRegimeBanner', () => {
  it('renders nothing when no row carries a regime', () => {
    const { container } = renderWithProviders(<MarketRegimeBanner results={[{ symbol: 'AAA' }]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders nothing for empty/undefined results', () => {
    const { container } = renderWithProviders(<MarketRegimeBanner results={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows the regime label, health, exposure and distribution days', () => {
    const results = [
      {
        symbol: 'AAA',
        market_regime: 'confirmed_uptrend',
        market_health: 88.5,
        market_exposure_pct: 100,
        market_distribution_days: 1,
      },
    ];
    renderWithProviders(<MarketRegimeBanner results={results} />);
    expect(screen.getByText('Confirmed Uptrend')).toBeInTheDocument();
    expect(screen.getByText(/Health 89\/100/)).toBeInTheDocument();
    expect(screen.getByText(/100%/)).toBeInTheDocument();
    expect(screen.getByText(/1 distribution day$/)).toBeInTheDocument();
  });

  it('falls back to the raw regime string for an unknown regime', () => {
    renderWithProviders(<MarketRegimeBanner results={[{ market_regime: 'weird_state' }]} />);
    expect(screen.getByText('weird_state')).toBeInTheDocument();
  });

  it('shows the follow-through-day chip when a live FTD backs the regime', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend',
      market_exposure_pct: 25,
      market_ftd_date: '2026-06-30',
      market_ftd_days_since: 3,
    }]} />);
    expect(screen.getByText('FTD 2026-06-30 (+3d)')).toBeInTheDocument();
    expect(screen.getByText(/25%/)).toBeInTheDocument();
  });

  it('renders no FTD chip when the regime is MA-driven', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend', market_exposure_pct: 100,
    }]} />);
    expect(screen.queryByText(/^FTD /)).not.toBeInTheDocument();
  });

  it('renders the health meter and the exposure ladder graphics', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend',
      market_health: 89,
      market_exposure_pct: 75,
    }]} />);
    expect(screen.getByTestId('health-meter')).toBeInTheDocument();
    const ladder = screen.getByTestId('exposure-ladder');
    const lit = ladder.querySelectorAll('[data-lit="true"]');
    expect(lit).toHaveLength(3); // 75% -> 3 of 4 segments
  });

  it('lights all four exposure segments at 100% and none at 0%', () => {
    const { unmount } = renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend', market_exposure_pct: 100,
    }]} />);
    expect(screen.getByTestId('exposure-ladder').querySelectorAll('[data-lit="true"]')).toHaveLength(4);
    unmount();
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'downtrend', market_exposure_pct: 0,
    }]} />);
    expect(screen.getByTestId('exposure-ladder').querySelectorAll('[data-lit="true"]')).toHaveLength(0);
  });

  it('escalates the distribution-day chip color with the count', () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'uptrend_under_pressure', market_distribution_days: 6,
    }]} />);
    const chip = screen.getByText('6 distribution days').closest('.MuiChip-root');
    expect(chip.className).toContain('MuiChip-colorError');
  });

  it('keeps a confirmed uptrend at the supplied 25% reference cap without authorizing full exposure', async () => {
    renderWithProviders(<MarketRegimeBanner researchExposure={25} results={[{
      market_regime: 'confirmed_uptrend', market_exposure_pct: 100,
    }]} />);
    expect(screen.getByText(/新規資金の試行配分上限（参考）/)).toHaveTextContent('25%');
    expect(screen.queryByText('100%')).not.toBeInTheDocument();
    expect(screen.getByTestId('exposure-ladder').querySelectorAll('[data-lit="true"]')).toHaveLength(1);
    expect(screen.getByText(/市場モデルの観測値/)).toHaveTextContent('条件付きの参考上限');
    fireEvent.mouseOver(screen.getByText('Confirmed Uptrend'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Model observation');
    expect(tooltip).not.toHaveTextContent(/full exposure|フル投資|正当化/i);
  });

  it.each([
    ['uptrend_under_pressure', 'Uptrend Under Pressure'],
    ['correction', 'Correction'],
    ['downtrend', 'Downtrend'],
  ])('describes %s as an observation without position-management commands', async (regime, label) => {
    renderWithProviders(<MarketRegimeBanner results={[{ market_regime: regime }]} />);
    fireEvent.mouseOver(screen.getByText(label));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('Model observation');
    expect(tooltip).not.toHaveTextContent(/trade smaller|tighten stops|raise cash|pilot buys|ロットを落とし|損切りを引き締める|現金比率を上げ/);
  });

  it.each([
    ['missing index observations', [{ market: 'US', currency: 'USD', market_regime: 'confirmed_uptrend' }]],
    ['conflicting regimes', ['confirmed_uptrend', 'downtrend'].map(market_regime => ({
      market: 'US', currency: 'USD', market_regime, market_above_50dma: true, market_above_200dma: true,
    }))],
  ])('preserves the zero reference cap for %s without implying clearance', (_label, results) => {
    const researchExposure = Math.min(modelMarket(results).cap, .25) * 100;
    expect(researchExposure).toBe(0);
    renderWithProviders(<MarketRegimeBanner results={results} researchExposure={researchExposure} />);
    expect(screen.getByText(/新規資金の試行配分上限（参考）/)).toHaveTextContent('0%');
    expect(screen.getByText(/市場モデルの観測値/)).toHaveTextContent('鮮度未確認');
    expect(screen.getByText(/市場モデルの観測値/)).toHaveTextContent('財務・決算予定・購入条件は別に確認');
  });

  it('does not use an old FTD event date as proof of current market conditions', async () => {
    renderWithProviders(<MarketRegimeBanner results={[{
      market_regime: 'confirmed_uptrend', market_ftd_date: '2020-01-02', market_ftd_days_since: 3,
    }]} />);
    const eventDate = screen.getByText('FTD 2020-01-02 (+3d)');
    expect(screen.getByText(/市場モデルの観測値/)).toHaveTextContent('鮮度未確認');
    fireEvent.mouseOver(eventDate);
    expect(await screen.findByRole('tooltip')).toHaveTextContent('市場データの更新日ではありません');
  });

  it('explains the recorded first-row scope when supplied regimes conflict', async () => {
    renderWithProviders(<MarketRegimeBanner researchExposure={0} results={[
      { symbol: 'NO-CONTEXT' },
      { symbol: 'FIRST', market_regime: 'confirmed_uptrend' },
      { symbol: 'SECOND', market_regime: 'downtrend' },
    ]} />);
    expect(screen.getByText('Confirmed Uptrend')).toBeInTheDocument();
    expect(screen.queryByText('Downtrend')).not.toBeInTheDocument();
    fireEvent.mouseOver(screen.getByText('Market'));
    const tooltip = await screen.findByRole('tooltip');
    expect(tooltip).toHaveTextContent('市場区分を持つ最初の行の観測値');
    expect(tooltip).toHaveTextContent('行間の一致や市場観測の鮮度');
    expect(tooltip).toHaveTextContent('この表示だけでは確認できません');
    expect(tooltip).not.toHaveTextContent('欠損・不一致は未確認として扱います');
  });
});
