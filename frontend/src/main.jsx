import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import { STATIC_SITE_MODE } from './config/runtimeMode';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
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
