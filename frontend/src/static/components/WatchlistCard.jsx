import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useWatchlist } from '../hooks/useWatchlist';

// 保有・監視リスト — same-day exit surfacing for names the user holds (C86,
// graphical rebuild C87).
//
// Reads each watched symbol's exported `sell` block (static charts index) and
// shows the current exit action as a colored pill + an R-multiple bar (where the
// open trade sits from −1R to +3R) + the protective stop, most-urgent first.
// This is the discipline half of SEPA: the screener finds buys well; the gap was
// that a held name breaking its 50-DMA was invisible unless you opened its chart.
// Names not in today's export show a "no data" line rather than vanish.

const C = {
  green: '#22ab94', red: '#f23645', amber: '#e0a52e', grey: '#787b86',
  ink: '#d1d4dc', track: '#23262f', panel: 'rgba(13,16,22,0.9)', dim: '#4a4e57',
};

// Display precedence (rank) + the pill's icon/color. rank<=1 == "sell now".
const ACTION_META = {
  stop_hit: { label: 'ストップ割れ — 即売却', icon: '⛔', color: C.red, rank: 0 },
  exit: { label: '売り — 50日線割れ', icon: '✗', color: C.red, rank: 1 },
  sell_into_strength: { label: '強さへ利確 (climax)', icon: '△', color: C.amber, rank: 2 },
  tighten_stop: { label: 'ストップ引き上げ', icon: '▲', color: C.amber, rank: 3 },
  raise_stop: { label: 'ストップ上げ (利益ロック)', icon: '▲', color: C.green, rank: 4 },
  hold: { label: 'ホールド', icon: '•', color: C.grey, rank: 5 },
};
const DEFAULT_META = ACTION_META.hold;

const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export function orderWatchRows(rows) {
  return [...rows].sort((a, b) => {
    const ra = (ACTION_META[a.sell?.action] || DEFAULT_META).rank;
    const rb = (ACTION_META[b.sell?.action] || DEFAULT_META).rank;
    if (ra !== rb) return ra - rb;
    return a.symbol.localeCompare(b.symbol);
  });
}

function ActionPill({ meta }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px',
      borderRadius: 1, bgcolor: `${meta.color}22`, border: `1px solid ${meta.color}`,
    }}>
      <Typography sx={{ fontSize: 11, lineHeight: 1 }}>{meta.icon}</Typography>
      <Typography sx={{ fontWeight: 800, fontSize: 11, color: meta.color, lineHeight: 1.2 }}>{meta.label}</Typography>
    </Box>
  );
}

// −1R ────0────▲──── +3R : where the open trade sits. 0 is entry (breakeven).
function RBar({ r }) {
  if (r == null) return null;
  const LO = -1, HI = 3;
  const pos = clamp(((r - LO) / (HI - LO)) * 100, 0, 100);
  const zero = ((0 - LO) / (HI - LO)) * 100;
  const col = r >= 0 ? C.green : C.red;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5, minWidth: 96 }}>
      <Box sx={{ position: 'relative', flex: 1, height: 6, borderRadius: 3, bgcolor: C.track, minWidth: 56 }}>
        {/* breakeven line */}
        <Box sx={{ position: 'absolute', left: `${zero}%`, top: -1, bottom: -1, width: '1px', bgcolor: C.grey }} />
        {/* fill from breakeven to R */}
        <Box sx={{
          position: 'absolute', top: 0, bottom: 0, borderRadius: 3, bgcolor: `${col}88`,
          left: `${Math.min(zero, pos)}%`, width: `${Math.abs(pos - zero)}%`,
        }} />
        {/* marker */}
        <Box sx={{ position: 'absolute', left: `${pos}%`, top: -2, width: 3, height: 10, borderRadius: 1, bgcolor: col, transform: 'translateX(-50%)' }} />
      </Box>
      <Typography sx={{ fontSize: 11, fontWeight: 700, color: col, fontFamily: 'monospace' }}>
        {r >= 0 ? '+' : ''}{fmt(r, 1)}R
      </Typography>
    </Box>
  );
}

function WatchRow({ row, onOpenChart, onRemove }) {
  const { symbol, sell, present } = row;
  const meta = ACTION_META[sell?.action] || DEFAULT_META;
  return (
    <Box
      data-testid={`watchlist-row-${symbol}`}
      onClick={() => onOpenChart?.(symbol)}
      sx={{
        p: 1.1, mb: 0.75, borderRadius: 1.5, cursor: 'pointer',
        border: `1px solid ${C.track}`, borderLeft: `3px solid ${present ? meta.color : C.dim}`,
        bgcolor: C.panel,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 14.5 }}>{symbol}</Typography>
        <Box sx={{ flex: 1 }} />
        {present ? (
          <Box data-testid={`watchlist-action-${symbol}`}><ActionPill meta={meta} /></Box>
        ) : (
          <Typography sx={{ fontSize: 11.5, color: C.grey }}>本日データ未取得</Typography>
        )}
        <Typography
          data-testid={`watchlist-remove-${symbol}`}
          onClick={(e) => { e.stopPropagation(); onRemove?.(symbol); }}
          sx={{ fontSize: 15, color: C.amber, cursor: 'pointer', ml: 0.5, lineHeight: 1 }}
          aria-label={`${symbol}を監視リストから外す`}
        >
          ★
        </Typography>
      </Box>
      {present && sell && (sell.stop != null || sell.r_multiple != null) && (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5, flexWrap: 'wrap' }}>
          <RBar r={sell.r_multiple} />
          {sell.stop != null && (
            <Typography sx={{ fontSize: 11, color: C.ink, fontFamily: 'monospace' }}>
              stop {fmt(sell.stop)}{sell.stop_basis ? ` · ${sell.stop_basis}` : ''}
            </Typography>
          )}
        </Box>
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
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>保有・監視リスト</Typography>
        {alertCount > 0 && (
          <Box data-testid="watchlist-alert-count"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px', borderRadius: 1, bgcolor: `${C.red}22`, border: `1px solid ${C.red}` }}>
            <Typography sx={{ fontSize: 11, lineHeight: 1 }}>⛔</Typography>
            <Typography sx={{ fontSize: 11, color: C.red, fontWeight: 800 }}>要売却 {alertCount}件</Typography>
          </Box>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 11, color: C.grey, fontFamily: 'monospace' }}>{rows.length}銘柄</Typography>
      </Box>
      {rows.map((row) => (
        <WatchRow key={row.symbol} row={row} onOpenChart={onOpenChart} onRemove={toggle} />
      ))}
    </Box>
  );
}
