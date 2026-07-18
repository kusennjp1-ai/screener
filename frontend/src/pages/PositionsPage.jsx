import { useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert, Box, Button, Chip, CircularProgress, IconButton, Link, Paper, Stack,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  ToggleButton, ToggleButtonGroup, Tooltip, Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline';
import ShowChartIcon from '@mui/icons-material/ShowChart';
import GlossaryLabel from '../components/common/GlossaryLabel';
import AddPositionDialog from '../components/positions/AddPositionDialog';
import { pulseRing, standardTransition } from '../theme/motion';
import {
  closePosition, createPosition, deletePosition, getPositions,
} from '../api/positions';

// Action chip meta — same palette + Japanese readings as the Markets 360
// SellPlanCard so the two surfaces never disagree about what an action means.
const ACTION_META = {
  stop_hit: { color: '#f23645', label: 'SELL — Stop Hit', ja: '売り：損切りライン到達（ストップは絶対、翌日成行で撤退）', pulse: true },
  exit: { color: '#f23645', label: 'SELL — Trend Broken', ja: '売り：トレンド崩壊（50日線を出来高を伴い割り込み）', pulse: true },
  sell_into_strength: { color: '#e0a52e', label: 'Sell Into Strength', ja: '強さに売る：クライマックス（買い疲れの急騰）を検出', pulse: true },
  tighten_stop: { color: '#e0a52e', label: 'Tighten Stop', ja: '損切りラインを引き締め（浅い50日線割れ）', pulse: false },
  raise_stop: { color: '#22ab94', label: 'Raise Stop', ja: '損切りラインを切り上げ（R倍数の利益を確保）', pulse: false },
  hold: { color: '#787b86', label: 'Hold', ja: '保持：売りシグナルなし', pulse: false },
  no_data: { color: '#4b4f58', label: 'No Data', ja: '価格キャッシュ未整備（スキャン実行後に更新）', pulse: false },
};

const fmt = (v, digits = 2) => (v == null || Number.isNaN(Number(v)) ? '—' : Number(v).toFixed(digits));

function ActionChip({ action }) {
  const meta = ACTION_META[action] || ACTION_META.no_data;
  return (
    <Tooltip title={meta.ja} arrow enterTouchDelay={0} leaveTouchDelay={8000}>
      <Chip
        size="small"
        label={meta.label}
        data-testid={`action-chip-${action}`}
        sx={{
          fontWeight: 700,
          color: meta.color,
          border: `1px solid ${meta.color}`,
          bgcolor: 'transparent',
          ...(meta.pulse && pulseRing(meta.color)),
        }}
      />
    </Tooltip>
  );
}

function RMultipleCell({ position }) {
  const r = position.r_multiple;
  if (r == null) return <Typography sx={{ fontSize: 13, color: 'text.disabled' }}>—</Typography>;
  // Progress toward the 2R objective: the first Minervini profit milestone.
  const progress = Math.max(0, Math.min(1, r / 2));
  const color = r >= 2 ? '#22ab94' : r >= 0 ? '#e0a52e' : '#f23645';
  return (
    <GlossaryLabel term="r_multiple">
      <Box sx={{ minWidth: 88 }}>
        <Typography component="span" sx={{ fontWeight: 700, fontSize: 13, color }}>
          {r >= 0 ? '+' : ''}{fmt(r, 2)}R
        </Typography>
        <Box sx={{ mt: 0.4, height: 4, borderRadius: 2, bgcolor: 'action.hover', overflow: 'hidden' }}>
          <Box sx={{
            width: `${progress * 100}%`, height: '100%', bgcolor: color, borderRadius: 2,
            transition: standardTransition('width'),
          }}
          />
        </Box>
      </Box>
    </GlossaryLabel>
  );
}

export default function PositionsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState('open');
  const [dialogOpen, setDialogOpen] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['positions', statusFilter],
    queryFn: () => getPositions(statusFilter),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['positions'] });
  const createMutation = useMutation({ mutationFn: createPosition, onSuccess: invalidate });
  const closeMutation = useMutation({ mutationFn: (id) => closePosition(id), onSuccess: invalidate });
  const deleteMutation = useMutation({ mutationFn: deletePosition, onSuccess: invalidate });

  const positions = useMemo(() => data?.positions ?? [], [data]);
  const isOpenView = statusFilter === 'open';

  const submitError = createMutation.isError
    ? (createMutation.error?.response?.data?.detail || 'Failed to register position')
    : null;

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 } }}>
      <Stack direction="row" alignItems="center" flexWrap="wrap" gap={1.5} sx={{ mb: 2 }}>
        <ShowChartIcon sx={{ color: '#22ab94' }} />
        <Typography variant="h5" sx={{ fontWeight: 700 }}>Positions</Typography>
        <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
          買値を登録すると売りエンジンがR倍数と出口シグナルを自動監視します
        </Typography>
        <Box sx={{ flexGrow: 1 }} />
        <ToggleButtonGroup
          size="small" exclusive value={statusFilter}
          onChange={(_, v) => v && setStatusFilter(v)}
        >
          <ToggleButton value="open" sx={{ minHeight: 44, px: 2 }}>Open</ToggleButton>
          <ToggleButton value="closed" sx={{ minHeight: 44, px: 2 }}>Closed</ToggleButton>
        </ToggleButtonGroup>
        <Button
          variant="contained" startIcon={<AddIcon />} onClick={() => setDialogOpen(true)}
          data-testid="add-position" sx={{ minHeight: 44 }}
        >
          Add Position
        </Button>
      </Stack>

      {isError ? <Alert severity="error">Failed to load positions.</Alert> : null}
      {isLoading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}><CircularProgress /></Box>
      ) : null}

      {!isLoading && !isError && positions.length === 0 ? (
        <Paper variant="outlined" sx={{ p: 4, textAlign: 'center' }}>
          <Typography sx={{ fontWeight: 600, mb: 0.5 }}>
            {isOpenView ? 'No open positions' : 'No closed positions'}
          </Typography>
          <Typography sx={{ color: 'text.secondary', fontSize: 13 }}>
            「Add Position」から買値と損切りラインを登録すると、トレーリングストップ・クライマックス・50日線割れを毎日チェックします。
          </Typography>
        </Paper>
      ) : null}

      {!isLoading && positions.length > 0 ? (
        <TableContainer component={Paper} variant="outlined" sx={{ overflowX: 'auto' }}>
          <Table size="small" sx={{ minWidth: 900 }}>
            <TableHead>
              <TableRow>
                <TableCell>Symbol</TableCell>
                <TableCell align="right">Entry（買値）</TableCell>
                <TableCell align="right">
                  <GlossaryLabel term="stop">Stop</GlossaryLabel>
                </TableCell>
                <TableCell align="right">Last</TableCell>
                <TableCell align="right">P&L %</TableCell>
                <TableCell>
                  <GlossaryLabel term="r_multiple">R Multiple</GlossaryLabel>
                </TableCell>
                <TableCell align="right">2R / 3R</TableCell>
                <TableCell>Action</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {positions.map((p) => {
                const ladderStop = p.sell_plan?.trailing?.stop;
                const stopRaised = Boolean(p.sell_plan?.trailing?.raised);
                const pnlColor = p.pnl_pct == null ? 'text.disabled' : (p.pnl_pct >= 0 ? '#22ab94' : '#f23645');
                return (
                  <TableRow key={p.id} hover data-testid={`position-row-${p.symbol}`}>
                    <TableCell>
                      <Link component={RouterLink} to={`/markets360/${p.symbol}`} sx={{ fontWeight: 700 }}>
                        {p.symbol}
                      </Link>
                      <Typography sx={{ fontSize: 11, color: 'text.secondary' }}>{p.entry_date}</Typography>
                    </TableCell>
                    <TableCell align="right">{fmt(p.entry_price)}</TableCell>
                    <TableCell align="right">
                      {isOpenView && ladderStop != null ? (
                        <Tooltip
                          arrow
                          title={stopRaised
                            ? `ラダーが損切りを ${fmt(p.initial_stop)} → ${fmt(ladderStop)} に切り上げ`
                            : '初期損切りライン'}
                        >
                          <Typography component="span" sx={{ fontSize: 13, fontWeight: stopRaised ? 700 : 400, color: stopRaised ? '#22ab94' : 'text.primary' }}>
                            {fmt(ladderStop)}{stopRaised ? ' ↑' : ''}
                          </Typography>
                        </Tooltip>
                      ) : fmt(p.initial_stop)}
                    </TableCell>
                    <TableCell align="right">{isOpenView ? fmt(p.last_close) : fmt(p.close_price)}</TableCell>
                    <TableCell align="right">
                      <Typography component="span" sx={{ fontSize: 13, fontWeight: 700, color: pnlColor }}>
                        {p.pnl_pct == null
                          ? (p.status === 'closed' && p.close_price != null
                            ? `${(((p.close_price - p.entry_price) / p.entry_price) * 100).toFixed(2)}%`
                            : '—')
                          : `${p.pnl_pct >= 0 ? '+' : ''}${fmt(p.pnl_pct)}%`}
                      </Typography>
                    </TableCell>
                    <TableCell><RMultipleCell position={p} /></TableCell>
                    <TableCell align="right">
                      {p.targets?.length
                        ? (
                          <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>
                            {p.targets.map((t) => fmt(t.price)).join(' / ')}
                          </Typography>
                        )
                        : <Typography sx={{ fontSize: 12, color: 'text.disabled' }}>—</Typography>}
                    </TableCell>
                    <TableCell>
                      {isOpenView ? <ActionChip action={p.action} /> : <Chip size="small" label="Closed" />}
                    </TableCell>
                    <TableCell align="right" sx={{ whiteSpace: 'nowrap' }}>
                      {isOpenView ? (
                        <Tooltip title="Close position（決済を記録）" arrow>
                          <IconButton
                            size="small" sx={{ width: 44, height: 44 }}
                            onClick={() => closeMutation.mutate(p.id)}
                            data-testid={`close-position-${p.id}`}
                          >
                            <CheckCircleOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      ) : null}
                      <Tooltip title="Delete（記録を削除）" arrow>
                        <IconButton
                          size="small" sx={{ width: 44, height: 44 }}
                          onClick={() => deleteMutation.mutate(p.id)}
                          data-testid={`delete-position-${p.id}`}
                        >
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </TableContainer>
      ) : null}

      <AddPositionDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        isSubmitting={createMutation.isPending}
        submitError={submitError}
        onSubmit={(payload) => createMutation.mutate(payload, {
          onSuccess: () => setDialogOpen(false),
        })}
      />
    </Box>
  );
}
