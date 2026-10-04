import { lazy } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import PageLoadingFallback from './components/App/PageLoadingFallback';
import RoutePageLoadBoundary from './components/App/RoutePageLoadBoundary';

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

// Lazy loaded pages (secondary pages)
const BreadthPage = lazy(() => import('./pages/BreadthPage'));
const GroupRankingsPage = lazy(() => import('./pages/GroupRankingsPage'));
const ValidationPage = lazy(() => import('./pages/ValidationPage'));
const ThemesPage = lazy(() => import('./pages/ThemesPage'));
const ChatbotPage = lazy(() => import('./pages/ChatbotPage'));
const OperationsPage = lazy(() => import('./pages/OperationsPage'));
const Markets360Page = lazy(() => import('./features/markets360/pages/Markets360Page'));
const PositionsPage = lazy(() => import('./pages/PositionsPage'));

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
        <RoutePageLoadBoundary>
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
        </RoutePageLoadBoundary>
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

export default function OnlineAppShell() {
  return <RuntimeProvider><AppShell /></RuntimeProvider>;
}
