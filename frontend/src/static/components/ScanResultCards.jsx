import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import PriceSparkline from '../../components/Scan/PriceSparkline';
import { bandStateLabel } from '../../components/Scan/BuyChecklist';
import { C, T, W, px } from '../designTokens';

// スキャン結果 — スマートフォン用のカード表示。
//
// なぜ表をやめたか: 共有の ResultsTable は 40 列・約 2500px の
// デスクトップ表で、375px の画面には「銘柄」と「RSトレンド」の 2 列しか
// 入らない。判断に必要な数字（RS・スコア・株価・ピボットまでの距離・
// バンドの状態）はすべて画面の外にあり、横スクロールしない限り存在自体が
// 見えない。列を減らすのではなく、1 銘柄 = 1 カードにして、判断に効く順に
// 縦へ積む。
//
// 何を載せるか（ミネルヴィニの判断順）:
//   1. 銘柄 と 現在値・前日比 … 何をいくらで
//   2. トレンドテンプレート と ステージ … 買ってよい状態か（最初の関門）
//   3. RS … 相対的な強さ（70未満は原則対象外）
//   4. ピボットまでの距離 … 今が買い場か、伸びすぎか
//   5. 3つのバンド … 圧力・買いリスク・TPR
// 表示できない値は行ごと出さない（「-」の列を並べない）。

const TAP_MIN = 44;

const fmt = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? null : Number(v).toFixed(d));
const pct = (v, d = 1) => {
  const n = fmt(v, d);
  return n == null ? null : `${Number(v) > 0 ? '+' : ''}${n}%`;
};

// バンドの色。意味は BuyChecklist と同じ辞書から引くので、表記がぶれない。
const BAND_TONE = {
  tpr: { strong: C.up, transition: C.amber, weak: C.down },
  pressure: { buy: C.up, neutral: C.amber, sell: C.down },
  buy_risk: { low: C.up, medium: C.amber, high: C.down },
};
const bandTone = (kind, value) => BAND_TONE[kind]?.[String(value || '').toLowerCase()] || C.grey;

function Band({ kind, label, value }) {
  if (value == null) return null;
  const tone = bandTone(kind, value);
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'baseline', gap: 0.4, minWidth: 0 }}>
      <Typography sx={{ fontSize: px(T.micro), color: C.grey }}>{label}</Typography>
      <Typography sx={{ fontSize: px(T.micro), color: tone, fontWeight: W.semibold }}>
        {bandStateLabel(kind, value)}
      </Typography>
    </Box>
  );
}

// ピボットから離れすぎた値は「まだ有効なベース」ではない。検出されたベースが
// 古いだけで、+217% のような数字を「ピボットからの距離」として出すと、実在
// しない買い場があるかのように読める。この幅を超えたら距離ではなく「ベース
// なし」と言う。25% は、ミネルヴィニの買いゾーン（ピボット〜+5%）と、その
// 後の追撃可能圏を十分に含み、なお「別のベース」と判断できる線。
const PIVOT_STALE_PCT = 25;

// 「あと何%でピボット」か「ピボットからどれだけ伸びたか」。ミネルヴィニの
// 買いゾーンはピボット +5% までなので、そこを超えていれば追いかけない。
function PivotLine({ row }) {
  const d = row.se_distance_to_pivot_pct;
  const pivot = row.se_pivot_price;
  if (d == null) return null;
  if (Math.abs(d) > PIVOT_STALE_PCT) {
    return (
      <Typography sx={{ fontSize: px(T.micro), color: C.grey }}>
        有効なベースなし（直近のピボットから {fmt(Math.abs(d), 0)}% 離れています）
      </Typography>
    );
  }
  const extended = d > 5;
  const below = d < 0;
  const tone = extended ? C.amber : below ? C.grey : C.up;
  const text = below
    ? `ピボットまで ${fmt(Math.abs(d), 1)}%`
    : extended
      ? `ピボットから +${fmt(d, 1)}%（追わない）`
      : `買いゾーン内 +${fmt(d, 1)}%`;
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, minWidth: 0 }}>
      <Typography sx={{ fontSize: px(T.micro), color: tone, fontWeight: W.semibold }}>{text}</Typography>
      {pivot != null && (
        <Typography sx={{ fontSize: px(T.micro), color: C.dim, fontFamily: 'monospace' }}>
          ピボット {fmt(pivot)}
        </Typography>
      )}
    </Box>
  );
}

export function ScanResultCard({ row, onOpenChart, chartEnabled }) {
  const change = row.price_change_1d;
  const changeTone = change == null ? C.grey : change >= 0 ? C.up : C.down;
  const rs = row.rs_rating;
  const template = row.passes_template;
  const subtitle = row.company_name && String(row.company_name).toUpperCase() !== String(row.symbol).toUpperCase()
    ? row.company_name
    : row.ibd_industry_group || null;

  return (
    <Box
      data-testid={`scan-card-${row.symbol}`}
      role={chartEnabled ? 'button' : undefined}
      tabIndex={chartEnabled ? 0 : undefined}
      onClick={chartEnabled ? () => onOpenChart?.(row.symbol) : undefined}
      onKeyDown={chartEnabled ? (e) => { if (e.key === 'Enter') onOpenChart?.(row.symbol); } : undefined}
      sx={{
        minHeight: TAP_MIN,
        p: 1.1, mb: 0.75, borderRadius: 1.5,
        border: `1px solid ${C.track}`, bgcolor: C.panel,
        cursor: chartEnabled ? 'pointer' : 'default',
      }}
    >
      {/* 1行目: 銘柄 / 現在値・前日比 */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
        <Typography sx={{ fontSize: px(T.strong), fontWeight: W.bold, color: C.inkStrong, flexShrink: 0 }}>
          {row.symbol}
        </Typography>
        {subtitle && (
          <Typography noWrap sx={{ fontSize: px(T.micro), color: C.grey, minWidth: 0, flex: 1 }}>
            {subtitle}
          </Typography>
        )}
        <Box sx={{ flex: subtitle ? 0 : 1 }} />
        {row.current_price != null && (
          <Typography sx={{ fontSize: px(T.body), color: C.ink, fontFamily: 'monospace', flexShrink: 0 }}>
            {fmt(row.current_price)}
          </Typography>
        )}
        {change != null && (
          <Typography sx={{ fontSize: px(T.micro), color: changeTone, fontFamily: 'monospace', fontWeight: W.semibold, flexShrink: 0 }}>
            {pct(change)}
          </Typography>
        )}
        {chartEnabled && <ChevronRightIcon sx={{ fontSize: px(T.strong), color: C.dim, flexShrink: 0 }} />}
      </Box>

      {/* 2行目: 最初の関門（テンプレート・ステージ）と RS */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', rowGap: 0.25, mt: 0.4 }}>
        {template != null && (
          // 不合格はほとんどの銘柄の既定の状態。赤は「危険・今すぐ動け」に
          // 取っておき、単なる非該当は灰にする。9件中8件が赤だと、赤が
          // 何も意味しなくなる。
          <Typography sx={{ fontSize: px(T.micro), color: template ? C.up : C.grey, fontWeight: template ? W.semibold : W.regular }}>
            テンプレート{template ? '合格' : '不合格'}
          </Typography>
        )}
        {row.stage != null && (
          <Typography sx={{ fontSize: px(T.micro), color: row.stage === 2 ? C.up : C.grey }}>
            ステージ{row.stage}
          </Typography>
        )}
        {rs != null && (
          <Typography sx={{ fontSize: px(T.micro), color: rs >= 70 ? C.up : C.grey, fontFamily: 'monospace' }}>
            RS {Math.round(rs)}
          </Typography>
        )}
        {row.vcp_detected && (
          <Typography sx={{ fontSize: px(T.micro), color: C.blue, fontWeight: W.semibold }}>VCP</Typography>
        )}
      </Box>

      {/* 3行目: 買い場かどうか */}
      <Box sx={{ mt: 0.35 }}><PivotLine row={row} /></Box>

      {/* 4行目: 3つのバンド */}
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25, flexWrap: 'wrap', rowGap: 0.25, mt: 0.35 }}>
        <Band kind="tpr" label="TPR" value={row.tpr_state} />
        <Band kind="pressure" label="圧力" value={row.pressure_state} />
        <Band kind="buy_risk" label="買いリスク" value={row.buy_risk_state} />
      </Box>

      {Array.isArray(row.price_history) && row.price_history.length > 1 && (
        <Box sx={{ mt: 0.5 }}>
          <PriceSparkline data={row.price_history} height={26} />
        </Box>
      )}
    </Box>
  );
}

export default function ScanResultCards({ rows, onOpenChart, isChartEnabled }) {
  if (!rows?.length) return null;
  return (
    <Box data-testid="scan-result-cards">
      {rows.map((row) => (
        <ScanResultCard
          key={row.symbol}
          row={row}
          onOpenChart={onOpenChart}
          chartEnabled={Boolean(onOpenChart) && (isChartEnabled ? isChartEnabled(row.symbol) : true)}
        />
      ))}
    </Box>
  );
}
