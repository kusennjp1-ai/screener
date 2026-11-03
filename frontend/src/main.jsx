import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import { STATIC_SITE_MODE } from './config/runtimeMode';
import StaticRoot from './StaticRoot';

// The static site (GitHub Pages) boots without Material UI; the connected app keeps it.
// Vite inlines VITE_STATIC_SITE, so a Pages build folds this literal comparison
// and Rollup drops the connected app's lazy import and every chunk only it reaches.
// STATIC_SITE_MODE still decides any other spelling, so the choice is unchanged.
const STATIC_BUILD = import.meta.env.VITE_STATIC_SITE === 'true' || STATIC_SITE_MODE;
const App = STATIC_BUILD ? null : React.lazy(() => import('./App'));
ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {STATIC_BUILD ? <StaticRoot /> : <React.Suspense fallback={null}><App /></React.Suspense>}
  </React.StrictMode>
);

// Offline support only for the installed static PWA (GitHub Pages), never the
// backend-connected app — caching live API responses would be unsafe. Prod
// build only, so the dev server is untouched. See public/sw.js (C88).
if (STATIC_SITE_MODE && import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
