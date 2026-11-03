import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { breakdown, fieldBreakdown, groupOf } from './site-size-breakdown.mjs';

let root;
afterEach(async () => { if (root) await rm(root, { recursive: true, force: true }); });

describe('site size breakdown', () => {
  it('groups static data three levels deep and other files two levels deep', () => {
    expect(groupOf('static-data/markets/us/charts/AAPL.json')).toBe('static-data/markets/us/');
    expect(groupOf('static-data/verified-charts/AAPL-1.json')).toBe('static-data/verified-charts/');
    expect(groupOf('assets/index.js')).toBe('assets/');
    expect(groupOf('qualification-audit.json')).toBe('qualification-audit.json');
  });

  it('counts packed charts as gzip and every other file at its raw size', async () => {
    root = await mkdtemp(join(tmpdir(), 'site-size-'));
    await mkdir(join(root, 'static-data/markets/us/charts'), { recursive: true });
    await mkdir(join(root, 'static-data/verified-charts'), { recursive: true });
    const repetitive = JSON.stringify({ bars: Array.from({ length: 2000 }, () => [1, 2, 3, 4, 5]) });
    await writeFile(join(root, 'static-data/markets/us/charts/AAA.json'), repetitive);
    await writeFile(join(root, 'static-data/verified-charts/AAA-1.json'), repetitive);
    const result = await breakdown(root);
    const packed = result.groups.find(group => group.group === 'static-data/markets/us/');
    const raw = result.groups.find(group => group.group === 'static-data/verified-charts/');
    expect(packed.packed).toBe(true);
    expect(packed.bytes).toBeLessThan(repetitive.length / 10);
    expect(raw.packed).toBe(false);
    expect(raw.bytes).toBe(repetitive.length);
    expect(result.files).toBe(2);
    expect(result.groups[0]).toBe(raw);
  });

  it('sums raw bytes per top-level field and skips files that are not JSON objects', async () => {
    root = await mkdtemp(join(tmpdir(), 'site-fields-'));
    await writeFile(join(root, 'A-1.json'), JSON.stringify({ bars: [1, 2, 3], symbol: 'A' }));
    await writeFile(join(root, 'B-1.json'), JSON.stringify({ bars: [4, 5, 6, 7], symbol: 'B' }));
    await writeFile(join(root, 'list.json'), '[1,2]');
    await writeFile(join(root, 'broken.json'), '{');
    const result = await fieldBreakdown(root);
    expect(result.files).toBe(2);
    expect(result.fields.map(field => field.key)).toEqual(['bars', 'symbol']);
    expect(result.fields[0].bytes).toBe('[1,2,3]'.length + '[4,5,6,7]'.length + 2 * ('bars'.length + 4));
  });
});
