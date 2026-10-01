import { useQuery } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { loadResearchBundle } from './researchWorkerClient';

export function useResearchBundle(path, date, version) {
  return useQuery({
    queryKey: ['researchRows', path, version], enabled: Boolean(path),
    placeholderData: () => undefined, staleTime: Infinity, structuralSharing: false,
    queryFn: ({ signal }) => loadResearchBundle(path, date, fetchStaticJson, signal),
  });
}
