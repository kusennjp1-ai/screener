// @vitest-environment node
import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareCompactDesign, COMPACT_DIAGNOSTICS, COMPACT_TOTAL_LIMIT, COMPACT_FILE_LIMIT, DIAGNOSTIC_FILE_LIMIT } from './prepare-compact-design.mjs';
const roots=[];
afterEach(async()=>{await Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true})));});
async function fixture() {const root=await mkdtemp(join(tmpdir(),'compact-design-'));roots.push(root);const source=join(root,'source'),target=join(root,'target');await mkdir(source);return {source,target};}
async function put(source,path,text='data') {const parts=path.split('/');if(parts.length>1)await mkdir(join(source,...parts.slice(0,-1)),{recursive:true});await writeFile(join(source,path),text);}
it('retains original reports and every screenshot plus only the named diagnostics, byte for byte',async()=>{
 const {source,target}=await fixture();const original=['report.json','summary.md','financial-carry-evidence.json','home.png','detail.png','diagnostic-initial-1440.cpuprofile','diagnostic-method-1440.cpuprofile'];
 for(const path of new Set([...original,...COMPACT_DIAGNOSTICS]))await put(source,path,`bytes:${path}`);
 for(const path of ['unbounded.trace.json','profile-sources/huge.map','radar-diagnostic/benchmark.js'])await put(source,path);
 const result=await prepareCompactDesign(source,target);
 expect(result.omitted).toEqual([]);expect(result.files.map(file=>file.path).sort()).toEqual([...new Set([...original,...COMPACT_DIAGNOSTICS])].sort());
 for(const file of result.files)expect(await readFile(join(target,file.path))).toEqual(await readFile(join(source,file.path)));
 expect(result.bytes).toBe(result.files.reduce((sum,file)=>sum+file.bytes,0));
});
it('bounds each optional diagnostic and the whole download without omitting required screenshots',async()=>{
 const {source,target}=await fixture();await put(source,'report.json','report');await put(source,'home.png','picture');
 await put(source,COMPACT_DIAGNOSTICS[0],'12345678901');await put(source,COMPACT_DIAGNOSTICS[1],'1234567890');await put(source,COMPACT_DIAGNOSTICS[2],'1234567890');
 const result=await prepareCompactDesign(source,target,{total:25,file:20,diagnostic:10});
 expect(result.bytes).toBe(23);expect(result.omitted.map(item=>item.path)).toEqual([COMPACT_DIAGNOSTICS[0],COMPACT_DIAGNOSTICS[2]]);
 expect(await readFile(join(target,'home.png'),'utf8')).toBe('picture');
});
it('fails before copying rather than silently dropping oversized acceptance evidence',async()=>{
 const {source,target}=await fixture();await put(source,'home.png','123456');
 await expect(prepareCompactDesign(source,target,{total:5,file:10,diagnostic:10})).rejects.toThrow('Required compact evidence');
 await expect(readdir(target)).rejects.toMatchObject({code:'ENOENT'});
 await expect(prepareCompactDesign(source,target,{total:10,file:5,diagnostic:10})).rejects.toThrow('Required compact evidence');
});
it('allows missing optional diagnostics but rejects stale nonempty destinations',async()=>{
 const {source,target}=await fixture();await put(source,'home.png');const result=await prepareCompactDesign(source,target);expect(result.files).toHaveLength(1);
 await expect(prepareCompactDesign(source,target)).rejects.toThrow('must be empty');
});
it('uses finite caps below the connector download ceiling',()=>{
 expect(COMPACT_TOTAL_LIMIT).toBe(128*1024*1024);expect(COMPACT_FILE_LIMIT).toBe(32*1024*1024);expect(DIAGNOSTIC_FILE_LIMIT).toBe(16*1024*1024);
 expect(COMPACT_DIAGNOSTICS.filter(path=>path.startsWith('diagnostic-continuous-'))).toEqual(['diagnostic-continuous-1440.cpuprofile','diagnostic-continuous-1440.trace.json','diagnostic-continuous-390.cpuprofile','diagnostic-continuous-390.trace.json']);
 expect(COMPACT_DIAGNOSTICS).toHaveLength(13);expect(COMPACT_DIAGNOSTICS.every(path=>!path.includes('*')&&!path.includes('..'))).toBe(true);
});

it('keeps missing early-failure evidence nonfatal, matching the existing warn-only upload',async()=>{
 const {source,target}=await fixture();await rm(source,{recursive:true});
 expect(await prepareCompactDesign(source,target)).toEqual({bytes:0,files:[],omitted:[]});
 expect(await readdir(target)).toEqual([]);
});

it('rejects symlinked source roots, diagnostic parents and target roots',async()=>{
 const {source,target}=await fixture();const outside=join(source,'..','outside');await mkdir(outside);await put(outside,'report.json','outside data');
 await symlink(outside,join(source,'radar-diagnostic'),'dir');
 await expect(prepareCompactDesign(source,target)).rejects.toThrow('directory must not be a symlink');
 await rm(join(source,'radar-diagnostic'));await rm(source,{recursive:true});await symlink(outside,source,'dir');
 await expect(prepareCompactDesign(source,target)).rejects.toThrow('directory must not be a symlink');
 await rm(source);await mkdir(source);await put(source,'report.json','safe');const destination=join(source,'..','destination');await mkdir(destination);await symlink(destination,target,'dir');
 await expect(prepareCompactDesign(source,target)).rejects.toThrow('directory must not be a symlink');
 expect(await readdir(destination)).toEqual([]);
});
it('rejects symbolic evidence files instead of following them',async()=>{
 const {source,target}=await fixture();await put(source,'other','not a screenshot');await symlink(join(source,'other'),join(source,'home.png'));
 await expect(prepareCompactDesign(source,target)).rejects.toThrow('not a file');
});
