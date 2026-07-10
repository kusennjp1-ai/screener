import { Box, Chip, Paper, Tooltip, Typography } from '@mui/material';
import GlossaryLabel from '../../../components/common/GlossaryLabel';
import { MOTION, enterSlideFade, pulseRing } from '../../../theme/motion';

// Minervini's first rule: trade with the general market, scale exposure to its
// health. The regime is computed once per scan (identical across rows), so read
// it off the first result and show a single banner above the table.
const REGIME_META = {
  confirmed_uptrend: {
    label: 'Confirmed Uptrend',
    color: 'success',
    pulse: '#4caf50',
    hint: 'General market in a confirmed uptrend — full exposure warranted.（上昇トレンド確認済み — フル投資が正当化される局面）',
  },
  uptrend_under_pressure: {
    label: 'Uptrend Under Pressure',
    color: 'warning',
    pulse: null,
    hint: 'Distribution building — trade smaller, tighten stops.（機関の売りが積み上がり中 — ロットを落とし損切りを引き締める）',
  },
  correction: {
    label: 'Correction',
    color: 'warning',
    pulse: null,
    hint: 'Market in correction — raise cash, only pilot buys.（市場は調整中 — 現金比率を上げ、試し玉のみ）',
  },
  downtrend: {
    label: 'Downtrend',
    color: 'error',
    pulse: '#f44336',
    hint: "Downtrend — don't fight the tape; setups are watchlist-only.（下落トレンド — 逆らわない。監視リスト入りに留める）",
  },
};

const healthColor = (value) => {
  if (value >= 70) return '#4caf50';
  if (value >= 40) return '#ffb300';
  return '#f44336';
};

/**
 * Animated 0-100 health meter: the fill sweeps in on mount (tween token).
 * The numeric label stays primary — the bar is the at-a-glance read, the
 * number is the truth.
 */
const HealthMeter = ({ health }) => {
  const value = Math.max(0, Math.min(100, Math.round(health)));
  return (
    <GlossaryLabel term="market_health">
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
        <Typography component="span" variant="body2" color="text.secondary">
          Health {value}/100
        </Typography>
        <Box
          data-testid="health-meter"
          sx={{
            position: 'relative',
            width: 72,
            height: 6,
            borderRadius: 3,
            bgcolor: 'action.hover',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              width: `${value}%`,
              borderRadius: 3,
              bgcolor: healthColor(value),
              '@media (prefers-reduced-motion: no-preference)': {
                animation: `healthSweep ${MOTION.duration.tween}ms ${MOTION.easing.enter} both`,
                '@keyframes healthSweep': {
                  from: { width: 0 },
                  to: { width: `${value}%` },
                },
              },
            }}
          />
        </Box>
      </Box>
    </GlossaryLabel>
  );
};

/**
 * Suggested-exposure ladder: four rising segments (Minervini scales in — pilot
 * → add → build → full). Lit segments arrive in a stagger, bottom-up.
 */
const ExposureLadder = ({ exposure }) => {
  const value = Math.max(0, Math.min(100, exposure));
  const litSegments = Math.round((value / 100) * 4);
  return (
    <GlossaryLabel term="exposure">
      <Box component="span" sx={{ display: 'inline-flex', alignItems: 'flex-end', gap: 0.75 }}>
        <Typography component="span" variant="body2" color="text.secondary">
          Suggested exposure <strong>{value}%</strong>
        </Typography>
        <Box
          data-testid="exposure-ladder"
          sx={{ display: 'inline-flex', alignItems: 'flex-end', gap: '3px', pb: '2px' }}
        >
          {[0, 1, 2, 3].map((segment) => {
            const lit = segment < litSegments;
            return (
              <Box
                key={segment}
                data-lit={lit ? 'true' : 'false'}
                sx={{
                  width: 9,
                  height: 6 + segment * 3,
                  borderRadius: 0.5,
                  bgcolor: lit ? healthColor(value) : 'action.hover',
                  transformOrigin: 'bottom',
                  '@media (prefers-reduced-motion: no-preference)': lit
                    ? {
                        animation: `segmentIn ${MOTION.duration.enter}ms ${MOTION.easing.enter} both`,
                        animationDelay: `${segment * 70}ms`,
                        '@keyframes segmentIn': {
                          from: { opacity: 0, transform: 'scaleY(0.4)' },
                          to: { opacity: 1, transform: 'scaleY(1)' },
                        },
                      }
                    : {},
                }}
              />
            );
          })}
        </Box>
      </Box>
    </GlossaryLabel>
  );
};

const distDaysColor = (distDays) => {
  if (distDays >= 6) return 'error';
  if (distDays >= 4) return 'warning';
  return 'default';
};

export default function MarketRegimeBanner({ results }) {
  const row = Array.isArray(results) ? results.find((r) => r?.market_regime) : null;
  if (!row || !row.market_regime) return null;

  const meta = REGIME_META[row.market_regime] || {
    label: row.market_regime,
    color: 'default',
    pulse: null,
    hint: '',
  };
  const health = row.market_health;
  const exposure = row.market_exposure_pct;
  const distDays = row.market_distribution_days;
  const ftdDate = row.market_ftd_date;
  const ftdAge = row.market_ftd_days_since;

  return (
    <Paper
      variant="outlined"
      sx={{
        p: 1.25,
        mb: 2,
        display: 'flex',
        alignItems: 'center',
        gap: 1.5,
        flexWrap: 'wrap',
        ...enterSlideFade(0),
      }}
    >
      <GlossaryLabel term="market_regime">
        <Typography component="span" variant="subtitle2" sx={{ fontWeight: 700 }}>
          Market
        </Typography>
      </GlossaryLabel>
      <Tooltip title={meta.hint} arrow>
        <Chip
          size="small"
          color={meta.color}
          label={meta.label}
          sx={meta.pulse ? pulseRing(meta.pulse) : undefined}
        />
      </Tooltip>
      {ftdDate && (
        <GlossaryLabel term="follow_through">
          <Chip
            size="small"
            color="info"
            variant="outlined"
            label={`FTD ${ftdDate}${ftdAge != null ? ` (+${ftdAge}d)` : ''}`}
          />
        </GlossaryLabel>
      )}
      {health != null && <HealthMeter health={health} />}
      {exposure != null && <ExposureLadder exposure={exposure} />}
      {distDays != null && (
        <GlossaryLabel term="distribution_days">
          <Chip
            size="small"
            variant="outlined"
            color={distDaysColor(distDays)}
            label={`${distDays} distribution day${distDays === 1 ? '' : 's'}`}
          />
        </GlossaryLabel>
      )}
    </Paper>
  );
}
