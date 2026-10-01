import { describe,it,expect } from 'vitest';
import { meterGeometry,gaugeGeometry,radarGeometry,money,signed } from './positionGeometry';
describe('design-target geometry, without decision changes',()=>{
 it('clips a meter without replacing missing values with zero',()=>{expect(meterGeometry(null).price).toBeNull();expect(meterGeometry(-40).price).toBe(4);expect(meterGeometry(0).pivot).toBe(56);expect(meterGeometry(40).clipped).toBe(true);});
 it('uses actual method buy limit and stop example',()=>{const g=gaugeGeometry({pivot:100,upper:103,price:102,distance:2,stopExample:94.86});expect(g.upper).toBeCloseTo(65);expect(g.stop).toBeCloseTo(24.3);expect(gaugeGeometry({pivot:null})).toBeNull();});
 it('ports the broken radar axis and excludes unavailable coordinates',()=>{const g=radarGeometry([{distance:null,rs:90},{distance:0,rs:90,volume:1,state:'zone'}]);expect(g.points).toHaveLength(1);expect((g.x(10)-g.left)/g.pw).toBeCloseTo(.84);expect(g.x(25)).toBe(g.left+g.pw);expect(g.y(100)).toBe(g.top);});
 it('formats numeric meaning consistently',()=>{expect(signed(-2)).toBe('−2.0%');expect(signed(0)).toBe('±0.0%');expect(money(null)).toBe('—');expect(money(1200)).toBe('$1,200.00');});
});
