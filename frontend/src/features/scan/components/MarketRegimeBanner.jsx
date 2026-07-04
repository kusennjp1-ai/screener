import { Chip, Paper, Tooltip, Typography } from '@mui/material';
import GlossaryLabel from '../../../components/common/GlossaryLabel';

// Minervini's first rule: trade with the general market, scale exposure to its
// health. The regime is computed once per scan (identical across rows), so read
// it off the first result and show a single banner above the table.
const REGIME_META = {
  confirmed_uptrend: {
    label: 'Confirmed Uptrend',
    color: 'success',
    hint: 'General market in a confirmed uptrend — full exposure warranted.（上昇トレンド確認済み — フル投資が正当化される局面）',
  },
  uptrend_under_pressure: {
    label: 'Uptrend Under Pressure',
    color: 'warning',
    hint: 'Distribution building — trade smaller, tighten stops.（機関の売りが積み上がり中 — ロットを落とし損切りを引き締める）',
  },
  correction: {
    label: 'Correction',
    color: 'warning',
    hint: 'Market in correction — raise cash, only pilot buys.（市場は調整中 — 現金比率を上げ、試し玉のみ）',
  },
  downtrend: {
    label: 'Downtrend',
    color: 'error',
    hint: "Downtrend — don't fight the tape; setups are watchlist-only.（下落トレンド — 逆らわない。監視リスト入りに留める）",
  },
};

export default function MarketRegimeBanner({ results }) {
  const row = Array.isArray(results) ? results.find((r) => r?.market_regime) : null;
  if (!row || !row.market_regime) return null;

  const meta = REGIME_META[row.market_regime] || {
    label: row.market_regime,
    color: 'default',
    hint: '',
  };
  const health = row.market_health;
  const exposure = row.market_exposure_pct;
  const distDays = row.market_distribution_days;

  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.25, mb: 2, display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}
    >
      <GlossaryLabel term="market_regime">
        <Typography component="span" variant="subtitle2" sx={{ fontWeight: 700 }}>
          Market
        </Typography>
      </GlossaryLabel>
      <Tooltip title={meta.hint} arrow>
        <Chip size="small" color={meta.color} label={meta.label} />
      </Tooltip>
      {health != null && (
        <GlossaryLabel term="market_health">
          <Typography component="span" variant="body2" color="text.secondary">
            Health {Math.round(health)}/100
          </Typography>
        </GlossaryLabel>
      )}
      {exposure != null && (
        <Typography variant="body2" color="text.secondary" component="span">
          {'· '}
          <GlossaryLabel term="exposure">
            <Typography component="span" variant="body2" color="text.secondary">
              Suggested exposure <strong>{exposure}%</strong>
            </Typography>
          </GlossaryLabel>
        </Typography>
      )}
      {distDays != null && (
        <Typography variant="body2" color="text.secondary" component="span">
          {'· '}
          <GlossaryLabel term="distribution_days">
            <Typography component="span" variant="body2" color="text.secondary">
              {distDays} distribution day{distDays === 1 ? '' : 's'}
            </Typography>
          </GlossaryLabel>
        </Typography>
      )}
    </Paper>
  );
}
