// A normal advancing price build owns the baseline. Carry may change only
// explicitly owned financial outputs and the independently replayed first daily
// observation; it never relaxes the strict same-price correction comparator.
import {lstatSync,cpSync,existsSync,linkSync,mkdirSync,mkdtempSync,readFileSync,readdirSync,rmSync,unlinkSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {dataFiles,inventoryDigest,safePath,sha256} from './publication-state.mjs';
import {compareCorrectionData,dataInventory,digest} from './financial-correction.mjs';

function linkTree(source,destination){
  mkdirSync(destination,{recursive:true});
  for(const entry of readdirSync(source,{withFileTypes:true})){
    if(!safePath(entry.name))throw Error('Unsafe carry comparison path');
    if(entry.isDirectory())linkTree(join(source,entry.name),join(destination,entry.name));
    else if(entry.isFile())linkSync(join(source,entry.name),join(destination,entry.name));
    else throw Error('Linked or special carry comparison input');
  }
}
const read=path=>JSON.parse(readFileSync(path,'utf8'));


export async function readCarryTargetBase({root,frontendRoot}) {
  const dataRoot=join(root,'static-data'),files=[];
  const input=path=>{
    if(!safePath(path))throw Error('Unsafe carry target path');
    let current=dataRoot;
    for(const part of path.split('/')){
      current=join(current,part);
      if(lstatSync(current).isSymbolicLink())throw Error('Linked carry target input');
    }
    if(!lstatSync(current).isFile())throw Error('Non-file carry target input');
    const raw=readFileSync(current);files.push({path:'static-data/'+path,bytes:raw.length,sha256:sha256(raw)});return JSON.parse(raw);
  };
  const manifest=input('manifest.json'),entry=manifest.markets?.US||manifest;
  const scan=input(entry.pages?.scan?.path),date=scan.as_of_date;
  if(entry.as_of_date!==date)throw Error('Carry target manifest/scan date mismatch');
  if(scan.chunks!==undefined&&!Array.isArray(scan.chunks))throw Error('Invalid carry target chunk declarations');
  const references=scan.chunks||[],paths=new Set();
  const chunks=references.map(ref=>{
    if(!ref||!safePath(ref.path)||paths.has(ref.path))throw Error('Invalid or duplicate carry target chunk');
    paths.add(ref.path);return input(ref.path);
  });
  const payloads=[scan,...chunks],seen=new Map();
  for(const payload of payloads){
    if(payload.as_of_date!==date)throw Error('Mixed carry target snapshot dates');
    const rows=payload.rows||payload.initial_rows||[];
    if(!Array.isArray(rows))throw Error('Invalid carry target rows');
    for(const row of rows){
      if(!row||typeof row.symbol!=='string'||!row.symbol.trim())throw Error('Invalid carry target symbol');
      if(seen.has(row.symbol)&&!isDeepStrictEqual(seen.get(row.symbol),row))throw Error('Conflicting carry target copies for '+row.symbol);
      seen.set(row.symbol,row);
    }
  }
  const [{mergeScanRows},{orderResearchExportRows},{decodeResearchIndex},{instrumentIdentityEvidence}]=await Promise.all([
    import(pathToFileURL(join(frontendRoot,'src/static/qualificationAudit.js')).href),
    import(pathToFileURL(join(frontendRoot,'tools/research-export-order.mjs')).href),
    import(pathToFileURL(join(frontendRoot,'src/static/researchTransport.js')).href),
    import(pathToFileURL(join(frontendRoot,'src/static/instrumentApplicability.js')).href),
  ]);
  const auditPath=join(root,'qualification-audit.json');
  if(lstatSync(auditPath).isSymbolicLink()||!lstatSync(auditPath).isFile())throw Error('Invalid carry order input');
  const audit=readFileSync(auditPath);
  const rows=await orderResearchExportRows(mergeScanRows(payloads,date),auditPath,date);
  if(!readFileSync(auditPath).equals(audit))throw Error('Carry order input changed during read');
  const research=decodeResearchIndex(input(entry.assets?.research?.path));
  if(research.as_of_date!==date||!Array.isArray(research.rows)||!rows.length)throw Error('Invalid carry target Research snapshot');
  const bySymbol=new Map(research.rows.map(row=>[row?.symbol,row]));
  if(bySymbol.size!==research.rows.length||!isDeepStrictEqual(rows.map(row=>row.symbol).sort(),[...bySymbol.keys()].sort()))throw Error('Carry target Research/scan universe mismatch');
  for(const row of rows){
    const counterpart=bySymbol.get(row.symbol);
    if(row.market!=='US'||counterpart.market!=='US'||(row.as_of_date??date)!==date||(counterpart.as_of_date??date)!==date)throw Error('Carry target Research/scan scope mismatch '+row.symbol);
    for(const key of ['current_price','adv_usd'])if(!isDeepStrictEqual(row[key],counterpart[key]))throw Error('Carry target Research/scan '+key+' mismatch '+row.symbol);
  }
  files.push({path:'qualification-audit.json',bytes:audit.length,sha256:sha256(audit)});
  files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
  const fullDigest=createHash('sha256');let fullBytes=0;
  const measure=value=>{fullDigest.update(value);fullBytes+=Buffer.byteLength(value);};
  measure('{"market":"US","as_of_date":'+JSON.stringify(date)+',"rows":[');
  rows.forEach((row,index)=>{if(index)measure(',');measure(JSON.stringify(row));});measure(']}');
  const rawFull={bytes:fullBytes,sha256:fullDigest.digest('hex'),cap_bytes:256*1024*1024,exceeds_unchanged_cap:fullBytes>256*1024*1024};
  // Retain every supplied observation. This wrapper belongs only to the
  // bound control target; it cannot add an issuer value to published rows.
  const projectedRows=rows.map(row=>({
    ...Object.fromEntries(['symbol','market','as_of_date','current_price','adv_usd','financial_identity'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,row[key]])),
    instrument_identity:{observed_contexts:instrumentIdentityEvidence(row)},
  }));
  const inputBindings={schema_version:'carry-target-observed-identity-inputs-v1',files,raw_full_target:rawFull};
  const bytes=JSON.stringify({market:'US',as_of_date:date,input_bindings:inputBindings,rows:projectedRows});
  if(Buffer.byteLength(bytes)>256*1024*1024)throw Error('Carry target exceeds unchanged 256 MiB bound');
  return {bytes,rows,asOfDate:date};
}

export async function verifyCarriedBundle({baselineRoot,root,frontendRoot,carry,evaluatedAt=Date.now(),excludePaths=[]}) {
  if(!Array.isArray(excludePaths)||excludePaths.some(path=>!/^static-data\/financial-corrections\/(?:source-projection|source-base|carry-projection|release)-[a-f0-9]{64}\.json$/.test(path)))throw Error('Unlisted carry audit exclusion');
  const helper=await import(pathToFileURL(join(frontendRoot,'tools/financial-generation-carry.mjs')).href);
  const compatibility=await helper.verifyCarryCompatibility({root:join(root,'static-data'),carry,evaluatedAt});
  const catalogPath='static-data/candidate-history/index.json',beforePath=join(baselineRoot,catalogPath);
  const previous=JSON.parse(readFileSync(beforePath,'utf8'));
  const manifest=JSON.parse(readFileSync(join(root,'static-data/manifest.json'),'utf8'));
  const workbench=JSON.parse(readFileSync(join(root,'static-data',manifest.markets.US.assets.workbench.path),'utf8'));
  const {HISTORY_RETENTION_SESSIONS}=await import(pathToFileURL(join(frontendRoot,'src/static/candidatePerformance.js')).href);
  const expected=structuredClone(previous);
  const newDay=!expected.snapshots.some(item=>item.as_of===workbench.as_of);
  if(newDay)expected.snapshots.push(workbench.current_snapshot);
  expected.snapshots=expected.snapshots.sort((a,b)=>a.as_of.localeCompare(b.as_of)).slice(-HISTORY_RETENTION_SESSIONS);
  if(readFileSync(join(root,catalogPath),'utf8')!==JSON.stringify(expected))throw Error('Carried daily history is not its exact first observation');
  const checked=mkdtempSync(join(tmpdir(),'verified-financial-carry-'));
  try {
    linkTree(join(root,'static-data'),join(checked,'static-data'));
    for(const file of dataFiles)linkSync(join(root,file),join(checked,file));
    for(const path of excludePaths)if(!existsSync(join(baselineRoot,path)))rmSync(join(checked,path),{force:true});
    unlinkSync(join(checked,catalogPath));cpSync(beforePath,join(checked,catalogPath));
    const transitions=[];
    if(newDay){
      // Neither baseline's current snapshot nor its current-day changes were
      // ever published. Verify both derivations, then permit exactly today's
      // financial-dependent transition and first-current references. The prior
      // comparison basis and every historical snapshot remain untouched.
      const beforeManifest=read(join(baselineRoot,'static-data/manifest.json'));
      const beforeWorkbench=read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.workbench.path));
      const {verifyWorkbenchComparison}=await import(pathToFileURL(join(frontendRoot,'tools/workbench-comparison.mjs')).href);
      await verifyWorkbenchComparison({root:join(baselineRoot,'static-data'),workbench:beforeWorkbench});
      const {validateWorkbenchDetails}=await import(pathToFileURL(join(frontendRoot,'src/static/workbenchSummary.js')).href);
      validateWorkbenchDetails(beforeWorkbench,read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.workbench_summary.path)));
      for(const key of ['workbench','workbench_summary']){
        const beforeRef=beforeManifest.markets.US.assets[key],afterRef=manifest.markets.US.assets[key];
        const beforeBytes=readFileSync(join(baselineRoot,'static-data',beforeRef.path)),afterBytes=readFileSync(join(root,'static-data',afterRef.path));
        if(sha256(beforeBytes)!==beforeRef.sha256||sha256(afterBytes)!==afterRef.sha256)throw Error('Carry workbench content address changed');
        const before=JSON.parse(beforeBytes),after=JSON.parse(afterBytes);
        transitions.push({asset:key,before:beforeRef.sha256,after:afterRef.sha256,fields:['changes','daily_changes_snapshot','comparison_basis.saved_first']});
        after.changes=before.changes;after.daily_changes_snapshot=before.daily_changes_snapshot;
        after.comparison_basis.saved_first=before.comparison_basis.saved_first;
        const path=join(checked,'static-data',afterRef.path);unlinkSync(path);writeFileSync(path,JSON.stringify(after));
      }
    }
    const equality=await compareCorrectionData(baselineRoot,checked,frontendRoot,carry);
    return {compatibility,equality:{...equality,after_inventory_sha256:inventoryDigest(dataInventory(root,excludePaths.filter(path=>!existsSync(join(baselineRoot,path))))),
      current_day_transition_sha256:digest(transitions)}};
  } finally {rmSync(checked,{recursive:true,force:true});}
}
