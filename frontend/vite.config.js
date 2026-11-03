import { previewBuildMetadata } from './src/static/limitedResearchPreview.js';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { precacheAssets } from './tools/precache-assets.mjs';

// Emits precache-manifest.json (all reachable app routes and their assets) so the
// static PWA's service worker can fully precache the app for first-visit offline
// (see public/sw.js). No runtime dependency — just a build-time listing.
function precacheManifest(base, staticSite) {
  return {
    name: 'precache-manifest',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = precacheAssets(bundle,{staticSite}).map((f) => `${base}${f}`);
      const list = Array.from(new Set([base, `${base}index.html`, ...files]));
      this.emitFile({
        type: 'asset',
        fileName: 'precache-manifest.json',
        source: JSON.stringify(list),
      });
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const configuredBase = env.VITE_BASE_PATH || '/';
  const base = configuredBase.endsWith('/') ? configuredBase : `${configuredBase}/`;

  return {
    base,
    define: { __LIMITED_RESEARCH_PREVIEW__: JSON.stringify(previewBuildMetadata(env.VITE_LIMITED_RESEARCH_PREVIEW)) },
    plugins: [react(), precacheManifest(base,String(env.VITE_STATIC_SITE || '').toLowerCase() === 'true')],
    resolve: {
      alias: [
        // MUI v5's deep icon entries default to CommonJS. Mixing those with
        // material's ESM entries makes esbuild defer createTheme initialization
        // until after Box uses it (a cold-start `createTheme_default` crash).
        // Keep icon imports on the ESM distribution, as the package barrel is.
        {
          find: /^@mui\/icons-material\/(?!esm(?:\/|$))([^/]+)$/,
          replacement: '@mui/icons-material/esm/$1',
        },
      ],
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: './src/test/setup.js',
      css: false,
      testTimeout: 20000,
      hookTimeout: 20000,
      include: ['src/**/*.test.{js,jsx}', 'tools/**/*.test.mjs'],
    },
    server: {
      port: 5173,
      open: true,
      proxy: {
        '/api': {
          target: 'http://127.0.0.1:8000',
          changeOrigin: true,
        },
      },
    },
    build: {
      // Manual chunks for better caching and smaller initial bundle
      rollupOptions: {
        output: {
          // Long-lived vendor chunks for caching. The JSX runtime and scheduler belong to React:
          // left in the Material UI chunk, every static page would preload Material UI.
          manualChunks(id) {
            // Rollup's CommonJS helpers are needed by React itself; elsewhere they drag a vendor chunk in.
            if (id.includes('commonjsHelpers')) return 'react-vendor';
            const name = id.match(/node_modules\/((?:@[^/]+\/)?[^/]+)\//)?.[1];
            if (!name) return undefined;
            if (['react', 'react-dom', 'scheduler', 'react-router', 'react-router-dom', '@remix-run/router'].includes(name)) return 'react-vendor';
            if (/^@(mui|emotion|popperjs)\//.test(name) || ['react-transition-group', 'stylis'].includes(name)) return 'mui-vendor';
            if (/^d3-/.test(name) || ['recharts', 'recharts-scale', 'react-smooth', 'victory-vendor', 'lightweight-charts', 'fancy-canvas', 'internmap', 'decimal.js-light'].includes(name)) return 'charts-vendor';
            if (name.startsWith('@tanstack/')) return 'query-vendor';
            return undefined;
          },
        },
      },
      // Increase chunk size warning limit
      chunkSizeWarningLimit: 1000,
      // Enable source maps for production debugging
      sourcemap: false,
    },
    // Optimize dependencies
    optimizeDeps: {
      include: [
        'react',
        'react-dom',
        'react-router-dom',
        '@mui/material',
        // Prebundle the shared styles entry alongside the material barrel.
        '@mui/material/styles',
        '@emotion/react',
        '@emotion/styled',
        '@tanstack/react-query',
        '@tanstack/react-virtual',
        'recharts',
        'lightweight-charts',
      ],
    },
  };
});
