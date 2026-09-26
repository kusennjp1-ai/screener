import { expect,it } from 'vitest';
import { normalizeFinnhubQuote,normalizeFinnhubTrade,newerQuote } from './personalQuote';
import { quoteStatus } from './researchEngine';
const now=Date.parse('2026-09-25T19:00:00Z');
it('uses provider trade time, rejects wrong symbols and future/invalid prices',()=>{
 const quote=normalizeFinnhubQuote({c:101,t:now/1000},'NVDA',now);
 expect(quoteStatus(quote,now)).toBe('リアルタイム');
 expect(quoteStatus(quote,now+91000)).toBe('期限切れ');
 for(const payload of [{c:0,t:now/1000},{c:10,t:now/1000+10},{c:10,t:null}]) expect(normalizeFinnhubQuote(payload,'NVDA',now)).toBeNull();
 expect(normalizeFinnhubTrade({type:'trade',data:[{s:'MSFT',p:1,t:now}]},'NVDA',now)).toBeNull();
 const next=normalizeFinnhubTrade({type:'trade',data:[{s:'NVDA',p:102,t:now-1000},{s:'NVDA',p:103,t:now}]},'NVDA',now);
 expect(next.price).toBe(103);expect(newerQuote(next,{...quote,as_of:new Date(now-2000).toISOString()})).toBe(next);
});
