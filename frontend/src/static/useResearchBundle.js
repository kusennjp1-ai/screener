import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { loadResearchBundle, refreshResearchBundle } from './researchWorkerClient';
import { researchBundleCurrent, validResearchEvaluation } from './researchPreprocess';
import { useFinancialDeadlineClock } from './useFinancialClock';

export function useResearchBundle(path, date, version) {
  const client = useQueryClient();
  const epoch = useRef(0);
  const query = useQuery({
    queryKey: ['researchRows', path, version], enabled: Boolean(path),
    placeholderData: () => undefined, staleTime: Infinity, structuralSharing: false,
    queryFn: ({ signal }) => loadResearchBundle(path, date, fetchStaticJson, signal, { now:Date.now(), generation:version ?? null, evaluationEpoch:++epoch.current }),
  });
  // Worker completion binds this validated deadline to the requested snapshot,
  // generation and evaluation epoch. Re-scanning its cloned rows here would
  // repeat full-universe financial projection on the main thread.
  const next = validResearchEvaluation(query.data) ? query.data.next_expiry_at : null;
  const now = useFinancialDeadlineClock(next);
  // An absent manifest date is not a mismatch: the producer/receipt still
  // validates the loaded bundle's own date before it can become current.
  const current = researchBundleCurrent(query.data, now, version ?? null) && (date == null || query.data.date === date);
  const observedClock = useRef({ now, rollbackEpoch: 0 });
  const rollbackEpoch = observedClock.current.rollbackEpoch + (now < observedClock.current.now ? 1 : 0);
  useEffect(() => {
    // Commit clock observations without changing state on every forward tick.
    observedClock.current = { now, rollbackEpoch };
  }, [now, rollbackEpoch]);
  useEffect(() => {
    if (!query.data || current) return;
    const key = ['researchRows', path, version];
    if (date != null && query.data.date !== date) {
      // The same path/generation must never make a different snapshot's cached
      // rows eligible. Fetch that date instead of preparing the previous rows.
      client.invalidateQueries({queryKey:key,exact:true});
      return;
    }
    const previous = query.data, evaluationEpoch = ++epoch.current;
    const controller = new AbortController();
    // Sample once when this source needs evaluation. Typing/quotes/forward
    // focus renders must not repeatedly cancel the same pending worker; a
    // genuine clock rollback still starts a new evaluation epoch.
    refreshResearchBundle(previous.rows, date ?? previous.date, { now:Date.now(), generation:version ?? null, evaluationEpoch, signal:controller.signal }).then(next => {
      if (!controller.signal.aborted && evaluationEpoch === epoch.current && client.getQueryData(key) === previous) client.setQueryData(key, next);
    }).catch(error => { if (error.name !== 'AbortError' && !controller.signal.aborted) client.invalidateQueries({queryKey:key,exact:true}); });
    return () => controller.abort();
  }, [query.data, current, path, date, version, rollbackEpoch, client]);
  // Expired decisions are withheld together while the next worker epoch builds.
  return { ...query, data: current ? query.data : undefined, isLoading:query.isLoading || Boolean(query.data && !current), evaluating:Boolean(query.data && !current), evaluatedNow:now };
}
