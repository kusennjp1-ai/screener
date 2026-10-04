import { INSTRUMENT_APPLICABILITY_VERSION } from './instrumentApplicability.js';
import { assess } from './researchEngine.js';

export const HISTORY_METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];
export const CHANGE_LABELS = { new: '今回通過', continued: '継続', returned: '再通過', dropped: '脱落', incomparable: '比較不能', unchanged: '未通過のまま' };
export const UNIVERSE_VERSION = 'us-published-equities-price10-adv20m-v1';
export const liquidState = row => !Number.isFinite(row.current_price) || !Number.isFinite(row.adv_usd) ? null : row.current_price >= 10 && row.adv_usd >= 20000000;
const knownSelectionState = result => result?.state === 'pass' || result?.state === 'fail';
const validRule = tuple => Array.isArray(tuple) && ['pass', 'fail', 'unknown'].includes(tuple[0]);
export function selectionState(assessment) {
  // Missing evidence takes precedence over failure for change attribution.
  return assessment.method_status === 'not_applicable' ? 'not_applicable' : assessment.method_status === 'quarantined' ? 'unknown' : assessment.unknown ? 'unknown' : assessment.qualified ? 'pass' : 'fail';
}
export function selectionSnapshot(rows, meta, now = Date.now()) {
  const definitions = {};
  const records = [...rows].sort((a,b)=>a.symbol.localeCompare(b.symbol)).map(row => {
    const methods = {};
    for (const method of HISTORY_METHODS) {
      const a = assess(row, method, now);
      definitions[method] ||= a.rules.map((r,i)=>({id:`${method}:${i+1}`,label:r.label,unit:r.unit || ''}));
      methods[method] = {state:selectionState(a), rules:a.rules.map(r=>[r.state,r.value ?? null,r.evidence ?? null])};
    }
    return {symbol:row.symbol, market:row.market || 'US', liquid:liquidState(row), methods};
  });
  return {schema_version:1, ...meta, universe_version:UNIVERSE_VERSION, instrument_applicability_version:INSTRUMENT_APPLICABILITY_VERSION, definitions, records};
}
export function compareSnapshots(current, previous, history = []) {
  return compareSnapshotStates(current, previous, history, true);
}
function compareSnapshotStates(current, previous, history, policyCompatible) {
  const compatible = policyCompatible && previous && previous.as_of < current.as_of && previous.rule_version === current.rule_version && previous.universe_version === current.universe_version && previous.instrument_applicability_version === current.instrument_applicability_version;
  const before = new Map((previous?.records || []).map(r=>[`${r.market}:${r.symbol}`,r]));
  const after = new Map(current.records.map(r=>[`${r.market}:${r.symbol}`,r]));
  const keys = [...new Set([...before.keys(),...after.keys()])].sort();
  const priorPass = new Set();
  for (const snapshot of history) if (snapshot.as_of < (previous?.as_of || '') && snapshot.rule_version === current.rule_version && snapshot.universe_version === current.universe_version) {
    for (const r of snapshot.records) if (r.liquid === true) for (const method of HISTORY_METHODS) if(r.methods?.[method]?.state === 'pass') priorPass.add(`${r.market}:${r.symbol}:${method}`);
  }
  return Object.fromEntries(HISTORY_METHODS.map(method => {
    const items = [];
    for (const key of keys) {
      const a=before.get(key), b=after.get(key);
      if(a?.liquid !== true && b?.liquid !== true) continue;
      const old=a?.methods?.[method], next=b?.methods?.[method];
      let state='incomparable', reason=null;
      if (!previous) reason='保存済みの前回判定がありません。初回通過とは判定しません。';
      else if (!compatible) reason='ルール版・対象範囲の定義が異なるため比較できません。';
      else if (!a || !b) reason='前回または今回の銘柄データが欠損しています。';
      else if (a.liquid !== true || b.liquid !== true) reason='流動性の対象範囲が変わった、または未確認です。';
      // Only explicit pass/fail observations support a transition. A present
      // object with a missing or unrecognized state is still missing evidence.
      else if (old?.state === 'not_applicable' || next?.state === 'not_applicable') reason='株式手法の対象範囲が異なるため、価格変化による通過・脱落として比較しません。';
      else if (!knownSelectionState(old) || !knownSelectionState(next)) reason='条件に未確認があるため、通過・脱落を断定しません。';
      else if (old.state==='pass' && next.state==='pass') state='continued';
      else if (old.state==='pass') state='dropped';
      else if (next.state==='pass') state=priorPass.has(`${key}:${method}`)?'returned':'new';
      else state='unchanged';
      const changes = compatible && Array.isArray(old?.rules) && Array.isArray(next?.rules) ? (current.definitions?.[method] || []).flatMap((def,i)=>{
        const x=old.rules[i], y=next.rules[i];
        return validRule(x) && validRule(y) && x[0]!==y[0] ? [{...def,before:x,after:y}] : [];
      }) : [];
      items.push({symbol:(b||a).symbol,state,reason,changes});
    }
    return [method,{counts:Object.fromEntries(Object.keys(CHANGE_LABELS).map(state=>[state,items.filter(i=>i.state===state).length])),items}];
  }));
}

const policyOf = snapshot => ({ rule_version: snapshot.rule_version, universe_version: snapshot.universe_version,
  instrument_applicability_version: snapshot.instrument_applicability_version ?? null });
const samePolicy = (snapshot, current) => snapshot && Object.entries(policyOf(current)).every(([key, value]) => (snapshot[key] ?? null) === value);
const observedSnapshot = (snapshot, ref) => {
  if (!snapshot || !ref || ref.as_of !== snapshot.as_of) throw Error('Comparison snapshot reference/date mismatch');
  return { ...ref, generated_at: snapshot.generated_at ?? null, policy: policyOf(snapshot) };
};

// Current events cannot reuse transitions computed under a previous financial
// policy. Within the same policy/date the first saved observation remains the
// event source, so a later financial correction cannot manufacture transitions.
export function compareCurrentObservations({ current, currentRef, recordedCurrent = null, previous = null, previousRef = null, history = [] }) {
  if (!/^[a-f0-9]{64}$/.test(current?.rule_version || '') || current.universe_version !== UNIVERSE_VERSION || current.instrument_applicability_version !== INSTRUMENT_APPLICABILITY_VERSION
    || currentRef?.as_of !== current.as_of) throw Error('Missing active comparison policy or date');
  if (recordedCurrent && recordedCurrent.snapshot.as_of !== current.as_of) throw Error('First recorded observation has a different price date');
  const first = recordedCurrent || { snapshot: current, ref: currentRef };
  const previousCompatible = samePolicy(previous, current), firstCompatible = samePolicy(first.snapshot, current);
  const saved = previousCompatible && firstCompatible;
  const selected = saved ? first.snapshot : current;
  const mode = !previous ? 'no_previous' : !saved ? 'incompatible_policy' : 'saved_first_same_policy';
  return {
    changes: compareSnapshotStates(selected, previous, history.filter(snapshot => samePolicy(snapshot, current)), Boolean(saved)),
    daily_changes_snapshot: saved ? first.ref : null,
    comparison_basis: { schema_version: 'current-policy-comparison-v1', mode, price_date: current.as_of,
      active_policy: policyOf(current), current_source: saved ? 'saved_first' : 'current_snapshot',
      saved_first: previous ? observedSnapshot(first.snapshot, first.ref) : null,
      previous: previous ? observedSnapshot(previous, previousRef) : null },
  };
}
