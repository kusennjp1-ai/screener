import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { validEvidenceDay } from '../src/static/evidenceTime.js';
import { observedBarrels, observedPrice, signalDateLabel } from '../src/static/technicalObservation.js';
import { scrollFinancialViewport } from './financial-viewport-geometry.mjs';

// Additional real /daily viewport coverage, outside the performance samples.
// Watch selection is test UI state only; no prices, evidence or clock are changed.
export function dailyObservationDesignScreens(viewport, theme) {
  return (viewport.width === 1440 && theme === 'dark') || (viewport.width === 390 && theme === 'light')
    ? ['daily-observations', 'daily-watchlist'] : [];
}

export function dailyObservationCaseSource(index, researchRows, visibleSymbols) {
  if (!validEvidenceDay(index?.as_of_date)) throw Error('Daily chart-index observation date is unavailable');
  if (!Array.isArray(visibleSymbols) || !visibleSymbols.length || visibleSymbols.length > 20 || new Set(visibleSymbols).size !== visibleSymbols.length) {
    throw Error('Daily capture needs unique initially rendered rows, limited to 20');
  }
  const researchSymbols = new Set(researchRows.map(row => row.symbol));
  // Bind the observed UI order back to exactly one source record per symbol.
  // Never expand the list to reach a convenient record outside the initial 20.
  const visible = visibleSymbols.map(symbol => {
    const matches = index.symbols?.filter(row => row?.symbol === symbol) || [];
    if (matches.length !== 1) throw Error(`Daily rendered symbol ${symbol} has no unique index source`);
    return matches[0];
  });
  const entry = visible.find(row => typeof row.symbol === 'string' && researchSymbols.has(row.symbol)
    && observedPrice(row.buy?.last_close) != null && observedPrice(row.buy?.trigger_price) != null && row.sell);
  if (!entry) throw Error('Daily source needs a real price/model record with a canonical Research symbol among initially rendered rows');
  return entry;
}

export async function verifyDailyObservationCases({ page, viewport, theme, capture, check, report, currentUrl }) {
  if (!dailyObservationDesignScreens(viewport, theme).length) return;
  const key = `daily/${viewport.width}/${theme}`;
  const get = async path => {
    const response = await page.request.get(new URL(`static-data/${path}`, currentUrl).href);
    if (!response.ok()) throw Error(`${path}: HTTP ${response.status()}`);
    return response.json();
  };
  report.daily_observations ||= [];
  const record = { viewport, theme, ui_state: 'One symbol selected through the watch button for this test; not actual user holdings', views: [] };
  report.daily_observations.push(record);
  try {
    const manifest = await get('manifest.json'), market = manifest.markets?.US || manifest;
    const [index, scan, research] = await Promise.all([
      get(market.assets.charts.path), get(market.pages.scan.path), get(market.assets.research.path),
    ]);
    await page.goto(`${currentUrl}#/daily?market=US`);
    await page.evaluate(() => { localStorage.removeItem('todaysWatchlist'); localStorage.removeItem('wlLastSell'); });
    await page.reload();
    const card = page.getByTestId('todays-buys-card');
    await card.waitFor({ state: 'visible', timeout: 60000 });
    const visibleSymbols = await card.locator('[data-testid^="todays-buys-row-"]:visible').evaluateAll(rows =>
      rows.map(row => row.dataset.testid.slice('todays-buys-row-'.length)));
    record.initial_rows = { count: visibleSymbols.length, symbols: visibleSymbols };
    check(visibleSymbols.join('\n') === index.symbols?.slice(0, 20).map(row => row.symbol).join('\n'), `${key}: initial card rows differ from the preserved source order/count`);
    const entry = dailyObservationCaseSource(index, decodeResearchIndex(research).rows, visibleSymbols);
    const symbol = entry.symbol;
    record.source = { symbol, index_path: market.assets.charts.path, as_of_date: index.as_of_date,
      scan_as_of_date: scan.as_of_date ?? null, signal_as_of: entry.buy.signal_as_of ?? null,
      buy: entry.buy, sell: entry.sell };
    const row = page.getByTestId(`todays-buys-row-${symbol}`);
    await row.waitFor({ state: 'visible' });
    const text = await row.innerText(), now = await page.evaluate(() => Date.now());
    check(text.includes(`記録終値 ${entry.buy.last_close.toFixed(2)} · シグナル基準値 ${entry.buy.trigger_price.toFixed(2)}`), `${key}: displayed technical prices differ from the source record`);
    check(text.includes(`配信基準日 ${index.as_of_date}`) && text.includes(`シグナル基準日 ${signalDateLabel(entry.buy.signal_as_of, now)}`), `${key}: observation/signal dates are missing or conflated`);
    check(text.includes(`旧モデル確認数（barrels） ${observedBarrels(entry.buy)}`), `${key}: barrel confirmation differs from source or missing became confirmed`);
    check(text.includes('テクニカル観測のみ · 購入条件は未判定'), `${key}: the recorded technical position lacks its decision scope`);
    const cardText = await card.innerText();
    check(cardText.includes('未確認や履歴不足は合格に数えません'), `${key}: missing-evidence scope is absent`);
    check((await page.getByTestId('todays-buys-market-context').innerText()).includes(`スキャン基準日 ${signalDateLabel(scan.as_of_date, now)}`), `${key}: market context lost its separate scan date`);
    check(!/BUY NOW|今日の買い候補|日次の買い条件通過|now |size |株数|資金/.test(cardText), `${key}: Daily contains an unsupported current purchase/sizing assertion`);
    record.displayed = { observation: text, freshness: await card.getAttribute('data-freshness') };
    check(['unknown', 'future', 'old', 'unverified'].includes(record.displayed.freshness), `${key}: calendar age was promoted to verified latest-session status`);

    const researchLink = row.getByRole('link', { name: `${symbol}の購入条件をResearchで確認` });
    const expectedHash = `#/?symbol=${encodeURIComponent(symbol)}`;
    check(new URL(await researchLink.getAttribute('href'), page.url()).hash === expectedHash, `${key}: canonical Research link changed the symbol/route`);
    const take = async (screen, testId) => {
      const viewportTargets = [`[data-testid=${JSON.stringify(testId)}]`];
      await scrollFinancialViewport(page, viewportTargets);
      await capture(page, viewport, theme, screen, { scope: 'scrolled-viewport', viewportTargets });
      record.views.push({ screen, targets: viewportTargets, scope: 'scrolled-viewport' });
    };
    await take('daily-observations', `todays-buys-row-${symbol}`);

    await row.getByRole('button', { name: `${symbol}を監視リストに追加` }).focus();
    await page.keyboard.press('Space');
    const watch = page.getByTestId(`watchlist-row-${symbol}`);
    await watch.waitFor({ state: 'visible' });
    record.watch_keyboard_added = await page.evaluate(symbol => JSON.parse(localStorage.getItem('todaysWatchlist') || '[]').includes(symbol), symbol);
    check(record.watch_keyboard_added, `${key}: keyboard watch action did not persist the test selection`);
    const watchText = await watch.innerText();
    check(watchText.includes(`配信基準日 ${index.as_of_date}`) && watchText.includes('売却モデル参考') && watchText.includes('実際の保有・注文は未確認'), `${key}: watch record lacks its source date/model/holdings scope`);
    check(!/要売却|保有継続|損切り |利確 |[+-]?\d+(?:\.\d+)?R/.test(watchText), `${key}: watch record implies a current sell/holding/P&L instruction`);
    check(new URL(await watch.getByRole('link', { name: `${symbol}の購入条件をResearchで確認` }).getAttribute('href'), page.url()).hash === expectedHash, `${key}: watch Research link changed the symbol/route`);
    record.displayed.watch = watchText;
    await take('daily-watchlist', `watchlist-row-${symbol}`);

    await watch.getByRole('link', { name: `${symbol}の購入条件をResearchで確認` }).focus();
    await page.keyboard.press('Enter');
    await page.waitForURL(url => url.hash === expectedHash);
    await page.locator('.symbol-title h2').filter({ hasText: symbol }).waitFor({ state: 'visible', timeout: 60000 });
    record.research_keyboard_destination = { hash: new URL(page.url()).hash, symbol: (await page.locator('.symbol-title h2').textContent())?.trim() };
    check(record.research_keyboard_destination.symbol === symbol, `${key}: keyboard navigation did not open the selected Research symbol`);
    await page.goBack();
    await watch.waitFor({ state: 'visible', timeout: 60000 });
    await watch.getByRole('button', { name: `${symbol}を監視リストから外す` }).focus();
    await page.keyboard.press('Space');
    await watch.waitFor({ state: 'detached' });
    record.watch_keyboard_removed = true;
  } catch (error) {
    record.error = error.message;
    check(false, `${key}: observation verification interrupted: ${error.message}`);
  }
}
