// @vitest-environment jsdom
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { recordProfileDiagnostic } from './profile-diagnostic.mjs';
import { recordContinuousSwitchDiagnostic } from './continuous-switch-diagnostic.mjs';
vi.mock('./profile-diagnostic.mjs', () => ({ recordProfileDiagnostic: vi.fn() }));
let calls, frames, page, visible;
beforeEach(() => {
  calls = []; frames = 0;
  vi.stubGlobal('requestAnimationFrame', callback => { frames++; queueMicrotask(() => callback(0)); return frames; });
  document.body.innerHTML = '<div class="method-tabs"><button>オニール</button></div><button class="candidate-row" aria-current="true"><span class="candidate-name"><strong>OLD</strong></span></button>';
  page = {
    goto: vi.fn(async url => calls.push(['goto', url])),
    locator: vi.fn(selector => selector),
    evaluate: vi.fn(async (fn, arg) => fn(arg)),
    getByRole: vi.fn(() => ({ click: vi.fn(async () => {
      calls.push(['click', frames]);
      document.querySelector('.method-tabs button').dispatchEvent(new MouseEvent('click', { bubbles: true }));
      document.querySelector('strong').textContent = 'NEW';
    }) })),
  };
  visible = vi.fn(async selector => calls.push(['visible', selector]));
  recordProfileDiagnostic.mockImplementation(async options => {
    calls.push(['profile-start']);
    await options.action();
    calls.push(['profile-end']);
    return { name: options.name, acceptance_measurement: false };
  });
});
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); document.body.innerHTML = ''; });
const run = () => recordContinuousSwitchDiagnostic({ cdp:{}, page, output:'/unused', url:'http://fixture/', readySelector:'.candidate-row', visible, width:1440 });
it('records navigation and immediate switch in one profile with the same two-frame boundaries', async () => {
  const result = await run();
  expect(calls).toEqual([['profile-start'], ['goto','http://fixture/'], ['visible','.candidate-row'], ['click',2], ['profile-end']]);
  expect(frames).toBe(4);
  expect(recordProfileDiagnostic).toHaveBeenCalledTimes(1);
  expect(recordProfileDiagnostic.mock.calls[0][0]).toMatchObject({ name:'diagnostic-continuous-1440', settleMs:500 });
  expect(page.getByRole).toHaveBeenCalledWith('button', { name:/^オニール/, exact:false });
  expect(result.acceptance_measurement).toBe(false);
  expect(result.continuous_switch.candidate_ready.selected_symbol).toBe('OLD');
  expect(result.continuous_switch.click_dispatch.selected_symbol).toBe('OLD');
  expect(result.continuous_switch.switch_endpoint.selected_symbol).toBe('NEW');
  expect(result.continuous_switch.click_dispatch.label).toBe('diagnostic-continuous-1440:click-dispatch');
  expect(window.__continuousSwitchDiagnostic).toBeUndefined();
  expect(window.__continuousSwitchCleanup).toBeUndefined();
});
it('releases diagnostic-only listeners and propagates click failure without changing gates', async () => {
  page.getByRole.mockReturnValue({click:async()=>{throw Error('Click failed');}});
  const remove = vi.spyOn(document, 'removeEventListener');
  await expect(run()).rejects.toThrow('Click failed');
  expect(remove).toHaveBeenCalledWith('click', expect.any(Function), true);
  expect(window.__continuousSwitchDiagnostic).toBeUndefined();
  expect(window.__continuousSwitchCleanup).toBeUndefined();
  remove.mockRestore();
});
it('rejects a missing dispatch witness instead of treating it as complete evidence', async () => {
  page.getByRole.mockReturnValue({ click:async()=>{} });
  await expect(run()).rejects.toThrow('Continuous diagnostic missed method click');
  expect(window.__continuousSwitchCleanup).toBeUndefined();
});
it('runs only in the supplementary post-measurement diagnostic block', () => {
  const source = readFileSync('tools/design-review.mjs', 'utf8');
  expect(source.indexOf('await recordContinuousSwitchDiagnostic(')).toBeGreaterThan(source.indexOf('if (label === \'current\' && runs.some'));
  expect(source.match(/await recordContinuousSwitchDiagnostic\(/g)).toHaveLength(1);
  expect(source).toContain('for (let repetition = 0; repetition < 3; repetition++)');
  expect(source).toContain('const switchStart = Date.now(); await method.click();');
  expect(source).toContain('const switchMs = Date.now() - switchStart;');
});
