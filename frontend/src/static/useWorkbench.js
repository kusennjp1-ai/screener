import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { validateWorkbenchSummary, validateWorkbenchDetails } from './workbenchSummary';

export function useWorkbench(entry) {
  const detailsRef = entry?.assets?.workbench;
  const summaryRef = entry?.assets?.workbench_summary;
  const ref = summaryRef || detailsRef;
  const asOf = entry?.as_of_date, researchPath = entry?.assets?.research?.path;
  const select = useCallback(value => validateWorkbenchSummary(value, ref, detailsRef, asOf, researchPath, Boolean(summaryRef)), [ref, detailsRef, asOf, researchPath, summaryRef]);
  const query = useQuery({
    queryKey: ['workbench-summary', ref?.path, ref?.sha256, ref?.snapshot_id, asOf],
    enabled: Boolean(ref?.path), staleTime: Infinity, placeholderData: () => undefined,
    queryFn: () => fetchStaticJson(ref.path, { sha256: ref.sha256, worker: summaryRef ? true : 'workbench-summary' }),
    select,
  });
  // React Query may retain the last selected value when select rejects a new
  // response. A failed identity check must not expose that preceding result.
  return query.isError ? { ...query, data: undefined } : query;
}

export function useWorkbenchDetails(summaryQuery, enabled) {
  const summary = summaryQuery.data, ref = summary?.details;
  const select = useCallback(value => validateWorkbenchDetails(value, summary), [summary]);
  const query = useQuery({
    queryKey: ['workbench-details', ref?.path, ref?.sha256, ref?.snapshot_id, summary?.as_of],
    enabled: Boolean(enabled && !summaryQuery.isError && ref?.path),
    staleTime: Infinity, placeholderData: () => undefined,
    queryFn: () => fetchStaticJson(ref.path, { sha256: ref.sha256, worker: 'workbench' }),
    select,
  });
  // An invalid/new overview can never leave the preceding day's details visible.
  return summaryQuery.isError ? { ...query, data: undefined, isError: true, error: summaryQuery.error } : query.isError ? { ...query, data: undefined } : query;
}
