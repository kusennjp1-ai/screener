import { Box, Typography } from '@mui/material';
import { formatLargeNumber } from '../../../utils/formatUtils';
import GlossaryLabel from '../../../components/common/GlossaryLabel';
import { C, T, W, px } from '../../../static/designTokens';

// Color ramps tuned to the Markets 360 chips: 0–99 ratings go red→amber→green,
// signed % chips go green/red by sign, band states map to their strip colors.
// 塗りは測定済みの意味色に統一し、その上の文字は近黒（C.onSolid）にする。
// 以前は暗い緑 #1a7f5a に白文字で 2.78:1（AA 4.5 未達）だった。
// C.onSolid on up = 6.80:1 / on amber = 8.91:1 / on down = 5.01:1。
function ratingColor(v) {
  if (v == null) return C.grey;
  if (v >= 80) return C.up;
  if (v >= 60) return C.up;
  if (v >= 40) return C.amber;
  return C.down;
}
function signColor(v) {
  if (v == null) return C.grey;
  return v >= 0 ? C.up : C.down;
}
const STATE_COLOR = {
  buy: C.up, sell: C.down, neutral: C.grey,
  low: C.up, medium: C.amber, high: C.down,
  strong: C.up, transition: C.amber, weak: C.down,
};
const TPR_LETTER_COLOR = { A: C.up, B: C.up, C: C.amber, D: C.amber, E: C.down };

function Field({ label, value, color = C.ink, strong, term }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, px: 0.75 }}>
      <GlossaryLabel term={term}>
        <Typography component="span" sx={{ fontSize: px(T.micro), color: C.dim, fontWeight: W.semibold }}>{label}</Typography>
      </GlossaryLabel>
      <Typography sx={{ fontSize: px(strong ? T.body : T.micro), color, fontWeight: strong ? W.bold : W.semibold, fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '–'}
      </Typography>
    </Box>
  );
}

function Chip({ label, value, bg, term }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75 }}>
      <GlossaryLabel term={term}>
        <Typography component="span" sx={{ fontSize: px(T.micro), color: C.grey, fontWeight: W.bold }}>{label}</Typography>
      </GlossaryLabel>
      <Box sx={{
        bgcolor: bg, color: C.onSolid, borderRadius: 0.75, px: 0.75, minWidth: 22,
        textAlign: 'center', fontSize: px(T.micro), fontWeight: W.bold, lineHeight: '18px',
      }}>
        {value ?? '–'}
      </Box>
    </Box>
  );
}

const Sep = () => <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: C.track, my: 0.5 }} />;

export default function StatusBar({ data }) {
  const q = data?.quote || {};
  const r = data?.ratings || {};
  const s = data?.states || {};
  const fmt = (v, d = 2) => (v == null ? '–' : Number(v).toFixed(d));
  const pct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(2)}%`);
  const spct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(1)}%`);

  return (
    <Box sx={{ bgcolor: '#0d0e13', borderBottom: '1px solid #1c1f27' }}>
      {/* Row 1: quote + earnings/sales/vcp + trend chips */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', py: 0.5 }}>
        <Field label="L" value={fmt(q.last)} color="#d1d4dc" strong />
        <Field label="B" value={q.bid != null ? fmt(q.bid) : fmt(q.last)} />
        <Field label="A" value={q.ask != null ? fmt(q.ask) : fmt(q.last)} />
        <Field label="$" value={q.change != null ? `${q.change >= 0 ? '+' : ''}${fmt(q.change)}` : '–'} color={signColor(q.change)} />
        <Field label="%" value={pct(q.change_pct)} color={signColor(q.change_pct)} />
        <Sep />
        <Chip label="ER" value={r.er} bg={ratingColor(r.er)} term="er" />
        <Chip label="SR" value={r.sr} bg={ratingColor(r.sr)} term="sr" />
        <Field label="VCP" value={r.vcp_pct != null ? `${Number(r.vcp_pct).toFixed(1)}%` : '–'} color={C.amber} term="vcp" />
        <Sep />
        <Chip label="Trend" value={s.trend_stage?.stage != null ? `S${s.trend_stage.stage}` : '–'}
              bg={s.trend_stage?.stage === 2 ? C.up : s.trend_stage?.stage === 4 ? C.down : C.grey} term="stage" />
        <Chip label="Pressure" value={(s.pressure?.state || '–').slice(0, 3).toUpperCase()} bg={STATE_COLOR[s.pressure?.state] || C.grey} term="pressure" />
        <Chip label="Buy Risk" value={(s.buy_risk?.state || '–').toUpperCase()} bg={STATE_COLOR[s.buy_risk?.state] || C.grey} term="buy_risk" />
        <Chip label="RPR" value={r.rpr} bg={ratingColor(r.rpr)} term="rpr" />
        <Chip label="TPR" value={r.tpr} bg={TPR_LETTER_COLOR[r.tpr] || C.grey} term="tpr" />
      </Box>
      {/* Row 2: volume + rate chips */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', py: 0.5, borderTop: '1px solid #16181f' }}>
        <Field label="V" value={q.volume != null ? formatLargeNumber(q.volume) : '–'} />
        <Field label="VRR" value={spct(r.vrr_pct)} color={signColor(r.vrr_pct)} term="vrr" />
        <Field label="+/–20dma" value={spct(r.dist_20dma_pct)} color={signColor(r.dist_20dma_pct)} term="dist_20dma" />
        <Sep />
        <Chip label="ESR" value={r.esr} bg={ratingColor(r.esr)} term="esr" />
        <Chip label="MonAlert" value={s.monalert_net} bg={s.monalert_net >= 5 ? C.up : s.monalert_net <= 0 ? C.down : C.grey} term="monalert" />
      </Box>
    </Box>
  );
}
