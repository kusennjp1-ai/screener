// Separate CI artifact: never emitted to dist/ or the public site.
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFile } from 'node:fs/promises';
const outDir = 'test-results/radar-build';
await build({ configFile: false, publicDir: false, plugins: [react()], build: { outDir, emptyOutDir: true, sourcemap: true, rollupOptions: { input: 'tools/radar-benchmark.jsx', output: { entryFileNames: 'benchmark.js', assetFileNames: '[name][extname]' } } } });
await writeFile(`${outDir}/index.html`, '<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="./radar-benchmark.css"><title>CI radar render measurement</title></head><body><script type="module" src="./benchmark.js"></script></body></html>');
