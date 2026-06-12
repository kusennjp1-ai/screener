import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  CircularProgress,
  Grid,
  Paper,
  Tab,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tabs,
  Typography,
} from '@mui/material';
import BreadthChart from '../../components/Charts/BreadthChart';
import BreadthGroupAttribution from '../components/BreadthGroupAttribution';
import { GlossaryHeaderCell, useMetricInfoPopover } from '../../components/common/MetricInfoPopover';
import { hasGlossaryEntry } from '../../constants/metricGlossary';
import { useStaticManifest, fetchStaticJson, resolveStaticMarketEntry } from '../dataClient';
import { useStaticMarket } from '../StaticMarketContext';

const RANGE_DAYS = { '1M': 31, '3M': 90 };

function MetricCard({ label, value, glossaryId, openInfo }) {
  const clickable = Boolean(glossaryId && openInfo && hasGlossaryEntry(glossaryId));
  return (
    <Paper
      elevation={0}
      onClick={clickable ? (event) => openInfo(event, glossaryId) : undefined}
      title={clickable ? 'クリックで指標の説明を表示' : undefined}
      sx={{
        p: 1.5,
        height: '100%',
        border: '1px solid',
        borderColor: 'divider',
        cursor: clickable ? 'help' : 'default',
      }}
    >
      <Typography
        variant="caption"
        sx={{
          fontSize: '10px',
          letterSpacing: '0.5px',
          color: 'text.disabled',
          ...(clickable ? { textDecoration: 'underline dotted', textUnderlineOffset: '3px' } : {}),
        }}
      >
        {label}
      </Typography>
      <Typography variant="body1" sx={{ mt: 0.25, fontFamily: 'monospace', fontWeight: 600 }}>
        {value ?? '-'}
      </Typography>
    </Paper>
  );
}

function StaticBreadthPage() {
  const manifestQuery = useStaticManifest();
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const breadthQuery = useQuery({
    queryKey: ['staticBreadth', marketEntry.pages?.breadth?.path],
    queryFn: () => fetchStaticJson(marketEntry.pages.breadth.path),
    enabled: Boolean(marketEntry.pages?.breadth?.path),
    staleTime: Infinity,
  });
  const [timeRange, setTimeRange] = useState('1M');
  // タブはURL（?tab=groups）と同期し、戻る/進むで切り替えを巻き戻せるようにする
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedTab = searchParams.get('tab') === 'groups' ? 1 : 0;
  const handleTabChange = useCallback((_event, value) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value === 1) {
        next.set('tab', 'groups');
      } else {
        next.delete('tab');
      }
      return next;
    });
  }, [setSearchParams]);
  const { openInfo, popover: metricInfoPopover } = useMetricInfoPopover();

  const payload = breadthQuery.data?.payload || {};
  const groupAttribution = payload.group_attribution || null;
  const attributionAvailable = Boolean(groupAttribution?.available);
  const displayName = marketEntry.display_name;
  const filteredChartData = useMemo(() => {
    const allData = payload.chart_data || payload.history_90d || [];
    return allData.slice(-(RANGE_DAYS[timeRange] || 31));
  }, [payload.chart_data, payload.history_90d, timeRange]);
  const filteredSpyData = useMemo(() => {
    const allSpy = payload.benchmark_overlay ?? payload.spy_overlay ?? [];
    return allSpy.slice(-(RANGE_DAYS[timeRange] || 31));
  }, [payload.benchmark_overlay, payload.spy_overlay, timeRange]);
  const benchmarkLabel = payload.benchmark_symbol || (marketEntry.market === 'US' ? 'SPY' : 'Benchmark');

  if (manifestQuery.isLoading || breadthQuery.isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (manifestQuery.isError || breadthQuery.isError) {
    return <Alert severity="error">騰落データの読み込みに失敗しました。</Alert>;
  }

  if (breadthQuery.data?.available === false) {
    return <Alert severity="info">{breadthQuery.data?.message || '騰落スナップショットがありません。'}</Alert>;
  }

  const current = payload.current || {};
  const history = payload.history_90d || [];

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: 700, letterSpacing: '-0.5px', mb: 0.5 }}>
        {displayName} 騰落状況（ブレッドス）
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: '12px' }}>
        スナップショット公開: {breadthQuery.data.published_at || breadthQuery.data.generated_at}
      </Typography>

      <Tabs
        value={selectedTab}
        onChange={handleTabChange}
        sx={{ mb: 2, borderBottom: 1, borderColor: 'divider', minHeight: 36 }}
      >
        <Tab label="概要" sx={{ minHeight: 36, fontSize: '12px' }} />
        <Tab
          label="業種グループ別"
          sx={{ minHeight: 36, fontSize: '12px' }}
          disabled={!attributionAvailable && groupAttribution == null}
        />
      </Tabs>

      {selectedTab === 0 && (
        <>
          <Grid container spacing={1.5} sx={{ mb: 2 }}>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="日付" value={current.date} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="4%以上 上昇銘柄数" value={current.stocks_up_4pct} glossaryId="stocks_up_4pct" openInfo={openInfo} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="4%以上 下落銘柄数" value={current.stocks_down_4pct} glossaryId="stocks_down_4pct" openInfo={openInfo} />
            </Grid>
            <Grid item xs={12} sm={6} md={3}>
              <MetricCard label="10日レシオ" value={current.ratio_10day?.toFixed?.(2) ?? '-'} glossaryId="ratio_10day" openInfo={openInfo} />
            </Grid>
          </Grid>

          <BreadthChart
            breadthData={filteredChartData}
            spyData={filteredSpyData}
            benchmarkLabel={benchmarkLabel}
            isLoading={false}
            error={null}
            timeRange={timeRange}
            onTimeRangeChange={setTimeRange}
            availableRanges={['1M', '3M']}
          />

          <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 600, fontSize: '13px', letterSpacing: '0.5px', mb: 0.5 }}>
              直近の営業日
            </Typography>
            <TableContainer>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>日付</TableCell>
                    <GlossaryHeaderCell glossaryId="stocks_up_4pct" openInfo={openInfo} align="right">4%超 上昇</GlossaryHeaderCell>
                    <GlossaryHeaderCell glossaryId="stocks_down_4pct" openInfo={openInfo} align="right">4%超 下落</GlossaryHeaderCell>
                    <GlossaryHeaderCell glossaryId="ratio_5day" openInfo={openInfo} align="right">5日レシオ</GlossaryHeaderCell>
                    <GlossaryHeaderCell glossaryId="ratio_10day" openInfo={openInfo} align="right">10日レシオ</GlossaryHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {history.slice(0, 20).map((row) => (
                    <TableRow key={row.date}>
                      <TableCell>{row.date}</TableCell>
                      <TableCell align="right">{row.stocks_up_4pct}</TableCell>
                      <TableCell align="right">{row.stocks_down_4pct}</TableCell>
                      <TableCell align="right">{row.ratio_5day?.toFixed?.(2) ?? '-'}</TableCell>
                      <TableCell align="right">{row.ratio_10day?.toFixed?.(2) ?? '-'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Paper>
        </>
      )}

      {selectedTab === 1 && <BreadthGroupAttribution attribution={groupAttribution} />}
      {metricInfoPopover}
    </Box>
  );
}

export default StaticBreadthPage;
