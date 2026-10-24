import { assessmentSummary, entryPosition } from './researchEngine.js';
import { auditValues, hasVerifiedDailyBars } from './qualificationAudit.js';
import { liquidState, HISTORY_METHODS } from './candidateHistory.js';
import { sectorKey, SECTORS } from './sectorDefinitions.js';
import { modelMarket } from './portfolioPlan.js';
import { BOOK_MARKET_VERSION } from './bookMarketEvidence.js';
import { validEvidenceDay, validClock } from './evidenceTime.js';

const positive = value => Number.isFinite(value) && value > 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const empty = () => ({ universe:0, selected:0, buyPositions:0, selectionUnknown:0, notApplicable:0, positionUnknown:0, verified:0, above50:0 });
const finish = value => ({...value, above50Percent:value.verified ? value.above50/value.verified*100 : null, unverified:value.universe-value.verified, coveragePercent:value.universe ? value.verified/value.universe*100 : null});
const missing = () => ({
  distribution:{available:false,reason:'指数・基準日・25営業日の観測範囲を確認できません。銘柄別の分配日値は代用しません。'},
  history:{available:false,points:[],reason:'同じ定義で保存した買い位置数の履歴がありません。形状・上放れ代理件数は代用しません。'},
});
export function leaderMarketSummary({rows,date,generation,now,method='minervini',breadthEvidence} = {}) {
  const base={date,generation,method,scope:'米国の公開価格・流動性対象（株価10ドル以上・平均売買代金2,000万ドル以上）。市場全体ではありません。',...missing()};
  if (!Array.isArray(rows)||!validEvidenceDay(date)||typeof generation!=='string'||!generation.trim()||!validClock(now)||!HISTORY_METHODS.includes(method)) {
    return {...base,available:false,reason:'同じ公開版の銘柄データ・基準日・評価日時を確認できません。',totals:null,sectors:[],market:null,newHighLow:null};
  }
  const frequency=new Map();
  for(const row of rows)if(typeof row?.symbol==='string'&&row.symbol.trim())frequency.set(row.symbol,(frequency.get(row.symbol)||0)+1);
  const excluded={duplicateSymbols:[...frequency.values()].filter(n=>n>1).length,mismatchedRows:0,invalidRows:0};
  const unique=rows.filter(row=>{
    if(!row||typeof row.symbol!=='string'||!row.symbol.trim()){excluded.invalidRows++;return false;}
    if(frequency.get(row.symbol)!==1)return false;
    if(row.as_of_date!=null&&row.as_of_date!==date){excluded.mismatchedRows++;return false;}
    return row.market==='US'||!row.market;
  });
  const totals=empty(), groups=new Map([...SECTORS,['Unknown','分類不明']].map(([key,label])=>[key,{key,label,...empty()}]));
  for(const row of unique.filter(row=>liquidState(row)===true)) {
    const group=groups.get(sectorKey(row.gics_sector)), assessment=assessmentSummary(row,method,now);
    const auditCurrent=hasVerifiedDailyBars(row,date), values=auditCurrent?auditValues(row):{};
    const verified=positive(values.close)&&positive(values.sma50);
    const notApplicable=assessment.method_status==='not_applicable';
    const unknown=!notApplicable&&(!auditCurrent||assessment.unknown>0||assessment.method_status==='quarantined');
    const selected=!unknown&&!notApplicable&&assessment.qualified;
    const position=selected?entryPosition(row,null,method):null;
    for(const target of [totals,group]) {
      target.universe++;
      if(verified){target.verified++;if(values.close>values.sma50)target.above50++;}
      if(notApplicable)target.notApplicable++;
      if(unknown)target.selectionUnknown++;
      if(selected){target.selected++;if(position.state==='買いゾーン内')target.buyPositions++;
        else if(!Number.isFinite(position.distance))target.positionUnknown++;}
    }
  }
  const evidence=breadthEvidence, latest=evidence?.latest;
  const newHighLow=evidence?.version===BOOK_MARKET_VERSION&&evidence.as_of_date===date&&latest?.date===date&&
    count(latest.newHighs)&&count(latest.newLows)&&count(latest.coverage)&&count(latest.expectedUniverseSize)&&latest.coverage>0&&
    latest.coverage<=latest.expectedUniverseSize&&latest.newHighs<=latest.coverage&&latest.newLows<=latest.coverage
    ? {newHighs:latest.newHighs,newLows:latest.newLows,coverage:latest.coverage,universe:latest.expectedUniverseSize,date,approximate:true,
      scope:'現在の公開チャート集合で観測した52週高値・安値。市場全体ではなく、価格・流動性対象の母集団とも異なります。',
      note:'近似計算：現在の公開集合を過去に適用。元データの取得日時・当時の構成銘柄は未確認。',sources:evidence.sources??null} : null;
  return {...base,available:true,evaluatedAt:now,excluded,totals:finish(totals),sectors:[...groups.values()].map(finish),market:modelMarket(unique),newHighLow};
}
