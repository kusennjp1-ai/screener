import { Box, Typography } from '@mui/material';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import WhatshotIcon from '@mui/icons-material/Whatshot';
import VerticalAlignTopIcon from '@mui/icons-material/VerticalAlignTop';
import GlossaryLabel from '../../../components/common/GlossaryLabel';

// 売りタイミングカード — the exit half of the trade. Renders the backend
// sell_plan: climax (sell into strength), 50-DMA breakdown (sell into
// weakness) and the trailing-stop ladder. Warning states pulse gently so an
// actionable exit is impossible to miss; "hold" renders nothing (no noise).
const ACTION_META = {
  exit: {
    color: '#f23645',
    icon: TrendingDownIcon,
    title: 'Sell — Trend Broken',
    ja: '売り：トレンド崩壊（50日線を出来高を伴い割り込み）',
    term: 'breakdown_50dma',
    pulse: true,
  },
  sell_into_strength: {
    color: '#e0a52e',
    icon: WhatshotIcon,
    title: 'Sell Into Strength',
    ja: '強さに売る：クライマックス（買い疲れの急騰）を検出',
    term: 'climax',
    pulse: true,
  },
  tighten_stop: {
    color: '#e0a52e',
    icon: VerticalAlignTopIcon,
    title: 'Tighten Stop',
    ja: '損切りラインを引き締め（浅い50日線割れ）',
    term: 'stop',
    pulse: false,
  },
  raise_stop: {
    color: '#22ab94',
    icon: VerticalAlignTopIcon,
    title: 'Raise Stop',
    ja: '損切りラインを切り上げ（R倍数の利益を確保）',
    term: 'trailing_stop',
    pulse: false,
  },
};

const CLIMAX_FLAG_JA = {
  extended_above_200dma: '200日線から70%以上の乖離',
  up_day_frenzy: '直近10日中8日以上が上昇（買い疲れ）',
  largest_up_day_late: '上昇局面で最大の上げ幅が終盤に出現',
  exhaustion_gap: '過熱圏での窓開け急騰（消耗ギャップ）',
};

export default function SellPlanCard({ sellPlan }) {
  const action = sellPlan?.action;
  const meta = ACTION_META[action];
  if (!meta) return null; // hold / missing -> stay quiet

  const Icon = meta.icon;
  const climaxFlags = sellPlan?.climax?.flags || [];
  const trailing = sellPlan?.trailing || {};

  return (
    <Box sx={{
      position: 'absolute', right: 16, top: 56, zIndex: 5, width: 300,
      bgcolor: 'rgba(13,16,22,0.96)', border: `1px solid ${meta.color}`, borderRadius: 1.5,
      boxShadow: '0 8px 28px rgba(0,0,0,0.55)', p: 1.5,
      ...(meta.pulse && {
        animation: 'sellPulse 2s ease-in-out infinite',
        '@keyframes sellPulse': {
          '0%, 100%': { boxShadow: `0 0 0 0 ${meta.color}44` },
          '50%': { boxShadow: `0 0 0 8px ${meta.color}00` },
        },
      }),
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <Icon sx={{ color: meta.color, fontSize: 20 }} />
        <GlossaryLabel term={meta.term}>
          <Typography component="span" sx={{ color: '#fff', fontWeight: 800, fontSize: 16 }}>
            {meta.title}
          </Typography>
        </GlossaryLabel>
      </Box>
      <Typography sx={{ color: '#c3c7cf', fontSize: 12, lineHeight: 1.5 }}>{meta.ja}</Typography>

      {action === 'sell_into_strength' && climaxFlags.length > 0 && (
        <Box sx={{ mt: 0.75 }}>
          {climaxFlags.map((f) => (
            <Typography key={f} sx={{ color: '#e0a52e', fontSize: 11.5, lineHeight: 1.6 }}>
              • {CLIMAX_FLAG_JA[f] || f}
            </Typography>
          ))}
          {sellPlan?.climax?.extension_200dma_pct != null && (
            <Typography sx={{ color: '#787b86', fontSize: 11.5, mt: 0.25 }}>
              200-DMA乖離 +{sellPlan.climax.extension_200dma_pct}% · スコア {sellPlan.climax.score}/100
            </Typography>
          )}
        </Box>
      )}

      {(action === 'raise_stop' || trailing?.raised) && trailing?.stop != null && (
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1, pt: 1, borderTop: '1px solid #23262f' }}>
          <GlossaryLabel term="r_multiple">
            <Typography component="span" sx={{ color: '#d1d4dc', fontSize: 13 }}>
              +{trailing.r_multiple}R
            </Typography>
          </GlossaryLabel>
          <Typography sx={{ color: '#22ab94', fontSize: 13 }}>
            new stop @ <b>{Number(trailing.stop).toFixed(2)}</b>
          </Typography>
        </Box>
      )}

      {action === 'exit' && sellPlan?.breakdown?.volume_multiple != null && (
        <Typography sx={{ color: '#787b86', fontSize: 11.5, mt: 0.75 }}>
          出来高 平均比 {sellPlan.breakdown.volume_multiple}x · 確度 {Math.round((sellPlan.breakdown.confidence || 0) * 100)}%
        </Typography>
      )}
    </Box>
  );
}
