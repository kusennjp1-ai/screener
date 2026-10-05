import test from 'node:test';
import {digestCanonicalInput} from './financial-candidate-baseline-derived.mjs';
import {digest} from './financial-correction.mjs';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareCandidateBaselineData, normalizeCandidateChartIdentity } from './financial-candidate-baseline.mjs';

function fixture(symbol = 'AAA', wrapper = false) {
  const root = mkdtempSync(join(tmpdir(), 'candidate-baseline-')), before = join(root, 'before'), after = join(root, 'after'), frontend = join(root, 'frontend');
  const put = (base, path, value) => { mkdirSync(join(base, path, '..'), { recursive: true }); writeFileSync(join(base, path), typeof value === 'string' ? value : JSON.stringify(value)); };
  put(frontend, 'package.json', { type: 'module' });
  put(frontend, 'src/static/researchTransport.js', 'export const decodeResearchIndex=value=>value;');
  put(frontend, 'src/static/researchEngine.js', "export const RULE_SUMMARY_VERSION='research-summary-v5-financial-current-instrument-applicability';");
  put(frontend, 'src/static/instrumentApplicability.js', "export const applicabilityUniverse=rows=>({version:'fixture-universe-v1',count:rows.length});export const instrumentIdentityEvidence=row=>[Object.fromEntries(['symbol','market','company_name'].map(key=>[key,row[key]])),...(row.instrument_identity?.observed_contexts||[])];");
  const row = { symbol, market: 'US', company_name: 'Recorded issuer name', current_price: 20, adv_usd: 30000000, eps_growth_yy: null, chart_path: 'charts/AAA.json', research_detail_path: 'research-details/AAA-aaaaaaaaaaaaaaaa.json' };
  const manifest = { as_of_date: '2026-10-02', default_market: 'US', supported_markets: ['US'], markets: { US: { as_of_date: '2026-10-02',
    assets: { research: { path: 'research.json' }, charts: { path: 'charts.json' } }, pages: { scan: { path: 'scan.json' } } } } };
  const files = { 'static-data/manifest.json': manifest, 'static-data/research.json': { as_of_date: '2026-10-02', rows: [row] },
    'static-data/charts.json': { symbols: [{ symbol, path: 'charts/AAA.json' }] },
    'static-data/charts/AAA.json': { symbol, market: 'US', bars: [{ date: '2026-10-02', open: 19, high: 21, low: 18, close: 20, volume: 1000 }], stock_data: row },
    'static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json': row,
    'static-data/scan.json': { as_of_date: '2026-10-02', initial_rows: [row], chunks: [] }, 'static-data/candidate-history/index.json': { snapshots: [] } };
  for (const base of [before, after]) for (const [path, value] of Object.entries(files)) put(base, path, value);
  const change = (path, update) => { const value = JSON.parse(readFileSync(join(after, path))); update(value); put(after, path, value); };
  change('static-data/manifest.json', value => Object.assign(value.markets.US.assets.research, {
    financial_evaluated_at: Date.now(), financial_semantics: 'current_at_evaluation_not_historical_publication',
    assessment_version: 'research-summary-v5-financial-current-instrument-applicability', instrument_applicability_universe: { version: 'fixture-universe-v1', count: 1 },
  }));
  change('static-data/research.json', value => { value.rows[0].as_of_date = '2026-10-02'; if (wrapper) value.rows[0].instrument_identity = { observed_contexts: [{ symbol, market: 'US', company_name: row.company_name }] }; });
  return { root, before, after, frontend, change, check: () => compareCandidateBaselineData(before, after, frontend), cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

test('candidate baseline reports exactly three verified compiler metadata additions without changing inputs', async () => {
  const f = fixture();
  try {
    const prior = readFileSync(join(f.before, 'static-data/manifest.json')), next = readFileSync(join(f.after, 'static-data/manifest.json'));
    const result = await f.check();
    assert.equal(result.publication_authority, 'none'); assert.equal(result.compiler_owned_paths.length, 3);
    assert.equal(result.compiler.assessment_version.before.present, false);
    assert.equal(result.compiler.assessment_version.after.value, 'research-summary-v5-financial-current-instrument-applicability');
    assert.deepEqual(readFileSync(join(f.before, 'static-data/manifest.json')), prior);
    assert.deepEqual(readFileSync(join(f.after, 'static-data/manifest.json')), next);
  } finally { f.cleanup(); }
});

for (const [name, path, change] of [
  ['market date', 'static-data/manifest.json', value => { value.markets.US.as_of_date = '2026-10-03'; }],
  ['unknown metadata', 'static-data/manifest.json', value => { value.markets.US.assets.research.approved = true; }],
  ['wrong version', 'static-data/manifest.json', value => { value.markets.US.assets.research.assessment_version = 'old'; }],
  ['extra applicability metadata', 'static-data/manifest.json', value => { value.markets.US.assets.research.instrument_applicability_universe.extra = true; }],
  ['historical price', 'static-data/charts/AAA.json', value => { value.bars[0].close = 21; }],
  ['historical bytes', 'static-data/candidate-history/index.json', value => { value.snapshots.push({ as_of: '2026-10-02' }); }],
  ['row price date', 'static-data/research.json', value => { value.rows[0].as_of_date = '2026-10-01'; }],
  ['research index date', 'static-data/research.json', value => { value.as_of_date = '2026-10-01'; }],
]) test(`candidate baseline rejects ${name}`, async () => { const f = fixture(); try { f.change(path, change); await assert.rejects(f.check); } finally { f.cleanup(); } });

for (const symbol of ['BITU', 'ETHE', 'SBIT']) test(`candidate baseline proves ${symbol} wrapper against original raw identity`, async () => {
  const f = fixture(symbol, true); try { const result = await f.check(); assert.equal(result.row_representation.observed_identity_wrappers[0].symbol, symbol); assert.equal(result.row_representation.observed_identity_wrappers[0].provenance.length, 3); } finally { f.cleanup(); }
});
for (const [name, change] of [
  ['different issuer', value => { value.rows[0].instrument_identity.observed_contexts[0].company_name = 'Invented name'; }],
  ['invented identifier', value => { value.rows[0].instrument_identity.observed_contexts[0].isin = 'invented'; }],
  ['duplicate context', value => { value.rows[0].instrument_identity.observed_contexts.push(value.rows[0].instrument_identity.observed_contexts[0]); }],
  ['classification', value => { value.rows[0].instrument_identity.classification = 'fund'; }],
]) test(`candidate baseline rejects identity ${name}`, async () => { const f = fixture('BITU', true); try { f.change('static-data/research.json', change); await assert.rejects(f.check); } finally { f.cleanup(); } });
test('candidate baseline rejects a wrapper for an unreviewed symbol', async () => { const f = fixture('SPY', true); try { await assert.rejects(f.check); } finally { f.cleanup(); } });
test('candidate baseline rejects a conflicting original raw name', async () => { const f = fixture('BITU', true); try { const path = join(f.before, 'static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json'), value = JSON.parse(readFileSync(path)); value.company_name = 'Conflicting original name'; writeFileSync(path, JSON.stringify(value)); await assert.rejects(f.check); } finally { f.cleanup(); } });
test('candidate baseline checks conflicting top-level scan.rows even when other originals agree', async () => { const f = fixture('BITU', true); try { const path = join(f.before, 'static-data/scan.json'), value = JSON.parse(readFileSync(path)); value.rows = [{ ...value.initial_rows[0], company_name: 'Conflicting compiler input' }]; writeFileSync(path, JSON.stringify(value)); writeFileSync(join(f.after,'static-data/scan.json'),JSON.stringify(value)); await assert.rejects(f.check,/original raw identity/); } finally { f.cleanup(); } });

test('chart normalization permits only inherited exact identities and preserves bars and unrelated fields', () => {
  const identity = { symbol: 'BITU', market: 'US', company_name: 'Recorded issuer name' };
  const before = { symbol: 'BITU', bars: [{ date: '2026-10-02', close: 20 }], signal: 'retained', stock_data: identity, fundamentals: { symbol: 'BITU', market: 'US' } };
  const after = structuredClone(before); after.market = 'US';
  after.instrument_identity = { observed_contexts: [{ symbol: 'BITU', market: 'US' }] };
  after.stock_data.instrument_identity = { observed_contexts: [identity] };
  after.fundamentals.instrument_identity = { observed_contexts: [{ symbol: 'BITU', market: 'US' }] };
  assert.deepEqual(normalizeCandidateChartIdentity(before, after, identity).value, before);
  const priceChange = structuredClone(after); priceChange.bars[0].close = 21;
  assert.equal(normalizeCandidateChartIdentity(before, priceChange, identity).value.bars[0].close, 21);
  for (const change of [v => { v.market = 'JP'; }, v => { v.symbol = 'OTHER'; }, v => { v.fundamentals.instrument_identity.observed_contexts[0].symbol = 'OTHER'; },
    v => { v.instrument_identity.observed_contexts[0].company_name = identity.company_name; }, v => { v.stock_data.instrument_identity.observed_contexts[0].company_name = 'Invented'; }]) {
    const invalid = structuredClone(after); change(invalid); assert.throws(() => normalizeCandidateChartIdentity(before, invalid, identity));
  }
  assert.throws(() => normalizeCandidateChartIdentity({ ...before, market: 'JP' }, after, identity));
  assert.throws(() => normalizeCandidateChartIdentity({ ...before, financial_source_evidence: { identity: { market: 'JP' } } }, after, identity));
  assert.throws(() => normalizeCandidateChartIdentity({ ...before, financial_historical: { detail_identity: { symbol: 'OTHER' } } }, after, identity));
});

test('normalizes exact date and identity wrappers in details and every scan alias', async () => {
  const f=fixture('BITU',true);
  try {
    const wrapper={observed_contexts:[{symbol:'BITU',market:'US',company_name:'Recorded issuer name'}]};
    f.change('static-data/research-details/AAA-aaaaaaaaaaaaaaaa.json',value=>{value.instrument_identity=wrapper;});
    f.change('static-data/scan.json',value=>{value.initial_rows[0].as_of_date='2026-10-02';value.initial_rows[0].instrument_identity=wrapper;});
    const result=await f.check();assert.ok(result.alias_representation.some(item=>item.field==='instrument_identity'));
  } finally {f.cleanup();}
});
for(const [label,change] of [
  ['changed alias date',value=>{value.initial_rows[0].as_of_date='2026-10-01';}],
  ['invented alias identity',value=>{value.initial_rows[0].instrument_identity={observed_contexts:[{symbol:'BITU',market:'US',company_name:'Invented'}]};}],
  ['changed alias price',value=>{value.initial_rows[0].current_price=21;}],
  ['unreviewed sort',value=>{value.sort={field:'arbitrary',order:'desc'};}],
]) test(`baseline representation rejects ${label}`,async()=>{
  const f=fixture('BITU',true);try {f.change('static-data/scan.json',change);await assert.rejects(f.check);}finally{f.cleanup();}
});


test('streamed canonical digest preserves complete proof keys, ordering, floats and text bytes',()=>{
  const values=[null,true,false,0,-0,1e-20,'quoted " text / 日本語 \ud800',
    {z:[3,{b:null,a:1.5}],a:{'10':[0,'USD'],'2':['CAD',-0],'0':['JPY',1e30]}},
    Array.from({length:1000},(_,index)=>({symbol:`ROW${index}`,proof:{'12':index/7,'2':null,'0':-0},history:[{end:'2025-12-31',eps:index/11}]}))];
  for(const value of values)assert.equal(digestCanonicalInput(value),digest(value));
  for(const value of [undefined,Infinity,NaN,{missing:undefined}])assert.throws(()=>digestCanonicalInput(value));
});
