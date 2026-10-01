import { useMemo, memo } from 'react';
import { AreaChart, Area, ResponsiveContainer, YAxis } from 'recharts';
import { Box, Tooltip, Typography, useTheme } from '@mui/material';

/**
 * Price Sparkline Component
 *
 * Renders an area chart sparkline showing the price trend
 * over the last 30 trading days. Uses normalized prices for
 * consistent visual comparison across stocks.
 *
 * Color coding:
 * - Green: Price up overall (30-day change positive)
 * - Red: Price down overall (30-day change negative)
 *
 * Displays 1-day change as text badge
 */
function PriceSparkline({
  data,
  trend,
  change1d,
  industry,  // Industry to show in tooltip
  width = 100,
  height = 28,
  showChange = true,  // Whether to show the 1-day change text
  sparklineWidth = 60,  // Width of the inner sparkline chart when showChange is true
}) {
  const theme = useTheme();
  // Transform data for chart
  const { chartData, domain, color, fillColor } = useMemo(() => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return { chartData: [], domain: [0, 1], color: theme.palette.text.secondary, fillColor: theme.palette.text.secondary };
    }

    // Convert to chart format
    const chartData = data.map((value, index) => ({
      index,
      value,
    }));

    const minVal = Math.min(...data);
    const maxVal = Math.max(...data);

    // Add 5% padding to domain
    const range = maxVal - minVal || 0.01;
    const padding = range * 0.05;

    // Determine color based on trend
    // trend: 1 = up, -1 = down, 0 = flat
    const isUp = trend === 1;
    const color = isUp ? theme.palette.success.main : theme.palette.error.main;
    const fillColor = color;

    return {
      chartData,
      domain: [minVal - padding, maxVal + padding],
      color,
      fillColor,
    };
  }, [data, trend, theme]);

  // Format 1-day change for display
  const changeText = useMemo(() => {
    if (change1d === null || change1d === undefined) return null;
    const sign = change1d >= 0 ? '+' : '';
    return `${sign}${change1d.toFixed(1)}%`;
  }, [change1d]);

  const changeColor = useMemo(() => {
    if (change1d === null || change1d === undefined) return 'text.secondary';
    return change1d >= 0 ? 'success.main' : 'error.main';
  }, [change1d]);

  // Tooltip content
  const tooltipText = useMemo(() => {
    const parts = [];

    // Add industry if available
    if (industry) {
      parts.push(industry);
    }

    // Add 30-day trend description
    const trendText = trend === 1 ? '上昇' : trend === -1 ? '下落' : '横ばい';
    if (data && data.length > 0) {
      const overallChange = ((data[data.length - 1] - data[0]) / data[0]) * 100;
      parts.push(`直近${data.length}営業日: ${overallChange >= 0 ? '+' : ''}${overallChange.toFixed(1)}% (${trendText})`);
    }

    return parts.join(' | ') || '株価推移データ未配信';
  }, [industry, trend, data]);

  // No data - show placeholder
  if (!chartData || chartData.length === 0) {
    return (
      <Box
        sx={{
          width,
          height,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'text.secondary',
          fontSize: 12,
        }}
      >
        -
      </Box>
    );
  }

  return (
    <Tooltip title={tooltipText} arrow placement="top">
      <Box role="img" aria-label={tooltipText}
        sx={{
          width,
          height,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        {/* Sparkline Chart */}
        <Box
          sx={{
            width: showChange ? sparklineWidth : '100%',
            height: '100%',
            flex: showChange ? '1 1 auto' : 1,
            minWidth: 0,
          }}
        >
          <ResponsiveContainer width="100%" height="100%" aria-hidden="true">
            <AreaChart
              data={chartData}
              margin={{ top: 2, right: 0, left: 0, bottom: 2 }}
            >
              <YAxis domain={domain} hide />
              <Area
                type="monotone"
                dataKey="value"
                stroke={color}
                strokeWidth={1.5}
                fill={fillColor}
                fillOpacity={0.12}
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </Box>

        {/* 1-Day Change Badge */}
        {showChange && changeText && (
          <Typography
            sx={{
              fontSize: 12,
              fontWeight: 600,
              fontFamily: 'monospace',
              color: changeColor,
              whiteSpace: 'nowrap',
              flexShrink: 0,
            }}
          >
            {changeText}
          </Typography>
        )}
      </Box>
    </Tooltip>
  );
}

export default memo(PriceSparkline);
