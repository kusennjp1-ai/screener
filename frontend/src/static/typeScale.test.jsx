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

  // Both guards scan to the end of the VALUE, not just its first character,
  // because the first version only matched a literal directly after the colon
  // and sailed straight past `fontWeight: isActive ? 600 : 400` — a real
  // violation that shipped while the test was green.
  const valueOf = (prop) => new RegExp(`${prop}:\\s*([^,}\\n]+)`, 'g');
  const violations = (prop, isBad) => sourceFiles()
    .flatMap(({ file, text }) => [...text.matchAll(valueOf(prop))]
      .filter((m) => isBad(m[1]))
      .map((m) => `${file}: ${prop}: ${m[1].trim()}`));

  // A value is bad when a LITERAL reaches the property — either a quoted value
  // carrying a unit, or a branch of the expression that is just a number.
  //
  // Testing "does the value contain a digit" is too blunt: it condemns
  // `fontWeight: rank <= 20 ? W.semibold : W.regular`, where the 20 is a rank
  // threshold and both branches are correct. Split on the ternary and judge
  // each branch on its own.
  const hasLiteral = (value) =>
    /['"]\s*\d+(?:\.\d+)?(?:px|rem|em)\s*['"]/.test(value)
    || value.split(/[?:]/).some((branch) => /^\s*\d+(?:\.\d+)?\s*$/.test(branch));

  it('no source writes a raw numeric font size', () => {
    // `fontSize: 11` / `fontSize: '11px'` / `fontSize: '0.65rem'` — every form
    // that bypasses the scale, including inside a responsive `{ xs, md }`
    // object. Chart-library tick props count too: they render HTML text in
    // this app, not canvas.
    expect(violations('fontSize', hasLiteral)).toEqual([]);
  });

  it('no source writes a raw numeric font weight', () => {
    // Weight is the secondary signal; size carries the hierarchy. 700 (W.bold)
    // is the ceiling — 800 everywhere made every level shout at once.
    expect(violations('fontWeight', hasLiteral)).toEqual([]);
  });

  it('caps weight at 700', () => {
    expect(Math.max(...Object.values(W))).toBe(700);
  });
});
