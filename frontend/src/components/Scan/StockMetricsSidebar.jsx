import { Box, Typography, Divider, Chip, Button } from '@mui/material';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import PeopleIcon from '@mui/icons-material/People';
import TrendingDownIcon from '@mui/icons-material/TrendingDown';
import TrendingFlatIcon from '@mui/icons-material/TrendingFlat';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import CancelIcon from '@mui/icons-material/Cancel';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import {
  getStageColor,
  getRatingColor,
  getGrowthColorHex,
  getEpsRatingColor,
} from '../../utils/colorUtils';
import { formatPercent, formatRatio, formatPatternName, getScoreColor } from '../../utils/formatUtils';
import { resolveMarketCapDisplay } from '../../utils/marketCapUtils';
import { EXECUTION_STATE_LABEL, EXECUTION_STATE_COLOR } from '../Charts/executionState';
import GlossaryLabel from '../common/GlossaryLabel';
import { enterSlideFade } from '../../theme/motion';

// Alias for this component's usage (uses hex colors)
const getGrowthColor = getGrowthColorHex;

/**
 * RS Trend icon component
 */
const RSTrendIcon = ({ trend }) => {
  if (trend === 1) return <TrendingUpIcon sx={{ fontSize: 16, color: '#4caf50' }} />;
  if (trend === -1) return <TrendingDownIcon sx={{ fontSize: 16, color: '#f44336' }} />;
  return <TrendingFlatIcon sx={{ fontSize: 16, color: '#9e9e9e' }} />;
};

/**
 * Boolean indicator (checkmark or X)
 */
const BoolIndicator = ({ value }) => {
  if (value) return <CheckCircleIcon sx={{ fontSize: 16, color: '#4caf50' }} />;
  return <CancelIcon sx={{ fontSize: 16, color: '#9e9e9e' }} />;
};

/**
 * Metric row component for 2-column grid
 */
const MetricRow = ({ label, value, color, term }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <GlossaryLabel term={term}>
      <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
        {label}
      </Typography>
    </GlossaryLabel>
    <Typography variant="body2" fontWeight="medium" sx={{ color: color || 'text.primary', fontSize: '0.8rem' }}>
      {value}
    </Typography>
  </Box>
);

/**
 * SEPA fundamental bonus breakdown — one chip per measured component.
 * met=true → colored chip with points, met=false → muted chip, missing → skipped.
 */
const BONUS_CHIP_META = {
  code33: { label: 'Code 33', term: 'code33' },
  eps_growth_qq: { label: 'EPS Q/Q', term: 'eps_qq' },
  sales_growth_qq: { label: 'Sales Q/Q', term: 'sales_qq' },
  roe: { label: 'ROE', term: 'roe' },
  eps_rating: { label: 'EPS Rat', term: 'eps_rating' },
};

const FundamentalBonusBreakdown = ({ bonus, detail }) => {
  const components = detail?.components || {};
  const measured = Object.entries(BONUS_CHIP_META)
    .map(([key, meta]) => ({ key, meta, comp: components[key] }))
    .filter(({ comp }) => comp && comp.met !== null && comp.met !== undefined);
  if (measured.length === 0) return null;

  return (
    <Box sx={{ mt: 0.75 }} data-testid="fundamental-bonus">
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
        <GlossaryLabel term="fundamental_bonus">
          <Typography component="span" variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
            Fnd Bonus
          </Typography>
        </GlossaryLabel>
        <Typography
          variant="body2"
          fontWeight="medium"
          sx={{ fontSize: '0.8rem', color: bonus > 0 ? 'success.main' : 'text.secondary' }}
        >
          {bonus > 0 ? `+${Number(bonus).toFixed(1)}` : '0'} / 10
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
        {measured.map(({ key, meta, comp }, index) => (
          <Box key={key} sx={enterSlideFade(index)}>
            <GlossaryLabel term={meta.term}>
              <Chip
                size="small"
                data-testid={`bonus-chip-${key}`}
                data-met={comp.met ? 'true' : 'false'}
                label={comp.met ? `${meta.label} +${comp.points}` : meta.label}
                sx={{
                  height: 20,
                  fontSize: '0.65rem',
                  fontWeight: comp.met ? 600 : 400,
                  bgcolor: comp.met ? 'rgba(76, 175, 80, 0.15)' : 'transparent',
                  color: comp.met ? 'success.main' : 'text.disabled',
                  border: '1px solid',
                  borderColor: comp.met ? 'rgba(76, 175, 80, 0.4)' : 'divider',
                }}
              />
            </GlossaryLabel>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

/**
 * Section header component
 */
const SectionHeader = ({ children }) => (
  <Typography
    variant="caption"
    color="text.secondary"
    sx={{ fontWeight: 'bold', letterSpacing: 0.5, fontSize: '0.65rem', mb: 0.5, display: 'block' }}
  >
    {children}
  </Typography>
);

/**
 * Stock metrics sidebar for chart viewer modal
 * Displays all screener scores, key metrics, and fundamentals in a compact 2-column layout
 *
 * @param {Object} props
 * @param {Object} props.stockData - Stock result data from scan (optional for watchlists)
 * @param {Object} props.fundamentals - Fundamentals data from cache
 */
function StockMetricsSidebar({ stockData, fundamentals, onViewPeers, onViewSetupDetails }) {
  // Show loading only if neither stockData nor fundamentals are available
  if (!stockData && !fundamentals) {
    return (
      <Box sx={{ p: 2, width: { xs: '100%', md: 450 } }}>
        <Typography variant="body2" color="text.secondary">
          Loading stock data...
        </Typography>
      </Box>
    );
  }

  const marketCapMetric = resolveMarketCapDisplay(stockData, fundamentals, { preferUsd: true });

  // Minimal view when only fundamentals are available (e.g., watchlists)
  if (!stockData && fundamentals) {
    return (
      <Box
        sx={{
          width: { xs: '100%', md: 450 },
          height: '100%',
          bgcolor: 'background.paper',
          borderRight: 1,
          borderColor: 'divider',
          overflow: 'auto',
          p: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 1.5,
        }}
      >
        {/* Header */}
        <Box>
          <Typography variant="body2" fontWeight="medium" sx={{ lineHeight: 1.3 }}>
            {fundamentals.symbol}
          </Typography>
        </Box>

        {/* About - Company Description */}
        {fundamentals?.description && (
          <Box>
            <SectionHeader>ABOUT</SectionHeader>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontSize: '0.75rem',
                lineHeight: 1.5,
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 3,
                WebkitBoxOrient: 'vertical',
              }}
            >
              {fundamentals.description}
            </Typography>
          </Box>
        )}

        <Divider />

        {/* Growth */}
        <Box>
          <SectionHeader>GROWTH</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
            <MetricRow
              label="EPS Q/Q"
            term="eps_qq"
              value={formatPercent(fundamentals.eps_growth_qq)}
              color={getGrowthColor(fundamentals.eps_growth_qq)}
            />
            <MetricRow
              label="Sales Q/Q"
            term="sales_qq"
              value={formatPercent(fundamentals.sales_growth_qq)}
              color={getGrowthColor(fundamentals.sales_growth_qq)}
            />
            <MetricRow
              label="EPS TTM"
            term="eps_ttm"
              value={formatPercent(fundamentals.eps_growth_annual)}
              color={getGrowthColor(fundamentals.eps_growth_annual)}
            />
            <MetricRow
              label="Rev Growth"
            term="rev_growth"
              value={formatPercent(fundamentals.revenue_growth)}
              color={getGrowthColor(fundamentals.revenue_growth)}
            />
          </Box>
        </Box>

        <Divider />

        {/* Valuation */}
        <Box>
          <SectionHeader>VALUATION</SectionHeader>
          <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
            <MetricRow label={marketCapMetric.label} value={marketCapMetric.formattedValue} />
            <MetricRow term="pe_ratio" label="P/E" value={formatRatio(fundamentals.pe_ratio)} />
            <MetricRow term="fwd_pe" label="Fwd P/E" value={formatRatio(fundamentals.forward_pe)} />
            <MetricRow term="peg" label="PEG" value={formatRatio(fundamentals.peg_ratio)} />
            <MetricRow
              label="ROE"
            term="roe"
              value={fundamentals.roe != null ? `${fundamentals.roe.toFixed(1)}%` : '-'}
            />
            <MetricRow
              label="Profit"
              value={fundamentals.profit_margin != null ? `${fundamentals.profit_margin.toFixed(1)}%` : '-'}
            />
            <MetricRow
              label="Inst Own"
            term="inst_own"
              value={fundamentals.institutional_ownership != null ? `${fundamentals.institutional_ownership.toFixed(1)}%` : '-'}
            />
          </Box>
        </Box>
      </Box>
    );
  }

  const showSetupSection =
    stockData?.se_setup_score != null ||
    stockData?.se_quality_score != null ||
    stockData?.se_readiness_score != null ||
    stockData?.se_pattern_primary != null ||
    stockData?.se_setup_ready != null ||
    stockData?.se_explain != null ||
    (Array.isArray(stockData?.se_candidates) && stockData.se_candidates.length > 0) ||
    stockData?.screeners_run?.includes('setup_engine');

  return (
    <Box
      sx={{
        width: { xs: '100%', md: 450 },
        height: '100%',
        bgcolor: 'background.paper',
        borderRight: 1,
        borderColor: 'divider',
        overflow: 'auto',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
      }}
    >
      {/* Header: Company Name + Rating */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="body2" fontWeight="medium" sx={{ flex: 1, lineHeight: 1.3 }}>
          {stockData.company_name || stockData.symbol}
        </Typography>
        {(stockData.rating || (stockData.execution_state && stockData.execution_state !== 'unknown')) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
            {stockData.rating && (
              <Chip
                label={stockData.rating}
                color={getRatingColor(stockData.rating)}
                size="small"
                sx={{ fontSize: '0.7rem', height: 22 }}
              />
            )}
            {/* Execution state directly under the rating ("break out" etc.), so the
                setup stage reads alongside the Pass/Buy rating. */}
            {stockData.execution_state && stockData.execution_state !== 'unknown' && (
              <Chip
                label={EXECUTION_STATE_LABEL[stockData.execution_state] || stockData.execution_state}
                size="small"
                variant="outlined"
                sx={{
                  fontSize: '0.65rem',
                  height: 20,
                  fontWeight: 700,
                  color: EXECUTION_STATE_COLOR[stockData.execution_state] || 'text.secondary',
                  borderColor: EXECUTION_STATE_COLOR[stockData.execution_state] || 'divider',
                }}
              />
            )}
          </Box>
        )}
      </Box>

      {/* About - Company Description */}
      {fundamentals?.description && (
        <Box>
          <SectionHeader>ABOUT</SectionHeader>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              fontSize: '0.75rem',
              lineHeight: 1.5,
              overflow: 'hidden',
              display: '-webkit-box',
              WebkitLineClamp: 3,
              WebkitBoxOrient: 'vertical',
            }}
          >
            {fundamentals.description}
          </Typography>
        </Box>
      )}

      <Divider />

      {/* Scores - Composite + Screener Scores combined */}
      <Box>
        <SectionHeader>SCORES</SectionHeader>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
          <MetricRow
            label="Composite"
            term="composite"
            value={stockData.composite_score?.toFixed(1) || '-'}
            color="primary.main"
          />
          <MetricRow
            label="EPS Rating"
            term="eps_rating"
            value={stockData.eps_rating != null ? stockData.eps_rating : '-'}
            color={getEpsRatingColor(stockData.eps_rating)}
          />
          <MetricRow term="minervini" label="Minervini" value={stockData.minervini_score?.toFixed(1) || '-'} />
          <MetricRow term="canslim" label="CANSLIM" value={stockData.canslim_score?.toFixed(1) || '-'} />
          <MetricRow label="IPO" value={stockData.ipo_score?.toFixed(1) || '-'} />
          <MetricRow label="Custom" value={stockData.custom_score?.toFixed(1) || '-'} />
          <MetricRow label="Vol Break" value={stockData.volume_breakthrough_score?.toFixed(1) || '-'} />
        </Box>
        <FundamentalBonusBreakdown
          bonus={stockData.fundamental_bonus}
          detail={stockData.fundamental_bonus_detail}
        />
      </Box>

      <Divider />

      {/* Relative Strength - 2 column grid */}
      <Box>
        <SectionHeader>RELATIVE STRENGTH</SectionHeader>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              RS Rating
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography variant="body2" fontWeight="medium" sx={{ fontSize: '0.8rem' }}>
                {stockData.rs_rating?.toFixed(1) || '-'}
              </Typography>
              <RSTrendIcon trend={stockData.rs_trend} />
            </Box>
          </Box>
          <MetricRow term="rs_rating" label="RS 1M" value={stockData.rs_rating_1m?.toFixed(1) || '-'} />
          <MetricRow term="rs_rating" label="RS 3M" value={stockData.rs_rating_3m?.toFixed(1) || '-'} />
          <MetricRow term="rs_rating" label="RS 12M" value={stockData.rs_rating_12m?.toFixed(1) || '-'} />
          <MetricRow term="beta" label="Beta" value={stockData.beta?.toFixed(2) || '-'} />
          <MetricRow term="beta_adj_rs" label="β-adj RS" value={stockData.beta_adj_rs?.toFixed(0) || '-'} />
        </Box>
      </Box>

      <Divider />

      {/* Growth - 2 column grid with colors */}
      <Box>
        <SectionHeader>GROWTH</SectionHeader>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
          <MetricRow
            label="EPS Q/Q"
            term="eps_qq"
            value={formatPercent(stockData.eps_growth_qq ?? fundamentals?.eps_growth_qq)}
            color={getGrowthColor(stockData.eps_growth_qq ?? fundamentals?.eps_growth_qq)}
          />
          <MetricRow
            label="Sales Q/Q"
            term="sales_qq"
            value={formatPercent(stockData.sales_growth_qq ?? fundamentals?.sales_growth_qq)}
            color={getGrowthColor(stockData.sales_growth_qq ?? fundamentals?.sales_growth_qq)}
          />
          <MetricRow
            label="EPS Y/Y"
            term="eps_yy"
            value={formatPercent(stockData.eps_growth_yy ?? fundamentals?.eps_growth_yy)}
            color={getGrowthColor(stockData.eps_growth_yy ?? fundamentals?.eps_growth_yy)}
          />
          <MetricRow
            label="Sales Y/Y"
            term="sales_yy"
            value={formatPercent(stockData.sales_growth_yy ?? fundamentals?.sales_growth_yy)}
            color={getGrowthColor(stockData.sales_growth_yy ?? fundamentals?.sales_growth_yy)}
          />
          <MetricRow
            label="EPS TTM"
            term="eps_ttm"
            value={formatPercent(fundamentals?.eps_growth_annual)}
            color={getGrowthColor(fundamentals?.eps_growth_annual)}
          />
          <MetricRow
            label="Rev Growth"
            term="rev_growth"
            value={formatPercent(fundamentals?.revenue_growth)}
            color={getGrowthColor(fundamentals?.revenue_growth)}
          />
        </Box>
      </Box>

      <Divider />

      {/* Valuation (from fundamentals) - 2 column grid */}
      <Box>
        <SectionHeader>VALUATION</SectionHeader>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
          <MetricRow label={marketCapMetric.label} value={marketCapMetric.formattedValue} />
          <MetricRow term="pe_ratio" label="P/E" value={formatRatio(fundamentals?.pe_ratio)} />
          <MetricRow term="fwd_pe" label="Fwd P/E" value={formatRatio(fundamentals?.forward_pe)} />
          <MetricRow term="peg" label="PEG" value={formatRatio(fundamentals?.peg_ratio)} />
          <MetricRow
            label="ROE"
            term="roe"
            value={fundamentals?.roe != null ? `${fundamentals.roe.toFixed(1)}%` : '-'}
          />
          <MetricRow
            label="Profit"
            value={fundamentals?.profit_margin != null ? `${fundamentals.profit_margin.toFixed(1)}%` : '-'}
          />
          <MetricRow
            label="Inst Own"
            term="inst_own"
            value={fundamentals?.institutional_ownership != null ? `${fundamentals.institutional_ownership.toFixed(1)}%` : '-'}
          />
        </Box>
      </Box>

      {/* VCP Pattern - Conditional, 2 column grid */}
      {stockData.vcp_detected && (
        <>
          <Divider />
          <Box>
            <SectionHeader>VCP PATTERN</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  Detected
                </Typography>
                <BoolIndicator value={stockData.vcp_detected} />
              </Box>
              <MetricRow term="vcp" label="Score" value={stockData.vcp_score?.toFixed(1) || '-'} />
              <MetricRow
                label="Pivot"
                term="pivot"
                value={stockData.vcp_pivot ? `$${stockData.vcp_pivot.toFixed(2)}` : '-'}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  Ready
                </Typography>
                <BoolIndicator value={stockData.vcp_ready_for_breakout} />
              </Box>
            </Box>
          </Box>
        </>
      )}

      {/* Setup Engine - Conditional, 2 column grid */}
      {showSetupSection && (
        <>
          <Divider />
          <Box>
            <SectionHeader>SETUP ENGINE</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <MetricRow
                label="Pattern"
                value={formatPatternName(stockData.se_pattern_primary)}
              />
              <MetricRow
                label="Confidence"
                value={stockData.se_pattern_confidence != null ? `${stockData.se_pattern_confidence.toFixed(0)}%` : '-'}
              />
              <MetricRow
                label="Setup"
                value={stockData.se_setup_score?.toFixed(1) || '-'}
                color={getScoreColor(stockData.se_setup_score)}
              />
              <MetricRow
                label="Quality"
                value={stockData.se_quality_score?.toFixed(1) || '-'}
                color={getScoreColor(stockData.se_quality_score)}
              />
              <MetricRow
                label="Readiness"
                value={stockData.se_readiness_score?.toFixed(1) || '-'}
                color={getScoreColor(stockData.se_readiness_score)}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
                  Ready
                </Typography>
                <BoolIndicator value={stockData.se_setup_ready} />
              </Box>
            </Box>
            {onViewSetupDetails && (
              <Button
                variant="outlined"
                size="small"
                fullWidth
                startIcon={<InfoOutlinedIcon />}
                onClick={onViewSetupDetails}
                sx={{ textTransform: 'none', mt: 1, fontSize: '0.75rem' }}
              >
                View Setup Details
              </Button>
            )}
          </Box>
        </>
      )}

      <Divider />

      {/* Price & Technical - 2 column grid */}
      <Box>
        <SectionHeader>PRICE & TECHNICAL</SectionHeader>
        <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
          <MetricRow
            label="Price"
            value={stockData.current_price ? `$${stockData.current_price.toFixed(2)}` : '-'}
          />
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              Stage
            </Typography>
            {stockData.stage ? (
              <Chip
                label={`S${stockData.stage}`}
                size="small"
                sx={{
                  backgroundColor: getStageColor(stockData.stage),
                  color: 'white',
                  fontSize: '0.65rem',
                  height: 18,
                  '& .MuiChip-label': { px: 0.75 },
                }}
              />
            ) : (
              <Typography variant="body2" sx={{ fontSize: '0.8rem' }}>-</Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              MA Align
            </Typography>
            <BoolIndicator value={stockData.ma_alignment} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: '0.75rem' }}>
              Pass Tmpl
            </Typography>
            <BoolIndicator value={stockData.passes_template} />
          </Box>
        </Box>
      </Box>

      {/* View Industry Peers Button */}
      {stockData.ibd_industry_group && onViewPeers && (
        <Button
          variant="outlined"
          size="small"
          fullWidth
          startIcon={<PeopleIcon />}
          onClick={onViewPeers}
          sx={{ textTransform: 'none', mt: 'auto' }}
        >
          View Industry Peers
        </Button>
      )}
    </Box>
  );
}

export default StockMetricsSidebar;
