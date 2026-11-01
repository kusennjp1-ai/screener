// Owner waiver for the subjective screenshot scores in check-design-review.mjs.
// It never covers objective checks: the captured run must exist and report no
// design, accessibility, layout or performance failures. Delete the file to
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

/** Objective evidence the waiver still requires from this Design run's report. */
export function requireObjectiveEvidence(report) {
  if (!Array.isArray(report?.screens) || !report.screens.length) throw Error('The owner waiver still requires the captured screens of this run');
  if (!Array.isArray(report.failures)) throw Error('The owner waiver requires the objective failure list of this run');
  if (report.failures.length) throw Error('Objective design/performance failures remain; the owner waiver covers subjective scores only');
  return report.screens.length;
}
