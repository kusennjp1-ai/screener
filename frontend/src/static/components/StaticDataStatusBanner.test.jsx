import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '../../test/renderWithProviders';
import StaticDataStatusBanner, {
  evaluateSnapshotFreshness,
  lastCompletedTradingSession,
  tradingSessionsBetween,
} from './StaticDataStatusBanner';

// Fixed calendar anchors used throughout (verified weekdays):
//   2026-07-23 Thu · 2026-07-24 Fri · 2026-07-25 Sat · 2026-07-27 Mon · 2026-07-28 Tue
const FRIDAY = '2026-07-24';
// July is EDT (UTC-4) in New York, JST is UTC+9 year round.
const et = (iso) => new Date(`${iso}-04:00`);

const setOnline = (value) => {
  Object.defineProperty(window.navigator, 'onLine', {
    configurable: true,
    get: () => value,
  });
};

afterEach(() => {
  setOnline(true);
});

describe('tradingSessionsBetween', () => {
  it('counts weekdays only, so a weekend costs nothing', () => {
    expect(tradingSessionsBetween(FRIDAY, '2026-07-25')).toBe(0); // Sat
    expect(tradingSessionsBetween(FRIDAY, '2026-07-26')).toBe(0); // Sun
    expect(tradingSessionsBetween(FRIDAY, '2026-07-27')).toBe(1); // Mon
    expect(tradingSessionsBetween(FRIDAY, '2026-07-28')).toBe(2); // Tue
  });

  it('is symmetric-safe and never negative', () => {
    expect(tradingSessionsBetween('2026-07-28', FRIDAY)).toBe(0);
    expect(tradingSessionsBetween(FRIDAY, FRIDAY)).toBe(0);
    expect(tradingSessionsBetween(null, FRIDAY)).toBe(0);
  });

  it('stays exact across long gaps', () => {
    // 2020-01-02 (Thu) -> 2020-01-31 (Fri): 21 weekdays after the start date.
    expect(tradingSessionsBetween('2020-01-02', '2020-01-31')).toBe(21);
  });
});

describe('lastCompletedTradingSession', () => {
  it('waits for the close plus the publish window before advancing', () => {
    // Monday, market still open -> Friday is the last completed session.
    expect(lastCompletedTradingSession(et('2026-07-27T10:00:00'), 'US')).toBe(FRIDAY);
    // Monday 16:30, closed but inside the publish grace -> still Friday.
    expect(lastCompletedTradingSession(et('2026-07-27T16:30:00'), 'US')).toBe(FRIDAY);
    // Monday 18:30, published -> Monday.
    expect(lastCompletedTradingSession(et('2026-07-27T18:30:00'), 'US')).toBe('2026-07-27');
  });

  it('rolls the weekend back to Friday', () => {
    expect(lastCompletedTradingSession(et('2026-07-25T12:00:00'), 'US')).toBe(FRIDAY);
    expect(lastCompletedTradingSession(et('2026-07-26T23:00:00'), 'US')).toBe(FRIDAY);
  });

  it('uses the market’s own timezone', () => {
    // 2026-07-27T21:00 UTC is already Tuesday 06:00 in Tokyo (Monday's session
    // long published), while New York is still Monday 17:00 — closed, but inside
    // the publish window, so Friday is its last dependable session.
    const instant = new Date('2026-07-27T21:00:00Z');
    expect(lastCompletedTradingSession(instant, 'JP')).toBe('2026-07-27');
    expect(lastCompletedTradingSession(instant, 'US')).toBe(FRIDAY);
  });
});

describe('evaluateSnapshotFreshness', () => {
  it('keeps a Friday snapshot fresh through the weekend', () => {
    expect(evaluateSnapshotFreshness({
      asOfDate: FRIDAY, market: 'US', now: et('2026-07-25T12:00:00'),
    })).toMatchObject({ stale: false, sessionsBehind: 0 });
  });

  it('marks the same Friday snapshot stale on Tuesday (the calendar-day bug)', () => {
    // Fri -> Tue is only 4 calendar days, which the old constant called fresh.
    const result = evaluateSnapshotFreshness({
      asOfDate: FRIDAY, market: 'US', now: et('2026-07-28T10:00:00'),
    });
    expect(result.stale).toBe(true);
    expect(result.sessionsBehind).toBe(1);
    expect(result.lastSessionDate).toBe('2026-07-27');
  });

  it('reports unknown rather than stale without a date', () => {
    expect(evaluateSnapshotFreshness({ asOfDate: null, market: 'US' }))
      .toMatchObject({ known: false, stale: false });
  });
});

describe('StaticDataStatusBanner', () => {
  it('renders nothing when online, fresh and fully loaded', () => {
    const { container } = renderWithProviders(
      <StaticDataStatusBanner failures={[]} asOfDate={FRIDAY} market="US" now={et('2026-07-25T12:00:00')} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('names every failed section and retries them all on tap', async () => {
    const retryHome = vi.fn().mockResolvedValue(undefined);
    const retryScan = vi.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <StaticDataStatusBanner
        failures={[
          { key: 'home', label: '主要指数と業種グループ', impact: '指数カードは空になります。', retry: retryHome },
          { key: 'scan', label: 'スキャン結果', impact: '候補リストは空になります。', retry: retryScan },
        ]}
        asOfDate={FRIDAY}
        market="US"
        now={et('2026-07-25T12:00:00')}
      />,
    );
    expect(screen.getByTestId('static-data-error-banner')).toHaveTextContent('一部のデータを読み込めませんでした');
    expect(screen.getByTestId('static-data-failure-home')).toHaveTextContent('主要指数と業種グループ');
    expect(screen.getByTestId('static-data-failure-scan')).toHaveTextContent('候補リストは空になります。');

    fireEvent.click(screen.getByTestId('static-data-retry'));
    await waitFor(() => expect(retryHome).toHaveBeenCalledTimes(1));
    expect(retryScan).toHaveBeenCalledTimes(1);
  });

  it('warns that the cached snapshot is being shown while offline', () => {
    setOnline(false);
    renderWithProviders(
      <StaticDataStatusBanner failures={[]} asOfDate={FRIDAY} market="US" now={et('2026-07-25T12:00:00')} />,
    );
    const banner = screen.getByTestId('static-data-stale-banner');
    expect(banner).toHaveTextContent('オフライン');
    expect(screen.getByTestId('static-data-offline-line')).toHaveTextContent(FRIDAY);
  });

  it('reacts to the browser going offline after mount', async () => {
    renderWithProviders(
      <StaticDataStatusBanner failures={[]} asOfDate={FRIDAY} market="US" now={et('2026-07-25T12:00:00')} />,
    );
    expect(screen.queryByTestId('static-data-stale-banner')).not.toBeInTheDocument();
    setOnline(false);
    fireEvent(window, new Event('offline'));
    expect(await screen.findByTestId('static-data-stale-banner')).toBeInTheDocument();
  });

  it('warns when the snapshot is behind the last completed session', () => {
    renderWithProviders(
      <StaticDataStatusBanner failures={[]} asOfDate={FRIDAY} market="US" now={et('2026-07-28T10:00:00')} />,
    );
    const line = screen.getByTestId('static-data-stale-line');
    expect(line).toHaveTextContent('2026-07-27');
    expect(line).toHaveTextContent('取引1日分遅れています');
  });
});
