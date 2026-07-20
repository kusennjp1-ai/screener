import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import { useWatchlist } from '../hooks/useWatchlist';

// 今日の買い候補 — the one-glance decision list (C83).
//
// Answers, per symbol, the only questions that matter at the open:
//   is the MARKET buyable today? (SEPA rule 1 strip, collapses the list when red)
//   WHAT price is the buy? (trigger .. trigger*1.05 chase cap = the valid zone)
//   WHERE is the stop / how big? (risk_plan numbers — the -8%-capped stop and
//   the size that makes a stop-out cost exactly the account risk; NEVER mixed
//   with signal.stop)
//
// Verdict precedence (first match wins): MARKET-RED -> STALE -> EXTENDED
// (past the +5% chase cap) -> BUY NOW (active + in zone) -> NOT TRIGGERED.
// Rows with buy=null degrade to a pivot-only line — the UI never fabricates a
// trigger. No performance claims on the card.
const CHASE_CAP = 1.05; // pivot +5% — Minervini's chase limit (signals.py)

const VERDICT_META = {
  buy_now: { label: '✓ BUY NOW', color: '#22ab94' },
  not_triggered: { label: 'WAIT — 未トリガー', color: '#787b86' },
  extended: { label: '✗ EXTENDED', color: '#e0a52e' },
  stale: { label: 'STALE — データ未更新', color: '#e0a52e' },
  no_signal: { label: 'シグナル未計算', color: '#787b86' },
};

const SOURCE_LABEL = { vcp: 'VCP', ma_tight: 'MA-TIGHT', vol_contract: 'VOL-CTR' };

export function classifyEntry(entry, { marketRed, stale }) {
  const buy = entry?.buy;
  if (!buy || buy.trigger_price == null) return 'no_signal';
  if (stale) return 'stale';
  const zoneHi = buy.trigger_price * CHASE_CAP;
  const px = buy.last_close;
  if (px != null && px > zoneHi) return 'extended';
  if (!marketRed && buy.active && px != null && px >= buy.trigger_price && px <= zoneHi) {
    return 'buy_now';
  }
  return 'not_triggered';
}

const fmt = (v, digits = 2) => (v == null ? '-' : Number(v).toFixed(digits));

function ZoneBar({ buy }) {
  const lo = buy.trigger_price;
  const hi = lo * CHASE_CAP;
  const px = buy.last_close;
  const within = px != null && px >= lo && px <= hi;
  const posPct = px == null ? null : Math.max(0, Math.min(100, ((px - lo) / (hi - lo)) * 100));
  const delta = px != null && lo > 0 ? ((px / lo - 1) * 100).toFixed(1) : null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Typography sx={{ fontSize: 12.5, color: '#d1d4dc', fontFamily: 'monospace' }}>
        BUY ZONE <b>{fmt(lo)}</b> – <b>{fmt(hi)}</b>
        <Box component="span" sx={{ color: '#787b86', ml: 0.5 }}>max +5%</Box>
      </Typography>
      <Box sx={{ position: 'relative', height: 6, mt: 0.5, borderRadius: 3, bgcolor: '#23262f' }}>
        <Box sx={{ position: 'absolute', inset: 0, borderRadius: 3, bgcolor: within ? 'rgba(34,171,148,0.35)' : 'rgba(120,123,134,0.25)' }} />
        {posPct != null && (
          <Box sx={{ position: 'absolute', top: -2, left: `${posPct}%`, width: 3, height: 10, borderRadius: 1, bgcolor: within ? '#22ab94' : '#e0a52e' }} />
        )}
      </Box>
      {px != null && (
        <Typography sx={{ fontSize: 11.5, color: within ? '#22ab94' : '#e0a52e', fontFamily: 'monospace' }}>
          now {fmt(px)} {within ? `— in zone (+${delta}%)` : `(${delta}%)`}
        </Typography>
      )}
    </Box>
  );
}

function BuyRow({ entry, verdict, equity, onOpenChart, watched, onToggleWatch }) {
  const buy = entry.buy;
  const meta = VERDICT_META[verdict];
  const expanded = verdict === 'buy_now';
  const shares = expanded && equity > 0 && buy?.position_size_pct != null && buy?.last_close > 0
    ? Math.floor((equity * buy.position_size_pct / 100) / buy.last_close)
    : null;
  return (
    <Box
      onClick={() => onOpenChart?.(entry.symbol)}
      data-testid={`todays-buys-row-${entry.symbol}`}
      sx={{
        p: 1.25, mb: 1, borderRadius: 1.5, cursor: 'pointer',
        border: `1px solid ${expanded ? meta.color : '#23262f'}`,
        bgcolor: 'rgba(13,16,22,0.9)',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>{entry.symbol}</Typography>
        {buy?.vcp_detected && buy?.vcp_source && (
          <Chip size="small" label={SOURCE_LABEL[buy.vcp_source] || buy.vcp_source}
            sx={{ height: 18, fontSize: 10, color: '#4f8cff', border: '1px solid #4f8cff', bgcolor: 'transparent' }} />
        )}
        {entry.rs_rating != null && (
          <Typography sx={{ fontSize: 11.5, color: '#787b86', fontFamily: 'monospace' }}>RS {Math.round(entry.rs_rating)}</Typography>
        )}
        <Box sx={{ flex: 1 }} />
        <Typography data-testid={`todays-buys-verdict-${entry.symbol}`}
          sx={{ fontWeight: 800, fontSize: 12.5, color: meta.color }}>
          {meta.label}{verdict === 'extended' && buy?.last_close != null && buy?.trigger_price > 0
            ? ` +${((buy.last_close / buy.trigger_price - 1) * 100).toFixed(1)}%` : ''}
        </Typography>
        <Typography
          data-testid={`todays-buys-watch-${entry.symbol}`}
          onClick={(e) => { e.stopPropagation(); onToggleWatch?.(entry.symbol); }}
          sx={{ fontSize: 15, color: watched ? '#e0a52e' : '#4a4e57', cursor: 'pointer', lineHeight: 1 }}
          aria-label={watched ? `${entry.symbol}を監視リストから外す` : `${entry.symbol}を監視リストに追加`}
        >
          ★
        </Typography>
      </Box>

      {verdict === 'no_signal' && (
        <Typography sx={{ fontSize: 11.5, color: '#787b86', mt: 0.5 }}>
          pivot情報なし — チャートで確認
        </Typography>
      )}

      {buy?.trigger_price != null && verdict !== 'no_signal' && <ZoneBar buy={buy} />}

      {expanded && buy && (
        <Box sx={{ mt: 0.75 }}>
          <Typography sx={{ fontSize: 12.5, color: '#f23645', fontFamily: 'monospace' }}>
            stop {fmt(buy.stop_loss)} ({buy.stop_pct != null ? `−${fmt(buy.stop_pct, 1)}%` : '-'}
            {buy.stop_basis ? ` · ${buy.stop_basis}` : ''})
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: '#d1d4dc', fontFamily: 'monospace' }}>
            size {fmt(buy.position_size_pct, 1)}% of capital · risk {fmt(buy.account_risk_pct, 2)}%/trade
            {shares != null ? ` · ${shares}株` : ''}
          </Typography>
          <Typography sx={{ fontSize: 12.5, color: '#22ab94', fontFamily: 'monospace' }}>
            targets 2R {fmt(buy.target_price_2r)} · 3R {fmt(buy.target_price_3r)}
          </Typography>
          <Typography sx={{ fontSize: 11, color: '#787b86', fontFamily: 'monospace', mt: 0.25 }}>
            barrels {buy.barrels_passed != null ? `${buy.barrels_passed}/3` : '-'}
            {buy.signal_as_of ? ` · signal ${String(buy.signal_as_of).slice(0, 10)}` : ''}
          </Typography>
        </Box>
      )}
    </Box>
  );
}

export default function TodaysBuysCard({ indexData, scanRows, onOpenChart }) {
  const [showAll, setShowAll] = useState(false);
  const { has: isWatched, toggle: toggleWatch } = useWatchlist();
  const [equity, setEquity] = useState(() => {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('todaysBuysEquity') : null;
    return raw ? Number(raw) : 0;
  });

  const regimeRow = useMemo(
    () => (Array.isArray(scanRows) ? scanRows.find((r) => r?.market_regime) : null),
    [scanRows],
  );
  const regime = regimeRow?.market_regime;
  const marketRed = regime === 'correction' || regime === 'downtrend';

  const entries = indexData?.symbols || [];
  const asOf = indexData?.as_of_date;
  // STALE: the index must carry the last completed trading day. We compare to
  // the freshest signal date the export itself stamped — if the newest
  // signal_as_of is ahead of as_of_date something is inconsistent; if as_of is
  // more than 4 calendar days old vs today, flag stale (weekend-safe).
  const stale = useMemo(() => {
    if (!asOf) return false;
    return (Date.now() - new Date(`${asOf}T00:00:00Z`).getTime()) > 4 * 86400e3;
  }, [asOf]);

  const classified = useMemo(() => {
    const groups = { buy_now: [], not_triggered: [], extended: [], stale: [], no_signal: [] };
    for (const e of entries) {
      groups[classifyEntry(e, { marketRed, stale })].push(e);
    }
    return groups;
  }, [entries, marketRed, stale]);

  // Pre-v2 indexes carry no buy blocks at all — render nothing rather than a
  // wall of "no signal" rows (graceful schema degradation).
  if (!entries.length || !entries.some((e) => e?.buy)) return null;

  const ordered = [
    ...classified.buy_now.map((e) => [e, stale ? 'stale' : 'buy_now']),
    ...classified.not_triggered.map((e) => [e, stale ? 'stale' : 'not_triggered']),
    ...classified.extended.map((e) => [e, stale ? 'stale' : 'extended']),
    ...classified.stale.map((e) => [e, 'stale']),
    ...classified.no_signal.map((e) => [e, 'no_signal']),
  ];
  const visible = showAll ? ordered : ordered.slice(0, 20);

  return (
    <Box sx={{ mb: 2 }} data-testid="todays-buys-card">
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: '#fff', fontSize: 15 }}>今日の買い候補</Typography>
        <Typography sx={{ fontSize: 11, color: '#787b86', fontFamily: 'monospace' }}>
          data {asOf || '-'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography
          onClick={() => {
            const raw = window.prompt('運用資金（ドル）を入力（株数の目安表示に使用・端末内保存）', equity || '');
            const v = Number(raw);
            if (raw != null && Number.isFinite(v) && v >= 0) {
              setEquity(v);
              localStorage.setItem('todaysBuysEquity', String(v));
            }
          }}
          sx={{ fontSize: 11, color: '#4f8cff', cursor: 'pointer' }}
        >
          {equity > 0 ? `資金 $${equity.toLocaleString()}` : '[資金を設定]'}
        </Typography>
      </Box>

      {marketRed ? (
        <Box sx={{ p: 1.25, borderRadius: 1.5, border: '1px solid #f23645', bgcolor: 'rgba(242,54,69,0.08)' }}
          data-testid="todays-buys-market-red">
          <Typography sx={{ color: '#f23645', fontWeight: 700, fontSize: 13 }}>
            新規買い停止 — 地合い{regime === 'correction' ? '調整入り' : '下降トレンド'}（FTD待ち）
          </Typography>
          <Typography sx={{ color: '#787b86', fontSize: 11.5, mt: 0.25 }}>
            SEPAルール1: 確認済み上昇トレンド以外で新規買いはしない。候補{ordered.length}件は待機。
          </Typography>
        </Box>
      ) : (
        <>
          {visible.map(([e, v]) => (
            <BuyRow key={e.symbol} entry={e} verdict={v} equity={equity} onOpenChart={onOpenChart}
              watched={isWatched(e.symbol)} onToggleWatch={toggleWatch} />
          ))}
          {ordered.length > 20 && !showAll && (
            <Typography onClick={() => setShowAll(true)}
              sx={{ fontSize: 12, color: '#4f8cff', cursor: 'pointer', textAlign: 'center' }}>
              すべて表示（{ordered.length}件）
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
