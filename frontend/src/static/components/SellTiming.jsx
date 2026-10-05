import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import BlockIcon from '@mui/icons-material/Block';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import BoltIcon from '@mui/icons-material/Bolt';
import KeyboardDoubleArrowUpIcon from '@mui/icons-material/KeyboardDoubleArrowUp';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import RemoveIcon from '@mui/icons-material/Remove';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { C } from '../designTokens';
import { observationFreshness } from '../technicalObservation';

// These are exported model observations, without a verified holding, entry,
// current quote, or executed order. Rank preserves the existing watchlist order.
export const ACTION_META = {
  stop_hit: { label: 'モデル停止水準割れの記録', Icon: BlockIcon, color: C.red, rank: 0 },
  exit: { label: '50日線割れの記録', Icon: TrendingDownIcon, color: C.red, rank: 1 },
  sell_into_strength: { label: '過熱候補の記録', Icon: BoltIcon, color: C.amber, rank: 2 },
  tighten_stop: { label: '停止水準見直しのモデル記録', Icon: KeyboardDoubleArrowUpIcon, color: C.amber, rank: 3 },
  raise_stop: { label: '利益保護のモデル記録', Icon: ArrowUpwardIcon, color: C.blue, rank: 4 },
  hold: { label: '売却条件の検出なし（モデル記録）', Icon: RemoveIcon, color: C.grey, rank: 5 },
  no_data: { label: '売却モデル未計算', Icon: HelpOutlineIcon, color: C.grey, rank: 6 },
};
export const DEFAULT_META = ACTION_META.no_data;

const EXPLANATIONS = {
  stop_hit: '配信時のモデルで停止水準割れが記録されています。',
  exit: '配信時のモデルで50日線割れが記録されています。',
  sell_into_strength: '配信時のモデルで過熱の候補が記録されています。',
  tighten_stop: '配信時のモデルで停止水準の見直し条件が記録されています。',
  raise_stop: '配信時のモデルで利益保護の条件が記録されています。',
  hold: '配信時のモデルで売却条件が検出されなかった記録です。保有継続や安全性を示す判定ではありません。',
  no_data: '有効な売却モデルの記録がありません。',
};
const numeric = (value, positive = false) => {
  if ((typeof value !== 'number' && typeof value !== 'string') || (typeof value === 'string' && !value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) && (!positive || number > 0) ? number : null;
};

const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));

// Normalize the two payload shapes into one: the charts-index `sell` block
// ({action, stop, target_2r, target_3r, r_multiple}) and the chart-level
// `sell_plan` ({action, stop_level, targets:{two_r,three_r}}).
export function normalizeSell(sell) {
  if (!sell) return null;
  const stop = sell.stop != null ? sell.stop : sell.stop_level;
  const t2 = sell.target_2r != null ? sell.target_2r : sell.targets?.two_r;
  const t3 = sell.target_3r != null ? sell.target_3r : sell.targets?.three_r;
  return {
    action: Object.hasOwn(ACTION_META, sell.action) ? sell.action : 'no_data',
    stop: numeric(stop, true),
    stopBasis: sell.stop_basis || null,
    rMultiple: numeric(sell.r_multiple),
    target2r: numeric(t2, true),
    target3r: numeric(t3, true),
  };
}

function Pill({ meta, compact }) {
  const Icon = meta.Icon;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px',
      borderRadius: 1, bgcolor: `color-mix(in srgb, ${meta.color} 13%, transparent)`, border: `1px solid ${meta.color}`,
    }}>
      <Icon sx={{ fontSize: compact ? 12 : 13, color: meta.color }} />
      <Typography sx={{ fontWeight: 800, fontSize: compact ? 10 : 11, color: meta.color, lineHeight: 1.2 }}>
        {meta.label}
      </Typography>
    </Box>
  );
}

// The separate sell block must never be presented as the buy block's risk
// plan. Its entry/basis can differ; no R ladder or position P&L is inferred.
export default function SellTiming({ sell, compact = false, stale = false, freshness = observationFreshness(null), currency = '' }) {
  const n = normalizeSell(sell) || { action: 'no_data', stop: null };
  const meta = ACTION_META[n.action] || DEFAULT_META;
  const basis = n.stopBasis === 'initial' ? '初期モデル' : n.stopBasis;
  const freshnessLabel = `${stale ? '前回の保存記録・鮮度未確認 · ' : ''}${freshness.label}`;

  return (
    <Box data-testid="sell-timing" data-action={n.action} data-freshness={freshness.state} data-record-source={stale ? 'saved' : 'exported'}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', rowGap: 0.5 }}>
      <Typography sx={{ fontSize: 11, color: C.grey }}>売却モデル参考</Typography>
      <Pill meta={meta} compact={compact} />
      {n.stop != null && <Typography sx={{ fontSize: compact ? 10.5 : 11.5, color: C.ink, fontFamily: 'monospace' }}>
        モデル停止水準 {currency}{fmt(n.stop)}{basis ? ` · ${basis}` : ''}
      </Typography>}
      <Typography sx={{ fontSize: 11, color: C.grey, flexBasis: '100%' }}>
        配信基準日 {freshness.date || '未確認'} · {freshnessLabel}
      </Typography>
      {!compact && <Box component="details" sx={{ flexBasis: '100%', fontSize: 12, color: C.grey }}>
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>売却モデルの記録について</summary>
        <p>{EXPLANATIONS[n.action]}</p>
        <p>停止水準は別の売却モデルの参考値です。上のシグナル基準値に対する損失率や、実際の保有の損益・追随ストップを示しません。あなたの保有・注文・約定を確認したものではありません。</p>
      </Box>}
    </Box>
  );
}
