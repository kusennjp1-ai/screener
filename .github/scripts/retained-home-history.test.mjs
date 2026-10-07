import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {prepareRetainedHomeHistory,validateRetainedHomeHistory,applyRetainedHomeHistory,RETAINED_HOME_KEY} from './retained-home-history.mjs';
import {extractPriceObservations,priceObservationDigest} from './price-observations.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const digest = value => sha(JSON.stringify(value,(_,item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.entries(item).sort(([a],[b]) => a.localeCompare(b))) : item));
function fixture({priorChange,candidateChange,publicationChange,sourceChange}={}) {
  const item = {symbol:'TVC:DXY',currency:'USD',display_name:'US Dollar Index',latest_date:'2026-10-02',latest_close:101.93,
    change_1d:-.17,history:[{date:'2026-10-01',close:102.1},{date:'2026-10-02',close:101.93}]};
  const other = {symbol:'SPY',latest_date:'2026-10-02',latest_close:600,history:[{date:'2026-10-02',close:600}]};
  const prior = {schema_version:'static-site-v2',market:'US',as_of_date:'2026-10-02',generated_at:'2026-10-04T04:20:51Z',
    freshness:{scan_as_of_date:'2026-10-02'},key_markets:[other,item],scan_summary:{rows_total:3},top_groups:[{rank:1}]};
  const current = {...clone(prior),as_of_date:'2026-10-06',generated_at:'2026-10-07T04:07:35Z',freshness:{scan_as_of_date:'2026-10-06'},
    key_markets:[{...clone(other),latest_date:'2026-10-06',latest_close:601,history:[{date:'2026-10-06',close:601}]},
      {...clone(item),latest_date:null,latest_close:null,change_1d:null,history:[]}]};
  priorChange?.(prior);candidateChange?.(current);
  const priorPublication = {schema:1,verification_universe:{as_of_date:'2026-10-02'},price_observations:{[RETAINED_HOME_KEY]:'2026-10-02'},known_price_dates:{[RETAINED_HOME_KEY]:'2026-10-02'}};
  publicationChange?.(priorPublication);
  const manifest_json = JSON.stringify({markets:{US:{as_of_date:'2026-10-06',pages:{home:{path:'markets/us/home.json'}}}},pages:{home:{path:'markets/us/home.json'}}});
  const observations = {[JSON.stringify(['US','home','SPY'])]:'2026-10-06'};
  const candidateSource = {manifest_json,manifest_sha256:sha(manifest_json),price_observations:observations,price_observations_sha256:priceObservationDigest(observations)};
  sourceChange?.(candidateSource);
  // Deliberately retain noncanonical whitespace to verify exact evidence bytes.
  const priorHomeBytes = Buffer.from(JSON.stringify(prior,null,2)+'\n'), candidateHomeBytes = Buffer.from(JSON.stringify(current)+'\n');
  return {priorPublication,candidateSource,priorHomeBytes,priorHomeSha256:sha(priorHomeBytes),candidateHomeBytes,candidateHomeSha256:sha(candidateHomeBytes)};
}

test('retains exact prior home evidence, historical points and clocks while clearing current display fields',()=>{
  const input = fixture(), originalPrior = Buffer.from(input.priorHomeBytes), originalCandidate = Buffer.from(input.candidateHomeBytes);
  const patch = prepareRetainedHomeHistory(input), prior = JSON.parse(originalPrior), candidate = JSON.parse(originalCandidate);
  assert.equal(patch.publication_authority,false);assert.equal(patch.reason,'missing_history');assert.equal(patch.observation_date,'2026-10-02');
  assert(Buffer.from(patch.prior_home.raw_utf8).equals(originalPrior));assert(Buffer.from(patch.candidate_home.raw_utf8).equals(originalCandidate));
  assert.deepEqual(patch.item.history,prior.key_markets[1].history);assert.equal(patch.item.latest_date,'2026-10-02');
  assert.equal(patch.item.latest_close,null);assert.equal(patch.item.change_1d,null);
  assert.equal(patch.item.retained_price_history.original_generated_at,prior.generated_at);
  assert.equal(patch.item.retained_price_history.original_as_of_date,'2026-10-02');assert.equal(patch.target_as_of_date,'2026-10-06');
  const after = applyRetainedHomeHistory(candidate,patch);
  assert.equal(after.generated_at,candidate.generated_at);assert.deepEqual(after.freshness,candidate.freshness);
  assert.deepEqual(after.key_markets[0],candidate.key_markets[0]);assert.deepEqual(after.top_groups,candidate.top_groups);
  assert.deepEqual(after.scan_summary,candidate.scan_summary);assert.equal(candidate.key_markets[1].history.length,0);
  assert(input.priorHomeBytes.equals(originalPrior));assert(input.candidateHomeBytes.equals(originalCandidate));
  // StaticHomePage's existing visibility predicate must not display an old
  // DXY scalar underneath the newer bundle's freshness header.
  assert.equal(after.key_markets.filter(item => item.latest_close != null && item.history.filter(p => p.close != null).length > 1).some(item => item.symbol === 'TVC:DXY'),false);
});

test('actual observation extractor retains Oct2 DXY while the other instrument advances',()=>{
  const input = fixture(), patch = prepareRetainedHomeHistory(input), root = mkdtempSync(join(tmpdir(),'retained-home-'));
  try {
    mkdirSync(join(root,'markets/us'),{recursive:true});
    writeFileSync(join(root,'markets/us/home.json'),JSON.stringify(applyRetainedHomeHistory(JSON.parse(input.candidateHomeBytes),patch)));
    const observations = extractPriceObservations({dataRoot:root,manifest:JSON.parse(input.candidateSource.manifest_json)});
    assert.equal(observations[RETAINED_HOME_KEY],'2026-10-02');assert.equal(observations[JSON.stringify(['US','home','SPY'])],'2026-10-06');
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('validates enclosing source, predecessor, target and exact restored home bytes',()=>{
  const input = fixture(), patch = prepareRetainedHomeHistory(input);
  assert.equal(validateRetainedHomeHistory(patch,{...input,targetAsOfDate:'2026-10-06'}),patch);
  assert.throws(()=>validateRetainedHomeHistory(patch,{candidateHomeBytes:Buffer.from(input.candidateHomeBytes.toString().trim())}),/SHA256/);
  assert.throws(()=>validateRetainedHomeHistory(patch,{targetAsOfDate:'2026-10-07'}),/target differs/);
  const prior = clone(input.priorPublication);prior.run_id=9;
  assert.throws(()=>validateRetainedHomeHistory(patch,{priorPublication:prior}),/receipt changed/);
  const source = clone(input.candidateSource);source.price_observations[JSON.stringify(['US','home','SPY'])]='2026-10-05';
  assert.throws(()=>validateRetainedHomeHistory(patch,{candidateSource:source}),/observations changed/);
  assert.throws(()=>prepareRetainedHomeHistory({...input,priorHomeSha256:'0'.repeat(64)}),/SHA256/);
  assert.throws(()=>prepareRetainedHomeHistory({...input,candidateHomePath:'home.json'}),/unreviewed home path/);
});

test('rejects missing predecessor authority, ledger-only dates and an already observed candidate',()=>{
  assert.throws(()=>prepareRetainedHomeHistory(fixture({publicationChange:p=>delete p.price_observations[RETAINED_HOME_KEY]})),/observation mismatch/);
  assert.throws(()=>prepareRetainedHomeHistory(fixture({publicationChange:p=>p.known_price_dates[RETAINED_HOME_KEY]='2026-10-05'})),/known-date ledger/);
  assert.throws(()=>prepareRetainedHomeHistory(fixture({sourceChange:s=>{s.price_observations[RETAINED_HOME_KEY]='2026-09-30';s.price_observations_sha256=priceObservationDigest(s.price_observations);}})),/already has an actual observation/);
  assert.throws(()=>prepareRetainedHomeHistory(fixture({sourceChange:s=>s.price_observations_sha256='0'.repeat(64)})),/observation binding mismatch/);
});

test('fails closed on changed home or DXY identities and unreviewed fields',()=>{
  for (const priorChange of [p=>p.market='CA',p=>p.key_markets.push(clone(p.key_markets[1])),p=>p.key_markets[1].symbol='DXY',
    p=>p.key_markets[1].currency='EUR',p=>p.key_markets[1].display_name='Another instrument',p=>p.key_markets[1].buy=true]) {
    assert.throws(()=>prepareRetainedHomeHistory(fixture({priorChange})),/market mismatch|duplicate|missing|currency mismatch|identity mismatch|unreviewed DXY field/);
  }
  assert.throws(()=>prepareRetainedHomeHistory(fixture({sourceChange:s=>{const m=JSON.parse(s.manifest_json);m.pages.home.path='another-home.json';s.manifest_json=JSON.stringify(m);s.manifest_sha256=sha(s.manifest_json);}})),/Conflicting root\/US home alias/);
});

test('rejects invalid, reordered, future, or metadata-inconsistent prior history',()=>{
  for (const priorChange of [p=>p.key_markets[1].history.reverse(),p=>p.key_markets[1].history[1].date='2026-10-06',
    p=>p.key_markets[1].history[1].close=0,p=>p.key_markets[1].history[1].date='2026-02-30',
    p=>p.key_markets[1].latest_date='2026-10-06',p=>p.key_markets[1].latest_close=999,
    p=>p.key_markets[1].history[0].current=true]) {
    assert.throws(()=>prepareRetainedHomeHistory(fixture({priorChange})),/history dates|exceeds|observed close|display date|display close|history point/);
  }
});

test('supports only the reviewed wholly missing candidate DXY observation',()=>{
  for(const candidateChange of [p=>p.key_markets[1].history=[{date:'2026-09-30',close:100}],
    p=>p.key_markets[1].latest_close=101.93,p=>p.key_markets[1].latest_date='2026-10-02',p=>p.key_markets[1].change_1d=0]) {
    assert.throws(()=>prepareRetainedHomeHistory(fixture({candidateChange})),/reviewed missing history|reviewed absence/);
  }
});

test('rejects tampered patches even if their self digest is recomputed',()=>{
  const input = fixture(), patch = prepareRetainedHomeHistory(input);
  const tampered = clone(patch);tampered.item.latest_close=101.93;
  assert.throws(()=>validateRetainedHomeHistory(tampered),/patch changed/);
  delete tampered.patch_sha256;tampered.patch_sha256=digest(tampered);
  assert.throws(()=>validateRetainedHomeHistory(tampered),/retained history or current display state/);
  const rewrittenDate = clone(patch);rewrittenDate.item.history[1].date='2026-10-06';
  delete rewrittenDate.patch_sha256;rewrittenDate.patch_sha256=digest(rewrittenDate);
  assert.throws(()=>validateRetainedHomeHistory(rewrittenDate),/retained history or current display state/);
});

test('composes reviewed group edits but refuses unrelated market or clock changes',()=>{
  const input = fixture(), patch = prepareRetainedHomeHistory(input), home = JSON.parse(input.candidateHomeBytes);
  home.top_groups=[{rank:1,symbol:'NEW'}];home.scan_summary={rows_total:2};
  const result = applyRetainedHomeHistory(home,patch);
  assert.deepEqual(result.top_groups,home.top_groups);assert.deepEqual(result.scan_summary,home.scan_summary);
  for(const change of [p=>p.generated_at='2026-10-07T05:00:00Z',p=>p.freshness.scan_as_of_date='2026-10-07',p=>p.key_markets[0].latest_close=999]) {
    const modified=clone(home);change(modified);assert.throws(()=>applyRetainedHomeHistory(modified,patch),/capture clock changed|freshness changed|instruments differ/);
  }
});
