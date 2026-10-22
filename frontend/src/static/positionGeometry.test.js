import { describe,it,expect } from 'vitest';
import { meterGeometry,gaugeGeometry,radarGeometry,money,signed,formatPrice } from './positionGeometry';
describe('design-target geometry, without decision changes',()=>{
 it('clips a meter without replacing missing values with zero',()=>{expect(meterGeometry(null).price).toBeNull();expect(meterGeometry(-40).price).toBe(4);expect(meterGeometry(0).pivot).toBe(56);expect(meterGeometry(40).clipped).toBe(true);});
 it('uses actual method buy limit and stop example',()=>{const g=gaugeGeometry({pivot:100,upper:103,price:102,distance:2,stopExample:94.86});expect(g.upper).toBeCloseTo(65);expect(g.stop).toBeCloseTo(24.3);expect(gaugeGeometry({pivot:null})).toBeNull();});
 it('ports the broken radar axis and excludes unavailable coordinates',()=>{const g=radarGeometry([{distance:null,rs:90},{distance:0,rs:90,volume:1,state:'zone'}]);expect(g.points).toHaveLength(1);expect((g.x(10)-g.left)/g.pw).toBeCloseTo(.84);expect(g.x(25)).toBe(g.left+g.pw);expect(g.y(100)).toBe(g.top);});
 it('formats numeric meaning consistently',()=>{expect(signed(-2)).toBe('−2.0%');expect(signed(0)).toBe('±0.0%');expect(money(null)).toBe('—');expect(money(1200)).toBe('$1,200.00');});
});

it('keeps shared currency formatting identical for rounding, signed zero and extreme values',()=>{
 for(const value of [0,-0,.005,-.005,1234.567,-1234.567,Number.MIN_VALUE,Number.MAX_VALUE,NaN,Infinity,null,undefined,'42']) {
  expect(money(value)).toBe(Number.isFinite(value)?`$${value.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}`:'—');
 }
});

it.each([
 [31.9 * 1.05, '33.50'], [1.005, '1.01'], [2.675, '2.68'],
 [-1.005, '-1.01'], [-2.675, '-2.68'], [1234.567, '1,234.57'],
 [0, '0.00'], [-0, '-0.00'], [null, '—'], [undefined, '—'],
 [NaN, '—'], [Infinity, '—'], [-Infinity, '—'], ['42', '—'],
])('uses the same display rounding with and without currency for %s', (value, expected) => {
 expect(formatPrice(value)).toBe(expected);
 expect(money(value)).toBe(Number.isFinite(value) ? `$${expected}` : '—');
});
