import { useMemo, useState } from 'react';
import { useMediaQuery, Drawer, IconButton } from '@mui/material';
import SetupRadar from './SetupRadar';
import PortfolioDecision from './PortfolioDecision';
import DailyChanges from './DailyChanges';
import { entryPlan } from '../researchEngine';
import { useWorkbenchDetails } from '../useWorkbench';
import './researchOverview.css';

function ChangesContents({workbench, ...props}) {
 const query = useWorkbenchDetails(workbench, true);
 return <DailyChanges {...props} query={query}/>;
}
export default function ResearchHero({rows,ranked,date,plan,selectedSymbol,onSelect,onInspect,onInspectChanged=onInspect,onBrowse,workbench,method,availableSymbols,loading=false}) {
 const small=useMediaQuery('(max-width:700px)');
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('research-hero-collapsed')==='true';}catch{return false;}});
 const [changesOpen,setChangesOpen]=useState(false);
 const counts=useMemo(()=>({qualified:ranked.filter(x=>x.assessment.qualified).length,zone:ranked.filter(x=>x.assessment.qualified&&entryPlan(x.row,null,'minervini').state==='買いゾーン内').length,verified:ranked.filter(x=>x.row.technical_audit?.valid===true).length}),[ranked]);
 const toggle=()=>{setCollapsed(!collapsed);try{localStorage.setItem('research-hero-collapsed',String(!collapsed));}catch{/* Default remains usable when storage is disabled. */}};
 const changes=workbench.data?.changes?.[method];
 const first=!workbench.data?.history?.previous_as_of;
 return <section data-testid="home-hero" className={`research-hero research-overview${collapsed?' hero-collapsed':''}`} aria-label="今日の概況">
  <div className="hero-copy"><p className="hero-date">{date||'取得中'} 終値 · ミネルヴィニ概況</p>
   <h1><span className="overview-compact-scope">ミネルヴィニ</span>{loading?'データを読み込み中。':counts.qualified?`選定候補は ${counts.qualified.toLocaleString()} 銘柄。`:'選定候補はありません。'}</h1>
   <p className="hero-subtitle">候補を選び、買い位置と日次の購入条件を確認。</p>
   <div className="hero-kpis overview-steps" aria-label="選定から購入検討までの3段階">
    <div><small><span className="overview-step-number">1</span> 銘柄選定</small><strong className="mono">{loading?'—':counts.qualified.toLocaleString()}<em> / {loading?'—':ranked.length.toLocaleString()}</em></strong><span className="overview-step-note">ミネルヴィニ条件通過</span></div>
    <div><small><span className="overview-step-number">2</span> 買い位置</small><strong className="mono zone-text">{loading?'—':counts.zone.toLocaleString()}<em> 銘柄</em></strong><span className="overview-step-note">選定候補のうちゾーン内</span></div>
    <div><small><span className="overview-step-number">3</span> 日次の購入条件</small><strong className="overview-next-check">個別に確認 <span aria-hidden="true">→</span></strong><span className="overview-step-note">市場・出来高・決算など</span></div>
   </div>
   <p className="overview-market"><span>{plan.market.label.replace('（独自判定）','')} · 新規上限 {loading?'—':Math.round(plan.allocationCap*100)}%</span><span>日足検証 {loading||!ranked.length?'—':`${(counts.verified/ranked.length*100).toFixed(small?0:1)}%`}</span><a href="#/breadth?tab=sectors">業種の追い風を見る →</a></p>
   <div className="hero-actions"><PortfolioDecision compact rows={rows} date={date} plan={plan} onInspect={onInspect} onBrowse={onBrowse} renderTrigger={({openPlan,label})=><button onClick={openPlan} aria-haspopup="dialog" aria-label={label}><span className="desktop-plan-label">{label}</span><span className="mobile-plan-label">配分</span></button>}/>
   <button className="changes-trigger" aria-label="候補の日次変化" aria-haspopup="dialog" aria-expanded={changesOpen} onClick={()=>setChangesOpen(true)}><span className="changes-desktop">{workbench.isError?'変化：取得できません':!workbench.data?'変化：読み込み中':first?'変化：記録開始（次回から）':`変化：新たに通過 ${changes?.counts?.new??'—'} · 再通過 ${changes?.counts?.returned??'—'} · 脱落 ${changes?.counts?.dropped??'—'}`}</span><span className="changes-mobile">変化</span></button></div>
  </div>
  {(!collapsed||small)&&<SetupRadar ranked={ranked} selectedSymbol={selectedSymbol} onSelect={onSelect} small={small}/>}
  <button className="hero-toggle" aria-expanded={!collapsed} aria-label={collapsed?'概況を展開':'概況をたたむ'} onClick={toggle}>{collapsed?'⌄':'⌃'}</button>
  <Drawer anchor="right" open={changesOpen} onClose={()=>setChangesOpen(false)} PaperProps={{role:'dialog','aria-modal':true,'aria-labelledby':'daily-changes-title',sx:{width:{xs:'100%',sm:520},p:3}}}>
   <header className="drawer-title"><h2 id="daily-changes-title">候補の日次変化</h2><IconButton aria-label="候補の変化を閉じる" onClick={()=>setChangesOpen(false)}>×</IconButton></header>
   <ChangesContents workbench={workbench} method={method} onSelect={ticker=>{setChangesOpen(false);onInspectChanged(ticker);}} availableSymbols={availableSymbols}/>
  </Drawer>
 </section>;
}
