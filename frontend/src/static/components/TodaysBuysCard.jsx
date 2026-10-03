import { useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { useWatchlist } from '../hooks/useWatchlist';
import { C } from '../designTokens';
import { observationFreshness, observedPrice, pricePosition, signalDateLabel, useObservationClock } from '../technicalObservation';
import SellTiming from './SellTiming';

// This index combines different signal and risk models and lacks the evidence
// needed by entryReadiness. Preserve its records as dated observations only.
const fmt = value => observedPrice(value)?.toFixed(2) ?? '未確認';
const MARKET_LABELS = {
  correction: '調整入り', downtrend: '下降トレンド',
  confirmed_uptrend: '確認済み上昇トレンド', uptrend_under_pressure: '上昇トレンド・売り圧力',
};

function ObservationRow({ entry, freshness, onOpenChart, watched, onToggleWatch, market, now }) {
  const buy = entry.buy;
  const position = pricePosition(buy);
  return (
    <Box data-testid={`todays-buys-row-${entry.symbol}`}
      sx={{ p: 1.25, mb: 1, borderRadius: 1.5, border: `1px solid ${C.track}`, bgcolor: C.panel }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap' }}>
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 16 }}>{entry.symbol}</Typography>
        <Typography sx={{ fontSize: 12, color: C.grey }} data-testid={`todays-buys-position-${entry.symbol}`}>
          {position.label}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <IconButton size="small" data-testid={`todays-buys-watch-${entry.symbol}`}
          onClick={() => onToggleWatch(entry.symbol)}
          sx={{ '&&': { minWidth: 44, minHeight: 44 }, color: watched ? C.amber : C.grey }}
          aria-label={watched ? `${entry.symbol}を監視リストから外す` : `${entry.symbol}を監視リストに追加`}>
          {watched ? <StarIcon sx={{ fontSize: 18 }} /> : <StarBorderIcon sx={{ fontSize: 18 }} />}
        </IconButton>
      </Box>
      <Typography sx={{ fontSize: 12, color: C.ink, fontFamily: 'monospace', lineHeight: 1.8 }}>
        記録終値 {fmt(buy?.last_close)} · シグナル基準値 {fmt(buy?.trigger_price)}
        {position.delta != null ? ` · 基準値比 ${position.delta > 0 ? '+' : ''}${position.delta.toFixed(1)}%` : ''}
      </Typography>
      <Typography sx={{ fontSize: 11, color: C.grey, lineHeight: 1.8 }}>
        配信基準日 {freshness.date || '未確認'} · シグナル基準日 {signalDateLabel(buy?.signal_as_of, now, market)}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 0.5 }}>
        {market === 'US' && <Button component={RouterLink} to={`/?symbol=${encodeURIComponent(entry.symbol)}`} size="small"
          sx={{ '&&': { minHeight: 44 } }} aria-label={`${entry.symbol}の購入条件をResearchで確認`}>
          購入条件をResearchで確認
        </Button>}
        {onOpenChart && <Button size="small" sx={{ '&&': { minHeight: 44 } }} onClick={() => onOpenChart(entry.symbol)}
          aria-label={`${entry.symbol}の記録チャートを開く`}>記録チャート</Button>}
      </Box>
      <Box sx={{ mt: 0.5, pt: 0.75, borderTop: `1px solid ${C.track}` }}>
        <SellTiming sell={entry.sell} freshness={freshness} />
      </Box>
    </Box>
  );
}

export default function TodaysBuysCard({ indexData, scanRows, marketAsOf, onOpenChart, market = 'US' }) {
  const [showAll, setShowAll] = useState(false);
  const { has: isWatched, toggle: toggleWatch } = useWatchlist();
  const now = useObservationClock();
  const freshness = observationFreshness(indexData?.as_of_date, now, market);
  const entries = indexData?.symbols || [];
  const regimeRow = Array.isArray(scanRows) ? scanRows.find(row => row?.market_regime) : null;
  const regimeLabel = MARKET_LABELS[regimeRow?.market_regime] || '未確認';

  // Pre-v2 indexes have no observations to present. Preserve exported ordering.
  if (!entries.length || !entries.some(entry => entry?.buy)) return null;
  const visible = showAll ? entries : entries.slice(0, 20);

  return (
    <Box sx={{ mb: 2 }} data-testid="todays-buys-card" data-freshness={freshness.state}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap', mb: 0.75 }}>
        <Typography component="h2" sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 16 }}>テクニカル観測記録</Typography>
        <Typography sx={{ fontSize: 12, color: C.grey }}>{entries.length}銘柄 · 基準日 {freshness.date || '未確認'}</Typography>
      </Box>
      <Typography sx={{ fontSize: 12, color: C.grey, mb: 1 }}>{freshness.label}。記録終値とシグナル基準値の比較です。購入条件はResearchで個別に確認できます。</Typography>
      <Typography sx={{ fontSize: 12, color: C.grey, mb: 1 }} data-testid="todays-buys-market-context">
        配信された市場区分（スキャン基準日 {signalDateLabel(marketAsOf, now, market)}）: {regimeLabel}{Number.isFinite(regimeRow?.market_distribution_days) ? ` · 分配日 ${regimeRow.market_distribution_days}` : ''}。市場区分の記録は購入条件の通過を示しません。
      </Typography>
      {visible.map(entry => <ObservationRow key={entry.symbol} entry={entry} freshness={freshness}
        onOpenChart={onOpenChart} watched={isWatched(entry.symbol)} onToggleWatch={toggleWatch} market={market} now={now} />)}
      {entries.length > 20 && !showAll && <Button onClick={() => setShowAll(true)} sx={{ '&&': { minHeight: 44 } }}>
        すべて表示（{entries.length}件）
      </Button>}
    </Box>
  );
}
