import { assessmentSummary } from './researchEngine.js';
import { liquidState, selectionState } from './candidateHistory.js';

import { SECTORS, sectorKey } from './sectorDefinitions.js';
export { SECTORS } from './sectorDefinitions.js';
export function relativeIndex(bars, benchmark, asOf, lookback, compatible) {
  if (!compatible) return {value:null,reason:'価格の調整方針を確認できません'};
  const dates=benchmark.filter(b=>b.date<=asOf).slice(-(lookback+1));
  const prices=new Map(bars.map(b=>[b.date,b.close]));
  if(dates.length!==lookback+1 || dates.at(-1)?.date!==asOf || dates.some((b,i)=>!(b.close>0) || !(prices.get(b.date)>0) || (i>0&&b.date<=dates[i-1].date))) return {value:null,reason:'期間内の日足が不足・不整合です'};
  const first=dates[0], last=dates.at(-1);
  const base=prices.get(first.date)/first.close;
  return {value:100*(prices.get(last.date)/last.close)/base,from:first.date,to:last.date,sessions:lookback};
}
export function sectorStrength(rows, prices, asOf) {
  const benchmark=prices?.as_of_date===asOf ? prices.series?.SPY || [] : [];
  const groups=[...SECTORS,['Unknown','分類不明',null]];
  return {as_of:asOf,source:prices?.source || null,retrieved_at:prices?.retrieved_at || null,adjustment:prices?.adjustment || null,
    classification:'当日の配信銘柄分類を固定。ETF構成銘柄とは異なります。',
    groups:groups.map(([key,label,etf])=>{
      const members=rows.filter(r=>(sectorKey(r.gics_sector)===key) && liquidState(r)===true);
      const rates=Object.fromEntries(['minervini','minervini2','oneil','ibd'].map(method=>{
        const states=members.map(r=>selectionState(assessmentSummary(r,method)));
        const pass=states.filter(s=>s==='pass').length,unknown=states.filter(s=>s==='unknown').length;
        return [method,{pass,total:members.length,unknown,percent:members.length?100*pass/members.length:null}];
      }));
      const values=Object.fromEntries([63,126].map(n=>[n,relativeIndex(prices?.series?.[etf] || [],benchmark,asOf,n,prices?.adjustment==='split-adjusted-close-no-dividend')]));
      const momentum=relativeIndex(prices?.series?.[etf] || [],benchmark,asOf,21,prices?.adjustment==='split-adjusted-close-no-dividend');
      return {key,label,etf,rates,relative:values,momentum21:momentum,small:members.length<10};
    })};
}
