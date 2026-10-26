import { useCallback, useContext, useMemo, useEffect, useState } from 'react';
import { Box, IconButton, useTheme } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import GridViewIcon from '@mui/icons-material/GridView';
import BarChartIcon from '@mui/icons-material/BarChart';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import { ColorModeContext } from '../contexts/ColorModeContext';
import { getStaticSupportedMarkets, resolveStaticMarketEntry, useStaticManifest } from './dataClient';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { researchTheme, themeCss } from './theme/tokens';
import { formatPublished } from './researchPresentation';
import ResearchSearch from './components/ResearchSearch';
import LimitedResearchPreviewNotice from './components/LimitedResearchPreviewNotice';
import { useStaticMarket } from './StaticMarketContext';
import './research.css';
import './theme/foundation.css';
import './theme/motion.css';
import './workbench.css';
import './leaderFeed.css';
import './workspace.css';
const NAV_ITEMS=[{path:'/',label:'本日の判断',Icon:ShowChartIcon},{path:'/compare',label:'比較',Icon:GridViewIcon},{path:'/breadth',label:'市場',Icon:BarChartIcon}];
const MOBILE_ITEMS=[{path:'/',label:'市場',Icon:GridViewIcon},{path:'/?mobile=chart',label:'チャート',Icon:ShowChartIcon},{path:'/?mobile=watch',label:'ウォッチ',Icon:BookmarkBorderIcon}];
export default function StaticLayout({children}) {
 const location=useLocation(),theme=useTheme(),dark=theme.palette.mode==='dark';
 const deskTheme=useMemo(()=>createTheme(theme,researchTheme(dark?'dark':'light')),[theme,dark]);
 useEffect(()=>{document.documentElement.dataset.theme=dark?'dark':'light';},[dark]);
 const colorMode=useContext(ColorModeContext),manifest=useStaticManifest();
 const {selectedMarket,setSelectedMarket}=useStaticMarket(),markets=getStaticSupportedMarkets(manifest.data);
 const market=resolveStaticMarketEntry(manifest.data,['/','/compare'].includes(location.pathname)?'US':selectedMarket);
 const [search,setSearch]=useState('');
 const changeSearch=useCallback(value=>{setSearch(value);window.dispatchEvent(new CustomEvent('research:search',{detail:value}));},[]);
 const current=location.pathname==='/compare'?'/compare':['/breadth','/groups','/scan'].includes(location.pathname)?'/breadth':'/';
 const workspaceTitle=current==='/compare'?'チャート比較':current==='/breadth'?'市場環境':'スクリーナー';
 return <ThemeProvider theme={deskTheme}><style>{themeCss}</style><Box className="leader-shell workspace-shell" data-theme={dark?'dark':'light'}>
  <a className="workspace-skip-link" href="#research-main-content" onClick={event=>{event.preventDefault();document.getElementById('research-main-content')?.focus();}}>メインコンテンツへ</a>
  <aside className="workspace-sidebar" aria-label="リサーチワークスペース">
   <RouterLink to="/" className="workspace-brand" aria-label="LEADER ホーム"><span className="workspace-brand-mark"><ShowChartIcon/></span><span>LEADER<small>RESEARCH WORKSPACE</small></span></RouterLink>
   <div className="workspace-context"><span className="workspace-context-mark" aria-hidden="true">{market.market||'US'}</span><span>{market.market==='US'?'米国株リサーチ':`${market.display_name||market.market||'市場'}リサーチ`}<small>日次スナップショット</small></span></div>
   <span className="workspace-nav-caption">WORKSPACE</span>
   <nav className="leader-desktop-nav" aria-label="メインナビゲーション">{NAV_ITEMS.map(({path,label,Icon})=><RouterLink key={path} to={path} aria-current={current===path?'page':undefined}><Icon aria-hidden="true"/><span>{label}</span><span className="workspace-nav-arrow" aria-hidden="true">›</span></RouterLink>)}</nav>
   <div className="workspace-sidebar-links"><span className="workspace-nav-caption">DISCOVER</span><RouterLink to="/breadth?tab=sectors">業種の強さ <span aria-hidden="true">↗</span></RouterLink><RouterLink to="/scan">詳細スキャン <span aria-hidden="true">↗</span></RouterLink></div>
   <div className="workspace-sidebar-note"><span className="workspace-note-icon" aria-hidden="true">◎</span><strong>根拠から、判断する。</strong><p>選定・買い位置・購入条件を<br/>それぞれ確認。</p><span>分析 {market.as_of_date||'未確認'}</span></div>
  </aside>
  <header className="leader-header">
   <RouterLink to="/" className="leader-logo"><ShowChartIcon/><span>LEADER <em>RESEARCH</em></span></RouterLink>
   <div className="workspace-breadcrumb"><span>リサーチ</span><span aria-hidden="true">/</span><strong>{workspaceTitle}</strong></div>
   <button className="mobile-header-back" onClick={()=>window.dispatchEvent(new CustomEvent('research:back'))}>← 候補一覧</button>
   <div id="research-mobile-instrument-context" className="mobile-instrument-context"/>
   <div className="header-search">{['/','/compare'].includes(location.pathname)&&<ResearchSearch value={search} onChange={changeSearch}/>}</div>
   {!['/','/compare'].includes(location.pathname)&&markets.length>1&&<select className="header-market" aria-label="市場切替" value={market.market} onChange={e=>setSelectedMarket(e.target.value)}>{markets.map(key=><option value={key} key={key}>{manifest.data?.markets?.[key]?.display_name||key}</option>)}</select>}
   <div className="header-dates"><span>分析 {market.as_of_date||'取得中'}</span><span>公開 {formatPublished(manifest.data?.generated_at)}</span></div>
   <IconButton onClick={colorMode.toggleColorMode} aria-label={dark?'ライトモードに切り替え':'ダークモードに切り替え'}>{dark?<Brightness7Icon fontSize="small"/>:<Brightness4Icon fontSize="small"/>}</IconButton>
  </header>
  <LimitedResearchPreviewNotice />
  <div id="research-main-content" tabIndex={-1} className="leader-content">{children}</div>
  <nav className="leader-mobile-nav mobile-bottom-nav" aria-label="モバイルナビゲーション">{MOBILE_ITEMS.map(({path,label,Icon})=><RouterLink key={path} to={path} aria-current={current==='/breadth' && path==='/'?'page':undefined}><Icon/><span>{label}</span></RouterLink>)}</nav>
 </Box></ThemeProvider>;
}
