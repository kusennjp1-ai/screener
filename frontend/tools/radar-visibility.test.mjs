import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { radarVisibilityWitness, RADAR_VISIBILITY_VERSION } from './radar-visibility.mjs';

let canvas, data, getImageData, geometry, styles;
beforeEach(() => {
  document.body.innerHTML = '<div class="leader-shell"><div class="radar-plot"><canvas></canvas></div></div>';
  canvas = document.querySelector('canvas'); canvas.width = 414; canvas.height = 2;
  geometry = { width: 207, height: 1, points: Array.from({ length: 207 }, (_, i) => ({ x: i + .5, y: .5 })) };
  data = new Uint8ClampedArray(canvas.width * canvas.height * 4);
  // A circle interior spans adjacent device pixels; include either side of a
  // subpixel center instead of depending on exact floating-point division.
  for (let i = 0; i < 414; i++) data[((canvas.width + i) * 4) + 3] = 153;
  getImageData = vi.fn(() => ({ width: canvas.width, height: canvas.height, data }));
  vi.spyOn(canvas, 'getContext').mockReturnValue({ getImageData });
  vi.spyOn(canvas, 'getBoundingClientRect').mockReturnValue({ left: 10, top: 10, width: 207, height: 1 });
  styles = new Map();
  vi.stubGlobal('getComputedStyle', node => ({ opacity: '1', display: 'block', visibility: 'visible', contentVisibility: 'visible', ...styles.get(node) }));
  vi.stubGlobal('innerWidth', 1000); vi.stubGlobal('innerHeight', 1000);
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: vi.fn(() => canvas) });
});
afterEach(() => { document.body.innerHTML = ''; delete document.elementFromPoint; vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('radar endpoint bitmap and CSS witness', () => {
  it('samples actual device pixels at all canonical point centers before any yield', () => {
    const reference = vi.fn(() => { expect(getImageData).toHaveBeenCalledOnce(); return geometry; });
    const result = radarVisibilityWitness(canvas, reference);
    expect(result).toMatchObject({ version: RADAR_VISIBILITY_VERSION, captured_in_endpoint_task: true,
      expected_points: 207, painted_point_centers: 207, unobscured_point_centers: 207, effective_opacity: 1, styles_visible: true, readback_error: null });
    expect(getImageData).toHaveBeenCalledWith(0, 0, 414, 2);
    expect(result.css_path.map(node => node.tag)).toEqual(['CANVAS', 'DIV', 'DIV', 'BODY', 'HTML']);
    expect(result.pixel_readback_ms).toBeGreaterThanOrEqual(0);
    expect(result.observation_ms).toBeGreaterThanOrEqual(result.pixel_readback_ms);
  });
  it.each([0, 135])('rejects an empty or grid-only bitmap with alpha %s', alpha => {
    for (let i = 3; i < data.length; i += 4) data[i] = alpha;
    expect(radarVisibilityWitness(canvas, () => geometry).painted_point_centers).toBe(0);
  });
  it('checks ancestor opacity and hidden styles even when the canvas contains all points', () => {
    styles.set(canvas.parentElement, { opacity: '0' });
    expect(radarVisibilityWitness(canvas, () => geometry)).toMatchObject({ painted_point_centers: 207, effective_opacity: 0 });
    styles.set(canvas.parentElement, { opacity: '.5' }); styles.set(document.body, { opacity: '.5' });
    expect(radarVisibilityWitness(canvas, () => geometry).effective_opacity).toBe(.25);
    for (const hidden of [{ display: 'none' }, { visibility: 'hidden' }, { contentVisibility: 'hidden' }]) {
      styles.set(document.body, hidden);
      expect(radarVisibilityWitness(canvas, () => geometry).styles_visible).toBe(false);
    }
  });
  it('rejects obscured or offscreen point centers', () => {
    document.elementFromPoint.mockReturnValue(document.body);
    expect(radarVisibilityWitness(canvas, () => geometry).unobscured_point_centers).toBe(0);
    document.elementFromPoint.mockReturnValue(canvas); vi.stubGlobal('innerWidth', 10);
    expect(radarVisibilityWitness(canvas, () => geometry).unobscured_point_centers).toBe(0);
  });
  it('fails closed when readback is unavailable', () => {
    getImageData.mockImplementation(() => { throw Error('tainted bitmap'); });
    expect(radarVisibilityWitness(canvas, () => geometry)).toMatchObject({ painted_point_centers: 0, readback_error: 'tainted bitmap' });
  });
  it('cannot turn blank or transparent endpoint evidence into readiness after later drawing', async () => {
    data.fill(0); styles.set(canvas.parentElement, { opacity: '0' });
    queueMicrotask(() => { data.fill(255); styles.clear(); });
    const result = radarVisibilityWitness(canvas, () => geometry);
    await Promise.resolve();
    expect(result).toMatchObject({ painted_point_centers: 0, effective_opacity: 0 });
    expect(getImageData).toHaveBeenCalledOnce();
  });
  it('takes evidence directly after the unchanged endpoint and leaves observation cost separate', () => {
    const entry = readFileSync('tools/radar-benchmark.jsx', 'utf8');
    const capture = entry.slice(entry.indexOf('const nextFrame ='), entry.indexOf('const visibility ='));
    expect(capture).toContain('performance.now() - start');
    expect(capture).not.toMatch(/await|requestAnimationFrame\(/);
    expect(entry).toContain('first_frame_ms: nextFrame, visibility');
  });
});
