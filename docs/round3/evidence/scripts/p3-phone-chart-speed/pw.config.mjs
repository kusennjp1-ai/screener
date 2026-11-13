// SCRATCH (audit3 p3): Playwright config for the timing and per-stock specs. CI-faithful browser (Chrome for Testing 147
// headless shell; run with FONTCONFIG_FILE=…/ci-fonts/fonts.conf). The builds are served by scripts/serve.mjs on 4414.
export default {
  testDir: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p3-phone-chart-speed/scripts',
  testMatch: new RegExp(process.env.P3_MATCH || 'timing\\.spec\\.mjs'),
  outputDir: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit3/p3-phone-chart-speed/timing/test-results',
  workers: 1, timeout: 60 * 60 * 1000, reporter: 'line',
  use: { trace: 'off', launchOptions: { executablePath: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/cft147/chrome-headless-shell-linux64/chrome-headless-shell' } },
};
