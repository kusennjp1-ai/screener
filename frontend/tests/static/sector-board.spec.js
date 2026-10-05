import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { SECTORS } from '../../src/static/sectorDefinitions.js';
const groups=[...SECTORS,['Unknown','分類不明',null]].map(([key,label,etf],i)=>({key,label,etf,relative:{63:{value:etf?113-i*2.5:null},126:{value:etf?90+i*2:null}},momentum21:{value:etf?95+(i%5)*2:null},small:i===11,rates:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,{pass:i,total:100,unknown:2,percent:i}]))}));
const raw=JSON.stringify({as_of:'2026-09-29',snapshot_id:'synthetic-sectors',sectors:{groups,as_of:'2026-09-29',source:'Synthetic test data'}}),sha256=createHash('sha256').update(raw).digest('hex');
const date='2026-09-29';
// Published rates deliberately differ from these current research rows. The
// browser must derive counts from the actual research dependency, not the asset.
const rows=groups.flatMap((group,index)=>Array.from({length:12},(_,member)=>{
 const row={symbol:`SYN${index}X${member}`,market:'US',current_price:100,adv_usd:5e7,gics_sector:group.key,rs_rating:member<2?90:10};
 return member<10?withAuditFixture(row,date):{...row,rs_rating:null};
}));
async function installFixture(page,state='current',pending=Promise.resolve()) {
 await page.route('**/static-data/**',async route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  if(file==='sectors.json')return route.fulfill({body:raw,contentType:'application/json'});
  if(file==='research.json') {
   if(state==='error')return route.fulfill({status:503,json:{error:'Synthetic research unavailable'}});
   if(state==='loading')await pending;
   return route.fulfill({json:{as_of_date:date,rows}});
  }
  return route.fulfill({json:file==='manifest.json'?{as_of_date:date,generated_at:'2026-09-30T04:56:47Z',research_generation:'synthetic-sector-research',assets:{workbench:{path:'sectors.json',sha256,snapshot_id:'synthetic-sectors'},...(state==='missing'?{}:{research:{path:'research.json'}})},pages:{breadth:{path:'unused.json'}}}:{}});
 });
}
async function expectCompactGeometry(page,width) {
 if(width===390) {
  await expect(page.locator('.sector-index-mobile')).toBeVisible();
  await expect(page.locator('.sector-index-desktop')).toBeHidden();
  const separation=await page.locator('.sector-rank-row').evaluateAll(rows=>rows.map(row=>{
   const value=row.querySelector('.sector-relative-value'),rate=row.querySelector('.sector-rate');
   return value&&rate?rate.getBoundingClientRect().left-value.getBoundingClientRect().right:null;
  }).filter(value=>value!==null));
  expect(separation.length).toBe(11);
  expect(Math.min(...separation)).toBeGreaterThanOrEqual(6);
 }
 const heights=await page.locator('.sector-rank-row').evaluateAll(rows=>rows.map(row=>row.getBoundingClientRect().height));
 expect(heights.length).toBe(12);
 expect(Math.min(...heights)).toBeGreaterThanOrEqual(44);
 const height=await page.evaluate(()=>document.documentElement.scrollHeight);
 expect(height).toBeLessThanOrEqual(width===390?1600:1000);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 expect(axe.violations).toEqual([]);
}
for(const width of [1440,390])for(const theme of ['dark','light'])test(`sector board ${width} ${theme}: layout, linked map and accessible data`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});
 await installFixture(page);
 await page.goto('/#/breadth?tab=sectors');
 await expect(page.getByRole('list',{name:'相対指数順の業種一覧'}).getByRole('link')).toHaveCount(12);
 await expect(page.getByRole('img',{name:'条件通過率 16.7%。通過2、全対象12、未確認2銘柄'})).toHaveCount(12);
 if(theme==='light')await page.getByRole('button',{name:'ライトモードに切り替え'}).click();
 const financial=page.locator('.sector-rank-row[href*="sector=Financial"]');
 await financial.focus();
 await expect(page.locator('circle[data-sector="Financial"]')).toHaveAttribute('data-highlight','true');
 for(const period of ['63','126']){
  await page.getByRole('combobox',{name:'相対強度の期間'}).selectOption(period);
  await expect(page.getByRole('img',{name:/業種ローテーション/})).toBeVisible();
  const boxes=await page.locator('[data-rotation-label]').evaluateAll(labels=>labels.map(label=>{const b=label.getBoundingClientRect();return {x:b.x,y:b.y,r:b.right,b:b.bottom};}));
  for(let i=0;i<boxes.length;i++)for(let j=i+1;j<boxes.length;j++)expect(boxes[i].x<boxes[j].r&&boxes[i].r>boxes[j].x&&boxes[i].y<boxes[j].b&&boxes[i].b>boxes[j].y).toBe(false);
 }
 await page.getByRole('combobox',{name:'相対強度の期間'}).selectOption('63');
 await page.evaluate(()=>window.scrollTo(0,0));
 await expectCompactGeometry(page,width);
 await page.screenshot({path:info.outputPath(`sectors-${width}-${theme}.png`),fullPage:true});
 await page.getByRole('button',{name:'表',exact:true}).click();
 await expect(page.getByRole('table',{name:'業種の相対強度一覧'})).toContainText('未確認2');
 await expect(page.getByRole('link',{name:'金融 / XLF',exact:true})).toHaveAttribute('href','#/?sector=Financial&view=charts&method=minervini');
});

for(const width of [1440,390])for(const state of ['missing','loading','error'])test(`sector board ${width} with ${state} research keeps prices and unknown rate columns`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});
 let release;
 const pending=new Promise(resolve=>{release=resolve;});
 await installFixture(page,state,pending);
 try {
  await page.goto('/#/breadth?tab=sectors');
  await expect(page.getByRole('list',{name:'相対指数順の業種一覧'}).getByRole('link')).toHaveCount(12);
  await expect(page.getByRole('status')).toHaveText(state==='loading'?'現在の財務根拠を再確認しています。条件通過率は未確認です。':'現在の財務根拠を確認できません。条件通過率は未確認です。');
  await expect(page.getByRole('img',{name:'現在の条件通過率は未確認'})).toHaveCount(12);
  await expect(page.locator('.sector-rank-row').first()).toHaveAccessibleName(/相対指数 113.0.*現在の条件通過率は未確認/);
  await expectCompactGeometry(page,width);
  await page.screenshot({path:info.outputPath(`sectors-${width}-${state}.png`),fullPage:true});
  await page.getByRole('button',{name:'表',exact:true}).click();
  const table=page.getByRole('table',{name:'業種の相対強度一覧'});
  await expect(table.getByRole('img',{name:'現在の条件通過率は未確認'})).toHaveCount(12);
  await expect(table).toContainText('113.0');
 } finally {
  release();
  await page.unrouteAll({behavior:'wait'});
 }
});
