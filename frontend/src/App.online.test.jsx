import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ runtime: {} }));
vi.mock('./static/StaticAppShell', () => ({ default: () => <div>Static app</div> }));
vi.mock('./contexts/RuntimeContext', () => ({
  RuntimeProvider: ({ children }) => <div data-testid="runtime-provider">{children}</div>,
  useRuntime: () => state.runtime,
}));
vi.mock('./contexts/StrategyProfileContext', () => ({ StrategyProfileProvider: ({ children }) => <div data-testid="strategy-provider">{children}</div> }));
vi.mock('./contexts/PipelineContext', () => ({ PipelineProvider: ({ children }) => <div data-testid="pipeline-provider">{children}</div> }));
vi.mock('./contexts/AssistantChatContext', () => ({ AssistantChatProvider: ({ children }) => <div data-testid="assistant-provider">{children}</div> }));
vi.mock('./components/Layout/Layout', () => ({ default: ({ children }) => <main aria-label="Online layout">{children}</main> }));
vi.mock('./components/App/ServerLoginScreen', () => ({ default: ({ onLogin, loginError }) => <button onClick={onLogin}>Server login {loginError}</button> }));
vi.mock('./components/App/BootstrapSetupScreen', () => ({ default: ({ onStartBootstrap, bootstrapError }) => <button onClick={onStartBootstrap}>Bootstrap {bootstrapError}</button> }));
vi.mock('./pages/ScanPage', () => ({ default: () => <h1>Scan</h1> }));
vi.mock('./pages/MarketScanPage', () => ({ default: () => <h1>Market scan</h1> }));
vi.mock('./pages/BreadthPage', () => ({ default: () => <h1>Breadth</h1> }));
vi.mock('./pages/GroupRankingsPage', () => ({ default: () => <h1>Groups</h1> }));
vi.mock('./pages/ValidationPage', () => ({ default: () => <h1>Validation</h1> }));
vi.mock('./pages/ThemesPage', () => ({ default: () => <h1>Themes</h1> }));
vi.mock('./pages/ChatbotPage', () => ({ default: () => <h1>Chatbot</h1> }));
vi.mock('./pages/OperationsPage', () => ({ default: () => <h1>Operations</h1> }));
vi.mock('./pages/PositionsPage', () => ({ default: () => <h1>Positions</h1> }));
vi.mock('./features/markets360/pages/Markets360Page', () => ({ default: () => <h1>Markets 360</h1> }));
vi.mock('./components/Stock/StockDetails', () => ({ default: () => <h1>Stock details</h1> }));

const renderOnline = async (path = '/') => {
  window.history.replaceState(null, '', path);
  const { default: App } = await import('./App');
  return render(<App />);
};

beforeEach(() => {
  vi.stubEnv('VITE_STATIC_SITE', 'false');
  vi.resetModules();
  state.runtime = {
    runtimeReady: true, auth: { required: false, authenticated: false }, bootstrapRequired: false,
    features: { themes: true, chatbot: true }, login: vi.fn(), startBootstrap: vi.fn(),
  };
});
afterEach(() => { cleanup(); vi.unstubAllEnvs(); window.history.replaceState(null, '', '/'); });

describe('online app boundary', () => {
  it.each([
    ['/', 'Market scan'], ['/scan', 'Scan'], ['/breadth', 'Breadth'], ['/groups', 'Groups'],
    ['/validation', 'Validation'], ['/themes', 'Themes'], ['/chatbot', 'Chatbot'],
    ['/stocks/NVDA', 'Stock details'], ['/markets360', 'Markets 360'], ['/markets360/NVDA', 'Markets 360'],
    ['/positions', 'Positions'], ['/operations', 'Operations'], ['/unknown', 'Market scan'],
  ])('preserves the online route %s and providers', async (path, heading) => {
    await renderOnline(path);
    const page = await screen.findByRole('heading', { name: heading, exact: true });
    expect(within(screen.getByTestId('runtime-provider')).getByRole('main', { name: 'Online layout' })).toContainElement(page);
    expect(screen.getByTestId('strategy-provider')).toContainElement(page);
    expect(screen.getByTestId('pipeline-provider')).toContainElement(page);
    expect(screen.queryByText('Static app')).not.toBeInTheDocument();
    if (path === '/chatbot') expect(screen.getByTestId('assistant-provider')).toContainElement(page);
  });

  it('retains runtime loading before login or routes', async () => {
    state.runtime.runtimeReady = false;
    await renderOnline();
    expect(await screen.findByTestId('runtime-provider')).toContainElement(screen.getByRole('status', { name: 'Loading page' }));
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('retains the login gate and retry callback before bootstrap', async () => {
    state.runtime.auth = { required: true, authenticated: false };
    state.runtime.bootstrapRequired = true;
    state.runtime.loginError = 'Try again';
    await renderOnline();
    fireEvent.click(await screen.findByRole('button', { name: 'Server login Try again' }));
    expect(state.runtime.login).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: /^Bootstrap/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it('retains bootstrap errors and retry callback before routes', async () => {
    state.runtime.bootstrapRequired = true;
    state.runtime.bootstrapError = 'Retry setup';
    await renderOnline();
    fireEvent.click(await screen.findByRole('button', { name: 'Bootstrap Retry setup' }));
    expect(state.runtime.startBootstrap).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('main')).not.toBeInTheDocument();
  });

  it.each(['/themes', '/chatbot'])('redirects disabled feature route %s and omits pipeline', async path => {
    state.runtime.features = { themes: false, chatbot: false };
    await renderOnline(path);
    expect(await screen.findByRole('heading', { name: 'Market scan' })).toBeInTheDocument();
    expect(window.location.pathname).toBe('/');
    expect(screen.queryByTestId('pipeline-provider')).not.toBeInTheDocument();
  });
});
