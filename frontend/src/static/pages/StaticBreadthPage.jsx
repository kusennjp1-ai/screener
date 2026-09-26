import { formatPublished } from '../researchPresentation';
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  CircularProgress,
  Button,
  useTheme,
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
import MarketPulse from '../components/MarketPulse';
import BookMarketEvidence from '../components/BookMarketEvidence';
import BookBreakoutJournal from '../components/BookBreakoutJournal';
import { breadthSummary, recentBreadth } from '../breadthSummary';
import '../market.css';
import { useStaticManifest, fetchStaticJson, resolveStaticMarketEntry } from '../dataClient';
import { useStaticMarket } from '../StaticMarketContext';

function StaticBreadthPage() {
  const theme = useTheme();
  const manifestQuery = useStaticManifest();
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const breadthQuery = useQuery({
    queryKey: ['staticBreadth', marketEntry.pages?.breadth?.path, manifestQuery.data?.generated_at],
    queryFn: () => fetchStaticJson(marketEntry.pages.breadth.path),
    enabled: Boolean(marketEntry.pages?.breadth?.path),
    staleTime: 60000,
    placeholderData: () => undefined,
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
  const analysisDate = payload.current?.date;
  const filteredChartData = useMemo(() => {
    const allData = [...(payload.history_90d || []), ...(payload.chart_data || [])];
    return recentBreadth(allData, timeRange, analysisDate);
  }, [payload.chart_data, payload.history_90d, analysisDate, timeRange]);
  const filteredSpyData = useMemo(() => {
    const allSpy = payload.benchmark_overlay ?? payload.spy_overlay ?? [];
    return recentBreadth(allSpy, timeRange, analysisDate);
  }, [payload.benchmark_overlay, payload.spy_overlay, analysisDate, timeRange]);
  const benchmarkLabel = payload.benchmark_symbol || (marketEntry.market === 'US' ? 'SPY' : 'Benchmark');

  if (manifestQuery.isLoading || breadthQuery.isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (manifestQuery.isError || breadthQuery.isError) {
    return <Alert severity="error" action={<Button onClick={() => { manifestQuery.refetch(); breadthQuery.refetch(); }}>再試行</Button>}>騰落データの読み込みに失敗しました。</Alert>;
  }

  if (breadthQuery.data?.available === false) {
    return <Alert severity="info">{breadthQuery.data?.message || '騰落スナップショットがありません。'}</Alert>;
  }

  const current = payload.current || {};
  const history = recentBreadth(payload.history_90d || [], '3M', current.date).reverse();
  const summary = breadthSummary(current);
  const mismatch = Boolean(marketEntry.as_of_date && current.date !== marketEntry.as_of_date);

  return (
    <Box component="main" className="market-workbench" data-theme={theme.palette.mode}>
      <header className="market-page-head"><div><div className="research-kicker">MARKET OVERVIEW</div><Typography component="h1" sx={{ fontWeight: 750, fontSize: { xs: 28, md: 34 }, letterSpacing: '-.04em', mt: 1 }}>市場環境</Typography><Typography color="text.secondary" sx={{ fontSize: 13, mt: .5 }}>{displayName} / 日次スナップショット</Typography></div><div className="market-date"><span>分析基準日</span><strong>{current.date || '未確認'}</strong><Button size="small" onClick={() => { manifestQuery.refetch(); breadthQuery.refetch(); }}>データを再確認 ↻</Button></div></header>
      {(summary.fresh.state !== 'recent' || mismatch) && <Alert severity="warning" sx={{ mb: 2 }}>分析日が古い、未確認、または公開データと一致しません。最新の市場状態として扱わないでください。</Alert>}
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
          <MarketPulse current={mismatch ? { date: current.date } : current} history={filteredChartData} range={timeRange} onRangeChange={setTimeRange} />
          {marketEntry.market === 'US' && payload.book_market_evidence && <details className="market-disclosure"><summary>市場判断の根拠 — 新高値・先導株・出来高</summary><BookMarketEvidence evidence={payload.book_market_evidence} expectedDate={marketEntry.as_of_date} /></details>}
          {marketEntry.market === 'US' && <details className="market-disclosure"><summary>ブレイク後の成績を記録する</summary><BookBreakoutJournal /></details>}
          {marketEntry.market === 'US' && !mismatch && payload.book_leadership?.date === current.date && <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
            <details className="research-disclosure"><summary>先導株の状態を詳しく確認する</summary>
            <Typography sx={{ my: 1 }}>日足検証済み {payload.book_leadership.verified} / {payload.book_leadership.universe}銘柄。『基本と原則』の一次条件通過 {payload.book_leadership.templateLeaders}銘柄、検証母集団の高値5%以内 {payload.book_leadership.nearHigh}銘柄。</Typography>
            <Typography sx={{ fontSize: 13 }}>一次通過株のRSライン30営業日前比プラス：{payload.book_leadership.rsUp} / {payload.book_leadership.rsAvailable}銘柄（RSラインを確認できた範囲）。指数の上昇だけで購入・増額を決めず、個別セットアップと保有後の反応を確認します。</Typography>
            <Typography sx={{ fontSize: 12, mt: 1 }} color="text.secondary">公開日足が揃う一部銘柄の当日集計です。市場全体の新高値・新安値数、ブレイク成功率、過去からの改善を示す統計ではありません。</Typography>
            <Button href="#/">銘柄ごとの根拠を確認 →</Button></details>
          </Paper>}
          <details className="market-disclosure"><summary>指数と比較する / 詳細チャート</summary>
            <Typography sx={{ px: 3, fontSize: 12, color: 'text.secondary' }}>指数データは配信された期間のみ表示します：{filteredSpyData[0]?.date || '未確認'} → {filteredSpyData.at(-1)?.date || '未確認'}</Typography>
            <BreadthChart breadthData={filteredChartData} spyData={filteredSpyData} benchmarkLabel={benchmarkLabel} isLoading={false} error={null} timeRange={timeRange} onTimeRangeChange={setTimeRange} availableRanges={['1M', '3M']} />
          </details>
          <details className="market-disclosure"><summary>日別データを確認する（直近20営業日）</summary>
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
          </details>
        </>
      )}

      {selectedTab === 1 && <BreadthGroupAttribution attribution={groupAttribution} />}
      <footer className="market-footnote">4%以上の騰落銘柄数は、市場全体の上昇・下落銘柄数とは異なります。10日レシオ＝期間内の4%以上上昇銘柄数の合計 ÷ 同下落銘柄数の合計。<br />公開更新：{formatPublished(breadthQuery.data.published_at || breadthQuery.data.generated_at)}<br /><a href="#/">銘柄の選定・10万ドル配分へ →</a></footer>
      {metricInfoPopover}
    </Box>
  );
}

export default StaticBreadthPage;
