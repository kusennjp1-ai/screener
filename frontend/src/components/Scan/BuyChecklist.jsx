import { Box, Typography } from '@mui/material';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import RemoveCircleOutlineIcon from '@mui/icons-material/RemoveCircleOutline';
import BoltIcon from '@mui/icons-material/Bolt';
import GlossaryLabel from '../common/GlossaryLabel';
import { enterSlideFade } from '../../theme/motion';

// 買い点灯条件チェックリスト — why (and whether) THIS chart is a buy.
//
// Mirrors the engine exactly: the buy signal's three confirmation barrels
// (from /buy-context) plus the fundamental legs from the scan row. Each row
// is a GlossaryLabel — tap any term for the Japanese explanation. The rule
// itself is printed, not implied: 3 barrels lit = Triple Barrel; otherwise a
// staged breakout signal (Alert → Ready → Buy Point) can still fire.
const OK = '#22ab94';
const NG = '#f23645';
const NA = '#787b86';

function Row({ met, term, label, detail, index }) {
  const Icon = met == null ? RemoveCircleOutlineIcon : met ? CheckCircleIcon : CancelIcon;
  const color = met == null ? NA : met ? OK : NG;
  return (
    <Box
      data-testid={`buy-check-${term}`}
      data-met={met == null ? 'unknown' : String(met)}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, py: 0.35, ...enterSlideFade(index) }}
    >
      <Icon sx={{ fontSize: 16, color }} />
      <GlossaryLabel term={term}>
        <Typography component="span" sx={{ fontSize: 12.5, fontWeight: 600, color: 'text.primary' }}>
          {label}
        </Typography>
      </GlossaryLabel>
      <Typography component="span" sx={{ fontSize: 12, color: 'text.secondary', ml: 'auto', textAlign: 'right' }}>
        {detail}
      </Typography>
    </Box>
  );
}

export default function BuyChecklist({ buyContext, stockData }) {
  if (!buyContext?.available) return null;
  const bands = buyContext.bands || {};
  const signal = buyContext.signal || {};
  const barrels = signal.barrels || {};

  const rs = stockData?.rs_rating ?? null;
  const eps = stockData?.eps_rating ?? null;
  const passesTemplate = stockData?.passes_template ?? stockData?.ma_alignment ?? null;
  const code33 = stockData?.code33 ?? null;

  return (
    <Box data-testid="buy-checklist" sx={{ px: 1.5, py: 1, borderBottom: 1, borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
        <BoltIcon sx={{ fontSize: 16, color: signal.active ? '#3aa0ff' : NA }} />
        <GlossaryLabel term="triple_barrel">
          <Typography component="span" sx={{ fontWeight: 800, fontSize: 13 }}>
            Buy Signal（買い点灯条件）
          </Typography>
        </GlossaryLabel>
        {signal.active ? (
          <Typography component="span" sx={{ ml: 'auto', fontSize: 12, fontWeight: 700, color: '#3aa0ff' }}>
            {signal.label || 'Buying Now!'}
            {signal.trigger_price != null ? ` @ ${Number(signal.trigger_price).toFixed(2)}` : ''}
          </Typography>
        ) : (
          <Typography component="span" sx={{ ml: 'auto', fontSize: 12, color: NA }}>
            未点灯（{Object.values(barrels).filter(Boolean).length}/3 バレル）
          </Typography>
        )}
      </Box>

      <Row index={0} met={barrels.trend ?? null} term="tpr" label="Trend — TPRバンドが緑（strong）" detail={bands.tpr_state ?? '—'} />
      <Row index={1} met={barrels.pressure ?? null} term="pressure" label="Pressure — 買い圧力バンドが緑（buy）" detail={bands.pressure_state ?? '—'} />
      <Row index={2} met={barrels.breakout ?? null} term="pivot" label="Breakout — ピボット突破＋Buy Riskが緑/黄" detail={bands.buy_risk_state ?? '—'} />
      <Row index={3} met={passesTemplate} term="trend_template" label="Trend Template — 8条件（必須）" detail={passesTemplate == null ? '—' : passesTemplate ? 'pass' : 'fail'} />
      <Row index={4} met={rs == null ? null : rs >= 70} term="rs_rating" label="RS Rating ≥ 70（必須・90+が理想）" detail={rs == null ? '—' : Number(rs).toFixed(0)} />
      <Row index={5} met={eps == null ? null : eps >= 80} term="eps_rating" label="EPS Rating ≥ 80（推奨）" detail={eps == null ? '—' : Number(eps).toFixed(0)} />
      <Row index={6} met={code33 == null ? null : Boolean(code33)} term="code33" label="Code 33（ボーナス・レア）" detail={code33 == null ? '—' : code33 ? '点灯' : '消灯'} />

      <Typography sx={{ fontSize: 11, color: 'text.secondary', mt: 0.5, lineHeight: 1.5 }}>
        3バレル全点灯＝Triple Barrel買い。チャートのVCP箱・Buy Ptチップ・Buy Trigger線が根拠の位置。各項目タップで日本語解説。
      </Typography>
    </Box>
  );
}
