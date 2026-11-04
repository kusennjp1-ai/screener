// The SEC companyfacts input written by tools/sec-financials.py. Current runs write
// book-financials.json.gz; a bundle produced before that change still holds the
// raw book-financials.json, which remains readable (the .gz file wins when both exist).
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';

export const BOOK_FINANCIALS_FILES = Object.freeze(['book-financials.json.gz', 'book-financials.json']);
const MAX_DECODED_BYTES = 256 * 1024 * 1024;

export async function readBookFinancials(root) {
  for (const name of BOOK_FINANCIALS_FILES) {
    let bytes;
    try { bytes = await readFile(resolve(root, name)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    const text = name.endsWith('.gz') ? gunzipSync(bytes, { maxOutputLength: MAX_DECODED_BYTES }) : bytes;
    return JSON.parse(text.toString('utf8'));
  }
  return null;
}
