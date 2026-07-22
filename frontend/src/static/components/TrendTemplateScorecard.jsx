import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import { C } from '../designTokens';

// Minervini 8-point Trend Template scorecard (C91).
//
// Shows WHY a name is (or isn't) a Stage-2 leader — the transparency every
// serious Minervini screener surfaces. Reads the chart payload's `trend_template`
// block, which is computed from the SAME per-bar conditions the TPR band scores
// (backend compute_tpr with_breakdown), so the checklist can never disagree with
// the chart's trend colour. Renders nothing when the block is absent (pre-v3
// export / insufficient history).
export default function TrendTemplateScorecard({ trendTemplate }) {
  const conditions = trendTemplate?.conditions;
  if (!Array.isArray(conditions) || conditions.length === 0) return null;

  const score = trendTemplate.score ?? conditions.filter((c) => c.passed).length;
  const max = trendTemplate.max ?? conditions.length;
  const allPass = score >= max;

  return (
    <Box data-testid="trend-template-scorecard"
      sx={{ p: 1.25, borderTop: '1px solid', borderColor: 'divider' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.75 }}>
        <Typography sx={{ fontSize: 11, color: 'text.disabled', fontWeight: 700, letterSpacing: 0.3 }}>
          トレンドテンプレート
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography data-testid="trend-template-score"
          sx={{ fontSize: 12.5, fontWeight: 800, fontFamily: 'monospace', color: allPass ? C.green : C.amber }}>
          {score}/{max}
        </Typography>
      </Box>
      {conditions.map((c) => (
        <Box key={c.key} sx={{ display: 'flex', alignItems: 'center', gap: 0.6, py: 0.15 }}>
          {c.passed
            ? <CheckCircleIcon sx={{ fontSize: 15, color: C.green, flexShrink: 0 }} />
            : <CancelIcon sx={{ fontSize: 15, color: C.dim, flexShrink: 0 }} />}
          <Typography sx={{ fontSize: 12, color: c.passed ? C.ink : C.grey }}>{c.label}</Typography>
        </Box>
      ))}
    </Box>
  );
}
