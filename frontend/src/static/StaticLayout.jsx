import { useContext, useMemo } from 'react';
import { AppBar, Box, Button, Chip, Container, FormControl, MenuItem, Select, Toolbar, Typography, IconButton, useTheme } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { ColorModeContext } from '../contexts/ColorModeContext';
import { useStaticMarket } from './StaticMarketContext';
import { getStaticSupportedMarkets, resolveStaticMarketEntry, useStaticManifest } from './dataClient';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import './research.css';
import { marketFlag } from './marketFlags';

const NAV_ITEMS = [
  { path: '/', label: '本日の判断' },
  { path: '/scan', label: '詳細スキャン' },
  { path: '/breadth', label: '市場環境' },
];
export default function StaticLayout({ children }) {
  const location = useLocation();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const deskTheme = useMemo(() => createTheme(theme, { palette: { primary: { main: dark ? '#a399ff' : '#6555dc' }, background: { paper: dark ? '#171c27' : '#ffffff' }, success: { main: dark ? '#6dd5b8' : '#16856e' }, error: { main: dark ? '#f599a1' : '#ba3e50' } } }), [theme, dark]);
  const colorMode = useContext(ColorModeContext);
  const manifest = useStaticManifest();
  const markets = getStaticSupportedMarkets(manifest.data);
  const { selectedMarket, setSelectedMarket } = useStaticMarket();
  const market = resolveStaticMarketEntry(manifest.data, selectedMarket);
  return <ThemeProvider theme={deskTheme}><Box className="leader-shell" data-theme={dark ? 'dark' : 'light'} sx={{ minHeight: '100vh', bgcolor: dark ? '#10131b' : '#f3f5fa' }}>
    <AppBar position="sticky" elevation={0} sx={{ bgcolor: dark ? '#141925' : '#fff', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', pt: 'env(safe-area-inset-top, 0px)' }}>
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, flexWrap: 'wrap', gap: { xs: 1, md: 3 }, px: { xs: 2, md: 3 } }}>
        <Box component={RouterLink} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: 'inherit', mr: { md: 2 } }}>
          <Box sx={{ width: 30, height: 30, borderRadius: '10px', bgcolor: dark ? '#a399ff' : '#6555dc', color: dark ? '#171329' : '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontFamily: 'monospace', fontSize: 18 }}>L</Box>
          <Typography sx={{ fontWeight: 700, letterSpacing: '.06em', fontSize: 14 }}>LEADER <Box component="span" sx={{ fontWeight: 400, opacity: .7 }}>RESEARCH</Box></Typography>
        </Box>
        <Box component="nav" aria-label="メインナビゲーション" sx={{ display: 'flex', order: { xs: 3, md: 0 }, width: { xs: '100%', md: 'auto' }, overflowX: 'auto', alignSelf: 'stretch', gap: .5 }}>
          {NAV_ITEMS.map(item => <Button key={item.path} component={RouterLink} to={item.path} aria-current={location.pathname === item.path ? 'page' : undefined} sx={{ flexShrink: 0, color: location.pathname === item.path ? (dark ? '#c2bbff' : '#6555dc') : 'text.secondary', borderRadius: 2, my: 1, bgcolor: location.pathname === item.path ? (dark ? 'rgba(163,153,255,.13)' : 'rgba(101,85,220,.08)') : 'transparent', fontSize: 13, px: 1.5, py: 1.1 }}>{item.label}</Button>)}
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label="米国株 / 日次分析" size="small" variant="outlined" sx={{ display: { xs: 'none', sm: 'flex' }, fontSize: 12, borderRadius: 1 }} />
          {location.pathname !== '/' && markets.length > 1 && <FormControl size="small"><Select value={market.market} onChange={e => setSelectedMarket(e.target.value)} inputProps={{ 'aria-label': 'Static market selector' }}>{markets.map(m => <MenuItem key={m} value={m}>{marketFlag(m)} {manifest.data?.markets?.[m]?.display_name || m}</MenuItem>)}</Select></FormControl>}
          <IconButton onClick={colorMode.toggleColorMode} aria-label={dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'} size="small">{dark ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}</IconButton>
        </Box>
      </Toolbar>
    </AppBar>
    <Container maxWidth={false} sx={{ px: { xs: 1.5, sm: 3 }, pb: 3, maxWidth: 1920 }}>{children}</Container>
  </Box></ThemeProvider>;
}
