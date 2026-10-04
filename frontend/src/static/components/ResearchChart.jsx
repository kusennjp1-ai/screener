import { requireChartIdentity } from '../chartPayloadIdentity';
import { useEffect, useMemo, useRef, useState } from 'react';
import { entryPlan } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { validEvidenceDay } from '../evidenceTime';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Typography, useMediaQuery } from '@mui/material';
import CandlestickChart from '../../components/Charts/CandlestickChart';
import { chartHistoryWarning } from '../../components/Charts/researchChartModel';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';
import { EntrySourceBadge } from './EntrySourceNote';
import './researchChartViewport.css';

const EMPTY_BARS = Object.freeze([]);
// Closed chrome: 53px toolbar + up to 44px metadata + 60px explanation
// disclosure, with room for a native horizontal scrollbar. Open disclosures
// remain normal-flow content and can grow beyond this reservation.
const CLOSED_CHROME_HEIGHT = 176;

export default function ResearchChart({ entry, symbol, generation, onExpand, rsRating, row, method, quote, date }) {
  const small = useMediaQuery('(max-width: 700px)');
  const section = useRef(null);
  const focusRequested = useRef(false);
  const [activated, setActivated] = useState(() => typeof IntersectionObserver === 'undefined');
  useEffect(() => {
    if (activated) return undefined;
    const target = section.current;
    let disposed = false;
    const observer = new IntersectionObserver(entries => {
      if (!disposed && entries.some(entry => entry.target === target && entry.isIntersecting)) setActivated(true);
    }, { rootMargin: '200px 0px', threshold: 0 });
    observer.observe(target);
    return () => { disposed = true; observer.disconnect(); };
  }, [activated]);
  // Query/projection/identity checks remain eager. Only the interactive canvas
  // and its visual transforms wait until this section is approached/requested.
  const query = useQuery({
    queryKey: [...staticChartKeys.payload(symbol, entry?.path), generation],
    queryFn: () => fetchStaticChartPayload(entry.path),
    enabled: Boolean(entry?.path), staleTime: 60000,
    placeholderData: () => undefined,
    select: payload => requireChartIdentity(payload, symbol, date),
  });
  const data = query.data;
  const ready = Boolean(entry?.path && !query.isError && data?.bars?.length);
  const historyWarning = useMemo(() => ready ? chartHistoryWarning(data.bars) : null, [ready, data]);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => { if (activated && ready) setInitialized(true); }, [activated, ready]);
  const renderChart = activated && (ready || initialized);
  useEffect(() => {
    if (activated && ready && focusRequested.current) {
      focusRequested.current = false;
      section.current?.querySelector('[aria-label="チャート操作"] button')?.focus({ preventScroll: true });
    }
  }, [activated, ready]);
  // Bars and their overlays must not come from different selections. A supplied
  // stale row is withheld, rather than promoted after the new bars arrive.
  const matchesContext = (value, allowMissingSymbol = false) => Boolean(value && symbol && validEvidenceDay(date)
    && (value.symbol === symbol || (allowMissingSymbol && value.symbol == null))
    && [value.as_of_date, value.technical_audit?.as_of_date, value.entry_evidence?.as_of_date].every(day => day == null || day === date));
  const currentRowContext = matchesContext(row);
  const contextRow = row != null ? (currentRowContext ? row : null)
    : ready && matchesContext(data?.stock_data, true) ? data.stock_data : null;
  const plan = entryPlan(contextRow || {},quote,method);
  const plotHeight = small ? 360 : 440;
  const warningMessage = historyWarning && `${historyWarning} 自動図解とピボット線は停止中です。表示中の履歴を購入判断に使わないでください。`;
  return <Box component="section" ref={section} className="research-chart" aria-label={`${symbol} の日次チャート`}>
    <header className="research-chart-heading"><h3>日次チャート</h3><button type="button" disabled={!entry?.path} onClick={onExpand} aria-label="日次チャートを分析">拡大 ↗</button></header>
    {entry?.path && (ready || currentRowContext) && plan.sourceContext?.warning && <div className="research-chart-source-context" style={{padding:'4px 12px 8px'}}><EntrySourceBadge plan={plan}/></div>}
    <div className="research-chart-viewport-body">
    {/* This hidden twin reserves the warning's real wrapped height; its visible
        counterpart remains below or inside the activated chart. */}
    {(entry?.path || initialized) && <div className="research-chart-reservation" aria-hidden="true">
      {warningMessage && <Alert severity="warning">{warningMessage}</Alert>}
      <div style={{ height: plotHeight + CLOSED_CHROME_HEIGHT }} />
    </div>}
    <div className="research-chart-viewport-content">
    {!entry?.path ? <Typography color="text.secondary" sx={{ p: 4 }}>この銘柄のチャートは未配信です。</Typography>
      : query.isLoading ? <Box role="status" sx={{ p: 6 }}><CircularProgress size={24} /> チャートを読み込み中…</Box>
      : query.isError ? <Alert severity="error" action={<Button onClick={() => query.refetch()}>再試行</Button>}>チャートを取得できません。</Alert>
      : !data?.bars?.length ? <Typography sx={{ p: 4 }}>ローソク足データが不足しています。</Typography> : null}
    {!renderChart && warningMessage && <Alert severity="warning">{warningMessage}</Alert>}
    {ready && !activated && <div className="research-chart-placeholder" style={{ minHeight: plotHeight + CLOSED_CHROME_HEIGHT }}>
      <button type="button" onFocus={() => { focusRequested.current = true; }} onBlur={() => { focusRequested.current = false; }} onClick={() => { focusRequested.current = true; setActivated(true); }}>日次チャートを表示</button>
    </div>}
    {renderChart && <div hidden={!ready} aria-hidden={!ready}>
      <CandlestickChart smallScreen={small} researchView bookAnnotations symbol={symbol} height={plotHeight}
        chartIdentity={JSON.stringify([symbol, date, generation, entry?.path])}
        priceData={ready ? data.bars : EMPTY_BARS} rsLineData={ready ? data.rs_line || null : null} rsRatingValue={ready ? rsRating ?? null : null}
        epsLine={ready ? data.eps_line || null : null} blueDots={ready ? data.blue_dots || null : null}
        dataUpdatedAtOverride={ready && data.generated_at ? Date.parse(data.generated_at) : null}
        hideOhlcLegend hideTimeframeToggle={false}
        pivotPrice={ready ? canonicalPivot(contextRow || {}).price : null}
        buyCeiling={ready ? plan.upper : null} stopPrice={ready ? plan.stopExample : null} pivotLabel="共通ピボット" vcpBoxes={ready ? data.vcp_boxes || null : null} />
    </div>}
    </div>
    </div>
  </Box>;
}
