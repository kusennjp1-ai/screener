import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useWatchlist } from '../hooks/useWatchlist';

// 保有・監視リスト — same-day exit surfacing for names the user holds (C86).
//
// Reads each watched symbol's exported `sell` block (static charts index) and
// shows the current exit action + protective stop, most-urgent first. This is
// the discipline half of SEPA: the screener already finds buys well; the gap
// was that a held name breaking its 50-DMA was invisible unless you opened its
// chart. Names not in today's export show a "no data" line rather than vanish.
//
// No performance claims, no fabricated action — a symbol with sell=null (engine
// produced nothing) reads "ホールド".

// Display precedence: the most urgent exit action sorts to the top.
const ACTION_META = {
  stop_hit: { label: '⛔ ストップ割れ — 即売却', color: '#f23645', rank: 0 },
  exit: { label: '✗ 売り — 50日線割れ', color: '#f23645', rank: 1 },
  sell_into_strength: { label: '△ 強さへ利確(climax)', color: '#e0a52e', rank: 2 },
  tighten_stop: { label: 'ストップ引き上げ', color: '#e0a52e', rank: 3 },
  raise_stop: { label: 'ストップ上げ(利益ロック)', color: '#22ab94', rank: 4 },
  hold: { label: 'ホールド', color: '#787b86', rank: 5 },
};
const DEFAULT_META = ACTION_META.hold;

const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));

export function orderWatchRows(rows) {
  // exit-urgency first, then symbol for stable ties
  return [...rows].sort((a, b) => {
    const ra = (ACTION_META[a.sell?.action] || DEFAULT_META).rank;
    const rb = (ACTION_META[b.sell?.action] || DEFAULT_META).rank;
    if (ra !== rb) return ra - rb;
    return a.symbol.localeCompare(b.symbol);
  });
}

function WatchRow({ row, onOpenChart, onRemove }) {
  const { symbol, sell, present } = row;
  const meta = ACTION_META[sell?.action] || DEFAULT_META;
  const rMultiple = sell?.r_multiple;
  return (
    <Box
      data-testid={`watchlist-row-${symbol}`}
      onClick={() => onOpenChart?.(symbol)}
      sx={{
        p: 1.1, mb: 0.75, borderRadius: 1.5, cursor: 'pointer',
        border: `1px solid ${meta.rank <= 1 ? meta.color : '#23262f'}`,
        bgcolor: 'rgba(13,16,22,0.9)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 14.5 }}>{symbol}</Typography>
        <Box sx={{ flex: 1 }} />
        {present ? (
          <Typography data-testid={`watchlist-action-${symbol}`}
            sx={{ fontWeight: 800, fontSize: 12, color: meta.color }}>
            {meta.label}
          </Typography>
        ) : (
          <Typography sx={{ fontSize: 11.5, color: '#787b86' }}>本日データ未取得</Typography>
        )}
        <Typography
          data-testid={`watchlist-remove-${symbol}`}
          onClick={(e) => { e.stopPropagation(); onRemove?.(symbol); }}
          sx={{ fontSize: 15, color: '#787b86', cursor: 'pointer', ml: 0.5, lineHeight: 1 }}
          aria-label={`${symbol}を監視リストから外す`}
        >
          ★
        </Typography>
      </Box>
      {present && sell && (sell.stop != null || rMultiple != null) && (
        <Typography sx={{ fontSize: 11.5, color: '#d1d4dc', fontFamily: 'monospace', mt: 0.25 }}>
          {sell.stop != null ? `stop ${fmt(sell.stop)}${sell.stop_basis ? ` · ${sell.stop_basis}` : ''}` : ''}
          {sell.stop != null && rMultiple != null ? ' · ' : ''}
          {rMultiple != null ? `${rMultiple >= 0 ? '+' : ''}${fmt(rMultiple, 1)}R` : ''}
        </Typography>
      )}
    </Box>
  );
}

export default function WatchlistCard({ indexData, onOpenChart }) {
  const { symbols, toggle } = useWatchlist();

  const bySymbol = useMemo(() => {
    const map = new Map();
    for (const e of indexData?.symbols || []) {
      if (e?.symbol) map.set(e.symbol, e);
    }
    return map;
  }, [indexData]);

  const rows = useMemo(
    () => orderWatchRows(
      symbols.map((symbol) => {
        const entry = bySymbol.get(symbol);
        return { symbol, sell: entry?.sell || null, present: Boolean(entry) };
      }),
    ),
    [symbols, bySymbol],
  );

  if (!symbols.length) return null;

  const alertCount = rows.filter((r) => r.present && (ACTION_META[r.sell?.action]?.rank ?? 9) <= 1).length;

  return (
    <Box sx={{ mb: 2 }} data-testid="watchlist-card">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>保有・監視リスト</Typography>
        {alertCount > 0 && (
          <Typography data-testid="watchlist-alert-count"
            sx={{ fontSize: 11.5, color: '#f23645', fontWeight: 700 }}>
            要売却 {alertCount}件
          </Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: '#787b86', fontFamily: 'monospace' }}>
          {rows.length}銘柄
        </Typography>
      </Box>
      {rows.map((row) => (
        <WatchRow key={row.symbol} row={row} onOpenChart={onOpenChart} onRemove={toggle} />
      ))}
    </Box>
  );
}
