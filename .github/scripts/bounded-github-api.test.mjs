// Synthetic command output only. No credentials, gh process or network is used.
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOUNDED_GITHUB_API_LIMITS as LIMITS, parseIncludedGitHubResponse,
  readBoundedGitHubPages } from './bounded-github-api.mjs';

const PREFIX = 'repos/kusennjp1-ai/screener', ORIGIN = 'https://api.github.com/';
const jobs = PREFIX + '/actions/runs/11/attempts/1/jobs?per_page=100';
const allJobs = PREFIX + '/actions/runs/11/jobs?filter=all&per_page=100';
const rows = (count, start = 1) => Array.from({ length: count }, (_unused, index) => ({ id: start + index }));
const page = (total, members, collection = 'jobs', extra = {}) => ({ total_count: total, [collection]: members, ...extra });
function include(value, { status = 200, headers = [], blocks = [], body, type = 'application/json; charset=utf-8' } = {}) {
  const block = (code, extra) => 'HTTP/2.0 ' + code + (code === 200 ? ' OK' : ' Synthetic') + '\n' +
    ['X-RateLimit-Limit: 15000', 'X-RateLimit-Remaining: 14000', 'X-RateLimit-Used: 1000',
      'X-RateLimit-Reset: 1791514800', 'X-RateLimit-Resource: core', ...extra].join('\r\n') + '\r\n\r\n';
  const before = blocks.map(item => block(item.status, item.headers ?? [])).join('');
  return Buffer.from(before + block(status, [ ...(type === null ? [] : ['Content-Type: ' + type]), ...headers ]) +
    (body ?? JSON.stringify(value)));
}
const next = (endpoint, ordinal) => '<' + ORIGIN + endpoint + '&page=' + ordinal + '>; rel="next"';

test('observed publisher catalogue Links preserve filenames under the fixed numeric repository alias', () => {
  for (const file of ['research-ui-release.yml', 'static-site.yml']) {
    const endpoint = PREFIX + '/actions/workflows/' + file + '/runs?branch=main&per_page=100';
    const link = ORIGIN + 'repositories/1203919607/actions/workflows/' + file + '/runs?branch=main&per_page=100&page=2';
    const first = page(101, rows(100), 'workflow_runs'), second = page(101, rows(1, 101), 'workflow_runs');
    const h = harness((_url, count) => count === 1 ? include(first, { headers: ['Link: <' + link + '>; rel="next", <' + link + '>; rel="last"'] }) : include(second));
    assert.deepEqual(readBoundedGitHubPages(endpoint, h.options), [first, second]);
    assert.equal(h.calls[1].args[1], link);
    assert.equal(h.after.every(value => value.page_validated), true);
  }
});

test('numeric repository Link aliases cannot change repository, workflow, filters, or authorize seeds', () => {
  const endpoint = PREFIX + '/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100';
  const alias = ORIGIN + 'repositories/1203919607/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100&page=2';
  const invalid = [
    alias.replace('1203919607', '1203919608'),
    alias.replace('1203919607', '01203919607'),
    alias.replace('research-ui-release.yml', 'static-site.yml'),
    alias.replace('research-ui-release.yml', '364666954'),
    alias.replace('research-ui-release.yml', 'unknown.yml'),
    alias.replace('branch=main', 'branch=develop'),
    alias.replace('per_page=100', 'per_page=10'),
    alias + '&event=push', alias + '&head_sha=' + 'a'.repeat(40),
    alias.replace('api.github.com/', 'api.github.com:443/'),
  ];
  for (const link of invalid) {
    const h = harness(() => include(page(101, rows(100), 'workflow_runs'), { headers: ['Link: <' + link + '>; rel="next"'] }));
    fault(() => readBoundedGitHubPages(endpoint, h.options));
    assert.equal(h.calls.length, 1);
  }
  const seed = 'repositories/1203919607/actions/workflows/research-ui-release.yml/runs?branch=main&per_page=100';
  const h = harness(() => { throw Error('Must not issue'); });
  fault(() => readBoundedGitHubPages(seed, h.options));
  assert.equal(h.calls.length, 0);
});
function harness(handler) {
  let clock = 0;
  const calls = [], before = [], after = [], sequence = [];
  return {
    calls, before, after, sequence,
    options: {
      monotonic: () => clock,
      command: (args, options) => {
        calls.push({ args, options }); sequence.push('command' + calls.length);
        assert.equal(args[0], 'api'); assert.equal(args[2], '--hostname'); assert.equal(args[3], 'github.com');
        assert.deepEqual(args.slice(4), ['--include', '--method', 'GET']);
        assert.equal(args[1].startsWith(ORIGIN), true);
        assert.equal(options.timeoutMs > 0 && options.timeoutMs <= LIMITS.commandMs, true);
        assert.equal(options.maxBuffer > LIMITS.headerBytes && options.maxBuffer <= LIMITS.bodyBytes + LIMITS.headerBytes, true);
        return handler(args[1], calls.length);
      },
      budget: {
        beforeRequest: facts => { before.push(facts); sequence.push('before' + before.length); },
        afterRequest: facts => { after.push(facts); sequence.push('after' + after.length); },
      },
    },
    advance(ms) { clock += ms; },
  };
}
function fault(work, code) {
  let result;
  assert.throws(() => { result = work(); }, error => {
    if (code) assert.equal(error.code, code);
    assert.equal(error.name, 'GitHubReadFault');
    return true;
  });
  assert.equal(result, undefined);
}

test('raw parsed page values and API shape survive with literal query order and safe bounded facts', () => {
  const endpoint = PREFIX + '/actions/workflows/ci.yml/runs?per_page=100&head_sha=' + 'a'.repeat(40) + '&event=push&branch=main';
  const raw = '{"total_count":1,"workflow_runs":[{"id":1,"steps":null,"clock":"literal","n":-0}],"extra":[true,null]}';
  const h = harness(() => include(null, { body: raw, headers: ['X-Ignored-Secret: synthetic-private-header'] }));
  const result = readBoundedGitHubPages(endpoint, h.options);
  assert.deepEqual(result, [JSON.parse(raw)]); assert.equal(Object.is(result[0].workflow_runs[0].n, -0), true);
  assert.deepEqual(h.calls[0].args, ['api', ORIGIN + endpoint, '--hostname', 'github.com', '--include', '--method', 'GET']);
  assert.deepEqual(h.sequence, ['before1', 'command1', 'after1']);
  assert.equal(h.after[0].status, 200); assert.equal(h.after[0].page_validated, true);
  assert.equal(h.after[0].wire_request_count, null); assert.deepEqual(h.after[0].visible_statuses, [200]);
  assert.equal(h.after[0].quota.remaining, 14000); assert.equal(h.after[0].quota.complete, true);
  assert.equal(Object.isFrozen(h.after[0].header_blocks), true);
  assert.doesNotMatch(JSON.stringify(h.after), /synthetic-private-header|literal|steps/);
});

test('only the audited closed route/profile combinations are admitted', () => {
  const head = 'a'.repeat(40), profiles = [
    [jobs, 'jobs'], [allJobs, 'jobs'],
    [PREFIX + '/actions/runs/11/artifacts?per_page=100', 'artifacts'],
    [PREFIX + '/actions/artifacts?per_page=100', 'artifacts'],
    ...['294252465', '294257497', '364666954'].flatMap(id => ['push', 'workflow_run'].map(event =>
      [PREFIX + '/actions/workflows/' + id + '/runs?branch=main&event=' + event + '&head_sha=' + head + '&per_page=100', 'workflow_runs'])),
    ...['ci.yml', 'design-acceptance.yml'].map(file =>
      [PREFIX + '/actions/workflows/' + file + '/runs?branch=main&event=push&head_sha=' + head + '&per_page=100', 'workflow_runs']),
    ...['financial-performance-certification.yml', 'financial-source-renewal-certification.yml', 'research-ui-release.yml'].map(file =>
      [PREFIX + '/actions/workflows/' + file + '/runs?branch=main&head_sha=' + head + '&per_page=100', 'workflow_runs']),
    ...['research-ui-release.yml', 'static-site.yml'].map(file =>
      [PREFIX + '/actions/workflows/' + file + '/runs?branch=main&per_page=100', 'workflow_runs']),
  ];
  for (const [endpoint, collection] of profiles) {
    const h = harness(() => include(page(0, [], collection)));
    assert.deepEqual(readBoundedGitHubPages(endpoint, h.options), [page(0, [], collection)]);
    assert.equal(h.calls.length, 1);
  }
  assert.equal(profiles.length, 17);
});

test('invalid seeds fail before the command or budget can be issued', () => {
  const invalid = [
    ORIGIN + jobs, jobs.replace('kusennjp1-ai', 'foreign'), jobs.replace('/11/', '/0/'),
    jobs.replace('/attempts/1/', '/attempts/01/'), jobs.replace('100', '10'), jobs + '&page=2',
    jobs + '&page=1', jobs + '&page=1&page=1', jobs + '&token=synthetic-private', jobs.replace('per_page', '%70er_page'),
    allJobs.replace('filter=all', 'filter=latest'), PREFIX + '/actions/runs/11',
    PREFIX + '/actions/workflows/unknown.yml/runs?branch=main&per_page=100',
    PREFIX + '/actions/workflows/ci.yml/runs?branch=main&per_page=100',
    PREFIX + '/actions/workflows/static-site.yml/runs?branch=main&event=push&head_sha=' + 'a'.repeat(40) + '&per_page=100',
    PREFIX + '/actions/workflows/294252465/runs?branch=main&event=workflow_dispatch&head_sha=' + 'a'.repeat(40) + '&per_page=100',
    PREFIX + '/actions/workflows/ci.yml/runs?branch=dev&event=push&head_sha=' + 'a'.repeat(40) + '&per_page=100',
  ];
  for (const endpoint of invalid) {
    const h = harness(() => { throw Error('Must not issue'); });
    fault(() => readBoundedGitHubPages(endpoint, h.options));
    assert.equal(h.calls.length, 0); assert.equal(h.before.length, 0); assert.equal(h.after.length, 0);
  }
});

test('validated raw next Links may reorder identical pairs without request sorting or body rewriting', () => {
  const rawNext = ORIGIN + PREFIX + '/actions/runs/11/jobs?per_page=100&page=2&filter=all';
  const first = page(101, rows(100)), second = page(101, [{ id: 101, steps: null, conclusion: 'cancelled' }]);
  const h = harness((_url, count) => count === 1 ? include(first, { headers: ['Link: <' + rawNext + '>; rel="next"'] }) : include(second));
  assert.deepEqual(readBoundedGitHubPages(allJobs, h.options), [first, second]);
  assert.equal(h.calls[0].args[1], ORIGIN + allJobs); assert.equal(h.calls[1].args[1], rawNext);
  assert.deepEqual(h.sequence, ['before1', 'command1', 'after1', 'before2', 'command2', 'after2']);
  assert.deepEqual(h.before.map(value => value.page), [1, 2]);
});

test('foreign/drifting/duplicate/skipped/backward/unknown Link relations are terminal before another command', () => {
  const base = ORIGIN + allJobs + '&page=2';
  const invalid = [
    '<http://api.github.com/' + allJobs + '&page=2>; rel="next"',
    '<' + base.replace('api.github.com', 'evil.invalid') + '>; rel="next"',
    '<' + base.replace('api.github.com', 'api.github.com:443') + '>; rel="next"',
    '<' + base.replace('/11/', '/12/') + '>; rel="next"',
    '<' + base.replace('filter=all', 'filter=latest') + '>; rel="next"',
    '<' + base + '&page=2>; rel="next"', '<' + base + '&unknown=1>; rel="next"',
    '<' + base.replace('page=2', 'page=3') + '>; rel="next"',
    '<' + base.replace('page=2', 'page=1') + '>; rel="next"',
    '<' + base + '#fragment>; rel="next"', '<' + base + '>; rel="alternate"',
    '<' + base + '>; rel="next", <' + base + '>; rel="next"',
    '<' + ORIGIN + allJobs + '>; rel="next"', '',
  ];
  for (const link of invalid) {
    const h = harness(() => include(page(101, rows(100)), { headers: link ? ['Link: ' + link] : [] }));
    fault(() => readBoundedGitHubPages(allJobs, h.options));
    assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1); assert.equal(h.after[0].page_validated, false);
  }
});

test('changing totals, truncated pages and duplicate member IDs never return an accepted prefix', () => {
  for (const mode of ['total', 'duplicate', 'truncated']) {
    const h = harness((_url, count) => {
      if (count === 1) return include(page(101, rows(mode === 'truncated' ? 99 : 100)), { headers: ['Link: ' + next(jobs, 2)] });
      return include(mode === 'total' ? page(102, rows(2, 101)) : page(101, [{ id: 1 }]));
    });
    fault(() => readBoundedGitHubPages(jobs, h.options), mode === 'total' ? 'changing-github-total' :
      mode === 'duplicate' ? 'duplicate-or-invalid-github-id' : 'partial-github-page');
    assert.equal(h.calls.length, mode === 'truncated' ? 1 : 2);
    assert.equal(h.after.at(-1).page_validated, false);
  }
});

test('nonzero command exit retains observed HTTP status but stays terminal and native errors stay private', () => {
  const hidden = 'synthetic-private-native-stderr-and-token';
  const error = Object.assign(new Error(hidden), { stderr: Buffer.from(hidden),
    stdout: include(page(1, [{ id: 1, name: hidden }])) });
  const h = harness(() => { throw error; });
  let caught;
  try { readBoundedGitHubPages(jobs, h.options); } catch (value) { caught = value; }
  assert.equal(caught.code, 'github-command-failed'); assert.equal(h.calls.length, 1);
  assert.equal(h.after[0].status, 200); assert.equal(h.after[0].command_failed, true);
  assert.deepEqual(h.after[0].visible_statuses, [200]);
  assert.doesNotMatch(JSON.stringify(caught.facts) + caught.message + JSON.stringify(h.after), new RegExp(hidden));
  assert.equal(Object.hasOwn(caught, 'cause'), false); assert.equal(Object.hasOwn(caught, 'stderr'), false);
  for (const status of [403, 429]) {
    const denial = harness(() => { throw Object.assign(new Error(hidden), { stdout: include({}, { status }), stderr: Buffer.from(hidden) }); });
    fault(() => readBoundedGitHubPages(jobs, denial.options), 'github-command-failed');
    assert.equal(denial.after[0].status, status); assert.equal(denial.after[0].command_failed, true);
    assert.equal(denial.calls.length, 1); assert.equal(denial.after[0].page_validated, false);
  }
  const unknown = harness(() => { throw Object.assign(new Error(hidden), { stdout: Buffer.from('{}') }); });
  fault(() => readBoundedGitHubPages(jobs, unknown.options), 'github-command-failed');
  assert.equal(unknown.after[0].status, null); assert.deepEqual(unknown.after[0].visible_statuses, []);

});

test('safe include parsing accounts informational blocks without claiming hidden wire exchanges', () => {
  const bytes = include(page(0, []), { blocks: [{ status: 100 }, { status: 103 }] });
  const parsed = parseIncludedGitHubResponse(bytes);
  assert.deepEqual(parsed.value, page(0, [])); assert.deepEqual(parsed.facts.visible_statuses, [100, 103, 200]);
  assert.equal(parsed.body_bytes, Buffer.byteLength(JSON.stringify(page(0, []))));
  const h = harness(() => bytes); assert.equal(readBoundedGitHubPages(jobs, h.options).length, 1);
  assert.equal(h.after[0].wire_request_count, null);
});

test('a later successful header block cannot hide visible denial, Retry-After, redirect or ambiguous replay', () => {
  const variants = [
    [{ status: 403 }, 'github-denial'], [{ status: 429 }, 'github-denial'],
    [{ status: 100, headers: ['Retry-After: 0'] }, 'github-retry-after'],
    [{ status: 100, headers: ['Retry-After: 15'] }, 'github-retry-after'],
    [{ status: 100, headers: ['Retry-After: Fri, 09 Oct 2026 11:00:00 GMT'] }, 'github-retry-after'],
    [{ status: 301, headers: ['Location: https://evil.invalid/private'] }, 'github-redirect'],
    [{ status: 421 }, 'ambiguous-include-blocks'], [{ status: 200 }, 'ambiguous-include-blocks'],
  ];
  for (const [block, code] of variants) {
    const h = harness(() => include(page(0, []), { blocks: [block] }));
    fault(() => readBoundedGitHubPages(jobs, h.options), code);
    assert.equal(h.calls.length, 1); assert.deepEqual(h.after[0].visible_statuses, [block.status, 200]);
    assert.equal(h.after[0].page_validated, false);
    assert.doesNotMatch(JSON.stringify(h.after), /evil\.invalid|private/);
  }
  for (const retry of ['0', '15', 'Fri, 09 Oct 2026 11:00:00 GMT']) {
    const h = harness(() => include(page(0, []), { headers: ['Retry-After: ' + retry] }));
    fault(() => readBoundedGitHubPages(jobs, h.options), 'github-retry-after'); assert.equal(h.calls.length, 1);
  }
});

test('malformed headers/quota/body/status/UTF-8 and valid-but-incomplete schema are terminal', () => {
  const valid = include(page(0, []));
  const inputs = [
    Buffer.from('{}'), Buffer.from(valid.toString().replace('HTTP/2.0 200 OK', 'ambiguous status')),
    Buffer.from(valid.toString().replace('Content-Type:', ' folded:')),
    include(page(0, []), { headers: ['X-RateLimit-Remaining: 1'] }),
    include(page(0, []), { headers: ['Link: value', 'Link: second'] }),
    include(page(0, []), { headers: ['Retry-After: 1', 'Retry-After: 2'] }),
    include(page(0, []), { status: 500 }), include(page(0, []), { status: 204 }),
    include(page(0, []), { type: 'text/html' }), include(page(0, []), { type: null }),
    include(null, { body: 'not-json' }), include(null, { body: '{}{}' }), include(null, { body: '' }),
    Buffer.concat([include(null, { body: '' }), Buffer.from([255])]),
    include([]), include({ total_count: 0 }), include({ total_count: 1, jobs: [] }),
    include({ total_count: 1, jobs: [{ id: 0 }] }),
    include({ total_count: 1, jobs: [{ id: '1' }] }),
  ];
  for (const input of inputs) {
    const h = harness(() => input); fault(() => readBoundedGitHubPages(jobs, h.options));
    assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1); assert.equal(h.after[0].page_validated, false);
  }
});

test('header/status block caps and declared dependency contracts stop terminally', () => {
  const headerOverflow = include(page(0, []), { headers: ['X-Large: ' + 'x'.repeat(LIMITS.headerBytes)] });
  const blocksOverflow = include(page(0, []), { blocks: Array.from({ length: LIMITS.statusBlocks }, () => ({ status: 100 })) });
  for (const input of [headerOverflow, blocksOverflow, 'not-binary-output']) {
    const h = harness(() => input); fault(() => readBoundedGitHubPages(jobs, h.options));
    assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1);
  }
  fault(() => readBoundedGitHubPages(jobs), 'invalid-github-reader-dependencies');
  const h = harness(() => include(page(0, [])));
  for (const timeoutMs of [0, -1, 120001, 0.5, Infinity])
    fault(() => readBoundedGitHubPages(jobs, { ...h.options, timeoutMs }), 'invalid-github-reader-deadline');
  assert.equal(h.calls.length, 0);
});

test('transport accepts11 and100 complete pages while narrower consumers retain their own rejection', () => {
  for (const count of [11, 100]) {
    const total = count * 100;
    const h = harness((_url, ordinal) => include(page(total, rows(100, (ordinal - 1) * 100 + 1)), {
      headers: ordinal < count ? ['Link: ' + next(jobs, ordinal + 1)] : [],
    }));
    const pages = readBoundedGitHubPages(jobs, h.options);
    assert.equal(pages.length, count); assert.equal(h.calls.length, count); assert.equal(h.after.length, count);
    const existingTenPageConsumer = values => { if (values.length > 10) throw Error('existing narrower page guard'); };
    assert.throws(() => existingTenPageConsumer(pages), /existing narrower page guard/);
  }
});

test('the new100-page ceiling rejects an unfinishable declared inventory before another command', () => {
  const h = harness((_url, ordinal) => include(page(10001, rows(100, (ordinal - 1) * 100 + 1)), {
    headers: ['Link: ' + next(jobs, ordinal + 1)],
  }));
  fault(() => readBoundedGitHubPages(jobs, h.options), 'github-page-cap');
  assert.equal(h.calls.length, 1); assert.equal(h.before.length, 1); assert.equal(h.after.length, 1);
});

test('budget hooks can deny before each command or after its safe facts with no retry', () => {
  const first = page(101, rows(100));
  for (const mode of ['before-first', 'before-second', 'after-first', 'false-before']) {
    const h = harness(() => include(first, { headers: ['Link: ' + next(jobs, 2)] }));
    h.options.budget.beforeRequest = facts => {
      h.before.push(facts);
      if (mode === 'false-before') return false;
      if (mode === 'before-first' || (mode === 'before-second' && h.calls.length === 1)) throw Error('synthetic private denial');
    };
    h.options.budget.afterRequest = facts => { h.after.push(facts); if (mode === 'after-first') throw Error('synthetic private denial'); };
    fault(() => readBoundedGitHubPages(jobs, h.options), mode === 'after-first' ? 'github-budget-after-request' : 'github-budget-before-request');
    assert.equal(h.calls.length, ['before-first', 'false-before'].includes(mode) ? 0 : 1);
    assert.equal(h.after.length, h.calls.length);
  }
});

test('finite invocation deadlines are checked after budget work and issued commands', () => {
  let h = harness(() => { h.advance(251); return include(page(0, [])); });
  fault(() => readBoundedGitHubPages(jobs, { ...h.options, timeoutMs: 250 }), 'github-reader-deadline');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.timeoutMs, 250); assert.equal(h.after.length, 1);
  assert.equal(h.after[0].error_code, 'github-reader-deadline');
  h = harness(() => include(page(0, [])));
  h.options.budget.beforeRequest = facts => { h.before.push(facts); h.advance(250); };
  fault(() => readBoundedGitHubPages(jobs, { ...h.options, timeoutMs: 250 }), 'github-reader-deadline');
  assert.equal(h.calls.length, 0); assert.equal(h.after.length, 1);
  for (const value of [NaN, Infinity, -1]) {
    const invalid = harness(() => include(page(0, [])));
    fault(() => readBoundedGitHubPages(jobs, { ...invalid.options, monotonic: () => value }), 'invalid-github-monotonic-clock');
    assert.equal(invalid.calls.length, 0);
  }
});

test('synchronous callback contracts reject async command/budget implementations without unhandled rejection', async () => {
  for (const target of ['command', 'before', 'after']) {
    const h = harness(() => include(page(0, [])));
    const rejected = () => Promise.reject(Error('synthetic private async failure'));
    if (target === 'command') h.options.command = rejected;
    else if (target === 'before') h.options.budget.beforeRequest = rejected;
    else h.options.budget.afterRequest = rejected;
    fault(() => readBoundedGitHubPages(jobs, h.options),
      target === 'command' ? 'asynchronous-gh-command' : target === 'before' ? 'github-budget-before-request' : 'github-budget-after-request');
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('a body larger than8MiB remains admitted below the original64MiB aggregate bound', () => {
  const expected = page(1, [{ id: 1 }], 'jobs', { padding: 'x'.repeat(9 * 1024 * 1024) });
  const h = harness(() => include(expected));
  const result = readBoundedGitHubPages(jobs, h.options);
  assert.equal(result[0].padding.length, 9 * 1024 * 1024);
  assert.equal(h.after[0].body_bytes > 8 * 1024 * 1024, true);
  assert.equal(h.after[0].body_bytes < LIMITS.bodyBytes, true);
});

test('raw body plus array-wrapper accounting remains within the original64MiB acceptance', () => {
  const raw = JSON.stringify(page(0, []));
  const body = raw + ' '.repeat(LIMITS.bodyBytes - Buffer.byteLength(raw) - 1);
  const h = harness(() => include(null, { body }));
  fault(() => readBoundedGitHubPages(jobs, h.options), 'github-body-cap');
  assert.equal(h.calls.length, 1); assert.equal(h.after[0].body_bytes, LIMITS.bodyBytes - 1);
});


test('raw bodies across pages share the64MiB bound and cannot escape as a partial array', () => {
  const h = harness((_url, ordinal) => {
    const value = ordinal === 1 ? page(101, rows(100)) : page(101, [{ id: 101 }]);
    const raw = JSON.stringify(value), size = ordinal === 1 ? 20 * 1024 * 1024 : 44 * 1024 * 1024;
    const body = raw + ' '.repeat(size - Buffer.byteLength(raw));
    return include(null, { body, headers: ordinal === 1 ? ['Link: ' + next(jobs, 2)] : [] });
  });
  fault(() => readBoundedGitHubPages(jobs, h.options), 'github-body-cap');
  assert.equal(h.calls.length, 2); assert.equal(h.after.length, 2); assert.equal(h.after[1].page_validated, false);
});


test('remaining aggregate capacity reduces the second command and rejects its oversized body beforeJSON.parse', () => {
  const first = JSON.stringify(page(101, rows(100))), firstSize = LIMITS.bodyBytes - 1024;
  const h = harness((_url, ordinal) => ordinal === 1 ? include(null, {
    body: first + ' '.repeat(firstSize - Buffer.byteLength(first)), headers: ['Link: ' + next(jobs, 2)],
  }) : include(null, { body: '{' + 'x'.repeat(2048) }));
  // The second body is deliberately invalid JSON. Size rejection must precede
  // any parse attempt, so the observed error is body-cap rather than malformed.
  fault(() => readBoundedGitHubPages(jobs, h.options), 'github-body-cap');
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].options.maxBuffer, LIMITS.bodyBytes - 2 + LIMITS.headerBytes);
  assert.equal(h.calls[1].options.maxBuffer, 1021 + LIMITS.headerBytes);
  assert.equal(h.calls[1].options.maxBuffer < h.calls[0].options.maxBuffer, true);
  assert.equal(h.after[1].page_validated, false); assert.equal(h.after[1].error_code, 'github-body-cap');
});

// Own-caller transport fixtures remain synthetic and grant no identity proof.
const { readBoundedRequiredCaller } = await import('./bounded-github-api.mjs');
const CALLER_SCOPE = Object.freeze({
  repository: 'kusennjp1-ai/screener', repository_id: 1203919607,
  run_id: 11, run_attempt: 2, controller_sha: 'b'.repeat(40),
});
const CALLER_ROUTE = PREFIX + '/actions/runs/11';
const CALLER_ATTEMPT_ROUTE = CALLER_ROUTE + '/attempts/2';
const CALLER_EPOCH = 1791514800000;
function callerHarness(handler, changes = {}) {
  const h = harness(handler);
  Object.assign(h.options, { scope: { ...CALLER_SCOPE }, wallClock: () => CALLER_EPOCH, ...changes });
  return h;
}
function callerInclude(value, quotaChanges = {}, options = {}) {
  let raw = include(value, options).toString();
  for (const [name, value] of Object.entries(quotaChanges)) {
    const title = name === 'resource' ? 'Resource' : name[0].toUpperCase() + name.slice(1);
    const pattern = new RegExp('^X-RateLimit-' + title + ':[^\\r\\n]*\\r?\\n', 'm');
    assert.equal(pattern.test(raw), true);
    raw = raw.replace(pattern, value === null ? '' : 'X-RateLimit-' + title + ': ' + value + '\r\n');
  }
  return Buffer.from(raw);
}

test('own-run and own-attempt reads preserve exact parsed JSON and copied safe start identity', () => {
  const raw = '{"id":99,"run_attempt":7,"head_sha":"literal-consumer-must-check","jobs":[{"n":-0,"steps":null}],"extra":[true,null]}\n';
  for (const [endpoint, kind] of [[CALLER_ROUTE, 'current-run'], [CALLER_ATTEMPT_ROUTE, 'run-attempt']]) {
    const h = callerHarness(() => include(null, { body: raw, headers: ['X-Ignored-Secret: synthetic-private-header'] }));
    const privateReceipt = { toJSON() { throw Error('Private receipt must never serialize'); } };
    const originalBefore = h.options.budget.beforeRequest, originalAfter = h.options.budget.afterRequest;
    h.options.budget.beforeRequest = (facts, ...extra) => {
      assert.equal(extra.length, 0); originalBefore(facts); h.advance(7); return privateReceipt;
    };
    h.options.budget.afterRequest = (facts, sameReceipt) => {
      assert.equal(sameReceipt, privateReceipt); originalAfter(facts);
    };
    const result = readBoundedRequiredCaller(endpoint, h.options);
    // Returned identities are deliberately different from scope. This transport
    // supplies original API data; the existing consumer must reject wrong IDs.
    assert.deepEqual(result, JSON.parse(raw)); assert.equal(Object.is(result.jobs[0].n, -0), true);
    assert.deepEqual(h.calls[0].args, ['api', ORIGIN + endpoint, '--hostname', 'github.com', '--include', '--method', 'GET']);
    assert.equal(h.calls[0].options.maxBuffer, LIMITS.bodyBytes + LIMITS.headerBytes);
    assert.deepEqual(h.sequence, ['before1', 'command1', 'after1']);
    assert.equal(h.before[0].endpoint, ORIGIN + endpoint); assert.equal(h.after[0].route_kind, kind);
    for (const key of ['endpoint', 'family', 'route_kind', 'scope', 'started_ms', 'started_epoch_ms', 'deadline_ms'])
      assert.deepEqual(h.after[0][key], h.before[0][key]);
    assert.equal(Object.isFrozen(h.before[0].scope), true); assert.equal(Object.isFrozen(h.after[0].header_blocks), true);
    assert.equal(h.after[0].command_started, true); assert.equal(h.after[0].command_started_ms, 7);
    assert.equal(h.after[0].elapsed_ms, 7); assert.equal(h.after[0].ended_epoch_ms, CALLER_EPOCH);
    assert.equal(h.after[0].status, 200); assert.equal(h.after[0].response_validated, true);
    assert.equal(h.after[0].native_request_issued, null); assert.equal(h.after[0].wire_request_count, null);
    assert.equal(h.after[0].quota.complete, true); assert.equal(Object.isFrozen(privateReceipt), false);
    assert.doesNotMatch(JSON.stringify(h.after), /synthetic-private-header|literal-consumer|jobs|steps/);
  }
});

test('required-caller routes and exact public scope reject foreign/query/attempt/controller drift before hooks', () => {
  for (const endpoint of [ORIGIN + CALLER_ROUTE, CALLER_ROUTE + '?page=1', CALLER_ROUTE + '?per_page=100',
    CALLER_ROUTE + '/', CALLER_ROUTE + '#fragment', CALLER_ROUTE.replace('/11', '/12'),
    CALLER_ROUTE.replace('/11', '/011'), CALLER_ATTEMPT_ROUTE.replace('/2', '/1'),
    CALLER_ATTEMPT_ROUTE + '/jobs?per_page=100', CALLER_ROUTE.replace('kusennjp1-ai', 'foreign')]) {
    const h = callerHarness(() => { throw Error('Unapproved own route must not issue'); });
    fault(() => readBoundedRequiredCaller(endpoint, h.options), 'unapproved-required-caller-route');
    assert.equal(h.calls.length, 0); assert.equal(h.before.length, 0); assert.equal(h.after.length, 0);
  }
  const invalidScopes = [
    null, [], {}, { ...CALLER_SCOPE, repository: 'foreign/repository' }, { ...CALLER_SCOPE, repository_id: 1 },
    { ...CALLER_SCOPE, run_id: 0 }, { ...CALLER_SCOPE, run_id: '11' }, { ...CALLER_SCOPE, run_attempt: 0 },
    { ...CALLER_SCOPE, run_attempt: 1.5 }, { ...CALLER_SCOPE, controller_sha: 'B'.repeat(40) },
    { ...CALLER_SCOPE, controller_sha: 'b'.repeat(39) }, { ...CALLER_SCOPE, controller_sha: BigInt('1'.repeat(40)) },
    { ...CALLER_SCOPE, controller_sha: { toString: () => 'b'.repeat(40) } },
    { ...CALLER_SCOPE, controller_sha: new String('b'.repeat(40)) }, { ...CALLER_SCOPE, token: 'synthetic-private-token' },
  ];
  for (const scope of invalidScopes) {
    const h = callerHarness(() => { throw Error('Bad own scope must not issue'); }, { scope });
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), 'invalid-required-caller-scope');
    assert.equal(h.calls.length, 0); assert.equal(h.before.length, 0); assert.equal(h.after.length, 0);
  }
});

test('required own reads require a complete unambiguous core quota tuple with exact arithmetic', () => {
  const variants = [
    ...['limit', 'remaining', 'used', 'reset', 'resource'].map(key => [{ [key]: null }, 'invalid-required-caller-quota']),
    [{ remaining: 13999 }, 'invalid-required-caller-quota'], [{ used: 1001 }, 'invalid-required-caller-quota'],
    [{ limit: 0, remaining: 0, used: 0 }, 'invalid-required-caller-quota'],
    [{ reset: 0 }, 'invalid-required-caller-quota'], [{ remaining: -1 }, 'invalid-quota-header'],
    [{ reset: '1.5' }, 'invalid-quota-header'], [{ remaining: 15001 }, 'contradictory-quota-header'],
    [{ resource: 'graphql' }, 'unexpected-quota-resource'],
  ];
  for (const [changes, code] of variants) {
    const h = callerHarness(() => callerInclude({ id: 11 }, changes));
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), code);
    assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1);
    assert.equal(h.after[0].response_validated, false);
  }
  const duplicate = callerHarness(() => include({ id: 11 }, { headers: ['X-RateLimit-Remaining: 14000'] }));
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, duplicate.options), 'duplicate-include-header');
  assert.equal(duplicate.calls.length, 1); assert.equal(duplicate.after.length, 1);
  // Reset-window, age and reserve policy belong to the supplied budget.
  const shapedOnly = callerHarness(() => callerInclude({ id: 11 }, { remaining: 0, used: 15000, reset: 1 }));
  assert.deepEqual(readBoundedRequiredCaller(CALLER_ROUTE, shapedOnly.options), { id: 11 });
  assert.equal(shapedOnly.after[0].quota.remaining, 0); assert.equal(shapedOnly.after[0].quota.reset, 1);
});

test('required own reads preserve all visible denial/backoff/redirect/multiple-block precedence', () => {
  const variants = [
    [{ status: 403 }, 'github-denial'], [{ status: 429 }, 'github-denial'],
    [{ status: 100, headers: ['Retry-After: 0'] }, 'github-retry-after'],
    [{ status: 100, headers: ['Retry-After: date-is-not-a-number'] }, 'github-retry-after'],
    [{ status: 302, headers: ['Location: https://evil.invalid/private'] }, 'github-redirect'],
    [{ status: 421 }, 'ambiguous-include-blocks'], [{ status: 200 }, 'ambiguous-include-blocks'],
  ];
  for (const [block, code] of variants) {
    const h = callerHarness(() => include({ id: 11 }, { blocks: [block] }));
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), code);
    assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1);
    assert.deepEqual(h.after[0].visible_statuses, [block.status, 200]); assert.equal(h.after[0].response_validated, false);
    assert.doesNotMatch(JSON.stringify(h.after), /evil\.invalid|private/);
  }
  const informative = callerHarness(() => include({ id: 11 }, { blocks: [{ status: 100 }, { status: 103 }] }));
  assert.deepEqual(readBoundedRequiredCaller(CALLER_ROUTE, informative.options), { id: 11 });
  assert.deepEqual(informative.after[0].visible_statuses, [100, 103, 200]);
  for (const bytes of [Buffer.from('{}'), include(null, { body: '{not-json' }),
    include({ id: 11 }, { type: 'text/html' }), include({ id: 11 }, { status: 500 }),
    include({ id: 11 }, { headers: ['Retry-After: 15'] })]) {
    const h = callerHarness(() => bytes); fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options));
    assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1); assert.equal(h.after[0].response_validated, false);
  }
});

test('own-read budget floor and phase deadline reject before command without an issuance claim', () => {
  for (const mode of ['false', 'throw', 'deadline']) {
    const h = callerHarness(() => include({ id: 11 }), { timeoutMs: 250 });
    const privateReceipt = {}, originalAfter = h.options.budget.afterRequest;
    h.options.budget.beforeRequest = facts => {
      h.before.push(facts);
      if (mode === 'false') return false;
      if (mode === 'throw') throw Error('synthetic private floor denial');
      h.advance(250); return privateReceipt;
    };
    h.options.budget.afterRequest = (facts, receipt) => { assert.equal(receipt, privateReceipt); originalAfter(facts); };
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options),
      mode === 'deadline' ? 'github-reader-deadline' : 'github-budget-before-request');
    assert.equal(h.before.length, 1); assert.equal(h.calls.length, 0); assert.equal(h.after.length, mode === 'deadline' ? 1 : 0);
    if (mode === 'deadline') {
      assert.equal(h.after[0].command_started, false); assert.equal(h.after[0].command_started_ms, null);
      assert.equal(h.after[0].native_request_issued, false); assert.equal(h.after[0].wire_request_count, null);
      assert.equal(h.after[0].error_code, 'github-reader-deadline');
    }
  }
  let h = callerHarness(() => { h.advance(251); return include({ id: 11 }); }, { timeoutMs: 250 });
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), 'github-reader-deadline');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].options.timeoutMs, 250);
  assert.equal(h.after.length, 1); assert.equal(h.after[0].error_code, 'github-reader-deadline');
  h = callerHarness(() => include({ id: 11 }), { timeoutMs: 250 });
  h.options.budget.afterRequest = facts => { h.after.push(facts); h.advance(250); };
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), 'github-reader-deadline');
  assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1);
  const afterDenied = callerHarness(() => include({ id: 11 }));
  afterDenied.options.budget.afterRequest = facts => { afterDenied.after.push(facts); return false; };
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, afterDenied.options), 'github-budget-after-request');
  assert.equal(afterDenied.calls.length, 1); assert.equal(afterDenied.after.length, 1);
  let nativeIssued = false;
  const preExec = callerHarness(() => { throw Error('Unexpected command'); });
  preExec.options.command = () => { assert.equal(nativeIssued, false); throw Error('synthetic wrapper phase deadline'); };
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, preExec.options), 'github-command-failed');
  assert.equal(nativeIssued, false); assert.equal(preExec.after.length, 1);
  assert.equal(preExec.after[0].command_started, true); assert.equal(preExec.after[0].native_request_issued, null);
  assert.equal(preExec.after[0].status, null);
});

test('failed own command outputs retain observed status once and keep native errors/body data private', () => {
  const hidden = 'synthetic-private-native-error-and-body';
  for (const status of [200, 403, 429]) {
    const h = callerHarness(() => { throw Object.assign(Error(hidden), {
      stdout: include({ id: 11, jobs: [{ name: hidden }] }, { status }), stderr: Buffer.from(hidden),
    }); });
    let caught;
    try { readBoundedRequiredCaller(CALLER_ROUTE, h.options); } catch (error) { caught = error; }
    assert.equal(caught.code, 'github-command-failed'); assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1);
    assert.equal(h.after[0].status, status); assert.equal(h.after[0].command_failed, true);
    assert.equal(h.after[0].response_validated, false); assert.equal(h.after[0].native_request_issued, null);
    assert.doesNotMatch(JSON.stringify(h.after) + JSON.stringify(caught.facts) + caught.message, new RegExp(hidden));
    assert.equal(Object.hasOwn(caught, 'cause'), false); assert.equal(Object.hasOwn(caught, 'stderr'), false);
  }
  const unknown = callerHarness(() => { throw Object.assign(Error(hidden), { stdout: Buffer.from('{}') }); });
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, unknown.options), 'github-command-failed');
  assert.equal(unknown.after.length, 1); assert.equal(unknown.after[0].status, null);
  assert.deepEqual(unknown.after[0].visible_statuses, []);
});

test('own-read clocks and dependency limits remain bounded with literal wall-clock samples', () => {
  for (const value of [NaN, Infinity, -1]) {
    const h = callerHarness(() => include({ id: 11 }), { monotonic: () => value });
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), 'invalid-github-monotonic-clock');
    assert.equal(h.calls.length, 0); assert.equal(h.before.length, 0);
  }
  for (const value of [NaN, Infinity, -1, 0.5]) {
    const h = callerHarness(() => include({ id: 11 }), { wallClock: () => value });
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), 'invalid-github-wall-clock');
    assert.equal(h.calls.length, 0); assert.equal(h.before.length, 0);
  }
  const receipt = {}, preClock = callerHarness(() => { throw Error('Clock failure must not issue'); });
  preClock.options.budget.beforeRequest = facts => { preClock.before.push(facts); preClock.advance(-1); return receipt; };
  preClock.options.budget.afterRequest = (facts, sameReceipt) => { assert.equal(sameReceipt, receipt); preClock.after.push(facts); };
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, preClock.options), 'invalid-github-monotonic-clock');
  assert.equal(preClock.calls.length, 0); assert.equal(preClock.after.length, 1);
  assert.equal(preClock.after[0].command_started, false); assert.equal(preClock.after[0].native_request_issued, false);
  const backwards = callerHarness(() => { backwards.advance(-1); return include({ id: 11 }); });
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, backwards.options), 'invalid-github-monotonic-clock');
  assert.equal(backwards.after.length, 1); assert.equal(backwards.after[0].ended_ms, null);
  let samples = 0;
  const invalidEnd = callerHarness(() => include({ id: 11 }), {
    wallClock: () => samples++ === 0 ? CALLER_EPOCH : NaN,
  });
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE, invalidEnd.options), 'invalid-github-wall-clock');
  assert.equal(invalidEnd.after.length, 1); assert.equal(invalidEnd.after[0].ended_epoch_ms, null);
  samples = 0;
  const literalWall = callerHarness(() => include({ id: 11 }), {
    wallClock: () => samples++ === 0 ? CALLER_EPOCH : CALLER_EPOCH - 1,
  });
  assert.deepEqual(readBoundedRequiredCaller(CALLER_ROUTE, literalWall.options), { id: 11 });
  assert.equal(literalWall.after[0].started_epoch_ms, CALLER_EPOCH);
  assert.equal(literalWall.after[0].ended_epoch_ms, CALLER_EPOCH - 1);
  for (const timeoutMs of [0, -1, 0.5, 120001, Infinity]) {
    const h = callerHarness(() => include({ id: 11 }), { timeoutMs });
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options), 'invalid-github-reader-deadline');
    assert.equal(h.calls.length, 0);
  }
  fault(() => readBoundedRequiredCaller(CALLER_ROUTE), 'invalid-github-reader-dependencies');
});

test('own-read synchronous command/budget contracts reject async callbacks without unhandled rejection', async () => {
  for (const target of ['command', 'before', 'after']) {
    const h = callerHarness(() => include({ id: 11 })), receipt = {};
    const rejected = () => Promise.reject(Error('synthetic private async failure'));
    const originalBefore = h.options.budget.beforeRequest, originalAfter = h.options.budget.afterRequest;
    let beforeCalls = 0, afterCalls = 0;
    h.options.budget.beforeRequest = facts => {
      beforeCalls++; originalBefore(facts); return target === 'before' ? rejected() : receipt;
    };
    h.options.budget.afterRequest = (facts, sameReceipt) => {
      afterCalls++; assert.equal(sameReceipt, receipt);
      if (target === 'after') return rejected();
      originalAfter(facts);
    };
    if (target === 'command') h.options.command = rejected;
    fault(() => readBoundedRequiredCaller(CALLER_ROUTE, h.options),
      target === 'command' ? 'asynchronous-gh-command' : target === 'before' ? 'github-budget-before-request' : 'github-budget-after-request');
    assert.equal(beforeCalls, 1); assert.equal(afterCalls, target === 'before' ? 0 : 1);
    await new Promise(resolve => setImmediate(resolve));
  }
});

test('optional page ceilings accept their exact bound and reject larger declared inventories without a prefix', () => {
  for (const [total, maximumPages] of [[0, 1], [100, 1], [1000, 10]]) {
    const h = harness((_url, ordinal) => {
      const count = Math.min(100, total - (ordinal - 1) * 100);
      return include(page(total, rows(count, (ordinal - 1) * 100 + 1)), {
        headers: ordinal < Math.max(1, Math.ceil(total / 100)) ? ['Link: ' + next(jobs, ordinal + 1)] : [],
      });
    });
    const result = readBoundedGitHubPages(jobs, { ...h.options, maximumPages });
    assert.equal(result.length, maximumPages); assert.equal(h.calls.length, maximumPages);
    assert.equal(h.before.length, maximumPages); assert.equal(h.after.length, maximumPages);
    assert.equal(result.flatMap(item => item.jobs).length, total);
  }
  for (const endpoint of [jobs, allJobs]) {
    const h = harness(() => include(page(1001, rows(100)), { headers: ['Link: ' + next(endpoint, 2)] }));
    fault(() => readBoundedGitHubPages(endpoint, { ...h.options, maximumPages: 10 }), 'github-page-cap');
    assert.equal(h.calls.length, 1); assert.equal(h.before.length, 1); assert.equal(h.after.length, 1);
    assert.equal(h.after[0].page_validated, false); assert.equal(h.after[0].error_code, 'github-page-cap');
  }
  const outputs = [];
  for (const cap of ['absent', undefined, 100]) {
    const h = harness((_url, ordinal) => include(page(1001, rows(ordinal === 11 ? 1 : 100, (ordinal - 1) * 100 + 1)), {
      headers: ordinal < 11 ? ['Link: ' + next(jobs, ordinal + 1)] : [],
    }));
    const options = cap === 'absent' ? h.options : { ...h.options, maximumPages: cap };
    outputs.push(readBoundedGitHubPages(jobs, options));
    assert.equal(h.calls.length, 11); assert.equal(h.after.length, 11);
  }
  assert.deepEqual(outputs[1], outputs[0]); assert.deepEqual(outputs[2], outputs[0]);
});

test('invalid page ceilings reject before hooks and the optional value is captured once', () => {
  for (const maximumPages of [null, false, true, 0, -1, 1.5, 101, Number.MAX_SAFE_INTEGER, Infinity, NaN,
    '10', 10n, { toString: () => '10' }]) {
    const h = harness(() => { throw Error('Invalid page ceiling must not issue'); });
    fault(() => readBoundedGitHubPages(jobs, { ...h.options, maximumPages }), 'invalid-github-page-limit');
    assert.equal(h.calls.length, 0); assert.equal(h.before.length, 0); assert.equal(h.after.length, 0);
  }
  let reads = 0;
  const h = harness((_url, ordinal) => include(page(101, rows(ordinal === 1 ? 100 : 1, ordinal === 1 ? 1 : 101)), {
    headers: ordinal === 1 ? ['Link: ' + next(jobs, 2)] : [],
  }));
  const options = { ...h.options, get maximumPages() { reads++; return reads === 1 ? 2 : 1; } };
  assert.equal(readBoundedGitHubPages(jobs, options).length, 2); assert.equal(reads, 1);
  assert.equal(h.calls.length, 2);
});

test('every pager page pairs the identical private receipt and copied start facts without serialization', () => {
  const h = harness((_url, ordinal) => include(page(101, rows(ordinal === 1 ? 100 : 1, ordinal === 1 ? 1 : 101)), {
    headers: ordinal === 1 ? ['Link: ' + next(jobs, 2)] : [],
  }));
  const receipts = [], originalBefore = h.options.budget.beforeRequest, originalAfter = h.options.budget.afterRequest;
  h.options.budget.beforeRequest = facts => {
    originalBefore(facts);
    const receipt = { toJSON() { throw Error('Private receipt must not serialize'); } };
    receipt.self = receipt; receipts.push(receipt); h.advance(3); return receipt;
  };
  h.options.budget.afterRequest = (facts, receipt) => {
    assert.equal(receipt, receipts[h.after.length]); assert.equal(receipt.self, receipt);
    assert.equal(Object.isFrozen(receipt), false); originalAfter(facts);
  };
  assert.equal(readBoundedGitHubPages(jobs, { ...h.options, maximumPages: 2 }).length, 2);
  assert.notEqual(receipts[0], receipts[1]); assert.equal(h.after.length, 2);
  assert.deepEqual(h.sequence, ['before1', 'command1', 'after1', 'before2', 'command2', 'after2']);
  for (let index = 0; index < 2; index++) {
    for (const key of ['endpoint', 'family', 'page', 'started_ms', 'deadline_ms', 'requested_gh_hostname',
      'max_body_bytes', 'max_stdout_bytes'])
      assert.deepEqual(h.after[index][key], h.before[index][key]);
    assert.equal(h.after[index].command_started, true);
    assert.equal(h.after[index].command_started_ms, h.before[index].started_ms + 3);
    assert.equal(h.after[index].elapsed_ms, 3); assert.equal(h.after[index].native_request_issued, null);
    assert.equal(h.after[index].wire_request_count, null);
    assert.equal(Object.isFrozen(h.after[index].header_blocks), true);
    assert.doesNotMatch(JSON.stringify(h.after[index]), /receipt|self|toJSON/);
  }
});

test('successful pager reservations settle once after pre-entry deadline or clock failure including page two', () => {
  for (const mode of ['deadline', 'backwards', 'throw']) {
    let failClock = false;
    const h = harness(() => { throw Error('Stopped pager reservation must not issue'); }), receipt = {};
    if (mode === 'throw') h.options.monotonic = () => {
      if (failClock) throw Error('synthetic private clock fault');
      return 0;
    };
    h.options.budget.beforeRequest = facts => {
      h.before.push(facts);
      if (mode === 'deadline') h.advance(250);
      else if (mode === 'backwards') h.advance(-1);
      else failClock = true;
      return receipt;
    };
    h.options.budget.afterRequest = (facts, sameReceipt) => { assert.equal(sameReceipt, receipt); h.after.push(facts); };
    fault(() => readBoundedGitHubPages(jobs, { ...h.options, timeoutMs: 250 }),
      mode === 'deadline' ? 'github-reader-deadline' : 'invalid-github-monotonic-clock');
    assert.equal(h.before.length, 1); assert.equal(h.calls.length, 0); assert.equal(h.after.length, 1);
    assert.equal(h.after[0].command_started, false); assert.equal(h.after[0].command_started_ms, null);
    assert.equal(h.after[0].command_failed, false); assert.equal(h.after[0].native_request_issued, false);
    assert.equal(h.after[0].wire_request_count, null); assert.equal(h.after[0].status, null);
    assert.equal(h.after[0].page_validated, false);
    assert.equal(h.after[0].started_ms, h.before[0].started_ms);
    assert.doesNotMatch(JSON.stringify(h.after), /synthetic private clock fault/);
  }
  const receipts = [], h = harness(() => include(page(101, rows(100)), { headers: ['Link: ' + next(jobs, 2)] }));
  h.options.budget.beforeRequest = facts => {
    h.before.push(facts); const receipt = {}; receipts.push(receipt);
    if (facts.page === 2) h.advance(250); return receipt;
  };
  h.options.budget.afterRequest = (facts, receipt) => { assert.equal(receipt, receipts[h.after.length]); h.after.push(facts); };
  fault(() => readBoundedGitHubPages(jobs, { ...h.options, timeoutMs: 250, maximumPages: 2 }), 'github-reader-deadline');
  assert.equal(h.calls.length, 1); assert.equal(h.before.length, 2); assert.equal(h.after.length, 2);
  assert.equal(h.after[0].page_validated, true); assert.equal(h.after[1].page_validated, false);
  assert.equal(h.after[1].page, 2); assert.equal(h.after[1].command_started, false);
  assert.equal(h.after[1].native_request_issued, false); assert.equal(h.after[1].error_code, 'github-reader-deadline');
});

test('entered pager commands retain known failure statuses and settle their private receipt once', () => {
  const hidden = 'synthetic-private-pager-native-error';
  for (const status of [200, 403, 429]) {
    const h = harness(() => { throw Object.assign(Error(hidden), {
      stdout: include(page(0, [], 'jobs', { hidden }), { status }), stderr: Buffer.from(hidden),
    }); }), receipt = {};
    h.options.budget.beforeRequest = facts => { h.before.push(facts); return receipt; };
    h.options.budget.afterRequest = (facts, sameReceipt) => { assert.equal(sameReceipt, receipt); h.after.push(facts); };
    let caught;
    try { readBoundedGitHubPages(jobs, h.options); } catch (error) { caught = error; }
    assert.equal(caught.code, 'github-command-failed'); assert.equal(h.calls.length, 1); assert.equal(h.after.length, 1);
    assert.equal(h.after[0].command_started, true); assert.equal(h.after[0].native_request_issued, null);
    assert.equal(h.after[0].status, status); assert.equal(h.after[0].command_failed, true);
    assert.equal(h.after[0].page_validated, false);
    assert.doesNotMatch(JSON.stringify(h.after) + JSON.stringify(caught.facts) + caught.message, new RegExp(hidden));
  }
  let nativeIssued = false;
  const h = harness(() => { throw Error('Unexpected native issuance'); }), receipt = {};
  h.options.command = () => { assert.equal(nativeIssued, false); throw Error('synthetic wrapper deadline'); };
  h.options.budget.beforeRequest = facts => { h.before.push(facts); return receipt; };
  h.options.budget.afterRequest = (facts, sameReceipt) => { assert.equal(sameReceipt, receipt); h.after.push(facts); };
  fault(() => readBoundedGitHubPages(jobs, h.options), 'github-command-failed');
  assert.equal(nativeIssued, false); assert.equal(h.after.length, 1);
  assert.equal(h.after[0].command_started, true); assert.equal(h.after[0].native_request_issued, null);
  assert.equal(h.after[0].status, null);
});

test('pager synchronous budget refusals and async contracts keep receipts private with no duplicate settlement', async () => {
  for (const target of ['before-false', 'before-throw', 'before-async', 'after-false', 'after-throw', 'after-async', 'command-async']) {
    const h = harness(() => include(page(0, []))), receipt = {};
    let wrapperEntries = 0, beforeCalls = 0, afterCalls = 0;
    const rejected = () => Promise.reject(Error('synthetic private pager async error'));
    h.options.budget.beforeRequest = facts => {
      beforeCalls++; h.before.push(facts);
      if (target === 'before-false') return false;
      if (target === 'before-throw') throw Error('synthetic private pager before error');
      if (target === 'before-async') return rejected();
      return receipt;
    };
    h.options.budget.afterRequest = (facts, sameReceipt) => {
      afterCalls++; assert.equal(sameReceipt, receipt); h.after.push(facts);
      if (target === 'after-false') return false;
      if (target === 'after-throw') throw Error('synthetic private pager after error');
      if (target === 'after-async') return rejected();
    };
    if (target === 'command-async') h.options.command = () => { wrapperEntries++; return rejected(); };
    fault(() => readBoundedGitHubPages(jobs, h.options), target.startsWith('before') ? 'github-budget-before-request' :
      target.startsWith('after') ? 'github-budget-after-request' : 'asynchronous-gh-command');
    assert.equal(beforeCalls, 1); assert.equal(afterCalls, target.startsWith('before') ? 0 : 1);
    assert.equal(h.calls.length + wrapperEntries, target.startsWith('before') ? 0 : 1);
    if (afterCalls) { assert.equal(h.after[0].command_started, true); assert.equal(h.after[0].native_request_issued, null); }
    await new Promise(resolve => setImmediate(resolve));
  }
});
