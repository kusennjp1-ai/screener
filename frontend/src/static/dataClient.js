import { projectFinancialPayload } from './financialCurrent';
import { useQuery } from '@tanstack/react-query';
import { getStaticDataUrl } from '../config/runtimeMode';
import { STATIC_DEFAULT_MARKET } from './StaticMarketContext';
import { runDataWorker } from './researchWorkerClient';
import { summarizeWorkbench } from './workbenchSummary';

export const fetchStaticJson = async (relativePath, { sha256, worker = false, now, asOfDate, market } = {}) => {
  const currentAsset = /(?:^|\/)(?:research-details\/|verified-charts\/|charts\/|scan\/|scan-list\/|groups\.json$|home\.json$)/.test(relativePath);
  const project = value => currentAsset ? projectFinancialPayload(value,{now:now === undefined?Date.now():now,asOfDate,market}) : value;
  if (worker && typeof Worker !== 'undefined') return project(await runDataWorker({ operation: ['workbench', 'workbench-summary'].includes(worker) ? worker : 'json', url: new URL(getStaticDataUrl(relativePath), location.href).href, sha256 }));
  const response = await fetch(getStaticDataUrl(relativePath), {
    cache: /(?:index|chunk|workbench(?:-summary)?|research-details\/[^/]+|verified-charts\/[^/]+)-[a-f0-9]{16}\.json$/.test(relativePath) ? 'default' : 'no-cache',
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load static data: ${relativePath} (${response.status})`);
  }

  if (sha256) {
    const raw=await response.text();
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw));
    const actual=[...new Uint8Array(digest)].map(b=>b.toString(16).padStart(2,'0')).join('');
    if(actual!==sha256) throw new Error('Static asset integrity mismatch');
    const value = JSON.parse(raw);
    return worker === 'workbench-summary' ? summarizeWorkbench(value) : project(value);
  }
  const value = await response.json();
  return worker === 'workbench-summary' ? summarizeWorkbench(value) : project(value);
};

export const useStaticManifest = () => useQuery({
  queryKey: ['staticManifest'],
  queryFn: () => fetchStaticJson('manifest.json'),
  staleTime: 60000,
  refetchInterval: 60000,
  gcTime: Infinity,
});

export const useStaticGroupsRRG = (marketEntry) => {
  const path = marketEntry?.assets?.groups_rrg?.path;
  return useQuery({
    queryKey: ['staticGroupsRRG', path],
    queryFn: () => fetchStaticJson(path),
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
    display_name: resolvedMarket,
    as_of_date: manifest?.as_of_date || null,
    features: manifest?.features || {},
    pages: manifest?.pages || {},
    assets: manifest?.assets || {},
    freshness: manifest?.freshness || {},
  };
};
