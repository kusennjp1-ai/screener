// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { decodeResearchIndex, RESEARCH_METHODS } from '../src/static/researchTransport.js';
import { prepareResearchBundle } from '../src/static/researchPreprocess.js';
import { SCAN_FILTER_FIELDS, sortStaticScanRows } from '../src/static/scanClient.js';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../src/static/testFinancialFixture.js';
import { assess, researchCsv } from '../src/static/researchEngine.js';
import { auditDailyBars } from '../src/static/qualificationAudit.js';
import { buildBookMarketEvidence } from '../src/static/bookMarketEvidence.js';

const write = async (path, value) => {
  await mkdir(resolve(path, '..'), { recursive: true });
  await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value));
};
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const symbols = rows => rows.map(row => row.symbol);

async function fixture({ withBreadth = false } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'research-export-order-'));
  const frontend = join(directory, 'frontend'), root = join(frontend, 'public/static-data');
  const bars = [];
  for (let time = Date.parse(date); bars.length < 280; time -= 86400000) {
    if ([0, 6].includes(new Date(time).getUTCDay())) continue;
    const close = 100 - bars.length * .1;
    bars.unshift({ date: new Date(time).toISOString().slice(0, 10), open: close, high: close + 1, low: close - 1, close, volume: 1000000 });
  }
  const sourceSymbols = withBreadth ? Array.from({ length: 101 }, (_, index) => `S${String(index).padStart(3, '0')}`) : ['ZETA', 'BETA', 'ALPHA'];
  const sourceCharts = sourceSymbols.map((symbol, index) => {
    const series = withBreadth ? bars.map((bar, offset) => {
      const close = 100 + offset * (.1 + index / 503) + (index + 1) * (offset % 7) / 1000000;
      return { ...bar, open: close, close, high: close + 1, low: close - 1, volume: 1000000 + index * 137 };
    }) : bars;
    if (withBreadth && index >= 97) {
      for (const bar of series.slice(-6, -1)) bar.volume /= 2;
      const close = Math.max(...series.slice(-21, -1).map(bar => bar.high)) * 1.01;
      Object.assign(series.at(-1), { open: close, close, high: close + 1, low: close - 1, volume: 2000000 + index * 137 });
    }
    return { symbol, market: 'US', as_of_date: date, bars: series };
  });
  const rows = sourceSymbols.map((symbol, index) => withFinancialProof({
    symbol, company_name: `${symbol} Corporation`, quoteType: 'EQUITY', currency: 'USD', current_price: sourceCharts[index].bars.at(-1).close,
    volume: 1000000, adv_usd: 100000000, se_setup_score: (index + 1) * 10,
    setup_recalculation: { status: 'calculated', as_of_date: date }, eps_growth_yy: 30 + index, sales_growth_yy: 40 + index,
  }, now, date));
  const histories = Object.fromEntries(rows.map(row => [row.symbol, {
    symbol: row.symbol, as_of_date: date, status: 'available', basis: 'reported_diluted_eps', currency: 'USD',
    source: 'Synthetic regression fixture', retrieved_at: new Date(now - 3600000).toISOString(),
    annual: [2022, 2023, 2024, 2025].map((year, index) => ({ end: `${year}-12-31`, eps: 2 ** index })), quarterly: [],
  }]));
  const entry = { as_of_date: date, market: 'US', pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts-index.json' } } };
  let benchmark = null;
  if (withBreadth) {
    entry.pages.breadth = { path: 'breadth.json' };
    benchmark = { symbol: 'SPY', as_of_date: date, bars: bars.map((bar, index) => {
      const close = 400 + index * .071 + (index % 3) * .003;
      return { ...bar, open: close, close, high: close + 1, low: close - 1, volume: 2000000 + index * 11 };
    }) };
    await write(join(root, 'breadth.json'), { as_of_date: date, payload: { current: { date }, retained_source: 'synthetic breadth source' } });
    await write(join(root, 'book-benchmark.json'), benchmark);
  }
  await write(join(root, 'manifest.json'), { generated_at: '2026-10-02T20:00:00Z', markets: { US: entry } });
  await write(join(root, 'scan.json'), { as_of_date: date, initial_rows: rows, chunks: [{ path: 'chunk.json' }], default_filters: {}, preset_screens: [] });
  await write(join(root, 'chunk.json'), { as_of_date: date, rows: [...rows].reverse() });
  await write(join(root, 'charts-index.json'), { symbols: rows.map(row => ({ symbol: row.symbol, path: `charts/${row.symbol}.json` })) });
  for (const [index, row] of rows.entries()) await write(join(root, `charts/${row.symbol}.json`), { ...sourceCharts[index], stock_data: row });
  await write(join(root, 'financial-history.json'), { as_of_date: date, results: histories });
  await write(join(root, 'candidate-history/retained-history.json'), 'historical bytes unchanged\n');
  await mkdir(join(directory, 'data/ibd_reference/ibd50'), { recursive: true });
  const env = { ...process.env, FINANCIAL_EVALUATED_AT: new Date(now).toISOString() };
  for (const key of Object.keys(env)) if (key.startsWith('FINANCIAL_CORRECTION_') || key.startsWith('FINANCIAL_GENERATION_CARRY_')) delete env[key];
  const run = () => execFileSync(process.execPath, [fileURLToPath(new URL('./export-research.mjs', import.meta.url))], { cwd: frontend, env, encoding: 'utf8', stdio: 'pipe' });
  const outputs = async () => {
    const manifest = await read(join(root, 'manifest.json'));
    const index = decodeResearchIndex(await read(join(root, manifest.markets.US.assets.research.path)));
    const details = await Promise.all(index.rows.map(row => read(join(root, row.research_detail_path))));
    const charts = await Promise.all(index.rows.map(row => read(join(root, row.chart_path))));
    return { manifest, index, details, charts, audit: await read(join(frontend, 'public/qualification-audit.json')) };
  };
  return { directory, frontend, root, rows, bars, histories, sourceCharts, benchmark, run, outputs };
}

it('keeps whole breadth bytes stable across two exports with order-sensitive cohorts, breakout events and floating reductions', async () => {
  const { directory, root, rows, sourceCharts, benchmark, run } = await fixture({ withBreadth: true });
  try {
    const options = { asOfDate: date, benchmark, expectedUniverseSize: rows.length, lookbackSessions: 60 };
    const original = buildBookMarketEvidence({ ...options, charts: sourceCharts });
    const reordered = buildBookMarketEvidence({ ...options, charts: [...sourceCharts].reverse() });
    // Ensure this fixture detects each observed production failure, including
    // exact floating differences that an approximate comparison would hide.
    expect(original.cohortMembers.length).toBeGreaterThan(1);
    expect(original.cohortMembers).not.toEqual(reordered.cohortMembers);
    expect(original.breakoutEvents.length).toBeGreaterThan(1);
    expect(original.breakoutEvents).not.toEqual(reordered.breakoutEvents);
    expect(original.series.some((point, index) => point.upDollarVolume !== reordered.series[index].upDollarVolume)).toBe(true);
    expect(original.series.some((point, index) => point.cohort?.meanReturnPct !== reordered.series[index].cohort?.meanReturnPct)).toBe(true);
    run();
    const firstBytes = await readFile(join(root, 'breadth.json'));
    expect(JSON.parse(firstBytes).payload.book_market_evidence).toEqual(original);
    const firstScan = await read(join(root, 'scan.json'));
    expect(symbols(firstScan.initial_rows)).toEqual(symbols(rows).reverse().slice(0, 50));
    run();
    expect(await readFile(join(root, 'breadth.json'))).toEqual(firstBytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('keeps research and audit order across the exporter rewriting initial_rows while preserving current evidence and history', async () => {
  const context = await fixture();
  const { directory, root, rows, bars, histories, run, outputs } = context;
  try {
    run();
    const first = await outputs();
    expect(symbols(first.index.rows)).toEqual(symbols(rows));
    expect(symbols(first.audit.results)).toEqual(symbols(rows));
    expect(symbols((await read(join(root, 'scan.json'))).initial_rows)).toEqual(['ALPHA', 'BETA', 'ZETA']);
    run();
    const second = await outputs();
    expect(symbols(second.index.rows)).toEqual(symbols(first.index.rows));
    expect(second.audit).toEqual(first.audit);
    const displayed = prepareResearchBundle([first.index], date, { now });
    for (const input of [second.index, { ...second.index, rows: [...second.index.rows].reverse() }]) {
      const rebuilt = prepareResearchBundle([input], date, { now });
      for (const method of RESEARCH_METHODS) {
        expect(symbols(rebuilt.rankings[method].map(item => item.row))).toEqual(symbols(displayed.rankings[method].map(item => item.row)));
        expect(researchCsv(rebuilt.rankings[method], method, date, now)).toBe(researchCsv(displayed.rankings[method], method, date, now));
      }
    }
    for (const field of SCAN_FILTER_FIELDS) for (const order of ['asc', 'desc']) {
      expect(symbols(sortStaticScanRows([...second.details].reverse(), field, order, { now })))
        .toEqual(symbols(sortStaticScanRows(first.details, field, order, { now })));
    }
    for (const [index, detail] of second.details.entries()) {
      const row = rows.find(item => item.symbol === detail.symbol);
      expect(detail.current_price).toBe(row.current_price);
      expect(detail.financial_current).toEqual(row.financial_current);
      expect(detail.eps_growth_yy).toBe(row.eps_growth_yy);
      expect(detail.sales_growth_yy).toBe(row.sales_growth_yy);
      expect(detail.financial_history).toEqual(histories[row.symbol]);
      expect(second.charts[index].bars).toEqual(bars);
      expect(detail.technical_audit).toEqual(auditDailyBars(detail, second.charts[index], date));
      expect(second.audit.results[index].methods).toEqual(Object.fromEntries(['minervini', 'minervini2', 'ibd'].map(method => [method, assess(detail, method, now)])));
    }
    expect(await readFile(join(root, 'candidate-history/retained-history.json'), 'utf8')).toBe('historical bytes unchanged\n');
    // An arbitrary subsequent source permutation must keep the same anchor.
    const scan = await read(join(root, 'scan.json'));
    scan.initial_rows = [scan.initial_rows[1], scan.initial_rows[2], scan.initial_rows[0]];
    await write(join(root, 'scan.json'), scan);
    run();
    expect((await outputs()).audit).toEqual(first.audit);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it('recomputes changed price and financial evidence without inheriting prior audit or method values', async () => {
  const { directory, root, run, outputs } = await fixture();
  try {
    run();
    const first = await outputs();
    for (const [path, key] of [['scan.json', 'initial_rows'], ['chunk.json', 'rows']]) {
      const payload = await read(join(root, path));
      const row = payload[key].find(item => item.symbol === 'ZETA');
      row.current_price = 101;
      row.eps_growth_yy = -10;
      row.eps_growth_annual = -10;
      row.financial_current.p['1'][0] = -10;
      row.financial_current.p['1'][6] = 'd';
      await write(join(root, path), payload);
    }
    const chartPath = first.index.rows.find(row => row.symbol === 'ZETA').chart_path;
    const chart = await read(join(root, chartPath));
    Object.assign(chart.bars.at(-1), { open: 101, close: 101, high: 102, low: 100 });
    await write(join(root, chartPath), chart);
    run();
    const second = await outputs(), detail = second.details.find(row => row.symbol === 'ZETA');
    const result = second.audit.results.find(row => row.symbol === 'ZETA');
    expect(symbols(second.audit.results)).toEqual(symbols(first.audit.results));
    expect(detail.current_price).toBe(101);
    expect(detail.eps_growth_yy).toBe(-10);
    expect(result.audit.valid).toBe(true);
    expect(result.audit.values.close).toBe(101);
    expect(result.audit).not.toEqual(first.audit.results[0].audit);
    expect(result.methods).toEqual(Object.fromEntries(['minervini', 'minervini2', 'ibd'].map(method => [method, assess(detail, method, now)])));
    expect(result.methods).not.toEqual(first.audit.results[0].methods);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

it.each(['malformed JSON', 'duplicate identities'])('rejects %s in an existing anchor before any export writes', async kind => {
  const { directory, frontend, root, run } = await fixture();
  try {
    run();
    const path = join(frontend, 'public/qualification-audit.json');
    const audit = await read(path);
    audit.results[1] = audit.results[0];
    await write(path, kind === 'malformed JSON' ? '{broken' : audit);
    const paths = [path, join(root, 'manifest.json'), join(root, 'scan.json'), join(root, 'chunk.json'), join(root, 'charts/ZETA.json')];
    const before = await Promise.all(paths.map(file => readFile(file)));
    expect(run).toThrow('Invalid research export order anchor');
    expect(await Promise.all(paths.map(file => readFile(file)))).toEqual(before);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
