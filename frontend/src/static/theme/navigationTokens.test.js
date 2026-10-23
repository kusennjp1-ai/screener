// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { radii } from './tokens';

it('uses approved radius steps for the desktop navigation links',()=>{
  const css=readFileSync(new URL('../workbench.css',import.meta.url),'utf8');
  const values=[...css.matchAll(/\.leader-desktop-nav a\s*\{([^}]*)\}/g)]
    .flatMap(match=>[...match[1].matchAll(/border-radius:([^;}]*)/g)].map(value=>value[1].trim()));
  expect(values.length).toBeGreaterThan(0);
  for(const value of values){
    expect(value).toMatch(/^\d+px$/);
    expect(radii).toContain(Number.parseInt(value,10));
  }
});
