// Post-close timer, waiting method A1: one GitHub-hosted job sleeps until the
// watchdog's own next inspection time (plan.wake_at), then requests the
// existing watchdog with no inputs. The watchdog still decides everything from
// the NYSE calendar, its two-minute grace, run history and the public site;
// this file only carries a time. A hosted job lasts at most six hours, so a
// longer wait re-dispatches this workflow with the same fire_at, one link per
// MAX_LINK_WAIT_MS. The watchdog's schedules stay as the fallback when a link
// is lost.
//
// Replacing A1 (an environment wait timer, A2, or an external clock calling
// workflow_dispatch, B) changes only TIMER/armWake's dispatch and runLink;
// the watchdog's wake_at contract does not change.
// workflow_dispatch is an explicit exception to GITHUB_TOKEN event suppression:
// https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow
import {execFileSync} from 'node:child_process';
import {appendFileSync, readFileSync, statSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {REPOSITORY} from './postclose-watchdog.mjs';

export const TIMER = 'postclose-timer.yml';
export const WATCHDOG = 'postclose-watchdog.yml';
const minute = 60_000;
// Below the 360-minute hosted job limit with room for checkout and dispatch.
export const MAX_LINK_WAIT_MS = 345*minute;
// A wake this old (for example a re-run of an old link) is not replayed.
export const STALE_FIRE_MS = 6*60*minute;
// Longer than any NYSE closure; a time beyond it is malformed, not a wait.
export const MAX_AHEAD_MS = 8*24*60*minute;
// Without a usable watchdog wake, inspect again in an hour.
export const FALLBACK_WAKE_MS = 60*minute;
// Never request a wake sooner than this, so a bad time cannot spin the chain.
export const MIN_LEAD_MS = minute;
export const DISPATCH_TRIES = 3;
// Bounded so arming stays well inside the watchdog's ten-minute job.
export const DISPATCH_TIMEOUT_MS = 30_000;
export const DISPATCH_RETRY_DELAY_MS = 5_000;
const FIRE_AT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const REASON = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_REPORT_BYTES = 16*1024*1024;

class TimerError extends Error {}
const check = (condition, message) => { if (!condition) throw new TimerError(message); };
const iso = value => new Date(value).toISOString();

export function parseFireAt(value) {
  check(typeof value === 'string' && FIRE_AT.test(value), 'Invalid fire_at');
  const at = Date.parse(value);
  check(Number.isFinite(at) && iso(at).slice(0, 19) === value.slice(0, 19), 'Invalid fire_at');
  return at;
}

export function wakeReason(value) {
  return typeof value === 'string' && REASON.test(value) ? value : 'unspecified';
}

// One link of the chain: what to do now for fire_at.
export function linkPlan({fireAt, now}) {
  check(Number.isFinite(fireAt) && Number.isFinite(now), 'Invalid timer clock');
  check(fireAt <= now+MAX_AHEAD_MS, 'fire_at is beyond any exchange closure');
  if (fireAt <= now-STALE_FIRE_MS) return {action: 'expired'};
  if (fireAt-now > MAX_LINK_WAIT_MS) return {action: 'rearm', wait_ms: MAX_LINK_WAIT_MS};
  return {action: 'fire', wait_ms: Math.max(0, fireAt-now)};
}

// The next fire_at from this run's watchdog report. Only a report whose plan
// was made, and whose dispatch (if any) was accepted, supplies its own time.
export function wakeRequest(report, now) {
  const fallback = reason => ({fire_at: iso(now+FALLBACK_WAKE_MS), reason, source: 'fallback'});
  if (!report || typeof report !== 'object') return fallback('watchdog_report_unavailable');
  if (report.schema_version !== 'postclose-watchdog-report-v1') return fallback('watchdog_report_unknown');
  if (report.status === 'verification_failed' || !report.plan || typeof report.plan !== 'object') return fallback('watchdog_verification_failed');
  if (report.dispatch_status !== undefined && report.dispatch_status !== 'accepted') return fallback('watchdog_dispatch_unconfirmed');
  let at;
  try { at = parseFireAt(report.plan.wake_at); } catch { return fallback('watchdog_wake_unavailable'); }
  if (at <= now-STALE_FIRE_MS || at > now+MAX_AHEAD_MS) return fallback('watchdog_wake_out_of_range');
  return {fire_at: iso(Math.max(at, now+MIN_LEAD_MS)), reason: wakeReason(report.plan.reason), source: 'watchdog_plan'};
}

export function readReport(path) {
  try {
    if (statSync(path).size > MAX_REPORT_BYTES) return null;
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch { return null; }
}

function github(args, body) {
  execFileSync('gh', args, {input: body, encoding: 'utf8', timeout: DISPATCH_TIMEOUT_MS, maxBuffer: 1024*1024, stdio: ['pipe','pipe','pipe']});
}

export function dispatchBody(workflow, inputs) {
  check([TIMER, WATCHDOG].includes(workflow), 'Unknown timer dispatch target');
  // The watchdog is always requested with no inputs: it plans from scratch.
  if (workflow === WATCHDOG) return {ref: 'main'};
  check(inputs && Object.keys(inputs).sort().join() === 'fire_at,reason', 'Timer dispatch needs fire_at and reason');
  parseFireAt(inputs.fire_at);
  return {ref: 'main', inputs: {fire_at: inputs.fire_at, reason: wakeReason(inputs.reason)}};
}

// A duplicate is harmless on both targets: the timer keeps only its newest run
// (cancel-in-progress), and the watchdog serializes and re-reads run history.
export async function dispatchWorkflow(workflow, inputs, {api = github, sleep = ms => new Promise(done => setTimeout(done, ms))} = {}) {
  const body = JSON.stringify(dispatchBody(workflow, inputs));
  for (let attempt = 1; ; attempt++) {
    try {
      api(['api', '--method', 'POST', `repos/${REPOSITORY}/actions/workflows/${workflow}/dispatches`, '--input', '-'], body);
      return attempt;
    } catch (error) {
      if (attempt >= DISPATCH_TRIES) throw new TimerError(`Dispatch of ${workflow} failed after ${attempt} tries`);
      await sleep(DISPATCH_RETRY_DELAY_MS);
    }
  }
}

export async function runLink({fireAt, reason, now = Date.now, sleep = ms => new Promise(done => setTimeout(done, ms)), dispatch}) {
  const started = now();
  let step = linkPlan({fireAt, now: started});
  const result = {fire_at: iso(fireAt), reason: wakeReason(reason), started_at: iso(started)};
  if (step.action === 'expired') return {...result, status: 'expired_not_dispatched'};
  if (step.action === 'rearm') {
    await sleep(step.wait_ms);
    await dispatch(TIMER, {fire_at: iso(fireAt), reason: wakeReason(reason)});
    return {...result, status: 'rearmed', dispatched_at: iso(now())};
  }
  // Sleep can end early or late: decide again on the wall clock before firing.
  for (let pass = 0; step.action === 'fire' && step.wait_ms > 0 && pass < 3; pass++) {
    await sleep(step.wait_ms);
    step = linkPlan({fireAt, now: now()});
  }
  if (step.action === 'expired') return {...result, status: 'expired_not_dispatched'};
  check(step.action === 'fire' && step.wait_ms === 0, 'Timer clock did not reach fire_at');
  await dispatch(WATCHDOG);
  return {...result, status: 'watchdog_requested', dispatched_at: iso(now())};
}

export function inMainActions(env) {
  return env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === REPOSITORY && env.GITHUB_REF === 'refs/heads/main';
}

function summary(env, text) {
  if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, text);
}

// Watchdog side: best effort. A lost link only leaves the schedules in charge,
// so an arming failure is a warning and never changes the watchdog's result.
export async function armWake({reportPath, env = process.env, now = Date.now, dispatch = dispatchWorkflow, log = console} = {}) {
  try {
    check(inMainActions(env), 'Timer dispatch is limited to the default-branch Actions controller');
    const request = wakeRequest(readReport(reportPath), now());
    await dispatch(TIMER, {fire_at: request.fire_at, reason: request.reason});
    summary(env, `\nNext watchdog wake: **${request.fire_at}** (${request.reason}; ${request.source}).\n`);
    log.log(JSON.stringify({status: 'armed', ...request}));
    return {status: 'armed', ...request};
  } catch (error) {
    const message = String(error?.message || error).slice(0, 300).replace(/[\r\n]/g, ' ');
    log.log(`::warning::Post-close timer not armed (${message}); the watchdog schedules remain the fallback.`);
    return {status: 'not_armed', error: message};
  }
}

// Timer side: a failure is visible on the timer run.
export async function waitAndWake({env = process.env, now = Date.now, sleep, dispatch = dispatchWorkflow, log = console} = {}) {
  check(inMainActions(env), 'Timer execution is limited to the default-branch Actions controller');
  const result = await runLink({fireAt: parseFireAt(env.FIRE_AT), reason: env.WAKE_REASON, now, sleep, dispatch});
  summary(env, `### Post-close watchdog timer\n\nfire_at **${result.fire_at}** (${result.reason}): ${result.status}.\n`);
  log.log(JSON.stringify(result));
  return result;
}

export async function main(args = process.argv.slice(2), options = {}) {
  if (args.length === 3 && args[0] === 'arm' && args[1] === '--report') return armWake({...options, reportPath: resolve(args[2])});
  check(args.length === 1 && args[0] === 'wait', 'Usage: postclose-timer.mjs arm --report <path> | wait');
  return waitAndWake(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  console.error(`::error::Post-close timer failed: ${String(error.message).slice(0, 300).replace(/[\r\n]/g, ' ')}`);
  process.exitCode = 1;
});
