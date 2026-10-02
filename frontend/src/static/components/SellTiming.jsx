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

// Shared, fallback-safe sell-timing renderer (C97). The promise is that EVERY
// name the user sees always shows its exit: an action pill + a protective stop
// + the 2R/3R targets. It NEVER returns null — a hold shows "保有継続 · stop x",
// a name with no computed plan shows an explicit "未計算" state. One vocabulary
// (ACTION_META) so every surface — watchlist, buy card, scan tables, chart —
// speaks the same exit language.

// rank drives urgency ordering; rank<=1 == sell now.
export const ACTION_META = {
  stop_hit: { label: 'ストップ割れ・執行を確認', Icon: BlockIcon, color: C.red, rank: 0 },
  exit: { label: '売り — 50日線割れ', Icon: TrendingDownIcon, color: C.red, rank: 1 },
  sell_into_strength: { label: '強さへ利確 (climax)', Icon: BoltIcon, color: C.amber, rank: 2 },
  tighten_stop: { label: 'ストップ引き上げ', Icon: KeyboardDoubleArrowUpIcon, color: C.amber, rank: 3 },
  raise_stop: { label: 'ストップ上げ (利益ロック)', Icon: ArrowUpwardIcon, color: C.green, rank: 4 },
  hold: { label: '保有継続', Icon: RemoveIcon, color: C.grey, rank: 5 },
  no_data: { label: 'エグジット未計算', Icon: HelpOutlineIcon, color: C.dim, rank: 6 },
};
export const DEFAULT_META = ACTION_META.no_data;

const EXPLANATIONS = {
  stop_hit: '配信モデルでは停止水準を下回っています。最新価格・設定した注文・約定履歴を照合してください。',
  exit: '配信モデルが50日線割れを検出しています。実際の保有期間・最新の終値・売却ルールを確認してください。',
  sell_into_strength: '配信モデルが過熱の候補を検出しています。初期の強さか後期の急騰かを、チャートと保有状況で確認してください。',
  tighten_stop: '配信モデルが停止水準の引き上げを示しています。現在の逆指値と、表示水準の根拠を照合してください。',
  raise_stop: '配信モデルが利益保護を示しています。実際の買値・最高値・現在の逆指値を確認してください。',
  hold: '配信モデルでは売却条件が検出されていません。保有の安全性や値上がりを保証する判定ではありません。',
  no_data: '有効な売却判定がありません。情報不足を保有継続の根拠にせず、チャートと保有情報を確認してください。',
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
      borderRadius: 1, bgcolor: `${meta.color}22`, border: `1px solid ${meta.color}`,
    }}>
      <Icon sx={{ fontSize: compact ? 12 : 13, color: meta.color }} />
      <Typography sx={{ fontWeight: 800, fontSize: compact ? 10 : 11, color: meta.color, lineHeight: 1.2 }}>
        {meta.label}
      </Typography>
    </Box>
  );
}

// `sell` may be the index block, the sell_plan block, or null/undefined; in every
// case this renders something. `stale` marks a last-known (offline) reading.
export default function SellTiming({ sell, compact = false, stale = false, currency = '' }) {
  const n = normalizeSell(sell) || { action: 'no_data', stop: null, rMultiple: null, target2r: null, target3r: null };
  const meta = ACTION_META[n.action] || DEFAULT_META;
  const money = (v) => (v == null ? null : `${currency}${fmt(v)}`);

  return (
    <Box data-testid="sell-timing" data-action={n.action}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', rowGap: 0.25 }}>
      {stale && (
        <Typography sx={{ fontSize: 11, color: C.dim, fontWeight: 700 }}>前回</Typography>
      )}
      <Pill meta={meta} compact={compact} />
      {n.stop != null ? (
        <Typography sx={{ fontSize: compact ? 10.5 : 11.5, color: C.ink, fontFamily: 'monospace' }}>
          損切り {money(n.stop)}{n.stopBasis && !compact ? ` · ${n.stopBasis}` : ''}
        </Typography>
      ) : (
        <Typography sx={{ fontSize: compact ? 10.5 : 11.5, color: C.grey }}>
          {n.action === 'no_data' ? 'チャートで確認' : '損切り —'}
        </Typography>
      )}
      {!compact && (n.target2r != null || n.target3r != null) && (
        <Typography sx={{ fontSize: 11, color: C.grey, fontFamily: 'monospace' }}>
          利確 {n.target2r != null ? money(n.target2r) : '-'} / {n.target3r != null ? money(n.target3r) : '-'}
        </Typography>
      )}
      {!compact && <Box component="details" sx={{ flexBasis: '100%', fontSize: 12, color: C.grey }}>
        <summary style={{ cursor: 'pointer', minHeight: 44, display: 'flex', alignItems: 'center' }}>売却判断の根拠と次の確認</summary>
        <p>{stale ? '前回のデータによる判定です。最新データの取得が先です。' : ''}{EXPLANATIONS[n.action]}</p>
        <p>表示水準は配信モデルの計算値です。あなたの保有・注文・約定を確認したものではありません。ギャップや滑りにより、停止水準での約定や損失額は保証されません。</p>
      </Box>}
    </Box>
  );
}
