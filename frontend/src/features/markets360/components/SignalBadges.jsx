import { Box, Chip, Tooltip } from '@mui/material';
import BoltIcon from '@mui/icons-material/Bolt';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import { enterSlideFade } from '../../../theme/motion';

// Compact Markets 360 signal badges — the mobile-first counterpart of the
// BuyingNowCard / SellPlanCard overlays (which would cover the candles at
// 375px). Same palette, same Japanese readings, tap-to-explain tooltips.
//
// Motion: badges slide-fade in with a small stagger (arrival should read as
// "the engine just spoke"), urgent actions carry the shared pulse ring.
// Both honor prefers-reduced-motion — the badge is still fully readable
// with zero animation.
const SELL_META = {
  stop_hit: {
    color: '#f23645',
    Icon: TrendingDownIcon,
    label: 'STOP HIT',
    ja: '売り：損切りライン到達（ストップは絶対、翌日成行で撤退）',
    pulse: true,
  },
  exit: {
    color: '#f23645',
    Icon: TrendingDownIcon,
    label: 'SELL',
    ja: '売り：トレンド崩壊（50日線を出来高を伴い割り込み）',
    pulse: true,
  },
  sell_into_strength: {
    color: '#e0a52e',
    Icon: WhatshotIcon,
    label: 'Sell Strength',
    ja: '強さに売る：クライマックス（買い疲れの急騰）を検出',
    pulse: true,
  },
  tighten_stop: {
    color: '#e0a52e',
    Icon: VerticalAlignTopIcon,
    label: 'Tighten Stop',
    ja: '損切りラインを引き締め（浅い50日線割れ）',
    pulse: false,
  },
  raise_stop: {
    color: '#22ab94',
    Icon: VerticalAlignTopIcon,
    label: 'Raise Stop',
    ja: '損切りラインを切り上げ（R倍数の利益を確保）',
    pulse: false,
  },
};

const badgeSx = (color, pulse, order) => ({
  fontWeight: 700,
  color,
  border: `1px solid ${color}`,
  bgcolor: 'rgba(13,16,22,0.92)',
  height: 30,
  '.MuiChip-icon': { color },
  // Shared motion vocabulary: staggered arrival; urgent -> pulse ring.
  ...enterSlideFade(order, pulse ? color : null),
});

export default function SignalBadges({ signal, sellPlan, sx }) {
  const buyActive = Boolean(signal?.active);
  const sellMeta = SELL_META[sellPlan?.action];
  if (!buyActive && !sellMeta) return null;

  let order = 0;
  return (
    <Box
      data-testid="signal-badges"
      sx={{ display: 'flex', gap: 0.75, alignItems: 'center', py: 0.75, px: 1, ...sx }}
    >
      {buyActive && (
        <Tooltip
          arrow
          enterTouchDelay={0}
          leaveTouchDelay={8000}
          title={signal.trigger_price != null
            ? `${signal.headline || 'Buying Now!'} — entry ${Number(signal.trigger_price).toFixed(2)}${signal.stop != null ? ` / stop ${Number(signal.stop).toFixed(2)}` : ''}`
            : (signal.headline || 'Buying Now!')}
        >
          <Chip
            size="small"
            icon={<BoltIcon sx={{ fontSize: 16 }} />}
            label={signal.headline || 'Buying Now!'}
            data-testid="signal-badge-buy"
            sx={badgeSx('#3aa0ff', true, order++)}
          />
        </Tooltip>
      )}
      {sellMeta && (
        <Tooltip arrow enterTouchDelay={0} leaveTouchDelay={8000} title={sellMeta.ja}>
          <Chip
            size="small"
            icon={<sellMeta.Icon sx={{ fontSize: 16 }} />}
            label={sellPlan?.trailing?.raised && sellPlan?.trailing?.stop != null
              ? `${sellMeta.label} @ ${Number(sellPlan.trailing.stop).toFixed(2)}`
              : sellMeta.label}
            data-testid={`signal-badge-${sellPlan.action}`}
            sx={badgeSx(sellMeta.color, sellMeta.pulse, order++)}
          />
        </Tooltip>
      )}
    </Box>
  );
}
