import { useState } from 'react';
import { money, times } from '../positionGeometry';
import { footprint, upDownVolume } from './briefChartModel';
import { weeklyBars } from './chartReadout';
import { shortDate } from './briefShared';
import { pivotBar, PIVOT_TIMEFRAMES } from './pivotBar';

const finite = Number.isFinite;
const cents = value => Math.round(value * 100);
// The desktop (1024px and wider) keeps this footnote in place; below that it is in the screen's 注記.
const UPDOWN_INLINE = '上げた日の出来高 ÷ 下げた日の出来高。1超は買いが優勢';

/** The Setup Engine's recalculation is current for the analysis date: the one test every Setup Engine figure on this card reads. */
function setupCurrent(row, date) {
  const calculation = row?.setup_recalculation;
  return calculation?.status === 'calculated' && Boolean(date) && calculation.as_of_date === date;
}

/** The Setup Engine's base length and depth, only when its recalculation is current for the analysis date. */
function engineBase(row, date) {
  if (!setupCurrent(row, date)) return null;
  const weeks = row.se_base_length_weeks, depth = row.se_base_depth_pct;
  return finite(weeks) || finite(depth) ? { weeks: finite(weeks) ? weeks : null, depth: finite(depth) ? depth : null } : null;
}

/** The line for a Setup Engine pivot whose own bar is not found (never `se_pivot_date` printed as the bar, never a guess). */
export const PIVOT_DAY_UNKNOWN = 'ピボットの日 未確認';
/** The suffix for a pivot found by a weekly detector (PIVOT_TIMEFRAMES 'weekly'): its bar is the day's, its pattern the weeks'. */
export const WEEKLY_PATTERN = '（週足の型）';
/** Between the Setup Engine's base and its pivot's day when the day is written in the base's own note. */
export const PIVOT_DAY_SEPARATOR = '・';

/**
 * The Setup Engine pivot's own day (round 3 C4), or null when there is no line to show: 「ピボット $89.88＝9/28の高値（SE）」,
 * with 「（週足の型）」 for a weekly pattern. Shown only when the screen's pivot (`view.pivot`) is the Setup Engine's
 * (`se_pivot_price`, compared in whole cents, so a vcp_pivot fallback or another price shows nothing) and its recalculation is
 * current for the analysis date `date`. The day is the bar `pivotBar` (H1) finds on the certified bars `judged`; with no such bar
 * (no `se_pivot_date`, a pattern pivotBar does not name, no bar whose high is the pivot in cents, or bars not certified) the line
 * reads 「ピボットの日 未確認」. The date is M/D, with the year only when it is not the analysis date's (shortDate).
 */
// eslint-disable-next-line react-refresh/only-export-components -- the card's texts are read by its tests and the rebuild check
export function pivotDayNote({ view, row, judged, date }) {
  const pivot = view?.pivot, engine = row?.se_pivot_price;
  if (!finite(pivot) || !finite(engine) || cents(engine) !== cents(pivot) || !setupCurrent(row, date)) return null;
  const bar = judged ? pivotBar(judged, row) : null;
  if (!bar) return PIVOT_DAY_UNKNOWN;
  const weekly = Object.hasOwn(PIVOT_TIMEFRAMES, row.se_pattern_primary) && PIVOT_TIMEFRAMES[row.se_pattern_primary] === 'weekly';
  return `ピボット ${money(pivot)}＝${shortDate(bar.date, date)}の高値（SE）${weekly ? WEEKLY_PATTERN : ''}`;
}

/**
 * The window of the Setup Engine's se_quiet_days_10d: the field's own 10 sessions (backend/app/analysis/patterns/readiness.py,
 * `quiet_days_window=10`, the field `quiet_days_10d`). Not a threshold of the brief's.
 */
export const QUIET_DAYS_WINDOW = 10;
/** What the Setup Engine counts as a quiet day (readiness.py `quiet_day_mask`, with its default 0.8, 50-day and 14-day windows). */
export const QUIET_DAYS_TITLE = `直近${QUIET_DAYS_WINDOW}営業日のうち、出来高がその日までの50日平均の0.8倍未満で、かつ真の値幅がその日の14日ATR未満だった日の数（Setup Engineの計算）`;

/**
 * 「静かな日 N/10日（SE）」 from `se_quiet_days_10d`, only while the Setup Engine's recalculation is current for `date` and the
 * field is a whole number of days within its window (a real 0 reads 0/10). Missing, fractional or out of range: null (nothing is
 * shown, never 0).
 */
// eslint-disable-next-line react-refresh/only-export-components -- the card's texts are read by its tests and the rebuild check
export function quietDaysText(row, date) {
  const days = row?.se_quiet_days_10d;
  return setupCurrent(row, date) && Number.isInteger(days) && days >= 0 && days <= QUIET_DAYS_WINDOW ? `静かな日 ${days}/${QUIET_DAYS_WINDOW}日（SE）` : null;
}

/** A contraction's length: its sessions, or the weeks it touches on the weekly chart. */
function legLength(leg, bars, weekly) {
  if (!weekly) return finite(leg.bars) ? `${leg.bars}日` : null;
  const weeks = weeklyBars(bars).filter(week => week.date >= leg.startDate && week.start <= leg.endDate).length;
  return weeks ? `${weeks}週` : null;
}

/**
 * The VCP card: the measured contractions (独自近似) and the volume evidence beside the pivot. Each
 * contraction is a button with its T number, depth, length and interval volume ratio; pressing it
 * emphasises that contraction on the chart (`chartRef`). `interval` is the chart's ('week' counts weeks).
 * The Setup Engine's base is shown beside the result when it is current, with a mark when they differ, and the Setup
 * Engine pivot's own day (pivotDayNote) after it in the same note (one inline-block span after 「・」, so a wrap moves the
 * day whole to the note's next line); with no base shown, the day is a note of its own. 当日の出来高 adds the Setup Engine's
 * quiet days (quietDaysText).
 * `pending` (the research detail or the bars still loading) and `uncertified` ({ reason }: the bars are
 * not certified for the analysis date) leave the VCP 未確認 and say why. While `pending`, the pivot's day is not shown
 * at all: the detail that carries its date has not arrived (loading, not 未確認).
 */
export default function VcpCard({ technical, bars, judged, view, wide, chartRef = null, interval = 'day', row = null, date = null, pending = false, uncertified = null }) {
  const print = pending || uncertified ? null : footprint(technical, bars), legs = print ? technical.vcp.legs : [];
  const dry = print ? legs.at(-1)?.volumeEvidence?.intervalRatio : null;
  const engine = engineBase(row, date);
  const pivotDay = pending ? null : pivotDayNote({ view, row, judged, date }), quiet = quietDaysText(row, date);
  // 「（週足の型）」 moves to the next line whole when the line wraps (brief-chart.css).
  const pivotDayText = !pivotDay ? null : pivotDay.endsWith(WEEKLY_PATTERN) ? <>{pivotDay.slice(0, -WEEKLY_PATTERN.length)}<span className="brief-vcp-weekly">{WEEKLY_PATTERN}</span></> : pivotDay;
  const [active, setActive] = useState(null);
  const disagree = engine && print && ((engine.weeks !== null && Math.abs(engine.weeks - print.weeks) > 2) || (engine.depth !== null && Math.abs(engine.depth - Math.max(...legs.map(l => l.depthPct))) > 3));
  const deepest = legs.length ? Math.max(...legs.map(l => l.depthPct)) : 1;
  const choose = (i, event) => {
    const next = active === i ? null : i;
    setActive(next);
    chartRef?.current?.highlightLeg?.(next);
    // On a phone the chart is above this card: bring it into view so the emphasis can be seen.
    const chart = event.currentTarget.closest('.brief-stock')?.querySelector('.brief-chart');
    const box = chart?.getBoundingClientRect?.();
    if (next !== null && box && (box.bottom < 60 || box.top > window.innerHeight - 60) && typeof chart.scrollIntoView === 'function') {
      chart.scrollIntoView({ block: 'center', behavior: typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  };
  return <section className="brief-card in" style={{ '--i': 4 }} aria-labelledby="brief-vcp-title">
    <h2 id="brief-vcp-title">値幅の収縮（VCP）</h2>
    {print ? <>
      <p className="brief-footprint">{print.text}</p>
      <p className="brief-note">土台 {print.weeks}週・{print.firstLabel} {print.first.toFixed(0)}% → 最後の押し {print.last.toFixed(0)}%・収縮 {print.count}回{print.contracting === true ? '（押しが毎回浅くなっています）' : print.contracting === false ? '（押しの縮小が途切れています）' : ''}。{print.brokeOut ? `${print.breakoutDate ? `${shortDate(print.breakoutDate)}に` : ''}土台の高値を上抜けています。` : ''}日足からの独自近似です。各収縮を押すとチャートで強調します。</p>
      <div className="brief-legs" role="group" aria-label="収縮ごとの深さ・長さ・出来高（押すとチャートで強調）">
        <span className="brief-legs-labels" aria-hidden="true"><span className="brief-legbar" /><span /><span>深さ</span><span>長さ</span><span>出来高</span></span>
        {legs.map((leg, i) => {
          const length = legLength(leg, bars, interval === 'week'), ratio = leg.volumeEvidence?.intervalRatio;
          return <button key={leg.startDate} type="button" className="brief-leg" aria-pressed={active === i} onClick={event => choose(i, event)}
            aria-label={`T${i + 1}：深さ ${leg.depthPct.toFixed(1)}%、長さ ${length ?? '未確認'}、出来高 ${finite(ratio) ? `${times(ratio)}（直前50日平均比）` : '未確認'}。押すとチャートで強調`}>
            <span className="brief-legbar"><span className="grow-y" style={{ height: `max(4px, ${(leg.depthPct / deepest * 100).toFixed(1)}%)`, '--i': i }} /></span>
            <b>T{i + 1}</b>
            <span>−{leg.depthPct.toFixed(0)}%</span>
            <span>{length ?? '未確認'}</span>
            <span>{finite(ratio) ? times(ratio) : '未確認'}</span>
          </button>;
        })}
      </div>
    </> : <>
      <p className="brief-footprint">{pending ? 'VCP 未確認（読み込み中）' : 'VCP 未確認'}</p>
      <p className="brief-note">{pending ? '収縮を測る詳細データを読み込み中です。'
        : uncertified ? `${bars?.length ? `日足を分析基準日で検証できないため${uncertified.reason ? `（${uncertified.reason}）` : ''}` : '日足がないため'}、VCPは未確認です。`
          : '測定できる収縮が2回以上ないため、VCPは未確認です。'}</p>
    </>}
    {engine ? <p className="brief-note brief-vcp-engine">Setup Engine：土台 {engine.weeks === null ? '未確認' : `${Math.round(engine.weeks)}週`}・深さ {engine.depth === null ? '未確認' : `${engine.depth.toFixed(0)}%`}{disagree ? '（独自近似と異なります）' : !print ? '（独自近似は未確認）' : ''}{pivotDayText ? <>{PIVOT_DAY_SEPARATOR}<span className="brief-vcp-pivotday">{pivotDayText}</span></> : null}</p> : null}
    {!engine && pivotDayText ? <p className="brief-note brief-vcp-pivotday">{pivotDayText}</p> : null}
    <dl className="brief-dl">
      <div><dt>最後の収縮の出来高</dt><dd>{finite(dry) ? <>{times(dry)}<small>直前50日平均比</small></> : '未確認'}</dd></div>
      <div><dt>上げ下げ出来高比（50日）</dt><dd>{(() => { const v = upDownVolume(judged); return v ? <>{v.ratio.toFixed(2)}<small>{wide ? UPDOWN_INLINE : '1超は買いが優勢'}</small></> : '未確認'; })()}</dd></div>
      <div><dt>当日の出来高</dt><dd>{finite(view?.volumeRatio) ? <>{times(view.volumeRatio)}<small>上抜けの目安 1.40×以上</small></> : '未確認'}{quiet ? <small className="brief-vcp-quiet" title={QUIET_DAYS_TITLE}>{quiet}</small> : null}</dd></div>
      <div><dt>ピボット</dt><dd>{finite(view?.pivot) ? <>{money(view.pivot)}<small>{view.pivotSource}</small></> : '未確認'}</dd></div>
    </dl>
  </section>;
}
