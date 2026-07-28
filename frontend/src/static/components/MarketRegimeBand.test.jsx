import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import MarketRegimeBand from './MarketRegimeBand';

// Minervini's first filter is market direction. The band must state one of
// three verdicts from the regime that already rides on every scan row — and
// must refuse to state one when that data is absent.
const row = (overrides = {}) => ({
  symbol: 'AAA',
  market_regime: 'confirmed_uptrend',
  market_health: 78,
  market_exposure_pct: 100,
  market_distribution_days: 2,
  market_ftd_date: '2026-06-12',
  market_ftd_days_since: 30,
  ...overrides,
});

const verdictOf = () => screen.getByTestId('market-regime-verdict').textContent;
const inputsOf = () => screen.getByTestId('market-regime-inputs').textContent;

describe('MarketRegimeBand', () => {
  it.each([
    ['confirmed_uptrend', '買い場'],
    ['uptrend_under_pressure', '慎重'],
    ['correction', '待機'],
    ['downtrend', '待機'],
  ])('maps regime %s to the verdict %s', (regime, verdict) => {
    render(<MarketRegimeBand results={[row({ market_regime: regime })]} />);
    expect(verdictOf()).toBe(verdict);
  });

  it('shows the inputs that produced the verdict', () => {
    render(<MarketRegimeBand results={[row()]} />);
    expect(inputsOf()).toBe('健全度 78/100 · 売り抜け 2日 · FTD 2026-06-12 +30d');
    expect(screen.getByTestId('market-regime-exposure')).toHaveTextContent('推奨 100%');
  });

  it('lists only the inputs the snapshot actually carries', () => {
    render(<MarketRegimeBand results={[row({
      market_health: null, market_ftd_date: null, market_ftd_days_since: null,
    })]} />);
    expect(inputsOf()).toBe('売り抜け 2日');
  });

  it('omits the FTD age when only the date is exported', () => {
    render(<MarketRegimeBand results={[row({ market_ftd_days_since: null })]} />);
    expect(inputsOf()).toContain('FTD 2026-06-12');
    expect(inputsOf()).not.toContain('+');
  });

  it('reads the regime off the first row that carries one', () => {
    render(<MarketRegimeBand results={[
      { symbol: 'NOREG' },
      row({ symbol: 'HASREG', market_regime: 'correction' }),
    ]} />);
    expect(verdictOf()).toBe('待機');
  });

  it.each([
    ['no rows', []],
    ['rows without a regime', [{ symbol: 'AAA', market_health: 90 }]],
    ['a non-array payload', undefined],
  ])('renders 判定不能 rather than a fake verdict for %s', (_label, results) => {
    render(<MarketRegimeBand results={results} />);
    expect(verdictOf()).toBe('判定不能');
    expect(inputsOf()).toBe('スキャン出力に地合いデータが含まれていません');
    expect(screen.queryByTestId('market-regime-exposure')).not.toBeInTheDocument();
  });

  // An unrecognised regime string is a data problem, not a buy signal.
  it('refuses to guess at an unknown regime string and names it', () => {
    render(<MarketRegimeBand results={[row({ market_regime: 'sideways_chop' })]} />);
    expect(verdictOf()).toBe('判定不能');
    expect(inputsOf()).toContain('未知の地合い区分「sideways_chop」');
    expect(inputsOf()).toContain('健全度 78/100');
    expect(screen.queryByTestId('market-regime-exposure')).not.toBeInTheDocument();
  });

  it('says so when a recognised regime arrives with no numbers behind it', () => {
    render(<MarketRegimeBand results={[{ symbol: 'AAA', market_regime: 'correction' }]} />);
    expect(verdictOf()).toBe('待機');
    expect(inputsOf()).toBe('判定の内訳が出力されていません');
  });
});
