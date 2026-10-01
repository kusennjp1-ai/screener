import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { candidatePerformance } from '../src/static/candidatePerformance.js';
import { auditDailyBars } from '../src/static/qualificationAudit.js';

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
  const currentBenchmark = prices?.as_of_date === entry.as_of_date && prices?.calendar === 'NYSE' && prices?.adjustment === 'split-adjusted-close-no-dividend';
  const benchmark = currentBenchmark ? { verified: true, bars: prices.series?.SPY || [] } : null;
  const sessions = currentBenchmark ? prices.sessions || benchmark.bars.map(bar => bar.date) : [];
  const data = { ...candidatePerformance({ snapshots, asOf: entry.as_of_date, sessions, stocks, benchmark }), generated_at: manifest.generated_at,
    source: { candidate_history: 'previously-published-catalog', prices: 'current independently verified daily chart payloads', benchmark: prices?.source || null },
    history_first_as_of: snapshots[0]?.as_of || null };
  const raw = JSON.stringify(data), sha256 = createHash('sha256').update(raw).digest('hex'), path = `candidate-performance-${sha256.slice(0, 16)}.json`;
  await writeFile(resolve(root, path), raw);
  entry.assets.candidate_performance = { path, sha256, as_of_date: entry.as_of_date };
  return data;
}
