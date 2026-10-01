import { readFile, writeFile } from 'node:fs/promises';
import { resolve, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { candidatePerformance } from '../src/static/candidatePerformance.js';
import { auditDailyBars } from '../src/static/qualificationAudit.js';
import { freezeObservation, preservedObservation, readPerformanceArchive, retainObservation, writePerformanceArchive } from './candidate-performance-archive.mjs';

export function performanceBenchmarkInputs(prices, asOf) {
  const current = prices?.as_of_date === asOf && prices?.calendar === 'NYSE' && prices?.adjustment === 'split-adjusted-close-no-dividend';
  // A price series is not an exchange calendar: deriving sessions from SPY
  // silently compresses any missing benchmark bar into a longer horizon.
  return { benchmark: current ? { verified: true, bars: prices.series?.SPY || [] } : null,
    sessions: current && Array.isArray(prices.sessions) ? prices.sessions : [] };
}

export async function exportCandidatePerformance({ root, snapshots, rows, prices, entry, manifest, now = Date.now() }) {
  const archive = await readPerformanceArchive(root, now);
  const eligible = new Set(snapshots.flatMap(snapshot => snapshot.records.filter(record => record.liquid === true && Object.values(record.methods || {}).some(method => method.state === 'pass')).map(record => record.symbol)));
  const stocks = new Map();
  for (const row of rows) if (eligible.has(row.symbol) && row.chart_path && row.technical_audit?.valid === true) {
    const path = resolve(root, row.chart_path);
    if (!path.startsWith(resolve(root) + sep)) throw Error('Invalid performance chart path');
    try {
      const raw = await readFile(path, 'utf8'), payload = JSON.parse(raw);
      const audit = auditDailyBars(row, payload, entry.as_of_date);
      if (audit.valid) stocks.set(row.symbol, { verified: true, bars: payload.bars.map(({ date, close }) => ({ date, close })), source: { path: row.chart_path, sha256: createHash('sha256').update(raw).digest('hex') } });
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const { benchmark, sessions } = performanceBenchmarkInputs(prices, entry.as_of_date);
  const reused = new Set(), frozen = new Set();
  const observationFor = ({ snapshot, record, horizon, measure }) => {
    const key = `${snapshot.published_ref?.sha256}:${record.symbol}:${horizon}`;
    const saved = preservedObservation(archive, snapshot, record.symbol, horizon, entry.as_of_date);
    if (saved) { if (!frozen.has(key)) reused.add(key); return saved.result; }
    const result = measure();
    if (result.status !== 'complete') return result;
    const observation = freezeObservation({ snapshot, symbol: record.symbol, horizon, result, stock: stocks.get(record.symbol), prices, sessions, asOf: entry.as_of_date, now });
    if (!observation) {
      const closedAt = Date.parse(prices?.completed_session_close);
      const preClose = result.end_date === entry.as_of_date && Number.isFinite(closedAt) && closedAt > now &&
        new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(closedAt) === entry.as_of_date;
      return { status: preClose ? 'pending' : 'unavailable',
        reason: preClose ? `${horizon}営業日の観測待ち（最終取引日の引け前）` : '公開cohort・NYSE閉場・取得時刻・調整方式の確認が不足',
        observed_sessions: preClose ? Math.max(0, horizon - 1) : result.observed_sessions,
        return_pct: null, spy_return_pct: null, max_drawdown_pct: null, end_date: null };
    }
    retainObservation(archive, snapshot, observation); frozen.add(key);
    return result;
  };
  const data = { ...candidatePerformance({ snapshots, asOf: entry.as_of_date, sessions, stocks, benchmark, observationFor }), generated_at: manifest.generated_at,
    source: { candidate_history: 'previously-published-catalog', prices: 'current independently verified daily chart payloads', benchmark: prices?.source || null },
    history_first_as_of: snapshots[0]?.as_of || null };
  const archiveRefs = await writePerformanceArchive(root, archive);
  data.observation_archive = { path: 'candidate-performance-history/index.json', completed_observations: archiveRefs.reduce((sum, ref) => sum + ref.observations, 0), newly_frozen: frozen.size, reused: reused.size };
  data.definition = '公開時に保存した通過銘柄の終値からの騰落率。売買実績ではありません。選定銘柄は公開時の記録で固定。満期を検証して保存した観測は、その時点の価格・SPY・NYSE営業日一覧と出典を固定し、後日の配信欠落で消しません。未保存の観測は現在の検証済み履歴で計測します。最大下落率は期間内終値の高値から安値への最大下落。配当込み総合リターン・費用は含みません。';
  const raw = JSON.stringify(data), sha256 = createHash('sha256').update(raw).digest('hex'), path = `candidate-performance-${sha256.slice(0, 16)}.json`;
  await writeFile(resolve(root, path), raw);
  entry.assets.candidate_performance = { path, sha256, as_of_date: entry.as_of_date };
  return data;
}
