import { useQuery } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { projectFinancialPayload } from './financialCurrent';

export const staticChartKeys = {
  index: (path) => ['staticChartsIndex', path],
  payload: (symbol, path) => ['staticChartsPayload', symbol, path],
};

export const useStaticChartIndex = (path, enabled = true) => useQuery({
  queryKey: staticChartKeys.index(path),
  queryFn: () => fetchStaticJson(path),
  enabled: Boolean(path) && enabled,
  staleTime: Infinity,
  gcTime: Infinity,
});

export const fetchStaticChartPayload = async (path, { now, asOfDate, market } = {}) => {
  const payload = await fetchStaticJson(path, {now,asOfDate,market});
  return projectFinancialPayload(payload, { now: now === undefined ? Date.now() : now, asOfDate, market });
};
