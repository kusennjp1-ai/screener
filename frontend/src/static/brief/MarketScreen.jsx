import MarketCard from './MarketCard';
import { HistoricalBreadth, SectorRankHistory } from '../components/MarketHistoryExplorer';
import MarketUpdateStatus from '../components/MarketUpdateStatus';
import { sentence } from './briefModel';

/**
 * The market tab: today's verdict and environment, then the long-run series (trend-template
 * count, stage mix, moving-average breadth, leader health, breakout success) and sector ETF
 * ranks. Every block keeps its own as-of date; nothing older is shown as today's.
 */
export default function MarketScreen({ brief }) {
  const trends = brief.trends;
  const history = trends?.data?.long_history || null;
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>市場</h1></header>
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={trends} date={brief.date} detail />
    <section className="brief-card brief-history in" style={{ '--i': 2 }} aria-labelledby="brief-history-title">
      <div className="brief-step"><h2 id="brief-history-title">市場環境の推移</h2></div>
      {trends?.loading ? <p className="brief-note" role="status">長期履歴を読み込み中…</p>
        : trends?.error ? <p className="brief-alert" role="alert">長期履歴の整合性を確認できません。</p>
          : <>
            <MarketUpdateStatus data={trends?.data} />
            {!history && typeof trends?.data?.long_history_error === 'string' ? <p className="brief-alert" role="alert">{sentence(trends.data.long_history_error)}</p> : <HistoricalBreadth history={history} />}
            <SectorRankHistory history={history} />
          </>}
    </section>
  </>;
}
