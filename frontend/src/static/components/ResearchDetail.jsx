import { memo, forwardRef, useState } from 'react';
import { Alert, Button } from '@mui/material';
import { assess, entryPlan, finite } from '../researchEngine';
import { tradingViewUrl } from '../tradingView';
import ResearchChart from './ResearchChart';
import QualificationVerification from './QualificationVerification';
import QuoteConnection from './QuoteConnection';
import FinancialHistory from './FinancialHistory';
import InstitutionalEvidence from './InstitutionalEvidence';
import EntryCard, { StateChip } from './EntryCard';
import { entryReadiness } from '../entryReadiness';
import { money, signed, times } from '../positionGeometry';
const TABS={evidence:'判定根拠',conditions:'購入条件',financial:'財務・機関',book:'書籍検証',notes:'メモ'};
function SymbolNotes({symbol}) {
 const [text,setText]=useState(()=>{try{return localStorage.getItem(`research-note-${symbol}`)||'';}catch{return '';}}),[error,setError]=useState(false);
 return <label className="symbol-notes">{symbol} のメモ（この端末に保存）<textarea value={text} rows={5} onChange={e=>{setText(e.target.value);try{localStorage.setItem(`research-note-${symbol}`,e.target.value);}catch{setError(true);}}}/>{error&&<span>保存できません。この画面を閉じると失われます。</span>}</label>;
}
const ResearchDetail = memo(forwardRef(function ResearchDetail({selected,method,usableQuote,date,market,now,chartEntry,version,onExpand,watch,onWatch,liveStatus,personalKey,personal,onConnect,onDisconnect,onVerificationToggle,detail,onVerified}, detailRef) {
 const [tab,setTab]=useState('evidence'),[connecting,setConnecting]=useState(false);
 const checks=selected?assess(selected,method):null,plan=selected?entryPlan(selected,usableQuote,method):null,readiness=selected?entryReadiness(selected,date,market,now):null;
 const choose=value=>{setTab(value);if(['financial','book'].includes(value))onVerificationToggle(selected.symbol);};
 const showConditions=()=>{choose('conditions');requestAnimationFrame(()=>document.getElementById('research-detail-tabs')?.scrollIntoView({block:'nearest'}));};
 return <div role="region" className="research-detail" ref={detailRef} tabIndex={-1} aria-label="銘柄詳細">
  {selected&&<>
   <header className="research-symbol-head">
    <div className="symbol-identity"><div className="symbol-title"><h2 className="mono">{selected.symbol}</h2><span className="exchange-tag">{selected.exchange||'US'}</span><StateChip state={plan.state}/><button className="readiness-chip" onClick={showConditions}>購入条件 {readiness.passed}/{readiness.total}</button></div><p title={selected.company_name}>{selected.company_name||'企業名未配信'} <span>· {selected.ibd_industry_group||'業種未確認'}</span></p></div>
    <div className="research-symbol-price"><strong className="mono">{money(plan.price)}</strong><span style={{color:finite(selected.price_change_1d)?`var(--${selected.price_change_1d>=0?'zone':'neg'})`:'var(--text-3)'}}>{signed(selected.price_change_1d)} <em>前日比 · {usableQuote?.as_of?new Date(usableQuote.as_of).toLocaleString('ja-JP'):`${date||'未確認'} 終値`}</em></span></div>
    <button className="watch-button" onClick={()=>onWatch(selected.symbol)} aria-label={`${selected.symbol} ${watch.includes(selected.symbol)?'ウォッチ解除':'ウォッチに保存'}`} aria-pressed={watch.includes(selected.symbol)}>{watch.includes(selected.symbol)?'★':'☆'}</button>
   </header>
   <ResearchChart method={method} quote={usableQuote} date={date} market={market} now={now} row={selected} rsRating={selected.rs_rating} entry={chartEntry} symbol={selected.symbol} generation={version} onExpand={onExpand}/>
   <EntryCard plan={plan} readiness={readiness} onConditions={showConditions} onConnect={()=>{setConnecting(!connecting);choose('conditions');}}/>
   <section className="research-evidence">
    <div id="research-detail-tabs" className="detail-tabs" role="tablist" aria-label="銘柄の詳細情報">{Object.entries(TABS).map(([key,label])=><button role="tab" key={key} id={`detail-tab-${key}`} aria-selected={tab===key} aria-controls={`detail-panel-${key}`} tabIndex={tab===key?0:-1} onClick={()=>choose(key)} onKeyDown={e=>{const keys=Object.keys(TABS),index=keys.indexOf(tab);let target;if(e.key==='ArrowRight')target=keys[(index+1)%keys.length];if(e.key==='ArrowLeft')target=keys[(index-1+keys.length)%keys.length];if(e.key==='Home')target=keys[0];if(e.key==='End')target=keys.at(-1);if(target){e.preventDefault();choose(target);document.getElementById(`detail-tab-${target}`)?.focus();}}}>{label}</button>)}</div>
    <div className="detail-panel" role="tabpanel" id={`detail-panel-${tab}`} aria-labelledby={`detail-tab-${tab}`} tabIndex={0}>
     {tab==='evidence'&&<><h3>選定 {checks.passed}/{checks.total} · 未確認 {checks.unknown}</h3><ul className="research-rules">{checks.rules.map(r=><li key={r.label}><span>{r.label}{r.evidence&&<small>{r.evidence}</small>}</span><span style={{color:`var(--${r.state==='pass'?'zone':r.state==='fail'?'neg':'text-3'})`}}>{r.state==='pass'?'✓ 通過':r.state==='fail'?'× 未達':'? 未確認'}{finite(r.value)?` · ${r.value.toLocaleString('ja-JP',{maximumFractionDigits:2})}${r.unit}`:''}</span></li>)}</ul><p>選定の一次条件です。購入条件とは別に確認します。RS・EPS・Composite・業種順位は独自推計。未確認は合格に数えません。</p>{checks.templateMismatch&&<Alert severity="warning">元の判定と日足再計算が不一致です。再計算した結果を使っています。</Alert>}<a href={tradingViewUrl(selected.symbol,'US')} target="_blank" rel="noopener noreferrer">TradingViewで確認 ↗</a></>}
     {tab==='conditions'&&<><h3>購入条件 {readiness.passed}/{readiness.total} · {liveStatus}</h3><ul className="research-rules condition-rules">{readiness.rules.map(r=><li key={r.id}><span><b>{r.state==='pass'?'✓':r.state==='fail'?'×':'?'} {r.label}</b><small>{r.detail}</small></span><span>{r.state==='pass'?'通過':r.state==='fail'?'未達':'未確認'}</span></li>)}</ul><p>出来高50日平均比 {times(selected.se_volume_vs_50d)} · VCP {selected.vcp_detected==null?'未確認':selected.vcp_detected?'検出':'未検出'}</p><Button onClick={()=>setConnecting(!connecting)} aria-expanded={connecting}>場中価格を接続する</Button>{connecting&&<QuoteConnection connected={Boolean(personalKey)} apiKey={personalKey} symbol={selected.symbol} cusip={selected.institutional_evidence?.cusip} status={personal.status} quote={personal.quote} onConnect={onConnect} onDisconnect={onDisconnect}/>}</>}
     {['financial','book'].includes(tab)&&<>{detail.isLoading&&<p role="status">詳細資料を読み込み中…</p>}{detail.isError&&<Alert severity="error" action={<Button onClick={()=>detail.refetch()}>再試行</Button>}>詳細資料を取得できません。合格とは扱いません。</Alert>}{(!selected.research_detail_path||detail.isSuccess)&&(tab==='financial'?<><FinancialHistory row={selected} date={date}/><InstitutionalEvidence row={selected} date={date}/></>:<QualificationVerification includeFinancial={false} row={selected} entry={chartEntry} date={date} generation={version} method={method} onVerified={onVerified}/>)}</>}
     {tab==='notes'&&<SymbolNotes key={selected.symbol} symbol={selected.symbol}/>}
    </div>
   </section>
  </>}
 </div>;
}));
export default ResearchDetail;
