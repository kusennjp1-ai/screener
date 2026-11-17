#!/usr/bin/env node
// SCRATCH (ui-abc yardstick, never committed): the phrase scan of plan §5.3 over a values run (every text line, SVG text,
// pair, accessible name and dock line/name of every matrix view, closed and opened; the first fold's wrapped lines are not scanned).
//   node phrases.mjs scan <valuesDir>            → <valuesDir>/phrases.json (rule → sorted [{ text, views }]) + phrases.sha256
//   node phrases.mjs diff <baseDir> <sliceDir>   → FAIL on every (rule, text) hit the slice has and the base has not
// The rules are the plan's, unwidened. Hits on main are main's baseline (reported, not hidden): e.g. 「独自計算」 (the plan
// card's ADR line, StockPlanCard.jsx:179) is a 「独自」 not followed by 判定/設定/集計/定義, which the plan's rule flags.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const sha = text => createHash('sha256').update(text).digest('hex');
export const RULES = [
  ['please', /してください/],
  ['recommend', /推奨(?!ではありません)/],
  ['buyTime', /買い時/],
  ['rightNow', /今すぐ/],
  ['entry', /エントリー/],
  ['conditionCount', /条件中/],
  ['asciiMinus', /(?<![0-9A-Za-z])-\d/],
  ['bareDokuji', /独自(?!判定|設定|集計|定義)/],
];
function scan(dir) {
  const values = JSON.parse(readFileSync(`${dir}/values.json`, 'utf8'));
  const hits = Object.fromEntries(RULES.map(([name]) => [name, new Map()]));
  for (const [key, record] of Object.entries(values)) {
    const texts = [];
    for (const part of ['closed', 'opened']) for (const section of ['lines', 'svg', 'pairs', 'names', 'dock']) for (const [text] of record[part]?.[section] || []) texts.push(text);
    // The first fold is not scanned: its lines are visual lines, cut where the text wraps (「…（独自判」 / 「定）」), and every
    // fold string is also in the closed lines, which are scanned whole.
    for (const text of new Set(texts)) for (const [name, re] of RULES) if (re.test(text)) {
      const m = hits[name]; if (!m.has(text)) m.set(text, new Set()); m.get(text).add(key);
    }
  }
  const out = Object.fromEntries(Object.entries(hits).map(([name, m]) => [name, [...m].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([text, views]) => ({ text, views: views.size, first: [...views].sort()[0] }))]));
  const text = JSON.stringify(out, null, 1) + '\n';
  writeFileSync(`${dir}/phrases.json`, text);
  writeFileSync(`${dir}/phrases.sha256`, `${sha(text)}  phrases.json\n`);
  console.log(`${sha(text)}  phrases.json`);
  for (const [name, list] of Object.entries(out)) console.log(`${name}: ${list.length} distinct texts${list.length ? `; e.g. 「${list[0].text.slice(0, 80)}」 (${list[0].views} views)` : ''}`);
  return out;
}
const [, , cmd, a, b] = process.argv;
if (cmd === 'scan') scan(a);
else if (cmd === 'diff') {
  const A = JSON.parse(readFileSync(`${a}/phrases.json`, 'utf8')), B = JSON.parse(readFileSync(`${b}/phrases.json`, 'utf8'));
  let fails = 0;
  for (const [name, list] of Object.entries(B)) {
    const known = new Set((A[name] || []).map(h => h.text));
    for (const h of list) if (!known.has(h.text)) { fails++; console.log(`FAIL\t${name}\t${h.views} views (e.g. ${h.first})\t${h.text}`); }
    for (const h of A[name] || []) if (!list.some(x => x.text === h.text)) console.log(`gone\t${name}\t${h.text}`);
  }
  console.log(JSON.stringify({ new_hits: fails }));
  process.exit(fails ? 1 : 0);
} else { console.error('usage: phrases.mjs scan <valuesDir> | diff <baseDir> <sliceDir>'); process.exit(2); }
