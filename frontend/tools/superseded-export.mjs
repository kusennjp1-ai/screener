import { lstat, unlink } from 'node:fs/promises';
import { resolve, sep } from 'node:path';

// A hash-addressed export replaces the output its INPUT manifest referenced
// for the same family instead of leaving one more generation per run. Only
// that exact referenced file can be removed here, and only when:
//   - it carries this family's generated name (anything else is left alone),
//   - this export wrote a different name for the family, and
//   - nothing in the new manifest still names it.
// Unreferenced leftovers from older runs are never touched, so paired builds
// (baseline/corrected, baseline/carried) apply the same rule on both sides in
// every mode. A referenced generated file that is missing fails closed.
export const SUPERSEDED_FAMILIES = Object.freeze({
  workbench: /^workbench-[a-f0-9]{16}\.json$/,
  workbench_summary: /^workbench-summary-[a-f0-9]{16}\.json$/,
  candidate_performance: /^candidate-performance-[a-f0-9]{16}\.json$/,
  market_trends_series: /^market-trends\/series-[a-f0-9]{64}\.json$/,
  market_trends_source: /^market-trends\/source-[a-f0-9]{64}\.json$/,
  market_trends_history_source: /^market-trends\/history-source-[a-f0-9]{64}\.json$/,
});

function names(value, found = new Set()) {
  if (typeof value === 'string') found.add(value);
  else if (Array.isArray(value)) for (const item of value) names(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) names(item, found);
  return found;
}

export function isGeneratedOutput(family, path) {
  const pattern = SUPERSEDED_FAMILIES[family];
  if (!pattern) throw Error(`Unknown superseded export family: ${family}`);
  return typeof path === 'string' && pattern.test(path);
}

// Each replacement is {family, previous, current}: previous is the path the
// input manifest referenced (read before the export overwrote its reference),
// current is the path this export now references (null when it wrote none).
export async function removeSupersededOutputs({ root, references, replacements }) {
  const base = resolve(root), referenced = names(references);
  const removed = [];
  for (const { family, previous, current } of replacements) {
    if (!isGeneratedOutput(family, previous) || previous === current || referenced.has(previous)) continue;
    const path = resolve(base, previous);
    if (!path.startsWith(base + sep)) throw Error(`Superseded ${family} escapes the data root`);
    let info;
    try { info = await lstat(path); } catch (error) {
      if (error.code === 'ENOENT') throw Error(`Input manifest references a missing ${family} output: ${previous}`);
      throw error;
    }
    if (!info.isFile() || info.isSymbolicLink()) throw Error(`Superseded ${family} is not a regular file: ${previous}`);
    await unlink(path);
    removed.push(previous);
  }
  return removed;
}
