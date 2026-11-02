import { HashRouter as Router, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
// The daily brief is the whole static app: today, candidates, watch, market and one stock.
import BriefApp from './brief/BriefApp';
import { StaticMarketProvider } from './StaticMarketContext';
import { getStaticSupportedMarkets, useStaticManifest } from './dataClient';

const SYMBOL = /^[A-Za-z0-9.^-]{1,15}$/;

/**
 * Addresses of the retired screens (bookmarks, the installed app's start URL, older
 * notifications) open the matching brief screen instead of an empty page.
 */
export function legacyTarget(pathname = '/', search = '') {
  const symbol = new URLSearchParams(search).get('symbol');
  if (symbol && SYMBOL.test(symbol)) return `/brief/stock/${encodeURIComponent(symbol.toUpperCase())}`;
  if (/^\/(breadth|groups|themes)(\/|$)/.test(pathname)) return '/brief/market';
  if (/^\/(compare|scan)(\/|$)/.test(pathname)) return '/brief/list';
  return '/brief';
}

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
