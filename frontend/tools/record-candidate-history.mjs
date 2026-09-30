// Run once at the final build, after optional data enrichments finish.
import { readFile,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root=resolve('public/static-data');
let manifest;try{manifest=JSON.parse(await readFile(resolve(root,'manifest.json'),'utf8'));}catch(e){if(e.code==='ENOENT')process.exit(0);throw e;}
const ref=manifest.markets.US.assets.workbench;
const raw=await readFile(resolve(root,ref.path),'utf8');
if(createHash('sha256').update(raw).digest('hex')!==ref.sha256)throw Error('Workbench integrity failure');
const workbench=JSON.parse(raw);
let catalog={schema_version:1,snapshots:[]};
try{catalog=JSON.parse(await readFile(resolve(root,'candidate-history/index.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
// Preserve the first published/build snapshot of each session. UI-only releases
// and later financial restatements must not rewrite the original observation.
if(!catalog.snapshots.some(s=>s.as_of===workbench.as_of)) catalog.snapshots.push(workbench.current_snapshot);
catalog.snapshots=catalog.snapshots.sort((a,b)=>a.as_of.localeCompare(b.as_of)).slice(-30);
await writeFile(resolve(root,'candidate-history/index.json'),JSON.stringify(catalog));
console.log(`Candidate history: ${catalog.snapshots.length} recorded session(s)`);
