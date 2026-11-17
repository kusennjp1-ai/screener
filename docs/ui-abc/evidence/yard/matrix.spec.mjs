// SCRATCH (ui-abc yardstick, never committed): the state-matrix driver (plan §5.2/§5.3). One Playwright test per view and
// mode, each in a fresh context (an Expander keeps its open state per session, so a reused page would contaminate the closed
// extraction). The page clock is PINNED in every view: openBrief fixes it at the fixture's analysis clock
// (brief-fixture.js:443), and a newer-session view moves it to its own clock and reloads (brief-freshness.spec.js:20).
// Modes: '375' (375x812: matrix record, the closed values, the closed first fold, then every <details>/expander opened and
// the opened values), '390f' (390x844: the closed first fold only), '1440' (1440x900: matrix record, closed and opened).
// Collectors (YARD_COLLECT, default 'matrix,values'): one file per view, mode and collector under
// $YARD_OUT/raw/<collector>/<mode>/<id>.json. Payloads carry no port, path, head or timestamp.
// Env: YARD_FIXTURE (the served worktree's brief-fixture.js), YARD_TREE (its frontend dir, for the tree's own modelMarket),
//      YARD_OUT, YARD_VIEWS (regex on id), YARD_MODES (comma list), YARD_SKIP_EXISTING=1 (resume after a cut).
import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { loadStates, servedRows, safeId } from './states.mjs';
import { collectValues, collectFold, openAll, quietDom, settleAll, openView, settledView } from './extract.mjs';

for (const key of ['YARD_FIXTURE', 'YARD_TREE', 'YARD_OUT']) if (!process.env[key]) throw new Error(`${key} is required`);
const fx = await import(process.env.YARD_FIXTURE);
const { modelMarket, capText } = await import(`${process.env.YARD_TREE}/src/static/portfolioPlan.js`);
const OUT = process.env.YARD_OUT;
const COLLECT = (process.env.YARD_COLLECT || 'matrix,values').split(',');
const MODES = (process.env.YARD_MODES || '375,390f,1440').split(',');
const ONLY = process.env.YARD_VIEWS ? new RegExp(process.env.YARD_VIEWS) : null;
const S = await loadStates(fx);
const DEVICES = {
  375: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  '390f': { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  1440: { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 },
};
const fileOf = (collector, mode, id) => `${OUT}/raw/${collector}/${mode}/${safeId(id)}.json`;
const norm = text => String(text).replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:PORT');

/**
 * The reach check: the page clock (Date.now in the page must be the view's own clock, or the fixture's `now` when the view has
 * none: proves a newer-session view really moved the clock), the tree's own modelMarket on the served rows, the page's
 * data-gate, the bar and page texts. A failed reach fails the test in every mode (390f writes no matrix record).
 */
async function reachOf(page, view) {
  const out = { why: [] };
  const want = new Date(view.clock ? Date.parse(view.clock) : fx.now).toISOString();
  out.now = await page.evaluate(() => new Date(Date.now()).toISOString());
  if (out.now !== want) out.why.push(`page clock ${out.now} != ${want}`);
  if (view.expect?.model) {
    const market = modelMarket(servedRows(fx, view.open));
    out.model = { label: market.label, cap: market.cap, capText: capText(market.cap), state: market.state ?? null };
    if (market.label !== view.expect.model[0] || market.cap !== view.expect.model[1]) out.why.push(`model ${market.label}/${market.cap} != ${view.expect.model.join('/')}`);
  }
  const text = await page.evaluate(() => document.querySelector('.brief')?.innerText || '');
  if (view.expect?.text && !new RegExp(view.expect.text).test(text)) out.why.push(`text /${view.expect.text}/ not shown`);
  const bar = await page.locator('.brief-bar').innerText().catch(() => '');
  if (view.expect?.barText && !bar.includes(view.expect.barText)) out.why.push(`bar lacks ${view.expect.barText}`);
  if (view.expect?.barNot && bar.includes(view.expect.barNot)) out.why.push(`bar shows ${view.expect.barNot}`);
  out.gate = await page.locator('#brief-main [data-testid="brief-conclusion"]').first().getAttribute('data-gate', { timeout: 2000 }).catch(() => null);
  if (view.expect?.gate && out.gate !== view.expect.gate) out.why.push(`data-gate ${out.gate} != ${view.expect.gate}`);
  return out;
}

const geometry = page => page.evaluate(() => {
  const stack = document.querySelector('#brief-main .brief-stack'), bar = document.querySelector('.brief-bar'), dock = document.querySelector('.brief-dock');
  return { hash: location.hash, page: document.documentElement.scrollHeight,
    content: stack ? Math.round(stack.getBoundingClientRect().bottom + scrollY) : null,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bar: bar ? Math.round(bar.getBoundingClientRect().height * 2) / 2 : null, dock: dock ? Math.round(dock.getBoundingClientRect().height * 2) / 2 : null,
    rows: [...document.querySelectorAll('[data-testid="brief-candidate"]')].filter(n => n.getClientRects().length).map(n => n.getAttribute('data-symbol')) };
});

const views = S.views.filter(view => !ONLY || ONLY.test(view.id));
for (const mode of MODES) test.describe(`matrix ${mode}`, () => {
  test.use({ ...DEVICES[mode], contextOptions: { reducedMotion: 'reduce' } });
  for (const view of views.filter(v => v.modes.includes(mode))) test(`${mode} ${view.id}`, async ({ page }) => {
    test.setTimeout(180000);
    const wanted = COLLECT.filter(c => !(c === 'matrix' && mode === '390f'));
    if (process.env.YARD_SKIP_EXISTING === '1' && wanted.every(c => existsSync(fileOf(c, mode, view.id)))) test.skip();
    const write = (collector, payload) => { mkdirSync(`${OUT}/raw/${collector}/${mode}`, { recursive: true }); writeFileSync(fileOf(collector, mode, view.id), JSON.stringify(payload)); };
    const errors = await openView(fx, page, view);
    const notes = [...(errors.steps || []), ...(await settledView(fx, page, view))];
    const reach = await reachOf(page, view);
    // The matrix record is read as loaded (folds closed), before anything is opened.
    const matrix = { id: view.id, mode, kind: view.kind, market: view.market, screen: view.screen, src: view.src, clock: view.clock || 'fixture', ...(await geometry(page)), reach, notes };
    if (wanted.includes('values')) {
      const record = { id: view.id, mode };
      // The fold's lines are the record; what the closed-<details> rule left out (rect-dependent) goes to the off-hash
      // `foldcheck` collector (merged into foldcheck.json, outside sha256.txt).
      const fold = async () => { const f = await collectFold(page); record.fold = f.lines; write('foldcheck', { id: view.id, mode, noRule: f.noRule, skipped: f.skipped }); };
      if (mode === '390f') await fold();
      else {
        record.closed = await collectValues(page);
        if (mode === '375') await fold();
        record.openedCount = await openAll(page);
        await settleAll(page); await quietDom(page); await settleAll(page);
        await page.evaluate(() => window.scrollTo(0, 0));
        record.opened = await collectValues(page);
      }
      write('values', record);
    }
    matrix.errors = errors.map(norm);
    if (wanted.includes('matrix')) write('matrix', matrix);
    expect(reach.why, `${view.id} ${mode}: state not reached`).toEqual([]);
  });
});
