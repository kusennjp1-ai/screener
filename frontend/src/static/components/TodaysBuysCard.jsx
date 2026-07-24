import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import UpdateIcon from '@mui/icons-material/Update';
import RemoveIcon from '@mui/icons-material/Remove';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import { useWatchlist } from '../hooks/useWatchlist';
import { C } from '../designTokens';
import SellTiming from './SellTiming';

// 今日の買い候補 — the one-glance decision list (C83, graphical rebuild C87).
//
// Answers, per symbol, the only questions that matter at the open:
//   is the MARKET buyable today? (collapses the list when red)
//   WHAT price is the buy? (trigger .. trigger*1.05 chase cap = the valid zone)
//   WHERE is the stop / how big / what's the reward? (one risk→reward ladder:
//   stop · pivot · 2R · 3R with the live price marker — the numbers are kept as
//   tick labels, but the SHAPE of the trade is now visual)
//
// Verdict precedence (first match wins): MARKET-RED -> STALE -> EXTENDED
// (past the +5% chase cap) -> BUY NOW (active + in zone) -> NOT TRIGGERED.
// Rows with buy=null degrade to a pivot-only line — the UI never fabricates a
// trigger. No performance claims on the card.
const CHASE_CAP = 1.05; // pivot +5% — Minervini's chase limit (signals.py)
// A bare breakout with none of the three behavioural barrels (trend / buy
// pressure / volume-confirmed breakout) is NOT a "BUY NOW". Minervini buys the
// confirmed setup, not any new high — require at least 2 of 3 barrels.
const MIN_BARRELS_FOR_BUY = 2;

// One MUI icon voice (matches the rest of the app) — never emoji/glyphs.
const VERDICT_META = {
  buy_now: { label: 'BUY NOW', Icon: CheckCircleIcon, color: C.green },
  not_triggered: { label: 'WAIT', Icon: ScheduleIcon, color: C.grey },
  extended: { label: 'EXTENDED', Icon: WarningAmberIcon, color: C.amber },
  stale: { label: 'データ未更新', Icon: UpdateIcon, color: C.amber },
  no_signal: { label: 'シグナル未計算', Icon: RemoveIcon, color: C.grey },
};

const SOURCE_LABEL = { vcp: 'VCP', ma_tight: 'MA-TIGHT', vol_contract: 'VOL-CTR' };

export function classifyEntry(entry, { marketRed, stale }) {
  const buy = entry?.buy;
  if (!buy || buy.trigger_price == null) return 'no_signal';
  if (stale) return 'stale';
  const zoneHi = buy.trigger_price * CHASE_CAP;
  const px = buy.last_close;
  if (px != null && px > zoneHi) return 'extended';
  // Unknown barrel count (older export) keeps the old behaviour; a known count
  // below the threshold downgrades the row from BUY NOW to WAIT.
  const confirmed = buy.barrels_passed == null || buy.barrels_passed >= MIN_BARRELS_FOR_BUY;
  if (!marketRed && buy.active && confirmed && px != null && px >= buy.trigger_price && px <= zoneHi) {
    return 'buy_now';
  }
  return 'not_triggered';
}

const fmt = (v, digits = 2) => (v == null ? '-' : Number(v).toFixed(digits));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A status icon + verdict word — the at-a-glance chip.
function VerdictBadge({ meta, suffix }) {
  const Icon = meta.Icon;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
      <Icon sx={{ fontSize: 15, color: meta.color }} />
      <Typography sx={{ fontWeight: 800, fontSize: 12.5, color: meta.color }}>
        {meta.label}{suffix}
      </Typography>
    </Box>
  );
}

// Compact RS strength pill (0-99) — width encodes strength, number is the truth.
function RsPill({ value }) {
  if (value == null) return null;
  const v = clamp(Math.round(value), 0, 99);
  const col = v >= 90 ? C.green : v >= 80 ? C.blue : C.grey;
  return (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
      <Box sx={{ width: 26, height: 4, borderRadius: 2, bgcolor: C.track, overflow: 'hidden' }}>
        <Box sx={{ width: `${v}%`, height: '100%', bgcolor: col }} />
      </Box>
      <Typography sx={{ fontSize: 10.5, color: col, fontFamily: 'monospace' }}>RS {v}</Typography>
    </Box>
  );
}

// The trade, drawn once: a stop→3R axis with red risk / green reward zones, the
// buy zone highlighted, ticks labeled with the real prices, and a live price
// marker. Replaces three monospace lines with one legible picture.
function RiskRewardLadder({ buy }) {
  const stop = buy.stop_loss;
  const pivot = buy.trigger_price;
  const zoneHi = pivot != null ? pivot * CHASE_CAP : null;
  const t2 = buy.target_price_2r;
  const t3 = buy.target_price_3r;
  const px = buy.last_close;
  // axis spans stop..3R (fall back to zoneHi if targets missing)
  const lo = stop;
  const hi = t3 ?? t2 ?? zoneHi;
  const ok = lo != null && hi != null && hi > lo;
  const pct = (v) => (v == null || !ok ? null : clamp(((v - lo) / (hi - lo)) * 100, 0, 100));
  const pivotPct = pct(pivot);
  const zoneHiPct = pct(zoneHi);
  const pxPct = pct(px);
  const inZone = px != null && pivot != null && zoneHi != null && px >= pivot && px <= zoneHi;
  const delta = px != null && pivot > 0 ? ((px / pivot - 1) * 100).toFixed(1) : null;

  const Tick = ({ p, label, sub, color, align }) => (
    p == null ? null : (
      <Box sx={{
        position: 'absolute', top: 0, left: `${p}%`,
        transform: align === 'end' ? 'translateX(-100%)' : align === 'mid' ? 'translateX(-50%)' : 'none',
        textAlign: align === 'end' ? 'right' : align === 'mid' ? 'center' : 'left', whiteSpace: 'nowrap',
      }}>
        <Typography sx={{ fontSize: 9.5, color: C.grey, lineHeight: 1.1 }}>{label}</Typography>
        <Typography sx={{ fontSize: 11, fontWeight: 700, color, fontFamily: 'monospace', lineHeight: 1.15 }}>{sub}</Typography>
      </Box>
    )
  );

  return (
    <Box sx={{ mt: 0.75 }}>
      {/* the track */}
      <Box sx={{ position: 'relative', height: 12, borderRadius: 1, overflow: 'hidden', bgcolor: C.track }}>
        {/* risk zone (stop..pivot) */}
        {pivotPct != null && (
          <Box sx={{ position: 'absolute', left: 0, width: `${pivotPct}%`, top: 0, bottom: 0, bgcolor: 'rgba(242,54,69,0.28)' }} />
        )}
        {/* reward zone (pivot..3R) */}
        {pivotPct != null && (
          <Box sx={{ position: 'absolute', left: `${pivotPct}%`, right: 0, top: 0, bottom: 0, bgcolor: 'rgba(34,171,148,0.22)' }} />
        )}
        {/* buy zone highlight (pivot..+5%) */}
        {pivotPct != null && zoneHiPct != null && (
          <Box sx={{ position: 'absolute', left: `${pivotPct}%`, width: `${Math.max(2, zoneHiPct - pivotPct)}%`, top: 0, bottom: 0, bgcolor: 'rgba(34,171,148,0.55)', borderLeft: `2px solid ${C.green}` }} />
        )}
        {/* 2R gridline */}
        {pct(t2) != null && (
          <Box sx={{ position: 'absolute', left: `${pct(t2)}%`, top: 0, bottom: 0, width: '1px', bgcolor: 'rgba(34,171,148,0.9)' }} />
        )}
        {/* live price marker */}
        {pxPct != null && (
          <Box sx={{ position: 'absolute', left: `${pxPct}%`, top: -1, bottom: -1, width: 3, borderRadius: 1, bgcolor: inZone ? C.inkStrong : C.amber, transform: 'translateX(-50%)', boxShadow: '0 0 0 1px rgba(0,0,0,0.6)' }} />
        )}
      </Box>
      {/* tick labels */}
      <Box sx={{ position: 'relative', height: 26, mt: 0.25 }}>
        <Tick p={0} label="STOP" sub={fmt(stop)} color={C.red} align="start" />
        <Tick p={pivotPct} label="PIVOT" sub={fmt(pivot)} color={C.inkStrong} align="mid" />
        {pct(t2) != null && <Tick p={pct(t2)} label="2R" sub={fmt(t2)} color={C.green} align="mid" />}
        <Tick p={100} label="3R" sub={fmt(t3 ?? t2)} color={C.green} align="end" />
      </Box>
      {/* live read line */}
      {px != null && (
        <Typography sx={{ fontSize: 11.5, color: inZone ? C.green : C.amber, fontFamily: 'monospace', mt: 0.25 }}>
          ● now {fmt(px)} {inZone ? `— ゾーン内 (+${delta}%)` : `(${delta > 0 ? '+' : ''}${delta}%)`}
          {buy.stop_pct != null && <Box component="span" sx={{ color: C.red, ml: 1 }}>risk −{fmt(buy.stop_pct, 1)}%</Box>}
        </Typography>
      )}
    </Box>
  );
}

// A slim pivot bar for non-BUY-NOW rows: just the zone + where price sits.
function MiniZone({ buy }) {
  const lo = buy.trigger_price;
  const hi = lo * CHASE_CAP;
  const px = buy.last_close;
  const within = px != null && px >= lo && px <= hi;
  const posPct = px == null ? null : clamp(((px - lo) / (hi - lo)) * 100, 0, 100);
  const delta = px != null && lo > 0 ? ((px / lo - 1) * 100).toFixed(1) : null;
  return (
    <Box sx={{ mt: 0.5 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: 11, color: C.grey, fontFamily: 'monospace' }}>
          pivot <b style={{ color: C.ink }}>{fmt(lo)}</b> … +5% {fmt(hi)}
        </Typography>
        {px != null && (
          <Typography sx={{ fontSize: 11, color: within ? C.green : C.amber, fontFamily: 'monospace' }}>
            now {fmt(px)} ({delta > 0 ? '+' : ''}{delta}%)
          </Typography>
        )}
      </Box>
      <Box sx={{ position: 'relative', height: 5, mt: 0.4, borderRadius: 3, bgcolor: C.track }}>
        <Box sx={{ position: 'absolute', inset: 0, borderRadius: 3, bgcolor: within ? 'rgba(34,171,148,0.35)' : 'rgba(120,123,134,0.25)' }} />
        {posPct != null && (
          <Box sx={{ position: 'absolute', top: -2, left: `${posPct}%`, width: 3, height: 9, borderRadius: 1, bgcolor: within ? C.green : C.amber, transform: 'translateX(-50%)' }} />
        )}
      </Box>
    </Box>
  );
}

// Position-size fill + share count, and barrel pips.
function SizeAndBarrels({ buy, shares }) {
  const size = buy.position_size_pct;
  const sizePct = size == null ? null : clamp(size, 0, 100);
  const barrels = buy.barrels_passed;
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.6, flexWrap: 'wrap' }}>
      {sizePct != null && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ width: 40, height: 6, borderRadius: 3, bgcolor: C.track, overflow: 'hidden' }}>
            <Box sx={{ width: `${sizePct}%`, height: '100%', bgcolor: C.blue }} />
          </Box>
          <Typography sx={{ fontSize: 11.5, color: C.ink, fontFamily: 'monospace' }}>
            size {fmt(size, 1)}%{shares != null ? ` · ${shares}株` : ''}
          </Typography>
        </Box>
      )}
      <Typography sx={{ fontSize: 11, color: C.grey, fontFamily: 'monospace' }}>
        risk {fmt(buy.account_risk_pct, 2)}%/回
      </Typography>
      {barrels != null && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, ml: 'auto' }}>
          <Typography sx={{ fontSize: 10.5, color: C.grey }}>barrels</Typography>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%',
              bgcolor: i < barrels ? C.green : 'transparent', border: `1px solid ${i < barrels ? C.green : C.dim}` }} />
          ))}
        </Box>
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
  const suffix = verdict === 'extended' && buy?.last_close != null && buy?.trigger_price > 0
    ? ` +${((buy.last_close / buy.trigger_price - 1) * 100).toFixed(1)}%` : '';
  return (
    <Box
      onClick={() => onOpenChart?.(entry.symbol)}
      data-testid={`todays-buys-row-${entry.symbol}`}
      sx={{
        p: 1.25, mb: 1, borderRadius: 1.5, cursor: 'pointer',
        // Hairline all around (no side-stripe); status reads from the accent
        // square + verdict icon, elevation from a brighter border on BUY NOW.
        border: `1px solid ${expanded ? meta.color : C.track}`,
        bgcolor: C.panel,
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
        <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: meta.color, flexShrink: 0 }} />
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 15 }}>{entry.symbol}</Typography>
        {buy?.vcp_detected && buy?.vcp_source && (
          <Chip size="small" label={SOURCE_LABEL[buy.vcp_source] || buy.vcp_source}
            sx={{ height: 18, fontSize: 10, color: C.blue, border: `1px solid ${C.blue}`, bgcolor: 'transparent' }} />
        )}
        <RsPill value={entry.rs_rating} />
        <Box sx={{ flex: 1 }} />
        <Box data-testid={`todays-buys-verdict-${entry.symbol}`}>
          <VerdictBadge meta={meta} suffix={suffix} />
        </Box>
        <Box
          component="span"
          role="button"
          data-testid={`todays-buys-watch-${entry.symbol}`}
          onClick={(e) => { e.stopPropagation(); onToggleWatch?.(entry.symbol); }}
          sx={{ display: 'inline-flex', cursor: 'pointer', color: watched ? C.amber : C.dim }}
          aria-label={watched ? `${entry.symbol}を監視リストから外す` : `${entry.symbol}を監視リストに追加`}
        >
          {watched ? <StarIcon sx={{ fontSize: 17 }} /> : <StarBorderIcon sx={{ fontSize: 17 }} />}
        </Box>
      </Box>

      {verdict === 'no_signal' && (
        <Typography sx={{ fontSize: 11.5, color: C.grey, mt: 0.5 }}>
          pivot情報なし — チャートで確認
        </Typography>
      )}

      {expanded && buy && (
        <>
          <RiskRewardLadder buy={buy} />
          <SizeAndBarrels buy={buy} shares={shares} />
          <Typography sx={{ fontSize: 10, color: C.grey, fontFamily: 'monospace', mt: 0.4 }}>
            stop {fmt(buy.stop_loss)}{buy.stop_basis ? ` · ${buy.stop_basis}` : ''}
            {buy.signal_as_of ? ` · signal ${String(buy.signal_as_of).slice(0, 10)}` : ''}
          </Typography>
        </>
      )}

      {!expanded && buy?.trigger_price != null && verdict !== 'no_signal' && <MiniZone buy={buy} />}

      {/* C97: the exit is ALWAYS shown, on every verdict — a buy candidate
          firing a sell/climax signal, or an EXTENDED/WAIT name's protective
          stop, must never be invisible. */}
      <Box sx={{ mt: 0.6, pt: 0.6, borderTop: `1px solid ${C.track}` }}>
        <SellTiming sell={entry.sell} />
      </Box>
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
  const underPressure = regime === 'uptrend_under_pressure';
  const distDays = regimeRow?.market_distribution_days;

  const entries = indexData?.symbols || [];
  const asOf = indexData?.as_of_date;
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

  // Pre-v2 indexes carry no buy blocks at all — render nothing.
  if (!entries.length || !entries.some((e) => e?.buy)) return null;

  const ordered = [
    ...classified.buy_now.map((e) => [e, stale ? 'stale' : 'buy_now']),
    ...classified.not_triggered.map((e) => [e, stale ? 'stale' : 'not_triggered']),
    ...classified.extended.map((e) => [e, stale ? 'stale' : 'extended']),
    ...classified.stale.map((e) => [e, 'stale']),
    ...classified.no_signal.map((e) => [e, 'no_signal']),
  ];
  const buyNowCount = stale ? 0 : classified.buy_now.length;
  const visible = showAll ? ordered : ordered.slice(0, 20);

  return (
    <Box sx={{ mb: 2 }} data-testid="todays-buys-card">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0 }}>今日の買い候補</Typography>
        {buyNowCount > 0 && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: C.green }} />
            <Typography sx={{ fontSize: 11.5, color: C.green, fontWeight: 700 }}>買い{buyNowCount}</Typography>
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Typography noWrap sx={{ fontSize: 10.5, color: C.grey, fontFamily: 'monospace', flexShrink: 1, minWidth: 0 }}>{asOf || '-'}</Typography>
        <Typography
          onClick={() => {
            const raw = window.prompt('運用資金（ドル）を入力（株数の目安表示に使用・端末内保存）', equity || '');
            const v = Number(raw);
            if (raw != null && Number.isFinite(v) && v >= 0) {
              setEquity(v);
              localStorage.setItem('todaysBuysEquity', String(v));
            }
          }}
          sx={{ fontSize: 11, color: C.blue, cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {equity > 0 ? `資金 $${equity.toLocaleString()}` : '[資金を設定]'}
        </Typography>
      </Box>

      {marketRed ? (
        <Box sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${C.red}`, bgcolor: 'rgba(242,54,69,0.08)' }}
          data-testid="todays-buys-market-red">
          <Typography sx={{ color: C.red, fontWeight: 700, fontSize: 13 }}>
            新規買い停止 — 地合い{regime === 'correction' ? '調整入り' : '下降トレンド'}（FTD待ち）
          </Typography>
          <Typography sx={{ color: C.grey, fontSize: 11.5, mt: 0.25 }}>
            SEPAルール1: 確認済み上昇トレンド以外で新規買いはしない。候補{ordered.length}件は待機。
          </Typography>
        </Box>
      ) : (
        <>
          {underPressure && !stale && (
            <Box sx={{ p: 1, mb: 1, borderRadius: 1.5, border: `1px solid ${C.amber}`, bgcolor: 'rgba(224,165,46,0.08)' }}
              data-testid="todays-buys-under-pressure">
              <Typography sx={{ color: C.amber, fontWeight: 700, fontSize: 12.5 }}>
                地合いに売り圧力 — 数を絞る{distDays != null ? `（分配日 ${distDays}）` : ''}
              </Typography>
              <Typography sx={{ color: C.grey, fontSize: 11, mt: 0.25 }}>
                上昇は続くが押し戻され気味。ミネルヴィニの「弱い時は少なく」。最も締まった候補だけに絞り、枚数と金額を控えめに。
              </Typography>
            </Box>
          )}
          {visible.map(([e, v]) => (
            <BuyRow key={e.symbol} entry={e} verdict={v} equity={equity} onOpenChart={onOpenChart}
              watched={isWatched(e.symbol)} onToggleWatch={toggleWatch} />
          ))}
          {ordered.length > 20 && !showAll && (
            <Typography onClick={() => setShowAll(true)}
              sx={{ fontSize: 12, color: C.blue, cursor: 'pointer', textAlign: 'center' }}>
              すべて表示（{ordered.length}件）
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}
