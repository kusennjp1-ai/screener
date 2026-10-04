import { memo, useState } from 'react';
import { getStaticDataUrl } from '../../config/runtimeMode';
import { FinancialGrowthMetric } from './FinancialEvidenceSummary';
import CandidateCurrentState from './CandidateCurrentState';
import { money, signed, times, stateKey, STATES } from '../positionGeometry';

const unresolvedLabel = rule => `${rule.label}：${rule.state === 'unknown' ? '未確認' : '未達'}`;

function CandidatePriceTrace({ trace, date, symbol }) {
 const [failed, setFailed] = useState(false);
 const available = !failed && trace?.status === 'available' && trace.asOfDate === date && typeof trace.src === 'string';
 return <div className="feed-price-trace">{available ? <><img src={getStaticDataUrl(trace.src)} loading="lazy" decoding="async" width="360" height="64" alt={`${symbol} ${trace.caption}`} onError={() => setFailed(true)}/><small>{trace.caption}</small></> : <span className="feed-trace-unavailable">価格推移 未確認<small>対応する日足・対象期間の根拠が未配信</small></span>}</div>;
}

export default memo(function CandidateFeedCard({ item, date, nearOnly, selected, onSelect, onCompare, onMove, watched, onWatch }) {
 const { row: r, assessment: a, plan: p, readiness, volume, growth, annual, selectionRules = [], missing } = item;
 const [label] = STATES[stateKey(p.state)];
 const dailyLabel = readiness ? `日次確認 ${readiness.passed}/${readiness.total}` : '日次確認 未確認';
 const dailyBlockers = readiness?.rules.filter(rule => rule.state !== 'pass') || [];
 const selectionBlockers = selectionRules.filter(rule => rule.state !== 'pass');
 const annualBlocker = annual?.required && annual.state !== 'pass';
 const nextCheck = annualBlocker ? { label: '年次EPS', state: annual.state } : selectionBlockers[0] || dailyBlockers[0];
 const nextLabel = nextCheck ? unresolvedLabel(nextCheck) : readiness?.ready ? '発注前に最新価格とリスクを確認' : '分析日または市場環境が未確認';
 const otherSelection = selectionBlockers;
 const otherDaily = dailyBlockers;
 const otherCount = otherSelection.length + otherDaily.length;
 const dailyDetail = readiness?.ready ? '発注前に最新価格とリスクを確認' : dailyBlockers[0] ? unresolvedLabel(dailyBlockers[0]) : '分析日または市場環境が未確認';
 const allBlockers = [...selectionBlockers, ...dailyBlockers].map(unresolvedLabel).join('。');
 return <article className="candidate-feed-card" data-selected={selected || undefined} data-near-pass={nearOnly || undefined} data-state-date={date || undefined}>
  <button className="candidate-row" aria-current={selected ? 'true' : undefined} aria-label={`${r.symbol} の分析を表示。価格位置 ${label}。ピボット比 ${signed(p.distance)}。RS ${Number.isFinite(r.rs_rating) ? Math.round(r.rs_rating) : '未確認'}。出来高 ${times(volume)}。選定条件 ${a.passed}/${a.total}。${dailyLabel}。${dailyDetail}${annualBlocker ? `。必須 年次EPS ${annual.state === 'fail' ? '未達' : '未確認'}` : ''}${allBlockers ? `。${allBlockers}` : ''}${nearOnly ? `。${missing?.csv || '判定を再確認してください'}` : ''}`} onClick={() => onSelect(r.symbol)} onKeyDown={event => {
   if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); onMove(r.symbol, event.key === 'ArrowDown' ? 1 : -1, event.currentTarget); }
   if (event.key === 'Enter' && onCompare) { event.preventDefault(); onCompare(r.symbol); }
  }}>
   <span className="feed-identity"><span className="feed-monogram" aria-hidden="true">{r.symbol.slice(0, 4)}</span><span className="candidate-name"><strong className="mono">{r.symbol}</strong><small title={r.company_name}>{r.company_name || '企業名未配信'}</small><span className="feed-state-date">{date ? `${date} 終値時点` : '基準日 未確認'}</span></span><span className="feed-price"><strong className="mono">{money(p.price)}</strong><small>{signed(r.price_change_1d)} 前日比</small></span></span>
  </button>
  <div className="feed-card-evidence">
   <CandidateCurrentState assessment={a} readiness={readiness} plan={p} annual={annual}/>
   <div className="feed-growth">{growth.map(row => <FinancialGrowthMetric key={row.id} row={row} compact/>)}</div>
   {nearOnly && <span className="feed-missing" data-state={missing?.state || 'unknown'}>{missing?.text || '判定資料を再確認'}</span>}
   <div className="feed-next-check" data-state={nextCheck?.state || 'unknown'}><strong>次に確認</strong><span>{nextLabel}</span></div>
   {otherCount > 0 && <details className="feed-other-checks"><summary>未達・未確認の内訳 <span>{otherCount}条件</span></summary><div aria-label="未達・未確認の内訳">
    {otherSelection.length > 0 && <div className="feed-blocker-group"><strong>選定条件</strong>{otherSelection.map((rule, index) => <span key={rule.id || `${rule.label}:${index}`} data-rule-id={rule.id} data-state={rule.state}>{unresolvedLabel(rule)}</span>)}</div>}
    {otherDaily.length > 0 && <div className="feed-blocker-group"><strong>日次確認</strong>{otherDaily.map(rule => <span key={rule.id} data-rule-id={rule.id} data-state={rule.state}>{unresolvedLabel(rule)}</span>)}</div>}
   </div></details>}
   <CandidatePriceTrace key={`${date}:${r.priceTrace?.src || r.symbol}`} trace={r.priceTrace} date={date} symbol={r.symbol}/>
   <div className="feed-observed-metrics"><span>RS <strong>{Number.isFinite(r.rs_rating) ? Math.round(r.rs_rating) : '未確認'}</strong></span><span>日次出来高 <strong>{times(volume)}</strong></span><span>ピボット <strong>{money(p.pivot)}</strong></span></div>
  </div>
  <footer className="feed-card-footer"><button className="feed-open-evidence" onClick={() => onSelect(r.symbol)} aria-label={`${r.symbol} の財務・日次根拠を見る`}>根拠を見る <span aria-hidden="true">↗</span></button><div>{onCompare && <button onClick={() => onCompare(r.symbol)} aria-label={`${r.symbol} のチャートを開く`}><span aria-hidden="true">▥</span> チャート</button>}{onWatch && <button className="feed-watch" onClick={() => onWatch(r.symbol)} aria-label={`${r.symbol} ${watched ? 'ウォッチ解除' : 'ウォッチに保存'}`} aria-pressed={watched}><span aria-hidden="true">{watched ? '★' : '☆'}</span><span>{watched ? '保存済み' : 'ウォッチ'}</span></button>}</div></footer>
 </article>;
});
