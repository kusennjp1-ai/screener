// Explicit, offline statement corrections are separate from price chronology.
// Intent is never evidence: all authority comes from immutable attempts/bytes.
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { githubApi, sameRepository, workflowPath } from './publication-gate.mjs';
import { dataFiles, inventoryDigest, safePath, sha256 } from './publication-state.mjs';
import { extractSourceArchive } from './restore-statement-source.mjs';
import { verifyCertifiedCorrectionSource } from './verify-certified-correction-source.mjs';
import contract from '../../contracts/financial_correction_v1.json' with { type: 'json' };

export { contract };
export const digest = value => sha256(canonical(value));
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  if (value === undefined || typeof value === 'number' && !Number.isFinite(value)) throw Error('Noncanonical correction data');
  return JSON.stringify(value);
}
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const positive = value => Number.isSafeInteger(value) && value > 0;
const exact = (value, keys, name) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw Error(`Invalid closed ${name} contract`);
};
const equal = (a, b, label) => { if (canonical(a) !== canonical(b)) throw Error(`Correction changed ${label}`); };
export function parseCorrectionIntent(input) {
  if (input == null || input === '') return null;
  if (typeof input !== 'string' || Buffer.byteLength(input) > 8192) throw Error('Expected bounded typed financial correction intent');
  const intent = JSON.parse(input);
  exact(intent, contract.intent_keys, 'correction intent');
  if (intent.schema_version !== contract.schema_version || intent.kind !== contract.kind || intent.reason !== contract.reason
    || !/^\d+\/\d+\/[a-f0-9]{64}\/[a-f0-9]{64}$/.test(intent.previous_publication_identity || '')) throw Error('Invalid financial correction identity');
  exact(intent.source, contract.source_keys, 'correction source');
  const source = intent.source;
  if (source.repository !== 'kusennjp1-ai/screener' || source.workflow !== contract.source_workflow || !sha(source.head_sha)
    || !['run_id', 'run_attempt', 'artifact_id'].every(key => positive(source[key]))
    || source.artifact_name !== `financial-statement-recovery-${source.head_sha}-${source.run_attempt}`
    || !['artifact_sha256', 'archive_manifest_sha256', 'acquisition_base_sha256', 'cohort_sha256'].every(key => hash(source[key]))) throw Error('Invalid pinned financial correction source');
  return intent;
}

export function verifyCorrectionSource(source, api = githubApi, certification = null) {
  // Reparse closed schema even when called from an on-disk state file.
  parseCorrectionIntent(JSON.stringify({schema_version:contract.schema_version,kind:contract.kind,reason:contract.reason,previous_publication_identity:`1/1/${'0'.repeat(64)}/${'0'.repeat(64)}`,source}));
  // Explicit source-validation authority only. Existing release callers never
  // pass this argument; preview-only partial evidence cannot enter this path.
  if (certification !== null) return verifyCertifiedCorrectionSource(source, certification, api);
  const repo = source.repository;
  const run = api(`repos/${repo}/actions/runs/${source.run_id}/attempts/${source.run_attempt}`);
  if (run.id !== source.run_id || run.run_attempt !== source.run_attempt || !sameRepository(run, repo) || run.head_sha !== source.head_sha
    || run.path !== source.workflow || !['main', 'improve/mandatory-financial-source-recovery'].includes(run.head_branch)
    || run.event !== 'push' || run.status !== 'completed' || run.conclusion !== 'success') throw Error('Correction source attempt is not successful and exact');
  const jobs = api(`repos/${repo}/actions/runs/${source.run_id}/attempts/${source.run_attempt}/jobs?per_page=100`, true).flatMap(page => page.jobs);
  const matching = jobs.filter(job => job.name === contract.source_job && job.run_attempt === source.run_attempt);
  if (matching.length !== 1 || matching[0].conclusion !== 'success' || !positive(matching[0].id)) throw Error('Missing successful correction source job');
  const job = matching[0];
  const list = api(`repos/${repo}/actions/runs/${source.run_id}/artifacts?per_page=100`, true).flatMap(page => page.artifacts);
  const artifacts = list.filter(item => item.name === source.artifact_name);
  if (artifacts.length !== 1) throw Error('Missing or duplicate correction source artifact');
  const artifact = artifacts[0];
  if (artifact.id !== source.artifact_id || artifact.expired !== false || artifact.digest !== `sha256:${source.artifact_sha256}`
    || artifact.workflow_run?.id !== source.run_id || artifact.workflow_run?.head_sha !== source.head_sha
    || !positive(artifact.size_in_bytes) || artifact.size_in_bytes > 128 * 1024 * 1024
    || ![artifact.created_at, job.started_at, job.completed_at].every(time => Number.isFinite(Date.parse(time)))
    || Date.parse(artifact.created_at) < Date.parse(job.started_at) || Date.parse(artifact.created_at) > Date.parse(job.completed_at)) throw Error('Correction artifact does not belong to the pinned attempt');
  return { artifact, job: { id: job.id, run_id: source.run_id, run_attempt: source.run_attempt, name: job.name } };
}

export function verifyCorrectionChecks(repository, controllerSha, api = githubApi) {
  if (!sha(controllerSha)) throw Error('Invalid correction controller SHA');
  const runs = api(`repos/${repository}/actions/workflows/ci.yml/runs?branch=main&event=push&head_sha=${controllerSha}&per_page=100`, true).flatMap(page => page.workflow_runs)
    .filter(run => run.path === workflowPath('ci.yml') && run.head_sha === controllerSha && sameRepository(run, repository) && run.event === 'push' && run.head_branch === 'main')
    .sort((a,b) => b.id-a.id || b.run_attempt-a.run_attempt);
  const selected = runs[0];
  if (!positive(selected?.id) || !positive(selected?.run_attempt)) throw Error('Correction requires exact successful controller CI');
  const run = api(`repos/${repository}/actions/runs/${selected.id}/attempts/${selected.run_attempt}`);
  if (run.id !== selected.id || run.run_attempt !== selected.run_attempt || !sameRepository(run, repository) || run.head_sha !== controllerSha
    || run.path !== workflowPath('ci.yml') || run.event !== 'push' || run.head_branch !== 'main' || run.status !== 'completed' || run.conclusion !== 'success') throw Error('Correction controller CI attempt is not successful');
  const jobs = api(`repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`, true).flatMap(page => page.jobs);
  return contract.required_ci_jobs.map(name => {
    const matching = jobs.filter(job => job.name === name && job.run_attempt === run.run_attempt);
    if (matching.length !== 1 || matching[0].conclusion !== 'success' || matching[0].status !== 'completed' || !positive(matching[0].id)) throw Error(`Correction requires successful CI job: ${name}`);
    return { workflow:run.path, run_id:run.id, run_attempt:run.run_attempt, job_id:matching[0].id, name, head_sha:controllerSha };
  });
}

export function verifyCorrectionConsumerChecks(live, repository, api=githubApi) {
  if(live.approval?.type!=='gates'||live.approval.sha!==live.uiSha)throw Error('Correction consumer needs explicit CI and Design approval');
  const checks=[];
  for(const file of ['ci.yml','design-acceptance.yml']) {
    const reference=live.approval.runs?.find(run=>run.path===workflowPath(file));
    if(!positive(reference?.id)||!positive(reference?.attempt))throw Error('Missing correction consumer gate identity');
    const run=api(`repos/${repository}/actions/runs/${reference.id}/attempts/${reference.attempt}`);
    if(run.id!==reference.id||run.run_attempt!==reference.attempt||!sameRepository(run,repository)||run.head_sha!==live.uiSha||run.head_branch!=='main'||run.event!=='push'||run.path!==workflowPath(file)||run.status!=='completed'||run.conclusion!=='success')throw Error('Correction consumer approval attempt changed');
    const jobs=api(`repos/${repository}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,true).flatMap(page=>page.jobs);
    for(const name of file==='ci.yml'?contract.required_ci_jobs:['Real-data design and performance budgets']) {
      const selected=jobs.filter(job=>job.name===name&&job.run_attempt===run.run_attempt);
      if(selected.length!==1||selected[0].status!=='completed'||selected[0].conclusion!=='success'||!positive(selected[0].id))throw Error(`Correction consumer gate job is not successful: ${name}`);
      checks.push({workflow:run.path,run_id:run.id,run_attempt:run.run_attempt,job_id:selected[0].id,name,head_sha:live.uiSha});
    }
  }
  return checks;
}

export function restoreCorrectionSource(source, directory, verified) {
  const root = resolve(directory); mkdirSync(root, {recursive:true});
  const zip = join(root, 'source.zip');
  if (!existsSync(zip)) {
    const fd = openSync(zip, 'wx');
    try { execFileSync('gh', ['api', `repos/${source.repository}/actions/artifacts/${source.artifact_id}/zip`], {stdio:['ignore',fd,'pipe']}); }
    finally { closeSync(fd); }
  }
  if (sha256(readFileSync(zip)) !== source.artifact_sha256 || verified.artifact.digest !== `sha256:${source.artifact_sha256}`) throw Error('Correction source ZIP digest mismatch');
  const files = join(root,'files'); rmSync(files,{recursive:true,force:true}); extractSourceArchive(zip,files);
  for (const [name,key] of [['archive/manifest.json','archive_manifest_sha256'],['base.json','acquisition_base_sha256'],['cohort.json','cohort_sha256']]) {
    if (sha256(readFileSync(join(files,name))) !== source[key]) throw Error(`Correction ${name} digest mismatch`);
  }
  // Nested source-provenance is retained seed history, never capture authority.
  return files;
}

export function dataInventory(root, excluded = []) {
  const out = {}, skip = new Set(excluded);
  const walk = (directory,prefix='') => {
    for (const entry of readdirSync(directory,{withFileTypes:true})) {
      const path = prefix+entry.name;
      if (!safePath(path)) throw Error('Unsafe correction bundle path');
      if (entry.isDirectory()) { if (path==='static-data' || path.startsWith('static-data/')) walk(join(directory,entry.name),`${path}/`); }
      else if (path==='static-data' || path.startsWith('static-data/') || dataFiles.includes(path)) {
        if (!entry.isFile()) throw Error('Correction bundle contains a link or special file');
        if (!skip.has(path)) out[path]=sha256(readFileSync(join(directory,entry.name)));
      }
    }
  }; walk(root); return out;
}

const owned = new Set([...contract.financial_fields,...contract.financial_context_fields,...contract.financial_derived_fields]);
const metadata = new Set(['financial_generation','financial_evaluated_at','financial_knowledge_basis','financial_point_in_time','financial_source_publication_date','financial_policy_version']);
const hashedPath = value => typeof value === 'string' ? value.replace(/-[a-f0-9]{16}(?=\.json(?:\.gz)?$)/,'-CONTENT') : value;
function stripped(value, row=false, cohort=null, parentSymbol=null, parentMarket='US') {
  if (Array.isArray(value)) return value.map(child => stripped(child,false,cohort,parentSymbol,parentMarket));
  if (!value || typeof value!=='object') return value;
  const isRow = row || typeof value.symbol==='string';
  const symbol=value.symbol||parentSymbol;
  const market=value.market||parentMarket;
  const permitted=!cohort||market==='US'&&cohort.has(symbol);
  const contextual={...value};
  if(isRow&&permitted)for(const key of ['screener_results','screener_details','screeners'])if(contextual[key]&&typeof contextual[key]==='object'&&!Array.isArray(contextual[key]))contextual[key]=Object.fromEntries(Object.entries(contextual[key]).filter(([name])=>!(/^(minervini|canslim|ipo|custom)$/i.test(name))));
  return Object.fromEntries(Object.entries(contextual).filter(([key]) => !metadata.has(key) && !(isRow && ['method_summary','financial_current_state'].includes(key)) && !(isRow && permitted && owned.has(key))).map(([key,child]) => [key,
    ['chart_path','research_detail_path','path','list_path'].includes(key) ? hashedPath(child) : stripped((key==='fundamentals'||key==='stock_data')&&child&&typeof child==='object'?{...Object.fromEntries(['symbol','market','as_of_date'].filter(k=>value[k]!==undefined).map(k=>[k,value[k]])),...child}:child,key==='fundamentals'||key==='stock_data',cohort,symbol,market)]));
}
function preservedFinancialAudit(before,after) {
  if(Array.isArray(before)) {
    const keyed=before.every(item=>item&&typeof item==='object'&&typeof item.symbol==='string');
    const next=keyed&&Array.isArray(after)?new Map(after.map(item=>[item.symbol,item])):null;
    for(let index=0;index<before.length;index++)preservedFinancialAudit(before[index],next?next.get(before[index].symbol):after?.[index]);
  } else if(before&&typeof before==='object') {
    if(Object.hasOwn(before,'financial_historical'))equal(before.financial_historical,after?.financial_historical,'retained financial audit');
    for(const [key,value]of Object.entries(before))if(key!=='financial_historical'&&after&&Object.hasOwn(after,key))preservedFinancialAudit(value,after[key]);
  }
}

const read = (root,path) => JSON.parse(readFileSync(join(root,path),'utf8'));
const rowMap = (rows,sanitize=stripped) => {
  if (!Array.isArray(rows) || rows.some(row => typeof row?.symbol!=='string') || new Set(rows.map(row=>row.symbol)).size!==rows.length) throw Error('Correction universe is incomplete or duplicated');
  return Object.fromEntries(rows.map(row=>[row.symbol,sanitize(row,true)]).sort(([a],[b])=>a.localeCompare(b)));
};

// The compiler is loaded from the approved consumer checkout. Controller helpers
// cannot silently substitute new UI dependencies into that release.
export async function verifyConsumerCapability(frontendRoot) {
  const path=join(frontendRoot,'tools/financial-correction-overlay.mjs');
  if (!existsSync(path)) throw Error('Approved UI lacks the financial correction consumer hook');
  const consumer=await import(pathToFileURL(path).href);
  if (consumer.FINANCIAL_CORRECTION_SCHEMA!==contract.projection_schema || typeof consumer.verifyCorrectionCompatibility!=='function') throw Error('Approved UI correction capability is incompatible');
  if (!readFileSync(join(frontendRoot,'tools/export-research.mjs'),'utf8').includes("from './financial-correction-overlay.mjs'")) throw Error('Approved exporter does not execute its correction hook');
  return consumer;
}

export async function compareCorrectionData(beforeRoot, afterRoot, frontendRoot, projection) {
  const cohort=new Set(Object.keys(projection.symbols||{}));
  let contextMarket='US';
  const sanitize=(value,row=false)=>stripped(value,row,cohort,null,contextMarket);
  const protectedRows=rows=>rowMap(rows,sanitize);
  const transport=await import(pathToFileURL(join(frontendRoot,'src/static/researchTransport.js')).href);
  const beforeFiles=dataInventory(beforeRoot), afterFiles=dataInventory(afterRoot), handledBefore=new Set(),handledAfter=new Set();
  // This check is independent of active pointers: a forged current pointer may
  // never turn an existing historical file into a permitted rewrite.
  for(const [path,hash] of Object.entries(beforeFiles)) if(path.startsWith('static-data/candidate-history/') && afterFiles[path]!==hash)throw Error(`Correction changed immutable historical snapshot: ${path}`);
  const semantic={};
  const pair=(before,after,label,transform=value=>sanitize(value))=>{
    if (!safePath(before)||!safePath(after)) throw Error('Unsafe correction asset reference');
    handledBefore.add(before); handledAfter.add(after);
    const original=read(beforeRoot,before),next=read(afterRoot,after);preservedFinancialAudit(original,next);const a=transform(original), b=transform(next); equal(a,b,label); semantic[label]=digest(a);
  };
  const bm=read(beforeRoot,'static-data/manifest.json'), am=read(afterRoot,'static-data/manifest.json');
  const normalizeManifest=value=>{ const out=sanitize(value); delete out.research_generation; for(const entry of Object.values(out.markets||{})) for(const key of ['research','workbench','workbench_summary']) if(entry.assets?.[key]) { delete entry.assets[key].sha256; delete entry.assets[key].snapshot_id; delete entry.assets[key].source_research_sha256; } return out; };
  pair('static-data/manifest.json','static-data/manifest.json','market/date and manifest scope',normalizeManifest);
  for(const [market,be] of Object.entries(bm.markets||{})) {
    contextMarket=market;
    const ae=am.markets?.[market]; if(!ae)throw Error('Correction dropped a market');
    if(market!=='US'){equal(be,ae,`${market} untouched market`);continue;}
    const beforeResearch=read(beforeRoot,`static-data/${be.assets.research.path}`),afterResearch=read(afterRoot,`static-data/${ae.assets.research.path}`);
    const br=transport.decodeResearchIndex(beforeResearch),ar=transport.decodeResearchIndex(afterResearch);
    pair(`static-data/${be.assets.research.path}`,`static-data/${ae.assets.research.path}`,`${market} research rows`,value=>({as_of_date:value.as_of_date,rows:protectedRows(transport.decodeResearchIndex(value).rows)}));
    semantic[`${market} universe`]=digest(Object.keys(protectedRows(br.rows)));
    if(ar.rows.length!==br.rows.length)throw Error('Correction changed full universe');
    const bci=read(beforeRoot,`static-data/${be.assets.charts.path}`),aci=read(afterRoot,`static-data/${ae.assets.charts.path}`);
    pair(`static-data/${be.assets.charts.path}`,`static-data/${ae.assets.charts.path}`,`${market} chart inventory`);
    const charts=new Map((aci.symbols||[]).map(item=>[item.symbol,item]));
    if(charts.size!==(aci.symbols||[]).length)throw Error('Duplicate correction chart identity');
    for(const item of bci.symbols||[]) {
      const next=charts.get(item.symbol);if(!next)throw Error('Correction dropped chart');
      pair(`static-data/${item.path}`,`static-data/${next.path}`,`${market} full chart ${item.symbol}`,value=>{const out=sanitize(value);if(market==='US'&&cohort.has(item.symbol))delete out.eps_line;return out;});
    }
    const afterRows=new Map(ar.rows.map(row=>[row.symbol,row]));
    for(const row of br.rows) if(row.research_detail_path) pair(`static-data/${row.research_detail_path}`,`static-data/${afterRows.get(row.symbol)?.research_detail_path}`,`${market} detail ${row.symbol}`);
    // Both source scan and its list aliases are independently compared.
    for(const key of ['path','list_path']) if(be.pages?.scan?.[key]) {
      const bp=`static-data/${be.pages.scan[key]}`,ap=`static-data/${ae.pages.scan[key]}`;
      const bs=read(beforeRoot,bp),as=read(afterRoot,ap);
      // Preserve exact canonical byte equality without retaining both full raw
      // and sanitized scan universes plus their giant canonical map strings.
      const visitRows=(root,scan,handled,visit)=>{
        const seen=new Set(),chunkMetadata=[];
        const rows=values=>{for(const row of values){if(typeof row?.symbol!=='string'||seen.has(row.symbol))throw Error('Correction universe is incomplete or duplicated');seen.add(row.symbol);visit(row);}};
        if(!scan.chunks?.length)rows(scan.initial_rows||[]);
        for(const item of scan.chunks||[]){const path=`static-data/${item.path}`;handled.add(path);const payload=read(root,path);rows(payload.rows||[]);const metadata={...payload};delete metadata.rows;chunkMetadata.push(sanitize(metadata));}
        return chunkMetadata;
      };
      const priorRows=new Map();
      const beforeMetadata=visitRows(beforeRoot,bs,handledBefore,row=>priorRows.set(row.symbol,canonical(sanitize(row,true))));
      const afterMetadata=visitRows(afterRoot,as,handledAfter,row=>{
        if(!priorRows.has(row.symbol)||priorRows.get(row.symbol)!==canonical(sanitize(row,true)))throw Error(`Correction changed ${market} scan ${key} rows and metadata`);
        priorRows.delete(row.symbol);
      });
      if(priorRows.size)throw Error(`Correction changed ${market} scan ${key} rows and metadata`);
      equal(beforeMetadata,afterMetadata,`${market} scan ${key} rows and metadata`);
      pair(bp,ap,`${market} scan ${key} metadata`,value=>{const out=sanitize(value);delete out.initial_rows;delete out.chunks;delete out.preview_rows;delete out.default_filtered_rows_total;if(out.preset_screens)out.preset_screens=out.preset_screens.map(({match_count,...screen})=>{void match_count;return screen;});return out;});
    }
    for(const asset of ['workbench','workbench_summary']) if(be.assets?.[asset]) {
      const bp=`static-data/${be.assets[asset].path}`,ap=`static-data/${ae.assets[asset].path}`;
      pair(bp,ap,`${market} ${asset} protected history`,value=>{
        const out=sanitize(value);for(const key of ['snapshot_id','source_research_sha256','current_snapshot'])delete out[key];if(out.details){delete out.details.sha256;delete out.details.snapshot_id;delete out.details.source_research_sha256;}if(out.sectors?.groups)out.sectors.groups=out.sectors.groups.map(({rates,...group})=>{void rates;return group;});
        return out;
      });
      const current=read(afterRoot,ap).current_snapshot;
      if(current?.path) {if(!/^candidate-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json\.gz$/.test(current.path))throw Error('Invalid correction current snapshot path');const path=`static-data/${current.path}`;const bytes=readFileSync(join(afterRoot,path));if(beforeFiles[path] && beforeFiles[path]!==sha256(bytes))throw Error('Correction current snapshot rewrote an existing artifact');if(sha256(bytes)!==current.sha256)throw Error('Correction current snapshot hash mismatch');handledAfter.add(path);const snapshot=JSON.parse(gunzipSync(bytes));if(snapshot.financial_generation!==projection.financial_generation)throw Error('Correction current snapshot lacks generation');}
    }
  }
  contextMarket='US';
  const portfolioKeys=['date','capital','market','allocationCap','blockers','positions','readiness','dailyPositions','candidateCount','invested','cash','exposure','risk','decision','executionExposure','executionCash'];
  for(const path of ['research-daily.json','portfolio-model.json','qualification-audit.json','static-data/financial-history.json']) if(beforeFiles[path]||afterFiles[path]) {
    if(!beforeFiles[path]||!afterFiles[path])throw Error(`Correction changed derived asset presence: ${path}`);
    pair(path,path,`protected derived metadata ${path}`,value=>{
      const out=sanitize(value);
      if(path==='research-daily.json') {delete out.candidates;delete out.ibd_comparison;}
      if(path==='portfolio-model.json') for(const key of portfolioKeys)delete out[key];
      if(path==='qualification-audit.json') out.results=out.results.map(({methods,...row})=>{void methods;return row;});
      if(path==='static-data/financial-history.json') {
        out.results=Object.fromEntries(Object.entries(out.results||{}).filter(([symbol])=>!cohort.has(symbol)));
        delete out.coverage;
      }
      return out;
    });
  }
  // No unlisted file may change or disappear. Old history and source aliases
  // remain byte-identical unless their explicit financial owner changes.
  for(const path of new Set([...Object.keys(beforeFiles),...Object.keys(afterFiles)])) {
    if(handledBefore.has(path)||handledAfter.has(path))continue;
    if(beforeFiles[path]===afterFiles[path])continue;
    if(/^static-data\/(?:research-details|verified-charts|scan-list)\//.test(path) && !afterFiles[path])continue;
    if(/^static-data\/(?:research-index|charts-index)-[a-f0-9]{16}\.json$/.test(path) && !afterFiles[path])continue;
    if(beforeFiles[path]&&afterFiles[path]&&/^static-data\/.*\.json$/.test(path)) {
      // Only actual source charts and source scan chunks may have changed owner
      // fields; benchmark/sector/home/history files never enter this exception.
      const a=read(beforeRoot,path),b=read(afterRoot,path);
      if(Array.isArray(a.bars)&&a.symbol===b.symbol&&a.symbol) {preservedFinancialAudit(a,b);const left=sanitize(a),right=sanitize(b);if((a.market||'US')==='US'&&cohort.has(a.symbol)){delete left.eps_line;delete right.eps_line;}equal(left,right,`source chart ${path}`);continue;}
    }
    throw Error(`Correction changed unowned data file: ${path}`);
  }
  return { semantic_sha256:digest(semantic), universe_sha256:digest(Object.fromEntries(Object.entries(semantic).filter(([key])=>key.endsWith(' universe')))), before_inventory_sha256:inventoryDigest(beforeFiles), after_inventory_sha256:inventoryDigest(afterFiles) };
}

export function assertCorrectionProgress(projection, previousGeneration) {
  if(projection?.schema_version!==contract.projection_schema || !hash(projection.financial_generation) || projection.financial_generation===previousGeneration
    || !Array.isArray(projection.receipt_inventory) || !projection.receipt_inventory.length) throw Error('Correction has no independently sourced financial progress');
  if(projection.knowledge_basis!==contract.knowledge_basis||projection.point_in_time!==false||projection.source_publication_date!==null)throw Error('Correction claims unsupported historical knowledge');
}

export function validateCorrectionReceipt(receipt) {
  exact(receipt,contract.receipt_keys,'correction receipt');
  if(receipt.schema_version!==contract.schema_version||receipt.kind!==contract.kind||receipt.reason!==contract.reason)throw Error('Unsupported financial correction receipt');
  const p=receipt.previous_publication,s=receipt.source,t=receipt.target,f=receipt.financial,v=receipt.validation;
  exact(p,['identity','ui_sha','ui_digest','data_inventory_sha256','artifact_id','artifact_sha256','financial_generation'],'previous publication');
  exact(t,['markets','universe_sha256','semantic_sha256','price_observations_sha256','known_price_dates_sha256'],'correction target');
  exact(f,['generation','projection_path','projection_sha256','receipt_inventory_sha256','evaluated_at','knowledge_basis','point_in_time','source_publication_date','policy','source_timestamp_bounds','scope','unavailable_reasons'],'correction financial');
  exact(v,['controller_sha','required_checks','consumer_checks','consumer_sha','ui_digest','compatibility_sha256','data_inventory_sha256'],'correction validation');
  parseCorrectionIntent(JSON.stringify({schema_version:receipt.schema_version,kind:receipt.kind,reason:receipt.reason,previous_publication_identity:p?.identity,source:s}));
  if(!sha(p.ui_sha)||!hash(p.ui_digest)||!hash(p.data_inventory_sha256)||!positive(p.artifact_id)||!hash(p.artifact_sha256)
    ||!(p.financial_generation==='legacy-none'||hash(p.financial_generation))||!hash(t.universe_sha256)||!hash(t.semantic_sha256)
    ||!hash(t.price_observations_sha256)||!hash(t.known_price_dates_sha256)||!hash(f.generation)||!hash(f.projection_sha256)||!hash(f.receipt_inventory_sha256)
    ||!safePath(f.projection_path)||!Number.isFinite(Date.parse(f.evaluated_at))||f.knowledge_basis!==contract.knowledge_basis||f.point_in_time!==false||f.source_publication_date!==null
    ||!sha(v.controller_sha)||!sha(v.consumer_sha)||v.consumer_sha!==p.ui_sha||v.ui_digest!==p.ui_digest||!hash(v.compatibility_sha256)||!hash(v.data_inventory_sha256)
    ||!Array.isArray(v.required_checks)||v.required_checks.length!==contract.required_ci_jobs.length||!Array.isArray(v.consumer_checks)||v.consumer_checks.length!==contract.required_ci_jobs.length+1)throw Error('Invalid financial correction receipt bindings');
  if(!t.markets||!Object.keys(t.markets).length||Object.entries(t.markets).some(([market,day])=>!(/^[A-Z]{2}$/.test(market)&&/^\d{4}-\d{2}-\d{2}$/.test(day))))throw Error('Invalid correction market dates');
  exact(f.policy,['id','contract_sha256','projector_sha256'],'correction policy');
  if(f.policy.id!==contract.policy_id||!hash(f.policy.contract_sha256)||!hash(f.policy.projector_sha256))throw Error('Invalid correction policy binding');
  if(!f.source_timestamp_bounds||!['earliest','latest'].every(key=>Number.isFinite(Date.parse(f.source_timestamp_bounds[key])))
    ||Date.parse(f.source_timestamp_bounds.earliest)>Date.parse(f.source_timestamp_bounds.latest)||Date.parse(f.source_timestamp_bounds.latest)>Date.parse(f.evaluated_at)
    ||!f.scope||!Number.isSafeInteger(f.scope.symbols)||f.scope.symbols<=0||f.scope.symbols>20000||!Array.isArray(f.scope.fields)||canonical(f.scope.fields)!==canonical(contract.financial_fields)||!f.unavailable_reasons)throw Error('Invalid financial correction scope or clocks');
  for(const name of contract.required_ci_jobs){const jobs=v.required_checks.filter(job=>job.name===name);if(jobs.length!==1||!positive(jobs[0].job_id)||!positive(jobs[0].run_id)||!positive(jobs[0].run_attempt)||jobs[0].head_sha!==v.controller_sha||jobs[0].workflow!==workflowPath('ci.yml'))throw Error('Invalid correction required-check identity');}
  for(const name of [...contract.required_ci_jobs,'Real-data design and performance budgets']){const jobs=v.consumer_checks.filter(job=>job.name===name);if(jobs.length!==1||!positive(jobs[0].job_id)||!positive(jobs[0].run_id)||!positive(jobs[0].run_attempt)||jobs[0].head_sha!==v.consumer_sha||jobs[0].workflow!==workflowPath(name==='Real-data design and performance budgets'?'design-acceptance.yml':'ci.yml'))throw Error('Invalid correction consumer-check identity');}
  return receipt;
}
