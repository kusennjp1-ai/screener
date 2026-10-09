// Stateless manual pagination. This transport grants no publication authority.
// Callers own fresh proofs, their narrower page limits, the private gh execution
// configuration and the supplied whole-path budget. CLI output is not wire data.
import { performance } from 'node:perf_hooks';

export const BOUNDED_GITHUB_API_LIMITS = Object.freeze({
  pages: 100, perPage: 100, bodyBytes: 64 * 1024 * 1024,
  headerBytes: 64 * 1024, statusBlocks: 8,
  deadlineMs: 120_000, commandMs: 30_000,
});
const L = BOUNDED_GITHUB_API_LIMITS;
const PREFIX = 'repos/kusennjp1-ai/screener';
const ORIGIN = 'https://api.github.com/';
const SHA = /^[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const freezeFacts = value => {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeFacts));
  if (object(value)) return Object.freeze(Object.fromEntries(Object.entries(value).map(([key, item]) => [key, freezeFacts(item)])));
  return value;
};
class GitHubReadFault extends Error {
  constructor(code, facts = {}) {
    super(code); this.name = 'GitHubReadFault'; this.code = code;
    this.facts = freezeFacts(facts);
  }
}
const check = (condition, code, facts) => { if (!condition) throw new GitHubReadFault(code, facts); };
function bytesOf(value) {
  check(value instanceof Uint8Array, 'invalid-command-output');
  check(value.byteLength <= L.bodyBytes + L.headerBytes, 'command-output-cap');
  return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
}
function quota(headers) {
  const result = {};
  for (const name of ['limit', 'remaining', 'used', 'reset']) {
    const raw = headers.get('x-ratelimit-' + name);
    check(raw === undefined || (/^\d+$/.test(raw) && Number.isSafeInteger(Number(raw))), 'invalid-quota-header');
    result[name] = raw === undefined ? null : Number(raw);
  }
  const resource = headers.get('x-ratelimit-resource');
  check(resource === undefined || resource === 'core', 'unexpected-quota-resource');
  result.resource = resource ?? null;
  check(result.limit === null || result.remaining === null || result.remaining <= result.limit, 'contradictory-quota-header');
  check(result.limit === null || result.used === null || result.used <= result.limit, 'contradictory-quota-header');
  result.complete = Object.values(result).every(value => value !== null);
  return Object.freeze(result);
}
function responseHead(input) {
  const bytes = bytesOf(input), blocks = [];
  let offset = 0, headerBytes = 0, lastHeaders = null, headerComplete = false;
  const safe = () => ({
    stdout_bytes: bytes.length, header_bytes: headerBytes,
    body_bytes: headerComplete && bytes.subarray(offset, offset + 5).toString('ascii') !== 'HTTP/' ? bytes.length - offset : null,
    visible_statuses: blocks.map(block => block.status),
    header_blocks: blocks.map(block => ({ ...block, quota: { ...block.quota } })),
    status: headerComplete && bytes.subarray(offset, offset + 5).toString('ascii') !== 'HTTP/' &&
      blocks.length && blocks[blocks.length - 1].status >= 200 ? blocks[blocks.length - 1].status : null,
    quota: blocks.length ? { ...blocks[blocks.length - 1].quota } : null,
    retry_after_present: blocks.some(block => block.retry_after_present),
    retry_after_seconds: blocks.find(block => block.retry_after_present)?.retry_after_seconds ?? null,
  });
  const line = () => {
    const end = bytes.indexOf(10, offset);
    check(end >= offset && end + 1 <= L.headerBytes, 'malformed-include-headers', safe());
    let finish = end;
    if (finish > offset && bytes[finish - 1] === 13) finish--;
    const raw = bytes.subarray(offset, finish);
    check(raw.every(value => value === 9 || (value >= 32 && value <= 126)), 'invalid-include-header-bytes', safe());
    offset = end + 1; headerBytes = offset;
    return raw.toString('ascii');
  };
  do {
    check(blocks.length < L.statusBlocks, 'include-status-block-cap', safe());
    headerComplete = false;
    const match = /^HTTP\/(?:1\.[01]|2(?:\.0)?|3(?:\.0)?) ([1-5]\d{2})(?: [ -~]*)?$/.exec(line());
    check(match, 'malformed-include-status', safe());
    const status = Number(match[1]), headers = new Map();
    const block = { status, quota: { limit: null, remaining: null, used: null, reset: null, resource: null, complete: false },
      retry_after_present: false, retry_after_seconds: null, location_present: false };
    blocks.push(block);
    while (true) {
      const value = line();
      if (value === '') break;
      const header = /^([!#$%&'*+.^_\x60|~0-9A-Za-z-]+):[ \t]*(.*)$/.exec(value);
      check(header, 'malformed-include-header', safe());
      const name = header[1].toLowerCase(), content = header[2].trim();
      // Only interpretation-sensitive duplicates are ambiguous. Repeated
      // unrelated headers are ignored and never enter observations.
      if (['link', 'content-type', 'retry-after', 'location'].includes(name) || name.startsWith('x-ratelimit-'))
        check(!headers.has(name), 'duplicate-include-header', safe());
      if (!headers.has(name)) headers.set(name, content);
      if (name === 'retry-after') {
        block.retry_after_present = true;
        block.retry_after_seconds = /^\d+$/.test(content) && Number.isSafeInteger(Number(content)) ? Number(content) : null;
      }
      if (name === 'location') block.location_present = true;
    }
    headerComplete = true;
    let parsedQuota;
    try { parsedQuota = quota(headers); }
    catch (error) {
      if (error instanceof GitHubReadFault) throw new GitHubReadFault(error.code, safe());
      throw error;
    }
    block.quota = parsedQuota; lastHeaders = headers;
  } while (bytes.subarray(offset, offset + 5).toString('ascii') === 'HTTP/');
  return { bytes, offset, headers: lastHeaders, facts: safe() };
}
function acceptedHead(head) {
  const { facts } = head;
  check(!facts.retry_after_present, 'github-retry-after', facts);
  check(!facts.header_blocks.some(block => [403, 429].includes(block.status)), 'github-denial', facts);
  check(!facts.header_blocks.some(block => (block.status >= 300 && block.status < 400) || block.location_present),
    'github-redirect', facts);
  check(facts.header_blocks.slice(0, -1).every(block => [100, 102, 103].includes(block.status)),
    'ambiguous-include-blocks', facts);
  check(facts.status === 200, 'github-http-status', facts);
  const type = head.headers.get('content-type');
  check(type !== undefined && /^(?:application\/(?:[a-z0-9!#$&^_.+-]+\+)?json)(?:[ \t]*;|$)/i.test(type),
    'github-json-content-type', facts);
}
// Header facts are bounded and safe; raw header values and command stderr are
// never returned. The parsed JSON value remains the caller's original API data.
export function parseIncludedGitHubResponse(input, {
  maxBodyBytes = L.bodyBytes, maxSerializedBytes = L.bodyBytes,
} = {}) {
  check(Number.isSafeInteger(maxBodyBytes) && maxBodyBytes > 0 && maxBodyBytes <= L.bodyBytes &&
    Number.isSafeInteger(maxSerializedBytes) && maxSerializedBytes > 0 && maxSerializedBytes <= L.bodyBytes,
    'invalid-github-response-capacity');
  const head = responseHead(input); acceptedHead(head);
  check(head.facts.body_bytes <= maxBodyBytes, 'github-body-cap', head.facts);
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(head.bytes.subarray(head.offset))); }
  catch { throw new GitHubReadFault('malformed-github-json', head.facts); }
  const serialized = Buffer.byteLength(JSON.stringify(value));
  check(serialized <= maxSerializedBytes, 'github-serialized-cap', head.facts);
  return { value, body_bytes: head.facts.body_bytes, serialized_bytes: serialized,
    link: head.headers.get('link') ?? '', facts: freezeFacts(head.facts) };
}
function route(value, seed = false) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !/[\u0000-\u0020\u007f]/.test(value), 'invalid-github-route');
  const relative = value.startsWith(ORIGIN) ? value.slice(ORIGIN.length) : value;
  check(!seed || relative === value, 'absolute-seed-route');
  check(!relative.includes('#') && !relative.includes('%') && !relative.includes('+'), 'invalid-github-route');
  const parts = relative.split('?');
  check(parts.length === 2 && parts[1].length > 0, 'invalid-github-query');
  const [path, rawQuery] = parts, parameters = new Map();
  for (const pair of rawQuery.split('&')) {
    const equals = pair.indexOf('=');
    check(equals > 0 && pair.indexOf('=', equals + 1) === -1, 'invalid-github-query');
    const key = pair.slice(0, equals), parameter = pair.slice(equals + 1);
    check(/^[a-z_]+$/.test(key) && parameter.length > 0 && !parameters.has(key), 'duplicate-or-invalid-github-query');
    parameters.set(key, parameter);
  }
  check(parameters.get('per_page') === '100', 'invalid-github-page-size');
  const page = parameters.has('page') ? Number(parameters.get('page')) : 1;
  check(!parameters.has('page') || (/^[1-9]\d*$/.test(parameters.get('page')) && positive(page)), 'invalid-github-page');
  check(!seed || !parameters.has('page'), 'noninitial-github-page');
  const keys = [...parameters.keys()].filter(key => key !== 'page');
  const hasKeys = expected => keys.length === expected.length && expected.every(key => parameters.has(key));
  let collection = null, family = null;
  const decimal = text => /^[1-9]\d*$/.test(text) && positive(Number(text));
  let match = new RegExp('^' + PREFIX + '/actions/runs/([^/]+)/attempts/([^/]+)/jobs$').exec(path);
  if (match) {
    check(decimal(match[1]) && decimal(match[2]) && hasKeys(['per_page']), 'invalid-attempt-jobs-route');
    collection = 'jobs'; family = 'attempt-jobs';
  } else if ((match = new RegExp('^' + PREFIX + '/actions/runs/([^/]+)/artifacts$').exec(path))) {
    check(decimal(match[1]) && hasKeys(['per_page']), 'invalid-run-artifacts-route');
    collection = 'artifacts'; family = 'run-artifacts';
  } else if (path === PREFIX + '/actions/artifacts') {
    check(hasKeys(['per_page']), 'invalid-repository-artifacts-route');
    collection = 'artifacts'; family = 'repository-artifacts';
  } else if ((match = new RegExp('^' + PREFIX + '/actions/runs/([^/]+)/jobs$').exec(path))) {
    check(decimal(match[1]) && hasKeys(['filter', 'per_page']) && parameters.get('filter') === 'all', 'invalid-all-jobs-route');
    collection = 'jobs'; family = 'all-attempt-jobs';
  } else if ((match = new RegExp('^' + PREFIX + '/actions/workflows/([^/]+)/runs$').exec(path))) {
    const workflow = match[1], branch = parameters.get('branch') === 'main';
    const head = SHA.test(parameters.get('head_sha') ?? '');
    const exactHead = branch && head && hasKeys(['branch', 'head_sha', 'per_page']);
    const eventHead = branch && head && hasKeys(['branch', 'event', 'head_sha', 'per_page']);
    const catalogue = branch && hasKeys(['branch', 'per_page']);
    const numeric = ['294252465', '294257497', '364666954'].includes(workflow) &&
      eventHead && ['push', 'workflow_run'].includes(parameters.get('event'));
    const gates = ['ci.yml', 'design-acceptance.yml'].includes(workflow) && eventHead && parameters.get('event') === 'push';
    const financial = ['financial-performance-certification.yml', 'financial-source-renewal-certification.yml'].includes(workflow) && exactHead;
    const publisher = workflow === 'research-ui-release.yml' && (exactHead || catalogue);
    const staticCatalogue = workflow === 'static-site.yml' && catalogue;
    check(numeric || gates || financial || publisher || staticCatalogue, 'unapproved-workflow-route');
    collection = 'workflow_runs'; family = 'workflow-runs';
  }
  check(collection !== null, 'unapproved-github-route');
  return { requested: value, path, parameters, page, family, collection };
}
function pageLinks(raw, first, current, last) {
  const relations = new Map();
  if (raw === '') return relations;
  check(typeof raw === 'string' && raw.length <= L.headerBytes, 'malformed-github-link');
  for (const item of raw.split(',')) {
    const match = /^\s*<([^<>]+)>;\s*rel="(first|prev|next|last)"\s*$/.exec(item);
    check(match && !relations.has(match[2]), 'duplicate-or-invalid-github-link');
    check(match[1].startsWith(ORIGIN), 'foreign-github-link');
    const linked = route(match[1]);
    check(linked.path === first.path && linked.parameters.size === first.parameters.size + (first.parameters.has('page') ? 0 : 1),
      'changed-github-link-route');
    for (const [key, value] of first.parameters)
      if (key !== 'page') check(linked.parameters.get(key) === value, 'changed-github-link-query');
    check(linked.parameters.has('page'), 'missing-github-link-page');
    const expected = { first: 1, prev: current - 1, next: current + 1, last }[match[2]];
    check(linked.page === expected && !(match[2] === 'prev' && current === 1) &&
      !(match[2] === 'next' && current === last), 'contradictory-github-link-page');
    relations.set(match[2], linked);
  }
  return relations;
}
function safeUnknownOutput(value) {
  if (!(value instanceof Uint8Array) || value.byteLength > L.bodyBytes + L.headerBytes) return {};
  try { return responseHead(value).facts; }
  catch (error) { return error instanceof GitHubReadFault ? error.facts : {}; }
}
function synchronousHook(callback, facts, code) {
  try {
    const result = callback(freezeFacts(facts));
    if (result && typeof result.then === 'function') {
      Promise.resolve(result).catch(() => {});
      throw new GitHubReadFault('asynchronous-budget-hook');
    }
    check(result !== false, code);
  } catch { throw new GitHubReadFault(code); }
}
// command is required: the owner must close/verify native gh configuration,
// identity and redirects/replays. Absolute validated URLs avoid api_host
// rewriting; fixed github.com selects the existing public credential context.
// One invocation returns all original parsed pages or throws; no accepted prefix.
export function readBoundedGitHubPages(endpoint, {
  command, monotonic = () => performance.now(), budget, timeoutMs = L.deadlineMs,
} = {}) {
  check(typeof command === 'function' && typeof monotonic === 'function' &&
    object(budget) && typeof budget.beforeRequest === 'function' && typeof budget.afterRequest === 'function',
    'invalid-github-reader-dependencies');
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= L.deadlineMs, 'invalid-github-reader-deadline');
  const seed = route(endpoint, true), first = { ...seed, requested: ORIGIN + endpoint }, pages = [], seen = new Set();
  let previousClock = -1, total = null, bodyBytes = 2, serializedBytes = 2, current = first;
  const now = () => {
    const value = monotonic();
    check(Number.isFinite(value) && value >= 0 && value >= previousClock, 'invalid-github-monotonic-clock');
    previousClock = value; return value;
  };
  const started = now(), deadline = started + timeoutMs;
  const checkpoint = () => { check(now() < deadline, 'github-reader-deadline'); };
  while (true) {
    checkpoint(); check(pages.length < L.pages, 'github-page-cap');
    const separator = pages.length ? 1 : 0;
    const remainingBody = L.bodyBytes - bodyBytes - separator;
    const remainingSerialized = L.bodyBytes - serializedBytes - separator;
    check(remainingBody > 0 && remainingSerialized > 0, 'github-aggregate-body-cap');
    synchronousHook(budget.beforeRequest, {
      endpoint: current.requested, family: first.family, page: current.page,
      started_ms: now(), deadline_ms: deadline, requested_gh_hostname: 'github.com',
      max_body_bytes: remainingBody, max_stdout_bytes: remainingBody + L.headerBytes,
    }, 'github-budget-before-request');
    checkpoint();
    const requestStarted = now(), remaining = Math.floor(deadline - requestStarted);
    check(remaining > 0, 'github-reader-deadline');
    const facts = { endpoint: current.requested, family: first.family, page: current.page,
      started_ms: requestStarted, status: null, command_started: true, command_failed: false,
      requested_gh_hostname: 'github.com', wire_request_count: null,
      stdout_bytes: null, header_bytes: null, body_bytes: null, visible_statuses: [], header_blocks: [],
      quota: null, retry_after_present: null, retry_after_seconds: null };
    let parsed, links, last, fault = null;
    facts.page_validated = false; facts.error_code = null;
    try {
      const output = command(['api', current.requested, '--hostname', 'github.com', '--include', '--method', 'GET'], {
        timeoutMs: Math.min(L.commandMs, remaining), maxBuffer: remainingBody + L.headerBytes,
      });
      if (output && typeof output.then === 'function') {
        Promise.resolve(output).catch(() => {}); throw new GitHubReadFault('asynchronous-gh-command');
      }
      parsed = parseIncludedGitHubResponse(output, { maxBodyBytes: remainingBody, maxSerializedBytes: remainingSerialized });
      Object.assign(facts, parsed.facts);
      const value = parsed.value;
      check(object(value) && Number.isSafeInteger(value.total_count) && value.total_count >= 0 &&
        Array.isArray(value[first.collection]), 'invalid-github-page-schema', facts);
      check(total === null || total === value.total_count, 'changing-github-total', facts);
      total = value.total_count; last = Math.max(1, Math.ceil(total / L.perPage));
      check(last <= L.pages, 'github-page-cap', facts);
      const rows = value[first.collection];
      check(current.page <= last && rows.length === (current.page < last ? L.perPage : total - (current.page - 1) * L.perPage),
        'partial-github-page', facts);
      for (const row of rows) {
        check(object(row) && positive(row.id) && !seen.has(row.id), 'duplicate-or-invalid-github-id', facts);
        seen.add(row.id);
      }
      links = pageLinks(parsed.link, first, current.page, last);
      check(current.page < last ? links.has('next') : !links.has('next'), 'missing-or-extra-github-next-link', facts);
      bodyBytes += parsed.body_bytes + (pages.length ? 1 : 0);
      serializedBytes += parsed.serialized_bytes + (pages.length ? 1 : 0);
      check(bodyBytes <= L.bodyBytes && serializedBytes <= L.bodyBytes, 'github-aggregate-body-cap', facts);
      facts.page_validated = true;
    } catch (error) {
      if (error instanceof GitHubReadFault) {
        Object.assign(facts, error.facts); fault = error;
      } else {
        Object.assign(facts, safeUnknownOutput(error?.stdout));
        facts.command_failed = true; fault = new GitHubReadFault('github-command-failed');
      }
    }
    try {
      facts.ended_ms = now(); facts.elapsed_ms = facts.ended_ms - requestStarted;
      check(facts.ended_ms < deadline, 'github-reader-deadline');
    } catch (error) {
      if (!fault) fault = error instanceof GitHubReadFault ? error : new GitHubReadFault('invalid-github-monotonic-clock');
      if (facts.ended_ms === undefined) { facts.ended_ms = null; facts.elapsed_ms = null; }
    }
    facts.error_code = fault?.code ?? null;
    try { synchronousHook(budget.afterRequest, facts, 'github-budget-after-request'); }
    catch (error) { if (!fault) fault = error; }
    if (fault) { facts.error_code = fault.code; throw new GitHubReadFault(fault.code, facts); }
    checkpoint(); pages.push(parsed.value);
    if (!links.has('next')) {
      check(pages.length === last && seen.size === total, 'incomplete-github-inventory', facts);
      return pages;
    }
    current = links.get('next');
  }
}
