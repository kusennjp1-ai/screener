import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,rmSync,symlinkSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {publicationVerifierPin as pin,assertPublicationVerifier,preparePublicationVerifier} from './targeted-publication-verifier.mjs';

function fixture(){
  const calls=[],state={sha:pin.sha,tree:pin.tree,dirty:''};
  return {calls,state,executeGit:(args,cwd)=>{
    calls.push({args,cwd});
    if(args[0]==='rev-parse')return args[1].endsWith('^{tree}')?state.tree:state.sha;
    if(args[0]==='status')return state.dirty;
    assert.ok(['init','fetch','checkout'].includes(args[0]));return '';
  }};
}
test('exact reviewed main verifier is fetched once and every invocation keeps its complete verifier result',async()=>{
  const root=mkdtempSync(join(tmpdir(),'targeted-verifier-')),f=fixture();let imports=0,verifications=0;
  try{
    const directory=join(root,'main'),live={receipt:{approval:{type:'performance-exception-v2'}},financialRelease:{verified:true}};
    const verify=await preparePublicationVerifier(directory,{executeGit:f.executeGit,importer:async url=>{
      imports++;assert.equal(url,new URL(`file://${directory}/.github/scripts/publication-state.mjs`).href);
      return {livePublication:async options=>{verifications++;assert.equal(options.repository,pin.repository);return live;}};
    }});
    assert.equal(await verify({repository:pin.repository}),live);assert.equal(await verify({repository:pin.repository}),live);
    assert.equal(imports,1);assert.equal(verifications,2);
    assert.deepEqual(f.calls.filter(c=>c.args[0]==='fetch').map(c=>c.args),[['fetch','--depth=1','--no-tags','https://github.com/kusennjp1-ai/screener.git',pin.sha]]);
    assert.equal(f.calls.filter(c=>c.args[0]==='status').length,5);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('wrong fetched commit/tree and failed fetch cannot import or fall back',async()=>{
  for(const mutation of [f=>f.state.sha='a'.repeat(40),f=>f.state.tree='b'.repeat(40),f=>{f.executeGit=()=>{throw Error('fetch denied');};}]){
    const root=mkdtempSync(join(tmpdir(),'targeted-verifier-')),f=fixture();mutation(f);let imported=false;
    try{await assert.rejects(preparePublicationVerifier(join(root,'main'),{executeGit:f.executeGit,importer:async()=>{imported=true;return {};}}));assert.equal(imported,false);}
    finally{rmSync(root,{recursive:true,force:true});}
  }
});
test('dirty, untracked and post-verification changes fail closed',async()=>{
  const root=mkdtempSync(join(tmpdir(),'targeted-verifier-')),f=fixture();
  try{
    for(const dirty of [' M .github/scripts/publication-state.mjs','?? injected.mjs','x'.repeat(2*1024**2)]){
      f.state.dirty=dirty;assert.throws(()=>assertPublicationVerifier(root,f.executeGit),/exact and clean/);
    }
    f.state.dirty='';const verify=await preparePublicationVerifier(join(root,'main'),{executeGit:f.executeGit,importer:async()=>({livePublication:async()=>{f.state.dirty='?? changed';return {};}})});
    await assert.rejects(verify({}),/exact and clean/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('publication rejection propagates without treating a recognized approval as accepted',async()=>{
  const root=mkdtempSync(join(tmpdir(),'targeted-verifier-')),f=fixture();
  try{
    const verify=await preparePublicationVerifier(join(root,'main'),{executeGit:f.executeGit,importer:async()=>({livePublication:async()=>{throw Error('Invalid authentic certificate');}})});
    await assert.rejects(verify({}),/Invalid authentic certificate/);
  }finally{rmSync(root,{recursive:true,force:true});}
});
test('existing destinations and linked parents are rejected before repository fetch',async()=>{
  const root=mkdtempSync(join(tmpdir(),'targeted-verifier-')),f=fixture();
  try{
    mkdirSync(join(root,'existing'));symlinkSync(root,join(root,'link'));
    for(const path of [join(root,'existing'),join(root,'link/main')])await assert.rejects(preparePublicationVerifier(path,{executeGit:f.executeGit}));
    assert.equal(f.calls.length,0);
  }finally{rmSync(root,{recursive:true,force:true});}
});
