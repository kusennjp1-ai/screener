import { describe,it,expect } from 'vitest';
import { validateSvgChart } from './svg-chart-evidence.mjs';
import { fixture } from './reviewed-design-functional-fixture.mjs';
import { validateFunctionalEvidence } from './reviewed-design-functional-evidence.mjs';
const bars=[{date:'2026-10-20',open:100,high:105,low:99,close:102,volume:123},{date:'2026-10-21',open:102,high:104,low:100,close:101,volume:0}];
function observed(symbol='SYNTH') {return {renderer:'leader-svg-v1',symbol,as_of_date:bars.at(-1).date,annotation_mode:'vcp-on',panes:['price','volume','rs'],moving_average_labels:['SMA50 データなし','SMA150 データなし','SMA200 データなし'],range_label:`${symbol} 価格・出来高・RS 共通時間軸 2026-10-20〜2026-10-21`,candles:bars.map(b=>({date:b.date,close:b.close,title:`${b.date} 始値 ${b.open} 高値 ${b.high} 安値 ${b.low} 終値 ${b.close}`,geometry:[{x1:1,y1:2,x2:1,y2:5},{x:0,y:3,width:2,height:1}]})),volumes:bars.map(b=>({value:b.volume,title:`${b.date} 出来高 ${b.volume}`})),rs_missing:true,rs_paths:[],date_labels:['10-20','10-21'],vcp_legs:[]};}
describe('live SVG evidence contract, synthetic unit fixtures only',()=>{
 it('accepts actual zero volume and explicit absent RS without altering observations',()=>{const v=observed(),before=JSON.stringify(v);expect(validateSvgChart(v,bars)).toBe(true);expect(JSON.stringify(v)).toBe(before);});
 const mutations={
 'missing pane':v=>v.panes.pop(),'duplicate pane':v=>v.panes.push('price'),'missing price':v=>v.candles=[],
 'wrong close':v=>v.candles[0].close=999,'wrong high':v=>v.candles[0].title=v.candles[0].title.replace('高値 105','高値 999'),
 'invalid shape':v=>v.candles[0].geometry[0].x1=NaN,'wrong volume':v=>v.volumes[0].value=999,
 'wrong date':v=>v.candles[0].date='2026-09-01','wrong range':v=>v.range_label='old',
 'missing date axis':v=>v.date_labels=[],'missing RS evidence':v=>delete v.rs_missing,'invented RS':v=>v.rs_paths=['1,2 3,4'],
 'malformed RS':v=>{v.rs_missing=false;v.rs_paths=['1,NaN'];},'unmarked RS absence':v=>v.rs_missing=false,
 'missing SMA':v=>v.moving_average_labels=[],'disabled annotation rendered':v=>{v.annotation_mode='vcp-off';v.vcp_legs=[{number:1,title:'T1 推定'}];},
 'unknown renderer':v=>v.renderer='fake',
 };
 for(const [name,mutate] of Object.entries(mutations))it('rejects '+name,()=>{const v=observed();mutate(v);expect(()=>validateSvgChart(v,bars)).toThrow();});
 it('accepts explicit SVG in complete functional evidence while leaving legacy unchanged',()=>{const f=fixture('ordinary');for(const r of f.report.chart_cases){r.renderer='leader-svg-v1';r.source_bars=bars;r.views=r.views.map(v=>({...v,...observed(r.symbol)}));}expect(validateFunctionalEvidence(f.report,f.binding)).toBe(true);});
 it('rejects corrupted SVG in full evidence and does not infer a renderer for legacy captures',()=>{const f=fixture('ordinary'),r=f.report.chart_cases[0];r.renderer='leader-svg-v1';r.source_bars=bars;r.views=r.views.map(v=>({...v,...observed(r.symbol)}));r.views[0].volumes[0].value=999;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();delete r.renderer;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();});
});

function provenanceView(){return {...observed(),evidence_contract:'leader-svg-provenance-v2',rs_context_label:'RS線の比較対象が未確認（データなし）',vcp_legs:[{number:5,title:'T5 推定 2026-10-20〜2026-10-21 深さ 4%'}],annotation_layout:{pane:{x:10,y:10,width:200,height:150},labels:[{number:5,box:{x:20,y:20,width:60,height:20},leader:'M80 30L150 120',anchor:{x:150,y:120}}]}};}
describe('versioned source-bound RS and actual VCP label geometry',()=>{
 it('keeps unknown comparison source unplotted even when caller has numerical RS data',()=>expect(validateSvgChart(provenanceView(),bars,'fixture',{benchmark_symbol:null,rs_line:[{value:20}]})).toBe(true));
 it('keeps a known comparison label and valid RS path',()=>{const v=provenanceView();v.rs_context_label='RS線 · SPY（RS順位とは別）';v.rs_missing=false;v.rs_paths=['20,120 40,100'];expect(validateSvgChart(v,bars,'fixture',{benchmark_symbol:'SPY'})).toBe(true);});
 const mutations={
 'missing contract source':v=>delete v.rs_context_label,
 'unknown benchmark drawn':v=>{v.rs_missing=false;v.rs_paths=['20,120 40,100'];},
 'missing annotation pane':v=>delete v.annotation_layout.pane,
 'missing label':v=>v.annotation_layout.labels=[],
 'label outside pane':v=>v.annotation_layout.labels[0].box.y=155,
 'wrong label number':v=>v.annotation_layout.labels[0].number=6,
 'label overlap':v=>{v.vcp_legs.push({number:6,title:'T6 推定'});v.annotation_layout.labels.push({...structuredClone(v.annotation_layout.labels[0]),number:6});},
 'missing leader':v=>v.annotation_layout.labels[0].leader=null,
 'leader misses actual low':v=>v.annotation_layout.labels[0].leader='M80 30L160 120',
 'leader detached from label':v=>v.annotation_layout.labels[0].leader='M90 30L150 120',
 'unknown evidence version':v=>v.evidence_contract='future',
 };
 for(const [name,mutate] of Object.entries(mutations))it('rejects '+name,()=>{const v=provenanceView();mutate(v);expect(()=>validateSvgChart(v,bars,'fixture',{benchmark_symbol:null})).toThrow();});
 it('rejects missing original source instead of inferring it from displayed label',()=>expect(()=>validateSvgChart(provenanceView(),bars)).toThrow(/source context/));
 it('requires declared new report captures to retain the observation version',()=>{const f=fixture('ordinary');f.report.svg_evidence_contract='leader-svg-provenance-v2';expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/provenance contract/);});
});
it('validates full versioned provenance capture without inferring missing metadata',()=>{const f=fixture('ordinary');f.report.svg_evidence_contract='leader-svg-provenance-v2';for(const r of f.report.chart_cases){r.renderer='leader-svg-v1';r.source_bars=bars;r.rs_source={benchmark_symbol:null};r.views=r.views.map(v=>({...v,...provenanceView(),symbol:r.symbol,range_label:`${r.symbol} 価格・出来高・RS 共通時間軸 2026-10-20〜2026-10-21`}));}expect(validateFunctionalEvidence(f.report,f.binding)).toBe(true);delete f.report.chart_cases[0].rs_source;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/source context/);});
