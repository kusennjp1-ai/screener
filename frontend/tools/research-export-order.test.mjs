// @vitest-environment node
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { orderResearchExportRows } from './research-export-order.mjs';
import { AUDIT_VERSION } from '../src/static/qualificationAudit.js';

const date = '2026-10-02';
const anchor = (symbols, asOfDate = date) => ({
  version: AUDIT_VERSION, as_of_date: asOfDate, total: symbols.length,
  results: symbols.map(symbol => ({ symbol, audit: { symbol, version: AUDIT_VERSION, as_of_date: asOfDate } })),
});
async function withAnchor(value, run) {
  const directory = await mkdtemp(join(tmpdir(), 'research-export-anchor-'));
  const path = join(directory, 'qualification-audit.json');
  try {
    if (value !== undefined) await writeFile(path, JSON.stringify(value));
    await run(path);
  } finally { await rm(directory, { recursive: true, force: true }); }
}

it('keeps fresh row references and an exact unique universe through removals and deterministic additions', async () => {
  const rows = ['ZZNEW', 'BETA', 'AANEW', 'ZETA'].map(symbol => ({ symbol, current_price: 123, financial_current: { fresh: true } }));
  await withAnchor(anchor(['ZETA', 'REMOVED', 'BETA'], '2026-10-01'), async path => {
    for (const current of [rows, [...rows].reverse(), [rows[2], rows[0], rows[3], rows[1]]]) {
      const ordered = await orderResearchExportRows(current, path, date);
      expect(ordered.map(row => row.symbol)).toEqual(['ZETA', 'BETA', 'AANEW', 'ZZNEW']);
      expect(new Set(ordered).size).toBe(rows.length);
      for (const row of ordered) expect(row).toBe(rows.find(item => item.symbol === row.symbol));
    }
  });
});

it('preserves the first export merge order only when the anchor file is absent', async () => {
  const rows = [{ symbol: 'ZETA' }, { symbol: 'ALPHA' }];
  await withAnchor(undefined, async path => expect(await orderResearchExportRows(rows, path, date)).toBe(rows));
  await withAnchor(anchor([]), async path => expect((await orderResearchExportRows(rows, path, date)).map(row => row.symbol)).toEqual(['ALPHA', 'ZETA']));
  await withAnchor(anchor(['REMOVED']), async path => expect(await orderResearchExportRows([], path, date)).toEqual([]));
});

it.each([
  ['null envelope', () => null],
  ['unknown version', value => ({ ...value, version: 'unknown' })],
  ['invalid date', value => ({ ...value, as_of_date: '2026-02-30' })],
  ['future date', () => anchor(['ZETA'], '2026-10-05')],
  ['missing results', value => ({ ...value, results: undefined })],
  ['wrong total', value => ({ ...value, total: 2 })],
  ['duplicate symbol', () => anchor(['ZETA', 'ZETA'])],
  ['empty symbol', () => anchor([' '])],
  ['numeric symbol', () => anchor([1])],
  ['missing nested identity', value => ({ ...value, results: [{ symbol: 'ZETA' }] })],
  ['wrong nested identity', value => ({ ...value, results: [{ ...value.results[0], symbol: 'OTHER' }] })],
  ['wrong nested date', value => ({ ...value, results: [{ symbol: 'ZETA', audit: { ...value.results[0].audit, as_of_date: '2026-10-01' } }] })],
  ['wrong nested version', value => ({ ...value, results: [{ symbol: 'ZETA', audit: { ...value.results[0].audit, version: 'unknown' } }] })],
])('fails closed on %s', async (_label, change) => {
  await withAnchor(change(anchor(['ZETA'])), async path => {
    await expect(orderResearchExportRows([{ symbol: 'ZETA' }], path, date)).rejects.toThrow('Invalid research export order anchor');
  });
});
