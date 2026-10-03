import { useEffect, useMemo } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import StarIcon from '@mui/icons-material/Star';
import { useWatchlist } from '../hooks/useWatchlist';
import { C } from '../designTokens';
import { observationFreshness, useObservationClock } from '../technicalObservation';
import SellTiming, { ACTION_META, DEFAULT_META } from './SellTiming';

// A stored symbol is a watch, not evidence of an actual holding or entry price.
// Keep existing storage and model-priority ordering, without inferring P&L.
const LAST_SELL_KEY = 'wlLastSell';
const readLastSell = () => {
  try { return JSON.parse(localStorage.getItem(LAST_SELL_KEY) || '{}') || {}; } catch { return {}; }
};

export function orderWatchRows(rows) {
  return [...rows].sort((a, b) => {
    const ra = (ACTION_META[a.sell?.action] || DEFAULT_META).rank;
    const rb = (ACTION_META[b.sell?.action] || DEFAULT_META).rank;
    if (ra !== rb) return ra - rb;
    return a.symbol.localeCompare(b.symbol);
  });
}

function WatchRow({ row, asOfDate, now, onOpenChart, onRemove, market }) {
  const { symbol, sell, present, lastKnown } = row;
  const observedSell = present ? sell : lastKnown?.sell;
  // The legacy cache has no market identity. An absent row cannot inherit
  // the selected market's calendar or its Research membership.
  const freshness = observationFreshness(present ? asOfDate : lastKnown?.date, now, present ? market : null);
  return (
    <Box data-testid={`watchlist-row-${symbol}`}
      sx={{ p: 1.1, mb: 0.75, borderRadius: 1.5, border: `1px solid ${C.track}`, bgcolor: C.panel }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 14 }}>{symbol}</Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" data-testid={`watchlist-remove-${symbol}`} onClick={() => onRemove(symbol)}
          sx={{ color: C.amber, '&&': { minWidth: 44, minHeight: 44 } }} aria-label={`${symbol}を監視リストから外す`}>
          <StarIcon sx={{ fontSize: 18 }} />
        </IconButton>
      </Box>
      {!present && <Typography sx={{ fontSize: 12, color: C.grey }}>今回の配信に記録なし{lastKnown ? ' · 前回の保存記録' : ''}</Typography>}
      <Box data-testid={`watchlist-action-${symbol}`}>
        <SellTiming sell={observedSell} freshness={freshness} stale={!present && Boolean(lastKnown)} compact />
      </Box>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
        {market === 'US' && present && <Button component={RouterLink} to={`/?symbol=${encodeURIComponent(symbol)}`} size="small"
          sx={{ '&&': { minHeight: 44 } }} aria-label={`${symbol}の購入条件をResearchで確認`}>購入条件をResearchで確認</Button>}
        {onOpenChart && present && <Button size="small" sx={{ '&&': { minHeight: 44 } }} onClick={() => onOpenChart(symbol)}
          aria-label={`${symbol}の記録チャートを開く`}>記録チャート</Button>}
      </Box>
    </Box>
  );
}

export default function WatchlistCard({ indexData, onOpenChart, market = 'US' }) {
  const { symbols, toggle } = useWatchlist();
  const now = useObservationClock();
  const bySymbol = useMemo(() => {
    const map = new Map();
    for (const entry of indexData?.symbols || []) {
      if (entry?.symbol) map.set(entry.symbol, entry);
    }
    return map;
  }, [indexData]);

  // Preserve last exported model records for watched symbols missing next time.
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
    return orderWatchRows(symbols.map(symbol => {
      const entry = bySymbol.get(symbol);
      const present = Boolean(entry);
      return { symbol, sell: entry?.sell || null, present, lastKnown: present ? null : (store[symbol] || null) };
    }));
  }, [symbols, bySymbol]);

  if (!symbols.length) return null;
  const recordedCount = rows.filter(row => row.present && (ACTION_META[row.sell?.action]?.rank ?? 9) <= 1).length;

  return (
    <Box sx={{ mb: 2 }} data-testid="watchlist-card">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
        <Typography component="h2" sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 16 }}>監視リストのモデル記録</Typography>
        {recordedCount > 0 && <Typography data-testid="watchlist-alert-count" sx={{ fontSize: 11, color: C.grey }}>
          水準割れの記録 {recordedCount}件
        </Typography>}
        <Typography sx={{ fontSize: 11, color: C.grey }}>{rows.length}銘柄</Typography>
      </Box>
      <Typography sx={{ fontSize: 12, color: C.grey, mb: 1 }}>
        保存した銘柄の売却モデル参考値です。実際の保有・買値・注文は未確認のため、損益や売買の指示を示しません。
      </Typography>
      {rows.map(row => <WatchRow key={row.symbol} row={row} asOfDate={asOfDate} now={now}
        onOpenChart={onOpenChart} onRemove={toggle} market={market} />)}
    </Box>
  );
}
