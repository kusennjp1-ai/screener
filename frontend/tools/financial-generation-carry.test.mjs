// @vitest-environment node
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, writeFile, rm, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { CORRECTION_FIELDS, overlayFinancialCorrection, overlayFinancialChart, validateCorrectionProjection } from './financial-correction-overlay.mjs';
import { FINANCIAL_GENERATION_CARRY_SCHEMA, FINANCIAL_GENERATION_CARRY_ENV, createFinancialGenerationCarry, validateFinancialGenerationCarry, readFinancialGenerationCarry, loadFinancialGenerationCarry, verifyCarryCompatibility } from './financial-generation-carry.mjs';
import { FINANCIAL_FIELDS, projectFinancialRow, projectFinancialPayload, currentFinancialHistory } from '../src/static/financialCurrent.js';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../src/test/fixtures/nativeAnnual.js';
import { decodeResearchIndex, encodeResearchIndex } from '../src/static/researchTransport.js';
import { assess } from '../src/static/researchEngine.js';
import { withAuditFixture } from '../src/static/testAuditFixture.js';
import { exportWorkbench } from './export-workbench.mjs';
import { readCarryTargetBase, verifyCarriedBundle } from '../../.github/scripts/financial-generation-carry-controller.mjs';
import { instrumentApplicability, instrumentIdentityEvidence } from '../src/static/instrumentApplicability.js';

const originalTime = Date.parse('2026-10-04T12:00:00Z'), originalDate = '2026-10-02';
const buildTime = Date.parse('2026-10-05T12:00:00Z'), targetDate = '2026-10-05';
const identity = `1/1/${'a'.repeat(64)}/${'b'.repeat(64)}`, lineage = 'c'.repeat(64), day = 86400000;
const hash = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => hash(JSON.stringify(canonical(value)));
const write = async (path, value) => { await mkdir(resolve(path, '..'), { recursive: true }); await writeFile(path, typeof value === 'string' ? value : JSON.stringify(value)); };
const read = async path => JSON.parse(await readFile(path, 'utf8'));
const row = (symbol, date = originalDate) => ({ symbol, market: 'US', as_of_date: date, company_name: `${symbol} Corporation`, quoteType: 'EQUITY', rs_rating: 90, current_price: 100, adv_usd: 30000000, current_volume: 1000000, composite_score: 99, eps_growth_yy: 999, eps_rating: 99, code33: true, screener_results: { canslim: { score: 99, passes: true }, volume_breakthrough: { score: 50 } } });
function inputs({ now = buildTime, date = targetDate, annualAgeHours = 1, quarterAgeHours = 1, currency = 'CAD' } = {}) {
  const base = { market: 'US', as_of_date: originalDate, rows: ['OWNED', 'NULL', 'MISMATCH', 'NOIDENTITY', 'DROPPED', 'OUTSIDE'].map(symbol => row(symbol)) };
  delete base.rows.find(row => row.symbol === 'NOIDENTITY').company_name;
  const sourceBase = JSON.stringify(base), symbols = {};
  const annualObserved = originalTime - annualAgeHours * 3600000, quarterObserved = originalTime - quarterAgeHours * 3600000;
  for (const symbol of ['OWNED', 'NULL', 'MISMATCH', 'NOIDENTITY', 'DROPPED']) {
    const owned = symbol !== 'NULL', proofRow = withFinancialProof({ symbol, ...(owned ? { eps_growth_qq: 30, eps_growth_yy: 40 } : {}) }, originalTime, originalDate);
    const values = Object.fromEntries(CORRECTION_FIELDS.map(field => [field, proofRow[field] ?? null]));
    values.eps_growth_quarterly = values.eps_growth_qq; values.eps_growth_annual = values.eps_growth_yy;
    const history = { symbol, as_of_date: originalDate, status: 'unavailable', basis: 'current-observation', source: null, retrieved_at: null, currency: null, annual: [], quarterly: [] }, receipts = [];
    if (owned) {
      for (const tuple of Object.values(proofRow.financial_current.p)) { tuple[4] = quarterObserved; tuple[5] = quarterObserved + 7 * day; }
      values.eps_5yr_cagr = 100;
      proofRow.financial_current.r = proofRow.financial_current.r.slice(0, 5) + '0' + proofRow.financial_current.r.slice(6);
      proofRow.financial_current.p['5'] = [100, '3', 'Diluted EPS', ['2025-12-31', '2024-12-31'], annualObserved, annualObserved + 7 * day, 'g', 'a'];
      const quarterly = { attribute: 'quarterly_income_stmt', receipt_sha256: '1'.repeat(64), capture_id: `${symbol}-original-quarterly`, raw_payload_sha256: '2'.repeat(64), observed_at: new Date(quarterObserved).toISOString() };
      const annual = { attribute: 'income_stmt', receipt_sha256: '3'.repeat(64), capture_id: `${symbol}-original-annual`, raw_payload_sha256: '4'.repeat(64), observed_at: new Date(annualObserved).toISOString() };
      receipts.push(quarterly, annual);
      Object.assign(history, nativeAnnualFixture(currency), { symbol, as_of_date: originalDate, retrieved_at: new Date(Math.min(annualObserved, quarterObserved)).toISOString(), quarterly_retrieved_at: quarterly.observed_at, quarterly: [{ end: '2025-06-30', eps: 1, revenue: 10 }, { end: '2026-06-30', eps: 1.4, revenue: 14 }] });
      Object.assign(history.annual_source, annual, { symbol });
    }
    symbols[symbol] = { market: 'US', as_of_date: originalDate, financial_values: values, financial_current: proofRow.financial_current, financial_source_evidence: { schema_version: 1, fields: {} }, financial_history: history, source_diagnostics: {}, history_source_diagnostics: {}, source_receipts: receipts };
  }
  const inventory = Object.entries(symbols).sort(([a], [b]) => a.localeCompare(b)).flatMap(([symbol, item]) => item.source_receipts.map(receipt => ({ symbol, ...receipt })));
  const sourcePolicy = { id: 'financial-correction-explicit-ownership-v1', contract_sha256: '5'.repeat(64), projector_sha256: '6'.repeat(64) };
  const source = {
    schema_version: 'financial-statement-projection-v1', financial_generation: '7'.repeat(64), financial_evaluated_at: new Date(originalTime).toISOString(), knowledge_basis: 'current_observation_at_source_capture', point_in_time: false, source_publication_date: null,
    bindings: { archive_manifest_sha256: '8'.repeat(64), acquisition_base_sha256: '9'.repeat(64), cohort_sha256: 'a'.repeat(64), target_publication_identity: identity, target_base_sha256: hash(sourceBase) },
    policy: { ...sourcePolicy, id: 'financial-correction-native-annual-v1' }, derivation: { schema_version: 'native-annual-destination-derivation-v1', source_projection_sha256: 'b'.repeat(64), source_policy: sourcePolicy, source_receipt_inventory_sha256: digest(inventory) },
    receipt_inventory: inventory, receipt_inventory_sha256: digest(inventory), symbols,
  };
  validateCorrectionProjection(source);
  const target = { market: 'US', as_of_date: date, rows: ['OWNED', 'NULL', 'MISMATCH', 'NOIDENTITY', 'OUTSIDE', 'NEW'].map(symbol => ({ ...row(symbol, date), current_price: 120, adv_usd: 35000000 })) };
  target.rows.find(row => row.symbol === 'MISMATCH').company_name = 'A Different Issuer';
  delete target.rows.find(row => row.symbol === 'NOIDENTITY').company_name;
  const sourceProjection = JSON.stringify(source, null, 2), targetBase = JSON.stringify(target);
  return { sourceProjection, sourceProjectionSha256: hash(sourceProjection), sourceBase, sourceBaseSha256: hash(sourceBase), sourceLineage: lineage, previousPublicationIdentity: identity, targetBase, targetBaseSha256: hash(targetBase), evaluatedAt: now };
}
const projected = (carry, targetRow, now = buildTime) => projectFinancialRow(overlayFinancialCorrection(targetRow, carry), { now });
const targetRows = options => JSON.parse(options.targetBase).rows;
const envFor = (path, carry, raw = JSON.stringify(carry)) => ({ FINANCIAL_GENERATION_CARRY_PROJECTION: path, FINANCIAL_GENERATION_CARRY_SHA256: hash(raw), FINANCIAL_GENERATION_CARRY_SOURCE_LINEAGE: carry.bindings.source_lineage_sha256, FINANCIAL_GENERATION_CARRY_PREVIOUS_IDENTITY: carry.bindings.previous_publication_identity, FINANCIAL_GENERATION_CARRY_TARGET_BASE_SHA256: carry.bindings.target_base_sha256, FINANCIAL_EVALUATED_AT: carry.financial_evaluated_at });

it('advances prices, date and partial universe without renewing original financial evidence', () => {
  const options = inputs(), before = structuredClone(options), source = JSON.parse(options.sourceProjection), carry = createFinancialGenerationCarry(options);
  expect(options).toEqual(before); expect(carry.schema_version).toBe(FINANCIAL_GENERATION_CARRY_SCHEMA);
  expect(carry.financial_generation).not.toBe(carry.source_financial_generation);
  const {financial_generation,...semantic}=carry;expect(financial_generation).toBe(digest(semantic));
  expect(carry.source_projection_json).toBe(options.sourceProjection); expect(carry.source_base_json).toBe(options.sourceBase);
  expect(carry.receipt_inventory).toEqual(source.receipt_inventory); expect(carry.symbols).not.toHaveProperty('DROPPED');
  expect(carry.ownership).toEqual({ MISMATCH: 'identity_mismatch', NEW: 'unowned_symbol', NOIDENTITY: 'unverified_issuer_identity', NULL: 'retained', OUTSIDE: 'unowned_symbol', OWNED: 'retained' });
  const item = carry.symbols.OWNED, original = source.symbols.OWNED;
  expect(item.financial_current).toEqual({ ...original.financial_current, a: targetDate });
  expect(item.financial_history).toEqual({ ...original.financial_history, as_of_date: targetDate });
  expect(item.financial_source_evidence).toEqual(original.financial_source_evidence); expect(item.source_receipts).toEqual(original.source_receipts);
  const result = projected(carry, targetRows(options).find(row => row.symbol === 'OWNED'));
  expect(result).toMatchObject({ current_price: 120, adv_usd: 35000000, as_of_date: targetDate, eps_growth_qq: 30, eps_growth_yy: 40, eps_5yr_cagr: 100, eps_rating: null, composite_score: null, code33: null });
  expect(result.financial_current_state.fields.eps_growth_qq.source_validated).toBe(true);
  expect(result.screener_results.canslim).toMatchObject({ score: null, passes: null, status: 'unknown' });
  for (const targetRow of targetRows(options).filter(row => row.symbol !== 'OWNED')) {
    const current = projected(carry, targetRow);
    expect(FINANCIAL_FIELDS.every(field => current[field] === null)).toBe(true);
    expect(current.financial_history.annual).toEqual([]); expect(assess(current, 'oneil', buildTime).qualified).toBe(false);
  }
  expect(() => validateCorrectionProjection(carry)).toThrow(); expect(validateFinancialGenerationCarry(carry)).toBe(carry);
});

it('checks fresh and expired annual/quarterly histories independently in native currency', () => {
  for (const [annualAgeHours, quarterAgeHours, annualFresh, quarterFresh] of [[60, 1, false, true], [1, 60, true, false]]) {
    const options = inputs({ annualAgeHours, quarterAgeHours, currency: 'JPY' }), carry = createFinancialGenerationCarry(options), history = carry.symbols.OWNED.financial_history;
    const current = currentFinancialHistory(history, 'OWNED', targetDate, buildTime);
    expect(current.annual.length > 0).toBe(annualFresh); expect(current.quarterly.length > 0).toBe(quarterFresh);
    expect(current.annualComplete).toBe(annualFresh ? true : null); expect(current.epsYoY).toBe(quarterFresh ? 39.99999999999999 : null);
    expect(history.currency).toBe('JPY'); expect(history.annual_currency).toBe('JPY'); expect(history.quarterly_currency).toBe('USD');
    expect(history.annual).toEqual(JSON.parse(options.sourceProjection).symbols.OWNED.financial_history.annual);
    expect(history.annual_source).toEqual(JSON.parse(options.sourceProjection).symbols.OWNED.financial_history.annual_source);
  }
});

it('expires individual scalar proofs at the actual build clock and preserves null ownership', () => {
  const now = originalTime + 2 * day, date = '2026-10-06';
  const options = inputs({ now, date, quarterAgeHours: 6 * 24 }), carry = createFinancialGenerationCarry(options);
  const result = projected(carry, targetRows(options).find(row => row.symbol === 'OWNED'), now);
  expect(result.eps_growth_yy).toBeNull(); expect(result.financial_current_state.fields.eps_growth_yy.reason).toBe('stale_source'); expect(result.eps_5yr_cagr).toBe(100);
  expect(result.financial_current.p['1'][4]).toBe(originalTime - 6 * day); expect(result.financial_current.t).toBe(originalTime);
  const nullRow = projected(carry, targetRows(options).find(row => row.symbol === 'NULL'), now);
  expect(nullRow.eps_growth_yy).toBeNull(); expect(nullRow.financial_current_state.fields.eps_growth_yy.reason).toBe('missing_evidence');
});

it('ignores unowned fresh provider-looking receipts and requires a new explicit source lineage', () => {
  const options = inputs(), target = JSON.parse(options.targetBase);
  const fresh = withFinancialProof({ ...target.rows[0], eps_growth_yy: 777 }, buildTime, targetDate);
  fresh.financial_source_evidence = { observed_at: new Date(buildTime).toISOString(), source: 'new provider receipt' }; target.rows[0] = fresh;
  options.targetBase = JSON.stringify(target); options.targetBaseSha256 = hash(options.targetBase);
  const carry = createFinancialGenerationCarry(options), result = projected(carry, fresh);
  expect(result.eps_growth_yy).toBe(40); expect(result.financial_current.p['1'][4]).toBe(originalTime - 3600000); expect(carry.bindings.source_lineage_sha256).toBe(lineage);
  const altered = structuredClone(carry); altered.symbols.OWNED.financial_current.p['1'][4] = buildTime;
  expect(() => validateFinancialGenerationCarry(altered)).toThrow('immutable derivation');
  const replacement = JSON.parse(options.sourceProjection); replacement.symbols.OWNED.source_receipts[0].capture_id = 'a-new-receipt';
  expect(() => createFinancialGenerationCarry({ ...options, sourceProjection: JSON.stringify(replacement) })).toThrow('source projection hash');
  expect(() => validateFinancialGenerationCarry(carry, { sourceLineage: 'd'.repeat(64) })).toThrow('source lineage');
});

it('quarantines issuer identifier conflicts even when names match and permits normalized identifiers', () => {
  const options = inputs(), original = JSON.parse(options.sourceBase), source = JSON.parse(options.sourceProjection), target = JSON.parse(options.targetBase);
  original.rows.find(row => row.symbol === 'OWNED').cik = '123'; target.rows.find(row => row.symbol === 'OWNED').issuer_cik = '0000000123';
  options.sourceBase = JSON.stringify(original); options.sourceBaseSha256 = hash(options.sourceBase); source.bindings.target_base_sha256 = options.sourceBaseSha256;
  options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
  options.targetBase = JSON.stringify(target); options.targetBaseSha256 = hash(options.targetBase);
  expect(createFinancialGenerationCarry(options).ownership.OWNED).toBe('retained');
  target.rows.find(row => row.symbol === 'OWNED').issuer_cik = '456'; options.targetBase = JSON.stringify(target); options.targetBaseSha256 = hash(options.targetBase);
  expect(createFinancialGenerationCarry(options).ownership.OWNED).toBe('identity_mismatch');
});

it('rejects tampering, backdating, missing source ownership and malformed destination identity', () => {
  const options = inputs(), carry = createFinancialGenerationCarry(options);
  for (const mutate of [value => value.symbols.OWNED.financial_values.eps_growth_yy++, value => value.symbols.OWNED.financial_history.annual[0].eps++, value => value.symbols.OWNED.financial_current.t++, value => value.symbols.OWNED.source_receipts[0].observed_at = value.financial_evaluated_at, value => value.policy.source_policy.id = 'forged', value => delete value.symbols.NEW, value => value.ownership.MISMATCH = 'retained', value => value.extra = true]) {
    const changed = structuredClone(carry); mutate(changed); expect(() => validateFinancialGenerationCarry(changed)).toThrow();
  }
  expect(() => createFinancialGenerationCarry({ ...options, evaluatedAt: originalTime - 1 })).toThrow('precedes');
  const changed = JSON.parse(options.targetBase); changed.as_of_date = '2026-10-01'; changed.rows.forEach(row => row.as_of_date = changed.as_of_date);
  const raw = JSON.stringify(changed); expect(() => createFinancialGenerationCarry({ ...options, targetBase: raw, targetBaseSha256: hash(raw) })).toThrow('precedes');
  const source = JSON.parse(options.sourceProjection); delete source.symbols.NULL.financial_values.eps_growth_yy;
  const sourceRaw = JSON.stringify(source); expect(() => createFinancialGenerationCarry({ ...options, sourceProjection: sourceRaw, sourceProjectionSha256: hash(sourceRaw) })).toThrow('ownership');
  changed.rows.push(changed.rows[0]); const duplicate = JSON.stringify(changed);
  expect(() => createFinancialGenerationCarry({ ...options, targetBase: duplicate, targetBaseSha256: hash(duplicate) })).toThrow('identity');
});

it('loads only exact, exclusive, complete carry bindings for the complete current universe', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'financial-carry-load-'));
  try {
    const options = inputs(), carry = createFinancialGenerationCarry(options), path = join(directory, 'carry.json'); await write(path, carry);
    const env = envFor(path, carry);
    expect(await readFinancialGenerationCarry({env})).toEqual(carry);
    expect(await loadFinancialGenerationCarry({ env, rows: targetRows(options), asOfDate: targetDate })).toEqual(carry);
    expect(await loadFinancialGenerationCarry({ env: {}, rows: targetRows(options), asOfDate: targetDate })).toBeNull();
    for (const key of [...FINANCIAL_GENERATION_CARRY_ENV, 'FINANCIAL_EVALUATED_AT']) {
      const changed = { ...env }; delete changed[key]; await expect(loadFinancialGenerationCarry({ env: changed, rows: targetRows(options), asOfDate: targetDate })).rejects.toThrow();
    }
    await expect(loadFinancialGenerationCarry({ env: { ...env, FINANCIAL_CORRECTION_PROJECTION: '/tmp/other.json' }, rows: targetRows(options), asOfDate: targetDate })).rejects.toThrow('mutually exclusive');
    await expect(loadFinancialGenerationCarry({ env, rows: targetRows(options).slice(1), asOfDate: targetDate })).rejects.toThrow('universe');
    const changed = targetRows(options); changed[0].current_price++;
    await expect(loadFinancialGenerationCarry({ env, rows: changed, asOfDate: targetDate })).rejects.toThrow('current_price');
    await writeFile(path, JSON.stringify(carry) + ' ');
    await expect(loadFinancialGenerationCarry({ env, rows: targetRows(options), asOfDate: targetDate })).rejects.toThrow('hash');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function exportFixture(options = inputs(), { withPrior = false, chartForRow } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'financial-carry-export-')), frontend = join(directory, 'frontend'), root = join(frontend, 'public/static-data'), rows = targetRows(options), date = JSON.parse(options.targetBase).as_of_date;
  const entry = { as_of_date: date, market: 'US', pages: { scan: { path: 'scan.json' } }, assets: { charts: { path: 'charts-index.json' } } };
  await write(join(root, 'manifest.json'), { generated_at: new Date(options.evaluatedAt).toISOString(), markets: { US: entry } });
  await write(join(root, 'scan.json'), { as_of_date: date, initial_rows: rows, preview_rows: rows, chunks: [{ path: 'chunk.json' }], default_filters: { minVolume: 500 }, preset_screens: [{ id: 'financial', filters: { epsRating: { min: 80 } } }] });
  await write(join(root, 'chunk.json'), { as_of_date: date, rows, initial_rows: rows, preview_rows: rows });
  await write(join(root, 'charts-index.json'), { symbols: rows.map(row => ({ symbol: row.symbol, path: `charts/${row.symbol}.json` })) });
  for (const row of rows) {
    const chart = chartForRow ? chartForRow(row) : { symbol: row.symbol, market: 'US', as_of_date: date, bars: [], stock_data: row, fundamentals: { ...row, symbol: undefined }, eps_line: [{ time: date, value: 99 }] };
    await write(join(root, `charts/${row.symbol}.json`), chart); await write(join(root, `raw/${row.symbol}.json`), chart);
  }
  await write(join(root, 'financial-history.json'), { as_of_date: date, results: Object.fromEntries(rows.map(row => [row.symbol, { symbol: row.symbol, annual: [{ end: '2025-12-31', eps: 999 }] }])) });
  await write(join(root, 'candidate-history/index.json'), { snapshots: [] }); await write(join(root, 'candidate-history/retained-history.json'), 'old history bytes\n');
  await mkdir(join(directory, 'data/ibd_reference/ibd50'), { recursive: true });
  if (withPrior) {
    const previousRows = rows.map(value => withFinancialProof(withAuditFixture({
      ...value, as_of_date: originalDate, eps_growth_yy: 30, sales_growth_yy: 30,
      financial_history: { symbol:value.symbol, as_of_date:originalDate, status:'available', basis:'reported_diluted_eps', currency:'USD', source:'Synthetic provider', retrieved_at:new Date(originalTime).toISOString(), annual:[1,2,4,8].map((eps,index)=>({end:`${2022+index}-12-31`,eps})) },
      institutional_evidence: { symbol:value.symbol, status:'available', unit:'13f_reporting_manager_cik', publication_cutoff:originalDate, observations:[{period:'2026-03-31',filing_date_first:'2026-04-30',filing_date_last:'2026-05-15',manager_count:5},{period:'2026-06-30',filing_date_first:'2026-07-31',filing_date_last:'2026-08-14',manager_count:7}] },
    }, originalDate), originalTime, originalDate));
    const previous = await exportWorkbench({root, rows:previousRows, manifest:{generated_at:new Date(originalTime).toISOString()}, entry:{as_of_date:originalDate,assets:{}}, researchContent:JSON.stringify(previousRows),now:originalTime});
    await write(join(root,'candidate-history/index.json'), {schema_version:1,snapshots:[previous.current_snapshot]});
  }
  const ordinaryEnv = { ...process.env, FINANCIAL_EVALUATED_AT: new Date(options.evaluatedAt).toISOString() };
  for (const key of Object.keys(ordinaryEnv)) if (key.startsWith('FINANCIAL_CORRECTION_') || key.startsWith('FINANCIAL_GENERATION_CARRY_')) delete ordinaryEnv[key];
  const exporter = fileURLToPath(new URL('./export-research.mjs', import.meta.url));
  execFileSync(process.execPath, [exporter], { cwd: frontend, env: ordinaryEnv, encoding: 'utf8' });
  const baselineRoot = join(directory, 'before-public'); await cp(join(frontend, 'public'), baselineRoot, { recursive: true });
  const carry = createFinancialGenerationCarry(options), path = join(directory, 'carry.json'); await write(path, carry);
  const env = { ...ordinaryEnv, ...envFor(path, carry) };
  execFileSync(process.execPath, [exporter], { cwd: frontend, env, encoding: 'utf8' });
  return { directory, frontend, root, carry, env, baselineRoot };
}

it('exports advancing carry across all aliases and records the final daily observation', async () => {
  const { directory, frontend, root, carry, env } = await exportFixture(inputs({ annualAgeHours: 60 }));
  try {
    const report = await verifyCarryCompatibility({ root, carry, evaluatedAt: buildTime + 1000 });
    expect(await verifyCarryCompatibility({root, carry, evaluatedAt: buildTime + 2000})).toEqual(report);

    expect(report.schema_version).toBe('financial-generation-carry-compatibility-v1'); expect(report.counts.universe).toBe(6);
    const manifest = await read(join(root, 'manifest.json')), index = decodeResearchIndex(await read(join(root, manifest.markets.US.assets.research.path)));
    expect(index.as_of_date).toBe(targetDate); expect(index.rows.every(row => row.current_price === 120 && row.adv_usd === 35000000)).toBe(true);
    expect(index.rows.find(row => row.symbol === 'OWNED')).toMatchObject({ eps_growth_yy: 40, financial_generation: carry.financial_generation }); expect(index.rows.find(row => row.symbol === 'NEW').eps_growth_yy).toBeNull();
    const raw = await read(join(root, 'raw/OWNED.json')); expect(raw.fundamentals.eps_growth_yy).toBe(40); expect(raw.eps_line).toEqual([]);
    expect(await readFile(join(root, 'candidate-history/retained-history.json'), 'utf8')).toBe('old history bytes\n');
    execFileSync(process.execPath, [fileURLToPath(new URL('./record-candidate-history.mjs', import.meta.url))], { cwd: frontend, env, encoding: 'utf8' });
    const catalog = await read(join(root, 'candidate-history/index.json')), workbench = await read(join(root, manifest.markets.US.assets.workbench.path)); expect(catalog.snapshots).toEqual([workbench.current_snapshot]);
    await expect(verifyCarryCompatibility({ root, carry, evaluatedAt: originalTime + 4 * day })).rejects.toThrow('expired');
    raw.fundamentals.eps_growth_yy = 999; await write(join(root, 'raw/OWNED.json'), raw); await expect(verifyCarryCompatibility({ root, carry, evaluatedAt: buildTime + 1000 })).rejects.toThrow('mismatch');
  } finally { if (process.env.FINANCIAL_CARRY_KEEP_FIXTURE) console.log(`Carry fixture: ${directory}`); else await rm(directory, { recursive: true, force: true }); }
});

it('detects annual-only expiry at recheck while quarterly history remains valid', async () => {
  const { directory, root, carry } = await exportFixture(inputs({ annualAgeHours: 47, quarterAgeHours: 1 }));
  try {
    await verifyCarryCompatibility({ root, carry, evaluatedAt: buildTime + 1000 });
    await expect(verifyCarryCompatibility({ root, carry, evaluatedAt: buildTime + 2 * 3600000 })).rejects.toThrow('history expired');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

it('also carries the original USD history contract without adding a native or FX claim', () => {
  const options = inputs({ currency: 'USD' }), source = JSON.parse(options.sourceProjection);
  source.policy = source.derivation.source_policy; delete source.derivation;
  for (const item of Object.values(source.symbols)) for (const key of ['schema_version', 'annual_currency', 'quarterly_currency', 'quarterly_retrieved_at', 'annual_source']) delete item.financial_history[key];
  options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
  const carry = createFinancialGenerationCarry(options), history = carry.symbols.OWNED.financial_history;
  expect(history).toEqual({ ...source.symbols.OWNED.financial_history, as_of_date: targetDate });
  expect(history).not.toHaveProperty('annual_source'); expect(history).not.toHaveProperty('schema_version');
  expect(currentFinancialHistory(history, 'OWNED', targetDate, buildTime).annualComplete).toBe(true);
});

it('keeps long-expired source generations auditable while all current claims become unknown', () => {
  const now = originalTime + 200 * day, date = new Date(now).toISOString().slice(0, 10), options = inputs({ now, date });
  const carry = createFinancialGenerationCarry(options), result = projected(carry, targetRows(options)[0], now);
  expect(result.eps_growth_yy).toBeNull(); expect(result.financial_current_state.fields.eps_growth_yy.reason).toBe('stale_reporting_period');
  expect(result.eps_5yr_cagr).toBeNull(); expect(result.financial_current_state.fields.eps_5yr_cagr.reason).toBe('stale_source');
  expect(currentFinancialHistory(result.financial_history, 'OWNED', date, now).valid).toBe(false);
  expect(carry.receipt_inventory).toEqual(JSON.parse(options.sourceProjection).receipt_inventory);
});

it('never treats placeholder names, bare tickers or invalid identifiers as issuer continuity', () => {
  for (const [field, value] of [['company_name', 'OWNED'], ['company_name', 'UNKNOWN'], ['company_name', 'N/A'], ['company_name', 'NONE'], ['company_name', 'null'], ['cik', 'UNKNOWN'], ['cik', 0], ['cusip', 'N/A'], ['cusip', '037833101'], ['isin', 'NONE'], ['isin', 'US0378331006']]) {
    const options = inputs(), original = JSON.parse(options.sourceBase), source = JSON.parse(options.sourceProjection), target = JSON.parse(options.targetBase);
    for (const rows of [original.rows, target.rows]) { const item = rows.find(row => row.symbol === 'OWNED'); delete item.company_name; item[field] = value; }
    options.sourceBase = JSON.stringify(original); options.sourceBaseSha256 = hash(options.sourceBase); source.bindings.target_base_sha256 = options.sourceBaseSha256;
    options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
    options.targetBase = JSON.stringify(target); options.targetBaseSha256 = hash(options.targetBase);
    expect(createFinancialGenerationCarry(options).ownership.OWNED, `${field}: ${value}`).toBe('unverified_issuer_identity');
  }
});

it('retains valid identifier-only matches with checked CUSIP/ISIN digits', () => {
  for (const [field, value] of [['cik', '123'], ['cusip', '037833100'], ['isin', 'US0378331005']]) {
    const options = inputs(), original = JSON.parse(options.sourceBase), source = JSON.parse(options.sourceProjection), target = JSON.parse(options.targetBase);
    for (const rows of [original.rows, target.rows]) { const item = rows.find(row => row.symbol === 'OWNED'); delete item.company_name; item[field] = value; }
    options.sourceBase = JSON.stringify(original); options.sourceBaseSha256 = hash(options.sourceBase); source.bindings.target_base_sha256 = options.sourceBaseSha256;
    options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
    options.targetBase = JSON.stringify(target); options.targetBaseSha256 = hash(options.targetBase);
    expect(createFinancialGenerationCarry(options).ownership.OWNED, field).toBe('retained');
  }
});

it('preserves conflicting original-base identity alongside the original projection identity', () => {
  const options = inputs(), original = JSON.parse(options.sourceBase), source = JSON.parse(options.sourceProjection);
  original.rows.find(row => row.symbol === 'OWNED').financial_identity = { observed_name: 'A Different Original Issuer' };
  source.symbols.OWNED.financial_identity = { status: 'ticker_only', symbol: 'OWNED', market: 'US', observed_name: 'OWNED Corporation', identifiers_bound_to_price: false, identifiers_bound_to_financial_receipts: false };
  options.sourceBase = JSON.stringify(original); options.sourceBaseSha256 = hash(options.sourceBase); source.bindings.target_base_sha256 = options.sourceBaseSha256;
  options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
  expect(createFinancialGenerationCarry(options).ownership.OWNED).toBe('identity_mismatch');
});


it('records a new carried daily observation against immutable prior saved decisions', async () => {
  const options=inputs(), source=JSON.parse(options.sourceProjection);
  const item=source.symbols.OWNED;
  item.financial_values.eps_growth_yy=20; item.financial_values.eps_growth_annual=20; item.financial_current.p['1'][0]=20;
  options.sourceProjection=JSON.stringify(source); options.sourceProjectionSha256=hash(options.sourceProjection);
  const {directory,frontend,root,carry,env,baselineRoot}=await exportFixture(options,{withPrior:true});
  try {
    const beforeManifest=await read(join(baselineRoot,'static-data/manifest.json')), afterManifest=await read(join(root,'manifest.json'));
    const before=await read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.workbench.path)), after=await read(join(root,afterManifest.markets.US.assets.workbench.path));
    const catalog=await read(join(baselineRoot,'static-data/candidate-history/index.json'));
    expect(catalog.snapshots).toHaveLength(1);
    expect(after.history.previous_as_of).toBe(originalDate);
    expect(after.daily_changes_snapshot).toEqual(after.current_snapshot);
    expect(after.daily_changes_snapshot).not.toEqual(before.daily_changes_snapshot);
    expect(after.changes.oneil.items.find(row=>row.symbol==='OWNED').changes.find(rule=>rule.id==='oneil:1').after).toEqual(['fail',20,null]);
    expect(before.changes.oneil.items.find(row=>row.symbol==='OWNED').changes.find(rule=>rule.id==='oneil:1').after).toEqual(['unknown',null,null]);
    const priorBytes=await readFile(join(root,catalog.snapshots[0].path));
    execFileSync(process.execPath,[fileURLToPath(new URL('./record-candidate-history.mjs',import.meta.url))],{cwd:frontend,env,encoding:'utf8'});
    expect((await read(join(root,'candidate-history/index.json'))).snapshots).toEqual([...catalog.snapshots,after.current_snapshot]);
    expect(await readFile(join(root,catalog.snapshots[0].path))).toEqual(priorBytes);
    await verifyCarryCompatibility({root,carry,evaluatedAt:buildTime+1000});
    const verify=()=>verifyCarriedBundle({baselineRoot,root:join(frontend,'public'),frontendRoot:fileURLToPath(new URL('..',import.meta.url)),carry,evaluatedAt:buildTime+1000});
    const report=await verify();expect(report.compatibility.financial_generation).toBe(carry.financial_generation);
    const catalogPath=join(root,'candidate-history/index.json'),catalogBytes=await readFile(catalogPath);
    await write(catalogPath,{schema_version:1,snapshots:[after.current_snapshot]});
    await expect(verify()).rejects.toThrow();await writeFile(catalogPath,catalogBytes);
    const priorPath=join(root,catalog.snapshots[0].path);
    await writeFile(priorPath,'forged prior observation');await expect(verify()).rejects.toThrow();await writeFile(priorPath,priorBytes);
    const workbenchPath=join(root,afterManifest.markets.US.assets.workbench.path),workbenchBytes=await readFile(workbenchPath);
    after.changes.oneil.items[0].state='new';await write(workbenchPath,after);
    await expect(verify()).rejects.toThrow();await writeFile(workbenchPath,workbenchBytes);
    expect(await verify()).toEqual(report);
  } finally {if(process.env.FINANCIAL_CARRY_KEEP_FIXTURE)console.log(`Prior carry fixture: ${directory}`);else await rm(directory,{recursive:true,force:true});}
});

it('advances an admitted containing date while preserving prior scope and original proof clocks',()=>{
  const options=inputs(),carry=createFinancialGenerationCarry(options),target=targetRows(options).find(row=>row.symbol==='OWNED');
  const oldScope={symbol:'OWNED',market:'US',as_of_date:originalDate};
  target.financial_identity={observed_scope:oldScope};
  const result=projected(carry,target),source=JSON.parse(options.sourceProjection).symbols.OWNED;
  expect(result.financial_identity.observed_scope).toEqual({...oldScope,as_of_date:targetDate});
  expect(result.financial_identity.prior_observed_scopes).toEqual([oldScope]);
  expect(result.financial_current_state.fields.eps_growth_qq.source_validated).toBe(true);
  expect(result.financial_current.p['0'].slice(4,6)).toEqual(source.financial_current.p['0'].slice(4,6));
  expect(Object.values(projectFinancialRow(result,{now:originalTime+8*day}).financial_current_state.fields).some(field=>field.source_validated)).toBe(false);
  expect(result.financial_historical).toEqual(projectFinancialRow(target,{now:buildTime}).financial_historical);
  expect(projected(carry,JSON.parse(JSON.stringify(result)))).toEqual(result);
  const serialized=JSON.parse(JSON.stringify(carry));
  expect(projected(serialized,target).financial_current_state.fields.eps_growth_qq.source_validated).not.toBe(true);
  expect(projected(Object.create(carry),target).financial_current_state.fields.eps_growth_qq.source_validated).not.toBe(true);
  validateFinancialGenerationCarry(serialized);
  expect(projected(serialized,target).financial_current_state.fields.eps_growth_qq.source_validated).toBe(true);
  for(const patch of [{symbol:'OTHER'},{market:'JP'},{as_of_date:null},{as_of_date:'2000-01-01'},{as_of_date:'2026-10-03'}]) {
    const bad={...target,financial_identity:{observed_scope:{...oldScope,...patch}}};
    expect(Object.values(projected(carry,bad).financial_current_state.fields).some(field=>field.source_validated)).toBe(false);
  }
  expect(()=>projected(carry,{...target,as_of_date:null})).toThrow('identity mismatch');
  const nextOptions=inputs(),targetBase=JSON.parse(nextOptions.targetBase),boundRow=targetBase.rows.find(row=>row.symbol==='OWNED');
  boundRow.financial_identity={observed_scope:{...oldScope,as_of_date:'2026-10-03'}};
  nextOptions.targetBase=JSON.stringify(targetBase);nextOptions.targetBaseSha256=hash(nextOptions.targetBase);
  const next=createFinancialGenerationCarry(nextOptions),advanced=projected(next,boundRow);
  expect(advanced.financial_identity.prior_observed_scopes).toEqual([boundRow.financial_identity.observed_scope]);
  expect(advanced.financial_current_state.fields.eps_growth_qq.source_validated).toBe(true);
});

function inheritedChartCarryInputs() {
  const options = inputs(), source = JSON.parse(options.sourceProjection), base = JSON.parse(options.sourceBase);
  base.rows = base.rows.filter(row => ['OWNED', 'NULL'].includes(row.symbol)).map(row => ({ ...row, rs_rating: null }));
  const fund = base.rows.find(row => row.symbol === 'NULL');
  Object.assign(fund, { symbol: 'BITU', company_name: 'ProShares Ultra Bitcoin ETF' });
  delete fund.quoteType;
  source.symbols = { BITU: source.symbols.NULL, OWNED: source.symbols.OWNED };
  source.symbols.BITU.financial_current.s = source.symbols.BITU.financial_history.symbol = 'BITU';
  for (const row of base.rows) {
    const item = source.symbols[row.symbol];
    item.financial_identity = { symbol: row.symbol, market: 'US', observed_name: row.company_name, observed_identifiers: {},
      registry_identifiers: row.symbol === 'BITU' ? { cusip: '74349Y704' } : {}, identifiers_bound_to_price: false, identifiers_bound_to_financial_receipts: false };
    item.instrument_applicability = instrumentApplicability(row);
  }
  source.receipt_inventory = Object.entries(source.symbols).flatMap(([symbol, item]) => item.source_receipts.map(receipt => ({ symbol, ...receipt })));
  source.receipt_inventory_sha256 = source.derivation.source_receipt_inventory_sha256 = digest(source.receipt_inventory);
  options.sourceBase = JSON.stringify(base); options.sourceBaseSha256 = hash(options.sourceBase);
  source.bindings.target_base_sha256 = options.sourceBaseSha256;
  options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
  const target = { market: 'US', as_of_date: targetDate, rows: base.rows.map(row => ({ ...projected(source, row, originalTime), as_of_date: targetDate })) };
  options.targetBase = JSON.stringify(target); options.targetBaseSha256 = hash(options.targetBase);
  // Archived BITU/NVDA charts have no root market or nested price dates: the
  // market is observed in stock_data, and nested rows inherit the chart date.
  const chartForRow = row => {
    const original = base.rows.find(value => value.symbol === row.symbol), stock = { ...original };
    delete stock.as_of_date;
    const chart = overlayFinancialChart({ symbol: row.symbol, as_of_date: originalDate,
      bars: [{ date: originalDate, open: 98, high: 101, low: 97, close: 100, volume: 123456 }],
      rs_line: [{ time: originalDate, value: 0.25 }], stock_data: stock,
      fundamentals: { symbol: row.symbol, market: 'US', current_price: 100, eps_growth_yy: 99 },
    }, source);
    chart.bars.push({ ...chart.bars[0], date: targetDate });
    chart.as_of_date = chart.stock_data.as_of_date = chart.fundamentals.as_of_date = targetDate;
    return JSON.parse(JSON.stringify(chart));
  };
  return { options, source, chartForRow };
}

it('carries observed chart scope from the containing market without acquiring price identity fields', () => {
  const { options, source, chartForRow } = inheritedChartCarryInputs(), carry = createFinancialGenerationCarry(options);
  expect(carry.ownership).toEqual({ BITU: 'retained', OWNED: 'retained' });
  for (const row of targetRows(options)) {
    const original = chartForRow(row);
    // Also cover nested aliases that inherit both market and date.
    delete original.fundamentals.market; delete original.fundamentals.as_of_date;
    const before = JSON.stringify(original), result = overlayFinancialChart(original, carry);
    expect(JSON.stringify(original)).toBe(before);
    expect(result).not.toHaveProperty('market');
    expect(result.fundamentals).not.toHaveProperty('market');
    expect(result.fundamentals).not.toHaveProperty('as_of_date');
    expect(result.bars).toEqual(original.bars); expect(result.rs_line).toEqual(original.rs_line);
    const contexts = [result.stock_data, result.fundamentals, ...(row.symbol === 'BITU' ? [result] : [])];
    for (const context of contexts) {
      const scope = { symbol: row.symbol, market: 'US', as_of_date: originalDate };
      expect(context.financial_identity.observed_scope).toEqual({ ...scope, as_of_date: targetDate });
      expect(context.financial_identity.prior_observed_scopes).toEqual([scope]);
      expect(context.financial_source_evidence).toEqual(source.symbols[row.symbol].financial_source_evidence);
      expect(context.financial_identity.observed_name).toBe(row.company_name);
      const replay = projected(carry, { ...context, symbol: row.symbol, market: 'US', as_of_date: targetDate });
      expect(replay.financial_identity).toEqual(context.financial_identity);
      if (row.symbol === 'BITU') {
        expect(context.instrument_applicability.status).toBe('not_applicable');
        expect(context.financial_current).toBeNull();
        expect(FINANCIAL_FIELDS.every(field => context[field] === null)).toBe(true);
        expect(context.financial_identity.observed_contexts.some(value => value.cusip || value.registry_identifiers)).toBe(false);
      } else {
        expect(context.financial_current.t).toBe(source.symbols[row.symbol].financial_current.t);
        expect(context.financial_current.p).toEqual(source.symbols[row.symbol].financial_current.p);
        expect(context.financial_current_state.fields.eps_growth_qq.source_validated).toBe(true);
      }
    }
    if (row.symbol === 'OWNED') expect(result).not.toHaveProperty('financial_identity');
    expect(overlayFinancialChart(JSON.parse(JSON.stringify(result)), carry)).toEqual(result);
    expect(carry.symbols[row.symbol].source_receipts).toEqual(source.symbols[row.symbol].source_receipts);
    expect(carry.symbols[row.symbol].financial_current).toEqual({ ...source.symbols[row.symbol].financial_current, a: targetDate });
    for (const key of ['stock_data', 'fundamentals']) expect(result[key].financial_historical).toEqual(original[key].financial_historical);
  }
});

it('never admits conflicting explicit or inherited chart identity through carry context', () => {
  const { options, chartForRow } = inheritedChartCarryInputs(), carry = createFinancialGenerationCarry(options);
  for (const row of targetRows(options)) {
    for (const location of ['root', 'stock_data', 'fundamentals']) for (const patch of [
      { symbol: 'OTHER' }, { market: 'JP' }, { market: null }, { as_of_date: originalDate }, { as_of_date: null },
    ]) {
      const chart = chartForRow(row);
      Object.assign(location === 'root' ? chart : chart[location], patch);
      if (row.symbol === 'OWNED' && location === 'root' && Object.hasOwn(patch, 'market')) {
        // A stock wrapper is not itself a financial row. Its conflicting
        // inherited market must still prevent admission for a marketless alias.
        delete chart.fundamentals.market;
        const result = overlayFinancialChart(chart, carry, row.symbol);
        expect(result.market).toBe(patch.market);
        expect(result.fundamentals.financial_identity.observed_scope.as_of_date).toBe(originalDate);
        expect(Object.values(result.fundamentals.financial_current_state.fields).some(field => field.source_validated)).toBe(false);
      } else expect(() => overlayFinancialChart(chart, carry, row.symbol)).toThrow('identity mismatch');
    }
    for (const patch of [{ symbol: 'OTHER' }, { market: 'JP' }, { as_of_date: '2000-01-01' }]) {
      const chart = chartForRow(row), badScope = { ...chart.fundamentals.financial_identity.observed_scope, ...patch };
      chart.fundamentals.financial_identity.observed_scope = badScope;
      const result = overlayFinancialChart(chart, carry).fundamentals;
      expect(result.financial_identity.observed_scope).toEqual(badScope);
      expect(result.financial_identity).not.toHaveProperty('prior_observed_scopes');
      expect(Object.values(result.financial_current_state.fields).some(field => field.source_validated)).toBe(false);
    }
  }
  const fund = targetRows(options).find(row => row.symbol === 'BITU'), chart = chartForRow(fund);
  chart.financial_identity.observed_name = 'Conflicting issuer';
  const result = overlayFinancialChart(chart, carry);
  expect(result.instrument_applicability.status).toBe('quarantined');
  expect(result.financial_identity.observed_contexts.some(value => value.observed_name === 'Conflicting issuer')).toBe(true);
  expect(overlayFinancialChart(JSON.parse(JSON.stringify(result)), carry)).toEqual(result);
  const unvalidated = JSON.parse(JSON.stringify(carry));
  expect(overlayFinancialChart(chartForRow(fund), unvalidated).financial_identity.observed_scope.as_of_date).toBe(originalDate);
  validateFinancialGenerationCarry(unvalidated);
  expect(overlayFinancialChart(chartForRow(fund), unvalidated).financial_identity.observed_scope.as_of_date).toBe(targetDate);
});

it('exports inherited fund and corporate chart aliases through strict carry verification', async () => {
  const { options, chartForRow } = inheritedChartCarryInputs();
  const { directory, root, carry } = await exportFixture(options, { chartForRow });
  try {
    const report = await verifyCarryCompatibility({ root, carry, evaluatedAt: buildTime + 1000 });
    expect(report.counts.charts).toBe(6);
    const manifest = await read(join(root, 'manifest.json')), index = decodeResearchIndex(await read(join(root, manifest.markets.US.assets.research.path)));
    for (const row of index.rows) for (const path of [`charts/${row.symbol}.json`, `raw/${row.symbol}.json`, row.chart_path]) {
      const chart = await read(join(root, path)), repeated = overlayFinancialChart(chart, carry);
      expect(chart.bars).toEqual(chartForRow(row).bars);
      for (const key of ['stock_data', 'fundamentals']) expect(repeated[key].financial_identity).toEqual(chart[key].financial_identity);
      expect(repeated.financial_identity).toEqual(chart.financial_identity);
      expect(overlayFinancialChart(JSON.parse(JSON.stringify(repeated)), carry)).toEqual(repeated);
    }
    const path = join(root, 'raw/BITU.json'), valid = await read(path);
    for (const mutate of [
      chart => { chart.financial_identity.observed_scope.as_of_date = originalDate; },
      chart => { chart.financial_identity.observed_name = 'Conflicting issuer'; },
    ]) {
      const corrupted = structuredClone(valid); mutate(corrupted); await write(path, corrupted);
      await expect(verifyCarryCompatibility({ root, carry, evaluatedAt: buildTime + 1000 })).rejects.toThrow();
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});


// These controller-target regressions use this file's existing synthetic source
// fixture and the selected local frontend modules. Actual approved-UI coverage
// is separately bound by the full-cohort diagnostic.
const carryReaderFrontend = resolve(dirname(fileURLToPath(import.meta.url)), '..');
async function carryReaderFixture(target) {
  const root = await mkdtemp(join(tmpdir(), 'carry-reader-'));
  const wire = encodeResearchIndex({ as_of_date: target.as_of_date, rows: target.rows });
  await write(join(root, 'static-data/manifest.json'), { markets: { US: { as_of_date: target.as_of_date,
    pages: { scan: { path: 'scan.json' } }, assets: { research: { path: 'research.json' } } } } });
  await write(join(root, 'static-data/scan.json'), { as_of_date: target.as_of_date, initial_rows: target.rows.slice(0, 2), chunks: [{ path: 'chunk.json' }] });
  await write(join(root, 'static-data/chunk.json'), { as_of_date: target.as_of_date, rows: target.rows });
  await write(join(root, 'static-data/research.json'), wire);
  await write(join(root, 'qualification-audit.json'), { version: 'ohlcv-v1', as_of_date: target.as_of_date, total: target.rows.length,
    results: target.rows.map(row => ({ symbol: row.symbol, audit: { version: 'ohlcv-v1', symbol: row.symbol, as_of_date: target.as_of_date } })) });
  const prepared = await readCarryTargetBase({ root, frontendRoot: carryReaderFrontend });
  return { root, wire, prepared };
}
function bindSyntheticSourceIdentity(options, properties) {
  const base = JSON.parse(options.sourceBase), source = JSON.parse(options.sourceProjection);
  Object.assign(base.rows.find(row => row.symbol === 'OWNED'), properties);
  options.sourceBase = JSON.stringify(base); options.sourceBaseSha256 = hash(options.sourceBase);
  source.bindings.target_base_sha256 = options.sourceBaseSha256;
  options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
  return options;
}
async function persistedCarry(root, options, target, name) {
  const carry = createFinancialGenerationCarry({ ...options, targetBase: target, targetBaseSha256: hash(target) });
  const path = join(root, name), raw = JSON.stringify(carry);
  await write(path, raw);
  return { carry, env: envFor(path, carry, raw) };
}

it('binds omitted historical CUSIP observations with the unchanged full-input carry loader', async () => {
  const options = bindSyntheticSourceIdentity(inputs(), { cusip: '123456782' });
  const target = JSON.parse(options.targetBase), owned = target.rows.find(row => row.symbol === 'OWNED');
  owned.financial_historical = { source_evidence: { identity: { cusip: '123456782' } }, unrelated_large_report: 'report '.repeat(4096) };
  const fixture = await carryReaderFixture(target);
  try {
    const compact = decodeResearchIndex(fixture.wire), compactBase = JSON.stringify({ market: 'US', as_of_date: target.as_of_date, rows: compact.rows });
    expect(instrumentIdentityEvidence(compact.rows.find(row => row.symbol === 'OWNED')).some(context => context.cusip)).toBe(false);
    const old = await persistedCarry(fixture.root, options, compactBase, 'compact-carry.json');
    await expect(loadFinancialGenerationCarry({ env: old.env, rows: fixture.prepared.rows, asOfDate: target.as_of_date })).rejects.toThrow('target issuer OWNED mismatch');
    const next = await persistedCarry(fixture.root, options, fixture.prepared.bytes, 'bounded-carry.json');
    const loaded = await loadFinancialGenerationCarry({ env: next.env, rows: fixture.prepared.rows, asOfDate: target.as_of_date });
    expect(loaded).toEqual(next.carry);
    expect(next.carry.ownership.OWNED).toBe('retained');
    const projected = JSON.parse(fixture.prepared.bytes).rows.find(row => row.symbol === 'OWNED');
    expect(projected.instrument_identity.observed_contexts).toEqual(instrumentIdentityEvidence(owned));
    expect(projected).not.toHaveProperty('financial_historical');
    expect(fixture.prepared.bytes.length).toBeLessThan(JSON.stringify({ market: 'US', as_of_date: target.as_of_date, rows: fixture.prepared.rows }).length);
    expect(next.carry.source_projection_json).toBe(options.sourceProjection);
    expect(next.carry.source_base_json).toBe(options.sourceBase);
    expect(next.carry.symbols.OWNED.financial_current.p).toEqual(JSON.parse(options.sourceProjection).symbols.OWNED.financial_current.p);
    expect(next.carry.symbols.OWNED.source_receipts).toEqual(JSON.parse(options.sourceProjection).symbols.OWNED.source_receipts);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('keeps conflicting observed identities unknown in the bounded controller target', async () => {
  for (const [label, evidence] of [
    ['CUSIP', { source_evidence: { identity: { cusip: 'CONFLICTING-CUSIP' } } }],
    ['name', { detail_identity: { company_name: 'Conflicting issuer' } }],
    ['type', { detail_identity: { quoteType: 'ETF' } }],
    ['market', { detail_identity: { market: 'JP' } }],
    ['symbol', { detail_identity: { symbol: 'DIFFERENT' } }],
  ]) {
    const options = bindSyntheticSourceIdentity(inputs(), { cusip: '123456782' });
    const target = JSON.parse(options.targetBase), owned = target.rows.find(row => row.symbol === 'OWNED');
    owned.financial_source_evidence = { identity: { cusip: '123456782' } };
    owned.financial_historical = evidence;
    const fixture = await carryReaderFixture(target);
    try {
      const next = await persistedCarry(fixture.root, options, fixture.prepared.bytes, 'conflict-carry.json');
      await expect(loadFinancialGenerationCarry({ env: next.env, rows: fixture.prepared.rows, asOfDate: target.as_of_date })).resolves.toEqual(next.carry);
      expect(next.carry.ownership.OWNED, label).toBe('identity_mismatch');
      expect(Object.values(next.carry.symbols.OWNED.financial_values).every(value => value === null), label).toBe(true);
      expect(next.carry.symbols.OWNED.source_receipts, label).toEqual([]);
      expect(next.carry.symbols.OWNED.financial_history.annual, label).toEqual([]);
      expect(next.carry.symbols.OWNED.financial_history.quarterly, label).toEqual([]);
    } finally { await rm(fixture.root, { recursive: true, force: true }); }
  }
});

it('preserves normalized name and CIK evidence without changing the observed text', async () => {
  const options = bindSyntheticSourceIdentity(inputs(), { cik: 123 });
  const target = JSON.parse(options.targetBase), owned = target.rows.find(row => row.symbol === 'OWNED');
  owned.company_name = ' ＯＷＮＥＤ   corporation ';
  owned.financial_historical = { detail_identity: { issuer_cik: '0000000123' } };
  const fixture = await carryReaderFixture(target);
  try {
    const next = await persistedCarry(fixture.root, options, fixture.prepared.bytes, 'normalized-carry.json');
    await expect(loadFinancialGenerationCarry({ env: next.env, rows: fixture.prepared.rows, asOfDate: target.as_of_date })).resolves.toEqual(next.carry);
    expect(next.carry.ownership.OWNED).toBe('retained');
    const evidence = JSON.parse(fixture.prepared.bytes).rows.find(row => row.symbol === 'OWNED').instrument_identity.observed_contexts;
    expect(evidence.some(context => context.company_name === owned.company_name)).toBe(true);
    expect(evidence.some(context => context.issuer_cik === '0000000123')).toBe(true);
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

it('rejects postbinding issuer, price and universe substitutions against the bounded target', async () => {
  const options = bindSyntheticSourceIdentity(inputs(), { cusip: '123456782' }), target = JSON.parse(options.targetBase);
  target.rows.find(row => row.symbol === 'OWNED').financial_historical = { detail_identity: { cusip: '123456782' } };
  const fixture = await carryReaderFixture(target);
  try {
    const next = await persistedCarry(fixture.root, options, fixture.prepared.bytes, 'bound-carry.json');
    for (const mutation of [
      row => ({ ...row, financial_historical: { detail_identity: { cusip: 'ALTERED-CUSIP' } } }),
      row => ({ ...row, company_name: 'Different issuer after binding' }),
      row => ({ ...row, current_price: row.current_price + 1 }),
      row => ({ ...row, adv_usd: row.adv_usd + 1 }),
      row => ({ ...row, market: 'JP' }),
      row => ({ ...row, as_of_date: '2026-10-04' }),
    ]) {
      const rows = fixture.prepared.rows.map(row => row.symbol === 'OWNED' ? mutation(row) : row);
      await expect(loadFinancialGenerationCarry({ env: next.env, rows, asOfDate: target.as_of_date })).rejects.toThrow(/Financial carry target/);
    }
    await expect(loadFinancialGenerationCarry({ env: next.env, rows: fixture.prepared.rows.slice(1), asOfDate: target.as_of_date })).rejects.toThrow('target universe');
    await expect(loadFinancialGenerationCarry({ env: next.env, rows: [...fixture.prepared.rows, fixture.prepared.rows[0]], asOfDate: target.as_of_date })).rejects.toThrow('target universe');
  } finally { await rm(fixture.root, { recursive: true, force: true }); }
});

// Execute the canonical-chart statements from the exact separately pinned
// publisher exporter fixture. The approved UI exporter remains unchanged;
// these regressions exercise the explicit publisher tooling amendment.
async function exportChartProjection(chart, { carry = null, correction = carry, symbol = chart.symbol ?? chart.stock_data?.symbol, now = buildTime, date = targetDate, market = 'US' } = {}) {
  const fixturePath = resolve(dirname(fileURLToPath(import.meta.url)), '../../.github/scripts/fixtures/publisher-export-research-oct6-carry-v1.mjs');
  const source = await readFile(fixturePath, 'utf8');
  expect(hash(source)).toBe('f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40');
  expect(Buffer.byteLength(source)).toBe(23247);
  const start = source.indexOf('    canonicalChart='), end = source.indexOf('    Object.assign(canonicalChart,', start);
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const run = new AsyncFunction('read', 'paths', 'symbol', 'correction', 'carry', 'evaluatedAt', 'scan', 'row', 'overlayFinancialChart', 'projectFinancialPayload',
    'let canonicalChart=null;\n' + source.slice(start, end) + '\nreturn canonicalChart;');
  return run(async () => structuredClone(chart), new Map([[symbol, 'fixture.json']]), symbol, correction, carry, now, { as_of_date: date }, { market }, overlayFinancialChart, projectFinancialPayload);
}

it('keeps carried stale-reporting-period reasons through the source-bound exporter and repeated serialization', async () => {
  const now = Date.parse('2026-10-08T12:00:00Z'), date = '2026-10-08', options = inputs({ now, date });
  const source = JSON.parse(options.sourceProjection), item = source.symbols.OWNED;
  const periodExpiry = Date.parse('2026-03-31') + 191 * day - 1;
  item.financial_values.eps_q2_yoy = 25;
  item.financial_current.r = item.financial_current.r.slice(0, 7) + '0' + item.financial_current.r.slice(8);
  item.financial_current.p['7'] = [25, '2', 'Diluted EPS', ['2026-03-31', '2025-12-31', '2025-09-30', '2025-06-30', '2025-03-31'], originalTime - 3600000, periodExpiry, 'g', 'r'];
  validateCorrectionProjection(source);
  options.sourceProjection = JSON.stringify(source); options.sourceProjectionSha256 = hash(options.sourceProjection);
  const carry = createFinancialGenerationCarry(options), target = targetRows(options).find(row => row.symbol === 'OWNED');
  const chart = { symbol: target.symbol, as_of_date: date, bars: [], stock_data: target,
    fundamentals: { current_price: 120, eps_q2_yoy: 999, eps_growth_qq: 999 } };
  const before = JSON.stringify(chart), once = overlayFinancialChart(chart, carry, target.symbol);
  const extra = projectFinancialPayload(once, { now, asOfDate: date, market: 'US' });
  expect(once.fundamentals.financial_current_state.fields.eps_q2_yoy).toMatchObject({ value: null, availability: 'unknown', reason: 'stale_reporting_period' });
  expect(extra.fundamentals.financial_current_state.fields.eps_q2_yoy.reason).toBe('missing_or_invalid_value');
  const exported = await exportChartProjection(chart, { carry, now, date });
  expect(exported).toEqual(once); expect(JSON.stringify(chart)).toBe(before);
  expect(await exportChartProjection(JSON.parse(JSON.stringify(exported)), { carry, now, date })).toEqual(exported);
  for (const context of [exported.stock_data, exported.fundamentals]) {
    expect(context.eps_q2_yoy).toBeNull();
    expect(context.financial_current_state.fields.eps_q2_yoy.reason).toBe('stale_reporting_period');
    expect(context.eps_growth_qq).toBe(30); expect(context.financial_current_state.fields.eps_growth_qq.source_validated).toBe(true);
    expect(context.financial_current.t).toBe(originalTime); expect(context.financial_current.p).toEqual(source.symbols.OWNED.financial_current.p);
  }
  for (const key of ['symbol', 'market', 'as_of_date']) expect(Object.hasOwn(exported.fundamentals, key)).toBe(false);
  expect(exported).not.toHaveProperty('market');
  expect(carry.symbols.OWNED.financial_values.eps_q2_yoy).toBe(25);
  expect(carry.symbols.OWNED.source_receipts).toEqual(source.symbols.OWNED.source_receipts);
});

it('keeps carried source-age expiry and current annual fields without renewing source clocks', async () => {
  const now = originalTime + 2 * day, date = '2026-10-06', options = inputs({ now, date, quarterAgeHours: 6 * 24 });
  const carry = createFinancialGenerationCarry(options), target = targetRows(options).find(row => row.symbol === 'OWNED');
  const chart = { symbol: target.symbol, as_of_date: date, bars: [], stock_data: target,
    fundamentals: { eps_growth_yy: 999, current_price: 120 } };
  const once = overlayFinancialChart(chart, carry), result = await exportChartProjection(chart, { carry, now, date });
  expect(result).toEqual(once);
  for (const context of [result.stock_data, result.fundamentals]) {
    expect(context.eps_growth_yy).toBeNull(); expect(context.financial_current_state.fields.eps_growth_yy.reason).toBe('stale_source');
    expect(context.eps_5yr_cagr).toBe(100); expect(context.financial_current_state.fields.eps_5yr_cagr.source_validated).toBe(true);
    expect(context.financial_current.t).toBe(originalTime); expect(context.financial_current.p['1'][4]).toBe(originalTime - 6 * day);
  }
  expect(await exportChartProjection(JSON.parse(JSON.stringify(result)), { carry, now, date })).toEqual(result);
});

it('preserves inherited and absent symbol ownership for carried unknown, unowned and reviewed-fund wrappers', async () => {
  const ordinaryOptions = inputs(), ordinaryCarry = createFinancialGenerationCarry(ordinaryOptions);
  for (const symbol of ['OWNED', 'NULL', 'NEW']) {
    const target = targetRows(ordinaryOptions).find(row => row.symbol === symbol);
    const chart = { as_of_date: targetDate, bars: [], stock_data: target, fundamentals: { eps_growth_yy: 999 } };
    const once = overlayFinancialChart(chart, ordinaryCarry, symbol), result = await exportChartProjection(chart, { carry: ordinaryCarry, symbol });
    expect(result).toEqual(once);
    expect(result).not.toHaveProperty('symbol'); expect(result).not.toHaveProperty('financial_current_state');
    for (const key of ['symbol', 'market', 'as_of_date']) expect(Object.hasOwn(result.fundamentals, key)).toBe(false);
    if (symbol === 'OWNED') expect(result.fundamentals.financial_current_state.fields.eps_growth_yy.source_validated).toBe(true);
    else expect(Object.values(result.fundamentals.financial_current_state.fields).some(field => field.source_validated)).toBe(false);
  }
  const { options, chartForRow } = inheritedChartCarryInputs(), carry = createFinancialGenerationCarry(options);
  const fund = targetRows(options).find(row => row.symbol === 'BITU'), chart = chartForRow(fund);
  delete chart.fundamentals.market; delete chart.fundamentals.as_of_date;
  const result = await exportChartProjection(chart, { carry }), once = overlayFinancialChart(chart, carry);
  expect(result).toEqual(once); expect(result).not.toHaveProperty('market');
  for (const context of [result, result.stock_data, result.fundamentals]) {
    expect(context.instrument_applicability.status).toBe('not_applicable');
    expect(context.financial_current).toBeNull(); expect(FINANCIAL_FIELDS.every(field => context[field] === null)).toBe(true);
  }
  expect(await exportChartProjection(JSON.parse(JSON.stringify(result)), { carry })).toEqual(result);
});

it('preserves the exact original non-carry projection for ordinary exports and corrections', async () => {
  const options = inputs(), correction = validateCorrectionProjection(JSON.parse(options.sourceProjection));
  const target = row('OWNED'), current = withFinancialProof({ ...target, eps_growth_qq: 30, eps_growth_yy: 40 }, originalTime, originalDate);
  const unknown = { symbol: 'OUTSIDE', market: 'US', as_of_date: originalDate, eps_growth_yy: 999 };
  const charts = [
    { symbol: 'OWNED', as_of_date: originalDate, bars: [], stock_data: current, fundamentals: { market: 'US', eps_growth_yy: 999 } },
    { as_of_date: originalDate, bars: [], stock_data: current, fundamentals: { eps_growth_yy: 999 } },
    { symbol: 'OUTSIDE', as_of_date: originalDate, bars: [], stock_data: unknown, fundamentals: { eps_growth_yy: 999 } },
  ];
  for (const chart of charts) for (const projection of [null, correction]) {
    const symbol = chart.symbol ?? chart.stock_data.symbol, before = JSON.stringify(chart);
    const expected = projectFinancialPayload(overlayFinancialChart(structuredClone(chart), projection, symbol), { now: originalTime, asOfDate: originalDate, market: 'US' });
    const result = await exportChartProjection(chart, { carry: null, correction: projection, symbol, now: originalTime, date: originalDate });
    expect(result).toEqual(expected); expect(JSON.stringify(result)).toBe(JSON.stringify(expected)); expect(JSON.stringify(chart)).toBe(before);
  }
});
