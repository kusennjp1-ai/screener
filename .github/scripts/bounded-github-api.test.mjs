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
  assert.equal(h.calls.length, 0); assert.equal(h.after.length, 0);
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
