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
  it('does not count raw composite ratings as current preset matches', () => {
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

    expect(result.current.matchCounts.ibd50).toBe(0);
  });

  it('does not count raw composite ratings when no preset limit is set', () => {
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

    expect(result.current.matchCounts.ibd_composite).toBe(0);
  });

  it('preserves capped and uncapped counts for technical-only presets', () => {
    const rows = [98, 97, 96, 95].map(makeRow);
    const screens = [
      { id: 'capped', limit: 3, filters: { rsRating: { min: 85 }, ibdGroupRank: { max: 60 } } },
      { id: 'uncapped', filters: { rsRating: { min: 85 }, week52HighDistance: { min: -15 } } },
    ];
    const { result } = renderHook(() => usePresetScreens({ screens, allRows: rows, hydrationComplete: true }));
    expect(result.current.matchCounts).toEqual({ capped: 3, uncapped: 4 });
  });

  it('preserves rating filter keys when building preset filters', () => {
    const filters = buildFiltersFromPreset({
      filters: { compositeRating: { min: 95, max: null } },
    });
    expect(filters.compositeRating).toEqual({ min: 95, max: null });
  });
});
