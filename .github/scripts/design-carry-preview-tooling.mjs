// Preview-only execution identity. This grants no publisher tooling authority
// and never changes the tracked exporter or any financial evidence/verifier.
import {existsSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {sha256} from './publication-state.mjs';

const ORIGINAL_SHA256='90e9f7316b34f171a726bc9245805e67e8d316b7367e288924ce568583fc3946';
const AMENDED_SHA256='f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40';
const originalLine='    canonicalChart=projectFinancialPayload(overlayFinancialChart(await read(paths.get(symbol)),correction,symbol),{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});';
const amendedLines='    canonicalChart=overlayFinancialChart(await read(paths.get(symbol)),correction,symbol);\n    if (!carry) canonicalChart=projectFinancialPayload(canonicalChart,{now:evaluatedAt,asOfDate:scan.as_of_date,market:row.market});';

export function designCarryPreviewTooling({repoRoot,candidateSha,provenanceSha256,predecessorIdentity,targetBaseSha256,projectionSha256,generation}){
  const original=readFileSync(join(repoRoot,'frontend/tools/export-research.mjs'));
  if(sha256(original)!==ORIGINAL_SHA256||original.toString().split(originalLine).length!==2)throw Error('Preview-only tooling requires its exact original exporter');
  const amended=Buffer.from(original.toString().replace(originalLine,amendedLines));
  if(sha256(amended)!==AMENDED_SHA256)throw Error('Preview-only exporter amendment changed');
  return {bytes:amended,binding:{schema:'design-carry-preview-tooling-v1',amendment:'carry-chart-single-projection-v1',publication_authority:'none',candidate_sha:candidateSha,
    input_provenance_sha256:provenanceSha256,predecessor_identity:predecessorIdentity,target_base_sha256:targetBaseSha256,carry_projection_sha256:projectionSha256,destination_generation:generation,
    original:{path:'frontend/tools/export-research.mjs',sha256:ORIGINAL_SHA256,bytes:original.length},preview:{sha256:AMENDED_SHA256,bytes:amended.length}}};
}

export function runDesignCarryPreviewExport({frontend,bytes,env,run}){
  // Preserve module-relative imports without replacing or staging the tracked
  // exporter. The exact temporary entrypoint is removed even when export fails.
  const name='.design-carry-preview-export.mjs',path=join(frontend,'tools',name);
  if(existsSync(path))throw Error('Preview exporter entrypoint must be new');
  if(sha256(bytes)!==AMENDED_SHA256)throw Error('Unbound preview exporter bytes');
  writeFileSync(path,bytes,{flag:'wx'});
  try{return run(name,frontend,env);}finally{rmSync(path);}
}
