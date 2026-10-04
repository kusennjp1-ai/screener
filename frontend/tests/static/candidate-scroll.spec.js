import { test, expect } from '@playwright/test';
import { withAuditFixture } from '../../src/static/testAuditFixture.js';
import { withSyntheticFinancialProof, financialFixtureDate as date, financialFixtureNow as now } from '../../src/test/fixtures/financialCurrent.js';

const rows=Array.from({length:101},(_,index)=>{
 const row=withAuditFixture({
  symbol:`PERF${String(index).padStart(3,'0')}`,company_name:`Synthetic scrolling case ${index}`,market:'US',
  current_price:102,se_pivot_price:100,adv_usd:5e7,rs_rating:95,
 },date);
 // Missing, ordinary and loss-narrowing evidence have different real heights.
 // Financial references do not change this fixture's technical ranking order.
 if(index%3===0)return row;
 const sourced=withSyntheticFinancialProof({...row,eps_growth_yy:index%3===2?50:30});
 if(index%3===2){
  sourced.financial_current.r=sourced.financial_current.r.slice(0,1)+'f'+sourced.financial_current.r.slice(2);
  sourced.financial_current.p[1][6]='l';
 }
 return sourced;
});

// The approved table → feed layout has variable-height cards and four actions
// per card. Preserve keyboard reachability and materialized geometry, not the
// former 51/70px table-row estimate or an unmaterialized total scrollHeight.
for(const width of [1440,1024,390])test(`offscreen feed cards keep geometry, focus and full pagination at ${width}px`,async({page},info)=>{
  await page.setViewportSize({width,height:width===390?844:900});
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/static-data/**',route=>{
    const file=new URL(route.request().url()).pathname.split('/').pop();
    const payload=file==='manifest.json'?{generated_at:`${date}T23:00:00Z`,research_generation:'scroll-fixture',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}}}}}
      :file==='research.json'?{as_of_date:date,rows}:{};
    return route.fulfill({json:payload});
  });
  await page.goto('/');
  await expect(page.getByRole('heading',{name:'候補リスト 101件'})).toBeVisible();
  const items=page.getByRole('list',{name:'投資手法別の銘柄候補'}).getByRole('listitem');
  await expect(items).toHaveCount(50);
  await expect(page.getByRole('button',{name:'前の50件',exact:true})).toBeDisabled();
  await page.evaluate(()=>document.fonts.ready);
  const expectPageGeometry=async label=>{
    const bounds=await items.evaluateAll(nodes=>nodes.map(item=>{
      const box=node=>{const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
      const card=item.querySelector('.candidate-feed-card');
      return {symbol:card.querySelector('.candidate-name strong').textContent,item:box(item),card:box(card),
        next:item.nextElementSibling?box(item.nextElementSibling.querySelector('.candidate-row')):null,
        actions:[...card.querySelectorAll('button')].map(node=>({label:node.getAttribute('aria-label'),...box(node)}))};
    }));
    await info.attach(`whole-page-geometry-${label}`,{body:JSON.stringify(bounds),contentType:'application/json'});
    // Inspect the unvisited cards too. Focusing first would remove skipped-size
    // containment and miss the original next-card/evidence-button collision.
    for(const row of bounds){
      expect(row.card.top,`${label}: ${row.symbol} starts outside its item`).toBeGreaterThanOrEqual(row.item.top-.1);
      expect(row.card.bottom,`${label}: ${row.symbol} extends past its item`).toBeLessThanOrEqual(row.item.bottom+.1);
      if(row.next)expect(row.card.bottom,`${label}: ${row.symbol} overlaps the next primary action`).toBeLessThanOrEqual(row.next.top+.1);
      for(const action of row.actions){
        expect(action.width,`${label}: ${action.label} target width`).toBeGreaterThanOrEqual(44);
        expect(action.height,`${label}: ${action.label} target height`).toBeGreaterThanOrEqual(44);
        expect(action.top).toBeGreaterThanOrEqual(row.card.top-.1);
        expect(action.bottom).toBeLessThanOrEqual(row.card.bottom+.1);
      }
    }
    return bounds;
  };
  const initial=await expectPageGeometry('initial-unvisited');
  expect(new Set(initial.map(row=>Math.round(row.card.height))).size,'fixture must exercise variable card heights').toBeGreaterThan(1);
  const geometry=async target=>target.evaluate(node=>{
    const box=element=>{const r=element.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
    const item=node.closest('[role=listitem]'),card=node.closest('.candidate-feed-card');
    const header=document.querySelector('.leader-header'),heading=document.querySelector('.candidate-board-heading');
    if(!item||!card||!header||!heading)throw Error('Required feed/header/heading geometry is missing');
    const row=box(node),headerBounds=box(header),nav=document.querySelector('.leader-mobile-nav');
    const navBounds=nav&&getComputedStyle(nav).display!=='none'?box(nav):null;
    let visibleTop=headerBounds.bottom,visibleBottom=navBounds?.height?navBounds.top:innerHeight;
    for(let parent=node.parentElement;parent&&parent!==document.body;parent=parent.parentElement){
      if(/auto|scroll|hidden|clip/.test(getComputedStyle(parent).overflowY)){
        const bounds=box(parent);visibleTop=Math.max(visibleTop,bounds.top);visibleBottom=Math.min(visibleBottom,bounds.bottom);
      }
    }
    const inset=.5;
    const hit=[row.left+inset,(row.left+row.right)/2,row.right-inset].every(x=>
      [row.top+inset,(row.top+row.bottom)/2,row.bottom-inset].every(y=>{
        const hit=document.elementFromPoint(x,y);return hit&&node.contains(hit);
      }));
    return {row,item:box(item),card:box(card),primary:box(card.querySelector('.candidate-row')),growth:box(card.querySelector('.feed-growth')),nextCheck:box(card.querySelector('.feed-next-check')),footer:box(card.querySelector('.feed-card-footer')),
      previous:item.previousElementSibling?box(item.previousElementSibling):null,next:item.nextElementSibling?box(item.nextElementSibling):null,
      header:headerBounds,heading:box(heading),controls:[...heading.querySelectorAll('button,select')].map(box),visibleTop,visibleBottom,hit};
  });
  const expectFocused=async target=>{
    await expect(target).toBeFocused();await expect(target).toBeInViewport({ratio:1});
    const bounds=await geometry(target);
    expect(bounds.row.top).toBeGreaterThanOrEqual(bounds.visibleTop-.1);
    expect(bounds.row.bottom).toBeLessThanOrEqual(bounds.visibleBottom+.1);
    expect(bounds.row.left).toBeGreaterThanOrEqual(0);expect(bounds.row.right).toBeLessThanOrEqual(width);
    expect(bounds.row.width).toBeGreaterThanOrEqual(44);expect(bounds.row.height).toBeGreaterThanOrEqual(44);
    expect(bounds.hit).toBe(true);
    return bounds;
  };
  const expectStableCard=async(target,label)=>{
    const before=await geometry(target);
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const after=await geometry(target);
    await info.attach(`materialized-card-${label}`,{body:JSON.stringify({before,after}),contentType:'application/json'});
    for(const part of ['item','card','row'])for(const edge of ['top','bottom','height'])expect(Math.abs(after[part][edge]-before[part][edge]),`${label}: materialized ${part}.${edge} changed without interaction`).toBeLessThanOrEqual(1);
    expect(after.primary.height).toBeGreaterThanOrEqual(44);
    for(const part of ['growth','nextCheck','footer'])expect(after[part].height,`${label}: ${part} collapsed`).toBeGreaterThan(0);
    expect(after.card.height).toBeGreaterThanOrEqual(after.primary.height+after.growth.height+after.nextCheck.height+after.footer.height);
    expect(after.item.height).toBeGreaterThanOrEqual(after.card.height);
    expect(after.card.top).toBeGreaterThanOrEqual(after.item.top-.1);expect(after.card.bottom).toBeLessThanOrEqual(after.item.bottom+.1);
    if(after.previous)expect(after.previous.bottom).toBeLessThanOrEqual(after.item.top+.1);
    if(after.next)expect(after.item.bottom).toBeLessThanOrEqual(after.next.top+.1);
    return after;
  };
  const penultimate=page.getByRole('button',{name:/^PERF048 の分析/});
  // Initial setup chooses the offscreen starting card. Every subsequent action
  // is reached through Tab/Shift+Tab or the existing arrow navigation.
  await penultimate.focus();
  await expectFocused(penultimate);
  const actions=items.nth(48).getByRole('button');
  await expect(actions).toHaveCount(4);
  await expect(actions.nth(0)).toHaveAccessibleName(/^PERF048 の分析/);
  await expect(actions.nth(1)).toHaveAccessibleName('PERF048 の財務・日次根拠を見る');
  await expect(actions.nth(2)).toHaveAccessibleName('PERF048 のチャートを開く');
  await expect(actions.nth(3)).toHaveAccessibleName('PERF048 ウォッチに保存');
  for(let index=1;index<await actions.count();index++){
    await page.keyboard.press('Tab');await expectFocused(actions.nth(index));
    await expect(actions.nth(index)).toHaveCSS('outline-style','solid');
  }
  await page.keyboard.press('Tab');
  const last=page.getByRole('button',{name:/^PERF049 の分析/});
  await expectFocused(last);
  await expect(last).toHaveCSS('outline-offset','-3px');
  await expect(last).toHaveCSS('outline-style','solid');
  const materialized=await expectStableCard(last,'last-page-one');
  // Reverse traversal must visit those same controls without a focus shortcut.
  for(let index=3;index>=0;index--){await page.keyboard.press('Shift+Tab');await expectFocused(actions.nth(index));}
  for(let index=1;index<await actions.count();index++){await page.keyboard.press('Tab');await expectFocused(actions.nth(index));}
  await page.keyboard.press('Tab');await expectFocused(last);
  const revisited=await expectStableCard(last,'revisited-page-one');
  expect(Math.abs(revisited.card.height-materialized.card.height)).toBeLessThanOrEqual(1);
  // Arrow navigation crosses the page boundary at every supported layout.
  await last.press('ArrowDown');
  const next=page.getByRole('button',{name:/^PERF050 の分析/});
  await expect(items).toHaveCount(50);await expectFocused(next);
  await next.press('ArrowUp');
  await expect(items).toHaveCount(50);await expectFocused(last);
  const returned=await expectStableCard(last,'arrow-return-page-one');
  expect(Math.abs(returned.card.height-materialized.card.height)).toBeLessThanOrEqual(1);
  await expectPageGeometry('after-offscreen-and-arrow-traversal');
  const expectPageStart=async symbol=>{
    const first=items.first().locator('.candidate-row');
    await expect(first).toContainText(symbol);
    const start=rows.findIndex(row=>row.symbol===symbol);
    expect(await items.locator('.candidate-name strong').allTextContents()).toEqual(rows.slice(start,start+50).map(row=>row.symbol));
    const bounds=await expectFocused(first);
    expect(bounds.heading.height).toBeGreaterThan(0);expect(bounds.controls).toHaveLength(3);
    for(const control of bounds.controls){expect(control.height).toBeGreaterThanOrEqual(44);expect(control.width).toBeGreaterThan(0);}
    expect(bounds.row.top).toBeGreaterThanOrEqual(Math.max(bounds.header.bottom,bounds.heading.bottom,...bounds.controls.map(control=>control.bottom))-.1);
    if(width<1280)expect(bounds.heading.top).toBeGreaterThanOrEqual(bounds.header.bottom-.1);
    await expectStableCard(first,`page-start-${symbol}`);
    await expectPageGeometry(`page-start-${symbol}`);
  };
  await page.getByRole('button',{name:'次の50件',exact:true}).click();
  await expect(items).toHaveCount(50);
  await expectPageStart('PERF050');
  await page.getByRole('button',{name:'次の50件',exact:true}).click();
  await expect(items).toHaveCount(1);
  await expectPageStart('PERF100');
  await expect(page.getByRole('button',{name:'次の50件',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'前の50件',exact:true}).click();
  await expect(items).toHaveCount(50);
  await expectPageStart('PERF050');
  await page.getByRole('button',{name:'前の50件',exact:true}).click();
  await expect(items).toHaveCount(50);
  await expectPageStart('PERF000');
  await expect(page.getByRole('button',{name:'前の50件',exact:true})).toBeDisabled();
  await expect(page.getByRole('heading',{name:'候補リスト 101件'})).toHaveText('候補リスト 101件');
});
