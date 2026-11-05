import { useCallback, useEffect, useMemo, useState } from 'react';
import MarketCard from './MarketCard';
import MarketSectors from './MarketSectors';
import WhenNear from './WhenNear';
import { HistoricalBreadth } from '../components/MarketHistoryExplorer';
import MarketUpdateStatus from '../components/MarketUpdateStatus';
import useMediaQuery from '../useMediaQuery';
import { marketUpdateState } from '../marketUpdateState';
import { bare, sentence, trendsStatus } from './briefModel';
import { Expander, Parts } from './briefPrimitives';
import { jumpTo } from './jump';
import { historyTakeaway } from './marketTabModel';
import useSessionState from './useSessionState';
import referenceData from '../reference/market-regime-reference-v1.json' with { type: 'json' };
import { validReference } from '../reference/marketRegimeReference.js';
import { marketTabStudy } from '../reference/marketTabStudy.js';

const EXPLORER_TITLE = 'brief-history-explorer-title';
/** The versioned market-regime study reference (tools/market-regime-reference.mjs); an invalid one shows nothing. */
const REFERENCE = validReference(referenceData) ? referenceData : null;

/**
 * 「過去の傾向」: one fold at the end of the 指数 panel (open by default on the desktop), one line per index state with
 * the study's share for that state, its comparator, its tags and its own date, the key to the tags shown, then what
 * the numbers are not. A comparator and each tag stay whole on a line. On a phone the Nasdaq's published position
 * (`nasdaq`, nasdaqFigures) is the first line of its block; the desktop shows it in place above the chart.
 * Never in the verdict or the warning summary.
 */
export function RegimeContext({ context, wide, nasdaq = null }) {
  return <Expander id={`market-regime-ref${wide ? '-wide' : ''}`} className="brief-regime-ref" summary={context.summary} defaultOpen={wide}>
    {!context.available ? <p className="brief-regime-foot">{context.reason}</p> : <>
      {context.indices.map(block => <div key={block.symbol} className="brief-regime-index">
        <h4>{block.name}</h4>
        {!wide && block.symbol === '^IXIC' && nasdaq && <p className="brief-regime-nas"><span className="numeric">{nasdaq.close}</span><Parts text={nasdaq.text} /></p>}
        <ul>{block.items.map(item => <li key={item.indicator} className={item.reason ? 'is-reason' : undefined}>{item.parts
          ? <>{item.parts.body}{item.parts.comparator && <span className="brief-regime-keep">{item.parts.comparator}</span>}{item.parts.tags.map(tag => <span key={tag} className="brief-regime-keep">{tag}</span>)}</>
          : item.text}</li>)}</ul>
      </div>)}
      {context.key && <p className="brief-regime-key">{context.key.split(/(〔[^〕]+〕)/).map((part, i) => i % 2 ? <span key={i} className="brief-regime-keep">{part}</span> : part)}</p>}
      <p className="brief-regime-foot">{context.footer}</p>
    </>}
  </Expander>;
}

/**
 * The market tab: the verdict, the warning summary and today's evidence (MarketCard detail), then the
 * long-run series and the sector ETF ranks. A row's 「市場環境の推移で見る」 opens its metric in the
 * long-run chart. Every block keeps its own as-of date; nothing older is shown as today's.
 * Below 1024px the evidence groups and the long history are sections of the 地合い card, one at a time
 * behind a sticky row of tabs (kept for the session); the desktop shows them all.
 */
export default function MarketScreen({ brief }) {
  const trends = brief.trends;
  const history = trends?.data?.long_history || null, status = trendsStatus(trends);
  const wide = useMediaQuery('(min-width:1024px)');
  // The study parts of the 地合い card (tags, 分配日 detail, Nasdaq note and position, 過去の傾向), from this chunk.
  const study = useMemo(() => marketTabStudy({ trends, reference: REFERENCE, date: brief.date }), [trends, brief.date]);
  const [section, setSection] = useSessionState('market-section', 'index');
  const [request, setRequest] = useState(null);
  const openMetric = useCallback(metric => { setSection('history'); setRequest(previous => ({ metric, seq: (previous?.seq || 0) + 1 })); }, [setSection]);
  // After the chart has the asked metric, bring its heading into view and move focus there.
  useEffect(() => { if (request) jumpTo(EXPLORER_TITLE); }, [request]);
  // Same failure kinds as the 地合い card: a fetch failure is never called an integrity failure.
  const failure = status.state !== 'error' ? null : status.kind === 'fetch' ? `長期履歴を取得できません（${bare(status.reason)}）。`
    : status.kind === 'reader' ? `長期履歴を表示できません（${bare(status.reason)}）。` : '長期履歴の整合性を確認できません。';
  const takeaway = status.state === 'ready' ? historyTakeaway(history, brief.date) : null;
  const historyError = !history && typeof trends?.data?.long_history_error === 'string';
  // The 推移 tab's 「?」 on a phone: no long history to show, or one that is not the latest session's.
  const update = status.state === 'ready' && history ? marketUpdateState(trends.data).state : null;
  const historyUnknown = status.state === 'loading' || update === 'current' ? null : update === 'pending' ? '更新待ち' : '未確認';
  const historySection = <section className={wide ? 'brief-card brief-history in' : 'brief-history is-section'} style={wide ? { '--i': 2 } : undefined} aria-labelledby="brief-history-title">
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
  </section>;
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>市場</h1></header>
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={trends} date={brief.date} detail onOpenMetric={openMetric}
      switcher={!wide} section={section} onSection={setSection} history={wide ? null : historySection} historyUnknown={historyUnknown}
      study={study} studyBlock={<RegimeContext context={study.regime} wide={wide} nasdaq={study.nasdaqPosition?.state ? study.nasdaqFigures : null} />} />
    {wide && historySection}
  </>;
}
