// A hold can remove publication authority, never grant it. Candidate/predecessor
// pins are for review and eventual clearance, not predicates for applying a hold.
import { lstatSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { contract, digest, parseCorrectionIntent } from './financial-correction.mjs';

export const HOLD_PATH = '.github/pending-financial-correction.json';
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const sha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

export function parsePendingCorrection(value) {
  if (!exact(value, ['schema_version', 'status', 'reason', 'candidate_ui', 'correction'])
    || value.schema_version !== 'pending-financial-correction-v1' || value.status !== 'pending'
    || value.reason !== 'review_corrected_candidate_before_ui_promotion'
    || !exact(value.candidate_ui, ['sha', 'tree']) || !sha(value.candidate_ui.sha) || !sha(value.candidate_ui.tree)) {
    throw Error('Invalid pending financial correction hold');
  }
  parseCorrectionIntent(JSON.stringify(value.correction));
  if (value.correction.schema_version !== contract.schema_version) throw Error('Unknown correction hold contract');
  return value;
}

export function readPendingCorrection(root = process.cwd()) {
  const path = join(root, HOLD_PATH);
  // Malformed, removed/unknown candidate refs, stale predecessor and changed
  // candidate trees cannot accidentally turn the hold off.
  try {
    const stat = lstatSync(path);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16384) throw Error('Invalid hold file');
    const bytes = readFileSync(path, 'utf8');
    return { active: true, record: parsePendingCorrection(JSON.parse(bytes)), sha256: digest(JSON.parse(bytes)) };
  } catch (error) {
    if (error.code === 'ENOENT') {
      // lstat follows no links: a broken symlink is a present invalid hold.
      try { lstatSync(path); } catch (missing) { if (missing.code === 'ENOENT') return null; }
    }
    return { active: true, invalid: true };
  }
}

export function applyPendingCorrectionHold(decision, hold) {
  if (!hold?.active || !decision.publish || decision.mode !== 'ui') return decision;
  const { approval, ...held } = decision;
  void approval;
  return { ...held, mode: 'data', pendingFinancialCorrection: true,
    reason: 'Pending financial correction holds every new UI; only validated data advances on the published UI may proceed' };
}
