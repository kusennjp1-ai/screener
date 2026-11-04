// Data for the daily-brief screens. Uses the same queries (and therefore the same
// caches and publication pinning) as the existing research screens.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { fetchStaticJson, resolveStaticMarketEntry, useStaticManifest } from '../dataClient';
import { useResearchBundle } from '../useResearchBundle';
import { useMarketTrends } from '../useMarketTrends';
import { filterRanked } from '../researchPresentation';
import { mergeFinancialDetail } from '../financialCurrent';
import { useFinancialClock } from '../useFinancialClock';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';
import { requireChartIdentity } from '../chartPayloadIdentity';
import { buildBookTechnicalEvidence } from '../bookTechnicalEvidence';
import { bookFinancialCurrent } from '../bookFinancialCurrent';
import { financialHistory } from '../financialHistory';
import { institutionalGrowth } from '../institutionalEvidence';
import { code33Layered } from '../code33Reference';
import { diagnoseBookChart } from '../bookChartDiagnostics';
import { auditDailyBars } from '../qualificationAudit';
import { candidateView, secStatus, sellSignals, trendTemplate, withBookWarning } from './briefModel';

export const WATCH_KEY = 'research-watch';
// The brief ranks only the trend template; the worker skips the other methods' rankings.
const BRIEF_METHODS = ['minervini'];

export function useBriefData() {
  const manifest = useStaticManifest();
  const entry = resolveStaticMarketEntry(manifest.data, 'US');
  const researchPath = entry.assets?.research?.path || entry.pages?.scan?.path;
  const version = manifest.data?.research_generation || manifest.data?.generated_at;
  const bundle = useResearchBundle(researchPath, entry.as_of_date, version, entry.publication, BRIEF_METHODS);
  const marketTrends = useMarketTrends(entry);
  // Before the manifest arrives there is no asset reference yet: that is loading, not "not published".
  // A manifest that failed leaves it unknown whether market data was published: an error, never 未配信.
  const trends = manifest.isLoading && !marketTrends.data && !marketTrends.error ? { ...marketTrends, loading: true }
    : manifest.isError && !manifest.data ? { ...marketTrends, loading: false, error: true, failureKind: 'manifest' } : marketTrends;
  const ranked = useMemo(() => filterRanked(bundle.data?.rankings?.minervini || [], { liquidOnly: true }), [bundle.data]);
  const date = bundle.data?.date || entry.as_of_date || null;
  const market = bundle.data?.prepared?.market || null;
  return { manifest, entry, version, bundle, ranked, date, market, marketLoading: !market && (manifest.isLoading || bundle.isLoading), trends };
}

/** The watchlist shared with the research screens (same storage key). */
export function useWatchlist() {
  const read = () => { try { const value = JSON.parse(localStorage.getItem(WATCH_KEY) || '[]'); return Array.isArray(value) ? value.filter(s => typeof s === 'string') : []; } catch { return []; } };
  const [watch, setWatch] = useState(read);
  const [storageError, setStorageError] = useState(false);
  useEffect(() => {
    const sync = event => { if (event.key === WATCH_KEY) setWatch(read()); };
    window.addEventListener('storage', sync);
    return () => window.removeEventListener('storage', sync);
  }, []);
  const toggle = useCallback(symbol => {
    const added = !watch.includes(symbol);
    const next = added ? [...watch, symbol] : watch.filter(s => s !== symbol);
    setWatch(next);
    try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
    return added;
  }, [watch]);
  return { watch, toggle, storageError };
}

/** Everything the stock screen shows for one symbol. Missing pieces stay null/unknown. */
/**
 * Bars that may be judged as of the analysis date: the publisher certified this row's daily bars
 * (technical_audit) and this payload passes the same audit now (last bar on the analysis date,
 * every exchange session present, price matching the row). Anything else stays unknown.
 */
export function certifyBars(row, payload, date) {
  if (!row || !payload) return { certified: false, reason: '日足データ未配信' };
  if (row.technical_audit?.valid !== true) return { certified: false, reason: '公開時の日足検証を通過していません' };
  let audit;
  try { audit = auditDailyBars(row, payload, date); } catch { return { certified: false, reason: '日足を検証できません' }; }
  return audit.valid ? { certified: true, reason: null } : { certified: false, reason: audit.errors[0] || '日足を検証できません' };
}

export function useStockData(symbol, brief) {
  const { bundle, version, entry, date } = brief;
  const item = useMemo(() => (bundle.data?.rankings?.minervini || []).find(r => r.row.symbol === symbol) || null, [bundle.data, symbol]);
  const summary = item?.row || null;
  const detail = useQuery({
    queryKey: ['researchDetail', summary?.symbol, summary?.research_detail_path, bundle.data?.date, version],
    enabled: Boolean(summary?.research_detail_path), staleTime: Infinity, placeholderData: () => undefined,
    queryFn: async ({ queryKey }) => {
      const [, ticker, path, day, generation] = queryKey;
      const value = await fetchStaticJson(path, { generation, publication: entry.publication });
      if (value.symbol !== ticker || value.as_of_date !== day) throw Error('Detail identity mismatch');
      return { value, symbol: ticker, date: day, generation, path };
    },
  });
  const clockRows = useMemo(() => [summary, detail.data?.value].filter(Boolean), [summary, detail.data]);
  const financialNow = Math.max(bundle.evaluatedNow ?? Date.now(), useFinancialClock(clockRows));
  const row = useMemo(() => summary ? mergeFinancialDetail(summary, detail.data?.value, { now: financialNow, asOfDate: bundle.data?.date, generation: version,
    detailGeneration: detail.data?.generation, expectedDetailPath: summary.research_detail_path, detailPath: detail.data?.path }) : null, [summary, detail.data, financialNow, bundle.data?.date, version]);
  const chartPath = row?.chart_path || null;
  const chart = useQuery({
    queryKey: [...staticChartKeys.payload(symbol, chartPath), version],
    queryFn: () => fetchStaticChartPayload(chartPath, { generation: version }),
    enabled: Boolean(chartPath), staleTime: 60000, placeholderData: () => undefined,
    select: payload => requireChartIdentity(payload, symbol, date),
  });
  const bars = chart.data?.bars?.length ? chart.data.bars : null;
  const view = useMemo(() => row ? candidateView({ row, assessment: item?.assessment }, date) : null, [row, item, date]);
  const template = useMemo(() => row ? trendTemplate(row, financialNow) : null, [row, financialNow]);
  const certification = useMemo(() => (row && chart.data ? certifyBars(row, chart.data, date) : { certified: false, reason: null }), [row, chart.data, date]);
  const technical = useMemo(() => {
    if (row?.book_technical_evidence?.vcp) return row.book_technical_evidence;
    if (!row || !bars || !certification.certified) return null;
    try { return buildBookTechnicalEvidence(row, chart.data, date); } catch { return null; }
  }, [row, bars, chart.data, date, certification.certified]);
  const financial = useMemo(() => {
    if (!row) return null;
    const book = row.book_financials ? bookFinancialCurrent(row.book_financials, row.symbol, date, financialNow, row) : null;
    const history = row.financial_history ? financialHistory(row.financial_history, row.symbol, date, financialNow) : null;
    // Stale or unverifiable SEC rows never reach the tiles; secStatus says why.
    const report = book?.current ? book.report : null;
    const historyRetrievedAt = row.financial_history?.quarterly_retrieved_at || row.financial_history?.retrieved_at || null;
    return { report, sec: secStatus(row, book), history, historyRetrievedAt, code33: code33Layered(report, history, date) };
  }, [row, date, financialNow]);
  // The publisher's diagnostics win, including an invalid verdict; the client recomputes only certified bars.
  const diagnostics = useMemo(() => {
    if (row?.book_diagnostics && row.book_diagnostics.as_of_date === date) return row.book_diagnostics;
    if (!row || !bars || !certification.certified) return null;
    try { return diagnoseBookChart(row, chart.data, date); } catch { return null; }
  }, [row, bars, chart.data, date, certification.certified]);
  const institutional = useMemo(() => row ? { growth: institutionalGrowth(row.institutional_evidence, row.symbol, date), observations: Array.isArray(row.institutional_evidence?.observations) ? row.institutional_evidence.observations : [] } : null, [row, date]);
  return { item, row, view, template, technical, diagnostics, financial, institutional, bars, certification, date, chart, detail, loading: bundle.isLoading || (Boolean(chartPath) && chart.isLoading) };
}

export const SELL_WATCH_LIMIT = 12;

/**
 * Sell checks for watched stocks, from the same chart queries the stock screen uses (shared cache).
 * Returns { [symbol]: result } where a checked stock carries the sellSignals result and any other
 * stock (beyond SELL_WATCH_LIMIT, failed chart, or bars not certified for the analysis date) carries
 * { unknown: true, reason }. Stocks whose chart is still loading are absent.
 */
export function useWatchSellChecks(views, brief) {
  const { version, date } = brief;
  const all = views || [];
  const targets = all.filter(view => view.row?.chart_path).slice(0, SELL_WATCH_LIMIT);
  const results = useQueries({
    queries: targets.map(view => ({
      queryKey: [...staticChartKeys.payload(view.symbol, view.row.chart_path), version],
      queryFn: () => fetchStaticChartPayload(view.row.chart_path, { generation: version }),
      staleTime: 60000,
      select: payload => requireChartIdentity(payload, view.symbol, date),
    })),
  });
  const key = results.map(r => `${r.dataUpdatedAt}:${r.isError}`).join('|');
  return useMemo(() => {
    const out = {};
    const checked = new Set(targets.map(view => view.symbol));
    for (const view of all) {
      if (!checked.has(view.symbol)) out[view.symbol] = { unknown: true, reason: view.row?.chart_path ? `確認は先頭${SELL_WATCH_LIMIT}銘柄まで` : '日足チャート未配信' };
    }
    targets.forEach((view, i) => {
      const result = results[i];
      if (result?.isError) { out[view.symbol] = { unknown: true, reason: '日足を取得できません' }; return; }
      const payload = result?.data;
      if (!payload) return;
      const { certified, reason } = certifyBars(view.row, payload, date);
      if (!certified) { out[view.symbol] = { unknown: true, reason }; return; }
      let diagnostics = null;
      try { diagnostics = diagnoseBookChart(view.row, payload, date); } catch { diagnostics = null; }
      out[view.symbol] = withBookWarning(sellSignals(payload.bars), diagnostics) || { unknown: true, reason: '日足が不足' };
    });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, all.map(v => v.symbol).join('|'), date]);
}
