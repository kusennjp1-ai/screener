import {
  Box,
  Paper,
  useMediaQuery,
  useTheme,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { useState } from 'react';
import PriceSparkline from '../../components/Scan/PriceSparkline';
import RSSparkline from '../../components/Scan/RSSparkline';
import TickerCell from '../../components/common/TickerCell';
import { GlossaryHeaderCell, useMetricInfoPopover } from '../../components/common/MetricInfoPopover';
import { getGroupRankColor } from '../../utils/colorUtils';
import { formatLocalCurrency } from '../../utils/formatUtils';
import { resolveMarketCapDisplay } from '../../utils/marketCapUtils';
import { C, T, W, px } from '../designTokens';
import ScanResultCards from './ScanResultCards';

// Characters of the section subtitle shown before the 説明を読む disclosure.
const SUBTITLE_PREVIEW_CHARS = 42;

const formatNumber = (value, digits = 0) => {
  if (value == null) return '-';
  return Number(value).toLocaleString(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  });
};

function DailyScanRowsTable({
  title,
  subtitle,
  rows,
  chartEnabledSymbols,
  navigationSymbols,
  onOpenChart,
  emptyMessage,
  action = null,
  showRs = false,
  showRating = false,
  priceSparklineWidth = 137,
  priceSparklineInnerWidth = 86,
  testId,
}) {
  const { openInfo, popover: metricInfoPopover } = useMetricInfoPopover();
  const theme = useTheme();
  // The 9-11 column table needs ~700px. On a phone it clipped its own last
  // columns (株価トレンド ran off the right edge) while 時価総額 showed a dash
  // in every row. Cards carry the same rows in the decision's own order.
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  // A 6-line explanation above a 2-row table buries the content it explains.
  // Keep the first line visible and put the rest one tap away.
  const [subtitleOpen, setSubtitleOpen] = useState(false);
  const subtitleText = typeof subtitle === 'string' ? subtitle : '';
  const subtitleIsLong = subtitleText.length > SUBTITLE_PREVIEW_CHARS;
  const isChartEnabled = (symbol) => chartEnabledSymbols.has(symbol);
  const handleRowOpen = (symbol) => {
    if (isChartEnabled(symbol)) {
      onOpenChart(symbol, navigationSymbols);
    }
  };
  const colSpan = 8 + (showRs ? 1 : 0) + (showRating ? 1 : 0);

  return (
    <Paper
      data-testid={testId}
      elevation={0}
      sx={{ p: 1.5, mb: 2, border: '1px solid', borderColor: 'divider' }}
    >
      <Box
        sx={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 1,
          flexWrap: 'wrap',
          mb: 1,
        }}
      >
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: W.semibold, fontSize: px(T.body), letterSpacing: '0.5px', mb: 0.5 }}>
            {title}
          </Typography>
          <Typography variant="caption" color="text.disabled" sx={{ display: 'block', fontSize: px(T.micro) }}>
            {subtitleIsLong && !subtitleOpen
              ? `${subtitleText.slice(0, SUBTITLE_PREVIEW_CHARS)}…`
              : subtitle}
          </Typography>
          {subtitleIsLong && (
            <Box
              component="button"
              type="button"
              data-testid={testId ? `${testId}-subtitle-toggle` : undefined}
              onClick={() => setSubtitleOpen((v) => !v)}
              aria-expanded={subtitleOpen}
              sx={{
                minHeight: 44, display: 'inline-flex', alignItems: 'center',
                background: 'none', border: 0, p: 0, cursor: 'pointer',
                color: C.blue, font: 'inherit', fontSize: px(T.micro),
              }}
            >
              {subtitleOpen ? '説明を閉じる ▴' : '説明を読む ▾'}
            </Box>
          )}
        </Box>
        {action}
      </Box>
      {isMobile ? (
        <ScanResultCards
          rows={rows}
          onOpenChart={(symbol) => handleRowOpen(symbol)}
          isChartEnabled={isChartEnabled}
        />
      ) : (
      <TableContainer>
        <Table size="small">
          <TableHead>
            <TableRow>
              <GlossaryHeaderCell glossaryId="symbol" openInfo={openInfo}>銘柄</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="daily_score" openInfo={openInfo}>スコア</GlossaryHeaderCell>
              {showRs ? <GlossaryHeaderCell glossaryId="rs_rating" openInfo={openInfo}>RS</GlossaryHeaderCell> : null}
              <GlossaryHeaderCell glossaryId="current_price" openInfo={openInfo}>株価</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="market_cap" openInfo={openInfo}>時価総額</GlossaryHeaderCell>
              {showRating ? <GlossaryHeaderCell glossaryId="rating" openInfo={openInfo}>評価</GlossaryHeaderCell> : null}
              <GlossaryHeaderCell glossaryId="price_trend_30d" openInfo={openInfo}>株価トレンド（30日）</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="rs_trend_30d" openInfo={openInfo}>RSトレンド（30日）</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="ibd_industry_group" openInfo={openInfo}>IBD業種</GlossaryHeaderCell>
              <GlossaryHeaderCell glossaryId="ibd_group_rank" openInfo={openInfo}>グループ順位</GlossaryHeaderCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => {
              const rowChartEnabled = isChartEnabled(row.symbol);
              return (
                <TableRow
                  key={row.symbol}
                  hover={rowChartEnabled}
                  tabIndex={rowChartEnabled ? 0 : -1}
                  onClick={() => handleRowOpen(row.symbol)}
                  onKeyDown={(event) => {
                    if (!rowChartEnabled) return;
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      handleRowOpen(row.symbol);
                    }
                  }}
                  sx={{ cursor: rowChartEnabled ? 'pointer' : 'default' }}
                >
                  <TableCell align="center">
                    <TickerCell symbol={row.symbol} companyName={row.company_name} align="center" />
                  </TableCell>
                  <TableCell align="center">{formatNumber(row.composite_score, 1)}</TableCell>
                  {showRs ? <TableCell align="center">{formatNumber(row.rs_rating, 0)}</TableCell> : null}
                  <TableCell align="center">{formatLocalCurrency(row.current_price, row.currency)}</TableCell>
                  <TableCell align="center">
                    {resolveMarketCapDisplay(row, null, { preferUsd: true }).formattedValue}
                  </TableCell>
                  {showRating ? <TableCell align="center">{row.rating}</TableCell> : null}
                  <TableCell align="center">
                    {row.price_sparkline_data ? (
                      <Box display="flex" justifyContent="center">
                        <PriceSparkline
                          data={row.price_sparkline_data}
                          trend={row.price_trend}
                          change1d={row.price_change_1d}
                          industry={row.ibd_industry_group}
                          width={priceSparklineWidth}
                          height={28}
                          sparklineWidth={priceSparklineInnerWidth}
                        />
                      </Box>
                    ) : '-'}
                  </TableCell>
                  <TableCell align="center">
                    {row.rs_sparkline_data ? (
                      <Box display="flex" justifyContent="center">
                        <RSSparkline
                          data={row.rs_sparkline_data}
                          trend={row.rs_trend}
                          width={117}
                          height={20}
                        />
                      </Box>
                    ) : '-'}
                  </TableCell>
                  <TableCell align="center" sx={{
                    color: 'text.secondary', fontSize: px(T.micro),
                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 140,
                  }}>
                    {row.ibd_industry_group || '-'}
                  </TableCell>
                  <TableCell align="center" sx={{
                    fontFamily: 'monospace', fontWeight: row.ibd_group_rank != null && row.ibd_group_rank <= 20 ? W.semibold : W.regular,
                    color: getGroupRankColor(row.ibd_group_rank),
                  }}>
                    {row.ibd_group_rank ?? '-'}
                  </TableCell>
                </TableRow>
              );
            })}
            {rows.length === 0 ? (
              <TableRow>
                <TableCell align="center" colSpan={colSpan}>
                  {emptyMessage}
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </TableContainer>
      )}
      {metricInfoPopover}
    </Paper>
  );
}

export default DailyScanRowsTable;
