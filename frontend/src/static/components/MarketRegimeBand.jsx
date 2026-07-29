import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { alpha } from '@mui/material/styles';
import { C, T, W, px } from '../designTokens';

// 地合いバンド — Minervini's rule 1, stated before anything else on the page.
//
// The old home page never said whether the market was buyable; you had to
// scroll past every candidate to find two 1-day percentages. This band is the
// FIRST thing under the title: one 3-state verdict plus the inputs that
// produced it.
//
// It performs NO calculation of its own. The regime is computed once per scan
// and rides on every scan row (identical across rows) — the same fields the PC
// scan page's MarketRegimeBanner reads: market_regime, market_health,
// market_exposure_pct, market_distribution_days, market_ftd_date,
// market_ftd_days_since. This band only maps that regime string to a verdict.
// When no row carries a regime, it says 判定不能 rather than inventing one.

const VERDICT = {
  confirmed_uptrend: { verdict: '買い場', color: C.up, advice: '新規買い可。' },
  uptrend_under_pressure: { verdict: '慎重', color: C.amber, advice: 'ロットを落とす。' },
  correction: { verdict: '待機', color: C.down, advice: '新規買いは見送り。' },
  downtrend: { verdict: '待機', color: C.down, advice: '監視のみ。' },
};

const UNKNOWN = {
  verdict: '判定不能',
  color: C.grey,
  advice: '地合いの判定材料がありません。',
};

// The verdict is only as good as its inputs, so show them — the market health
// score, the distribution-day count and the follow-through day, and only the
// ones this snapshot actually carries. (Suggested exposure is an OUTPUT of the
// regime, so it sits on the verdict line with the action, not here.)
function buildRegimeInputs(row) {
  if (!row) return null;
  const parts = [];
  if (row.market_health != null) parts.push(`健全度 ${Math.round(row.market_health)}/100`);
  if (row.market_distribution_days != null) parts.push(`売り抜け ${row.market_distribution_days}日`);
  if (row.market_ftd_date) {
    const age = row.market_ftd_days_since != null ? ` +${row.market_ftd_days_since}d` : '';
    parts.push(`FTD ${row.market_ftd_date}${age}`);
  }
  return parts.length ? parts.join(' · ') : null;
}

export default function MarketRegimeBand({ results }) {
  const row = Array.isArray(results) ? results.find((r) => r?.market_regime) : null;
  const known = row ? VERDICT[row.market_regime] : null;
  const meta = known || UNKNOWN;
  const inputs = buildRegimeInputs(row);
  // No regime at all, an unrecognised regime string, and a recognised regime
  // with no numbers behind it are three different failures — name each one.
  let inputsLine;
  if (!row) {
    inputsLine = 'スキャン出力に地合いデータが含まれていません';
  } else if (!known) {
    inputsLine = `未知の地合い区分「${row.market_regime}」${inputs ? ` · ${inputs}` : ''}`;
  } else {
    inputsLine = inputs || '判定の内訳が出力されていません';
  }

  return (
    <Box
      data-testid="market-regime-band"
      role="status"
      sx={{
        minHeight: 64,
        mb: 1,
        px: 1.25,
        py: 0.75,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        gap: 0.25,
        borderRadius: 1.5,
        border: '1px solid',
        borderColor: alpha(meta.color, 0.45),
        borderLeft: `4px solid ${meta.color}`,
        bgcolor: alpha(meta.color, 0.1),
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography
          data-testid="market-regime-verdict"
          sx={{
            fontSize: px(T.hero), fontWeight: W.bold, lineHeight: 1.15,
            color: meta.color, whiteSpace: 'nowrap',
          }}
        >
          {meta.verdict}
        </Typography>
        <Typography sx={{ fontSize: px(T.body), color: C.ink, lineHeight: 1.3, minWidth: 0 }}>
          {meta.advice}
        </Typography>
        {known && row.market_exposure_pct != null && (
          <Typography
            data-testid="market-regime-exposure"
            sx={{
              fontSize: px(T.body), fontWeight: W.bold, color: meta.color, whiteSpace: 'nowrap',
            }}
          >
            {`推奨 ${Math.round(row.market_exposure_pct)}%`}
          </Typography>
        )}
      </Box>
      <Typography
        data-testid="market-regime-inputs"
        sx={{ fontSize: px(T.micro), fontFamily: 'monospace', color: C.grey, lineHeight: 1.35 }}
      >
        {inputsLine}
      </Typography>
    </Box>
  );
}
