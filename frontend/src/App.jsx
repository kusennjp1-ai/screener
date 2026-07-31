import { useState, useMemo, lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { CssBaseline, ThemeProvider, createTheme, CircularProgress, Box } from '@mui/material';

import { STATIC_SITE_MODE } from './config/runtimeMode';
import StaticAppShell from './static/StaticAppShell';

// Eagerly loaded pages (most frequently used)
import ScanPage from './pages/ScanPage';
import MarketScanPage from './pages/MarketScanPage';
import StockDetails from './components/Stock/StockDetails';
import Layout from './components/Layout/Layout';
import BootstrapSetupScreen from './components/App/BootstrapSetupScreen';
import ServerLoginScreen from './components/App/ServerLoginScreen';
import { AssistantChatProvider } from './contexts/AssistantChatContext';
import { PipelineProvider } from './contexts/PipelineContext';
import { RuntimeProvider, useRuntime } from './contexts/RuntimeContext';
import { StrategyProfileProvider } from './contexts/StrategyProfileContext';
import { ColorModeContext } from './contexts/ColorModeContext';

// Lazy loaded pages (secondary pages)
const BreadthPage = lazy(() => import('./pages/BreadthPage'));
const GroupRankingsPage = lazy(() => import('./pages/GroupRankingsPage'));
const ValidationPage = lazy(() => import('./pages/ValidationPage'));
const ThemesPage = lazy(() => import('./pages/ThemesPage'));
const ChatbotPage = lazy(() => import('./pages/ChatbotPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const Markets360Page = lazy(() => import('./features/markets360/pages/Markets360Page'));
const PositionsPage = lazy(() => import('./pages/PositionsPage'));

// Loading fallback component
const PageLoadingFallback = () => (
  <Box
    sx={{
      display: 'flex',
      justifyContent: 'center',
      alignItems: 'center',
      minHeight: '50vh',
    }}
  >
    <CircularProgress />
  </Box>
);

// Create React Query client with optimized settings
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5 * 60 * 1000, // 5 minutes - data considered fresh
      gcTime: 30 * 60 * 1000, // 30 minutes - keep in cache (was cacheTime in v4)
      placeholderData: (previousData) => previousData, // Use previous data while loading
    },
  },
});

// Function to create theme based on mode
const getDesignTokens = (mode) => ({
  // On the dark surface MUI's stock palette does not clear WCAG AA: primary
  // #1976d2 measures 3.99:1, error #d32f2f 3.67:1, success #2e7d32 worse still.
  // Those colours reach the screen through every Button, Chip and link, so the
  // fix belongs here rather than in each call site. The dark values are the
  // same measured tokens src/static/designTokens.js uses (5.68 / 4.69 / 6.37).
  // Light mode keeps MUI's defaults, which are built for a white background.
  palette: {
    mode,
    primary: {
      main: mode === 'dark' ? '#4f8cff' : '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
    success: {
      main: mode === 'dark' ? '#22ab94' : '#2e7d32',
      light: '#4caf50',
    },
    error: {
      main: mode === 'dark' ? '#f23645' : '#d32f2f',
      light: '#f44336',
    },
    warning: {
      main: mode === 'dark' ? '#e0a52e' : '#ed6c02',
    },
    background: {
      default: mode === 'light' ? '#f5f5f5' : '#0c0c11',
      paper: mode === 'light' ? '#ffffff' : '#141419',
    },
  },
  shape: {
    borderRadius: 10,
  },
  // Typography is pinned to the same six-step scale the static cards use
  // (src/static/designTokens.js: 12/13/15/17/22/26) and every step is an
  // explicit integer px.
  //
  // Two problems this fixes. (1) `caption` at 11px and the table head at 10px
  // are below the 12px floor — at those sizes Japanese glyphs sub-pixel-render
  // and smear on a phone. (2) Any variant left on MUI's rem defaults was
  // resolved against `fontSize: 13` and came out FRACTIONAL: h5 measured
  // 22.2857px on the breadth and group pages. Fractional sizes are what make
  // text look faintly out of focus. Declaring px for h1–h6 removes the whole
  // class of them.
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    body1: { fontSize: '13px' },
    body2: { fontSize: '13px', lineHeight: 1.5 },
    caption: { fontSize: '12px' },
    subtitle1: { fontSize: '15px' },
    subtitle2: { fontSize: '13px' },
    button: { fontSize: '13px' },
    overline: { fontSize: '12px' },
    h1: { fontSize: '26px', fontWeight: 700 },
    h2: { fontSize: '26px', fontWeight: 700 },
    h3: { fontSize: '22px', fontWeight: 700 },
    h4: { fontSize: '22px', fontWeight: 700 },
    h5: { fontSize: '17px', fontWeight: 700 },
    h6: { fontSize: '15px', fontWeight: 600 },
  },
  components: {
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '4px 6px',
          fontSize: '12px',
          lineHeight: 1.3,
          borderBottom: mode === 'light' ? '1px solid #e0e0e0' : '1px solid #333',
        },
        head: {
          backgroundColor: '#1a1a2e',
          color: '#ffffff',
          fontWeight: 600,
          // was 10px: an uppercase, letter-spaced header at 10px is the least
          // legible text in the product. 12px is the floor for every surface.
          fontSize: '12px',
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
          padding: '6px 6px',
          whiteSpace: 'nowrap',
          borderBottom: '2px solid #333',
        },
        sizeSmall: {
          padding: '3px 5px',
        },
      },
    },
    MuiTableRow: {
      styleOverrides: {
        root: {
          height: 24,
          '&:nth-of-type(odd)': {
            backgroundColor: mode === 'light' ? '#fafafa' : '#1e1e1e',
          },
          '&:nth-of-type(even)': {
            backgroundColor: mode === 'light' ? '#ffffff' : '#252525',
          },
          '&:hover': {
            backgroundColor: mode === 'light' ? '#e3f2fd !important' : '#333 !important',
          },
          '&.MuiTableRow-head': {
            height: 28,
            '&:nth-of-type(odd)': {
              backgroundColor: '#1a1a2e',
            },
          },
        },
      },
    },
    MuiTableSortLabel: {
      styleOverrides: {
        root: {
          color: '#ffffff !important',
          '&:hover': {
            color: '#90caf9 !important',
          },
          '&.Mui-active': {
            color: '#90caf9 !important',
          },
        },
        icon: {
          color: '#90caf9 !important',
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        // MUI derives the small button's label from a rem value that resolved
        // to a FRACTIONAL 12.0714px against this theme's 13px base. Pin it.
        sizeSmall: { fontSize: '13px' },
        root: { fontSize: '13px' },
      },
    },
    MuiChip: {
      styleOverrides: {
        sizeSmall: {
          // 18px tall with a 10px label made the scan page's 30 preset chips
          // both unreadable and untappable. 22px/12px keeps them compact while
          // clearing the type floor; the tap target is enlarged at the call site.
          height: 22,
          fontSize: '12px',
        },
        labelSmall: {
          padding: '0 6px',
        },
        // A SOLID chip in a semantic colour takes near-black text, not white.
        // White on the (now correctly bright) fills measures 2.87-3.22:1; the
        // page background #0c0c11 on them measures 5.01-8.91:1 and reads as a
        // hole punched in the page. Same treatment as the sell-timing pill.
        ...(mode === 'dark'
          ? {
            filledPrimary: { color: '#0c0c11' },
            filledSuccess: { color: '#0c0c11' },
            filledError: { color: '#0c0c11' },
            filledWarning: { color: '#0c0c11' },
            filledInfo: { color: '#0c0c11' },
          }
          : {}),
      },
    },
    MuiIconButton: {
      styleOverrides: {
        sizeSmall: {
          padding: 2,
        },
      },
    },
    MuiCardContent: {
      styleOverrides: {
        root: {
          padding: 12,
          '&:last-child': {
            paddingBottom: 12,
          },
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          minHeight: 40,
          fontSize: '12px',
        },
      },
    },
    MuiTabs: {
      styleOverrides: {
        root: {
          minHeight: 40,
        },
      },
    },
  },
});

function App() {
  const [mode, setMode] = useState('dark');

  // The static PWA is a DARK-SURFACE product and cannot honour a light mode.
  //
  // Its whole visual system (src/static/designTokens.js) is a set of hex values
  // whose WCAG ratios are measured, asserted and documented against ONE
  // background — the card panel #12151b compositing over the page #0c0c11.
  // Flipping MUI to light left those tokens unchanged, so the phone rendered
  // near-white headings on white paper: "今日の買い候補" measured 1.02:1 and was
  // literally invisible, 27 of 114 text nodes fell below AA, and the result
  // cards stayed dark rectangles on a white page.
  //
  // A real light theme means a second measured palette, not a toggle — so the
  // toggle is disabled here rather than left as a way to break the app. The
  // full desktop app keeps its toggle: it is styled from the MUI palette, which
  // does adapt.
  const colorMode = useMemo(
    () => ({
      toggleColorMode: () => {
        if (STATIC_SITE_MODE) return;
        setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
      },
      mode: STATIC_SITE_MODE ? 'dark' : mode,
      canToggle: !STATIC_SITE_MODE,
    }),
    [mode]
  );

  const theme = useMemo(
    () => createTheme(getDesignTokens(STATIC_SITE_MODE ? 'dark' : mode)),
    [mode],
  );

  const appShell = STATIC_SITE_MODE ? <StaticAppShell /> : (
    <RuntimeProvider>
      <AppShell />
    </RuntimeProvider>
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ColorModeContext.Provider value={colorMode}>
        <ThemeProvider theme={theme}>
          <CssBaseline />
          {appShell}
        </ThemeProvider>
      </ColorModeContext.Provider>
    </QueryClientProvider>
  );
}

function AppShell() {
  const {
    auth,
    bootstrapRequired,
    bootstrapState,
    enabledMarkets,
    features,
    isLoggingIn,
    isStartingBootstrap,
    login,
    marketCatalog,
    primaryMarket,
    loginError,
    runtimeReady,
    startBootstrap,
    supportedMarkets,
    bootstrapError,
  } = useRuntime();

  if (!runtimeReady) {
    return <PageLoadingFallback />;
  }

  if (auth?.required && !auth?.authenticated) {
    return (
      <ServerLoginScreen
        auth={auth}
        isLoggingIn={isLoggingIn}
        loginError={loginError}
        onLogin={login}
      />
    );
  }

  if (bootstrapRequired) {
    return (
      <BootstrapSetupScreen
        primaryMarket={primaryMarket}
        enabledMarkets={enabledMarkets}
        supportedMarkets={supportedMarkets}
        marketCatalog={marketCatalog}
        bootstrapState={bootstrapState}
        isStartingBootstrap={isStartingBootstrap}
        bootstrapError={bootstrapError}
        onStartBootstrap={startBootstrap}
      />
    );
  }

  const assistantChatbotRoute = (
    <AssistantChatProvider>
      <ChatbotPage />
    </AssistantChatProvider>
  );

  const appRoutes = (
    <Router>
      <Layout>
        <Suspense fallback={<PageLoadingFallback />}>
          <Routes>
            <Route path="/" element={<MarketScanPage />} />
            <Route path="/scan" element={<ScanPage />} />
            <Route path="/breadth" element={<BreadthPage />} />
            <Route path="/groups" element={<GroupRankingsPage />} />
            <Route path="/validation" element={<ValidationPage />} />
            {features.themes && <Route path="/themes" element={<ThemesPage />} />}
            {features.chatbot && <Route path="/chatbot" element={assistantChatbotRoute} />}
            <Route path="/stocks/:ticker" element={<StockDetails />} />
            <Route path="/markets360" element={<Markets360Page />} />
            <Route path="/markets360/:ticker" element={<Markets360Page />} />
            <Route path="/positions" element={<PositionsPage />} />
            <Route path="/operations" element={<OperationsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Suspense>
      </Layout>
    </Router>
  );

  const routedApp = (
    <StrategyProfileProvider>
      {appRoutes}
    </StrategyProfileProvider>
  );

  if (features.themes) {
    return <PipelineProvider>{routedApp}</PipelineProvider>;
  }

  return routedApp;
}

export default App;
