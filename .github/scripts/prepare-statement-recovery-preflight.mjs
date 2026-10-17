// OFFLINE PLAN ONLY. Hash-bound canonical inputs do not establish current
// remote continuity, authorize acquisition, certify a source, or publish it.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {lstatSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {PUBLIC_DATA_ROOT,researchPath} from './prepare-statement-cohort.mjs';
import {decodeResearchIndex} from '../../frontend/src/static/researchTransport.js';
import {rankCandidates} from '../../frontend/src/static/researchEngine.js';
import {decodePinnedResearchIndex,loadPinnedResearchDecoder} from './pinned-research-decoder.mjs';

const repositoryRoot=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const digest=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const day=value=>typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString().slice(0,10)===value;
const fields=['canonical_manifest_sha256','canonical_research_sha256','source_archive_manifest_sha256','source_base_sha256','source_cohort_sha256'];
function exact(value,keys,label){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error(`Invalid closed ${label}`);}
function bound(bytes,sum,label){if(!Buffer.isBuffer(bytes)||!digest(sum)||hash(bytes)!==sum)throw Error(`${label} digest mismatch`);}
function regular(path,maximum){
  for(let part=resolve(path);;part=dirname(part)){
    const info=lstatSync(part);if(info.isSymbolicLink())throw Error('Linked preflight input');
    if(part===dirname(part))break;
  }
  const info=lstatSync(path);
  if(!info.isFile()||info.nlink!==1||info.size<=0||info.size>maximum)throw Error('Invalid bounded preflight input');
  return readFileSync(path);
}

export function prepareRecoveryPreflightInputs({manifestBytes,indexBytes,sourceBaseBytes,sourceCohortBytes,bindings,observedAt,pinnedDecoder}){
  exact(bindings,fields,'preflight bindings');
  for(const key of fields)if(!digest(bindings[key]))throw Error('Invalid preflight digest');
  bound(manifestBytes,bindings.canonical_manifest_sha256,'Canonical manifest');
  bound(indexBytes,bindings.canonical_research_sha256,'Canonical research');
  bound(sourceBaseBytes,bindings.source_base_sha256,'Original source base');
  bound(sourceCohortBytes,bindings.source_cohort_sha256,'Original source cohort');
  if(sourceBaseBytes.length>32*1024**2||sourceCohortBytes.length>1024**2)throw Error('Original cohort input exceeds bound');
  const original=JSON.parse(sourceCohortBytes),oldBase=JSON.parse(sourceBaseBytes);
  exact(original,['symbols','base_artifact_sha256'],'original full cohort');
  if(original.base_artifact_sha256!==bindings.source_base_sha256||!Array.isArray(original.symbols)||!original.symbols.length||original.symbols.length>20000
    ||original.symbols.some(symbol=>typeof symbol!=='string'||!(/^[A-Z][A-Z0-9]{0,14}(?:-[A-Z0-9]{1,4})?$/).test(symbol))
    ||new Set(original.symbols).size!==original.symbols.length)throw Error('Invalid retained complete cohort');
  if(manifestBytes.length>1024**2||indexBytes.length>10*1024**2)throw Error('Canonical input exceeds bound');
  if(typeof observedAt!=='string'||!observedAt.endsWith('Z')||!Number.isFinite(Date.parse(observedAt)))throw Error('Explicit UTC observation is required');
  const manifest=JSON.parse(manifestBytes),path=researchPath(manifest),raw=JSON.parse(indexBytes);
  // The existing raw/v1 offline API stays explicit. V2 must use the producer's
  // exact verified decoder, never a schema relabel or legacy fallback.
  const index=pinnedDecoder!==undefined||raw?.schema==='research-table-v2'
    ? decodePinnedResearchIndex(pinnedDecoder,raw):decodeResearchIndex(raw);
  if(path!==`research-index-${hash(indexBytes).slice(0,16)}.json`)throw Error('Canonical research content path mismatch');
  if(!day(index.as_of_date)||index.as_of_date>observedAt.slice(0,10)||manifest.as_of_date!==index.as_of_date
    ||manifest.markets.US.as_of_date!==index.as_of_date)throw Error('Canonical snapshot dates disagree');
  if(!Array.isArray(index.rows)||!index.rows.length||index.rows.length>25000)throw Error('Invalid canonical universe');
  const currentRows=new Map();
  for(const row of index.rows){
    if(!row||typeof row.symbol!=='string'||!(/^[A-Z][A-Z0-9-]{0,19}$/).test(row.symbol)||currentRows.has(row.symbol)
      ||(row.market!=null&&row.market!=='US'))throw Error('Invalid canonical security identity');
    currentRows.set(row.symbol,{...row,market:'US'});
  }
  const currentLiquidCount=rankCandidates(index.rows,'minervini',{liquidOnly:true}).length;
  const priorRows=oldBase.rows??oldBase.results;
  if(!Array.isArray(priorRows)||new Set(priorRows.map(row=>row?.symbol)).size!==priorRows.length)throw Error('Invalid original source rows');
  const oldRows=new Map(priorRows.map(row=>[row?.symbol,row]));
  if(typeof oldBase.as_of_date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(oldBase.as_of_date)||!Number.isFinite(Date.parse(oldBase.as_of_date))
    ||new Date(oldBase.as_of_date).toISOString().slice(0,10)!==oldBase.as_of_date||oldBase.as_of_date>index.as_of_date)throw Error('Recovery price input predates the original source base');
  for(const symbol of original.symbols){
    const old=oldRows.get(symbol),current=currentRows.get(symbol);
    if(!old||(old.market??oldBase.market)!=='US'||!current||current.market!=='US')throw Error(`Full cohort member is absent or foreign: ${symbol}`);
  }
  // Keep every original member, including a name that is no longer liquid.
  // The current liquidity count is diagnostic and cannot narrow this cohort.
  const base={schema_version:'financial-recovery-base-v1',market:'US',as_of_date:index.as_of_date,
    source:{url:PUBLIC_DATA_ROOT+path,manifest_url:PUBLIC_DATA_ROOT+'manifest.json',manifest_sha256:hash(manifestBytes),
      research_index_sha256:hash(indexBytes),generated_at:manifest.generated_at??null,observed_at:observedAt},
    liquidity:{min_price_usd:10,min_average_dollar_volume:20000000},universe_size:index.rows.length,eligible_size:currentLiquidCount,
    rows:index.rows.map(row=>({symbol:row.symbol,market:'US',current_price:row.current_price??null,adv_usd:row.adv_usd??null})),
    priority_basis:'retained_original_cohort_order_only',
    cohort_policy:'preserve_complete_original_source_cohort',retained_cohort_size:original.symbols.length};
  const baseBytes=Buffer.from(JSON.stringify(base));
  return {baseBytes,cohort:{symbols:[...original.symbols],base_artifact_sha256:hash(baseBytes)},
    bindings:{...bindings},current_liquid_count:currentLiquidCount};
}

export function planningArguments({source,output,archiveSha,observedAt}){
  return ['-m','app.scripts.manage_statement_archive','plan','--archive',join(source,'archive'),
    '--archive-sha256',archiveSha,'--base',join(output,'base.json'),'--cohort',join(output,'cohort.json'),
    '--now',observedAt,'--batch-limit','200','--output-directory',join(output,'planning')];
}

async function main(){
  const args=process.argv.slice(2);
  if(args.length!==4&&args.length!==5)throw Error('Usage: node prepare-statement-recovery-preflight.mjs CANONICAL_STATIC_DATA SOURCE_FILES HASH_BINDINGS_JSON NEW_OUTPUT [EXACT_PINNED_PRODUCER_CHECKOUT]');
  const [canonical,source,bindingsPath,output]=args.map(value=>resolve(value));
  for(let part=dirname(output);;part=dirname(part)){
    if(!lstatSync(part).isDirectory()||lstatSync(part).isSymbolicLink())throw Error('Invalid preflight output parent');
    if(part===dirname(part))break;
  }
  if([canonical,source,repositoryRoot].some(root=>output===root||output.startsWith(root+sep)||root.startsWith(output+sep)))throw Error('Preflight output must be separate from source, canonical input and controller');
  const bindings=JSON.parse(regular(bindingsPath,4096));
  const manifestBytes=regular(join(canonical,'manifest.json'),1024**2);
  const indexBytes=regular(join(canonical,researchPath(JSON.parse(manifestBytes))),10*1024**2);
  const sourceBaseBytes=regular(join(source,'base.json'),32*1024**2),sourceCohortBytes=regular(join(source,'cohort.json'),1024**2);
  bound(regular(join(source,'archive/manifest.json'),32*1024**2),bindings.source_archive_manifest_sha256,'Original archive manifest');
  const observedAt=new Date().toISOString();
  const pinnedDecoder=args[4]===undefined?undefined:await loadPinnedResearchDecoder(args[4]);
  const result=prepareRecoveryPreflightInputs({manifestBytes,indexBytes,sourceBaseBytes,sourceCohortBytes,bindings,observedAt,pinnedDecoder});
  mkdirSync(output,{recursive:false});
  const write=(name,value)=>writeFileSync(join(output,name),JSON.stringify(value,null,2),{flag:'wx'});
  writeFileSync(join(output,'base.json'),result.baseBytes,{flag:'wx'});write('cohort.json',result.cohort);
  const env={...process.env,PYTHONPATH:join(repositoryRoot,'backend')};
  for(const key of ['GH_TOKEN','GITHUB_TOKEN','PYTHONSTARTUP','PYTHONHOME'])delete env[key];
  // This existing CLI audits all retained receipt bytes and journals, then
  // calls the pure planner. No collect/runtime/dry-run-provider path exists.
  execFileSync('python3',planningArguments({source,output,archiveSha:bindings.source_archive_manifest_sha256,observedAt}),
    {cwd:repositoryRoot,env,stdio:['ignore','pipe','pipe'],maxBuffer:1024**2,timeout:20*60*1000});
  let planBytes=regular(join(output,'planning/plan.json'),32*1024**2);
  const reportBytes=regular(join(output,'planning/report.json'),32*1024**2),plan=JSON.parse(planBytes),report=JSON.parse(reportBytes);
  if(JSON.stringify([...plan.verified_us_cohort.symbols].sort())!==JSON.stringify([...result.cohort.symbols].sort())
    ||plan.verified_us_cohort.base_artifact_sha256!==result.cohort.base_artifact_sha256)throw Error('Planner changed the complete original cohort');
  // The pure planner sorts its full cohort, while receipt continuity keeps the
  // exact original order. This changes no selected work or target requirement.
  plan.verified_us_cohort=result.cohort;planBytes=Buffer.from(JSON.stringify(plan,null,2));
  writeFileSync(join(output,'planning/plan.json'),planBytes);
  const selectedSymbols=plan.selected.map(item=>item.symbol);
  if(JSON.stringify(selectedSymbols)!==JSON.stringify(plan.batch_allowlist)||JSON.stringify(selectedSymbols)!==JSON.stringify(report.batch.map(item=>item.symbol)))throw Error('Planner selection audit mismatch');
  write('preflight.json',{schema_version:'financial-recovery-offline-preflight-v1',evaluated_at:observedAt,
    publication_authority:'none',financial_admission:false,provider_execution:false,current_remote_continuity_verified:false,
    required_next_gate:'authenticate_latest_serial_recovery_attempt_and_review_current_execution_plan',
    bindings:result.bindings,base_sha256:hash(result.baseBytes),cohort_sha256:hash(Buffer.from(JSON.stringify(result.cohort,null,2))),
    plan_sha256:hash(planBytes),report_sha256:hash(reportBytes),original_cohort_count:result.cohort.symbols.length,
    current_liquid_count:result.current_liquid_count,batch_limit:200,selected_symbols:selectedSymbols,
    provider_state:report.provider_state,retry_decisions:[],source_rechecks:[],provider_resume:null});
  console.log(JSON.stringify({selected:selectedSymbols.length,provider_state:report.provider_state,publication_authority:'none',provider_execution:false}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)await main();
