import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { buildFiltersFromPreset, usePresetScreens } from './usePresetScreens';

const makeRow = (composite) => ({
  symbol: `S${composite}`,
  composite_rating: composite,
  rs_rating: 90,
  ibd_group_rank: 10,
  week_52_high_distance: -5,
});

describe('usePresetScreens', () => {
  it('caps the match count to a preset limit', () => {
    // 8 rows clear the IBD-50 gates; the preset caps the reported count to 3.
    const rows = [98, 97, 96, 96, 95, 95, 95, 95].map(makeRow);
    const screens = [
      {
        id: 'ibd50',
        limit: 3,
        filters: {
          compositeRating: { min: 95, max: null },
          rsRating: { min: 85, max: null },
          ibdGroupRank: { min: null, max: 60 },
          week52HighDistance: { min: -15, max: null },
        },
      },
    ];

    const { result } = renderHook(() =>
      usePresetScreens({ screens, allRows: rows, hydrationComplete: true })
    );

    expect(result.current.matchCounts.ibd50).toBe(3);
  });

  it('reports the full match count when no limit is set', () => {
    const rows = [98, 97, 96].map(makeRow);
    const screens = [
      {
        id: 'ibd_composite',
        filters: { compositeRating: { min: 95, max: null } },
      },
    ];

    const { result } = renderHook(() =>
      usePresetScreens({ screens, allRows: rows, hydrationComplete: true })
    );

    expect(result.current.matchCounts.ibd_composite).toBe(3);
  });

  it('preserves rating filter keys when building preset filters', () => {
    const filters = buildFiltersFromPreset({
      filters: { compositeRating: { min: 95, max: null } },
    });
    expect(filters.compositeRating).toEqual({ min: 95, max: null });
  });
});
