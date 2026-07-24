# Chart inspector (CDP trade-plan consistency gate)

The [tradingview-mcp](https://github.com/tradesdontlie/tradingview-mcp) project drives
**TradingView Desktop** (an Electron/Chromium app) over the **Chrome DevTools
Protocol (CDP)** to read a chart's internals — symbol, OHLCV, indicator values,
drawings, screenshots — because TradingView has no public API but Chromium does.

This tool applies the **same technique to our own screener**. Playwright is a CDP
client, so we point it at the screener PWA (served on `localhost`) and read our
**rendered trade plan** straight out of the DOM. No TradingView, no subscription,
no external network — the browser (`/opt/pw-browsers/chromium`) and the app are
both local.

## What it checks

The buy card renders the plan the export computed: pivot, stop, 2R/3R, size,
risk%. Those numbers are re-surfaced in several places, so drift ships a
**self-contradicting plan**. The inspector reads every buy row over CDP and
asserts it is internally correct:

- the stop on the risk→reward ladder equals the stop in the footer line
- `2R == pivot + 2·(pivot − stop)` and `3R == pivot + 3·(pivot − stop)`
- the displayed `risk −X%` equals `(pivot − stop) / pivot · 100`

It writes a JSON report + a CDP screenshot and **exits non-zero on any
violation**, so it can gate CI. It never reads or touches the frozen validation
metrics (FIRE±5 / GATE / golden) — it is a pure display-correctness gate.

## Usage

```bash
# point it at any running screener page that shows the Today's-Buys card
node tools/chart-inspector/inspect.mjs http://localhost:5173/ --out ./inspect

# override the pinned Chromium if needed
PW_CHROMIUM_PATH=/path/to/chromium node tools/chart-inspector/inspect.mjs <url>
```

Output in `--out` (default: cwd): `chart-inspect.json` (rows + violations) and
`chart-inspect.png` (the CDP screenshot).

## Pieces

- `checks.mjs` — the pure consistency rules (`checkRow`), unit-tested in
  `checks.test.mjs` (runs under `npm run test:run`).
- `inspect.mjs` — the CDP runner: launches Chromium, opens a raw CDP session
  (`Runtime.evaluate` + `Page.captureScreenshot`), reads the rows, applies the
  rules.

## Limits

- Reads the **DOM**, not `<canvas>` pixels — the lightweight-charts candles are
  captured in the screenshot but their exact drawn levels are read from the plan
  data, not the pixels.
- Order-book / Level-2 depth (a tradingview-mcp feature) has no equivalent here:
  the screener is an end-of-day OHLCV system with no depth data.
- The literal Pine-Script compile loop needs TradingView's Pine compiler, which
  only exists on the user's own machine; our in-repo equivalent is the Python
  detector → `make gates` / 908-trade harness loop.
