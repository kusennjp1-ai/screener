import { HashRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
// The daily brief is the whole static app: today, candidates, watch, market and one stock.
import BriefApp from './brief/BriefApp';
import { StaticMarketProvider } from './StaticMarketContext';
import { getStaticSupportedMarkets, useStaticManifest } from './dataClient';
import { legacyTarget } from './legacyRoutes';

function LegacyRedirect() {
  const { pathname, search } = useLocation();
  return <Navigate to={legacyTarget(pathname, search)} replace />;
}

function StaticAppContent() {
  const manifestQuery = useStaticManifest();
  const queryClient = useQueryClient();
  const generation = manifestQuery.data?.research_generation || manifestQuery.data?.generated_at;
  useEffect(() => {
    if (!generation) return;
    // Asset paths are stable across publishes. Refresh dependent charts/pages
    // when the generation changes, including queries whose staleTime is Infinity.
    queryClient.invalidateQueries({ predicate: query => !['staticManifest', 'researchClock', 'researchQuote'].includes(query.queryKey[0]) });
  }, [generation, queryClient]);
  const supportedMarkets = getStaticSupportedMarkets(manifestQuery.data);
  const defaultMarket = manifestQuery.data?.default_market || supportedMarkets[0] || 'US';

  return (
    <StaticMarketProvider
      supportedMarkets={supportedMarkets}
      defaultMarket={defaultMarket}
    >
      <Routes>
        <Route path="/brief/*" element={<BriefApp />} />
        <Route path="*" element={<LegacyRedirect />} />
      </Routes>
    </StaticMarketProvider>
  );
}

function StaticAppShell() {
  return (
    <Router>
      <StaticAppContent />
    </Router>
  );
}

export default StaticAppShell;
