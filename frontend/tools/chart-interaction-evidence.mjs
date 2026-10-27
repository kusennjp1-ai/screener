import assert from 'node:assert/strict';

const score = value => value.toFixed(1).replace(/\.0$/, '');
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value;
const point = value => day(value?.time) && Number.isFinite(value.value) && value.value >= 1 && value.value <= 99 && Number.isSafeInteger(value.universe_size) && value.universe_size >= 100;

export async function observeRsSelection(page, payload, symbol) {
  const region = page.getByRole('region', { name: `${symbol} のRS順位推移`, exact: true }).first();
  const source = payload.rs_rating_history?.points || [];
  if (!source.length) {
    assert.equal(await region.locator('select').count(), 0, 'Missing RS source cannot produce selectable observations');
    return { available: false, source_points: [], unavailable_text: await region.locator('.rs-history-basis').textContent() };
  }
  const selected = source[0], latest = source.at(-1);
  await region.locator('select').selectOption(selected.time);
  const observed = { available: true, source_points: source, selected_date: await region.locator('select').inputValue(),
    headline: (await region.locator('summary strong').textContent()).trim(),
    population: (await region.locator('output').textContent()).trim(),
    latest: (await region.locator('.rs-history-current').textContent()).trim() };
  validateRsSelection(observed, payload.as_of_date);
  await region.locator('select').selectOption(latest.time);
  return observed;
}

export function validateRsSelection(observed, asOf) {
  assert(Array.isArray(observed?.source_points), 'Missing RS source points');
  if (observed.available === false) {
    assert.equal(observed.source_points.length, 0, 'Cannot claim absent RS when source observations exist');
    assert.match(observed.unavailable_text || '', /比較可能なRS順位履歴は未配信/);
    return true;
  }
  const points = observed.source_points;
  assert(observed.available === true && points.length > 0 && Array.from(points).every((p,i) => point(p) && (!i || p.time > points[i-1].time)), 'Invalid RS source series');
  const selected = points[0], latest = points.at(-1);
  assert.equal(latest.time, asOf, 'RS source date does not match chart');
  assert.equal(observed.selected_date, selected.time, 'Did not exercise earliest available RS observation');
  assert.equal(observed.headline, `${score(selected.value)} / 99`, 'Selected date does not drive RS headline');
  assert.equal(observed.population, `比較対象 ${selected.universe_size.toLocaleString('ja-JP')}銘柄`, 'Score and population are confused');
  assert.equal(observed.latest, `最新 ${asOf} · RS ${score(latest.value)} / 99`, 'Latest RS context differs from source');
  return true;
}

// A native vertical gesture is followed immediately by a native tap. In
// particular, no screenshot, locator wait or programmatic scroll occurs
// between the gesture's touchEnd and the close button's touchStart.
export async function observeImmediateTouchClose(page, dialog, opener) {
  await opener.click();
  await dialog.locator('svg[data-chart-plot]').waitFor({ state: 'visible' });
  await page.waitForFunction(() => Boolean(history.state?.__screenerChartDialog));
  const route = page.url(), close = await dialog.getByRole('button', { name: 'チャートを閉じる', exact: true }).boundingBox();
  assert(close?.width >= 44 && close.height >= 44, 'Close target must be at least 44px');
  const scroller = dialog.getByTestId('expanded-chart-scroll'), bounds = await scroller.boundingBox();
  await scroller.evaluate(node => {
    window.__chartTouchAudit = { initial: node.scrollTop, maximum: node.scrollTop, background_clicks: 0, initial_theme: document.querySelector('.leader-shell')?.dataset.theme };
    node.addEventListener('scroll', () => { window.__chartTouchAudit.maximum = Math.max(window.__chartTouchAudit.maximum, node.scrollTop); });
    const background = event => { if (!event.target.closest('[role="dialog"]')) window.__chartTouchAudit.background_clicks++; };
    document.addEventListener('click', background);
    window.__chartTouchAuditCleanup = () => document.removeEventListener('click', background);
  });
  const client = await page.context().newCDPSession(page);
  try {
    const x = Math.min(bounds.x + bounds.width / 2, 150), y = Math.min(bounds.y + bounds.height - 24, page.viewportSize().height - 100);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (const distance of [20, 50, 90, 140]) await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - distance }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: close.x + close.width / 2, y: close.y + close.height / 2 }] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await dialog.waitFor({ state: 'hidden', timeout: 3000 });
    const result = await page.evaluate(() => ({ ...window.__chartTouchAudit, marker_cleared: !history.state?.__screenerChartDialog, theme_preserved: window.__chartTouchAudit.initial_theme === document.querySelector('.leader-shell')?.dataset.theme }));
    return { ...result, route_preserved: page.url() === route, focus_restored: await opener.evaluate(node => node === document.activeElement), closed: true, close_target: close, intervening_operations: [] };
  } finally { await page.evaluate(() => { window.__chartTouchAuditCleanup?.(); delete window.__chartTouchAuditCleanup; }); await client.detach(); }
}

export function validateImmediateTouchClose(observed) {
  assert(observed?.closed === true && observed.route_preserved === true && observed.marker_cleared === true && observed.focus_restored === true, 'Incomplete native close/history/focus evidence');
  assert(observed.background_clicks === 0 && observed.theme_preserved === true, 'Closing touch activated the underlying screen');
  assert(Number.isFinite(observed.initial) && Number.isFinite(observed.maximum) && observed.maximum > observed.initial, 'Native gesture did not scroll');
  assert(observed.close_target?.width >= 44 && observed.close_target.height >= 44, 'Small close target');
  assert.deepEqual(observed.intervening_operations, [], 'Native tap was not immediate');
  return true;
}
