// Read-only acquisition planning. No financial pass/rank or public data is changed.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { decodeResearchIndex } from '../../frontend/src/static/researchTransport.js';
import { rankCandidates } from '../../frontend/src/static/researchEngine.js';

export const PUBLIC_DATA_ROOT = 'https://kusennjp1-ai.github.io/screener/static-data/';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const symbolPattern = /^[A-Z][A-Z0-9-]{0,19}$/;
const validDay = text => typeof text === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(text) && Number.isFinite(Date.parse(text)) && new Date(text).toISOString().slice(0, 10) === text;

export function researchPath(manifest) {
  if (manifest?.schema_version !== 'static-site-v2') throw Error('Unsupported published manifest');
  const path = manifest.markets?.US?.assets?.research?.path;
  if (typeof path !== 'string' || !/^research-index-[a-f0-9]{16}\.json$/.test(path)) throw Error('Unbound research path');
  return path;
}

export function prepareStatementCohort(manifestBytes, indexBytes, observedAt) {
  if (manifestBytes.length > 1024 * 1024 || indexBytes.length > 10 * 1024 * 1024) throw Error('Published input exceeds bounded size');
  if (typeof observedAt !== 'string' || !/Z$/.test(observedAt) || !Number.isFinite(Date.parse(observedAt))) throw Error('An explicit UTC observation time is required');
  const manifest = JSON.parse(manifestBytes), path = researchPath(manifest);
  const digest = sha256(indexBytes);
  if (path !== `research-index-${digest.slice(0, 16)}.json`) throw Error('Research content hash mismatch');
  const raw = JSON.parse(indexBytes);
  const index = decodeResearchIndex(raw);
  const date = index.as_of_date;
  if (!validDay(date) || date > observedAt.slice(0, 10) || manifest.as_of_date !== date ||
      (manifest.markets.US.as_of_date != null && manifest.markets.US.as_of_date !== date)) throw Error('Published snapshot dates disagree');
  if (!Array.isArray(index.rows) || !index.rows.length || index.rows.length > 25000) throw Error('Invalid research universe');
  const symbols = new Set();
  for (const row of index.rows) {
    if (!row || !symbolPattern.test(row.symbol) || symbols.has(row.symbol) || (row.market != null && row.market !== 'US')) throw Error('Invalid, duplicated or foreign research identity');
    symbols.add(row.symbol);
  }
  // This is the existing app liquidity predicate and technical browsing order.
  // No financial condition is required before acquiring its own evidence.
  const candidates = rankCandidates(index.rows, 'minervini', { liquidOnly: true });
  if (!candidates.length) throw Error('No liquid US symbols in the verified input');
  const base = {
    schema_version: 'financial-recovery-base-v1', market: 'US', as_of_date: date,
    source: {
      url: PUBLIC_DATA_ROOT + path, manifest_url: PUBLIC_DATA_ROOT + 'manifest.json',
      manifest_sha256: sha256(manifestBytes), research_index_sha256: digest,
      generated_at: manifest.generated_at ?? null, observed_at: observedAt,
    },
    liquidity: { min_price_usd: 10, min_average_dollar_volume: 20000000 },
    universe_size: index.rows.length, eligible_size: candidates.length,
    priority_basis: 'existing_minervini_technical_browsing_order_only',
    rows: index.rows.map(row => ({ symbol: row.symbol, market: 'US',
      current_price: row.current_price ?? null, adv_usd: row.adv_usd ?? null })),
  };
  const baseBytes = Buffer.from(JSON.stringify(base));
  return {
    base, baseBytes,
    cohort: {
      symbols: candidates.map(({ row }) => row.symbol), base_artifact_sha256: sha256(baseBytes),
    },
  };
}

async function boundedFetch(url, maximumBytes) {
  const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw Error(`Published source HTTP ${response.status}`);
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > maximumBytes) throw Error('Published input exceeds bounded size');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

async function main() {
  const [output, inputDirectory] = process.argv.slice(2);
  if (!output) throw Error('Usage: node prepare-statement-cohort.mjs OUTPUT_DIRECTORY [LOCAL_STATIC_DATA]');
  const manifestBytes = inputDirectory
    ? await readFile(resolve(inputDirectory, 'manifest.json'))
    : await boundedFetch(PUBLIC_DATA_ROOT + 'manifest.json', 1024 * 1024);
  const path = researchPath(JSON.parse(manifestBytes));
  const indexBytes = inputDirectory
    ? await readFile(resolve(inputDirectory, path))
    : await boundedFetch(PUBLIC_DATA_ROOT + path, 10 * 1024 * 1024);
  const result = prepareStatementCohort(manifestBytes, indexBytes, new Date().toISOString());
  const basePath = resolve(output, 'base.json');
  await mkdir(dirname(basePath), { recursive: true });
  await writeFile(basePath, result.baseBytes, { flag: 'wx' });
  await writeFile(resolve(output, 'cohort.json'), JSON.stringify(result.cohort, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ source_date: result.base.as_of_date, universe: result.base.universe_size,
    eligible: result.base.eligible_size, base_artifact_sha256: result.cohort.base_artifact_sha256 }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
