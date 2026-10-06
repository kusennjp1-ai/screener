import { publicationQueryIdentity } from './staticPublication';
import { useQuery } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { projectFinancialPayload } from './financialCurrent';

export const staticChartKeys = {
  index: (path) => ['staticChartsIndex', path],
  payload: (symbol, path) => ['staticChartsPayload', symbol, path],
};

export const useStaticChartIndex = (path, enabled = true, publication) => useQuery({
  queryKey: [...staticChartKeys.index(path), ...(publication ? [publicationQueryIdentity(publication)] : [])],
  queryFn: () => fetchStaticJson(path, { publication }),
  enabled: Boolean(path) && enabled,
  placeholderData: () => undefined,
  staleTime: Infinity,
  gcTime: Infinity,
});

export const fetchStaticChartPayload = async (path, { now, asOfDate, market, ...transport } = {}) => {
  const payload = await fetchStaticJson(path, {now,asOfDate,market,...transport});
  return projectFinancialPayload(payload, { now: now === undefined ? Date.now() : now, asOfDate, market });
};
