import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../../src/static/testFinancialFixture.js';
const generation='synthetic-dynamic',generatedAt='2026-10-03T15:35:00Z';
const rows=['SYNTH','OTHER'].map((symbol,i)=>withFinancialProof(withAuditFixture({symbol,company_name:`Synthetic ${symbol}`,currency:'USD',current_price:102+i*100,se_pivot_price:100+i*100,adv_usd:5e7,rs_rating:95,chart_path:`${symbol}.json`},date)));
const bars=Array.from({length:280},(_,i)=>({date:new Date(Date.parse(date)-(279-i)*86400000).toISOString().slice(0,10),open:100,high:104,low:98,close:101+(i%3),volume:i===279?0:1000000}));
const payload=(symbol='SYNTH')=>({symbol,as_of_date:date,generated_at:generatedAt,stock_data:rows.find(row=>row.symbol===symbol),bars:bars.map(bar=>({...bar,...(symbol==='OTHER'?{open:200,high:204,low:198,close:201}:{})})),rs_line:[]});
async function setup(page,width){
 const errors=[];const values={SYNTH:payload(),OTHER:payload('OTHER')},requests={SYNTH:0,OTHER:0},gates={};
 page.__chartErrors=errors;page.on('pageerror',error=>errors.push(error.message));
 await page.setViewportSize({width,height:width===375?812:1000});await page.clock.setFixedTime(new Date(now));
 await page.route('**/*',route=>new URL(route.request().url()).hostname!=='127.0.0.1'?route.abort():route.continue());
 // Test-only bridge to the real app client. Leave its defaults, query keys,
 // fetch functions and component lifetimes unchanged; request a real refetch.
 await page.route(url=>url.pathname==='/src/App.jsx',async route=>{
  const response=await route.fetch(),body=await response.text();
  const instrumented=body.replace('const queryClient = new QueryClient(', 'const queryClient = window.__chartTestQueryClient = new QueryClient(');
  expect(instrumented).not.toBe(body);
  await route.fulfill({response,body:instrumented});
 });
 await page.route('**/static-data/**',async route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop(),symbol=rows.find(row=>row.chart_path===file)?.symbol;
  if(symbol){requests[symbol]++;const captured=structuredClone(values[symbol]);if(gates[symbol])await gates[symbol].promise;return route.fulfill({json:captured});}
  const data=file==='manifest.json'?{as_of_date:date,generated_at:generatedAt,research_generation:generation,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'},charts:{path:'index.json'}},pages:{}}}}:file==='research.json'?{as_of_date:date,rows}:file==='index.json'?{as_of_date:date,symbols:rows.map(row=>({symbol:row.symbol,path:row.chart_path}))}:{};
  return route.fulfill({json:data});
 });
 await page.goto('/#/?method=oneil');await expect.poll(()=>page.evaluate(()=>Boolean(window.__chartTestQueryClient))).toBe(true);
 const choose=async symbol=>{const back=page.getByRole('button',{name:'← 候補一覧',exact:true});if(width===375&&await back.isVisible())await back.click();await page.getByRole('button',{name:new RegExp(`^${symbol} の分析を表示`)}).focus();await page.keyboard.press('Space');};
 await choose('SYNTH');const detail=page.getByRole('region',{name:'銘柄詳細',exact:true}),numeric=detail.locator('.chart-numeric-data');
 await expect(detail.locator('canvas').first()).toBeVisible();await numeric.locator('summary').click();
 const refresh=async()=>{const before=requests.SYNTH;await page.evaluate(()=>{window.__chartTestQueryClient.refetchQueries({queryKey:['staticChartsPayload','SYNTH','SYNTH.json']});});await expect.poll(()=>requests.SYNTH).toBeGreaterThan(before);};
 const hold=symbol=>{let release;const promise=new Promise(resolve=>{release=resolve;});gates[symbol]={promise,release};};
 const release=symbol=>{gates[symbol]?.release();delete gates[symbol];};
 return {detail,numeric,values,requests,errors,refresh,hold,release,choose};
}
test.afterEach(async({page},info)=>{await info.attach('browser-errors',{body:JSON.stringify(page.__chartErrors || []),contentType:'application/json'});});
for(const width of [375,1440]){
 test(`same-identity history updates and empty recovery at ${width}px`,async({page},info)=>{
  const a=await setup(page,width),dates=a.numeric.getByRole('combobox');await dates.selectOption('2026-10-01');
  a.values.SYNTH.bars=[{...bars[0],date:'2025-12-26'},...bars];await a.refresh();await expect(dates.locator('option')).toHaveCount(281);await expect(dates).toHaveValue('2026-10-01');await expect(a.numeric.getByText('終値',{exact:true}).locator('..')).toHaveText('終値103');
  a.values.SYNTH.bars=bars.filter(bar=>bar.date>='2026-09-30');await a.refresh();await expect(dates.locator('option')).toHaveCount(3);await expect(dates).toHaveValue('2026-10-01');
  a.values.SYNTH.bars=bars.filter(bar=>bar.date===date);await a.refresh();await expect(dates).toHaveValue(date);await expect(a.numeric).toContainText('選択していた 2026-10-01');await expect(a.numeric.getByText('出来高',{exact:true}).locator('..')).toHaveText('出来高0');
  await a.numeric.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`reset-${width}.png`)});
  a.values.SYNTH.bars=[];await a.refresh();await expect(a.detail).toContainText('ローソク足データが不足しています');await expect(a.numeric).toHaveCount(0);await expect(a.detail.locator('canvas').first()).not.toBeVisible();
  a.values.SYNTH.bars=bars;await a.refresh();await expect(a.detail.locator('canvas').first()).toBeVisible();await a.numeric.locator('summary').click();await expect(a.numeric.getByRole('combobox')).toHaveValue(date);expect(a.errors).toEqual([]);
 });
 const invalidDates={
  'later last day':b=>[...b,{...b.at(-1),date:'2026-10-03'}],
  'removed latest day':b=>b.slice(0,-1),
  'reordered history':b=>[b[1],b[0],...b.slice(2)],
  'invalid calendar day':b=>[{...b[0],date:'2026-02-30'},...b.slice(1)],
  'missing date':b=>[{...b[0],date:null},...b.slice(1)],
  'duplicate date':b=>[...b.slice(0,-1),{...b.at(-1),close:104},b.at(-1)],
 };
 for(const [label,mutate] of Object.entries(invalidDates))test(`rejects ${label} without stale chart at ${width}px`,async({page},info)=>{
  const a=await setup(page,width);await a.numeric.getByRole('combobox').selectOption('2026-10-01');a.values.SYNTH.bars=mutate(bars);await a.refresh();
  await expect(a.detail.getByRole('alert')).toContainText(/チャートを取得できません|日足.*未確認/);await expect(a.numeric).toHaveCount(0);await expect(a.detail.locator('canvas').first()).not.toBeVisible();
  await a.detail.getByRole('alert').scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`invalid-${label.replaceAll(' ','-')}-${width}.png`)});expect(a.errors).toEqual([]);
  a.values.SYNTH=payload();await a.refresh();await expect(a.detail.locator('canvas').first()).toBeVisible();await a.numeric.locator('summary').click();await expect(a.numeric.getByRole('combobox')).toHaveValue(date);
 });
 for(const invalid of [null,'not-a-number'])test(`unknown numeric ${String(invalid)} clears candles at ${width}px`,async({page},info)=>{
  const a=await setup(page,width);await a.numeric.getByRole('combobox').selectOption(date);a.values.SYNTH.bars=[...bars.slice(0,-1),{...bars.at(-1),close:invalid,volume:null}];await a.refresh();
  await expect(a.numeric.getByRole('combobox')).toHaveValue(date);await expect(a.numeric.getByText('終値',{exact:true}).locator('..')).toHaveText('終値未確認');await expect(a.numeric.getByText('出来高',{exact:true}).locator('..')).toHaveText('出来高未確認');await expect(a.detail.getByRole('alert').filter({hasText:'チャートは未表示'})).toBeVisible();await expect(a.detail.getByText('SYNTH の日足データが不足しています',{exact:true})).toBeVisible();
  await a.numeric.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`unknown-${String(invalid)}-${width}.png`)});expect(a.errors).toEqual([]);
  a.values.SYNTH=payload();await a.refresh();await expect(a.numeric.getByText('出来高',{exact:true}).locator('..')).toHaveText('出来高0');await expect(a.detail.getByRole('alert')).toHaveCount(0);
 });
 test(`late previous-symbol response cannot replace current selection at ${width}px`,async({page},info)=>{
  const a=await setup(page,width);await page.evaluate(()=>window.__chartTestQueryClient.removeQueries({queryKey:['staticChartsPayload','OTHER','OTHER.json','synthetic-dynamic'],exact:true}));a.hold('SYNTH');a.hold('OTHER');a.values.SYNTH.bars=[...bars.slice(0,-1),{...bars.at(-1),close:103.75}];await a.refresh();
  await a.choose('OTHER');await expect.poll(()=>a.requests.OTHER).toBeGreaterThan(0);await expect(a.numeric).toHaveCount(0);await expect(a.detail.locator('canvas').first()).not.toBeVisible();
  const oldResponse=page.waitForResponse(response=>new URL(response.url()).pathname.endsWith('/SYNTH.json'));a.release('SYNTH');await oldResponse;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(a.detail).toContainText('OTHER');await expect(a.numeric).toHaveCount(0);a.release('OTHER');await expect(a.detail.locator('canvas').first()).toBeVisible();await a.numeric.locator('summary').click();
  await expect(a.numeric.getByRole('combobox',{name:'OTHER の日付'})).toHaveValue(date);await expect(a.numeric.getByText('終値',{exact:true}).locator('..')).toHaveText('終値201');await expect(a.numeric).not.toContainText('103.75');await a.numeric.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`late-response-${width}.png`)});expect(a.errors).toEqual([]);
 });
 test(`expanded chart also clears malformed payloads at ${width}px`,async({page},info)=>{
  const a=await setup(page,width);
  await a.detail.getByRole('button',{name:'日次チャートを分析'}).click();
  const dialog=page.getByRole('dialog'),numeric=dialog.locator('.chart-numeric-data');
  await expect(dialog.locator('canvas').first()).toBeVisible();await numeric.locator('summary').click();
  await numeric.getByRole('combobox').selectOption(date);
  a.values.SYNTH.bars=[...bars.slice(0,-1),{...bars.at(-1),close:null}];await a.refresh();
  await expect(numeric.getByText('終値',{exact:true}).locator('..')).toHaveText('終値未確認');
  await expect(numeric.getByText('出来高',{exact:true}).locator('..')).toHaveText('出来高0');
  await expect(dialog.getByRole('alert').filter({hasText:'チャートは未表示'})).toBeVisible();
  await expect(dialog.getByText('SYNTH の日足データが不足しています',{exact:true})).toBeVisible();
  await numeric.scrollIntoViewIfNeeded();await page.screenshot({path:info.outputPath(`expanded-unknown-${width}.png`)});
  a.values.SYNTH=payload();await a.refresh();await expect(numeric.getByText('終値',{exact:true}).locator('..')).toHaveText('終値101');
  a.values.SYNTH.bars=[...bars,bars.at(-1)];await a.refresh();
  await expect(dialog.getByRole('alert')).toContainText('チャートデータの読み込みに失敗しました');
  await expect(numeric).toHaveCount(0);await expect(dialog.locator('canvas')).toHaveCount(0);
  expect(a.errors).toEqual([]);
 });

}
