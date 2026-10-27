import { useMemo, lazy, Suspense } from 'react';
import useColorModePreference from './contexts/useColorModePreference';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CssBaseline, ThemeProvider, createTheme, CircularProgress, Box } from '@mui/material';

import { STATIC_SITE_MODE } from './config/runtimeMode';
import StaticAppShell from './static/StaticAppShell';

import { ColorModeContext } from './contexts/ColorModeContext';

// Backend routes and chart libraries are loaded only for the connected app.
const ServerApp = lazy(() => import('./ServerApp'));

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
  palette: {
    mode,
    primary: {
      main: '#1976d2',
    },
    secondary: {
      main: '#dc004e',
    },
    success: {
      main: '#2e7d32',
      light: '#4caf50',
    },
    error: {
      main: '#d32f2f',
      light: '#f44336',
    },
    background: {
      default: mode === 'light' ? '#f5f5f5' : '#0c0c11',
      paper: mode === 'light' ? '#ffffff' : '#141419',
    },
  },
  shape: {
    borderRadius: 10,
  },
  typography: {
    fontFamily: '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: 13,
    body1: {
      fontSize: '14px',
    },
    body2: {
      fontSize: '13px',
      lineHeight: 1.5,
    },
    caption: {
      fontSize: '11px',
    },
    h6: {
      fontSize: '15px',
      fontWeight: 600,
    },
  },
  components: {
    MuiTableCell: {
      styleOverrides: {
        root: {
          padding: '4px 6px',
          fontSize: '11px',
          lineHeight: 1.3,
          borderBottom: mode === 'light' ? '1px solid #e0e0e0' : '1px solid #333',
        },
        head: {
          backgroundColor: '#1a1a2e',
          color: '#ffffff',
          fontWeight: 600,
          fontSize: '10px',
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
    MuiChip: {
      styleOverrides: {
        sizeSmall: {
          height: 18,
          fontSize: '10px',
        },
        labelSmall: {
          padding: '0 6px',
        },
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
  const [mode, setMode] = useColorModePreference();

  const colorMode = useMemo(
    () => ({
      toggleColorMode: () => {
        setMode((prevMode) => (prevMode === 'light' ? 'dark' : 'light'));
      },
      mode,
    }),
    [mode, setMode]
  );

  const theme = useMemo(() => createTheme(getDesignTokens(mode)), [mode]);

  const appShell = STATIC_SITE_MODE ? <StaticAppShell /> : (
    <Suspense fallback={<Box role="status" sx={{p:4}}><CircularProgress aria-label="アプリを読み込み中" /></Box>}>
      <ServerApp />
    </Suspense>
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

export default App;
