// Versioned reference03 rich-feed layout contract. Legacy captures use their
// original table geometry; this never reinterprets their recorded failures.
export const LEADER_FEED_CONTRACT='leader-x-feed-v1';
export function observeLeaderFeed() {
 const shown=node=>Boolean(node&&node.checkVisibility({checkOpacity:true,checkVisibilityCSS:true})&&node.getBoundingClientRect().width&&node.getBoundingClientRect().height);
 const rect=node=>{if(!shown(node))return null;const b=node.getBoundingClientRect();return {top:b.top,bottom:b.bottom,left:b.left,right:b.right,width:b.width,height:b.height};};
 const controls=selector=>[...document.querySelectorAll(selector)].map(node=>({text:node.textContent.trim(),rect:rect(node),pressed:node.getAttribute('aria-pressed')}));
 const posts=[...document.querySelectorAll('.candidate-row')].filter(shown).map(row=>{
  const value=selector=>{const node=row.querySelector(selector);return shown(node)?node.textContent.trim():null;};
  const symbol=value('.leader-post-avatar');
  return {symbol,identity:value('.leader-post-identity > span'),company:value('.leader-post-identity strong'),daily:value('.candidate-daily-check'),judgment:value('.leader-post-judgment'),rs:value('.leader-rs-ring'),volume:value('.leader-post-metrics > span:nth-child(2)'),change:value('.leader-post-metrics > span:nth-child(3)'),position:value('.leader-post-position'),chart:shown(row.querySelector('.leader-mini-chart'))?'svg':value('.leader-chart-empty'),evidence:value('.leader-post-evidence'),states:[...row.querySelectorAll('.leader-condition-strip > span')].map(node=>({state:node.dataset.state,glyph:node.textContent.trim(),shown:shown(node)})),dailyMissing:value('.leader-daily-empty'),rect:rect(row)};
 });
 return {version:'leader-x-feed-v1',strategies:controls('.leader-feed-controls .method-tabs button'),filters:controls('.leader-quick-filters button'),pinned:rect(document.querySelector('.leader-pinned-title')),posts};
}
export function leaderFeedFailures(metrics,screen) {
 if(!['home','near-pass','compact'].includes(screen))return [];
 const failures=[],fail=(ok,message)=>{if(!ok)failures.push(message);},feed=metrics?.feed;
 const number=n=>typeof n==='number'&&Number.isFinite(n),text=s=>typeof s==='string'&&s.trim().length>0;
 const rectangle=r=>r&&['top','bottom','left','right','width','height'].every(k=>number(r[k]))&&r.width>0&&r.height>0;
 fail(feed?.version===LEADER_FEED_CONTRACT,'missing versioned feed observation');if(!feed)return failures;
 const width=metrics.viewport?.width,bottom=metrics.viewport?.height-metrics.bottomNavHeight,top=metrics.headerHeight;
 for(const [key,labels] of [['strategies',['ミネルヴィニ','基本と原則','オニール','IBD型']],['filters',['買い位置','あと1条件','RS 80+']]]){
  const controls=feed[key];fail(Array.isArray(controls)&&controls.length===labels.length&&controls.every((c,i)=>c.text===labels[i]&&rectangle(c.rect)&&['true','false'].includes(c.pressed)&&c.rect.left>=0&&c.rect.right<=width&&c.rect.height>=(width<=700?44:24)&&c.rect.width>=(width<=700?44:24)),`missing/clipped ${key}`);
 }
 fail(rectangle(feed.pinned),'missing pinned judgment post');
 fail(Array.isArray(feed.posts)&&feed.posts.length>0,'missing stock posts');
 if(!Array.isArray(feed.posts)||!feed.posts.length)return failures;
 for(const post of feed.posts){
  fail(rectangle(post.rect)&&post.rect.left>=0&&post.rect.right<=width&&post.rect.height>=240,'clipped/incomplete stock post');
  fail(text(post.symbol)&&text(post.identity)&&post.identity.startsWith('@'+post.symbol+' ·')&&text(post.company),'missing full ticker/company');
  for(const field of ['daily','judgment','rs','volume','change','position','chart','evidence'])fail(text(post[field]),'missing stock '+field);
  fail(/日次条件\s*\d+\/7/.test(post.daily||'')||/未確認|データなし/.test(post.daily||''),'missing daily count or explicit unknown');
  fail(['rs','volume','change','position'].every(field=>/\d|データなし/.test(post[field]||'')),'missing metric values or explicit unavailable');
  fail(/RS/.test(post.rs||'')&&/出来高比/.test(post.volume||'')&&/前日比/.test(post.change||'')&&/ピボット比/.test(post.position||''),'missing metric labels');
  fail((Array.isArray(post.states)&&post.states.length===7&&post.states.every(s=>s.shown===true&&['pass','fail','unknown','not_applicable'].includes(s.state)&&s.glyph===({pass:'✓',fail:'×',unknown:'?',not_applicable:'—'})[s.state]))||/データなし/.test(post.dailyMissing||''),'missing daily seven-state or explicit unavailable evidence');
 }
 const first=feed.posts[0].rect;
 fail(rectangle(first)&&first.top>=top&&first.top+44<=bottom,'first stock entry hidden by pinned post/chrome');
 if(width===1440){fail(metrics.chart&&number(metrics.chart.top)&&metrics.chart.top<bottom&&metrics.chart.bottom>top,'desktop chart outside viewport');if(screen==='compact')fail(metrics.visibleCandidates>=1,'compact feed lacks one complete post');}
 return failures;
}
