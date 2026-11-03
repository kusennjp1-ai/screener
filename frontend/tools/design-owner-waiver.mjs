// Owner waiver for the subjective screenshot scores in check-design-review.mjs.
// It never covers functional, accessibility or layout checks: the brief report must
// still hold every required capture and no objective failure. Measured timing
// overruns (report.timing_warnings) pass only as deferred warnings when the owner's
// timing approval is recorded in the same file. Delete the file to require scored
// screenshot reviews again.
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyBriefReport } from './brief-design-contract.mjs';

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
  if (value.timing_instruction !== undefined || value.timing_granted_at !== undefined) {
    if (typeof value.timing_instruction !== 'string' || !value.timing_instruction.trim()) fail('timing_instruction must be the owner\'s instruction');
    if (typeof value.timing_granted_at !== 'string' || !Number.isFinite(Date.parse(value.timing_granted_at))) fail('timing_granted_at must be a timestamp');
  }
  return value;
}

/** The validated waiver, or null when none is committed. An unreadable or invalid file fails closed. */
export async function readOwnerWaiver(directory) {
  let text;
  try { text = await readFile(resolve(directory, OWNER_WAIVER_FILE), 'utf8'); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  return validateOwnerWaiver(JSON.parse(text));
}

/** True only when the owner's approval to defer measured timing overruns is recorded. */
export const timingDeferralApproved = waiver => Boolean(waiver?.timing_instruction?.trim() && Number.isFinite(Date.parse(waiver?.timing_granted_at)));

/**
 * Objective evidence every gate still requires from this Design run (see
 * verifyBriefReport). Timing warnings are allowed only under a recorded owner
 * timing approval. Returns the capture count and the deferred timing warnings.
 */
export async function requireObjectiveEvidence(report, output, waiver = null) {
  const warnings = await verifyBriefReport(report, output);
  if (warnings.length && !timingDeferralApproved(waiver)) {
    throw Error(`Measured timing overruns are deferred only under the owner's recorded timing approval: ${warnings.join('; ')}`);
  }
  return { captures: report.screens.length, warnings };
}
