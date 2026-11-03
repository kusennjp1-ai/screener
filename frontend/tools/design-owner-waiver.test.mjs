// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateOwnerWaiver, requireObjectiveEvidence, timingDeferralApproved } from './design-owner-waiver.mjs';
import { CAPTURES, DESIGN_GROUPS, REPORT_SCHEMA, captureKey } from './brief-design-contract.mjs';

const checker = fileURLToPath(new URL('./check-design-review.mjs', import.meta.url));
const waiver = { schema_version: 'owner-design-waiver-v1', scope: 'subjective-screenshot-scores', objective_checks: 'required', granted_by: 'owner', granted_at: '2026-11-01T23:00:00Z', instruction: '点数はつけなくていい' };
const timed = { ...waiver, timing_instruction: '速度の基準超過も保留にして公開してよい', timing_granted_at: '2026-11-02T05:10:00Z' };

function completeReport(overrides = {}) {
  const screens = DESIGN_GROUPS.flatMap(group => CAPTURES.map(({ screen }) => ({ key: captureKey(screen, group), screenshot: `${screen}-${group.width}-${group.theme}.png`, failures: [] })));
  return { schema: REPORT_SCHEMA, commit: 'a'.repeat(40), groups: DESIGN_GROUPS.map(group => ({ key: group.key, completed: true })), screens, failures: [], timing_warnings: [], ...overrides };
}
async function withEvidence(report, action, { emptyShot = null } = {}) {
  const output = mkdtempSync(join(tmpdir(), 'brief-evidence-'));
  try {
    for (const screen of report.screens) writeFileSync(join(output, screen.screenshot), screen.screenshot === emptyShot ? '' : 'png');
    return await action(output);
  } finally { rmSync(output, { recursive: true, force: true }); }
}
function run({ waiverValue, report, emptyShot }) {
  const root = mkdtempSync(join(tmpdir(), 'design-waiver-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'docs/design-review'), { recursive: true });
    const output = join(root, 'frontend/test-results/design-review');
    mkdirSync(output, { recursive: true });
    if (waiverValue !== undefined) writeFileSync(join(root, 'docs/design-review/owner-waiver.json'), typeof waiverValue === 'string' ? waiverValue : JSON.stringify(waiverValue));
    writeFileSync(join(output, 'report.json'), JSON.stringify(report));
    for (const screen of report.screens) writeFileSync(join(output, screen.screenshot), screen.screenshot === emptyShot ? '' : 'png');
    return spawnSync(process.execPath, [checker], { cwd: join(root, 'frontend'), encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '', DESIGN_REVIEW_OUTPUT: '' } });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('owner waiver for subjective design scores', () => {
  it('accepts only the exact schema and keeps objective checks required', () => {
    expect(validateOwnerWaiver(waiver)).toBe(waiver);
    expect(validateOwnerWaiver(timed)).toBe(timed);
    for (const broken of [{ ...waiver, schema_version: 'v0' }, { ...waiver, scope: 'everything' }, { ...waiver, objective_checks: 'waived' }, { ...waiver, granted_by: ' ' }, { ...waiver, instruction: '' }, { ...waiver, granted_at: 'soon' },
      { ...waiver, timing_instruction: '' , timing_granted_at: '2026-11-02T05:10:00Z' }, { ...waiver, timing_instruction: 'ok' }, null]) {
      expect(() => validateOwnerWaiver(broken)).toThrow(/owner-waiver/);
    }
    expect(timingDeferralApproved(waiver)).toBe(false);
    expect(timingDeferralApproved(timed)).toBe(true);
  });

  it('requires every brief capture, a non-empty PNG, completed groups and no failures', async () => {
    const report = completeReport();
    expect(report.screens).toHaveLength(28);
    await withEvidence(report, async output => expect(await requireObjectiveEvidence(report, output, waiver)).toEqual({ captures: 28, warnings: [] }));
    await withEvidence(report, async output => {
      await expect(requireObjectiveEvidence({ ...report, schema: 'design-review-v0' }, output, waiver)).rejects.toThrow(/schema/);
      await expect(requireObjectiveEvidence({ ...report, screens: report.screens.slice(1) }, output, waiver)).rejects.toThrow(/today\/390\/dark: required capture missing/);
      await expect(requireObjectiveEvidence({ ...report, groups: report.groups.slice(1) }, output, waiver)).rejects.toThrow(/390\/dark: group did not complete/);
      await expect(requireObjectiveEvidence({ ...report, failures: ['stock/390/dark: axe 1 rule violations'] }, output, waiver)).rejects.toThrow(/Objective design failures remain/);
      await expect(requireObjectiveEvidence({ ...report, failures: undefined }, output, waiver)).rejects.toThrow(/failures/);
      await expect(requireObjectiveEvidence({ ...report, commit: 'local' }, output, waiver)).rejects.toThrow(/commit/);
    });
    await withEvidence(report, async output => {
      await expect(requireObjectiveEvidence(report, output, waiver)).rejects.toThrow(/watch-1440-light.png is missing or empty/);
    }, { emptyShot: 'watch-1440-light.png' });
  });

  it('defers measured timing only under the recorded owner timing approval', async () => {
    const report = completeReport({ timing_warnings: ['390: tab_switch_ms median 474ms > 400ms'] });
    await withEvidence(report, async output => {
      await expect(requireObjectiveEvidence(report, output, waiver)).rejects.toThrow(/recorded timing approval/);
      await expect(requireObjectiveEvidence(report, output, null)).rejects.toThrow(/recorded timing approval/);
      expect((await requireObjectiveEvidence(report, output, timed)).warnings).toEqual(report.timing_warnings);
    });
  });

  it('passes the gate with a waiver and clean objective results, and nowhere else', () => {
    const clean = completeReport();
    const passed = run({ waiverValue: waiver, report: clean });
    expect(passed.status, passed.stderr).toBe(0);
    expect(passed.stdout).toContain('Subjective screenshot scores waived by owner');
    expect(passed.stdout).toContain('No scores were recorded');
    const deferred = run({ waiverValue: timed, report: { ...clean, timing_warnings: ['1440: tab_switch_ms median 474ms > 400ms'] } });
    expect(deferred.status, deferred.stderr).toBe(0);
    expect(deferred.stderr).toContain('::warning title=Deferred measured timing under the owner waiver::1440: tab_switch_ms median 474ms > 400ms');
    const failing = run({ waiverValue: timed, report: { ...clean, failures: ['today/390/dark: horizontal page overflow'] } });
    expect(failing.status).not.toBe(0);
    expect(failing.stderr).toContain('Objective design failures remain');
    const missing = run({ waiverValue: timed, report: clean, emptyShot: 'today-390-dark.png' });
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toContain('today-390-dark.png is missing or empty');
    const none = run({ report: clean });
    expect(none.status).not.toBe(0);
    expect(none.stderr).toContain('No screenshot-based design review matches the current UI');
    const corrupt = run({ waiverValue: '{"schema_version":', report: clean });
    expect(corrupt.status).not.toBe(0);
    const retired = run({ waiverValue: timed, report: { ...clean, schema: undefined } });
    expect(retired.status).not.toBe(0);
    expect(retired.stderr).toContain('brief-design-review-v1');
  });
});
