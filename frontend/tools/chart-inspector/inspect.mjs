#!/usr/bin/env node
// Chart inspector — read our screener's rendered trade plan over the Chrome
// DevTools Protocol and assert it is internally correct (C94).
//
// This is the tradingview-mcp technique turned inward: that project drives
// TradingView Desktop over CDP to read its chart internals; Playwright is the
// SAME CDP client, so here we point it at OUR screener PWA (served on localhost)
// and read OUR rendered trade plan straight out of the DOM — no TradingView, no
// subscription, no external network.
//
// Why it matters: the buy card, the risk→reward ladder, and the risk-plan footer
// each surface pivot / stop / 2R / 3R that were computed upstream. If any of
// those drift, the app ships a self-contradicting plan (the coherence risk the
// capability matrix flagged). This gate reads every buy row and asserts:
//   - the stop shown on the ladder == the stop in the footer line
//   - 2R == pivot + 2·(pivot − stop),  3R == pivot + 3·(pivot − stop)
//   - the "risk −X%" == (pivot − stop) / pivot · 100
// It never touches the frozen metrics (FIRE±5 / GATE / golden) — it is a pure
// display-correctness gate. Exits non-zero on any inconsistency so it can gate CI.
//
// Usage:  node tools/chart-inspector/inspect.mjs <url> [--out DIR] [--tol 0.02]
//   <url>  a running screener PWA page that renders the Today's-Buys card
//   --out  directory for the JSON report + CDP screenshot (default: cwd)
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { checkRow } from './checks.mjs';

const args = process.argv.slice(2);
const url = args.find((a) => !a.startsWith('--'));
const getOpt = (name, def) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
};
if (!url) {
  console.error('usage: node inspect.mjs <url> [--out DIR] [--tol 0.02]');
  process.exit(2);
}
const outDir = resolve(getOpt('--out', process.cwd()));
const tol = Number(getOpt('--tol', '0.02'));
const CHROMIUM = process.env.PW_CHROMIUM_PATH || '/opt/pw-browsers/chromium';

async function main() {
  mkdirSync(outDir, { recursive: true });
  const browser = await chromium.launch({ headless: true, executablePath: CHROMIUM });
  const page = await browser.newPage({ viewport: { width: 420, height: 1400 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-testid="todays-buys-card"]', { timeout: 15000 }).catch(() => {});

  // Raw CDP session — the exact protocol tradingview-mcp uses.
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Runtime.enable');
  const evaluate = async (expression) =>
    (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value;

  const rows = await evaluate(`(() => {
    // Grab the first number after a label, tolerating separator elements
    // ("STOP |  | 124.10") — label, then any non-numeric chars, then the value.
    const after = (t, label) => { const m = t.match(new RegExp(label + '[^0-9-]*(-?[0-9]+(?:\\\\.[0-9]+)?)')); return m ? Number(m[1]) : null; };
    return [...document.querySelectorAll('[data-testid^="todays-buys-row-"]')].map((el) => {
      const t = el.innerText.replace(/\\n/g, ' | ');
      const footer = (t.match(/stop\\s+(-?\\d+(?:\\.\\d+)?)/) || [])[1];
      const risk = (t.match(/risk\\s*[-−]\\s*(\\d+(?:\\.\\d+)?)%/) || [])[1];
      return {
        symbol: el.getAttribute('data-testid').replace('todays-buys-row-', ''),
        verdict: (document.querySelector('[data-testid="todays-buys-verdict-'+el.getAttribute('data-testid').replace('todays-buys-row-','')+'"]')||{}).innerText || null,
        pivot: after(t, 'PIVOT'), stop: after(t, 'STOP'),
        t2: after(t, '2R'), t3: after(t, '3R'),
        riskPct: risk != null ? Number(risk) : null,
        footerStop: footer != null ? Number(footer) : null,
      };
    });
  })()`);

  const trendScore = await evaluate(`(document.querySelector('[data-testid="trend-template-score"]')||{}).innerText || null`);

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  writeFileSync(resolve(outDir, 'chart-inspect.png'), Buffer.from(shot.data, 'base64'));

  const violations = rows.flatMap((r) => checkRow(r, tol));
  const report = {
    url, checked_at_rows: rows.length, trend_template_score: trendScore,
    rows, violations, consistent: violations.length === 0,
  };
  writeFileSync(resolve(outDir, 'chart-inspect.json'), JSON.stringify(report, null, 2));
  await browser.close();

  console.log(JSON.stringify(report, null, 2));
  if (violations.length) {
    console.error(`\n✗ ${violations.length} consistency violation(s) — the rendered plan contradicts itself.`);
    process.exit(1);
  }
  console.log(`\n✓ ${rows.length} row(s) internally consistent.`);
}

// Only run when invoked as a script (so checkRow can be unit-tested).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
