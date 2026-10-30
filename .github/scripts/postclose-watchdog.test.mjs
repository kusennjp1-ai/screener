import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {BASE_URL, PRODUCER, PUBLISHER, REPOSITORY, observePublication, planRecovery, dispatchRequestFor, readPublicObservations, recentWorkflowRuns, validateClock, main} from './postclose-watchdog.mjs';
import {completionRequest, waitForProducer, COMPLETION_TIMEOUT_MS, EVENT_GRACE_MS} from './postclose-completion.mjs';

const target = '2026-10-27', before = '2026-10-26';
const hash = value => createHash('sha256').update(value).digest('hex');
const etfs = ['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY'];
const fixture = () => {
  const receipt = {schema: 1, run_id: 100, data_source: {run_id: 90}, price_observations: Object.fromEntries(Array.from({length: 10}, (_, i) => [JSON.stringify(['US','chart',`T${i}`]), target]))};
  const manifest = {markets: {US: {freshness: {scan_as_of_date: target, breadth_latest_date: target, groups_latest_date: target, prices_generated_at: '2026-10-28T01:00:00Z'}}}};
  const trends = {schema_version: 'market-trends-v1', market: 'US', as_of_date: target,
    indices: ['^GSPC','^IXIC'].map(symbol => ({symbol, available: true, points: [{date: target, value: 4}]})),
    put_call: {points: [{date: target, value: .8, calls: 100, puts: 80}]},
    long_history: {as_of_date: target, breadth: [{date: target, coverage: 4400, coveragePercent: 99, above50: 3000, newHighs: 50, newLows: 20, leaderCount: 100}], sp500: [{date: target, close: 6000}],
      sectorRotation: {frames: [{date: target, ranks: etfs.map((symbol, i) => ({symbol, rank: i+1, relativeIndex: 100-i}))}]},
      sectorBreadth: [{sector: 'Technology', universe: 100, points: [{date: target, above50: 50, leaderCount: 10}]}]}};
  return {receipt, manifest, trends};
};
function context(value = '2026-10-27T22:30:00Z') {
  const now = Date.parse(value);
  return {now, clock: {schema_version: 'postclose-session-clock-v1', exchange: 'NYSE', provider: 'pandas_market_calendars', provider_version: '5.4.0', evaluated_at: value, target_session: target, target_close: '2026-10-27T20:00:00Z', eligible_at: '2026-10-27T20:02:00Z', next_session: '2026-10-28', next_close: '2026-10-28T20:00:00Z', next_eligible_at: '2026-10-28T20:02:00Z', acquisition_grace_minutes: 2},
    observed: {...observePublication(fixture(), target), fresh: false, stale: ['long_history']}, producerRuns: [], publisherRuns: [], workflowStates: {[PRODUCER]: 'active', [PUBLISHER]: 'active'}};
}
function run(workflow, overrides = {}) {
  return {id: 200, path: `.github/workflows/${workflow}`, head_branch: 'main', event: workflow === PRODUCER ? 'workflow_dispatch' : 'workflow_run', repository: {full_name: REPOSITORY}, head_repository: {full_name: REPOSITORY}, status: 'completed', conclusion: 'success', created_at: '2026-10-27T20:05:00Z', updated_at: '2026-10-27T21:00:00Z', ...overrides};
}

test('uses every actual observation date, with zero counts allowed', () => {
  const value = fixture(); value.trends.long_history.breadth[0].newLows = 0;
  assert.equal(observePublication(value, target).fresh, true);
});
test('new generated_at and wrapper dates cannot make old history current', () => {
  const value = fixture(); value.trends.long_history.breadth[0].date = before;
  assert.deepEqual(observePublication(value, target).stale, ['long_breadth']);
});
test('future dates fail rather than claim freshness', () => {
  for (const mutate of [f => {f.manifest.markets.US.freshness.scan_as_of_date = '2026-10-28';}, f => {f.trends.long_history.as_of_date = '2026-10-28';}, f => {f.receipt.price_observations['["US","chart","T0"]'] = '2026-10-28';}]) {
    const value = fixture(); mutate(value); assert.throws(() => observePublication(value, target), /future|Future/);
  }
});
test('null breadth and missing one ETF remain stale even with latest label', () => {
  const value = fixture(); value.trends.long_history.breadth[0].leaderCount = null; value.trends.long_history.sectorRotation.frames[0].ranks.pop();
  assert.deepEqual(observePublication(value, target).stale, ['long_breadth','sector_rs']);
});
test('duplicate ETF cannot satisfy eleven ETF freshness', () => {
  const value = fixture(); value.trends.long_history.sectorRotation.frames[0].ranks[10].symbol = 'XLB';
  assert.deepEqual(observePublication(value, target).stale, ['sector_rs']);
});
test('actual chart coverage, not refresh timestamp, establishes price readiness', () => {
  const value = fixture(); value.receipt.price_observations['["US","chart","T0"]'] = before;
  assert.equal(observePublication(value, target).fresh, true);
  value.receipt.price_observations['["US","chart","T1"]'] = before;
  const observed = observePublication(value, target); assert.equal(observed.charts.ratio, .8); assert.deepEqual(observed.stale, ['chart_coverage']);
});
test('Cboe null observation is unavailable regardless of date', () => {
  const value = fixture(); value.trends.put_call.points[0].value = null;
  assert.deepEqual(observePublication(value, target).stale, ['put_call']);
});
test('today an explicitly undercovered sector stays unknown without becoming a stale date', () => {
  const value = fixture(); value.trends.long_history.sectorBreadth[0].points[0] = {date: target, coverage: 0, eligibleUniverse: 1, above50: null, leaderCount: null};
  assert.equal(observePublication(value, target).fresh, true);
  value.trends.long_history.sectorBreadth[0].points[0].date = before;
  assert.deepEqual(observePublication(value, target).stale, ['sector_breadth']);
});
test('current chart prices with older scan/history request full acquisition', () => {
  const value = context(); value.observed.stale = ['scan','long_history'];
  const plan = planRecovery(value);
  assert.equal(plan.action, 'acquire'); assert.equal(plan.acquisition_mode, 'full');
  assert.deepEqual(dispatchRequestFor(plan), {workflow: PRODUCER, inputs: {market_group: 'us', prices_only: false}});
});
test('first post-close missing chart observations require a full dated snapshot', () => {
  const value = context('2026-10-27T20:02:00Z'); value.observed.charts = {observed: 100, current: 0, ratio: 0}; value.observed.stale = ['scan','chart_coverage','long_history'];
  const plan = planRecovery(value);
  assert.equal(plan.action, 'acquire'); assert.equal(plan.acquisition_mode, 'full');
  assert.deepEqual(dispatchRequestFor(plan), {workflow: PRODUCER, inputs: {market_group: 'us', prices_only: false}});
  assert.deepEqual(value.observed.stale, ['scan','chart_coverage','long_history']);
});
test('any prior ordinary attempt makes remaining poor price coverage use full acquisition', () => {
  const value = context(); value.observed.charts = {observed: 100, current: 80, ratio: .8}; value.observed.stale = ['chart_coverage','long_history'];
  value.producerRuns = [run(PRODUCER, {conclusion: 'failure'})];
  // The run API provides no inputs. Do not guess whether this was a full or
  // quick run, and never keep requesting quick runs on a stuck 90% threshold.
  const plan = planRecovery(value); assert.equal(plan.acquisition_mode, 'full');
  assert.equal(dispatchRequestFor(plan).inputs.prices_only, false);
});
test('a previously successful fast publication with old scan wrapper still advances to full', () => {
  const value = context(); value.observed.stale = ['scan','long_history'];
  value.producerRuns = [run(PRODUCER)];
  value.publisherRuns = [run(PUBLISHER, {created_at: '2026-10-27T21:01:00Z', updated_at: '2026-10-27T21:10:00Z'})];
  const plan = planRecovery(value); assert.equal(plan.action, 'acquire'); assert.equal(plan.acquisition_mode, 'full');
});
test('dispatch mapping preserves ordinary publication inputs and rejects invented mode', () => {
  assert.deepEqual(dispatchRequestFor({action: 'publish'}), {workflow: PUBLISHER, inputs: {ui_only: false}});
  assert.throws(() => dispatchRequestFor({action: 'acquire', acquisition_mode: 'skip_quality'}), /Invalid acquisition/);
  assert.throws(() => dispatchRequestFor({action: 'acquire', acquisition_mode: 'prices_only'}), /Invalid acquisition/);
  assert.throws(() => dispatchRequestFor({action: 'none'}), /Invalid acquisition/);
});
test('fresh publication is idempotent; never request more work', () => {
  const value = context(); value.observed = observePublication(fixture(), target);
  assert.deepEqual(planRecovery(value), {target_session: target, elapsed_minutes: 150, overdue: false, action: 'none', reason: 'published_observations_current'});
});
test('active producer, queued publisher and waiting publisher suppress duplicates', () => {
  for (const [workflow, status] of [[PRODUCER,'in_progress'],[PUBLISHER,'queued'],[PUBLISHER,'waiting']]) {
    const value = context(); value[workflow === PRODUCER ? 'producerRuns' : 'publisherRuns'] = [run(workflow, {status, conclusion: null})];
    const decision = planRecovery(value); assert.equal(decision.action, 'none'); assert.equal(decision.reason, 'existing_work_in_flight'); assert.equal(decision.overdue, true);
  }
});
test('ordinary no-export CI producer does not suppress acquisition', () => {
  const value = context(); value.producerRuns = [run(PRODUCER, {event: 'workflow_run', status: 'in_progress'})];
  assert.equal(planRecovery(value).action, 'acquire');
});

test('an older in-flight build delays but never consumes the next completed session', () => {
  const value = context('2026-10-28T20:02:00Z');
  Object.assign(value.clock, {target_session: '2026-10-28', target_close: '2026-10-28T20:00:00Z', eligible_at: '2026-10-28T20:02:00Z', next_session: '2026-10-29', next_close: '2026-10-29T20:00:00Z', next_eligible_at: '2026-10-29T20:02:00Z'});
  value.observed = observePublication(fixture(), '2026-10-28');
  value.producerRuns = [run(PRODUCER, {status: 'in_progress', conclusion: null})];
  assert.equal(planRecovery(value).reason, 'existing_work_in_flight');
  value.producerRuns[0].status = 'completed'; value.producerRuns[0].conclusion = 'success';
  value.producerRuns[0].updated_at = '2026-10-28T20:01:00Z';
  const plan = planRecovery(value);
  assert.equal(plan.action, 'acquire'); assert.equal(plan.target_session, '2026-10-28');
  assert.deepEqual(dispatchRequestFor(plan), {workflow: PRODUCER, inputs: {market_group: 'us', prices_only: false}});
});
test('disabled workflow is explicit failure even when dates are fresh', () => {
  const value = context(); value.workflowStates[PRODUCER] = 'disabled_inactivity';
  assert.throws(() => planRecovery(value), /disabled/);
});
test('foreign or future workflow evidence cannot authorize recovery', () => {
  for (const overrides of [{repository: {full_name: 'attacker/repo'}}, {created_at: '2026-10-28T20:00:00Z'}, {path: '.github/workflows/other.yml'}]) {
    const value = context(); value.producerRuns = [run(PRODUCER, overrides)]; assert.throws(() => planRecovery(value), /Foreign|Future|Malformed/);
  }
});
test('successful producer with lost publication event requests normal publisher', () => {
  const value = context(); value.producerRuns = [run(PRODUCER)];
  assert.equal(planRecovery(value).reason, 'producer_completed_without_publisher'); assert.equal(planRecovery(value).action, 'publish');
});
test('producer completion has a propagation grace before another dispatch', () => {
  const value = context(); value.producerRuns = [run(PRODUCER, {updated_at: '2026-10-27T22:29:00Z'})];
  assert.equal(planRecovery(value).action, 'none');
});
test('failed publisher retries once for same producer, then reacquires after cooldown', () => {
  const value = context(); value.producerRuns = [run(PRODUCER)];
  value.publisherRuns = [run(PUBLISHER, {id: 300, conclusion: 'failure', created_at: '2026-10-27T21:01:00Z', updated_at: '2026-10-27T21:10:00Z'})];
  assert.equal(planRecovery(value).reason, 'retry_failed_publication_once');
  value.publisherRuns.push(run(PUBLISHER, {id: 301, conclusion: 'failure', created_at: '2026-10-27T21:20:00Z', updated_at: '2026-10-27T21:30:00Z'}));
  assert.equal(planRecovery(value).action, 'acquire');
});
test('new producer failure observes durable cooldown', () => {
  const value = context(); value.producerRuns = [run(PRODUCER, {conclusion: 'failure', updated_at: '2026-10-27T22:25:00Z'})];
  assert.equal(planRecovery(value).reason, 'acquisition_retry_cooldown');
});
test('six acquisitions back off six hours instead of looping costly builds', () => {
  const value = context(); value.producerRuns = Array.from({length: 6}, (_, i) => run(PRODUCER, {id: 200+i, conclusion: 'failure', created_at: `2026-10-27T20:${10+i}:00Z`, updated_at: '2026-10-27T21:00:00Z'}));
  assert.equal(planRecovery(value).retry_after, '2026-10-28T03:00:00.000Z');
  const later = {...value, ...context('2026-10-28T03:01:00Z'), producerRuns: value.producerRuns};
  assert.equal(planRecovery(later).action, 'acquire');
});
test('Cboe has its own delay policy and does not mask current other data', () => {
  const value = context('2026-10-27T21:20:00Z'); value.observed.stale = ['put_call'];
  const decision = planRecovery(value); assert.equal(decision.reason, 'waiting_for_cboe_publication'); assert.equal(decision.overdue, false);
});
test('P/C-only acquisition capped at two after its 90-minute grace', () => {
  const value = context('2026-10-28T05:00:00Z'); value.observed.stale = ['put_call'];
  value.producerRuns = [run(PRODUCER, {id: 1, conclusion: 'failure', created_at: '2026-10-27T21:31:00Z', updated_at: '2026-10-27T22:00:00Z'}), run(PRODUCER, {id: 2, conclusion: 'failure', created_at: '2026-10-28T00:05:00Z', updated_at: '2026-10-28T01:00:00Z'})];
  const decision = planRecovery(value); assert.equal(decision.reason, 'cboe_retry_budget_used_until_next_session'); assert.equal(decision.overdue, true); assert.equal(decision.action, 'none');
});
test('invalid, future and stale calendar clocks fail closed', () => {
  for (const mutate of [v => {v.clock.target_session = '2026-02-30';}, v => {v.clock.evaluated_at = '2026-10-26T22:30:00Z';}, v => {v.clock.eligible_at = '2026-10-27T23:00:00Z';}, v => {v.clock.provider = 'weekdays';}]) {
    const value = context(); mutate(value); assert.throws(() => validateClock(value.clock, value.now));
  }
});
test('recovery history paginates and also retains an older active queued run', () => {
  const calls = [], recent = Array.from({length: 100}, (_, i) => run(PRODUCER, {id: i+1}));
  const older = run(PRODUCER, {id: 101, created_at: '2026-10-26T20:05:00Z'}), queued = run(PRODUCER, {id: 102, status: 'queued', created_at: '2026-10-25T20:05:00Z'});
  const actual = recentWorkflowRuns(PRODUCER, Date.parse('2026-10-27T20:02:00Z'), path => {
    calls.push(path);
    if (path.includes('status=')) return {total_count: path.includes('status=queued') ? 1 : 0, workflow_runs: path.includes('status=queued') ? [queued] : []};
    return path.endsWith('page=1') ? {total_count: 300, workflow_runs: recent} : {total_count: 300, workflow_runs: [older]};
  });
  assert.equal(actual.length, 102); assert.equal(calls.length, 5); assert.equal(actual.find(item => item.id === 102).status, 'queued');
});
test('incomplete large run history fails visibly instead of resetting retry budget', () => {
  const recent = Array.from({length: 100}, (_, i) => run(PRODUCER, {id: i+1}));
  assert.throws(() => recentWorkflowRuns(PRODUCER, Date.parse('2026-10-27T20:02:00Z'), () => ({total_count: 2000, workflow_runs: recent})), /ten-page/);
});

function httpFixture() {
  const value = fixture(), files = new Map(), trendsRaw = Buffer.from(JSON.stringify(value.trends));
  value.manifest.markets.US.assets = {market_trends: {path: `market-trends/series-${hash(trendsRaw)}.json`, sha256: hash(trendsRaw)}};
  const manifestRaw = Buffer.from(JSON.stringify(value.manifest)); value.receipt.data_manifest_sha256 = hash(manifestRaw);
  const receiptRaw = Buffer.from(JSON.stringify(value.receipt));
  files.set(BASE_URL+'publication.json', receiptRaw); files.set(BASE_URL+'static-data/manifest.json', manifestRaw); files.set(BASE_URL+'static-data/'+value.manifest.markets.US.assets.market_trends.path, trendsRaw);
  const calls = [];
  return {value, files, calls, fetch: async (url, options) => {calls.push({url, options}); assert(files.has(url)); return new Response(files.get(url));}};
}
test('public verification binds exact bytes and rereads receipt without caches', async () => {
  const value = httpFixture(); const result = await readPublicObservations(target, value.fetch);
  assert.equal(result.fresh, true); assert.equal(value.calls.length, 4);
  for (const call of value.calls) {assert.equal(call.options.cache, 'no-store'); assert.equal(call.options.redirect, 'error');}
});
test('changed manifest or trend bytes cannot report freshness', async () => {
  for (const kind of ['manifest','series']) {
    const value = httpFixture(), url = [...value.files.keys()].find(path => path.includes(kind)); value.files.set(url, Buffer.from('{}'));
    await assert.rejects(readPublicObservations(target, value.fetch), /mismatch/);
  }
});
test('a deployment changing during observation defers instead of mixing generations', async () => {
  const value = httpFixture(); let reads = 0;
  const fetch = async (url, options) => {if (url.endsWith('publication.json') && ++reads > 1) return new Response('{}'); return value.fetch(url, options);};
  await assert.rejects(readPublicObservations(target, fetch), /changed during/);
});
test('execution cannot be requested by an ordinary local process', async () => {
  const saved = process.env.GITHUB_ACTIONS; delete process.env.GITHUB_ACTIONS;
  try {await assert.rejects(main(['--execute']), /default-branch Actions/);} finally {if (saved !== undefined) process.env.GITHUB_ACTIONS = saved;}
});
test('workflow is recoverable, calendar-driven and has no deployment authority', () => {
  const workflow = readFileSync(new URL('../workflows/postclose-watchdog.yml', import.meta.url), 'utf8');
  assert.match(workflow, /2,12,22,32,42,52 13-20 \* \* 1-5/); assert.match(workflow, /17 0,6,10 \* \* \*/); assert.match(workflow, /America\/New_York/);
  assert.match(workflow, /cancel-in-progress: false/); assert.match(workflow, /--execute --output postclose-watchdog-report.json/);
  assert.match(workflow, /10 16 \* \* 1-6/); assert.match(workflow, /30 23 \* \* 1-6/);
  const producer = readFileSync(new URL('../workflows/static-site.yml', import.meta.url), 'utf8');
  assert.doesNotMatch(producer, /^  schedule:/m);
  assert.doesNotMatch(producer, /github\.event\.schedule|'-fast'/);
  assert.match(producer, /cancel-in-progress: false/);
  assert.match(workflow, /actions: write/); assert.doesNotMatch(workflow, /pages: write|id-token: write|contents: write|gh issue|gh api.*comments/);
  const ci = readFileSync(new URL('../workflows/ci.yml', import.meta.url), 'utf8'); assert.match(ci, /test_postclose_\*\.py/); assert.match(ci, /postclose-watchdog.test.mjs/);
});

function completionFixture(overrides = {}) {
  return run(PRODUCER, {run_attempt: 2, head_sha: 'a'.repeat(40), ...overrides});
}
const completion = completionRequest('200', '2');

test('completion relay rejects malformed, partial and unsafe identity inputs', () => {
  for (const values of [['', '2'], ['200', ''], ['0', '2'], ['200', '-1'], ['200', '2;echo'], ['200/attempts/1','2'], ['9007199254740992','2'], ['200','1.1']]) {
    assert.throws(() => completionRequest(...values), /Invalid/);
  }
});

test('completion relay waits for exact terminal attempt plus existing delivery grace', async () => {
  let now = Date.parse('2026-10-27T21:00:00Z'); const start = now, paths = [];
  const report = await waitForProducer(completion, {
    now: () => now, sleep: async ms => { now += ms; },
    api: async path => {
      paths.push(path);
      return completionFixture(now < start + 20_000 ? {status: 'in_progress', conclusion: null} : {updated_at: new Date(start + 20_000).toISOString()});
    },
  });
  assert.equal(report.waited_ms, 20_000 + EVENT_GRACE_MS);
  assert.equal(report.status, 'completed_with_event_grace');
  assert(paths.every(path => path === `repos/${REPOSITORY}/actions/runs/200`));
  const ctx = context(new Date(now).toISOString()); ctx.producerRuns = [completionFixture({updated_at: new Date(start + 20_000).toISOString()})];
  assert.equal(planRecovery(ctx).reason, 'producer_completed_without_publisher');
});

test('old completed source needs no sleep and already current public data causes no dispatch', async () => {
  const report = await waitForProducer(completion, {now: () => Date.parse('2026-10-27T22:30:00Z'), sleep: () => assert.fail('Unnecessary sleep'), api: async () => completionFixture()});
  assert.equal(report.waited_ms, 0);
  const ctx = context(); ctx.observed = observePublication(fixture(), target); ctx.producerRuns = [completionFixture()];
  assert.equal(planRecovery(ctx).action, 'none'); assert.equal(planRecovery(ctx).reason, 'published_observations_current');
});

test('active publisher still blocks a relay-triggered duplicate publication', async () => {
  await waitForProducer(completion, {now: () => Date.parse('2026-10-27T22:30:00Z'), api: async () => completionFixture()});
  const ctx = context(); ctx.producerRuns = [completionFixture()]; ctx.publisherRuns = [run(PUBLISHER, {status: 'in_progress', conclusion: null})];
  assert.equal(planRecovery(ctx).action, 'none'); assert.equal(planRecovery(ctx).reason, 'existing_work_in_flight');
});

test('completion relay rejects foreign identity, wrong attempt, failed source and future clock without waiting', async () => {
  const changes = [{id: 201}, {run_attempt: 3}, {repository: {full_name: 'foreign/repo'}}, {head_repository: {full_name: 'foreign/repo'}}, {head_branch: 'feature'}, {path: '.github/workflows/other.yml'}, {event: 'workflow_run'}, {head_sha: 'bad'}, {conclusion: 'failure'}, {conclusion: 'cancelled'}, {updated_at: '2026-10-28T00:00:00Z'}, {status: 'unknown'}];
  for (const change of changes) await assert.rejects(waitForProducer(completion, {now: () => Date.parse('2026-10-27T22:30:00Z'), api: async () => completionFixture(change), sleep: () => assert.fail('Invalid identity must not wait')}));
});

test('rerun starting while relay waits cannot be mistaken for original completion', async () => {
  let now = Date.parse('2026-10-27T21:00:00Z'), reads = 0;
  await assert.rejects(waitForProducer(completion, {now: () => now, sleep: async ms => {now += ms;}, api: async () => completionFixture(++reads === 1 ? {status: 'in_progress', conclusion: null} : {run_attempt: 3})}), /attempt changed/);
  assert.equal(reads, 2);
});

test('completion and event grace share a finite timeout', async () => {
  for (const ongoing of [true, false]) {
    let now = Date.parse('2026-10-27T21:00:00Z'); const start = now;
    await assert.rejects(waitForProducer(completion, {now: () => now, sleep: async ms => {now += ms;}, api: async () => completionFixture(ongoing ? {status: 'in_progress', conclusion: null} : {updated_at: new Date(now).toISOString()})}), /timeout; no recovery requested/);
    assert.equal(now - start, COMPLETION_TIMEOUT_MS);
  }
});

test('transient completion observations retry within the same bound without losing the wakeup', async () => {
  let now = Date.parse('2026-10-27T22:30:00Z'), calls = 0; const started = now;
  const report = await waitForProducer(completion, {now: () => now, sleep: async ms => {now += ms;}, api: async () => {
    if (++calls <= 2) throw Error('Transient API unavailable');
    return completionFixture();
  }});
  assert.equal(report.failed_observations, 2); assert.equal(report.observations, 3);
  assert.equal(now - started, 20_000);
});

test('persistent observation outage stops at the shared deadline without recovery', async () => {
  let now = Date.parse('2026-10-27T22:30:00Z'), calls = 0; const started = now;
  await assert.rejects(waitForProducer(completion, {now: () => now, sleep: async ms => {now += ms;}, api: async () => {calls++; throw Error('API unavailable');}}), error => {
    assert.match(error.message, /timeout; no recovery requested/); assert.equal(error.failedObservations, calls); return true;
  });
  assert.equal(now - started, COMPLETION_TIMEOUT_MS); assert.equal(calls, 30);
});

test('an invalid identity after a transient read is fatal without additional retries', async () => {
  let now = Date.parse('2026-10-27T22:30:00Z'), calls = 0, waits = 0;
  await assert.rejects(waitForProducer(completion, {now: () => now, sleep: async ms => {now += ms; waits++;}, api: async () => {
    if (++calls === 1) throw Error('Transient failure');
    return completionFixture({run_attempt: 3});
  }}), /attempt changed/);
  assert.equal(calls, 2); assert.equal(waits, 1);
});

test('late API requests receive only remaining deadline budget and cannot return late success', async () => {
  let now = Date.parse('2026-10-27T22:30:00Z'); const start = now, limits = [];
  await assert.rejects(waitForProducer(completion, {now: () => now, sleep: async ms => {now += ms;}, api: async (_path, {timeoutMs}) => {
    limits.push(timeoutMs);
    if (limits.length === 1) {now = start + COMPLETION_TIMEOUT_MS - 15_000; throw Error('Slow observation');}
    now += timeoutMs;
    return completionFixture();
  }}), /timeout; no recovery requested/);
  assert.deepEqual(limits, [30_000, 5_000]);
});

test('workflow wakeup is success-only ordinary full US and default checks keep existing planner', () => {
  const producer = readFileSync(new URL('../workflows/static-site.yml', import.meta.url), 'utf8');
  const relay = producer.split('  wake-postclose-watchdog:')[1].split('  promote-daily-source:')[0];
  assert.match(relay, /continue-on-error: true/);
  assert.match(relay, /needs: \[select-markets, build-market, combine-and-build, promote-daily-source\]/);
  for (const guard of ["github.event_name == 'workflow_dispatch'", "github.ref == 'refs/heads/main'", "needs.select-markets.outputs.repair != 'true'", "needs.select-markets.outputs.mode == 'full'", "'US'", "needs.build-market.result == 'success'", "needs.combine-and-build.result == 'success'", "needs.promote-daily-source.result == 'success'", "needs.promote-daily-source.result == 'skipped'"]) assert(relay.includes(guard));
  assert.match(relay, /producer_run_id="\$GITHUB_RUN_ID" -f producer_run_attempt="\$GITHUB_RUN_ATTEMPT"/);
  assert.match(relay, /for relay_try in 1 2 3; do/); assert.match(relay, /if \[ "\$relay_try" -lt 3 \]; then sleep 5; fi/);
  const workflow = readFileSync(new URL('../workflows/postclose-watchdog.yml', import.meta.url), 'utf8');
  assert.match(workflow, /if: inputs.producer_run_id != '' \|\| inputs.producer_run_attempt != ''/);
  assert(workflow.indexOf('postclose-completion.mjs') < workflow.indexOf('postclose-watchdog.mjs --execute'));
  assert.doesNotMatch(workflow, /continue-on-error: true/);
});
