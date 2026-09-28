import ChartDecisionSummary from './ChartDecisionSummary';
import { canonicalPivot } from '../researchPresentation';
import { useQuery } from '@tanstack/react-query';
import { Alert, Box, Button, CircularProgress, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import CandlestickChart from '../../components/Charts/CandlestickChart';
import { fetchStaticChartPayload, staticChartKeys } from '../chartClient';

export default function ResearchChart({ entry, symbol, generation, onExpand, rsRating, row, method, quote, date, market, now }) {
  const dark = useTheme().palette.mode === 'dark';
  const small = useMediaQuery('(max-width: 700px)');
  const query = useQuery({
    queryKey: [...staticChartKeys.payload(symbol, entry?.path), generation],
    queryFn: () => fetchStaticChartPayload(entry.path),
    enabled: Boolean(entry?.path), staleTime: 60000,
    placeholderData: () => undefined,
  });
  const data = query.data;
  return <Box className="research-chart" aria-label={`${symbol} の日次チャート`}>
    <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ px: 2, py: 1.25, borderBottom: '1px solid', borderColor: 'divider' }}>
      <Typography variant="body2" fontWeight={700}>価格・出来高・相対強度</Typography>
      <Button size="small" disabled={!entry} onClick={onExpand}>日次チャートを分析</Button>
    </Stack>
    {!entry?.path ? <Typography color="text.secondary" sx={{ p: 4 }}>この銘柄のチャートは未配信です。</Typography>
      : query.isLoading ? <Box role="status" sx={{ p: 6 }}><CircularProgress size={24} /> チャートを読み込み中…</Box>
      : query.isError ? <Alert severity="error" action={<Button onClick={() => query.refetch()}>再試行</Button>}>チャートを取得できません。</Alert>
      : !data?.bars?.length ? <Typography sx={{ p: 4 }}>ローソク足データが不足しています。</Typography>
      : <CandlestickChart smallScreen={small} researchView bookAnnotations key={symbol} symbol={symbol} height={small ? 410 : 520}
        priceData={data.bars} rsLineData={data.rs_line || null} rsRatingValue={rsRating ?? null}
        epsLine={data.eps_line || null} blueDots={data.blue_dots || null}
        dataUpdatedAtOverride={data.generated_at ? Date.parse(data.generated_at) : null}
        hideOhlcLegend={small} hideTimeframeToggle={small}
        pivotPrice={canonicalPivot(row || data.stock_data).price}
        pivotLabel="共通ピボット" vcpBoxes={data.vcp_boxes || null} />}
    {<ChartDecisionSummary row={row} date={date || data?.as_of_date} method={method} quote={quote} market={market} now={now} />}
    <Stack direction="row" flexWrap="wrap" gap={2} sx={{ px: 2, py: 1, fontSize: 12, color: 'text.secondary', borderTop: '1px solid', borderColor: 'divider' }}>
      <span style={{ color: dark ? '#60a5fa' : '#2563eb' }}>━ SMA50日 / 10週</span><span style={{ color: dark ? '#94a3b8' : '#64748b' }}>┄ SMA150日 / 30週</span><span style={{ color: dark ? '#c4b5fd' : '#7c3aed' }}>┈ SMA200日 / 40週</span><span>RS：対市場の強さ</span><span>日次データ / {data?.as_of_date || '未確認'}</span>
    </Stack>
  </Box>;
}
