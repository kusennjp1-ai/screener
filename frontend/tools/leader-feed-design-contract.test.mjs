// Synthetic contract tests, not capture evidence or review scores.
import { test, expect } from 'vitest';
import { feedFixture } from './reviewed-design-functional-fixture.mjs';
import { leaderFeedFailures } from './leader-feed-design-contract.mjs';
import { validateFunctionalEvidence } from './reviewed-design-functional-evidence.mjs';
const home=f=>f.report.screens.find(s=>s.key==='home/390/dark').metrics;
for(const scope of ['ordinary','carry'])test(`versioned ${scope} rich feed accepts explicit missing evidence without mutating capture`,()=>{const f=feedFixture(scope),before=JSON.stringify(f);expect(validateFunctionalEvidence(f.report,f.binding)).toBe(true);expect(JSON.stringify(f)).toBe(before);});
for(const [label,change] of [
 ['missing feed',m=>delete m.feed],['unknown version',m=>m.feed.version='future'],['empty posts',m=>m.feed.posts=[]],
 ['buried entry',m=>m.feed.posts[0].rect.top=780],['under fixed header',m=>m.feed.posts[0].rect.top=0],['horizontal post clipping',m=>m.feed.posts[0].rect.right=391],
 ['wrong daily denominator',m=>m.feed.posts[0].daily='日次条件 0/8'],['empty RS number',m=>m.feed.posts[0].rs='RS'],
 ['missing ticker',m=>m.feed.posts[0].identity='@WRONG'],['missing company',m=>m.feed.posts[0].company=''],
 ['missing daily states',m=>m.feed.posts[0].states=[]],['unknown treated as pass token',m=>m.feed.posts[0].states[0].state='verified'],['hidden condition bar',m=>m.feed.posts[0].states[0].shown=false],['color-only condition',m=>m.feed.posts[0].states[0].glyph=''],
 ['hidden tab',m=>m.feed.strategies[0].rect=null],['missing strategy',m=>m.feed.strategies.pop()],['undersized filter',m=>m.feed.filters[0].rect.height=43],['unobserved filter state',m=>m.feed.filters[0].pressed=null],
 ...['daily','judgment','rs','volume','change','position','chart','evidence'].map(field=>['missing '+field,m=>m.feed.posts[0][field]='']),
 ['overflow retained',m=>m.horizontalOverflow=true],['radius gate retained',m=>m.radiusIssues.push({})],['font gate retained',m=>m.fontIssues.push({})],
])test('rejects '+label,()=>{const f=feedFixture();change(home(f));expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();});
test('compact desktop requires one complete post',()=>{const f=feedFixture();f.report.screens.find(s=>s.key.startsWith('compact/')).metrics.visibleCandidates=0;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();});
test('desktop chart remains in actual viewport',()=>{const f=feedFixture();const m=f.report.screens.find(s=>s.key==='home/1440/dark').metrics;m.chart.top=901;expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();});
test('versioned feed cannot bypass axe or data binding',()=>{for(const mutation of [f=>f.report.screens[0].axe.push({id:'color-contrast'}),f=>f.report.commit='bad',f=>f.report.data.as_of_date='bad']){const f=feedFixture();mutation(f);expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();}});
test('unknown report version rejected',()=>{const f=feedFixture();f.report.layout_contract='future';expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();});

test('360px controls keep44px minimum',()=>{const m=home(feedFixture());m.viewport.width=360;m.feed.filters[0].rect.height=43;expect(leaderFeedFailures(m,'home')).toContain('missing/clipped filters');});
for(const [state,glyph] of [['pass','?'],['fail','✓'],['unknown','✓'],['not_applicable','?']])test(`rejects misleading ${state} glyph`,()=>{const f=feedFixture();Object.assign(home(f).feed.posts[0].states[0],{state,glyph});expect(()=>validateFunctionalEvidence(f.report,f.binding)).toThrow();});
