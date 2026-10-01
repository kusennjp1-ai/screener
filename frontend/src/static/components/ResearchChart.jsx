import { requireChartIdentity } from '../chartPayloadIdentity';
import { useEffect, useState } from 'react';
import { entryPlan } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Typography, useMediaQuery } from '@mui/material';
import CandlestickChart from '../../components/Charts/CandlestickChart';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';

const EMPTY_BARS = Object.freeze([]);

export default function ResearchChart({ entry, symbol, generation, onExpand, rsRating, row, method, quote, date }) {
  const small = useMediaQuery('(max-width: 700px)');
  const query = useQuery({
    queryKey: [...staticChartKeys.payload(symbol, entry?.path), generation],
    queryFn: () => fetchStaticChartPayload(entry.path),
    enabled: Boolean(entry?.path), staleTime: 60000,
    placeholderData: () => undefined,
    select: payload => requireChartIdentity(payload, symbol, date),
  });
  const data = query.data;
  const ready = Boolean(entry?.path && !query.isError && data?.bars?.length);
  const [initialized, setInitialized] = useState(false);
  useEffect(() => { if (ready) setInitialized(true); }, [ready]);
  const plan = entryPlan(row || data?.stock_data || {},quote,method);
  return <Box component="section" className="research-chart" aria-label={`${symbol} の日次チャート`}>
    {!entry?.path ? <Typography color="text.secondary" sx={{ p: 4 }}>この銘柄のチャートは未配信です。</Typography>
      : query.isLoading ? <Box role="status" sx={{ p: 6 }}><CircularProgress size={24} /> チャートを読み込み中…</Box>
      : query.isError ? <Alert severity="error" action={<Button onClick={() => query.refetch()}>再試行</Button>}>チャートを取得できません。</Alert>
      : !data?.bars?.length ? <Typography sx={{ p: 4 }}>ローソク足データが不足しています。</Typography> : null}
    {(ready || initialized) && <div hidden={!ready} aria-hidden={!ready}>
      <CandlestickChart smallScreen={small} researchActions={<Button size="small" onClick={onExpand} aria-label="日次チャートを分析">拡大 ↗</Button>} researchView bookAnnotations symbol={symbol} height={small ? 360 : 440}
        chartIdentity={JSON.stringify([symbol, date, generation, entry?.path])}
        priceData={ready ? data.bars : EMPTY_BARS} rsLineData={ready ? data.rs_line || null : null} rsRatingValue={ready ? rsRating ?? null : null}
        epsLine={ready ? data.eps_line || null : null} blueDots={ready ? data.blue_dots || null : null}
        dataUpdatedAtOverride={ready && data.generated_at ? Date.parse(data.generated_at) : null}
        hideOhlcLegend hideTimeframeToggle={false}
        pivotPrice={ready ? canonicalPivot(row || data.stock_data).price : null}
        buyCeiling={ready ? plan.upper : null} stopPrice={ready ? plan.stopExample : null} pivotLabel="共通ピボット" vcpBoxes={ready ? data.vcp_boxes || null : null} />
    </div>}

  </Box>;
}
