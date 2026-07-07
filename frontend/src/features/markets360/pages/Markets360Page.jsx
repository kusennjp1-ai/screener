import { useMemo, useState, useCallback } from 'react';
import { useParams, useNavigate, Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Box, Button, CircularProgress, Snackbar, Typography, Alert } from '@mui/material';

import { fetchMarkets360, markets360Keys } from '../api/markets360';
import { createPosition } from '../../../api/positions';
import AddPositionDialog from '../../../components/positions/AddPositionDialog';
import ChartToolbar from '../components/ChartToolbar';
import StatusBar from '../components/StatusBar';
import Markets360Chart from '../components/Markets360Chart';
import BuyingNowCard from '../components/BuyingNowCard';
import ExitSignalCard from '../components/ExitSignalCard';
import SellPlanCard from '../components/SellPlanCard';
import QuarterlyStrip from '../components/QuarterlyStrip';

const PERIODS = [
  { key: '5y', label: '5y' },
  { key: '2y', label: '2y' },
  { key: '1y', label: '1y' },
  { key: '6mo', label: '6m' },
  { key: '3mo', label: '3m' },
  { key: '1mo', label: '1m' },
];
const MA_LEGEND = [
  { key: 'ma21', color: '#2962ff' },
  { key: 'ma50', color: '#f23645' },
  { key: 'ma150', color: '#787b86' },
  { key: 'ma200', color: '#b0bec5' },
];

function LegendOverlay({ data, timeframe, hover }) {
  const bars = data?.chart?.bars || [];
  const last = hover || bars[bars.length - 1];
  const prev = bars[bars.length - 2];
  const ma = data?.chart?.moving_averages || {};
  const lastMa = (k) => {
    const arr = ma[k];
    return arr && arr.length ? arr[arr.length - 1].value : null;
  };
  const change = last && prev ? last.close - prev.close : null;
  const changePct = change != null && prev ? (change / prev.close) * 100 : null;
  const c = (v) => (v == null ? '–' : Number(v).toFixed(2));

  return (
    // Translucent backing + responsive sizes: on 375px the naked legend text
    // used to wrap onto the candles and become unreadable.
    <Box sx={{
      position: 'absolute', top: 54, left: 12, zIndex: 4, pointerEvents: 'none',
      maxWidth: 'calc(100% - 24px)', bgcolor: 'rgba(10,11,16,0.55)',
      borderRadius: 1, px: 0.75, py: 0.25,
    }}>
      <Typography noWrap sx={{ color: '#e6e8ec', fontSize: { xs: 12.5, sm: 15 }, fontWeight: 700 }}>
        {data?.symbol} · {data?.name} · {timeframe === 'weekly' ? '1W' : '1D'} · {data?.exchange}
      </Typography>
      {last && (
        <Box sx={{ display: 'flex', gap: 1, mt: 0.25 }}>
          <Typography sx={{ fontSize: 12, color: '#787b86' }}>
            O <span style={{ color: '#d1d4dc' }}>{c(last.open)}</span>{'  '}
            H <span style={{ color: '#d1d4dc' }}>{c(last.high)}</span>{'  '}
            L <span style={{ color: '#d1d4dc' }}>{c(last.low)}</span>{'  '}
            C <span style={{ color: '#d1d4dc' }}>{c(last.close)}</span>
          </Typography>
          {change != null && (
            <Typography sx={{ fontSize: 12, color: change >= 0 ? '#22ab94' : '#f23645' }}>
              {change >= 0 ? '+' : ''}{c(change)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: { xs: 0.75, sm: 1.5 }, mt: 0.25 }}>
        {MA_LEGEND.map((m) => {
          const v = lastMa(m.key);
          if (v == null) return null;
          return (
            <Typography key={m.key} sx={{ fontSize: { xs: 10.5, sm: 12 }, color: m.color, fontWeight: 600 }}>
              MA {Number(v).toFixed(2)}
            </Typography>
          );
        })}
        {data?.chart?.benchmark_symbol && (
          <Typography sx={{ fontSize: 12, color: '#9598a1', fontWeight: 600 }}>
            {data.chart.benchmark_symbol}
            {(() => {
              const ov = data?.chart?.spy_overlay;
              const v = ov && ov.length ? ov[ov.length - 1].value : null;
              return v != null ? `  ${Number(v).toFixed(2)}` : '';
            })()}
          </Typography>
        )}
      </Box>
    </Box>
  );
}

export default function Markets360Page() {
  const { ticker } = useParams();
  const navigate = useNavigate();
  const symbol = (ticker || 'AAPL').toUpperCase();
  const [timeframe, setTimeframe] = useState('daily');
  const [period, setPeriod] = useState('1y');
  const [hover, setHover] = useState(null);
  const [registerOpen, setRegisterOpen] = useState(false);
  const [registered, setRegistered] = useState(false);
  const registerMutation = useMutation({
    mutationFn: createPosition,
    onSuccess: () => { setRegisterOpen(false); setRegistered(true); },
  });

  const { data, isLoading, error } = useQuery({
    queryKey: markets360Keys.symbol(symbol, period),
    queryFn: () => fetchMarkets360(symbol, period),
    enabled: Boolean(symbol),
    staleTime: 60_000,
  });

  const onLegend = useCallback((d) => {
    if (d && d.time) setHover({ open: d.open, high: d.high, low: d.low, close: d.close });
  }, []);

  const chartPayload = useMemo(() => data?.chart || null, [data]);

  return (
    <Box sx={{ bgcolor: '#0a0a0f', minHeight: 'calc(100vh - 48px)', display: 'flex', flexDirection: 'column' }}>
      <ChartToolbar
        symbol={symbol}
        timeframe={timeframe}
        onTimeframe={setTimeframe}
        onSearch={(s) => navigate(`/markets360/${encodeURIComponent(s)}`)}
        onAskMai={() => {}}
      />
      <StatusBar data={data} />

      <Box sx={{ position: 'relative', flex: 1, minHeight: 560 }}>
        {isLoading && (
          <Box sx={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <CircularProgress size={28} />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ m: 2 }}>Failed to load Markets 360: {error.message}</Alert>}
        {data?.degraded_reasons?.length > 0 && (
          <Alert severity="info" sx={{ position: 'absolute', top: 8, right: 8, zIndex: 6, py: 0 }}>
            {data.degraded_reasons.join(', ')}
          </Alert>
        )}
        {chartPayload && (
          <>
            <LegendOverlay data={data} timeframe={timeframe} hover={hover} />
            <Markets360Chart chart={chartPayload} timeframe={timeframe} height={560} onLegend={onLegend} monalertNet={data?.states?.monalert_net} />
            <BuyingNowCard signal={data?.signal} onRegister={() => setRegisterOpen(true)} />
{data?.sell_plan
              ? <SellPlanCard sellPlan={data.sell_plan} />
              : <ExitSignalCard exitSignal={data?.exit_signal} />}
          </>
        )}
      </Box>

      <AddPositionDialog
        open={registerOpen}
        onClose={() => setRegisterOpen(false)}
        isSubmitting={registerMutation.isPending}
        submitError={registerMutation.isError
          ? (registerMutation.error?.response?.data?.detail || 'Failed to register position')
          : null}
        initialValues={{
          symbol,
          entry_price: data?.signal?.trigger_price != null ? String(data.signal.trigger_price) : '',
          initial_stop: data?.signal?.stop != null ? String(data.signal.stop) : '',
          entry_date: new Date().toISOString().slice(0, 10),
        }}
        onSubmit={(payload) => registerMutation.mutate(payload)}
      />
      <Snackbar
        open={registered}
        autoHideDuration={6000}
        onClose={() => setRegistered(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
        message={`${symbol} を登録しました — 売りエンジンが監視を開始`}
        action={(
          <Button component={RouterLink} to="/positions" size="small" sx={{ color: '#3aa0ff' }}>
            Positionsへ
          </Button>
        )}
      />

      {/* Bottom range bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, px: 1.5, py: 0.5, bgcolor: '#0a0a0f', borderTop: '1px solid #1c1f27' }}>
        {PERIODS.map((p) => (
          <Box
            key={p.key}
            onClick={() => setPeriod(p.key)}
            sx={{
              cursor: 'pointer', px: 1, py: 0.25, borderRadius: 0.75, fontSize: 13, fontWeight: 700,
              color: period === p.key ? '#3aa0ff' : '#787b86',
            }}
          >
            {p.label}
          </Box>
        ))}
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: 12, color: '#787b86' }}>{data?.as_of}</Typography>
      </Box>

      <QuarterlyStrip quarters={data?.quarters} />
    </Box>
  );
}
