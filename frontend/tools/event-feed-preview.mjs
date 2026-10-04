import { chromium } from '@playwright/test';
import { readFile, mkdir, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, extname, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { eventFeedPreviewFixture } from './event-feed-preview-fixture.mjs';
import { researchFeedMetrics } from './research-feed-acceptance.mjs';
import { derivePublicPreviewTrace } from './event-feed-preview-public-trace.mjs';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { filterRanked } from '../src/static/researchPresentation.js';

if (!process.env.CI) throw Error('Run this screenshot preview only in GitHub Actions.');
const root = resolve('dist'), output = resolve('test-results/event-feed-preview');
await mkdir(output, { recursive: true });
const sha256 = value => createHash('sha256').update(value).digest('hex');
const report = { commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), source_run: `https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`,
  captured_at: new Date().toISOString(), purpose: 'Draft production-build visual preview only; not Design Acceptance, a performance test, or a release.', screens: [], failures: [], public_resources: [] };
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml' };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname), relative = pathname.replace(/^\/screener\//, '').replace(/^\/+/, '') || 'index.html';
    let file = resolve(root, relative);
    if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream' });response.end(await readFile(file));
  } catch { response.writeHead(404);response.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/screener/`, browser = await chromium.launch();
const fixture = eventFeedPreviewFixture(), publicCache = new Map();
const publicBase = 'https://kusennjp1-ai.github.io/screener/static-data/';
async function published(path) {
  if (!path || path.split('/').some(part => part === '..') || /[?#\\]/.test(path)) throw Error('Invalid public data path');
  const url = new URL(path, publicBase);
  if (!url.href.startsWith(publicBase)) throw Error('Public preview origin mismatch');
  if (!publicCache.has(path)) publicCache.set(path, (async () => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw Error(`Published resource ${path}: HTTP ${response.status}`);
    const body = Buffer.from(await response.arrayBuffer()), type = response.headers.get('content-type') || 'application/json';
    report.public_resources.push({ path, url: url.href, sha256: sha256(body), bytes: body.length, retrieved_at: new Date().toISOString() });
    return { body, type };
  })());
  return publicCache.get(path);
}
// Pin one manifest response for all real-data views. Referenced immutable
// payloads are then fetched once and recorded, rather than mixing manifest ages.
let derivedTrace;
try {
  const manifest = JSON.parse((await published('manifest.json')).body.toString('utf8'));
  report.public_snapshot = { as_of_date: manifest.markets?.US?.as_of_date || manifest.as_of_date, generated_at: manifest.generated_at, research_generation: manifest.research_generation };
  try {
    derivedTrace = await derivePublicPreviewTrace({ manifest, readResource: published, preferredSymbol: 'DELL' });
    report.derived_trace = derivedTrace.provenance;
  } catch (error) { report.failures.push(error.message); }
} catch (error) { report.failures.push(`Public snapshot unavailable: ${error.message}`); }

for (const source of ['synthetic', 'public', 'public-derived-trace']) for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 568 }]) {
  if (source === 'public' && !report.public_snapshot) continue;
  if (source === 'public-derived-trace' && !derivedTrace) continue;
  const context = await browser.newContext({ viewport, serviceWorkers: 'block' }), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (source === 'synthetic') await page.clock.setFixedTime(new Date(fixture.now));
  await context.route('**/static-data/**', async route => {
    const path = new URL(route.request().url()).pathname.split('/static-data/')[1];
    try {
      const data = source === 'synthetic' ? fixture.resources.get(path) : (source === 'public-derived-trace' && derivedTrace.resources.get(path)) || await published(path);
      if (!data) return route.fulfill({ status: 404, body: 'Not part of the synthetic fixture' });
      return route.fulfill({ contentType: data.type, body: data.body });
    } catch (error) { errors.push(error.message);return route.fulfill({ status: 503, body: 'Preview source unavailable' }); }
  });
  const capture = async name => {
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const filename = `${source}-${name}-${viewport.width}x${viewport.height}-dark.png`, path = resolve(output, filename);
    await page.screenshot({ path });
    const observation = await page.evaluate(() => ({ route: location.hash, theme: document.querySelector('.leader-shell')?.dataset.theme, preview_badge: document.querySelector('.research-preview-badge')?.textContent || null, symbol: document.querySelector('.research-detail .symbol-title h2')?.textContent || document.querySelector('.candidate-feed-card .candidate-name strong')?.textContent || null,
      page_size: document.querySelector('#candidate-board')?.dataset.feedPageSize, total: document.querySelector('#candidate-board')?.dataset.feedTotal, horizontal_body_overflow: document.documentElement.scrollWidth > innerWidth,
      text: document.querySelector('.research-feed-main')?.innerText.slice(0, 14000) || null }));
    report.screens.push({ screenshot: filename, screenshot_sha256: sha256(await readFile(path)), source, fixture: source === 'synthetic' ? { name: 'event-feed-preview-v1', symbols: fixture.symbols, fixed_clock: new Date(fixture.now).toISOString(), limitation: 'Synthetic price and financial evidence, not actual stocks or vendor observations.' } : { ...report.public_snapshot, clock: 'Actual browser clock; public financial evidence may be unavailable or expired.' }, viewport, observation });
    if (source === 'public-derived-trace') report.screens.at(-1).derived_trace_provenance = derivedTrace.provenance;
    if (observation.preview_badge !== '検証版') errors.push(`${name}: the unpublished preview is not labelled`);
    if (observation.horizontal_body_overflow) errors.push(`${name}: horizontal body overflow`);
    if (name === 'feed') {
      const essential = await page.evaluate(researchFeedMetrics);
      report.screens.at(-1).essential_evidence = essential.feed;
      for (const metric of essential.feed.metrics) for (const field of ['actual', 'status', 'role', 'condition']) {
        if (!metric[field]?.firstViewport) errors.push(`feed: ${metric.id} ${field} is outside the unobscured first viewport`);
      }
      for (const field of ['selection', 'daily']) if (!essential.feed.decisions?.[field]?.firstViewport) errors.push(`feed: ${field} state is outside the unobscured first viewport`);
      if (essential.feed.decisions?.annual?.required && !essential.feed.decisions.annual.firstViewport) errors.push('feed: required annual EPS status is outside the unobscured first viewport');
    }
    if (name === 'table') {
      const rows = await page.locator('tr[data-feed-symbol]').evaluateAll(rows => rows.map(row => {
        const button = row.querySelector('.candidate-row'), annual = row.querySelector('.research-table-annual');
        return { symbol: row.dataset.feedSymbol, button_clips: button.scrollHeight > button.clientHeight + 1,
          annual_overlaps_identity: annual && annual.getBoundingClientRect().top < button.getBoundingClientRect().bottom - 1 };
      }));
      report.screens.at(-1).table_identity_geometry = rows;
      for (const row of rows) if (row.button_clips || row.annual_overlaps_identity) errors.push(`table: ${row.symbol} identity or annual state is clipped/overlapped`);
    }
  };
  try {
    await page.goto(`${base}#/?method=oneil`);
    await page.locator('.candidate-feed-card').first().waitFor({ state: 'visible', timeout: 60000 });
    if (source === 'public-derived-trace') {
      const derivedManifest = JSON.parse(derivedTrace.resources.get('manifest.json').body.toString('utf8'));
      const derivedIndex = JSON.parse(derivedTrace.resources.get(derivedManifest.markets.US.assets.research.path).body.toString('utf8'));
      const expectedSearch = filterRanked(decodeResearchIndex(derivedIndex).rows.filter(row => row.market === 'US' || !row.market).map(row => ({ row, assessment: {} })), { search: derivedTrace.symbol, liquidOnly: true }).map(item => item.row.symbol);
      report.search_expectation = { query: derivedTrace.symbol, count: expectedSearch.length, symbols: expectedSearch };
      await page.evaluate(({ query, count }) => {
        window.__previewSearchInconsistencies = [];
        const board = document.getElementById('candidate-board');
        const observer = new MutationObserver(() => {
          const active = [...board.querySelectorAll('button')].some(button => button.getAttribute('aria-label') === `検索：${query}の絞り込みを解除`);
          if (active && Number(board.dataset.feedTotal) !== count) window.__previewSearchInconsistencies.push({ query, displayed_total: Number(board.dataset.feedTotal), expected_total: count });
        });
        observer.observe(board, { subtree: true, childList: true, attributes: true, characterData: true });
      }, { query: derivedTrace.symbol, count: expectedSearch.length });
      await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
      const drawer = page.getByRole('dialog', { name: '候補を絞り込む', exact: true });
      await drawer.getByLabel('銘柄・企業名を検索', { exact: true }).fill(derivedTrace.symbol);
      await drawer.getByRole('button', { name: '候補を確認する →', exact: true }).click();
      await page.waitForFunction(({ symbol, count }) => Number(document.getElementById('candidate-board')?.dataset.feedTotal) === count && [...document.querySelectorAll('.candidate-feed-card .candidate-name strong')].some(node => node.textContent === symbol), { symbol: derivedTrace.symbol, count: expectedSearch.length });
      const mismatches = await page.evaluate(() => window.__previewSearchInconsistencies);
      if (mismatches.length) errors.push(`Search chip and committed count disagreed: ${JSON.stringify(mismatches.slice(0, 5))}`);
    }
    await page.locator('.feed-price-trace img').first().evaluate(image => image.complete ? undefined : new Promise(resolve => { image.addEventListener('load', resolve, { once: true });image.addEventListener('error', resolve, { once: true }); })).catch(() => {});
    await capture('feed');
    if (source === 'public-derived-trace') {
      const traceImage = page.locator('.feed-price-trace img').first();
      if (!await traceImage.evaluate(image => image.complete && image.naturalWidth > 0)) throw Error('Derived canonical price trace did not load');
      await traceImage.scrollIntoViewIfNeeded();await capture('trace');
    }
    await page.getByRole('button', { name: '表', exact: true }).click();
    await page.getByRole('region', { name: '銘柄候補の比較表' }).waitFor({ state: 'visible' });
    await capture('table');
    await page.getByRole('button', { name: 'フィード', exact: true }).click();
    await page.locator('.feed-open-evidence').first().click();
    await page.locator('.research-detail .financial-evidence-summary').waitFor({ state: 'visible' });
    await capture('detail');
    await page.getByRole('button', { name: '← 候補一覧に戻る', exact: true }).click();
    await page.locator('.candidate-feed-card').first().waitFor({ state: 'visible' });
  } catch (error) {
    errors.push(error.message);
    await capture('interrupted').catch(() => {});
  } finally {
    report.failures.push(...errors.map(message => `${source}/${viewport.width}: ${message}`));
    await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
    await context.close();
  }
}
await browser.close();await new Promise(resolve => server.close(resolve));
await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ commit: report.commit, screens: report.screens.length, failures: report.failures, public_snapshot: report.public_snapshot }, null, 2));
if (report.failures.length) process.exitCode = 1;
