import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { candidatePerformance } from '../src/static/candidatePerformance.js';
import { auditDailyBars } from '../src/static/qualificationAudit.js';

export function performanceBenchmarkInputs(prices, asOf) {
  const current = prices?.as_of_date === asOf && prices?.calendar === 'NYSE' && prices?.adjustment === 'split-adjusted-close-no-dividend';
  // A price series is not an exchange calendar: deriving sessions from SPY
  // silently compresses any missing benchmark bar into a longer horizon.
  return { benchmark: current ? { verified: true, bars: prices.series?.SPY || [] } : null,
    sessions: current && Array.isArray(prices.sessions) ? prices.sessions : [] };
}

export async function exportCandidatePerformance({ root, snapshots, rows, prices, entry, manifest }) {
  const eligible = new Set(snapshots.flatMap(snapshot => snapshot.records.filter(record => record.liquid === true && Object.values(record.methods || {}).some(method => method.state === 'pass')).map(record => record.symbol)));
  const stocks = new Map();
  for (const row of rows) if (eligible.has(row.symbol) && row.chart_path && row.technical_audit?.valid === true) {
    const path = resolve(root, row.chart_path);
    if (!path.startsWith(resolve(root) + sep)) throw Error('Invalid performance chart path');
    try {
      const payload = JSON.parse(await readFile(path, 'utf8'));
      const audit = auditDailyBars(row, payload, entry.as_of_date);
      if (audit.valid) stocks.set(row.symbol, { verified: true, bars: payload.bars.map(({ date, close }) => ({ date, close })) });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const { benchmark, sessions } = performanceBenchmarkInputs(prices, entry.as_of_date);
  const data = { ...candidatePerformance({ snapshots, asOf: entry.as_of_date, sessions, stocks, benchmark }), generated_at: manifest.generated_at,
    source: { candidate_history: 'previously-published-catalog', prices: 'current independently verified daily chart payloads', benchmark: prices?.source || null },
    history_first_as_of: snapshots[0]?.as_of || null };
  const raw = JSON.stringify(data), sha256 = createHash('sha256').update(raw).digest('hex'), path = `candidate-performance-${sha256.slice(0, 16)}.json`;
  await writeFile(resolve(root, path), raw);
  entry.assets.candidate_performance = { path, sha256, as_of_date: entry.as_of_date };
  return data;
}
