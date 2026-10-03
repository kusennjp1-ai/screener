import { cleanup, render } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import SetupRadar from './SetupRadar';
import fixture from '../../../tools/fixtures/radar-207-2026-09-29.json';
import { radarAttributionElement } from '../../../tools/radar-attribution-cases';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it.each([false, true])('uses the exact Radar frame without mounting its canvas lifecycle (mobile=%s)', small => {
  const context = vi.spyOn(HTMLCanvasElement.prototype, 'getContext');
  const mount = vi.spyOn(SetupRadar.prototype, 'componentDidMount');
  const expected = new SetupRadar({ ranked: fixture.ranked, small }).render();
  const element = radarAttributionElement('prepared-frame', fixture.ranked, small);
  const { container } = render(element);
  expect(element.props.dangerouslySetInnerHTML).toEqual(expected.props.dangerouslySetInnerHTML);
  expect(container.querySelector('canvas')).toHaveAccessibleName(/207銘柄/);
  expect(container.querySelector('canvas')).not.toHaveAttribute('data-radar-point-count');
  expect(context).not.toHaveBeenCalled();
  expect(mount).not.toHaveBeenCalled();
});

it('uses the real production component only for the full control and rejects unknown modes', () => {
  const element = radarAttributionElement('full-radar', fixture.ranked, true);
  expect(element.type).toBe(SetupRadar);
  expect(element.props.ranked).toBe(fixture.ranked);
  expect(element.props.small).toBe(true);
  expect(radarAttributionElement('empty-root', fixture.ranked, false)).toBeNull();
  expect(() => radarAttributionElement('warm-radar', fixture.ranked, false)).toThrow('Unknown radar attribution mode');
});
