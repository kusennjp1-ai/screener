// Addresses of the retired screens (bookmarks, the installed app's start URL, older notifications)
// open the matching brief screen, replacing the old entry in the history.
import { test, expect } from '@playwright/test';
import { openBrief, VIEWPORTS } from './brief-fixture.js';

const TODAY = { url: /#\/brief$/, heading: '10月2日（金）の判断' };
const LIST = { url: /#\/brief\/list$/, heading: '候補' };
const MARKET = { url: /#\/brief\/market$/, heading: '市場' };
const stock = symbol => ({ url: new RegExp(`#/brief/stock/${symbol}$`), symbol });
const REDIRECTS = [
  ['', TODAY], ['#/', TODAY], ['#/daily', TODAY], ['#/no-such-screen', TODAY],
  ['#/compare', LIST], ['#/scan', LIST], ['#/scan/results', LIST],
  ['#/breadth', MARKET], ['#/groups', MARKET], ['#/themes', MARKET],
  ['#/?symbol=ZZKS', stock('ZZKS')], ['#/?symbol=zzod', stock('ZZOD')], ['#/?method=oneil&symbol=ZZNV', stock('ZZNV')],
];

for (const [name, device] of Object.entries(VIEWPORTS)) test.describe(`${name} ${device.viewport.width}px`, () => {
  test.use(device);

  test('every retired address opens its brief screen', async ({ page }) => {
    const { errors, external } = await openBrief(page, '#/brief/list');
    await expect(page.getByRole('heading', { level: 1, name: '候補' })).toBeVisible();
    for (const [address, target] of REDIRECTS) {
      await test.step(address || '(no hash)', async () => {
        await page.goto(`/${address}`);
        await expect(page).toHaveURL(target.url);
        if (target.symbol) {
          const title = name === 'phone' ? page.locator('.brief-bar-title') : page.locator('.brief-stockhead h2');
          await expect(title).toContainText(target.symbol);
          await expect(page.getByTestId('brief-price-chart')).toHaveAttribute('aria-label', new RegExp(`^${target.symbol} の日足チャート`));
        } else {
          await expect(page.getByRole('heading', { level: 1, name: target.heading })).toBeVisible();
        }
      });
    }
    // The redirect replaces the retired entry, so Back returns to the screen before it.
    await page.goto('/#/brief');
    await expect(page.getByRole('heading', { level: 1, name: TODAY.heading })).toBeVisible();
    await page.goto('/#/breadth');
    await expect(page).toHaveURL(MARKET.url);
    await page.goBack();
    await expect(page).toHaveURL(TODAY.url);
    await expect(page.getByRole('heading', { level: 1, name: TODAY.heading })).toBeVisible();
    expect(errors).toEqual([]);
    expect(external).toEqual([]);
  });
});
