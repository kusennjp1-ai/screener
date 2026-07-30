import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import BoltIcon from '@mui/icons-material/Bolt';
import GlossaryLabel from '../common/GlossaryLabel';
import { enterSlideFade } from '../../theme/motion';
import { C, T, W, px } from '../../static/designTokens';

// 買い点灯条件チェックリスト — why (and whether) THIS chart is a buy.
//
// Mirrors the engine exactly: the buy signal's three confirmation barrels
// (from /buy-context) plus the fundamental legs from the scan row. Each row
// is a GlossaryLabel — tap any term for the Japanese explanation. The rule
// itself is printed, not implied: 3 barrels lit = Triple Barrel; otherwise a
// staged breakout signal (Alert → Ready → Buy Point) can still fire.
const NA = C.dim;

// The band states arrive as raw backend enums. Printing them verbatim put
// English words in the value column of a Japanese checklist — and worse, the
// words read as verdicts to anyone who doesn't know the scale: "low" beside a
// FAILED breakout row looks like good news. Each state is spelled out in
// Japanese, on the same scale the row's own icon is already asserting.
export const BAND_STATE_JA = {
  tpr: { strong: '強い', transition: '移行中', weak: '弱い' },
  pressure: { buy: '買い優勢', neutral: '中立', sell: '売り優勢' },
  buy_risk: { low: '低い', medium: '中程度', high: '高い' },
};

export const bandStateLabel = (kind, value) => {
  if (value == null || value === '') return '—';
  return BAND_STATE_JA[kind]?.[String(value).toLowerCase()] || String(value);
};

// The staged buy annotations from markets360/signals.py. These are four
// DIFFERENT states, not one — Alert (approaching), Ready (within 3% below the
// pivot), Point (broke out), SEPA Point (broke out with the full setup). The
// stage is the most decision-relevant word on the panel, so it is translated,
// not dropped and not printed in English.
export const SIGNAL_LABEL_JA = {
  'SEPA Buy Point': 'SEPA買い点',
  'Buy Point': '買い点',
  'Buy Ready': '買い準備',
  'Buy Alert': '買い接近',
  'Buying Now!': '買い点灯',
  Watch: '監視',
};

export const signalLabelJa = (label) => SIGNAL_LABEL_JA[label] || '買い点灯';

function Row({ met, term, label, detail, index }) {
  const Icon = met == null ? RemoveCircleOutlineIcon : met ? CheckCircleIcon : CancelIcon;
  const color = met == null ? NA : met ? C.up : C.down;
  return (
    <Box
      data-testid={`buy-check-${term}`}
      data-met={met == null ? 'unknown' : String(met)}
      sx={{
        display: 'flex', alignItems: 'center', gap: 0.75,
        // 44px so each row is a real tap target — every one of them opens a
        // glossary explanation, which is the whole point of the panel.
        minHeight: 44, py: 0.35, ...enterSlideFade(index),
      }}
    >
      <Icon sx={{ fontSize: px(T.strong), color }} />
      <GlossaryLabel term={term}>
        <Typography component="span" sx={{ fontSize: px(T.micro), fontWeight: W.semibold, color: 'text.primary' }}>
          {label}
        </Typography>
      </GlossaryLabel>
      <Typography component="span" sx={{ fontSize: px(T.micro), color: 'text.secondary', ml: 'auto', textAlign: 'right' }}>
        {detail}
      </Typography>
    </Box>
  );
}

export default function BuyChecklist({ buyContext, stockData, trendTemplate = null }) {
  if (!buyContext?.available) return null;
  const bands = buyContext.bands || {};
  const signal = buyContext.signal || {};
  const barrels = signal.barrels || {};

  const rs = stockData?.rs_rating ?? null;
  const eps = stockData?.eps_rating ?? null;
  // The Trend Template is Minervini's mandatory gate, and it must be read from
  // the SAME payload the 8/8 scorecard renders further down this modal. Reading
  // the scan row here let one screen show "必須: fail" above "8/8" in green — a
  // product contradicting itself on its most important condition. The chart
  // payload wins; the scan row is only a fallback when no breakdown shipped.
  const ttScore = trendTemplate?.score
    ?? (Array.isArray(trendTemplate?.conditions)
      ? trendTemplate.conditions.filter((c) => c.passed).length
      : null);
  const ttMax = trendTemplate?.max
    ?? (Array.isArray(trendTemplate?.conditions) ? trendTemplate.conditions.length : null);
  const passesTemplate = ttScore != null && ttMax != null
    ? ttScore >= ttMax
    : (stockData?.passes_template ?? stockData?.ma_alignment ?? null);
  const templateDetail = ttScore != null && ttMax != null
    ? `${ttScore}/${ttMax}`
    : (passesTemplate == null ? '—' : passesTemplate ? '合格' : '不合格');
  // Prefer buy-context's live code33 (from cached EDGAR flag); fall back to the
  // scan row (static export stamps it there).
  const code33 = buyContext?.code33 ?? stockData?.code33 ?? null;

  return (
    <Box data-testid="buy-checklist" sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <BoltIcon sx={{ fontSize: px(T.strong), color: signal.active ? C.blue : NA }} />
        <GlossaryLabel term="triple_barrel">
          <Typography component="span" sx={{ fontWeight: W.bold, fontSize: px(T.body) }}>
            買い点灯条件
          </Typography>
        </GlossaryLabel>
        {signal.active ? (
          <Typography component="span" sx={{ ml: 'auto', fontSize: px(T.micro), fontWeight: W.bold, color: C.blue }}>
            {/* signal.label is a backend string ("Buy Point"); translate the
                STAGE rather than printing it raw or flattening it away. */}
            {signalLabelJa(signal.label)}
            {signal.trigger_price != null ? ` @ ${Number(signal.trigger_price).toFixed(2)}` : ''}
          </Typography>
        ) : (
          <Typography component="span" sx={{ ml: 'auto', fontSize: px(T.micro), color: NA }}>
            未点灯（{Object.values(barrels).filter(Boolean).length}/3 バレル）
          </Typography>
        )}
      </Box>

      <Row index={0} met={barrels.trend ?? null} term="tpr"
        label="トレンド — TPRバンドが「強い」" detail={bandStateLabel('tpr', bands.tpr_state)} />
      <Row index={1} met={barrels.pressure ?? null} term="pressure"
        label="買い圧力 — 圧力バンドが「買い優勢」" detail={bandStateLabel('pressure', bands.pressure_state)} />
      <Row index={2} met={barrels.breakout ?? null} term="pivot"
        label="ブレイク — ピボット突破＋買いリスクが「低い/中程度」" detail={bandStateLabel('buy_risk', bands.buy_risk_state)} />
      <Row index={3} met={passesTemplate} term="trend_template"
        label="トレンドテンプレート — 8条件（必須）" detail={templateDetail} />
      <Row index={4} met={rs == null ? null : rs >= 70} term="rs_rating"
        label="RSレーティング 70以上（必須・90以上が理想）" detail={rs == null ? '—' : Number(rs).toFixed(0)} />
      <Row index={5} met={eps == null ? null : eps >= 80} term="eps_rating"
        label="EPSレーティング 80以上（推奨）" detail={eps == null ? '—' : Number(eps).toFixed(0)} />
      <Row index={6} met={code33 == null ? null : Boolean(code33)} term="code33"
        label="コード33（ボーナス・まれ）" detail={code33 == null ? '—' : code33 ? '点灯' : '消灯'} />

      <Typography sx={{ fontSize: px(T.micro), color: 'text.secondary', mt: 0.5, lineHeight: 1.5 }}>
        3バレル全点灯＝トリプルバレル買い。チャートのVCP箱・買い点チップ・買いトリガー線が根拠の位置。各項目タップで解説。
      </Typography>
    </Box>
  );
}
