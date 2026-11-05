import { useState } from 'react';
import { money, times } from '../positionGeometry';
import { footprint, upDownVolume } from './briefChartModel';
import { weeklyBars } from './chartReadout';
import { shortDate } from './briefShared';

const finite = Number.isFinite;
// The desktop (1024px and wider) keeps this footnote in place; below that it is in the screen's 注記.
const UPDOWN_INLINE = '上げた日の出来高 ÷ 下げた日の出来高。1超は買いが優勢';

/** The Setup Engine's base length and depth, only when its recalculation is current for the analysis date. */
function engineBase(row, date) {
  const calculation = row?.setup_recalculation;
  if (calculation?.status !== 'calculated' || !date || calculation.as_of_date !== date) return null;
  const weeks = row.se_base_length_weeks, depth = row.se_base_depth_pct;
  return finite(weeks) || finite(depth) ? { weeks: finite(weeks) ? weeks : null, depth: finite(depth) ? depth : null } : null;
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
 * The Setup Engine's base is shown beside the result when it is current, with a mark when they differ.
 * `pending` (the research detail or the bars still loading) and `uncertified` ({ reason }: the bars are
 * not certified for the analysis date) leave the VCP 未確認 and say why.
 */
export default function VcpCard({ technical, bars, judged, view, wide, chartRef = null, interval = 'day', row = null, date = null, pending = false, uncertified = null }) {
  const print = pending || uncertified ? null : footprint(technical, bars), legs = print ? technical.vcp.legs : [];
  const dry = print ? legs.at(-1)?.volumeEvidence?.intervalRatio : null;
  const engine = engineBase(row, date);
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
    {engine ? <p className="brief-note brief-vcp-engine">Setup Engine：土台 {engine.weeks === null ? '未確認' : `${Math.round(engine.weeks)}週`}・深さ {engine.depth === null ? '未確認' : `${engine.depth.toFixed(0)}%`}{disagree ? '（独自近似と異なります）' : !print ? '（独自近似は未確認）' : ''}</p> : null}
    <dl className="brief-dl">
      <div><dt>最後の収縮の出来高</dt><dd>{finite(dry) ? <>{times(dry)}<small>直前50日平均比</small></> : '未確認'}</dd></div>
      <div><dt>上げ下げ出来高比（50日）</dt><dd>{(() => { const v = upDownVolume(judged); return v ? <>{v.ratio.toFixed(2)}<small>{wide ? UPDOWN_INLINE : '1超は買いが優勢'}</small></> : '未確認'; })()}</dd></div>
      <div><dt>当日の出来高</dt><dd>{finite(view?.volumeRatio) ? <>{times(view.volumeRatio)}<small>上抜けの目安 1.40×以上</small></> : '未確認'}</dd></div>
      <div><dt>ピボット</dt><dd>{finite(view?.pivot) ? <>{money(view.pivot)}<small>{view.pivotSource}</small></> : '未確認'}</dd></div>
    </dl>
  </section>;
}
