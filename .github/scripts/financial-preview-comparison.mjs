// Preview verification uses a fresh process so a preceding compiler replay or
// parsed source projection cannot consume the strict comparator's heap.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareCorrectionData, dataInventory, digest } from './financial-correction.mjs';
import { inventoryDigest, sha256 } from './publication-state.mjs';
const schema = 'financial-preview-comparison-phase-v1';
const worker = fileURLToPath(import.meta.url);
// Resolve a filesystem sibling from the Node module path. Browser-oriented
// test transforms may rewrite static new URL(..., import.meta.url) as an asset.
const comparator = join(dirname(worker), 'financial-correction.mjs');
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const exact = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join('\0') !== [...keys].sort().join('\0')) throw Error('Invalid closed preview comparison phase');
};
export function validateComparisonPhase(input) {
  exact(input, ['schema_version','before','after','frontend_root','originals','evaluated_at','projection','projection_sha256','comparator_sha256']);
  if (input.schema_version !== schema || !isAbsolute(input.frontend_root || '') || !hash(input.comparator_sha256)
    || !Number.isFinite(Date.parse(input.evaluated_at)) || new Date(input.evaluated_at).toISOString() !== input.evaluated_at) throw Error('Invalid preview comparison identity');
  if (!Array.isArray(input.originals) || input.originals.length > 2) throw Error('Invalid original comparison inputs');
  for (const value of [input.before,input.after,...input.originals]) {
    exact(value,['root','inventory_sha256']);
    if (!isAbsolute(value.root || '') || !hash(value.inventory_sha256)) throw Error('Invalid preview comparison input');
  }
  exact(input.projection,['symbols','financial_generation']);
  if (!Array.isArray(input.projection.symbols) || input.projection.symbols.some(symbol=>typeof symbol !== 'string' || !symbol)
    || new Set(input.projection.symbols).size !== input.projection.symbols.length
    || input.projection.financial_generation !== null && !hash(input.projection.financial_generation)
    || digest(input.projection) !== input.projection_sha256) throw Error('Invalid comparison projection binding');
  return input;
}
const validateInventories = input => {
  if (sha256(readFileSync(comparator)) !== input.comparator_sha256) throw Error('Preview comparator code changed');
  for (const value of [input.before,input.after,...input.originals]) {
    if (inventoryDigest(dataInventory(value.root)) !== value.inventory_sha256) throw Error('Preview comparison input inventory changed');
  }
};
export function comparisonHeapArguments(args) {
  const output=[];
  for(let index=0;index<args.length;index++){
    if(/^--(?:max[-_]old[-_]space[-_]size|max[-_]semi[-_]space[-_]size)=\d+$/.test(args[index]))output.push(args[index]);
    else if(/^--(?:max[-_]old[-_]space[-_]size|max[-_]semi[-_]space[-_]size)$/.test(args[index]) && /^\d+$/.test(args[index+1] || ''))output.push(args[index],args[++index]);
  }
  return output;
}
export async function executeComparisonPhase(input) {
  validateComparisonPhase(input); validateInventories(input);
  const projection = { symbols: Object.fromEntries(input.projection.symbols.map(symbol=>[symbol,{}])),
    ...(input.projection.financial_generation === null ? {} : {financial_generation:input.projection.financial_generation}) };
  const result = await compareCorrectionData(input.before.root,input.after.root,input.frontend_root,projection);
  validateInventories(input);
  return {schema_version:schema,input_sha256:digest(input),result,result_sha256:digest(result)};
}
export function comparePreviewDataIsolated(beforeRoot,afterRoot,frontendRoot,projection,{evaluatedAt,originals=[],auditDirectory=null,expectedInventories=null}={}) {
  const identity = root => ({root:resolve(root),inventory_sha256:inventoryDigest(dataInventory(root))});
  const selected = {symbols:Object.keys(projection.symbols || {}).sort(),financial_generation:projection.financial_generation ?? null};
  const input = validateComparisonPhase({schema_version:schema,before:identity(beforeRoot),after:identity(afterRoot),
    frontend_root:resolve(frontendRoot),originals:originals.map(identity),evaluated_at:evaluatedAt,
    projection:selected,projection_sha256:digest(selected),comparator_sha256:sha256(readFileSync(comparator))});
  if(expectedInventories){exact(expectedInventories,['before','after']);if(input.before.inventory_sha256!==expectedInventories.before||input.after.inventory_sha256!==expectedInventories.after)throw Error('Normalized comparison inventory changed between phases');}
  // Preserve heap flags passed directly to Node as well as inherited NODE_OPTIONS.
  // Do not forward test runners, inspectors or eval arguments to the worker.
  const heapArgs=comparisonHeapArguments(process.execArgv);
  const envelope=JSON.parse(execFileSync(process.execPath,[...heapArgs,worker],{
    input:JSON.stringify(input),encoding:'utf8',maxBuffer:1024*1024,env:process.env,stdio:['pipe','pipe','pipe'],
  }));
  exact(envelope,['schema_version','input_sha256','result','result_sha256']);
  exact(envelope.result,['semantic_sha256','universe_sha256','before_inventory_sha256','after_inventory_sha256']);
  if(envelope.schema_version!==schema || envelope.input_sha256!==digest(input) || envelope.result_sha256!==digest(envelope.result)
    || !Object.values(envelope.result).every(hash) || envelope.result.before_inventory_sha256!==input.before.inventory_sha256
    || envelope.result.after_inventory_sha256!==input.after.inventory_sha256)throw Error('Preview comparison result binding mismatch');
  validateInventories(input);
  if(auditDirectory){mkdirSync(auditDirectory,{recursive:true});writeFileSync(join(auditDirectory,'input.json'),JSON.stringify(input,null,2)+'\n');writeFileSync(join(auditDirectory,'result.json'),JSON.stringify(envelope,null,2)+'\n');}
  return envelope.result;
}
if (process.argv[1] && resolve(process.argv[1]) === worker) {
  try { process.stdout.write(JSON.stringify(await executeComparisonPhase(JSON.parse(readFileSync(0,'utf8'))))); }
  catch(error) { console.error(error.stack || error); process.exitCode=1; }
}
