import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { AsOf, ChartNote, Label, StatusAlert, VerdictMark } from './MarketCard';
import MarketSectors from './MarketSectors';
import WhenNear from './WhenNear';
import { HistoricalBreadth } from '../components/MarketHistoryExplorer';
import MarketUpdateStatus from '../components/MarketUpdateStatus';
import useMediaQuery from '../useMediaQuery';
import { marketUpdateState } from '../marketUpdateState';
import { bare, sentence, shortDate, trendsStatus } from './briefModel';
import { Expander, Parts, ScreenNotes } from './briefPrimitives';
import { jumpTo } from './jump';
import { barDay } from './briefNav';
import { chartStatusOf, indexCloses, marketCardView, num, signedPercent, sma, SURVIVORSHIP_NOTE } from './marketTabModel';
import { historyTakeaway } from './marketTabHistory';
import { marketTabParts } from './marketTabGroups';
import useSessionState from './useSessionState';
import referenceData from '../reference/market-regime-reference-v1.json' with { type: 'json' };
import { validReference } from '../reference/marketRegimeReference.js';
import { exposureRuleText, marketTabStudy } from '../reference/marketTabStudy.js';

const EXPLORER_TITLE = 'brief-history-explorer-title';
/** The versioned market-regime study reference (tools/market-regime-reference.mjs); an invalid one shows nothing. */
const REFERENCE = validReference(referenceData) ? referenceData : null;

// ---- the market tab's 地合い card ------------------------------------------------------------------------

const finite = Number.isFinite;
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
/** A scale label: a whole number, a negative one with U+2212 (never the ASCII hyphen). */
const scale = value => num(value, 0).replace('-', '−');

/**
 * The market tab's index chart: one index's closes with its 50-day and 200-day lines, its active distribution days, the
 * FTD day and the rally low, and its scale. `name` names the index (Today draws its own, MarketCard.jsx). A moving
 * average that starts inside the window (too few closes before it, e.g. the Nasdaq's 200-day line on its published
 * closes) names its first day in the legend and the label (「200日線（6/12〜）」), so a shorter line never reads as
 * covering the whole range. `legendName` false leaves the index's own legend entry out (a phone's S&P／Nasdaq switch
 * already names the series; the label keeps the name and the range).
 */
function IndexChart({ closes, name = 'S&P 500', distribution, distributionEnd, followThrough = null, status, legendName = true }) {
  const points = (closes || []).filter(p => finite(p.close)).slice(-130);
  if (points.length < 60) return <ChartNote status={status} closes={closes} />;
  const all = (closes || []).filter(p => finite(p.close)), offset = all.length - points.length;
  const ma = sma(all, offset, points.length, 50);
  const ma200 = sma(all, offset, points.length, 200);
  const values = [...points.map(p => p.close), ...ma.filter(finite), ...ma200.filter(finite)], lo = Math.min(...values), hi = Math.max(...values);
  const W = 600, H = 132, x = i => 4 + i * (W - 8) / (points.length - 1), y = v => 18 + (hi - v) * (H - 30) / (hi - lo || 1);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join('');
  const maPath = series => series.map((v, i) => v == null ? '' : `${series[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const line50 = maPath(ma), line200 = ma200.some(finite) ? maPath(ma200) : '';
  const active = new Set((distribution?.events || []).filter(e => e.state === 'active').map(e => e.date));
  const marks = points.map((p, i) => active.has(p.date) ? i : -1).filter(i => i >= 0);
  // The ▲ marks come from the index series, which can end on another session than the closes.
  const chartEnd = points.at(-1).date;
  // A line's first day when it starts after the window's first session: 「（6/12〜）」, else nothing.
  const startOf = series => { const at = series.findIndex(finite); return at > 0 ? `（${shortDate(points[at].date, chartEnd)}〜）` : ''; };
  const from50 = startOf(ma), from200 = line200 ? startOf(ma200) : '';
  const lineNames = `50日線${from50}${line200 ? `・200日線${from200}` : ''}`;
  // The exporter's follow-through record for the same index: a mark only for a day inside the window.
  const ft = followThrough?.available === true ? followThrough : null, find = day => isDay(day) ? points.findIndex(p => p.date === day) : -1;
  const ftdAt = ft && ['confirmed', 'ftd_failed'].includes(ft.state) ? find(ft.ftd?.date) : -1;
  // The rally low: during an attempt the record's own low; once an FTD stands (or failed) the record's low is a
  // later pullback's, so the low the FTD confirmed comes from its ftd event. Without that date, no ○.
  const rallyLow = !ft ? null : ['rally_attempt', 'attempt_expired'].includes(ft.state) ? ft.low?.date
    : ['confirmed', 'ftd_failed'].includes(ft.state) ? (Array.isArray(ft.events) ? ft.events : []).find(e => e?.type === 'ftd' && e.date === ft.ftd?.date)?.lowDate : null;
  const lowAt = find(rallyLow);
  const at = i => ({ left: `${(100 * x(i) / W).toFixed(2)}%`, top: `${(100 * y(points[i].close) / H).toFixed(2)}%` });
  // A failed FTD keeps its ◆ but says it failed, so the mark never reads as a standing follow-through.
  const ftdWord = ftdAt >= 0 ? `FTD ${shortDate(points[ftdAt].date, chartEnd)}${ft.state === 'ftd_failed' && isDay(ft.failedDate) ? `（失敗 ${shortDate(ft.failedDate, chartEnd)}）` : ft.state === 'ftd_failed' ? '（失敗）' : ''}` : null;
  const words = [ftdWord, lowAt >= 0 ? `反発の安値 ${shortDate(points[lowAt].date, chartEnd)}` : null].filter(Boolean);
  const svg = <svg className="brief-index is-detail" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img"
    aria-label={`${name} の終値と${lineNames}（${points[0].date}〜${chartEnd}）。有効な分配日 ${marks.length}日${words.length ? `。${words.join('、')}` : ''}。目盛り ${scale(lo)}〜${scale(hi)}`}>
    {line200 && <path d={line200} className="brief-index-ma200" />}
    <path d={line50} className="brief-index-ma" />
    <path d={line} className="brief-index-line" />
    {marks.map((i, k) => <path key={i} d={`M${x(i) - 5},${y(points[i].close) + 14}h10l-5,-8z`} className="brief-index-dist" style={{ '--i': k }} />)}
  </svg>;
  return <>
    <div className="brief-index-frame">
      {svg}
      {/* Labels and marks are HTML over the stretched SVG, so they keep their shape and the 12px floor. The scale labels
          sit on an opaque chip, so a line passing under one never reads as a minus sign. */}
      <span className="brief-index-scale is-hi numeric" aria-hidden="true" style={{ top: `${(100 * y(hi) / H).toFixed(2)}%` }}>{scale(hi)}</span>
      <span className="brief-index-scale is-lo numeric" aria-hidden="true" style={{ top: `${(100 * y(lo) / H).toFixed(2)}%` }}>{scale(lo)}</span>
      {lowAt >= 0 && <span className="brief-index-mark is-low" aria-hidden="true" style={at(lowAt)}>○</span>}
      {/* The FTD label sits above its ◆, or below it when the close is near the frame's top. */}
      {ftdAt >= 0 && <span className={`brief-index-mark is-ftd${x(ftdAt) > W * 0.6 ? ' is-end' : ''}${y(points[ftdAt].close) < H * 0.3 ? ' is-below' : ''}${ft.state === 'ftd_failed' ? ' is-failed' : ''}`} aria-hidden="true" style={at(ftdAt)}>◆<span className="brief-index-mark-label">{ftdWord}</span></span>}
    </div>
    <p className="brief-index-legend" aria-hidden="true">{legendName && <span className="is-close">{name} 終値（{shortDate(points[0].date, chartEnd)}〜{shortDate(chartEnd, chartEnd)}）</span>}<span className="is-ma">50日線{from50}</span>{line200 && <span className="is-ma200">200日線{from200}</span>}<span className="is-dist">▲ 分配日{distributionEnd && distributionEnd !== chartEnd ? `（${shortDate(distributionEnd, chartEnd)}まで）` : ''}</span>{(ftdAt >= 0 || lowAt >= 0) && <span className="is-ftd">{ftdAt >= 0 ? `◆ FTD${ft.state === 'ftd_failed' ? '（失敗）' : ''}` : ''}{ftdAt >= 0 && lowAt >= 0 ? '・' : ''}{lowAt >= 0 ? '○ 反発の安値' : ''}</span>}</p>
  </>;
}

// ---- market tab: rows that open to their rule, one-year line and long-history link ----------------

/** A path through the values, broken where a session has none (an unknown is never drawn as 0). */
function seriesPath(series, lo, hi, W, H, pad) {
  const n = series.length, x = i => n > 1 ? i * W / (n - 1) : W / 2, y = v => pad + (hi - v) * (H - 2 * pad) / (hi - lo);
  let pen = 'M';
  return series.map((v, i) => { if (v === null) { pen = 'M'; return ''; } const step = `${pen}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = 'L'; return step; }).join('');
}

/** The row's last year at a glance (its own scale; the opened row shows that scale in words). */
const Spark = ({ range }) => <svg className="brief-env-spark" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={seriesPath(range.series, range.lo, range.hi, 64, 20, 2)} /></svg>;

/**
 * The value's last 252 sessions on its own labelled scale; mounted only when its row is opened. `name` names the series
 * in its caption, before a full-width space, when a row draws more than one (「S&P」, then 「1年の最低 0日・最高 3日」).
 */
function YearLine({ label, name = null, range, format }) {
  const lastValue = [...range.series].reverse().find(v => v !== null);
  return <div className="brief-yearline">
    <svg viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label={`${label}の直近1年の推移。最低 ${format(range.lo)}、最高 ${format(range.hi)}、最新 ${format(lastValue)}`}><path d={seriesPath(range.series, range.lo, range.hi, 300, 56, 4)} /></svg>
    <p aria-hidden="true">{name ? <><b className="brief-yearline-name">{name}</b>{'　'}</> : null}<span>1年の最低 {format(range.lo)}・最高 {format(range.hi)}</span></p>
  </div>;
}

function PairLines({ item, groupAsOf }) {
  return <span className="brief-env-pairs">{item.rows.map(row => <span key={row.name} className="brief-ftd-row">
    <span className="brief-ftd-index">{row.name}</span>
    <b className={row.warn ? 'is-warn' : ''}>{row.b}{row.asOf && row.asOf !== groupAsOf ? <span className="brief-fact-asof">（{row.asOf}時点）</span> : null}</b>
    {row.em ? <em><Parts text={row.em} /></em> : null}
    {row.flag ? <span className={`brief-flag${row.reference ? ' is-reference' : ''}`}><span aria-hidden="true">{row.reference ? '○' : '▲'}</span><span className="sr-only">{row.reference ? '参考：' : '注意：'}</span>{row.flag}</span> : null}
  </span>)}</span>;
}

/**
 * One market-tab row: a fixed status slot (▲ 注意 only for a rule that exists and fired), the label,
 * the value with its one-month change and its last year as a small line. Opening it shows the details,
 * the one-year line on its own scale, the rule (基準) and a link to the long history.
 */
function EnvRow({ item, groupAsOf, onOpenMetric }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const pair = Boolean(item.rows);
  const rowAsOf = item.asOf && item.asOf !== groupAsOf ? item.asOf : null;
  const note = [item.note, item.position].filter(Boolean).join('・') || (item.valued ? null : item.em) || null;
  const details = [item.detail, pair ? item.note : null, ...(item.details || [])].filter(Boolean);
  return <div className={`brief-fact brief-env-row${item.className ? ` ${item.className}` : ''}${item.warn ? ' is-warn' : ''}${pair ? ' is-pair' : ''}`}>
    <button type="button" className="brief-env-toggle" aria-expanded={open} aria-controls={`${id}-d`} onClick={() => setOpen(value => !value)}>
      {/* ▲ 注意 for a rule that fired; ○ 参考 for one the study could not confirm (counted apart, never amber). */}
      <span className={`brief-env-status${item.reference ? ' is-reference' : ''}`}>{item.warn ? <><span aria-hidden="true">▲</span><span>注意</span></> : item.reference ? <><span aria-hidden="true">○</span><span>参考</span></> : null}</span>
      <small><Label text={item.label} /></small>
      {pair ? <PairLines item={item} groupAsOf={groupAsOf} />
        : <>
          <b className={item.warn ? 'is-warn' : ''}>{item.b}<AsOf value={rowAsOf} /></b>
          {note ? <em><Parts text={note} /></em> : null}
          {item.flag ? <span className={`brief-flag${item.reference ? ' is-reference' : ''}`}><span className="sr-only">{item.reference ? '参考：' : '注意：'}</span>{item.flag}</span> : null}
          {item.range ? <Spark range={item.range} /> : null}
          {item.change ? <span className="brief-env-change"><span className="numeric">{item.change}</span> 1か月比</span> : null}
        </>}
      <span className="brief-env-chevron" aria-hidden="true">⌄</span>
    </button>
    {item.stages && <>
      <div className="brief-stagebar" role="img" aria-label={`ステージ構成 ${item.stages.map(s => `ステージ${s.k} ${num(s.share, 1)}%`).join('、')}${item.asOf ? `（${item.asOf}時点）` : ''}`}>
        {item.stages.map((s, i) => <span key={s.k} className={`stage-${s.k}`} style={{ flexGrow: s.share, '--i': i }} />)}
      </div>
      <div className="brief-stagelegend" aria-hidden="true">{item.stages.map(s => <span key={s.k}><i className={`stage-${s.k}`} />{s.k} {s.name} <b className="numeric">{num(s.share, 0)}%</b></span>)}</div>
    </>}
    <div className="brief-env-detail" id={`${id}-d`} hidden={!open}>
      {open && <>
        {details.map(text => <p key={text}>{text}</p>)}
        {item.range && <YearLine label={item.label} range={item.range} format={item.format} />}
        {(item.yearLines || []).map(line => <YearLine key={line.label} label={line.label} name={line.name} range={line.range} format={line.format} />)}
        <p className="brief-env-rule"><b>基準</b>{item.rule}</p>
        {item.metric && onOpenMetric && <button type="button" className="brief-env-open" onClick={() => onOpenMetric(item.metric)}>市場環境の推移で見る <span aria-hidden="true">›</span></button>}
      </>}
    </div>
  </div>;
}

/**
 * One evidence group: its heading, its question, its marks and date, its rows. `control` (the phone's S&P／Nasdaq switch)
 * takes the marks' slot beside the heading, and the marks and date, when there are any, take the question's line under
 * the heading: the head keeps its two lines and the switch adds no row of its own.
 */
function Group({ group, caveat = null, control = null, children }) {
  const head = useId();
  const meta = (group.fired > 0 || group.references > 0 || group.asOf) ? <>
    {group.fired > 0 && <span className="brief-env-state"><span aria-hidden="true">▲</span> 注意 {group.fired}</span>}
    {group.references > 0 && <span className="brief-env-state is-reference"><span aria-hidden="true">○</span> 参考 {group.references}</span>}
    {group.asOf && <span className="brief-env-asof" id={`${head}-d`}>{group.asOf}時点の値</span>}
  </> : null;
  return <div className={`brief-env-group is-${group.id}`} role="group" aria-labelledby={`brief-env-${group.id}${group.asOf ? ` ${head}-d` : ''}`}>
    <div className={`brief-env-head${control ? ' has-control' : ''}`}>
      <div className="brief-env-title"><h3 id={`brief-env-${group.id}`} tabIndex={-1}>{group.title}</h3>{control && meta ? <span className="brief-env-meta is-inline">{meta}</span> : <span>{group.question}</span>}</div>
      {control || (meta && <div className="brief-env-meta">{meta}</div>)}
    </div>
    {caveat && <p className="brief-env-caveat">{caveat}</p>}
    {group.unavailable ? <p className="brief-missing">{group.unavailable}</p> : children}
    {group.missing && <p className="brief-missing" data-testid={`brief-missing-${group.id}`}>{group.missing}</p>}
  </div>;
}

/** What the long history's absence leaves judged: only the index checks that themselves were judged. */
function historyScope(judged) {
  if (!judged.length) return '長期集計がないため、市場の参加度とリーダーの健全性も判定していません。';
  const dist = judged.filter(c => c.key.startsWith('dist-')).length, ftd = judged.filter(c => c.key.startsWith('ftd-')).length;
  const scope = dist === 2 && ftd === 2 ? '分配日とFTD' : judged.map(c => c.label).join('・');
  return `長期集計がないため、${scope}だけを判定しています。`;
}

/** Why each unjudged check was not judged: 「ラベル（理由）」 joined by 「／」. */
const unjudgedReasons = reasons => reasons.map(r => `${r.labels.join('・')}（${r.reason}）`).join('／');

/**
 * The warning summary's headline. Only a judged check that can raise a warning (`warnable`: judged and not 参考) can make
 * 「注意 0件」 or 「注意サインなし」 true; a 〔参考〕 sign is counted apart (「・参考 M件」) and never stands in for them.
 *  - warnings fired: 「▲ 注意 N件・参考 M件」, or 「▲ 注意サイン N件」 with no 参考 sign (as before round 2)
 *  - none fired, a warnable check judged: 「注意 0件・参考 M件」, or 「注意サインなし」 with no 参考 sign
 *  - no warnable check judged: 「注意サインを判定できません」, or with a 参考 sign 「注意 判定不可・参考 M件」 (never 0件,
 *    never なし). The count's short form (「注意 N件・参考 M件」) reads like the groups' marks (「▲ 注意 1」「○ 参考 1」) and
 *    keeps the line one line on a 375px phone with its date, so 判定不可 takes the count's place in it.
 */
function signalsHeadline({ warnings, references, warnable }) {
  const more = references > 0 ? `・参考 ${references}件` : '';
  if (warnings > 0) return { mark: true, text: references > 0 ? `注意 ${warnings}件${more}` : `注意サイン ${warnings}件` };
  if (warnable > 0) return { mark: false, text: references > 0 ? `注意 0件${more}` : '注意サインなし' };
  return { mark: false, text: references > 0 ? `注意 判定不可${more}` : '注意サインを判定できません' };
}

/**
 * The warning summary. `inline` (the desktop): every unjudged check and its reason on one line, as
 * before. Below 1024px the summary line names the unjudged checks and only their reasons fold. A check the study
 * tags 〔参考〕 is counted apart with a neutral ○, never a ▲ (signalsHeadline). That the signs do not change the
 * guide is said once, in the guide's own disclosure (exposureRuleText).
 */
function Signals({ signals, inline = true }) {
  const { fired, unjudged, reasons, judged = [], asOf, historyMissing, legend, tagNote } = signals;
  const warnings = signals.warnings ?? fired.length, references = signals.references ?? 0;
  const head = signalsHeadline({ warnings, references, warnable: signals.warnable ?? judged.length });
  const headline = head.mark ? <><span aria-hidden="true">▲</span> {head.text}</> : head.text;
  return <div className={`brief-signals${warnings ? ' is-warn' : ''}`} role="group" aria-label="注意サイン（独自判定）">
    <b>{headline}<small>（{asOf ? `${asOf}時点・` : ''}独自判定）</small></b>
    {fired.length > 0 && <ul>{fired.map(s => <li key={s.key} className={s.reference ? 'is-reference' : undefined}><span aria-hidden="true">{s.reference ? '○' : '▲'}</span><span>{s.text}{s.itemAsOf ? `（${s.itemAsOf}時点）` : ''}{s.tags?.length ? <span className="brief-signal-tag">{s.tags.join('')}</span> : null}</span></li>)}</ul>}
    {/* The study tags' key: on a phone the short 〔参考〕 legend (the full sentence is in the 注記), on the desktop the sentence itself. */}
    {inline ? tagNote && <p className="brief-signals-tags">{tagNote}</p> : legend && <p className="brief-signals-tags">{legend}</p>}
    {historyMissing && <p>{historyScope(judged)}</p>}
    {unjudged.length > 0 && (inline ? <p className="brief-signals-unjudged">判定していない項目 {unjudged.length}件：{unjudgedReasons(reasons)}</p>
      : <Expander id="market-unjudged" className="brief-signals-unjudged" summary={`判定していない項目 ${unjudged.length}件：${unjudged.map(c => c.label).join('・')}`}>
        <p>理由：{reasons.length === 1 ? reasons[0].reason : unjudgedReasons(reasons)}</p>
      </Expander>)}
  </div>;
}

/**
 * The market tab's sections on a phone: the three groups and the long history, one at a time. A tab's
 * marks sit on a line of their own under its label, so a label never runs into its neighbour's on a
 * 320px phone; when any tab has a mark, every tab keeps that line, so the labels stay level.
 */
function SectionTabs({ panels, active, onSelect }) {
  const refs = useRef({});
  const move = (event, at) => {
    const keys = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: panels.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    const next = panels[(keys[event.key] + panels.length) % panels.length];
    onSelect(next.id);
    refs.current[next.id]?.focus();
  };
  const marked = panels.some(panel => panel.fired > 0 || panel.unknown);
  return <div className="brief-switch" role="tablist" aria-label="市場タブの表示">
    {panels.map((panel, at) => <button key={panel.id} ref={node => { refs.current[panel.id] = node; }} type="button" role="tab" id={`brief-tab-${panel.id}`} aria-selected={active === panel.id} aria-controls={`brief-panel-${panel.id}`}
      tabIndex={active === panel.id ? 0 : -1} onClick={() => onSelect(panel.id)} onKeyDown={event => move(event, at)}>
      <span className="brief-switch-label">{panel.label}</span>
      {marked && <span className="brief-switch-marks">{panel.fired > 0 && <span className="brief-switch-flag"><span aria-hidden="true">▲</span><span className="sr-only">注意</span>{panel.fired}</span>}
        {panel.unknown && <span className="brief-switch-gap"><span aria-hidden="true">?</span><span className="sr-only">{panel.unknown}</span></span>}</span>}
    </button>)}
  </div>;
}

/**
 * The market tab's 地合い card: the verdict, the warning summary and the evidence in three groups whose rows open to
 * their rule and one-year line (view model: marketCardView, with the tab's study parts). Every value shows a number (an
 * older one only with its own date) or the precise reason it has none. It lives in this lazily loaded chunk with
 * everything only the tab draws, so Today's card (MarketCard.jsx) carries none of it.
 * `study` (reference/marketTabStudy.js: the warning summary's tags, the 分配日 detail, the Nasdaq note and position, the
 * judge side's cause under the basis and two notes) and `studyBlock`, the 「過去の傾向」 fold (at the end of the 指数 panel
 * on a phone, across the card on the desktop).
 */
export function MarketDetailCard({ market, marketLoading = false, trends, date, onOpenMetric, switcher = false, section = null, onSection, history = null, historyUnknown = null, study = null, studyBlock = null }) {
  const view = marketCardView({ market, marketLoading, trends, date, study, tab: marketTabParts });
  const { status, verdict, dating, signals, conflict, groups, chart } = view;
  const chartStatus = chartStatusOf(view, status);
  // The 指数 panel's S&P／Nasdaq switch (only with the Nasdaq's published closes): one index at a time, its figures, its
  // chart and its marks; the switch replaces what the panel shows and never adds an index's block beside the other.
  const [indexKey, setIndexKey] = useSessionState('market-index', 'spx');
  const shown = view.series ? view.series.find(entry => entry.key === indexKey) || view.series[0] : null;
  const summary = shown ? shown.summary : view.summary;
  // On a phone the switch sits beside the 指数 group's heading, in the slot of its marks and date (Group's `control`), and
  // its pressed button names the series, so the chart's legend and the figures' first label drop the index's name
  // (`named` false): the switch replaces content and adds no row. On the desktop it sits above the figures, which keep
  // their names. A phone's short label is read out whole.
  const indexSwitch = view.series ? <div className="brief-index-switch" role="group" aria-label="表示する指数">{view.series.map(entry => <button key={entry.key} type="button" aria-pressed={shown.key === entry.key}
    aria-label={switcher ? entry.spoken : undefined} onClick={() => setIndexKey(entry.key)}>{switcher ? entry.short : entry.name}</button>)}</div> : null;
  const named = !(switcher && indexSwitch);
  const chartEl = shown && shown.key !== 'spx'
    ? <IndexChart closes={shown.closes} name={shown.name} distribution={shown.distribution} distributionEnd={shown.distributionEnd} followThrough={shown.followThrough} status={chartStatus} legendName={named} />
    : <IndexChart closes={chart.sp500} distribution={chart.distribution} distributionEnd={chart.distributionEnd} followThrough={chart.followThrough} status={chartStatus} legendName={named} />;
  // Phone (switcher): a sticky row of section tabs under the verdict shows one group, or the long
  // history passed in as `history`, at a time; each tab carries its group's ▲ count, and a neutral 「?」
  // when the section holds a value or check that is not confirmed (`historyUnknown`: the long history's
  // own state, from MarketScreen). Desktop keeps the three groups side by side and the history below.
  const panels = switcher ? [...groups.map(group => ({ id: group.id, label: group.short, fired: group.fired, unknown: group.unknown ? '未確認あり' : null })),
    ...(history ? [{ id: 'history', label: '推移', fired: 0, unknown: historyUnknown }] : [])] : [];
  const active = panels.some(panel => panel.id === section) ? section : panels[0]?.id;
  const tabsRef = useRef(null), pending = useRef(false);
  const select = id => {
    if (id === active) return;
    // A switch made while the tabs are stuck under the bar brings the new section's top under them.
    const box = tabsRef.current?.getBoundingClientRect(), bar = document.querySelector('.brief-bar')?.getBoundingClientRect();
    pending.current = Boolean(box && bar && box.top <= bar.bottom + 1);
    onSection?.(id);
  };
  useLayoutEffect(() => {
    if (!pending.current || !tabsRef.current) return;
    pending.current = false;
    // While stuck the tabs report the bar's edge, so the scroll is taken from what follows them.
    const tabs = tabsRef.current, after = tabs.nextElementSibling, bar = document.querySelector('.brief-bar')?.getBoundingClientRect();
    if (!after) return;
    const top = after.getBoundingClientRect().top + window.scrollY - (bar?.bottom || 0) - tabs.offsetHeight;
    window.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  }, [active]);
  const panel = (id, child) => switcher ? <div key={id} role="tabpanel" id={`brief-panel-${id}`} aria-labelledby={`brief-tab-${id}`} className="brief-panel" hidden={active !== id}>{child}</div> : child;
  const notes = [
    switcher ? dating.lagDetail : null,
    view.summary && !conflict ? 'S&P 500の終値・1年高値からの位置・50日線比・200日線比は、長期履歴の^GSPC終値から計算しています。' : null,
    view.series ? study?.nasdaqSource : null,
    // Closes the reader withdrew (readMarketTrends' closes_error): why there is no S&P／Nasdaq switch.
    !view.series && view.nasdaqClosesError ? 'Nasdaq総合の終値は形式を確認できないため、指数の切替を表示しません。' : null,
    '各行を開くと、その値の基準（しきい値）と直近1年の推移を表示します。',
    `参加度・リーダーの値は、${SURVIVORSHIP_NOTE}です。`,
    // Whom TT達成数 counts, only beside a TT達成数 row that shows a value (said once, here).
    view.ttShown ? study?.ttPopulation : null,
    signals?.tagNote ? `注意サインの印：${signals.tagNote}` : null,
    // The S&P's own reason (the long history's ^GSPC closes), whichever index the switch shows.
    view.summary && !finite(view.summary.vs200) ? '200日線比は、長期履歴に200日分の終値がないため未算出です。' : null,
  ];
  // The Nasdaq's published position: in place on the desktop, inside 過去の傾向 on a phone (the screen's budget). With the
  // S&P／Nasdaq switch, it is the Nasdaq's own figures in the panel instead.
  const nas = switcher || view.series ? null : view.nasdaqFigures;
  // The judge side's cause (or the FTD upgrade's disclosure): one line after the verdict's basis.
  const cause = verdict.cause ? <p className="brief-verdict-why brief-verdict-cause">{verdict.cause}</p> : null;

  return <section className="brief-card brief-market is-detail in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
    {/* On a phone a lag is said in the stamp slot (the rest is in the 注記); the desktop keeps the full line. */}
    <div className="brief-step"><h2 id="brief-market-title">地合い</h2>{dating.stamp ? <span className="brief-stamp numeric"><span aria-hidden="true">◷</span> {dating.stamp}</span>
      : switcher && dating.lagStamp ? <span className="brief-stamp numeric is-older brief-lagstamp" role="note"><span aria-hidden="true">◷</span> {dating.lagStamp}</span> : null}</div>
    {dating.lagNote && !switcher && <p className="brief-note brief-asof brief-lag" role="note">{dating.lagNote}</p>}
    <div className="brief-lead">
      <div className={`brief-verdict is-lead tone-${verdict.tone}`} data-testid="brief-regime" aria-busy={verdict.pending || undefined}>
        <div className="brief-verdict-head"><VerdictMark verdict={verdict} /><div><strong><Label text={verdict.label} /></strong>{verdict.date && <span className="brief-verdict-date numeric">{verdict.date}</span>}<p>{verdict.lead}</p></div></div>
        {/* On a narrow phone the label breaks before の目安, never leaving 「安」 alone. */}
        {verdict.exposure !== null && <div className="brief-exposure"><small><span className="brief-frag">エクスポージャー</span><span className="brief-frag">の目安</span></small><b className="numeric">{verdict.exposure > 0 ? `最大 ${verdict.exposure}%` : '0%'}</b><span className="brief-exposure-track" aria-hidden="true"><i style={{ width: `${verdict.exposure}%` }} /></span></div>}
        {/* 目安と判定の基準, in the same order on both: the verdict's basis, while the verdict is positive the Nasdaq's
            own state, then how the guide is set (from MARKET_CAPS). One fold under the meter on a phone, whose summary
            names the fold and, when it applies, the Nasdaq note's short form; in place on the desktop. */}
        {switcher && (verdict.exposure !== null || verdict.basis)
          ? <Expander id="market-exposure-rule" className="brief-exposure-basis" summary={verdict.nasdaq ? <Parts text={`目安と判定の基準・${verdict.nasdaq.short}`} /> : '目安と判定の基準'}>
            {verdict.basis && <p className="brief-verdict-why">{verdict.basis.text}</p>}
            {cause}
            {verdict.nasdaq && <p>{verdict.nasdaq.long}</p>}
            {verdict.exposure !== null && <p>{exposureRuleText()}</p>}
          </Expander>
          : <>
            {verdict.basis && <p className="brief-verdict-why">{verdict.basis.text}</p>}
            {cause}
            {verdict.nasdaq && <p className="brief-exposure-nasdaq">{verdict.nasdaq.long}</p>}
            {verdict.exposure !== null && <p className="brief-exposure-basis">{exposureRuleText()}</p>}
          </>}
      </div>
      {signals && <Signals signals={signals} inline={!switcher} />}
    </div>
    <StatusAlert view={view} trends={trends} detail />
    {switcher && panels.length > 0 && <div ref={tabsRef} className="brief-switchbar"><SectionTabs panels={panels} active={active} onSelect={select} /></div>}
    <div className="brief-env-groups">
      {groups.map(group => panel(group.id, <Group key={group.id} group={group} caveat={!switcher && (group.id === 'breadth' || group.id === 'leaders') ? SURVIVORSHIP_NOTE : null} control={group.id === 'index' && switcher ? indexSwitch : null}>
        {group.id === 'index' && <div className="brief-index-block">
          {!switcher && indexSwitch}
          {summary && <div className="brief-index-stats" role="group" aria-label={shown && shown.key !== 'spx' ? `${shown.name}（^IXICの日足、${shortDate(summary.date, date)}）` : `S&P 500（長期履歴の^GSPC終値、${shortDate(summary.date, date)}）`}>
            {/* With a phone's switch its pressed button names the index (the group's label keeps the full name): the cell reads 終値. */}
            {named ? <div><small>{shown ? shown.name : 'S&P 500'}</small><b className="numeric">{num(summary.close, 2)}</b><span>{shortDate(summary.date, date)}終値</span></div>
              : <div><small>終値</small><b className="numeric">{num(summary.close, 2)}</b><span>{shortDate(summary.date, date)}</span></div>}
            {/* A distance without its window is a dash, read out as 未算出 (the published Nasdaq position never had one), never 0. */}
            <div><small>{summary.fullYear ? '1年高値から' : '期間内高値から'}</small>{finite(summary.fromHigh) ? <b className="numeric">{signedPercent(summary.fromHigh)}</b> : <><b className="numeric" aria-hidden="true">—</b><span className="sr-only">未算出</span></>}</div>
            {/* The 200-day distance is the cell's second line, so the row keeps its height. */}
            {/* Without 200 closes a dash keeps the cell as narrow as a value (the row never wraps); the words are read
                out and the reason is in the 注記 and in 過去の傾向. */}
            <div className="is-ma"><small>50日線比</small>{finite(summary.vsMa) ? <b className="numeric">{signedPercent(summary.vsMa)}</b> : <><b className="numeric" aria-hidden="true">—</b><span className="sr-only">未算出</span></>}{finite(summary.vs200) ? <span>200日線比 {signedPercent(summary.vs200)}</span>
              : <><span aria-hidden="true">200日線比 —</span><span className="sr-only">200日線比 未算出（200日分の終値なし）</span></>}</div>
          </div>}
          {/* The Nasdaq's position, only from a publication whose exporter recorded it (older ones never did). */}
          {nas && <p className="brief-index-nas"><b>Nasdaq総合</b><span className="numeric">{nas.close}</span><Parts text={nas.text} /></p>}
          {/* A disagreement with the verdict's scan input is always said here (the S&P's figures); the plain source line is in
              place on the desktop and in the 注記 below 1024px. */}
          {shown && shown.key !== 'spx' ? !switcher && study?.nasdaqSource && <p className="brief-index-source"><span>{study.nasdaqSource}</span></p>
            : summary && (conflict || !switcher) && <p className={`brief-index-source${conflict ? ' is-conflict' : ''}`}>{conflict || <span>4つの数値（終値・1年高値から・50日線比・200日線比）は長期履歴の^GSPC終値から計算しています。</span>}</p>}
          {chartEl}
        </div>}
        <div className="brief-env-rows">{group.items.map(item => <EnvRow key={item.key} item={item} groupAsOf={group.asOf} onOpenMetric={view.history ? onOpenMetric : null} />)}</div>
        {group.id === 'index' && switcher && studyBlock}
      </Group>))}
    </div>
    {/* On the desktop 「過去の傾向」 spans the card under the three columns, open. */}
    {!switcher && studyBlock}
    {switcher && history && panel('history', history)}
    {/* TT達成数 is the row's own name; the line keeps three lines at 375px in a full-width (CJK) font. */}
    <p className="brief-note">分配日・フォロースルーデー・ステージ・TT達成数・RS推計は公開日足からの独自集計で、IBDの公式値ではありません。注意サインの基準も独自判定です。</p>
    <ScreenNotes id="market" wide={!switcher} notes={notes} />
  </section>;
}

/**
 * 「過去の傾向」: one fold at the end of the 指数 panel on a phone, and on the desktop open across the card under its three
 * columns. Its summary is one line on what the lines say (how many states had more or fewer declines than their
 * comparator), wrapping only between its 「・」 parts. Inside: one line per index state with the study's share for that
 * state, its comparator (and, for a confirmed state, which way it differs), its tags and its own date; then a nested
 * 「読み方と出典」 fold with the key to the tags shown and what the numbers are not (open on the desktop). A comparator and
 * each tag stay whole on a line. On a phone without the S&P／Nasdaq switch, the Nasdaq's published position (`nasdaq`,
 * nasdaqFigures) is the first line of its block. Never in the verdict or the warning summary.
 */
export function RegimeContext({ context, wide, nasdaq = null }) {
  return <Expander id={`market-regime-ref${wide ? '-wide' : ''}`} className="brief-regime-ref" summary={<Parts text={context.summary} />} defaultOpen={wide}>
    {!context.available ? <p className="brief-regime-foot">{context.reason}</p> : <>
      <div className="brief-regime-indices">{context.indices.map(block => <div key={block.symbol} className="brief-regime-index">
        <h4>{block.name}</h4>
        {!wide && block.symbol === '^IXIC' && nasdaq && <p className="brief-regime-nas"><span className="numeric">{nasdaq.close}</span><Parts text={nasdaq.text} /></p>}
        <ul>{block.items.map(item => <li key={item.indicator} className={item.reason ? 'is-reason' : undefined}>{item.parts
          ? <>{item.parts.body}{item.parts.comparator && <span className="brief-regime-keep">{item.parts.comparator}</span>}{item.parts.tags.map(tag => <span key={tag} className="brief-regime-keep">{tag}</span>)}</>
          : item.text}</li>)}</ul>
      </div>)}</div>
      <Expander id={`market-regime-howto${wide ? '-wide' : ''}`} className="brief-regime-howto" summary={<>読み方と出典<small>（予測ではありません）</small></>} defaultOpen={wide}>
        {context.key && <p className="brief-regime-key">{context.key.split(/(〔[^〕]+〕)/).map((part, i) => i % 2 ? <span key={i} className="brief-regime-keep">{part}</span> : part)}</p>}
        <p className="brief-regime-foot">{context.footer}</p>
      </Expander>
    </>}
  </Expander>;
}

/**
 * The market tab: the verdict, the warning summary and today's evidence (MarketDetailCard), then the
 * long-run series and the sector ETF ranks. A row's 「市場環境の推移で見る」 opens its metric in the
 * long-run chart. Every block keeps its own as-of date; nothing older is shown as today's.
 * Below 1024px the evidence groups and the long history are sections of the 地合い card, one at a time
 * behind a sticky row of tabs (kept for the session); the desktop shows them all.
 */
export default function MarketScreen({ brief }) {
  const trends = brief.trends;
  const history = trends?.data?.long_history || null, status = trendsStatus(trends);
  const wide = useMediaQuery('(min-width:1024px)');
  // The study parts of the 地合い card (tags, 分配日 detail, Nasdaq note and position, 過去の傾向, the judge side's cause), from this chunk.
  const manifest = brief.manifest?.data ?? null;
  const study = useMemo(() => marketTabStudy({ trends, reference: REFERENCE, date: brief.date, market: brief.market, manifest }), [trends, brief.date, brief.market, manifest]);
  const [section, setSection] = useSessionState('market-section', 'index');
  const [request, setRequest] = useState(null);
  const openMetric = useCallback(metric => { setSection('history'); setRequest(previous => ({ metric, seq: (previous?.seq || 0) + 1 })); }, [setSection]);
  // After the chart has the asked metric, bring its heading into view and move focus there.
  useEffect(() => { if (request) jumpTo(EXPLORER_TITLE); }, [request]);
  // Same failure kinds as the 地合い card: a fetch failure is never called an integrity failure.
  const failure = status.state !== 'error' ? null : status.kind === 'fetch' ? `長期履歴を取得できません（${bare(status.reason)}）。`
    : status.kind === 'reader' ? `長期履歴を表示できません（${bare(status.reason)}）。` : '長期履歴の整合性を確認できません。';
  const takeaway = status.state === 'ready' ? historyTakeaway(history, brief.date) : null;
  // With the Nasdaq's closes the 指数 panel switches between the indices and shows the Nasdaq's figures itself.
  const nasdaqSwitch = status.state === 'ready' && Boolean(indexCloses((trends.data.indices || []).find(item => item?.symbol === '^IXIC')));
  const historyError = !history && typeof trends?.data?.long_history_error === 'string';
  // The 推移 tab's 「?」 on a phone: no long history to show, or one that is not the latest session's.
  const update = status.state === 'ready' && history ? marketUpdateState(trends.data).state : null;
  const historyUnknown = status.state === 'loading' || update === 'current' ? null : update === 'pending' ? '更新待ち' : '未確認';
  const historySection = <section className={wide ? 'brief-card brief-history in' : 'brief-history is-section'} style={wide ? { '--i': 2 } : undefined} aria-labelledby="brief-history-title">
    <div className="brief-step"><h2 id="brief-history-title" tabIndex={-1}>市場環境の推移</h2></div>
    {status.state === 'loading' ? <p className="brief-note" role="status">長期履歴を読み込み中…</p>
      : failure ? <p className="brief-alert" role="alert">{failure}</p>
        : <>
          {takeaway && <p className="brief-takeaway">{takeaway}</p>}
          <MarketUpdateStatus data={trends?.data} />
          <div className="brief-history-grid">
            <div className="brief-history-main">
              {historyError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(trends.data.long_history_error)}</p>
                // The long-run chart is the heaviest part of the tab: it mounts once it nears the screen, when the
                // page is idle, or at once when a row asks for it.
                : <WhenNear force={Boolean(request)} idle minHeight={640}><HistoricalBreadth history={history} request={request} showSplit={false} id={EXPLORER_TITLE} /></WhenNear>}
            </div>
            <MarketSectors history={history} date={brief.date} />
          </div>
        </>}
  </section>;
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date ? `${barDay(brief.date)}引け・米国株` : '日付未確認'}</small><h1>市場</h1></header>
    <MarketDetailCard market={brief.market} marketLoading={brief.marketLoading} trends={trends} date={brief.date} onOpenMetric={openMetric}
      switcher={!wide} section={section} onSection={setSection} history={wide ? null : historySection} historyUnknown={historyUnknown}
      study={study}
      studyBlock={<RegimeContext context={study.regime} wide={wide} nasdaq={study.nasdaqPosition?.state && !nasdaqSwitch ? study.nasdaqFigures : null} />} />
    {wide && historySection}
  </>;
}
