import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// index.html paints a boot shell before any module loads. The shell carries no data, and its one
// inline script only picks the ground colour, so the server CSP admits exactly that script by hash.
const html = readFileSync('index.html', 'utf8');
const nginx = readFileSync('nginx.conf', 'utf8');
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(match => match[1]);

describe('boot shell', () => {
  it('has one inline script, and the nginx CSP admits exactly its hash', () => {
    expect(inline).toHaveLength(1);
    const hash = `'sha256-${createHash('sha256').update(inline[0]).digest('base64')}'`;
    const scriptSrc = nginx.match(/script-src ([^;]+);/)[1].split(/\s+/);
    expect(scriptSrc).toContain(hash);
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc.filter(source => source.startsWith("'sha256-"))).toEqual([hash]);
  });

  it('shows only the app name and a loading line, never data', () => {
    const root = html.match(/<div id="root">([\s\S]*?)<\/div>\s*<script type="module"/)[1];
    expect(root.replace(/<[^>]+>/g, '')).toBe('米国株スクリーナー読み込み中…');
    expect(html).toContain('<meta name="theme-color" content="#10121D" />');
  });
});
