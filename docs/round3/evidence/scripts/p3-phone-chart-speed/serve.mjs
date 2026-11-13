// SCRATCH (audit3 p3): one static server on 127.0.0.1:4414 for the three production builds, as design-review.mjs serves
// CURRENT_BUILD (no-store, index.html for a directory). /t-<sha>/ = the plain build, /m-<sha>/ = the sourcemap build.
// static-data/* is never served here (each page answers it through page.route).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
const P = process.argv[2], PORT = Number(process.argv[3] || 4414);
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.txt': 'text/plain', '.wasm': 'application/wasm', '.map': 'application/json' };
createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const m = pathname.match(/^\/([tm])-([0-9a-f]{7})\/(.*)$/);
    if (!m) throw Error('outside');
    const root = resolve(P, 'trees', m[2], 'frontend', m[1] === 't' ? 'dist' : 'dist-map');
    let file = resolve(root, m[3] || 'index.html');
    if (file !== root && !file.startsWith(root + sep)) throw Error('Invalid path');
    if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html');
    const body = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    response.end(body);
  } catch { response.writeHead(404); response.end('Not found'); }
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${P}/trees on ${PORT}`));
