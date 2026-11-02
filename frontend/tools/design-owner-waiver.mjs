// Owner waiver for the subjective screenshot scores in check-design-review.mjs.
// It never covers functional, accessibility or layout checks. Measured timing overruns pass only
// when the bound screening-priority policy classifies them as deferred warnings. Delete the file to
// require scored screenshot reviews again.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

export const OWNER_WAIVER_FILE = 'owner-waiver.json';
export const OWNER_WAIVER_SCHEMA = 'owner-design-waiver-v1';

export function validateOwnerWaiver(value) {
  const fail = message => { throw Error(`Invalid ${OWNER_WAIVER_FILE}: ${message}`); };
  if (!value || typeof value !== 'object') fail('not an object');
  if (value.schema_version !== OWNER_WAIVER_SCHEMA) fail(`schema_version must be ${OWNER_WAIVER_SCHEMA}`);
  if (value.scope !== 'subjective-screenshot-scores') fail('scope must be subjective-screenshot-scores');
  if (value.objective_checks !== 'required') fail('objective_checks must stay required');
  if (typeof value.granted_by !== 'string' || !value.granted_by.trim()) fail('granted_by is required');
  if (typeof value.instruction !== 'string' || !value.instruction.trim()) fail("the owner's instruction is required");
  if (typeof value.granted_at !== 'string' || !Number.isFinite(Date.parse(value.granted_at))) fail('granted_at must be a timestamp');
  return value;
}

/** The validated waiver, or null when none is committed. An unreadable or invalid file fails closed. */
export async function readOwnerWaiver(directory) {
  let text;
  try { text = await readFile(resolve(directory, OWNER_WAIVER_FILE), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return validateOwnerWaiver(JSON.parse(text));
}

/**
 * Objective evidence the waiver still requires from this Design run's report.
 * With a bound screening-priority assessment, only its measured timing warnings may remain
 * (the 2026-10-21 policy defers those; the owner approved deferring them without an image
 * review). Any blocking failure stops the gate. Without an assessment, the report must have
 * no failures at all.
 */
export function requireObjectiveEvidence(report, assessment = null) {
  if (!Array.isArray(report?.screens) || !report.screens.length) throw Error('The owner waiver still requires the captured screens of this run');
  if (!Array.isArray(report.failures)) throw Error('The owner waiver requires the objective failure list of this run');
  if (assessment) {
    if (!Array.isArray(assessment.blocking_failures) || !Array.isArray(assessment.warnings)) throw Error('The owner waiver requires a complete screening-priority assessment');
    if (assessment.blocking_failures.length) throw Error('Objective functional/design failures remain; the owner waiver covers subjective scores and measured timing only: ' + assessment.blocking_failures.join('; '));
    const deferred = new Set(assessment.warnings);
    if (report.failures.some(failure => !deferred.has(failure))) throw Error('Objective design/performance failures remain; the owner waiver covers subjective scores and measured timing only');
    return report.screens.length;
  }
  if (report.failures.length) throw Error('Objective design/performance failures remain; the owner waiver covers subjective scores only');
  return report.screens.length;
}
