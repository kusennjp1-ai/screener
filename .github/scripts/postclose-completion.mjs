// A successful producer explicitly wakes the existing watchdog. GitHub documents
// workflow_dispatch as an exception to GITHUB_TOKEN event suppression:
// https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow
// This relay only observes completion; publication still uses the normal planner
// and all source, financial, freshness and UI gates.
import {execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {PRODUCER, REPOSITORY} from './postclose-watchdog.mjs';

class CompletionVerificationError extends Error {}
const check = (condition, message) => { if (!condition) throw new CompletionVerificationError(message); };
export const COMPLETION_TIMEOUT_MS = 300_000;
export const EVENT_GRACE_MS = 120_000;

export function completionRequest(runId, attempt) {
  check(typeof runId === 'string' && /^[1-9][0-9]*$/.test(runId) && Number.isSafeInteger(Number(runId)), 'Invalid producer run ID');
  check(typeof attempt === 'string' && /^[1-9][0-9]*$/.test(attempt) && Number.isSafeInteger(Number(attempt)), 'Invalid producer attempt');
  return {run_id: Number(runId), run_attempt: Number(attempt)};
}

export function verifyCompletionRun(run, request, now) {
  check(run?.id === request.run_id && run.run_attempt === request.run_attempt, 'Producer run or attempt changed');
  check(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY, 'Foreign producer repository');
  check(run.path === `.github/workflows/${PRODUCER}` && run.head_branch === 'main' && run.event === 'workflow_dispatch', 'Not an ordinary main producer');
  check(/^[a-f0-9]{40}$/.test(run.head_sha || ''), 'Invalid producer revision');
  const created = Date.parse(run.created_at), updated = Date.parse(run.updated_at);
  check(Number.isFinite(created) && Number.isFinite(updated) && updated >= created && updated <= now + 60_000, 'Invalid producer clock');
  check(['queued','in_progress','waiting','pending','requested','completed'].includes(run.status), 'Unknown producer status');
  if (run.status === 'completed') check(run.conclusion === 'success', 'Producer did not complete successfully');
  return run.status === 'completed' ? updated + EVENT_GRACE_MS : null;
}

export async function waitForProducer(request, {api, now = Date.now, sleep = ms => new Promise(done => setTimeout(done, ms))}) {
  const started = now(), deadline = started + COMPLETION_TIMEOUT_MS;
  let observations = 0, failedObservations = 0;
  const withinDeadline = () => {
    if (now() >= deadline) {
      const error = new CompletionVerificationError('Producer completion timeout; no recovery requested');
      error.failedObservations = failedObservations;
      throw error;
    }
  };
  while (true) {
    withinDeadline();
    observations += 1;
    let run;
    try {
      run = await api(`repos/${REPOSITORY}/actions/runs/${request.run_id}`, {timeoutMs: Math.max(1, Math.min(30_000, deadline - now()))});
    } catch {
      // A transient read failure must not lose the wakeup. Retry only the
      // observation, within the same deadline, without logging raw API output.
      failedObservations += 1;
      withinDeadline();
      await sleep(Math.min(10_000, deadline - now()));
      continue;
    }
    const checked = now();
    let readyAt;
    try { readyAt = verifyCompletionRun(run, request, checked); }
    catch (error) { error.failedObservations = failedObservations; throw error; }
    withinDeadline();
    if (readyAt !== null && checked >= readyAt) return {
      schema_version: 'postclose-completion-report-v1', ...request,
      status: 'completed_with_event_grace', source_sha: run.head_sha,
      producer_updated_at: run.updated_at, checked_at: new Date(checked).toISOString(),
      waited_ms: checked - started, observations, failed_observations: failedObservations,
    };
    // Keep the planner's existing two-minute workflow_run delivery grace. The
    // five-minute total bound also allows producer job teardown; timeout leaves
    // recovery to the scheduled watchdog without dispatching anything here.
    await sleep(Math.min(10_000, deadline - checked, readyAt === null ? 10_000 : readyAt - checked));
  }
}

export async function main(args = process.argv.slice(2)) {
  check(args.length === 2, 'Expected exact producer run ID and attempt');
  const request = completionRequest(...args);
  const report = await waitForProducer(request, {api: (path, {timeoutMs}) => JSON.parse(execFileSync('gh', ['api', path], {encoding: 'utf8', timeout: timeoutMs, stdio: ['ignore','pipe','pipe']}))});
  writeFileSync('postclose-completion-report.json', JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => {
  // Do not echo raw API/subprocess output: it may contain credentials. A failed
  // pre-step skips the mutation-capable watchdog step and retains diagnostics.
  const reason = error instanceof CompletionVerificationError ? error.message : 'Producer API observation unavailable';
  const report = {schema_version: 'postclose-completion-report-v1', status: 'completion_not_verified', checked_at: new Date().toISOString(), reason, failed_observations: Number.isSafeInteger(error.failedObservations) ? error.failedObservations : 0, recovery_requested: false};
  writeFileSync('postclose-completion-report.json', JSON.stringify(report, null, 2) + '\n');
  console.error(`::error::${reason}; scheduled recovery remains active.`);
  process.exitCode = 1;
});
