import { test } from 'node:test';
import assert from 'node:assert/strict';
import { institutionalGrowth } from '../src/static/institutionalEvidence.js';
import { holderEvidence, holderSymbol, holderAsOf, invalidHolderCases, holderArguments, holderPeriodPair, validHolderQuarterPairs } from './fixtures/institutional-history.mjs';

for (const entry of invalidHolderCases()) test(`reject without zero or pass: ${entry.name}`, () => {
  assert.deepEqual(institutionalGrowth(...holderArguments(entry)), {
    increasing: null, delta: null, reason: '比較可能な保有機関数の履歴が未取得',
  });
});
for (const [count, increasing, delta] of [[110, true, 10], [100, false, 0], [90, false, -10]]) test(`valid count ${count} retains measured delta ${delta}`, () => {
  const data = holderEvidence(); data.observations[1].manager_count = count;
  const original = structuredClone(data);
  assert.deepEqual(institutionalGrowth(data, holderSymbol, holderAsOf), {
    increasing, delta, reason: `13F報告運用会社 100 → ${count}社 / 公表集計期限 2026-08-31。ファンド数ではありません。`,
  });
  assert.deepEqual(data, original);
});
test('rejection neither sorts nor removes observations from the caller input', () => {
  const data = holderEvidence(); data.observations.reverse();
  const original = structuredClone(data);
  institutionalGrowth(data, holderSymbol, holderAsOf);
  assert.deepEqual(data, original);
  data.observations[0] = null;
  const malformed = structuredClone(data);
  institutionalGrowth(data, holderSymbol, holderAsOf);
  assert.deepEqual(data, malformed);
});
test('exact safe integer counts remain usable at the representation boundary', () => {
  const data = holderEvidence();
  data.observations[0].manager_count = Number.MAX_SAFE_INTEGER - 1;
  data.observations[1].manager_count = Number.MAX_SAFE_INTEGER;
  assert.equal(institutionalGrowth(data, holderSymbol, holderAsOf).delta, 1);
});
for (const [previous, current] of validHolderQuarterPairs) for (const count of [110, 100, 90]) test(`adjacent calendar quarters ${previous}/${current}, count ${count}`, () => {
  const { data, asOf } = holderPeriodPair(previous, current);
  data.observations[1].manager_count = count;
  const result = institutionalGrowth(data, holderSymbol, asOf);
  assert.equal(result.delta, count - 100);
  assert.equal(result.increasing, count > 100);
});
