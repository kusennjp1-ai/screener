import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { compareCurrentObservations, selectionSnapshot } from '../src/static/candidateHistory.js';

const hash = value => createHash('sha256').update(value).digest('hex');
export async function workbenchRuleFingerprint() {
  const engines = ['researchEngine.js', 'qualificationAudit.js', 'financialHistory.js', 'financialCurrent.js', 'instrumentApplicability.js', 'evidenceTime.js', 'institutionalEvidence.js', 'candidateHistory.js'];
  const files = [...engines.map(file => new URL(`../src/static/${file}`, import.meta.url)),
    ...['static_financial_current_v1.json', 'financial_instrument_applicability_v1.json', 'native_annual_history_v1.json'].map(file => new URL(`../contracts/${file}`, import.meta.url))];
  return hash((await Promise.all(files.map(file => readFile(file, 'utf8')))).map(value => value.replace(/\r\n/g, '\n')).join('\n'));
}
export async function verifyWorkbenchComparison({ root, workbench, canonicalRows = null }) {
  root = resolve(root);
  const snapshot = async ref => {
    if (!/^candidate-history\/\d{4}-\d{2}-\d{2}-[a-f0-9]{16}\.json(?:\.gz)?$/.test(ref?.path || '')) throw Error('Unsafe comparison snapshot reference');
    const path = resolve(root, ref.path);
    if (!path.startsWith(root + sep)) throw Error('Comparison snapshot escaped data root');
    const raw = await readFile(path);
    if (hash(raw) !== ref.sha256) throw Error('Comparison snapshot digest mismatch');
    const value = JSON.parse(ref.path.endsWith('.gz') ? gunzipSync(raw) : raw);
    if (value.as_of !== ref.as_of) throw Error('Comparison snapshot date mismatch');
    return value;
  };
  const current = await snapshot(workbench.current_snapshot);
  if (current.rule_version !== await workbenchRuleFingerprint() || current.source_research_sha256 !== workbench.source_research_sha256) throw Error('Workbench comparison is not bound to the executing policy/research');
  if (canonicalRows) {
    const regenerated = selectionSnapshot(canonicalRows, {}, workbench.financial_evaluated_at);
    if (!isDeepStrictEqual(current.records, regenerated.records) || !isDeepStrictEqual(current.definitions, regenerated.definitions)) throw Error('Current comparison snapshot does not reproduce from canonical inputs');
  }
  let catalog;
  try { catalog = JSON.parse(await readFile(resolve(root, 'candidate-history/index.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; catalog = { snapshots: [] }; }
  const refs = catalog.snapshots.filter(ref => ref.as_of <= workbench.as_of).sort((a, b) => a.as_of.localeCompare(b.as_of));
  if (new Set(refs.map(ref => ref.as_of)).size !== refs.length) throw Error('Duplicate comparison history date');
  const previousRef = refs.filter(ref => ref.as_of < workbench.as_of).at(-1) || null;
  const firstRef = refs.find(ref => ref.as_of === workbench.as_of) || null;
  const previous = previousRef ? await snapshot(previousRef) : null;
  const recordedCurrent = firstRef ? { snapshot: await snapshot(firstRef), ref: firstRef } : null;
  const history = [];
  for (const ref of refs.filter(ref => ref.as_of < workbench.as_of)) {
    if (ref === previousRef) { history.push(previous); continue; }
    const value = await snapshot(ref);
    history.push({ ...value, records: value.records.map(record => ({ ...record,
      methods: Object.fromEntries(Object.entries(record.methods).map(([method, result]) => [method, { state: result.state }])) })) });
  }
  const expected = compareCurrentObservations({ current, currentRef: workbench.current_snapshot, recordedCurrent, previous, previousRef, history });
  for (const key of ['changes', 'daily_changes_snapshot', 'comparison_basis']) if (!isDeepStrictEqual(workbench[key], expected[key])) throw Error(`Workbench ${key} does not reproduce from current-policy original snapshots`);
  if (current.rule_version !== workbench.rule_version || current.universe_version !== workbench.universe_version || current.as_of !== workbench.as_of) throw Error('Workbench current policy differs from its snapshot');
  return expected.comparison_basis;
}
