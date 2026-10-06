import { createRequire } from 'node:module';

// Resolve the frontend's installed packages through their CommonJS entry points.
// Dynamic import(require.resolve('@playwright/test')) can expose only `default`,
// even though require('@playwright/test') has the documented chromium property.
// Importing this helper never loads a package or starts a browser by itself.
export function loadPreviewBrowserTools() {
  const require = createRequire(new URL('../../../frontend/package.json', import.meta.url));
  const { chromium } = require('@playwright/test');
  const { AxeBuilder } = require('@axe-core/playwright');
  if (typeof chromium?.launch !== 'function') throw Error('Installed Playwright does not expose chromium.launch');
  if (typeof AxeBuilder !== 'function' || typeof AxeBuilder.prototype.analyze !== 'function') throw Error('Installed Axe does not expose the expected builder API');
  return { chromium, AxeBuilder };
}
