import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SECTORS } from '../sectorStrength';
import { sectorKey } from '../sectorDefinitions';

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

export default function MobileMarketMap({ ranked, date, sector, onSector, onSelect, loading, methodLabel }) {
  const [showAll, setShowAll] = useState(false);
  const groups = useMemo(() => summarizeSectors(ranked), [ranked]);
  const visibleGroups = showAll ? groups : groups.slice(0, 6);
  const candidates = ranked.filter(item => !sector || sectorKey(item.row.gics_sector) === sector).slice(0, 6);
  return <section className="mobile-market-map" aria-label="市場マップ">
    <header><span className="mobile-eyebrow">MARKET EXPLORER</span><h1>市場から、次の候補へ。</h1><p>{methodLabel} · 分析 {date || '未確認'}</p></header>
    <Link className="mobile-market-context" to="/breadth"><span>市場環境を確認<small>指数・騰落・市場の広がり</small></span><span aria-hidden="true">↗</span></Link>
    <div className="mobile-map-heading"><h2>業種マップ</h2><button aria-pressed={!sector} onClick={() => onSector('')}>すべて</button></div>
    <p className="mobile-map-scope">公開対象の選定通過数 · {ranked.length}銘柄内<br/>色はRS中央値の80以上 / 未満 / 未確認。市場全体の騰落率ではありません。</p>
    {loading ? <p role="status">業種を集計中…</p> : !groups.length ? <p>集計できる銘柄がありません。</p> : <div className="mobile-sector-tiles">{visibleGroups.map(group => <button key={group.key} aria-pressed={sector === group.key} onClick={() => onSector(group.key)} data-strength={group.median === null ? 'unknown' : group.median >= 80 ? 'strong' : 'ordinary'}>
      <span>{group.label}</span><strong>{group.qualified}<small> / {group.count} 銘柄</small></strong><small>RS中央値 {group.median === null ? '未確認' : group.median.toFixed(0)}</small>
    </button>)}</div>}
    {groups.length > 6 && <button className="mobile-map-browse" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? '主要6業種に戻す' : `すべての業種を見る (${groups.length})`}</button>}
    <div className="mobile-map-heading"><h2>{sector ? labels[sector] || '分類不明' : '銘柄を確認'}</h2><small>チャートへ →</small></div>
    <div className="mobile-map-candidates">{candidates.map(({ row }) => <button key={row.symbol} onClick={() => onSelect(row.symbol)} aria-label={`${row.symbol} のチャートを確認`}><span><strong>{row.symbol}</strong><small>{row.company_name || '企業名未配信'}</small></span><span>RS {Number.isFinite(row.rs_rating) ? Math.round(row.rs_rating) : '—'} <b aria-hidden="true">›</b></span></button>)}</div>
  </section>;
}
