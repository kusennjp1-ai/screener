import { Box, Typography } from '@mui/material';
import { formatLargeNumber } from '../../../utils/formatUtils';

// Color ramps tuned to the Markets 360 chips: 0–99 ratings go red→amber→green,
// signed % chips go green/red by sign, band states map to their strip colors.
function ratingColor(v) {
  if (v == null) return '#3a3f4b';
  if (v >= 80) return '#1a7f5a';
  if (v >= 60) return '#5a7f1a';
  if (v >= 40) return '#9a8520';
  return '#a23b2e';
}
function signColor(v) {
  if (v == null) return '#3a3f4b';
  return v >= 0 ? '#1a7f5a' : '#a23b2e';
}
const STATE_COLOR = {
  buy: '#1a7f5a', sell: '#a23b2e', neutral: '#5c6270',
  low: '#1a7f5a', medium: '#9a8520', high: '#a23b2e',
  strong: '#1a7f5a', transition: '#9a8520', weak: '#a23b2e',
};
const TPR_LETTER_COLOR = { A: '#1a7f5a', B: '#3f7f2a', C: '#9a8520', D: '#a2542e', E: '#a23b2e' };

function Field({ label, value, color = '#d1d4dc', strong }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, px: 0.75 }}>
      <Typography sx={{ fontSize: 11, color: '#787b86', fontWeight: 600 }}>{label}</Typography>
      <Typography sx={{ fontSize: strong ? 13 : 12, color, fontWeight: strong ? 700 : 600, fontVariantNumeric: 'tabular-nums' }}>
        {value ?? '–'}
      </Typography>
    </Box>
  );
}

function Chip({ label, value, bg }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 0.75 }}>
      <Typography sx={{ fontSize: 11, color: '#9aa0aa', fontWeight: 700 }}>{label}</Typography>
      <Box sx={{
        bgcolor: bg, color: '#fff', borderRadius: 0.75, px: 0.75, minWidth: 22,
        textAlign: 'center', fontSize: 11.5, fontWeight: 800, lineHeight: '18px',
      }}>
        {value ?? '–'}
      </Box>
    </Box>
  );
}

const Sep = () => <Box sx={{ width: '1px', alignSelf: 'stretch', bgcolor: '#23262f', my: 0.5 }} />;

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
        <Chip label="ER" value={r.er} bg={ratingColor(r.er)} />
        <Chip label="SR" value={r.sr} bg={ratingColor(r.sr)} />
        <Field label="VCP" value={r.vcp_pct != null ? `${Number(r.vcp_pct).toFixed(1)}%` : '–'} color="#e0a52e" />
        <Sep />
        <Chip label="Trend" value={s.trend_stage?.stage != null ? `S${s.trend_stage.stage}` : '–'}
              bg={s.trend_stage?.stage === 2 ? '#1a7f5a' : s.trend_stage?.stage === 4 ? '#a23b2e' : '#5c6270'} />
        <Chip label="Pressure" value={(s.pressure?.state || '–').slice(0, 3).toUpperCase()} bg={STATE_COLOR[s.pressure?.state] || '#3a3f4b'} />
        <Chip label="Buy Risk" value={(s.buy_risk?.state || '–').toUpperCase()} bg={STATE_COLOR[s.buy_risk?.state] || '#3a3f4b'} />
        <Chip label="RPR" value={r.rpr} bg={ratingColor(r.rpr)} />
        <Chip label="TPR" value={r.tpr} bg={TPR_LETTER_COLOR[r.tpr] || '#3a3f4b'} />
      </Box>
      {/* Row 2: volume + rate chips */}
      <Box sx={{ display: 'flex', alignItems: 'stretch', flexWrap: 'wrap', py: 0.5, borderTop: '1px solid #16181f' }}>
        <Field label="V" value={q.volume != null ? formatLargeNumber(q.volume) : '–'} />
        <Field label="VRR" value={spct(r.vrr_pct)} color={signColor(r.vrr_pct)} />
        <Field label="+/–20dma" value={spct(r.dist_20dma_pct)} color={signColor(r.dist_20dma_pct)} />
        <Sep />
        <Chip label="ESR" value={r.esr} bg={ratingColor(r.esr)} />
        <Chip label="MonAlert" value={s.monalert_net} bg={s.monalert_net >= 5 ? '#1a7f5a' : s.monalert_net <= 0 ? '#a23b2e' : '#5c6270'} />
      </Box>
    </Box>
  );
}
