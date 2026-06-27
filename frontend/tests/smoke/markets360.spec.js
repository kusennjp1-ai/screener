import { expect, test } from '@playwright/test';

// Visual + structural smoke for the standalone Markets 360 view. The whole API
// surface is mocked (no backend/DB), so this renders the page with payloads
// shaped to match the reference Markets 360 screenshots and captures a
// per-ticker screenshot for pixel review.

test.use({ viewport: { width: 1512, height: 982 } });

const jsonResponse = (route, payload, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) });

const capabilities = {
  features: { themes: false, chatbot: true, tasks: false },
  auth: { required: false, configured: true, authenticated: true, mode: 'session_cookie', message: null },
  ui_snapshots: { enabled: false, scan: false, breadth: false, groups: false, themes: false },
  api_base_path: '/api',
};
const runtimeActivity = {
  bootstrap: { state: 'ready', app_ready: true, primary_market: 'US', enabled_markets: ['US'], current_stage: null, progress_mode: 'determinate', percent: 100, message: 'ready', background_warning: null },
  summary: { active_market_count: 0, active_markets: [], status: 'idle' },
};

const r = (v, d = 2) => { const f = 10 ** d; return Math.round(v * f) / f; };

// Derive the three MM360 color bands from the bar series, mirroring the backend
// intent so the rendered strips are GREEN while the stock advances (above a
// rising 50-MA, accumulating) and RED while it bases/declines — i.e. the colors
// line up with the price at each point in time, as in the reference images.
function computeBands(bars) {
  const n = bars.length;
  const close = bars.map((b) => b.close);
  const sma = (p, i) => {
    if (i < p - 1) return null;
    let s = 0;
    for (let k = i - p + 1; k <= i; k++) s += close[k];
    return s / p;
  };
  const P = []; const B = []; const T = [];
  for (let i = 0; i < n; i++) {
    const s50 = sma(50, i);
    const s150 = sma(150, i);
    const ref = i >= 10 ? close[i - 10] : close[0];
    P.push(close[i] > ref ? 'buy' : close[i] < ref ? 'sell' : 'neutral');
    if (s50 == null) {
      T.push('transition'); B.push('medium');
    } else {
      const s50prev = sma(50, Math.max(0, i - 20));
      const rising = s50prev != null && s50 > s50prev;
      if (close[i] > s50 && rising && (s150 == null || s50 > s150)) T.push('strong');
      else if (close[i] < s50 && !rising) T.push('weak');
      else T.push('transition');
      const ext = close[i] / s50 - 1;
      if (close[i] < s50 || ext > 0.15) B.push('high');
      else if (ext < 0.05) B.push('low');
      else B.push('medium');
    }
  }
  return { pressure_history: P, buy_risk_history: B, tpr_history: T };
}

// Build a realistic payload from a per-ticker spec. `shape(t)` maps t∈[0,1] to a
// close price so each ticker traces its reference chart (recovery, base-and-rip,
// or downtrend); band/ signal/ ratings come straight from the spec.
function buildPayload(spec) {
  const days = 260;
  const bars = []; const spy = []; const rpr = [];
  const start = new Date('2025-06-25T00:00:00Z');
  // RPR pane ramps from a neutral baseline toward the ticker's RPR rating.
  const rprTarget = spec.ratings.rpr ?? 50;
  const rprStart = 55;
  for (let i = 0; i < days; i++) {
    const d = new Date(start); d.setUTCDate(start.getUTCDate() + i);
    if (d.getUTCDay() === 0 || d.getUTCDay() === 6) continue;
    const t = i / days;
    const px = spec.shape(t) + Math.sin(i / 6) * spec.noise;
    const date = d.toISOString().slice(0, 10);
    bars.push({ date, open: r(px - spec.noise), high: r(px + spec.noise * 1.6), low: r(px - spec.noise * 1.8), close: r(px + spec.noise * 0.4), volume: Math.round(spec.vol * (1 + Math.sin(i / 5) * 0.35)) });
    spy.push({ time: date, value: r(560 + 180 * t + Math.sin(i / 9) * 8) });
    rpr.push({ time: date, value: r(rprStart + (rprTarget - rprStart) * t + Math.sin(i / 7) * 3, 1) });
  }
  const n = bars.length;
  const lastDate = bars[n - 1].date;
  const pivot = bars[n - 6].close * 0.94;
  return {
    symbol: spec.symbol, name: spec.name, exchange: spec.exchange, market: 'US', as_of: lastDate,
    quote: spec.quote,
    ratings: spec.ratings,
    states: {
      trend_stage: spec.trend_stage, pressure: { state: spec.pressure }, buy_risk: { state: spec.buy_risk },
      tpr: { state: spec.tpr_state, score: spec.tpr_score, max: 8 }, monalert_net: spec.monalert,
    },
    chart: {
      period: '1y', window_days: 372, benchmark_symbol: 'SPY', bars,
      moving_averages: {
        ma21: bars.map((b) => ({ time: b.date, value: r(b.close * 0.97) })),
        ma50: bars.map((b) => ({ time: b.date, value: r(b.close * 0.9) })),
        ma150: bars.map((b) => ({ time: b.date, value: r(b.close * 0.82) })),
        ma200: bars.map((b) => ({ time: b.date, value: r(b.close * 0.78) })),
      },
      spy_overlay: spy, rpr_pane: rpr,
      rs_line: bars.map((b, i) => ({ time: b.date, value: r(0.7 + (i / n) * spec.rsSlope, 4) })),
      blue_dots: [bars[n - 18].date],
      bands: computeBands(bars),
      buy_points: spec.buyPoints
        ? [
            { time: bars[n - 28].date, type: 'buy_alert', price: r(pivot) },
            { time: bars[n - 12].date, type: 'buy_ready', price: r(pivot) },
            { time: bars[n - 6].date, type: spec.buyPoints, price: r(pivot), base_low: r(pivot * 0.96) },
          ]
        : [],
      vcp_boxes: spec.vcp ? [{ start: bars[n - 30].date, end: bars[n - 8].date, high: r(pivot * 1.02), low: r(pivot * 0.95) }] : [],
      earnings_markers: [bars[Math.floor(n * 0.25)].date, bars[Math.floor(n * 0.55)].date, bars[Math.floor(n * 0.88)].date].map((time) => ({ time, label: 'E' })),
      monalert: rpr.map((p) => ({ time: p.time, value: r((p.value - 50) / 10, 2) })),
      news_markers: spec.news ? [bars[Math.floor(n * 0.3)].date, bars[Math.floor(n * 0.6)].date, bars[Math.floor(n * 0.92)].date].slice(0, spec.news) : [],
    },
    signal: spec.signal
      ? {
          active: true, type: spec.signal, label: spec.signalLabel, headline: 'Buying Now!', author: 'Mark Minervini',
          as_of: `${lastDate}T11:57:00`, trigger_price: r(pivot), stop: r(spec.stop), risk_pct: 4.2,
          barrels: { trend: true, pressure: true, breakout: true }, barrels_passed: 3,
        }
      : { active: false, type: null, label: null },
    quarters: spec.quarters,
    degraded_reasons: [],
  };
}

const RECOVERY = (t) => 760 + 480 * (t * t) - 120 * Math.sin(t * Math.PI);
const BASE_AND_RIP = (t) => (t < 0.62 ? 120 + 30 * Math.sin(t * 6) : 120 + 760 * Math.pow((t - 0.62) / 0.38, 1.8));
const DOWNTREND = (t) => 70 - 36 * Math.pow(t, 0.8) + 4 * Math.sin(t * 7);

const TICKERS = {
  LLY: {
    symbol: 'LLY', name: 'Eli Lilly & Co.', exchange: 'XNYS', shape: RECOVERY, noise: 14, vol: 3.0e6, rsSlope: 1.0,
    quote: { last: 1208.54, bid: 1207.83, ask: 1209.24, change: 1.41, change_pct: 0.12, volume: 3_970_000 },
    ratings: { er: 90, sr: 96, rpr: 87, tpr: 'B', esr: 97, vcp_pct: 13.7, vrr_pct: 54, dist_20dma_pct: 8.1 },
    trend_stage: { stage: 2, label: 'Stage 2 — Advancing', active: true }, pressure: 'buy', buy_risk: 'low', tpr_state: 'strong', tpr_score: 7, monalert: 0,
    buyPoints: 'sepa_buy_point', vcp: true, news: 3, signal: 'triple_barrel', signalLabel: 'Triple Barrel Behavioral Analytic Buy Signal', stop: 1079,
    quarters: [
      { label: '2025 Q2', estimate: false, eps_actual: 6.31, eps_prior: 3.92, eps_growth: 61, sales_actual: 15.6e9, sales_prior: 11.3e9, sales_growth: 38 },
      { label: '2025 Q3', estimate: false, eps_actual: 7.02, eps_prior: 1.18, eps_growth: 495, sales_actual: 17.6e9, sales_prior: 11.4e9, sales_growth: 54 },
      { label: '2025 Q4', estimate: false, eps_actual: 7.54, eps_prior: 5.32, eps_growth: 42, sales_actual: 19.3e9, sales_prior: 13.5e9, sales_growth: 43 },
      { label: '2026 Q1', estimate: false, eps_actual: 8.55, eps_prior: 3.34, eps_growth: 156, sales_actual: 19.8e9, sales_prior: 12.7e9, sales_growth: 56 },
      { label: '2026 Q2', estimate: true, earnings_date: '08/06', earnings_timing: 'B', eps_est_growth: 40, sales_est_growth: 32 },
    ],
  },
  ARM: {
    symbol: 'ARM', name: 'Arm Holdings plc American Depositary Shares', exchange: 'XNAS', shape: BASE_AND_RIP, noise: 6, vol: 8.0e6, rsSlope: 1.4,
    quote: { last: 439.98, bid: 439.49, ask: 440.29, change: 0.80, change_pct: 0.18, volume: 8_430_000 },
    ratings: { er: 56, sr: 82, rpr: 99, tpr: 'A', esr: 74, vcp_pct: 0.6, vrr_pct: -11, dist_20dma_pct: 28 },
    trend_stage: { stage: 2, label: 'Stage 2 — Advancing', active: true }, pressure: 'buy', buy_risk: 'low', tpr_state: 'strong', tpr_score: 8, monalert: 0,
    buyPoints: 'sepa_buy_point', vcp: true, news: 0, signal: 'sepa_buy_point', signalLabel: 'SEPA Buy Point', stop: 200.80,
    quarters: [
      { label: '2025 Q3', estimate: false, eps_actual: 0.39, eps_prior: 0.21, eps_growth: 86, sales_actual: 1.1e9, sales_prior: 0.84e9, sales_growth: 31 },
      { label: '2025 Q4', estimate: false, eps_actual: 0.42, eps_prior: 0.30, eps_growth: 40, sales_actual: 1.24e9, sales_prior: 0.98e9, sales_growth: 27 },
      { label: '2026 Q1', estimate: true, earnings_date: '05/13', earnings_timing: 'A', eps_est_growth: 25, sales_est_growth: 22 },
    ],
  },
  IBIT: {
    symbol: 'IBIT', name: 'iShares Bitcoin Trust ETF', exchange: 'XNAS', shape: DOWNTREND, noise: 1.4, vol: 33e6, rsSlope: -0.4,
    quote: { last: 36.20, bid: 36.18, ask: 36.22, change: -0.80, change_pct: -2.16, volume: 33_160_000 },
    ratings: { er: null, sr: null, rpr: 14, tpr: 'E', esr: null, vcp_pct: 9.4, vrr_pct: -8, dist_20dma_pct: -6.2 },
    trend_stage: { stage: 4, label: 'Stage 4 — Declining', active: false }, pressure: 'sell', buy_risk: 'high', tpr_state: 'weak', tpr_score: 1, monalert: 0,
    buyPoints: null, vcp: false, news: 0, signal: null, signalLabel: null, stop: null,
    quarters: [],
  },
};

function mockRoutes(page, symbol) {
  return page.route('**/*', async (route, request) => {
    const path = new URL(request.url()).pathname.replace(/^\/api/, '');
    const method = request.method();
    if (!path.startsWith('/v1/')) return route.continue();
    if (path === '/v1/app-capabilities' && method === 'GET') return jsonResponse(route, capabilities);
    if (path === '/v1/runtime/activity' && method === 'GET') return jsonResponse(route, runtimeActivity);
    if (path === '/v1/strategy-profiles' && method === 'GET') return jsonResponse(route, { profiles: [], active: 'minervini' });
    if (path === '/v1/strategy-profiles/default' && method === 'GET') return jsonResponse(route, { profile: 'minervini' });
    if (path === `/v1/markets360/${symbol}` && method === 'GET') return jsonResponse(route, buildPayload(TICKERS[symbol]));
    return jsonResponse(route, {});
  });
}

test('LLY reproduces the reference (Triple Barrel, full layout)', async ({ page }) => {
  await mockRoutes(page, 'LLY');
  await page.goto('/markets360/LLY');
  await expect(page.getByText('Eli Lilly & Co.', { exact: false })).toBeVisible();
  await expect(page.getByText('Buying Now!')).toBeVisible();
  await expect(page.getByText('Triple Barrel Behavioral Analytic Buy Signal')).toBeVisible();
  await expect(page.getByText('Minervini Pressure')).toBeVisible();
  await expect(page.getByText('SEPA Buy Point')).toBeVisible();
  await expect(page.getByText('+495%')).toBeVisible();
  await expect(page.getByText('News Count', { exact: false })).toBeVisible();
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'tests/smoke/__screenshots__/markets360-lly.png' });
});

test('ARM reproduces the reference (SEPA Buy Point, RPR 99 / TPR A)', async ({ page }) => {
  await mockRoutes(page, 'ARM');
  await page.goto('/markets360/ARM');
  await expect(page.getByText('Arm Holdings', { exact: false })).toBeVisible();
  await expect(page.getByText('SEPA Buy Point').first()).toBeVisible();
  await expect(page.getByText('99')).toBeVisible(); // RPR
  await expect(page.getByText('A', { exact: true }).first()).toBeVisible(); // TPR
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'tests/smoke/__screenshots__/markets360-arm.png' });
});

test('IBIT reproduces the reference (downtrend, RPR 14, no signal)', async ({ page }) => {
  await mockRoutes(page, 'IBIT');
  await page.goto('/markets360/IBIT');
  await expect(page.getByText('iShares Bitcoin Trust ETF', { exact: false })).toBeVisible();
  await expect(page.getByText('14')).toBeVisible(); // RPR
  await expect(page.getByText('Buying Now!')).toHaveCount(0); // no active signal
  await page.waitForTimeout(1400);
  await page.screenshot({ path: 'tests/smoke/__screenshots__/markets360-ibit.png' });
});
