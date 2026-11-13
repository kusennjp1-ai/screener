// SCRATCH config (CI-faithful renders): Chrome for Testing 147 headless shell, run with FONTCONFIG_FILE=…/ci-fonts/fonts.conf, port 4440 only.
import base from '/home/user/screener/.claude/worktrees/r3-market-audit/frontend/playwright.static.config.js';
const W = '/home/user/screener/.claude/worktrees/r3-market-audit';
const R = '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/audit-market/inventory/render';
const PORT = 4440;
export default { ...base, testDir: R + '/spec', testMatch: /.*\.spec\.mjs/, outputDir: R + '/test-results', reporter: 'line', workers: 1,
  use: { ...base.use, baseURL: 'http://127.0.0.1:' + PORT, launchOptions: { executablePath: '/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad/cft147/chrome-headless-shell-linux64/chrome-headless-shell' } },
  webServer: { ...base.webServer, command: 'npm run dev -- --host 127.0.0.1 --port ' + PORT + ' --strictPort', url: 'http://127.0.0.1:' + PORT, cwd: W + '/frontend', reuseExistingServer: false } };
