import { Box, Typography } from '@mui/material';
import { formatLargeNumber } from '../../../utils/formatUtils';

// Bottom quarterly EPS / Sales growth strip. Each column is a fiscal quarter
// showing actual vs year-ago + YoY %; the right-most column is the upcoming
// report's estimate with a next-earnings date badge.
const growthColor = (v) => (v == null ? '#787b86' : v >= 0 ? '#22ab94' : '#f23645');
const fmtPct = (v) => (v == null ? '–' : `${v >= 0 ? '+' : ''}${Number(v).toFixed(0)}%`);
const fmtEps = (v) => (v == null ? '–' : Number(v).toFixed(2));
const fmtSales = (v) => (v == null ? '–' : formatLargeNumber(v));

function Row({ a, prior, growth, fmt }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, whiteSpace: 'nowrap' }}>
      <Typography sx={{ fontSize: 12, color: '#d1d4dc', fontWeight: 600 }}>{fmt(a)}</Typography>
      {prior != null && <Typography sx={{ fontSize: 11, color: '#787b86' }}>vs {fmt(prior)}</Typography>}
      <Typography sx={{ fontSize: 12, color: growthColor(growth), fontWeight: 700 }}>{fmtPct(growth)}</Typography>
    </Box>
  );
}

function Column({ col }) {
  if (col.estimate) {
    return (
      <Box sx={{ px: 1.25, py: 0.5, borderLeft: '1px solid #1c1f27', minWidth: 150 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
          <Typography sx={{ fontSize: 11.5, color: '#d1d4dc', fontWeight: 700 }}>{col.label}</Typography>
          {col.earnings_date && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, border: '1px solid #e0a52e', borderRadius: 0.75, px: 0.5 }}>
              {col.earnings_timing && <Typography sx={{ fontSize: 10, color: '#e0a52e', fontWeight: 800 }}>{col.earnings_timing}</Typography>}
              <Typography sx={{ fontSize: 11, color: '#e0a52e', fontWeight: 700 }}>{col.earnings_date}</Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: '#787b86' }}>Earnings</Typography>
          <Typography sx={{ fontSize: 12, color: '#787b86' }}>Est.</Typography>
          <Typography sx={{ fontSize: 12, color: growthColor(col.eps_est_growth), fontWeight: 700 }}>{fmtPct(col.eps_est_growth)}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 0.75 }}>
          <Typography sx={{ fontSize: 11, color: '#787b86' }}>Sales</Typography>
          <Typography sx={{ fontSize: 12, color: '#787b86' }}>Est.</Typography>
          <Typography sx={{ fontSize: 12, color: growthColor(col.sales_est_growth), fontWeight: 700 }}>{fmtPct(col.sales_est_growth)}</Typography>
        </Box>
      </Box>
    );
  }
  return (
    <Box sx={{ px: 1.25, py: 0.5, borderLeft: '1px solid #1c1f27', minWidth: 150 }}>
      <Typography sx={{ fontSize: 11.5, color: '#d1d4dc', fontWeight: 700, mb: 0.25 }}>{col.label}</Typography>
      <Row a={col.eps_actual} prior={col.eps_prior} growth={col.eps_growth} fmt={fmtEps} />
      <Row a={col.sales_actual} prior={col.sales_prior} growth={col.sales_growth} fmt={fmtSales} />
    </Box>
  );
}

export default function QuarterlyStrip({ quarters }) {
  if (!quarters || quarters.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', overflowX: 'auto', bgcolor: '#0a0a0f', borderTop: '1px solid #1c1f27' }}>
      {quarters.map((col, i) => <Column key={col.label || i} col={col} />)}
    </Box>
  );
}
