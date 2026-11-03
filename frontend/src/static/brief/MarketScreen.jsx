import MarketCard from './MarketCard';
import { HistoricalBreadth, SectorRankHistory } from '../components/MarketHistoryExplorer';
import MarketUpdateStatus from '../components/MarketUpdateStatus';
import { environmentPoint } from '../marketLongHistory';
import { SECTORS } from '../sectorDefinitions';
import { bare, latestKnown, sentence, trendsStatus } from './briefModel';

const sectorNames = Object.fromEntries(SECTORS.map(([, label, symbol]) => [symbol, label]));
const num = value => value.toLocaleString('ja-JP', { maximumFractionDigits: 0 });

/**
 * One line on what the long history says today, from the data only: the leader count now against a
 * year earlier and its one-year range, and the leading sectors of the newest complete frame.
 */
function historyTakeaway(history) {
  if (!history) return null;
  const rows = (history.breadth || []).map(environmentPoint);
  const field = rows.some(row => 'trendTemplateCount' in row) ? ['trendTemplateCount', 'TT達成数'] : ['leaderCount', '先導株数（価格条件）'];
  const hit = latestKnown(rows, field[0]), parts = [];
  if (hit && hit.index >= 251) {
    const window = rows.slice(hit.index - 251, hit.index + 1).map(row => row[field[0]]).filter(Number.isFinite), before = rows[hit.index - 251]?.[field[0]];
    if (window.length >= 200) parts.push(`${field[1]}は${Number.isFinite(before) ? `1年前の${num(before)}から` : '現在'}${num(hit.value)}銘柄（1年の範囲 ${num(Math.min(...window))}〜${num(Math.max(...window))}）`);
  }
  const frame = (history.sectorRotation?.frames || []).at(-1);
  if (frame?.ranks?.length === 11) parts.push(`セクターの上位は${[...frame.ranks].sort((a, b) => a.rank - b.rank).slice(0, 3).map(row => sectorNames[row.symbol] || row.symbol).join('・')}`);
  return parts.length ? `${parts.join('。')}。` : null;
}

/**
 * The market tab: the verdict and today's evidence (MarketCard detail), then the long-run series
 * and sector ETF ranks. Every block keeps its own as-of date; nothing older is shown as today's.
 */
export default function MarketScreen({ brief }) {
  const trends = brief.trends;
  const history = trends?.data?.long_history || null, status = trendsStatus(trends);
  // Same failure kinds as the 地合い card: a fetch failure is never called an integrity failure.
  const failure = status.state !== 'error' ? null : status.kind === 'fetch' ? `長期履歴を取得できません（${bare(status.reason)}）。`
    : status.kind === 'reader' ? `長期履歴を表示できません（${bare(status.reason)}）。` : '長期履歴の整合性を確認できません。';
  const takeaway = status.state === 'ready' ? historyTakeaway(history) : null;
  return <>
    <header className="brief-hero in" style={{ '--i': 0 }}><small className="numeric">{brief.date || '日付未確認'} 引け・米国株</small><h1>市場</h1></header>
    <MarketCard market={brief.market} marketLoading={brief.marketLoading} trends={trends} date={brief.date} detail />
    <section className="brief-card brief-history in" style={{ '--i': 2 }} aria-labelledby="brief-history-title">
      <div className="brief-step"><h2 id="brief-history-title" tabIndex={-1}>市場環境の推移</h2></div>
      {status.state === 'loading' ? <p className="brief-note" role="status">長期履歴を読み込み中…</p>
        : failure ? <p className="brief-alert" role="alert">{failure}</p>
          : <>
            {takeaway && <p className="brief-takeaway">{takeaway}</p>}
            <MarketUpdateStatus data={trends?.data} />
            <div className="brief-history-grid">
              {!history && typeof trends?.data?.long_history_error === 'string' ? <p className="brief-alert" role="alert" data-check={trends.data.long_history_error_key || undefined}>{sentence(trends.data.long_history_error)}</p> : <HistoricalBreadth history={history} showSplit={false} />}
              <SectorRankHistory history={history} />
            </div>
          </>}
    </section>
  </>;
}
