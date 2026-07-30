import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Box,
  CircularProgress,
  Grid,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import {
  useStaticManifest,
  fetchStaticJson,
  resolveStaticMarketEntry,
  useStaticGroupsRRG,
} from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import StaticGroupDetailModal from '../StaticGroupDetailModal';
import RRGChart from '../../components/Charts/RRGChart';
import RRGViewToggle from '../../components/Charts/RRGViewToggle';
import { useRRGScopeSelection } from '../../components/Charts/useRRGScopeSelection';
import RankChangeCell from '../../components/shared/RankChangeCell';
import TickerCell from '../../components/common/TickerCell';
import { GlossaryHeaderCell, useMetricInfoPopover } from '../../components/common/MetricInfoPopover';
import { useStaticMarket } from '../StaticMarketContext';
import { C, T, W, px } from '../designTokens';
import { SnapshotGapPanel, buildSnapshotFacts, marketDisplayNameJa } from './SnapshotGapPanel';

/**
 * 書き出しに業種グループランキングが無いとき、バックエンドの英語メッセージ
 * （"No group rankings are available for static-site export date …"）を
 * そのまま出していた。生のバックエンド文字列はユーザー向けの文言ではないので、
 * 原因のカテゴリだけを見て日本語の説明に置き換える。
 * 未知の原因でも生文字列は絶対に返さない。
 */
function describeGroupsGap(message) {
  const text = String(message || '');
  if (/group rank/i.test(text)) {
    return '基準日の業種グループランキングがスナップショットに入っていません。ランキングは市場全体の銘柄をまとめて順位づけするため、対象銘柄が揃わない書き出しでは作成されません。';
  }
  if (/rrg/i.test(text)) {
    return '基準日の RRG（相対強弱ローテーション）を計算できませんでした。順位の履歴が足りていないためです。';
  }
  return '基準日の業種グループランキングがスナップショットに入っていません。書き出しの時点でデータが揃っていなかったためです。';
}

function MoversCard({ title, rows, openInfo }) {
  return (
    <Paper elevation={0} sx={{ p: 1.5, height: '100%', border: '1px solid', borderColor: 'divider' }}>
      <Typography variant="subtitle1" sx={{ fontWeight: W.semibold, fontSize: px(T.body), letterSpacing: '0.5px', mb: 0.5 }}>
        {title}
      </Typography>
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <GlossaryHeaderCell glossaryId="ibd_industry_group" openInfo={openInfo} align="left">業種グループ</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="group_rank" openInfo={openInfo} align="right">順位</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="group_rank_change" openInfo={openInfo} align="right">変化</GlossaryHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {(rows || []).slice(0, 5).map((row) => (
              <TableRow key={`${title}-${row.industry_group}`}>
                <TableCell>{row.industry_group}</TableCell>
                <TableCell align="right">{row.rank}</TableCell>
                <TableCell align="right">
                  <RankChangeCell value={row.rank_change_1w} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
}

function GroupsTableView({ movers, moversPeriod, rankings, onSelectGroup, openInfo }) {
  return (
    <>
      <Grid container spacing={1.5} sx={{ mb: 2 }}>
        <Grid item xs={12} md={6}>
          <MoversCard title={`上昇グループ（${moversPeriod.toUpperCase()}）`} rows={movers.gainers} openInfo={openInfo} />
        </Grid>
        <Grid item xs={12} md={6}>
          <MoversCard title={`下落グループ（${moversPeriod.toUpperCase()}）`} rows={movers.losers} openInfo={openInfo} />
        </Grid>
      </Grid>

      <Paper elevation={0} sx={{ p: 1.5, border: '1px solid', borderColor: 'divider' }}>
        <Typography variant="subtitle1" sx={{ fontWeight: W.semibold, fontSize: px(T.body), letterSpacing: '0.5px', mb: 0.5 }}>
          現在のランキング
        </Typography>
        <TableContainer>
          <Table size="small">
            <TableHead>
              <TableRow>
                <GlossaryHeaderCell glossaryId="group_rank" openInfo={openInfo}>順位</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="ibd_industry_group" openInfo={openInfo} align="left">業種グループ</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_avg_rs" openInfo={openInfo}>平均RS</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_num_stocks" openInfo={openInfo}>銘柄数</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_rank_change_1w" openInfo={openInfo} align="right">1週</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_rank_change_1m" openInfo={openInfo} align="right">1ヶ月</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_rank_change_3m" openInfo={openInfo} align="right">3ヶ月</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_rank_change_6m" openInfo={openInfo} align="right">6ヶ月</GlossaryHeaderCell>
                <GlossaryHeaderCell glossaryId="group_top_stock" openInfo={openInfo} align="left">代表銘柄</GlossaryHeaderCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rankings.map((row) => (
                <TableRow
                  key={row.industry_group}
                  hover
                  onClick={() => onSelectGroup(row.industry_group)}
                  tabIndex={0}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      onSelectGroup(row.industry_group);
                    }
                  }}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell align="center" sx={{ fontFamily: 'monospace', fontWeight: W.semibold }}>{row.rank}</TableCell>
                  <TableCell>{row.industry_group}</TableCell>
                  <TableCell align="center" sx={{ fontFamily: 'monospace' }}>{row.avg_rs_rating?.toFixed?.(1) ?? '-'}</TableCell>
                  <TableCell align="center" sx={{ fontFamily: 'monospace' }}>{row.num_stocks}</TableCell>
                  <TableCell align="right"><RankChangeCell value={row.rank_change_1w} /></TableCell>
                  <TableCell align="right"><RankChangeCell value={row.rank_change_1m} /></TableCell>
                  <TableCell align="right"><RankChangeCell value={row.rank_change_3m} /></TableCell>
                  <TableCell align="right"><RankChangeCell value={row.rank_change_6m} /></TableCell>
                  <TableCell sx={{ fontSize: px(T.micro) }}>
                    <TickerCell symbol={row.top_symbol} companyName={row.top_symbol_name} />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>
    </>
  );
}

function StaticGroupsPage() {
  const manifestQuery = useStaticManifest();
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const groupsQuery = useQuery({
    queryKey: ['staticGroups', marketEntry.pages?.groups?.path],
    queryFn: () => fetchStaticJson(marketEntry.pages.groups.path),
    enabled: Boolean(marketEntry.pages?.groups?.path),
    staleTime: Infinity,
  });
  const chartIndexQuery = useStaticChartIndex(marketEntry.assets?.charts?.path);
  const rrgQuery = useStaticGroupsRRG(marketEntry);
  const rrgAvailable = Boolean(marketEntry.assets?.groups_rrg?.path);
  // グループ詳細モーダルと表示モードはURLと同期し、戻る/進むで操作を巻き戻せるようにする
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedGroup = searchParams.get('group');
  const view = searchParams.get('view') === 'rrg' ? 'rrg' : 'table'; // 'table' | 'rrg'
  const setSelectedGroup = useCallback((group) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (group) {
        next.set('group', group);
      } else {
        next.delete('group');
      }
      return next;
    }, group ? undefined : { replace: true });
  }, [setSearchParams]);
  const setView = useCallback((nextView) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (nextView === 'rrg') {
        next.set('view', 'rrg');
      } else {
        next.delete('view');
      }
      return next;
    });
  }, [setSearchParams]);
  const [rrgScope, setRrgScope] = useState('groups'); // 'groups' | 'sectors'
  const snapshotFacts = useMemo(() => buildSnapshotFacts(marketEntry), [marketEntry]);
  const { openInfo, popover: metricInfoPopover } = useMetricInfoPopover();
  const { availableScopes: availableRrgScopes } = useRRGScopeSelection({
    view,
    scope: rrgScope,
    setView,
    setScope: setRrgScope,
    rrgAvailable,
    bundle: rrgQuery.data,
  });

  if (manifestQuery.isLoading || groupsQuery.isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (manifestQuery.isError || groupsQuery.isError) {
    return (
      <Box>
        <Typography variant="h5" sx={{ fontWeight: W.bold, letterSpacing: '-0.5px', mb: 2 }}>
          {marketDisplayNameJa(marketEntry)} 業種グループランキング
        </Typography>
        <SnapshotGapPanel
          testId="groups-fetch-failed"
          title="業種グループランキングを読み込めませんでした"
          statusLabel="読み込み失敗"
          reason="スナップショットのランキングファイルを取得できませんでした。通信が切れているか、公開途中の可能性があります。"
          actions={[
            { to: '/', label: 'デイリーに戻る' },
            { to: '/scan', label: 'スキャンを見る' },
          ]}
          footnote="ページを再読み込みしても直らない場合は、次のスナップショット公開までお待ちください。"
        />
      </Box>
    );
  }

  if (!groupsQuery.data?.available) {
    return (
      <Box>
        <Typography variant="h5" sx={{ fontWeight: W.bold, letterSpacing: '-0.5px', mb: 0.5 }}>
          {marketDisplayNameJa(marketEntry)} 業種グループランキング
        </Typography>
        <Typography sx={{ fontSize: px(T.body), color: C.grey, mb: 2 }}>
          基準日 {groupsQuery.data?.expected_as_of_date || marketEntry.as_of_date || '-'}
        </Typography>
        <SnapshotGapPanel
          testId="groups-unavailable"
          title="業種グループランキングはこの日には入っていません"
          reason={describeGroupsGap(groupsQuery.data?.message)}
          facts={snapshotFacts}
          actions={[
            { to: '/', label: 'デイリーで相場判定を見る' },
            { to: '/scan', label: 'スキャンで銘柄を絞る' },
          ]}
          footnote="ランキングは次回のスナップショットにデータが揃えば、この画面に自動で表示されます。個別銘柄の業種は「スキャン」の各行から確認できます。"
        />
      </Box>
    );
  }

  const payload = groupsQuery.data.payload || {};
  const rankings = payload.rankings?.rankings || [];
  const movers = payload.movers || {};
  const moversPeriod = payload.movers_period || movers.period || '1w';
  const groupDetails = payload.group_details || {};

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: W.bold, letterSpacing: '-0.5px', mb: 0.5 }}>
        {marketDisplayNameJa(marketEntry)} 業種グループランキング
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, fontSize: px(T.micro) }}>
        最新ランキング日付: {payload.rankings?.date || '-'}
      </Typography>

      {rrgAvailable && (
        <RRGViewToggle
          view={view}
          onView={setView}
          scope={rrgScope}
          onScope={setRrgScope}
          rrgAvailable={rrgAvailable}
          availableScopes={availableRrgScopes}
          sx={{ mb: 2 }}
        />
      )}

      {view === 'rrg' ? (
        <RRGChart
          data={rrgQuery.data?.payload?.[rrgScope]}
          isLoading={rrgQuery.isLoading}
          error={rrgQuery.isError ? rrgQuery.error : null}
          onSelectGroup={(name) => rrgScope === 'groups' && setSelectedGroup(name)}
        />
      ) : (
        <GroupsTableView
          movers={movers}
          moversPeriod={moversPeriod}
          rankings={rankings}
          onSelectGroup={setSelectedGroup}
          openInfo={openInfo}
        />
      )}

      <StaticGroupDetailModal
        group={selectedGroup}
        detail={selectedGroup ? groupDetails[selectedGroup] : null}
        chartIndex={chartIndexQuery.data}
        open={!!selectedGroup}
        onClose={() => setSelectedGroup(null)}
      />
      {metricInfoPopover}
    </Box>
  );
}

export default StaticGroupsPage;
