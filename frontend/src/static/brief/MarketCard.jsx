import { Link } from 'react-router-dom';
import { bifurcation, environmentPoint, BREAKOUT_MIN_SAMPLE } from '../marketLongHistory';
import { distributionCount, environmentWarnings, followThroughView, latestKnown, marketTone, sentence, shortDate, trendsAlert, trendsStatus } from './briefModel';

const finite = Number.isFinite;
// Only ever called with a finite number: a unit is never appended to an unknown value.
const num = (value, digits = 0) => value.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const delta = value => `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('ja-JP')}`;
const STAGE_FIELDS = ['stage1Percent', 'stage2Percent', 'stage3Percent', 'stage4Percent'];

function IndexChart({ sp500, distribution, status }) {
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
  return <svg className="brief-index" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={`S&P 500 の終値と50日線（${points[0].date}〜${points.at(-1).date}）。有効な分配日 ${marks.length}日`}>
    <path d={line50} className="brief-index-ma" pathLength="1" />
    <path d={line} className="brief-index-line" pathLength="1" />
    {marks.map((i, k) => <path key={i} d={`M${x(i) - 5},${y(points[i].close) + 14}h10l-5,-8z`} className="brief-index-dist" style={{ '--i': k }} />)}
  </svg>;
}

function Sparkline({ points, field }) {
  const values = points.map(p => p[field]);
  const known = values.filter(finite);
  if (known.length < 10) return null;
  const lo = Math.min(...known), hi = Math.max(...known), W = 160, H = 40;
  const x = i => 2 + i * (W - 4) / (values.length - 1), y = v => 4 + (hi - v) * (H - 8) / (hi - lo || 1);
  const d = values.map((v, i) => v == null ? '' : `${values[i - 1] == null ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  return <svg className="brief-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" aria-hidden="true"><path d={d} pathLength="1" /></svg>;
}

const AsOf = ({ value }) => value ? <span className="brief-fact-asof">（{value}時点）</span> : null;
// On a phone an explanation wraps only between its 「・」 parts, and a label keeps its （…） together.
const Parts = ({ text }) => { const parts = String(text).split('・'); return parts.map((part, i) => <span key={i} className="brief-frag">{part}{i < parts.length - 1 ? '・' : ''}</span>); };
const Label = ({ text }) => { const at = text.indexOf('（'); return at > 0 ? <>{text.slice(0, at)}<span className="brief-frag">{text.slice(at)}</span></> : text; };
const Fact = ({ fact }) => <div className={`brief-fact${fact.wide ? ' is-wide' : ''}`}><small><Label text={fact.label} /></small><b className={fact.warn ? 'is-warn' : ''}>{fact.b}<AsOf value={fact.asOf} /></b>{fact.em ? <em><Parts text={fact.em} /></em> : null}</div>;

/**
 * 地合い: the verdict, the index chart and the market-environment tiles. Every tile shows a value
 * (an older one only with its own date) or the precise reason it has none; an unknown is never 0.
 */
export default function MarketCard({ market, marketLoading = false, trends, date, detail = false }) {
  const status = trendsStatus(trends), ready = status.state === 'ready';
  const history = ready ? trends.data.long_history || null : null;
  const longError = ready && !history && typeof trends.data.long_history_error === 'string' ? trends.data.long_history_error : null;
  const rows = (history?.breadth || []).map(environmentPoint);
  const last = rows.at(-1) || null, recent = rows.slice(-126);
  const split = bifurcation(history);
  const warnings = environmentWarnings(rows);
  const indices = ready ? trends.data.indices || [] : [];
  const spx = indices.find(item => item.symbol === '^GSPC'), ndx = indices.find(item => item.symbol === '^IXIC');
  const verdictTone = marketTone(market);
  // Never present an older observation as today's: say which session each block describes.
  const historyDate = last?.date || null;
  const older = value => value && ((historyDate && value < historyDate) || (date && value < date)) ? shortDate(value, date) : null;
  const known = field => latestKnown(rows, field);
  // Why a long-history tile has no value, most specific first. A fetch failure is not an integrity failure.
  const failed = status.state === 'error' ? { b: status.kind === 'fetch' ? '取得できません' : '確認できません', em: status.tile } : null;
  const absent = key => status.state === 'loading' ? { b: '読み込み中…', em: '' }
    : status.state === 'error' ? failed
      : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' }
        : !history ? (longError ? { b: '確認できません', em: '長期集計の整合性エラー' } : { b: '未配信', em: '長期集計なし' })
          : !rows.length ? { b: '未算出', em: '長期集計に観測日なし' }
            : !rows.some(row => key in row) ? { b: '未収録', em: `旧形式の長期集計 ${shortDate(history.as_of_date, date)}` }
              : { b: '未算出', em: '観測率90%以上の日なし' };
  const monthBefore = (hit, field) => { const before = rows[hit.index - 21]; return finite(before?.[field]) ? before[field] : null; };
  const count = (label, field, fallback) => { const hit = known(field); if (!hit) return { label, ...absent(field) }; const before = monthBefore(hit, field);
    return { label, b: `${num(hit.value)}銘柄`, asOf: older(hit.date), em: before === null ? fallback : `1か月で ${delta(hit.value - before)}` }; };
  const share = (label, field, base) => { const hit = known(field); if (!hit) return { label, ...absent(field) }; const before = monthBefore(hit, field);
    return { label, b: `${num(hit.value, 1)}%`, asOf: older(hit.date), em: [finite(hit.row[base]) && finite(hit.row.coverage) ? `観測${num(hit.row.coverage)}中${num(hit.row[base])}銘柄` : null, before === null ? null : `1か月前 ${num(before, 1)}%`].filter(Boolean).join('・') }; };

  // Distribution days: each index with its own last observed session.
  const dist = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, item, hit: distributionCount(item) }));
  const distDates = dist.filter(d => d.hit && date && d.hit.date < date);
  const distAsOf = !distDates.length ? null : distDates.length === 2 && distDates[0].hit.date === distDates[1].hit.date ? shortDate(distDates[0].hit.date, date) : distDates.map(d => `${d.name} ${shortDate(d.hit.date, date)}`).join('・');
  const distFact = !ready ? { label: '分配日（25日）', ...absent('') }
    : { label: '分配日（25日）', b: dist.every(d => !d.hit) ? '算出不可' : dist.map(d => d.hit ? num(d.hit.value) : '算出不可').join('・'), em: 'S&P・NAS', asOf: distAsOf, warn: dist.some(d => d.hit && d.hit.value >= 5) };
  const distReasons = ready ? dist.filter(d => !d.hit).map(d => `${d.name}の分配日：${d.item?.reason || '指数データを確認できません。'}`) : [];

  // Breakout success: a rate needs at least BREAKOUT_MIN_SAMPLE judged breakouts on that session.
  const rate = known('breakoutHoldPercent');
  const judgedNow = last && Number.isSafeInteger(last.breakoutsJudged) ? last.breakoutsJudged : null;
  const whyNot = !last || !('breakoutsJudged' in last) ? null : judgedNow === null ? '判定期間に観測不足の日を含む' : judgedNow < BREAKOUT_MIN_SAMPLE ? `${judgedNow}件（${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示）` : '成功数を確認できません';
  const breakout = rate ? { label: 'ブレイクアウト成功率', b: `${num(rate.value)}%`, asOf: older(rate.date),
    em: rate.index === rows.length - 1 ? `10〜29営業日前の${rate.row.breakoutsJudged}件・10日で−7%未満` : `${rate.row.breakoutsJudged}件で判定${whyNot ? `・最新は${whyNot}` : ''}` }
    : judgedNow !== null && judgedNow < BREAKOUT_MIN_SAMPLE ? { label: 'ブレイクアウト成功率', b: `${judgedNow}件`, asOf: older(last.date), em: `${BREAKOUT_MIN_SAMPLE}件未満のため率は非表示` }
      : whyNot ? { label: 'ブレイクアウト成功率', b: '未算出', em: whyNot } : { label: 'ブレイクアウト成功率', ...absent('breakoutsJudged') };

  const highsLows = known(['newHighs', 'newLows']);
  const extremes = highsLows ? { label: '52週の新高値・新安値', b: `${num(highsLows.value.newHighs)}・${num(highsLows.value.newLows)}`, asOf: older(highsLows.date), warn: highsLows.value.newLows > highsLows.value.newHighs, em: `差 ${delta(highsLows.value.newHighs - highsLows.value.newLows)}` }
    : { label: '52週の新高値・新安値', ...absent('newHighs') };

  // Today keeps exactly four facts; the market tab adds the rest.
  const facts = [
    distFact,
    count('TT達成数', 'trendTemplateCount', '8条件すべて達成'),
    share('200日線より上', 'above200Percent', 'above200'),
    detail && share('50日線より上', 'above50Percent', 'above50'),
    detail && breakout,
    detail && count('RS90以上のTT達成（独自RS）', 'rs90TemplateCount', '強いリーダーの数'),
    { ...extremes, wide: detail },
  ].filter(Boolean);

  const follow = [['S&P', spx], ['NAS', ndx]].map(([name, item]) => ({ name, ...(status.state === 'loading' ? { b: '読み込み中…', em: '' } : status.state === 'error' ? failed : status.state === 'none' ? { b: '未配信', em: '市場推移データなし' } : followThroughView(item?.followThrough, date)) }));

  const stageHit = detail ? known(STAGE_FIELDS) : null;
  const stages = stageHit ? STAGE_FIELDS.map((key, i) => ({ k: i + 1, share: stageHit.value[key] })) : [];
  const stageAsOf = stageHit ? older(stageHit.date) : null;
  const stageMissing = detail && !stageHit ? (({ b, em }) => `ステージ構成は${b}${em ? `（${em}）` : ''}`)(absent('stage1')) : null;
  const sparkKnown = recent.filter(row => finite(row.trendTemplateCount)).length >= 10;

  const indexDates = [['S&P', dist[0].hit?.date], ['NAS', dist[1].hit?.date]].filter(([, value]) => value && date && value < date);
  // Both indices on the same older session read as one date; otherwise each older index is named.
  const indexDate = !indexDates.length ? null : indexDates.length === 2 && indexDates[0][1] === indexDates[1][1] ? indexDates[0][1] : indexDates.map(([name, value]) => `${name} ${value}`).join('・');
  const lagging = [historyDate && date && historyDate < date ? `長期集計は ${historyDate} 時点` : null, indexDate ? `分配日は ${indexDate} 時点` : null].filter(Boolean);
  const pending = !market && marketLoading;
  return <section className={`brief-card brief-market in${detail ? ' is-detail' : ''}`} style={{ '--i': 1 }} aria-labelledby="brief-market-title">
    <div className="brief-step">{!detail && <span className="brief-step-no" aria-hidden="true">1</span>}<h2 id="brief-market-title">地合い</h2>{!detail && <Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link>}</div>
    <div className={`brief-verdict tone-${verdictTone}`} data-testid="brief-regime" aria-busy={pending || undefined}>
      <span className="brief-verdict-mark" aria-hidden="true">{pending ? '…' : verdictTone === 'zone' ? '●' : verdictTone === 'ext' ? '▲' : verdictTone === 'neg' ? '⊘' : '?'}</span>
      <div><strong>{market?.label || (pending ? '判定を読み込み中…' : '市場未確認')}</strong><p>{market?.cap > 0 ? `新規の買いを検討できる地合い。エクスポージャーの目安は最大 ${Math.round(market.cap * 100)}%（独自判定）。` : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : market ? '新規の買いは控えます（独自判定）。' : pending ? '市場の判定を読み込み中です。' : '市場の判定を読み込めません。新規の買いは見送ります。'}</p></div>
    </div>
    <IndexChart sp500={history?.sp500} distribution={spx} status={longError ? 'history-error' : status.state === 'error' && status.kind === 'fetch' ? 'fetch-error' : status.state} />
    {(history?.sp500 || []).filter(p => finite(p.close)).length >= 60 && <p className="brief-index-legend" aria-hidden="true"><span className="is-close">S&amp;P 500 終値（半年）</span><span className="is-ma">50日線</span><span className="is-dist">▲ 分配日</span></p>}
    {status.state === 'loading' ? <p className="brief-note" role="status">市場推移を読み込み中…</p>
      : status.state === 'error' ? <p className="brief-alert" role="alert" data-failure={status.kind}>{trendsAlert(status)}数値は表示しません。</p>
        : status.state === 'none' ? <p className="brief-note">市場推移データはこの公開に含まれていません。</p>
          : longError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(longError)}{detail ? '分配日・フォロースルーデー' : '分配日'}は指数データから表示しています。</p> : null}
    <div className="brief-facts">
      {detail && <div className="brief-fact is-wide brief-ftd"><small><Label text="フォロースルーデー（独自判定）" /></small>
        {follow.map(row => <div key={row.name} className="brief-ftd-row"><span className="brief-ftd-index">{row.name}</span><b className={row.tone === 'ext' ? 'is-warn' : ''}>{row.b}<AsOf value={row.asOf} /></b>{row.em ? <em><Parts text={row.em} /></em> : null}</div>)}
      </div>}
      {facts.map(fact => <Fact key={fact.label} fact={fact} />)}
    </div>
    {distReasons.length > 0 && <ul className="brief-factnotes">{distReasons.map(text => <li key={text}>{text}</li>)}</ul>}
    {lagging.length > 0 && <p className="brief-note brief-asof" role="note">{lagging.join('・')}（分析基準日 {date} の再集計待ち）</p>}
    {stageHit && <div className="brief-environment">
      <div className="brief-stagebar" role="img" aria-label={`ステージ構成 ${stages.map(s => `ステージ${s.k} ${num(s.share, 1)}%`).join('、')}${stageAsOf ? `（${stageAsOf}時点）` : ''}`}>
        {stages.map((s, i) => <span key={s.k} className={`stage-${s.k}`} style={{ flexGrow: s.share, '--i': i }} />)}
      </div>
      <div className="brief-stagelegend" aria-hidden="true">{stages.map(s => <span key={s.k}><i className={`stage-${s.k}`} />ステージ{s.k} {num(s.share, 0)}%</span>)}{stageAsOf && <span className="brief-fact-asof">（{stageAsOf}時点）</span>}</div>
      {sparkKnown && <div className="brief-trend"><span>TT達成数の推移（6か月）</span><Sparkline points={recent} field="trendTemplateCount" /></div>}
    </div>}
    {stageMissing && <p className="brief-note" data-testid="brief-stage-missing">{stageMissing}</p>}
    {warnings.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{warnings.map(w => <li key={w.key}><span aria-hidden="true">▲</span> {w.text}（独自判定）</li>)}</ul>}
    {split?.warning && !detail && <p className="brief-alert" role="note">▲ {split.fromHigh > -0.05 ? '指数は1年高値の水準にありますが' : `指数は1年高値まであと${Math.abs(split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{num(split.above200Percent, 1)}%。指数と個別株が乖離しています（独自判定）。</p>}
    <p className="brief-note">分配日・{detail ? 'フォロースルーデー・' : ''}ステージ・トレンドテンプレート数・RSは公開日足からの独自集計で、IBDの公式値ではありません。{detail ? 'フォロースルーデーは6%以上の下落（高値の終値から安値日の終値まで）後、反発4〜15日目に出来高増を伴う+1.2%以上の上昇。50日線・200日線より上の割合は、観測できた銘柄に占める割合です。' : ''}</p>
  </section>;
}
