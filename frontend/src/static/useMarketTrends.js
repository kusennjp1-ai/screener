import { useQuery } from '@tanstack/react-query';
import { fetchStaticJson } from './dataClient';
import { publicationQueryIdentity } from './staticPublication';
import { readMarketTrends } from './marketTrendAsset';
export function useMarketTrends(marketEntry){
 const ref=marketEntry.assets?.market_trends;
 const valid=ref?.schema_version==='market-trends-v1'&&ref.market==='US'&&ref.as_of_date===marketEntry.as_of_date&&/^[a-f0-9]{64}$/.test(ref.sha256||'')&&ref.path===`market-trends/series-${ref.sha256}.json`;
 const query=useQuery({queryKey:['marketTrends',ref?.sha256,marketEntry.as_of_date,publicationQueryIdentity(marketEntry.publication)],queryFn:async({signal})=>readMarketTrends(await fetchStaticJson(ref.path,{sha256:ref.sha256,publication:marketEntry.publication,signal}),marketEntry),enabled:Boolean(valid),staleTime:Infinity,placeholderData:()=>undefined});
 return {...query,loading:Boolean(valid)&&query.isLoading,error:Boolean(ref)&&(!valid||query.isError)};
}
