import { useContext } from 'react';
import {
  AppBar,
  Box,
  Button,
  Chip,
  Container,
  FormControl,
  MenuItem,
  Select,
  Toolbar,
  Typography,
  IconButton,
  useTheme,
} from '@mui/material';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import { ColorModeContext } from '../contexts/ColorModeContext';
import { useStaticMarket } from './StaticMarketContext';
import { getStaticSupportedMarkets, resolveStaticMarketEntry, useStaticManifest } from './dataClient';
import { marketFlag } from './marketFlags';

const NAV_ITEMS = [
  { path: '/', label: 'デイリー' },
  { path: '/scan', label: 'スキャン' },
  { path: '/breadth', label: '騰落' },
  { path: '/groups', label: '業種グループ' },
];

function StaticLayout({ children }) {
  const location = useLocation();
  const navigate = useNavigate();
  const theme = useTheme();
  const colorMode = useContext(ColorModeContext);
  const manifestQuery = useStaticManifest();
  const supportedMarkets = getStaticSupportedMarkets(manifestQuery.data);
  const { selectedMarket, setSelectedMarket } = useStaticMarket();
  const marketEntry = resolveStaticMarketEntry(manifestQuery.data, selectedMarket);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="static" sx={{ minHeight: 48 }}>
        <Toolbar variant="dense" sx={{ minHeight: 48, flexWrap: 'wrap', rowGap: 0.5, py: 0.5 }}>
          <IconButton
            color="inherit"
            size="small"
            onClick={() => navigate(-1)}
            aria-label="前のページに戻る"
            title="戻る"
            sx={{ mr: 0.25 }}
          >
            <ArrowBackIosNewIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <IconButton
            color="inherit"
            size="small"
            onClick={() => navigate(1)}
            aria-label="次のページに進む"
            title="進む"
            sx={{ mr: 0.75 }}
          >
            <ArrowForwardIosIcon sx={{ fontSize: 16 }} />
          </IconButton>
          <ShowChartIcon sx={{ mr: 1, fontSize: 20, display: { xs: 'none', sm: 'block' } }} />
          <Typography
            variant="subtitle1"
            component="div"
            sx={{ fontWeight: 600, display: { xs: 'none', sm: 'block' } }}
          >
            STOCK SCANNER DAILY
          </Typography>
          <Chip
            label="閲覧専用"
            size="small"
            color="info"
            sx={{ ml: { xs: 0.5, sm: 1.5 }, height: 22, fontSize: '11px', display: { xs: 'none', md: 'inline-flex' } }}
          />
          <Box sx={{ ml: 1.5, minWidth: 140 }}>
            <FormControl size="small" fullWidth>
              <Select
                value={marketEntry.market}
                onChange={(event) => setSelectedMarket(event.target.value)}
                displayEmpty
                sx={{
                  color: 'inherit',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  height: 30,
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(255,255,255,0.35)',
                  },
                  '& .MuiSvgIcon-root': {
                    color: 'inherit',
                  },
                }}
                inputProps={{ 'aria-label': 'Static market selector' }}
              >
                {supportedMarkets.map((market) => {
                  const label = manifestQuery.data?.markets?.[market]?.display_name || market;
                  const flag = marketFlag(market);
                  return (
                    <MenuItem key={market} value={market}>
                      {flag ? `${flag}  ${label}` : label}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          </Box>
          <Box sx={{ flexGrow: 1 }} />
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Button
                key={item.path}
                color="inherit"
                component={RouterLink}
                to={item.path}
                size="small"
                sx={{
                  backgroundColor: isActive ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                  borderBottom: isActive ? '2px solid white' : '2px solid transparent',
                  borderRadius: 0,
                  fontWeight: isActive ? 600 : 400,
                  fontSize: '12px',
                  px: 1.5,
                  py: 0.5,
                  '&:hover': {
                    backgroundColor: 'rgba(255, 255, 255, 0.25)',
                  },
                }}
              >
                {item.label}
              </Button>
            );
          })}
          <IconButton
            sx={{ ml: 0.5 }}
            onClick={colorMode.toggleColorMode}
            color="inherit"
            title={theme.palette.mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            size="small"
          >
            {theme.palette.mode === 'dark' ? <Brightness7Icon fontSize="small" /> : <Brightness4Icon fontSize="small" />}
          </IconButton>
        </Toolbar>
      </AppBar>

      <Container maxWidth="xl" sx={{ mt: 1.5, mb: 1.5, flex: 1 }}>
        {children}
      </Container>
    </Box>
  );
}

export default StaticLayout;
