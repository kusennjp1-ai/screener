import { useMemo, useState } from 'react';
import { useMediaQuery, Drawer, IconButton } from '@mui/material';
import SetupRadar from './SetupRadar';
import PortfolioDecision from './PortfolioDecision';
import DailyChanges from './DailyChanges';
import { entryPlan } from '../researchEngine';
export default function ResearchHero({rows,ranked,date,plan,selectedSymbol,onSelect,onInspect,onInspectChanged=onInspect,onBrowse,workbench,method,availableSymbols,loading=false}) {
 const small=useMediaQuery('(max-width:700px)');
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('research-hero-collapsed')==='true';}catch{return false;}});
 const [changesOpen,setChangesOpen]=useState(false);
 const counts=useMemo(()=>({qualified:ranked.filter(x=>x.assessment.qualified).length,zone:ranked.filter(x=>x.assessment.qualified&&entryPlan(x.row,null,'minervini').state==='買いゾーン内').length,verified:ranked.filter(x=>x.row.technical_audit?.valid===true).length}),[ranked]);
 const toggle=()=>{setCollapsed(!collapsed);try{localStorage.setItem('research-hero-collapsed',String(!collapsed));}catch{/* Default remains usable when storage is disabled. */}};
 const changes=workbench.data?.changes?.[method];
 const first=!workbench.data?.history?.previous_as_of;
 return <section data-testid="home-hero" className={`research-hero${collapsed?' hero-collapsed':''}`} aria-label="今日の概況">
  <div className="hero-copy"><p className="hero-date">{date||'取得中'} 終値 · 米国株 日次判断</p>
   <h1>{loading?'データを読み込み中。':plan.dailyPositions.length?`${plan.dailyPositions.length}銘柄が条件通過。`:counts.qualified?'候補あり。':'条件を確認中。'}</h1>
   <p className="hero-subtitle">発注前に、未達の条件を確かめる。</p>
   <div className="hero-kpis">
    <div><small>条件通過</small><strong className="mono">{loading?'—':counts.qualified}<em> / {loading?'—':ranked.length.toLocaleString()}</em></strong></div>
    <div><small>買いゾーン内</small><strong className="mono zone-text">{loading?'—':counts.zone}</strong></div>
    <div><small>日足検証</small><strong className="mono">{ranked.length?`${(counts.verified/ranked.length*100).toFixed(small?0:1)}%`:'—'}</strong></div>
    <div><small>市場 · 新規上限 {loading?'—':Math.round(plan.allocationCap*100)}%</small><strong className="hero-market">{plan.market.label.replace('（独自判定）','')}</strong></div>
   </div>
   <div className="hero-actions"><PortfolioDecision compact rows={rows} date={date} plan={plan} onInspect={onInspect} onBrowse={onBrowse} renderTrigger={({openPlan,label})=><button onClick={openPlan} aria-haspopup="dialog" aria-label={label}><span className="desktop-plan-label">{label}</span><span className="mobile-plan-label">配分</span></button>}/><a href="#/breadth?tab=sectors">業種の追い風を見る →</a></div>
   <button className="changes-trigger" onClick={()=>setChangesOpen(true)}>{workbench.isError?'変化：取得できません':first?'変化：記録開始（次回から）':`変化：新たに通過 ${changes?.counts?.new??'—'} · 再通過 ${changes?.counts?.returned??'—'} · 脱落 ${changes?.counts?.dropped??'—'}`}</button>
  </div>
  {(!collapsed||small)&&<SetupRadar ranked={ranked} selectedSymbol={selectedSymbol} onSelect={onSelect} small={small}/>}
  <button className="hero-toggle" aria-expanded={!collapsed} aria-label={collapsed?'概況を展開':'概況をたたむ'} onClick={toggle}>{collapsed?'⌄':'⌃'}</button>
  <Drawer anchor="right" open={changesOpen} onClose={()=>setChangesOpen(false)} PaperProps={{role:'dialog','aria-modal':true,'aria-labelledby':'daily-changes-title',sx:{width:{xs:'100%',sm:520},p:3}}}>
   <header className="drawer-title"><h2 id="daily-changes-title">候補の日次変化</h2><IconButton aria-label="候補の変化を閉じる" onClick={()=>setChangesOpen(false)}>×</IconButton></header>
   <DailyChanges query={workbench} method={method} onSelect={ticker=>{setChangesOpen(false);onInspectChanged(ticker);}} availableSymbols={availableSymbols}/>
  </Drawer>
 </section>;
}
