import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { sentence, shortDate, trendsAlert } from './briefModel';
import { jumpTo } from './jump';
import { marketCardView, num, signedPercent } from './marketTabModel';

const finite = Number.isFinite;

function IndexChart({ sp500, distribution, distributionEnd, status, detail }) {
  const points = (sp500 || []).filter(p => finite(p.close)).slice(-130);
  if (points.length < 60) return <p className="brief-note">{status === 'loading' ? '指数の履歴を読み込み中…' : status === 'error' ? '指数の履歴は整合性を確認できないため表示しません。' : status === 'fetch-error' ? '指数の履歴は取得できないため表示しません。' : status === 'history-error' ? '指数の履歴は長期集計の整合性を確認できないため表示しません。' : sp500?.length ? '指数の履歴が60営業日に満たないため表示しません。' : '指数の履歴は公開データに含まれていません。'}</p>;
  const all = (sp500 || []).filter(p => finite(p.close)), offset = all.length - points.length;
  const ma = points.map((_, i) => { const at = offset + i; if (at < 49) return null; let s = 0; for (let j = at - 49; j <= at; j++) s += all[j].close; return s / 50; });
  const values = [...points.map(p => p.close), ...ma.filter(finite)], lo = Math.min(...values), hi = Math.max(...values);
  const W = 600, H = 132, x = i => 4 + i * (W - 8) / (points.length - 1), y = v => 18 + (hi - v) * (H - 30) / (hi - lo || 1);
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.close).toFixed(1)}`).join('');
  const line50 = ma.map((v, i) => v == null ? '' : `${ma[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const active = new Set((distribution?.events || []).filter(e => e.state === 'active').map(e => e.date));
  const marks = points.map((p, i) => active.has(p.date) ? i : -1).filter(i => i >= 0);
  // The ▲ marks come from the index series, which can end on another session than the closes.
  const chartEnd = points.at(-1).date;
  return <>
    <svg className={`brief-index${detail ? ' is-detail' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`S&P 500 の終値と50日線（${points[0].date}〜${chartEnd}）。有効な分配日 ${marks.length}日`}>
      <path d={line50} className="brief-index-ma" />
      <path d={line} className="brief-index-line" />
      {marks.map((i, k) => <path key={i} d={`M${x(i) - 5},${y(points[i].close) + 14}h10l-5,-8z`} className="brief-index-dist" style={{ '--i': k }} />)}
    </svg>
    <p className="brief-index-legend" aria-hidden="true"><span className="is-close">S&amp;P 500 終値（{detail ? `${shortDate(points[0].date, chartEnd)}〜${shortDate(chartEnd, chartEnd)}` : '半年'}）</span><span className="is-ma">50日線</span><span className="is-dist">▲ 分配日{detail && distributionEnd && distributionEnd !== chartEnd ? `（${shortDate(distributionEnd, chartEnd)}まで）` : ''}</span></p>
  </>;
}

const AsOf = ({ value }) => value ? <span className="brief-fact-asof">（{value}時点）</span> : null;
// On a phone an explanation wraps only between its 「・」 parts, and a label keeps its （…） together.
const Parts = ({ text }) => { const parts = String(text).split('・'); return parts.map((part, i) => <span key={i} className="brief-frag">{part}{i < parts.length - 1 ? '・' : ''}</span>); };
const Label = ({ text }) => { const at = text.indexOf('（'); return at > 0 ? <>{text.slice(0, at)}<span className="brief-frag">{text.slice(at)}</span></> : text; };
// A warning is never colour alone: the ▲ and the word travel with the amber value.
const WarnMark = () => <span className="brief-warnmark"><span aria-hidden="true">▲</span><span className="sr-only">注意 </span></span>;

/** Today's tile: a pair names each side (S&P / NAS, 高 / 安) and marks the side that fired. */
const Fact = ({ fact }) => <div className={`brief-fact${fact.warn ? ' is-warn' : ''}`}>
  <small><Label text={fact.label} /></small>
  {fact.pairs ? <b className="brief-pairs">{fact.pairs.map(pair => <span key={pair.name} className={`brief-pair${pair.warn ? ' is-warn' : ''}`}><span className="brief-pair-name">{pair.name}</span>{pair.warn && <WarnMark />}{pair.value}</span>)}<AsOf value={fact.asOf} /></b>
    : <b className={fact.warn ? 'is-warn' : ''}>{fact.warn && <WarnMark />}{fact.b}<AsOf value={fact.asOf} /></b>}
  {fact.em ? <em className={fact.warn ? 'is-warn' : ''}><Parts text={fact.em} /></em> : null}
</div>;

// ---- market tab: rows that open to their rule, one-year line and long-history link ----------------

/** A path through the values, broken where a session has none (an unknown is never drawn as 0). */
function seriesPath(series, lo, hi, W, H, pad) {
  const n = series.length, x = i => n > 1 ? i * W / (n - 1) : W / 2, y = v => pad + (hi - v) * (H - 2 * pad) / (hi - lo);
  let pen = 'M';
  return series.map((v, i) => { if (v === null) { pen = 'M'; return ''; } const step = `${pen}${x(i).toFixed(1)},${y(v).toFixed(1)}`; pen = 'L'; return step; }).join('');
}

/** The row's last year at a glance (its own scale; the opened row shows that scale in words). */
const Spark = ({ range }) => <svg className="brief-env-spark" viewBox="0 0 64 20" preserveAspectRatio="none" aria-hidden="true" focusable="false"><path d={seriesPath(range.series, range.lo, range.hi, 64, 20, 2)} /></svg>;

/** The value's last 252 sessions on its own labelled scale; mounted only when its row is opened. */
function YearLine({ label, range, format }) {
  const lastValue = [...range.series].reverse().find(v => v !== null);
  return <div className="brief-yearline">
    <svg viewBox="0 0 300 56" preserveAspectRatio="none" role="img" aria-label={`${label}の直近1年の推移。最低 ${format(range.lo)}、最高 ${format(range.hi)}、最新 ${format(lastValue)}`}><path d={seriesPath(range.series, range.lo, range.hi, 300, 56, 4)} /></svg>
    <p aria-hidden="true"><span>1年の最低 {format(range.lo)}</span><span>最高 {format(range.hi)}</span></p>
  </div>;
}

function PairLines({ item, groupAsOf }) {
  return <span className="brief-env-pairs">{item.rows.map(row => <span key={row.name} className="brief-ftd-row">
    <span className="brief-ftd-index">{row.name}</span>
    <b className={row.warn ? 'is-warn' : ''}>{row.b}{row.asOf && row.asOf !== groupAsOf ? <span className="brief-fact-asof">（{row.asOf}時点）</span> : null}</b>
    {row.em ? <em><Parts text={row.em} /></em> : null}
    {row.flag ? <span className="brief-flag"><span aria-hidden="true">▲</span><span className="sr-only">注意：</span>{row.flag}</span> : null}
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
  const details = [item.detail, pair ? item.note : null].filter(Boolean);
  return <div className={`brief-fact brief-env-row${item.className ? ` ${item.className}` : ''}${item.warn ? ' is-warn' : ''}${pair ? ' is-pair' : ''}`}>
    <button type="button" className="brief-env-toggle" aria-expanded={open} aria-controls={`${id}-d`} onClick={() => setOpen(value => !value)}>
      <span className="brief-env-status">{item.warn ? <><span aria-hidden="true">▲</span><span>注意</span></> : null}</span>
      <small><Label text={item.label} /></small>
      {pair ? <PairLines item={item} groupAsOf={groupAsOf} />
        : <>
          <b className={item.warn ? 'is-warn' : ''}>{item.b}<AsOf value={rowAsOf} /></b>
          {note ? <em><Parts text={note} /></em> : null}
          {item.flag ? <span className="brief-flag"><span className="sr-only">注意：</span>{item.flag}</span> : null}
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
        <p className="brief-env-rule"><b>基準</b>{item.rule}</p>
        {item.metric && onOpenMetric && <button type="button" className="brief-env-open" onClick={() => onOpenMetric(item.metric)}>市場環境の推移で見る <span aria-hidden="true">›</span></button>}
      </>}
    </div>
  </div>;
}

function Group({ group, children }) {
  const head = useId();
  return <div className={`brief-env-group is-${group.id}`} role="group" aria-labelledby={`brief-env-${group.id}${group.asOf ? ` ${head}-d` : ''}`}>
    <div className="brief-env-head">
      <div className="brief-env-title"><h3 id={`brief-env-${group.id}`} tabIndex={-1}>{group.title}</h3><span>{group.question}</span></div>
      {(group.fired > 0 || group.asOf) && <div className="brief-env-meta">
        {group.fired > 0 && <span className="brief-env-state"><span aria-hidden="true">▲</span> 注意 {group.fired}</span>}
        {group.asOf && <span className="brief-env-asof" id={`${head}-d`}>{group.asOf}時点の値</span>}
      </div>}
    </div>
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

function Signals({ signals, exposure }) {
  const { fired, unjudged, reasons, judged = [], asOf, historyMissing } = signals;
  // 「なし」 only when at least one check was judged: nothing judged is 判定できません, never an all-clear.
  const headline = fired.length ? <><span aria-hidden="true">▲</span> 注意サイン {fired.length}件</> : judged.length ? '注意サインなし' : '注意サインを判定できません';
  return <div className={`brief-signals${fired.length ? ' is-warn' : ''}`} role="group" aria-label="注意サイン（独自判定）">
    <b>{headline}<small>（{asOf ? `${asOf}時点・` : ''}独自判定）</small></b>
    {fired.length > 0 && <ul>{fired.map(s => <li key={s.key}><span aria-hidden="true">▲</span><span>{s.text}{s.itemAsOf ? `（${s.itemAsOf}時点）` : ''}</span></li>)}</ul>}
    {historyMissing && <p>{historyScope(judged)}</p>}
    {unjudged.length > 0 && <p className="brief-signals-unjudged">判定していない項目 {unjudged.length}件：{reasons.map(r => `${r.labels.join('・')}（${r.reason}）`).join('／')}</p>}
    {fired.length > 0 && exposure > 0 && <p>注意サインは判定とは別の確認項目で、エクスポージャーの目安は変えません。</p>}
  </div>;
}

/**
 * 地合い: the verdict, the index chart and the market-environment values (view model: marketCardView).
 * Every value shows a number (an older one only with its own date) or the precise reason it has none.
 * Today (compact) keeps four tiles; the market tab (detail) leads with the verdict and the warning
 * summary, then the evidence in three groups whose rows open to their rule and one-year line.
 */
export default function MarketCard({ market, marketLoading = false, trends, date, detail = false, onOpenMetric }) {
  const view = marketCardView({ market, marketLoading, trends, date });
  const { status, verdict, dating, signals, summary, conflict, groups, chart } = view;
  const chartStatus = view.longError ? 'history-error' : status.state === 'error' && status.kind === 'fetch' ? 'fetch-error' : status.state;
  const verdictMark = <span className="brief-verdict-mark" aria-hidden="true">{verdict.pending ? '…' : verdict.tone === 'zone' ? '●' : verdict.tone === 'ext' ? '▲' : verdict.tone === 'neg' ? '⊘' : '?'}</span>;
  const statusAlert = status.state === 'loading' ? <p className="brief-note" role="status">市場推移を読み込み中…</p>
    : status.state === 'error' ? <p className="brief-alert" role="alert" data-failure={status.kind}>{trendsAlert(status)}数値は表示しません。</p>
      : status.state === 'none' ? <p className="brief-note">市場推移データはこの公開に含まれていません。</p>
        : view.longError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(view.longError)}{detail ? '分配日・フォロースルーデー' : '分配日'}は指数データから表示しています。</p> : null;
  const chartEl = <IndexChart sp500={chart.sp500} distribution={chart.distribution} distributionEnd={chart.distributionEnd} status={chartStatus} detail={detail} />;

  if (!detail) {
    return <section className="brief-card brief-market in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">1</span><h2 id="brief-market-title">地合い</h2><Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link></div>
      <div className={`brief-verdict tone-${verdict.tone}`} data-testid="brief-regime" aria-busy={verdict.pending || undefined}>{verdictMark}<div><strong>{verdict.label}</strong><p>{verdict.text}</p></div></div>
      {chartEl}
      {statusAlert}
      <div className="brief-facts">{view.today.map(fact => <Fact key={fact.key} fact={fact} />)}</div>
      {view.distReasons.length > 0 && <ul className="brief-factnotes">{view.distReasons.map(text => <li key={text}>{text}</li>)}</ul>}
      {dating.todayNote && <p className="brief-note brief-asof" role="note">{dating.todayNote}</p>}
      {view.warnings.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{view.warnings.map(w => <li key={w.key}><span aria-hidden="true">▲</span> {w.text}（独自判定）</li>)}</ul>}
      {view.split?.warning && <p className="brief-alert" role="note">▲ {view.split.fromHigh > -0.05 ? '指数は1年高値の水準にありますが' : `指数は1年高値まであと${Math.abs(view.split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{num(view.split.above200Percent, 1)}%。指数と個別株が乖離しています（独自判定）。</p>}
      {/* The phone's Today hides the verdict, so the card itself still says the judgement is the app's own. */}
      <p className="brief-note">地合いの判定と各集計は公開日足からの独自判定・独自集計で、IBDの公式値ではありません。</p>
    </section>;
  }

  return <section className="brief-card brief-market is-detail in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
    <div className="brief-step"><h2 id="brief-market-title">地合い</h2>{dating.stamp && <span className="brief-stamp numeric"><span aria-hidden="true">◷</span> {dating.stamp}</span>}</div>
    {dating.lagNote && <p className="brief-note brief-asof brief-lag" role="note">{dating.lagNote}</p>}
    <div className="brief-lead">
      <div className={`brief-verdict is-lead tone-${verdict.tone}`} data-testid="brief-regime" aria-busy={verdict.pending || undefined}>
        <div className="brief-verdict-head">{verdictMark}<div><strong>{verdict.label}</strong>{verdict.date && <span className="brief-verdict-date numeric">{verdict.date}</span>}<p>{verdict.lead}</p></div></div>
        {verdict.exposure !== null && <div className="brief-exposure"><small>エクスポージャーの目安</small><b className="numeric">{verdict.exposure > 0 ? `最大 ${verdict.exposure}%` : '0%'}</b><span className="brief-exposure-track" aria-hidden="true"><i style={{ width: `${verdict.exposure}%` }} /></span></div>}
        {verdict.basis && <p className="brief-verdict-why">{verdict.basis.text}</p>}
      </div>
      {signals && <Signals signals={signals} exposure={verdict.exposure} />}
    </div>
    {/* Phone: one tap to each group and to the long history. */}
    <nav className="brief-jump" aria-label="市場タブ内の移動">
      {groups.map(group => <button key={group.id} type="button" onClick={() => jumpTo(`brief-env-${group.id}`)}>{group.short}</button>)}
      <button type="button" onClick={() => jumpTo('brief-history-title')}>推移</button>
    </nav>
    {statusAlert}
    <div className="brief-env-groups">
      {groups.map(group => <Group key={group.id} group={group}>
        {group.id === 'index' && <div className="brief-index-block">
          {summary && <div className="brief-index-stats" role="group" aria-label={`S&P 500（長期履歴の^GSPC終値、${shortDate(summary.date, date)}）`}>
            <div><small>S&amp;P 500</small><b className="numeric">{num(summary.close, 2)}</b><span>{shortDate(summary.date, date)}終値</span></div>
            <div><small>{summary.fullYear ? '1年高値から' : '期間内高値から'}</small><b className="numeric">{signedPercent(summary.fromHigh)}</b></div>
            <div><small>50日線比</small><b className="numeric">{signedPercent(summary.vsMa)}</b></div>
          </div>}
          {summary && <p className={`brief-index-source${conflict ? ' is-conflict' : ''}`}>{conflict || '3つの数値は長期履歴の^GSPC終値から計算しています。'}</p>}
          {chartEl}
        </div>}
        <div className="brief-env-rows">{group.items.map(item => <EnvRow key={item.key} item={item} groupAsOf={group.asOf} onOpenMetric={view.history ? onOpenMetric : null} />)}</div>
      </Group>)}
    </div>
    <p className="brief-note">分配日・フォロースルーデー・ステージ・トレンドテンプレート数・RSは公開日足からの独自集計で、IBDの公式値ではありません。注意サインの基準もこのアプリの独自判定です。</p>
  </section>;
}
