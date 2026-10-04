import { lazy } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { HashRouter, Link, MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import PageLoadBoundary from './PageLoadBoundary';
import RoutePageLoadBoundary from './RoutePageLoadBoundary';

afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, '', '/'); });

function RoutedPage({ Page }) {
  return (
    <MemoryRouter initialEntries={['/secondary']}>
      <nav aria-label="Pages"><Link to="/">Home</Link><Link to="/secondary">Secondary</Link></nav>
      <RoutePageLoadBoundary>
        <Routes>
          <Route path="/" element={<h1>Home page</h1>} />
          <Route path="/secondary" element={<Page />} />
        </Routes>
      </RoutePageLoadBoundary>
    </MemoryRouter>
  );
}

describe('page chunk loading', () => {
  it('keeps navigation usable while a chunk loads and ignores its late arrival after navigation', async () => {
    let resolvePage;
    const Page = lazy(() => new Promise(resolve => { resolvePage = resolve; }));
    render(<RoutedPage Page={Page} />);
    expect(screen.getByRole('status', { name: 'Loading page' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(screen.getByRole('heading', { name: 'Home page' })).toBeInTheDocument();
    await act(async () => resolvePage({ default: () => <h1>Secondary page</h1> }));
    expect(screen.queryByRole('heading', { name: 'Secondary page' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Secondary' }));
    expect(await screen.findByRole('heading', { name: 'Secondary page' })).toBeInTheDocument();
  });

  it('recovers navigation after a chunk rejection and retains the reload action when returning', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Page = lazy(() => Promise.reject(new Error('Chunk unavailable')));
    render(<RoutedPage Page={Page} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This page could not load');
    expect(screen.getByRole('navigation', { name: 'Pages' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Home' }));
    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Secondary' }));
    expect(await screen.findByRole('button', { name: 'Reload / 再読み込み' })).toBeInTheDocument();
  });

  it('offers an explicit fresh-page retry for cached import failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const onReload = vi.fn();
    const Page = lazy(() => Promise.reject(new Error('Old deployment chunk')));
    render(<PageLoadBoundary onReload={onReload}><Page /></PageLoadBoundary>);
    fireEvent.click(await screen.findByRole('button', { name: 'Reload / 再読み込み' }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });

  it('recovers on direct hash navigation even when the history key stays default', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const Page = lazy(() => Promise.reject(new Error('Missing hash route chunk')));
    window.history.replaceState(null, '', '/#/secondary');
    render(
      <HashRouter>
        <RoutePageLoadBoundary>
          <Routes>
            <Route path="/secondary" element={<Page />} />
            <Route path="/" element={<h1>Home page</h1>} />
          </Routes>
        </RoutePageLoadBoundary>
      </HashRouter>
    );
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    await act(async () => { window.location.hash = '#/'; });
    expect(await screen.findByRole('heading', { name: 'Home page' })).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
