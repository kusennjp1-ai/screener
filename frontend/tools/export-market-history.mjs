#!/usr/bin/env node
// Explicit local inputs only. This command never fetches or publishes data.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { gunzipSync } from 'node:zlib';
import { buildInstitutionalMarketSnapshot } from './market-history-producer.mjs';
import { persistMarketHistorySnapshot } from './market-history-store.mjs';

export function exportMarketHistory(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    'as-of': { type: 'string' }, symbols: { type: 'string' }, store: { type: 'string' },
    seed: { type: 'string' }, mapping: { type: 'string' }, manifest: { type: 'string' },
  } });
  if (!values['as-of'] || !values.symbols || !values.store) throw Error('Required: --as-of YYYY-MM-DD --symbols AAPL,MSFT --store <directory>');
  const symbols = values.symbols.split(',').map(symbol => symbol.trim());
  if (symbols.some(symbol => !/^[A-Z][A-Z0-9-]*$/.test(symbol)) || new Set(symbols).size !== symbols.length) throw Error('Symbols must be distinct explicit US symbol names');
  const seedPath = values.seed || fileURLToPath(new URL('../../data/institutional/sec13f.json.gz', import.meta.url));
  const mappingPath = values.mapping || fileURLToPath(new URL('../../data/institutional/openfigi.json', import.meta.url));
  const seedBytes = readFileSync(seedPath), mappingBytes = readFileSync(mappingPath);
  const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
  const seed = JSON.parse(gunzipSync(seedBytes).toString('utf8'));
  const mapping = JSON.parse(mappingBytes.toString('utf8'));
  const now = Date.now();
  const snapshot = buildInstitutionalMarketSnapshot({ seed, mapping, asOfDate: values['as-of'], symbols,
    inputHashes: { seed_sha256: sha256(seedBytes), mapping_sha256: sha256(mappingBytes) }, now });
  return persistMarketHistorySnapshot({ store: values.store, snapshot, manifestPath: values.manifest || null, now });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(exportMarketHistory())); } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
