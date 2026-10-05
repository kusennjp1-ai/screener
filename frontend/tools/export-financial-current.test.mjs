// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { researchEvaluation, validatePublishedSummaries, validateResearchListSummaries } from './research-quality.mjs';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../src/static/testFinancialFixture.js';

it('exports one coherent current generation while retaining raw values and historical files',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'financial-current-export-'));
  const frontend=join(directory,'frontend'),root=join(frontend,'public/static-data');
  const write=async(path,value)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value));};
  try {
    const row=withFinancialProof({eps_growth_yy:0,eps_rating:99,composite_rating:99,code33:false,current_price:100,volume:1000},now,date);
    const scan={as_of_date:date,initial_rows:[row],preview_rows:[row],chunks:[],default_filters:{minVolume:500},preset_screens:[{id:'financial',filters:{epsRating:{min:80}}}],sort:{field:'composite_score',order:'desc'}};
    const entry={as_of_date:date,market:'US',pages:{scan:{path:'scan.json'}},assets:{charts:{path:'charts-index.json'}}};
    await write(join(root,'manifest.json'),{generated_at:'2026-10-02T20:00:00Z',markets:{US:entry}});
    await write(join(root,'scan.json'),scan);await write(join(root,'charts-index.json'),{symbols:[]});
    await write(join(root,'candidate-history/retained-history.json'),'historical bytes unchanged\n');
    await mkdir(join(directory,'data/ibd_reference/ibd50'),{recursive:true});
    execFileSync(process.execPath,[fileURLToPath(new URL('./export-research.mjs',import.meta.url))],{cwd:frontend,env:{...process.env,FINANCIAL_EVALUATED_AT:new Date(now).toISOString()},encoding:'utf8'});
    const manifest=JSON.parse(await readFile(join(root,'manifest.json'),'utf8'));
    const index=JSON.parse(await readFile(join(root,manifest.markets.US.assets.research.path),'utf8'));
    expect(index.orders).toBeUndefined();
    const decoded=decodeResearchIndex(index);
    expect(researchEvaluation(decoded,manifest.markets.US.assets.research)).toBe(now);
    expect(index.summary_storage).toBe('canonical-detail-v1');
    expect(()=>validateResearchListSummaries(index,decoded.rows,now)).not.toThrow();
    const current=decoded.rows[0];
    expect(current).toMatchObject({eps_growth_yy:0,eps_rating:null,composite_rating:null});
    const detail=JSON.parse(await readFile(join(root,current.research_detail_path),'utf8'));
    expect(()=>validatePublishedSummaries([detail],now)).not.toThrow();
    expect(current.method_summary).toBeUndefined();
    expect(detail.method_summary.evaluated_at).toBe(now);
    expect(detail.financial_historical.values).toMatchObject({eps_growth_yy:0,eps_rating:99,composite_rating:99,code33:false});
    const emitted=JSON.parse(await readFile(join(root,'scan.json'),'utf8'));
    expect(emitted.initial_rows[0].code33).toBeNull();expect(emitted.preview_rows[0].eps_rating).toBeNull();
    expect(emitted.default_filtered_rows_total).toBe(1);expect(emitted.preset_screens[0].match_count).toBe(0);
    for(const name of ['qualification-audit.json','research-daily.json','portfolio-model.json']) {
      const value=JSON.parse(await readFile(join(frontend,'public',name),'utf8'));
      expect(value).toMatchObject({financial_evaluated_at:now,financial_semantics:'current_at_evaluation_not_historical_publication'});
      expect(value.assessment_version).toContain('financial-current');
    }
    expect(await readFile(join(root,'candidate-history/retained-history.json'),'utf8')).toBe('historical bytes unchanged\n');
  } finally {await rm(directory,{recursive:true,force:true});}
});
