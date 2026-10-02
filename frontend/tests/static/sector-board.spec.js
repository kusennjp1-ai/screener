import { test,expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { createHash } from 'node:crypto';
import { SECTORS } from '../../src/static/sectorDefinitions.js';
const groups=[...SECTORS,['Unknown','分類不明',null]].map(([key,label,etf],i)=>({key,label,etf,relative:{63:{value:etf?113-i*2.5:null},126:{value:etf?90+i*2:null}},momentum21:{value:etf?95+(i%5)*2:null},small:i===11,rates:Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>[method,{pass:i,total:100,unknown:2,percent:i}]))}));
const raw=JSON.stringify({as_of:'2026-09-29',snapshot_id:'synthetic-sectors',sectors:{groups,as_of:'2026-09-29',source:'Synthetic test data'}}),sha256=createHash('sha256').update(raw).digest('hex');
for(const width of [1440,390])for(const theme of ['dark','light'])test(`sector board ${width} ${theme}: layout, linked map and accessible data`,async({page},info)=>{
 await page.setViewportSize({width,height:width===390?844:900});
 await page.route('**/static-data/**',async route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  if(file==='sectors.json')return route.fulfill({body:raw,contentType:'application/json'});
  return route.fulfill({json:file==='manifest.json'?{as_of_date:'2026-09-29',generated_at:'2026-09-30T04:56:47Z',assets:{workbench:{path:'sectors.json',sha256,snapshot_id:'synthetic-sectors'}},pages:{breadth:{path:'unused.json'}}}:{}});
 });
 await page.goto('/#/breadth?tab=sectors');
 await expect(page.getByRole('list',{name:'相対指数順の業種一覧'}).getByRole('link')).toHaveCount(12);
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

 const height=await page.evaluate(()=>document.documentElement.scrollHeight);
 expect(height).toBeLessThanOrEqual(width===390?1600:1000);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 const axe=await new AxeBuilder({page}).include('#root').withTags(['wcag2a','wcag2aa','wcag21aa','wcag22aa']).analyze();
 expect(axe.violations).toEqual([]);
 await page.screenshot({path:info.outputPath(`sectors-${width}-${theme}.png`),fullPage:true});
 await page.getByRole('button',{name:'表',exact:true}).click();
 await expect(page.getByRole('table',{name:'業種の相対強度一覧'})).toContainText('未確認2');
 await expect(page.getByRole('link',{name:'金融 / XLF',exact:true})).toHaveAttribute('href','#/?sector=Financial&view=charts&method=minervini');
});
