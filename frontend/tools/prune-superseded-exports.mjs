// Remove export files that nothing references any more. Static Site runs this
// once, after `npm run build` and before the data-quality gate, on both
// public/static-data and dist/static-data. Each export run writes new
// hash-named workbench, workbench-summary, candidate-performance,
// market-trends and candidate-history files, and nothing removes the earlier
// ones, so they would otherwise be published.
//
// Kept: the manifest's workbench, summary, candidate-performance and
// market-trends series, its source_path and history-source-<long_history.
// source_sha256>, every catalog snapshot and the workbench's current snapshot,
// every snapshot a completed candidate-performance-history cohort was measured
// from (the release's history reconciliation re-reads it after it leaves the
// catalog), and any file of these families that a referenced document names. A family
// the manifest does not reference at all is left unchanged. Every root must
// resolve all of its references before anything is removed; a missing or
// changed referenced file fails the run. Nothing outside these five families
// is touched (the top-level market-history-source.json and
// market-trend-source.json stay).
// Usage: node tools/prune-superseded-exports.mjs [--dry-run] STATIC_DATA...
import { lstat, readdir, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { exportFamilyOf, exportStatus, referencedExports } from './export-references.mjs';

async function names(root, directory) {
  try { return (await readdir(join(root, directory))).map(name => directory ? `${directory}/${name}` : name); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}

/** Which export files under one static-data root are superseded. Read-only. */
export async function planPrune(root) {
  root = resolve(root);
  const references = await referencedExports(root);
  const remove = [], keep = [], unchanged = new Set();
  const paths = [...await names(root, ''), ...await names(root, 'market-trends'), ...await names(root, 'candidate-history')].sort();
  for (const path of paths) {
    const family = exportFamilyOf(path);
    if (!family) continue;
    const status = exportStatus(references, path);
    const info = await lstat(join(root, path));
    if (!info.isFile() || info.isSymbolicLink()) throw Error(`Export path is not a regular file: ${path}`);
    if (status === 'no-reference') unchanged.add(family);
    (status === 'superseded' ? remove : keep).push({ path, family, status, bytes: info.size });
  }
  for (const [family, referenced] of Object.entries(references.families)) {
    for (const path of referenced || []) if (!keep.some(item => item.path === path)) throw Error(`Referenced ${family} file is not listed: ${path}`);
  }
  return { root, remove, keep, unchanged: [...unchanged].sort(), lineage: [...references.lineageSnapshots].sort() };
}

/**
 * Plan every root first, then remove. A root whose references do not resolve
 * stops the run before any root is changed.
 */
export async function pruneSupersededExports(roots, { dryRun = false } = {}) {
  const resolved = roots.map(root => resolve(root));
  if (!resolved.length) throw Error('No static-data root given');
  if (new Set(resolved).size !== resolved.length) throw Error('Duplicate static-data root');
  const plans = [];
  for (const root of resolved) plans.push(await planPrune(root));
  if (dryRun) return plans;
  for (const plan of plans) {
    for (const item of plan.remove) await unlink(join(plan.root, item.path));
    // The pruned tree must still resolve every reference and keep every
    // performance lineage snapshot it had.
    const after = await referencedExports(plan.root);
    for (const path of plan.lineage) if (!after.lineageSnapshots.has(path)) throw Error(`Prune lost a performance lineage snapshot: ${path}`);
  }
  return plans;
}

export function formatPrune(plan, dryRun = false) {
  const bytes = plan.remove.reduce((sum, item) => sum + item.bytes, 0);
  const counts = {};
  for (const item of plan.remove) counts[item.family] = (counts[item.family] || 0) + 1;
  const lines = [`${dryRun ? 'Would prune' : 'Pruned'} ${plan.remove.length} superseded export files (${bytes.toLocaleString('en-US')} bytes) from ${plan.root}`
    + (plan.remove.length ? `: ${Object.entries(counts).map(([family, count]) => `${family} ${count}`).join(', ')}` : '')];
  for (const item of plan.remove) lines.push(`  ${item.bytes.toLocaleString('en-US').padStart(13)} ${item.path}`);
  if (plan.unchanged.length) lines.push(`  Left unchanged (the manifest references no file of the family): ${plan.unchanged.join(', ')}`);
  lines.push(`  Kept ${plan.keep.length} referenced export files`);
  return lines;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), dryRun = args[0] === '--dry-run', roots = dryRun ? args.slice(1) : args;
  if (!roots.length || roots.some(root => root.startsWith('-'))) throw Error('Usage: node tools/prune-superseded-exports.mjs [--dry-run] STATIC_DATA...');
  for (const plan of await pruneSupersededExports(roots, { dryRun })) for (const line of formatPrune(plan, dryRun)) console.log(line);
}
