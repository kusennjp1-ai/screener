import { useCallback, useContext, useMemo, useEffect, useState } from 'react';
import { Box, IconButton, useTheme } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import GridViewIcon from '@mui/icons-material/GridView';
import BarChartIcon from '@mui/icons-material/BarChart';
import { ColorModeContext } from '../contexts/ColorModeContext';
import { getStaticSupportedMarkets, resolveStaticMarketEntry, useStaticManifest } from './dataClient';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { researchTheme, themeCss } from './theme/tokens';
import { formatPublished } from './researchPresentation';
import ResearchSearch from './components/ResearchSearch';
import { useStaticMarket } from './StaticMarketContext';
import './research.css';
import './theme/foundation.css';
import './workbench.css';
const NAV_ITEMS=[{path:'/',label:'本日の判断',Icon:ShowChartIcon},{path:'/compare',label:'比較',Icon:GridViewIcon},{path:'/breadth',label:'市場',Icon:BarChartIcon}];
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
 return <ThemeProvider theme={deskTheme}><style>{themeCss}</style><Box className="leader-shell" data-theme={dark?'dark':'light'}>
  <header className="leader-header">
   <RouterLink to="/" className="leader-logo"><ShowChartIcon/><span>LEADER <em>RESEARCH</em></span></RouterLink>
   <button className="mobile-header-back" onClick={()=>window.dispatchEvent(new CustomEvent('research:back'))}>← 候補一覧</button>
   <nav className="leader-desktop-nav" aria-label="メインナビゲーション">{NAV_ITEMS.map(({path,label})=><RouterLink key={path} to={path} aria-current={current===path?'page':undefined}>{label}</RouterLink>)}</nav>
   <div className="header-search">{['/','/compare'].includes(location.pathname)&&<ResearchSearch value={search} onChange={changeSearch}/>}</div>
   {!['/','/compare'].includes(location.pathname)&&markets.length>1&&<select className="header-market" aria-label="市場切替" value={market.market} onChange={e=>setSelectedMarket(e.target.value)}>{markets.map(key=><option value={key} key={key}>{manifest.data?.markets?.[key]?.display_name||key}</option>)}</select>}
   <div className="header-dates"><span>分析 {market.as_of_date||'取得中'}</span><span>公開 {formatPublished(manifest.data?.generated_at)}</span></div>
   <IconButton onClick={colorMode.toggleColorMode} aria-label={dark?'ライトモードに切り替え':'ダークモードに切り替え'}>{dark?<Brightness7Icon fontSize="small"/>:<Brightness4Icon fontSize="small"/>}</IconButton>
  </header>
  <div className="leader-content">{children}</div>
  <nav className="leader-mobile-nav mobile-bottom-nav" aria-label="モバイルナビゲーション">{NAV_ITEMS.map(({path,label,Icon})=><RouterLink key={path} to={path} aria-current={current===path?'page':undefined}><Icon/><span>{label}</span></RouterLink>)}</nav>
 </Box></ThemeProvider>;
}
