// Preserve actual 2026-09-29 observations for D9's exactly 207-point budget.
// This is a render fixture only; it is never loaded by the published app.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { assess, entryPlan, rankCandidates } from '../src/static/researchEngine.js';
import { filterRanked } from '../src/static/researchPresentation.js';
const root = 'public/static-data/';
const manifest = JSON.parse(await readFile(root + 'manifest.json', 'utf8'));
const entry = manifest.markets.US;
if (entry.as_of_date !== '2026-09-29') throw Error('Requires the actual 2026-09-29 source snapshot, not invented replacement observations');
const source = await readFile(root + entry.assets.research.path);
const rows = decodeResearchIndex(JSON.parse(source)).rows;
const real = filterRanked(rankCandidates(rows, 'minervini'), { liquidOnly: true, qualifiedOnly: true })
  .filter(item => entryPlan(item.row, null, 'minervini').pivot && Number.isFinite(item.row.rs_rating));
if (real.length !== 207 || real.some(item => !assess(item.row, 'minervini').qualified)) throw Error('The real canonical fixture must contain exactly 207 qualified points');
const fields = ['symbol', 'current_price', 'se_pivot_price', 'vcp_pivot', 'rs_rating', 'se_volume_vs_50d', 'corporate_action', 'price_activity', 'chart_path'];
const fixture = { as_of_date: entry.as_of_date, generated_at: manifest.generated_at, source_path: entry.assets.research.path, source_sha256: createHash('sha256').update(source).digest('hex'), purpose: 'D9 rendering only, historical observed data; never investment input',
  ranked: real.map(({ row, assessment }) => ({ row: Object.fromEntries(fields.filter(field => Object.hasOwn(row, field)).map(field => [field, row[field]])), assessment })) };
await mkdir('tools/fixtures', { recursive: true });
await writeFile('tools/fixtures/radar-207-2026-09-29.json', JSON.stringify(fixture));
console.log(`${fixture.ranked.length} real points, source ${fixture.source_sha256}`);
