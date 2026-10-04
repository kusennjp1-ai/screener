import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { auditDailyBars } from '../src/static/qualificationAudit.js';
import { PRICE_TRACE_BARS, PRICE_TRACE_WIDTH, PRICE_TRACE_HEIGHT, priceTraceForRow, verifiedTraceIdentity, validatePriceTraceDescriptor } from '../src/static/priceTrace.js';

const sha256 = content => createHash('sha256').update(content).digest('hex');
const localPath = (root, path) => {
  const base = resolve(root), target = resolve(base, path);
  if (!target.startsWith(base + sep)) throw Error('Invalid local price trace path');
  return target;
};

export function createPriceTrace(row, chart, date) {
  // Recheck the source, even when an earlier stage supplied a valid audit. The
  // miniature uses exactly the same final close as the canonical price/chart.
  if (!verifiedTraceIdentity(row, date)) return null;
  const audit = auditDailyBars(row, chart, date);
  if (!audit.valid || audit.bars !== row.technical_audit.bars || audit.values.close !== row.current_price) return null;
  const points = chart.bars.slice(-PRICE_TRACE_BARS).map(bar => [bar.date, bar.close]);
  return { symbol: row.symbol, points, svg: renderPriceTrace(points) };
}

function renderPriceTrace(points) {
  const first = Date.parse(points[0][0]), elapsed = Date.parse(points.at(-1)[0]) - first;
  const low = Math.min(...points.map(point => point[1])), high = Math.max(...points.map(point => point[1]));
  // Calendar spacing preserves gaps; no synthetic sessions or interpolated
  // closes are inserted. A flat series is centered without division by zero.
  const path = points.map(([date, close], index) => {
    const x = 4 + (Date.parse(date) - first) / elapsed * (PRICE_TRACE_WIDTH - 8);
    const y = high === low ? PRICE_TRACE_HEIGHT / 2 : 4 + (high - close) / (high - low) * (PRICE_TRACE_HEIGHT - 8);
    return `${index ? 'L' : 'M'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(' ');
  // Only numeric coordinates enter SVG markup. No symbol text, external URL,
  // script, trade marker, or inferred profitability is embedded in this asset.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PRICE_TRACE_WIDTH}" height="${PRICE_TRACE_HEIGHT}" viewBox="0 0 ${PRICE_TRACE_WIDTH} ${PRICE_TRACE_HEIGHT}"><path d="${path}" fill="none" stroke="#5685c7" stroke-width="1.75" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}

export async function exportPriceTraces({ root, rows, traces, date }) {
  const entries = [];
  for (const row of rows) {
    const trace = traces.get(row.symbol);
    if (!trace) {
      if (row.price_trace_start !== undefined) throw Error(`Missing price trace source: ${row.symbol}`);
      continue;
    }
    if (!verifiedTraceIdentity(row, date) || trace.symbol !== row.symbol || trace.points.length !== PRICE_TRACE_BARS ||
        trace.points[0][0] !== row.price_trace_start || trace.points.at(-1)[0] !== date || trace.points.at(-1)[1] !== row.current_price) throw Error(`Price trace identity mismatch: ${row.symbol}`);
    entries.push({ symbol: row.symbol, chart_path: row.chart_path, points: trace.points, sha256: sha256(trace.svg) });
  }
  entries.sort((a, b) => a.symbol < b.symbol ? -1 : a.symbol > b.symbol ? 1 : 0);
  if (entries.length !== traces.size || new Set(entries.map(entry => entry.symbol)).size !== entries.length) throw Error('Price trace universe mismatch');
  // The complete set is addressed by one hash. Its proof binds exact closes
  // and dates (before SVG rounding), canonical chart identity, and asset bytes.
  const proof = JSON.stringify({ version: 'daily-close-svg-v1', as_of_date: date, bars: PRICE_TRACE_BARS, entries });
  const descriptor = { root: `price-traces/${sha256(proof)}`, as_of_date: date, bars: PRICE_TRACE_BARS };
  validatePriceTraceDescriptor(descriptor, date);
  await mkdir(localPath(root, descriptor.root), { recursive: true });
  for (const row of rows) {
    const presentation = priceTraceForRow(row, descriptor, date);
    if (presentation.status === 'available') await writeFile(localPath(root, presentation.src), traces.get(row.symbol).svg);
    else if (traces.has(row.symbol)) throw Error(`Ineligible price trace: ${row.symbol}`);
  }
  await writeFile(localPath(root, `${descriptor.root}/index.json`), proof);
  await verifyPriceTraces({ root, rows, descriptor, date });
  return descriptor;
}

export async function verifyPriceTraces({ root, rows, descriptor, date }) {
  if (descriptor === undefined) return { available: 0, legacy: true };
  validatePriceTraceDescriptor(descriptor, date);
  const proof = await readFile(localPath(root, `${descriptor.root}/index.json`), 'utf8');
  if (`price-traces/${sha256(proof)}` !== descriptor.root) throw Error('Price trace set hash mismatch');
  const data = JSON.parse(proof);
  if (data.version !== 'daily-close-svg-v1' || data.as_of_date !== date || data.bars !== PRICE_TRACE_BARS || !Array.isArray(data.entries)) throw Error('Invalid price trace proof');
  const entries = new Map(data.entries.map(entry => [entry.symbol, entry]));
  const available = rows.filter(row => priceTraceForRow(row, descriptor, date).status === 'available');
  if (entries.size !== data.entries.length || entries.size !== available.length) throw Error('Price trace proof universe mismatch');
  for (const row of available) {
    const entry = entries.get(row.symbol);
    if (!entry || entry.chart_path !== row.chart_path) throw Error(`Price trace source mismatch: ${row.symbol}`);
    const chart = JSON.parse(await readFile(localPath(root, row.chart_path), 'utf8'));
    if (chart.stock_data && (chart.stock_data.symbol !== row.symbol || chart.stock_data.current_price !== row.current_price)) throw Error(`Price trace canonical price mismatch: ${row.symbol}`);
    const trace = createPriceTrace(row, chart, date);
    if (!trace || JSON.stringify(trace.points) !== JSON.stringify(entry.points) || trace.points[0][0] !== row.price_trace_start) throw Error(`Price trace source mismatch: ${row.symbol}`);
    const svg = await readFile(localPath(root, priceTraceForRow(row, descriptor, date).src), 'utf8');
    if (sha256(svg) !== entry.sha256 || svg !== trace.svg) throw Error(`Price trace asset mismatch: ${row.symbol}`);
  }
  return { available: available.length, legacy: false };
}
