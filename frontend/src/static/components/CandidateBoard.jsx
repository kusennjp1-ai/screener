import CandidateCharts from './CandidateCharts';
import { memo, useMemo, useState } from 'react';
import { Button, Paper } from '@mui/material';
import { entryPlan } from '../researchEngine';

const number = (n, digits=1) => Number.isFinite(n) ? n.toLocaleString('en-US',{minimumFractionDigits:digits,maximumFractionDigits:digits}) : '—';
const stateOrder = state => ['買いゾーン内','ピボット待ち','買いゾーン超過','未判定','有効な買い水準なし','低変動・監視のみ','現金買収合意・購入対象外'].indexOf(state);
export default memo(function CandidateBoard({ranked,method,selectedSymbol,loading,onSelect,view='list',onView,date,generation,market,now,onCompare,paused}) {
  const [sort,setSort]=useState('rank');
  const [page,setPage]=useState(0);
  const ordered=useMemo(()=>{
    const values=ranked.map(item=>({...item,plan:entryPlan(item.row,null,method)}));
    if(sort==='rank') return values;
    const value=item=>sort==='distance' ? (item.plan.distance == null ? null : Math.abs(item.plan.distance)) : sort==='rs' ? item.row.rs_rating : sort==='volume' ? item.row.se_volume_vs_50d : stateOrder(item.plan.state);
    return values.sort((a,b)=>{const av=value(a),bv=value(b);return av==null ? (bv==null?0:1) : bv==null ? -1 : (av-bv)*(sort==='rs'||sort==='volume'?-1:1) || a.row.symbol.localeCompare(b.row.symbol);});
  },[ranked,method,sort]);
  const maxPage=Math.max(0,Math.ceil(ordered.length/50)-1), current=Math.min(page,maxPage);
  return <Paper component="section" id="candidate-board" tabIndex={-1} aria-label="候補リスト" className="research-panel research-list">
    <div className="candidate-board-heading"><h2>候補リスト <small>{loading?'—':ranked.length.toLocaleString()}件</small></h2>
      <label>並び順 <select aria-label="候補の並び順" value={sort} onChange={e=>{setSort(e.target.value);setPage(0);}}><option value="rank">選定・買い位置</option><option value="state">状態</option><option value="distance">ピボットに近い順</option><option value="rs">RSが高い順</option><option value="volume">出来高比が高い順</option></select></label>
    </div>
    <div className="candidate-view-switch" role="group" aria-label="候補の表示形式"><Button aria-pressed={view==='list'} onClick={()=>onView?.('list')}>一覧</Button><Button aria-pressed={view==='charts'} onClick={()=>onView?.('charts')}>チャート比較</Button></div>
    <p className="candidate-help">状態は価格位置です。購入条件の合格とは別に表示します。</p>
    {view==='charts' && !loading && <CandidateCharts ordered={ordered} {...{method,date,generation,market,now,paused}} onSelect={onCompare || onSelect} />}
    <div className="candidate-scroll" hidden={view!=='list'}><table aria-label="投資手法別の銘柄候補" className="candidate-table">
      <thead><tr><th>銘柄 / 株価</th><th>状態</th><th>ピボット比</th><th>RS / 出来高</th></tr></thead>
      <tbody>{ordered.slice(current*50,current*50+50).map(({row:r,assessment:a,plan:p})=><tr key={r.symbol} aria-selected={r.symbol===selectedSymbol}>
        <td><button onClick={()=>onSelect(r.symbol)} aria-label={`${r.symbol} の分析を表示`}>{r.symbol}</button><small>${number(r.current_price,2)}</small></td>
        <td><span>{p.state==='現金買収合意・購入対象外'?'買収・対象外':p.state==='低変動・監視のみ'?'低変動・監視':p.state}</span><small>選定 <span>{a.passed}/{a.total}</span>{a.unknown ? ` · 未確認${a.unknown}`:''}</small></td>
        <td>{Number.isFinite(p.distance)?`${p.distance>0?'+':''}${number(p.distance)}%`:'—'}</td>
        <td>{number(r.rs_rating,0)}<small>{Number.isFinite(r.se_volume_vs_50d)?`${number(r.se_volume_vs_50d,2)}倍`:'出来高 —'}</small></td>
      </tr>)}</tbody>
    </table></div>
    {!ranked.length && !loading && <p className="candidate-help">該当銘柄がありません。検索や「全条件通過のみ」を解除して確認できます。</p>}
    {view==='list' && maxPage>0 && <div className="candidate-pagination"><Button disabled={!current} onClick={()=>setPage(current-1)}>前の50件</Button><span>{current+1} / {maxPage+1}</span><Button disabled={current===maxPage} onClick={()=>setPage(current+1)}>次の50件</Button></div>}
  </Paper>;
});
