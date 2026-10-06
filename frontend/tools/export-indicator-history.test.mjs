// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rm, readdir, writeFile, mkdir, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { compareCorrectionData } from '../../.github/scripts/financial-correction.mjs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportIndicatorHistory, recordIndicatorObservation, entryPriceHistoryBasis } from './export-indicator-history.mjs';
import { ENTRY_HISTORY_VERSION } from '../src/static/entryHistory.js';
describe('entry snapshot persistence', () => {
  it('preserves first same-date bytes and records the next date separately', async () => {
    const root = await mkdtemp(join(tmpdir(), 'indicator-history-'));
    try {
      const entry = { as_of_date: '2026-09-29', assets: {} }, manifest = { generated_at: '2026-09-29T22:00:00Z' };
      const args = { root, rows: [], entry, manifest, benchmark: { bars: [{ date: '2026-09-28' }, { date: entry.as_of_date }] }, now: Date.parse(manifest.generated_at) };
      const initial = await exportIndicatorHistory(args);
      expect(initial.entry.minervini[3].latest.newCrossings).toBeNull();
      await recordIndicatorObservation(root, entry.assets.indicator_history);
      const path = join(root, 'indicator-history/index.json'), first = await readFile(path, 'utf8');
      manifest.generated_at = '2026-09-29T23:00:00Z';
      await exportIndicatorHistory(args); await recordIndicatorObservation(root, entry.assets.indicator_history);
      expect(await readFile(path, 'utf8')).toBe(first);
      entry.as_of_date = '2026-09-30'; manifest.generated_at = '2026-09-30T22:00:00Z';
      await exportIndicatorHistory(args); await recordIndicatorObservation(root, entry.assets.indicator_history);
      const catalog = JSON.parse(await readFile(path, 'utf8'));
      expect(catalog.version).toBe(ENTRY_HISTORY_VERSION); expect(catalog.snapshots).toHaveLength(2);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it('matches overlapping history across a rolling-window shift and catches a prior price revision', () => {
    const bars = Array.from({ length: 300 }, (_, i) => ({ date: `day-${i}`, open: i + 1, high: i + 2, low: i + .5, close: i + 1, volume: 100 }));
    const previous = entryPriceHistoryBasis({ as_of_date: 'day-298', bars: bars.slice(0, -1) }, 'day-298');
    const next = entryPriceHistoryBasis({ as_of_date: 'day-299', bars: bars.slice(1) }, 'day-299');
    expect(next.prior).toBe(previous.latest);
    bars[100].close += 1;
    expect(entryPriceHistoryBasis({ as_of_date: 'day-299', bars }, 'day-299').prior).not.toBe(previous.latest);
  });
});

const rowAt = (date, price) => ({symbol:'AAA',market:'US',currency:'USD',cusip:'123456789',current_price:price,se_pivot_price:100,
 technical_audit:{version:'ohlcv-v1',symbol:'AAA',as_of_date:date,valid:true,errors:[],values:{close:price}},
 setup_recalculation:{status:'calculated',as_of_date:date,engine_sha256:'engine-one'},setup_engine:{schema_version:'v1',pattern_primary:'flat_base',pivot_type:'base_high',pivot_date:'2026-09-25',pivot_price:100}});
const argsAt = (root,date,price,previous,priorHash,latestHash) => ({root,rows:[rowAt(date,price)],entry:{as_of_date:date,assets:{}},manifest:{generated_at:date+'T22:00:00Z'},benchmark:{bars:[{date:previous},{date}]},now:Date.parse(date+'T22:00:00Z'),priceHistoryBasis:{AAA:{prior:priorHash,latest:latestHash}}});

it('restores real retained observations into a fresh build root before calculating the next session crossing', async()=>{
 const root=await mkdtemp(join(tmpdir(),'indicator-fresh-build-'));
 try{
  const first=join(root,'first'),next=join(root,'fresh-next');
  const a=argsAt(first,'2026-09-28',99,'2026-09-25','0'.repeat(64),'a'.repeat(64));
  await exportIndicatorHistory(a);await recordIndicatorObservation(first,a.entry.assets.indicator_history);
  const original=await readFile(join(first,'indicator-history/index.json'));
  const script=fileURLToPath(new URL('./restore-candidate-history.py',import.meta.url));
  const restore=spawnSync('python3',['-c',`
import importlib.util,sys
from pathlib import Path
spec=importlib.util.spec_from_file_location('history',sys.argv[1]);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
module.ROOT=Path(sys.argv[3]);source=Path(sys.argv[2])
module.urlopen=lambda url,timeout=None: (source/url.removeprefix(module.BASE)).open('rb')
module.restore_indicator_history()
`,script,first,next],{encoding:'utf8'});
  expect(restore.status,restore.stderr).toBe(0);
  expect(await readFile(join(next,'indicator-history/index.json'))).toEqual(original);
  const b=argsAt(next,'2026-09-29',102,'2026-09-28','a'.repeat(64),'b'.repeat(64));
  const history=await exportIndicatorHistory(b);
  expect(history.entry.minervini[3].series.map(row=>row.date)).toEqual(['2026-09-28','2026-09-29']);
  expect(history.entry.minervini[3].latest).toMatchObject({newCrossings:1,crossingCoverage:1});
  await recordIndicatorObservation(next,b.entry.assets.indicator_history);
  expect(JSON.parse(await readFile(join(next,'indicator-history/index.json'))).snapshots).toHaveLength(2);
  expect(await readFile(join(next,a.entry.assets.indicator_history.path))).toEqual(await readFile(join(first,a.entry.assets.indicator_history.path)));
 }finally{await rm(root,{recursive:true,force:true});}
});

it('keeps the first same-date source ref and creates no replacement file when financial knowledge changes',async()=>{
 const root=await mkdtemp(join(tmpdir(),'indicator-same-date-'));
 try{
  const args=argsAt(root,'2026-09-29',102,'2026-09-28','a'.repeat(64),'b'.repeat(64));
  const before=await exportIndicatorHistory(args);await recordIndicatorObservation(root,args.entry.assets.indicator_history);
  const ref={...args.entry.assets.indicator_history},files=await readdir(join(root,'indicator-history')),catalog=await readFile(join(root,'indicator-history/index.json'));
  args.rows[0].eps_growth_yy=999;args.manifest.generated_at='2026-09-29T23:00:00Z';args.now+=3600000;
  const after=await exportIndicatorHistory(args);await recordIndicatorObservation(root,args.entry.assets.indicator_history);
  expect(args.entry.assets.indicator_history).toEqual(ref);
  expect(after.entry).toEqual(before.entry);
  expect(await readdir(join(root,'indicator-history'))).toEqual(files);
  expect(await readFile(join(root,'indicator-history/index.json'))).toEqual(catalog);
 }finally{await rm(root,{recursive:true,force:true});}
});

it('passes the actual financial correction gate with an unchanged first indicator observation and manifest ref',async()=>{
 const root=await mkdtemp(join(tmpdir(),'indicator-correction-gate-'));
 const put=async(base,path,value)=>{const target=join(base,path);await mkdir(join(target,'..'),{recursive:true});await writeFile(target,JSON.stringify(value));};
 try{
  const before=join(root,'before'),after=join(root,'after'),dataRoot=join(before,'static-data');
  const args=argsAt(dataRoot,'2026-09-29',102,'2026-09-28','a'.repeat(64),'b'.repeat(64));
  args.entry.pages={scan:{path:'scan.json'}};args.entry.assets.research={path:'research-index-aaaaaaaaaaaaaaaa.json'};args.entry.assets.charts={path:'charts-index-aaaaaaaaaaaaaaaa.json'};
  const histories=await exportIndicatorHistory(args);await recordIndicatorObservation(dataRoot,args.entry.assets.indicator_history);
  const manifest={as_of_date:args.entry.as_of_date,markets:{US:args.entry}};
  await put(before,'static-data/manifest.json',manifest);
  await put(before,'static-data/research-index-aaaaaaaaaaaaaaaa.json',{as_of_date:args.entry.as_of_date,rows:args.rows});
  await put(before,'static-data/charts-index-aaaaaaaaaaaaaaaa.json',{symbols:[]});
  await put(before,'static-data/scan.json',{as_of_date:args.entry.as_of_date,initial_rows:args.rows,chunks:[]});
  await put(before,'static-data/breadth.json',{payload:{indicator_histories:histories}});
  await cp(before,after,{recursive:true});
  args.root=join(after,'static-data');args.rows[0].eps_growth_yy=25;args.rows[0].financial_generation='f'.repeat(64);args.now+=3600000;
  const changed=await exportIndicatorHistory(args);
  await put(after,'static-data/manifest.json',manifest);
  await put(after,'static-data/research-index-aaaaaaaaaaaaaaaa.json',{as_of_date:args.entry.as_of_date,rows:args.rows});
  await put(after,'static-data/scan.json',{as_of_date:args.entry.as_of_date,initial_rows:args.rows,chunks:[]});
  await put(after,'static-data/breadth.json',{payload:{indicator_histories:changed}});
  const result=await compareCorrectionData(before,after,fileURLToPath(new URL('..',import.meta.url)),{financial_generation:'f'.repeat(64),symbols:{AAA:{}}});
  expect(result.semantic_sha256).toMatch(/^[a-f0-9]{64}$/);
 }finally{await rm(root,{recursive:true,force:true});}
});
