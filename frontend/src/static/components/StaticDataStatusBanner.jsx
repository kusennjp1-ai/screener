import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CloudOffIcon from '@mui/icons-material/CloudOff';
import UpdateIcon from '@mui/icons-material/Update';
import ReportProblemIcon from '@mui/icons-material/ReportProblem';
import RefreshIcon from '@mui/icons-material/Refresh';
import { C, T, W, px } from '../designTokens';

// データ状態バナー (C98) — the single place the static PWA admits that what it
// is showing is incomplete or old.
//
// Two independent failure modes, deliberately kept in ONE module so the page
// never has to choose between them:
//
//  1. A root fetch failed. The page must still render everything that DID load;
//     this banner names what is missing, what it costs the user, and offers a
//     retry that refetches only the failed queries.
//  2. The snapshot is old — or the device is offline and the service worker is
//     replaying a cached bundle. Staleness is measured in TRADING SESSIONS, not
//     calendar days: a Friday snapshot is fine on Saturday and wrong on Tuesday.

// Regular-session close per market, in the market's own timezone. Only markets
// this app exports are listed; anything else falls back to the US session.
const MARKET_SESSIONS = {
  US: { timeZone: 'America/New_York', closeMinutes: 16 * 60 },
  JP: { timeZone: 'Asia/Tokyo', closeMinutes: 15 * 60 + 30 },
  HK: { timeZone: 'Asia/Hong_Kong', closeMinutes: 16 * 60 },
  TW: { timeZone: 'Asia/Taipei', closeMinutes: 13 * 60 + 30 },
};

// The export pipeline publishes minutes after the bell. Without this allowance
// every market would flash "stale" for the whole post-close publish window.
const PUBLISH_GRACE_MINUTES = 120;

const DAY_MS = 86_400_000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/;

export const resolveMarketSession = (market) =>
  MARKET_SESSIONS[String(market || '').toUpperCase()] || MARKET_SESSIONS.US;

const toEpochDay = (isoDate) => {
  const match = ISO_DATE.exec(String(isoDate || ''));
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
};

const fromEpochDay = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

// 1970-01-01 (epoch day 0) was a Thursday -> weekday index 4 with 0=Sunday.
const dayOfWeek = (day) => (((day + 4) % 7) + 7) % 7;
const isWeekday = (day) => dayOfWeek(day) >= 1 && dayOfWeek(day) <= 5;

// Weekdays in epoch days 0..day inclusive. Closed form so a snapshot years old
// costs the same as one a day old.
const weekdaysThrough = (day) => {
  if (day < 0) return 0;
  const total = day + 1;
  const fullWeeks = Math.floor(total / 7);
  let count = fullWeeks * 5;
  for (let i = 0; i < total % 7; i += 1) {
    if (isWeekday(fullWeeks * 7 + i)) count += 1;
  }
  return count;
};

// The market's own wall-clock date and minute-of-day right now.
const marketLocalNow = (now, timeZone) => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const bag = {};
  parts.forEach((part) => {
    if (part.type !== 'literal') bag[part.type] = part.value;
  });
  return {
    date: `${bag.year}-${bag.month}-${bag.day}`,
    minutes: (Number(bag.hour) % 24) * 60 + Number(bag.minute),
  };
};

/**
 * The most recent trading session that has both closed AND had time to publish.
 * Weekday-based: exchange holidays are not modelled, so on a holiday this can
 * name a day the market never opened. That errs toward warning, never toward a
 * false "fresh" — the banner copy says so.
 */
export function lastCompletedTradingSession(now = new Date(), market = 'US') {
  const session = resolveMarketSession(market);
  const local = marketLocalNow(now, session.timeZone);
  let day = toEpochDay(local.date);
  if (day == null) return null;
  const publishedToday = isWeekday(day)
    && local.minutes >= session.closeMinutes + PUBLISH_GRACE_MINUTES;
  if (!publishedToday) day -= 1;
  let guard = 0;
  while (!isWeekday(day) && guard < 10) {
    day -= 1;
    guard += 1;
  }
  return fromEpochDay(day);
}

/** Trading sessions strictly after `fromDate` up to and including `toDate`. */
export function tradingSessionsBetween(fromDate, toDate) {
  const from = toEpochDay(fromDate);
  const to = toEpochDay(toDate);
  if (from == null || to == null || to <= from) return 0;
  return weekdaysThrough(to) - weekdaysThrough(from);
}

/**
 * How far behind the snapshot is, in completed trading sessions.
 * `stale` is the single rule the page banner and the buy card both obey.
 */
export function evaluateSnapshotFreshness({ asOfDate, market = 'US', now = new Date() } = {}) {
  const lastSessionDate = lastCompletedTradingSession(now, market);
  if (toEpochDay(asOfDate) == null) {
    return { known: false, stale: false, sessionsBehind: null, lastSessionDate };
  }
  const sessionsBehind = tradingSessionsBetween(asOfDate, lastSessionDate);
  return { known: true, stale: sessionsBehind >= 1, sessionsBehind, lastSessionDate };
}

/** navigator.onLine, kept live through the online/offline events. */
export function useOnlineStatus() {
  const read = () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false);
  const [online, setOnline] = useState(read);
  useEffect(() => {
    const sync = () => setOnline(read());
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    sync();
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);
  return online;
}

function Notice({ testId, tone, Icon, title, children, action }) {
  return (
    <Box
      data-testid={testId}
      sx={{
        p: 1.25,
        mb: 1.5,
        borderRadius: 1.5,
        border: `1px solid ${tone}`,
        bgcolor: tone === C.down ? 'rgba(242,54,69,0.08)' : 'rgba(224,165,46,0.08)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6, flexWrap: 'wrap' }}>
        <Icon sx={{ fontSize: px(T.heading), color: tone }} />
        <Typography sx={{ color: tone, fontWeight: W.bold, fontSize: px(T.strong) }}>{title}</Typography>
        <Box sx={{ flex: 1, minWidth: 8 }} />
        {action}
      </Box>
      <Box sx={{ mt: 0.35 }}>{children}</Box>
    </Box>
  );
}

const bodySx = { color: C.grey, fontSize: px(T.body), lineHeight: 1.5 };

export default function StaticDataStatusBanner({
  failures = [],
  asOfDate = null,
  market = 'US',
  now,
}) {
  const online = useOnlineStatus();
  const freshness = useMemo(
    () => evaluateSnapshotFreshness({ asOfDate, market, now: now || new Date() }),
    [asOfDate, market, now],
  );
  const [retrying, setRetrying] = useState(false);
  const retryAll = useCallback(async () => {
    setRetrying(true);
    try {
      await Promise.all(failures.map((failure) => failure.retry?.()));
    } finally {
      setRetrying(false);
    }
  }, [failures]);

  const showFreshness = !online || freshness.stale;
  if (!failures.length && !showFreshness) return null;

  return (
    <Box>
      {failures.length > 0 && (
        <Notice
          testId="static-data-error-banner"
          tone={C.down}
          Icon={ReportProblemIcon}
          title="一部のデータを読み込めませんでした"
          action={(
            <Box
              component="button"
              type="button"
              data-testid="static-data-retry"
              onClick={retryAll}
              disabled={retrying}
              sx={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 0.4,
                px: 1,
                py: 0.35,
                borderRadius: 1,
                cursor: retrying ? 'default' : 'pointer',
                bgcolor: 'transparent',
                color: retrying ? C.dim : C.blue,
                border: `1px solid ${retrying ? C.dim : C.blue}`,
                // NOT the `font` shorthand: it resets size/weight/family at once
                // and left this label inheriting an unpredictable size.
                fontFamily: 'inherit',
                fontSize: px(T.body),
                fontWeight: W.medium,
              }}
            >
              <RefreshIcon sx={{ fontSize: px(T.strong) }} />
              {retrying ? '再読み込み中' : '再試行'}
            </Box>
          )}
        >
          {failures.map((failure) => (
            <Typography key={failure.key} sx={bodySx} data-testid={`static-data-failure-${failure.key}`}>
              ・{failure.label}が表示できません — {failure.impact}
            </Typography>
          ))}
          <Typography sx={{ ...bodySx, mt: 0.35, color: C.dim }}>
            読み込めたものはそのまま下に表示しています。
          </Typography>
        </Notice>
      )}

      {showFreshness && (
        <Notice
          testId="static-data-stale-banner"
          tone={C.amber}
          Icon={online ? UpdateIcon : CloudOffIcon}
          title={online ? 'データが最新ではありません' : 'オフライン — 保存済みデータを表示中'}
        >
          {!online && (
            <Typography sx={bodySx} data-testid="static-data-offline-line">
              通信できないため、端末に保存された最後のスナップショットを表示しています。
              {asOfDate ? `（${asOfDate} 時点）` : ''}
              オンラインに戻ると自動で最新を取得します。
            </Typography>
          )}
          {freshness.stale && (
            <Typography sx={bodySx} data-testid="static-data-stale-line">
              表示中のデータは {asOfDate} 時点。直近の立会日は {freshness.lastSessionDate} で、
              取引{freshness.sessionsBehind}日分遅れています。価格も判定も古いので、この画面で新規の買いを決めないでください。
            </Typography>
          )}
          {online && freshness.stale && (
            <Typography sx={{ ...bodySx, color: C.dim, mt: 0.35 }}>
              市場が祝日で休みだった場合も、この表示になることがあります。
            </Typography>
          )}
        </Notice>
      )}
    </Box>
  );
}
