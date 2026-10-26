// Versioned initial mobile detail observation. Old captures retain their 160px
// card-spacing contract; only new, explicitly labelled SVG captures use this.
export const LEGACY_LEADER_DETAIL_CONTRACT = 'leader-svg-detail-v1';
export const LEADER_DETAIL_CONTRACT = 'leader-tabbed-detail-v2';
export const supportedDetailContract = value => [LEGACY_LEADER_DETAIL_CONTRACT, LEADER_DETAIL_CONTRACT].includes(value);
export function observeLeaderDetail() {
 const detail=document.querySelector('.research-detail');
 if(!detail)return null;
 const shown=node=>Boolean(node&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true}));
 const box=node=>{if(!shown(node))return null;const r=node.getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,width:r.width,height:r.height};};
 const text=selector=>{const node=detail.querySelector(selector);return shown(node)?node.textContent.trim():null;};
 const svg=detail.querySelector('svg[data-chart-plot]'),pane=svg?.querySelector('[data-pane="price"]');
 const clipId=pane?.getAttribute('clip-path')?.match(/^url\(#(.+)\)$/)?.[1];
 const clip=clipId?document.getElementById(clipId)?.querySelector('rect'):null;
 let price=null;
 // The clip rectangle in defs has no CSS box. Transform its real SVG lengths
 // through the rendered SVG matrix, rather than guessing a pane percentage.
 if(shown(svg)&&clip){const matrix=svg.getScreenCTM();if(matrix){const x=clip.x.baseVal.value,y=clip.y.baseVal.value,w=clip.width.baseVal.value,h=clip.height.baseVal.value;const a=new DOMPoint(x,y).matrixTransform(matrix),b=new DOMPoint(x+w,y+h).matrixTransform(matrix);price={left:a.x,top:a.y,right:b.x,bottom:b.y,width:b.x-a.x,height:b.y-a.y};}}
 const header=box(document.querySelector('.leader-header')),nav=box(document.querySelector('.stock-section-nav'))||box(document.querySelector('.mobile-research-nav'))||box(document.querySelector('.leader-mobile-nav')),actions=box(document.querySelector('.mobile-chart-actions'));
 const content={left:0,right:innerWidth,top:Math.max(0,header?.bottom||0),bottom:Math.min(innerHeight,nav?.top??innerHeight,actions?.top??innerHeight)};
 // Respect actual scroll/clipping ancestors in addition to fixed chrome.
 for(let parent=svg?.parentElement;parent&&parent!==document.body;parent=parent.parentElement){const style=getComputedStyle(parent),r=parent.getBoundingClientRect();if(/(auto|scroll|hidden|clip)/.test(style.overflowY)){content.top=Math.max(content.top,r.top);content.bottom=Math.min(content.bottom,r.bottom);}if(/(auto|scroll|hidden|clip)/.test(style.overflowX)){content.left=Math.max(content.left,r.left);content.right=Math.min(content.right,r.right);}}
 let visible=null,hits=[];
 if(price){visible={left:Math.max(price.left,content.left),right:Math.min(price.right,content.right),top:Math.max(price.top,content.top),bottom:Math.min(price.bottom,content.bottom)};visible.width=Math.max(0,visible.right-visible.left);visible.height=Math.max(0,visible.bottom-visible.top);if(visible.height&&visible.width)hits=[.1,.5,.9].flatMap(x=>[.1,.5,.9].map(y=>{const hit=document.elementFromPoint(visible.left+x*visible.width,visible.top+y*visible.height);return Boolean(hit&&(hit===svg||svg.contains(hit)));}));}
 const states=[...detail.querySelectorAll('.leader-detail-overview .leader-condition-strip > span')].map(node=>({state:node.dataset.state,glyph:node.textContent.trim(),shown:shown(node)}));
 const identity=document.querySelector('.research-mobile-instrument-context')?.textContent||document.getElementById('research-mobile-instrument-context')?.textContent||null;
 const sections=[...detail.querySelectorAll('.stock-section-nav [role="tab"]')].map(node=>({id:node.id,selected:node.getAttribute('aria-selected'),rect:box(node)}));
 return {version:'leader-tabbed-detail-v2',identity,section:detail.dataset.section,sections,renderer:svg?'leader-svg-v1':null,price,visible,hits,content,chart:box(svg),unavailable:text('.leader-svg-warning'),verdict:text('.leader-detail-verdict'),rs:text('.leader-detail-metrics .leader-rs-ring'),volume:text('.leader-detail-metrics > div:nth-child(2)'),states,gates:[...detail.querySelectorAll('.leader-five-gates button')].map(node=>({label:node.querySelector('b')?.textContent,state:node.querySelector('[data-state]')?.dataset.state,rect:box(node)}))};
}
// Observe real tab navigation, then restore the original chart and scroll.
// The five gates/seven states are still inspected while actually rendered;
// they are never inferred from hidden nodes or fabricated from model data.
export async function observeTabbedDetail(page) {
 const initial=await page.evaluate(observeLeaderDetail);
 if(page.viewportSize().width>700||!initial||initial.section!=='chart')return initial;
 const scroll=await page.evaluate(()=>scrollY);
 await page.getByRole('tab',{name:'購入条件',exact:true}).click();
 await page.locator('.leader-detail-overview').waitFor({state:'visible'});
 const conditions=await page.evaluate(observeLeaderDetail);
 await page.getByRole('tab',{name:'チャート',exact:true}).click();
 await page.evaluate(y=>window.scrollTo({top:y,behavior:'instant'}),scroll);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const chart=await page.evaluate(observeLeaderDetail);
 return {...chart,conditionsObservation:{identity:conditions.identity,section:conditions.section},verdict:conditions.verdict,rs:conditions.rs,volume:conditions.volume,states:conditions.states,gates:conditions.gates};
}
export function leaderDetailFailures(metrics,screen) {
 if(screen!=='detail'||metrics.viewport?.width>700)return [];
 const failures=[],check=(ok,label)=>{if(!ok)failures.push(label);},value=metrics.detailEvidence;
 const finite=n=>typeof n==='number'&&Number.isFinite(n),text=s=>typeof s==='string'&&s.trim().length>0;
 const rect=r=>r&&['left','right','top','bottom','width','height'].every(k=>finite(r[k]))&&r.width>0&&r.height>0&&Math.abs(r.right-r.left-r.width)<.1&&Math.abs(r.bottom-r.top-r.height)<.1;
 check(supportedDetailContract(value?.version),'missing versioned detail evidence');if(!value)return failures;
 if(value.version===LEADER_DETAIL_CONTRACT){
  check(text(value.identity)&&value.section==='chart'&&value.conditionsObservation?.identity===value.identity&&value.conditionsObservation?.section==='conditions','missing same-instrument tab observations');
  const ids=['chart','setup','conditions','financial','evidence','notes'].map(key=>`detail-tab-${key}`);
  check(Array.isArray(value.sections)&&value.sections.length===6&&value.sections.every((tab,i)=>tab.id===ids[i]&&tab.selected===(i===0?'true':'false')&&rect(tab.rect)&&tab.rect.width>=44&&tab.rect.height>=44&&tab.rect.left>=0&&tab.rect.right<=metrics.viewport.width&&tab.rect.top>=metrics.headerHeight&&tab.rect.bottom<=metrics.viewport.height),'missing reachable 44px section tabs');
 }
 check(text(value.verdict)&&/日次条件/.test(value.verdict),'missing daily verdict');
 check(text(value.rs)&&/RS/.test(value.rs)&&/\d|データなし/.test(value.rs),'missing RS value');
 check(text(value.volume)&&/出来高比/.test(value.volume)&&/\d|データなし/.test(value.volume),'missing volume ratio');
 const glyphs={pass:'✓',fail:'×',unknown:'?',not_applicable:'—'};
 check(Array.isArray(value.states)&&value.states.length===7&&value.states.every(s=>s.shown===true&&s.glyph===glyphs[s.state]&&Object.hasOwn(glyphs,s.state)),'missing exact seven daily states');
 check(Array.isArray(value.gates)&&value.gates.length===5&&value.gates.every((g,i)=>g.label===['トレンド','VCP','RS','出来高','市場'][i]&&Object.hasOwn(glyphs,g.state)&&rect(g.rect)&&g.rect.width>=44&&g.rect.height>=44&&g.rect.left>=0&&g.rect.right<=metrics.viewport.width),'missing or clipped 44px five gates');
 if(value.renderer===null){check(value.price===null&&value.chart===null&&value.visible===null&&Array.isArray(value.hits)&&value.hits.length===0&&/データなし/.test(value.unavailable||''),'missing explicit unavailable chart');return failures;}
 check(value.renderer==='leader-svg-v1','unknown detail renderer');
 check(rect(value.price)&&rect(value.chart)&&rect(value.visible),'missing real price pane geometry');
 if(!rect(value.price)||!rect(value.visible))return failures;
 const p=value.price,v=value.visible,c=value.content;
 check(c&&finite(c.top)&&finite(c.bottom)&&c.top>=metrics.headerHeight&&c.bottom<=metrics.viewport.height-metrics.bottomNavHeight,'missing chrome exclusion');
 check(p.left>=0&&p.right<=metrics.viewport.width&&v.left===p.left&&v.right===p.right,'horizontally clipped price pane');
 check(c&&v.top===Math.max(p.top,c.top)&&v.bottom===Math.min(p.bottom,c.bottom),'inconsistent visible price intersection');
 check(v.height>=Math.min(100,p.height),'less than 100px of actual price pane visible');
 check(Array.isArray(value.hits)&&value.hits.length===9&&value.hits.every(hit=>hit===true),'price pane is obscured or hit proof missing');
 return failures;
}
