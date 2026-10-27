import { describe,it,expect } from 'vitest';
import { readFileSync,writeFileSync,mkdirSync,mkdtempSync,rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { buildMarketTrends,exportMarketTrends } from './export-market-trends.mjs';
const source=()=>JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'),'utf8'));
describe('market trend source projection',()=>{
 it('projects actual dated separate indices and Cboe numerator/denominator',()=>{const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date});expect(out.indices.map(x=>x.available)).toEqual([true,true]);expect(out.indices[0].points).toHaveLength(280);expect(out.put_call.points).toHaveLength(63);for(const row of out.put_call.points)expect(row.value).toBe(row.puts/row.calls);});
 it('does not use a different date source as current',()=>{const out=buildMarketTrends(source(),{asOfDate:'2026-10-26'});expect(out.indices.every(x=>!x.available)).toBe(true);expect(out.put_call.points).toEqual([]);});
 it('rejects future/different-day Cboe evidence and preserves unknown values',()=>{const input=source();input.put_call.observations=input.put_call.observations.slice(-1);input.put_call.observations[0].provenance.url='https://www.cboe.com/markets/us/options/market-statistics/daily?dt=2026-10-22';const out=buildMarketTrends(input,{asOfDate:input.as_of_date});expect(out.put_call.points[0].value).toBeNull();});
 it('keeps the public chart universe and denominator for above50 instead of merging with liquid-stock current count',()=>{const input=source(),out=buildMarketTrends(input,{asOfDate:input.as_of_date,bookEvidence:{as_of_date:input.as_of_date,series:[{date:input.as_of_date,above50:3,coverage:4,expectedUniverseSize:7,newHighs:1,newLows:0}]}});expect(out.breadth.points[0]).toMatchObject({above50Percent:75,coverage:4,universe:7,newLows:0});expect(out.breadth.approximate).toBe(true);});
 it('retains known index history without carrying its past count into today',()=>{const input=source();input.indices[0].bars.pop();const out=buildMarketTrends(input,{asOfDate:input.as_of_date});expect(out.indices[0]).toMatchObject({available:false,historical:true,latest:null});expect(out.indices[0].points.at(-1).date).toBe('2026-10-22');expect(out.indices[0].points.at(-1).value).toEqual(expect.any(Number));});
 it('writes raw and derived data with exact content hashes and binds the manifest reference',async()=>{const root=mkdtempSync(resolve(tmpdir(),'market-trends-'));try{const entry={assets:{charts:{path:'existing.json'}}};await exportMarketTrends({root,entry,asOfDate:'2026-10-23'});const ref=entry.assets.market_trends,bytes=readFileSync(resolve(root,ref.path)),sourceBytes=readFileSync(resolve(root,ref.source_path));expect(createHash('sha256').update(bytes).digest('hex')).toBe(ref.sha256);expect(createHash('sha256').update(sourceBytes).digest('hex')).toBe(ref.source_sha256);expect(JSON.parse(bytes).source_sha256).toBe(ref.source_sha256);expect(entry.assets.charts.path).toBe('existing.json');expect(JSON.parse(bytes).indices[0].latest.value).toBe(5);}finally{rmSync(root,{recursive:true,force:true});}});
 it('replays identical selected seed and manifest bytes from a foreign cwd, ignoring a spoofed cwd seed',async()=>{
  const scratch=mkdtempSync(resolve(tmpdir(),'market-replay-'));
  try{
   const entry={assets:{}},asOfDate='2026-10-23',normal=resolve(scratch,'normal'),foreign=resolve(scratch,'foreign');
   mkdirSync(resolve(foreign,'data'),{recursive:true});
   writeFileSync(resolve(foreign,'data',`market-trend-source-${asOfDate}.json`),JSON.stringify({...source(),indices:[],put_call:{observations:[]}}));
   await exportMarketTrends({root:normal,entry,asOfDate});
   const moduleUrl=pathToFileURL(resolve('tools/export-market-trends.mjs')).href,replay=resolve(foreign,'output');
   const code=`import {exportMarketTrends} from ${JSON.stringify(moduleUrl)};const entry={assets:{}};await exportMarketTrends({root:${JSON.stringify(replay)},entry,asOfDate:${JSON.stringify(asOfDate)}});process.stdout.write(JSON.stringify(entry));`;
   const replayEntry=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',code],{cwd:foreign,encoding:'utf8'}));
   expect(replayEntry).toEqual(entry);
   const ref=entry.assets.market_trends;
   expect(readFileSync(resolve(replay,ref.path))).toEqual(readFileSync(resolve(normal,ref.path)));
   expect(readFileSync(resolve(replay,ref.source_path))).toEqual(readFileSync(resolve(normal,ref.source_path)));
  }finally{rmSync(scratch,{recursive:true,force:true});}
 });
 it('keeps the exact-date daily source ahead of the compiler seed',async()=>{
  const root=mkdtempSync(resolve(tmpdir(),'market-daily-source-'));
  try{
   const daily=Buffer.from(JSON.stringify(source(),null,1)+'\n');
   writeFileSync(resolve(root,'market-trend-source.json'),daily);
   const entry={};await exportMarketTrends({root,entry,asOfDate:'2026-10-23'});
   const ref=entry.assets.market_trends;
   expect(ref.source_sha256).toBe(createHash('sha256').update(daily).digest('hex'));
   expect(readFileSync(resolve(root,ref.source_path))).toEqual(daily);
  }finally{rmSync(root,{recursive:true,force:true});}
 });
});
