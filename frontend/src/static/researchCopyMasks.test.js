import { describe, expect, it } from 'vitest';
import { decodeResearchIndex } from './researchTransport.js';
import { encodeResearchBytes } from './researchFloat64.js';
const mask = (count, ids) => {
  const bytes = new Uint8Array(Math.ceil(count / 8));
  for (const row of ids) bytes[row >> 3] |= 1 << (row & 7);
  return encodeResearchBytes(bytes);
};
const wire = (count, column, values = Array(count).fill(1)) => ({ schema: 'research-table-v2', column_encoding: 'sparse-record-arrays-and-copy-masks-v1', count,
  fields: [['source'], ['result']], columns: [{ values }, { copy: 0, patch: [], ...column }] });
const roundtrip = value => decodeResearchIndex(JSON.parse(JSON.stringify(value))).rows;

describe('exact copy patches with separate absence and null bitmaps', () => {
  it.each([0, 7, 8, 9])('preserves every row at byte boundary %i', count => {
    const ids = Array.from({ length: count }, (_, i) => i);
    expect(roundtrip(wire(count, { absent_bitmap: mask(count, ids) }))).toStrictEqual(ids.map(() => ({ source: 1 })));
    expect(roundtrip(wire(count, { null_bitmap: mask(count, ids) }))).toStrictEqual(ids.map(() => ({ source: 1, result: null })));
  });
  it('applies masks after exact factor/copy and preserves signed zeros through chained references', () => {
    const payload = wire(9, { factor: -1, absent_bitmap: mask(9, [2, 8]), null_bitmap: mask(9, [3]) }, [-0, 0, null, 4, false, 1, 2, 3, 4]);
    payload.negative_zeros = [[0, 0, []]];
    payload.fields.push(['chain']); payload.columns.push({ copy: 1, patch: [] });
    const rows = roundtrip(payload);
    expect(Object.is(rows[0].source, -0)).toBe(true);
    expect(Object.is(rows[0].result, 0)).toBe(true);
    expect(Object.is(rows[1].result, -0)).toBe(true);
    expect(Object.is(rows[1].chain, -0)).toBe(true);
    expect(rows[2]).toStrictEqual({ source: null });
    expect(rows[3]).toStrictEqual({ source: 4, result: null, chain: null });
    expect(rows[4]).toStrictEqual({ source: false, result: false, chain: false });
  });
  it.each([
    { absent_bitmap: 'AA==' }, // Too short for nine rows.
    { absent_bitmap: 'AAA' }, // Non-canonical base64.
    { absent_bitmap: mask(16, [9]) }, // Nonzero tail padding.
    { absent_bitmap: mask(9, [0]), null_bitmap: mask(9, [0]) },
    { absent_bitmap: mask(9, [0]), patch: [[0, 1]] },
    { null_bitmap: mask(9, [0]), patch: [[0]] },
    { absent_bitmap: mask(9, [0]), patch: [[1, 2], [1, 3]] },
    { absent_bitmap: mask(9, [0]), patch: [[9, 2]] },
    { absent_bitmap: mask(9, [0]), values: Array(9).fill(1) },
    { absent_bitmap: mask(9, [0]), factor: 2 },
    { absent_bitmap: mask(9, [0]), unknown: true },
    { absent_bitmap: mask(9, [0]), patch: Array(1) },
  ])('rejects ambiguous, overlapping, padded or incomplete masks', column => {
    expect(() => decodeResearchIndex(wire(9, column))).toThrow();
  });
  it.each(['sparse-binary-and-signed-zero-v1', 'sparse-float64-and-signed-zero-v1', 'present-values-and-missing-runs-v1', undefined])('rejects masks in an older marker %s', column_encoding => {
    const payload = wire(9, { absent_bitmap: mask(9, [0]) }); payload.column_encoding = column_encoding;
    expect(() => decodeResearchIndex(payload)).toThrow();
    payload.schema = 'research-table-v1'; expect(() => decodeResearchIndex(payload)).toThrow();
  });
  it.each(['absent_bitmap', 'null_bitmap'])('rejects a signed zero that targets %s', kind => {
    const payload = wire(9, { [kind]: mask(9, [0]) }); payload.negative_zeros = [[0, 1, []]];
    expect(() => decodeResearchIndex(payload)).toThrow();
  });
});
