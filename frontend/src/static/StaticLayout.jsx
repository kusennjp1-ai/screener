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
import { Link as RouterLink, useLocation } from 'react-router-dom';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import Brightness4Icon from '@mui/icons-material/Brightness4';
import Brightness7Icon from '@mui/icons-material/Brightness7';
import { ColorModeContext } from '../contexts/ColorModeContext';
import { useStaticMarket } from './StaticMarketContext';
import { getStaticSupportedMarkets, resolveStaticMarketEntry, useStaticManifest } from './dataClient';
import { marketFlag } from './marketFlags';
import { marketNameJa } from './marketNames';
import { C, T, W, px, NAV_HEIGHT } from './designTokens';

const NAV_ITEMS = [
  { path: '/', label: 'デイリー' },
  { path: '/scan', label: 'スキャン' },
  { path: '/breadth', label: '騰落' },
  { path: '/groups', label: '業種グループ' },
];

function StaticLayout({ children }) {
  const location = useLocation();
  const theme = useTheme();
  const colorMode = useContext(ColorModeContext);
  const manifestQuery = useStaticManifest();
  const supportedMarkets = getStaticSupportedMarkets(manifestQuery.data);
  const { selectedMarket, setSelectedMarket } = useStaticMarket();
  const marketEntry = resolveStaticMarketEntry(manifestQuery.data, selectedMarket);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar
        position="sticky"
        sx={{
          // ノッチ／ステータスバーと重ならないようセーフエリア分の余白を確保する
          // （index.html の viewport-fit=cover で端まで広がるため必須）
          pt: 'env(safe-area-inset-top, 0px)',
          pl: 'env(safe-area-inset-left, 0px)',
          pr: 'env(safe-area-inset-right, 0px)',
        }}
      >
        {/* 固定表示のバーなので 1 行 44px に固定する。折り返すと 900px の
            画面の 8% を常時占有してしまうため、はみ出す分は横スクロールする。 */}
        <Toolbar
          variant="dense"
          disableGutters
          sx={{
            minHeight: NAV_HEIGHT,
            height: NAV_HEIGHT,
            flexWrap: 'nowrap',
            px: 1,
            gap: 0.5,
          }}
        >
          <ShowChartIcon sx={{ fontSize: px(T.heading), flexShrink: 0, display: { xs: 'none', sm: 'block' } }} />
          <Typography
            component="div"
            sx={{
              fontSize: px(T.heading),
              fontWeight: W.bold,
              whiteSpace: 'nowrap',
              flexShrink: 0,
              display: { xs: 'none', sm: 'block' },
            }}
          >
            STOCK SCANNER DAILY
          </Typography>
          <Chip
            label="閲覧専用"
            size="small"
            color="info"
            sx={{
              height: 22,
              fontSize: px(T.micro),
              flexShrink: 0,
              display: { xs: 'none', md: 'inline-flex' },
            }}
          />
          {supportedMarkets.length > 1 ? (
            <FormControl size="small" sx={{ minWidth: 132, flexShrink: 0 }}>
              <Select
                value={marketEntry.market}
                onChange={(event) => setSelectedMarket(event.target.value)}
                displayEmpty
                sx={{
                  color: 'inherit',
                  backgroundColor: 'rgba(255,255,255,0.12)',
                  height: 30,
                  fontSize: px(T.body),
                  '& .MuiOutlinedInput-notchedOutline': {
                    borderColor: 'rgba(255,255,255,0.35)',
                  },
                  '& .MuiSvgIcon-root': {
                    color: 'inherit',
                  },
                }}
                inputProps={{ 'aria-label': '市場を選択' }}
              >
                {supportedMarkets.map((market) => {
                  const label = marketNameJa(market, manifestQuery.data?.markets?.[market]?.display_name);
                  const flag = marketFlag(market);
                  return (
                    <MenuItem key={market} value={market}>
                      {flag ? `${flag}  ${label}` : label}
                    </MenuItem>
                  );
                })}
              </Select>
            </FormControl>
          ) : null}

          {/* タブだけがスクロール領域。歯車はこの外側に置き、常に見える位置に固定する。 */}
          <Box
            data-testid="static-nav-tabs"
            sx={{
              display: 'flex',
              flexWrap: 'nowrap',
              overflowX: 'auto',
              overflowY: 'hidden',
              flex: 1,
              minWidth: 0,
              justifyContent: 'flex-end',
              alignItems: 'stretch',
              height: NAV_HEIGHT,
              scrollbarWidth: 'none',
              '&::-webkit-scrollbar': { display: 'none' },
            }}
          >
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
                    flexShrink: 0,
                    minWidth: 'auto',
                    whiteSpace: 'nowrap',
                    backgroundColor: isActive ? 'rgba(255, 255, 255, 0.15)' : 'transparent',
                    borderBottom: isActive ? '2px solid white' : '2px solid transparent',
                    borderRadius: 0,
                    fontWeight: isActive ? W.medium : W.regular,
                    fontSize: px(T.body),
                    px: 1.25,
                    py: 0,
                    '&:hover': {
                      backgroundColor: 'rgba(255, 255, 255, 0.25)',
                    },
                  }}
                >
                  {item.label}
                </Button>
              );
            })}
          </Box>

          <IconButton
            onClick={colorMode.toggleColorMode}
            color="inherit"
            title={theme.palette.mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            aria-label={theme.palette.mode === 'dark' ? 'ライトモードに切り替え' : 'ダークモードに切り替え'}
            size="small"
            // MUI's size="small" draws a 23x23 hit box. The glyph stays small,
            // but the target is 44x44 (WCAG 2.5.5); negative margins absorb the
            // growth so the 44px-capped nav bar keeps its height.
            sx={{ flexShrink: 0, width: 44, height: 44, my: '-11px', mr: '-8px' }}
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
