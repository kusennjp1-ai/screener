import { useMemo, useState } from 'react';
import MetricDisclosure from './MetricDisclosure';
import { institutionalRanking } from '../institutionalRanking';
import './marketCandidateDetails.css';

const source = 'https://www.investor.gov/introduction-investing/investing-basics/glossary/form-13f-reports-filed-institutional-investment';
export default function InstitutionalRanking({ranked, date, onSelect}) {
  const data = useMemo(() => institutionalRanking(ranked, date), [ranked, date]);
  const [cohort, setCohort] = useState('');
  const [order, setOrder] = useState('increase');
  const key = group => `${group[0].previous.period}/${group[0].current.period}/${group[0].cutoff}`;
  const group = data.groups.find(g => key(g) === cohort) || data.groups[0] || [];
  const rows = order === 'increase' ? group : [...group].sort((a,b) => a.currentRank-b.currentRank || a.symbol.localeCompare(b.symbol));
  const top = group[0];
  return <section className="institutional-ranking" aria-label="機関投資家の保有報告ランキング">
    <MetricDisclosure summary={<span><b>機関投資家の保有報告</b><small>{data.groups.reduce((sum,g)=>sum+g.length,0)} / {data.total}銘柄で前期比較</small></span>}>
      <p>13F報告運用会社数の増減です。日々の購入額・購入株数は公開データに含まれません。</p>
      {top ? <>
        {data.groups.length > 1 && <label>比較する公表データ<select value={key(group)} onChange={event=>setCohort(event.target.value)}>{data.groups.map(g=><option key={key(g)} value={key(g)}>{g[0].current.period}・公表期限 {g[0].cutoff} ({g.length}銘柄)</option>)}</select></label>}
        <p>{top.previous.period} → {top.current.period} <small>保有対象期 / 公表集計期限 {top.cutoff}</small></p>
        <div className="institutional-ranking-order" role="group" aria-label="保有報告の並び順"><button aria-pressed={order==='increase'} onClick={()=>setOrder('increase')}>増加順</button><button aria-pressed={order==='count'} onClick={()=>setOrder('count')}>保有報告社数順</button></div>
        <ol>{rows.slice(0,6).map(row=><li key={row.symbol}><button onClick={()=>onSelect(row.symbol)} aria-label={`${row.symbol} の保有報告とチャートを確認`}><span><b>{row.symbol}</b><small>社数順位 {row.previousRank} → {row.currentRank}位</small></span><span className="institutional-count-trend"><span>{row.previous.manager_count.toLocaleString('ja-JP')} → {row.current.manager_count.toLocaleString('ja-JP')}社</span><strong>{row.delta>0?'+':''}{row.delta}社</strong></span></button><small>提出・公表 {row.current.filing_date_first}〜{row.current.filing_date_last}</small></li>)}</ol>
        <p className="institutional-ranking-note">同じ対象期・公表期限の{group.length}銘柄内の順位。対象外・履歴不足 {data.unavailable}銘柄、継続性要確認 {data.continuityUnconfirmed}銘柄はゼロに置換せず除外しています。</p>
        <p className="institutional-ranking-note">取得日時 {top.retrievedAt || '未配信'} · 集計後の新しい報告は未反映です。</p>
        {group.some(row=>row.refreshUnavailable) && <p role="status">最新取得に失敗した報告があります。取得済みの公表期限を表示しています。</p>}
      </> : <p role="status">比較可能な連続2四半期の保有報告がありません。履歴不足・期限切れ・分析日後の公表を順位に含めません。</p>}
      {data.continuityExcluded.length > 0 && <MetricDisclosure summary={`継続性要確認の観測 (${data.continuityExcluded.length}銘柄)`}><ul>{data.continuityExcluded.map(row=><li key={row.symbol}><b>{row.symbol}</b> {row.previous.manager_count} → {row.current.manager_count}社<small>{row.previous.period} → {row.current.period} / 公表期限 {row.cutoff}</small><small>前期の提出 {row.previous.filing_date_first}〜{row.previous.filing_date_last}</small><small>{row.reason}。増加順位から除外。</small>{row.source && <a href={row.source} target="_blank" rel="noreferrer">SECの識別子変更通知</a>}</li>)}</ul></MetricDisclosure>}
      <MetricDisclosure summary="日付・順位・データの見方"><p>13Fは四半期末の保有を原則45日以内に提出する制度です。提出日は購入日ではありません。日々の売買や四半期中に売却済みの取引、取得価格は分かりません。</p><p>単位は報告運用会社のCIKです。運用ファンド数や金融機関の親会社数とは異なります。訂正報告・追加報告を反映し、同一報告会社の重複を除外します。株数を比較しないため分割による増株を購入扱いしません。曖昧な銘柄・株式クラスは集計対象外です。</p><p>いずれかの対象期で最初の公表が期末45日後を超える銘柄は、遅延報告・訂正・銘柄変更による比較の歪みを避けるため「継続性要確認」として除外するアプリ独自の保守的な設定です。これだけで全報告の網羅性が保証されるわけではありません。</p><p>順位推移は確認できる2四半期の社数順位です。日次順位を補間しません。報告義務のない会社・非公開保有・未取得報告は含みません。増加社数は購入量や銘柄推奨を示しません。</p><a href={source} target="_blank" rel="noreferrer">SEC / Investor.gov：13Fの制度</a></MetricDisclosure>
    </MetricDisclosure>
  </section>;
}
