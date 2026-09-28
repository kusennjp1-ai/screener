import {it,expect,vi,afterEach} from 'vitest';
import {probeInstitutionalAccess} from './finnhubEntitlement';
afterEach(()=>vi.unstubAllGlobals());
it('does not treat a forbidden endpoint as empty ownership',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({status:403,ok:false})));
  expect((await probeInstitutionalAccess('fixture-key','AMD','007903107')).state).toBe('denied');
});
it('does not call a provider without the personal key',async()=>{
  const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
  expect((await probeInstitutionalAccess('','AMD','007903107')).state).toBe('disconnected');expect(fetcher).not.toHaveBeenCalled();
});
it('empty historical response is not a verified zero',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>({status:200,ok:true,json:async()=>({data:[]})})));
  expect((await probeInstitutionalAccess('fixture-key','AMD','007903107')).state).toBe('empty');
});
