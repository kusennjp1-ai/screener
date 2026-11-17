// SCRATCH (ui-abc yardstick, never committed): screenshots of plan §5.7. For every matrix view flagged `shot` in states.mjs,
// light and dark, a fresh page per size: the first fold (viewport PNG at scroll 0) at 320x640, 375x812, 390x844, the two
// installed-PWA sizes (brief-phone.spec.js:19-20, safe-area insets 44/34 at 375x812 and 47/34 at 390x844 via
// Emulation.setSafeAreaInsetsOverride, :28; Today and stock views only) and 1440x900; plus a full-page PNG for Today, the stock
// screens and 市場 at 375 and 1440. CI-faithful browser and fonts, reduced motion, pinned page clock, charts settled.
// Env: YARD_FIXTURE, YARD_OUT (the PNG dir: <id>__<size>__<theme>[-full].png), YARD_VIEWS (regex), YARD_THEMES, YARD_SIZES.
import { test } from '@playwright/test';
import { mkdirSync, existsSync } from 'node:fs';
import { loadStates, safeId } from './states.mjs';
import { openView, settledView } from './extract.mjs';

for (const key of ['YARD_FIXTURE', 'YARD_OUT']) if (!process.env[key]) throw new Error(`${key} is required`);
const fx = await import(process.env.YARD_FIXTURE);
const OUT = process.env.YARD_OUT;
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.YARD_VIEWS ? new RegExp(process.env.YARD_VIEWS) : null;   // empty: every shot view
const THEMES = (process.env.YARD_THEMES || 'light,dark').split(',');
const phone = (width, height) => ({ viewport: { width, height }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const SIZES = {
  '320x640': { device: phone(320, 640), phone: true },
  '375x812': { device: phone(375, 812), phone: true, full: true },
  '390x844': { device: phone(390, 844), phone: true },
  'pwa375': { device: phone(375, 812), phone: true, insets: { top: 44, bottom: 34 }, pwa: true },
  'pwa390': { device: phone(390, 844), phone: true, insets: { top: 47, bottom: 34 }, pwa: true },
  '1440x900': { device: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 }, phone: false, full: true },
};
const SIZE_KEYS = (process.env.YARD_SIZES || Object.keys(SIZES).join(',')).split(',');
const S = await loadStates(fx);
const views = S.views.filter(v => v.shot && (!ONLY || ONLY.test(v.id)));
// Full pages: Today and 市場 in four market states (50%, 0%, one condition unknown, no manifest), and every stock state as published.
const isFull = v => (v.kind === 'market' && ['m50', 'below50', 'partunk', 'manifest503'].includes(v.market) && ['today', 'market', 'market-t0'].includes(v.screen))
  || (v.kind === 'stock' && v.market === 'pub');

for (const size of SIZE_KEYS) for (const theme of THEMES) test.describe(`shots ${size} ${theme}`, () => {
  const spec = SIZES[size];
  test.use({ ...spec.device, colorScheme: theme, contextOptions: { reducedMotion: 'reduce' } });
  for (const view of views) {
    const phoneView = view.modes.includes('375'), deskView = view.modes.includes('1440');
    if (spec.phone ? !phoneView : !deskView) continue;
    if (spec.pwa && !(view.screen === 'today' || view.stock)) continue;
    const base = `${OUT}/${safeId(view.id)}__${size}__${theme}`;
    test(`${size} ${theme} ${view.id}`, async ({ page }) => {
      test.setTimeout(180000);
      if (process.env.YARD_SKIP_EXISTING === '1' && existsSync(`${base}.png`)) test.skip();
      if (spec.insets) await (await page.context().newCDPSession(page)).send('Emulation.setSafeAreaInsetsOverride', { insets: { ...spec.insets, left: 0, right: 0 } });
      await openView(fx, page, { ...view, open: { ...view.open, storage: { ...(view.open.storage || {}), 'screener:color-mode': theme } } });
      await settledView(fx, page, view);
      await page.screenshot({ path: `${base}.png`, animations: 'disabled', caret: 'hide' });
      if (spec.full && isFull(view)) await page.screenshot({ path: `${base}-full.png`, fullPage: true, animations: 'disabled', caret: 'hide' });
    });
  }
});
