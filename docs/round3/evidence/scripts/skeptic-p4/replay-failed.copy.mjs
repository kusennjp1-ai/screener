// Replay the failed-breakout check day by day on the certified bars, with today's pivot held fixed (the pivot on earlier
// days is not published here: 未検証). Shows the day the ▲ appears and the day it clears.
import { readFileSync } from 'node:fs';
const [,, BUNDLE, SERVE, ...SYMS] = process.argv;
const m = await import(BUNDLE);
const ev = new Map(readFileSync(process.env.EVAL, 'utf8').trim().split('\n').map(l => JSON.parse(l)).map(r => [r.symbol, r]));
for (const sym of SYMS) {
  const chart = JSON.parse(readFileSync(`${SERVE}/charts/${sym}.json`, 'utf8'));
  const pivot = ev.get(sym).pivot, bars = chart.bars, line = [];
  const from = process.env.FROM ? bars.findIndex(b => b.date >= process.env.FROM) + 1 : bars.length - 16;
  for (let k = from; k <= bars.length; k++) {
    const list = bars.slice(0, k), last = list.at(-1);
    const view = { pivot, distance: (last.close / pivot - 1) * 100, state: last.close >= pivot ? 'zone' : 'wait' };
    const s = m.sell.sellSignals(list, m.sell.SELL_RULES, { view });
    const fb = s?.weakness.find(c => c.key === 'failedBreakout');
    line.push(`${last.date.slice(5)} ${last.close.toFixed(2)} ${fb ? (fb.state === 'hit' ? '▲' : fb.state === 'clear' ? '·' : '?') : '-'}`);
  }
  console.log(sym, 'pivot', pivot, '\n  ' + line.join('\n  '));
}
