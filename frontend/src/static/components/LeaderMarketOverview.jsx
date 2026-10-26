import MetricDisclosure from './MetricDisclosure';
import { useId, useMemo } from 'react';
import { useResearchBundle } from '../useResearchBundle';
import { leaderMarketSummary } from '../leaderMarketSummary';
import { sectorHref } from '../sectorPresentation';
import '../leaderMarket.css';
const n=value=>Number.isFinite(value)?value.toLocaleString('ja-JP',{maximumFractionDigits:1}):'データなし';
export function LeaderMarketOverview({summary,loading=false,error=false}){
 const patternPrefix=useId().replace(/:/g,'');
 if(loading)return <section className="leader-market-overview" aria-label="LEADER市場概況"><p role="status">同じ公開版の市場集計を読み込み中…</p></section>;
 if(error||!summary?.available)return <section className="leader-market-overview" aria-label="LEADER市場概況"><h2>市場の判断材料</h2><p role="status">データなし。{error?'公開版の銘柄データを取得できません。':summary?.reason||'同じ基準日・公開版の対象銘柄を確認できません。'}</p></section>;
 const {totals,sectors=[],newHighLow,market={}}=summary,percent=totals.above50Percent;
 const highest=Math.max(1,...sectors.map(sector=>Number.isFinite(sector.buyPositions)?sector.buyPositions:0));
 return <section className="leader-market-overview" aria-label="LEADER市場概況">
  <header><div><small>市場の判断材料 · {summary.date}</small><h2>ミネルヴィニ市場概況</h2></div><p className="leader-market-regime">{market.label||'市場判定：未確認'}<span>既存の独自モデル · 公式IBD判定ではありません</span></p></header>
  <p className="leader-market-scope">{typeof summary.scope==='string'?summary.scope:'公開価格・流動性対象の米国株。市場全体ではありません。'}<br/>対象 {n(totals.universe)} · 選定 {n(totals.selected)} · 確認済み買い位置 {n(totals.buyPositions)}<br/>選定未確認 {n(totals.selectionUnknown)} · 選定済みの価格位置未確認 {n(totals.positionUnknown)}。確認済み0件は未確認銘柄の不在を意味しません。</p>
  <div className="leader-market-cards">
   <article aria-label="50日線上の割合"><MetricDisclosure summary={<span><h3>50日線上</h3><strong>{Number.isFinite(percent)?`${n(percent)}%`:'データなし'}</strong></span>}>{Number.isFinite(percent)&&<svg viewBox="0 0 240 24" role="img" aria-label={`同日検証済み ${n(totals.verified)}銘柄中、50日線上 ${n(totals.above50)}銘柄`}><rect x="0" y="8" width="240" height="8" rx="4" fill="var(--line)"/><rect x="0" y="8" width={Math.max(0,Math.min(100,percent))*2.4} height="8" rx="4" fill="var(--zone)"/></svg>}<p>観測 {n(totals.verified)} / 対象 {n(totals.universe)}。未検証 {n(Number.isFinite(totals.universe)&&Number.isFinite(totals.verified)?totals.universe-totals.verified:null)}。同値は「上」に含めません。</p></MetricDisclosure></article>
   <article aria-label="新高値と新安値"><MetricDisclosure summary={<span><h3>新高値 / 新安値</h3><strong><span className="leader-market-positive">{newHighLow?n(newHighLow.newHighs):'データなし'}</span><span> / </span><span className="leader-market-negative">{newHighLow?n(newHighLow.newLows):'データなし'}</span></strong></span>}><p>{newHighLow?`公開チャート集合 ${n(newHighLow.coverage)} / ${n(newHighLow.universe)} の近似観測。上の価格・流動性集団とは別です。`:newHighLow?.reason||'同日・同じ版の観測範囲を確認できません。'}</p></MetricDisclosure></article>
   <article aria-label="分配日"><MetricDisclosure summary={<span><h3>分配日 / 25営業日</h3><strong>データなし</strong></span>}><p>{summary.distribution?.reason||'指数・25営業日の観測範囲を確認できません。銘柄の参考値を市場指標に転用しません。'}</p></MetricDisclosure></article>
  </div>
  <section className="leader-market-sectors" aria-label="業種別買い位置ヒートマップ"><h3>業種別の買い位置</h3><p>選定条件通過かつ価格が買いゾーン内の件数。日次7条件通過や配分件数ではありません。</p><MetricDisclosure summary="ヒートマップの見方"><p className="leader-heatmap-legend" aria-label="ヒートマップの凡例">緑の濃淡・棒の長さ＝確認済み買い位置件数の相対量（業種RSではありません）。✓ 確認済み · 0 確認済みゼロ · ? 斜線は未確認あり。未確認をゼロとは扱いません。</p></MetricDisclosure><div className="leader-sector-tiles">{sectors.map((sector,index)=>{
 const uncertain=sector.selectionUnknown>0||sector.positionUnknown>0,zero=sector.buyPositions===0,ratio=Math.max(0,sector.buyPositions||0)/highest,pattern=`${patternPrefix}-${index}`;
 return <a key={sector.key} data-observation={uncertain?'partial':zero?'known-zero':'observed'} href={sectorHref(sector,summary.method||'minervini')} aria-label={`${sector.label||sector.key}：確認済み買い位置 ${n(sector.buyPositions)}、選定 ${n(sector.selected)}、対象 ${n(sector.universe)}、選定未確認 ${n(sector.selectionUnknown)}、価格位置未確認 ${n(sector.positionUnknown)}。${uncertain?'未確認あり、斜線表示。':zero?'確認済みゼロ。':'緑の濃淡は確認済み件数。'}業種の候補を比較`}>
 <svg viewBox="0 0 160 80" preserveAspectRatio="none" aria-hidden="true"><defs><pattern id={pattern} width="8" height="8" patternUnits="userSpaceOnUse"><path d="M0 8L8 0" stroke="var(--text-2)" strokeWidth="1" opacity=".14"/></pattern></defs><rect x="1" y="1" width="158" height="78" rx="8" fill="var(--ground)" stroke={uncertain?'var(--ext)':'var(--line)'} strokeDasharray={uncertain?'4 3':undefined}/>{!zero&&<rect x="2" y="2" width="156" height="76" rx="8" fill="var(--zone)" opacity={.06+.16*ratio}/>} {uncertain&&<rect x="2" y="2" width="156" height="76" rx="8" fill={`url(#${pattern})`}/>}<rect x="10" y="71" width={140*ratio} height="4" rx="2" fill="var(--zone)"/></svg>
 <span><b>{sector.label||sector.key}</b><strong>{n(sector.buyPositions)} <small>銘柄 {uncertain?'?':zero?'0確認':'✓'}</small></strong><small>選定 {n(sector.selected)} / 対象 {n(sector.universe)}</small><small>選定未確認 {n(sector.selectionUnknown)} · 位置未確認 {n(sector.positionUnknown)}</small></span></a>;
 })}</div><details><summary>業種ごとの確認範囲と数値</summary><ul>{sectors.map(sector=><li key={sector.key}><b>{sector.label||sector.key}</b>：買い位置 {n(sector.buyPositions)} / 選定 {n(sector.selected)} / 対象 {n(sector.universe)}、選定未確認 {n(sector.selectionUnknown)}、買い位置未確認 {n(sector.positionUnknown)}、対象外 {n(sector.notApplicable)}</li>)}</ul></details></section>
  <section className="leader-market-history" aria-label="買い位置数の推移"><MetricDisclosure summary={<span><h3>買い位置数の推移</h3><strong>データなし</strong></span>}><p>{summary.history?.reason||'同じ定義・観測範囲の履歴がありません。セットアップ候補やブレイク代理件数を代用しません。'}</p></MetricDisclosure></section>
  <details className="leader-market-provenance"><summary>対象範囲・出所・基準日時</summary><p>基準日 {summary.date} · 公開版 {summary.generation||'未確認'}。原データ取得日時：未確認。集計評価日時 {Number.isFinite(summary.evaluatedAt)?new Date(summary.evaluatedAt).toISOString():'未確認'}。公開生成時刻と取得日時は別です。</p><p>選定未確認 {n(totals.selectionUnknown)} · 買い位置未確認 {n(totals.positionUnknown)} · 対象外 {n(totals.notApplicable)}。未確認を合格または観測ゼロに数えません。</p><p>集計から除外：重複銘柄 {n(summary.excluded?.duplicateSymbols)}、基準日不一致 {n(summary.excluded?.mismatchedRows)}、識別不備 {n(summary.excluded?.invalidRows)}。</p><p>新高値・新安値は現在の公開銘柄集合による近似です。過去当時の全銘柄を再現した統計ではありません。既存の市場判断の根拠欄で観測範囲と限界を確認してください。</p></details>
 </section>;
}
export default function ConnectedLeaderMarketOverview({marketEntry,generation,breadthEvidence}){
 const path=marketEntry.assets?.research?.path||marketEntry.pages?.scan?.path;
 const bundle=useResearchBundle(path,marketEntry.as_of_date,generation,marketEntry.publication);
 const summary=useMemo(()=>bundle.data?leaderMarketSummary({rows:bundle.data.rows,date:marketEntry.as_of_date,generation,now:bundle.evaluatedNow,method:'minervini',breadthEvidence}):null,[bundle.data,marketEntry.as_of_date,generation,bundle.evaluatedNow,breadthEvidence]);
 return <LeaderMarketOverview summary={summary} loading={Boolean(path)&&bundle.isLoading} error={bundle.isError}/>;
}
