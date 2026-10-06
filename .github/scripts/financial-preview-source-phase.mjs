// Large projection and compatibility graphs live only in an exiting worker.
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {isAbsolute,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertCorrectionProgress,dataInventory,digest,verifyConsumerCapability} from './financial-correction.mjs';
import {inventoryDigest,sha256} from './publication-state.mjs';
import {comparisonHeapArguments} from './financial-preview-comparison.mjs';
import {certifiedSourceDescriptor,nativeDestinationDescriptor} from './financial-candidate-preview-v2.mjs';
import {POSTCAPTURE_PREVIEW_SCHEMA,isCertifiedPreviewSchema,postcaptureSourceDescriptor} from './financial-candidate-preview-postcapture.mjs';
const schema='financial-preview-source-phase-v1',worker=fileURLToPath(import.meta.url);
const exact=(value,keys)=>{if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|'))throw Error('Invalid closed preview source phase');};
export function validateSourcePhase(input){
  const metadata=input?.kind==='projection_metadata',compatibility=input?.kind==='compatibility';
  if(!metadata&&!compatibility)throw Error('Unknown preview source phase');
  exact(input,['schema_version','kind','projection_path','projection_sha256',...(metadata?['request','source_evidence','source_files','certification','controller_root','projection_result','evaluated_at','previous_financial_generation']:['frontend_root','data_root','data_inventory_sha256'])]);
  if(input.schema_version!==schema||!isAbsolute(input.projection_path||'')||!/^[a-f0-9]{64}$/.test(input.projection_sha256||''))throw Error('Invalid preview projection phase identity');
  if(metadata){if(!isAbsolute(input.source_files||'')||!isAbsolute(input.controller_root||'')||!Number.isFinite(Date.parse(input.evaluated_at)))throw Error('Invalid projection metadata phase');}
  else if(!isAbsolute(input.frontend_root||'')||!isAbsolute(input.data_root||'')||!/^[a-f0-9]{64}$/.test(input.data_inventory_sha256||''))throw Error('Invalid compatibility phase');
  return input;
}
const verifyInputs=input=>{
  if(sha256(readFileSync(input.projection_path))!==input.projection_sha256)throw Error('Preview projection changed between phases');
  if(input.kind==='compatibility'&&inventoryDigest(dataInventory(input.data_root))!==input.data_inventory_sha256)throw Error('Compatibility data changed between phases');
};
export async function executeSourcePhase(input){
  validateSourcePhase(input);verifyInputs(input);
  const projection=JSON.parse(readFileSync(input.projection_path,'utf8'));
  let result;
  if(input.kind==='projection_metadata'){
    const {parsePreviewRequest,sourceOutcome}=await import('./financial-candidate-preview.mjs');
    const request=parsePreviewRequest(input.request),certified=isCertifiedPreviewSchema(request.schema_version);
    if(input.projection_result.projection_path!==input.projection_path||input.projection_result.projection_sha256!==input.projection_sha256
      || certified&&input.projection_result.source_projection_sha256!==projection.derivation?.source_projection_sha256)throw Error('Native preview source-projection result mismatch');
    assertCorrectionProgress(projection,input.previous_financial_generation);
    const sourceStatus=sourceOutcome(request,input.source_evidence,input.source_files,projection,input.certification);
    const selected=certified?{source_validation:(request.schema_version===POSTCAPTURE_PREVIEW_SCHEMA?postcaptureSourceDescriptor:certifiedSourceDescriptor)(input.certification,sourceStatus),
      destination_projection:nativeDestinationDescriptor(projection,input.projection_sha256,input.controller_root,readFileSync(input.projection_result.source_projection_path))}:{};
    result={sourceStatus,selected,comparison:{financial_generation:projection.financial_generation,symbols:Object.fromEntries(Object.keys(projection.symbols||{}).map(symbol=>[symbol,{}]))},
      financial:{generation:projection.financial_generation,projection_sha256:input.projection_sha256,receipt_inventory_sha256:projection.receipt_inventory_sha256,
        evaluated_at:input.evaluated_at,knowledge_basis:projection.knowledge_basis,point_in_time:false,source_publication_date:null}};
  }else{
    const consumer=await verifyConsumerCapability(input.frontend_root);
    result=await consumer.verifyCorrectionCompatibility({root:join(input.data_root,'static-data'),projection,evaluatedAt:Date.now()});
  }
  verifyInputs(input);
  return {input_sha256:digest(input),result,result_sha256:digest(result)};
}
export function runPreviewSourcePhase(input,{auditDirectory=null}={}){
  validateSourcePhase(input);
  const envelope=JSON.parse(execFileSync(process.execPath,[...comparisonHeapArguments(process.execArgv),worker],{input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024,env:process.env,stdio:['pipe','pipe','pipe']}));
  exact(envelope,['input_sha256','result','result_sha256']);
  if(envelope.input_sha256!==digest(input)||envelope.result_sha256!==digest(envelope.result))throw Error('Preview source phase result binding mismatch');
  verifyInputs(input);
  if(auditDirectory){mkdirSync(auditDirectory,{recursive:true});writeFileSync(join(auditDirectory,'phase.json'),JSON.stringify({input,...envelope},null,2)+'\n');}
  return envelope.result;
}
if(process.argv[1]&&resolve(process.argv[1])===worker){
  try{process.stdout.write(JSON.stringify(await executeSourcePhase(JSON.parse(readFileSync(0,'utf8')))));}
  catch(error){console.error(error.stack||error);process.exitCode=1;}
}
