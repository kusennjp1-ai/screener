import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import PositionMeter from './PositionMeter';

afterEach(()=>{cleanup();vi.restoreAllMocks();});
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

it('updates only changed attributes without parsing or replacing its SVG subtree',()=>{
 const parse=vi.spyOn(Element.prototype,'innerHTML','set');
 const {container,rerender}=render(<PositionMeter plan={{distance:2,zone:5,state:'買いゾーン内'}}/>);
 const svg=screen.getByRole('img'),children=[...svg.children],circle=svg.querySelector('circle');
 expect(parse).not.toHaveBeenCalled();
 const attributes=vi.spyOn(Element.prototype,'setAttribute');
 rerender(<PositionMeter plan={{distance:2,zone:5,state:'買いゾーン内',unrelated:'new readiness'}}/>);
 expect(attributes).not.toHaveBeenCalled();
 rerender(<PositionMeter plan={{distance:3,zone:3,state:'買いゾーン超過'}}/>);
 expect([...svg.children]).toEqual(children);
 expect(svg.querySelector('circle')).toBe(circle);
 expect(circle).toHaveAttribute('cx','71.60000000000001');
 expect(circle).toHaveAttribute('fill','var(--ext)');
 expect(svg.querySelector('rect')).toHaveAttribute('width','15.600000000000009');
 expect(parse).not.toHaveBeenCalled();
 rerender(<PositionMeter plan={{distance:null,zone:3,state:'未判定'}}/>);
 expect(svg.querySelector('circle')).toBeNull();
 expect([...svg.children]).toEqual(children.slice(0,3));
 expect(container.querySelectorAll('svg')).toHaveLength(1);
});
