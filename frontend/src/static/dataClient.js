import { projectFinancialPayload } from './financialCurrent';
import { useQuery } from '@tanstack/react-query';
import { STATIC_DEFAULT_MARKET } from './StaticMarketContext';
import { runDataWorker } from './researchWorkerClient';
import { summarizeWorkbench } from './workbenchSummary';
import { loadStaticManifest, publicationForManifest, publicationQueryIdentity, readStaticPayload, resolveStaticPublication } from './staticPublication';

export const fetchStaticJson = async (relativePath, { sha256, worker = false, now, asOfDate, market, publication, generation, signal } = {}) => {
  if (relativePath === 'manifest.json') return loadStaticManifest();
  const pinned = await resolveStaticPublication({ publication, generation });
  const currentAsset = /(?:^|\/)(?:research-details\/|verified-charts\/|charts\/|scan\/|scan-list\/|groups\.json$|home\.json$)/.test(relativePath);
  const project = value => currentAsset ? projectFinancialPayload(value,{now:now === undefined?Date.now():now,asOfDate,market}) : value;
  const useWorker = worker && typeof Worker !== 'undefined';
  const value = useWorker
    ? await runDataWorker({ operation: ['workbench', 'workbench-summary'].includes(worker) ? worker : 'json', path: relativePath, publication: pinned, sha256 }, signal)
    : await readStaticPayload(relativePath, { publication: pinned, sha256, signal });
  return !useWorker && worker === 'workbench-summary' ? summarizeWorkbench(value) : project(value);
};

export const useStaticManifest = () => useQuery({
  queryKey: ['staticManifest'],
  structuralSharing: false,
  queryFn: () => fetchStaticJson('manifest.json'),
  staleTime: 60000,
  refetchInterval: 60000,
  gcTime: Infinity,
});

export const useStaticGroupsRRG = (marketEntry) => {
  const path = marketEntry?.assets?.groups_rrg?.path;
  return useQuery({
    queryKey: ['staticGroupsRRG', path, publicationQueryIdentity(marketEntry?.publication)],
    placeholderData: () => undefined,
    queryFn: () => fetchStaticJson(path, { publication: marketEntry.publication }),
    enabled: Boolean(path),
    staleTime: Infinity,
    gcTime: Infinity,
  });
};

export const getStaticSupportedMarkets = (manifest) => {
  if (Array.isArray(manifest?.supported_markets) && manifest.supported_markets.length > 0) {
    return manifest.supported_markets;
  }
  if (manifest?.default_market) {
    return [manifest.default_market];
  }
  return [STATIC_DEFAULT_MARKET];
};

export const resolveStaticMarketEntry = (manifest, selectedMarket) => {
  const defaultMarket = String(manifest?.default_market || STATIC_DEFAULT_MARKET).toUpperCase();
  const supportedMarkets = getStaticSupportedMarkets(manifest).map((market) => String(market).toUpperCase());
  const normalizedMarket = String(selectedMarket || defaultMarket).toUpperCase();
  const resolvedMarket = supportedMarkets.includes(normalizedMarket) ? normalizedMarket : defaultMarket;
  const marketEntry = manifest?.markets?.[resolvedMarket];

  if (marketEntry) {
    return {
      market: resolvedMarket,
      publication: publicationForManifest(manifest),
      display_name: marketEntry.display_name || resolvedMarket,
      as_of_date: marketEntry.as_of_date || manifest?.as_of_date || null,
      features: marketEntry.features || {},
      pages: marketEntry.pages || {},
      assets: marketEntry.assets || {},
      freshness: marketEntry.freshness || {},
    };
  }

  return {
    market: resolvedMarket,
    publication: publicationForManifest(manifest),
    display_name: resolvedMarket,
    as_of_date: manifest?.as_of_date || null,
    features: manifest?.features || {},
    pages: manifest?.pages || {},
    assets: manifest?.assets || {},
    freshness: manifest?.freshness || {},
  };
};
