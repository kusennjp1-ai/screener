import { Grid } from '@mui/material';
import {
  CompactRangeInput,
  CompactCheckbox,
  CompactMultiSelect,
  FilterSection,
} from '../../../../components/Scan/filters';
import { SE_PATTERN_OPTIONS } from './constants';

function RatingFiltersSection({
  filters,
  updateFilter,
  updateRangeFilter,
  activeCount,
  defaultExpanded,
}) {
  return (
    <FilterSection
      title="評価・スコア"
      category="rating"
      activeCount={activeCount}
      defaultExpanded={defaultExpanded}
    >
      <Grid container spacing={1.5}>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="補助スコア"
            minValue={filters.compositeScore?.min}
            maxValue={filters.compositeScore?.max}
            onChange={(range) => updateRangeFilter('compositeScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="ミネルヴィニ点"
            minValue={filters.minerviniScore?.min}
            maxValue={filters.minerviniScore?.max}
            onChange={(range) => updateRangeFilter('minerviniScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="CAN SLIM点"
            minValue={filters.canslimScore?.min}
            maxValue={filters.canslimScore?.max}
            onChange={(range) => updateRangeFilter('canslimScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="IPO"
            minValue={filters.ipoScore?.min}
            maxValue={filters.ipoScore?.max}
            onChange={(range) => updateRangeFilter('ipoScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="カスタム点"
            minValue={filters.customScore?.min}
            maxValue={filters.customScore?.max}
            onChange={(range) => updateRangeFilter('customScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="出来高ブレイク点"
            minValue={filters.volBreakthroughScore?.min}
            maxValue={filters.volBreakthroughScore?.max}
            onChange={(range) => updateRangeFilter('volBreakthroughScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="セットアップ点"
            minValue={filters.seSetupScore?.min}
            maxValue={filters.seSetupScore?.max}
            onChange={(range) => updateRangeFilter('seSetupScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="ピボット比"
            minValue={filters.seDistanceToPivot?.min}
            maxValue={filters.seDistanceToPivot?.max}
            onChange={(range) => updateRangeFilter('seDistanceToPivot', range)}
            step={1}
            suffix="%"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="収縮度"
            minValue={filters.seBbSqueeze?.min}
            maxValue={filters.seBbSqueeze?.max}
            onChange={(range) => updateRangeFilter('seBbSqueeze', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="出来高50日比"
            minValue={filters.seVolumeVs50d?.min}
            maxValue={filters.seVolumeVs50d?.max}
            onChange={(range) => updateRangeFilter('seVolumeVs50d', range)}
            step={0.5}
            minLimit={0}
            suffix="x"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="上昇日対下落日の出来高比"
            minValue={filters.seUpDownVolume?.min}
            maxValue={filters.seUpDownVolume?.max}
            onChange={(range) => updateRangeFilter('seUpDownVolume', range)}
            step={0.25}
            minLimit={0}
            suffix="x"
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="準備条件"
            value={filters.seSetupReady}
            onChange={(value) => updateFilter('seSetupReady', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="RS新高値"
            value={filters.seRsLineNewHigh}
            onChange={(value) => updateFilter('seRsLineNewHigh', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="RS先行高値"
            value={filters.seRsLineBlueDot}
            onChange={(value) => updateFilter('seRsLineBlueDot', value)}
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.4}>
          <CompactMultiSelect
            label="パターン"
            values={filters.sePatternPrimary || []}
            options={SE_PATTERN_OPTIONS}
            onChange={(values) => updateFilter('sePatternPrimary', values)}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.2}>
          <CompactRangeInput
            label="VCP点"
            minValue={filters.vcpScore?.min}
            maxValue={filters.vcpScore?.max}
            onChange={(range) => updateRangeFilter('vcpScore', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="VCP"
            value={filters.vcpDetected}
            onChange={(value) => updateFilter('vcpDetected', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="VCP準備"
            value={filters.vcpReady}
            onChange={(value) => updateFilter('vcpReady', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="条件通過"
            value={filters.passesTemplate}
            onChange={(value) => updateFilter('passesTemplate', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="業績加速（3期）"
            value={filters.code33}
            onChange={(value) => updateFilter('code33', value)}
          />
        </Grid>
      </Grid>
    </FilterSection>
  );
}

export default RatingFiltersSection;
