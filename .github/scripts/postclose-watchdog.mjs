// This controller requests the existing gated producer/publisher. It cannot
// manufacture data, change approval, cancel active work, or deploy a Pages tree.
// GitHub schedules are best effort, not a publication SLA:
// https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule
// workflow_dispatch is explicitly allowed to create a run with GITHUB_TOKEN:
// https://docs.github.com/en/actions/how-tos/writing-workflows/choosing-when-your-workflow-runs/triggering-a-workflow
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {appendFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

export const REPOSITORY = 'kusennjp1-ai/screener';
export const BASE_URL = 'https://kusennjp1-ai.github.io/screener/';
export const PRODUCER = 'static-site.yml';
export const PUBLISHER = 'research-ui-release.yml';
const minute = 60_000;
const hash = value => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => { if (!condition) throw Error(message); };
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const positive = value => Number.isFinite(value) && value > 0;
const count = value => Number.isFinite(value) && value >= 0;
const latest = points => Array.isArray(points) ? points.at(-1) : null;
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const safePath = value => typeof value === 'string' && value.length < 256 && !value.startsWith('/') && !value.includes('..') && /^[A-Za-z0-9_./-]+$/.test(value);

export function validateClock(clock, now) {
  check(clock?.schema_version === 'postclose-session-clock-v1' && clock.exchange === 'NYSE' && clock.provider === 'pandas_market_calendars', 'Unknown exchange clock');
  check(day(clock.target_session) && day(clock.next_session) && clock.next_session > clock.target_session, 'Invalid session dates');
  for (const key of ['evaluated_at', 'target_close', 'eligible_at', 'next_close', 'next_eligible_at']) check(stamp(clock[key]), `Invalid ${key}`);
  check(Math.abs(Date.parse(clock.evaluated_at)-now) <= minute && Date.parse(clock.eligible_at) <= now && now < Date.parse(clock.next_eligible_at), 'Stale or future exchange clock');
  check(Date.parse(clock.eligible_at)-Date.parse(clock.target_close) === 2*minute && Date.parse(clock.next_eligible_at)-Date.parse(clock.next_close) === 2*minute && clock.acquisition_grace_minutes === 2, 'Changed acquisition grace');
}

export function observePublication({receipt, manifest, trends}, target) {
  check(receipt?.schema === 1 && Number.isSafeInteger(receipt.run_id) && receipt.run_id > 0, 'Missing real publication receipt');
  check(manifest?.markets?.US && trends?.schema_version === 'market-trends-v1' && trends.market === 'US', 'Missing US data');
  const market = manifest.markets.US, history = trends.long_history;
  const fields = {}, invalid = [];
  const record = (key, value, valid = true) => {
    if (value != null && (!day(value) || value > target)) invalid.push(key);
    fields[key] = valid && day(value) ? value : null;
  };
  record('scan', market.freshness?.scan_as_of_date);
  record('breadth', market.freshness?.breadth_latest_date);
  record('groups', market.freshness?.groups_latest_date);
  record('market_trends', trends.as_of_date);
  for (const symbol of ['^GSPC', '^IXIC']) {
    const index = trends.indices?.find(item => item.symbol === symbol), point = latest(index?.points);
    record(symbol === '^GSPC' ? 'sp500_distribution' : 'nasdaq_distribution', point?.date, index?.available === true && count(point?.value));
  }
  const putCall = latest(trends.put_call?.points);
  record('put_call', putCall?.date, positive(putCall?.calls) && count(putCall?.puts) && count(putCall?.value));
  record('long_history', history?.as_of_date);
  const breadth = latest(history?.breadth), sp500 = latest(history?.sp500), rotation = latest(history?.sectorRotation?.frames);
  record('long_breadth', breadth?.date, positive(breadth?.coverage) && breadth.coveragePercent >= 90 && count(breadth?.above50) && count(breadth?.newHighs) && count(breadth?.newLows) && count(breadth?.leaderCount));
  record('sp500_history', sp500?.date, positive(sp500?.close));
  const etfs = ['XLB','XLC','XLE','XLF','XLI','XLK','XLP','XLRE','XLU','XLV','XLY'];
  const ranks = rotation?.ranks;
  record('sector_rs', rotation?.date, ranks?.length === 11 && new Set(ranks.map(item => item.symbol)).size === 11 && etfs.every(symbol => ranks.some(item => item.symbol === symbol && positive(item.rank) && positive(item.relativeIndex))));
  const sectors = history?.sectorBreadth?.filter(item => item.universe > 0) || [];
  record('sector_breadth', sectors.length ? sectors.map(item => latest(item.points)?.date).sort()[0] : null,
    sectors.length > 0 && sectors.every(item => {
      const point = latest(item.points);
      // A small sector can correctly be unknown at today's observation. The
      // explicit coverage fields distinguish that from a missing update.
      const observed = count(point?.above50) && count(point?.leaderCount);
      const unknown = count(point?.coverage) && count(point?.eligibleUniverse) &&
        (point.eligibleUniverse === 0 || point.coverage/point.eligibleUniverse < .9) && point.above50 === null && point.leaderCount === null;
      return day(point?.date) && point.date <= target && (observed || unknown);
    }));
  // Count actual chart observation dates, never prices_generated_at (a fetch
  // timestamp can advance while every market bar remains yesterday's).
  const dates = [];
  for (const [key, value] of Object.entries(receipt.price_observations || {})) {
    let identity; try { identity = JSON.parse(key); } catch { throw Error('Malformed price observation identity'); }
    if (identity[0] !== 'US' || identity[1] !== 'chart') continue;
    check(day(value) && value <= target, 'Future or invalid actual chart observation');
    dates.push(value);
  }
  const current = dates.filter(value => value === target).length;
  const charts = {observed: dates.length, current, ratio: dates.length ? current/dates.length : 0};
  const stale = Object.entries(fields).filter(([, value]) => value !== target).map(([key]) => key);
  if (charts.ratio < .9) stale.push('chart_coverage');
  check(!invalid.length, `Invalid/future public dates: ${invalid.join(', ')}`);
  return {fields, charts, stale, fresh: stale.length === 0, publication_run_id: receipt.run_id, source_run_id: receipt.data_source?.run_id ?? null};
}

function normalizeRuns(runs, workflow, now) {
  check(Array.isArray(runs), 'Workflow run list missing');
  return runs.filter(run => run.head_branch === 'main' && (workflow !== PRODUCER || ['schedule', 'workflow_dispatch'].includes(run.event))).map(run => {
    check(run.path === `.github/workflows/${workflow}` && Number.isSafeInteger(run.id) && run.id > 0 && stamp(run.created_at) && stamp(run.updated_at), 'Malformed workflow run identity/clock');
    check(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY, 'Foreign workflow run');
    check(Date.parse(run.created_at) <= now+minute && Date.parse(run.updated_at) <= now+minute, 'Future workflow run');
    return run;
  }).sort((a, b) => Date.parse(b.created_at)-Date.parse(a.created_at));
}

export function planRecovery({clock, observed, producerRuns, publisherRuns, workflowStates, now}) {
  validateClock(clock, now);
  for (const name of [PRODUCER, PUBLISHER]) check(workflowStates[name] === 'active', `${name} is disabled or unavailable`);
  const producers = normalizeRuns(producerRuns, PRODUCER, now), publishers = normalizeRuns(publisherRuns, PUBLISHER, now);
  const elapsedMinutes = Math.floor((now-Date.parse(clock.target_close))/minute);
  const putCallOnly = observed.stale.length === 1 && observed.stale[0] === 'put_call';
  const common = {target_session: clock.target_session, elapsed_minutes: elapsedMinutes, overdue: !observed.fresh && elapsedMinutes >= (putCallOnly ? 240 : 120)};
  if (observed.fresh) return {...common, action: 'none', reason: 'published_observations_current'};
  const active = [...producers, ...publishers].filter(run => run.status !== 'completed');
  if (active.length) return {...common, action: 'none', reason: 'existing_work_in_flight', active_runs: active.map(run => ({id: run.id, workflow: run.path, status: run.status}))};
  const completedProducer = producers.find(run => run.conclusion === 'success' && Date.parse(run.created_at) >= Date.parse(clock.eligible_at));
  const lastRelease = publishers[0];
  // A producer can complete while its workflow_run event is lost. Give event
  // delivery two minutes, then request the ordinary publisher once. A failed
  // publisher is retried only once for this exact producer; fresh acquisition
  // remains the recovery path if the same evidence cannot pass publication.
  if (completedProducer && now-Date.parse(completedProducer.updated_at) >= 2*minute) {
    const afterProducer = publishers.filter(run => Date.parse(run.created_at) >= Date.parse(completedProducer.updated_at));
    const noDelivery = afterProducer.length === 0;
    const retryFailed = afterProducer.length === 1 && lastRelease.conclusion === 'failure' && now-Date.parse(lastRelease.updated_at) >= 10*minute;
    if (noDelivery || retryFailed) return {...common, action: 'publish', reason: noDelivery ? 'producer_completed_without_publisher' : 'retry_failed_publication_once', producer_run_id: completedProducer.id};
  }
  const attempts = producers.filter(run => Date.parse(run.created_at) >= Date.parse(clock.eligible_at));
  const last = attempts[0];
  // Cboe has its own publication clock. Its delay must not hold a fresh price
  // publication or trigger an expensive universe rebuild every ten minutes.
  if (putCallOnly) {
    const optionRetries = attempts.filter(run => Date.parse(run.created_at) >= Date.parse(clock.target_close)+90*minute);
    if (elapsedMinutes < 90) return {...common, action: 'none', reason: 'waiting_for_cboe_publication'};
    if (optionRetries.length >= 2) return {...common, action: 'none', reason: 'cboe_retry_budget_used_until_next_session'};
    if (optionRetries.length && now-Date.parse(optionRetries[0].updated_at) < 120*minute) return {...common, action: 'none', reason: 'cboe_retry_cooldown'};
  }
  // Run history survives runner/cache loss. After six acquisitions, slow to
  // six-hour catchup instead of repeatedly rebuilding an unavailable source.
  const cooldown = (attempts.length >= 6 ? 360 : Math.min(60, Math.max(10, attempts.length*10)))*minute;
  if (last && now-Date.parse(last.updated_at) < cooldown) return {...common, action: 'none', reason: 'acquisition_retry_cooldown', retry_after: new Date(Date.parse(last.updated_at)+cooldown).toISOString()};
  if (lastRelease && now-Date.parse(lastRelease.updated_at) < 2*minute) return {...common, action: 'none', reason: 'publication_propagation_grace'};
  // The first post-close request prioritizes actual chart prices. Its producer
  // restores retained long history without waiting for the bulk acquisition.
  // Any later request is full: API run metadata does not expose dispatch inputs,
  // and a failed price threshold must not trap recovery in a prices-only loop.
  const acquisitionMode = attempts.length === 0 && observed.charts.ratio < .9 ? 'prices_only' : 'full';
  return {...common, action: 'acquire', acquisition_mode: acquisitionMode,
    reason: attempts.length ? 'published_observations_still_behind' : 'completed_session_not_published'};
}

export function dispatchRequestFor(plan) {
  if (plan.action === 'publish') return {workflow: PUBLISHER, inputs: {ui_only: false}};
  check(plan.action === 'acquire' && ['prices_only','full'].includes(plan.acquisition_mode), 'Invalid acquisition dispatch plan');
  return {workflow: PRODUCER, inputs: {market_group: 'us', prices_only: plan.acquisition_mode === 'prices_only'}};
}

async function boundedGet(url, maxBytes, fetchImpl) {
  check(url.startsWith(BASE_URL), 'Foreign public data URL');
  let last;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetchImpl(url, {cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(20_000)});
      if (!response.ok) { const error = Error(`Public HTTP ${response.status}`); error.retryable = [408, 429, 500, 502, 503, 504].includes(response.status); throw error; }
      const parts = []; let size = 0;
      for await (const part of response.body) { size += part.length; check(size <= maxBytes, 'Public response exceeds bounded size'); parts.push(part); }
      return Buffer.concat(parts);
    } catch (error) {
      last = error;
      if (error.retryable === false || /bounded size|Foreign/.test(error.message) || attempt === 2) throw error;
      await new Promise(resolve => setTimeout(resolve, (attempt+1)*1000));
    }
  }
  throw last;
}

export async function readPublicObservations(target, fetchImpl = fetch) {
  // All these files are identity members of the existing transport contract.
  // Hash checks bind actual HTTP bytes through the publication receipt; no
  // deployment-time assumption or snapshot date substitutes for observation.
  const receiptRaw = await boundedGet(`${BASE_URL}publication.json`, 16*1024*1024, fetchImpl);
  const receipt = JSON.parse(receiptRaw);
  const manifestRaw = await boundedGet(`${BASE_URL}static-data/manifest.json`, 1024*1024, fetchImpl);
  check(hash(manifestRaw) === receipt.data_manifest_sha256, 'Publication/manifest mismatch (deployment may be changing)');
  const manifest = JSON.parse(manifestRaw), asset = manifest.markets?.US?.assets?.market_trends;
  check(safePath(asset?.path) && /^[a-f0-9]{64}$/.test(asset?.sha256 || ''), 'Market trend path/hash missing');
  const trendsRaw = await boundedGet(`${BASE_URL}static-data/${asset.path}`, 8*1024*1024, fetchImpl);
  check(hash(trendsRaw) === asset.sha256, 'Market trend content hash mismatch');
  const after = await boundedGet(`${BASE_URL}publication.json`, 16*1024*1024, fetchImpl);
  check(hash(after) === hash(receiptRaw), 'Publication changed during observation; defer to next check');
  return {...observePublication({receipt, manifest, trends: JSON.parse(trendsRaw)}, target), receipt_sha256: hash(receiptRaw), manifest_sha256: hash(manifestRaw), trends_sha256: hash(trendsRaw)};
}

function github(args, body) {
  const raw = execFileSync('gh', args, {input: body, encoding: 'utf8', timeout: 90_000, maxBuffer: 8*1024*1024, stdio: ['pipe','pipe','pipe']});
  return raw.trim() ? JSON.parse(raw) : null;
}

export function recentWorkflowRuns(name, cutoff, api) {
  const collected = new Map();
  let complete = false;
  for (let page = 1; page <= 10; page++) {
    const result = api(`repos/${REPOSITORY}/actions/workflows/${name}/runs?branch=main&per_page=100&page=${page}`);
    check(Array.isArray(result.workflow_runs) && Number.isSafeInteger(result.total_count), 'Missing workflow inventory');
    const runs = result.workflow_runs;
    for (const run of runs) { check(stamp(run.created_at), 'Workflow inventory date missing'); collected.set(run.id, run); }
    if (runs.length < 100 || page*100 >= result.total_count || runs.some(run => Date.parse(run.created_at) < cutoff)) { complete = true; break; }
  }
  check(complete, 'Workflow inventory exceeds bounded ten-page recovery window');
  // An old queued run may be outside the observation window. It still owns
  // work and must not be displaced by another automatic request.
  for (const status of ['queued','in_progress','waiting']) {
    const result = api(`repos/${REPOSITORY}/actions/workflows/${name}/runs?branch=main&status=${status}&per_page=100`);
    check(Array.isArray(result.workflow_runs) && Number.isSafeInteger(result.total_count) && result.total_count <= 100, 'Active workflow inventory exceeds bound');
    for (const run of result.workflow_runs) collected.set(run.id, run);
  }
  return [...collected.values()];
}

function saveReport(args, report) {
  const position = args.indexOf('--output');
  if (position >= 0) { check(args[position+1], 'Missing output path'); const path = resolve(args[position+1]); mkdirSync(dirname(path), {recursive: true}); writeFileSync(path, JSON.stringify(report, null, 2)+'\n'); }
}

export async function main(args = process.argv.slice(2)) {
  check(args.every((value, i) => ['--execute','--output'].includes(value) || args[i-1] === '--output'), 'Unknown watchdog argument');
  const execute = args.includes('--execute');
  check(!execute || process.env.GITHUB_REPOSITORY === REPOSITORY && process.env.GITHUB_REF === 'refs/heads/main' && process.env.GITHUB_ACTIONS === 'true', 'Execution is limited to the default-branch Actions controller');
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const clock = JSON.parse(execFileSync(process.env.POSTCLOSE_PYTHON || 'python', [resolve(root, '.github/scripts/postclose-calendar.py')], {encoding: 'utf8', timeout: 30_000}));
  const now = Date.now(); validateClock(clock, now);
  const observed = await readPublicObservations(clock.target_session);
  const workflowStates = {}, inventories = {};
  for (const name of [PRODUCER, PUBLISHER]) {
    const workflow = github(['api', `repos/${REPOSITORY}/actions/workflows/${name}`]);
    check(workflow.path === `.github/workflows/${name}`, 'Workflow identity mismatch'); workflowStates[name] = workflow.state;
    inventories[name] = recentWorkflowRuns(name, Math.min(now-12*60*minute, Date.parse(clock.eligible_at)), path => github(['api', path]));
  }
  const plan = planRecovery({clock, observed, producerRuns: inventories[PRODUCER], publisherRuns: inventories[PUBLISHER], workflowStates, now});
  const report = {schema_version: 'postclose-watchdog-report-v1', checked_at: new Date(now).toISOString(), clock, observed, plan, execute, dispatched: false};
  if (execute && ['acquire','publish'].includes(plan.action)) {
    const {workflow, inputs} = dispatchRequestFor(plan);
    report.dispatch_status = 'requested'; report.dispatched_workflow = workflow; saveReport(args, report);
    try {
      github(['api','--method','POST',`repos/${REPOSITORY}/actions/workflows/${workflow}/dispatches`,'--input','-'], JSON.stringify({ref: 'main', inputs}));
      report.dispatched = true; report.dispatch_status = 'accepted';
    } catch (error) {
      // A lost HTTP response is not proof that no run was queued. Do not retry
      // the mutation here; next inspection reconciles actual workflow history.
      report.dispatch_status = 'outcome_unknown'; report.error = 'Dispatch response unavailable; inspect workflow history before retrying';
      error.watchdogReport = report; throw error;
    }
  }
  saveReport(args, report);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### US close update check\n\nExpected session: **${clock.target_session}** (close ${clock.target_close}).\n\n| Observation | Published session |\n| --- | --- |\n${Object.entries(observed.fields).map(([key, value]) => `| ${key} | ${value || 'unavailable'} |`).join('\n')}\n\nCurrent chart observations: ${observed.charts.current}/${observed.charts.observed}. Action: ${plan.action}${plan.acquisition_mode ? ` (${plan.acquisition_mode})` : ''}; ${plan.reason}.\n\n${report.dispatched ? 'Requested the existing gated workflow; this is not publication confirmation.' : 'No workflow dispatched.'}\n`);
  console.log(JSON.stringify(report, null, 2));
  if (plan.overdue) { console.error(`::error::US ${clock.target_session} still missing ${observed.stale.join(', ')} ${plan.elapsed_minutes} minutes after close; recovery ${plan.reason}.`); if (execute) process.exitCode = 1; }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  const message = String(error.message).slice(0, 500).replace(/[\r\n]/g, ' ');
  saveReport(process.argv.slice(2), error.watchdogReport || {schema_version: 'postclose-watchdog-report-v1', checked_at: new Date().toISOString(), status: 'verification_failed', error: message, execute: process.argv.includes('--execute'), dispatched: false});
  console.error(`::error::Post-close update verification failed: ${message}`); process.exitCode = 1;
});
