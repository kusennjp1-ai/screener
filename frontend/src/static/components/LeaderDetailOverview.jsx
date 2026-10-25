import { assess } from '../researchEngine';
import { auditValues, hasVerifiedDailyBars, verifiedVolumeRatio } from '../qualificationAudit';
import { bookFinancialCurrent } from '../bookFinancialCurrent';
import { money, signed, times } from '../positionGeometry';
import { DailyConditionStrip, RSRing } from './LeaderPost';
import PositionMeter from './PositionMeter';

const LABEL={pass:'達成',fail:'未達',unknown:'未確認',not_applicable:'対象外'};
const ICON={pass:'✓',fail:'×',unknown:'?',not_applicable:'—'};
const TREND_LABELS=['株価と150・200日線','150日線と200日線','200日線の上向き','50日線と長期線','株価と50日線','52週安値からの上昇','52週高値からの距離','RSの相対的な強さ'];
const show=value=>Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:2}):'データなし';
function stateOf(rules){return rules.some(r=>r.state==='fail')?'fail':rules.some(r=>r.state==='not_applicable')?'not_applicable':!rules.length||rules.some(r=>r.state!=='pass')?'unknown':'pass';}
function State({state}){return <span className="leader-detail-state" data-state={state}>{ICON[state]||'?'} {LABEL[state]||'未確認'}</span>;}
function detailTrend(row,method,date,now){
 const result=assess(row,method==='minervini2'?'minervini2':'minervini',now);
 const dated=Boolean(date)&&row.technical_audit?.as_of_date===date;
 const rules=result.rules.slice(0,8).map(rule=>!dated?{...rule,state:'unknown',value:null,evidence:'分析日と日足の基準日が一致しません。'}:rule);
 const integrity=dated?result.rules[8]:{state:'unknown',evidence:'分析日と日足の基準日が一致しません。'};
 return {rules,integrity,blocked:result.method_status,passed:rules.filter(r=>r.state==='pass').length};
}
export function LeaderDetailOverview({row,plan,readiness,date,method,now,onConditions}){
 const trend=detailTrend(row,method,date,now),find=id=>readiness.rules.find(rule=>rule.id===id)||{state:'unknown',detail:'データなし'};
 const change=date&&hasVerifiedDailyBars(row,date)?auditValues(row).change:null,volume=verifiedVolumeRatio(row,date);
 const openTrend=()=>{const target=document.getElementById('leader-trend-template');if(target){target.open=true;const summary=target.querySelector('summary');summary?.focus({preventScroll:true});target.scrollIntoView?.({block:'nearest'});}};
 const gates=[{label:'トレンド',state:trend.blocked==='not_applicable'?'not_applicable':trend.blocked?'unknown':stateOf([...trend.rules.slice(0,7),trend.integrity]),detail:'既存トレンド7項目と日足整合性。RSは別欄。'}, {label:'VCP',...find('shape'),detail:`形状候補の確認。VCP確定とは別です。${find('shape').detail}`},{label:'RS',...trend.rules[7]},{label:'出来高',...find('volume')},{label:'市場',...find('market')}];
 return <div className="leader-detail-overview">
  <p className="leader-detail-verdict">日次条件は <strong>{readiness.passed}/{readiness.total}</strong>。{readiness.ready?'すべて通過しています。発注前に最新情報を確認。':`未達 ${readiness.failed}・未確認 ${readiness.unknown}${readiness.notApplicable?`・対象外 ${readiness.notApplicable}`:''}があります。`}</p>
  <div className="leader-detail-metrics"><RSRing value={trend.rules[7]?.value}/><div><small>出来高比</small><strong>{Number.isFinite(volume)?times(volume):'データなし'}</strong></div><div><small>前日比（日次）</small><strong data-state={Number.isFinite(change)?change>=0?'pass':'fail':'unknown'}>{Number.isFinite(change)?signed(change):'データなし'}</strong></div><div className="leader-detail-position"><PositionMeter plan={plan}/><span>ピボット {money(plan.pivot)} · 上限 {money(plan.upper)}</span></div></div>
  <DailyConditionStrip readiness={readiness}/>
  <div className="leader-five-gates" role="group" aria-label="5つの関門：既存根拠の分類">{gates.map((gate,index)=><button key={index} type="button" onClick={index===0||index===2?openTrend:onConditions} aria-controls={index===0||index===2?'leader-trend-template':'research-detail-tabs'} title={gate.detail||gate.evidence||gate.label} aria-label={`${['トレンド','VCP・形状候補','RS','出来高','市場'][index]}：${LABEL[gate.state]||'未確認'}。${gate.detail||gate.evidence||''}`}><b>{['トレンド','VCP','RS','出来高','市場'][index]}</b><State state={gate.state}/></button>)}</div>
  <p className="leader-detail-caption">5分類は根拠の索引です。VCP欄は形状候補、RSはトレンド条件の独自推計。購入可否は日次7条件を別途確認。</p>
 </div>;
}
function QuarterTrend({rows,metric,label}){
 const values=rows.map(row=>row[metric]);
 if(values.length!==3||!values.every(Number.isFinite))return <span className="leader-quarter-missing">{label}：データなし</span>;
 const low=Math.min(...values),high=Math.max(...values),points=values.map((value,index)=>`${8+index*52},${high===low?22:36-(value-low)/(high-low)*28}`);
 return <svg viewBox="0 0 120 44" role="img" aria-label={`${label} ${rows.map((row,i)=>`${row.end} ${show(values[i])}%`).join('、')}`}><polyline points={points.join(' ')} fill="none" stroke="var(--accent)" strokeWidth="2"/>{points.map((point,i)=><circle key={rows[i].end} cx={point.split(',')[0]} cy={point.split(',')[1]} r="3" fill="var(--accent)"/>)}</svg>;
}
function TrendRing({rules,passed}){
 return <svg className="leader-trend-ring" viewBox="0 0 80 80" width="80" height="80" role="img" aria-label={passed==='—'?'Trend Template 対象外または適用未確認。参考内訳は展開して確認':`Trend Template ${passed}/8。未確認は達成に数えません`}>
 {rules.map((rule,index)=><circle key={index} cx="40" cy="40" r="31" fill="none" stroke={rule.state==='pass'?'var(--zone)':rule.state==='fail'?'var(--neg)':'var(--line)'} strokeWidth="6" pathLength="100" strokeDasharray="10 90" transform={`rotate(${-90+index*45} 40 40)`}/>)}<text x="40" y="45" textAnchor="middle" fill="currentColor" fontSize="16">{passed}/8</text></svg>;
}
export function LeaderDetailFundamentals({row,date,method,now,onEvidence}){
 const trend=detailTrend(row,method,date,now),data=row.book_financials||row.financial_historical?.book_financials,current=bookFinancialCurrent(data,row.symbol,date,now,row),report=current.report;
 const codeState=current.applicability.status==='not_applicable'?'not_applicable':current.current?report.code33:'unknown';
 const visible=report.rows.slice(-3);
 return <section className="leader-detail-fundamentals" aria-label="トレンドと業績の確認">
  <details id="leader-trend-template" className="leader-detail-trend"><summary><TrendRing rules={trend.blocked?trend.rules.map(rule=>({...rule,state:trend.blocked==='not_applicable'?'not_applicable':'unknown'})):trend.rules} passed={trend.blocked?'—':trend.passed}/><strong>{trend.blocked?'参考 · ':''}Trend Template <span className="sr-only">{trend.blocked?'—':trend.passed}/8</span>{trend.blocked&&<State state={trend.blocked==='not_applicable'?'not_applicable':'unknown'}/>}</strong><span>8条件の内訳</span></summary><p>ミネルヴィニ{method==='minervini2'?'（基本と原則）':''}の既存8条件。選択中の手法の最終判定や購入7条件とは別です。{trend.blocked?'株式手法への適用は未確認または対象外です。':''}</p><ol>{trend.rules.map((rule,index)=><li key={index} data-state={rule.state}><div><b>{TREND_LABELS[index]}</b><State state={rule.state}/></div><p>{rule.label}{Number.isFinite(rule.value)?` · ${show(rule.value)}${rule.unit||''}`:''}</p>{rule.evidence&&<small>{rule.evidence}</small>}</li>)}</ol><p>日足整合性（別項目）：<State state={trend.integrity.state}/></p><small>{trend.integrity.evidence}</small></details>
  <details className="leader-detail-code33" open><summary><strong>Code 33</strong><State state={codeState}/></summary><p>4四半期・3回連続改善の既存判定。EPS・売上は前年比、純利益率は水準を比較。SEPA全体の認定ではありません。</p><p>{current.current?'期間内の参考資料':codeState==='not_applicable'?'対象外・参考記録':'現在の業績確認は未確認。欠損・期限切れを達成に数えません。'}</p>{visible.length?<><div className="leader-quarter-trends">{[['epsYoY','EPS前年比'],['salesYoY','売上前年比'],['margin','純利益率']].map(([metric,label])=><div key={metric}><small>{label}</small><QuarterTrend rows={visible} metric={metric} label={label}/></div>)}</div><div className="leader-quarter-grid" role="table" aria-label="直近3四半期の表示（判定は4四半期）"><div role="row"><b role="columnheader">期末</b><b role="columnheader">EPS前年比</b><b role="columnheader">売上前年比</b><b role="columnheader">純利益率</b></div>{visible.map(quarter=><div role="row" key={quarter.end}><span role="rowheader">{quarter.end}</span>{['epsYoY','salesYoY','margin'].map(key=><span role="cell" key={key}>{show(quarter[key])}{Number.isFinite(quarter[key])?'%':''}</span>)}</div>)}</div><p>表示は直近3期。判定に使う4期以上の履歴・提出日は全根拠で確認。</p></>:<p>四半期推移：データなし</p>}<p className="leader-detail-caption">提供元 {report.source||'未確認'} · 基準日 {date||'未確認'} · 取得 {data?.retrieved_at||'未確認'}</p><button type="button" onClick={onEvidence}>業績の全根拠を見る</button></details>
 </section>;
}
