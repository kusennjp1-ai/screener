// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { expect, it } from 'vitest';
import { readBookFinancials } from './book-financials-input.mjs';

it('reads the gzip SEC input first and still reads a legacy raw file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'book-financials-input-'));
  try {
    expect(await readBookFinancials(root)).toBeNull();
    await writeFile(join(root, 'book-financials.json'), JSON.stringify({ as_of_date: '2026-10-01', results: {} }));
    expect((await readBookFinancials(root)).as_of_date).toBe('2026-10-01');
    await writeFile(join(root, 'book-financials.json.gz'), gzipSync(JSON.stringify({ as_of_date: '2026-10-02', results: { A: { symbol: 'A' } } })));
    expect(await readBookFinancials(root)).toEqual({ as_of_date: '2026-10-02', results: { A: { symbol: 'A' } } });
    await writeFile(join(root, 'book-financials.json.gz'), 'not gzip');
    await expect(readBookFinancials(root)).rejects.toThrow();
  } finally { await rm(root, { recursive: true, force: true }); }
});
