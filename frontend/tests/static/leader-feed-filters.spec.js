import { openResearchList } from './research-navigation.js';
import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { rankCandidates, entryPlan } from '../../src/static/researchEngine.js';
import { filterRanked } from '../../src/static/researchPresentation.js';

const date='2026-10-22',now=new Date('2026-10-23T12:00:00Z');
// Deliberately synthetic inputs, never production values or design-image data.
const rows=[['ZONE95',102,95],['EDGE85',104,85],['LOW70',102,70],['NO_RS',102,null],['HIGH99',110,99]].map(([symbol,current_price,rs_rating])=>withAuditFixture({symbol,company_name:`Synthetic ${symbol}`,market:'US',current_price,se_pivot_price:100,adv_usd:5e7,rs_rating},date));
const methods=[['ミネルヴィニ','minervini'],['基本と原則','minervini2'],['オニール','oneil'],['IBD型','ibd']];

test('390px feed combines canonical price/finite RS filters, search, four strategies and reset',async({page},info)=>{
 await page.setViewportSize({width:390,height:844});await page.clock.setFixedTime(now);
 await page.route('**/static-data/**',route=>{
  const name=new URL(route.request().url()).pathname.split('/').pop();
  return route.fulfill({json:name==='manifest.json'?{as_of_date:date,generated_at:'2026-10-23T01:00:00Z',research_generation:'feed-filter-fixture',assets:{research:{path:'research.json'}}}:name==='research.json'?{as_of_date:date,rows}:{}});
 });
 await page.goto('/'); await openResearchList(page);
 const list=page.getByRole('list',{name:'投資手法別の銘柄候補'}),quick=page.getByRole('group',{name:'クイック絞り込み'});
 const position=quick.getByRole('button',{name:'買い位置',exact:true}),rs=quick.getByRole('button',{name:'RS 80+',exact:true}),near=quick.getByRole('button',{name:'あと1条件',exact:true});
 const tabs=page.getByRole('group',{name:'投資手法'}),search=page.locator('.leader-feed-search').getByRole('textbox');
 const symbols=async expected=>{await expect.poll(async()=> (await list.locator('.leader-post-avatar').allTextContents()).sort()).toEqual([...expected].sort());};
 await symbols(rows.map(row=>row.symbol));
 const missing=list.getByRole('button',{name:/^NO_RS の分析/});
 await expect(missing.locator('.leader-rs-ring')).toContainText('データなし');
 await expect(missing.locator('.leader-chart-empty')).toContainText('データなし');
 await expect(missing.locator('.leader-condition-strip [data-state=unknown]')).not.toHaveCount(0);
 await expect(missing.locator('.leader-post-identity')).toContainText('@NO_RS');
 await position.click();await expect(position).toHaveAttribute('aria-pressed','true');await symbols(['ZONE95','EDGE85','LOW70','NO_RS']);
 await expect(page.locator('.leader-filter-scope')).toContainText('選定・日次条件の通過とは別');
 await position.click();await rs.click();await symbols(['ZONE95','EDGE85','HIGH99']);
 await position.click();await symbols(['ZONE95','EDGE85']);
 for(const [label,method] of methods){
  const tab=tabs.getByRole('button',{name:label,exact:true});await tab.click();await expect(tab).toHaveAttribute('aria-pressed','true');
  const expected=rows.filter(row=>entryPlan(row,null,method).state==='買いゾーン内'&&Number.isFinite(row.rs_rating)&&row.rs_rating>=80).map(row=>row.symbol);
  await symbols(expected);await expect(position).toHaveAttribute('aria-pressed','true');await expect(rs).toHaveAttribute('aria-pressed','true');
  await search.fill('EDGE85');await symbols(expected.filter(symbol=>symbol==='EDGE85'));await search.fill('');await symbols(expected);
 }
 await near.click();await expect(near).toHaveAttribute('aria-pressed','true');
 const nearExpected=filterRanked(rankCandidates(rows,'ibd',{now:now.getTime()}),{nearOnly:true,liquidOnly:true}).filter(({row})=>entryPlan(row,null,'ibd').state==='買いゾーン内'&&Number.isFinite(row.rs_rating)&&row.rs_rating>=80).map(({row})=>row.symbol);
 await symbols(nearExpected);await near.click();await symbols(['ZONE95','EDGE85']);
 await search.fill('ZONE95');await symbols(['ZONE95']);
 await page.getByRole('button',{name:'候補を絞り込む',exact:true}).click();
 const drawer=page.getByRole('dialog',{name:'候補を絞り込む'});await drawer.getByRole('button',{name:'検索・絞り込みを初期化'}).click();
 await drawer.getByRole('button',{name:'絞り込みを閉じる'}).click();await expect(drawer).not.toBeVisible();
 await expect(search).toHaveValue('');for(const button of [position,rs,near])await expect(button).toHaveAttribute('aria-pressed','false');
 await expect(tabs.getByRole('button',{name:'IBD型',exact:true})).toHaveAttribute('aria-pressed','true');await symbols(rows.map(row=>row.symbol));
 // Sorting must reorder actual posts, not only update the selector value.
 await page.getByRole('combobox',{name:'候補の並び順'}).selectOption('rs');
 await expect(list.locator('.leader-post-avatar')).toHaveText(['HIGH99','ZONE95','EDGE85','LOW70','NO_RS']);
 expect(await quick.locator('button').evaluateAll(nodes=>nodes.every(node=>{const r=node.getBoundingClientRect();return r.width>=44&&r.height>=44;}))).toBe(true);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath('leader-feed-390-filters-reset.png'),fullPage:true});
});
