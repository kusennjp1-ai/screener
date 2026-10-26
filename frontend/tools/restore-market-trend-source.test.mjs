// @vitest-environment node
import {it,expect} from 'vitest';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {exportMarketTrends,buildMarketTrends} from './export-market-trends.mjs';
import {restoreMarketTrendSource} from './restore-market-trend-source.mjs';
import {pack} from './static-transport/pack.mjs';
import {inventoryDigest} from '../../.github/scripts/publication-state.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const date='2026-10-23',next='2026-10-26';

async function fixture({withFeature=true,mutateEntry}={}){
 const directory=await mkdtemp(join(tmpdir(),'market-restore-')),source=join(directory,'source'),root=join(source,'static-data'),output=join(directory,'packed'),fresh=join(directory,'fresh');
 await mkdir(root,{recursive:true});await mkdir(fresh);
 await mkdir(join(root,'markets/us/charts'),{recursive:true});await writeFile(join(root,'markets/us/charts/TEST.json'),JSON.stringify({symbol:'TEST',bars:[],synthetic:true}));
 const entry={market:'US',as_of_date:date,assets:{}};
 if(withFeature)await exportMarketTrends({root,entry,asOfDate:date});
 mutateEntry?.(entry);
 const manifest=JSON.stringify({markets:{US:entry}});await writeFile(join(root,'manifest.json'),manifest);await writeFile(join(fresh,'manifest.json'),JSON.stringify({markets:{US:{market:'US',as_of_date:next}}}));
 const html='<!doctype html><title>test only</title>',sw='// test only';await writeFile(join(source,'index.html'),html);await writeFile(join(source,'sw.js'),sw);
 const uiFiles={'index.html':hash(html),'sw.js':hash(sw)},uiDigest=inventoryDigest(uiFiles),sha='4'.repeat(40);
 const bindings={manifestSha256:hash(manifest),uiInventorySha256:uiDigest,financialGeneration:null,financialLineageSha256:null,sourceCommit:'3'.repeat(40),appCommit:sha,candidateId:'5'.repeat(64)};
 const packed=await pack({source,output,bindings});
 const publication={schema:1,run_id:1,run_attempt:1,artifact_name:'github-pages-1-1',ui_sha:sha,ui_files:uiFiles,ui_digest:uiDigest,data_manifest_sha256:hash(manifest),verification_universe:{as_of_date:date,required_symbols:['TEST'],minimum_target:.9,total:1,verified:1},price_observations:{},known_price_dates:{},transport:{schema_version:'static-json-transport-publication-v1',root:packed.expectedRoot,logical_data_inventory_sha256:inventoryDigest(Object.fromEntries(Object.entries(packed.logicalInventory).map(([path,value])=>[path,value.sha256]))),physical_inventory_sha256:inventoryDigest(Object.fromEntries(Object.entries(packed.physicalInventory).map(([path,value])=>[path,value.sha256]))),ui_sha:sha,ui_digest:uiDigest}};
 await writeFile(join(output,'publication.json'),JSON.stringify(publication));
 const fetchImpl=async url=>{try{return new Response(await readFile(join(output,new URL(url).pathname.slice('/screener/'.length))));}catch(error){if(error.code==='ENOENT')return new Response(null,{status:404});throw error;}};
 return {directory,entry,output,fresh,fetchImpl,publication,cleanup:()=>rm(directory,{recursive:true,force:true})};
}

it('restores verified packed day N into a fresh daily directory; failed providers retain history and leave day N+1 unknown',async()=>{
 const f=await fixture();try{
  await expect(readFile(join(f.fresh,'market-trend-source.json'))).rejects.toMatchObject({code:'ENOENT'});
  const result=await restoreMarketTrendSource({root:f.fresh,fetchImpl:f.fetchImpl});expect(result).toMatchObject({restored:true,origin:'verified_publication',as_of_date:date});
  const previous=JSON.parse(await readFile(join(f.fresh,'market-trend-source.json'),'utf8'));
  // Advance only the test clock beyond Monday's close. The production collector
  // and real independent NYSE calendar execute; every external provider fails.
  const code="import importlib.util,sys\nfrom datetime import datetime,timezone\nfrom unittest.mock import patch\nfrom urllib.error import URLError\ns=importlib.util.spec_from_file_location('c',sys.argv[1]);c=importlib.util.module_from_spec(s);s.loader.exec_module(c)\nclass Clock(datetime):\n @classmethod\n def now(cls,tz=None): return cls(2026,10,27,1,tzinfo=timezone.utc)\nwith patch.object(c,'datetime',Clock),patch.object(c,'fetch',side_effect=URLError('offline lifecycle test')): c.collect('2026-10-26',sys.argv[2],allow_unavailable=True)\n";
  const calendarPython=process.env.SESSION_CALENDAR_PYTHON||(process.env.RUNNER_TEMP&&join(process.env.RUNNER_TEMP,'session-calendar-runtime/bin/python'));
  const python=calendarPython&&existsSync(calendarPython)?calendarPython:process.platform==='win32'?'python':'python3';
  execFileSync(python,['-c',code,resolve('tools/collect-market-trends.py'),join(f.fresh,'market-trend-source.json')],{encoding:'utf8',timeout:30000});
  const current=JSON.parse(await readFile(join(f.fresh,'market-trend-source.json'),'utf8'));
  expect(current.as_of_date).toBe(next);expect(current.put_call.observations).toHaveLength(64);
  for(const old of previous.put_call.observations){const retained=current.put_call.observations.find(row=>row.date===old.date);expect(retained).toMatchObject(old);}
  expect(current.put_call.observations.at(-1)).toMatchObject({date:next,calls:null,puts:null});
  const projected=buildMarketTrends(current,{asOfDate:next});expect(projected.indices.map(index=>index.latest)).toEqual([null,null]);expect(projected.indices.every(index=>index.historical&&index.points.at(-1).date===date)).toBe(true);
  expect(current.indices.map(index=>index.bars)).toEqual(previous.indices.map(index=>index.bars));
 }finally{await f.cleanup();}
},45000);

it('fails closed for tampered source bytes and leaves an existing destination unchanged',async()=>{
 const f=await fixture();try{
  const bytes=await readFile(resolve('data/market-trend-source-2026-10-23.json'));await writeFile(join(f.fresh,'market-trend-source.json'),bytes);
  await writeFile(join(f.output,'static-data',f.entry.assets.market_trends.source_path),'{}');
  await expect(restoreMarketTrendSource({root:f.fresh,fetchImpl:f.fetchImpl})).rejects.toThrow();
  expect(await readFile(join(f.fresh,'market-trend-source.json'))).toEqual(bytes);
 }finally{await f.cleanup();}
});

it('refuses publication date rollback and never creates a destination on rejection',async()=>{
 const f=await fixture();try{
  await writeFile(join(f.fresh,'manifest.json'),JSON.stringify({markets:{US:{as_of_date:'2026-10-22'}}}));
  await expect(restoreMarketTrendSource({root:f.fresh,fetchImpl:f.fetchImpl})).rejects.toThrow(/refusing rollback/);
  await expect(readFile(join(f.fresh,'market-trend-source.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.cleanup();}
});

it('a declared feature with a missing source reference is an error, not pre-feature seed fallback',async()=>{
 const f=await fixture({mutateEntry:entry=>{entry.assets.market_trends.source_path=null;}});try{
  await expect(restoreMarketTrendSource({root:f.fresh,fetchImpl:f.fetchImpl})).rejects.toThrow(/published source reference/);
  await expect(readFile(join(f.fresh,'market-trend-source.json'))).rejects.toMatchObject({code:'ENOENT'});
 }finally{await f.cleanup();}
});

it('only a verified pre-feature manifest may seed an eligible committed capture; HTTP and manifest integrity errors do not fall back',async()=>{
 const f=await fixture({withFeature:false});try{
  const result=await restoreMarketTrendSource({root:f.fresh,fetchImpl:f.fetchImpl});expect(result.origin).toBe('committed_pre_feature_seed');
  const before=await readFile(join(f.fresh,'market-trend-source.json'));
  await expect(restoreMarketTrendSource({root:f.fresh,fetchImpl:async()=>new Response(null,{status:503})})).rejects.toThrow();
  await writeFile(join(f.output,'static-data/manifest.json'),'{}');
  await expect(restoreMarketTrendSource({root:f.fresh,fetchImpl:f.fetchImpl})).rejects.toThrow();
  expect(await readFile(join(f.fresh,'market-trend-source.json'))).toEqual(before);
 }finally{await f.cleanup();}
});

it('the production workflow restores verified previous input before collecting into the fresh combined bundle',async()=>{
 const workflow=await readFile(resolve('../.github/workflows/static-site.yml'),'utf8');
 expect(workflow.indexOf('node tools/restore-market-trend-source.mjs')).toBeLessThan(workflow.indexOf('python tools/collect-market-trends.py'));
 expect(workflow.indexOf('python tools/collect-market-trends.py')).toBeLessThan(workflow.indexOf('node tools/export-research.mjs'));
});
