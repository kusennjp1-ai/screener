import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { C } from '../designTokens';

// Archive only: keep the transcribed metrics and provenance visible without
// treating them as a validated estimate for the current selection method.
// The warning is component-owned so older cached payloads cannot omit it.

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
        <Typography sx={{ fontSize: 20, fontWeight: 800, fontFamily: 'monospace', color: valueColor, lineHeight: 1.1 }}>
          {value}
        </Typography>
      </Box>
      <Box sx={{ minWidth: 0 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.inkStrong, lineHeight: 1.2 }}>{label}</Typography>
        <Typography sx={{ fontSize: 11, color: C.grey, lineHeight: 1.2 }}>{meaning}</Typography>
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
          <Typography sx={{ fontSize: 14, fontWeight: 800, color: C.inkStrong, letterSpacing: 0.2 }}>
            旧バックテスト記録
          </Typography>
          <Typography sx={{ fontSize: 12, fontWeight: 800, color: C.amber }}>
            現行手法は未再検証
          </Typography>
        </Box>
        <Box data-testid="legacy-evaluation-warning" sx={{ mt: 1 }}>
          <Typography sx={{ fontSize: 12, color: C.inkStrong, lineHeight: 1.6 }}>
            旧集計の参考記録です。現在の候補リストや日次の購入条件の成績ではありません。
          </Typography>
          <Typography sx={{ fontSize: 11, color: C.grey, lineHeight: 1.6 }}>
            今回確認した検証コードに、寄付きの判断・数量計算で当日終値を参照する先読みを確認。下記の旧集計への影響は未算定です。
          </Typography>
          <Typography sx={{ fontSize: 11, color: C.grey, lineHeight: 1.6 }}>
            現在取得できる銘柄群に偏りがあり、上場廃止銘柄は復元していません。銘柄の適格判定方法も検証窓で異なります。
          </Typography>
        </Box>
        {windowLabel && (
          <Typography sx={{ fontSize: 11, color: C.dim, fontFamily: 'monospace', mt: 0.25 }}>
            {windowLabel}{data?.universe_size ? ` · 米国${data.universe_size}銘柄` : ''}
          </Typography>
        )}
        {(data.source || data.variant) && (
          <Typography sx={{ fontSize: 11, color: C.dim, mt: 0.5, overflowWrap: 'anywhere' }}>
            出典: {data.source || '未記録'}{data.variant ? ` · variant: ${data.variant}` : ''}
            {data.as_of ? ` · 基準日: ${data.as_of}` : ''}
          </Typography>
        )}
      </Box>

      {/* Archived priority rows 1..5; values are not recalculated here. */}
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

      {/* Preserve the wider-window record and its eligibility correction history. */}
      {(data.caveat || data.wider_window) && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          {data.caveat && (
            <Typography sx={{ fontSize: 11, color: C.grey, lineHeight: 1.5, mb: data.wider_window ? 0.75 : 0 }}>
              {data.caveat}
            </Typography>
          )}
          {data.wider_window && (
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <Typography sx={{ fontSize: 11, fontWeight: 800, color: C.inkStrong }}>
                  約{data.wider_window.window?.years}年窓（旧集計）
                </Typography>
                <Typography sx={{ fontSize: 11, fontFamily: 'monospace', color: C.amber }}>
                  CAGR {fmtPct(data.wider_window.cagr_pct)}
                </Typography>
                <Typography sx={{ fontSize: 11, color: C.grey }}>
                  （S&P500 {fmtPct(data.wider_window.benchmark_cagr_pct)}）· 最大DD {fmtPct(data.wider_window.max_drawdown_pct)}
                </Typography>
              </Box>
              <Typography sx={{ fontSize: 11, color: C.dim, mt: 0.5, overflowWrap: 'anywhere' }}>
                {data.wider_window.window?.start} 〜 {data.wider_window.window?.end}
                {data.wider_window.source ? ` · 出典: ${data.wider_window.source}` : ''}
                {data.wider_window.variant ? ` · variant: ${data.wider_window.variant}` : ''}
              </Typography>
              {data.wider_window.correction && (
                <Typography data-testid="legacy-window-correction" sx={{ fontSize: 11, color: C.grey, lineHeight: 1.6, mt: 0.5 }}>
                  訂正履歴: {data.wider_window.correction}
                </Typography>
              )}
            </Box>
          )}
        </Box>
      )}

      {/* Descriptive concentration of gains in the archived run, not a trading recommendation. */}
      {top10 != null && (
        <Box sx={{ px: 1.5, py: 1, borderTop: '1px solid', borderColor: 'divider' }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, mb: 0.5, flexWrap: 'wrap' }}>
            <Typography sx={{ fontSize: 11, fontWeight: 800, color: C.inkStrong }}>旧集計の利益集中（右テール）</Typography>
            <Typography sx={{ fontSize: 11, color: C.grey }}>上位10%の勝ちが利益の {top10}%</Typography>
          </Box>
          <Box sx={{ position: 'relative', height: 8, borderRadius: 4, bgcolor: C.track, overflow: 'hidden' }}>
            <Box sx={{ position: 'absolute', inset: 0, width: `${Math.min(100, top10)}%`, bgcolor: C.green, opacity: 0.85 }} />
            {best != null && (
              <Box sx={{ position: 'absolute', top: 0, bottom: 0, width: `${Math.min(100, best)}%`, bgcolor: C.green }} />
            )}
          </Box>
          <Typography sx={{ fontSize: 11, color: C.grey, mt: 0.5 }}>
            {best != null ? `濃い部分＝最大の勝ち1件で利益の ${best}%。` : ''}この旧集計内の分布です。
          </Typography>
        </Box>
      )}
    </Box>
  );
}
