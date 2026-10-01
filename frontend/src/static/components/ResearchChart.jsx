import { requireChartIdentity } from '../chartPayloadIdentity';
import { entryPlan } from '../researchEngine';
import { canonicalPivot } from '../researchPresentation';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Typography, useMediaQuery } from '@mui/material';
import CandlestickChart from '../../components/Charts/CandlestickChart';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';

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
  const plan = entryPlan(row || data?.stock_data || {},quote,method);
  return <Box component="section" className="research-chart" aria-label={`${symbol} の日次チャート`}>
    {!entry?.path ? <Typography color="text.secondary" sx={{ p: 4 }}>この銘柄のチャートは未配信です。</Typography>
      : query.isLoading ? <Box role="status" sx={{ p: 6 }}><CircularProgress size={24} /> チャートを読み込み中…</Box>
      : query.isError ? <Alert severity="error" action={<Button onClick={() => query.refetch()}>再試行</Button>}>チャートを取得できません。</Alert>
      : !data?.bars?.length ? <Typography sx={{ p: 4 }}>ローソク足データが不足しています。</Typography>
      : <CandlestickChart smallScreen={small} researchActions={<Button size="small" onClick={onExpand} aria-label="日次チャートを分析">拡大 ↗</Button>} researchView bookAnnotations key={symbol} symbol={symbol} height={small ? 360 : 440}
        priceData={data.bars} rsLineData={data.rs_line || null} rsRatingValue={rsRating ?? null}
        epsLine={data.eps_line || null} blueDots={data.blue_dots || null}
        dataUpdatedAtOverride={data.generated_at ? Date.parse(data.generated_at) : null}
        hideOhlcLegend hideTimeframeToggle={false}
        pivotPrice={canonicalPivot(row || data.stock_data).price}
        buyCeiling={plan.upper} stopPrice={plan.stopExample} pivotLabel="共通ピボット" vcpBoxes={data.vcp_boxes || null} />}

  </Box>;
}
