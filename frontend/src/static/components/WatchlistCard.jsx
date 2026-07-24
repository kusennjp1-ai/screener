import { useEffect, useMemo } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import BlockIcon from '@mui/icons-material/Block';
import StarIcon from '@mui/icons-material/Star';
import { useWatchlist } from '../hooks/useWatchlist';
import { C } from '../designTokens';
import { ACTION_META, DEFAULT_META } from './SellTiming';

// 保有・監視リスト — same-day exit surfacing for names the user holds (C86,
// graphical rebuild C87).
//
// Reads each watched symbol's exported `sell` block (static charts index) and
// shows the current exit action as a colored pill + an R-multiple bar (where the
// open trade sits from −1R to +3R) + the protective stop, most-urgent first.
// This is the discipline half of SEPA: the screener finds buys well; the gap was
// that a held name breaking its 50-DMA was invisible unless you opened its chart.
// Names not in today's export show a "no data" line rather than vanish.

// Exit vocabulary (icons/colors/labels/ranks) is shared with SellTiming so the
// watchlist and every other surface speak the same language. rank<=1 == sell now.
const fmt = (v, d = 2) => (v == null ? '-' : Number(v).toFixed(d));

const LAST_SELL_KEY = 'wlLastSell';
const readLastSell = () => {
  try { return JSON.parse(localStorage.getItem(LAST_SELL_KEY) || '{}') || {}; } catch { return {}; }
};
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
  const Icon = meta.Icon;
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px',
      borderRadius: 1, bgcolor: `${meta.color}22`, border: `1px solid ${meta.color}`,
    }}>
      <Icon sx={{ fontSize: 13, color: meta.color }} />
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
  const { symbol, sell, present, lastKnown } = row;
  const meta = ACTION_META[sell?.action] || DEFAULT_META;
  // A watched name absent from today's export still shows its LAST-KNOWN exit
  // (offline/stale) rather than vanishing — the discipline must survive a
  // missed refresh. Only falls to "no data" when nothing was ever recorded.
  const staleMeta = lastKnown ? (ACTION_META[lastKnown.sell?.action] || DEFAULT_META) : null;
  return (
    <Box
      data-testid={`watchlist-row-${symbol}`}
      onClick={() => onOpenChart?.(symbol)}
      sx={{
        // Hairline all around (no side-stripe); the accent square carries urgency.
        p: 1.1, mb: 0.75, borderRadius: 1.5, cursor: 'pointer',
        border: `1px solid ${C.track}`, bgcolor: C.panel,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: present ? meta.color : C.dim, flexShrink: 0 }} />
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 14.5 }}>{symbol}</Typography>
        <Box sx={{ flex: 1 }} />
        {present ? (
          <Box data-testid={`watchlist-action-${symbol}`}><ActionPill meta={meta} /></Box>
        ) : staleMeta ? (
          <Box data-testid={`watchlist-action-${symbol}`} sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
            <Typography sx={{ fontSize: 9.5, color: C.dim, fontWeight: 700 }}>前回</Typography>
            <ActionPill meta={staleMeta} />
          </Box>
        ) : (
          <Typography sx={{ fontSize: 11.5, color: C.grey }}>本日データ未取得</Typography>
        )}
        <Box
          component="span"
          role="button"
          data-testid={`watchlist-remove-${symbol}`}
          onClick={(e) => { e.stopPropagation(); onRemove?.(symbol); }}
          sx={{ display: 'inline-flex', color: C.amber, cursor: 'pointer', ml: 0.5 }}
          aria-label={`${symbol}を監視リストから外す`}
        >
          <StarIcon sx={{ fontSize: 16 }} />
        </Box>
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
      {!present && lastKnown?.sell?.stop != null && (
        <Typography sx={{ fontSize: 11, color: C.grey, fontFamily: 'monospace', mt: 0.5 }}>
          前回 stop {fmt(lastKnown.sell.stop)}{lastKnown.date ? ` · ${String(lastKnown.date).slice(5, 10)}` : ''}
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

  // Persist each present name's exit so a later offline/stale load can still
  // show its last-known sell timing instead of dropping the held name.
  const asOfDate = indexData?.as_of_date || null;
  useEffect(() => {
    if (!bySymbol.size) return;
    const store = readLastSell();
    let changed = false;
    for (const symbol of symbols) {
      const entry = bySymbol.get(symbol);
      if (entry?.sell) { store[symbol] = { sell: entry.sell, date: asOfDate }; changed = true; }
    }
    if (changed) {
      try { localStorage.setItem(LAST_SELL_KEY, JSON.stringify(store)); } catch { /* quota — ignore */ }
    }
  }, [symbols, bySymbol, asOfDate]);

  const rows = useMemo(() => {
    const store = readLastSell();
    return orderWatchRows(
      symbols.map((symbol) => {
        const entry = bySymbol.get(symbol);
        const present = Boolean(entry);
        return {
          symbol,
          sell: entry?.sell || null,
          present,
          lastKnown: present ? null : (store[symbol] || null),
        };
      }),
    );
  }, [symbols, bySymbol]);

  if (!symbols.length) return null;

  const alertCount = rows.filter((r) => r.present && (ACTION_META[r.sell?.action]?.rank ?? 9) <= 1).length;

  return (
    <Box sx={{ mb: 2 }} data-testid="watchlist-card">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 15 }}>保有・監視リスト</Typography>
        {alertCount > 0 && (
          <Box data-testid="watchlist-alert-count"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px', borderRadius: 1, bgcolor: `${C.red}22`, border: `1px solid ${C.red}` }}>
            <BlockIcon sx={{ fontSize: 12, color: C.red }} />
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
