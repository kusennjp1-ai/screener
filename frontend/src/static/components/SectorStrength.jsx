import { useResearchBundle } from '../useResearchBundle';
import { useStaticManifest } from '../dataClient';
import { sectorStrength } from '../sectorStrength';
import SectorRotation from './SectorRotation';
import { useMemo, useState } from 'react';
import { Alert,useMediaQuery } from '@mui/material';
import { useWorkbench } from '../useWorkbench';
import { rankedSectors,sectorBar,sectorChange,sectorHref,sectorNumber,sectorReadings,sectorValue } from '../sectorPresentation';

function RelativeBar({value}) {
  const bar=sectorBar(value);
  if(!bar)return <span className="sector-relative-missing">未確認</span>;
  return <span className="sector-relative" role="img" aria-label={`相対価格指数 ${sectorNumber(value)}、100はSPYと同等${bar.clipped?'。棒の表示範囲外':''}`}>
    <span className="sector-relative-plot"><i className="sector-relative-center"/><i className={`sector-relative-fill ${bar.positive?'positive':'negative'}`} style={{left:`${bar.left}%`,width:`${bar.width}%`}}/>
      <strong className={`sector-relative-value ${bar.positive?'positive':'negative'}`} style={{left:`${bar.end}%`}}>{sectorNumber(value)}{bar.clipped?'↔':''}</strong>
    </span>
  </span>;
}
function Rate({rate,small}) {
  if(!rate)return <span className="sector-rate" role="img" aria-label="現在の条件通過率は未確認">未確認</span>;
  return <span className="sector-rate" role="img" aria-label={`条件通過率 ${sectorNumber(rate.percent)}${rate.percent==null?'':'%'}。通過${rate.pass}、全対象${rate.total}、未確認${rate.unknown}銘柄${small?'。10銘柄未満の少数標本':''}`}>
    <span className="sector-rate-top"><i aria-hidden="true"><b style={{width:`${Number.isFinite(rate.percent)?Math.max(0,Math.min(100,rate.percent)):0}%`}}/></i><strong>{sectorNumber(rate.percent)}{rate.percent==null?'':'%'}</strong></span>
    <small><span>{rate.pass} / {rate.total}</span><span className="sector-rate-missing"> · 未確認{rate.unknown}{small?' *':''}</span></small>
  </span>;
}
function Reading({groups,render}) {return groups.length?groups.slice(0,3).map(render).join('、'):'該当なし';}
export default function SectorStrength({entry}) {
  const query=useWorkbench(entry),[period,setPeriod]=useState('63'),[method,setMethod]=useState('minervini'),[view,setView]=useState('bars');
  const [highlight,setHighlight]=useState(null);
  const isMobile=useMediaQuery('(max-width:700px)');
  const manifest=useStaticManifest();
  const bundle=useResearchBundle(entry?.assets?.research?.path,entry?.as_of_date,manifest.data?.research_generation || manifest.data?.generated_at);
  const publishedSectors=query.data?.sectors;
  const sectors=useMemo(()=>{
    if(!publishedSectors)return null;
    const current=bundle.data ? new Map(sectorStrength(bundle.data.rows,null,bundle.data.date,bundle.evaluatedNow).groups.map(group=>[group.key,group])) : null;
    return {...publishedSectors,groups:publishedSectors.groups.map(group=>({...group,rates:current?.get(group.key)?.rates || {},small:current?.get(group.key)?.small ?? false}))};
  },[publishedSectors,bundle.data,bundle.evaluatedNow]);
  const groups=useMemo(()=>rankedSectors(sectors?.groups || [],period),[sectors,period]);
  const readings=useMemo(()=>sectorReadings(groups,period,method),[groups,period,method]);
  if(query.isError)return <Alert severity="error">業種データの基準日または取得状態を確認できません。</Alert>;
  if(!sectors)return <p>業種の相対強度を読み込み中…</p>;
  return <section className="sector-strength" aria-label="業種の相対強度と通過率">
    <header className="sector-heading"><div className="research-kicker">市場 · 業種の強さ · {entry.as_of_date || sectors.as_of || '未確認'}</div><h1>{readings.heading}</h1><p className="sector-subheading">{readings.subheading}</p>
      {!bundle.data&&<p role="status">{bundle.isError||!entry?.assets?.research?.path?'現在の財務根拠を確認できません。':'現在の財務根拠を再確認しています。'}条件通過率は未確認です。</p>}
    </header>
    <div className="sector-controls">
      <label>期間<select value={period} onChange={e=>setPeriod(e.target.value)} aria-label="相対強度の期間"><option value="63">63営業日</option><option value="126">126営業日</option></select></label>
      <label>選定方式<select value={method} onChange={e=>setMethod(e.target.value)}><option value="minervini">ミネルヴィニ</option><option value="minervini2">基本と原則</option><option value="oneil">オニール / CAN SLIM</option><option value="ibd">IBD型リーダー</option></select></label>
      <div className="sector-view" role="group" aria-label="業種の表示形式"><button aria-pressed={view==='bars'} onClick={()=>setView('bars')}>順位と棒</button><button aria-pressed={view==='table'} onClick={()=>setView('table')}>表</button></div>
    </div>
    <div className="sector-dashboard">
      <div className="sector-list-panel">
        {view==='table' ? <div className="sector-table-scroll"><table aria-label="業種の相対強度一覧"><thead><tr><th>業種 / 代理ETF</th><th>相対指数</th><th>21日変化</th><th>通過 / 全対象</th></tr></thead><tbody>{groups.map(g=><tr key={g.key} data-highlight={highlight===g.key} onMouseEnter={()=>setHighlight(g.key)} onMouseLeave={()=>setHighlight(null)}><th><a href={sectorHref(g,method)} onFocus={()=>setHighlight(g.key)} onBlur={()=>setHighlight(null)}>{g.label} / {g.etf||'—'}</a></th><td>{sectorNumber(sectorValue(g,period))}</td><td>{sectorChange(g.momentum21?.value==null?null:g.momentum21.value-100)}</td><td><Rate rate={g.rates[method]} small={g.small}/></td></tr>)}</tbody></table></div> : <>
          <div className="sector-rank-head" aria-hidden="true"><span>業種 · 代理ETF</span><span className="sector-index-heading"><span className="sector-index-desktop">80 ← 相対指数100 → 120</span><span className="sector-index-mobile">指数（100=SPY）</span></span><span className="sector-momentum-head">21日の変化</span><span>条件通過率</span></div>
          <ol className="sector-rank-list" aria-label="相対指数順の業種一覧">{groups.map((g,index)=>{
            const value=sectorValue(g,period),momentum=g.momentum21?.value==null?null:g.momentum21.value-100,rate=g.rates[method];
            return <li key={g.key} data-highlight={highlight===g.key} onMouseEnter={()=>setHighlight(g.key)} onMouseLeave={()=>setHighlight(null)}><a className="sector-rank-row" href={sectorHref(g,method)} onFocus={()=>setHighlight(g.key)} onBlur={()=>setHighlight(null)} aria-label={`${Number.isFinite(value)?`${index+1}位、`:''}${g.label}、相対指数 ${sectorNumber(value)}、21日変化 ${sectorChange(momentum)}、${rate ? `条件通過 ${rate.pass} / ${rate.total}、未確認 ${rate.unknown}` : '現在の条件通過率は未確認'}。候補を見る`}>
              <span className="sector-name"><strong>{g.label}</strong><small>{g.etf||'代理ETFなし'}</small><span className={`sector-mobile-momentum ${momentum==null?'':momentum>=0?'positive':'negative'}`}>{momentum==null?'21日未確認':`${momentum>0?'↑':momentum<0?'↓':'→'} ${sectorChange(momentum)}`}</span></span>
              <RelativeBar value={value}/><span className={`sector-momentum ${momentum==null?'':momentum>=0?'positive':'negative'}`}>{momentum==null?'未確認':`${momentum>0?'↑':momentum<0?'↓':'→'} ${sectorChange(momentum)}`}</span><Rate rate={rate} small={g.small}/>
            </a></li>;
          })}</ol>
        </>}
        <p className="sector-list-note">未確認は分母に含め、通過には含めません。* 10銘柄未満。棒は80〜120に制限し、実際の指数はそのまま表示。</p>
      </div>
      <aside className="sector-aside" aria-label="業種データの読み方">
        <SectorRotation groups={groups} period={period} highlight={highlight} onHighlight={setHighlight} compact={isMobile}/>
        <details className="sector-readings" open={!isMobile}><summary>今日の読み方</summary><dl>
          <div><dt className="positive">追い風（指数100超）</dt><dd><Reading groups={readings.tailwind} render={g=>`${g.label}（${sectorNumber(sectorValue(g,period))}）`}/></dd></div>
          <div><dt className="negative">逆風（指数95未満）</dt><dd><Reading groups={readings.headwind} render={g=>`${g.label}（${sectorNumber(sectorValue(g,period))}）`}/></dd></div>
          <div><dt className="improving">改善中（100未満・21日上昇）</dt><dd><Reading groups={readings.improving} render={g=>`${g.label}（${sectorChange(g.momentum21.value-100)}）`}/></dd></div>
          <div><dt>通過率が高い業種</dt><dd><Reading groups={readings.highPass} render={g=>`${g.label} ${sectorNumber(g.rates[method].percent)}%`}/></dd></div>
        </dl></details>
      </aside>
    </div>
    <details className="market-disclosure sector-disclosure"><summary>計算方法・対象範囲・欠損の扱い</summary><p>指数＝100 ×（当日のETF終値 / SPY終値）÷（{period}営業日前のETF終値 / SPY終値）。100が基点です。21日変化は同じ式で計算した直近21営業日の指数から100を引いた値。配当込みリターンではありません。</p><p>ETFは業種の代理です。銘柄分類の集計対象とETF構成は一致しません。通過率の分母は株価10ドル以上・平均売買代金2,000万ドル以上の全対象銘柄。分類不明は別集計です。少数標本は解釈に注意してください。</p><p>価格出典：{sectors.source||'未取得'} / 取得：{sectors.retrieved_at||'未確認'} / 調整：分割調整済み終値・配当調整なし。同日・同じ調整方針で取得し、途中の日足が欠ける場合は相対指数を表示しません。IBD公式RSではありません。</p></details>
  </section>;
}
