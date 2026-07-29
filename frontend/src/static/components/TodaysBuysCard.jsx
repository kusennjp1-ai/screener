import { useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ScheduleIcon from '@mui/icons-material/Schedule';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import BlockIcon from '@mui/icons-material/Block';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import BoltIcon from '@mui/icons-material/Bolt';
import FlagOutlinedIcon from '@mui/icons-material/FlagOutlined';
import { useWatchlist } from '../hooks/useWatchlist';
import { C } from '../designTokens';
import { evaluateSnapshotFreshness } from './StaticDataStatusBanner';
import SellTiming from './SellTiming';

// 今日の買い候補 — the one-glance decision list (C83, graphical rebuild C87,
// candidate-only rebuild C99).
//
// The card answers ONE question: what may I buy at today's open? So it shows
// ONLY genuine buy candidates (in the pivot..+5% zone, confirmed, market green,
// data fresh), best first. Everything else is demoted:
//   · extended / not-yet-triggered  -> collapsed 監視中 (n) disclosure
//   · no computed signal            -> not on this card at all
//   · benchmarks / index ETFs       -> never a candidate (they are the index
//     strip; "buy the S&P 500, which is also a sell" is not a stock pick)
// When nothing qualifies the card says so in one line — 0件 is the answer, not
// a wall of empty rows.
const CHASE_CAP = 1.05; // pivot +5% — Minervini's chase limit (signals.py)
// A bare breakout with none of the three behavioural barrels (trend / buy
// pressure / volume-confirmed breakout) is NOT a "BUY NOW". Minervini buys the
// confirmed setup, not any new high — require at least 2 of 3 barrels.
const MIN_BARRELS_FOR_BUY = 2;
const MAX_BUY_ROWS = 12;

// Benchmarks, broad-market index proxies and their leveraged/inverse siblings.
// These are market context, never stock picks — the classifier drops them.
const BENCHMARK_SYMBOLS = new Set([
  // US broad market
  'SPY', 'SPX', 'VOO', 'IVV', 'SPLG', 'VTI', 'ITOT', 'SCHB', 'SCHX', 'VT', 'RSP', 'MDY',
  'QQQ', 'QQQM', 'NDX', 'ONEQ',
  'IWM', 'IWB', 'IWV', 'RUT',
  'DIA', 'DJI',
  // leveraged / inverse index products
  'SSO', 'UPRO', 'SPXL', 'SDS', 'SPXS', 'SPXU', 'SH',
  'QLD', 'TQQQ', 'SQQQ', 'PSQ',
  'TNA', 'TZA', 'RWM', 'DDM', 'DOG',
  // volatility
  'VIX', 'VXX', 'UVXY', 'VIXY', 'SVXY',
  // index trackers for the other exported markets
  '1306', '1321', '1330', '1570', '2800', '2833', '0050', '006208',
]);

/** SPY / 1306.T / ^GSPC … — market context, never a buy candidate. */
export function isBenchmarkSymbol(symbol) {
  const raw = String(symbol || '').trim().toUpperCase();
  if (!raw) return false;
  if (raw.startsWith('^')) return true; // ^GSPC, ^IXIC, ^N225 …
  return BENCHMARK_SYMBOLS.has(raw.split('.')[0]);
}

// Engineering enums never reach the screen. Anything unmapped renders as
// nothing rather than leaking a raw identifier next to a price.
export const STOP_BASIS_JA = {
  initial: '初期ストップ',
  half_risk: '半分利食い後',
  max_loss_cap: '最大損失ライン',
  base_low: 'ベース安値',
  breakeven: '建値',
  lock_1r: '+1R確保',
  trail_50dma: '50日線トレール',
  trail_20bar_low: '直近20日安値トレール',
};

export const stopBasisLabel = (basis) => STOP_BASIS_JA[basis] || null;

/** Same sell block with its stop basis already in Japanese (SellTiming prints it verbatim). */
export function localizeSell(sell) {
  if (!sell) return sell;
  return { ...sell, stop_basis: stopBasisLabel(sell.stop_basis) };
}

// One MUI icon voice (matches the rest of the app) — never emoji/glyphs.
const VERDICT_META = {
  buy_now: { label: 'ゾーン内 — 買い', Icon: CheckCircleIcon, color: C.green },
  not_triggered: { label: '待機', Icon: ScheduleIcon, color: C.grey },
  extended: { label: '伸びすぎ', Icon: WarningAmberIcon, color: C.amber },
};

const SOURCE_LABEL = { vcp: 'VCP', ma_tight: 'MA-TIGHT', vol_contract: 'VOL-CTR' };

// 44x44 minimum tap target (WCAG 2.5.5 AAA / iOS HIG). The drawn icon keeps its
// size; the box grows around it and negative margins absorb the growth, so the
// row rhythm is unchanged while the finger gets a real target.
const TAP_MIN = 44;
const TAP = {
  minWidth: TAP_MIN, minHeight: TAP_MIN, display: 'inline-flex',
  alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer',
};

// A candidate is NOT a position. Position-management verbs (保有継続 /
// ストップ上げ / 半分利食い後) only mean something for stock you own, so a row
// the user does not hold shows the ENTRY plan instead. The exit engine is still
// read — but as a reason NOT to buy, phrased for someone with no position.
export const ENTRY_BLOCK_META = {
  stop_hit: { label: 'ストップ水準割れ — 新規買い見送り', Icon: BlockIcon, color: C.red },
  exit: { label: '50日線割れ — 新規買い見送り', Icon: TrendingDownIcon, color: C.red },
  sell_into_strength: { label: 'クライマックス — 新規買い見送り', Icon: BoltIcon, color: C.amber },
};

/** The entry-side reading of an exit action: a warning, or null (nothing blocks entry). */
export function entryBlock(sell) {
  return ENTRY_BLOCK_META[sell?.action] || null;
}

/**
 * buy_now | extended | not_triggered | no_signal | benchmark
 *
 * A stale snapshot or a red market can only ever DEMOTE a row to 待機 — the card
 * never issues a buy off data it does not trust.
 */
export function classifyEntry(entry, { marketRed, stale } = {}) {
  if (isBenchmarkSymbol(entry?.symbol)) return 'benchmark';
  const buy = entry?.buy;
  if (!buy || buy.trigger_price == null) return 'no_signal';
  const zoneHi = buy.trigger_price * CHASE_CAP;
  const px = buy.last_close;
  if (px != null && px > zoneHi) return 'extended';
  // Unknown barrel count (older export) keeps the old behaviour; a known count
  // below the threshold downgrades the row from BUY NOW to WAIT.
  const confirmed = buy.barrels_passed == null || buy.barrels_passed >= MIN_BARRELS_FOR_BUY;
  if (!marketRed && !stale && buy.active && confirmed
    && px != null && px >= buy.trigger_price && px <= zoneHi) {
    return 'buy_now';
  }
  return 'not_triggered';
}

const fmt = (v, digits = 2) => (v == null ? '-' : Number(v).toFixed(digits));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Best first: more confirmation barrels, then stronger RS, then the entry that
// is closest to its pivot (least chased).
const buyOrderKey = (e) => {
  const b = e.buy || {};
  const barrels = b.barrels_passed == null ? MIN_BARRELS_FOR_BUY : b.barrels_passed;
  const rs = e.rs_rating == null ? 0 : e.rs_rating;
  const chase = b.last_close != null && b.trigger_price > 0 ? b.last_close / b.trigger_price - 1 : 1;
  return [-barrels, -rs, chase];
};

// Watch list: nearest to a tradable zone first.
const distanceToZone = (e) => {
  const b = e.buy || {};
  const lo = b.trigger_price;
  const px = b.last_close;
  if (lo == null || lo <= 0 || px == null) return Number.POSITIVE_INFINITY;
  const hi = lo * CHASE_CAP;
  if (px < lo) return (lo - px) / lo;
  if (px > hi) return (px - hi) / hi;
  return 0;
};

const byKey = (keyFn) => (a, b) => {
  const ka = keyFn(a);
  const kb = keyFn(b);
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return ka[i] < kb[i] ? -1 : 1;
  }
  return String(a.symbol).localeCompare(String(b.symbol));
};

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
      {/* tick labels — a pivot sitting close to the stop is nudged right and
          left-aligned so the two prices never collide at 375px */}
      <Box sx={{ position: 'relative', height: 26, mt: 0.25 }}>
        <Tick p={0} label="損切り" sub={fmt(stop)} color={C.red} align="start" />
        <Tick
          p={pivotPct == null ? null : Math.max(pivotPct, 26)}
          label="ピボット"
          sub={fmt(pivot)}
          color={C.inkStrong}
          align={pivotPct != null && pivotPct < 26 ? 'start' : 'mid'}
        />
        {pct(t2) != null && <Tick p={pct(t2)} label="2R" sub={fmt(t2)} color={C.green} align="mid" />}
        <Tick p={100} label="3R" sub={fmt(t3 ?? t2)} color={C.green} align="end" />
      </Box>
      {/* live read line */}
      {px != null && (
        <Typography sx={{ fontSize: 11.5, color: inZone ? C.green : C.amber, fontFamily: 'monospace', mt: 0.25 }}>
          ● 現在値 {fmt(px)} {inZone ? `— ゾーン内 (+${delta}%)` : `(${delta > 0 ? '+' : ''}${delta}%)`}
          {buy.stop_pct != null && <Box component="span" sx={{ color: C.red, ml: 1 }}>損失幅 −{fmt(buy.stop_pct, 1)}%</Box>}
        </Typography>
      )}
    </Box>
  );
}

// One labelled number. Label and value live in the SAME grid cell and both are
// noWrap, so the pair can never be split across lines by a long neighbour.
function ZoneCell({ label, value, note, color, align = 'start' }) {
  const justify = align === 'end' ? 'flex-end' : align === 'mid' ? 'center' : 'flex-start';
  return (
    <Box sx={{ minWidth: 0, textAlign: align === 'end' ? 'right' : align === 'mid' ? 'center' : 'left' }}>
      <Typography noWrap sx={{ fontSize: 10, color: C.grey, lineHeight: 1.25 }}>{label}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.4, justifyContent: justify }}>
        <Typography noWrap sx={{ fontSize: 11.5, fontWeight: 700, color, fontFamily: 'monospace', lineHeight: 1.3 }}>
          {value}
        </Typography>
        {note != null && (
          <Typography noWrap sx={{ fontSize: 10, color, fontFamily: 'monospace', lineHeight: 1.3 }}>{note}</Typography>
        )}
      </Box>
    </Box>
  );
}

// A slim pivot bar for watch rows: just the zone + where price sits.
//
// Laid out as a 3-column GRID, not an inline run. With 4-digit prices (LLY
// 1160.95, GEV 1118.96) the old inline flex row wrapped mid-sentence and
// orphaned「+5%」from its number and「(+4.1%)」from its price. A grid cell can
// only ever move as a whole.
function MiniZone({ buy }) {
  const lo = buy.trigger_price;
  const hi = lo * CHASE_CAP;
  const px = buy.last_close;
  const within = px != null && px >= lo && px <= hi;
  const posPct = px == null ? null : clamp(((px - lo) / (hi - lo)) * 100, 0, 100);
  const delta = px != null && lo > 0 ? ((px / lo - 1) * 100).toFixed(1) : null;
  return (
    <Box sx={{ mt: 0.6 }}>
      <Box
        data-testid="mini-zone-grid"
        sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', columnGap: 0.75, alignItems: 'end' }}
      >
        <ZoneCell label="ピボット" value={fmt(lo)} color={C.inkStrong} />
        <ZoneCell label="+5%上限" value={fmt(hi)} color={C.grey} align="mid" />
        {px != null && (
          <ZoneCell
            label="現在値"
            value={fmt(px)}
            note={`${delta > 0 ? '+' : ''}${delta}%`}
            color={within ? C.green : C.amber}
            align="end"
          />
        )}
      </Box>
      <Box sx={{ position: 'relative', height: 5, mt: 0.5, borderRadius: 3, bgcolor: C.track }}>
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
            比率 {fmt(size, 1)}%{shares != null ? ` · ${shares}株` : ''}
          </Typography>
        </Box>
      )}
      <Typography sx={{ fontSize: 11, color: C.grey, fontFamily: 'monospace' }}>
        1回のリスク {fmt(buy.account_risk_pct, 2)}%
      </Typography>
      {barrels != null && (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, ml: 'auto' }}>
          <Typography sx={{ fontSize: 10.5, color: C.grey }}>確認</Typography>
          {[0, 1, 2].map((i) => (
            <Box key={i} sx={{ width: 7, height: 7, borderRadius: '50%',
              bgcolor: i < barrels ? C.green : 'transparent', border: `1px solid ${i < barrels ? C.green : C.dim}` }} />
          ))}
        </Box>
      )}
    </Box>
  );
}

// The entry-side footer for a name the user does NOT hold: the stop you would
// set on the day you buy, plus any reason not to buy at all.
function EntryPlan({ buy, sell, showStop }) {
  const block = entryBlock(sell);
  const basis = stopBasisLabel(buy?.stop_basis);
  const stop = buy?.stop_loss;
  const withStop = showStop && stop != null;
  if (!block && !withStop) return null;
  const BlockIconEl = block?.Icon;
  return (
    <Box data-testid="entry-plan" data-entry-block={block ? sell.action : ''}
      sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', rowGap: 0.25 }}>
      {block ? (
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.4, px: 0.6, py: '1px',
          borderRadius: 1, bgcolor: `${block.color}22`, border: `1px solid ${block.color}`,
        }}>
          <BlockIconEl sx={{ fontSize: 13, color: block.color }} />
          <Typography sx={{ fontWeight: 800, fontSize: 11, color: block.color, lineHeight: 1.2 }}>
            {block.label}
          </Typography>
        </Box>
      ) : (
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
          <FlagOutlinedIcon sx={{ fontSize: 13, color: C.grey }} />
          <Typography sx={{ fontSize: 11, color: C.grey, fontWeight: 700 }}>買う場合</Typography>
        </Box>
      )}
      {withStop && (
        <Typography noWrap sx={{ fontSize: 11.5, color: C.ink, fontFamily: 'monospace' }}>
          損切り {fmt(stop)}{basis ? ` · ${basis}` : ''}
        </Typography>
      )}
    </Box>
  );
}

function BuyRow({ entry, verdict, rank, equity, onOpenChart, watched, onToggleWatch }) {
  const buy = entry.buy;
  const meta = VERDICT_META[verdict] || VERDICT_META.not_triggered;
  const expanded = verdict === 'buy_now';
  const shares = expanded && equity > 0 && buy?.position_size_pct != null && buy?.last_close > 0
    ? Math.floor((equity * buy.position_size_pct / 100) / buy.last_close)
    : null;
  const suffix = verdict === 'extended' && buy?.last_close != null && buy?.trigger_price > 0
    ? ` +${((buy.last_close / buy.trigger_price - 1) * 100).toFixed(1)}%` : '';
  const basis = stopBasisLabel(buy?.stop_basis);
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
        {rank != null ? (
          <Typography sx={{ fontSize: 11, fontWeight: 800, color: C.green, fontFamily: 'monospace', flexShrink: 0 }}>
            {rank}
          </Typography>
        ) : (
          <Box sx={{ width: 8, height: 8, borderRadius: 0.5, bgcolor: meta.color, flexShrink: 0 }} />
        )}
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
          sx={{ ...TAP, my: '-11px', mr: '-10px', color: watched ? C.amber : C.dim }}
          aria-label={watched ? `${entry.symbol}を監視リストから外す` : `${entry.symbol}を監視リストに追加`}
        >
          {watched ? <StarIcon sx={{ fontSize: 17 }} /> : <StarBorderIcon sx={{ fontSize: 17 }} />}
        </Box>
      </Box>

      {expanded && buy && (
        <>
          <RiskRewardLadder buy={buy} />
          <SizeAndBarrels buy={buy} shares={shares} />
          <Typography sx={{ fontSize: 10, color: C.grey, fontFamily: 'monospace', mt: 0.4 }}>
            損切り {fmt(buy.stop_loss)}{basis ? ` · ${basis}` : ''}
            {buy.signal_as_of ? ` · 判定日 ${String(buy.signal_as_of).slice(0, 10)}` : ''}
          </Typography>
        </>
      )}

      {!expanded && buy?.trigger_price != null && <MiniZone buy={buy} />}

      {/* C97: risk is ALWAYS shown, on every verdict — but in the right voice.
          A name the user HOLDS (it is on the watchlist) gets position
          management: 保有継続 / ストップ上げ / 半分利食い後. A name he merely
          might buy gets the ENTRY plan — a candidate cannot be "after taking
          half profits". */}
      {watched ? (
        <Box data-testid={`todays-buys-held-${entry.symbol}`}
          sx={{ mt: 0.6, pt: 0.6, borderTop: `1px solid ${C.track}` }}>
          <Typography sx={{ fontSize: 10, color: C.grey, fontWeight: 700, mb: 0.25 }}>保有・監視中の建玉</Typography>
          <SellTiming sell={localizeSell(entry.sell)} />
        </Box>
      ) : (
        (entryBlock(entry.sell) || (!expanded && buy?.stop_loss != null)) && (
          <Box sx={{ mt: 0.6, pt: 0.6, borderTop: `1px solid ${C.track}` }}>
            <EntryPlan buy={buy} sell={entry.sell} showStop={!expanded} />
          </Box>
        )
      )}
    </Box>
  );
}

export default function TodaysBuysCard({ indexData, scanRows, onOpenChart, market = 'US', now }) {
  const [showAllBuys, setShowAllBuys] = useState(false);
  const [showWatch, setShowWatch] = useState(false);
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
  // Staleness is counted in TRADING SESSIONS, not calendar days. The old
  // 4-calendar-day constant called a Friday snapshot fresh on the following
  // Tuesday; one completed session behind is already too old to buy on.
  const freshness = useMemo(
    () => evaluateSnapshotFreshness({ asOfDate: asOf, market, now: now || new Date() }),
    [asOf, market, now],
  );
  const stale = freshness.stale;

  // Two lists only: today's candidates, and the names worth watching. Rows with
  // no computed signal and every benchmark/index ticker are dropped outright.
  const { buys, watch } = useMemo(() => {
    const buyList = [];
    const watchList = [];
    for (const e of entries) {
      const verdict = classifyEntry(e, { marketRed, stale });
      if (verdict === 'buy_now') buyList.push(e);
      else if (verdict === 'extended' || verdict === 'not_triggered') watchList.push(e);
    }
    buyList.sort(byKey(buyOrderKey));
    watchList.sort(byKey((e) => [distanceToZone(e)]));
    return { buys: buyList, watch: watchList };
  }, [entries, marketRed, stale]);

  // Pre-v2 indexes carry no buy blocks at all — render nothing.
  if (!entries.length || !entries.some((e) => e?.buy)) return null;

  const visibleBuys = showAllBuys ? buys : buys.slice(0, MAX_BUY_ROWS);
  const emptyReason = stale
    ? 'データが最新ではないため判定は出していません'
    : watch.length > 0 ? `ゾーン内の銘柄はありません（監視中 ${watch.length}件）` : null;

  return (
    <Box sx={{ mb: 2 }} data-testid="todays-buys-card">
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
        <Typography sx={{ fontWeight: 800, color: C.inkStrong, fontSize: 15, whiteSpace: 'nowrap', flexShrink: 0 }}>今日の買い候補</Typography>
        {buys.length > 0 && (
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4, flexShrink: 0 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: C.green }} />
            <Typography sx={{ fontSize: 11.5, color: C.green, fontWeight: 700 }}>買い{buys.length}</Typography>
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }} />
        <Typography noWrap sx={{ fontSize: 10.5, color: C.grey, fontFamily: 'monospace', flexShrink: 1, minWidth: 0 }}>{asOf || '-'}</Typography>
        <Box
          component="span"
          role="button"
          data-testid="todays-buys-equity"
          onClick={() => {
            const raw = window.prompt('運用資金（ドル）を入力（株数の目安表示に使用・端末内保存）', equity || '');
            const v = Number(raw);
            if (raw != null && Number.isFinite(v) && v >= 0) {
              setEquity(v);
              localStorage.setItem('todaysBuysEquity', String(v));
            }
          }}
          sx={{ ...TAP, my: '-13px', mr: '-4px', px: 0.5, whiteSpace: 'nowrap' }}
        >
          <Typography sx={{ fontSize: 11, color: C.blue }}>
            {equity > 0 ? `資金 $${equity.toLocaleString()}` : '[資金を設定]'}
          </Typography>
        </Box>
      </Box>

      {marketRed ? (
        <Box sx={{ p: 1.25, borderRadius: 1.5, border: `1px solid ${C.red}`, bgcolor: 'rgba(242,54,69,0.08)' }}
          data-testid="todays-buys-market-red">
          <Typography sx={{ color: C.red, fontWeight: 700, fontSize: 13 }}>
            新規買い停止 — 地合い{regime === 'correction' ? '調整入り' : '下降トレンド'}（FTD待ち）
          </Typography>
          <Typography sx={{ color: C.grey, fontSize: 11.5, mt: 0.25 }}>
            SEPAルール1: 確認済み上昇トレンド以外で新規買いはしない。候補{watch.length}件は待機。
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

          {visibleBuys.map((e, i) => (
            <BuyRow key={e.symbol} entry={e} verdict="buy_now" rank={i + 1} equity={equity}
              onOpenChart={onOpenChart} watched={isWatched(e.symbol)} onToggleWatch={toggleWatch} />
          ))}
          {buys.length > MAX_BUY_ROWS && !showAllBuys && (
            <Box role="button" data-testid="todays-buys-show-all" onClick={() => setShowAllBuys(true)}
              sx={{ ...TAP, width: '100%', mb: 1 }}>
              <Typography sx={{ fontSize: 12, color: C.blue }}>すべて表示（{buys.length}件）</Typography>
            </Box>
          )}

          {buys.length === 0 && (
            <Box data-testid="todays-buys-empty"
              sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75, flexWrap: 'wrap',
                p: 1.25, borderRadius: 1.5, border: `1px solid ${C.track}`, bgcolor: C.panel }}>
              <Typography sx={{ fontSize: 13, fontWeight: 700, color: C.ink }}>
                本日の新規買い候補: 0件
              </Typography>
              {emptyReason && (
                <Typography sx={{ fontSize: 11, color: C.grey }}>{emptyReason}</Typography>
              )}
            </Box>
          )}
        </>
      )}

      {watch.length > 0 && (
        <Box sx={{ mt: 1 }} data-testid="todays-buys-watch-section">
          <Box
            role="button"
            aria-expanded={showWatch}
            data-testid="todays-buys-watch-toggle"
            onClick={() => setShowWatch((v) => !v)}
            sx={{ ...TAP, justifyContent: 'flex-start', gap: 0.25, pr: 1.5, my: '-8px' }}
          >
            <ChevronRightIcon sx={{ fontSize: 16, color: C.grey, transform: showWatch ? 'rotate(90deg)' : 'none' }} />
            <Typography sx={{ fontSize: 12, fontWeight: 700, color: C.grey }}>
              監視中 ({watch.length})
            </Typography>
          </Box>
          {showWatch && (
            <Box sx={{ mt: 0.75 }}>
              {watch.map((e) => (
                <BuyRow key={e.symbol} entry={e} verdict={classifyEntry(e, { marketRed, stale })}
                  equity={equity} onOpenChart={onOpenChart}
                  watched={isWatched(e.symbol)} onToggleWatch={toggleWatch} />
              ))}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
