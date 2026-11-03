import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { breakdown, groupOf } from './site-size-breakdown.mjs';

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
});
