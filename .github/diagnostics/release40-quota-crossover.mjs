import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

export const REPOSITORY = 'kusennjp1-ai/screener';
export const REPOSITORY_ID = 1203919607;
export const TARGET = 'https://api.github.com/repos/kusennjp1-ai/screener/actions/runs/37456692717/attempts/1';
export const SEQUENCE = Object.freeze(['C','T','C','B','C','B','C','T','C','T','C','B']);
export const LIMITS = Object.freeze({ invocations: 12, total_ms: 180000, per_call_ms: 10000,
  interval_ms: 1000, header_bytes: 32768, body_bytes: 131072, stderr_bytes: 4096,
  artifact_bytes: 65536, retained_reserve: 228 });
export const PROFILE = Object.freeze({ Accept: 'application/vnd.github+json',
  'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'release40-quota-crossover/1',
  'Content-Type': 'application/json; charset=utf-8', 'Time-Zone': 'UTC',
  'Accept-Encoding': 'identity', 'Cache-Control': 'no-store', Pragma: 'no-cache',
  'Accept-Language': '*', 'Sec-Fetch-Mode': 'cors' });
const ARMS = Object.freeze({ C: { transport: 'gh', authorization_scheme: 'token' },
  T: { transport: 'native-fetch', authorization_scheme: 'token' },
  B: { transport: 'native-fetch', authorization_scheme: 'Bearer' } });
const CODES = new Set(['invalid-target','invalid-arm','missing-credential','credential-binding-changed',
  'total-deadline','call-timeout','output-cap','stderr-cap','header-cap','body-cap','gh-process-error',
  'gh-nonzero','native-fetch-failed','malformed-response','malformed-headers','invalid-status',
  'redirect-observed','unexpected-final-url','retry-after-present','status-not-200','invalid-quota',
  'identity-mismatch','reset-boundary-crossed','insufficient-diagnostic-reserve','unsafe-output',
  'invalid-clock','unexpected-failure','invalid-context','invalid-runtime','candidate-mismatch',
  'overlay-scope-mismatch','output-directory-invalid','cleanup-failed','setup-failed']);
export class DiagnosticError extends Error { constructor(code) { super(code); this.code = code; } }
export const ensure = (condition, code) => { if (!condition) throw new DiagnosticError(code); };
export const safeCode = error => CODES.has(error?.code) ? error.code : 'unexpected-failure';
export function assertTarget(url) { ensure(url === TARGET, 'invalid-target'); }
const integer = value => typeof value === 'string' && /^(0|[1-9]\d{0,12})$/.test(value)
  && Number.isSafeInteger(Number(value)) ? Number(value) : null;
const fixedString = (value, pattern, maximum = 128) => typeof value === 'string'
  && value.length <= maximum && pattern.test(value) ? value : null;
const EMPTY_QUOTA = () => ({ resource: null, limit: null, remaining: null, used: null, reset_epoch: null });
const KNOWN_HEADERS = new Set(['date','x-github-request-id','x-ratelimit-resource','x-ratelimit-limit',
  'x-ratelimit-remaining','x-ratelimit-used','x-ratelimit-reset','age','cache-control','vary','x-cache',
  'x-github-api-version-selected','via','location','retry-after','content-type','content-length',
  'content-encoding','server','etag','last-modified','link','strict-transport-security',
  'x-content-type-options','x-frame-options','x-xss-protection','referrer-policy',
  'access-control-allow-origin','access-control-expose-headers','content-security-policy',
  'x-accepted-github-permissions','x-accepted-oauth-scopes','x-oauth-scopes']);
export function reduceHeaders(pairs) {
  let malformed = false, bytes = 0;
  const headers = new Map();
  if (!Array.isArray(pairs)) return reduceHeaders([]);
  for (const pair of pairs) {
    if (!Array.isArray(pair) || pair.length !== 2 || typeof pair[0] !== 'string' || typeof pair[1] !== 'string') {
      malformed = true; continue;
    }
    const [rawName, value] = pair; const name = rawName.toLowerCase();
    bytes += Buffer.byteLength(rawName) + Buffer.byteLength(value) + 4;
    if (!/^[a-z0-9-]{1,80}$/.test(name) || /[\r\n\0]/.test(value) || headers.has(name)) malformed = true;
    else headers.set(name, value);
  }
  ensure(bytes <= LIMITS.header_bytes, 'header-cap');
  const get = name => headers.get(name);
  const quota = EMPTY_QUOTA();
  quota.resource = get('x-ratelimit-resource') === 'core' ? 'core' : null;
  for (const [key, name] of [['limit','limit'],['remaining','remaining'],['used','used'],['reset_epoch','reset']])
    quota[key] = integer(get('x-ratelimit-' + name));
  const validQuota = !malformed && quota.resource === 'core' && quota.limit > 0
    && quota.remaining !== null && quota.used !== null && quota.reset_epoch > 0
    && quota.remaining + quota.used === quota.limit;
  const date = fixedString(get('date'), /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/, 29);
  const responseDate = date && new Date(Date.parse(date)).toUTCString() === date ? date : null;
  // Never preserve arbitrary cache values. The parsers accept only known directives/header names.
  const cacheControl = fixedString(get('cache-control'), /^(?:(?:public|private|no-cache|no-store|must-revalidate|proxy-revalidate|immutable|no-transform)|(?:max-age|s-maxage|stale-while-revalidate|stale-if-error)=\d{1,9})(?:,\s*(?:(?:public|private|no-cache|no-store|must-revalidate|proxy-revalidate|immutable|no-transform)|(?:max-age|s-maxage|stale-while-revalidate|stale-if-error)=\d{1,9}))*$/i, 256);
  const vary = fixedString(get('vary'), /^(?:Accept|Accept-Encoding|Accept-Language|Authorization|Cookie|Origin|X-GitHub-OTP|X-GitHub-Api-Version|X-Requested-With)(?:,\s*(?:Accept|Accept-Encoding|Accept-Language|Authorization|Cookie|Origin|X-GitHub-OTP|X-GitHub-Api-Version|X-Requested-With))*$/i, 256);
  return { quota, valid_quota: validQuota, malformed_headers: malformed,
    response_date: responseDate,
    request_id: fixedString(get('x-github-request-id'), /^[A-Fa-f0-9]{4,16}(?::[A-Fa-f0-9]{4,16}){3,5}$/),
    cache: { age: integer(get('age')), cache_control: cacheControl, vary,
      x_cache: fixedString(get('x-cache'), /^(?:HIT|MISS|BYPASS|STALE|EXPIRED|REVALIDATED|DYNAMIC)(?:, ?(?:HIT|MISS|BYPASS|STALE|EXPIRED|REVALIDATED|DYNAMIC))*$/, 80),
      api_version: get('x-github-api-version-selected') === '2022-11-28' ? '2022-11-28' : null,
      via_present: headers.has('via'), location_present: headers.has('location'),
      retry_after_present: headers.has('retry-after'), unexpected_header_present: [...headers.keys()].some(h => !KNOWN_HEADERS.has(h)),
      cache_value_rejected: ['cache-control','vary','x-cache','age','x-github-api-version-selected'].some(name => headers.has(name)
        && ({'cache-control':cacheControl, vary, 'x-cache':fixedString(get('x-cache'),/^(?:HIT|MISS|BYPASS|STALE|EXPIRED|REVALIDATED|DYNAMIC)(?:, ?(?:HIT|MISS|BYPASS|STALE|EXPIRED|REVALIDATED|DYNAMIC))*$/,80), age:integer(get('age')), 'x-github-api-version-selected':get(name)==='2022-11-28'?'2022-11-28':null})[name] === null) } };
}
export function verifyBody(body) {
  ensure(Buffer.byteLength(body) <= LIMITS.body_bytes, 'body-cap');
  let object; try { object = JSON.parse(body); } catch { throw new DiagnosticError('malformed-response'); }
  ensure(object && object.id === 37456692717 && object.run_attempt === 1
    && object.repository?.id === REPOSITORY_ID && object.repository?.full_name === REPOSITORY
    && object.head_repository?.id === REPOSITORY_ID && object.head_repository?.full_name === REPOSITORY
    && object.head_sha === '8a490df5b0a873637781a8e4e5351cece9313f37'
    && object.head_branch === 'main' && object.path === '.github/workflows/research-ui-release.yml'
    && object.event === 'workflow_run' && object.status === 'completed' && object.conclusion === 'success', 'identity-mismatch');
  return true;
}
export function parseGhOutput(buffer) {
  ensure(Buffer.isBuffer(buffer) && buffer.length <= LIMITS.header_bytes + LIMITS.body_bytes, 'output-cap');
  const text = buffer.toString('utf8');
  const boundary = /\r?\n\r?\n/.exec(text);
  ensure(boundary && boundary.index <= LIMITS.header_bytes, 'malformed-response');
  const lines = text.slice(0, boundary.index).split(/\r?\n/);
  const match = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5]\d\d)(?: [\x20-\x7e]*)?$/.exec(lines.shift());
  ensure(match, 'invalid-status');
  const headers = lines.map(line => { const i = line.indexOf(':');
    ensure(i > 0 && !/^\s/.test(line), 'malformed-headers'); return [line.slice(0, i), line.slice(i+1).trim()]; });
  const body = text.slice(boundary.index + boundary[0].length);
  ensure(!/^HTTP\//.test(body), 'redirect-observed');
  ensure(Buffer.byteLength(body) <= LIMITS.body_bytes, 'body-cap');
  return { status: Number(match[1]), headers, body, final_url_equal: null, redirected: null, process_exit_ok: true };
}
export function ghEnvironment(base, token, configDirectory) {
  const env = { ...base, GH_TOKEN: token, GH_CONFIG_DIR: configDirectory, GH_HOST: 'github.com',
    GH_PROMPT_DISABLED: '1', GH_DEBUG: '', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1' };
  delete env.GITHUB_TOKEN; delete env.GH_ENTERPRISE_TOKEN; delete env.GITHUB_ENTERPRISE_TOKEN;
  return env;
}
export function ghArguments(url = TARGET) {
  assertTarget(url);
  return ['api', url, '--method', 'GET', '--hostname', 'github.com', '--include',
    ...Object.entries(PROFILE).flatMap(([name,value]) => ['--header', `${name}: ${value}`])];
}
export function collectProcess(binary, args, { env, timeoutMs, maxOutput = LIMITS.header_bytes + LIMITS.body_bytes, spawnImpl = spawn }) {
  return new Promise((resolve, reject) => {
    let child, timer, settled = false, size = 0, stderrSize = 0; const chunks = [];
    const fail = code => { if (settled) return; settled = true; clearTimeout(timer); child?.kill('SIGKILL'); chunks.length = 0; reject(new DiagnosticError(code)); };
    try { child = spawnImpl(binary, args, { env, stdio: ['ignore','pipe','pipe'], shell: false }); }
    catch { fail('gh-process-error'); return; }
    timer = setTimeout(() => fail('call-timeout'), timeoutMs);
    child.stdout.on('data', chunk => { if (settled) return; size += chunk.length;
      if (size > maxOutput) fail('output-cap'); else chunks.push(chunk); });
    child.stderr.on('data', chunk => { stderrSize += chunk.length; if (stderrSize > LIMITS.stderr_bytes) fail('stderr-cap'); });
    child.on('error', () => fail('gh-process-error'));
    child.on('close', code => { if (settled) return; settled = true; clearTimeout(timer);
      const output = Buffer.concat(chunks); chunks.length = 0; resolve({ output, exit_ok: code === 0 }); });
  });
}
async function nativeRequest(arm, token, { fetchImpl, timeoutMs, url }) {
  const controller = new AbortController(); let timer;
  const work = async () => {
    let response, reader, complete = false;
    try {
      try { response = await fetchImpl(url, { method: 'GET', headers: { ...PROFILE,
        Authorization: `${ARMS[arm].authorization_scheme} ${token}` }, redirect: 'error',
        cache: 'no-store', credentials: 'omit', signal: controller.signal }); }
      catch { throw new DiagnosticError(controller.signal.aborted ? 'call-timeout' : 'native-fetch-failed'); }
      const headers = [...response.headers.entries()]; reduceHeaders(headers);
      const result = { status: response.status, headers, body: '', final_url_equal: response.url === url,
        redirected: response.redirected === true, process_exit_ok: null };
      ensure(!result.redirected && !(response.status >= 300 && response.status <= 399), 'redirect-observed');
      ensure(result.final_url_equal, 'unexpected-final-url');
      reader = response.body?.getReader(); const chunks = []; let size = 0;
      if (reader) while (true) { const { done, value } = await reader.read(); if (done) break;
        size += value.byteLength; ensure(size <= LIMITS.body_bytes, 'body-cap'); chunks.push(Buffer.from(value)); }
      complete = true; result.body = Buffer.concat(chunks).toString('utf8'); chunks.length = 0;
      return result;
    } finally {
      if (!complete) {
        controller.abort();
        if (reader) await reader.cancel().catch(() => {});
        else if (response?.body) await response.body.cancel().catch(() => {});
      }
      reader?.releaseLock();
    }
  };
  try { return await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => {
    controller.abort(); reject(new DiagnosticError('call-timeout')); }, timeoutMs); })]); }
  finally { clearTimeout(timer); controller.abort(); }
}
export function createTransport({ token, env, configDirectory, ghPath = '/usr/bin/gh', fetchImpl = fetch,
  processImpl = collectProcess }) {
  return async ({ arm, url, timeoutMs }) => {
    assertTarget(url); ensure(Object.hasOwn(ARMS, arm), 'invalid-arm');
    ensure(env.GH_TOKEN === token && typeof token === 'string' && token.length > 0, 'credential-binding-changed');
    if (arm !== 'C') return nativeRequest(arm, token, { fetchImpl, timeoutMs, url });
    const result = await processImpl(ghPath, ghArguments(url), { env: ghEnvironment(env, token, configDirectory), timeoutMs });
    try { const response = parseGhOutput(result.output); response.process_exit_ok = result.exit_ok; return response; }
    finally { result.output.fill(0); }
  };
}
export function safeEnvironment(env) {
  const names = ['HTTP_PROXY','HTTPS_PROXY','ALL_PROXY','NO_PROXY','http_proxy','https_proxy','all_proxy','no_proxy',
    'NODE_USE_ENV_PROXY','NODE_OPTIONS','NODE_DEBUG','NODE_DEBUG_NATIVE','GH_CONFIG_DIR','GH_TOKEN','GITHUB_TOKEN','GH_ENTERPRISE_TOKEN',
    'GITHUB_ENTERPRISE_TOKEN','GH_DEBUG','SSLKEYLOGFILE','NODE_EXTRA_CA_CERTS','SSL_CERT_FILE','SSL_CERT_DIR'];
  return { presence: Object.fromEntries(names.map(name => [name, Boolean(env[name])])),
    node_proxy_mode: env.NODE_USE_ENV_PROXY === '1' ? 'enabled' : !env.NODE_USE_ENV_PROXY || env.NODE_USE_ENV_PROXY === '0' ? 'disabled' : 'unrecognized',
    proxy_security_environment_preserved: true, isolated_gh_config: true,
    alternative_cli_token_fallbacks_removed: true };
}
export function classify(samples) {
  if (samples.length !== SEQUENCE.length || samples.some(s => !s.valid_quota || s.status !== 200)) return 'inconclusive';
  if (new Set(samples.map(s=>s.request_id)).size !== samples.length || samples.some(s => !s.response_date || !s.request_id || !s.cache.cache_control || s.cache.age > 0 || (s.cache.x_cache !== null && s.cache.x_cache.split(',').some(value=>!['MISS','BYPASS','DYNAMIC'].includes(value.trim()))) || s.cache.cache_value_rejected || !s.date_within_sample_tolerance)) return 'inconclusive-freshness';
  const windows = new Map();
  for (const arm of ['C','T','B']) { const keys = new Set(samples.filter(s=>s.arm===arm).map(s=>JSON.stringify([s.quota.resource,s.quota.limit,s.quota.reset_epoch])));
    if (keys.size !== 1) return 'inconclusive-within-arm-variation'; windows.set(arm,[...keys][0]); }
  const c=windows.get('C'),t=windows.get('T'),b=windows.get('B');
  if (c===t && t===b) return 'split-not-reproduced';
  if (c===t && b!==t) return 'scheme-associated-window-split-reproduced';
  if (t===b && c!==t) return 'scheme-alone-not-supported-cli-native-split';
  return 'inconclusive-window-pattern';
}
export function serializeSafe(report, token) {
  const text = JSON.stringify(report, null, 2) + '\n';
  ensure(Buffer.byteLength(text) <= LIMITS.artifact_bytes, 'output-cap');
  // Last-resort equality containment guard only. No token digest, logging, parsing, or serialization.
  ensure(!token || !text.includes(token), 'unsafe-output');
  return text;
}
export async function runCrossover({ token, env, request, wall = Date.now, monotonic = () => performance.now(),
  sleep = ms => new Promise(resolve => setTimeout(resolve,ms)) }) {
  const report = { schema: 'release40-quota-crossover-result-v1', measurement_complete: false, measurement_succeeded: false,
    budgetAccepted: false, quota_credit_granted: false, whole_release_certified: false, publication_authority: false,
    target: TARGET, method: 'GET', credential_reference: 'automatic github.token via GH_TOKEN',
    credential_equality_checked_in_memory: false, historical_token_reused: false,
    sequence: SEQUENCE, limits: LIMITS, request_header_names: [...Object.keys(PROFILE), 'Authorization'].sort(),
    header_profile_normalized: true, freshness_scope: 'Date proximity and distinct validated request IDs; absent cache metadata cannot prove fresh origin', residual_transport_differences: ['HTTP-version','header-order','connection-behavior','default-proxy-routing','gh-final-origin-unobservable'],
    owned_invocations: 0, internal_gh_wire_requests: null, wire_request_bound_proven: false,
    gh_redirect_policy: 'stock CLI opaque; no requested redirects; stop if observed', native_redirect_policy: 'error',
    diagnostic_admission_only: true, production_budget_policy_changed: false,
    samples: [], outcome: 'inconclusive', stop_reason: null };
  const begin = monotonic(); let lastStart = null;
  try {
    ensure(typeof token === 'string' && token.length > 0, 'missing-credential');
    for (const arm of SEQUENCE) {
      ensure(env.GH_TOKEN === token, 'credential-binding-changed');
      if (lastStart !== null) await sleep(Math.max(0, LIMITS.interval_ms - (monotonic()-lastStart)));
      ensure(env.GH_TOKEN === token, 'credential-binding-changed');
      const start = monotonic(), startWall = wall();
      ensure(Number.isFinite(start) && Number.isFinite(startWall) && start >= begin, 'invalid-clock');
      ensure(start - begin + LIMITS.per_call_ms <= LIMITS.total_ms, 'total-deadline');
      for (const prior of report.samples) ensure(prior.quota.reset_epoch * 1000 > startWall, 'reset-boundary-crossed');
      lastStart = start; report.owned_invocations++; report.credential_equality_checked_in_memory = true;
      const sample = { sequence: report.owned_invocations, arm, ...ARMS[arm], started_at: new Date(startWall).toISOString(),
        ended_at: null, duration_ms: null, status: null, quota: EMPTY_QUOTA(), valid_quota: false,
        response_date: null, request_id: null, cache: { age:null,cache_control:null,vary:null,x_cache:null,api_version:null,
          via_present:null,location_present:null,retry_after_present:null,unexpected_header_present:null,cache_value_rejected:null },
        malformed_headers: null, final_url_equal: null, redirected: null, process_exit_ok: null,
        credential_reference_equal: true, date_within_sample_tolerance: null, identity_verified: false, error: null };
      report.samples.push(sample);
      try {
        const response = await request({ arm, url: TARGET, timeoutMs: LIMITS.per_call_ms });
        ensure(env.GH_TOKEN === token, 'credential-binding-changed');
        ensure(Number.isInteger(response.status) && response.status >= 100 && response.status <= 599, 'invalid-status');
        sample.status = response.status; Object.assign(sample, reduceHeaders(response.headers));
        sample.final_url_equal = response.final_url_equal; sample.redirected = response.redirected; sample.process_exit_ok = response.process_exit_ok;
        ensure(!sample.redirected && !(sample.status>=300&&sample.status<=399) && !sample.cache.location_present, 'redirect-observed');
        ensure(arm==='C'||sample.final_url_equal===true, 'unexpected-final-url');
        ensure(!sample.cache.retry_after_present, 'retry-after-present'); ensure(sample.status===200, 'status-not-200');
        ensure(!sample.malformed_headers, 'malformed-headers'); ensure(sample.valid_quota, 'invalid-quota');
        ensure(arm!=='C'||sample.process_exit_ok===true, 'gh-nonzero');
        sample.identity_verified = verifyBody(response.body); response.body = null;
      } catch (error) { sample.error = safeCode(error); throw error; }
      finally {
        const end = monotonic(), endWall = wall(); sample.ended_at = new Date(endWall).toISOString();
        sample.duration_ms = Math.max(0,Math.round(end-start));
        sample.date_within_sample_tolerance = sample.response_date ? Date.parse(sample.response_date)>=startWall-5000 && Date.parse(sample.response_date)<=endWall+5000 : null;
      }
      ensure(sample.duration_ms<=LIMITS.per_call_ms && monotonic()-begin<=LIMITS.total_ms, 'total-deadline');
      for (const previous of report.samples) ensure(previous.quota.reset_epoch*1000>wall(), 'reset-boundary-crossed');
      ensure(sample.quota.remaining >= LIMITS.retained_reserve + SEQUENCE.length - report.owned_invocations, 'insufficient-diagnostic-reserve');
    }
    report.measurement_complete = true; report.measurement_succeeded = true; report.outcome = classify(report.samples);
  } catch (error) { report.stop_reason = safeCode(error); }
  return report;
}
