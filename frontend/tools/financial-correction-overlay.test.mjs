// @vitest-environment node
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { FINANCIAL_FIELDS, projectFinancialRow } from '../src/static/financialCurrent.js';
import { instrumentApplicability } from '../src/static/instrumentApplicability.js';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { FINANCIAL_CORRECTION_SCHEMA, CORRECTION_FIELDS, loadFinancialCorrection, validateCorrectionProjection, overlayFinancialCorrection, overlayFinancialChart, verifyCorrectionCompatibility } from './financial-correction-overlay.mjs';
const now=Date.parse('2026-10-04T12:00:00Z'), date='2026-10-02', identity=`1/1/${'a'.repeat(64)}/${'b'.repeat(64)}`;
const hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
const digest=value=>hash(JSON.stringify(canonical(value)));
const write=async(path,value)=>{await mkdir(resolve(path,'..'),{recursive:true});await writeFile(path,typeof value==='string'?value:JSON.stringify(value));};
const read=async path=>JSON.parse(await readFile(path,'utf8'));
function projection({annualHistory=false}={}) {
  const symbols={};
  for(const symbol of ['AVAILABLE','EMPTY']) {
    const row=withFinancialProof({symbol,...(symbol==='AVAILABLE'?{eps_growth_qq:30,eps_growth_yy:40}: {})},now,date);
    const financial_values=Object.fromEntries(CORRECTION_FIELDS.map(key=>[key,row[key]??null]));
    financial_values.eps_growth_quarterly=financial_values.eps_growth_qq;financial_values.eps_growth_annual=financial_values.eps_growth_yy;
    const source_receipts=symbol==='AVAILABLE'?[{attribute:'quarterly_income_stmt',receipt_sha256:'c'.repeat(64),capture_id:'capture-original',raw_payload_sha256:'d'.repeat(64),observed_at:new Date(now-3600000).toISOString()}]:[];
    if(annualHistory && symbol==='AVAILABLE') source_receipts.push({attribute:'income_stmt',receipt_sha256:'6'.repeat(64),capture_id:'annual-original',raw_payload_sha256:'7'.repeat(64),observed_at:new Date(now-2*3600000).toISOString()});
    symbols[symbol]={market:'US',as_of_date:date,financial_values,financial_source_evidence:{schema_version:1,fields:{}},financial_current:row.financial_current,financial_history:{symbol,as_of_date:date,status:'unavailable',basis:'current-observation',annual:[],quarterly:[],currency:null,source:null,retrieved_at:null},source_diagnostics:{},history_source_diagnostics:{},source_receipts};
    if(annualHistory && symbol==='AVAILABLE') Object.assign(symbols[symbol].financial_history,{status:'available',basis:'reported_diluted_eps',currency:'USD',source:'yfinance',retrieved_at:new Date(now-2*3600000).toISOString(),annual:[2022,2023,2024,2025].map((year,index)=>({end:`${year}-12-31`,eps:2**index}))});
  }
  const receipt_inventory=Object.entries(symbols).flatMap(([symbol,item])=>item.source_receipts.map(receipt=>({symbol,...receipt})));
  return {schema_version:FINANCIAL_CORRECTION_SCHEMA,financial_generation:'e'.repeat(64),financial_evaluated_at:new Date(now).toISOString(),knowledge_basis:'current_observation_at_source_capture',point_in_time:false,source_publication_date:null,bindings:{archive_manifest_sha256:'f'.repeat(64),acquisition_base_sha256:'1'.repeat(64),cohort_sha256:'2'.repeat(64),target_publication_identity:identity,target_base_sha256:'3'.repeat(64)},policy:{id:'financial-correction-explicit-ownership-v1',contract_sha256:'4'.repeat(64),projector_sha256:'5'.repeat(64)},receipt_inventory,receipt_inventory_sha256:digest(receipt_inventory),symbols};
}
const envFor=(path,raw)=>({FINANCIAL_CORRECTION_PROJECTION:path,FINANCIAL_CORRECTION_SHA256:hash(raw),FINANCIAL_EVALUATED_AT:new Date(now).toISOString(),FINANCIAL_CORRECTION_TARGET_IDENTITY:identity,FINANCIAL_CORRECTION_TARGET_BASE_SHA256:'3'.repeat(64)});
const rows=()=>['AVAILABLE','EMPTY','OUTSIDE'].map(symbol=>({symbol,market:'US',as_of_date:date,...(symbol==='AVAILABLE'?{quoteType:'EQUITY'}:{quote_type:'EQUITY'}),current_price:100,volume:1000,eps_growth_qq:99,eps_growth_yy:99,eps_growth_quarterly:99,eps_growth_annual:99,annual_eps_growth_3y:99,eps_rating:99,code33:true,code33_pass:true,canslim_score:99,screener_results:{canslim:{score:99,passes:true},volume:{score:77}},rs_rating:88,setup_recalculation:{status:'calculated',as_of_date:date}}));

it('is strictly opt-in and explicit null ownership preserves independent prices',async()=>{
  const input=rows()[1];
  expect(await loadFinancialCorrection({env:{},rows:rows(),asOfDate:date})).toBeNull();
  expect(overlayFinancialCorrection(input,null)).toBe(input);
  expect(()=>validateCorrectionProjection(projection(),{evaluatedAt:now})).not.toThrow();
  const changed=projectFinancialRow(overlayFinancialCorrection({...input,financial_history:{annual:[{end:'2025-12-31',eps:999}]},book_financials:{source:'old'}},projection()),{now});
  expect(changed).toMatchObject({current_price:100,rs_rating:88,eps_growth_yy:null,annual_eps_growth_3y:null,eps_rating:null,code33:null,code33_pass:null,canslim_score:null,book_financials:null});
  expect(changed.financial_history.annual).toEqual([]);expect(input.eps_growth_yy).toBe(99);
});

it('rejects incomplete ownership, tampered artifact, target mismatch, clocks and partial opt-in',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'financial-correction-validation-'));
  try {
    const value=projection(),raw=JSON.stringify(value),path=join(directory,'projection.json');await writeFile(path,raw);
    const env=envFor(path,raw);
    expect(await loadFinancialCorrection({env,rows:rows(),asOfDate:date})).toEqual(value);
    for(const key of Object.keys(env)) {const changed={...env};delete changed[key];await expect(loadFinancialCorrection({env:changed,rows:rows(),asOfDate:date})).rejects.toThrow();}
    await expect(loadFinancialCorrection({env:{...env,FINANCIAL_CORRECTION_TARGET_IDENTITY:`2/1/${'a'.repeat(64)}/${'b'.repeat(64)}`},rows:rows(),asOfDate:date})).rejects.toThrow('target publication');
    await expect(loadFinancialCorrection({env:{...env,FINANCIAL_CORRECTION_TARGET_BASE_SHA256:'a'.repeat(64)},rows:rows(),asOfDate:date})).rejects.toThrow('target base');
    await expect(loadFinancialCorrection({env,rows:rows().filter(row=>row.symbol!=='EMPTY'),asOfDate:date})).rejects.toThrow('target row');
    await writeFile(path,raw+' ');await expect(loadFinancialCorrection({env,rows:rows(),asOfDate:date})).rejects.toThrow('hash mismatch');
    for(const mutate of [v=>delete v.symbols.EMPTY.financial_values.annual_eps_growth_3y,v=>v.symbols.AVAILABLE.financial_current.t++,v=>v.symbols.AVAILABLE.financial_current.p['0'][4]++,v=>v.financial_evaluated_at='2026-10-05T12:00:00Z',v=>v.receipt_inventory_sha256='0'.repeat(64),v=>v.point_in_time=true]) {
      const changed=projection();mutate(changed);expect(()=>validateCorrectionProjection(changed,{evaluatedAt:now})).toThrow();
    }
  } finally {await rm(directory,{recursive:true,force:true});}
});

async function fixture({baseline=false,annualHistory=false,sourceRows=rows(),value=projection({annualHistory}),chartForRow}={}) {
  const directory=await mkdtemp(join(tmpdir(),'financial-correction-export-')),frontend=join(directory,'frontend'),root=join(frontend,'public/static-data');
  const scan={as_of_date:date,initial_rows:sourceRows,preview_rows:sourceRows,chunks:[{path:'chunk.json'}],default_filters:{minVolume:500},preset_screens:[{id:'financial',filters:{epsRating:{min:80}}}],sort:{field:'composite_score',order:'desc'}};
  const entry={as_of_date:date,market:'US',pages:{scan:{path:'scan.json'}},assets:{charts:{path:'charts-index.json'},candidate_performance:{path:'candidate-performance-retained.json',sha256:'a'.repeat(64)}}};
  await write(join(root,'manifest.json'),{generated_at:'2026-10-02T20:00:00Z',markets:{US:entry}});
  await write(join(root,'scan.json'),scan);await write(join(root,'chunk.json'),{as_of_date:date,rows:sourceRows,initial_rows:sourceRows,preview_rows:sourceRows});
  await write(join(root,'charts-index.json'),{symbols:sourceRows.map(row=>({symbol:row.symbol,path:`charts/${row.symbol}.json`}))});
  for(const row of sourceRows) {
    const chart=chartForRow ? chartForRow(row) : {symbol:row.symbol,market:'US',as_of_date:date,bars:[],stock_data:row,fundamentals:{...row,symbol:undefined},eps_line:[{time:date,value:99}]};
    await write(join(root,`charts/${row.symbol}.json`),chart);await write(join(root,`raw/${row.symbol}.json`),chart);
  }
  await write(join(root,'financial-history.json'),{as_of_date:date,results:Object.fromEntries(sourceRows.map(row=>[row.symbol,{symbol:row.symbol,annual:[{end:'2025-12-31',eps:999}]}]))});
  await write(join(root,'candidate-history/index.json'),{snapshots:[]});await write(join(root,'candidate-history/retained-history.json'),'historical bytes unchanged\n');
  await write(join(root,'candidate-performance-history/index.json'),'performance archive bytes unchanged\n');await write(join(root,'candidate-performance-retained.json'),{preserved:'performance bytes unchanged'});
  await mkdir(join(directory,'data/ibd_reference/ibd50'),{recursive:true});
  const raw=JSON.stringify(value),path=join(directory,'projection.json');await writeFile(path,raw);
  const baselineRoot=join(directory,'before-public');
  if(baseline) {
    await rm(join(root,'candidate-performance-history'),{recursive:true,force:true});
    const ordinaryEnv={...process.env,FINANCIAL_EVALUATED_AT:new Date(now).toISOString()};
    for(const key of Object.keys(ordinaryEnv)) if(key.startsWith('FINANCIAL_CORRECTION_')) delete ordinaryEnv[key];
    execFileSync(process.execPath,[fileURLToPath(new URL('./export-research.mjs',import.meta.url))],{cwd:frontend,env:ordinaryEnv,encoding:'utf8'});
    execFileSync(process.execPath,[fileURLToPath(new URL('./record-candidate-history.mjs',import.meta.url))],{cwd:frontend,env:ordinaryEnv,encoding:'utf8'});
    await writeFile(join(root,'candidate-history/index.json'),JSON.stringify(await read(join(root,'candidate-history/index.json')),null,2)+'\n');
    await cp(join(frontend,'public'),baselineRoot,{recursive:true});
  }
  const env={...process.env,...envFor(path,raw)};
  execFileSync(process.execPath,[fileURLToPath(new URL('./export-research.mjs',import.meta.url))],{cwd:frontend,env,encoding:'utf8'});
  if(baseline) execFileSync(process.execPath,[fileURLToPath(new URL('./record-candidate-history.mjs',import.meta.url))],{cwd:frontend,env,encoding:'utf8'});
  return {directory,frontend,root,value,env,baselineRoot};
}

it('fans out all cohort rows to every current alias and recomputes compatibility while preserving history',async()=>{
  const {directory,root,value}=await fixture();
  try {
    const report=await verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000});
    expect(report.cohort_symbols).toEqual(['AVAILABLE','EMPTY']);expect(report.counts.universe).toBe(3);expect(report.counts.charts).toBe(6);
    const manifest=await read(join(root,'manifest.json')),index=decodeResearchIndex(await read(join(root,manifest.markets.US.assets.research.path)));
    expect(index.financial_generation).toBe(value.financial_generation);
    expect(index.rows.find(row=>row.symbol==='AVAILABLE').quoteType).toBe('EQUITY');expect(index.rows.find(row=>row.symbol==='AVAILABLE')).not.toHaveProperty('quote_type');
    expect(index.rows.find(row=>row.symbol==='EMPTY').quote_type).toBe('EQUITY');expect(index.rows.find(row=>row.symbol==='EMPTY')).not.toHaveProperty('quoteType');expect(index.rows.map(row=>row.symbol)).toEqual(['AVAILABLE','EMPTY','OUTSIDE']);
    expect(index.rows.find(row=>row.symbol==='EMPTY')).toMatchObject({eps_growth_yy:null,annual_eps_growth_3y:null,eps_rating:null});
    const original=await read(join(root,'raw/AVAILABLE.json'));
    expect(original.fundamentals).toMatchObject({eps_growth_yy:40,financial_generation:value.financial_generation});expect(original.eps_line).toEqual([]);
    expect(await readFile(join(root,'candidate-history/retained-history.json'),'utf8')).toBe('historical bytes unchanged\n');expect(await read(join(root,'candidate-history/index.json'))).toEqual({snapshots:[]});
    expect(await readFile(join(root,'candidate-performance-history/index.json'),'utf8')).toBe('performance archive bytes unchanged\n');expect(await read(join(root,'candidate-performance-retained.json'))).toEqual({preserved:'performance bytes unchanged'});
    expect(manifest.markets.US.assets.candidate_performance.path).toBe('candidate-performance-retained.json');expect((await readdir(join(root,'candidate-history'))).filter(path=>path.endsWith('.gz')).length).toBe(1);
    await expect(verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+8*86400000})).rejects.toThrow('expired or invalid');
    original.fundamentals.eps_growth_yy=99;await write(join(root,'raw/AVAILABLE.json'),original);await expect(verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000})).rejects.toThrow('mismatch');
  } finally {await rm(directory,{recursive:true,force:true});}
});

it('rejects resurrection and missing generations in every corrected row surface',async()=>{
  const {directory,root,value}=await fixture();
  try {
    const manifest=await read(join(root,'manifest.json')),entry=manifest.markets.US;
    const index=decodeResearchIndex(await read(join(root,entry.assets.research.path))),empty=index.rows.find(row=>row.symbol==='EMPTY');
    const list=await read(join(root,entry.pages.scan.list_path));
    const cases=[
      ['raw/EMPTY.json',payload=>payload.fundamentals.eps_growth_yy=99],
      ['raw/EMPTY.json',payload=>payload.stock_data.screener_results.canslim.score=99],
      ['charts/EMPTY.json',payload=>payload.stock_data.annual_eps_growth_3y=99],
      ['scan.json',payload=>payload.preview_rows.find(row=>row.symbol==='EMPTY').eps_rating=99],
      ['chunk.json',payload=>payload.initial_rows.find(row=>row.symbol==='EMPTY').code33=true],
      [list.chunks[0].path,payload=>delete payload.rows.find(row=>row.symbol==='EMPTY').financial_generation],
      [empty.research_detail_path,payload=>payload.financial_history.annual=[{end:'2025-12-31',eps:999}]],
      ['financial-history.json',payload=>payload.results.EMPTY.annual=[{end:'2025-12-31',eps:999}]],
    ];
    for(const [path,mutate] of cases) {
      const original=await readFile(join(root,path),'utf8'),changed=JSON.parse(original);mutate(changed);await write(join(root,path),changed);
      await expect(verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000})).rejects.toThrow('Financial correction');await writeFile(join(root,path),original);
    }
    expect(await verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000})).toEqual(await verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+2000}));
  } finally {await rm(directory,{recursive:true,force:true});}
});

it('rejects financial claims for not-applicable or quarantined instruments',()=>{
  for(const status of ['not_applicable','quarantined']) {
    const value=projection(),item=value.symbols.AVAILABLE;
    item.instrument_applicability={version:'instrument-applicability-v1',status,reason:'reviewed_non_corporate_instrument',instrument_class:'exchange_traded_fund'};
    expect(()=>validateCorrectionProjection(value)).toThrow('financial claims');
    const unavailable=projection();unavailable.symbols.EMPTY.instrument_applicability={...item.instrument_applicability};
    expect(()=>validateCorrectionProjection(unavailable)).not.toThrow();
  }
});

it('keeps a complete ordinary predecessor coherent across correction and optionally checks the independent controller',async()=>{
  const context=await fixture({baseline:true});
  const {directory,frontend,root,value,baselineRoot}=context;
  try {
    await verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000});
    const beforeManifest=await read(join(baselineRoot,'static-data/manifest.json')),afterManifest=await read(join(root,'manifest.json'));
    const beforeRows=decodeResearchIndex(await read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.research.path))).rows;
    const afterRows=decodeResearchIndex(await read(join(root,afterManifest.markets.US.assets.research.path))).rows;
    expect(afterRows.map(row=>[row.symbol,row.technical_audit])).toEqual(beforeRows.map(row=>[row.symbol,row.technical_audit]));
    expect(await readFile(join(root,'candidate-history/index.json'),'utf8')).toBe(await readFile(join(baselineRoot,'static-data/candidate-history/index.json'),'utf8'));
    expect(afterManifest.markets.US.assets.candidate_performance).toEqual(beforeManifest.markets.US.assets.candidate_performance);
    if(process.env.FINANCIAL_CANDIDATE_BASELINE_VERIFIER) {
      const {verifyCandidateDerivedOutputs}=await import(pathToFileURL(process.env.FINANCIAL_CANDIDATE_BASELINE_VERIFIER).href);
      const wire=await read(join(baselineRoot,'static-data',beforeManifest.markets.US.assets.research.path));
      const verify=()=>verifyCandidateDerivedOutputs(baselineRoot,fileURLToPath(new URL('..',import.meta.url)),beforeManifest,wire,beforeRows);
      expect((await verify()).canonical_rows).toBe(3);
      for(const [path,mutate] of [['static-data/scan.json',v=>{v.preview_rows[0].current_price=101;}],['static-data/scan.json',v=>{v.preset_screens[0].match_count=999;}],['research-daily.json',v=>{v.candidates.oneil=[{symbol:'FORGED'}];}],['portfolio-model.json',v=>{v.cash=123;}],['qualification-audit.json',v=>{v.results[0].audit={valid:true};}]]) {
        const target=join(baselineRoot,path),original=await readFile(target,'utf8'),changed=JSON.parse(original);mutate(changed);await write(target,changed);
        await expect(verify()).rejects.toThrow();await writeFile(target,original);
      }
    }
    if(process.env.FINANCIAL_CORRECTION_CONTROLLER) {
      const {compareCorrectionData}=await import(pathToFileURL(process.env.FINANCIAL_CORRECTION_CONTROLLER).href);
      await compareCorrectionData(baselineRoot,join(frontend,'public'),fileURLToPath(new URL('..',import.meta.url)),value);
    }
    await rm(directory,{recursive:true,force:true});
  } catch(error) {throw new Error(`Combined financial correction fixture retained at ${directory}: ${error.message}`,{cause:error});}
});

it('rechecks the separate annual-history capture expiry without extending it to field-proof expiry',async()=>{
  const {directory,root,value}=await fixture({annualHistory:true});
  try {
    await verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000});
    await expect(verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+4*86400000})).rejects.toThrow('current history expired');
  } finally {await rm(directory,{recursive:true,force:true});}
});

it('accepts explicit native destination policy and binds annual history to its exact original receipt', async () => {
  const { nativeAnnualFixture } = await import('../src/test/fixtures/nativeAnnual.js');
  const value = projection({annualHistory:true});
  const sourcePolicy = structuredClone(value.policy);
  value.policy.id = 'financial-correction-native-annual-v1';
  value.derivation = { schema_version:'native-annual-destination-derivation-v1', source_projection_sha256:'8'.repeat(64), source_policy:sourcePolicy, source_receipt_inventory_sha256:value.receipt_inventory_sha256 };
  const history = nativeAnnualFixture('CAD');
  history.symbol = history.annual_source.symbol = 'AVAILABLE';
  const receipt = value.symbols.AVAILABLE.source_receipts.find(item=>item.attribute==='income_stmt');
  Object.assign(history.annual_source,receipt);
  history.retrieved_at = receipt.observed_at;
  value.symbols.AVAILABLE.financial_history = history;
  expect(()=>validateCorrectionProjection(value)).not.toThrow();
  for(const mutate of [
    p=>{p.policy.id=sourcePolicy.id;delete p.derivation;},
    p=>{p.derivation.source_policy.id='unknown';},
    p=>{p.derivation.source_receipt_inventory_sha256='0'.repeat(64);},
    p=>{p.symbols.AVAILABLE.financial_history.annual_source.receipt_sha256='0'.repeat(64);},
    p=>{p.symbols.AVAILABLE.financial_history.annual_source.capture_id='other';},
    p=>{p.symbols.AVAILABLE.financial_history.annual_source.raw_payload_sha256='0'.repeat(64);},
    p=>{p.symbols.AVAILABLE.financial_history.quarterly_retrieved_at='2026-10-04T09:00:00Z';},
    p=>{p.symbols.AVAILABLE.financial_history.annual[2].eps=null;},
  ]) {const altered=structuredClone(value);mutate(altered);expect(()=>validateCorrectionProjection(altered)).toThrow();}
});

// These observed product names are fixture inputs, separate from the registry.
const fundRows = () => [
  ['BITU', 'ProShares Ultra Bitcoin ETF'],
  ['SBIT', 'ProShares UltraShort Bitcoin ETF'],
  ['ETHE', 'Grayscale Ethereum Staking ETF'],
  ['NVDA', 'NVIDIA Corp'],
].map(([symbol,company_name])=>({...rows()[0],symbol,company_name,adv_usd:30000000}));
function fundProjection() {
  const value=projection(),template=value.symbols;
  value.symbols={};
  for(const row of fundRows()) {
    const item=structuredClone(template[row.symbol==='NVDA'?'AVAILABLE':'EMPTY']);
    item.financial_current.s=item.financial_history.symbol=row.symbol;
    item.financial_identity={symbol:row.symbol,market:'US',observed_name:row.company_name,observed_identifiers:{},
      registry_identifiers:row.symbol==='ETHE'?{cik:'0001725210',cusip:'389638107',isin:'US3896381072'}:row.symbol==='BITU'?{cusip:'74349Y704'}:row.symbol==='SBIT'?{cusip:'74349Y563'}:{},
      identifiers_bound_to_price:false,identifiers_bound_to_financial_receipts:false};
    item.instrument_applicability=instrumentApplicability(row);
    if(row.symbol==='NVDA') {
      const proof=withFinancialProof({...row,eps_growth_qq:30,eps_growth_yy:40,sales_growth_qq:20,sales_growth_yy:25},now,date);
      item.financial_current=proof.financial_current;
      for(const field of ['eps_growth_qq','eps_growth_yy','sales_growth_qq','sales_growth_yy']) item.financial_values[field]=proof[field];
      for(const [index,field] of [[6,'eps_q1_yoy'],[7,'eps_q2_yoy']]) {
        item.financial_values[field]=40;
        item.financial_current.p[index]=[40,'2','Diluted EPS',['2026-06-30','2026-03-31','2025-12-31','2025-09-30','2025-06-30'],now-3600000,now+6*86400000,'g','r'];
        item.financial_current.r=item.financial_current.r.slice(0,index)+'0'+item.financial_current.r.slice(index+1);
      }
    }
    value.symbols[row.symbol]=item;
  }
  value.receipt_inventory=Object.entries(value.symbols).flatMap(([symbol,item])=>item.source_receipts.map(receipt=>({symbol,...receipt})));
  value.receipt_inventory_sha256=digest(value.receipt_inventory);
  return value;
}
const rawFundChart = row => ({symbol:row.symbol,as_of_date:date,
  bars:[{date,open:98.25,high:101.5,low:97.75,close:100,volume:123456}],
  rs_line:[{time:date,value:0.23456789}],stock_data:structuredClone(row),
  fundamentals:{current_price:row.current_price,rs_rating:row.rs_rating,eps_growth_yy:99},eps_line:[{time:date,value:99}]});
const financialView = row => Object.fromEntries([...CORRECTION_FIELDS,'financial_current','financial_current_state','instrument_applicability','financial_identity'].map(field=>[field,row[field]]));
const priceBytes = chart => JSON.stringify([chart.bars,chart.rs_line,...[chart,chart.stock_data,chart.fundamentals].map(row=>[row?.current_price,row?.volume,row?.rs_rating])]);

it('materializes reviewed fund chart roots once with observed identity and preserves stock wrappers and six proofs',()=>{
  const value=fundProjection();
  expect(()=>validateCorrectionProjection(value)).not.toThrow();
  for(const row of fundRows()) {
    const original=rawFundChart(row),before=JSON.stringify(original),changed=overlayFinancialChart(original,value);
    expect(changed.financial_identity?.observed_name).toBe(row.symbol==='NVDA'?undefined:row.company_name);
    expect(priceBytes(changed)).toBe(priceBytes(original));expect(JSON.stringify(original)).toBe(before);
    for(const nested of [changed.stock_data,changed.fundamentals,...(row.symbol==='NVDA'?[]:[changed])]) {
      expect(nested.instrument_applicability).toEqual(value.symbols[row.symbol].instrument_applicability);
      if(row.symbol==='NVDA') expect(Object.values(nested.financial_current_state.fields).filter(field=>field.source_validated)).toHaveLength(6);
      else {
        expect(nested.instrument_applicability).toMatchObject({status:'not_applicable',identity_binding:'ticker_name_only',matched_identifiers:[]});
        expect(FINANCIAL_FIELDS.every(field=>nested[field]===null)).toBe(true);
        expect(nested.financial_identity).toMatchObject({observed_identifiers:{},identifiers_bound_to_price:false,identifiers_bound_to_financial_receipts:false});
        expect(nested.instrument_identity.observed_contexts.every(context=>!context.cik && !context.cusip && !context.isin && !context.registry_identifiers)).toBe(true);
      }
    }
    if(row.symbol==='NVDA') for(const field of ['financial_current','financial_current_state','instrument_applicability',...FINANCIAL_FIELDS]) expect(changed).not.toHaveProperty(field);
    expect(overlayFinancialChart(JSON.parse(JSON.stringify(changed)),value)).toEqual(changed);
  }
});

it('exports raw, canonical and nested fund aliases consistently in one run and detects later root corruption',async()=>{
  // This short chart cannot establish an audited RS percentile. Keep that
  // unrelated export recalculation out of the alias byte-preservation check.
  const sourceRows=fundRows().map(row=>({...row,rs_rating:null})),value=fundProjection();
  const {directory,root}=await fixture({sourceRows,value,chartForRow:rawFundChart});
  try {
    const report=await verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000});
    expect(report.cohort_symbols).toEqual(['BITU','ETHE','NVDA','SBIT']);expect(report.counts.charts).toBe(12);
    const manifest=await read(join(root,'manifest.json')),index=decodeResearchIndex(await read(join(root,manifest.markets.US.assets.research.path)));
    for(const input of sourceRows) {
      const row=index.rows.find(row=>row.symbol===input.symbol),detail=await read(join(root,row.research_detail_path));
      expect(row.instrument_applicability).toEqual(value.symbols[input.symbol].instrument_applicability);
      expect(detail.instrument_applicability).toEqual(row.instrument_applicability);
      const once=overlayFinancialChart(rawFundChart(input),value);
      for(const path of [`raw/${input.symbol}.json`,`charts/${input.symbol}.json`,row.chart_path]) {
        const chart=await read(join(root,path));
        expect(financialView(chart)).toEqual(financialView(once));
        expect(chart.stock_data.instrument_applicability).toEqual(row.instrument_applicability);
        expect(financialView(chart.fundamentals)).toEqual(financialView(once.fundamentals));
        expect(priceBytes(chart)).toBe(priceBytes(rawFundChart(input)));
        const repeated=overlayFinancialChart(chart,value);
        if(path!==row.chart_path) expect(repeated).toEqual(chart);
        expect(overlayFinancialChart(JSON.parse(JSON.stringify(repeated)),value)).toEqual(repeated);
      }
    }
    const path=join(root,'raw/BITU.json'),changed=await read(path);
    changed.instrument_applicability.status='quarantined';await write(path,changed);
    await expect(verifyCorrectionCompatibility({root,projection:value,evaluatedAt:now+1000})).rejects.toThrow('instrument applicability mismatch');
  } finally {await rm(directory,{recursive:true,force:true});}
});

it('keeps missing observed names quarantined and never promotes registry identifiers to observations',()=>{
  for(const row of fundRows().filter(row=>row.symbol!=='NVDA')) {
    const value=fundProjection(),chart=rawFundChart(row);
    delete chart.stock_data.company_name;delete value.symbols[row.symbol].financial_identity.observed_name;
    const changed=overlayFinancialChart(chart,value);
    for(const context of [changed,changed.stock_data,changed.fundamentals]) expect(context.instrument_applicability).toMatchObject({status:'quarantined',identity_conflicts:['missing_product_name'],identity_binding:'unverified'});
    expect(overlayFinancialChart(JSON.parse(JSON.stringify(changed)),value)).toEqual(changed);
  }
});

it('retains conflicting original identity across root and nested correction-owned contexts',()=>{
  const patches=[
    {company_name:'Another corporation'},
    {financial_identity:{observed_name:'Another corporation'}},
    {financial_identity:{observed_identifiers:{isin:'WRONG'}}},
    {financial_source_evidence:{identity:{issuer_cik:'123'}}},
    {financial_history:{symbol:'OTHER'}},
    {book_financials:{name:'Former issuer'}},
    {instrument_identity:{observed_contexts:[{cusip:'WRONG'}]}},
    {institutional_evidence:{market:'JP'}},
  ];
  for(const location of ['root','stock_data','fundamentals']) for(const patch of patches) {
    const value=fundProjection(),chart=rawFundChart(fundRows()[2]);
    Object.assign(location==='root'?chart:chart[location],patch);
    const changed=overlayFinancialChart(chart,value),context=location==='root'?changed:changed[location];
    expect(context.instrument_applicability.status,`${location}/${JSON.stringify(patch)}`).toBe('quarantined');
    expect(priceBytes(changed)).toBe(priceBytes(chart));
    expect(overlayFinancialChart(JSON.parse(JSON.stringify(changed)),value)).toEqual(changed);
  }
});

it('rejects conflicting chart symbols, markets and dates without rewriting price context',()=>{
  const value=fundProjection();
  for(const location of ['root','stock_data','fundamentals']) for(const patch of [{symbol:'SBIT'},{symbol:'OUTSIDE'},{market:'JP'},{as_of_date:'2026-10-01'}]) {
    const chart=rawFundChart(fundRows()[0]);Object.assign(location==='root'?chart:chart[location],patch);
    expect(()=>overlayFinancialChart(chart,value,'BITU')).toThrow('identity mismatch');
  }
  const noSymbol=rawFundChart(fundRows()[0]);delete noSymbol.symbol;delete noSymbol.stock_data.symbol;
  expect(overlayFinancialChart(noSymbol,value)).toBe(noSymbol);
});

it('distinguishes inherited container symbols from correction-owned financial roots',()=>{
  const value=fundProjection(),wrapper=rawFundChart(fundRows()[0]);delete wrapper.symbol;
  const changed=overlayFinancialChart(wrapper,value);
  expect(changed).not.toHaveProperty('symbol');expect(changed).not.toHaveProperty('financial_identity');
  expect(changed.stock_data.instrument_applicability.status).toBe('not_applicable');
  expect(overlayFinancialChart(JSON.parse(JSON.stringify(changed)),value)).toEqual(changed);
  // Preserve the former explicit ownership, and also supply the projection
  // for a proof-only root which the payload projector already materializes.
  for(const patch of [{recent_quarter_date:date},{financial_current:{}}]) {
    const chart={...rawFundChart(fundRows()[3]),...patch},projected=overlayFinancialChart(chart,value);
    expect(projected.financial_identity.observed_name).toBe('NVIDIA Corp');
    expect(Object.values(projected.financial_current_state.fields).filter(field=>field.source_validated)).toHaveLength(6);
    expect(priceBytes(projected)).toBe(priceBytes(chart));
    expect(overlayFinancialChart(JSON.parse(JSON.stringify(projected)),value)).toEqual(projected);
  }
});
