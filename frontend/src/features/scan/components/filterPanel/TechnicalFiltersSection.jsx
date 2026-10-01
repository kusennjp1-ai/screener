import { Grid } from '@mui/material';
import {
  CompactRangeInput,
  CompactSelect,
  CompactCheckbox,
  FilterSection,
} from '../../../../components/Scan/filters';
import { STAGE_OPTIONS } from './constants';

function TechnicalFiltersSection({
  filters,
  updateFilter,
  updateRangeFilter,
  activeCount,
  defaultExpanded,
}) {
  return (
    <FilterSection
      title="テクニカル"
      category="technical"
      activeCount={activeCount}
      defaultExpanded={defaultExpanded}
    >
      <Grid container spacing={1.5}>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="ADR %"
            minValue={filters.adrPercent?.min}
            maxValue={filters.adrPercent?.max}
            onChange={(range) => updateRangeFilter('adrPercent', range)}
            step={0.5}
            minLimit={0}
            suffix="%"
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1.5}>
          <CompactSelect
            label="段階"
            value={filters.stage}
            options={STAGE_OPTIONS}
            onChange={(value) => updateFilter('stage', value)}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="RS推計"
            minValue={filters.rsRating?.min}
            maxValue={filters.rsRating?.max}
            onChange={(range) => updateRangeFilter('rsRating', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="RS 1か月"
            minValue={filters.rs1m?.min}
            maxValue={filters.rs1m?.max}
            onChange={(range) => updateRangeFilter('rs1m', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="RS 3か月"
            minValue={filters.rs3m?.min}
            maxValue={filters.rs3m?.max}
            onChange={(range) => updateRangeFilter('rs3m', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="RS 12か月"
            minValue={filters.rs12m?.min}
            maxValue={filters.rs12m?.max}
            onChange={(range) => updateRangeFilter('rs12m', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="ベータ"
            minValue={filters.beta?.min}
            maxValue={filters.beta?.max}
            onChange={(range) => updateRangeFilter('beta', range)}
            step={0.1}
            minLimit={0}
            maxLimit={5}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="ベータ調整RS"
            minValue={filters.betaAdjRs?.min}
            maxValue={filters.betaAdjRs?.max}
            onChange={(range) => updateRangeFilter('betaAdjRs', range)}
            step={5}
            minLimit={0}
            maxLimit={100}
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="移動平均整列"
            value={filters.maAlignment}
            onChange={(value) => updateFilter('maAlignment', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="ポケットピボット"
            value={filters.pocketPivot}
            onChange={(value) => updateFilter('pocketPivot', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1}>
          <CompactCheckbox
            label="強い上昇トレンド"
            value={filters.powerTrend}
            onChange={(value) => updateFilter('powerTrend', value)}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="前日比 %"
            minValue={filters.perfDay?.min}
            maxValue={filters.perfDay?.max}
            onChange={(range) => updateRangeFilter('perfDay', range)}
            step={1}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="1週間騰落 %"
            minValue={filters.perfWeek?.min}
            maxValue={filters.perfWeek?.max}
            onChange={(range) => updateRangeFilter('perfWeek', range)}
            step={1}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="1か月騰落 %"
            minValue={filters.perfMonth?.min}
            maxValue={filters.perfMonth?.max}
            onChange={(range) => updateRangeFilter('perfMonth', range)}
            step={1}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="3か月騰落 %"
            minValue={filters.perf3m?.min}
            maxValue={filters.perf3m?.max}
            onChange={(range) => updateRangeFilter('perf3m', range)}
            step={5}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="6か月騰落 %"
            minValue={filters.perf6m?.min}
            maxValue={filters.perf6m?.max}
            onChange={(range) => updateRangeFilter('perf6m', range)}
            step={10}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="窓開け %"
            minValue={filters.gapPercent?.min}
            maxValue={filters.gapPercent?.max}
            onChange={(range) => updateRangeFilter('gapPercent', range)}
            step={1}
            suffix="%"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="出来高増加率"
            minValue={filters.volumeSurge?.min}
            maxValue={filters.volumeSurge?.max}
            onChange={(range) => updateRangeFilter('volumeSurge', range)}
            step={0.5}
            minLimit={0}
            suffix="x"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="10日指数平均から %"
            minValue={filters.ema10Distance?.min}
            maxValue={filters.ema10Distance?.max}
            onChange={(range) => updateRangeFilter('ema10Distance', range)}
            step={1}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="20日指数平均から %"
            minValue={filters.ema20Distance?.min}
            maxValue={filters.ema20Distance?.max}
            onChange={(range) => updateRangeFilter('ema20Distance', range)}
            step={1}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="50日指数平均から %"
            minValue={filters.ema50Distance?.min}
            maxValue={filters.ema50Distance?.max}
            onChange={(range) => updateRangeFilter('ema50Distance', range)}
            step={1}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="52週高値から %"
            minValue={filters.week52HighDistance?.min}
            maxValue={filters.week52HighDistance?.max}
            onChange={(range) => updateRangeFilter('week52HighDistance', range)}
            step={1}
            suffix="%"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="52週安値から %"
            minValue={filters.week52LowDistance?.min}
            maxValue={filters.week52LowDistance?.max}
            onChange={(range) => updateRangeFilter('week52LowDistance', range)}
            step={1}
            suffix="%"
          />
        </Grid>
      </Grid>
    </FilterSection>
  );
}

export default TechnicalFiltersSection;
