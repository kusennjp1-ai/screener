import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import FilterPanel from '../../components/Scan/FilterPanel';
import ResultsTable from '../../components/Scan/ResultsTable';
import MarketRegimeBanner from '../../features/scan/components/MarketRegimeBanner';
import { useStaticManifest, fetchStaticJson, resolveStaticMarketEntry } from '../dataClient';
import { useStaticChartIndex } from '../chartClient';
import {
  applyScanFilterDefaults,
  buildDefaultScanFilters,
} from '../../features/scan/defaultFilters';
import { normalizeScanFilterOptions } from '../../features/scan/filterOptions';
import { getStableFilterKey } from '../../utils/filterUtils';
import {
  filterStaticScanRows,
  paginateStaticScanRows,
  sortStaticScanRows,
} from '../scanClient';
import StaticChartViewerModal from '../StaticChartViewerModal';
import ScreenSelector from '../components/ScreenSelector';
import { usePresetScreens, buildFiltersFromPreset } from '../hooks/usePresetScreens';
import { useStaticMarket } from '../StaticMarketContext';
import { C, T, W, px } from '../designTokens';
import { SnapshotGapPanel } from './SnapshotGapPanel';

const HYDRATION_BATCH_SIZE = 2;

/**
 * プリセットスクリーンの名前はバックエンドの英語リストから来る。
 * そのまま出すと 30 個の英語チップが並び、日本語アプリの中で
 * ここだけ英語アプリになってしまう。
 *
 * ここで日本語の表示名に差し替える。日本のトレーダーが実際に使う
 * 用語（VCP・IBD・RS・CANSLIM・EP など）は英字のまま残し、
 * それ以外は日本語にする。`note` は「何を拾うスクリーンなのか」を
 * 一行で説明する短文で、チップの下に本文として出す（ツールチップは
 * スマートフォンでは開けないため、本文で見せる）。
 *
 * バックエンドに新しいスクリーンが増えてここに無い場合は、
 * 元の short_name にそのまま戻す（表示が消えるより英字のほうがまし）。
 */
const PRESET_LABELS_JA = {
  minervini: {
    short: 'ミネルヴィニ',
    name: 'ミネルヴィニ・トレンドテンプレート',
    note: 'ステージ2の上昇トレンド、RS 90以上、52週高値から10%以内、EPSレーティング80以上、上位業種グループ。',
  },
  minervini_vcp: {
    short: 'ミネルヴィニ+VCP',
    name: 'ミネルヴィニ合格 かつ VCP形成中',
    note: '合格銘柄のうち、いま値幅が縮んでベースを作っている銘柄だけ。伸びきった後ではなく買い場に近い形。',
  },
  minervini_usic: {
    short: 'USIC流',
    name: 'ミネルヴィニ USIC 流',
    note: '実際の投資選手権でのエントリーに合わせた条件。高値から5%以内、6ヶ月で25%以上の上昇、値動きは中程度。',
  },
  canslim: {
    short: 'CANSLIM',
    name: 'CANSLIM（オニール）',
    note: '直近四半期と通期のEPSがともに25%以上、高値圏、RS上位。',
  },
  ibd_composite: {
    short: 'IBD 85-85',
    name: 'IBD 総合リーダー（85-85）',
    note: 'EPSレーティング85以上かつRSレーティング85以上で、上位業種グループに属する銘柄。',
  },
  ibd50: {
    short: 'IBD 50',
    name: 'IBD 50 相当',
    note: '総合レーティング上位の成長リーダーを50銘柄まで。EPS・RS・業種・利益率・機関の売買を合成した順位。',
  },
  vcp: {
    short: 'VCP',
    name: 'VCP（ボラティリティ収縮）',
    note: 'ステージ2の上昇トレンドの中で、押し幅が段階的に小さくなっている形。',
  },
  blue_dot_leaders: {
    short: 'ブルードット',
    name: 'RS新高値（ブルードット）',
    note: '株価より先にRSラインが新高値をつけた銘柄。ブレイク前に主導株になりつつあるサイン。',
  },
  vol_break: {
    short: '出来高ブレイク',
    name: '出来高ブレイクスルー',
    note: '1年・5年の期間で最大級の出来高を伴う上放れ。',
  },
  episodic_pivot: {
    short: 'EP（窓開け）',
    name: 'エピソディック・ピボット',
    note: '大商いを伴う窓開け上昇。決算などの材料で一気に水準が変わった銘柄。',
  },
  momentum: {
    short: 'モメンタム',
    name: 'モメンタム上位',
    note: 'ステージ2の上昇トレンドで、3〜6ヶ月の上昇率が上位の銘柄。',
  },
  kell_growth: {
    short: 'ケル流成長',
    name: 'オリバー・ケル流 成長株',
    note: '高値圏にあり、利益と売上の伸びが加速している銘柄。',
  },
  rs_power: {
    short: 'RS最上位',
    name: 'RS パワープレイ',
    note: 'ステージ2の上昇トレンドで、RSレーティングが最上位クラスの銘柄。',
  },
  leaders_in_leading_groups: {
    short: '主導グループ',
    name: '主導グループの主導株',
    note: 'IBD業種グループ上位40に入るグループの中で、成績の良い銘柄。',
  },
  new_highs: {
    short: '新高値',
    name: '新高値＋出来高',
    note: '52週高値の近辺にあり、出来高が平均を上回っている銘柄。',
  },
  growth: {
    short: '急成長',
    name: '急成長株',
    note: 'EPSと売上がともに3桁成長で、相対的な強さも高い銘柄。',
  },
  tight: {
    short: 'タイト',
    name: 'タイトな保ち合い',
    note: '値動きが小さく締まったベースを作っている上昇トレンド銘柄。',
  },
  ipo: {
    short: '新規上場',
    name: '最近のIPO',
    note: '上場して間もなく、初動の値動きが強い銘柄。',
  },
  pocket_pivot: {
    short: 'ポケットピボット',
    name: 'ポケットピボット',
    note: '直近10営業日のどの下落日よりも大きい出来高で上昇した日。',
  },
  power_trend: {
    short: 'パワートレンド',
    name: 'ミネルヴィニ パワートレンド',
    note: '21日EMAに沿って上昇し、50日移動平均が上向きの状態。',
  },
  accumulation: {
    short: '買い集め',
    name: '機関の買い集め',
    note: '10日間の上昇日/下落日の出来高比が高く、機関投資家の買いが示唆される銘柄。',
  },
  se_cup_handle: {
    short: 'カップ',
    name: 'カップ・ウィズ・ハンドル',
    note: '取っ手付きカップ型のベースを検出した銘柄。',
  },
  se_double_bottom: {
    short: 'ダブルボトム',
    name: 'ダブルボトム',
    note: '二番底型のベースを検出した銘柄。',
  },
  se_high_tight_flag: {
    short: 'ハイタイトフラッグ',
    name: 'ハイ・タイト・フラッグ',
    note: '急騰したあと高い位置で小さく持ち合う、勢いの強いベース。',
  },
  se_first_pullback: {
    short: '初押し',
    name: 'ブレイク後の初押し',
    note: 'ブレイクアウトのあと、最初の押し目をつけた銘柄。',
  },
  se_three_weeks_tight: {
    short: '3週タイト',
    name: '3週間タイト',
    note: '3週続けて週足終値が接近している継続パターン。',
  },
  se_nr7_inside_day: {
    short: 'NR7/インサイド',
    name: 'NR7・インサイドデイ',
    note: '直近7日で最も値幅が小さい日、または前日の値幅に収まった日。',
  },
  gainers_4pct: {
    short: '当日+4%',
    name: '当日4%以上の上昇',
    note: 'その日に4%以上上げた銘柄。相場全体の勢いを手早く見るための一覧。',
  },
  movers_9m: {
    short: '大商い',
    name: '大商いの動意',
    note: '売買代金1億ドル以上かつ、平常の1.25倍以上の出来高で動いた銘柄。',
  },
  movers_20_weekly: {
    short: '週+20%',
    name: '直近5日で20%以上の上昇',
    note: '直近5営業日で20%以上上げた銘柄。',
  },
  club_97: {
    short: '97クラブ',
    name: '上位3%の値動き',
    note: '日・週・月のすべてで上位3%に入る値動きをしている銘柄。',
  },
};

const ALL_STOCKS_SCREEN = {
  name: '全銘柄',
  note: 'プリセットを使わず、下の絞り込み条件だけを適用したスキャン結果。',
};

function localizeScreen(screen) {
  const ja = PRESET_LABELS_JA[screen?.id];
  if (!ja) {
    return screen;
  }
  return {
    ...screen,
    short_name: ja.short,
    name: ja.name,
    description: ja.note,
  };
}

// 絞り込み条件チップの日本語名。値の書式もここで決める。
const FILTER_LABELS_JA = {
  symbolSearch: 'ティッカー',
  stage: 'ステージ',
  ratings: 'レーティング',
  ibdIndustries: '業種',
  gicsSectors: 'セクター',
  markets: '市場',
  minVolume: '売買代金',
  minMarketCap: '時価総額',
  marketCapUsd: '時価総額(米ドル)',
  advUsd: '平均売買代金(米ドル)',
  price: '株価',
  ipoAfter: '上場時期',
  epsGrowth: 'EPS成長率(前年同期比)',
  epsGrowthYy: 'EPS成長率(通期)',
  salesGrowth: '売上成長率',
  epsRating: 'EPSレーティング',
  ibdGroupRank: '業種グループ順位',
  rsRating: 'RSレーティング',
  rs1m: 'RS(1ヶ月)',
  rs3m: 'RS(3ヶ月)',
  rs12m: 'RS(12ヶ月)',
  betaAdjRs: 'β調整後RS',
  beta: 'ベータ',
  maAlignment: '移動平均の並び',
  adrPercent: 'ADR(平均日中変動率)',
  perfDay: '当日騰落率',
  perfWeek: '週間騰落率',
  perfMonth: '月間騰落率',
  perf3m: '3ヶ月騰落率',
  perf6m: '6ヶ月騰落率',
  pctDay: '当日騰落率',
  pctWeek: '週間騰落率',
  pctMonth: '月間騰落率',
  gapPercent: 'ギャップ率',
  volumeSurge: '出来高倍率',
  ema10Distance: '10日EMAとの距離',
  ema20Distance: '20日EMAとの距離',
  ema50Distance: '50日EMAとの距離',
  week52HighDistance: '52週高値からの距離',
  week52LowDistance: '52週安値からの距離',
  pocketPivot: 'ポケットピボット',
  powerTrend: 'パワートレンド',
  compositeScore: 'コンポジットスコア',
  compositeRating: '総合レーティング',
  minerviniScore: 'ミネルヴィニスコア',
  canslimScore: 'CANSLIMスコア',
  ipoScore: 'IPOスコア',
  customScore: 'カスタムスコア',
  volBreakthroughScore: '出来高ブレイクスコア',
  seSetupScore: 'セットアップスコア',
  seDistanceToPivot: 'ピボットまでの距離',
  seBbSqueeze: 'ボリンジャー収縮',
  seVolumeVs50d: '出来高/50日平均',
  seUpDownVolume: '上昇/下落 出来高比',
  sePatternPrimary: '検出パターン',
  seSetupReady: 'セットアップ成立',
  seRsLineNewHigh: 'RSライン新高値',
  seRsLineBlueDot: 'RSライン ブルードット',
  vcpScore: 'VCPスコア',
  vcpDetected: 'VCP検出',
  vcpReady: 'VCP成立',
  passesTemplate: 'トレンドテンプレート合格',
  code33: 'コード33',
};

const PERCENT_FILTER_KEYS = new Set([
  'epsGrowth', 'epsGrowthYy', 'salesGrowth', 'adrPercent', 'gapPercent',
  'perfDay', 'perfWeek', 'perfMonth', 'perf3m', 'perf6m',
  'pctDay', 'pctWeek', 'pctMonth',
  'ema10Distance', 'ema20Distance', 'ema50Distance',
  'week52HighDistance', 'week52LowDistance', 'seDistanceToPivot',
]);

const MULTIPLE_FILTER_KEYS = new Set(['volumeSurge', 'seVolumeVs50d', 'seUpDownVolume']);

/** 1億ドル / 5,000万ドル のように、日本語の桁で読める形にする。 */
function formatUsdAmount(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  if (n >= 1e8) {
    const oku = n / 1e8;
    return `${Number(oku.toFixed(2)).toLocaleString()}億ドル`;
  }
  if (n >= 1e4) {
    const man = n / 1e4;
    return `${Number(man.toFixed(0)).toLocaleString()}万ドル`;
  }
  return `${n.toLocaleString()}ドル`;
}

function formatFilterValue(key, value) {
  if (typeof value === 'boolean') {
    return value ? 'あり' : 'なし';
  }
  if (key === 'minVolume' || key === 'minMarketCap' || key === 'marketCapUsd' || key === 'advUsd') {
    return `${formatUsdAmount(value)}以上`;
  }
  if (Array.isArray(value)) {
    return value.length <= 2 ? value.join('・') : `${value.length}件選択`;
  }
  if (value && typeof value === 'object' && Array.isArray(value.values)) {
    const mode = value.mode === 'exclude' ? 'を除外' : 'を選択';
    return `${value.values.length}件${mode}`;
  }
  if (value && typeof value === 'object' && ('min' in value || 'max' in value)) {
    const suffix = PERCENT_FILTER_KEYS.has(key) ? '%' : (MULTIPLE_FILTER_KEYS.has(key) ? '倍' : '');
    const { min, max } = value;
    if (min != null && max != null) return `${min}${suffix}〜${max}${suffix}`;
    if (min != null) return `${min}${suffix}以上`;
    return `${max}${suffix}以下`;
  }
  return String(value);
}

/**
 * いま効いている絞り込み条件を、日本語のチップ用に並べ直す。
 * 共有の buildActiveFilters() は英語ラベル（"Dollar Vol: >$100M"）を返すので、
 * ここでは値そのものから日本語の表示を組み立てる。
 */
function describeActiveFilters(filters) {
  if (!filters) return [];
  return Object.entries(filters)
    .filter(([, value]) => {
      if (value == null) return false;
      if (typeof value === 'string') return value.length > 0;
      if (typeof value === 'boolean') return value;
      if (Array.isArray(value)) return value.length > 0;
      if (typeof value === 'object') {
        if (Array.isArray(value.values)) return value.values.length > 0;
        if ('min' in value || 'max' in value) return value.min != null || value.max != null;
      }
      return true;
    })
    .map(([key, value]) => ({
      key,
      label: `${FILTER_LABELS_JA[key] || key} ${formatFilterValue(key, value)}`,
    }));
}

/**
 * 日本語の絞り込みバー。
 *
 * 共有の FilterPanel（PC のスキャン画面と共用。担当外のファイル）は
 * "Filters / Reset / Dollar Vol: >$100M" と英語のヘッダーを出すので、
 * このページではそのヘッダーを隠し、同じ役割のバーを日本語で用意する。
 * 中身（詳細な条件）は共有パネルをそのまま開く。
 */
function ScanFilterBar({ activeFilters, expanded, onToggle, onReset, children }) {
  return (
    <Paper elevation={0} sx={{ border: `1px solid ${C.track}`, borderRadius: 1, mb: 1.5, overflow: 'hidden' }}>
      <Box
        component="button"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        data-testid="scan-filter-bar-toggle"
        sx={{
          width: '100%',
          minHeight: 40,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1.25,
          py: 0.5,
          background: 'none',
          border: 0,
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          cursor: 'pointer',
        }}
      >
        <Typography sx={{ fontSize: px(T.body), fontWeight: W.bold, color: C.inkStrong, flexShrink: 0 }}>
          絞り込み
        </Typography>
        <Typography sx={{ fontSize: px(T.micro), fontFamily: 'monospace', color: C.grey, flexShrink: 0 }}>
          {activeFilters.length > 0 ? `${activeFilters.length} 件` : 'なし'}
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Typography sx={{ fontSize: px(T.micro), color: C.grey, flexShrink: 0 }}>
          {expanded ? '▾' : '▸'}
        </Typography>
      </Box>

      {activeFilters.length > 0 && (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 0.5, px: 1.25, pb: 1 }}>
          {activeFilters.map((filter) => (
            <Chip
              key={filter.key}
              label={filter.label}
              size="small"
              variant="outlined"
              sx={{
                height: 22,
                fontSize: px(T.micro),
                color: C.ink,
                borderColor: C.track,
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          ))}
          <Button
            type="button"
            size="small"
            onClick={onReset}
            sx={{
              fontSize: px(T.micro),
              fontWeight: W.medium,
              color: C.blue,
              textTransform: 'none',
              minWidth: 0,
              px: 0.75,
              py: 0.25,
              '&:hover': { backgroundColor: 'transparent' },
            }}
          >
            条件をリセット
          </Button>
        </Box>
      )}

      <Collapse in={expanded} unmountOnExit>
        <Box
          sx={{
            borderTop: `1px solid ${C.track}`,
            // 共有 FilterPanel の英語ヘッダー（Filters / Reset）と、末尾の
            // 英語の "Active:" チップ列は、上の日本語バーと役割がそのまま
            // 重複するので隠す。共有ファイル側は PC のスキャン画面と共用の
            // ため編集していない。
            '& > .MuiPaper-root': { backgroundColor: 'transparent', boxShadow: 'none', mb: 0 },
            '& > .MuiPaper-root > .MuiBox-root:first-of-type': { display: 'none' },
            '& .MuiCollapse-wrapperInner > .MuiBox-root > .MuiBox-root:last-of-type': { display: 'none' },
          }}
        >
          {children}
        </Box>
      </Collapse>
    </Paper>
  );
}

function StaticScanPage() {
  const manifestQuery = useStaticManifest();
  const { selectedMarket } = useStaticMarket();
  const marketEntry = useMemo(
    () => resolveStaticMarketEntry(manifestQuery.data, selectedMarket),
    [manifestQuery.data, selectedMarket],
  );
  const scanManifestQuery = useQuery({
    queryKey: ['staticScanManifest', marketEntry.pages?.scan?.path],
    queryFn: () => fetchStaticJson(marketEntry.pages.scan.path),
    enabled: Boolean(marketEntry.pages?.scan?.path),
    staleTime: Infinity,
  });
  const chartIndexQuery = useStaticChartIndex(scanManifestQuery.data?.charts?.path);

  const theme = useTheme();
  // モバイルでは初期状態でフィルタを折りたたみ、結果テーブルをすぐ見られるようにする
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const [filters, setFilters] = useState(buildDefaultScanFilters);
  const [showFilters, setShowFilters] = useState(!isMobile);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(50);
  const [sortBy, setSortBy] = useState('composite_score');
  const [sortOrder, setSortOrder] = useState('desc');
  // チャートモーダルとプリセットスクリーン選択はURLと同期させる。
  // 履歴に積まれるため、ブラウザの「戻る」でモーダルが閉じ、選択も巻き戻せる。
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedChartSymbol = searchParams.get('chart');
  const chartModalOpen = Boolean(selectedChartSymbol);
  const screenParam = searchParams.get('screen');
  const closeChartModal = useCallback(() => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.delete('chart');
      return next;
    }, { replace: true });
  }, [setSearchParams]);
  const [hydrationState, setHydrationState] = useState({
    status: 'idle',
    rows: [],
    loadedRows: 0,
    error: null,
  });
  const sectionDefaultExpanded = useMemo(
    () => ({
      fundamental: false,
      technical: false,
      rating: false,
    }),
    []
  );
  const manifestDefaultFilterValues = useMemo(
    () => scanManifestQuery.data?.default_filters ?? {},
    [scanManifestQuery.data?.default_filters]
  );
  const manifestDefaultFilters = useMemo(
    () => applyScanFilterDefaults(manifestDefaultFilterValues),
    [manifestDefaultFilterValues]
  );
  const manifestDefaultSortBy = scanManifestQuery.data?.sort?.field ?? 'composite_score';
  const manifestDefaultSortOrder = scanManifestQuery.data?.sort?.order ?? 'desc';
  const presetScreens = scanManifestQuery.data?.preset_screens;

  useEffect(() => {
    if (scanManifestQuery.data?.default_page_size) {
      setPerPage(scanManifestQuery.data.default_page_size);
    }
    if (scanManifestQuery.data?.sort?.field) {
      setSortBy(scanManifestQuery.data.sort.field);
      setSortOrder(scanManifestQuery.data.sort.order || 'desc');
    }
  }, [scanManifestQuery.data]);

  useEffect(() => {
    if (!scanManifestQuery.data) {
      return;
    }
    setFilters(manifestDefaultFilters);
  }, [manifestDefaultFilters, scanManifestQuery.data]);

  useEffect(() => {
    const manifest = scanManifestQuery.data;
    if (!manifest) {
      return undefined;
    }

    const initialRows = Array.isArray(manifest.initial_rows) ? manifest.initial_rows : [];
    const totalRows = manifest.rows_total || initialRows.length;
    const chunks = Array.isArray(manifest.chunks) ? manifest.chunks : [];
    const rowsBySymbol = new Map(initialRows.map((row) => [row.symbol, row]));
    const initialLoadedRows = Math.min(rowsBySymbol.size, totalRows);

    if (!chunks.length || initialLoadedRows >= totalRows) {
      setHydrationState({
        status: 'complete',
        rows: initialRows,
        loadedRows: initialLoadedRows,
        error: null,
      });
      return undefined;
    }

    setHydrationState({
      status: 'loading',
      rows: initialRows,
      loadedRows: initialLoadedRows,
      error: null,
    });

    let cancelled = false;
    const hydrateRows = async () => {
      try {
        for (let index = 0; index < chunks.length; index += HYDRATION_BATCH_SIZE) {
          const batch = chunks.slice(index, index + HYDRATION_BATCH_SIZE);
          const payloads = await Promise.all(batch.map((chunk) => fetchStaticJson(chunk.path)));
          if (cancelled) {
            return;
          }

          payloads.forEach((payload) => {
            (payload.rows || []).forEach((row) => {
              rowsBySymbol.set(row.symbol, row);
            });
          });

          setHydrationState({
            status: rowsBySymbol.size >= totalRows ? 'complete' : 'loading',
            rows: Array.from(rowsBySymbol.values()),
            loadedRows: Math.min(rowsBySymbol.size, totalRows),
            error: null,
          });
        }

        if (!cancelled) {
          setHydrationState({
            status: 'complete',
            rows: Array.from(rowsBySymbol.values()),
            loadedRows: Math.min(rowsBySymbol.size, totalRows),
            error: null,
          });
        }
      } catch (error) {
        if (!cancelled) {
          const accumulatedRows = Array.from(rowsBySymbol.values());
          setHydrationState({
            status: 'error',
            rows: accumulatedRows,
            loadedRows: Math.min(accumulatedRows.length, totalRows),
            error: error instanceof Error ? error.message : 'Unknown hydration error',
          });
        }
      }
    };

    void hydrateRows();

    return () => {
      cancelled = true;
    };
  }, [scanManifestQuery.data]);

  const hydrationComplete = hydrationState.status === 'complete';
  const hydratedRows = hydrationState.rows;
  const { activeScreenId, setActiveScreenId, matchCounts } = usePresetScreens({
    screens: presetScreens,
    allRows: hydratedRows,
    hydrationComplete,
  });

  const applyScreen = useCallback((screenId) => {
    setActiveScreenId(screenId || null);
    if (!screenId) {
      setFilters(manifestDefaultFilters);
      setSortBy(manifestDefaultSortBy);
      setSortOrder(manifestDefaultSortOrder);
    } else {
      const screen = presetScreens?.find((s) => s.id === screenId);
      if (screen) {
        setFilters(buildFiltersFromPreset(screen));
        setSortBy(screen.sort_by);
        setSortOrder(screen.sort_order);
      }
    }
  }, [
    presetScreens,
    manifestDefaultFilters,
    manifestDefaultSortBy,
    manifestDefaultSortOrder,
    setActiveScreenId,
  ]);

  // URLの ?screen= が変わったら（チップ選択・戻る/進む・直接リンク）選択を適用する
  useEffect(() => {
    if (!scanManifestQuery.data) {
      return;
    }
    applyScreen(screenParam);
  }, [applyScreen, scanManifestQuery.data, screenParam]);

  const handleSelectScreen = useCallback((screenId) => {
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      if (screenId) {
        next.set('screen', screenId);
      } else {
        next.delete('screen');
      }
      return next;
    });
  }, [setSearchParams]);

  const filterKey = useMemo(() => getStableFilterKey(filters), [filters]);
  useEffect(() => {
    setPage(1);
  }, [filterKey]);
  const chartEntries = useMemo(
    () => chartIndexQuery.data?.symbols || [],
    [chartIndexQuery.data]
  );
  const chartEnabledSymbols = useMemo(
    () => new Set(chartEntries.map((entry) => entry.symbol)),
    [chartEntries]
  );
  const filteredRows = useMemo(
    () => (hydrationComplete ? filterStaticScanRows(hydratedRows, filters) : hydratedRows),
    [filters, hydratedRows, hydrationComplete]
  );
  const sortedRows = useMemo(
    () => (
      hydrationComplete
        ? sortStaticScanRows(filteredRows, sortBy, sortOrder, {
          prioritizeCompositeScanMode: !activeScreenId,
        })
        : filteredRows
    ),
    [activeScreenId, filteredRows, hydrationComplete, sortBy, sortOrder]
  );
  const activeScreenLimit = useMemo(() => {
    if (!activeScreenId) return null;
    const screen = presetScreens?.find((s) => s.id === activeScreenId);
    return screen?.limit ?? null;
  }, [activeScreenId, presetScreens]);
  // Capped screens (e.g. "IBD 50") show only the top-N after sorting, so the
  // list reads like the editorial leaderboard rather than every match.
  const cappedRows = useMemo(
    () => (activeScreenLimit ? sortedRows.slice(0, activeScreenLimit) : sortedRows),
    [activeScreenLimit, sortedRows]
  );
  const pagedRows = useMemo(
    () => (hydrationComplete ? paginateStaticScanRows(cappedRows, page, perPage) : filteredRows),
    [cappedRows, filteredRows, hydrationComplete, page, perPage]
  );
  const chartsAvailable = chartEnabledSymbols.size > 0;
  const isChartEnabled = useCallback(
    (symbol) => chartEnabledSymbols.has(symbol),
    [chartEnabledSymbols]
  );

  const handleOpenChart = (symbol) => {
    if (!isChartEnabled(symbol)) {
      return;
    }
    setSearchParams((previous) => {
      const next = new URLSearchParams(previous);
      next.set('chart', symbol);
      return next;
    });
  };
  const navigationSymbols = useMemo(() => {
    const orderedRows = hydrationComplete ? cappedRows : pagedRows;
    return orderedRows
      .map((row) => row.symbol)
      .filter((symbol) => chartEnabledSymbols.has(symbol));
  }, [cappedRows, chartEnabledSymbols, hydrationComplete, pagedRows]);

  const localizedScreens = useMemo(
    () => (presetScreens || []).map(localizeScreen),
    [presetScreens],
  );
  const activeScreen = useMemo(
    () => localizedScreens.find((screen) => screen.id === activeScreenId) || null,
    [activeScreenId, localizedScreens],
  );
  const activeFilterChips = useMemo(() => describeActiveFilters(filters), [filters]);
  const resetFilters = useCallback(() => {
    setFilters(manifestDefaultFilters);
    setSortBy(manifestDefaultSortBy);
    setSortOrder(manifestDefaultSortOrder);
    if (screenParam) {
      handleSelectScreen(null);
    } else {
      setActiveScreenId(null);
    }
  }, [
    handleSelectScreen,
    manifestDefaultFilters,
    manifestDefaultSortBy,
    manifestDefaultSortOrder,
    screenParam,
    setActiveScreenId,
  ]);
  const clearAllFilters = useCallback(() => {
    setFilters(buildDefaultScanFilters());
    if (screenParam) {
      handleSelectScreen(null);
    } else {
      setActiveScreenId(null);
    }
  }, [handleSelectScreen, screenParam, setActiveScreenId]);

  if (manifestQuery.isLoading || scanManifestQuery.isLoading) {
    return (
      <Box display="flex" justifyContent="center" py={8}>
        <CircularProgress />
      </Box>
    );
  }

  if (manifestQuery.isError || scanManifestQuery.isError) {
    return (
      <Box>
        <Typography variant="h5" sx={{ fontWeight: W.bold, letterSpacing: '-0.5px', mb: 2 }}>
          デイリースキャン
        </Typography>
        <SnapshotGapPanel
          testId="scan-fetch-failed"
          title="スキャン結果を読み込めませんでした"
          statusLabel="読み込み失敗"
          reason="スナップショットのスキャンファイルを取得できませんでした。通信が切れているか、公開途中の可能性があります。"
          actions={[{ to: '/', label: 'デイリーに戻る' }]}
          footnote="ページを再読み込みしても直らない場合は、次のスナップショット公開までお待ちください。"
        />
      </Box>
    );
  }

  const shownCount = hydrationComplete ? cappedRows.length : hydrationState.loadedRows;
  const totalRows = scanManifestQuery.data.rows_total || 0;
  const chartCount = scanManifestQuery.data.charts?.available
    ? (scanManifestQuery.data.charts.symbols_total ?? scanManifestQuery.data.charts.limit)
    : null;
  const showEmptyState = hydrationComplete && cappedRows.length === 0;

  return (
    <Box>
      <Typography variant="h5" sx={{ fontWeight: W.bold, letterSpacing: '-0.5px', mb: 0.5 }}>
        デイリースキャン
      </Typography>
      <Typography sx={{ fontSize: px(T.body), color: C.grey, mb: 2 }}>
        基準日 {scanManifestQuery.data.as_of_date}
      </Typography>

      {hydrationComplete && localizedScreens.length > 0 && (
        <ScreenSelector
          screens={localizedScreens}
          activeScreenId={activeScreenId}
          onSelectScreen={handleSelectScreen}
          matchCounts={matchCounts}
        />
      )}

      {/* 以前はここに 3 つの数字（0 件 / 全 10 件 / チャート 13 銘柄）が
          説明なしで並んでいた。見出しの数字は「いま選んでいる条件に該当した
          銘柄数」ひとつだけにし、何の数かを日本語で言う。すぐ下に、選択中の
          スクリーンの名前と一行説明を置く（チップのツールチップはスマート
          フォンでは開けないため）。残りの内訳は該当なしのときの説明文の中で
          文脈と一緒に出す。 */}
      <Paper
        elevation={0}
        data-testid="scan-result-count"
        sx={{ p: 1.5, mb: 1.5, border: `1px solid ${C.track}`, borderRadius: 1 }}
      >
        <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
          <Typography sx={{ fontSize: px(T.display), fontFamily: 'monospace', fontWeight: W.bold, color: C.inkStrong, lineHeight: 1.1 }}>
            {shownCount.toLocaleString()}
          </Typography>
          <Typography sx={{ fontSize: px(T.body), color: C.ink }}>銘柄</Typography>
          <Typography sx={{ fontSize: px(T.micro), color: C.grey }}>
            {hydrationComplete ? 'が該当' : 'を読み込み中'}
          </Typography>
        </Box>
        {hydrationComplete && (
          <Box sx={{ mt: 1, pt: 1, borderTop: `1px solid ${C.track}` }} data-testid="scan-active-screen">
            <Typography sx={{ fontSize: px(T.body), fontWeight: W.bold, color: C.inkStrong, mb: 0.25 }}>
              {activeScreen ? activeScreen.name : ALL_STOCKS_SCREEN.name}
            </Typography>
            <Typography sx={{ fontSize: px(T.micro), color: C.grey, lineHeight: 1.7 }}>
              {activeScreen ? activeScreen.description : ALL_STOCKS_SCREEN.note}
            </Typography>
          </Box>
        )}
      </Paper>

      {!hydrationComplete && (
        <Alert severity="info" sx={{ mb: 2 }}>
          全データを読み込み中: {hydrationState.loadedRows.toLocaleString()} /{' '}
          {scanManifestQuery.data.rows_total.toLocaleString()} 件。読み込み完了後にフィルタと並べ替えが使えるようになります。
        </Alert>
      )}

      {hydrationState.status === 'error' && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          バックグラウンドのデータ読み込みに失敗しました。先頭ページのみ表示しています。
        </Alert>
      )}

      {chartIndexQuery.isError && scanManifestQuery.data.charts?.path ? (
        <Alert severity="warning" sx={{ mb: 2 }}>
          チャートデータの読み込みに失敗しました。スキャン結果はチャートなしで利用できます。
        </Alert>
      ) : null}

      {/* Minervini rule 1 — the same market-regime banner the PC scan page
          shows; regime fields ride on every static scan row. Fed from the
          unfiltered set so the market context stays visible even when the
          active filters match nothing. */}
      <MarketRegimeBanner results={hydratedRows} />

      {hydrationComplete && (
        <ScanFilterBar
          activeFilters={activeFilterChips}
          expanded={showFilters}
          onToggle={() => setShowFilters((previous) => !previous)}
          onReset={resetFilters}
        >
          <FilterPanel
            filters={filters}
            onFilterChange={setFilters}
            onReset={resetFilters}
            filterOptions={normalizeScanFilterOptions(scanManifestQuery.data.filter_options)}
            expanded
            onToggle={() => setShowFilters((previous) => !previous)}
            presetsEnabled={false}
            sectionDefaultExpanded={sectionDefaultExpanded}
          />
        </ScanFilterBar>
      )}

      {showEmptyState ? (
        <SnapshotGapPanel
          testId="scan-no-matches"
          title="条件に合う銘柄がありません"
          statusLabel="該当なし"
          reason={
            activeScreen
              ? `「${activeScreen.name}」の条件に合う銘柄は、このスナップショットの ${totalRows.toLocaleString()} 銘柄の中にありませんでした。`
              : `いまの絞り込み条件に合う銘柄は、このスナップショットの ${totalRows.toLocaleString()} 銘柄の中にありませんでした。`
          }
          facts={[
            { label: '基準日', value: scanManifestQuery.data.as_of_date || '-' },
            { label: '収録銘柄', value: `${totalRows.toLocaleString()} 銘柄` },
            ...(chartCount != null
              ? [{ label: 'チャート', value: `${Number(chartCount).toLocaleString()} 銘柄` }]
              : []),
            ...(activeFilterChips.length > 0
              ? [{ label: '絞り込み', value: activeFilterChips.map((chip) => chip.label).join(' / ') }]
              : []),
          ]}
          factsTitle="いまの条件"
          actionsTitle="次にできること"
          actions={[
            ...(activeScreenId ? [{ id: 'all', label: '全銘柄を表示' }] : []),
            ...(activeFilterChips.length > 0 ? [{ id: 'clear', label: '絞り込みを外す' }] : []),
            { to: '/', label: 'デイリーで注目銘柄を見る' },
          ]}
          onAction={(id) => {
            if (id === 'all') {
              handleSelectScreen(null);
            } else if (id === 'clear') {
              clearAllFilters();
            }
          }}
          footnote="このスナップショットは収録銘柄が少ないため、条件の厳しいスクリーンでは該当が出ないことがあります。"
        />
      ) : (
      <ResultsTable
        results={pagedRows}
        total={hydrationComplete ? cappedRows.length : pagedRows.length}
        page={hydrationComplete ? page : 1}
        perPage={perPage}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onPageChange={hydrationComplete ? setPage : () => setPage(1)}
        onPerPageChange={hydrationComplete ? setPerPage : () => setPage(1)}
        onSortChange={(nextSortBy, nextSortOrder) => {
          if (!hydrationComplete) {
            return;
          }
          setSortBy(nextSortBy);
          setSortOrder(nextSortOrder);
          setPage(1);
        }}
        onOpenChart={chartsAvailable ? handleOpenChart : undefined}
        loading={false}
        showActions={chartsAvailable}
        showWatchlistMenu={false}
        isChartEnabled={isChartEnabled}
        sortingEnabled={hydrationComplete}
      />
      )}

      <StaticChartViewerModal
        open={chartModalOpen}
        onClose={closeChartModal}
        initialSymbol={selectedChartSymbol}
        chartIndex={chartIndexQuery.data}
        navigationSymbols={navigationSymbols}
      />
    </Box>
  );
}

export default StaticScanPage;
