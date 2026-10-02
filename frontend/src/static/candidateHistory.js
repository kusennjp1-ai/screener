import { assess } from './researchEngine.js';

export const HISTORY_METHODS = ['minervini', 'minervini2', 'oneil', 'ibd'];
export const CHANGE_LABELS = { new: '今回通過', continued: '継続', returned: '再通過', dropped: '脱落', incomparable: '比較不能', unchanged: '未通過のまま' };
export const UNIVERSE_VERSION = 'us-published-equities-price10-adv20m-v1';
export const liquidState = row => !Number.isFinite(row.current_price) || !Number.isFinite(row.adv_usd) ? null : row.current_price >= 10 && row.adv_usd >= 20000000;
const knownSelectionState = result => result?.state === 'pass' || result?.state === 'fail';
const validRule = tuple => Array.isArray(tuple) && ['pass', 'fail', 'unknown'].includes(tuple[0]);
export function selectionState(assessment) {
  // Missing evidence takes precedence over failure for change attribution.
  return assessment.unknown ? 'unknown' : assessment.qualified ? 'pass' : 'fail';
}
export function selectionSnapshot(rows, meta) {
  const definitions = {};
  const records = [...rows].sort((a,b)=>a.symbol.localeCompare(b.symbol)).map(row => {
    const methods = {};
    for (const method of HISTORY_METHODS) {
      const a = assess(row, method);
      definitions[method] ||= a.rules.map((r,i)=>({id:`${method}:${i+1}`,label:r.label,unit:r.unit || ''}));
      methods[method] = {state:selectionState(a), rules:a.rules.map(r=>[r.state,r.value ?? null,r.evidence ?? null])};
    }
    return {symbol:row.symbol, market:row.market || 'US', liquid:liquidState(row), methods};
  });
  return {schema_version:1, ...meta, universe_version:UNIVERSE_VERSION, definitions, records};
}
export function compareSnapshots(current, previous, history = []) {
  const compatible = previous && previous.as_of < current.as_of && previous.rule_version === current.rule_version && previous.universe_version === current.universe_version;
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
