import { recordProfileDiagnostic } from './profile-diagnostic.mjs';
import { summarizeContinuousSwitch } from './continuous-switch-summary.mjs';

// Supplementary evidence only. Start profiling before navigation,
// then retain the original ready/two-frame/click/two-frame sequence without a
// profiler restart or deliberate settling interval at the switch boundary.
export async function recordContinuousSwitchDiagnostic({ cdp, page, output, url, readySelector, visible, width }) {
  const name = `diagnostic-continuous-${width}`;
  let phases;
  try {
    const result = await recordProfileDiagnostic({ cdp, page, output, name, settleMs: 500, action: async () => {
      await page.goto(url);
      await visible(page.locator(readySelector));
      await page.evaluate(prefix => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const snapshot = phase => {
          const label = `${prefix}:${phase}`;
          performance.mark(label);
          return { label, time_origin: performance.timeOrigin, now: performance.now(),
            selected_symbol: document.querySelector('.candidate-row[aria-current="true"] .candidate-name strong')?.textContent || null };
        };
        // This mark is the last browser task before requesting Playwright's click;
        // locator/actionability work remains inside the diagnostic switch span.
        const evidence = { candidate_ready: snapshot('candidate-ready') };
        window.__continuousSwitchDiagnostic = evidence;
        const clicked = event => {
          const button = event.target?.closest?.('.method-tabs button');
          if (!button || !/^オニール/.test(button.textContent || '')) return;
          evidence.click_dispatch = snapshot('click-dispatch');
          document.removeEventListener('click', clicked, true);
        };
        document.addEventListener('click', clicked, true);
        window.__continuousSwitchCleanup = () => document.removeEventListener('click', clicked, true);
        resolve();
      }))), name);
      await page.getByRole('button', { name: /^オニール/, exact: false }).click();
      phases = await page.evaluate(prefix => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => {
        const label = `${prefix}:switch-endpoint`;
        performance.mark(label);
        resolve({ ...window.__continuousSwitchDiagnostic,
          switch_endpoint: { label, time_origin: performance.timeOrigin, now: performance.now(),
            selected_symbol: document.querySelector('.candidate-row[aria-current="true"] .candidate-name strong')?.textContent || null } });
        delete window.__continuousSwitchDiagnostic;
      }))), name);
      if (!phases?.click_dispatch) throw Error('Continuous diagnostic missed method click');
    } });
    return { ...result, continuous_switch: phases,
      continuous_switch_summary: summarizeContinuousSwitch(phases, result.observations) };
  } finally {
    // Outside the recorded endpoint; also release the listener if clicking fails.
    await page.evaluate(() => {
      window.__continuousSwitchCleanup?.();
      delete window.__continuousSwitchCleanup;
      delete window.__continuousSwitchDiagnostic;
    }).catch(() => {});
  }
}
