import { describe, expect, it } from 'vitest';
import { encodeResearchHex, decodeResearchHex } from './researchHex';
import { encodeResearchIndex, decodeResearchIndex, RESEARCH_TRANSPORT_VERSION } from './researchTransport';

describe('exact binary hash columns', () => {
  it.each([16, 64])('preserves all %s hex digits, leading zeros and explicit nulls', length => {
    const values = ['0'.repeat(length), 'f'.repeat(length), '0123456789abcdef'.repeat(length / 16), null];
    const encoded = JSON.parse(JSON.stringify(encodeResearchHex(Object.freeze(values))));
    expect(decodeResearchHex(encoded, values.length)).toEqual(values);
  });
  it('restores exact list/detail paths after packing their complete hashes', () => {
    const rows = Array.from({ length: 200 }, (_, index) => {
      const symbol = index ? `S${index}` : 'BRK/B';
      const hash = (BigInt(index) * 0x9e3779b97f4a7c15n & 0xffffffffffffffffn).toString(16).padStart(16, '0');
      return { symbol, ...(index === 2 ? {} : { chart_path: index === 1 ? null : `verified-charts/${encodeURIComponent(symbol)}-${hash}.json` }),
        research_detail_path: `research-details/${encodeURIComponent(symbol)}-${[...hash].reverse().join('')}.json` };
    });
    const encoded = encodeResearchIndex({ as_of_date: '2026-10-02', rows }, undefined, { columnBytes: column => Object.keys(column).some(key => key.startsWith('hex_')) ? 0 : 1 });
    expect(encoded.column_encoding).toBe('sparse-binary-and-signed-zero-v1');
    expect(encoded.columns.some(column => Object.keys(column).some(key => key.startsWith('hex_')))).toBe(true);
    expect(decodeResearchIndex(JSON.parse(JSON.stringify(encoded))).rows).toEqual(rows);
    expect(() => decodeResearchIndex({ ...encoded, column_encoding: 'sparse-float64-and-signed-zero-v1' })).toThrow();
    expect(() => decodeResearchIndex({ ...encoded, column_encoding: 'unknown' })).toThrow();
  });
  it('retains old v1 path reconstruction and signed-zero-capable Float64 formats', () => {
    const legacy = { schema: 'research-table-v1', count: 2, fields: [['symbol'], ['chart_path']],
      columns: [{ values: ['A', 'B'] }, { values: ['000000000000000f', null] }], paths: { chart_path: 'verified-charts' } };
    expect(decodeResearchIndex(legacy).rows).toEqual([{ symbol: 'A', chart_path: 'verified-charts/A-000000000000000f.json' }, { symbol: 'B', chart_path: null }]);
    const newer = encodeResearchIndex({ rows: [{ symbol: 'A', value: -0 }] });
    expect(Object.is(decodeResearchIndex({ ...newer, column_encoding: 'sparse-float64-and-signed-zero-v1' }).rows[0].value, -0)).toBe(true);
  });
  it.each([[], [null], ['ABCDEF0123456789'], ['000000000000000g'], ['0'.repeat(15)], ['0'.repeat(16), '0'.repeat(64)], [false], [0], [undefined]])('does not reinterpret unsupported text %j', values => {
    expect(encodeResearchHex(values)).toBeNull();
  });
  it.each([
    value => ({ ...value, width: 0 }), value => ({ ...value, width: 16 }), value => ({ ...value, width: 33 }),
    value => ({ ...value, count: -1 }), value => ({ ...value, count: 1.5 }), value => ({ ...value, count: 3 }),
    value => ({ ...value, bytes: value.bytes.slice(4) }), value => ({ ...value, bytes: `!${value.bytes.slice(1)}` }),
    value => ({ ...value, nulls: '/w==' }), value => ({ ...value, nulls: '' }), value => ({ ...value, extra: true }),
  ])('rejects unsupported widths, counts, byte strings and masks', mutate => {
    expect(() => decodeResearchHex(mutate(encodeResearchHex(['0000000000000000', null])), 2)).toThrow();
  });
  it('rejects concealed null bytes, mixed representations and mismatched row counts', () => {
    const vector = encodeResearchHex(['ffffffffffffffff']);
    expect(() => decodeResearchHex({ ...vector, nulls: 'AQ==' }, 1)).toThrow('null bytes');
    const wire = { schema: RESEARCH_TRANSPORT_VERSION, column_encoding: 'sparse-binary-and-signed-zero-v1', count: 1, fields: [['value']], columns: [{ hex_values: vector }] };
    expect(() => decodeResearchIndex({ ...wire, count: 2 })).toThrow();
    expect(() => decodeResearchIndex({ ...wire, columns: [{ hex_values: vector, values: ['ffffffffffffffff'] }] })).toThrow();
    expect(() => decodeResearchIndex({ ...wire, columns: [{ hex_pool: vector, refs: [1] }] })).toThrow();
  });
});
