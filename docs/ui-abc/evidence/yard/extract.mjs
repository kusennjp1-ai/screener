// SCRATCH (ui-abc yardstick, never committed): the page-side extraction and the shared open/settle helpers of the yard's
// browser tools (matrix/values, surfaces, shots). Plan §5.3. No selector list decides what text is read: every rendered text
// line of the bar and #brief-main is taken; the selector lists below only PAIR labels with values (PAIR_CELLS; a later
// package appends its own cell selectors here).
import { expect } from '@playwright/test';

/** Label-bound cells: [kind, selector]. dt/dd and th/td pairs are read generically besides these. */
export const PAIR_CELLS = [
  ['tile', '[data-testid="brief-summary"] li'],
  ['kgrid', '.brief-kgrid > *'],
  ['fact', '.brief-facts > *'],
  ['stats', '.brief-index-stats > *'],
  ['ftdrow', '.brief-ftd-row'],
];
/** Accessible-name roles kept from the aria snapshot (plan §5.3: links, buttons, regions, role=img; tabs too). */
const NAME_ROLES = /^(link|button|region|img|tab|tabpanel|group|switch|checkbox)$/;
/** The number tokens of plan §5.3. */
export const NUMBER_RE = /[+−]?\$?\d[\d,]*(?:\.\d+)?(?:%|×|株|営業日|日|件|銘柄|位|週|条件)?/g;

const QUIET_MS = 1500;
/** DOM quiescence: no mutation for 1.5 s (the harness dump's rule; the desktop list paints the rest of its rows late). */
export const quietDom = page => page.evaluate(ms => new Promise(resolve => {
  let timer = null; const stop = setTimeout(() => done(), 20000);
  const done = () => { obs.disconnect(); clearTimeout(timer); clearTimeout(stop); resolve(); };
  const obs = new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(done, ms); });
  obs.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
  timer = setTimeout(done, ms);
}), QUIET_MS);
/**
 * Every RUNNING finite animation finished, polled live (as the fixture's chartSettled does), at most 15 s. Awaiting
 * `animation.finished` of every finite animation (the harness's settle) hung once on main for 180 s (390f pend-m50/stock-ZZNV,
 * S1-P0): a paused or idle animation's promise never resolves, so only running ones are waited for.
 */
export const settleAll = page => page.waitForFunction(() => !document.getAnimations().some(a => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity), null, { timeout: 15000, polling: 100 }).catch(() => {});

/** Open a view as its recipe says (pinned clock; a newer-session view moves the clock and reloads), then do its steps. */
export async function openView(fx, page, view) {
  const { errors } = await fx.openBrief(page, view.hash, view.open);
  if (view.clock) { await page.clock.setFixedTime(new Date(view.clock)); await page.reload(); }
  await page.locator('.brief[data-theme]').waitFor({ state: 'attached', timeout: 60000 });
  // A step the state cannot take (no rows to filter on a failed manifest, no tab) is a note, never a hang.
  const steps = [];
  for (const step of view.steps || []) {
    if (step.filter) {
      await page.getByTestId('brief-candidate').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => {});
      await page.getByRole('group', { name: '絞り込み' }).getByRole('button', { name: new RegExp(step.filter) }).click({ timeout: 10000 })
        .catch(() => steps.push(`filter ${step.filter} not clickable`));
    }
    if (step.more) { // 「さらに表示」 until the whole list is shown (ListView's phone page size), at most 10 pages
      const more = page.locator('#brief-main .brief-morebutton');
      for (let i = 0; i < 10 && await more.count(); i++) await more.first().click({ timeout: 10000 }).catch(() => steps.push('more not clickable'));
      await page.getByTestId('brief-candidate').last().waitFor({ state: 'visible', timeout: 10000 }).catch(() => {});
    }
    if (step.tab !== undefined) {
      const tab = page.getByRole('tablist', { name: '市場タブの表示' }).getByRole('tab').nth(step.tab);
      await tab.click({ timeout: 10000 }).then(() => expect(tab).toHaveAttribute('aria-selected', 'true')).catch(() => steps.push(`tab ${step.tab} not selectable`));
    }
  }
  errors.steps = steps;
  return errors;
}

/** Ready: no loading text (design-review's briefReady), charts settled (fixture H3), network idle, DOM quiet, top of page. */
export async function settledView(fx, page, view) {
  const notes = [];
  await page.waitForFunction(() => !/読み込み中|読込中|取得中/.test(document.querySelector('.brief')?.innerText || ''), null, { timeout: 30000 }).catch(() => notes.push('loading text after 30s'));
  if (view.stock) await page.locator('#brief-main [data-testid="brief-price-chart"]').first().waitFor({ state: 'attached', timeout: 20000 }).catch(() => notes.push('no chart'));
  // The wide layout's right pane draws its stock (and chart) after the list (the harness dump's rule): wait for its candles.
  await page.waitForFunction(() => { const pane = document.querySelector('.brief-right'); if (!pane || !pane.querySelector('[data-testid="brief-conclusion"], [data-testid="brief-price-chart"]')) return true;
    const chart = pane.querySelector('[data-testid="brief-price-chart"]'); return chart && (chart.querySelector('svg rect.bc-up, svg rect.bc-down') || chart.querySelector('.brief-chart-empty, .brief-chart-failed')); }, null, { timeout: 30000 }).catch(() => notes.push('right pane chart not drawn'));
  await fx.chartSettled(page).catch(error => notes.push(`chartSettled: ${error.message.split('\n')[0]}`));
  await page.waitForLoadState('networkidle').catch(() => {});
  await settleAll(page); await quietDom(page); await settleAll(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  return notes;
}

/** Open every closed <details> (expanders) and every collapsed toggle in #brief-main, repeatedly (nested). Returns the count. */
export const openAll = page => page.evaluate(async () => {
  let opened = 0;
  for (let round = 0; round < 6; round++) {
    const closed = [...document.querySelectorAll('.brief-bar details:not([open]), #brief-main details:not([open])')];
    const toggles = [...document.querySelectorAll('#brief-main button[aria-expanded="false"]')].filter(b => b.getClientRects().length);
    if (!closed.length && !toggles.length) break;
    for (const d of closed) { d.open = true; opened++; }
    for (const b of toggles) { b.click(); opened++; }
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  }
  return opened;
});

/**
 * The closed-<details> rule (shared by the values and the first fold, inside pageSide below): a node is folded away when an
 * ancestor <details> is closed and the node is not inside that details' own first <summary> child. Chrome lays the content of
 * a closed <details> out under `content-visibility: hidden`, so its text nodes and elements still return rects (stale
 * positions above the dock) and getComputedStyle shows nothing hidden: neither a rect nor a style check can see it.
 */

/**
 * The page-side extraction (closed or opened): text lines, SVG text, label-bound pairs, number tokens, and the dock's lines.
 * A pair cell, SVG text, li, row or input counts only when it is rendered (has client rects) and not folded away by a closed
 * <details> (the rule above, the same one the first fold applies; innerText already leaves that content out of the lines).
 * Pairs: the PAIR_CELLS selectors, dt/dd, th/td, and the generic bindings — every li of the bar and #brief-main
 * (`li|<first line>|<the rest joined by " / ">`, sr-only text as innerText gives it), every candidate row
 * (`row|<data-symbol>|<its lines joined by " / ">`), every input/select/textarea (`input|<aria-label or label text>|<value>`)
 * and (round 2) every VCP leg button (`leg|T<n>|<depth> / <length> / <volume>`).
 */
function pageSide({ what, cells, numberSource }) {
  const folded = node => {
    for (let child = node, n = node.parentNode; n && n !== document.body; child = n, n = n.parentNode) {
      if (n.nodeName === 'DETAILS' && !n.open && child !== [...n.children].find(c => c.tagName === 'SUMMARY')) return true;
    }
    return false;
  };
  if (what === 'fold') return foldOf(folded);
  const roots = [document.querySelector('.brief-bar'), document.querySelector('#brief-main')].filter(Boolean);
  const clean = s => s.replace(/[ \t ]+/g, ' ').trim();
  const lines = roots.flatMap(root => root.innerText.split('\n').map(clean).filter(Boolean));
  const shown = n => n.getClientRects().length > 0 && !folded(n);
  const svg = [...document.querySelectorAll('#brief-main svg text')].filter(shown).map(t => clean(t.textContent)).filter(Boolean);
  const partsOf = el => el.innerText.split('\n').map(clean).filter(Boolean);
  const pairs = [];
  for (const [kind, selector] of cells) for (const cell of document.querySelectorAll(selector)) {
    if (!shown(cell)) continue;
    const parts = partsOf(cell);
    if (parts.length) pairs.push(`${kind}|${parts[0]}|${parts.slice(1).join(' / ')}`);
  }
  for (const dt of document.querySelectorAll('.brief-bar dt, #brief-main dt')) {
    if (!shown(dt)) continue;
    const dd = dt.nextElementSibling?.tagName === 'DD' ? dt.nextElementSibling : null;
    pairs.push(`dl|${clean(dt.innerText)}|${dd ? clean(dd.innerText.replace(/\n/g, ' / ')) : ''}`);
  }
  for (const tr of document.querySelectorAll('#brief-main tr')) {
    if (!shown(tr)) continue;
    const head = tr.querySelector('th'), cellsIn = [...tr.querySelectorAll('td')];
    if (head && cellsIn.length) pairs.push(`tr|${clean(head.innerText)}|${cellsIn.map(td => clean(td.innerText.replace(/\n/g, ' / '))).join(' | ')}`);
  }
  // The generic bindings: a value printed beside its label in any list item, any candidate row, any input.
  for (const li of document.querySelectorAll('.brief-bar li, #brief-main li')) {
    if (!shown(li)) continue;
    const parts = partsOf(li);
    if (parts.length) pairs.push(`li|${parts[0]}|${parts.slice(1).join(' / ')}`);
  }
  for (const row of document.querySelectorAll('.brief-bar [data-testid="brief-candidate"], #brief-main [data-testid="brief-candidate"]')) {
    if (shown(row)) pairs.push(`row|${row.getAttribute('data-symbol') ?? ''}|${partsOf(row).join(' / ')}`);
  }
  // Round 2: the VCP leg cells (StockVcpCard's leg buttons: the button holding .brief-legbar), `leg|T<n>|<depth> / <length> /
  // <volume>` from its <b> and the spans after it, so two legs' printed depths exchanging places is a diff (as lines they
  // are separate, equal multisets).
  for (const button of document.querySelectorAll('.brief-bar button:has(> .brief-legbar), #brief-main button:has(> .brief-legbar)')) {
    const b = button.querySelector(':scope > b');
    if (!b || !shown(button)) continue;
    const after = [];
    for (let el = b.nextElementSibling; el; el = el.nextElementSibling) if (el.tagName === 'SPAN') after.push(clean(el.innerText));
    pairs.push(`leg|${clean(b.innerText)}|${after.join(' / ')}`);
  }
  for (const input of document.querySelectorAll('.brief-bar :is(input, select, textarea), #brief-main :is(input, select, textarea)')) {
    if (!shown(input) || input.type === 'hidden') continue;
    const by = input.getAttribute('aria-labelledby');
    const label = clean(input.getAttribute('aria-label') || (by ? by.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ') : '')
      || (input.labels?.[0] ? partsOf(input.labels[0])[0] || '' : '') || input.getAttribute('placeholder') || input.name || input.id || '');
    const value = input.type === 'checkbox' || input.type === 'radio' ? (input.checked ? 'checked' : 'unchecked')
      : input.tagName === 'SELECT' ? [...input.selectedOptions].map(o => clean(o.text)).join(' / ') : input.value;
    pairs.push(`input|${label}|${value}`);
  }
  const re = new RegExp(numberSource, 'g');
  const numbers = [...lines, ...svg].flatMap(line => line.match(re) || []);
  // The phone's dock (tabs, or the stock screen's list position and buttons): its own section, never in the lines or the fold.
  // Only a .brief-dock outside #brief-main (at >= 1024 the tab bar inside the left pane carries the class too, and is read
  // with #brief-main).
  const dockEl = [...document.querySelectorAll('.brief-dock')].find(d => !d.closest('#brief-main'));
  const dock = dockEl ? dockEl.innerText.split('\n').map(clean).filter(Boolean) : [];
  return { lines, svg, pairs, numbers, dock };

  // ---- the closed first fold (collectFold) ----
  function foldOf(folded) {
    window.scrollTo(0, 0);
    const dock = [...document.querySelectorAll('.brief-dock')].find(d => !d.closest('#brief-main')), limit = dock ? dock.getBoundingClientRect().top : innerHeight;
    const roots = [document.querySelector('.brief-bar'), document.querySelector('#brief-main')].filter(Boolean);
    const hidden = el => {
      for (let n = el; n && n !== document.body; n = n.parentElement) {
        if (n.classList?.contains('sr-only')) return true;
        const cs = getComputedStyle(n);
        if (cs.visibility === 'hidden' || cs.opacity === '0' || cs.display === 'none') return true;
        if (cs.clip && cs.clip !== 'auto') return true;
        // The visually-hidden patterns (.sr-only's clip, .brief-chip-aside's clip-path: inset(50%), a 1px overflow-hidden box).
        if (cs.clipPath && cs.clipPath !== 'none') return true;
        if (cs.position === 'absolute' && cs.overflow === 'hidden' && n.getBoundingClientRect().width <= 1.5 && n.getBoundingClientRect().height <= 1.5) return true;
      }
      return false;
    };
    // Runs: each text node's visible characters split where the node wraps to a new line (a run never mixes two nodes, so two
    // elements sharing a line are never interleaved character by character). A run of a node inside a closed <details> is
    // marked `folded`: it is left out of the fold (and kept only for the off-hash `noRule` check of the record).
    const runs = [], skipped = [];
    for (const root of roots) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const text = node.textContent;
        if (!text.trim() || !node.parentElement) continue;
        const box = node.parentElement.getBoundingClientRect();
        if (box.top >= limit || box.bottom <= 0 || hidden(node.parentElement)) continue;
        const isFolded = folded(node);
        if (isFolded) skipped.push(text.trim().slice(0, 40));
        const range = document.createRange();
        let run = null;
        for (let i = 0; i < text.length; i++) {
          range.setStart(node, i); range.setEnd(node, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width < 0.5 || r.height < 0.5) continue;
          const mid = (r.top + r.bottom) / 2;
          if (!run || Math.abs(run.mid - mid) > 3) { run = { mid, top: r.top, bottom: r.bottom, left: r.left, right: r.right, text: '', folded: isFolded }; runs.push(run); }
          run.text += text[i]; run.top = Math.min(run.top, r.top); run.bottom = Math.max(run.bottom, r.bottom); run.right = Math.max(run.right, r.right);
        }
      }
    }
    // Visual lines: runs whose vertical centres lie within 3px of a line's centre, read left to right.
    const group = list => {
      const lines = [];
      for (const run of list) {
        if (!run.text.trim()) continue;
        let line = lines.find(l => Math.abs(l.mid - run.mid) <= 3);
        if (!line) { line = { mid: run.mid, top: run.top, bottom: run.bottom, runs: [] }; lines.push(line); }
        line.top = Math.min(line.top, run.top); line.bottom = Math.max(line.bottom, run.bottom); line.runs.push(run);
      }
      return lines.filter(l => l.top >= 0 && l.bottom <= limit + 0.5).sort((a, b) => a.mid - b.mid)
        .map(l => l.runs.sort((a, b) => a.left - b.left).map((r, i, all) => (i && r.left - all[i - 1].right > 2.5 ? ' ' : '') + r.text).join('').replace(/\s+/g, ' ').trim()).filter(Boolean);
    };
    return { lines: group(runs.filter(run => !run.folded)), noRule: group(runs), skipped };
  }
}

/** Multiset form, sorted (byte-stable): [[text, count], ...]. */
export const multiset = list => [...list.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map())].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));

/** Accessible names from Playwright's aria snapshot of a root: `role "name"` for NAME_ROLES. */
async function names(page, selectors = ['.brief-bar', '#brief-main']) {
  const out = [];
  for (const selector of selectors) {
    const loc = page.locator(selector).first();
    if (!(await loc.count())) continue;
    const yaml = await loc.ariaSnapshot({ timeout: 10000 }).catch(() => '');
    for (const line of yaml.split('\n')) {
      const m = line.match(/^\s*- ([a-z]+)(?: "((?:[^"\\]|\\.)*)")?/);
      if (m && NAME_ROLES.test(m[1])) out.push(`${m[1]} ${m[2] ?? ''}`.trim());
    }
  }
  return out;
}

export async function collectValues(page) {
  const v = await page.evaluate(pageSide, { what: 'values', cells: PAIR_CELLS, numberSource: NUMBER_RE.source });
  // The dock section: its text lines (`line|…`) and accessible names (`name|…`), apart from the bar and #brief-main.
  const dock = [...v.dock.map(t => `line|${t}`), ...(await names(page, ['.brief-dock:not(#brief-main *)'])).map(t => `name|${t}`)];
  // Round 2: `seq` = the same lines as `lines`, in document order (.brief-bar, then #brief-main; innerText, so a closed
  // <details> outside its summary is left out exactly as in `lines`): values.mjs diff's `lineOrder` reads it.
  return { lines: multiset(v.lines), svg: multiset(v.svg), pairs: multiset(v.pairs), numbers: multiset(v.numbers), names: multiset(await names(page)), dock: multiset(dock), seq: v.lines };
}

/**
 * The closed first fold: the visual lines (per-character boxes from Range rects, grouped by line) of the bar and #brief-main
 * whose box lies wholly above the dock's top (or the viewport's bottom without a dock), at scroll 0. What the reader sees
 * before any tap: clipped (sr-only) and invisible text is left out, and so is any text inside a CLOSED <details> outside that
 * details' own first <summary> (the closed-<details> rule above: such text keeps stale rects above the dock, and no style shows it hidden).
 * Returns { lines, noRule, skipped }: `lines` is the fold. `noRule` (the same lines built without the closed-details rule, as
 * the S1-P0 baseline built them) and `skipped` (the closed-details text nodes whose element box lay above the limit, first 40
 * characters) depend on stale rects: they are written to the off-hash `foldcheck` record only, never into values.json.
 */
export const collectFold = page => page.evaluate(pageSide, { what: 'fold' });
