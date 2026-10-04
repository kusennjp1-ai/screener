import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { priceTraceForRow, traceDate, verifiedTraceIdentity } from '../src/static/priceTrace.js';
import { createPriceTrace, exportPriceTraces } from './export-price-traces.mjs';

const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = message => { throw Error(`Public preview trace unavailable: ${message}`); };
const canonicalPath = row => typeof row.chart_path === 'string' &&
  /^verified-charts\/[A-Z0-9][A-Z0-9.^_-]{0,31}-[a-f0-9]{16}\.json$/.test(row.chart_path) &&
  row.chart_path === `verified-charts/${encodeURIComponent(row.symbol)}-${row.chart_path.slice(-21, -5)}.json`;
const safePath = path => typeof path === 'string' && /^[A-Za-z0-9._/-]+$/.test(path) &&
  !path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..');
const noChunks = value => value?.chunks === undefined || (Array.isArray(value.chunks) && value.chunks.length === 0);
const digest = (path, body) => ({ path, sha256: sha256(body), bytes: Buffer.byteLength(body) });

// This helper belongs exclusively to the nonpublishing CI screenshot preview.
// All reads are injected: one pinned manifest, its complete research index, and
// exactly one canonical chart. A rejected chart never triggers a bulk fallback.
export async function derivePublicPreviewTrace({ manifest, readResource, preferredSymbol = 'DELL' } = {}) {
  if (!process.env.CI) fail('run only in the CI preview');
  if (!manifest || typeof manifest !== 'object' || typeof readResource !== 'function') fail('missing pinned inputs');
  const inputManifest = structuredClone(manifest);
  const read = async (path, maxBytes) => {
    if (!safePath(path)) fail('invalid resource path');
    let resource;
    try { resource = await readResource(path); }
    catch (error) { fail(`${path}: ${error.message}`); }
    if (!resource || !(typeof resource.body === 'string' || Buffer.isBuffer(resource.body))) fail(`${path}: missing bytes`);
    const body = Buffer.from(resource.body);
    if (body.length > maxBytes) fail(`${path}: resource exceeds preview limit`);
    let value;
    try { value = JSON.parse(body.toString('utf8')); }
    catch { fail(`${path}: invalid JSON`); }
    return { body, value };
  };
  const originalManifest = await read('manifest.json', 1000000);
  if (!isDeepStrictEqual(originalManifest.value, inputManifest)) fail('pinned manifest identity mismatch');
  const entry = inputManifest.markets?.US, reference = entry?.assets?.research;
  const date = entry?.as_of_date || inputManifest.as_of_date;
  if (!traceDate(date) || !safePath(reference?.path)) fail('missing US research snapshot');
  if (!noChunks(reference)) fail('chunked research is unsupported');
  const research = await read(reference.path, 8000000);
  const researchHash = sha256(research.body);
  if (Object.hasOwn(reference, 'sha256') && reference.sha256 !== researchHash) fail('research reference hash mismatch');
  if (inputManifest.research_generation !== undefined && inputManifest.research_generation !== researchHash) fail('research generation mismatch');
  const pathHash = /^research-index-([a-f0-9]{16})\.json$/.exec(reference.path)?.[1];
  if (pathHash && pathHash !== researchHash.slice(0, 16)) fail('research path hash mismatch');
  if (!noChunks(research.value)) fail('chunked research is unsupported');
  if (research.value?.price_traces !== undefined) fail('price traces are already published');
  const decoded = decodeResearchIndex(structuredClone(research.value));
  if (decoded?.as_of_date !== date || !Array.isArray(decoded.rows) || !decoded.rows.length) fail('incomplete or mismatched research snapshot');
  if (research.value.count !== undefined && research.value.count !== decoded.rows.length) fail('research count mismatch');
  if (decoded.rows.some(row => !row || typeof row.symbol !== 'string') ||
      new Set(decoded.rows.map(row => row.symbol)).size !== decoded.rows.length) fail('invalid or duplicate research symbols');
  if (decoded.rows.some(row => row.price_trace_start !== undefined)) fail('preexisting partial trace metadata');
  // Older indexes keep the date once at index level. Production preparation
  // supplies it to rows without a date; use that same validation context only,
  // never write it back or replace an explicitly conflicting row date.
  const datedRow = row => Object.hasOwn(row, 'as_of_date') ? row : { ...row, as_of_date: date };
  const eligible = row => verifiedTraceIdentity(datedRow(row), date) && canonicalPath(row);
  const selected = decoded.rows.find(row => row.symbol === preferredSymbol && eligible(row)) || decoded.rows.find(eligible);
  if (!selected) fail('no same-date verified canonical chart');
  const chart = await read(selected.chart_path, 8000000);
  if (chart.value?.stock_data && (chart.value.stock_data.symbol !== selected.symbol || chart.value.stock_data.current_price !== selected.current_price ||
      (chart.value.stock_data.as_of_date !== undefined && chart.value.stock_data.as_of_date !== date))) fail('canonical stock identity mismatch');
  const trace = createPriceTrace(datedRow(selected), chart.value, date);
  if (!trace) fail('canonical chart failed the production price audit');
  const tracedRow = { ...datedRow(selected), price_trace_start: trace.points[0][0] };
  let descriptor, proofBody, svgBody;
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'event-feed-public-trace-'));
  try {
    const chartFile = join(temporaryRoot, selected.chart_path);
    await mkdir(dirname(chartFile), { recursive: true });
    await writeFile(chartFile, chart.body);
    // The production exporter writes and then independently verifies its proof
    // and exact SVG bytes against the unchanged canonical chart on disk.
    descriptor = await exportPriceTraces({ root: temporaryRoot, rows: [tracedRow], traces: new Map([[selected.symbol, trace]]), date });
    proofBody = await readFile(join(temporaryRoot, descriptor.root, 'index.json'));
    svgBody = await readFile(join(temporaryRoot, priceTraceForRow(tracedRow, descriptor, date).src));
  } finally { await rm(temporaryRoot, { recursive: true, force: true }); }

  // Do not re-encode through researchListRow: that production projection may
  // remove existing financial detail or unfamiliar metadata. Append a sparse
  // transport column instead, preserving every original column and all rows.
  const derivedIndex = structuredClone(research.value);
  const selectedIndex = decoded.rows.indexOf(selected);
  if (derivedIndex.schema) {
    if (derivedIndex.fields.some(path => path[0] === 'price_trace_start')) fail('preexisting trace transport column');
    derivedIndex.fields.push(['price_trace_start']);
    derivedIndex.columns.push({ pool: [tracedRow.price_trace_start], refs: decoded.rows.map((_, index) => index === selectedIndex ? 0 : -1) });
  } else derivedIndex.rows[selectedIndex].price_trace_start = tracedRow.price_trace_start;
  derivedIndex.price_traces = descriptor;
  const roundTrip = decodeResearchIndex(structuredClone(derivedIndex));
  const expected = structuredClone(decoded);
  expected.rows[selectedIndex].price_trace_start = tracedRow.price_trace_start;
  expected.price_traces = descriptor;
  if (!isDeepStrictEqual(roundTrip, expected)) fail('research round-trip changed source data');
  const researchBody = Buffer.from(JSON.stringify(derivedIndex));
  const derivedHash = sha256(researchBody), researchPath = `research-index-${derivedHash.slice(0, 16)}.json`;
  const derivedManifest = structuredClone(inputManifest);
  derivedManifest.research_generation = derivedHash;
  derivedManifest.markets.US.assets.research.path = researchPath;
  if (Object.hasOwn(reference, 'sha256')) derivedManifest.markets.US.assets.research.sha256 = derivedHash;
  const manifestBody = Buffer.from(JSON.stringify(derivedManifest));
  const svgPath = priceTraceForRow(tracedRow, descriptor, date).src, proofPath = `${descriptor.root}/index.json`;
  const resources = new Map([
    ['manifest.json', { type: 'application/json', body: manifestBody }],
    [researchPath, { type: 'application/json', body: researchBody }],
    [proofPath, { type: 'application/json', body: proofBody }],
    [svgPath, { type: 'image/svg+xml', body: svgBody }],
  ]);
  return {
    resources, symbol: selected.symbol,
    provenance: {
      version: 'public-ohlcv-preview-trace-v1', preview_only: true, symbol: selected.symbol,
      statement: 'Locally derived preview geometry from public canonical OHLCV; not a published new dataset or a newly fresh financial observation. Original financial values, timestamps, source freshness and all research rows are unchanged.',
      source_as_of_date: date, source_generated_at: inputManifest.generated_at ?? null,
      source_research_generation: inputManifest.research_generation ?? null, derived_research_generation: derivedHash,
      row_count: decoded.rows.length, chart_resources_read: 1,
      original: { manifest: digest('manifest.json', originalManifest.body), research: digest(reference.path, research.body), chart: digest(selected.chart_path, chart.body) },
      derived: { manifest: digest('manifest.json', manifestBody), research: digest(researchPath, researchBody), svg: digest(svgPath, svgBody), proof: digest(proofPath, proofBody) },
    },
  };
}
