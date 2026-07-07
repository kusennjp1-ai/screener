/**
 * Relative Rotation Graph (RRG)
 *
 * Plots each IBD group (or sector roll-up) by RS-Ratio (x) vs RS-Momentum (y),
 * with a weekly "tail" tracing its path through the four quadrants:
 *
 *     Leading   (x>=100, y>=100)  green
 *     Weakening (x>=100, y<100)   orange
 *     Lagging   (x<100,  y<100)   red
 *     Improving (x<100,  y>=100)  blue
 *
 * Each tail vertex is a hoverable dot (date + weeks-ago), the trace is graduated
 * oldest->newest, and direction arrows point the way each series is travelling.
 * A filter narrows the plot to the groups/sectors of interest.
 *
 * Coordinates are pre-computed server-side (see backend rrg_service.py), so this
 * component is purely presentational. It is shared by the live Group Rankings
 * page and the static-site Groups page — both pass the same `{ groups: [...] }`.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  ScatterChart,
  Scatter,
  Cell,
  XAxis,
  YAxis,
  ZAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  ReferenceArea,
  ResponsiveContainer,
  Customized,
} from 'recharts';
import {
  Box,
  Card,
  CardContent,
  Chip,
  IconButton,
  Slider,
  Typography,
  CircularProgress,
  Alert,
  FormControlLabel,
  Switch,
} from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import { QUADRANT_COLORS, QUADRANT_FILLS, quadrantColor } from './rrgColors';
import { buildTailPoints } from './rrgTrace';
import { computeFlows, groupAtFrame, maxFrames } from './rrgFlow';
import { useRRGFilters } from './useRRGFilters';
import RRGFilters from './RRGFilters';

// Below this many series shown, the plot renders the full per-week detail:
// graduated, hoverable tail dots + per-segment direction arrows. Above it (e.g.
// the unfiltered ~197-series view) tails are line-only with a single most-recent
// arrow per series, to stay light and readable. Filter down to get the detail.
const DETAIL_LIMIT = 20;

/** Symmetric axis bounds around the 100/100 cross, padded to the data extent. */
const computeBound = (groups) => {
  let maxAbs = 8;
  for (const g of groups) {
    const pts = [g.current, ...(g.tail || [])];
    for (const p of pts) {
      maxAbs = Math.max(maxAbs, Math.abs(p.x - 100), Math.abs(p.y - 100));
    }
  }
  return Math.min(20, Math.ceil(maxAbs) + 1);
};

/** Graduated tail vertex: faint/small when old, brighter toward the head. The
 *  head itself is drawn by the larger "current" dot, so it's skipped here. */
const TailDot = ({ cx, cy, payload }) => {
  if (cx == null || cy == null || payload?.isHead) return null;
  const t = payload.t ?? 0.5;
  return (
    <circle
      cx={cx}
      cy={cy}
      r={2 + 2.5 * t}
      fill={quadrantColor(payload.quadrant)}
      fillOpacity={0.25 + 0.5 * t}
    />
  );
};

const ArrowHead = ({ x, y, angle, color }) => {
  const size = 5;
  return (
    <polygon
      points={`${-size},${-size * 0.6} ${size},0 ${-size},${size * 0.6}`}
      transform={`translate(${x},${y}) rotate(${(angle * 180) / Math.PI})`}
      fill={color}
      fillOpacity={0.9}
    />
  );
};

/** Recharts <Customized> child: draws direction arrows in pixel space using the
 *  axis scales. Degrades to nothing if scales aren't ready (e.g. SSR/jsdom). */
const TailArrows = ({ shown, perSegment, xAxisMap, yAxisMap }) => {
  const xAxis = xAxisMap && xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap && yAxisMap[Object.keys(yAxisMap)[0]];
  const xScale = xAxis?.scale;
  const yScale = yAxis?.scale;
  if (typeof xScale !== 'function' || typeof yScale !== 'function') return null;

  const arrows = [];
  shown.forEach((g) => {
    const tail = g.tail || [];
    if (tail.length < 2) return;
    const from = perSegment ? 1 : tail.length - 1;
    for (let i = from; i < tail.length; i += 1) {
      const a = tail[i - 1];
      const b = tail[i];
      const x1 = xScale(a.x);
      const y1 = yScale(a.y);
      const x2 = xScale(b.x);
      const y2 = yScale(b.y);
      if ([x1, y1, x2, y2].some((v) => v == null || Number.isNaN(v))) continue;
      arrows.push(
        <ArrowHead
          key={`${g.industry_group}-${i}`}
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2}
          angle={Math.atan2(y2 - y1, x2 - x1)}
          color={quadrantColor(g.quadrant)}
        />,
      );
    }
  });
  return <g>{arrows}</g>;
};

/** Recharts <Customized> child: draws the group/sector name next to each current
 *  head dot, tinted by quadrant. Uses the axis scales like TailArrows, and
 *  degrades to nothing if scales aren't ready (e.g. SSR/jsdom). */
const GroupLabels = ({ shown, xAxisMap, yAxisMap }) => {
  const xAxis = xAxisMap && xAxisMap[Object.keys(xAxisMap)[0]];
  const yAxis = yAxisMap && yAxisMap[Object.keys(yAxisMap)[0]];
  const xScale = xAxis?.scale;
  const yScale = yAxis?.scale;
  if (typeof xScale !== 'function' || typeof yScale !== 'function') return null;

  return (
    <g>
      {shown.map((g) => {
        const cur = g.current;
        if (!cur) return null;
        const cx = xScale(cur.x);
        const cy = yScale(cur.y);
        if ([cx, cy].some((v) => v == null || Number.isNaN(v))) return null;
        return (
          <text
            key={`label-${g.industry_group}`}
            x={cx + 7}
            y={cy - 7}
            fontSize={10}
            fontWeight={600}
            fill={quadrantColor(g.quadrant)}
            pointerEvents="none"
          >
            {g.industry_group}
          </text>
        );
      })}
    </g>
  );
};

const RRGTooltip = ({ active, payload }) => {
  if (!active || !payload || !payload.length) return null;
  const g = payload[0]?.payload;
  if (!g) return null;
  return (
    <Box
      sx={{
        backgroundColor: 'background.paper',
        border: '1px solid',
        borderColor: 'divider',
        borderRadius: 1,
        p: 1.5,
        boxShadow: 2,
        minWidth: 180,
      }}
    >
      <Typography variant="body2" sx={{ fontWeight: 700, mb: 0.5 }}>
        {g.industry_group}
      </Typography>
      <Typography variant="caption" sx={{ color: quadrantColor(g.quadrant), fontWeight: 600 }}>
        {g.quadrant}
        {g.is_provisional ? ' · provisional' : ''}
      </Typography>
      {g.isCurrent ? (
        <Typography variant="body2" sx={{ mt: 0.5 }}>
          Rank: {g.rank ?? '—'} · RS: {g.avg_rs_rating != null ? g.avg_rs_rating.toFixed(1) : '—'}
        </Typography>
      ) : (
        <Typography variant="body2" sx={{ mt: 0.5, color: 'text.secondary' }}>
          {g.weeksAgo === 0 ? 'Current' : `${g.weeksAgo}w ago`}
          {g.date ? ` · ${g.date}` : ''}
        </Typography>
      )}
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        Ratio {g.x?.toFixed(1)} · Momentum {g.y?.toFixed(1)}
      </Typography>
    </Box>
  );
};

/**
 * @param {Object[]} props.data.groups - RRGGroupResponse[] from the API
 */
export default function RRGChart({ data, isLoading, error, onSelectGroup, height = 560 }) {
  const groups = useMemo(() => (data?.groups ?? []), [data]);
  const asOf = data?.date ?? null;
  const scopeLabel = data?.scope === 'sectors' ? 'Sectors' : 'Groups';

  const { shown, filter } = useRRGFilters(groups, { scope: data?.scope, market: data?.market });

  // Display preference (not a filter) — kept local so it persists across
  // scope/market switches, unlike the filters in useRRGFilters.
  const [showLabels, setShowLabels] = useState(false);

  const bound = useMemo(() => computeBound(shown), [shown]);
  const lo = 100 - bound;
  const hi = 100 + bound;

  // Single "detail level" driving both tail-dot richness and arrow density, so
  // the default (all-series) view stays light and the filtered view gets the
  // full per-week detail.
  const detailed = shown.length <= DETAIL_LIMIT;

  // --- Playback (sector-rotation animation) --------------------------------
  // frame == null renders the live (latest) chart; 0..totalFrames-1 time-travels
  // every series along its weekly tail. While playing, recharts tweens the head
  // dots between frames, so rotation reads as motion — where money is going.
  const totalFrames = useMemo(() => maxFrames(shown), [shown]);
  const [frame, setFrame] = useState(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setFrame((f) => {
        const next = (f == null ? 0 : f + 1);
        if (next >= totalFrames - 1) {
          setPlaying(false);
          return null; // finished: snap back to live
        }
        return next;
      });
    }, 700);
    return () => clearInterval(id);
  }, [playing, totalFrames]);
  const startPlayback = () => {
    setFrame(0);
    setPlaying(true);
  };

  const framedShown = useMemo(
    () => (frame == null ? shown : shown.map((g) => groupAtFrame(g, frame))),
    [shown, frame],
  );
  const flows = useMemo(() => computeFlows(shown, frame), [shown, frame]);
  const frameDate = useMemo(() => {
    if (frame == null) return asOf;
    for (const g of framedShown) {
      if (g.current?.date) return g.current.date;
    }
    return asOf;
  }, [frame, framedShown, asOf]);

  const currentPoints = useMemo(
    () => framedShown.map((g) => ({ ...g, ...g.current, isCurrent: true })),
    [framedShown],
  );
  const tails = useMemo(
    () => framedShown.map((g) => ({ name: g.industry_group, color: quadrantColor(g.quadrant), points: buildTailPoints(g, asOf) })),
    [framedShown, asOf],
  );

  if (isLoading) {
    return (
      <Card>
        <CardContent sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height }}>
          <CircularProgress />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent>
          <Alert severity="error">
            Failed to load RRG data{error?.message ? `: ${error.message}` : '.'}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  if (!groups.length) {
    return (
      <Card>
        <CardContent>
          <Alert severity="info">
            No RRG data available yet. Group-ranking history is required to plot rotation.
          </Alert>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap', mb: 1 }}>
          <Typography variant="subtitle2">
            Relative Rotation Graph — {scopeLabel}
            {asOf ? ` · ${asOf}` : ''}
          </Typography>
          <Box sx={{ flexGrow: 1 }} />
          {totalFrames >= 3 && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, minWidth: 200 }}>
              <IconButton
                size="small"
                aria-label={playing ? 'Pause rotation playback' : 'Play rotation playback'}
                onClick={() => (playing ? setPlaying(false) : startPlayback())}
              >
                {playing ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
              </IconButton>
              <Slider
                size="small"
                aria-label="Rotation week"
                min={0}
                max={totalFrames - 1}
                value={frame == null ? totalFrames - 1 : frame}
                onChange={(_, v) => {
                  setPlaying(false);
                  setFrame(v >= totalFrames - 1 ? null : v);
                }}
                sx={{ width: 110 }}
              />
              <Typography variant="caption" sx={{ color: 'text.secondary', minWidth: 78 }}>
                {frame == null ? 'Live' : frameDate || `w${frame + 1}`}
              </Typography>
            </Box>
          )}
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showLabels}
                onChange={(e) => setShowLabels(e.target.checked)}
              />
            }
            label="Labels"
            sx={{ mr: 0 }}
          />
          <RRGFilters
            scopeLabel={scopeLabel}
            names={filter.names}
            selected={filter.selected}
            onSelected={filter.setSelected}
            quadrants={filter.quadrants}
            onQuadrants={filter.setQuadrants}
            maxRank={filter.maxRank}
            rankValue={filter.rankValue}
            onRankChange={filter.setRankRange}
          />
        </Box>

        {(flows.inflow.length > 0 || flows.outflow.length > 0) && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 1 }} data-testid="rrg-flow-strip">
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              資金流入
            </Typography>
            {flows.inflow.map((f) => (
              <Chip
                key={`in-${f.name}`}
                size="small"
                color="success"
                variant="outlined"
                label={`${f.name} ↗ +${f.score.toFixed(1)}`}
              />
            ))}
            <Box sx={{ width: 8 }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
              資金流出
            </Typography>
            {flows.outflow.map((f) => (
              <Chip
                key={`out-${f.name}`}
                size="small"
                color="error"
                variant="outlined"
                label={`${f.name} ↘ ${f.score.toFixed(1)}`}
              />
            ))}
          </Box>
        )}

        {shown.length === 0 ? (
          <Alert severity="info">No {scopeLabel.toLowerCase()} match the current filter.</Alert>
        ) : (
          <ResponsiveContainer width="100%" height={height}>
            <ScatterChart margin={{ top: 20, right: 30, bottom: 20, left: 10 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.3} />

              {/* Quadrant backdrops */}
              <ReferenceArea x1={100} x2={hi} y1={100} y2={hi} fill={QUADRANT_FILLS.Leading} fillOpacity={1}
                label={{ value: 'Leading', position: 'insideTopRight', fill: QUADRANT_COLORS.Leading, fontSize: 12 }} />
              <ReferenceArea x1={100} x2={hi} y1={lo} y2={100} fill={QUADRANT_FILLS.Weakening} fillOpacity={1}
                label={{ value: 'Weakening', position: 'insideBottomRight', fill: QUADRANT_COLORS.Weakening, fontSize: 12 }} />
              <ReferenceArea x1={lo} x2={100} y1={lo} y2={100} fill={QUADRANT_FILLS.Lagging} fillOpacity={1}
                label={{ value: 'Lagging', position: 'insideBottomLeft', fill: QUADRANT_COLORS.Lagging, fontSize: 12 }} />
              <ReferenceArea x1={lo} x2={100} y1={100} y2={hi} fill={QUADRANT_FILLS.Improving} fillOpacity={1}
                label={{ value: 'Improving', position: 'insideTopLeft', fill: QUADRANT_COLORS.Improving, fontSize: 12 }} />

              <ReferenceLine x={100} stroke="#9e9e9e" strokeDasharray="4 4" />
              <ReferenceLine y={100} stroke="#9e9e9e" strokeDasharray="4 4" />

              <XAxis
                type="number"
                dataKey="x"
                name="RS-Ratio"
                domain={[lo, hi]}
                tickCount={5}
                label={{ value: 'RS-Ratio', position: 'insideBottom', offset: -10, fontSize: 12 }}
              />
              <YAxis
                type="number"
                dataKey="y"
                name="RS-Momentum"
                domain={[lo, hi]}
                tickCount={5}
                label={{ value: 'RS-Momentum', angle: -90, position: 'insideLeft', fontSize: 12 }}
              />
              <ZAxis type="number" dataKey="num_stocks" range={[60, 500]} name="Constituents" />
              <Tooltip content={<RRGTooltip />} cursor={{ strokeDasharray: '3 3' }} />

              {/* Tails: connecting line, plus graduated hoverable per-week dots
                  in the detailed (filtered) view; line-only when many series. */}
              {tails.map((t) => (
                <Scatter
                  key={`tail-${t.name}`}
                  data={t.points}
                  line={{ stroke: t.color, strokeWidth: 1.25, strokeOpacity: 0.45 }}
                  lineType="joint"
                  shape={detailed ? <TailDot /> : () => null}
                  isAnimationActive={false}
                  legendType="none"
                />
              ))}

              {/* Direction arrows along each trace (per-segment when detailed). */}
              <Customized
                component={(props) => (
                  <TailArrows shown={shown} perSegment={detailed} {...props} />
                )}
              />

              {/* Group/sector name labels next to each head dot (toggle). */}
              {showLabels && (
                <Customized
                  component={(props) => <GroupLabels shown={shown} {...props} />}
                />
              )}

              {/* Current head dots — sized by constituents, colored by quadrant, clickable. */}
              <Scatter
                data={currentPoints}
                isAnimationActive={playing}
                animationDuration={600}
                animationEasing="ease-in-out"
                onClick={(pt) => onSelectGroup?.(pt?.industry_group)}
                cursor="pointer"
              >
                {currentPoints.map((p) => (
                  <Cell
                    key={`dot-${p.industry_group}`}
                    fill={quadrantColor(p.quadrant)}
                    fillOpacity={p.is_provisional ? 0.35 : 0.9}
                    stroke={quadrantColor(p.quadrant)}
                  />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}
