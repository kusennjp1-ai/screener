// The owner's line for the app's first download: the entry chunk of `npm run build` is at most 134.00 kB gzip, measured as
// vite prints it (zlib's default gzip level, kB = 1000 bytes). Read from frontend/dist when a build is there (the script
// index.html loads); skipped otherwise. The test step of CI runs before any build, so this guards local builds only.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';

const ENTRY_LINE_KB = 134;
// Paths, not URL objects: the test environment's URL is jsdom's, which node:fs does not take.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist');
const html = existsSync(join(dist, 'index.html')) ? readFileSync(join(dist, 'index.html'), 'utf8') : '';
const entry = html.match(/<script type="module"[^>]*\ssrc="[^"]*\/(assets\/[^"/]+\.js)"/)?.[1] ?? null;

describe.skipIf(!entry)('the entry chunk of the build in frontend/dist', () => {
  it(`is at most ${ENTRY_LINE_KB.toFixed(2)} kB gzip`, () => {
    const kB = gzipSync(readFileSync(join(dist, entry))).length / 1000;
    expect(kB, `${entry}: ${kB.toFixed(2)} kB gzip`).toBeLessThanOrEqual(ENTRY_LINE_KB);
  });
});
