import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { loadResearchBundle, refreshResearchBundle } from './researchWorkerClient';
import { researchBundleCurrent } from './researchPreprocess';
import { useFinancialClock } from './useFinancialClock';

export function useResearchBundle(path, date, version) {
  const client = useQueryClient();
  const epoch = useRef(0);
  const query = useQuery({
    queryKey: ['researchRows', path, version], enabled: Boolean(path),
    placeholderData: () => undefined, staleTime: Infinity, structuralSharing: false,
    queryFn: ({ signal }) => loadResearchBundle(path, date, fetchStaticJson, signal, { now:Date.now(), generation:version ?? null, evaluationEpoch:++epoch.current }),
  });
  const now = useFinancialClock(query.data?.rows);
  const current = researchBundleCurrent(query.data, now, version ?? null);
  useEffect(() => {
    if (!query.data || current) return;
    const previous = query.data, evaluationEpoch = ++epoch.current;
    const controller = new AbortController();
    const key = ['researchRows', path, version];
    refreshResearchBundle(previous.rows, date, { now, generation:version ?? null, evaluationEpoch, signal:controller.signal }).then(next => {
      if (!controller.signal.aborted && evaluationEpoch === epoch.current && client.getQueryData(key) === previous) client.setQueryData(key, next);
    }).catch(error => { if (error.name !== 'AbortError' && !controller.signal.aborted) client.invalidateQueries({queryKey:key,exact:true}); });
    return () => controller.abort();
  }, [query.data, current, path, date, version, now, client]);
  // Expired decisions are withheld together while the next worker epoch builds.
  return { ...query, data: current ? query.data : undefined, isLoading:query.isLoading || Boolean(query.data && !current), evaluating:Boolean(query.data && !current), evaluatedNow:now };
}
