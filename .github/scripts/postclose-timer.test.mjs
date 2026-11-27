import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PRODUCER, PUBLISHER, REPOSITORY, planRecovery, planRecoveryWithWake} from './postclose-watchdog.mjs';
import {DISPATCH_RETRY_DELAY_MS, DISPATCH_TIMEOUT_MS, DISPATCH_TRIES, FALLBACK_WAKE_MS, MAX_AHEAD_MS, MAX_LINK_WAIT_MS, MIN_LEAD_MS, STALE_FIRE_MS, TIMER, WATCHDOG,
  armWake, dispatchBody, dispatchWorkflow, linkPlan, main, parseFireAt, readReport, runLink, waitAndWake, wakeRequest} from './postclose-timer.mjs';

const minute = 60_000, hour = 60*minute;
const at = value => Date.parse(value);
const iso = value => new Date(value).toISOString();
const mainEnv = {GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: REPOSITORY, GITHUB_REF: 'refs/heads/main'};
const quiet = {log() {}};
const read = name => readFileSync(new URL(`../workflows/${name}`, import.meta.url), 'utf8');

// The same NYSE clock the watchdog runs (pandas_market_calendars, pinned).
function exchangeClock(now) {
  const python = process.env.POSTCLOSE_PYTHON;
  assert.ok(python, 'Set POSTCLOSE_PYTHON to the pinned session-calendar runtime, as ci.yml does');
  return JSON.parse(execFileSync(python, ['-I', fileURLToPath(new URL('./postclose-calendar.py', import.meta.url)), '--now', now], {encoding: 'utf8', timeout: 60_000}));
}
const inspect = (now, observed = {fresh: true, stale: []}) => planRecoveryWithWake({clock: exchangeClock(now), observed, producerRuns: [], publisherRuns: [], workflowStates: {[PRODUCER]: 'active', [PUBLISHER]: 'active'}, now: at(now)});
const report = plan => ({schema_version: 'postclose-watchdog-report-v1', checked_at: '2026-11-25T23:30:00.000Z', plan, execute: true, dispatched: false});

test('fire_at is a strict UTC instant', () => {
  assert.equal(parseFireAt('2026-11-27T19:00:00Z'), at('2026-11-27T19:00:00Z'));
  assert.equal(parseFireAt('2026-11-27T19:00:00.000Z'), at('2026-11-27T19:00:00Z'));
  for (const bad of ['', null, undefined, 42, 'now', '2026-11-27', '2026-11-27T19:00Z', '2026-11-27 19:00:00Z', '2026-11-27T19:00:00+09:00', '2026-11-27T19:00:00', '2026-02-30T00:00:00Z', '2026-11-27T24:00:00Z', '2026-11-27T19:00:00.000Z; echo', ' 2026-11-27T19:00:00Z'])
    assert.throws(() => parseFireAt(bad), /Invalid fire_at/, String(bad));
});

test('one link waits at most 5h45m, fires at fire_at, and drops a wake six hours old', () => {
  const now = at('2026-11-25T22:00:00Z');
  assert.equal(MAX_LINK_WAIT_MS, 345*minute); assert.equal(STALE_FIRE_MS, 6*hour);
  assert.deepEqual(linkPlan({fireAt: now+30*minute, now}), {action: 'fire', wait_ms: 30*minute});
  assert.deepEqual(linkPlan({fireAt: now+345*minute, now}), {action: 'fire', wait_ms: 345*minute});
  assert.deepEqual(linkPlan({fireAt: now+345*minute+1, now}), {action: 'rearm', wait_ms: 345*minute});
  assert.deepEqual(linkPlan({fireAt: now+10*hour, now}), {action: 'rearm', wait_ms: 345*minute});
  assert.deepEqual(linkPlan({fireAt: now-5*hour, now}), {action: 'fire', wait_ms: 0});
  assert.deepEqual(linkPlan({fireAt: now-6*hour+1, now}), {action: 'fire', wait_ms: 0});
  assert.deepEqual(linkPlan({fireAt: now-6*hour, now}), {action: 'expired'});
  assert.deepEqual(linkPlan({fireAt: now-7*hour, now}), {action: 'expired'});
  assert.throws(() => linkPlan({fireAt: now+MAX_AHEAD_MS+1, now}), /beyond any exchange closure/);
  assert.throws(() => linkPlan({fireAt: NaN, now}), /Invalid timer clock/);
});

function fakeClock(start) {
  let now = at(start); const sleeps = [], dispatches = [];
  return {sleeps, dispatches, now: () => now, advance: ms => { now += ms; },
    sleep: async ms => { sleeps.push(ms); now += ms; },
    dispatch: async (workflow, inputs) => { dispatches.push({workflow, inputs, at: iso(now)}); }};
}

test('a near wake sleeps once and requests the watchdog with no inputs at fire_at', async () => {
  const clock = fakeClock('2026-11-25T21:10:00Z');
  const result = await runLink({fireAt: at('2026-11-25T22:00:00Z'), reason: 'published_observations_current', ...clock});
  assert.deepEqual(clock.sleeps, [50*minute]);
  assert.deepEqual(clock.dispatches, [{workflow: WATCHDOG, inputs: undefined, at: '2026-11-25T22:00:00.000Z'}]);
  assert.equal(result.status, 'watchdog_requested');
});

test('an early return from sleep never fires before fire_at', async () => {
  let now = at('2026-11-25T21:00:00Z'); const sleeps = [], dispatches = [];
  await assert.rejects(runLink({fireAt: at('2026-11-25T22:00:00Z'), reason: 'x', now: () => now, sleep: async ms => { sleeps.push(ms); now += ms/2; }, dispatch: async workflow => { dispatches.push([workflow, iso(now)]); }}), /did not reach fire_at/);
  assert.equal(sleeps.length, 3); assert.deepEqual(dispatches, [], 'no dispatch before fire_at');
  now = at('2026-11-25T21:00:00Z'); let calls = 0;
  await runLink({fireAt: at('2026-11-25T22:00:00Z'), reason: 'x', now: () => now, sleep: async ms => { now += ++calls === 1 ? ms-1000 : ms; }, dispatch: async workflow => { dispatches.push([workflow, iso(now)]); }});
  assert.deepEqual(dispatches, [[WATCHDOG, '2026-11-25T22:00:00.000Z']]);
});

test('a far wake re-dispatches this timer with the same fire_at after one maximal link', async () => {
  const clock = fakeClock('2026-11-25T23:30:00Z');
  const result = await runLink({fireAt: at('2026-11-27T19:00:00Z'), reason: 'published_observations_current', ...clock});
  assert.deepEqual(clock.sleeps, [345*minute]);
  assert.deepEqual(clock.dispatches, [{workflow: TIMER, inputs: {fire_at: '2026-11-27T19:00:00.000Z', reason: 'published_observations_current'}, at: '2026-11-26T05:15:00.000Z'}]);
  assert.equal(result.status, 'rearmed');
});

test('a wake six or more hours old dispatches nothing', async () => {
  const clock = fakeClock('2026-11-26T04:00:00Z');
  const result = await runLink({fireAt: at('2026-11-25T22:00:00Z'), reason: 'x', ...clock});
  assert.equal(result.status, 'expired_not_dispatched'); assert.deepEqual(clock.sleeps, []); assert.deepEqual(clock.dispatches, []);
});

test('dispatch bodies: the watchdog gets no inputs, the timer only a validated fire_at and reason', () => {
  assert.deepEqual(dispatchBody(WATCHDOG), {ref: 'main'});
  assert.deepEqual(dispatchBody(WATCHDOG, {fire_at: '2026-11-27T19:00:00Z', reason: 'x'}), {ref: 'main'});
  assert.deepEqual(dispatchBody(TIMER, {fire_at: '2026-11-27T19:00:00.000Z', reason: 'cboe_retry_cooldown'}), {ref: 'main', inputs: {fire_at: '2026-11-27T19:00:00.000Z', reason: 'cboe_retry_cooldown'}});
  assert.deepEqual(dispatchBody(TIMER, {fire_at: '2026-11-27T19:00:00Z', reason: '$(id)'}).inputs.reason, 'unspecified');
  assert.throws(() => dispatchBody('static-site.yml', {}), /Unknown timer dispatch target/);
  assert.throws(() => dispatchBody('research-ui-release.yml'), /Unknown timer dispatch target/);
  assert.throws(() => dispatchBody(TIMER, {fire_at: 'soon', reason: 'x'}), /Invalid fire_at/);
  assert.throws(() => dispatchBody(TIMER, {fire_at: '2026-11-27T19:00:00Z', reason: 'x', ref: 'feature'}), /fire_at and reason/);
});

test('a dispatch is retried at most three times and posts only to the named workflow on main', async () => {
  const calls = [], waits = [];
  const attempts = await dispatchWorkflow(TIMER, {fire_at: '2026-11-27T19:00:00Z', reason: 'x'}, {sleep: async ms => { waits.push(ms); }, api: (args, body) => { calls.push({args, body: JSON.parse(body)}); if (calls.length < 3) throw Error('HTTP 502'); }});
  assert.equal(attempts, 3); assert.equal(DISPATCH_TRIES, 3); assert.deepEqual(waits, [5000, 5000]);
  // Worst case stays far inside the watchdog's ten-minute job.
  assert(DISPATCH_TRIES*DISPATCH_TIMEOUT_MS+(DISPATCH_TRIES-1)*DISPATCH_RETRY_DELAY_MS <= 2*minute);
  for (const call of calls) {
    assert.deepEqual(call.args, ['api', '--method', 'POST', `repos/${REPOSITORY}/actions/workflows/${TIMER}/dispatches`, '--input', '-']);
    assert.deepEqual(call.body, {ref: 'main', inputs: {fire_at: '2026-11-27T19:00:00Z', reason: 'x'}});
  }
  const failing = [];
  await assert.rejects(dispatchWorkflow(WATCHDOG, undefined, {sleep: async () => {}, api: args => { failing.push(args[3]); throw Error('down'); }}), /failed after 3 tries/);
  assert.deepEqual(failing, Array(3).fill(`repos/${REPOSITORY}/actions/workflows/${WATCHDOG}/dispatches`));
});

test('the next fire_at comes from the watchdog plan, otherwise one hour later', () => {
  const now = at('2026-11-25T23:31:00Z'), fallback = '2026-11-26T00:31:00.000Z';
  assert.equal(FALLBACK_WAKE_MS, hour); assert.equal(MIN_LEAD_MS, minute);
  assert.deepEqual(wakeRequest(report({action: 'none', reason: 'published_observations_current', wake_at: '2026-11-27T19:00:00.000Z'}), now), {fire_at: '2026-11-27T19:00:00.000Z', reason: 'published_observations_current', source: 'watchdog_plan'});
  assert.deepEqual(wakeRequest({...report({action: 'acquire', reason: 'completed_session_not_published', wake_at: '2026-11-26T05:16:00.000Z'}), dispatch_status: 'accepted', dispatched: true}, now).source, 'watchdog_plan');
  for (const [value, reason] of [
    [null, 'watchdog_report_unavailable'], ['text', 'watchdog_report_unavailable'],
    [{schema_version: 'other', plan: {wake_at: '2026-11-27T19:00:00Z'}}, 'watchdog_report_unknown'],
    [{schema_version: 'postclose-watchdog-report-v1', status: 'verification_failed', error: 'Public HTTP 503'}, 'watchdog_verification_failed'],
    [{...report({action: 'acquire', wake_at: '2026-11-26T05:16:00.000Z'}), dispatch_status: 'outcome_unknown'}, 'watchdog_dispatch_unconfirmed'],
    [{...report({action: 'acquire', wake_at: '2026-11-26T05:16:00.000Z'}), dispatch_status: 'requested'}, 'watchdog_dispatch_unconfirmed'],
    [report({action: 'none', reason: 'x'}), 'watchdog_wake_unavailable'],
    [report({action: 'none', reason: 'x', wake_at: 'tomorrow'}), 'watchdog_wake_unavailable'],
    [report({action: 'none', reason: 'x', wake_at: '2026-11-25T17:31:00.000Z'}), 'watchdog_wake_out_of_range'],
    [report({action: 'none', reason: 'x', wake_at: '2026-12-05T00:00:00.000Z'}), 'watchdog_wake_out_of_range'],
  ]) assert.deepEqual(wakeRequest(value, now), {fire_at: fallback, reason, source: 'fallback'}, reason);
  // A wake already due (the check ran long) is kept at least a minute ahead.
  assert.equal(wakeRequest(report({action: 'none', reason: 'publication_propagation_grace', wake_at: '2026-11-25T23:30:30.000Z'}), now).fire_at, '2026-11-25T23:32:00.000Z');
  assert.equal(wakeRequest(report({action: 'none', reason: 'Bad Reason', wake_at: '2026-11-27T19:00:00.000Z'}), now).reason, 'unspecified');
});

test('an overdue check waiting for the once-only publication retry arms that retry time, not the hourly fallback', () => {
  // 11-25 session: producer 45709447126 and the release that failed at 01:23:38Z (measured run clocks).
  const now = '2026-11-26T01:30:00Z', runs = (path, overrides) => [{path: `.github/workflows/${path}`, head_branch: 'main', event: 'workflow_dispatch', repository: {full_name: REPOSITORY}, head_repository: {full_name: REPOSITORY}, status: 'completed', ...overrides}];
  const plan = planRecoveryWithWake({clock: exchangeClock(now), observed: {fresh: false, stale: ['scan', 'long_history']},
    producerRuns: runs(PRODUCER, {id: 45709447126, conclusion: 'success', created_at: '2026-11-25T22:00:29Z', updated_at: '2026-11-26T00:56:14Z'}),
    publisherRuns: runs(PUBLISHER, {id: 45732499990, conclusion: 'failure', created_at: '2026-11-26T00:58:22Z', updated_at: '2026-11-26T01:23:38Z'}),
    workflowStates: {[PRODUCER]: 'active', [PUBLISHER]: 'active'}, now: at(now)});
  assert.equal(plan.action, 'none'); assert.equal(plan.reason, 'publication_retry_grace'); assert.equal(plan.overdue, true);
  assert.equal(plan.wake_at, '2026-11-26T01:33:38.000Z');
  // The overdue exit 1 still leaves a report whose own wake is used.
  assert.deepEqual(wakeRequest({...report(plan), checked_at: now}, at(now)+minute), {fire_at: '2026-11-26T01:33:38.000Z', reason: 'publication_retry_grace', source: 'watchdog_plan'});
});

test('report reading tolerates a missing or malformed file', () => {
  const directory = mkdtempSync(join(tmpdir(), 'postclose-timer-'));
  try {
    assert.equal(readReport(join(directory, 'missing.json')), null);
    writeFileSync(join(directory, 'bad.json'), '{"schema_version":'); assert.equal(readReport(join(directory, 'bad.json')), null);
    writeFileSync(join(directory, 'good.json'), JSON.stringify(report({wake_at: '2026-11-27T19:00:00.000Z'}))); assert.equal(readReport(join(directory, 'good.json')).plan.wake_at, '2026-11-27T19:00:00.000Z');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('arming is limited to main Actions and never fails the watchdog', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'postclose-timer-')), path = join(directory, 'postclose-watchdog-report.json');
  const lines = [], log = {log: line => lines.push(line)};
  try {
    writeFileSync(path, JSON.stringify(report({action: 'none', reason: 'published_observations_current', wake_at: '2026-11-27T19:00:00.000Z'})));
    for (const env of [{}, {...mainEnv, GITHUB_REF: 'refs/heads/feature'}, {...mainEnv, GITHUB_REPOSITORY: 'fork/screener'}, {...mainEnv, GITHUB_ACTIONS: 'false'}]) {
      const outside = [];
      const result = await armWake({reportPath: path, env, now: () => at('2026-11-25T23:31:00Z'), log, dispatch: async (...call) => { outside.push(call); }});
      assert.equal(result.status, 'not_armed'); assert.deepEqual(outside, [], 'no dispatch outside main Actions');
    }
    assert(lines.every(line => line.startsWith('::warning::')));
    const sent = [];
    const armed = await armWake({reportPath: path, env: mainEnv, now: () => at('2026-11-25T23:31:00Z'), log: quiet, dispatch: async (workflow, inputs) => { sent.push({workflow, inputs}); }});
    assert.deepEqual(sent, [{workflow: TIMER, inputs: {fire_at: '2026-11-27T19:00:00.000Z', reason: 'published_observations_current'}}]); assert.equal(armed.status, 'armed');
    sent.length = 0;
    await armWake({reportPath: join(directory, 'absent.json'), env: mainEnv, now: () => at('2026-11-25T23:31:00Z'), log: quiet, dispatch: async (workflow, inputs) => { sent.push({workflow, inputs}); }});
    assert.deepEqual(sent, [{workflow: TIMER, inputs: {fire_at: '2026-11-26T00:31:00.000Z', reason: 'watchdog_report_unavailable'}}]);
    lines.length = 0;
    const lost = await armWake({reportPath: path, env: mainEnv, now: () => at('2026-11-25T23:31:00Z'), log, dispatch: async () => { throw Error('Dispatch of postclose-timer.yml failed after 3 tries'); }});
    assert.equal(lost.status, 'not_armed'); assert.match(lines[0], /^::warning::Post-close timer not armed .*schedules remain the fallback/);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('waiting is limited to main Actions and validates fire_at before sleeping', async () => {
  const never = () => assert.fail('must not sleep or dispatch');
  await assert.rejects(waitAndWake({env: {FIRE_AT: '2026-11-25T22:00:00Z'}, sleep: never, dispatch: never, log: quiet}), /default-branch Actions/);
  await assert.rejects(waitAndWake({env: {...mainEnv, FIRE_AT: '$(date)'}, sleep: never, dispatch: never, log: quiet}), /Invalid fire_at/);
  const clock = fakeClock('2026-11-25T21:30:00Z');
  const result = await waitAndWake({env: {...mainEnv, FIRE_AT: '2026-11-25T22:00:00Z', WAKE_REASON: 'published_observations_current'}, ...clock, log: quiet});
  assert.equal(result.status, 'watchdog_requested'); assert.deepEqual(clock.dispatches.map(item => item.workflow), [WATCHDOG]);
  await assert.rejects(main(['arm']), /Usage/); await assert.rejects(main(['wait', '--now', 'x']), /Usage/); await assert.rejects(main([]), /Usage/);
});

test('session wakes come from the exchange calendar: one hour after each actual NYSE close', () => {
  for (const [now, session, wake] of [
    ['2026-11-24T23:30:00Z', '2026-11-24', '2026-11-25T22:00:00.000Z'], // winter close 21:00Z
    ['2026-11-25T20:30:00Z', '2026-11-24', '2026-11-25T22:00:00.000Z'], // before the close: the same session's wake
    ['2026-11-25T23:30:00Z', '2026-11-25', '2026-11-27T19:00:00.000Z'], // 11-26 Thanksgiving has no session; 11-27 closes 18:00Z
    ['2026-11-26T15:00:00Z', '2026-11-25', '2026-11-27T19:00:00.000Z'],
    ['2026-11-27T19:30:00Z', '2026-11-27', '2026-11-30T22:00:00.000Z'], // Friday to Monday
    ['2026-10-30T21:30:00Z', '2026-10-30', '2026-11-02T22:00:00.000Z'], // DST ends over the weekend
    ['2027-03-12T22:30:00Z', '2027-03-12', '2027-03-15T21:00:00.000Z'], // DST starts 2027-03-14: close 20:00Z
    ['2026-12-24T19:00:00Z', '2026-12-24', '2026-12-28T22:00:00.000Z'], // early close, then Christmas
  ]) {
    const plan = inspect(now);
    assert.equal(plan.target_session, session, now); assert.equal(plan.reason, 'published_observations_current', now); assert.equal(plan.wake_at, wake, now);
  }
});

test('11-25 published: the chain reaches the watchdog at 11-27 19:00Z, which then requests 11-27', async () => {
  const wake = wakeRequest(report(inspect('2026-11-25T23:30:00Z')), at('2026-11-25T23:31:00Z'));
  assert.equal(wake.fire_at, '2026-11-27T19:00:00.000Z');
  const clock = fakeClock('2026-11-25T23:31:00Z'); let link = {fire_at: wake.fire_at, reason: wake.reason}, links = 0;
  while (link) {
    links++; clock.advance(minute); // queueing before each link starts
    const before = clock.dispatches.length;
    await runLink({fireAt: parseFireAt(link.fire_at), reason: link.reason, ...clock});
    const sent = clock.dispatches.slice(before); assert.equal(sent.length, 1);
    link = sent[0].workflow === TIMER ? sent[0].inputs : null;
  }
  assert.equal(links, 8); // 43h29m of waiting in links of at most 5h45m
  const fired = clock.dispatches.at(-1); assert.equal(fired.workflow, WATCHDOG); assert.equal(fired.at, '2026-11-27T19:00:00.000Z');
  // The watchdog at that time still applies its own rule: 18:00Z close, 2-minute grace.
  const clockAt = exchangeClock('2026-11-27T19:00:00Z');
  assert.equal(clockAt.target_session, '2026-11-27'); assert.equal(clockAt.eligible_at, '2026-11-27T18:02:00Z');
  const plan = inspect('2026-11-27T19:00:00Z', {fresh: false, stale: ['scan', 'chart_coverage', 'long_history']});
  assert.equal(plan.action, 'acquire'); assert.equal(plan.target_session, '2026-11-27');
  assert.equal(planRecovery({clock: clockAt, observed: {fresh: false, stale: ['scan']}, producerRuns: [], publisherRuns: [], workflowStates: {[PRODUCER]: 'active', [PUBLISHER]: 'active'}, now: at('2026-11-27T19:00:00Z')}).reason, 'completed_session_not_published');
});

test('timer workflow: dispatch-only, newest wake wins, minimal token, inputs never inlined in shell', () => {
  const workflow = read('postclose-timer.yml');
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:\n      fire_at:\n/m); assert.doesNotMatch(workflow, /^  (schedule|push|pull_request|workflow_run):/m);
  assert.match(workflow, /^run-name: .*\$\{\{ inputs\.fire_at \}\}/m);
  assert.match(workflow, /^permissions:\n  contents: read\n  actions: write\n\n/m);
  assert.doesNotMatch(workflow, /pages: write|id-token: write|contents: write|secrets\./);
  assert.match(workflow, /^concurrency:\n  group: postclose-timer\n  cancel-in-progress: true\n/m);
  assert.match(workflow, /^    if: github\.ref == 'refs\/heads\/main'\n/m);
  const timeout = Number(workflow.match(/timeout-minutes: (\d+)/)[1]); assert(timeout*minute > MAX_LINK_WAIT_MS+5*minute && timeout <= 360, String(timeout));
  for (const line of workflow.split('\n').filter(line => /^\s+run:/.test(line))) assert.doesNotMatch(line, /\$\{\{/, line);
  assert.match(workflow, /FIRE_AT: \$\{\{ inputs\.fire_at \}\}/); assert.match(workflow, /WAKE_REASON: \$\{\{ inputs\.reason \}\}/);
  assert.match(workflow, /run: node \.github\/scripts\/postclose-timer\.mjs wait$/m);
  // The watchdog keeps every schedule as the fallback for a lost link.
  const watchdog = read('postclose-watchdog.yml');
  for (const cron of ['2,12,22,32,42,52 13-20 * * 1-5', '17 0,6,10 * * *', '47 1-23/2 * * *', '10 16 * * 1-6', '30 23 * * 1-6']) assert(watchdog.includes(`cron: '${cron}'`), cron);
  assert.match(read('ci.yml'), /POSTCLOSE_PYTHON="\$RUNNER_TEMP\/session-calendar-runtime\/bin\/python" node --test \.github\/scripts\/postclose-timer\.test\.mjs/);
});
