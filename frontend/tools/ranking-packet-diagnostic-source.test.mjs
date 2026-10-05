// @vitest-environment node
import {expect,it}from'vitest';
import {build}from'esbuild';
import {fileURLToPath}from'node:url';
import {readFile,mkdtemp,mkdir,symlink,rm}from'node:fs/promises';
import {join}from'node:path';
import {tmpdir}from'node:os';
import {readDiagnosticSource}from'./ranking-packet-diagnostic-source.mjs';
const root=fileURLToPath(new URL('..',import.meta.url)),roots={baseline:root,candidate:root};
it('serves the complete actual browser Worker/preprocessor graph including all three JSON contracts',async()=>{
 const result=await build({absWorkingDir:root,entryPoints:['src/static/researchWorker.js'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',logLevel:'silent'});
 const inputs=Object.keys(result.metafile.inputs);
 expect(inputs.filter(path=>path.startsWith('contracts/'))).toHaveLength(3);
 for(const flavor of ['baseline','candidate'])for(const path of inputs){
  const value=await readDiagnosticSource(roots,`/${flavor}/${path}`);
  expect(value.body).toEqual(await readFile(join(root,path)));
  expect(value.type).toBe(path.endsWith('.json')?'application/json':'text/javascript');
 }
});
it.each(['/candidate/package.json','/unknown/src/static/researchWorker.js','/candidate/contracts/other.json','/candidate/src/../../package.js','/candidate/src//static/researchWorker.js','/candidate/src/static/researchWorker.js?x=1','/candidate/src/static/researchWorker.js/extra'])('rejects route %s',async path=>{
 await expect(readDiagnosticSource(roots,path)).rejects.toThrow();
});
it('rejects a source symlink escaping its checkout',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'ranking-route-'));
 try{await mkdir(join(dir,'src'));await symlink(join(root,'src/static/researchWorker.js'),join(dir,'src/escape.js'));
 await expect(readDiagnosticSource({baseline:dir,candidate:dir},'/candidate/src/escape.js')).rejects.toThrow('escaped');
 }finally{await rm(dir,{recursive:true,force:true});}
});
