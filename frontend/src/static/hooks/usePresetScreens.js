import { useMemo, useState } from 'react';
import { applyScanFilterDefaults } from '../../features/scan/defaultFilters';
import { filterStaticScanRows } from '../scanClient';

export function buildFiltersFromPreset(screen) {
  return applyScanFilterDefaults(screen?.filters ?? {});
}

export function usePresetScreens({
  screens,
  allRows,
  hydrationComplete,
}) {
  const [activeScreenId, setActiveScreenId] = useState(null);

  const matchCounts = useMemo(() => {
    if (!hydrationComplete || !screens?.length) return {};
    return Object.fromEntries(
      screens.map((s) => {
        const matched = filterStaticScanRows(allRows, buildFiltersFromPreset(s)).length;
        // Capped screens (e.g. "IBD 50") report the capped count so the chip
        // reads like the editorial leaderboard rather than the raw match total.
        const count = s.limit ? Math.min(matched, s.limit) : matched;
        return [s.id, count];
      }),
    );
  }, [allRows, hydrationComplete, screens]);

  return { activeScreenId, setActiveScreenId, matchCounts };
}
