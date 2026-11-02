import { Link } from 'react-router-dom';
import { bifurcation, environmentPoint } from '../marketLongHistory';
import { environmentWarnings, marketTone } from './briefModel';

const finite = Number.isFinite;
const num = (value, digits = 0) => finite(value) ? value.toLocaleString('ja-JP', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '未確認';
const delta = value => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : '±'}${Math.abs(value).toLocaleString('ja-JP')}` : '';


function IndexChart({ sp500, distribution }) {
  const points = (sp500 || []).filter(p => finite(p.close)).slice(-130);
  if (points.length < 60) return <p className="brief-note">指数の履歴は未取得です。</p>;
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

export default function MarketCard({ market, trends, date, detail = false }) {
  const history = trends?.data?.long_history || null;
  const rows = (history?.breadth || []).map(environmentPoint);
  const last = rows.at(-1) || null, monthAgo = rows.at(-22) || null, recent = rows.slice(-126);
  const hasEnvironment = Boolean(last && 'trendTemplateCount' in last);
  const split = bifurcation(history);
  const warnings = environmentWarnings(rows);
  const spx = trends?.data?.indices?.find(item => item.symbol === '^GSPC'), ndx = trends?.data?.indices?.find(item => item.symbol === '^IXIC');
  const dist = item => finite(item?.latest?.value) ? item.latest.value : null;
  const stages = hasEnvironment ? [1, 2, 3, 4].map(k => ({ k, share: last[`stage${k}Percent`] })) : [];
  const verdictTone = marketTone(market);
  // Never present an older observation as today's: say which session each block describes.
  const historyDate = last?.date || null, indexDate = spx?.latest?.date || null;
  const lagging = [historyDate && date && historyDate < date ? `長期集計は ${historyDate} 時点` : null, indexDate && date && indexDate < date ? `分配日は ${indexDate} 時点` : null].filter(Boolean);
  return <section className="brief-card brief-market in" style={{ '--i': 1 }} aria-labelledby="brief-market-title">
    <div className="brief-step">{!detail && <span className="brief-step-no" aria-hidden="true">1</span>}<h2 id="brief-market-title">地合い</h2>{!detail && <Link className="brief-more" to="/brief/market">市場の詳細 <span aria-hidden="true">›</span></Link>}</div>
    <div className={`brief-verdict tone-${verdictTone}`} data-testid="brief-regime">
      <span className="brief-verdict-mark" aria-hidden="true">{verdictTone === 'zone' ? '●' : verdictTone === 'ext' ? '▲' : verdictTone === 'neg' ? '⊘' : '?'}</span>
      <div><strong>{market?.label || '市場未確認'}</strong><p>{market?.cap > 0 ? `新規の買いを検討できる地合い。エクスポージャーの目安は最大 ${Math.round(market.cap * 100)}%（独自判定）。` : market?.state === 'unknown' ? '市場の状態を確認できません。新規の買いは見送ります。' : '新規の買いは控えます（独自判定）。'}</p></div>
    </div>
    <IndexChart sp500={history?.sp500} distribution={spx} />
    <div className="brief-facts">
      <div className="brief-fact"><small>分配日（25日）</small><b className={(dist(spx) ?? 0) >= 5 || (dist(ndx) ?? 0) >= 5 ? 'is-warn' : ''}>{dist(spx) == null && dist(ndx) == null ? '未確認' : `${num(dist(spx))}・${num(dist(ndx))}`}</b><em>S&amp;P・NAS</em></div>
      <div className="brief-fact"><small>TT達成数</small><b>{hasEnvironment ? `${num(last.trendTemplateCount)}銘柄` : '未取得'}</b><em>{hasEnvironment && finite(monthAgo?.trendTemplateCount) ? `1か月で ${delta(last.trendTemplateCount - monthAgo.trendTemplateCount)}` : '8条件すべて達成'}</em></div>
      <div className="brief-fact"><small>200日線より上</small><b>{hasEnvironment ? `${num(last.above200Percent, 1)}%` : '未取得'}</b><em>{hasEnvironment && finite(monthAgo?.above200Percent) ? `1か月前 ${num(monthAgo.above200Percent, 1)}%` : '全銘柄に占める割合'}</em></div>
      <div className="brief-fact"><small>ブレイクアウト成功率</small><b>{hasEnvironment && finite(last.breakoutHoldPercent) ? `${num(last.breakoutHoldPercent)}%` : '未確認'}</b><em>{hasEnvironment && Number.isInteger(last.breakoutsJudged) ? `直近${last.breakoutsJudged}件・10日で−7%未満` : '判定数が不足'}</em></div>
      <div className="brief-fact"><small>52週の新高値・新安値</small><b className={finite(last?.newHighs) && finite(last?.newLows) && last.newLows > last.newHighs ? 'is-warn' : ''}>{finite(last?.newHighs) && finite(last?.newLows) ? `${num(last.newHighs)}・${num(last.newLows)}` : '未確認'}</b><em>{finite(last?.newHighs) && finite(last?.newLows) ? `差 ${delta(last.newHighs - last.newLows) || '±0'}` : '日足から集計'}</em></div>
      <div className="brief-fact"><small>RS90以上のTT達成</small><b>{hasEnvironment && finite(last.rs90TemplateCount) ? `${num(last.rs90TemplateCount)}銘柄` : '未取得'}</b><em>{hasEnvironment && finite(monthAgo?.rs90TemplateCount) ? `1か月で ${delta(last.rs90TemplateCount - monthAgo.rs90TemplateCount)}` : '強いリーダーの数'}</em></div>
    </div>
    {lagging.length > 0 && <p className="brief-note brief-asof" role="note">{lagging.join('・')}（分析基準日 {date} の再集計待ち）</p>}
    {hasEnvironment && <div className="brief-environment">
      <div className="brief-stagebar" role="img" aria-label={`ステージ構成 ${stages.map(s => `ステージ${s.k} ${num(s.share, 1)}%`).join('、')}`}>
        {stages.map((s, i) => <span key={s.k} className={`stage-${s.k}`} style={{ flexGrow: finite(s.share) ? s.share : 0, '--i': i }} />)}
      </div>
      <div className="brief-stagelegend" aria-hidden="true">{stages.map(s => <span key={s.k}><i className={`stage-${s.k}`} />ステージ{s.k} {num(s.share, 0)}%</span>)}</div>
      <div className="brief-trend"><span>TT達成数の推移（6か月）</span><Sparkline points={recent} field="trendTemplateCount" /></div>
    </div>}
    {warnings.length > 0 && <ul className="brief-warnings" aria-label="地合いの悪化サイン（独自判定）">{warnings.map(w => <li key={w.key}><span aria-hidden="true">▲</span> {w.text}（独自判定）</li>)}</ul>}
    {split?.warning && <p className="brief-alert" role="note">▲ {split.fromHigh > -0.05 ? '指数は1年高値の水準にありますが' : `指数は1年高値まであと${Math.abs(split.fromHigh).toFixed(1)}%の位置ですが`}、200日線より上の銘柄は{num(split.above200Percent, 1)}%。指数と個別株が乖離しています（独自判定）。</p>}
    <p className="brief-note">分配日・ステージ・トレンドテンプレート数は公開日足からの独自集計で、IBDの公式値ではありません。</p>
  </section>;
}
