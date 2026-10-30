// @vitest-environment node
// Synthetic fixtures only. These are not browser observations or review scores.
import { test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { LEADER_DETAIL_CONTRACT, LEGACY_LEADER_DETAIL_CONTRACT, leaderDetailFailures } from './leader-detail-design-contract.mjs';
import { feedFixture } from './reviewed-design-functional-fixture.mjs';
import { validateFunctionalEvidence, validateInlineChartEvidence, validateInlineCaptureEvidence } from './reviewed-design-functional-evidence.mjs';
const rect=(left,top,width,height)=>({left,top,width,height,right:left+width,bottom:top+height});
function fixture(){return {viewport:{width:390,height:844},headerHeight:48,bottomNavHeight:56,detailEvidence:{version:LEADER_DETAIL_CONTRACT,identity:'ALPHA分析2026-10-23',section:'chart',conditionsObservation:{identity:'ALPHA分析2026-10-23',section:'conditions'},sections:['chart','setup','conditions','financial','evidence','notes'].map((key,i)=>({id:`detail-tab-${key}`,selected:i===0?'true':'false',rect:rect(i*60,788,60,44)})),renderer:'leader-svg-v1',price:rect(20,650,330,180),visible:rect(20,650,330,138),chart:rect(16,630,358,390),content:{left:0,right:390,top:48,bottom:788},hits:Array(9).fill(true),verdict:'日次条件 0/7。未達 2・未確認 5。',rs:'RS データなし',volume:'出来高比 データなし',states:Array.from({length:7},()=>({state:'unknown',glyph:'?',shown:true})),gates:['トレンド','VCP','RS','出来高','市場'].map((label,i)=>({label,state:'unknown',rect:rect(16+i*70,500,65,44)}))}};}
test('new SVG detail requires visible actual price area without restricting overview card spacing',()=>expect(leaderDetailFailures(fixture(),'detail')).toEqual([]));
test('small price pane must be entirely visible',()=>{const m=fixture();m.detailEvidence.price=rect(20,650,330,80);m.detailEvidence.visible=rect(20,650,330,80);expect(leaderDetailFailures(m,'detail')).toEqual([]);m.detailEvidence.visible.height=79;m.detailEvidence.visible.bottom--;expect(leaderDetailFailures(m,'detail').length).toBeGreaterThan(0);});
test('missing chart is explicit, never a fabricated price pane',()=>{const m=fixture(),d=m.detailEvidence;d.renderer=null;d.chart=null;d.price=null;d.visible=null;d.hits=[];d.unavailable='チャート：データなし。日足未確認';expect(leaderDetailFailures(m,'detail')).toEqual([]);d.price=rect(20,650,330,180);expect(leaderDetailFailures(m,'detail').length).toBeGreaterThan(0);});
for(const [name,mutate] of [
 ['missing observation',m=>delete m.detailEvidence],['unknown version',m=>m.detailEvidence.version='future'],['unknown renderer',m=>m.detailEvidence.renderer='canvas'],
 ['99px price visibility',m=>{m.detailEvidence.price=rect(20,689,330,180);m.detailEvidence.visible=rect(20,689,330,99);}],
 ['offscreen price',m=>{m.detailEvidence.price=rect(20,900,330,180);m.detailEvidence.visible=rect(20,900,330,0);}],
 ['horizontal clipping',m=>{m.detailEvidence.price=rect(-1,650,351,180);m.detailEvidence.visible=rect(0,650,350,138);}],
 ['obscured price',m=>m.detailEvidence.hits[0]=false],['absent hit evidence',m=>m.detailEvidence.hits=[]],['no real price rectangle',m=>m.detailEvidence.price=null],
 ['invented visible intersection',m=>m.detailEvidence.visible=rect(20,600,330,188)],['chrome overlap',m=>m.detailEvidence.content.bottom=844],
 ['missing RS',m=>m.detailEvidence.rs='RS'],['missing volume',m=>m.detailEvidence.volume='出来高比'],['missing verdict',m=>m.detailEvidence.verdict=''],
 ['missing daily condition',m=>m.detailEvidence.states.pop()],['unknown presented as pass',m=>m.detailEvidence.states[0].glyph='✓'],['hidden daily condition',m=>m.detailEvidence.states[0].shown=false],
 ['missing gate',m=>m.detailEvidence.gates.pop()],['wrong gate state',m=>m.detailEvidence.gates[0].state='verified'],['undersized gate',m=>m.detailEvidence.gates[0].rect=rect(16,500,65,43)],
 ['missing-chart unlabelled',m=>{m.detailEvidence.renderer=null;m.detailEvidence.chart=null;m.detailEvidence.price=null;m.detailEvidence.unavailable='';}],
])test('rejects '+name,()=>{const m=fixture();mutate(m);expect(leaderDetailFailures(m,'detail').length).toBeGreaterThan(0);});
test('360px mobile is covered, not only screenshot width390',()=>{const m=fixture();m.viewport.width=360;m.detailEvidence.gates.forEach((g,i)=>g.rect=rect(16+i*66,500,60,44));expect(leaderDetailFailures(m,'detail')).toEqual([]);m.detailEvidence.gates[0].rect=rect(16,500,65,43);expect(leaderDetailFailures(m,'detail').length).toBeGreaterThan(0);});
test('legacy capture retains strict160px spacing regardless of untrusted new observation',()=>{const f=feedFixture();const m=f.report.screens.find(s=>s.key==='detail/390/dark').metrics;m.chartCard.top=m.detail.top+161;m.detailEvidence=fixture().detailEvidence;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/detail\/chart spacing/);});
test('unknown report detail contract cannot downgrade validation',()=>{const f=feedFixture();f.report.detail_contract='future';expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/Unknown detail contract/);});

function newCapture(){
 const f=feedFixture();f.report.detail_contract=LEADER_DETAIL_CONTRACT;
 for(const s of f.report.screens){if(s.key.startsWith('detail/390/')){s.metrics.detailEvidence=fixture().detailEvidence;s.metrics.detailEvidence.content.top=s.metrics.headerHeight;s.metrics.detailEvidence.content.bottom=s.metrics.viewport.height-s.metrics.bottomNavHeight;s.metrics.detailEvidence.visible=rect(20,650,330,Math.min(830,s.metrics.detailEvidence.content.bottom)-650);s.metrics.chartCard.top=s.metrics.detail.top+500;}}
 for(const record of [...(f.report.financial_cases||[]),...(f.report.financial_carry_cases||[])])for(const view of record.views){const selector=view.screen.endsWith('-selection')?'#detail-tab-evidence':view.screen.endsWith('-purchase')?'#detail-tab-conditions':null;if(!selector||record.viewport.width===390)continue;view.targets.unshift(selector);const screen=f.report.screens.find(s=>s.key===`${view.screen}/${record.viewport.width}/${record.theme}`);screen.viewport_geometry.targets.unshift({...screen.viewport_geometry.targets[0],selector,text:'選択した判定タブ'});}
 for(const screen of f.report.screens){if(!/^(?:carry-)?financial-/.test(screen.key)||screen.metrics.viewport.width!==390)continue;const selected=screen.key.split('/')[0].endsWith('-selection')?'evidence':screen.key.split('/')[0].endsWith('-purchase')?'conditions':'financial';screen.viewport_geometry.section_navigation={kind:'stock-sections',tabs:['chart','setup','conditions','financial','evidence','notes'].map((key,i)=>({id:`detail-tab-${key}`,selected:key===selected?'true':'false',hit:true,rect:rect(i*60,screen.viewport_geometry.chrome.navigation.top,60,44)}))};}
 return f;
}
test('new capture integrates versioned detail and visible financial tabs without changing legacy fixtures',()=>{const f=newCapture();expect(validateFunctionalEvidence(f.report,f.binding)).toBe(true);});
test('new capture cannot omit original financial rows after adding tab',()=>{const f=newCapture(),record=f.report.financial_cases.find(r=>r.views.some(v=>v.screen.endsWith('-selection'))),view=record.views.find(v=>v.screen.endsWith('-selection'));view.targets.pop();const screen=f.report.screens.find(s=>s.key===`${view.screen}/${record.viewport.width}/${record.theme}`);screen.viewport_geometry.targets.pop();expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/actual financial targets/);});
test('new capture cannot omit price visibility proof',()=>{const f=newCapture();delete f.report.screens.find(s=>s.key==='detail/390/dark').metrics.detailEvidence;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/detail observation version/);});
test('new capture cannot downgrade its detail observation to v1',()=>{const f=newCapture();f.report.screens.find(s=>s.key==='detail/390/dark').metrics.detailEvidence.version=LEGACY_LEADER_DETAIL_CONTRACT;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/detail observation version/);});

function inlineFixture(){const g={viewport:{width:390,height:844},chrome:{header:rect(0,0,390,48),navigation:rect(0,788,390,56)},targets:['.research-chart .leader-svg-controls','.research-chart svg[data-chart-plot]'].map((selector,i)=>({selector,count:1,shown:true,rect:rect(16,60+i*120,358,i?390:100),clip:{left:0,right:390,top:48,bottom:788},hit_samples:Array(9).fill(true)}))};return {default:structuredClone(g),annotations:structuredClone(g)};}
test('inline capture requires controls and all three-pane plot fully visible together',()=>expect(validateInlineChartEvidence(inlineFixture(),390,844)).toBe(true));
for(const [label,mutate] of [['missing annotations',v=>delete v.annotations],['wrong target',v=>v.default.targets[0].selector='unrelated'],['partially obscured control',v=>v.default.targets[0].hit_samples[0]=false],['controls hidden by header',v=>v.default.targets[0].rect=rect(16,20,358,100)],['plot clipped by navigation',v=>v.default.targets[1].rect=rect(16,450,358,390)],['missing clip',v=>delete v.default.targets[0].clip],['missing real hit observations',v=>v.default.targets[0].hit_samples=[]]])test('inline viewport rejects '+label,()=>{const v=inlineFixture();mutate(v);expect(()=>validateInlineChartEvidence(v,390,844)).toThrow();});

function inlineScreens(){const record={symbol:'MSM',viewport:{width:390,height:844},theme:'light'},geometry=inlineFixture();return {record,screens:[['default','inline'],['annotations','inline-annotations']].map(([state,suffix])=>({key:`case-MSM-${suffix}/390/light`,screenshot_scope:'scrolled-viewport',metrics_scope:'original-viewport',screenshot_target:null,viewport_geometry:geometry[state]}))};}
test('inline screenshots independently validate actual capture-time geometry',()=>{const {record,screens}=inlineScreens();expect(validateInlineCaptureEvidence(record,screens)).toBe(true);});
for(const [label,mutate] of [['missing screenshot',s=>s.pop()],['missing screenshot-time evidence',s=>delete s[0].viewport_geometry],['changed scroll clips screenshot plot',s=>s[0].viewport_geometry.targets[1].rect=rect(16,610,358,390)],['screenshot-time overlap',s=>s[1].viewport_geometry.targets[0].hit_samples[4]=false],['not original viewport',s=>s[0].metrics_scope='full-page']])test('inline screenshot rejects '+label,()=>{const {record,screens}=inlineScreens();mutate(screens);expect(()=>validateInlineCaptureEvidence(record,screens)).toThrow();});
test('chart capture establishes requested real theme before positioning and rechecks targets at both screenshots',()=>{const source=readFileSync(new URL('./chart-design-cases.mjs',import.meta.url),'utf8');const reload=source.indexOf('await page.reload()'),theme=source.indexOf('requested theme was not established before chart measurement'),scroll=source.indexOf('await scrollFinancialViewport(page,inlineTargets)'),measure=source.indexOf('record.inline_geometry={default:await inspectInlineViewport()}');expect(reload).toBeLessThan(theme);expect(theme).toBeLessThan(scroll);expect(scroll).toBeLessThan(measure);for(const suffix of ['inline','inline-annotations'])expect(source).toContain('`case-${symbol}-'+suffix+'`, { scope: \'scrolled-viewport\', viewportTargets: inlineTargets }');});

test('authenticated v1 captures retain the original simultaneous evidence contract',()=>{const m=fixture();m.detailEvidence.version=LEGACY_LEADER_DETAIL_CONTRACT;delete m.detailEvidence.conditionsObservation;delete m.detailEvidence.sections;expect(leaderDetailFailures(m,'detail')).toEqual([]);m.detailEvidence.states[0].shown=false;expect(leaderDetailFailures(m,'detail')).toContain('missing exact seven daily states');});
for(const [name,mutate] of [['missing condition observation',d=>delete d.conditionsObservation],['different instrument',d=>d.conditionsObservation.identity='OTHER'],['wrong initial section',d=>d.section='conditions'],['wrong measured section',d=>d.conditionsObservation.section='evidence'],['missing tab',d=>d.sections.pop()],['undersized tab',d=>d.sections[0].rect=rect(0,788,43,44)],['wrong selected tab',d=>d.sections[0].selected='false']])test('tabbed contract rejects '+name,()=>{const m=fixture();mutate(m.detailEvidence);expect(leaderDetailFailures(m,'detail').length).toBeGreaterThan(0);});

// Synthetic geometry only; source authentication is tested separately below
// the Git-bound capture contract. These are not authored image observations.
function warningInline(width=390,expected=true){
 const height=width===390?844:900, geometry=inlineFixture();
 for(const state of ['default','annotations']){
  const g=geometry[state];g.viewport={width,height};g.chrome.header=rect(0,0,width,48);g.chrome.navigation=width===390?rect(0,788,width,56):null;
  const selectors=[...(expected?[...(width>=900?['.research-symbol-head']:[]),'.research-symbol-head .entry-source-badge']:[]),'.research-chart .leader-svg-controls','.research-chart svg[data-chart-plot]'];
  g.targets=selectors.map(selector=>({selector,count:1,shown:true,rect:selector==='.research-symbol-head'?rect(16,60,width-32,65):selector.endsWith('.entry-source-badge')?rect(24,85,200,20):selector.endsWith('.leader-svg-controls')?rect(16,140,width-32,100):rect(16,260,width-32,390),clip:{left:0,right:width,top:48,bottom:width===390?788:900},hit_samples:Array(9).fill(true)}));
 }
 const record={symbol:'ADI',viewport:{width,height},theme:'dark',source_warning:{expected}};
 const screens=[['default','inline'],['annotations','inline-annotations']].map(([state,suffix])=>({key:`case-ADI-${suffix}/${width}/dark`,screenshot_scope:'scrolled-viewport',metrics_scope:'original-viewport',screenshot_target:null,viewport_geometry:structuredClone(geometry[state])}));
 return {geometry,record,screens,context:{contract:'source-warning-v1',sourceWarning:record.source_warning}};
}
for(const width of [390,1440])for(const expected of [true,false])test(`source warning contract validates exact conditional targets ${width}/${expected}`,()=>{
 const f=warningInline(width,expected);
 expect(validateInlineChartEvidence(f.geometry,width,f.record.viewport.height,'synthetic',f.context)).toBe(true);
 expect(validateInlineCaptureEvidence(f.record,f.screens,f.context.contract)).toBe(true);
});
test('legacy warning captures retain exactly two original targets',()=>{
 const f=inlineScreens();f.record.source_warning={expected:true};
 expect(validateInlineCaptureEvidence(f.record,f.screens)).toBe(true);
 expect(()=>validateInlineCaptureEvidence(f.record,f.screens,'source-warning-v1')).toThrow(/inline targets/);
});
for(const contract of ['unknown',null])test(`inline warning contract rejects ${contract}`,()=>{const f=warningInline();expect(()=>validateInlineChartEvidence(f.geometry,390,844,'synthetic',{...f.context,contract})).toThrow(/unknown inline warning/);});
test('new warning contract requires a boolean source expectation',()=>{const f=warningInline();expect(()=>validateInlineChartEvidence(f.geometry,390,844,'synthetic',{contract:f.context.contract})).toThrow(/warning expectation/);});
const warningMutations=[
 ['missing warning',g=>g.targets=g.targets.filter(t=>!t.selector.endsWith('.entry-source-badge'))],
 ['duplicate warning',g=>g.targets.push(structuredClone(g.targets.find(t=>t.selector.endsWith('.entry-source-badge'))))],
 ['unexpected extra',g=>g.targets.push({...structuredClone(g.targets[0]),selector:'.unrelated'})],
 ['offscreen warning',g=>g.targets.find(t=>t.selector.endsWith('.entry-source-badge')).rect=rect(24,20,200,20)],
 ['overlapped warning',g=>g.targets.find(t=>t.selector.endsWith('.entry-source-badge')).hit_samples[0]=false],
 ['hidden warning',g=>g.targets.find(t=>t.selector.endsWith('.entry-source-badge')).shown=false],
 ['missing plot',g=>g.targets=g.targets.filter(t=>!t.selector.endsWith('svg[data-chart-plot]'))],
 ['clipped plot',g=>g.targets.find(t=>t.selector.endsWith('svg[data-chart-plot]')).rect=rect(16,700,358,390)],
 ['missing controls',g=>g.targets=g.targets.filter(t=>!t.selector.endsWith('.leader-svg-controls'))],
 ['incomplete hit proof',g=>g.targets.find(t=>t.selector.endsWith('.entry-source-badge')).hit_samples=[]],
];
for(const width of [390,1440])for(const state of ['default','annotations'])for(const [label,mutate] of warningMutations)test(`warning geometry rejects ${label} ${width}/${state} at both observation times`,()=>{
 const f=warningInline(width);mutate(f.geometry[state]);expect(()=>validateInlineChartEvidence(f.geometry,width,f.record.viewport.height,'synthetic',f.context)).toThrow();
 const atCapture=warningInline(width);mutate(atCapture.screens[state==='default'?0:1].viewport_geometry);expect(()=>validateInlineCaptureEvidence(atCapture.record,atCapture.screens,atCapture.context.contract)).toThrow();
});
for(const state of ['default','annotations'])test(`desktop warning requires full symbol header ${state} at both observation times`,()=>{
 const remove=g=>g.targets=g.targets.filter(t=>t.selector!=='.research-symbol-head'), f=warningInline(1440);
 remove(f.geometry[state]);expect(()=>validateInlineChartEvidence(f.geometry,1440,900,'synthetic',f.context)).toThrow(/inline targets/);
 const capture=warningInline(1440);remove(capture.screens[state==='default'?0:1].viewport_geometry);expect(()=>validateInlineCaptureEvidence(capture.record,capture.screens,capture.context.contract)).toThrow(/inline targets/);
});
test('no-warning contract cannot smuggle warning targets or claim false expectation',()=>{
 const f=warningInline();f.record.source_warning.expected=false;
 expect(()=>validateInlineCaptureEvidence(f.record,f.screens,'source-warning-v1')).toThrow(/inline targets/);
});
test('full report rejects unknown inline warning contract before accepting cases',()=>{const f=feedFixture();f.report.inline_warning_geometry_contract='future';expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow(/Unknown inline warning/);});
