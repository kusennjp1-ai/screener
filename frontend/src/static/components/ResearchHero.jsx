import { useMemo, useState } from 'react';
import { useMediaQuery, Drawer, IconButton } from '@mui/material';
import SetupRadar from './SetupRadar';
import PortfolioDecision from './PortfolioDecision';
import DailyChanges from './DailyChanges';
import { entryPosition } from '../researchEngine';
import { useWorkbenchDetails } from '../useWorkbench';
import { dailyChangePresentation } from '../dailyChangePresentation';
import './researchOverview.css';

function ChangesContents({workbench, ...props}) {
 const query = useWorkbenchDetails(workbench, true);
 return <DailyChanges {...props} query={query}/>;
}
export default function ResearchHero({rows,ranked,date,plan,selectedSymbol,onSelect,onInspect,onInspectChanged=onInspect,onBrowse,workbench,method,availableSymbols,loading=false}) {
 const small=useMediaQuery('(max-width:700px)');
 const [collapsed,setCollapsed]=useState(true);
 const [changesOpen,setChangesOpen]=useState(false);
 const counts=useMemo(()=>({qualified:ranked.filter(x=>x.assessment.qualified).length,zone:ranked.filter(x=>x.assessment.qualified&&entryPosition(x.row,null,'minervini').state==='買いゾーン内').length,verified:ranked.filter(x=>x.row.technical_audit?.valid===true).length}),[ranked]);
 const toggle=()=>setCollapsed(value=>!value);
 const changes=dailyChangePresentation(workbench,method);
 return <section data-testid="home-hero" className={`research-hero research-overview${collapsed?' hero-collapsed':''}`} aria-label="今日の概況">
  <div className="market-context-strip">
   <div className="market-context-date"><strong>{date||'取得中'} 終値</strong><span>{plan.market.label.replace('（独自判定）','')}</span></div>
   <h1 className="sr-only">{loading?'データを読み込み中。':counts.qualified?`選定候補は ${counts.qualified.toLocaleString()} 銘柄。`:'選定候補はありません。'}</h1>
   <div className="market-context-counts" aria-label="ミネルヴィニの選定と価格位置"><span>ミネルヴィニ · トレンド通過 <strong>{loading?'—':counts.qualified.toLocaleString()}</strong></span><span>価格ゾーン内 <strong className="zone-text">{loading?'—':counts.zone.toLocaleString()} 銘柄</strong></span></div>
   <div className="hero-actions">
    <button className="overview-trigger" aria-expanded={!collapsed} aria-controls="research-market-overview" aria-label={collapsed?'概況を展開':'概況をたたむ'} onClick={toggle}>概況 {collapsed?'⌄':'⌃'}</button>
    <button className="changes-trigger" aria-label="候補の日次変化" aria-haspopup="dialog" aria-expanded={changesOpen} title={changes.label} onClick={()=>setChangesOpen(true)}>変化<span className="changes-desktop sr-only">{changes.label}</span></button>
    <PortfolioDecision compact rows={rows} date={date} plan={plan} onInspect={onInspect} onBrowse={onBrowse} renderTrigger={({openPlan,label})=><button onClick={openPlan} aria-haspopup="dialog" aria-label={label}>配分</button>}/>
   </div>
  </div>
  {!collapsed&&<div id="research-market-overview" className="market-overview-expanded">
   <div className="overview-explanation"><p>{date||'取得中'} 終値 · ミネルヴィニ概況</p><p>トレンド8条件と日足品質1条件の選定です。財務の成長根拠と日次の購入条件は個別に確認します。</p><p className="overview-market"><span>新規上限 {loading?'—':Math.round(plan.allocationCap*100)}%</span><span>日足検証 {loading||!ranked.length?'—':`${(counts.verified/ranked.length*100).toFixed(small?0:1)}%`}</span><a href="#/breadth?tab=sectors">業種の追い風を見る →</a></p></div>
   <SetupRadar ranked={ranked} selectedSymbol={selectedSymbol} onSelect={onSelect} small={small}/>
  </div>}
  <Drawer anchor="right" open={changesOpen} onClose={()=>setChangesOpen(false)} PaperProps={{role:'dialog','aria-modal':true,'aria-labelledby':'daily-changes-title',sx:{width:{xs:'100%',sm:520},p:3}}}>
   <header className="drawer-title"><h2 id="daily-changes-title">候補の日次変化</h2><IconButton aria-label="候補の変化を閉じる" onClick={()=>setChangesOpen(false)}>×</IconButton></header>
   <ChangesContents workbench={workbench} method={method} onSelect={ticker=>{setChangesOpen(false);onInspectChanged(ticker);}} availableSymbols={availableSymbols}/>
  </Drawer>
 </section>;
}
