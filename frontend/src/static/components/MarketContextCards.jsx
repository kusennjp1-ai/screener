import MetricDisclosure from './MetricDisclosure';
import { BOOK_MARKET_VERSION } from '../bookMarketEvidence';
import { finite, snapshotFreshness } from '../researchEngine';
import './marketContextCards.css';

const count = value => Number.isInteger(value) && value >= 0;
const number = value => count(value) ? value.toLocaleString('ja-JP') : '—';
const percent = value => finite(value) ? `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(2)}%` : '—';

// These observations are produced by buildBookMarketEvidence. In particular,
// their cohort is the published chart set, not the entire listed market.
export default function MarketContextCards({ evidence, expectedDate, now = Date.now() }) {
  const freshness = snapshotFreshness(expectedDate, now);
  const valid = ['recent', 'old'].includes(freshness.state) && evidence?.version === BOOK_MARKET_VERSION &&
    evidence.as_of_date === expectedDate && evidence.latest?.date === expectedDate &&
    evidence.currentSnapshotComplete === true;
  const latest = valid ? evidence.latest : null;
  const benchmark = latest?.benchmark?.date === expectedDate ? latest.benchmark : null;
  const stale = freshness.state !== 'recent';
  const hasCoverage = count(latest?.coverage) && count(latest?.expectedUniverseSize) &&
    latest.coverage > 0 && latest.coverage <= latest.expectedUniverseSize;
  const highs = hasCoverage && count(latest.newHighs) && latest.newHighs <= latest.coverage ? latest.newHighs : null;
  const lows = hasCoverage && count(latest.newLows) && latest.newLows <= latest.coverage ? latest.newLows : null;
  const leaders = hasCoverage && count(latest.leaderCount) && latest.leaderCount <= latest.coverage ? latest.leaderCount : null;
  const direction = finite(benchmark?.dailyChangePct) ? benchmark.dailyChangePct : null;
  const coveragePct = hasCoverage ? latest.coverage / latest.expectedUniverseSize * 100 : null;
  return <section className="market-context" aria-label="市場環境を読む3つの視点">
    <header className="market-context-heading"><div><span className="market-context-eyebrow">MARKET CONTEXT</span><h2>市場を、3つの視点で読む</h2></div><span className="market-context-date">{expectedDate || '分析日未確認'}{stale ? ' · 過去または未確認の観測' : ' · 日次の観測'}</span></header>
    <div className="market-context-grid">
      <article className="market-context-card" aria-label="指数の方向">
        <MetricDisclosure summary={<div className="market-metric-summary"><div className="market-context-label"><span className="market-context-icon" aria-hidden="true">↗</span><h3>指数の方向</h3><span className="market-context-step">01</span></div>
        <div className="market-context-value" data-tone={direction === null ? 'unknown' : direction > 0 ? 'positive' : direction < 0 ? 'negative' : 'neutral'}><strong>{percent(direction)}</strong><span>{benchmark?.symbol || '指数未確認'} · 前日比</span></div></div>}>
        <p>{direction === null ? '同じ分析日の指数データがありません。' : direction > 0 ? '指数は前日から上昇。個別株への広がりも確認します。' : direction < 0 ? '指数は前日から下落。先導株の動きと合わせて確認します。' : '指数は前日と同水準です。'}</p>
        <div className="market-context-detail"><span>20営業日前比</span><strong>{percent(benchmark?.return20)}</strong></div>
        </MetricDisclosure>
      </article>
      <article className="market-context-card" aria-label="高値と安値の更新">
        <MetricDisclosure summary={<div className="market-metric-summary"><div className="market-context-label"><span className="market-context-icon" aria-hidden="true">⇅</span><h3>高値・安値の更新</h3><span className="market-context-step">02</span></div>
        <div className="market-context-high-low"><div><span>52週高値</span><strong>{number(highs)}<small>銘柄</small></strong></div><div><span>52週安値</span><strong>{number(lows)}<small>銘柄</small></strong></div></div></div>}>
        <p>{highs === null || lows === null ? '同じ分析日の高値・安値更新数は未確認です。' : '直前251本の高値・安値を更新した銘柄数。公開チャート集合内の観測です。'}</p>
        <div className="market-context-detail"><span>観測できた銘柄</span><strong>{hasCoverage ? number(latest.coverage) : '—'} 銘柄</strong></div>
        </MetricDisclosure>
      </article>
      <article className="market-context-card" aria-label="先導株の状態">
        <MetricDisclosure summary={<div className="market-metric-summary"><div className="market-context-label"><span className="market-context-icon" aria-hidden="true">◎</span><h3>先導株の状態</h3><span className="market-context-step">03</span></div>
        <div className="market-context-value"><strong>{number(leaders)}<small>銘柄</small></strong><span>トレンド条件とRSによる先導候補</span></div></div>}>
        <p>『基本と原則』の近似条件と独自RSによる集計。購入条件の通過数ではありません。</p>
        <div className="market-context-detail"><span>日足の観測範囲</span><strong>{hasCoverage ? `${number(latest.coverage)} / ${number(latest.expectedUniverseSize)}` : '未確認'}</strong></div>
        {coveragePct !== null && <div className="market-context-coverage" role="img" aria-label={`公開チャート集合の観測率 ${coveragePct.toFixed(1)}%`}><span style={{ width: `${coveragePct}%` }} /></div>}
        </MetricDisclosure>
      </article>
    </div>
    <p className="market-context-scope">{!valid ? '根拠データが未取得、または分析日が一致していません。' : '公開チャート集合内の観測。'} 市場全体・購入可否の判定ではありません。</p>
  </section>;
}
