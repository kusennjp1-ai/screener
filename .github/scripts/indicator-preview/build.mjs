import { copyFile, mkdir, writeFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const frontend=resolve('frontend'),source=resolve('.github/scripts/indicator-preview');
const output=resolve(process.env.INDICATOR_PREVIEW_OUTPUT||'frontend/test-results/indicator-preview');
const temporary=resolve(frontend,'.indicator-preview');
await mkdir(temporary,{recursive:true});
await Promise.all([copyFile(resolve(source,'app.jsx'),resolve(temporary,'main.jsx')),copyFile(resolve(source,'preview.css'),resolve(temporary,'preview.css')),copyFile(resolve(output,'preview-data.json'),resolve(temporary,'preview-data.json'))]);
await writeFile(resolve(temporary,'index.html'),'<!doctype html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>指標履歴の確認用プレビュー</title></head><body><div id="root"></div><script type="module" src="/main.jsx"></script></body></html>');
const require=createRequire(resolve(frontend,'package.json'));
const {build}=await import(pathToFileURL(require.resolve('vite')));
const {default:react}=await import(pathToFileURL(require.resolve('@vitejs/plugin-react')));
try { await build({configFile:false,root:temporary,publicDir:false,base:'./',plugins:[react()],define:{'import.meta.env.VITE_STATIC_SITE':JSON.stringify('true')},build:{outDir:resolve(output,'site'),emptyOutDir:false,chunkSizeWarningLimit:2000}}); } finally { await rm(temporary,{recursive:true,force:true}); }
