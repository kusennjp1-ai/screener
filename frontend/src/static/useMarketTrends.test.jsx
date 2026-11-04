import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildMarketTrends } from '../../tools/export-market-trends.mjs';
import { fetchStaticJson } from './dataClient';
import { useMarketTrends } from './useMarketTrends';

vi.mock('./dataClient',()=>({fetchStaticJson:vi.fn()}));
afterEach(()=>{vi.clearAllMocks();});
const date='2026-10-23',sha256='a'.repeat(64);
const entry={as_of_date:date,publication:null,assets:{market_trends:{schema_version:'market-trends-v1',market:'US',as_of_date:date,sha256,path:`market-trends/series-${sha256}.json`}}};
const payload=()=>{
 const value=buildMarketTrends(JSON.parse(readFileSync(resolve('data/market-trend-source-2026-10-23.json'),'utf8')),{asOfDate:date});
 value.long_history={...JSON.parse(readFileSync(resolve('data/market-history-source-2026-10-23.json'),'utf8')),source_sha256:sha256};
 return value;
};
const render=()=>{
 const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
 return renderHook(()=>useMarketTrends(entry),{wrapper:({children})=><QueryClientProvider client={client}>{children}</QueryClientProvider>});
};

it('keeps distribution days and follow-through when only the long history fails validation',async()=>{
 const value=payload();value.long_history.breadth[0].ratio_10day=1;fetchStaticJson.mockResolvedValue(value);
 const hook=render();
 await waitFor(()=>expect(hook.result.current.data).toBeDefined());
 const {data,loading,error}=hook.result.current;
 expect(loading).toBe(false);expect(error).toBe(false);
 expect(data.long_history).toBeUndefined();expect(data.long_history_error).toMatch(/^長期市場履歴の整合性を確認できない/);
 expect(data.indices.map(index=>[index.latest.value,index.followThrough.state])).toEqual([[5,'confirmed'],[3,'no_correction']]);
 expect(fetchStaticJson).toHaveBeenCalledWith(entry.assets.market_trends.path,expect.objectContaining({sha256}));
});

it('does not withdraw a published long history because the device clock is behind its retrieval',async()=>{
 const value=payload(),behind=Date.parse(value.long_history.retrieved_at)-86400000;fetchStaticJson.mockResolvedValue(value);
 const now=vi.spyOn(Date,'now').mockReturnValue(behind);
 try{
  const hook=render();
  await waitFor(()=>expect(hook.result.current.data).toBeDefined());
  expect(hook.result.current.data.long_history.as_of_date).toBe(date);expect(hook.result.current.data.long_history_error).toBeUndefined();
 }finally{now.mockRestore();}
});
