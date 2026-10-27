import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { encodeResearchRecordArrays, decodeResearchRecordArrays } from './researchRecordArrays.js';
const bytes = value => gzipSync(JSON.stringify(value)).length;
const decode = value => decodeResearchRecordArrays(value, 100);
const valid = () => ({ count: 2, lengths: [1, 0], fields: ['eps'], columns: [{ values: [1] }] });

describe('bounded lossless arrays of scalar records', () => {
  it('preserves outer null, empty arrays, empty records, missing cells and exact scalar types', () => {
    const input = [null, [], [{}], [{ end: '2025-12-31', eps: 24.999999999999996 }, { eps: null }, { eps: false }, { eps: 0 }, { end: '' }]];
    const wire = encodeResearchRecordArrays(input, bytes);
    expect(decode(JSON.parse(JSON.stringify(wire)))).toStrictEqual(input);
  });
  it.each([
    [[['array-shaped']]], [[{ nested: {} }]], [[{ eps: NaN }]], [[{ eps: Infinity }]],
    [[{ eps: undefined }]], [[Object.create({ eps: 1 })]], [[JSON.parse('{"__proto__":1}')]],
  ])('falls back for non-scalar or non-plain records: %j', value => {
    expect(encodeResearchRecordArrays(value, bytes)).toBeNull();
  });
  it('rejects holes, inherited slots and extra properties without converting them to valid records', () => {
    const holes = Array(1), inherited = Array(1);
    Object.setPrototypeOf(inherited, Object.assign(Object.create(Array.prototype), { 0: { eps: 1 } }));
    for (const value of [holes, inherited, Object.assign([{ eps: 1 }], { extra: true })]) expect(encodeResearchRecordArrays([value], bytes)).toBeNull();
    expect(encodeResearchRecordArrays(Array(1), bytes)).toBeNull();
  });
  it.each([
    value => { value.count = 101; },
    value => { value.lengths = [257, 0]; },
    value => { value.lengths = [1e12, 0]; },
    value => { value.fields = ['eps', 'eps']; value.columns.push({ values: [2] }); },
    value => { value.fields = ['constructor']; },
    value => { value.columns = [{ values: [] }]; },
    value => { value.columns = [{ values: [1, 2] }]; },
    value => { value.columns = [{ pool: [1], refs: [1] }]; },
    value => { value.columns = [{ pool: [1], refs: [-2] }]; },
    value => { value.columns = [{ pool: [1], refs: [0], values: [1] }]; },
    value => { value.columns = [{ values: Array(1) }]; },
    value => { value.columns = [{ pool: Array(1), refs: [0] }]; },
    value => { value.columns = [{ pool: [1], refs: Array(1) }]; },
    value => { value.fields = Array(1); },
    value => { value.columns = Array(1); },
    value => { value.lengths = Array(2); },
    value => { value.unknown = true; },
  ])('rejects malformed vectors before reconstruction', mutate => {
    const wire = valid(); mutate(wire); expect(() => decode(wire)).toThrow();
  });
});
