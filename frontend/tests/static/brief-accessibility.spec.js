// axe-core (WCAG 2.0/2.1/2.2 A and AA) on every brief screen in both colour modes, with no
// horizontal overflow, no page errors and no request leaving 127.0.0.1.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS, horizontalOverflow, axeViolations } from './brief-fixture.js';

const SCREENS = [
  ['today', '#/brief', page => expect(page.getByRole('region', { name: '注目候補' }).getByTestId('brief-candidate')).toHaveCount(5)],
  ['list', '#/brief/list', page => expect(page.getByTestId('brief-candidate').first()).toBeVisible()],
  ['watch', '#/brief/watch', page => expect(page.getByRole('region', { name: 'ウォッチ中の銘柄' }).getByTestId('brief-candidate')).toHaveCount(2)],
  ['market', '#/brief/market', page => expect(page.locator('.market-history-explorer').getByRole('img')).toBeVisible()],
  ['stock', '#/brief/stock/ZZNV', page => expect(page.getByTestId('brief-price-chart').locator('svg rect.bc-up, svg rect.bc-down')).toHaveCount(130)],
];

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  // Reduced motion settles every entrance animation, so axe measures final colours. It is a
  // browser-context option, so it goes through contextOptions (a bare `reducedMotion` is ignored).
  test.use({ ...device, contextOptions: { reducedMotion: 'reduce' } });

  for (const [screen, hash, ready] of SCREENS) test(`${screen} screen passes axe in dark and light`, async ({ page }) => {
    // A watched one-short stock and a watched candidate exercise the watch rows and sell checks.
    const { errors, external } = await openBrief(page, hash, { storage: { 'research-watch': ['ZZNV', 'ZZZF'] } });
    for (const theme of ['dark', 'light']) {
      if (theme === 'light') await page.getByRole('button', { name: 'ライトモードに切り替え' }).click();
      await expect(page.locator('.brief')).toHaveAttribute('data-theme', theme);
      await ready(page);
      expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
      expect(await page.evaluate(() => document.getAnimations().filter(animation => animation.playState === 'running').map(animation => animation.animationName || animation.constructor.name)), `${screen} ${theme} running animations`).toEqual([]);
      expect(await axeViolations(page), `${screen} ${theme}`).toEqual([]);
      expect(await horizontalOverflow(page), `${screen} ${theme} overflow`).toBe(0);
    }
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
});
