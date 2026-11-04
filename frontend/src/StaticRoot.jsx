import { useMemo, useState } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import useColorModePreference from './contexts/useColorModePreference';
import { ColorModeContext } from './contexts/ColorModeContext';
import { createQueryClient } from './config/queryClient';
import StaticAppShell from './static/StaticAppShell';
import { prefetchStaticManifest } from './static/dataClient';
import { prewarmResearchWorker } from './static/researchWorkerClient';

/**
 * Root of the static site (GitHub Pages). It carries only the query cache and the
 * light/dark choice, so the phone downloads and parses no Material UI runtime.
 */
export default function StaticRoot() {
  // The manifest and the research worker's script start downloading together, before the first render.
  const [queryClient] = useState(() => { const client = createQueryClient(); prefetchStaticManifest(client); prewarmResearchWorker(); return client; });
  const [mode, setMode] = useColorModePreference();
  const colorMode = useMemo(() => ({ toggleColorMode: () => setMode(previous => (previous === 'light' ? 'dark' : 'light')), mode }), [mode, setMode]);
  return <QueryClientProvider client={queryClient}>
    <ColorModeContext.Provider value={colorMode}>
      <StaticAppShell />
    </ColorModeContext.Provider>
  </QueryClientProvider>;
}
