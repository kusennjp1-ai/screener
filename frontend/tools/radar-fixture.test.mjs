import { expect, it } from 'vitest';
import fixture from './fixtures/radar-207-2026-09-29.json';
import { entryPlan } from '../src/static/researchEngine.js';
import { radarGeometry } from '../src/static/positionGeometry.js';

it('uses 207 distinct observed, qualified and drawable points without padding missing data', () => {
  expect(fixture.as_of_date).toBe('2026-09-29');
  expect(fixture.source_sha256).toMatch(/^[0-9a-f]{64}$/);
  expect(fixture.ranked).toHaveLength(207);
  expect(new Set(fixture.ranked.map(item => item.row.symbol)).size).toBe(207);
  expect(fixture.ranked.every(item => item.assessment.qualified)).toBe(true);
  const points = fixture.ranked.map(({ row }) => ({ ...row, rs: row.rs_rating, distance: entryPlan(row).distance }));
  expect(points.every(point => Number.isFinite(point.distance) && Number.isFinite(point.rs))).toBe(true);
  expect(radarGeometry(points).points).toHaveLength(207);
});
