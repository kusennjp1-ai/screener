import { useContext } from 'react';
import { AppBar, Box, Button, Chip, Container, FormControl, MenuItem, Select, Toolbar, Typography, IconButton, useTheme } from '@mui/material';
import { Link as RouterLink, useLocation } from 'react-router-dom';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { ColorModeContext } from '../contexts/ColorModeContext';
import { useStaticMarket } from './StaticMarketContext';
import { getStaticSupportedMarkets, resolveStaticMarketEntry, useStaticManifest } from './dataClient';
import { marketFlag } from './marketFlags';

const NAV_ITEMS = [
  { path: '/', label: 'リサーチ' },
  { path: '/daily', label: 'デイリー' },
  { path: '/scan', label: '詳細スキャン' },
  { path: '/breadth', label: '市場環境' },
  { path: '/groups', label: '業種ランキング' },
];
export default function StaticLayout({ children }) {
  const location = useLocation();
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const colorMode = useContext(ColorModeContext);
  const manifest = useStaticManifest();
  const markets = getStaticSupportedMarkets(manifest.data);
  const { selectedMarket, setSelectedMarket } = useStaticMarket();
  const market = resolveStaticMarketEntry(manifest.data, selectedMarket);
  return <Box sx={{ minHeight: '100vh', bgcolor: dark ? '#101318' : '#f3f5f7' }}>
    <AppBar position="sticky" elevation={0} sx={{ bgcolor: dark ? '#14181e' : '#fff', color: 'text.primary', borderBottom: '1px solid', borderColor: 'divider', pt: 'env(safe-area-inset-top, 0px)' }}>
      <Toolbar sx={{ minHeight: { xs: 56, sm: 64 }, flexWrap: 'wrap', gap: { xs: 1, md: 3 }, px: { xs: 2, md: 3 } }}>
        <Box component={RouterLink} to="/" sx={{ display: 'flex', alignItems: 'center', gap: 1.25, textDecoration: 'none', color: 'inherit', mr: { md: 2 } }}>
          <Box sx={{ width: 30, height: 30, border: '1px solid #d4ac61', color: '#d4ac61', display: 'grid', placeItems: 'center', fontWeight: 800, fontFamily: 'monospace', fontSize: 18 }}>L</Box>
          <Typography sx={{ fontWeight: 700, letterSpacing: '.06em', fontSize: 14 }}>LEADER <Box component="span" sx={{ fontWeight: 400, opacity: .7 }}>RESEARCH</Box></Typography>
        </Box>
        <Box component="nav" aria-label="メインナビゲーション" sx={{ display: 'flex', order: { xs: 3, md: 0 }, width: { xs: '100%', md: 'auto' }, overflowX: 'auto', alignSelf: 'stretch', gap: .5 }}>
          {NAV_ITEMS.map(item => <Button key={item.path} component={RouterLink} to={item.path} aria-current={location.pathname === item.path ? 'page' : undefined} sx={{ flexShrink: 0, color: location.pathname === item.path ? (dark ? '#e1bd80' : '#72501c') : 'text.secondary', borderRadius: 0, borderBottom: location.pathname === item.path ? '2px solid #d4ac61' : '2px solid transparent', fontSize: 13, px: 1.5, py: 1.5 }}>{item.label}</Button>)}
        </Box>
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip label="米国株 / 日次分析" size="small" variant="outlined" sx={{ display: { xs: 'none', sm: 'flex' }, fontSize: 12, borderRadius: 1 }} />
          {markets.length > 1 && <FormControl size="small"><Select value={market.market} onChange={e => setSelectedMarket(e.target.value)} inputProps={{ 'aria-label': 'Static market selector' }}>{markets.map(m => <MenuItem key={m} value={m}>{marketFlag(m)} {manifest.data?.markets?.[m]?.display_name || m}</MenuItem>)}</Select></FormControl>}
          <IconButton onClick={colorMode.toggleColorMode} aria-label={dark ? 'ライトモードに切り替え' : 'ダークモードに切り替え'} size="small">{dark ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}</IconButton>
        </Box>
      </Toolbar>
    </AppBar>
    <Container maxWidth={false} sx={{ px: { xs: 1.5, sm: 3 }, pb: 3, maxWidth: 1920 }}>{children}</Container>
  </Box>;
}
