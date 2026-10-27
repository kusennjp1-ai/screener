import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeResearchRecordArrays } from './researchRecordArrays.js';
import { encodeResearchIndex, decodeResearchIndex } from './researchTransport.js';
const bytes = value => gzipSync(JSON.stringify(value)).length;
const vector = values => encodeResearchRecordArrays(values, bytes);
const wire = column => ({ schema: 'research-table-v2', column_encoding: 'sparse-record-arrays-and-copy-masks-v1', count: 3, fields: [['a']], columns: [column] });

describe('versioned record-array research transport', () => {
  it.each(['values', 'pool', 'present'])('restores mixed-record signed zeros through %s, then dependent copy/factor', form => {
    const values = [[{ eps: -0, status: false }], [{ eps: 0 }], [{ eps: false }]];
    const source = form === 'values' ? { arrays_values: vector(values) }
      : form === 'pool' ? { arrays_pool: vector(values), refs: [0, 1, 2] }
        : { arrays_present: vector([values[0], values[2]]), missing: [[1, 2]] };
    const payload = wire(source);
    payload.fields.push(['copy']); payload.columns.push({ copy: 0, factor: -1, patch: [] });
    payload.negative_zeros = [[0, 0, [0, 'eps']]];
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(payload))).rows;
    expect(decoded).toStrictEqual(values.map((a, index) => form === 'present' && index === 1 ? {} : { a, copy: a }));
    expect(Object.is(decoded[0].a[0].eps, -0)).toBe(true);
    if (form !== 'present') expect(Object.is(decoded[1].a[0].eps, 0)).toBe(true);
  });
  it('encoder retains the old marker without array columns and declares the new marker only on use', () => {
    expect(encodeResearchIndex({ rows: [{ symbol: 'A' }] }, undefined, { columnBytes: bytes }).column_encoding).toBe('sparse-binary-and-signed-zero-v1');
    const rows = Array.from({ length: 100 }, (_, i) => ({ symbol: `S${i}`, data: [{ value: i, label: 'same' }] }));
    const encoded = encodeResearchIndex({ rows }, undefined, { columnBytes: bytes });
    expect(encoded.column_encoding).toBe('sparse-record-arrays-and-copy-masks-v1');
    expect(decodeResearchIndex(JSON.parse(JSON.stringify(encoded))).rows).toStrictEqual(rows);
  });
  it.each(['sparse-binary-and-signed-zero-v1', 'sparse-float64-and-signed-zero-v1', 'present-values-and-missing-runs-v1', undefined])('rejects arrays disguised as old encoding %s', encoding => {
    const payload = wire({ arrays_values: vector([[], [], []]) });
    payload.column_encoding = encoding;
    expect(() => decodeResearchIndex(payload)).toThrow();
    payload.schema = 'research-table-v1';
    expect(() => decodeResearchIndex(payload)).toThrow();
  });
  it.each([
    { arrays_values: vector([[], [], []]), values: [[], [], []] },
    { arrays_values: vector([[], [], []]), f64_values: { count: 0, bytes: '' } },
    { arrays_pool: vector([[]]), refs: [0, 0, 1] },
    { arrays_present: vector([[]]), missing: [[0, 2], [1, 3]] },
    { arrays_present: vector([[]]), missing: [] },
    { arrays_values: vector([[], []]) },
  ])('rejects mixed, incomplete or out-of-range forms', column => {
    expect(() => decodeResearchIndex(wire(column))).toThrow();
  });
});
