import { hasVerifiedDailyBars } from '../qualificationAudit.js';
import { applicabilityUniverse } from '../instrumentApplicability';
import { useMemo, useState, useId } from 'react';
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
export default function ResearchHero({rows,ranked,date,plan,selectedSymbol,onSelect,onInspect,onInspectChanged=onInspect,onBrowse,workbench,method,availableSymbols,loading=false,freshnessNotice=null,mobileView='list'}) {
 const small=useMediaQuery('(max-width:700px)');
 const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('research-hero-collapsed')==='true';}catch{return false;}});
 const [changesOpen,setChangesOpen]=useState(false);
 const [radarOpen,setRadarOpen]=useState(false);
 const [universeOpen,setUniverseOpen]=useState(false),universeId=useId();
 const universe=useMemo(()=>applicabilityUniverse(rows || ranked.map(item=>item.row)),[rows,ranked]);
 const counts=useMemo(()=>({qualified:ranked.filter(x=>x.assessment.qualified).length,zone:ranked.filter(x=>x.assessment.qualified&&entryPosition(x.row,null,'minervini').state==='買いゾーン内').length,verified:ranked.filter(x=>hasVerifiedDailyBars(x.row, date)).length}),[ranked,date]);
 const toggle=()=>{setCollapsed(!collapsed);try{localStorage.setItem('research-hero-collapsed',String(!collapsed));}catch{/* Default remains usable when storage is disabled. */}};
 const changes=dailyChangePresentation(workbench,method);
 return <section data-testid="home-hero" className={`research-hero research-overview${collapsed?' hero-collapsed':''}${freshnessNotice?' has-freshness':''}`} aria-label="今日の概況">
  <div className="hero-copy"><div className="leader-pinned-title"><span className="leader-pinned-icon" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M8 3h8l-1 6 4 4H5l4-4-1-6Z"/><path d="M12 13v8"/></svg></span><strong>本日の判断</strong><span className="leader-pinned-scope">固定 · ミネルヴィニ全候補</span><span className="leader-pinned-date">ミネルヴィニ · {date||'基準日未確認'}{date?' 終値':''}</span></div><p className="hero-date">{date||'取得中'} 終値 · ミネルヴィニ概況</p>
   <p className="leader-pinned-summary">選定 <strong>{loading?'—':counts.qualified.toLocaleString()}</strong> 銘柄 · 買い位置 <strong className="zone-text">{loading?'—':counts.zone.toLocaleString()} 銘柄</strong></p>
   <h1><span className="overview-compact-scope">ミネルヴィニ</span>{loading?'データを読み込み中。':counts.qualified?`選定候補は ${counts.qualified.toLocaleString()} 銘柄。`:'選定候補はありません。'}</h1>
   <p className="hero-subtitle">候補を選び、買い位置と日次の購入条件を確認。</p>
   <div className="hero-kpis overview-steps" aria-label="選定から購入検討までの3段階">
    <div><small><span className="overview-step-number">1</span> 銘柄選定</small><strong className="mono">{loading?'—':counts.qualified.toLocaleString()}<em> / {loading?'—':ranked.length.toLocaleString()}</em></strong><span className="overview-step-note">ミネルヴィニ条件通過</span></div>
    <div><small><span className="overview-step-number">2</span> 買い位置</small><strong className="mono zone-text">{loading?'—':counts.zone.toLocaleString()}<em> 銘柄</em></strong><span className="overview-step-note">選定候補のうちゾーン内</span></div>
    <div><small><span className="overview-step-number">3</span> 日次の購入条件</small><strong className="overview-next-check">個別に確認 <span aria-hidden="true">→</span></strong><span className="overview-step-note">市場・出来高・決算など</span></div>
   </div>
   <div className="overview-market"><div className="overview-market-data">
    <p className="overview-market-state"><span>{plan.market.label.replace('（独自判定）','')} · 新規上限 {loading?'—':Math.round(plan.allocationCap*100)}%</span><span>日足検証 {loading||!ranked.length?'—':`${counts.verified.toLocaleString()}/${ranked.length.toLocaleString()}（${(counts.verified/ranked.length*100).toFixed(small?0:1)}%）`}</span></p>

   </div><a href="#/breadth?tab=sectors">業種の追い風を見る →</a></div>
   {collapsed&&!small&&freshnessNotice}
   <div className="hero-actions">{small&&mobileView!=='list'&&<button onClick={onBrowse}>銘柄一覧</button>}<PortfolioDecision compact rows={rows} date={date} plan={plan} onInspect={onInspect} onBrowse={onBrowse} renderTrigger={({openPlan,label})=><button onClick={openPlan} aria-haspopup="dialog" aria-label={label}><span className="desktop-plan-label">{label}</span><span className="mobile-plan-label">配分</span></button>}/>
   <button className="changes-trigger" aria-label="候補の日次変化" aria-haspopup="dialog" aria-expanded={changesOpen} onClick={()=>setChangesOpen(true)}><span className="changes-desktop">{changes.label}</span><span className="changes-mobile">日次変化</span></button>{small&&<button className="mobile-radar-toggle" aria-expanded={radarOpen} aria-controls="mobile-setup-radar" onClick={()=>setRadarOpen(value=>!value)}>{radarOpen?'分布を閉じる':'分布を見る'}</button>}<button type="button" className="overview-universe-toggle" aria-label="対象内訳" aria-expanded={universeOpen} aria-controls={universeId} onClick={()=>setUniverseOpen(value=>!value)}><span>対象内訳</span><small>対象外 {loading?'—':universe.verified_fund_exclusions.length} · 保留 {loading?'—':universe.identity_quarantines.length}</small></button></div>
    {<p id={universeId} hidden={!universeOpen} className="overview-universe" data-universe-version={universe.version}>{loading?'対象内訳を読み込み中':<>価格・流動性対象 {universe.price_liquidity_count.toLocaleString()}件 · 企業財務判定の対象 {universe.financial_applicable_count.toLocaleString()}件{universe.verified_fund_exclusions.length>0&&<>（確認済みファンド {universe.verified_fund_exclusions.map(item=>item.symbol).join("・")} は対象外）</>}{universe.identity_quarantines.length>0&&<>（識別情報不整合 {universe.identity_quarantines.map(item=>item.symbol).join("・")} は財務判定を保留）</>}</>}</p>}
  </div>
  {(!collapsed||small)&&freshnessNotice}
  {small?(radarOpen&&<div id="mobile-setup-radar" className="overview-radar"><SetupRadar ranked={ranked} selectedSymbol={selectedSymbol} onSelect={onSelect} small/></div>):(!collapsed&&<SetupRadar ranked={ranked} selectedSymbol={selectedSymbol} onSelect={onSelect}/>)}
  <button className="hero-toggle" aria-expanded={!collapsed} aria-label={collapsed?'概況を展開':'概況をたたむ'} onClick={toggle}>{collapsed?'⌄':'⌃'}</button>
  <Drawer anchor="right" open={changesOpen} onClose={()=>setChangesOpen(false)} PaperProps={{className:'research-safe-drawer',role:'dialog','aria-modal':true,'aria-labelledby':'daily-changes-title',sx:{width:{xs:'100%',sm:520},p:3}}}>
   <header className="drawer-title"><h2 id="daily-changes-title">候補の日次変化</h2><IconButton aria-label="候補の変化を閉じる" onClick={()=>setChangesOpen(false)}>×</IconButton></header>
   <ChangesContents workbench={workbench} method={method} onSelect={ticker=>{setChangesOpen(false);onInspectChanged(ticker);}} availableSymbols={availableSymbols}/>
  </Drawer>
 </section>;
}
