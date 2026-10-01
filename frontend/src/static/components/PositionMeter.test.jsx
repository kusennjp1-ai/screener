import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import PositionMeter from './PositionMeter';

afterEach(cleanup);
it('keeps buy-zone geometry, clipped prices, missing markers and accessible labels',()=>{
 const {rerender,container}=render(<PositionMeter plan={{distance:2,zone:5,state:'買いゾーン内'}}/>);
 const svg=screen.getByRole('img');
 expect(svg).toHaveAccessibleName('ピボット比 +2.0%。買いゾーン内');
 expect([...svg.children].map(element=>element.tagName)).toEqual(['path','rect','path','circle']);
 expect(svg.querySelector('rect')).toHaveAttribute('width','26');
 expect(svg.querySelector('circle')).toHaveAttribute('cx','66.4');
 expect(svg.querySelector('circle')).toHaveAttribute('fill','var(--zone)');
 rerender(<PositionMeter plan={{distance:-20,zone:3,state:'ピボット待ち'}}/>);
 expect(svg.querySelector('rect')).toHaveAttribute('width','15.600000000000009');
 expect(svg.querySelector('circle')).toHaveAttribute('cx','4');
 expect(svg).toHaveAccessibleName(/目盛り範囲外/);
 rerender(<PositionMeter plan={{distance:null,state:'" onload="alert(1)'}}/>);
 expect(svg.querySelector('circle')).toBeNull();
 expect(svg).toHaveAccessibleName('ピボット比 —。判定不可');
 expect(container.querySelector('[onload]')).toBeNull();
});
