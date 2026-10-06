import test from 'node:test';
import assert from 'node:assert/strict';
import {linkSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {financialAuditInventory,validateFinancialAuditFiles,requiredFinancialAuditFiles,assertFinancialAuditPreserved,parsePublicationReceipt} from './financial-audit-history.mjs';
import {restorePublishedFinancialSource,writeFinancialReleaseReceipt,verifyFinancialReleaseAssets,sourceLineage} from './financial-release-activation.mjs';
import {lifecycleFixture,read} from './fixtures/financial-release-lifecycle.mjs';
import {createFinancialGenerationCarry} from '../../frontend/tools/financial-generation-carry.mjs';
import {sha256,validateReceipt} from './publication-state.mjs';

const H='a'.repeat(64),path=`static-data/financial-corrections/release-${H}.json`;
test('financial audit metadata rejects unsafe, mismatched, duplicate and oversized declarations',()=>{
  const files={[path]:H};assert.equal(validateFinancialAuditFiles(files),files);
  for(const value of [{},{[path]:'b'.repeat(64)},{wrong:undefined},{wrong:H},[],{[`../${path}`]:H},{[path.toUpperCase()]:H},{[path+'?x']:H}])assert.throws(()=>validateFinancialAuditFiles(value));
  const many=Object.fromEntries(Array.from({length:7000},(_,i)=>{const hash=sha256(String(i));return [`static-data/financial-corrections/release-${hash}.json`,hash];}));
  assert.throws(()=>validateFinancialAuditFiles(many),/bounded/);
  assert.throws(()=>validateReceipt({padding:'x'.repeat(4*1024*1024)}),/browser byte limit/);
  assert.throws(()=>parsePublicationReceipt(' '.repeat(4*1024*1024)+'{}'),/browser byte limit/);
  for(const raw of [`{"financial_audit_files":{"${path}":"${H}","${path}":"${H}"}}`,'{"schema":1,"\\u0073chema":1}','{"x":[{"a":1,"a":2}]}'])assert.throws(()=>parsePublicationReceipt(raw),/Duplicate/);
  assert.deepEqual(parsePublicationReceipt('{"a":[{"b":1},{"b":2}],"string":"{\\"key\\":1}"}'),{a:[{b:1},{b:2}],string:'{"key":1}'});
});

test('inventory comparison is order independent while changed hashes and dropped history fail',()=>{
  const before={[path]:H,[`static-data/financial-corrections/source-base-${H}.json`]:H};
  assert.doesNotThrow(()=>assertFinancialAuditPreserved(before,Object.fromEntries(Object.entries(before).reverse())));
  assert.throws(()=>assertFinancialAuditPreserved(before,{[path]:H}),/removed or changed/);
  assert.throws(()=>assertFinancialAuditPreserved(before,{...before,[path]:'b'.repeat(64)}),/content-addressed/);
});

test('audit scanning rejects file links, directory links, hard links, special files and changed bytes',()=>{
  const root=mkdtempSync(join(tmpdir(),'financial-audit-files-')),base=join(root,'static-data/financial-corrections');mkdirSync(base,{recursive:true});
  const bytes='{"audit":"opaque bytes"}',hash=sha256(bytes),file=join(base,`release-${hash}.json`);
  try{
    writeFileSync(file,bytes);assert.equal(Object.keys(financialAuditInventory(root)).length,1);
    writeFileSync(file,'changed');assert.throws(()=>financialAuditInventory(root),/content-addressed/);rmSync(file);
    const outside=join(root,'outside');writeFileSync(outside,bytes);
    symlinkSync(outside,file);assert.throws(()=>financialAuditInventory(root),/linked/);rmSync(file);
    linkSync(outside,file);assert.throws(()=>financialAuditInventory(root),/Linked/);rmSync(file);
    execFileSync('mkfifo',[file]);assert.throws(()=>financialAuditInventory(root),/linked/);rmSync(file);
    rmSync(base,{recursive:true});symlinkSync(root,base);assert.throws(()=>financialAuditInventory(root),/directory/);rmSync(base);
    rmSync(join(root,'static-data'),{recursive:true});symlinkSync(root,join(root,'static-data'));assert.throws(()=>financialAuditInventory(root),/directory/);
  }finally{rmSync(root,{recursive:true,force:true});}
});

test('clean-directory R0 to C1 to C2 to C3 restores every authentic receipt and evaluation',async()=>{
  const f=lifecycleFixture(),scratch=mkdtempSync(join(tmpdir(),'financial-audit-carries-'));f.seed();
  try{
    let root=f.liveRoot,publication=read(join(root,'publication.json')),receipt=read(join(root,publication.financial_release.path));
    const origin=publication.financial_release,original=financialAuditInventory(root),originBytes=readFileSync(join(root,origin.path));
    assert.equal(publication.financial_audit_files,undefined);
    for(let index=1;index<=3;index++){
      const previousFiles=financialAuditInventory(root),previousRoot=root,priorReceipt=receipt;
      const live={identity:`${30+index}/1/${sha256(JSON.stringify(publication))}/${publication.data_manifest_sha256}`,receipt:publication,financialRelease:receipt};
      root=join(scratch,`carry-${index}`);mkdirSync(root);
      const fetcher=async url=>({ok:true,arrayBuffer:async()=>readFileSync(join(previousRoot,new URL(url).pathname.split('/screener/')[1]))});
      if(index>1){
        const missing=structuredClone(live);delete missing.receipt.financial_audit_files;
        assert.throws(()=>requiredFinancialAuditFiles(missing),/unindexed carry/);
        const omitted=structuredClone(live);delete omitted.receipt.financial_audit_files[receipt.source_base.path];
        await assert.rejects(()=>restorePublishedFinancialSource(omitted,root,fetcher),/omits active/);
        await assert.rejects(()=>restorePublishedFinancialSource(live,root,async url=>String(url).includes(origin.path)?{ok:false,status:404}:fetcher(url)),/Cannot restore/);
        await assert.rejects(()=>restorePublishedFinancialSource(live,root,async()=>({ok:true,arrayBuffer:async()=>Buffer.from('changed')})),/disagree/);
      }
      await restorePublishedFinancialSource(live,root,fetcher);
      assertFinancialAuditPreserved(previousFiles,financialAuditInventory(root));
      assert.deepEqual(readFileSync(join(root,origin.path)),originBytes);
      const evaluatedAt=`2026-10-0${4+index}T12:00:00.000Z`;
      const carry=createFinancialGenerationCarry({sourceProjection:f.original.bytes,sourceProjectionSha256:sha256(f.original.bytes),sourceBase:f.original.base,
        sourceBaseSha256:sha256(f.original.base),sourceLineage:receipt.lineage_sha256,previousPublicationIdentity:live.identity,targetBase:f.original.base,targetBaseSha256:sha256(f.original.base),evaluatedAt});
      const prepared=writeFinancialReleaseReceipt({dist:root,mode:'carry',previousIdentity:live.identity,lineage:{id:receipt.lineage_sha256,value:receipt.lineage},
        sourceProjectionBytes:f.original.bytes,sourceBaseBytes:f.original.base,evaluationBytes:JSON.stringify(carry),generation:carry.financial_generation,evaluatedAt,
        ui:receipt.ui,priceInput:receipt.price_input});
      receipt=prepared.receipt;
      publication={...publication,financial_release:prepared.reference,financial_lineage_sha256:receipt.lineage_sha256,financial_generation:receipt.financial_generation,
        financial_audit_files:financialAuditInventory(root)};
      validateReceipt(publication);assertFinancialAuditPreserved(requiredFinancialAuditFiles(live),publication.financial_audit_files);
      verifyFinancialReleaseAssets(root,prepared.reference);
      for(const ref of [origin,live.receipt.financial_release,priorReceipt.evaluation_projection])assert.equal(publication.financial_audit_files[ref.path],ref.sha256);
    }
    assertFinancialAuditPreserved(original,financialAuditInventory(root));
    assert.equal(read(join(root,origin.path)).mode,'activation','later origin readers can still load the actual R0 receipt');
    const bad=structuredClone(publication);delete bad.financial_audit_files[bad.financial_release.path];
    assert.throws(()=>validateReceipt(bad),/lost the active release/);
    const retained=Object.keys(publication.financial_audit_files).find(key=>key!==publication.financial_release.path);
    rmSync(join(root,retained));assert.throws(()=>assertFinancialAuditPreserved(publication.financial_audit_files,financialAuditInventory(root)),/removed or changed/);
  }finally{f.cleanup();rmSync(scratch,{recursive:true,force:true});}
});


test('restoration rejects a destination replaced by a symlink after inventory but before write',async()=>{
  const f=lifecycleFixture(),root=mkdtempSync(join(tmpdir(),'financial-audit-race-'));f.seed();
  try{
    const publication=read(join(f.liveRoot,'publication.json')),receipt=read(join(f.liveRoot,publication.financial_release.path));
    const live={receipt:publication,financialRelease:receipt},outside=join(root,'outside');writeFileSync(outside,'outside must remain exact');
    await assert.rejects(()=>restorePublishedFinancialSource(live,root,async url=>{
      const path=new URL(url).pathname.split('/screener/')[1];mkdirSync(join(root,'static-data/financial-corrections'),{recursive:true});
      symlinkSync(outside,join(root,path));return {ok:true,arrayBuffer:async()=>readFileSync(join(f.liveRoot,path))};
    }),/ELOOP|linked|Linked/);
    assert.equal(readFileSync(outside,'utf8'),'outside must remain exact');
  }finally{f.cleanup();rmSync(root,{recursive:true,force:true});}
});

// This opt-in byte-only smoke uses the retained real projection and target base.
// Only the activation envelope is synthetic; it is never publication evidence.
test('retained real source bytes survive inventory and clean-directory restoration',{
  skip:!process.env.FINANCIAL_AUDIT_SOURCE_CANDIDATE,
},async()=>{
  const candidate=process.env.FINANCIAL_AUDIT_SOURCE_CANDIDATE,f=lifecycleFixture(),root=mkdtempSync(join(tmpdir(),'financial-real-audit-'));f.seed();
  try{
    const preview=read(join(candidate,'preview-receipt.json'));
    const source=readFileSync(join(candidate,'projection',`native-annual-projection-${preview.financial.projection_sha256}.json`));
    const base=readFileSync(join(candidate,'target-base.json')),projection=JSON.parse(source);
    assert.equal(sha256(source),preview.financial.projection_sha256);
    assert.equal(sha256(base),projection.bindings.target_base_sha256);
    const sourceAuthority=sourceLineage({source:preview.source,certificate:preview.source_validation.certificate.reference,
      sourceProjectionSha256:sha256(source),receiptInventorySha256:preview.financial.receipt_inventory_sha256,projectionPolicy:projection.policy});
    const publication=read(join(f.liveRoot,'publication.json')),template=read(join(f.liveRoot,publication.financial_release.path));
    const prepared=writeFinancialReleaseReceipt({dist:root,mode:'activation',previousIdentity:template.previous_publication_identity,lineage:sourceAuthority,
      sourceProjectionBytes:source,sourceBaseBytes:base,evaluationBytes:source,generation:projection.financial_generation,evaluatedAt:projection.financial_evaluated_at,
      ui:template.ui,priceInput:template.price_input,candidate:template.candidate});
    const files=financialAuditInventory(root),live={financialRelease:prepared.receipt,receipt:{...publication,financial_release:prepared.reference,
      financial_lineage_sha256:sourceAuthority.id,financial_audit_files:files}};
    const restored=join(root,'clean-restore');mkdirSync(restored);
    await restorePublishedFinancialSource(live,restored,async url=>new Response(readFileSync(join(root,new URL(url).pathname.split('/screener/')[1]))));
    assert.deepEqual(financialAuditInventory(restored),files);
    assert.deepEqual(readFileSync(join(restored,prepared.receipt.source_projection.path)),source);
    assert.deepEqual(readFileSync(join(restored,prepared.receipt.source_base.path)),base);
    assert.deepEqual(read(join(restored,prepared.reference.path)),prepared.receipt);
    console.log(JSON.stringify({scope:'byte-only real-source smoke; synthetic activation authority; no publication',source_projection_sha256:sha256(source),source_projection_bytes:source.length,
      source_base_sha256:sha256(base),source_base_bytes:base.length,audit_files:Object.keys(files).length}));
  }finally{f.cleanup();rmSync(root,{recursive:true,force:true});}
});
