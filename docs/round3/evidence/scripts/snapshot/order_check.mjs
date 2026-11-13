// Cross-check the rebuild's ranking against the one ordered list the CI log prints: report-data-coverage's
// fundamentalsCoverage `symbols` = [minervini top-50, minervini2 top-50 (research-daily candidates), briefRows], deduped;
// its unknown_symbols are the first 25 of those with Code 33 unknown (order kept).
import { readFileSync } from 'node:fs';
const [,, BUNDLE, WORK] = process.argv;
const m = await import(BUNDLE);
const NOW = Date.parse('2026-11-13T10:14:12Z'), DATE = '2026-11-12';
const evals = readFileSync(`${WORK}/eval-proxy.jsonl`, 'utf8').trim().split('\n').map(l => JSON.parse(l));
const rows = evals.map(e => ({ ...e.row, technical_audit: e.technical_audit }));
const cands = method => m.engine.rankCandidates(rows, method, { liquidOnly: true, now: NOW }).filter(r => r.assessment.qualified).slice(0, 50).map(r => r.row.symbol);
const audit = { as_of_date: DATE, results: rows.map(r => ({ symbol: r.symbol, methods: { minervini: m.engine.assess(r, 'minervini', NOW) } })) };
const mm = cands('minervini'), m2 = cands('minervini2');
const symbols = [...new Set([...mm, ...m2, ...m.briefRows(audit, DATE)])];
const published = 'BMO MFC CUBI HMC PBA TD JHX EMBJ GKOS BRZE FROG HNGE SONY BNS APA RAL GFR TBBB JAKK CPAC MEOH BSRR PFIS TRNS CHMG'.split(' ');
const pos = published.map(s => [s, symbols.indexOf(s), mm.indexOf(s), m2.indexOf(s)]);
console.log(JSON.stringify(pos));
let inversions = 0; for (let i = 1; i < pos.length; i++) if (pos[i][1] < pos[i - 1][1]) inversions++;
console.log('positions ascending except', inversions, 'adjacent inversions; minervini top-50 head:', mm.slice(0, 12).join(' '));
