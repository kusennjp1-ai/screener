import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { StateChip } from './EntryCard';
afterEach(cleanup);
it.each([
 ['判定不可','? 判定不可'],
 ['低変動・監視のみ','≈ 低変動・監視のみ'],
 ['買収合意・対象外','⊘ 買収合意・対象外'],
])('keeps neutral status %s readable on its tinted surface without changing state', (state,label)=>{
 render(<StateChip state={state}/>);
 const chip=screen.getByText(label);
 expect(chip.style.color).toBe('var(--text-2)');
 expect(chip.style.getPropertyValue('--state-tone')).toBe('var(--neutral)');
});
it('retains the non-neutral state tone and glyph',()=>{
 render(<StateChip state="買いゾーン内"/>);
 const chip=screen.getByText('● 買いゾーン内');
 expect(chip.style.color).toBe('');
 expect(chip.style.getPropertyValue('--state-tone')).toBe('var(--zone)');
});
