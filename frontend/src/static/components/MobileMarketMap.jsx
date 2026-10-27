import MetricDisclosure from './MetricDisclosure';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SECTORS } from '../sectorStrength';
import { sectorKey } from '../sectorDefinitions';
import { strongestMarketCandidates } from '../marketCandidates';
import InstitutionalRanking from './InstitutionalRanking';

const labels = Object.fromEntries(SECTORS);
function summarizeSectors(ranked) {
  const groups = new Map();
  for (const item of ranked) {
    const key = sectorKey(item.row.gics_sector);
    if (!groups.has(key)) groups.set(key, { key, label: labels[key] || '分類不明', count: 0, qualified: 0, ratings: [] });
    const group = groups.get(key);
    group.count++;
    if (item.assessment?.qualified === true) group.qualified++;
    if (Number.isFinite(item.row.rs_rating)) group.ratings.push(item.row.rs_rating);
  }
  return [...groups.values()].map(group => {
    const sorted = group.ratings.sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
    return { ...group, median: sorted.length ? (sorted[mid] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2 : null };
  }).sort((a, b) => b.qualified - a.qualified || (b.median ?? -1) - (a.median ?? -1) || a.label.localeCompare(b.label));
}

export default function MobileMarketMap({ ranked, minerviniRanked = ranked, date, sector, onSector, onSelect, loading, methodLabel, market, now }) {
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => summarizeSectors(ranked), [ranked]);
  const visibleGroups = showAll ? groups : groups.slice(0, 6);
  const strongest = useMemo(() => strongestMarketCandidates(minerviniRanked, date, market, now), [minerviniRanked, date, market, now]);
  const candidates = strongest.filter(item => !sector || sectorKey(item.row.gics_sector) === sector).slice(0, 6);
  return <section className="mobile-market-map" aria-label="市場マップ">
    <header><h1>市場</h1><p>分析 {date || '未確認'} · 業種集計 {methodLabel}</p></header>
    <Link className="mobile-market-context" to="/breadth"><span>市場環境を確認<small>指数・騰落・市場の広がり</small></span><span aria-hidden="true">↗</span></Link>
    <div className="mobile-map-heading"><h2>業種マップ</h2><button aria-pressed={!sector} onClick={() => onSector('')}>絞り込み解除</button></div>
    <p className="mobile-map-scope">選定通過 / 公開対象 · {ranked.length}銘柄内</p><MetricDisclosure summary="業種マップの見方"><p>色はRS中央値の80以上 / 未満 / 未確認。市場全体の騰落率ではありません。</p></MetricDisclosure>
    {loading ? <p role="status">業種を集計中…</p> : !groups.length ? <p>集計できる銘柄がありません。</p> : <div className="mobile-sector-tiles">{visibleGroups.map(group => <button key={group.key} aria-pressed={sector === group.key} onClick={() => onSector(group.key)} data-strength={group.median === null ? 'unknown' : group.median >= 80 ? 'strong' : 'ordinary'}>
      <span>{group.label}</span><strong>{group.qualified}<small> / {group.count} 銘柄</small></strong><small>RS中央値 {group.median === null ? '未確認' : group.median.toFixed(0)}</small>
    </button>)}</div>}
    {groups.length > 6 && <button className="mobile-map-browse" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? '6業種に戻す' : `全業種を表示 (${groups.length})`}</button>}
    <div className="mobile-map-heading"><h2>銘柄を確認</h2><small>ミネルヴィニ条件</small></div>
    <MetricDisclosure summary="候補の優先順"><p>ミネルヴィニ選定条件をすべて通過し、株価10ドル以上・平均売買代金2,000万ドル以上・独自RS推定80以上の銘柄から表示します。現金買収合意・低変動・財務除外・未確認の条件がある銘柄を最強候補に繰り上げません。</p><p>共通の日次買い条件が全通過の銘柄を優先し、通過条件数、買いゾーン内、RS、売買代金の順で並べます。ベース・出来高・市場・決算・データ鮮度も日次条件に含みます。本人の実際の保有・購入予定や推奨を示すものではありません。</p></MetricDisclosure>
    <p className="market-candidate-status">{sector ? `${labels[sector] || '分類不明'}内` : '全業種'} · 選定通過 {strongest.filter(item=>!sector || sectorKey(item.row.gics_sector)===sector).length}銘柄 / 公開対象 {minerviniRanked.length}銘柄</p>
    {!loading && !candidates.length && <p className="market-candidate-status" role="status">現在、確認済みの選定条件を満たす候補はありません。未確認の条件を通過扱いにはしません。</p>}
    <div className="mobile-map-candidates">{candidates.map(({ row, readiness, position }) => <button key={row.symbol} onClick={() => onSelect(row.symbol)} aria-label={`${row.symbol} のチャートを確認`}><span><strong>{row.symbol}</strong><small>{row.company_name || '企業名未配信'}</small><span className="market-candidate-evidence">{readiness.ready ? '日次条件を全通過' : `監視候補・購入条件未充足 ${readiness.passed}/${readiness.total}`} · {position.state}</span></span><span>RS {Math.round(row.rs_rating)} <b aria-hidden="true">›</b></span></button>)}</div>
    <InstitutionalRanking ranked={ranked} date={date} onSelect={onSelect} />
  </section>;
}
