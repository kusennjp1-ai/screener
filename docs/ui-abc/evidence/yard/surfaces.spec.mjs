// SCRATCH (ui-abc yardstick, never committed): the cross-surface oracle of plan §5.3. In every market state of the matrix
// (states.mjs MARKETS) and in the newer-session states (pending and late x 50% / 25% / 0%), each SURFACE that states the
// market verdict is read and parsed into { answer, figure }: answer one of open / hold / unknown / waiting, figure 最大N% /
// 0% / null. A text no parser rule recognises THROWS (never a silent null). Surfaces are rows of SURFACES: S1 adds the band,
// the chip and the gate card, S2 the call's market line, S3 the pane, each as one row (a reader and its parser).
// Output: $YARD_OUT/raw/surfaces/<state>.json. Agreement per state: `answer` (every UI surface the same answer, and the
// model's answer equal, or 'open' against 'waiting'), `figureLoose` (every figure a UI surface states equals the model's)
// and `figureStrict` (every UI surface states exactly the model's figure, a null included). Main's disagreements are its
// baseline (e.g. pending/late with cap > 0: the 市場 tab waits while Today's tile still reads 目安≤50%, as
// brief-market-r3.spec.js:184-187 asserts); `surfaces.mjs diff` fails on any surface whose reading changes or any flag that
// turns false.
// Env: YARD_FIXTURE, YARD_TREE, YARD_OUT, YARD_VIEWS (regex on state id).
import { test } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';
import { loadStates, servedRows, safeId } from './states.mjs';
import { openView, settledView } from './extract.mjs';

for (const key of ['YARD_FIXTURE', 'YARD_TREE', 'YARD_OUT']) if (!process.env[key]) throw new Error(`${key} is required`);
const fx = await import(process.env.YARD_FIXTURE);
const { modelMarket, capText } = await import(`${process.env.YARD_TREE}/src/static/portfolioPlan.js`);
const OUT = `${process.env.YARD_OUT}/raw/surfaces`;
mkdirSync(OUT, { recursive: true });
const ONLY = process.env.YARD_VIEWS ? new RegExp(process.env.YARD_VIEWS) : null;
const S = await loadStates(fx);
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 };
const DESK = { viewport: { width: 1440, height: 900 }, isMobile: false, hasTouch: false, deviceScaleFactor: 1 };

// ---- parsers: every rule explicit; anything else throws ----
const figureOf = text => {
  const max = text.match(/(?:目安≤|最大\s*)(\d+)%/);
  if (max) return Number(max[1]) > 0 ? `最大${Number(max[1])}%` : '0%';
  if (/(?:目安\s*|^|[^\d.])0%/.test(text)) return '0%';
  return null;
};
/** The Today 地合い tile (its text after the label). */
function parseTile(text) {
  const t = text.replace(/\s+/g, ' ');
  let answer;
  if (/更新待ち/.test(t)) answer = 'waiting';
  else if (/検討可/.test(t) || /目安≤[1-9]\d*%/.test(t)) answer = 'open';
  else if (/買いは控える/.test(t)) answer = 'hold';
  else if (/見送り|市場未確認|市場条件未確認/.test(t)) answer = 'unknown';
  else throw new Error(`tile: no rule for 「${t}」`);
  return { answer, figure: figureOf(t) };
}
/** A verdict block ([data-testid="brief-regime"]: the 市場 tab's, and Today's at >= 1024). */
function parseVerdict(text) {
  const t = text.replace(/\s+/g, ' ');
  let answer;
  if (/更新待ち|新しい公開を待って/.test(t)) answer = 'waiting';
  else if (/検討できます|検討できる/.test(t)) answer = 'open';
  else if (/控えます|控える/.test(t)) answer = 'hold';
  else if (/確認できません|見送ります|見送り/.test(t)) answer = 'unknown';
  else throw new Error(`verdict: no rule for 「${t}」`);
  return { answer, figure: figureOf(t) };
}

/**
 * A verdict block's statement: its label (strong), its lead (.brief-verdict-head p) and its exposure figure (.brief-exposure b),
 * joined by ' | '. The block's disclosure (独自の目安：上昇トレンド 最大50%・…) is not the statement and is never parsed.
 */
const VERDICT = selector => {
  const block = document.querySelector(selector);
  if (!block) return null;
  const text = sel => block.querySelector(sel)?.innerText.replace(/\s+/g, ' ').trim() ?? '';
  // The 市場 tab's lead is .brief-verdict-head p (MarketScreen.jsx:366); Today's card has one <p> beside the label (MarketCard.jsx:79).
  return [text('strong'), text('.brief-verdict-head p') || text(':scope > div > p'), text('.brief-exposure b')].filter(Boolean).join(' | ');
};

/**
 * The surfaces. `device` and `hash` say where it is read; `read(page)` returns its raw text or null when the surface is
 * absent; `parse` maps the text. Readers use the app's own landmarks (the 地合い tile by its label, the verdict by its testid).
 */
export const SURFACES = [
  { name: 'today-tile@390', device: PHONE, hash: '#/brief', parse: parseTile,
    read: page => page.evaluate(() => { const li = [...document.querySelectorAll('[data-testid="brief-summary"] li')].find(n => n.innerText.trim().startsWith('地合い')); return li ? li.innerText.trim().replace(/^地合い\s*/, '') : null; }) },
  { name: 'today-verdict@1440', device: DESK, hash: '#/brief', parse: parseVerdict,
    read: page => page.evaluate(VERDICT, '#brief-main .brief-left [data-testid="brief-regime"]') },
  { name: 'market-verdict@390', device: PHONE, hash: '#/brief/market', parse: parseVerdict,
    read: page => page.evaluate(VERDICT, '#brief-main [data-testid="brief-regime"]') },
  { name: 'market-verdict@1440', device: DESK, hash: '#/brief/market', parse: parseVerdict,
    read: page => page.evaluate(VERDICT, '#brief-main [data-testid="brief-regime"]') },
];

const states = S.views.filter(v => (v.kind === 'market' && v.screen === 'today') || (v.kind === 'newer' && v.screen === 'today'))
  .map(v => ({ id: v.id.replace(/\/today$/, ''), view: v })).filter(s => !ONLY || ONLY.test(s.id));

test.describe('surfaces', () => {
  for (const { id, view } of states) test(`surfaces ${id}`, async ({ browser }) => {
    test.setTimeout(240000);
    const record = { id, clock: view.clock || 'fixture', surfaces: {} };
    // modelMarket on what the page holds: the served rows (none when the manifest fails: the page has no rows).
    const market = modelMarket(view.open.fail === 'manifest' ? [] : servedRows(fx, view.open));
    record.surfaces.model = { text: `${market.label} ${capText(market.cap)}`, answer: market.state === 'unknown' ? 'unknown' : market.cap > 0 ? 'open' : 'hold', figure: market.state === 'unknown' ? null : capText(market.cap) };
    for (const surface of SURFACES) {
      const context = await browser.newContext({ ...surface.device, reducedMotion: 'reduce' });
      const page = await context.newPage();
      try {
        await openView(fx, page, { ...view, hash: surface.hash, steps: [], stock: false });
        await settledView(fx, page, { ...view, stock: false });
        const text = await surface.read(page);
        record.surfaces[surface.name] = text === null ? { absent: true } : { text, ...surface.parse(text) };
      } finally { await context.close(); }
    }
    const ui = Object.entries(record.surfaces).filter(([name, s]) => name !== 'model' && !s.absent).map(([, s]) => s), model = record.surfaces.model;
    const answers = [...new Set(ui.map(s => s.answer))];
    record.agree = {
      answer: answers.length === 1 && (answers[0] === model.answer || (model.answer === 'open' && answers[0] === 'waiting')),
      figureLoose: ui.every(s => s.figure === null || s.figure === model.figure),
      figureStrict: ui.every(s => s.figure === model.figure),
    };
    writeFileSync(`${OUT}/${safeId(id)}.json`, JSON.stringify(record));
  });
});
