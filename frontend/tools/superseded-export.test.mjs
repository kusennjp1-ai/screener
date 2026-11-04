// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { removeSupersededOutputs } from './superseded-export.mjs';
import { exportMarketTrends } from './export-market-trends.mjs';
import { exportWorkbench } from './export-workbench.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const temporary = prefix => mkdtempSync(join(tmpdir(), prefix));
const names = (root, directory = '.') => readdirSync(join(root, directory)).sort();

describe('removeSupersededOutputs', () => {
  const setup = () => {
    const root = temporary('superseded-unit-');
    for (const name of ['workbench-1111111111111111.json', 'workbench-2222222222222222.json', 'workbench-3333333333333333.json', 'custom-workbench.json']) writeFileSync(join(root, name), name);
    return root;
  };
  it('removes only the input-referenced generation once a different name replaces it', async () => {
    const root = setup();
    try {
      const removed = await removeSupersededOutputs({ root, references: { assets: { workbench: { path: 'workbench-2222222222222222.json' } } },
        replacements: [{ family: 'workbench', previous: 'workbench-1111111111111111.json', current: 'workbench-2222222222222222.json' }] });
      expect(removed).toEqual(['workbench-1111111111111111.json']);
      // An unreferenced leftover from an older run is never touched here.
      expect(names(root)).toEqual(['custom-workbench.json', 'workbench-2222222222222222.json', 'workbench-3333333333333333.json']);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('keeps the input reference when it is rewritten, still referenced, not a generated name, or absent', async () => {
    const root = setup();
    try {
      const before = names(root);
      const cases = [
        { references: {}, replacements: [{ family: 'workbench', previous: 'workbench-1111111111111111.json', current: 'workbench-1111111111111111.json' }] },
        { references: { markets: { HK: { assets: { workbench: { path: 'workbench-1111111111111111.json' } } } } }, replacements: [{ family: 'workbench', previous: 'workbench-1111111111111111.json', current: 'workbench-2222222222222222.json' }] },
        { references: {}, replacements: [{ family: 'workbench', previous: 'custom-workbench.json', current: 'workbench-2222222222222222.json' }] },
        { references: {}, replacements: [{ family: 'workbench', previous: '../workbench-1111111111111111.json', current: null }] },
        { references: {}, replacements: [{ family: 'workbench_summary', previous: 'workbench-1111111111111111.json', current: null }] },
        { references: {}, replacements: [{ family: 'workbench', previous: undefined, current: 'workbench-2222222222222222.json' }] },
      ];
      for (const value of cases) expect(await removeSupersededOutputs({ root, ...value })).toEqual([]);
      expect(names(root)).toEqual(before);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('fails closed when the referenced generation is missing or is not a regular file', async () => {
    const root = setup();
    try {
      await expect(removeSupersededOutputs({ root, references: {}, replacements: [{ family: 'workbench', previous: 'workbench-4444444444444444.json', current: null }] }))
        .rejects.toThrow(/missing workbench output/);
      symlinkSync(join(root, 'workbench-3333333333333333.json'), join(root, 'workbench-5555555555555555.json'));
      await expect(removeSupersededOutputs({ root, references: {}, replacements: [{ family: 'workbench', previous: 'workbench-5555555555555555.json', current: null }] }))
        .rejects.toThrow(/not a regular file/);
      await expect(removeSupersededOutputs({ root, references: {}, replacements: [{ family: 'candidate_history', previous: 'x', current: null }] }))
        .rejects.toThrow(/Unknown superseded export family/);
      expect(existsSync(join(root, 'workbench-3333333333333333.json'))).toBe(true);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('exportMarketTrends replaces its input series, source and long-history capture', () => {
  const source = () => JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'), 'utf8'));
  const history = () => JSON.parse(readFileSync(resolve('data/market-history-source-2026-10-23.json'), 'utf8'));
  const asOfDate = '2026-10-23';
  const stage = (root, indent) => {
    // Same observations, different exact bytes: every content address changes.
    writeFileSync(join(root, 'market-trend-source.json'), JSON.stringify(source(), null, indent));
    writeFileSync(join(root, 'market-history-source.json'), JSON.stringify(history(), null, indent));
  };
  const outputs = entry => {
    const ref = entry.assets.market_trends, series = JSON.parse(readFileSync(join(entry.root, ref.path), 'utf8'));
    return [ref.path, ref.source_path, `market-trends/history-source-${series.long_history.source_sha256}.json`];
  };
  it('keeps exactly the referenced triple plus unrelated leftovers across successive exports', async () => {
    const root = temporary('superseded-market-');
    try {
      const entry = { assets: {} };
      stage(root, 1);
      await exportMarketTrends({ root, entry, asOfDate });
      const first = outputs({ ...entry, root });
      const leftover = `market-trends/series-${'f'.repeat(64)}.json`;
      writeFileSync(join(root, leftover), '{}');
      stage(root, 2);
      await exportMarketTrends({ root, entry, asOfDate });
      const second = outputs({ ...entry, root });
      for (let index = 0; index < 3; index++) expect(second[index]).not.toBe(first[index]);
      expect(names(root, 'market-trends')).toEqual([...second, leftover].map(path => path.slice('market-trends/'.length)).sort());
      for (const path of second) expect(sha(readFileSync(join(root, path)))).toBe(path.match(/-([a-f0-9]{64})\.json$/)[1]);
      // The runtime inputs the next export reads stay in place.
      expect(existsSync(join(root, 'market-trend-source.json'))).toBe(true);
      expect(existsSync(join(root, 'market-history-source.json'))).toBe(true);
      // An identical re-export rewrites the same names and removes nothing.
      await exportMarketTrends({ root, entry, asOfDate });
      expect(outputs({ ...entry, root })).toEqual(second);
      expect(names(root, 'market-trends')).toEqual([...second, leftover].map(path => path.slice('market-trends/'.length)).sort());
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('fails closed before writing when the input series is missing or does not match its content address', async () => {
    const root = temporary('superseded-market-closed-');
    try {
      const entry = { assets: {} };
      stage(root, 1);
      await exportMarketTrends({ root, entry, asOfDate });
      const [series] = outputs({ ...entry, root });
      const bytes = readFileSync(join(root, series));
      writeFileSync(join(root, series), Buffer.concat([bytes, Buffer.from(' ')]));
      stage(root, 2);
      await expect(exportMarketTrends({ root, entry, asOfDate })).rejects.toThrow(/content address mismatch/);
      rmSync(join(root, series));
      await expect(exportMarketTrends({ root, entry, asOfDate })).rejects.toThrow(/missing market-trends series/);
      expect(entry.assets.market_trends.path).toBe(series);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

describe('exportWorkbench replaces its input pair and candidate-performance report', () => {
  const rows = [{ symbol: 'TEST', current_price: 20, adv_usd: 30e6, gics_sector: 'Technology' }];
  const at = time => ({ rows, researchContent: JSON.stringify(rows), now: Date.parse(time) });
  const top = (root, prefix) => names(root).filter(name => name.startsWith(prefix) && name.endsWith('.json'));
  it('removes the input-referenced pair in every mode and never touches candidate history', async () => {
    const root = temporary('superseded-workbench-');
    try {
      const manifest = { generated_at: '2026-09-30T05:00:00Z' }, entry = { as_of_date: '2026-09-29', assets: {} };
      await exportWorkbench({ root, manifest, entry, ...at('2026-09-30T05:00:00Z') });
      const first = structuredClone(entry.assets);
      const leftover = 'workbench-ffffffffffffffff.json';
      writeFileSync(join(root, leftover), '{}');
      await exportWorkbench({ root, manifest, entry, ...at('2026-09-30T06:00:00Z') });
      expect(entry.assets.workbench.path).not.toBe(first.workbench.path);
      expect(top(root, 'workbench-summary-')).toEqual([entry.assets.workbench_summary.path]);
      expect(top(root, 'workbench-').filter(name => !name.startsWith('workbench-summary-'))).toEqual([entry.assets.workbench.path, leftover].sort());
      expect(top(root, 'candidate-performance-')).toEqual([entry.assets.candidate_performance.path]);
      // Every same-session snapshot stays: candidate history is not in scope.
      expect(names(root, 'candidate-history').filter(name => name.endsWith('.gz'))).toHaveLength(2);
      // A carry/correction export applies the same rule to its pair and keeps
      // the report it does not write.
      const performance = structuredClone(entry.assets.candidate_performance);
      await exportWorkbench({ root, manifest, entry, ...at('2026-09-30T07:00:00Z'), financialCorrection: { financial_generation: 'a'.repeat(64) } });
      expect(entry.assets.candidate_performance).toEqual(performance);
      expect(top(root, 'candidate-performance-')).toEqual([performance.path]);
      expect(top(root, 'workbench-summary-')).toEqual([entry.assets.workbench_summary.path]);
      expect(names(root, 'candidate-history').filter(name => name.endsWith('.gz'))).toHaveLength(3);
      for (const key of ['workbench', 'workbench_summary', 'candidate_performance']) {
        expect(sha(readFileSync(join(root, entry.assets[key].path)))).toBe(entry.assets[key].sha256);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('fails closed when the input manifest names a missing generated workbench', async () => {
    const root = temporary('superseded-workbench-closed-');
    try {
      const manifest = { generated_at: '2026-09-30T05:00:00Z' }, entry = { as_of_date: '2026-09-29', assets: {} };
      await exportWorkbench({ root, manifest, entry, ...at('2026-09-30T05:00:00Z') });
      rmSync(join(root, entry.assets.workbench.path));
      await expect(exportWorkbench({ root, manifest, entry, ...at('2026-09-30T06:00:00Z') })).rejects.toThrow(/missing workbench output/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});
