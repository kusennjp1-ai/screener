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

async function mockFeed(page) {
 await page.clock.setFixedTime(new Date(now));
 await page.route('**/static-data/**',route=>{
  const file=new URL(route.request().url()).pathname.split('/').pop();
  const payload=file==='manifest.json'?{generated_at:`${date}T23:00:00Z`,research_generation:'scroll-fixture',as_of_date:date,default_market:'US',supported_markets:['US'],markets:{US:{as_of_date:date,assets:{research:{path:'research.json'}}}}}
   :file==='research.json'?{as_of_date:date,rows}:{};
  return route.fulfill({json:payload});
 });
}

// The approved table → feed layout has variable-height cards and four actions
// per card. Preserve keyboard reachability and materialized geometry, not the
// former 51/70px table-row estimate or an unmaterialized total scrollHeight.
for(const [width,height,pageSize] of [[1440,900,50],[1024,900,50],[390,844,50],[360,568,50],[1440,900,20],[360,568,20]])test(`${pageSize===50?'explicit 50-card stress':'default 20-card browsing'} keeps geometry, focus and full pagination at ${width}x${height}`,async({page},info)=>{
  await page.setViewportSize({width,height});
  await mockFeed(page);
  await page.goto(pageSize===50?'/#/?feedSize=50':'/');
  const heading=page.getByRole('region',{name:'候補リスト',exact:true}).locator('.candidate-board-heading h2');
  const expectCandidateHeading=async()=>{
    await expect(heading).toBeVisible();
    for(const text of ['ミネルヴィニ','候補','101件'])await expect(heading).toContainText(text);
  };
  await expectCandidateHeading();
  const items=page.getByRole('list',{name:'投資手法別の銘柄候補'}).getByRole('listitem');
  await expect(items).toHaveCount(pageSize);
  await expect(page.getByRole('combobox',{name:'1ページの銘柄数',exact:true})).toHaveValue(String(pageSize));
  await expect(page.locator('#candidate-board')).toHaveAttribute('data-feed-total','101');
  await expect(page.getByRole('status').filter({hasText:/全101銘柄中/})).toHaveText(`全101銘柄中1–${pageSize}`);
  await expect(page.getByRole('button',{name:`前の${pageSize}件`,exact:true})).toBeDisabled();
  const footerControls=await page.getByRole('navigation',{name:'候補のページ切り替え'}).locator('button,select').evaluateAll(nodes=>nodes.map(node=>{
    const bounds=node.getBoundingClientRect();return {label:node.getAttribute('aria-label')||node.textContent,width:bounds.width,height:bounds.height};
  }));
  for(const control of footerControls){
    expect(control.width,`${control.label} footer target width`).toBeGreaterThanOrEqual(44);
    expect(control.height,`${control.label} footer target height`).toBeGreaterThanOrEqual(44);
  }
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
    // Probe both full axes, including their edges. Bounding-box corners are not
    // necessarily part of a native/rounded button's hit shape. One CSS pixel
    // also keeps edge probes inside fractional viewport and scroll-clip bounds.
    const inset=1,cx=(row.left+row.right)/2,cy=(row.top+row.bottom)/2;
    const points=[0,.25,.5,.75,1].flatMap(fraction=>[
      {x:cx,y:row.top+inset+(row.height-2*inset)*fraction},
      {x:row.left+inset+(row.width-2*inset)*fraction,y:cy},
    ]);
    const describe=element=>element?{tag:element.tagName,id:element.id,class:element.getAttribute('class'),
      label:element.getAttribute('aria-label'),text:element.textContent?.trim().slice(0,100),bounds:box(element)}:null;
    const probe=point=>{
      const actual=document.elementFromPoint(point.x,point.y);
      return {...point,hit:Boolean(actual&&node.contains(actual)),actual:describe(actual),
        stack:document.elementsFromPoint(point.x,point.y).slice(0,4).map(describe)};
    };
    const hitPoints=points.map(probe);
    // Retain the original half-pixel grid diagnostically. In particular, the
    // mobile square primary action's prior corner miss remains unexplained.
    const cornerHitPoints=[row.left+.5,cx,row.right-.5].flatMap(x=>
      [row.top+.5,cy,row.bottom-.5].map(y=>probe({x,y})));
    const style=getComputedStyle(node),hit=hitPoints.every(point=>point.hit);
    return {row,item:box(item),card:box(card),primary:box(card.querySelector('.candidate-row')),growth:box(card.querySelector('.feed-growth')),nextCheck:box(card.querySelector('.feed-next-check')),footer:box(card.querySelector('.feed-card-footer')),
      previous:item.previousElementSibling?box(item.previousElementSibling):null,next:item.nextElementSibling?box(item.nextElementSibling):null,
      header:headerBounds,nav:navBounds,heading:box(heading),controls:[...heading.querySelectorAll('button,select')].map(box),visibleTop,visibleBottom,
      target:describe(node),targetStyle:{borderRadius:style.borderRadius,clipPath:style.clipPath,pointerEvents:style.pointerEvents},hitPoints,cornerHitPoints,hit};
  });
  let focusCheck=0;
  const expectFocused=async target=>{
    await expect(target).toBeFocused();
    // Observe the application's keyboard reveal after the browser's default
    // focus step; do not reposition the target from the test.
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const bounds=await geometry(target);
    const name=`focused-target-${width}-${++focusCheck}`;
    // Retain actual hit elements and their stacking order before any assertion
    // can end the test; a boolean alone cannot distinguish clipping/overlays.
    await info.attach(name,{body:JSON.stringify(bounds),contentType:'application/json'});
    if(!bounds.hit||bounds.row.top<bounds.visibleTop||bounds.row.bottom>bounds.visibleBottom){
      const path=info.outputPath(`${name}.png`);
      await page.screenshot({path});await info.attach(`${name}-screen`,{path,contentType:'image/png'});
    }
    await expect(target).toBeInViewport({ratio:1});
    expect(bounds.row.top).toBeGreaterThanOrEqual(bounds.visibleTop-.1);
    expect(bounds.row.bottom).toBeLessThanOrEqual(bounds.visibleBottom+.1);
    expect(bounds.row.left).toBeGreaterThanOrEqual(0);expect(bounds.row.right).toBeLessThanOrEqual(width);
    expect(bounds.row.width).toBeGreaterThanOrEqual(44);expect(bounds.row.height).toBeGreaterThanOrEqual(44);
    expect(bounds.hit,JSON.stringify(bounds.hitPoints.filter(point=>!point.hit))).toBe(true);
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
  const penultimate=page.getByRole('button',{name:new RegExp(`^PERF${String(pageSize-2).padStart(3,'0')} の分析`)});
  // Initial setup chooses the offscreen starting card. Every subsequent action
  // is reached through Tab/Shift+Tab or the existing arrow navigation.
  await penultimate.focus();
  await expectFocused(penultimate);
  const actions=items.nth(pageSize-2).getByRole('button');
  await expect(actions).toHaveCount(4);
  await expect(actions.nth(0)).toHaveAccessibleName(new RegExp(`^PERF${String(pageSize-2).padStart(3,'0')} の分析`));
  await expect(actions.nth(1)).toHaveAccessibleName(`PERF${String(pageSize-2).padStart(3,'0')} の財務・日次根拠を見る`);
  await expect(actions.nth(2)).toHaveAccessibleName(`PERF${String(pageSize-2).padStart(3,'0')} のチャートを開く`);
  await expect(actions.nth(3)).toHaveAccessibleName(`PERF${String(pageSize-2).padStart(3,'0')} ウォッチに保存`);
  for(let index=1;index<await actions.count();index++){
    await page.keyboard.press('Tab');await expectFocused(actions.nth(index));
    await expect(actions.nth(index)).toHaveCSS('outline-style','solid');
  }
  await page.keyboard.press('Tab');
  const last=page.getByRole('button',{name:new RegExp(`^PERF${String(pageSize-1).padStart(3,'0')} の分析`)});
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
  const next=page.getByRole('button',{name:new RegExp(`^PERF${String(pageSize).padStart(3,'0')} の分析`)});
  await expect(items).toHaveCount(pageSize);await expectFocused(next);
  await next.press('ArrowUp');
  await expect(items).toHaveCount(pageSize);await expectFocused(last);
  const returned=await expectStableCard(last,'arrow-return-page-one');
  expect(Math.abs(returned.card.height-materialized.card.height)).toBeLessThanOrEqual(1);
  await expectPageGeometry('after-offscreen-and-arrow-traversal');
  const expectPageStart=async symbol=>{
    const first=items.first().locator('.candidate-row');
    await expect(first).toContainText(symbol);
    const start=rows.findIndex(row=>row.symbol===symbol);
    expect(await items.locator('.candidate-name strong').allTextContents()).toEqual(rows.slice(start,start+pageSize).map(row=>row.symbol));
    const bounds=await expectFocused(first);
    expect(bounds.heading.height).toBeGreaterThan(0);expect(bounds.controls).toHaveLength(3);
    for(const control of bounds.controls){expect(control.height).toBeGreaterThanOrEqual(44);expect(control.width).toBeGreaterThan(0);}
    expect(bounds.row.top).toBeGreaterThanOrEqual(Math.max(bounds.header.bottom,bounds.heading.bottom,...bounds.controls.map(control=>control.bottom))-.1);
    if(width<1280)expect(bounds.heading.top).toBeGreaterThanOrEqual(bounds.header.bottom-.1);
    await expectStableCard(first,`page-start-${symbol}`);
    await expectPageGeometry(`page-start-${symbol}`);
  };
  for(let start=pageSize;start<rows.length;start+=pageSize){
    await page.getByRole('button',{name:`次の${pageSize}件`,exact:true}).click();
    await expect(items).toHaveCount(Math.min(pageSize,rows.length-start));
    await expectPageStart(`PERF${String(start).padStart(3,'0')}`);
    await expect(page.getByRole('status').filter({hasText:/全101銘柄中/})).toHaveText(`全101銘柄中${start+1}–${Math.min(start+pageSize,rows.length)}`);
  }
  await expect(page.getByRole('button',{name:`次の${pageSize}件`,exact:true})).toBeDisabled();
  if(width<=700){
    const finalActions=items.first().getByRole('button');
    const evidence=page.getByRole('button',{name:'PERF100 の財務・日次根拠を見る',exact:true});
    // The final card has no following card to supply extra scrolling room.
    // Reach every action through the keyboard, including the short viewport.
    for(let index=1;index<await finalActions.count();index++){
      await page.keyboard.press('Tab');await expectFocused(finalActions.nth(index));
    }
    for(let index=await finalActions.count()-2;index>=1;index--){
      await page.keyboard.press('Shift+Tab');await expectFocused(finalActions.nth(index));
    }
    const positioned=await expectFocused(evidence);
    expect(positioned.nav,'mobile bottom navigation must be present').not.toBeNull();
    expect(positioned.nav.bottom).toBeCloseTo(height,1);
    // Exercise a real wheel gesture near the fixed nav, without DOM scrolling
    // or a locator click silently repositioning the evidence action for us.
    const delta=Math.ceil(positioned.row.bottom-positioned.visibleBottom+8);
    const scroll=await page.evaluate(()=>({y:scrollY,max:document.documentElement.scrollHeight-innerHeight}));
    await page.mouse.move((positioned.row.left+positioned.row.right)/2,(positioned.row.top+positioned.row.bottom)/2);
    await page.mouse.wheel(0,delta);
    const expectedScroll=Math.max(0,Math.min(scroll.max,scroll.y+delta));
    await expect.poll(async()=>Math.abs(await page.evaluate(()=>scrollY)-expectedScroll)).toBeLessThanOrEqual(1);
    const tappable=await expectFocused(evidence);
    const before={scrollY:await page.evaluate(()=>scrollY),url:page.url(),
      filters:await page.getByLabel('現在の絞り込み').textContent()};
    await info.attach('final-evidence-before-tap',{body:JSON.stringify({...before,bounds:tappable}),contentType:'application/json'});
    await page.mouse.click((tappable.row.left+tappable.row.right)/2,(tappable.row.top+tappable.row.bottom)/2);
    await expect(page.getByRole('region',{name:'銘柄詳細',exact:true}).getByRole('heading',{name:'PERF100',exact:true})).toBeVisible();
    await expect(page.locator('.research-workbench')).toHaveAttribute('data-mobile-view','detail');
    await page.getByRole('button',{name:'← 候補一覧',exact:true}).click();
    await expect(page.locator('.research-workbench')).toHaveAttribute('data-mobile-view','list');
    await expect(items).toHaveCount(1);
    await expect(items.locator('.candidate-name strong')).toHaveText('PERF100');
    await expect(finalActions.first()).toBeFocused();
    await expect(finalActions.first()).toHaveAttribute('aria-current','true');
    await expect(page.getByRole('combobox',{name:'候補のページ',exact:true})).toHaveValue(String(Math.ceil(rows.length/pageSize)-1));
    await expect(page.getByRole('button',{name:`次の${pageSize}件`,exact:true})).toBeDisabled();
    await expect(page.getByRole('button',{name:'ミネルヴィニ',exact:true})).toHaveAttribute('aria-pressed','true');
    await expect(page.getByLabel('現在の絞り込み')).toHaveText(before.filters);
    expect(page.url()).toBe(before.url);
    await expect.poll(async()=>Math.abs(await page.evaluate(()=>scrollY)-before.scrollY)).toBeLessThanOrEqual(1);
    const returned=await geometry(evidence);
    await info.attach('final-evidence-after-back',{body:JSON.stringify({scrollY:await page.evaluate(()=>scrollY),bounds:returned}),contentType:'application/json'});
    expect(returned.hit,JSON.stringify(returned.hitPoints.filter(point=>!point.hit))).toBe(true);
    await expectPageGeometry('final-evidence-after-back');
  }
  for(let start=Math.floor((rows.length-1)/pageSize)*pageSize-pageSize;start>=0;start-=pageSize){
    await page.getByRole('button',{name:`前の${pageSize}件`,exact:true}).click();
    await expect(items).toHaveCount(pageSize);
    await expectPageStart(`PERF${String(start).padStart(3,'0')}`);
  }
  await expect(page.getByRole('button',{name:`前の${pageSize}件`,exact:true})).toBeDisabled();
  await expectCandidateHeading();
});

test('default 20-card mobile browsing retains the selected symbol, filters and Back position across size and page jumps',async({page})=>{
 await page.setViewportSize({width:360,height:568});
 await mockFeed(page);
 await page.goto('/');
 const board=page.getByRole('region',{name:'候補リスト',exact:true});
 const items=board.getByRole('listitem');
 const pageSize=page.getByRole('combobox',{name:'1ページの銘柄数',exact:true});
 const jump=page.getByRole('combobox',{name:'候補のページ',exact:true});
 await expect(items).toHaveCount(20);
 await jump.selectOption('3');
 const selected=page.getByRole('button',{name:/^PERF077 の分析/});
 await selected.click();
 await expect(page.getByRole('region',{name:'銘柄詳細',exact:true}).getByRole('heading',{name:'PERF077',exact:true})).toBeVisible();
 await page.getByRole('button',{name:'← 候補一覧',exact:true}).click();
 await expect(selected).toBeFocused();
 const filters=await page.getByLabel('現在の絞り込み').textContent();
 // Browse away from the selected symbol before changing the display unit.
 await jump.selectOption('0');
 await expect(selected).toHaveCount(0);
 await pageSize.focus();await pageSize.selectOption('50');
 await expect(page).toHaveURL(/feedSize=50/);
 await expect(items).toHaveCount(50);
 await expect(jump).toHaveValue('1');
 await expect(selected).toBeFocused();
 await expect(selected).toHaveAttribute('aria-current','true');
 await pageSize.focus();await pageSize.selectOption('20');
 await expect(page).toHaveURL(/feedSize=20/);
 await expect(items).toHaveCount(20);
 await expect(jump).toHaveValue('3');
 await expect(selected).toBeFocused();
 await expect(page.getByLabel('現在の絞り込み')).toHaveText(filters);
 await expect(page.getByRole('button',{name:'ミネルヴィニ',exact:true})).toHaveAttribute('aria-pressed','true');
 const scrollBefore=await page.evaluate(()=>scrollY);
 await selected.click();
 await expect(page.locator('.research-workbench')).toHaveAttribute('data-mobile-view','detail');
 await page.getByRole('button',{name:'← 候補一覧',exact:true}).click();
 await expect(selected).toBeFocused();
 await expect(jump).toHaveValue('3');
 await expect.poll(async()=>Math.abs(await page.evaluate(()=>scrollY)-scrollBefore)).toBeLessThanOrEqual(1);
 await expect(page.getByLabel('現在の絞り込み')).toHaveText(filters);
 await jump.selectOption('5');
 await expect(items).toHaveCount(1);
 await expect(items).toHaveAttribute('aria-posinset','101');
 await expect(items).toHaveAttribute('aria-setsize','101');
 await expect(board.getByRole('status')).toHaveText('全101銘柄中101–101');
 await expect(page.getByRole('button',{name:'次の20件',exact:true})).toBeDisabled();
});
