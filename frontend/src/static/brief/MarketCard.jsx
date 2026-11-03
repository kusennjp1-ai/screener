import { useId } from 'react';
import { Link } from 'react-router-dom';
import { bifurcation, environmentPoint, BREAKOUT_MIN_SAMPLE, LEADER_MIN_COHORT } from '../marketLongHistory';
import MetricDisclosure from '../components/MetricDisclosure';
import { distributionCount, environmentWarnings, followThroughView, latestKnown, marketTone, sentence, shortDate, trendsAlert, trendsStatus } from './briefModel';

const finite = Number.isFinite;
// Only ever called with a finite number: a unit is never appended to an unknown value.
const num = (value, digits = 0) => value.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const delta = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('ja-JP')}`;
const signedPercent = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toFixed(1)}%`;
const STAGE_FIELDS = ['stage1Percent', 'stage2Percent', 'stage3Percent', 'stage4Percent'];
// The threshold of the existing distribution warning (the tile turned amber at 5 or more).
const DISTRIBUTION_WARN = 5;

/** Last close, its distance from the 50-day line and from the highest close of the last 252 sessions. */
function indexSummary(sp500) {
  const all = (sp500 || []).filter(p => finite(p.close));
  if (all.length < 60) return null;
  const last = all.at(-1), ma = all.slice(-50).reduce((sum, p) => sum + p.close, 0) / 50, year = all.slice(-252);
  return { date: last.date, close: last.close, vsMa: 100 * (last.close / ma - 1), fromHigh: 100 * (last.close / Math.max(...year.map(p => p.close)) - 1), fullYear: year.length >= 252 };
}

function IndexChart({ sp500, distribution, status, detail }) {
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
  const markEnd = distributionCount(distribution)?.date, chartEnd = points.at(-1).date;
  return <>
    <svg className={`brief-index${detail ? ' is-detail' : ''}`} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`S&P 500 の終値と50日線（${points[0].date}〜${chartEnd}）。有効な分配日 ${marks.length}日`}>
      <path d={line50} className="brief-index-ma" />
      <path d={line} className="brief-index-line" />
      {marks.map((i, k) => <path key={i} d={`M${x(i) - 5},${y(points[i].close) + 14}h10l-5,-8z`} className="brief-index-dist" style={{ '--i': k }} />)}
    </svg>
    <p className="brief-index-legend" aria-hidden="true"><span className="is-close">S&amp;P 500 終値（{detail ? `${shortDate(points[0].date, chartEnd)}〜${shortDate(chartEnd, chartEnd)}` : '半年'}）</span><span className="is-ma">50日線</span><span className="is-dist">▲ 分配日{detail && markEnd && markEnd !== chartEnd ? `（${shortDate(markEnd, chartEnd)}まで）` : ''}</span></p>
  </>;
}

const AsOf = ({ value }) => value ? <span className="brief-fact-asof">（{value}時点）</span> : null;
// On a phone an explanation wraps only between its 「・」 parts, and a label keeps its （…） together.
const Parts = ({ text }) => { const parts = String(text).split('・'); return parts.map((part, i) => <span key={i} className="brief-frag">{part}{i < parts.length - 1 ? '・' : ''}</span>); };
const Label = ({ text }) => { const at = text.indexOf('（'); return at > 0 ? <>{text.slice(0, at)}<span className="brief-frag">{text.slice(at)}</span></> : text; };
// A warning is never colour alone: the ▲ and the word travel with the amber value.
const WarnMark = () => <span className="brief-warnmark"><span aria-hidden="true">▲</span><span className="sr-only">注意 </span></span>;
const Fact = ({ fact }) => <div className={`brief-fact${fact.wide ? ' is-wide' : ''}`}><small><Label text={fact.label} /></small><b className={fact.warn ? 'is-warn' : ''}>{fact.warn && <WarnMark />}{fact.b}<AsOf value={fact.asOf} /></b>{fact.em ? <em><Parts text={fact.em} /></em> : null}</div>;

// ---- market tab (detail): compact rows inside titled groups ------------------------------------

const Flag = ({ text }) => text ? <span className="brief-flag"><span aria-hidden="true">▲</span><span className="sr-only">注意：</span>{text}</span> : null;
/** Where the value sits between the lowest and highest of its last 252 sessions (no threshold: a position only). */
function yearRange(rows, hit, field) {
  if (!hit) return null;
  const values = rows.slice(Math.max(0, hit.index - 251), hit.index + 1).map(row => row[field]).filter(finite);
  if (values.length < 200) return null;
  const lo = Math.min(...values), hi = Math.max(...values);
  return hi > lo ? { lo, hi, at: (hit.value - lo) / (hi - lo) } : null;
}
const Range = ({ range, format }) => range ? <span className="brief-range"><span className="brief-range-track" aria-hidden="true"><i style={{ left: `${(range.at * 100).toFixed(1)}%` }} /></span><span className="brief-range-text">{range.at === 0 ? '1年で最低 · 範囲' : range.at === 1 ? '1年で最高 · 範囲' : '1年の範囲'} {format(range.lo)}〜{format(range.hi)}</span></span> : null;
/** A row's date is shown only when it differs from its group's date. */
const rowAsOf = (value, groupAsOf) => value && value !== groupAsOf ? value : null;
const Row = ({ fact, groupAsOf }) => <div className={`brief-fact brief-env-row${fact.className ? ` ${fact.className}` : ''}`}>
  <small><Label text={fact.label} /></small>
  <b className={fact.warn ? 'is-warn' : ''}>{fact.b}<AsOf value={rowAsOf(fact.asOf, groupAsOf)} /></b>
  {/* A short note and the one-year range share a line when they fit. */}
  {fact.em || fact.range ? <div className="brief-env-sub">{fact.em ? <em><Parts text={fact.em} /></em> : null}{fact.range ? <Range range={fact.range} format={fact.format} /> : null}</div> : null}
  {fact.flag ? <Flag text={fact.flag} /> : null}
  {fact.extra || null}
</div>;
const PairRow = ({ fact, groupAsOf }) => <div className={`brief-fact brief-env-row is-pair${fact.className ? ` ${fact.className}` : ''}`}>
  <small><Label text={fact.label} /></small>
  {fact.rows ? fact.rows.map(row => <div key={row.name} className="brief-ftd-row"><span className="brief-ftd-index">{row.name}</span><b className={row.warn ? 'is-warn' : ''}>{row.b}<AsOf value={rowAsOf(row.asOf, groupAsOf)} /></b>{row.em ? <em><Parts text={row.em} /></em> : null}{row.flag ? <Flag text={row.flag} /> : null}</div>)
    : <><b>{fact.b}</b>{fact.em ? <em><Parts text={fact.em} /></em> : null}</>}
  {fact.rows && fact.note ? <em className="brief-pair-note">{fact.note}</em> : null}
</div>;

/** The one session every valued item of a group describes, when they all agree on an older one. */
function groupDate(items) {
  const valued = items.flatMap(item => item?.rows ? item.rows : [item]).filter(item => item?.valued);
  return valued.length && valued.every(item => item.asOf && item.asOf === valued[0].asOf) ? valued[0].asOf : null;
}

/** Scrolls to a section heading and moves focus there (instantly under reduced motion). */
function jumpTo(id) {
  const target = document.getElementById(id);
  if (!target) return;
  const reduced = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  target.scrollIntoView?.({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
  target.focus?.({ preventScroll: true });
}

function Group({ id, title, asOf, signals, takeaway, missing, children }) {
  const head = useId();
  return <div className={`brief-env-group is-${id}`} role="group" aria-labelledby={`brief-env-${id}${asOf ? ` ${head}-d` : ''}`}>
    <div className="brief-env-head">
      <h3 id={`brief-env-${id}`} tabIndex={-1}>{title}</h3>
      {signals > 0 && <span className="brief-env-state"><span aria-hidden="true">▲</span> 注意 {signals}</span>}
      {asOf && <span className="brief-env-asof" id={`${head}-d`}>{asOf}時点の値</span>}
    </div>
    {takeaway && <p className="brief-takeaway">{takeaway}</p>}
    {children}
    {missing && <p className="brief-missing" data-testid={`brief-missing-${id}`}>{missing}</p>}
  </div>;
}

// The basis of modelMarket's verdict (portfolioPlan.js), in words. Its inputs are the scan's market
// fields (the benchmark against its 50/200-day lines and the backend's regime); nothing is recomputed here.
function verdictBasis(market) {
  const label = market?.label || '';
  if (!market || market.state === 'unknown') return null;
  if (/^上昇トレンド/.test(label)) return 'スキャン時にベンチマーク指数が50日線と200日線の上で、局面判定（分配日・FTDなど）が「上昇トレンド」。';
  if (/^上昇に圧力/.test(label)) return 'スキャン時にベンチマーク指数は50日線と200日線の上ですが、局面判定が「上昇に圧力」。';
  if (/^50日線割れ/.test(label)) return 'スキャン時にベンチマーク指数の終値が50日線を下回っています。';
  if (/^長期トレンド警戒/.test(label)) return 'スキャン時にベンチマーク指数の終値が200日線を下回っています。';
  if (/^新規購入を抑制/.test(label)) return 'スキャン時にベンチマーク指数は50日線と200日線の上ですが、局面判定が上昇トレンドではありません。';
  return null;
}

/** One index's follow-through state in a plain clause (the state is the exporter's; wording only). */
function followClause(name, ft, date) {
  if (!ft || ft.available !== true) return null;
  const at = value => shortDate(value, date), whole = value => Number.isSafeInteger(value) && value >= 0;
  switch (ft.state) {
    case 'confirmed': return `${name}は${ft.ftd?.date ? `${at(ft.ftd.date)}の` : ''}FTDで上昇を確認`;
    case 'rally_attempt': return `${name}は${whole(ft.attempt?.day) ? `反発${ft.attempt.day}日目で` : '反発中で'}FTD待ち`;
    case 'correction': return `${name}は調整中${finite(ft.declinePct) ? `（高値から−${Math.abs(ft.declinePct).toFixed(1)}%）` : ''}`;
    case 'attempt_expired': return `${name}は反発から15日以内のFTDなし`;
    case 'ftd_failed': return `${name}はFTDが失敗${ft.failedDate ? `（${at(ft.failedDate)}）` : ''}`;
    case 'no_correction': return ft.peakAtWindowStart === true ? null : `${name}は6%以上の調整なし`;
    default: return null;
  }
}

/**
 * 地合い: the verdict, the index chart and the market-environment values. Every value shows a number
 * (an older one only with its own date) or the precise reason it has none; an unknown is never 0.
 * Today (compact) keeps four tiles; the market tab (detail) groups the evidence in decision order.
 */
export default function MarketCard({ market, marketLoading = false, trends, date, detail = false }) {
  const status = trendsStatus(trends), ready = status.state === 'ready';
  const history = ready ? trends.data.long_history || null : null;
  const longError = ready && !history && typeof trends.data.long_history_error === 'string' ? trends.data.long_history_error : null;
  const rows = (history?.breadth || []).map(environmentPoint);
  const last = rows.at(-1) || null;
  const split = bifurcation(history);
  const warnings = environmentWarnings(rows);
  const indices = ready ? trends.data.indices || [] : [];
  const spx = indices.find(item => item.symbol === '^GSPC'), ndx = indices.find(item => item.symbol === '^IXIC');
  const verdictTone = marketTone(market);
  // Never present an older observation as today's: say which session each block describes.
  const historyDate = last?.date || null;
  const older = value => value && ((historyDate && value < historyDate) || (date && value < date)) ? shortDate(value, date) : null;
  const known = field => latestKnown(rows, field);
  // Why a long-history value is missing, most specific first. A fetch failure is not an integrity failure.
  const failed = status.state === 'error' ? { b: status.kind === 'fetch' ? '取得できません' : '確認できません', em: status.tile } : null;
  const absent = key => status.state === 'loading' ? { b: '読み込み中…', em: '' }
    : status.state === 'error' ? failed
      : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' }
        : !history ? (longError ? { b: '確認できません', em: '長期集計の整合性エラー' } : { b: '未配信', em: '長期集計なし' })
          : !rows.length ? { b: '未算出', em: '長期集計に観測日なし' }
            : !rows.some(row => key in row) ? { b: '未収録', em: `旧形式の長期集計 ${shortDate(history.as_of_date, date)}`, missing: true }
              : { b: '未算出', em: '観測率90%以上の日なし' };
  const monthBefore = (hit, field) => { const before = rows[hit.index - 21]; return finite(before?.[field]) ? before[field] : null; };
  const count = (label, field, fallback) => { const hit = known(field); if (!hit) return { label, ...absent(field) }; const before = monthBefore(hit, field);
    return { label, valued: true, b: `${num(hit.value)}銘柄`, asOf: older(hit.date), em: before === null ? fallback : `1か月で ${delta(hit.value - before)}`, range: yearRange(rows, hit, field), format: value => num(value) }; };
  const share = (label, field, base) => { const hit = known(field); if (!hit) return { label, ...absent(field) }; const before = monthBefore(hit, field);
    return { label, valued: true, b: `${num(hit.value, 1)}%`, asOf: older(hit.date), em: [finite(hit.row[base]) && finite(hit.row.coverage) ? `観測${num(hit.row.coverage)}中${num(hit.row[base])}銘柄` : null, before === null ? null : `1か月前 ${num(before, 1)}%`].filter(Boolean).join('・'), range: yearRange(rows, hit, field), format: value => `${num(value, 1)}%` }; };

  // Distribution days: each index with its own last observed session.
  const dist = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, item, hit: distributionCount(item) }));
  const distDates = dist.filter(d => d.hit && date && d.hit.date < date);
  const distAsOf = !distDates.length ? null : distDates.length === 2 && distDates[0].hit.date === distDates[1].hit.date ? shortDate(distDates[0].hit.date, date) : distDates.map(d => `${d.name} ${shortDate(d.hit.date, date)}`).join('・');
  const distWarn = dist.some(d => d.hit && d.hit.value >= DISTRIBUTION_WARN);
  const distFact = !ready ? { label: '分配日（25日）', ...absent('') }
    : { label: '分配日（25日）', b: dist.every(d => !d.hit) ? '算出不可' : dist.map(d => d.hit ? num(d.hit.value) : '算出不可').join('・'), em: 'S&P・NAS', asOf: distAsOf, warn: distWarn };
  const distReasons = ready ? dist.filter(d => !d.hit).map(d => `${d.name}の分配日：${d.item?.reason || '指数データを確認できません。'}`) : [];

  // Breakout success: a rate needs at least BREAKOUT_MIN_SAMPLE judged breakouts on that session.
  const rate = known('breakoutHoldPercent');
  const judgedNow = last && Number.isSafeInteger(last.breakoutsJudged) ? last.breakoutsJudged : null;
  const whyNot = !last || !('breakoutsJudged' in last) ? null : judgedNow === null ? '判定期間に観測不足の日を含む' : judgedNow < BREAKOUT_MIN_SAMPLE ? `${judgedNow}件（${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示）` : '成功数を確認できません';
  const breakout = rate ? { label: 'ブレイクアウト成功率', valued: true, b: `${num(rate.value)}%`, asOf: older(rate.date), range: detail ? yearRange(rows, rate, 'breakoutHoldPercent') : null, format: value => `${num(value)}%`,
    em: rate.index === rows.length - 1 ? (detail && Number.isSafeInteger(rate.row.breakoutsHeld) ? `10〜29営業日前の上抜け${rate.row.breakoutsJudged}件のうち${rate.row.breakoutsHeld}件が10日間で−7%に届かず` : `10〜29営業日前の${rate.row.breakoutsJudged}件・10日で−7%未満`) : `${rate.row.breakoutsJudged}件で判定${whyNot ? `・最新は${whyNot}` : ''}` }
    : judgedNow !== null && judgedNow < BREAKOUT_MIN_SAMPLE ? { label: 'ブレイクアウト成功率', valued: true, b: `${judgedNow}件`, asOf: older(last.date), em: `${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示` }
      : whyNot ? { label: 'ブレイクアウト成功率', b: '未算出', em: whyNot } : { label: 'ブレイクアウト成功率', ...absent('breakoutsJudged') };

  const highsLows = known(['newHighs', 'newLows']);
  const lowsLead = highsLows ? highsLows.value.newLows > highsLows.value.newHighs : false;
  const extremes = highsLows ? { label: '52週の新高値・新安値', valued: true, b: `${num(highsLows.value.newHighs)}・${num(highsLows.value.newLows)}`, asOf: older(highsLows.date), warn: lowsLead, em: `差 ${delta(highsLows.value.newHighs - highsLows.value.newLows)}` }
    : { label: '52週の新高値・新安値', ...absent('newHighs') };

  // An older long history without the trend-template fields still has the price-only leader count.
  const leaderHit = known('leaderCount');
  const ttFact = (() => { const fact = count('TT達成数', 'trendTemplateCount', '8条件すべて達成'); return fact.missing && leaderHit ? { ...fact, em: `${fact.em}・先導株数（価格条件）${num(leaderHit.value)}銘柄` } : fact; })();

  const follow = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, ...(status.state === 'loading' ? { b: '読み込み中…', em: '' } : status.state === 'error' ? failed : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' } : followThroughView(item?.followThrough, date)) }));

  const stageHit = detail ? known(STAGE_FIELDS) : null;
  const stages = stageHit ? STAGE_FIELDS.map((key, i) => ({ k: i + 1, share: stageHit.value[key] })) : [];
  const stageAsOf = stageHit ? older(stageHit.date) : null;

  const indexDates = [['S&P', dist[0].hit?.date], ['NAS', dist[1].hit?.date]].filter(([, value]) => value && date && value < date);
  // Both indices on the same older session read as one date; otherwise each older index is named.
  const indexDate = !indexDates.length ? null : indexDates.length === 2 && indexDates[0][1] === indexDates[1][1] ? indexDates[0][1] : indexDates.map(([name, value]) => `${name} ${value}`).join('・');
  const lagging = [historyDate && date && historyDate < date ? `長期集計は ${historyDate} 時点` : null, indexDate ? `分配日は ${indexDate} 時点` : null].filter(Boolean);
  const pending = !market && marketLoading;
  const chartStatus = longError ? 'history-error' : status.state === 'error' && status.kind === 'fetch' ? 'fetch-error' : status.state;
  const verdictMark = <span className="brief-verdict-mark" aria-hidden="true">{pending ? '…' : verdictTone === 'zone' ? '●' : verdictTone === 'ext' ? '▲' : verdictTone === 'neg' ? '⊘' : '?'}</span>;
  const verdictLabel = market?.label || (pending ? '判定を読み込み中…' : '市場未確認');
  const verdictText = market?.cap > 0 ? `新規の買いを検討できる地合い。エクスポージャーの目安は最大 ${Math.round(market.cap * 100)}%（独自判定）。` : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。';
  const statusAlert = status.state === 'loading' ? <p className="brief-note" role="status">市場推移を読み込み中…</p>
    : status.state === 'error' ? <p className="brief-alert" role="alert" data-failure={status.kind}>{trendsAlert(status)}数値は表示しません。</p>
      : status.state === 'none' ? <p className="brief-note">市場推移データはこの公開に含まれていません。</p>
        : longError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(longError)}{detail ? '分配日・フォロースルーデー' : '分配日'}は指数データから表示しています。</p> : null;
  const laggingNote = lagging.length > 0 && <p className="brief-note brief-asof" role="note">{lagging.join('・')}（分析基準日 {date} の再集計待ち）</p>;

  if (!detail) {
    // Today keeps exactly four facts.
    const facts = [distFact, ttFact, share('200日線より上', 'above200Percent', 'above200'), extremes];
    return <section className="brief-card brief-market in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
      <div className="brief-step"><span className="brief-step-no" aria-hidden="true">1</span><h2 id="brief-market-title">地合い</h2><Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link></div>
      <div className={`brief-verdict tone-${verdictTone}`} data-testid="brief-regime" aria-busy={pending || undefined}>{verdictMark}<div><strong>{verdictLabel}</strong><p>{verdictText}</p></div></div>
      <IndexChart sp500={history?.sp500} distribution={spx} status={chartStatus} />
      {statusAlert}
      <div className="brief-facts">{facts.map(fact => <Fact key={fact.label} fact={fact} />)}</div>
      {distReasons.length > 0 && <ul className="brief-factnotes">{distReasons.map(text => <li key={text}>{text}</li>)}</ul>}
      {laggingNote}
      {warnings.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{warnings.map(w => <li key={w.key}><span aria-hidden="true">▲</span> {w.text}（独自判定）</li>)}</ul>}
      {split?.warning && <p className="brief-alert" role="note">▲ {split.fromHigh > -0.05 ? '指数は1年高値の水準にありますが' : `指数は1年高値まであと${Math.abs(split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{num(split.above200Percent, 1)}%。指数と個別株が乖離しています（独自判定）。</p>}
      <p className="brief-note">分配日・ステージ・トレンドテンプレート数・RSは公開日足からの独自集計で、IBDの公式値ではありません。</p>
    </section>;
  }

  // ---- market tab: verdict first, then the evidence in decision order ----
  const warning = key => warnings.find(w => w.key === key) || null;
  const summary = ready ? indexSummary(history?.sp500) : null;

  // 1. 指数のトレンド: follow-through and distribution per index.
  const followRows = follow.map(row => ({ ...row, valued: ready && row.b !== '未集計' && row.b !== '算出不可', flag: row.tone === 'ext' ? 'FTD失敗' : null, warn: row.tone === 'ext' }));
  const ftdFact = { label: 'フォロースルーデー（独自判定）', className: 'brief-ftd', rows: followRows };
  const distRowsFact = !ready ? { label: '分配日（25日）', className: 'brief-dist', ...absent('') }
    : { label: '分配日（25日）', className: 'brief-dist', rows: dist.map(d => d.hit ? { name: d.name, valued: true, b: `${num(d.hit.value)}日`, asOf: d.hit.date < date ? shortDate(d.hit.date, date) : null, warn: d.hit.value >= DISTRIBUTION_WARN, flag: d.hit.value >= DISTRIBUTION_WARN ? `${DISTRIBUTION_WARN}日以上` : null }
      : { name: d.name, b: '算出不可', em: d.item?.reason || '指数データを確認できません。' }) };
  const indexSignals = [...followRows.filter(row => row.flag).map(row => ({ key: `ftd-${row.name}`, chip: `${row.name}のFTD失敗` })),
    ...dist.filter(d => d.hit && d.hit.value >= DISTRIBUTION_WARN).map(d => ({ key: `dist-${d.name}`, chip: `${d.name}の分配日 ${num(d.hit.value)}日` }))];
  const indexTakeaway = (() => {
    if (!ready) return null;
    const clauses = [followClause('S&P', spx?.followThrough, date), followClause('NAS', ndx?.followThrough, date)].filter(Boolean);
    const counted = dist.filter(d => d.hit), heavy = counted.filter(d => d.hit.value >= DISTRIBUTION_WARN), list = counted.map(d => `${d.name} ${num(d.hit.value)}日`).join('・');
    const distText = !counted.length ? '' : heavy.length ? `分配日は${heavy.map(d => d.name).join('・')}が${DISTRIBUTION_WARN}日以上と多い（${list}）。` : `分配日は${list}で、${counted.length > 1 ? 'いずれも' : ''}${DISTRIBUTION_WARN}日未満。`;
    return `${clauses.length ? `${clauses.join('、')}。` : ''}${distText}` || null;
  })();
  const indexItems = [ftdFact, distRowsFact];

  // 2. 市場の参加度: moving-average breadth, new highs and lows, the trend-template count.
  const a200 = share('200日線より上', 'above200Percent', 'above200'), a50 = share('50日線より上', 'above50Percent', 'above50');
  const template = warning('template');
  const tt = { ...ttFact, flag: template ? '10日で20%以上減少' : null, warn: Boolean(template) };
  const leaderSubstitute = tt.missing && leaderHit ? (() => { const before = monthBefore(leaderHit, 'leaderCount');
    return { label: '先導株数（価格条件）', valued: true, b: `${num(leaderHit.value)}銘柄`, asOf: older(leaderHit.date), em: `${before === null ? '' : `1か月で ${delta(leaderHit.value - before)}・`}TT達成数の旧集計（安値条件25%）`, range: yearRange(rows, leaderHit, 'leaderCount'), format: value => num(value) }; })() : null;
  const extremesRow = highsLows ? { label: extremes.label, className: 'brief-dist', note: extremes.em, rows: [
    { name: '新高値', valued: true, b: num(highsLows.value.newHighs), asOf: extremes.asOf },
    { name: '新安値', valued: true, b: num(highsLows.value.newLows), asOf: extremes.asOf, warn: lowsLead, flag: lowsLead ? '新高値より多い' : null }] } : extremes;
  const breadthItems = [a200, a50, extremesRow, tt, leaderSubstitute].filter(Boolean);
  const breadthSignals = [split?.warning && { key: 'split', chip: '指数と個別株の乖離' }, lowsLead && { key: 'lows', chip: '新安値＞新高値' }, template && { key: 'template', chip: 'TT達成数が急減' }].filter(Boolean);
  const breadthTakeaway = (() => {
    if (!ready || !history) return null;
    const parts = [];
    if (split?.warning) parts.push(`指数は1年高値${split.fromHigh > -0.05 ? 'の水準' : `まで${Math.abs(split.fromHigh).toFixed(1)}%`}なのに200日線より上の銘柄は${num(split.above200Percent, 1)}%で、指数と個別株が乖離（独自判定）`);
    if (highsLows) parts.push(lowsLead ? `新安値（${num(highsLows.value.newLows)}）が新高値（${num(highsLows.value.newHighs)}）を上回る` : highsLows.value.newHighs > highsLows.value.newLows ? `新高値（${num(highsLows.value.newHighs)}）が新安値（${num(highsLows.value.newLows)}）を上回る` : '新高値と新安値が同数');
    if (template) parts.push(template.text);
    const hit200 = known('above200Percent'), before200 = hit200 ? monthBefore(hit200, 'above200Percent') : null;
    if (!split?.warning && hit200 && before200 !== null && parts.length < 2) parts.push(hit200.value === before200 ? `200日線より上は1か月前と同じ${num(before200, 1)}%` : `200日線より上は1か月前の${num(before200, 1)}%から${hit200.value > before200 ? '上昇' : '低下'}`);
    return parts.length ? `${parts.join('。')}。` : null;
  })();

  // 3. リーダーの健全性: strong leaders, breakouts, last month's leaders, the stage mix.
  const rs90 = count('RS90以上のTT達成（独自RS）', 'rs90TemplateCount', '強いリーダーの数');
  const breakoutWarn = warning('breakout'), leadersWarn = warning('leaders'), stageWarn = warning('stage');
  const breakoutRow = { ...breakout, flag: breakoutWarn ? '40%未満' : null, warn: Boolean(breakoutWarn) };
  const health = known('leaderHealthPercent');
  const cohortNow = last && Number.isSafeInteger(last.leaderCohort) ? last.leaderCohort : null;
  // A newest cohort too small for a rate is today's state; an older rate is not shown in its place.
  const healthRow = cohortNow !== null && cohortNow < LEADER_MIN_COHORT ? { label: 'リーダーの健全度', valued: true, b: `${cohortNow}銘柄`, asOf: older(last.date), em: `20営業日前のTT達成が${LEADER_MIN_COHORT}銘柄未満のため率は非表示` }
    : health ? { label: 'リーダーの健全度', valued: true, b: `${num(health.value)}%`, asOf: older(health.date), warn: Boolean(leadersWarn), flag: leadersWarn ? '50%未満' : null,
      em: `20営業日前のTT達成${num(health.row.leaderCohort)}銘柄のうち${num(health.row.leaderCohortAbove50)}銘柄が50日線の上`, range: yearRange(rows, health, 'leaderHealthPercent'), format: value => `${num(value)}%` }
      : { label: 'リーダーの健全度', ...absent('leaderCohort') };
  const stageRow = stageHit ? { label: 'ステージ構成', valued: true, className: 'is-stage', b: `ステージ2 ${num(stageHit.value.stage2Percent, 0)}%`, asOf: stageAsOf, warn: Boolean(stageWarn), flag: stageWarn ? 'ステージ4がステージ2より多い' : null,
    extra: <><div className="brief-stagebar" role="img" aria-label={`ステージ構成 ${stages.map(s => `ステージ${s.k} ${num(s.share, 1)}%`).join('、')}${stageAsOf ? `（${stageAsOf}時点）` : ''}`}>
      {stages.map((s, i) => <span key={s.k} className={`stage-${s.k}`} style={{ flexGrow: s.share, '--i': i }} />)}
    </div><div className="brief-stagelegend" aria-hidden="true">{stages.map(s => <span key={s.k}><i className={`stage-${s.k}`} />{s.k} {s.k === 1 ? '底固め' : s.k === 2 ? '上昇' : s.k === 3 ? '天井圏' : '下降'} {num(s.share, 0)}%</span>)}</div></> }
    : { label: 'ステージ構成', className: 'is-stage', ...absent('stage1') };
  const leaderItems = [rs90, breakoutRow, healthRow, stageRow];
  const leaderSignals = [stageWarn && { key: 'stage', chip: 'ステージ4＞ステージ2' }, leadersWarn && { key: 'leaders', chip: `リーダーの健全度 ${num(health.value)}%` }, breakoutWarn && { key: 'breakout', chip: `ブレイクアウト成功率 ${num(rate.value)}%` }].filter(Boolean);
  const leaderTakeaway = (() => {
    if (!ready || !history) return null;
    const fired = [stageWarn, leadersWarn, breakoutWarn].filter(Boolean);
    if (fired.length) return `${fired.map(w => w.text).join('。')}（独自判定）。`;
    // environmentWarnings reads the newest session only: an older value was not judged today.
    const judged = [finite(last?.stage2Percent) && finite(last?.stage4Percent) && 'ステージ構成', finite(last?.leaderHealthPercent) && 'リーダーの健全度', finite(last?.breakoutHoldPercent) && 'ブレイクアウト成功率'].filter(Boolean);
    return judged.length ? `${judged.join('・')}に悪化サインはありません（独自判定）。` : null;
  })();

  // Values a former long-history schema did not record are named once per group, not row by row.
  const missingLine = items => { const gone = items.filter(item => item.missing); return gone.length ? `旧形式の長期集計（${shortDate(history.as_of_date, date)}）には未収録：${gone.map(item => item.label).join('・')}` : null; };
  const shown = items => items.filter(item => !item.missing);
  const signals = [...indexSignals, ...breadthSignals, ...leaderSignals];
  const schemaGaps = [...breadthItems, ...leaderItems].some(item => item.missing);
  const groups = [
    { id: 'index', title: '指数のトレンド', short: '指数', items: indexItems, signals: indexSignals.length, takeaway: indexTakeaway },
    { id: 'breadth', title: '市場の参加度', short: '参加度', items: breadthItems, signals: breadthSignals.length, takeaway: breadthTakeaway },
    { id: 'leaders', title: 'リーダーの健全性', short: 'リーダー', items: leaderItems, signals: leaderSignals.length, takeaway: leaderTakeaway },
  ];
  const exposure = market?.cap > 0 ? Math.round(market.cap * 100) : market && market.state !== 'unknown' ? 0 : null;
  const verdictLead = market?.cap > 0 ? '新規の買いを検討できます。' : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。';
  const basis = verdictBasis(market);
  const render = (item, asOf) => item.rows || item.className === 'brief-dist' ? <PairRow key={item.label} fact={item} groupAsOf={asOf} /> : <Row key={item.label} fact={item} groupAsOf={asOf} />;

  return <section className="brief-card brief-market is-detail in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
    <div className="brief-step"><h2 id="brief-market-title">地合い</h2></div>
    <div className={`brief-verdict is-lead tone-${verdictTone}`} data-testid="brief-regime" aria-busy={pending || undefined}>
      <div className="brief-verdict-head">{verdictMark}<div><strong>{verdictLabel}</strong><p>{verdictLead}</p></div></div>
      {exposure !== null && <div className="brief-exposure"><small>エクスポージャーの目安</small><b className="numeric">{exposure > 0 ? `最大 ${exposure}%` : '0%'}</b><span className="brief-exposure-track" aria-hidden="true"><i style={{ width: `${exposure}%` }} /></span></div>}
      {basis && <p className="brief-verdict-why"><span>判定の根拠</span> {basis}</p>}
    </div>
    {ready && <div className={`brief-signals${signals.length ? ' is-warn' : ''}`} role="group" aria-label="注意サイン（独自判定）">
      <b>{signals.length ? <><span aria-hidden="true">▲</span> 注意サイン {signals.length}件</> : '注意サインなし'}<small>（独自判定）</small></b>
      {signals.length > 0 && <ul>{signals.map(s => <li key={s.key}>{s.chip}</li>)}</ul>}
      {(signals.length === 0 || !history || schemaGaps) && <span>{!history ? '長期集計がないため、分配日とFTDだけを判定しています。' : schemaGaps ? '旧形式の長期集計に未収録の項目は判定していません。' : '判定できた独自基準（分配日・FTD・新安値・乖離・TT急減・ステージ・リーダー・ブレイクアウト）のいずれにも該当しません。'}</span>}
    </div>}
    {/* Phone: one tap to each group and to the long history, each with its own warning count. */}
    <nav className="brief-jump" aria-label="市場タブ内の移動">
      {groups.map(group => <button key={group.id} type="button" onClick={() => jumpTo(`brief-env-${group.id}`)}>{group.short}{group.signals > 0 && <span className="brief-jump-warn"><span aria-hidden="true">▲</span>{group.signals}<span className="sr-only">件の注意</span></span>}</button>)}
      <button type="button" onClick={() => jumpTo('brief-history-title')}>推移</button>
    </nav>
    {statusAlert}
    {laggingNote}
    <div className="brief-env-groups">
      {groups.map(group => { const asOf = groupDate(group.items); return <Group key={group.id} id={group.id} title={group.title} asOf={asOf} signals={group.signals} takeaway={group.takeaway} missing={missingLine(group.items)}>
        {group.id === 'index' && <div className="brief-index-block">
          {summary && <p className="brief-index-summary"><span>S&amp;P 500<b className="numeric">{num(summary.close, 2)}</b><small>{shortDate(summary.date, date)}終値</small></span><span>50日線より<b className="numeric">{signedPercent(summary.vsMa)}</b></span><span>{summary.fullYear ? '1年高値から' : '期間内高値から'}<b className="numeric">{signedPercent(summary.fromHigh)}</b></span></p>}
          <IndexChart sp500={history?.sp500} distribution={spx} status={chartStatus} detail />
        </div>}
        <div className="brief-env-rows">{shown(group.items).map(item => render(item, asOf))}</div>
      </Group>; })}
    </div>
    <p className="brief-note">分配日・フォロースルーデー・ステージ・トレンドテンプレート数・RSは公開日足からの独自集計で、IBDの公式値ではありません。</p>
    <MetricDisclosure className="brief-glossary" summary="用語と判定ルール">
      <dl>
        <div><dt>フォロースルーデー（FTD）</dt><dd>6%以上の下落（高値の終値から安値日の終値まで）後、反発4〜15日目に出来高増を伴う+1.2%以上の上昇。確認後にFTD当日の安値を終値で下回ると失敗です。</dd></div>
        <div><dt>分配日</dt><dd>指数が前日比0.2%を超えて下落し、出来高が前日より多かった日。25営業日で失効し、指数がその日の終値から5%以上上昇しても除外します。{DISTRIBUTION_WARN}日以上で注意サインです。</dd></div>
        <div><dt>50日線・200日線より上</dt><dd>観測できた銘柄のうち、終値が各移動平均線を上回る割合です。</dd></div>
        <div><dt>TT達成数</dt><dd>ミネルヴィニのトレンドテンプレート8条件（独自RS 70以上を含む）をすべて満たす銘柄数。10営業日で20%以上減ると注意サインです。</dd></div>
        <div><dt>RS90以上のTT達成</dt><dd>TT達成銘柄のうち独自RSが90以上の銘柄数。IBD公式RSではありません。</dd></div>
        <div><dt>ブレイクアウト成功率</dt><dd>終値で過去251営業日の高値を超え、出来高が50日平均の1.4倍以上だった上抜け（10〜29営業日前）のうち、その後10営業日の安値が上抜け日の終値から−7%に届かなかった割合。{BREAKOUT_MIN_SAMPLE}件未満は率を出しません。40%未満で注意サインです。</dd></div>
        <div><dt>リーダーの健全度</dt><dd>20営業日前のTT達成銘柄のうち、終値が50日線の上にある割合（{LEADER_MIN_COHORT}銘柄未満は非表示）。50%未満で注意サインです。</dd></div>
        <div><dt>ステージ構成</dt><dd>200日線の傾きと株価の位置から日ごとに判定した、1 底固め・2 上昇・3 天井圏・4 下降の割合。ステージ4がステージ2を上回ると注意サインです。</dd></div>
        <div><dt>指数と個別株の乖離</dt><dd>S&amp;P 500が1年高値から5%以内なのに、200日線より上の銘柄が50%未満の状態です。</dd></div>
      </dl>
    </MetricDisclosure>
  </section>;
}
