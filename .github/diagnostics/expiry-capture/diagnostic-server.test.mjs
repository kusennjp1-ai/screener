// @vitest-environment node
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,extname} from 'node:path';
import {runInNewContext} from 'node:vm';
import {expect,it} from 'vitest';

it('serves the real diagnostic root as HTML while retaining asset MIME types and missing-file behavior',async()=>{
 const dist=await mkdtemp(join(tmpdir(),'expiry-http-regression-'));
 let server;
 try{
  await mkdir(join(dist,'assets'));await mkdir(join(dist,'static-data'));
  const html='<!doctype html><html><title>Expiry HTTP regression only</title></html>';
  await writeFile(join(dist,'index.html'),html);await writeFile(join(dist,'assets','test.js'),'export const fixture = true;');await writeFile(join(dist,'static-data','test.json'),'{}');
  // Load only the actual server declaration. Importing the runner would execute
  // its top-level browser launch, which is deliberately excluded from this test.
  const source=await readFile(new URL('./run-browser.mjs',import.meta.url),'utf8');
  const start=source.indexOf('const server=createServer('),end=source.indexOf('\nawait new Promise(done=>server.listen',start);
  assert.ok(start>=0&&end>start,'Expected diagnostic server declaration not found');
  server=runInNewContext(`${source.slice(start,end)}\nserver`,{createServer,readFile,join,extname,assert,dist,URL});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));const base=`http://127.0.0.1:${server.address().port}`;
  for(const path of ['/screener/','/screener/?method=oneil&symbol=AVT','/screener/index.html']){
   const response=await fetch(base+path,{signal:AbortSignal.timeout(2000)});expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe('text/html');expect(await response.text()).toBe(html);
  }
  for(const [path,mime,body] of [['assets/test.js','text/javascript','export const fixture = true;'],['static-data/test.json','application/json','{}']]){
   const response=await fetch(`${base}/screener/${path}`,{signal:AbortSignal.timeout(2000)});expect(response.status).toBe(200);expect(response.headers.get('content-type')).toBe(mime);expect(await response.text()).toBe(body);
  }
  const missing=await fetch(`${base}/screener/missing.json`,{signal:AbortSignal.timeout(2000)});expect(missing.status).toBe(404);expect(await missing.text()).toBe('Not found');
 }finally{if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}await rm(dist,{recursive:true,force:true});}
});
