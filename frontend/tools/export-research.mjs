// Daily, reproducible candidate snapshots use the exact same rules as the UI.
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { rankCandidates, compareReference } from '../src/static/researchEngine.js';

const root = resolve('public/static-data');
async function read(relative) {
  const path = resolve(root, relative);
  if (!path.startsWith(root + '/') && !path.startsWith(root + '\\')) throw Error('Invalid data path');
  return JSON.parse(await readFile(path, 'utf8'));
}
let manifest;
try { manifest = await read('manifest.json'); } catch (error) {
  if (error.code !== 'ENOENT') throw error;
  console.log('Daily research export skipped: no local static-data bundle.');
  process.exit(0);
}
const entry = manifest.markets?.US || manifest;
const scan = await read(entry.pages.scan.path);
const rows = new Map((scan.initial_rows || []).map(r => [r.symbol, r]));
for (const chunk of scan.chunks || []) {
  const payload = await read(chunk.path);
  if (payload.as_of_date && payload.as_of_date !== scan.as_of_date) throw Error('Mixed scan dates');
  for (const row of payload.rows || []) rows.set(row.symbol, row);
}
const candidates = Object.fromEntries(['oneil', 'minervini', 'ibd'].map(method => [method,
  rankCandidates([...rows.values()], method, { liquidOnly: true }).filter(r => r.assessment.qualified).slice(0, 50).map(({ row, assessment }) => ({ symbol: row.symbol, rs_estimate: row.rs_rating, passed: assessment.passed, total: assessment.total }))]));
// Only explicitly verified references are eligible. Old lists remain historical;
// they can never inflate today's overlap. No scraping or invented IBD membership.
let reference = null;
const referenceDir = resolve('../data/ibd_reference/ibd50');
for (const file of (await readdir(referenceDir)).filter(f => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().reverse()) {
  const value = JSON.parse(await readFile(resolve(referenceDir, file), 'utf8'));
  if (value.verified === true && value.as_of_date === scan.as_of_date && value.source && value.constituents?.length) { reference = value; break; }
}
await writeFile('public/ibd-reference.json', JSON.stringify(reference));
await writeFile('public/research-daily.json', JSON.stringify({
  schema_version: 1, rule_version: 'research-v2', as_of_date: scan.as_of_date,
  generated_at: manifest.generated_at, universe_size: rows.size, ratings: 'independent_estimates',
  liquidity: { min_price_usd: 10, min_average_dollar_volume: 20000000 },
  candidates, ibd_comparison: compareReference(candidates.ibd, reference, scan.as_of_date),
}, null, 2));
console.log(`Daily research exported for ${scan.as_of_date}: ${rows.size} rows.`);
