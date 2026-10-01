import { Box, Divider, Grid, TextField, Typography } from '@mui/material';
import {
  CompactRangeInput,
  CompactSelect,
  CompactMultiSelect,
  FilterSection,
  IpoDateFilter,
} from '../../../../components/Scan/filters';
import { MARKET_CAP_OPTIONS, MARKET_OPTIONS, VOLUME_OPTIONS } from './constants';

function FundamentalFiltersSection({
  filters,
  filterOptions,
  updateFilter,
  updateRangeFilter,
  activeCount,
  defaultExpanded,
}) {
  return (
    <FilterSection
      title="財務"
      category="fundamental"
      activeCount={activeCount}
      defaultExpanded={defaultExpanded}
    >
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={1.5}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 0.5, fontSize: '12px' }}
            >
              銘柄
            </Typography>
            <TextField
              size="small"
              value={filters.symbolSearch || ''}
              onChange={(event) => updateFilter('symbolSearch', event.target.value)}
              placeholder="銘柄を検索"
              inputProps={{ 'aria-label': '銘柄の検索' }}
              sx={{
                width: '100%',
                '& .MuiOutlinedInput-root': { height: 28 },
                '& .MuiOutlinedInput-input': { padding: '4px 8px', fontSize: '0.75rem' },
              }}
            />
          </Box>
        </Grid>
        <Grid item xs={6} sm={3} md={1.5}>
          <CompactSelect
            label="時価総額（現地通貨）"
            value={filters.minMarketCap}
            options={MARKET_CAP_OPTIONS}
            onChange={(value) => updateFilter('minMarketCap', value)}
          />
        </Grid>
        <Grid item xs={6} sm={3} md={1.5}>
          <CompactSelect
            label="売買代金（現地通貨）"
            value={filters.minVolume}
            options={VOLUME_OPTIONS}
            onChange={(value) => updateFilter('minVolume', value)}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="株価"
            minValue={filters.price?.min}
            maxValue={filters.price?.max}
            onChange={(range) => updateRangeFilter('price', range)}
            step={1}
            minLimit={0}
            prefix="$"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="EPS成長"
            minValue={filters.epsGrowth?.min}
            maxValue={filters.epsGrowth?.max}
            onChange={(range) => updateRangeFilter('epsGrowth', range)}
            step={5}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="売上成長"
            minValue={filters.salesGrowth?.min}
            maxValue={filters.salesGrowth?.max}
            onChange={(range) => updateRangeFilter('salesGrowth', range)}
            step={5}
            suffix="%"
            minOnly
          />
        </Grid>
        <Grid item xs={6} sm={4} md={1.5}>
          <CompactRangeInput
            label="EPS評価"
            minValue={filters.epsRating?.min}
            maxValue={filters.epsRating?.max}
            onChange={(range) => updateRangeFilter('epsRating', range)}
            step={5}
            minLimit={0}
            maxLimit={99}
            minOnly
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.5}>
          <CompactMultiSelect
            label="IBD業種"
            values={filters.ibdIndustries?.values || []}
            options={filterOptions.ibdIndustries || []}
            onChange={(values) => updateFilter('ibdIndustries', { ...filters.ibdIndustries, values })}
            mode={filters.ibdIndustries?.mode || 'include'}
            onModeChange={(mode) => updateFilter('ibdIndustries', { ...filters.ibdIndustries, mode })}
            showModeToggle
          />
        </Grid>
        <Grid item xs={12} sm={6} md={2.5}>
          <CompactMultiSelect
            label="業種"
            values={filters.gicsSectors?.values || []}
            options={filterOptions.gicsSectors || []}
            onChange={(values) => updateFilter('gicsSectors', { ...filters.gicsSectors, values })}
            mode={filters.gicsSectors?.mode || 'include'}
            onModeChange={(mode) => updateFilter('gicsSectors', { ...filters.gicsSectors, mode })}
            showModeToggle
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <IpoDateFilter
            value={filters.ipoAfter}
            onChange={(value) => updateFilter('ipoAfter', value)}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 1.5 }} />
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: 'block', mb: 1, fontSize: '12px', textTransform: 'uppercase', letterSpacing: 0.5 }}
      >
        市場横断（米ドル換算）
      </Typography>
      <Grid container spacing={3}>
        <Grid item xs={12} sm={6} md={3}>
          <CompactMultiSelect
            label="市場"
            values={filters.markets || []}
            options={MARKET_OPTIONS}
            onChange={(values) => updateFilter('markets', values)}
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <CompactRangeInput
            label="時価総額（米ドル）"
            minValue={filters.marketCapUsd?.min}
            maxValue={filters.marketCapUsd?.max}
            onChange={(range) => updateRangeFilter('marketCapUsd', range)}
            step={100000000}
            minLimit={0}
            prefix="$"
          />
        </Grid>
        <Grid item xs={6} sm={4} md={2}>
          <CompactRangeInput
            label="平均売買代金（米ドル）"
            minValue={filters.advUsd?.min}
            maxValue={filters.advUsd?.max}
            onChange={(range) => updateRangeFilter('advUsd', range)}
            step={1000000}
            minLimit={0}
            prefix="$"
          />
        </Grid>
      </Grid>
    </FilterSection>
  );
}

export default FundamentalFiltersSection;
