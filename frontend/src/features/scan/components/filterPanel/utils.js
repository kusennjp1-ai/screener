import { MARKET_CAP_OPTIONS, VOLUME_OPTIONS } from './constants';

const NULL_RESET_KEYS = new Set(['stage', 'minVolume', 'minMarketCap', 'ipoAfter']);
const ARRAY_RESET_KEYS = new Set(['ratings', 'sePatternPrimary']);
const MODED_MULTI_RESET_KEYS = new Set(['ibdIndustries', 'gicsSectors']);
const BOOLEAN_RESET_KEYS = new Set([
  'vcpDetected',
  'vcpReady',
  'maAlignment',
  'passesTemplate',
  'code33',
  'seSetupReady',
  'seRsLineNewHigh',
  'seRsLineBlueDot',
  'pocketPivot',
  'powerTrend',
]);

const SCORE_FILTERS = [
  { key: 'compositeScore', label: '補助スコア' },
  { key: 'minerviniScore', label: 'ミネルヴィニ点' },
  { key: 'canslimScore', label: 'CAN SLIM点' },
  { key: 'ipoScore', label: 'IPO' },
  { key: 'customScore', label: 'カスタム点' },
  { key: 'volBreakthroughScore', label: '出来高ブレイク点' },
  { key: 'seSetupScore', label: 'セットアップ点' },
];

const RS_FILTERS = [
  { key: 'rsRating', label: 'RS' },
  { key: 'rs1m', label: 'RS 1か月' },
  { key: 'rs3m', label: 'RS 3か月' },
  { key: 'rs12m', label: 'RS 12か月' },
  { key: 'epsRating', label: 'EPS評価' },
  { key: 'ibdGroupRank', label: '業種順位' },
];

const TECH_FILTERS = [
  { key: 'perfDay', label: '前日比' },
  { key: 'perfWeek', label: '1週間騰落' },
  { key: 'perfMonth', label: '1か月騰落' },
  { key: 'perf3m', label: '3か月騰落' },
  { key: 'perf6m', label: '6か月騰落' },
  { key: 'gapPercent', label: '窓開け' },
  { key: 'volumeSurge', label: '出来高増加率', suffix: 'x' },
  { key: 'ema10Distance', label: '10日指数平均から' },
  { key: 'ema20Distance', label: '20日指数平均から' },
  { key: 'ema50Distance', label: '50日指数平均から' },
  { key: 'week52HighDistance', label: '52週高値から' },
  { key: 'week52LowDistance', label: '52週安値から' },
  { key: 'beta', label: 'ベータ' },
  { key: 'betaAdjRs', label: 'ベータ調整RS' },
  { key: 'seDistanceToPivot', label: 'ピボット比' },
  { key: 'seBbSqueeze', label: '収縮度' },
  { key: 'seVolumeVs50d', label: '出来高50日比', suffix: 'x' },
  { key: 'seUpDownVolume', label: '上昇日対下落日の出来高比', suffix: 'x' },
];

function hasRangeValue(range) {
  return Boolean(range && (range.min != null || range.max != null));
}

function formatRangeLabel(range, { minPrefix = '≥', maxPrefix = '≤', suffix = '' } = {}) {
  const minStr = range?.min != null ? `${minPrefix}${range.min}${suffix}` : '';
  const maxStr = range?.max != null ? `${maxPrefix}${range.max}${suffix}` : '';
  return `${minStr}${minStr && maxStr ? ', ' : ''}${maxStr}`;
}

export function isFilterActive(filters, key) {
  const value = filters[key];
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'boolean') return true;
  if (typeof value === 'object') {
    if ('min' in value || 'max' in value) {
      return value.min != null || value.max != null;
    }
    if ('values' in value) {
      return value.values?.length > 0;
    }
  }
  return true;
}

export function countActiveInCategory(filters, keys) {
  return keys.filter((key) => isFilterActive(filters, key)).length;
}

export function buildActiveFilters(filters) {
  const active = [];

  if (filters.symbolSearch) {
    active.push({ key: 'symbolSearch', label: `銘柄: ${filters.symbolSearch}` });
  }
  if (filters.stage != null) {
    active.push({ key: 'stage', label: `段階: ${filters.stage}` });
  }
  if (filters.ratings?.length) {
    active.push({ key: 'ratings', label: `補助評価: ${filters.ratings.join(', ')}` });
  }
  if (filters.ibdIndustries?.values?.length) {
    const modeLabel = filters.ibdIndustries.mode === 'exclude' ? '（除外）' : '';
    active.push({ key: 'ibdIndustries', label: `IBD業種${modeLabel}: ${filters.ibdIndustries.values.length}件選択` });
  }
  if (filters.gicsSectors?.values?.length) {
    const modeLabel = filters.gicsSectors.mode === 'exclude' ? '（除外）' : '';
    active.push({ key: 'gicsSectors', label: `業種${modeLabel}: ${filters.gicsSectors.values.length}件選択` });
  }
  if (filters.minVolume != null) {
    const volLabel = VOLUME_OPTIONS.find((option) => option.value === filters.minVolume)?.label || `>${filters.minVolume}`;
    active.push({ key: 'minVolume', label: `売買代金: ${volLabel}` });
  }
  if (filters.minMarketCap != null) {
    const capLabel = MARKET_CAP_OPTIONS.find((option) => option.value === filters.minMarketCap)?.label || `>${filters.minMarketCap}`;
    active.push({ key: 'minMarketCap', label: `時価総額: ${capLabel}` });
  }
  if (filters.ipoAfter) {
    active.push({ key: 'ipoAfter', label: `IPO: >${filters.ipoAfter.toUpperCase()}` });
  }

  for (const { key, label } of SCORE_FILTERS) {
    const range = filters[key];
    if (hasRangeValue(range)) {
      active.push({ key, label: `${label}: ${formatRangeLabel(range)}` });
    }
  }

  for (const { key, label } of RS_FILTERS) {
    const range = filters[key];
    if (hasRangeValue(range)) {
      active.push({ key, label: `${label}: ${formatRangeLabel(range)}` });
    }
  }

  if (hasRangeValue(filters.price)) {
    const { min, max } = filters.price;
    active.push({
      key: 'price',
      label: `株価: ${min != null ? `≥$${min}` : ''}${max != null ? ` ≤$${max}` : ''}`,
    });
  }
  if (hasRangeValue(filters.adrPercent)) {
    const { min, max } = filters.adrPercent;
    active.push({
      key: 'adrPercent',
      label: `ADR: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
    });
  }
  if (hasRangeValue(filters.epsGrowth)) {
    const { min, max } = filters.epsGrowth;
    active.push({
      key: 'epsGrowth',
      label: `EPS: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
    });
  }
  if (hasRangeValue(filters.salesGrowth)) {
    const { min, max } = filters.salesGrowth;
    active.push({
      key: 'salesGrowth',
      label: `売上成長: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
    });
  }

  if (hasRangeValue(filters.vcpScore)) {
    const { min, max } = filters.vcpScore;
    active.push({
      key: 'vcpScore',
      label: `VCP点: ${min != null ? `≥${min}` : ''}${max != null ? ` ≤${max}` : ''}`,
    });
  }
  if (hasRangeValue(filters.vcpPivot)) {
    const { min, max } = filters.vcpPivot;
    active.push({
      key: 'vcpPivot',
      label: `VCPピボット: ${min != null ? `≥$${min}` : ''}${max != null ? ` ≤$${max}` : ''}`,
    });
  }

  if (filters.vcpDetected != null) {
    active.push({ key: 'vcpDetected', label: `VCP: ${filters.vcpDetected ? 'あり' : 'なし'}` });
  }
  if (filters.vcpReady != null) {
    active.push({ key: 'vcpReady', label: `VCP準備: ${filters.vcpReady ? 'あり' : 'なし'}` });
  }
  if (filters.maAlignment != null) {
    active.push({ key: 'maAlignment', label: `移動平均整列: ${filters.maAlignment ? 'あり' : 'なし'}` });
  }
  if (filters.passesTemplate != null) {
    active.push({ key: 'passesTemplate', label: `条件通過: ${filters.passesTemplate ? 'あり' : 'なし'}` });
  }
  if (filters.code33 != null) {
    active.push({ key: 'code33', label: `業績加速（3期）: ${filters.code33 ? 'あり' : 'なし'}` });
  }
  if (filters.seSetupReady != null) {
    active.push({ key: 'seSetupReady', label: `準備条件: ${filters.seSetupReady ? 'あり' : 'なし'}` });
  }
  if (filters.seRsLineNewHigh != null) {
    active.push({ key: 'seRsLineNewHigh', label: `RS新高値: ${filters.seRsLineNewHigh ? 'あり' : 'なし'}` });
  }
  if (filters.seRsLineBlueDot != null) {
    active.push({ key: 'seRsLineBlueDot', label: `RS先行高値: ${filters.seRsLineBlueDot ? 'あり' : 'なし'}` });
  }
  if (filters.pocketPivot != null) {
    active.push({ key: 'pocketPivot', label: `ポケットピボット: ${filters.pocketPivot ? 'あり' : 'なし'}` });
  }
  if (filters.powerTrend != null) {
    active.push({ key: 'powerTrend', label: `強い上昇トレンド: ${filters.powerTrend ? 'あり' : 'なし'}` });
  }
  if (filters.sePatternPrimary?.length) {
    active.push({ key: 'sePatternPrimary', label: `パターン: ${filters.sePatternPrimary.length}件選択` });
  }

  for (const { key, label, suffix = '%' } of TECH_FILTERS) {
    const range = filters[key];
    if (hasRangeValue(range)) {
      active.push({
        key,
        label: `${label}: ${formatRangeLabel(range, { suffix })}`,
      });
    }
  }

  return active;
}

export function resetFilterValue(key) {
  if (key === 'symbolSearch') {
    return '';
  }
  if (NULL_RESET_KEYS.has(key)) {
    return null;
  }
  if (ARRAY_RESET_KEYS.has(key)) {
    return [];
  }
  if (MODED_MULTI_RESET_KEYS.has(key)) {
    return { values: [], mode: 'include' };
  }
  if (BOOLEAN_RESET_KEYS.has(key)) {
    return null;
  }
  return { min: null, max: null };
}
