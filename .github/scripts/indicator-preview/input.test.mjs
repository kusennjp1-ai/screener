import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openPublishedInput } from './input.mjs';
test('requires an exact external pin and one source without credentials or query parameters',async()=>{
 await assert.rejects(openPublishedInput({directory:'/tmp'}),/SHA-256/);
 await assert.rejects(openPublishedInput({directory:'/tmp',baseURL:'https://example.test/',publicationSha256:'0'.repeat(64)}),/exactly one/);
 await assert.rejects(openPublishedInput({baseURL:'http://example.test/',publicationSha256:'0'.repeat(64)}),/Invalid published/);
 await assert.rejects(openPublishedInput({baseURL:'https://user:secret@example.test/',publicationSha256:'0'.repeat(64)}),/Invalid published/);
 await assert.rejects(openPublishedInput({baseURL:'https://example.test/?latest=true',publicationSha256:'0'.repeat(64)}),/Invalid published/);
});
test('rejects a changed receipt before reading any transport data and leaves the source intact',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'indicator-input-'));
 try{const receipt=Buffer.from('{"schema":"untrusted"}');await writeFile(join(directory,'publication.json'),receipt);
  await assert.rejects(openPublishedInput({directory,publicationSha256:'0'.repeat(64)}),/digest mismatch/);
  assert.deepEqual(await readFile(join(directory,'publication.json')),receipt);
 }finally{await rm(directory,{recursive:true,force:true});}
});
test('the browser harness exits before any browser work outside an admitted CI job',()=>{
 const result=spawnSync(process.execPath,['.github/scripts/indicator-preview/capture.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'',GITHUB_RUN_ID:''}});
 assert.equal(result.status,1);assert.match(result.stderr,/restricted to admitted GitHub Actions jobs/);assert.doesNotMatch(result.stderr,/browserType.launch|<launching>/);
});

test('accepts only the exact repository, isolated push branch and checked-in #99 pin',async()=>{
 const {loadPreviewPin,verifyPreviewPin,requireAdmittedPreview,previewInputOptions}=await import('./controls.mjs');
 const pin=await loadPreviewPin();assert.equal(pin.source_release.run_id,37456692717);
 const env={GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'kusennjp1-ai/screener',GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/preview/market-indicator-histories',GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
 requireAdmittedPreview(env);
 assert.deepEqual(await previewInputOptions(env),{baseURL:'https://kusennjp1-ai.github.io/screener/',publicationSha256:'0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a'});
 for(const patch of [{GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'pull_request'},{GITHUB_EVENT_NAME:'workflow_dispatch'},{GITHUB_REF:'refs/heads/main'},{GITHUB_REF:'refs/heads/preview/other'},{GITHUB_SHA:'short'},{GITHUB_RUN_ID:''},{INDICATOR_INPUT_BASE_URL:'https://example.test/'},{INDICATOR_INPUT_DIRECTORY:'/tmp'},{INDICATOR_PUBLICATION_SHA256:'b'.repeat(64)}])assert.throws(()=>requireAdmittedPreview({...env,...patch}));
 for(const patch of [{base_url:'https://example.test/'},{publication_sha256:'b'.repeat(64)},{source_release:{...pin.source_release,run_attempt:2}},{branch:'main'},{publication_authority:'release'}])assert.throws(()=>verifyPreviewPin({...pin,...patch}));
 await assert.rejects(previewInputOptions({INDICATOR_INPUT_BASE_URL:'https://example.test/'}),/prohibited/);
});

test('accepts the exact 766121-byte deployed #99 receipt within a bounded 1 MiB cap',async()=>{
 const {gunzipSync}=await import('node:zlib');
 const {parsePinnedPublication,sha256,PUBLICATION_BYTE_LIMIT,ASSET_BYTE_LIMIT}=await import('./input.mjs');
 const {validateExpectedRoot}=await import('../../../frontend/src/static/transport/index.mjs');
 const raw=gunzipSync(await readFile(new URL('./fixtures/publication-99.json.gz',import.meta.url)));
 const pin='0e5b6b58fb3f501d8121ff1d77b026652207a4289fa018b8049ae099e346434a';
 assert.equal(raw.length,766121);assert.equal(sha256(raw),pin);
 assert.equal(PUBLICATION_BYTE_LIMIT,1048576);assert.equal(ASSET_BYTE_LIMIT,134217728);
 const value=parsePinnedPublication(raw,pin);validateExpectedRoot(value.transport.root);
 assert.equal(value.run_id,37456692717);assert.equal(value.run_attempt,1);
 assert.equal(value.transport.root.bytes,54900);
 assert.equal(value.transport.root.bindings.manifestSha256,value.data_manifest_sha256);
 assert.equal(value.transport.root.bindings.financialGeneration,value.financial_generation);
 assert.equal(value.transport.root.bindings.appCommit,value.ui_sha);
 const changed=Buffer.from(raw);changed[changed.length-1]^=1;
 assert.throws(()=>parsePinnedPublication(changed,pin),/digest mismatch/);
 assert.throws(()=>parsePinnedPublication(Buffer.alloc(PUBLICATION_BYTE_LIMIT+1),pin),/1 MiB cap/);
});


test('resolves the installed browser and accessibility APIs without launching a browser', async()=>{
 const {createRequire}=await import('node:module');
 const require=createRequire(new URL('../../../frontend/package.json',import.meta.url));
 const lock=JSON.parse(await readFile(new URL('../../../frontend/package-lock.json',import.meta.url)));
 assert.equal(require('@playwright/test/package.json').version,lock.packages['node_modules/@playwright/test'].version);
 const {loadPreviewBrowserTools}=await import('./browser-tools.mjs');
 const {chromium,AxeBuilder}=loadPreviewBrowserTools();
 assert.equal(chromium,require('@playwright/test').chromium);
 assert.equal(typeof chromium.launch,'function');
 assert.equal(AxeBuilder,require('@axe-core/playwright').AxeBuilder);
 assert.equal(typeof AxeBuilder,'function');
 assert.equal(typeof AxeBuilder.prototype.analyze,'function');
 assert.equal(typeof AxeBuilder.prototype.include,'function');
 assert.equal(typeof AxeBuilder.prototype.withTags,'function');
 // Deliberately do not call launch(), construct a browser, or open a page.
});


test('uses a new explicit guarded context per viewport and permits Axe-style extra pages without a browser launch',async()=>{
 const {withPreviewViewport}=await import('./viewport-context.mjs');
 const contexts=[],events=[];
 const browser={newPage:()=>{throw Error('Convenience browser.newPage must not be used');},newContext:async options=>{
  const context={options,pages:[],closed:false,route:async(pattern,handler)=>{assert.equal(pattern,'**/*');context.handler=handler;events.push('guard');},newPage:async()=>{
   assert.equal(typeof context.handler,'function');assert.equal(context.closed,false);
   const page={context:()=>context,close:async()=>{events.push('close-page');}};context.pages.push(page);events.push('new-page');return page;
  },close:async()=>{context.closed=true;events.push('close-context');}};
  contexts.push(context);return context;
 }};
 const viewports=[{width:1440,height:900},{width:390,height:667},{width:360,height:568}];
 for(const viewport of viewports)await withPreviewViewport(browser,viewport,'http://127.0.0.1:4321',async page=>{
  assert.deepEqual(page.context().options,{viewport,reducedMotion:'reduce'});
  const extra=await page.context().newPage();await extra.close(); // The operation required by Axe.finishRun.
  const routeResult=async url=>{let result;await page.context().handler({request:()=>({url:()=>url}),continue:async()=>{result='allow';},abort:async()=>{result='block';}});return result;};
  assert.equal(await routeResult('http://127.0.0.1:4321/assets/app.js'),'allow');
  for(const url of ['https://example.test/','http://127.0.0.1:4322/','file:///tmp/private','not a URL'])assert.equal(await routeResult(url),'block');
 });
 assert.equal(contexts.length,3);assert.ok(contexts.every(context=>context.pages.length===2&&context.closed));
 assert.deepEqual(events,['guard','new-page','new-page','close-page','close-context','guard','new-page','new-page','close-page','close-context','guard','new-page','new-page','close-page','close-context']);
});

test('closes explicit contexts when routing, page creation or accessibility work fails',async()=>{
 const {withPreviewViewport}=await import('./viewport-context.mjs');
 for(const failure of ['route','page','axe']){
  let closed=false;
  const browser={newContext:async()=>({route:async()=>{if(failure==='route')throw Error(failure);},newPage:async()=>{if(failure==='page')throw Error(failure);return {};},close:async()=>{closed=true;}})};
  await assert.rejects(withPreviewViewport(browser,{width:360,height:568},'http://127.0.0.1:4321',async()=>{throw Error('axe');}),new RegExp(failure));
  assert.equal(closed,true);
 }
});

test('preserves actionable Axe selectors, HTML and contrast evidence without relaxing severity',async()=>{
 const {seriousAccessibilityViolations}=await import('./diagnostics.mjs');
 const node={target:['.history a'],html:'<a href="https://www.sec.gov/13f">SEC 13F</a>',failureSummary:'Contrast is below 4.5',any:[{id:'color-contrast',message:'Insufficient contrast',data:{contrastRatio:2.1,expectedContrastRatio:'4.5:1'}}],all:[],none:[]};
 const result=seriousAccessibilityViolations([{id:'color-contrast',impact:'serious',help:'Readable text',nodes:[node]},{id:'minor',impact:'moderate',nodes:[node]},{id:'critical',impact:'critical',nodes:[]}]);
 assert.equal(result.length,2);assert.equal(result[0].nodes,1);
 assert.deepEqual(result[0].node_details[0],{target:node.target,html:node.html,failure_summary:node.failureSummary,checks:[{group:'any',...node.any[0]}]});
});

test('the isolated preview imports the production layout style order and research theme',async()=>{
 const production=await readFile(new URL('../../../frontend/src/static/StaticLayout.jsx',import.meta.url),'utf8');
 const preview=await readFile(new URL('./app.jsx',import.meta.url),'utf8');
 const styles=[...production.matchAll(/import '\.\/(.*?)\.css';/g)].map(match=>`${match[1]}.css`);
 assert.ok(styles.length>=4);
 const positions=styles.map(style=>preview.indexOf(`import '../src/static/${style}';`));
 assert.ok(positions.every((position,index)=>position>=0&&(!index||position>positions[index-1])));
 assert.match(preview,/createTheme\(researchTheme\('dark'\)\)/);
 assert.match(preview,/<style>\{themeCss\}<\/style>/);
 assert.match(preview,/className="leader-shell" data-theme="dark"/);
 assert.match(preview,/className="research-grid"/);
 assert.doesNotMatch(preview,/compareOnly/);
});

test('keyboard scrolling checks both axes, reports evidence, resets position and rejects inaccessible tables without a browser',async()=>{
 const {checkHistoryKeyboardScrolling}=await import('./diagnostics.mjs');
 const nodes=[{label:'Wide and tall table',tabIndex:0,scrollWidth:600,clientWidth:300,scrollHeight:600,clientHeight:360},{label:'Fits',tabIndex:0,scrollWidth:300,clientWidth:300,scrollHeight:100,clientHeight:100}];
 let focused;
 for(const node of nodes)Object.assign(node,{ownerDocument:{get activeElement(){return focused;}},scrollLeft:0,scrollTop:0,getAttribute:()=>node.label,scrollTo:(x,y)=>{node.scrollLeft=x;node.scrollTop=y;},blur:()=>{focused=null;}});
 const page={locator:()=>({count:async()=>nodes.length,nth:index=>({locator:()=>({count:async()=>index===0?1:0,focus:async()=>{focused='summary';},press:async key=>{assert.equal(key,'Tab');assert.equal(focused,'summary');focused=nodes[index];}}),evaluate:async fn=>fn(nodes[index]),focus:async()=>{focused=nodes[index];},elementHandle:async()=>nodes[index],press:async key=>{assert.equal(focused,nodes[index]);nodes[index][key==='ArrowRight'?'scrollLeft':'scrollTop']=40;}})}),waitForFunction:async(fn,args)=>{assert.equal(fn(args),true);}};
 const results=await checkHistoryKeyboardScrolling(page);
 assert.deepEqual(results[0],{label:nodes[0].label,tabIndex:0,horizontal:true,vertical:true,reached_by_tab:true,horizontal_keyboard_moved:true,vertical_keyboard_moved:true});
 assert.deepEqual(results[1],{label:nodes[1].label,tabIndex:0,horizontal:false,vertical:false});
 assert.equal(nodes[0].scrollLeft,0);assert.equal(nodes[0].scrollTop,0);assert.equal(focused,null);
 nodes[0].tabIndex=-1;await assert.rejects(checkHistoryKeyboardScrolling(page),/not keyboard focusable/);
});
