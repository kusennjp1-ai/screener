// Lossless numeric transport: group the eight little-endian IEEE-754 bytes
// by position so repeated exponent bytes compress without rounding values.
const base64 = bytes => {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) text += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(text);
};
const bytesFromBase64 = (text, expected) => {
  if (typeof text !== 'string' || text.length !== 4 * Math.ceil(expected / 3) || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) throw Error('Invalid Float64 encoding');
  const binary = atob(text);
  if (binary.length !== expected || btoa(binary) !== text) throw Error('Invalid Float64 byte count');
  return Uint8Array.from(binary, character => character.charCodeAt(0));
};
export { base64 as encodeResearchBytes, bytesFromBase64 as decodeResearchBytes };

export function encodeResearchFloat64(values) {
  if (!Array.isArray(values) || values.some(value => value !== null && (typeof value !== 'number' || !Number.isFinite(value)))) return null;
  const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
  const shuffled = new Uint8Array(bytes.length), nulls = new Uint8Array(Math.ceil(values.length / 8));
  values.forEach((value, index) => {
    if (value === null) nulls[index >> 3] |= 1 << (index & 7);
    else view.setFloat64(index * 8, value, true);
  });
  for (let byte = 0; byte < 8; byte++) for (let index = 0; index < values.length; index++) shuffled[byte * values.length + index] = bytes[index * 8 + byte];
  return { count: values.length, bytes: base64(shuffled), ...(values.includes(null) ? { nulls: base64(nulls) } : {}) };
}

export function decodeResearchFloat64(value, maximumCount) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['count', 'bytes', 'nulls'].includes(key)) ||
      !Number.isSafeInteger(maximumCount) || maximumCount < 0 || !Number.isSafeInteger(value.count) || value.count < 0 || value.count > maximumCount) throw Error('Invalid Float64 vector');
  const encoded = bytesFromBase64(value.bytes, value.count * 8);
  const nulls = Object.hasOwn(value, 'nulls') ? bytesFromBase64(value.nulls, Math.ceil(value.count / 8)) : null;
  if (nulls && value.count % 8 && nulls.at(-1) >> (value.count % 8)) throw Error('Invalid Float64 null mask');
  const bytes = new Uint8Array(encoded.length), view = new DataView(bytes.buffer);
  for (let byte = 0; byte < 8; byte++) for (let index = 0; index < value.count; index++) bytes[index * 8 + byte] = encoded[byte * value.count + index];
  return Array.from({ length: value.count }, (_, index) => {
    if (nulls && (nulls[index >> 3] & (1 << (index & 7)))) {
      if (view.getUint32(index * 8, true) || view.getUint32(index * 8 + 4, true)) throw Error('Invalid Float64 null bytes');
      return null;
    }
    const number = view.getFloat64(index * 8, true);
    if (!Number.isFinite(number)) throw Error('Invalid Float64 number');
    return number;
  });
}
