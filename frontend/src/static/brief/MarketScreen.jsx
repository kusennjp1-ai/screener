import { useCallback, useEffect, useState } from 'react';
import MarketCard from './MarketCard';
import MarketSectors from './MarketSectors';
import WhenNear from './WhenNear';
import { HistoricalBreadth } from '../components/MarketHistoryExplorer';
import MarketUpdateStatus from '../components/MarketUpdateStatus';
import { bare, sentence, trendsStatus } from './briefModel';
import { jumpTo } from './jump';
import { historyTakeaway } from './marketTabModel';

const EXPLORER_TITLE = 'brief-history-explorer-title';

/**
 * The market tab: the verdict, the warning summary and today's evidence (MarketCard detail), then the
 * long-run series and the sector ETF ranks. A row's 「市場環境の推移で見る」 opens its metric in the
 * long-run chart. Every block keeps its own as-of date; nothing older is shown as today's.
 */
export default function MarketScreen({ brief }) {
  const trends = brief.trends;
  const history = trends?.data?.long_history || null, status = trendsStatus(trends);
  const [request, setRequest] = useState(null);
  const openMetric = useCallback(metric => setRequest(previous => ({ metric, seq: (previous?.seq || 0) + 1 })), []);
  // After the chart has the asked metric, bring its heading into view and move focus there.
  useEffect(() => { if (request) jumpTo(EXPLORER_TITLE); }, [request]);
  // Same failure kinds as the 地合い card: a fetch failure is never called an integrity failure.
  const failure = status.state !== 'error' ? null : status.kind === 'fetch' ? `長期履歴を取得できません（${bare(status.reason)}）。`
    : status.kind === 'reader' ? `長期履歴を表示できません（${bare(status.reason)}）。` : '長期履歴の整合性を確認できません。';
  const takeaway = status.state === 'ready' ? historyTakeaway(history) : null;
  const historyError = !history && typeof trends?.data?.long_history_error === 'string';
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>市場</h1></header>
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={trends} date={brief.date} detail onOpenMetric={openMetric} />
    <section className="brief-card brief-history in" style={{ '--i': 2 }} aria-labelledby="brief-history-title">
      <div className="brief-step"><h2 id="brief-history-title" tabIndex={-1}>市場環境の推移</h2></div>
      {status.state === 'loading' ? <p className="brief-note" role="status">長期履歴を読み込み中…</p>
        : failure ? <p className="brief-alert" role="alert">{failure}</p>
          : <>
            {takeaway && <p className="brief-takeaway">{takeaway}</p>}
            <MarketUpdateStatus data={trends?.data} />
            <div className="brief-history-grid">
              <div className="brief-history-main">
                {historyError ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(trends.data.long_history_error)}</p>
                  // The long-run chart is the heaviest part of the tab: it mounts once it nears the screen, when the
                  // page is idle, or at once when a row asks for it.
                  : <WhenNear force={Boolean(request)} idle minHeight={640}><HistoricalBreadth history={history} request={request} showSplit={false} id={EXPLORER_TITLE} /></WhenNear>}
              </div>
              <MarketSectors history={history} date={brief.date} />
            </div>
          </>}
    </section>
  </>;
}
