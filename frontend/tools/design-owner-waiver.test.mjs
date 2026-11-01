// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateOwnerWaiver, requireObjectiveEvidence } from './design-owner-waiver.mjs';

const checker = fileURLToPath(new URL('./check-design-review.mjs', import.meta.url));
const waiver = { schema_version: 'owner-design-waiver-v1', scope: 'subjective-screenshot-scores', objective_checks: 'required', granted_by: 'owner', granted_at: '2026-11-01T23:00:00Z', instruction: '点数はつけなくていい' };

function run({ waiverValue, report }) {
  const root = mkdtempSync(join(tmpdir(), 'design-waiver-'));
  try {
    execFileSync('git', ['init', '-q', root]);
    mkdirSync(join(root, 'docs/design-review'), { recursive: true });
    mkdirSync(join(root, 'frontend/test-results/design-review'), { recursive: true });
    if (waiverValue !== undefined) writeFileSync(join(root, 'docs/design-review/owner-waiver.json'), typeof waiverValue === 'string' ? waiverValue : JSON.stringify(waiverValue));
    writeFileSync(join(root, 'frontend/test-results/design-review/report.json'), JSON.stringify(report));
    return spawnSync(process.execPath, [checker], { cwd: join(root, 'frontend'), encoding: 'utf8', env: { ...process.env, GITHUB_ACTIONS: '' } });
  } finally { rmSync(root, { recursive: true, force: true }); }
}

describe('owner waiver for subjective design scores', () => {
  it('accepts only the exact schema and keeps objective checks required', () => {
    expect(validateOwnerWaiver(waiver)).toBe(waiver);
    for (const broken of [{ ...waiver, schema_version: 'v0' }, { ...waiver, scope: 'everything' }, { ...waiver, objective_checks: 'waived' }, { ...waiver, granted_by: ' ' }, { ...waiver, instruction: '' }, { ...waiver, granted_at: 'soon' }, null]) {
      expect(() => validateOwnerWaiver(broken)).toThrow(/owner-waiver/);
    }
    expect(requireObjectiveEvidence({ screens: [{ key: 'a' }], failures: [] })).toBe(1);
    expect(() => requireObjectiveEvidence({ screens: [], failures: [] })).toThrow(/captured screens/);
    expect(() => requireObjectiveEvidence({ screens: [{ key: 'a' }] })).toThrow(/failure list/);
    expect(() => requireObjectiveEvidence({ screens: [{ key: 'a' }], failures: ['axe: color-contrast'] })).toThrow(/Objective/);
  });

  it('passes the gate with a waiver and clean objective results, and nowhere else', () => {
    const clean = { screens: [{ key: 'home/390/dark' }], failures: [] };
    const passed = run({ waiverValue: waiver, report: clean });
    expect(passed.status, passed.stderr).toBe(0);
    expect(passed.stdout).toContain('Subjective screenshot scores waived by owner');
    expect(passed.stdout).toContain('No scores were recorded');
    const failing = run({ waiverValue: waiver, report: { ...clean, failures: ['home/390/dark: horizontal overflow'] } });
    expect(failing.status).not.toBe(0);
    expect(failing.stderr).toContain('owner waiver covers subjective scores only');
    const none = run({ report: clean });
    expect(none.status).not.toBe(0);
    expect(none.stderr).toContain('No screenshot-based design review matches the current UI');
    const corrupt = run({ waiverValue: '{"schema_version":', report: clean });
    expect(corrupt.status).not.toBe(0);
  });
});
