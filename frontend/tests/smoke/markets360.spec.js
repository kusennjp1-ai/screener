import { expect, test } from '@playwright/test';

test.use({ viewport: { width: 1512, height: 982 } });

// Visual + structural smoke for the standalone Markets 360 view. The whole API
// surface is mocked (no backend/DB), so this renders the page with a realistic
// LLY-like payload and screenshots it for pixel review against the reference.

const jsonResponse = (route, payload, status = 200) =>
  route.fulfill({
    status,
    contentType: 'application/json',
    body: JSON.stringify(payload),
  });

const capabilities = {
  features: { themes: false, chatbot: true, tasks: false },
  auth: { required: false, configured: true, authenticated: true, mode: 'session_cookie', message: null },
  ui_snapshots: { enabled: false, scan: false, breadth: false, groups: false, themes: false },
  api_base_path: '/api',
};

const runtimeActivity = {
  bootstrap: {
    state: 'ready', app_ready: true, primary_market: 'US', enabled_markets: ['US'],
    current_stage: null, progress_mode: 'determinate', percent: 100,
    message: 'Primary market is ready.', background_warning: null,
  },
  summary: { active_market_count: 0, active_markets: [], status: 'idle' },
};

// --- realistic LLY-like Markets 360 payload ------------------------------- //
function buildPayload() {
  const days = 260;
  const bars = [];
  const spy = [];
  const rpr = [];
  const start = new Date('2025-06-25T00:00:00Z');
  let price = 760;
  for (let i = 0; i < days; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    // U-shaped recovery then breakout, roughly tracing the LLY reference.
    const t = i / days;
    const drift = 760 + 480 * (t * t) - 120 * Math.sin(t * Math.PI);
    price = drift + Math.sin(i / 6) * 14;
    const open = price - 4;
    const high = price + 8;
    const low = price - 9;
    const close = price + 3;
    const date = d.toISOString().slice(0, 10);
    bars.push({ date, open: r(open), high: r(high), low: r(low), close: r(close), volume: Math.round(3.0e6 + Math.sin(i / 5) * 1.1e6) });
    spy.push({ time: date, value: r(560 + 180 * t + Math.sin(i / 9) * 8) });
    rpr.push({ time: date, value: r(55 + 35 * t + Math.sin(i / 7) * 5, 1) });
  }
  const n = bars.length;
  const hist = (states) => Array.from({ length: Math.min(n, 252) }, (_, k) => states[Math.floor((k / 252) * states.length) % states.length]);
  const lastDate = bars[n - 1].date;
  const breakoutDate = bars[n - 6].date;
  return {
    symbol: 'LLY', name: 'Eli Lilly & Co.', exchange: 'XNYS', market: 'US', as_of: lastDate,
    quote: { last: 1208.54, bid: 1207.83, ask: 1209.24, change: 1.41, change_pct: 0.12, volume: 3_970_000 },
    ratings: { er: 90, sr: 96, rpr: 87, tpr: 'B', esr: 97, vcp_pct: 13.7, vrr_pct: 54, dist_20dma_pct: 8.1 },
    states: {
      trend_stage: { stage: 2, label: 'Stage 2 — Advancing', active: true },
      pressure: { state: 'buy', value: 0.4 },
      buy_risk: { state: 'low', atr: 2.1 },
      tpr: { state: 'strong', score: 7, max: 8 },
      monalert_net: 0,
    },
    chart: {
      period: '1y', window_days: 372, benchmark_symbol: 'SPY',
      bars,
      moving_averages: {
        ma21: bars.map((b) => ({ time: b.date, value: r(b.close - 30) })),
        ma50: bars.map((b) => ({ time: b.date, value: r(b.close - 80) })),
        ma150: bars.map((b) => ({ time: b.date, value: r(b.close - 150) })),
        ma200: bars.map((b) => ({ time: b.date, value: r(b.close - 200) })),
      },
      spy_overlay: spy,
      rpr_pane: rpr,
      rs_line: bars.map((b, i) => ({ time: b.date, value: r(0.8 + i / n, 4) })),
      blue_dots: [bars[n - 20].date, bars[n - 8].date],
      bands: {
        pressure_history: hist(['sell', 'sell', 'buy', 'buy', 'buy', 'sell', 'buy']),
        buy_risk_history: hist(['high', 'medium', 'low', 'low', 'low', 'medium']),
        tpr_history: hist(['weak', 'transition', 'strong', 'strong', 'strong']),
      },
      buy_points: [
        { time: bars[n - 30].date, type: 'buy_alert', price: 1126 },
        { time: bars[n - 12].date, type: 'buy_ready', price: 1126 },
        { time: breakoutDate, type: 'sepa_buy_point', price: 1126, base_low: 1079 },
      ],
      vcp_boxes: [{ start: bars[n - 35].date, end: bars[n - 10].date, high: 1130, low: 1080 }],
      earnings_markers: [
        { time: bars[Math.floor(n * 0.2)].date, label: 'E' },
        { time: bars[Math.floor(n * 0.55)].date, label: 'E' },
        { time: bars[Math.floor(n * 0.9)].date, label: 'E' },
      ],
      monalert: rpr.map((p) => ({ time: p.time, value: r((p.value - 55) / 10, 2) })),
    },
    signal: {
      active: true, type: 'triple_barrel', label: 'Triple Barrel Behavioral Analytic Buy Signal',
      headline: 'Buying Now!', author: 'Mark Minervini', as_of: `${lastDate}T11:57:00`,
      trigger_price: 1126.0, stop: 1079.0, risk_pct: 4.2,
      barrels: { trend: true, pressure: true, breakout: true }, barrels_passed: 3,
    },
    quarters: [
      { label: '2025 Q2', estimate: false, eps_actual: 6.31, eps_prior: 3.92, eps_growth: 61, sales_actual: 15.6e9, sales_prior: 11.3e9, sales_growth: 38 },
      { label: '2025 Q3', estimate: false, eps_actual: 7.02, eps_prior: 1.18, eps_growth: 495, sales_actual: 17.6e9, sales_prior: 11.4e9, sales_growth: 54 },
      { label: '2025 Q4', estimate: false, eps_actual: 7.54, eps_prior: 5.32, eps_growth: 42, sales_actual: 19.3e9, sales_prior: 13.5e9, sales_growth: 43 },
      { label: '2026 Q1', estimate: false, eps_actual: 8.55, eps_prior: 3.34, eps_growth: 156, sales_actual: 19.8e9, sales_prior: 12.7e9, sales_growth: 56 },
      { label: '2026 Q2', estimate: true, earnings_date: '08/06', earnings_timing: 'B', eps_est_growth: 40, sales_est_growth: 32 },
    ],
    degraded_reasons: [],
  };
}

function r(v, d = 2) { const f = 10 ** d; return Math.round(v * f) / f; }

test('Markets 360 view renders the full LLY layout', async ({ page }) => {
  await page.route('**/*', async (route, request) => {
    const url = new URL(request.url());
    const method = request.method();
    const path = url.pathname.replace(/^\/api/, '');
    if (!path.startsWith('/v1/')) return route.continue();

    if (path === '/v1/app-capabilities' && method === 'GET') return jsonResponse(route, capabilities);
    if (path === '/v1/runtime/activity' && method === 'GET') return jsonResponse(route, runtimeActivity);
    if (path === '/v1/strategy-profiles' && method === 'GET') return jsonResponse(route, { profiles: [], active: 'minervini' });
    if (path === '/v1/strategy-profiles/default' && method === 'GET') return jsonResponse(route, { profile: 'minervini' });
    if (path === '/v1/markets360/LLY' && method === 'GET') return jsonResponse(route, buildPayload());

    // Catch-all: keep the app from hanging on incidental boot calls.
    return jsonResponse(route, {});
  });

  await page.goto('/markets360/LLY');

  // Status bar chips.
  await expect(page.getByText('ER').first()).toBeVisible();
  await expect(page.getByText('Eli Lilly & Co.', { exact: false })).toBeVisible();
  await expect(page.getByText('TPR').first()).toBeVisible();

  // Buying Now card.
  await expect(page.getByText('Buying Now!')).toBeVisible();
  await expect(page.getByText('Triple Barrel Behavioral Analytic Buy Signal')).toBeVisible();

  // Quarterly strip.
  await expect(page.getByText('2025 Q2').first()).toBeVisible();
  await expect(page.getByText('+495%')).toBeVisible();

  // Give the chart a moment to paint, then capture for visual review.
  await page.waitForTimeout(1500);
  await page.screenshot({ path: 'tests/smoke/__screenshots__/markets360-lly.png', fullPage: true });
});
