import { describe, expect, it } from 'vitest';
import { encodeResearchFloat64, decodeResearchFloat64 } from './researchFloat64';
import { encodeResearchIndex, decodeResearchIndex, RESEARCH_TRANSPORT_VERSION } from './researchTransport';

const values = [0, -0, Number.MIN_VALUE, -Number.MIN_VALUE, Number.MAX_VALUE, -Number.MAX_VALUE,
  Number.EPSILON, 24.999999999999996, 25, 25.000000000000004, Number.MAX_SAFE_INTEGER, null];
const wire = column => ({ schema: RESEARCH_TRANSPORT_VERSION, column_encoding: 'sparse-float64-and-signed-zero-v1', as_of_date: '2026-10-02', count: 4, fields: [['value']], columns: [column] });

describe('bit-exact Float64 research columns', () => {
  it('retains signed zero, subnormals, extremes, threshold neighbors and nulls', () => {
    const input = Object.freeze(values);
    const encoded = JSON.parse(JSON.stringify(encodeResearchFloat64(input)));
    const decoded = decodeResearchFloat64(encoded, input.length);
    decoded.forEach((value, index) => expect(Object.is(value, input[index])).toBe(true));
    expect(decodeResearchFloat64(encodeResearchFloat64([]), 0)).toEqual([]);
  });
  it('keeps missing cells distinct from null and signed zero through the real encoder', () => {
    const rows = Array.from({ length: 160 }, (_, index) => ({ symbol: `S${index}`, ...(index % 17 ? { value: values[index % values.length] } : {}) }));
    const encoded = encodeResearchIndex({ as_of_date: '2026-10-02', rows }, undefined, { columnBytes: column => Object.keys(column).some(key => key.startsWith('f64_')) ? 0 : 1 });
    expect(encoded.columns.some(column => Object.keys(column).some(key => key.startsWith('f64_')))).toBe(true);
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encoded))).rows;
    expect(decoded).toEqual(rows);
    rows.forEach((row, index) => {
      expect(Object.hasOwn(decoded[index], 'value')).toBe(Object.hasOwn(row, 'value'));
      expect(Object.is(decoded[index].value, row.value)).toBe(true);
    });
  });
  it('decodes binary dictionaries and bounded sparse vectors, preserving references', () => {
    const dictionary = wire({ f64_pool: encodeResearchFloat64([0, null, -0]), refs: [0, 1, 2, -1] });
    const decoded = decodeResearchIndex(dictionary).rows;
    expect(decoded).toEqual([{ value: 0 }, { value: null }, { value: -0 }, {}]);
    const sparse = wire({ f64_present: encodeResearchFloat64([0, null, -0]), missing: [[3, 4]] });
    expect(decodeResearchIndex(sparse).rows).toEqual(decoded);
    const dense = wire({ f64_values: encodeResearchFloat64([0, null, -0, Number.MIN_VALUE]) });
    expect(decodeResearchIndex(dense).rows.at(-1).value).toBe(Number.MIN_VALUE);
    expect(() => decodeResearchIndex({ ...dense, column_encoding: 'present-values-and-missing-runs-v1' })).toThrow();
    expect(() => decodeResearchIndex(wire({ ...dense.columns[0], values: [0, null, 0, 0] }))).toThrow();
    expect(() => decodeResearchIndex(wire({ f64_pool: encodeResearchFloat64([0]), refs: [0, 1, 0, 0] }))).toThrow();
  });
  it('preserves signs in mixed columns and retained arrays without mutating shared dictionary cells', () => {
    const rows = [{ symbol: 'A', value: -0, annual_eps_growth_3y: [-0, 25, 30], financial_history: { annual: [{ end: '2025-12-31', eps: -0 }] } },
      { symbol: 'B', value: false, annual_eps_growth_3y: [0, 25, 30], financial_history: { annual: [{ end: '2025-12-31', eps: 0 }] } }];
    const encoded = encodeResearchIndex({ as_of_date: '2026-10-02', rows });
    expect(decodeResearchIndex(encoded).rows).toEqual(rows);
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encoded))).rows;
    expect(decoded).toEqual(rows);
    expect(Object.is(decoded[0].value, -0)).toBe(true);
    expect(Object.is(decoded[0].annual_eps_growth_3y[0], -0)).toBe(true);
    expect(Object.is(decoded[1].annual_eps_growth_3y[0], 0)).toBe(true);
    expect(Object.is(decoded[0].financial_history.annual[0].eps, -0)).toBe(true);
    expect(Object.is(decoded[1].financial_history.annual[0].eps, 0)).toBe(true);
  });
  it('restores signed zeros before a dependent inverse column reads them', () => {
    const rows = Array.from({ length: 80 }, (_, index) => {
      const value = index ? index + .123456789 : -0;
      return { symbol: `S${index}`, value, inverse: -value };
    });
    const encoded = encodeResearchIndex({ as_of_date: '2026-10-02', rows });
    expect(encoded.columns.some(column => column.factor === -1)).toBe(true);
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encoded))).rows;
    expect(decoded).toEqual(rows);
    expect(Object.is(decoded[0].inverse, 0)).toBe(true);
  });
  it.each([
    [[4, 0, []]], [[0, 1, []]], [[-1, 0, []]], [[0.5, 0, []]], [[0, 0, []], [0, 0, []]],
    [[0, 0]], [[0, 0, ['__proto__']]], [[0, 0, ['absent']]], [[0, 0, null]],
  ])('rejects malformed signed-zero locations: %j', negativeZeros => {
    expect(() => decodeResearchIndex({ ...wire({ values: [0, 0, 0, 0] }), negative_zeros: negativeZeros })).toThrow();
  });
  it('rejects signed-zero metadata for nonzero cells and undeclared capabilities', () => {
    expect(() => decodeResearchIndex({ ...wire({ values: [1, 0, 0, 0] }), negative_zeros: [[0, 0, []]] })).toThrow('signed-zero');
    expect(() => decodeResearchIndex({ ...wire({ values: [0, 0, 0, 0] }), column_encoding: 'present-values-and-missing-runs-v1', negative_zeros: [[0, 0, []]] })).toThrow('signed-zero');
  });
  it.each([NaN, Infinity, -Infinity, false, '0', undefined, {}])('does not encode unsupported numeric input %j', value => {
    expect(encodeResearchFloat64([value])).toBeNull();
  });
  it.each([
    value => ({ ...value, count: -1 }),
    value => ({ ...value, count: 1.5 }),
    value => ({ ...value, count: 5 }),
    value => ({ ...value, bytes: value.bytes.slice(4) }),
    value => ({ ...value, bytes: `!${value.bytes.slice(1)}` }),
    value => ({ ...value, nulls: '/w==' }),
    value => ({ ...value, nulls: '' }),
    value => ({ ...value, unknown: true }),
  ])('rejects malformed lengths, base64, masks and extra metadata', mutate => {
    expect(() => decodeResearchFloat64(mutate(encodeResearchFloat64([null, 1, 2])), 3)).toThrow();
  });
  it('rejects noncanonical padding, nonfinite bytes and concealed null values', () => {
    expect(() => decodeResearchFloat64({ count: 1, bytes: 'AAAAAAAAAAB=' }, 1)).toThrow();
    for (const value of [Infinity, -Infinity, NaN]) {
      const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
      expect(() => decodeResearchFloat64({ count: 1, bytes: btoa(String.fromCharCode(...bytes)) }, 1)).toThrow('number');
    }
    const value = encodeResearchFloat64([1]); value.nulls = 'AQ==';
    expect(() => decodeResearchFloat64(value, 1)).toThrow('null bytes');
  });
});
