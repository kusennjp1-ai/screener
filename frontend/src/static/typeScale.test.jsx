/* eslint-env node */
import { readFileSync, globSync } from 'node:fs';
import { join } from 'node:path';
import { T, W, TEXT_MIN_PX } from './designTokens';

// Source-level guard for the six-step type scale (C101).
//
// The per-component tests assert what a single card renders. This one asserts
// the RULE across every static-site source file, so a new component cannot
// quietly reintroduce a seventh size. It reads the sources rather than
// rendering, because the failure mode we are guarding against is a literal
// being typed into an `sx` block.
//
// Before this scale the phone rendered 11 distinct sizes (10, 10.5, 11, 11.5,
// 12, 12.5, 13, 14, 15, 16.5, 19) plus fractional em/rem-derived values like
// 12.0714px and 22.2857px. Fractional sizes sub-pixel-render and make Japanese
// glyphs look smeared; a dozen sizes destroy the hierarchy because no size
// means anything.

// NOT `import.meta.url` — under Vite that resolves to the server path
// (/src/static), not a filesystem path, and every glob silently returns zero
// files, which makes this whole guard pass vacuously.
// eslint-disable-next-line no-undef
const SRC = join(process.cwd(), 'src', 'static');

const sourceFiles = () => {
  const files = globSync('**/*.{js,jsx}', { cwd: SRC }).filter((f) => !f.includes('.test.'));
  // Fail loudly rather than pass on an empty set.
  if (files.length < 10) throw new Error(`only ${files.length} sources found under ${SRC}`);
  return files.map((f) => ({ file: f, text: readFileSync(join(SRC, f), 'utf8') }));
};

describe('static-site type scale', () => {
  it('has six integer steps, all at or above the 12px floor', () => {
    const steps = Object.values(T);
    expect(steps).toHaveLength(6);
    expect(steps.every(Number.isInteger)).toBe(true);
    expect(Math.min(...steps)).toBe(TEXT_MIN_PX);
    // strictly ascending — a step that ties another is not a step
    expect([...steps].sort((a, b) => a - b)).toEqual(steps);
    expect(new Set(steps).size).toBe(6);
  });

  it('no source writes a raw numeric font size', () => {
    // `fontSize: 11` / `fontSize: '11px'` / `fontSize: '0.65rem'` — every form
    // that bypasses the scale. Chart-library tick props are included on
    // purpose: they render HTML text in this app, not canvas.
    const raw = /fontSize:\s*(?:\d|'[\d.]+(?:px|rem|em)')/;
    const offenders = sourceFiles()
      .filter(({ text }) => raw.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('no source writes a raw numeric font weight', () => {
    // Weight is the secondary signal; size carries the hierarchy. 700 (W.bold)
    // is the ceiling — 800 everywhere made every level shout at once.
    const raw = /fontWeight:\s*\d/;
    const offenders = sourceFiles()
      .filter(({ text }) => raw.test(text))
      .map(({ file }) => file);
    expect(offenders).toEqual([]);
  });

  it('caps weight at 700', () => {
    expect(Math.max(...Object.values(W))).toBe(700);
  });
});
