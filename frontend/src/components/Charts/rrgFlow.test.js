import { describe, it, expect } from 'vitest';
import { computeFlows, groupAtFrame, maxFrames, pointQuadrant } from './rrgFlow';

const g = (name, tail) => ({
  industry_group: name,
  quadrant: 'Leading',
  current: { x: tail[tail.length - 1].x, y: tail[tail.length - 1].y },
  tail,
});

describe('rrgFlow', () => {
  it('pointQuadrant maps the four quadrants around 100/100', () => {
    expect(pointQuadrant(101, 101)).toBe('Leading');
    expect(pointQuadrant(101, 99)).toBe('Weakening');
    expect(pointQuadrant(99, 101)).toBe('Improving');
    expect(pointQuadrant(99, 99)).toBe('Lagging');
  });

  it('maxFrames is the longest tail', () => {
    const groups = [g('A', [{ x: 100, y: 100 }]), g('B', [{ x: 99, y: 99 }, { x: 100, y: 100 }])];
    expect(maxFrames(groups)).toBe(2);
  });

  it('groupAtFrame slices the tail and recomputes the head + quadrant', () => {
    const grp = g('Tech', [
      { x: 98, y: 98, date: '2026-06-01' },
      { x: 99, y: 101, date: '2026-06-08' },
      { x: 102, y: 103, date: '2026-06-15' },
    ]);
    const at1 = groupAtFrame(grp, 1);
    expect(at1.tail).toHaveLength(2);
    expect(at1.current.x).toBe(99);
    expect(at1.current.date).toBe('2026-06-08');
    expect(at1.quadrant).toBe('Improving'); // 99/101, not the live 'Leading'
    // frame == null (live) and over-long frames are safe
    expect(groupAtFrame(grp, null)).toBe(grp);
    expect(groupAtFrame(grp, 99).current.x).toBe(102);
  });

  it('computeFlows ranks northeast movers as inflow and southwest as outflow', () => {
    const groups = [
      g('Tech', [{ x: 99, y: 99 }, { x: 102, y: 102 }]),     // +6 -> strongest inflow
      g('Energy', [{ x: 100, y: 100 }, { x: 101, y: 100.5 }]), // +1.5 inflow
      g('Utilities', [{ x: 101, y: 101 }, { x: 99, y: 98 }]),  // -5 -> strongest outflow
      g('Flat', [{ x: 100, y: 100 }, { x: 100, y: 100 }]),     // 0 -> neither list
    ];
    const flows = computeFlows(groups, null);
    expect(flows.inflow.map((f) => f.name)).toEqual(['Tech', 'Energy']);
    expect(flows.inflow[0].score).toBeCloseTo(6);
    expect(flows.outflow.map((f) => f.name)).toEqual(['Utilities']);
    expect(flows.outflow[0].score).toBeCloseTo(-5);
  });

  it('computeFlows at a playback frame uses the movement INTO that frame', () => {
    const groups = [g('Tech', [
      { x: 100, y: 100 },
      { x: 104, y: 104 },  // frame 1: +8 in
      { x: 101, y: 101 },  // frame 2: -6 out
    ])];
    expect(computeFlows(groups, 1).inflow[0].score).toBeCloseTo(8);
    expect(computeFlows(groups, 2).outflow[0].score).toBeCloseTo(-6);
    expect(computeFlows(groups, 0)).toEqual({ inflow: [], outflow: [] }); // needs 2 points
  });
});
