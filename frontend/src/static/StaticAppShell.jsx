import { HashRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import { lazy, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import StaticLayout from './StaticLayout';
import ResearchPage from './pages/ResearchPage';
import { StaticMarketProvider } from './StaticMarketContext';
import { getStaticSupportedMarkets, useStaticManifest } from './dataClient';
import RoutePageLoadBoundary from '../components/App/RoutePageLoadBoundary';

const StaticHomePage = lazy(() => import('./pages/StaticHomePage'));
const StaticScanPage = lazy(() => import('./pages/StaticScanPage'));
const StaticBreadthPage = lazy(() => import('./pages/StaticBreadthPage'));
const StaticGroupsPage = lazy(() => import('./pages/StaticGroupsPage'));

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
      <StaticLayout>
        <RoutePageLoadBoundary>
          <Routes>
            <Route path="/" element={<ResearchPage />} />
            <Route path="/compare" element={<ResearchPage compareOnly />} />
            <Route path="/daily" element={<StaticHomePage />} />
            <Route path="/scan" element={<StaticScanPage />} />
            <Route path="/breadth" element={<StaticBreadthPage />} />
            <Route path="/groups" element={<StaticGroupsPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </RoutePageLoadBoundary>
      </StaticLayout>
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
