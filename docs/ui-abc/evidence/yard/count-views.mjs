// SCRATCH: count the matrix's views per mode (needs the fixture; run from the worktree's frontend dir via node --import? no: plain).
import { loadStates } from './states.mjs';
const fx = await import(process.argv[2]);
const S = await loadStates(fx);
const modes = {}; for (const v of S.views) for (const m of v.modes) modes[m] = (modes[m] || 0) + 1;
console.log(JSON.stringify({ views: S.views.length, modes, shots: S.views.filter(v => v.shot).length, kinds: S.views.reduce((a, v) => ({ ...a, [v.kind]: (a[v.kind] || 0) + 1 }), {}) }));
