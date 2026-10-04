import { encodeResearchBytes, decodeResearchBytes } from './researchFloat64.js';

// Content-addressed paths use fixed-width lowercase hex strings. Preserve the
// exact bytes and restore the original text before any path validation.
export function encodeResearchHex(values) {
  if (!Array.isArray(values)) return null;
  const sample = values.find(value => value !== null);
  if (typeof sample !== 'string' || ![16, 64].includes(sample.length) ||
      values.some(value => value !== null && (typeof value !== 'string' || value.length !== sample.length || !/^[0-9a-f]+$/.test(value)))) return null;
  const width = sample.length / 2, bytes = new Uint8Array(values.length * width), nulls = new Uint8Array(Math.ceil(values.length / 8));
  values.forEach((value, index) => {
    if (value === null) nulls[index >> 3] |= 1 << (index & 7);
    else for (let byte = 0; byte < width; byte++) bytes[index * width + byte] = parseInt(value.slice(byte * 2, byte * 2 + 2), 16);
  });
  return { count: values.length, width, bytes: encodeResearchBytes(bytes), ...(values.includes(null) ? { nulls: encodeResearchBytes(nulls) } : {}) };
}

export function decodeResearchHex(value, maximumCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['count', 'width', 'bytes', 'nulls'].includes(key)) ||
      !Number.isSafeInteger(maximumCount) || maximumCount < 0 || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > maximumCount || ![8, 32].includes(value.width)) throw Error('Invalid hex vector');
  const bytes = decodeResearchBytes(value.bytes, value.count * value.width);
  const nulls = Object.hasOwn(value, 'nulls') ? decodeResearchBytes(value.nulls, Math.ceil(value.count / 8)) : null;
  if (nulls && value.count % 8 && nulls.at(-1) >> (value.count % 8)) throw Error('Invalid hex null mask');
  return Array.from({ length: value.count }, (_, index) => {
    const item = bytes.subarray(index * value.width, (index + 1) * value.width);
    if (nulls && (nulls[index >> 3] & (1 << (index & 7)))) {
      if (item.some(byte => byte !== 0)) throw Error('Invalid hex null bytes');
      return null;
    }
    return [...item].map(byte => byte.toString(16).padStart(2, '0')).join('');
  });
}
