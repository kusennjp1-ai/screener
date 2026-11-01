// Data for the daily-brief screens. Uses the same queries (and therefore the same
// caches and publication pinning) as the existing research screens.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
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
import { candidateView, trendTemplate } from './briefModel';

export const WATCH_KEY = 'research-watch';

export function useBriefData() {
  const manifest = useStaticManifest();
  const entry = resolveStaticMarketEntry(manifest.data, 'US');
  const researchPath = entry.assets?.research?.path || entry.pages?.scan?.path;
  const version = manifest.data?.research_generation || manifest.data?.generated_at;
  const bundle = useResearchBundle(researchPath, entry.as_of_date, version, entry.publication);
  const trends = useMarketTrends(entry);
  const ranked = useMemo(() => filterRanked(bundle.data?.rankings?.minervini || [], { liquidOnly: true }), [bundle.data]);
  const date = bundle.data?.date || entry.as_of_date || null;
  return { manifest, entry, version, bundle, ranked, date, market: bundle.data?.prepared?.market || null, trends };
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
    let added = false;
    setWatch(current => {
      added = !current.includes(symbol);
      const next = added ? [...current, symbol] : current.filter(s => s !== symbol);
      try { localStorage.setItem(WATCH_KEY, JSON.stringify(next)); setStorageError(false); } catch { setStorageError(true); }
      return next;
    });
    return added;
  }, []);
  return { watch, toggle, storageError };
}

/** Everything the stock screen shows for one symbol. Missing pieces stay null/unknown. */
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
  const technical = useMemo(() => {
    if (row?.book_technical_evidence?.vcp) return row.book_technical_evidence;
    if (!row || !bars) return null;
    try { return buildBookTechnicalEvidence(row, chart.data, date); } catch { return null; }
  }, [row, bars, chart.data, date]);
  const financial = useMemo(() => {
    if (!row) return null;
    const book = row.book_financials ? bookFinancialCurrent(row.book_financials, row.symbol, date, financialNow, row) : null;
    const history = row.financial_history ? financialHistory(row.financial_history, row.symbol, date, financialNow) : null;
    const report = book?.current ? book.report : null;
    return { report, history, code33: code33Layered(report, history, date) };
  }, [row, date, financialNow]);
  const institutional = useMemo(() => row ? { growth: institutionalGrowth(row.institutional_evidence, row.symbol, date), observations: Array.isArray(row.institutional_evidence?.observations) ? row.institutional_evidence.observations : [] } : null, [row, date]);
  return { item, row, view, template, technical, financial, institutional, bars, chart, detail, loading: bundle.isLoading || (Boolean(chartPath) && chart.isLoading) };
}
