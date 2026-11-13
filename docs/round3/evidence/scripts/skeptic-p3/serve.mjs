// SCRATCH skeptic-p3: static server on 127.0.0.1:4414 for own builds at /s-<sha>/ (no-store).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
const ROOT = process.argv[2], PORT = 4414;
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
createServer(async (q, r) => {
  try {
    const p = decodeURIComponent(new URL(q.url, 'http://x').pathname); const m = p.match(/^\/s-([0-9a-f]{7})\/(.*)$/); if (!m) throw 0;
    const root = resolve(ROOT, m[1], 'frontend', 'dist'); let f = resolve(root, m[2] || 'index.html');
    if (f !== root && !f.startsWith(root + sep)) throw 0; if ((await stat(f)).isDirectory()) f = resolve(f, 'index.html');
    r.writeHead(200, { 'Content-Type': mime[extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' }); r.end(await readFile(f));
  } catch { r.writeHead(404); r.end('nf'); }
}).listen(PORT, '127.0.0.1', () => console.log('serving', PORT));
