import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { prepareStatementCohort, researchPath } from './prepare-statement-cohort.mjs';
import { encodeResearchIndex } from '../../frontend/src/static/researchTransport.js';

const now = '2026-10-04T11:00:00.000Z', date = '2026-10-02';
const row = (symbol, price = 10, adv = 20000000) => ({ symbol, market: 'US', current_price: price, adv_usd: adv });
function inputs(rows, overrides = {}, wire = false) {
  let index = { as_of_date: date, rows };
  if (wire) index = encodeResearchIndex(index, {});
  const bytes = Buffer.from(JSON.stringify(index));
  const hash = createHash('sha256').update(bytes).digest('hex');
  return [Buffer.from(JSON.stringify({ schema_version: 'static-site-v2', as_of_date: date,
    generated_at: '2026-10-04T04:49:09Z', markets: { US: { as_of_date: date,
      assets: { research: { path: `research-index-${hash.slice(0, 16)}.json` } } } }, ...overrides })), bytes];
}

test('existing liquidity boundaries select the whole eligible cohort without a financial precondition', () => {
  const result = prepareStatementCohort(...inputs([row('AMD'), row('VIRT'), row('LOW', 9.99), row('THIN', 10, 19999999)]), now);
  assert.deepEqual(result.cohort.symbols.sort(), ['AMD', 'VIRT']);
  assert.equal(result.base.universe_size, 4);
  assert.equal(result.base.eligible_size, 2);
  assert.equal(result.base.as_of_date, date);
  assert.equal(result.base.source.observed_at, now);
  assert.equal(result.cohort.base_artifact_sha256, createHash('sha256').update(result.baseBytes).digest('hex'));
  assert.equal(result.base.rows.length, 4);
});

test('lossless column transport produces the same eligibility as plain research input', () => {
  const rows = [row('AMD'), row('BRK-B'), row('LOW', 9)];
  assert.deepEqual(prepareStatementCohort(...inputs(rows, {}, true), now).cohort.symbols,
    prepareStatementCohort(...inputs(rows), now).cohort.symbols);
});

test('a named-content mismatch stops before any source acquisition plan', () => {
  const [manifest, bytes] = inputs([row('AMD')]);
  assert.throws(() => prepareStatementCohort(manifest, Buffer.concat([bytes, Buffer.from(' ')]), now), /hash mismatch/);
});

test('snapshot dates, future dates and missing clocks fail closed', () => {
  assert.throws(() => prepareStatementCohort(...inputs([row('AMD')], { as_of_date: '2026-10-01' }), now), /dates disagree/);
  assert.throws(() => prepareStatementCohort(...inputs([row('AMD')]), '2026-10-01T11:00:00Z'), /dates disagree/);
  assert.throws(() => prepareStatementCohort(...inputs([row('AMD')]), null), /UTC/);
});

test('duplicates, foreign identities, path traversal and empty eligibility are rejected', () => {
  for (const rows of [[row('AMD'), row('AMD')], [{ ...row('AMD'), market: 'HK' }], [row('../AMD')], []]) {
    assert.throws(() => prepareStatementCohort(...inputs(rows), now), /identity|universe/);
  }
  assert.throws(() => prepareStatementCohort(...inputs([row('LOW', 9)]), now), /No liquid/);
  assert.throws(() => researchPath({ schema_version: 'static-site-v2', markets: { US: { assets: { research: { path: '../source.json' } } } } }), /Unbound/);
});

test('unknown/nonfinite financial and price values never become zero or qualification evidence', () => {
  const result = prepareStatementCohort(...inputs([{ ...row('AMD'), eps_growth_yy: null }, row('NONE', null), row('NULL', 10, null)]), now);
  assert.deepEqual(result.cohort.symbols, ['AMD']);
  assert.equal(result.base.rows.find(item => item.symbol === 'NONE').current_price, null);
  assert.equal(Object.hasOwn(result.base.rows[0], 'eps_growth_yy'), false);
});
