import { execFileSync } from 'node:child_process';
import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { createImmutableGitApi } from './immutable-github-api.mjs';
import {priceControllerRoot,verifyPriceSourceCompletion,isVerifiedPriceSourceProof} from './retained-price-ci-admission.mjs';
import {readRepairRequest,validateRepairRequest} from './retained-price-source-admission.mjs';

const invocationApi = new AsyncLocalStorage();

export function withInvocationImmutableGitApi(repository, work) {
  const api = createImmutableGitApi((endpoint, paginate) => invocationApi.run(undefined, () => githubApi(endpoint, paginate)), repository);
  return invocationApi.run(api, () => {
    try {
      const result = work();
      if (result && typeof result.then === 'function') return Promise.resolve(result).finally(() => api.dispose());
      api.dispose();
      return result;
    } catch (error) {
      api.dispose();
      throw error;
    }
  });
}

export const gateWorkflows = ['ci.yml', 'design-acceptance.yml'];
export const sameRepository = (run, repository) => run?.repository?.full_name === repository
  && run?.head_repository?.full_name === repository;
export const workflowPath = file => `.github/workflows/${file}`;

export function publicationDecision({ eventName, event, sha, currentSha, runs = [], finitePriceSource = null }) {
  const repository = event.repository?.full_name;
  const blocked = reason => ({ publish: false, reason });
  if (!repository || event.repository.default_branch !== 'main' || !/^[a-f0-9]{40}$/.test(sha ?? '')) return blocked('Invalid repository or revision');
  if (sha !== currentSha) return blocked('Controller revision is no longer current main');
  const trigger = event.workflow_run;
  let finite=false;
  if(isVerifiedPriceSourceProof(finitePriceSource,{sourceRunId:trigger?.id,controllerSha:sha})){
    try{validateRepairRequest(finitePriceSource.activation.request);finite=trigger?.event==='workflow_run'&&trigger.path===workflowPath('static-site.yml')&&trigger.head_sha===sha;}catch{finite=false;}
  }
  if (eventName !== 'workflow_dispatch' && (eventName !== 'workflow_run' || !sameRepository(trigger, repository)
    || trigger.head_branch !== 'main' || trigger.status !== 'completed'
    || ![...gateWorkflows, 'static-site.yml'].some(file => trigger.path === workflowPath(file))
    || (trigger.path !== workflowPath('static-site.yml') && trigger.event !== 'push')
    || (trigger.path === workflowPath('static-site.yml') && !['schedule', 'workflow_dispatch'].includes(trigger.event)&&!finite))) {
    return blocked('Untrusted publication trigger');
  }
  if(finite)return {publish:true,mode:'data',finitePriceSource:{runId:finitePriceSource.producer.id,attempt:finitePriceSource.producer.run_attempt},reason:'Exact finite repaired source; preserve the currently approved live UI'};
  const gates = gateWorkflows.map(file => runs.filter(run => run.path === workflowPath(file) && run.event === 'push'
    && run.head_branch === 'main' && run.head_sha === sha && sameRepository(run, repository))
    .sort((a, b) => b.id - a.id || b.run_attempt - a.run_attempt)[0]);
  if (gates.every(run => run?.status === 'completed' && run.conclusion === 'success' && Number.isSafeInteger(run.id) && run.id > 0 && Number.isSafeInteger(run.run_attempt) && run.run_attempt > 0)) {
    return { publish: true, mode: 'ui', approval: { type: 'gates', sha, runs: gates.map(run => ({ id: run.id, attempt: run.run_attempt, path: run.path })) }, reason: 'Both exact-main UI gates passed' };
  }
  return { publish: true, mode: 'data', reason: 'Keep the approved live UI; validate data with its pinned code' };
}

// Transport retries never cover JSON/provenance validation or retain partial pages.
export const githubReadRetryPolicy = Object.freeze({ attempts: 3, totalMs: 120000, attemptMs: 60000, delaysMs: Object.freeze([1000, 2000]) });
export function transientGithubReadError(error) {
  const stderr = `${String(error?.stderr ?? '')}\n${String(error?.message ?? '')}`;
  const statuses = [...stderr.matchAll(/\bHTTP (\d{3})\b/g)].map(match => Number(match[1]));
  if (error?.signal || ['ENOBUFS', 'ENOENT', 'EACCES', 'EPERM'].includes(error?.code) ||
      /authentication|authorization|unauthorized|forbidden|permission|access denied|rate limit|bad credentials|gh auth login|certificate|unknown authority/i.test(stderr)) return false;
  if (statuses.length) return statuses.every(status => [500, 502, 503, 504].includes(status));
  return ['ECONNRESET', 'ETIMEDOUT', 'EAI_AGAIN'].includes(error?.code) ||
    /(?:connection reset by peer|TLS handshake timeout|dial tcp[^\n]*: i\/o timeout|temporary failure in name resolution)/i.test(stderr);
}
export function createGithubReadApi({ execute = execFileSync, sleep = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms), now = () => performance.now() } = {}) {
  return (endpoint, paginate = false) => {
    const args = ['api', ...(paginate ? ['--paginate', '--slurp'] : []), endpoint];
    const started = now();
    let output, lastError;
    for (let attempt = 0; attempt < githubReadRetryPolicy.attempts; attempt++) {
      const remaining = githubReadRetryPolicy.totalMs - (now() - started);
      if (remaining <= 0) throw lastError ?? Error('GitHub read time budget exhausted');
      try {
        output = execute('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
          timeout: Math.max(1, Math.min(githubReadRetryPolicy.attemptMs, Math.floor(remaining))), killSignal: 'SIGKILL' });
        break;
      } catch (error) {
        lastError = error;
        const delay = githubReadRetryPolicy.delaysMs[attempt];
        if (!transientGithubReadError(error) || attempt + 1 >= githubReadRetryPolicy.attempts ||
            now() - started + delay >= githubReadRetryPolicy.totalMs) throw error;
        sleep(delay);
        if (now() - started >= githubReadRetryPolicy.totalMs) throw error;
      }
    }
    return JSON.parse(output);
  };
}
const readGithubApi = createGithubReadApi();

export function githubApi(endpoint, paginate = false) {
  const scopedApi = invocationApi.getStore();
  if (scopedApi) return scopedApi(endpoint, paginate);
  return readGithubApi(endpoint, paginate);
}

export function checkPublication(event, sha, repository, api = githubApi) {
  const repo = api(`repos/${repository}`);
  if (repo.full_name !== repository) throw Error('Unexpected publication repository');
  let trigger;
  if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
    if (!Number.isSafeInteger(event.workflow_run?.id) || event.workflow_run.id <= 0) throw Error('Missing workflow completion identity');
    trigger = api(`repos/${repository}/actions/runs/${event.workflow_run.id}`);
  }
  const normalizedEvent = { ...event, repository: repo, workflow_run: trigger };
  const currentSha = api(`repos/${repository}/git/ref/heads/main`).object.sha;
  let finitePriceSource=null;
  if(trigger?.path===workflowPath('static-site.yml')&&trigger.event==='workflow_run'){
    const root=priceControllerRoot(),request=readRepairRequest(root);
    if(request?.value.enabled)finitePriceSource=verifyPriceSourceCompletion({root,sourceRun:trigger,api});
  }
  if(finitePriceSource){
    const finiteDecision=publicationDecision({eventName:process.env.GITHUB_EVENT_NAME,event:normalizedEvent,sha,currentSha,runs:[],finitePriceSource});
    if(finiteDecision.publish&&finiteDecision.mode==='data'&&finiteDecision.finitePriceSource)return finiteDecision;
  }
  const runs = gateWorkflows.flatMap(file => api(`repos/${repository}/actions/workflows/${file}/runs?branch=main&event=push&head_sha=${sha}&per_page=100`, true).flatMap(page => page.workflow_runs));
  return publicationDecision({ eventName: process.env.GITHUB_EVENT_NAME, event: normalizedEvent, sha, currentSha, runs,finitePriceSource });
}
