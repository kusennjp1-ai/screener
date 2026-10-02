import { expect, it } from 'vitest';
import { verifiedVolumeRatio } from './qualificationAudit';
import { withAuditFixture } from './testAuditFixture';

const date='2026-09-29';
it('uses verified preceding-session volume rather than conflicting legacy copies',()=>{
 const row=withAuditFixture({symbol:'VOL',current_price:100,se_volume_vs_50d:3,entry_evidence:{volumeRatio:2}},date);
 row.technical_audit.values.volumeRatio=1.39;
 expect(verifiedVolumeRatio(row,date)).toBe(1.39);
 expect(verifiedVolumeRatio(row,'2026-09-30')).toBeNull();
});
it.each([null,undefined,'2',NaN,Infinity,-1])('keeps invalid ratio %j unknown',value=>{
 const row=withAuditFixture({symbol:'VOL',current_price:100},date);row.technical_audit.values.volumeRatio=value;
 expect(verifiedVolumeRatio(row,date)).toBeNull();
});
it('requires identity- and price-matched audit evidence, including an actual analysis date',()=>{
 const row=withAuditFixture({symbol:'VOL',current_price:100},date);
 expect(verifiedVolumeRatio(row)).toBeNull();
 expect(verifiedVolumeRatio(null,date)).toBeNull();
 row.technical_audit.values.close=101;
 expect(verifiedVolumeRatio(row,date)).toBeNull();
});
