import { useLayoutEffect, useRef } from 'react';
import { signed } from '../positionGeometry';
import { auditValues } from '../qualificationAudit';
import { marketGuidePercent } from './buyGate';
import { pivotDay, WEEKLY_PATTERN } from './StockVcpCard';
import './brief-strip.css';

const finite = Number.isFinite;
// A value that is not there reads — on screen and 未計算 to a screen reader (as the level tiles did).
const DASH = <><span aria-hidden="true">—</span><span className="sr-only">未計算</span></>;
const price = value => finite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : DASH;
const dollars = value => `$${Math.round(value).toLocaleString('en-US')}`;
/** A unit a line breaks before rather than inside. */
const Unit = ({ children }) => <span className="brief-nowrap">{children}</span>;

/** The one sentence the retired pivot meter said for an unknown pivot (plan D5: kept word for word, a full-width line). */
export const PIVOT_UNKNOWN_NOTE = 'ピボットを確認できないため位置は未確認です。';
/** The strip's title (plan S2-P2): the four numbers are a trial calculation, never a recommendation. */
export const STRIP_TITLE = '試算（買いの推奨ではありません）';

/**
 * The title's qualifier (plan S2-P2, minors A3 and C6): 「参考・地合い 0%」 on a day whose guide is 0%, 「参考・地合い未確認」 when the
 * market's guide is unknown, else the qualifier the level tiles carried (参考 for a plan the gate leaves a reference only, else
 * 既定条件 while every input is its default), or none. 「試算」 itself is only in the title.
 */
function stripQualifier({ market, referenced, plan }) {
  const guide = marketGuidePercent(market);
  if (guide === 0) return '参考・地合い 0%';
  if (guide === null) return '参考・地合い未確認';
  if (referenced) return '参考';
  return plan?.defaults ? '既定条件' : null;
}

/**
 * The published 52-week high of the analysis date (the chart's own reading: the audit dated `date`, on bars certified for it),
 * when it lies inside the buy zone (pivot to its upper limit): 「52週高 X（+n%）」, n the high above the analysis date's close
 * (minor B9). Null otherwise.
 */
function highLine({ view, row, judged, date }) {
  if (!judged || row?.technical_audit?.as_of_date !== date) return null;
  const high = auditValues(row).high;
  if (!finite(high) || !finite(view?.pivot) || !finite(view?.upper) || high < view.pivot || high > view.upper) return null;
  const close = finite(view.price) && view.price > 0 ? view.price : null;
  return `52週高 ${price(high)}${close ? `（${signed((high / close - 1) * 100)}）` : ''}`;
}

/**
 * The 前提 line (plan S2-P2, O10) from the plan's own inputs: 「前提：口座 $50,000・1回 1.25%（$625）・買値 X（終値／ピボット）・損切
 * −7.0%」, or its short form 「前提：口座 $50,000・1回 1.25%・損切 −7.0%（計画カードに内訳）」 (`short`). Null without a plan.
 */
function premiseLine(plan, settings, short) {
  if (!plan || plan.blocked) return null;
  const account = finite(settings?.account) ? `$${settings.account.toLocaleString('en-US')}` : '—';
  const risk = finite(settings?.riskPercent) ? `${settings.riskPercent}%` : '—';
  const stop = `損切 −${plan.stopPercent.toFixed(1)}%`;
  if (short) return [`前提：口座 ${account}`, `1回 ${risk}`, `${stop}（計画カードに内訳）`];
  const budget = finite(plan.riskDollars) ? `（${dollars(plan.riskDollars)}）` : '';
  return [`前提：口座 ${account}`, `1回 ${risk}${budget}`, `買値 ${price(plan.entry)}（${plan.basis === 'pivot' ? 'ピボット' : '終値'}）`, stop];
}

/** The strip's cells and full-width lines, from the plan, the view and the pivot's day (one model for the render and its tests). */
function stripModel({ view, plan, settings, row, judged, date, market, referenced, short = false }) {
  const levels = plan && !plan.blocked ? plan : null;
  const pivotKnown = finite(view?.pivot);
  // A stale pivot says why in the call's line; an unknown one keeps the meter's sentence (D5) and its cell reads 未確認.
  const pivotUnknown = !view?.stale && !finite(view?.distance);
  const day = pivotKnown ? pivotDay({ view, row, judged, date }) : null;
  const dayText = day?.date ? <>{day.date}{day.weekly ? <Unit>{WEEKLY_PATTERN}</Unit> : null}</> : '日付未確認';
  const underOne = levels && finite(levels.risk) && levels.risk > 0 && finite(levels.riskDollars) && levels.riskDollars > 0
    && (levels.shares === 0 || levels.shares === null);
  const shares = finite(levels?.shares) && levels.shares > 0 ? `${levels.shares.toLocaleString('en-US')}株` : underOne ? '1株未満' : DASH;
  const capBinds = !underOne && levels?.binding === 'cap' && finite(levels.capPercent);
  const shareNote = underOne ? (levels.binding === 'cap' ? '1銘柄の上限超' : 'リスク上限超')
    : capBinds ? `上限${levels.capPercent}%` : <>リスク {finite(levels?.riskDollars) ? dollars(levels.riskDollars) : DASH}</>;
  const cells = [
    { key: 'upper', label: 'ゾーン上限', value: price(view?.upper), note: finite(view?.upper) ? '+5%' : null },
    { key: 'pivot', label: 'ピボット', value: pivotUnknown && !pivotKnown ? '未確認' : price(view?.pivot), note: pivotKnown ? dayText : null },
    { key: 'stop', label: finite(levels?.stopPercent) ? `損切り −${levels.stopPercent.toFixed(1)}%` : '損切り', value: price(levels?.stop),
      note: <>買値 {price(levels?.entry)}</>, extra: !referenced && levels?.stopInsideBase === true ? '収縮の中' : null },
    { key: 'shares', label: '株数', value: shares, note: shareNote },
  ];
  const premise = premiseLine(levels, settings, short);
  const actual = capBinds && finite(levels.actualRisk) ? dollars(levels.actualRisk) : null;
  const lines = [
    premise ? { key: 'premise', units: premise } : null,
    (() => { const text = highLine({ view, row, judged, date }); return text ? { key: 'high', units: [text] } : null; })(),
    capBinds ? { key: 'cap', units: [`上限${levels.capPercent}%`, `実リスク ${actual ?? '—'}`] } : null,
    pivotUnknown ? { key: 'pivotUnknown', units: [PIVOT_UNKNOWN_NOTE] } : null,
  ].filter(Boolean);
  return { qualifier: stripQualifier({ market, referenced, plan: levels }), cells, lines };
}

/**
 * The value fit ladder (plan S2-P2): one row of four with 16px values; if a value does not fit its cell (scrollWidth over
 * clientWidth), one row with 14px values; still not, 2 × 2. A value is never clipped. Measured on every resize, so it holds for
 * any font; the form is the strip's `data-fit` (16, 14 or 2x2), set here only.
 */
function useFitLadder(ref, signature) {
  useLayoutEffect(() => {
    const strip = ref.current;
    if (!strip) return undefined;
    let width = null;
    const fit = () => {
      // Only a new width can change the form (a form changes the strip's height, never its width).
      if (strip.clientWidth === width) return;
      width = strip.clientWidth;
      const values = [...strip.querySelectorAll('.brief-strip-cells dd > b')];
      for (const form of ['16', '14', '2x2']) {
        strip.dataset.fit = form;
        if (values.every(value => value.scrollWidth <= value.clientWidth)) return;
      }
    };
    fit();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(fit) : null;
    observer?.observe(strip);
    return () => observer?.disconnect();
  }, [ref, signature]);
}

/**
 * The stock's 4-number strip (plan S2-P2, D4, D5, D8, D17, D19, D20), right under the chart card and attached to it: the title
 * 「試算（買いの推奨ではありません）」 with the day's qualifier, the cells ゾーン上限 | ピボット (its day, as the VCP card reads it) | 損切り
 * (the plan's stop as the plan prints it) | 株数, and the full-width lines, each only in its state (前提, the 52-week high inside the
 * zone, the cap that set the count, the unknown pivot). Text inks only, on every day (D17). `referenced` is the call's (the gate's
 * or the plan's reference); `settings` the plan's inputs; the rest as the call reads them.
 */
export default function StockStrip(props) {
  const { qualifier, cells, lines } = stripModel(props);
  const ref = useRef(null);
  useFitLadder(ref, cells.map(cell => cell.key + String(cell.value?.props ? '' : cell.value)).join('|'));
  return <div ref={ref} className="brief-strip" data-testid="brief-strip">
    <p className="brief-strip-title"><span>{STRIP_TITLE}</span>{qualifier ? <span className="brief-strip-tag">{qualifier}</span> : null}</p>
    <dl className="brief-strip-cells">{cells.map(cell => <div key={cell.key} data-cell={cell.key}>
      <dt>{cell.label}</dt>
      <dd><b className="numeric">{cell.value}</b>{cell.note ? <small>{cell.note}</small> : null}{cell.extra ? <small className="brief-strip-extra">{cell.extra}</small> : null}</dd>
    </div>)}</dl>
    {lines.map(line => <p key={line.key} className="brief-strip-line" data-line={line.key}>{line.units.map((unit, i) => <Unit key={i}>{unit}{i < line.units.length - 1 ? '・' : ''}</Unit>)}</p>)}
  </div>;
}
