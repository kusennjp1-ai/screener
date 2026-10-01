import { describe,it,expect } from 'vitest';
import { patternLabel,sectorLabel } from './scanLabels';
import { industryLabel } from './industryLabels';
describe('scan display translations preserve raw classifications',()=>{
 it('maps exact sector aliases without changing category membership',()=>{ expect(sectorLabel('Financial')).toBe('金融');expect(sectorLabel('Financial Services')).toBe('金融');expect(sectorLabel(null)).toBe('分類未確認'); });
 it('explains pattern identifiers and keeps unknown shapes unconfirmed',()=>{expect(patternLabel('cup_with_handle')).toBe('カップ・ウィズ・ハンドル');expect(patternLabel(null)).toBe('—');expect(patternLabel('invented')).toBe('分類未対応');});
 it('distinguishes nearby provider industry codes',()=>{expect(industryLabel('Elec-Semicondctor Fablss')).toBe('半導体・設計専業');expect(industryLabel('Elec-Semiconductor Mfg')).toBe('半導体製造');expect(industryLabel('Group not available')).toBe('分類未確認');});
});
