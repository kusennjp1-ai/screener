// @vitest-environment node
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const directories = [];
afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });
const receipt = phase => `data-quality:${phase}:complete:v1\n`;
const complete = phase => `writeSync(3, ${JSON.stringify(receipt(phase))});`;
const prelude = "import { appendFileSync, readFileSync, writeFileSync, writeSync } from 'node:fs';\n";
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'quality-worker-orchestration-')); directories.push(root);
  const tools = join(root, 'tools'); mkdirSync(tools);
  copyFileSync(new URL('./check-data-quality.mjs', import.meta.url), join(tools, 'check-data-quality.mjs'));
  const worker = (phase, body) => writeFileSync(join(tools, `check-data-quality-${phase}.mjs`), prelude + body);
  for (const phase of ['core', 'financial']) worker(phase, `appendFileSync('order', ${JSON.stringify(phase + '\n')});${complete(phase)}`);
  return { root, tools, worker, order: () => { try { return readFileSync(join(root, 'order'), 'utf8').trim().split('\n'); } catch { return []; } },
    run: ({ args = [], nodeArgs = [], env = {} } = {}) => spawnSync(process.execPath, [...nodeArgs, join(tools, 'check-data-quality.mjs'), ...args], {
      cwd: root, env: { ...process.env, ...env }, encoding: 'utf8', timeout: 10000,
    }) };
}

const failures = [
  ['exit without completion', '', 'did not complete'],
  ['nonzero after completion', 'RECEIPT;process.exit(7);', 'exit 7'],
  ['signal after completion', "RECEIPT;process.kill(process.pid, 'SIGTERM');", 'SIGTERM'],
  ['completion on stdout only', 'process.stdout.write(MARKER);', 'did not complete'],
  ['wrong completion', "writeSync(3, 'wrong phase');", 'did not complete'],
  ['duplicate completion', 'RECEIPT;RECEIPT;', 'did not complete'],
  ['oversized completion', "writeSync(3, 'x'.repeat(4096));", 'worker failed'],
];

describe('data quality CLI worker lifetimes', () => {
  it('waits for the core process to exit before starting financial and streams diagnostics', () => {
    const f = fixture();
    f.worker('core', `process.on('exit', () => writeFileSync('core-exited', String(process.pid))); console.log('x'.repeat(4096)); ${complete('core')}`);
    f.worker('financial', `const pid = Number(readFileSync('core-exited', 'utf8'));
      try { process.kill(pid, 0); throw Error('Core process still alive'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
      console.log('financial reached after core exit'); ${complete('financial')}`);
    const result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('x'.repeat(4096));
    expect(result.stdout).toContain('financial reached after core exit');
  });

  for (const phase of ['core', 'financial']) it.each(failures)(`${phase} fails closed on %s`, (_name, body, diagnostic) => {
    const f = fixture();
    f.worker(phase, `appendFileSync('order', ${JSON.stringify(phase + '\n')});` + body.replaceAll('RECEIPT', complete(phase)).replaceAll('MARKER', JSON.stringify(receipt(phase))));
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain(diagnostic);
    expect(f.order()).toEqual(phase === 'core' ? ['core'] : ['core', 'financial']);
  });

  it.each(['--core-only', '--skip-financial', '--phase=financial'])('rejects public phase selection %s', arg => {
    const f = fixture(), result = f.run({ args: [arg] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('does not accept arguments');
    expect(f.order()).toEqual([]);
  });

  it('has no environment phase or skip switch', () => {
    const f = fixture(), result = f.run({ env: { DATA_QUALITY_PHASE: 'core', SKIP_FINANCIAL_COMPATIBILITY: '1', SKIP_DATA_QUALITY: '1' } });
    expect(result.status, result.stderr).toBe(0);
    expect(f.order()).toEqual(['core', 'financial']);
  });

  it.each([{ nodeArgs: [] }, { nodeArgs: ['--max-old-space-size=128'] }])('preserves inherited and direct heap settings: $nodeArgs', ({ nodeArgs }) => {
    const f = fixture(), env = { NODE_OPTIONS: '--max-old-space-size=160' };
    for (const phase of ['core', 'financial']) f.worker(phase, `import { getHeapStatistics } from 'node:v8';
      appendFileSync('limits', JSON.stringify({ flags: process.execArgv, options: process.env.NODE_OPTIONS, limit: getHeapStatistics().heap_size_limit }) + '\\n'); ${complete(phase)}`);
    const result = f.run({ nodeArgs, env });
    expect(result.status, result.stderr).toBe(0);
    const expected = spawnSync(process.execPath, [...nodeArgs, '-p', "require('node:v8').getHeapStatistics().heap_size_limit"], { env: { ...process.env, ...env }, encoding: 'utf8' });
    expect(expected.status, expected.stderr).toBe(0);
    const limits = readFileSync(join(f.root, 'limits'), 'utf8').trim().split('\n').map(JSON.parse);
    expect(limits).toEqual(['core', 'financial'].map(() => ({ flags: nodeArgs, options: env.NODE_OPTIONS, limit: Number(expected.stdout) })));
  });
});

function financialFixture({ carry = null, correction = null, fail = null } = {}) {
  const f = fixture();
  copyFileSync(new URL('./check-data-quality-financial.mjs', import.meta.url), join(f.tools, 'check-data-quality-financial.mjs'));
  mkdirSync(join(f.root, 'public/static-data'), { recursive: true });
  mkdirSync(join(f.root, 'src/static'), { recursive: true });
  writeFileSync(join(f.root, 'package.json'), '{"type":"module"}');
  writeFileSync(join(f.root, 'src/static/researchTransport.js'), 'export const decodeResearchIndex = value => value;');
  writeFileSync(join(f.root, 'public/static-data/manifest.json'), JSON.stringify({ assets: { research: { path: 'research.json' } } }));
  writeFileSync(join(f.root, 'public/static-data/research.json'), JSON.stringify({ rows: [{ symbol: 'FIXTURE' }], as_of_date: '2026-10-02', financial_evaluated_at: 1 }));
  f.worker('core', `process.on('exit', () => writeFileSync('core-exited-at', String(Date.now()))); ${complete('core')}`);
  const stub = `import { appendFileSync } from 'node:fs'; const record = (kind, args) => appendFileSync('calls', JSON.stringify({ kind, args }) + '\\n');\n`;
  writeFileSync(join(f.tools, 'financial-generation-carry.mjs'), stub + `
    export async function readFinancialGenerationCarry() { record('readCarry'); return ${JSON.stringify(carry)}; }
    export async function verifyCarryCompatibility(args) { record('verifyCarry', args); ${fail === 'carry' ? "throw Error('carry rejected');" : ''} }`);
  writeFileSync(join(f.tools, 'financial-correction-overlay.mjs'), stub + `
    export async function loadFinancialCorrection(args) { record('loadCorrection', args); ${fail === 'load' ? "throw Error('correction binding rejected');" : ''} return ${JSON.stringify(correction)}; }
    export async function verifyCorrectionCompatibility(args) { record('verifyCorrection', args); ${fail === 'correction' ? "throw Error('correction expired');" : ''} }`);
  return { ...f, calls: () => readFileSync(join(f.root, 'calls'), 'utf8').trim().split('\n').map(JSON.parse) };
}

describe('financial quality worker dispatch and clocks', () => {
  it('prioritizes carry and uses a fresh actual check clock after core exits', () => {
    const carry = { symbols: { FIXTURE: {} } }, f = financialFixture({ carry, correction: carry });
    const before = Date.now(), result = f.run({ env: { FINANCIAL_EVALUATED_AT: '2000-01-01T00:00:00Z' } }), after = Date.now();
    expect(result.status, result.stderr).toBe(0);
    expect(f.calls().map(call => call.kind)).toEqual(['readCarry', 'verifyCarry']);
    const args = f.calls()[1].args;
    expect(args).toEqual({ root: 'public/static-data', carry, evaluatedAt: expect.any(Number) });
    expect(args.evaluatedAt).toBeGreaterThanOrEqual(Math.max(before, Number(readFileSync(join(f.root, 'core-exited-at'), 'utf8'))));
    expect(args.evaluatedAt).toBeLessThanOrEqual(after);
  });

  it('loads correction with the decoded universe and verifies with the current clock', () => {
    const correction = { symbols: { FIXTURE: {} } }, f = financialFixture({ correction });
    const before = Date.now(), result = f.run({ env: { FINANCIAL_EVALUATED_AT: '2000-01-01T00:00:00Z' } }), after = Date.now();
    expect(result.status, result.stderr).toBe(0);
    expect(f.calls().map(call => call.kind)).toEqual(['readCarry', 'loadCorrection', 'verifyCorrection']);
    expect(f.calls()[1].args).toEqual({ rows: [{ symbol: 'FIXTURE' }], asOfDate: '2026-10-02' });
    expect(f.calls()[2].args).toEqual({ root: 'public/static-data', projection: correction, evaluatedAt: expect.any(Number) });
    expect(f.calls()[2].args.evaluatedAt).toBeGreaterThanOrEqual(before);
    expect(f.calls()[2].args.evaluatedAt).toBeLessThanOrEqual(after);
  });

  it('completes the financial gate after checking that neither mode is active', () => {
    const f = financialFixture(), result = f.run();
    expect(result.status, result.stderr).toBe(0);
    expect(f.calls().map(call => call.kind)).toEqual(['readCarry', 'loadCorrection']);
  });

  it.each(['carry', 'load', 'correction'])('propagates %s failures without a success completion', fail => {
    const value = { symbols: { FIXTURE: {} } }, f = financialFixture({ carry: fail === 'carry' ? value : null, correction: value, fail });
    const result = f.run();
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Data quality financial worker failed: exit 1');
    expect(f.calls().map(call => call.kind)).toEqual(fail === 'carry' ? ['readCarry', 'verifyCarry'] : fail === 'load' ? ['readCarry', 'loadCorrection'] : ['readCarry', 'loadCorrection', 'verifyCorrection']);
  });
});
