import { readFile, readdir, mkdir, writeFile, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, dirname, relative, isAbsolute } from 'node:path';

const digest = value => createHash('sha256').update(value).digest('hex');
const pathInside = (root, name) => {
  const path = resolve(root, name), rel = relative(root, path);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw Error('Invalid diagnostic asset path');
  return path;
};

// Reconstruct source maps in memory after browser measurements. Never modify
// the tested candidate, run exporters, or accept a map for different JS bytes.
export async function retainProfileSources({ root, output, quoteUrl, build }) {
  const directory = resolve(output, 'diagnostic-code');
  await mkdir(directory, { recursive: true });
  const files = (await readdir(resolve(root, 'assets'), { recursive: true })).filter(name => /\.(?:js|css)$/.test(name)).map(name => `assets/${name}`);
  const recorded = new Map(), manifest = { acceptance_measurement: false, maps_reproduced: false, assets: [] };
  for (const name of files) {
    const bytes = await readFile(pathInside(root, name));
    recorded.set(name, bytes);
    const destination = pathInside(directory, name);
    await mkdir(dirname(destination), { recursive: true });
    await copyFile(pathInside(root, name), destination);
    manifest.assets.push({ path: name, bytes: bytes.length, sha256: digest(bytes), source_map: null });
  }
  const manifestPath = resolve(directory, 'manifest.json');
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  try {
    build ||= (await import('vite')).build;
    const result = await build({
      base: '/screener/', publicDir: false,
      define: { 'import.meta.env.VITE_STATIC_SITE': JSON.stringify('true'), 'import.meta.env.VITE_RESEARCH_QUOTE_URL': quoteUrl === undefined ? 'undefined' : JSON.stringify(quoteUrl) },
      build: { write: false, copyPublicDir: false, sourcemap: 'hidden' },
    });
    const outputs = (Array.isArray(result) ? result : [result]).flatMap(item => item.output);
    const rebuilt = new Map(outputs.map(item => [item.fileName, item]));
    // Validate every exact production script and stylesheet before writing any
    // maps, including chunks not sampled by this particular diagnostic run.
    for (const [name, bytes] of recorded) {
      const item = rebuilt.get(name), content = item?.type === 'chunk' ? item.code : item?.source;
      if (content === undefined || !Buffer.from(content).equals(bytes)) throw Error(`Source-map reconstruction differs from tested asset: ${name}`);
    }
    for (const item of manifest.assets) {
      const map = rebuilt.get(`${item.path}.map`);
      if (!map) {
        if (rebuilt.get(item.path)?.type === 'chunk') throw Error(`Source map missing for tested script: ${item.path}`);
        continue;
      }
      const bytes = Buffer.from(map.source);
      await writeFile(pathInside(directory, `${item.path}.map`), bytes);
      item.source_map = { path: `${item.path}.map`, bytes: bytes.length, sha256: digest(bytes) };
    }
    manifest.maps_reproduced = true;
  } catch (error) {
    manifest.error = error.message;
  }
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
  if (manifest.error) throw Error(manifest.error);
  return manifest;
}
