import { useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import useColorModePreference from './contexts/useColorModePreference';
import { ColorModeContext } from './contexts/ColorModeContext';
import { createQueryClient } from './config/queryClient';
import StaticAppShell from './static/StaticAppShell';

/**
 * Root of the static site (GitHub Pages). It carries only the query cache and the
 * light/dark choice, so the phone downloads and parses no Material UI runtime.
 */
export default function StaticRoot() {
  const [queryClient] = useState(createQueryClient);
  const [mode, setMode] = useColorModePreference();
  const colorMode = useMemo(() => ({ toggleColorMode: () => setMode(previous => (previous === 'light' ? 'dark' : 'light')), mode }), [mode, setMode]);
  return <QueryClientProvider client={queryClient}>
    <ColorModeContext.Provider value={colorMode}>
      <StaticAppShell />
    </ColorModeContext.Provider>
  </QueryClientProvider>;
}
