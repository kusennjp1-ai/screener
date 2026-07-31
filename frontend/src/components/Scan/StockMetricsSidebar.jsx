import { Box, Typography, Divider, Chip, Button, Tooltip } from '@mui/material';
import PeopleIcon from '@mui/icons-material/People';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
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
import { INDICATOR_GLOSSARY } from '../../utils/indicatorGlossary';
import { enterSlideFade } from '../../theme/motion';
import { C, T, W, px } from '../../static/designTokens';

// Alias for this component's usage (uses hex colors)
const getGrowthColor = getGrowthColorHex;

// 判定バッジの日本語表記。色は getRatingColor（英語キー）に渡す。
const RATING_LABEL = {
  'Strong Buy': '強い買い',
  Buy: '買い',
  Watch: '監視',
  Pass: '見送り',
  'Insufficient Data': 'データ不足',
};

// 用語ツールチップ。INDICATOR_GLOSSARY にキーが無いラベルはここで補い、
// 「点線の下線がある項目とない項目が混在する」状態を作らない（全項目に付く）。
const LOCAL_HINTS = {
  ipo_score: 'IPOスクリーナーのスコア。上場後まもない銘柄の需給と勢いを評価。',
  custom_score: 'カスタムスクリーナーのスコア。自分で設定した条件の充足度。',
  volume_breakthrough: '出来高突破スクリーナーのスコア。平常時を大きく超える出来高を伴う動きを評価。',
  profit_margin: '純利益率。売上に対する最終利益の割合。高いほど稼ぐ力が強い。',
  market_cap: '時価総額。株価 × 発行済株式数。(USD)は米ドル換算、(現地)は現地通貨。',
  price: '直近の終値。',
  vcp_detected: 'VCP（ボラティリティ収縮パターン）を検出したか。',
  vcp_score: 'VCPの形状スコア。収縮の回数・深さ・出来高の枯れ具合から算出。',
  vcp_ready: 'ピボット直下まで収縮し、ブレイク待ちの状態かどうか。',
  se_pattern: 'セットアップエンジンが判定した主パターン名。',
  se_confidence: 'パターン判定の確度。100%に近いほど教科書的な形。',
  se_setup: 'セットアップ総合スコア。仕掛けの形が整っているか。',
  se_quality: 'ベースの質のスコア。収縮の素直さ、出来高の枯れ方など。',
  se_readiness: '仕掛けまでの近さ。ピボットに近いほど高い。',
  se_ready: 'いま仕掛けられる状態かどうか。',
};

/**
 * RS Trend icon component
 */
const RSTrendIcon = ({ trend }) => {
  if (trend === 1) return <TrendingUpIcon sx={{ fontSize: px(T.strong), color: 'success.main' }} />;
  if (trend === -1) return <TrendingDownIcon sx={{ fontSize: px(T.strong), color: 'error.main' }} />;
  return <TrendingFlatIcon sx={{ fontSize: px(T.strong), color: 'text.disabled' }} />;
};

/**
 * Boolean indicator (checkmark or X)
 */
const BoolIndicator = ({ value }) => {
  if (value) return <CheckCircleIcon sx={{ fontSize: px(T.strong), color: 'success.main' }} />;
  return <CancelIcon sx={{ fontSize: px(T.strong), color: 'text.disabled' }} />;
};

/**
 * ラベル + 用語解説。用語集にある語は GlossaryLabel（詳しい解説）、
 * 無い語は LOCAL_HINTS の一文で、見た目（点線の下線）は完全に同じにする。
 */
const MetricLabel = ({ label, term, hint }) => {
  const text = (
    <Typography
      component="span"
      variant="caption"
      color="text.secondary"
      sx={{ fontSize: px(T.micro) }}
    >
      {label}
    </Typography>
  );
  const entry = term ? INDICATOR_GLOSSARY[term] : null;

  return (
    <Box
      component="span"
      data-glossary="true"
      sx={{
        display: 'block',
        minWidth: 0,
        flex: '0 1 auto',
        overflow: 'hidden',
        whiteSpace: 'nowrap',
        textOverflow: 'ellipsis',
      }}
    >
      {entry ? (
        <GlossaryLabel term={term}>{text}</GlossaryLabel>
      ) : (
        <Tooltip title={hint || label} arrow enterTouchDelay={0} leaveTouchDelay={8000} placement="top">
          <Box
            component="span"
            sx={{ cursor: 'help', borderBottom: '1px dotted', borderColor: 'text.disabled' }}
          >
            {text}
          </Box>
        </Tooltip>
      )}
    </Box>
  );
};

/**
 * Metric row component for 2-column grid
 */
const MetricRow = ({ label, value, color, term, hint }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
    <MetricLabel label={label} term={term} hint={hint} />
    <Typography
      variant="body2"
      fontWeight="medium"
      sx={{ color: color || 'text.primary', fontSize: px(T.body), flexShrink: 0 }}
    >
      {value}
    </Typography>
  </Box>
);

/**
 * ラベル + 真偽アイコンの行（MetricRow と同じ下線ルール）
 */
const BoolRow = ({ label, value, term, hint }) => (
  <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
    <MetricLabel label={label} term={term} hint={hint} />
    <BoolIndicator value={value} />
  </Box>
);

/**
 * SEPA fundamental bonus breakdown — one chip per measured component.
 * met=true → colored chip with points, met=false → muted chip, missing → skipped.
 */
const BONUS_CHIP_META = {
  code33: { label: 'Code 33', term: 'code33' },
  eps_growth_qq: { label: 'EPS 前Q', term: 'eps_qq' },
  sales_growth_qq: { label: '売上 前Q', term: 'sales_qq' },
  roe: { label: 'ROE', term: 'roe' },
  eps_rating: { label: 'EPSレート', term: 'eps_rating' },
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
        <MetricLabel label="ファンダ加点" term="fundamental_bonus" />
        <Typography
          variant="body2"
          fontWeight="medium"
          sx={{ fontSize: px(T.body), color: bonus > 0 ? 'success.main' : 'text.secondary' }}
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
                  fontSize: px(T.micro),
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
    sx={{ fontWeight: 'bold', letterSpacing: 0.5, fontSize: px(T.micro), mb: 0.5, display: 'block' }}
  >
    {children}
  </Typography>
);

// 時価総額ラベルの日本語表記（英語ラベルは utils/marketCapUtils が返す）。
const marketCapLabel = (metric) => {
  if (metric?.source === 'market_cap_usd') return '時価総額(USD)';
  if (metric?.source === 'market_cap') return '時価総額(現地)';
  return '時価総額';
};

/**
 * 測定値が1つでもあるか。
 *
 * 真偽フラグ（MA整列 / テンプレ合格）は未計算でも ✗ として描けてしまうため
 * 数えない。ここが false のとき、セクション見出しごと畳んで1行に置き換える
 * ——「-」を28個並べない。
 */
const hasAnyMetric = (stockData, fundamentals) => {
  const s = stockData || {};
  const f = fundamentals || {};
  const values = [
    s.composite_score, s.eps_rating, s.minervini_score, s.canslim_score, s.ipo_score,
    s.custom_score, s.volume_breakthrough_score, s.fundamental_bonus,
    s.rs_rating, s.rs_rating_1m, s.rs_rating_3m, s.rs_rating_12m, s.beta, s.beta_adj_rs,
    s.eps_growth_qq, s.sales_growth_qq, s.eps_growth_yy, s.sales_growth_yy,
    s.current_price, s.stage, s.vcp_score, s.vcp_pivot,
    s.se_setup_score, s.se_quality_score, s.se_readiness_score, s.se_pattern_primary,
    s.market_cap, s.market_cap_usd,
    f.eps_growth_qq, f.sales_growth_qq, f.eps_growth_annual, f.revenue_growth,
    f.pe_ratio, f.forward_pe, f.peg_ratio, f.roe, f.profit_margin,
    f.institutional_ownership, f.market_cap, f.market_cap_usd,
  ];
  return values.some((value) => value != null);
};

/**
 * データが1つも無いときの1行表示（40px）。
 */
const EmptyMetrics = () => (
  <Box
    data-testid="metrics-empty"
    sx={{ height: 40, display: 'flex', alignItems: 'center' }}
  >
    <Typography variant="body2" color="text.secondary" sx={{ fontSize: px(T.body) }}>
      ファンダメンタルデータ未取得
    </Typography>
  </Box>
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
          銘柄データを読み込み中…
        </Typography>
      </Box>
    );
  }

  const marketCapMetric = resolveMarketCapDisplay(stockData, fundamentals, { preferUsd: true });
  const populated = hasAnyMetric(stockData, fundamentals);

  // 縦積み（モバイル）では自然な高さにする。height:100% を残すと親の
  // スクロール高に引き伸ばされ、内容の下に1000px級の空白ができる。
  const rootSx = {
    width: { xs: '100%', md: 450 },
    height: { xs: 'auto', md: '100%' },
    bgcolor: 'background.paper',
    borderRight: { xs: 0, md: 1 },
    borderColor: 'divider',
    overflow: { xs: 'visible', md: 'auto' },
    p: 2,
    display: 'flex',
    flexDirection: 'column',
    gap: 1.5,
  };

  // Minimal view when only fundamentals are available (e.g., watchlists)
  if (!stockData && fundamentals) {
    return (
      <Box sx={rootSx}>
        {/* Header */}
        <Box>
          <Typography variant="body2" fontWeight="medium" sx={{ lineHeight: 1.3 }}>
            {fundamentals.symbol}
          </Typography>
        </Box>

        {/* About - Company Description */}
        {fundamentals?.description && (
          <Box>
            <SectionHeader>企業概要</SectionHeader>
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontSize: px(T.micro),
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

        {!populated ? (
          <EmptyMetrics />
        ) : (
          <>
            <Divider />

            {/* Growth */}
            <Box>
              <SectionHeader>成長率</SectionHeader>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                <MetricRow
                  label="EPS 前Q比"
                  term="eps_qq"
                  value={formatPercent(fundamentals.eps_growth_qq)}
                  color={getGrowthColor(fundamentals.eps_growth_qq)}
                />
                <MetricRow
                  label="売上 前Q比"
                  term="sales_qq"
                  value={formatPercent(fundamentals.sales_growth_qq)}
                  color={getGrowthColor(fundamentals.sales_growth_qq)}
                />
                <MetricRow
                  label="EPS 通期"
                  term="eps_ttm"
                  value={formatPercent(fundamentals.eps_growth_annual)}
                  color={getGrowthColor(fundamentals.eps_growth_annual)}
                />
                <MetricRow
                  label="売上成長率"
                  term="rev_growth"
                  value={formatPercent(fundamentals.revenue_growth)}
                  color={getGrowthColor(fundamentals.revenue_growth)}
                />
              </Box>
            </Box>

            <Divider />

            {/* Valuation */}
            <Box>
              <SectionHeader>バリュエーション</SectionHeader>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                <MetricRow
                  label={marketCapLabel(marketCapMetric)}
                  hint={LOCAL_HINTS.market_cap}
                  value={marketCapMetric.formattedValue}
                />
                <MetricRow term="pe_ratio" label="PER" value={formatRatio(fundamentals.pe_ratio)} />
                <MetricRow term="fwd_pe" label="予想PER" value={formatRatio(fundamentals.forward_pe)} />
                <MetricRow term="peg" label="PEG" value={formatRatio(fundamentals.peg_ratio)} />
                <MetricRow
                  label="ROE"
                  term="roe"
                  value={fundamentals.roe != null ? `${fundamentals.roe.toFixed(1)}%` : '-'}
                />
                <MetricRow
                  label="純利益率"
                  hint={LOCAL_HINTS.profit_margin}
                  value={fundamentals.profit_margin != null ? `${fundamentals.profit_margin.toFixed(1)}%` : '-'}
                />
                <MetricRow
                  label="機関保有"
                  term="inst_own"
                  value={fundamentals.institutional_ownership != null ? `${fundamentals.institutional_ownership.toFixed(1)}%` : '-'}
                />
              </Box>
            </Box>
          </>
        )}
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
    <Box sx={rootSx}>
      {/* Header: Company Name + Rating */}
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="body2" fontWeight="medium" sx={{ flex: 1, lineHeight: 1.3 }}>
          {stockData.company_name || stockData.symbol}
        </Typography>
        {(stockData.rating || (stockData.execution_state && stockData.execution_state !== 'unknown')) && (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.5, flexShrink: 0 }}>
            {stockData.rating && (
              <Chip
                label={RATING_LABEL[stockData.rating] || stockData.rating}
                color={getRatingColor(stockData.rating)}
                size="small"
                variant={getRatingColor(stockData.rating) === 'default' ? 'outlined' : 'filled'}
                sx={{ fontSize: px(T.micro), height: 22, fontWeight: 600 }}
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
                  fontSize: px(T.micro),
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
          <SectionHeader>企業概要</SectionHeader>
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{
              fontSize: px(T.micro),
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

      {!populated ? (
        <EmptyMetrics />
      ) : (
        <>
          <Divider />

          {/* Scores - Composite + Screener Scores combined */}
          <Box>
            <SectionHeader>スコア</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <MetricRow
                label="総合"
                term="composite"
                value={stockData.composite_score?.toFixed(1) || '-'}
                color="primary.main"
              />
              <MetricRow
                label="EPSレート"
                term="eps_rating"
                value={stockData.eps_rating != null ? stockData.eps_rating : '-'}
                color={getEpsRatingColor(stockData.eps_rating)}
              />
              <MetricRow term="minervini" label="ミネルヴィニ" value={stockData.minervini_score?.toFixed(1) || '-'} />
              <MetricRow term="canslim" label="CANSLIM" value={stockData.canslim_score?.toFixed(1) || '-'} />
              <MetricRow label="IPO" hint={LOCAL_HINTS.ipo_score} value={stockData.ipo_score?.toFixed(1) || '-'} />
              <MetricRow label="カスタム" hint={LOCAL_HINTS.custom_score} value={stockData.custom_score?.toFixed(1) || '-'} />
              <MetricRow
                label="出来高突破"
                hint={LOCAL_HINTS.volume_breakthrough}
                value={stockData.volume_breakthrough_score?.toFixed(1) || '-'}
              />
            </Box>
            <FundamentalBonusBreakdown
              bonus={stockData.fundamental_bonus}
              detail={stockData.fundamental_bonus_detail}
            />
          </Box>

          <Divider />

          {/* Relative Strength - 2 column grid */}
          <Box>
            <SectionHeader>相対強度</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
                <MetricLabel label="RSレート" term="rs_rating" />
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flexShrink: 0 }}>
                  <Typography variant="body2" fontWeight="medium" sx={{ fontSize: px(T.body) }}>
                    {stockData.rs_rating?.toFixed(1) || '-'}
                  </Typography>
                  <RSTrendIcon trend={stockData.rs_trend} />
                </Box>
              </Box>
              <MetricRow term="rs_rating" label="RS 1か月" value={stockData.rs_rating_1m?.toFixed(1) || '-'} />
              <MetricRow term="rs_rating" label="RS 3か月" value={stockData.rs_rating_3m?.toFixed(1) || '-'} />
              <MetricRow term="rs_rating" label="RS 12か月" value={stockData.rs_rating_12m?.toFixed(1) || '-'} />
              <MetricRow term="beta" label="ベータ" value={stockData.beta?.toFixed(2) || '-'} />
              <MetricRow term="beta_adj_rs" label="β調整RS" value={stockData.beta_adj_rs?.toFixed(0) || '-'} />
            </Box>
          </Box>

          <Divider />

          {/* Growth - 2 column grid with colors */}
          <Box>
            <SectionHeader>成長率</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <MetricRow
                label="EPS 前Q比"
                term="eps_qq"
                value={formatPercent(stockData.eps_growth_qq ?? fundamentals?.eps_growth_qq)}
                color={getGrowthColor(stockData.eps_growth_qq ?? fundamentals?.eps_growth_qq)}
              />
              <MetricRow
                label="売上 前Q比"
                term="sales_qq"
                value={formatPercent(stockData.sales_growth_qq ?? fundamentals?.sales_growth_qq)}
                color={getGrowthColor(stockData.sales_growth_qq ?? fundamentals?.sales_growth_qq)}
              />
              <MetricRow
                label="EPS 前年比"
                term="eps_yy"
                value={formatPercent(stockData.eps_growth_yy ?? fundamentals?.eps_growth_yy)}
                color={getGrowthColor(stockData.eps_growth_yy ?? fundamentals?.eps_growth_yy)}
              />
              <MetricRow
                label="売上 前年比"
                term="sales_yy"
                value={formatPercent(stockData.sales_growth_yy ?? fundamentals?.sales_growth_yy)}
                color={getGrowthColor(stockData.sales_growth_yy ?? fundamentals?.sales_growth_yy)}
              />
              <MetricRow
                label="EPS 通期"
                term="eps_ttm"
                value={formatPercent(fundamentals?.eps_growth_annual)}
                color={getGrowthColor(fundamentals?.eps_growth_annual)}
              />
              <MetricRow
                label="売上成長率"
                term="rev_growth"
                value={formatPercent(fundamentals?.revenue_growth)}
                color={getGrowthColor(fundamentals?.revenue_growth)}
              />
            </Box>
          </Box>

          <Divider />

          {/* Valuation (from fundamentals) - 2 column grid */}
          <Box>
            <SectionHeader>バリュエーション</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <MetricRow
                label={marketCapLabel(marketCapMetric)}
                hint={LOCAL_HINTS.market_cap}
                value={marketCapMetric.formattedValue}
              />
              <MetricRow term="pe_ratio" label="PER" value={formatRatio(fundamentals?.pe_ratio)} />
              <MetricRow term="fwd_pe" label="予想PER" value={formatRatio(fundamentals?.forward_pe)} />
              <MetricRow term="peg" label="PEG" value={formatRatio(fundamentals?.peg_ratio)} />
              <MetricRow
                label="ROE"
                term="roe"
                value={fundamentals?.roe != null ? `${fundamentals.roe.toFixed(1)}%` : '-'}
              />
              <MetricRow
                label="純利益率"
                hint={LOCAL_HINTS.profit_margin}
                value={fundamentals?.profit_margin != null ? `${fundamentals.profit_margin.toFixed(1)}%` : '-'}
              />
              <MetricRow
                label="機関保有"
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
                <SectionHeader>VCPパターン</SectionHeader>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                  <BoolRow label="検出" term="vcp" value={stockData.vcp_detected} />
                  <MetricRow
                    label="スコア"
                    hint={LOCAL_HINTS.vcp_score}
                    value={stockData.vcp_score?.toFixed(1) || '-'}
                  />
                  <MetricRow
                    label="ピボット"
                    term="pivot"
                    value={stockData.vcp_pivot ? `$${stockData.vcp_pivot.toFixed(2)}` : '-'}
                  />
                  <BoolRow
                    label="ブレイク待ち"
                    hint={LOCAL_HINTS.vcp_ready}
                    value={stockData.vcp_ready_for_breakout}
                  />
                </Box>
              </Box>
            </>
          )}

          {/* Setup Engine - Conditional, 2 column grid */}
          {showSetupSection && (
            <>
              <Divider />
              <Box>
                <SectionHeader>セットアップエンジン</SectionHeader>
                <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
                  <MetricRow
                    label="パターン"
                    hint={LOCAL_HINTS.se_pattern}
                    value={formatPatternName(stockData.se_pattern_primary)}
                  />
                  <MetricRow
                    label="確度"
                    hint={LOCAL_HINTS.se_confidence}
                    value={stockData.se_pattern_confidence != null ? `${stockData.se_pattern_confidence.toFixed(0)}%` : '-'}
                  />
                  <MetricRow
                    label="セットアップ"
                    hint={LOCAL_HINTS.se_setup}
                    value={stockData.se_setup_score?.toFixed(1) || '-'}
                    color={getScoreColor(stockData.se_setup_score)}
                  />
                  <MetricRow
                    label="質"
                    hint={LOCAL_HINTS.se_quality}
                    value={stockData.se_quality_score?.toFixed(1) || '-'}
                    color={getScoreColor(stockData.se_quality_score)}
                  />
                  <MetricRow
                    label="準備度"
                    hint={LOCAL_HINTS.se_readiness}
                    value={stockData.se_readiness_score?.toFixed(1) || '-'}
                    color={getScoreColor(stockData.se_readiness_score)}
                  />
                  <BoolRow label="仕掛け可" hint={LOCAL_HINTS.se_ready} value={stockData.se_setup_ready} />
                </Box>
                {onViewSetupDetails && (
                  <Button
                    variant="outlined"
                    size="small"
                    fullWidth
                    startIcon={<InfoOutlinedIcon />}
                    onClick={onViewSetupDetails}
                    sx={{ textTransform: 'none', mt: 1, fontSize: px(T.micro) }}
                  >
                    セットアップ詳細を見る
                  </Button>
                )}
              </Box>
            </>
          )}

          <Divider />

          {/* Price & Technical - 2 column grid */}
          <Box>
            <SectionHeader>株価・テクニカル</SectionHeader>
            <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 0.5 }}>
              <MetricRow
                label="株価"
                hint={LOCAL_HINTS.price}
                value={stockData.current_price ? `$${stockData.current_price.toFixed(2)}` : '-'}
              />
              <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 0.5 }}>
                <MetricLabel label="ステージ" term="stage" />
                {stockData.stage ? (
                  <Chip
                    label={`S${stockData.stage}`}
                    size="small"
                    sx={{
                      backgroundColor: getStageColor(stockData.stage),
                      // White on the stage fills measured 2.78:1 — below AA.
                      // A solid chip takes near-black text (C.onSolid), the
                      // same treatment the sell-timing pill uses.
                      color: C.onSolid,
                      fontWeight: W.bold,
                      fontSize: px(T.micro),
                      height: 20,
                      flexShrink: 0,
                      '& .MuiChip-label': { px: 0.75 },
                    }}
                  />
                ) : (
                  <Typography variant="body2" sx={{ fontSize: px(T.body) }}>-</Typography>
                )}
              </Box>
              <BoolRow label="MA整列" term="ma_stack" value={stockData.ma_alignment} />
              <BoolRow label="テンプレ合格" term="trend_template" value={stockData.passes_template} />
            </Box>
          </Box>
        </>
      )}

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
          同業銘柄を見る
        </Button>
      )}
    </Box>
  );
}

export default StockMetricsSidebar;
