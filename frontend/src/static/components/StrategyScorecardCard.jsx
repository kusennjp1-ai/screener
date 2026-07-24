import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Tooltip from '@mui/material/Tooltip';
import { C } from '../designTokens';

// Strategy scorecard (C95) — the "約束" made visible on the phone.
//
// Shows how the whole strategy scores over the long backtest, in the AGREED
// priority order (docs/OBJECTIVE.md): CAGR > max drawdown > risk-adjusted
// (Sortino primary) > per-trade expectancy > win rate. Plus the right-tail
// concentration bar, because the edge depends on NOT capping the big winners.
//
// Reads a static JSON transcribed from backtest_minervini_tactics.py; renders
// nothing when that file is absent (so a market with no backtest shows no card).

const fmtPct = (v, digits = 1) =>
  v == null || Number.isNaN(Number(v)) ? '—' : `${Number(v) > 0 ? '+' : ''}${Number(v).toFixed(digits)}%`;
const fmtNum = (v, digits = 2) =>
  v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(digits);

// One priority row: rank chip · big value · label + plain-language meaning.
function Row({ rank, value, valueColor, label, meaning }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 0.6 }}>
      <Box sx={{
        flexShrink: 0, width: 20, height: 20, borderRadius: '50%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        bgcolor: C.track, color: C.grey, fontSize: 11, fontWeight: 800, fontFamily: 'monospace',
      }}>{rank}</Box>
      <Box sx={{ minWidth: 92, textAlign: 'right' }}>
        <Typography sx={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: valueColor, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: C.inkStrong, lineHeight: 1.2 }}>{label}</Typography>
        <Typography sx={{ fontSize: 10.5, color: C.grey, lineHeight: 1.2 }}>{meaning}</Typography>
      </Box>
    </Box>
  );
}

export default function StrategyScorecardCard({ data }) {
  const m = data?.metrics;
  if (!m) return null;
  const pd = m.payoff_distribution || {};
  const bench = data?.benchmark || null;
  const years = data?.window?.years;
  const windowLabel = data?.window?.start && data?.window?.end
    ? `${data.window.start} 〜 ${data.window.end}${years ? `（約${years}年）` : ''}`
    : null;

  // risk-adjusted: Sortino is primary (doesn't punish big winners); show Sharpe beside it.
  const riskAdj = m.sortino != null
    ? `${fmtNum(m.sortino)}`
    : (m.sharpe != null ? `${fmtNum(m.sharpe)}` : '—');
  const riskAdjMeaning = m.sortino != null
    ? `Sortino（下落だけで採点）／Sharpe ${fmtNum(m.sharpe)}`
    : 'Sharpe（リスク1あたりのリターン）';

  const expectancy = pd.expectancy_r != null ? `${fmtNum(pd.expectancy_r)}R` : '—';
  const payoffRatio = pd.payoff_ratio != null ? `勝ち÷負け ${fmtNum(pd.payoff_ratio)}倍` : '1トレードあたりの平均';

  // right-tail concentration: how much of gross gains the top trades carry.
  const top10 = pd.top10pct_gain_share != null ? Math.round(pd.top10pct_gain_share * 100) : null;
  const best = pd.best_trade_gain_share != null ? Math.round(pd.best_trade_gain_share * 100) : null;

  return (
    <Box data-testid="strategy-scorecard"
      sx={{
        mb: 2, borderRadius: 2, border: '1px solid', borderColor: 'divider',
        bgcolor: C.panel, overflow: 'hidden',
      }}>
      {/* header */}
      <Box sx={{ px: 1.5, pt: 1.25, pb: 0.75, borderBottom: '1px solid', borderColor: 'divider' }}>
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: 13.5, fontWeight: 800, color: C.inkStrong, letterSpacing: 0.2 }}>
            戦略スコアカード
          </Typography>
          <Typography sx={{ fontSize: 10.5, color: C.grey }}>
            過去データ検証・この優先順位で磨きます
          </Typography>
        </Box>
        {windowLabel && (
          <Typography sx={{ fontSize: 10, color: C.dim, fontFamily: 'monospace', mt: 0.25 }}>
            {windowLabel}{data?.universe_size ? ` · 米国${data.universe_size}銘柄` : ''}
          </Typography>
        )}
      </Box>

      {/* priority rows 1..5 */}
      <Box sx={{ px: 1.5, py: 0.75 }}>
        <Row rank={1}
          value={fmtPct(m.cagr_pct)}
          valueColor={Number(m.cagr_pct) >= 0 ? C.green : C.red}
          label="年率リターン (CAGR)"
          meaning={bench?.cagr_pct != null ? `S&P500は ${fmtPct(bench.cagr_pct)}／年` : '複利で資産が増える速さ'} />
        <Row rank={2}
          value={fmtPct(m.max_drawdown_pct)}
          valueColor={C.amber}
          label="最大の落ち込み (最大DD)"
          meaning={bench?.max_drawdown_pct != null ? `S&P500は ${fmtPct(bench.max_drawdown_pct)}` : '一番きつい下落の深さ＝生き残り' } />
        <Row rank={3}
          value={riskAdj}
          valueColor={C.blue}
          label="リスク調整後リターン"
          meaning={riskAdjMeaning} />
        <Row rank={4}
          value={expectancy}
          valueColor={Number(pd.expectancy_r) >= 0 ? C.green : C.red}
          label="期待値 (1トレード)"
          meaning={payoffRatio} />
        <Row rank={5}
          value={m.win_rate_pct != null ? `${fmtNum(m.win_rate_pct, 0)}%` : '—'}
          valueColor={C.grey}
          label="勝率"
          meaning={m.trades != null ? `${m.trades}トレードで検証・勝率は最重視しない` : '勝率は最重視しない'} />
      </Box>

      {/* honest window-dependence caveat + the wider (mostly-bull) window,
          where just holding the index wins. Never hide the less flattering
          number — the priority order judges CAGR first. */}
      {(data.caveat || data.wider_window) && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          {data.caveat && (
            <Typography sx={{ fontSize: 10.5, color: C.grey, lineHeight: 1.5, mb: data.wider_window ? 0.75 : 0 }}>
              {data.caveat}
            </Typography>
          )}
          {data.wider_window && (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
              <Typography sx={{ fontSize: 10.5, fontWeight: 800, color: C.inkStrong }}>
                {data.wider_window.window?.years}年窓
              </Typography>
              <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: C.amber }}>
                CAGR {fmtPct(data.wider_window.cagr_pct)}
              </Typography>
              <Typography sx={{ fontSize: 10.5, color: C.grey }}>
                （S&P500 {fmtPct(data.wider_window.benchmark_cagr_pct)}）· 最大DD {fmtPct(data.wider_window.max_drawdown_pct)}
              </Typography>
            </Box>
          )}
        </Box>
      )}

      {/* right-tail concentration — why we never cap winners */}
      {top10 != null && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.5 }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: C.inkStrong }}>大勝ちの効き（右テール）</Typography>
            <Tooltip title="利益の大半はごく一部の大勝ちが生む。だから途中で利確せず伸ばす（20%固定利確はこの効きを壊す）。">
              <Typography sx={{ fontSize: 10, color: C.grey, cursor: 'help' }}>上位10%の勝ちが利益の {top10}%</Typography>
            </Tooltip>
          </Box>
          <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: C.track, overflow: 'hidden' }}>
            <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, top10)}%`, bgcolor: C.green, opacity: 0.85 }} />
            {best != null && (
              <Box sx={{ position: 'absolute', top: 0, bottom: 0, width: `${Math.min(100, best)}%`, bgcolor: C.green }} />
            )}
          </Box>
          <Typography sx={{ fontSize: 10, color: C.grey, mt: 0.5 }}>
            {best != null ? `濃い部分＝最大の勝ち1件で利益の ${best}%。` : ''}少数の大勝ちを切らないのが要。
          </Typography>
        </Box>
      )}
    </Box>
  );
}
