// Offline adapter for the existing SEC aggregate and OpenFIGI cache. This does
// not collect data, infer missing holdings, or certify the original archives.
import { MARKET_HISTORY_VERSION, validHistoryDate } from '../src/static/marketIndicatorHistory.js';

export const MARKET_SNAPSHOT_VERSION = 'market-indicator-snapshot-v1';
export const INSTITUTIONAL_HISTORY_PRODUCER = 'sec13f-market-history-v1';
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ownArray = value => {
  if (!Array.isArray(value)) return false;
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) return false;
  return true;
};
const text = value => typeof value === 'string' && value.trim().length > 0;
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const symbolName = value => typeof value === 'string' && /^[A-Z][A-Z0-9-]*$/.test(value);
const quarter = value => validHistoryDate(value) && /-(03-31|06-30|09-30|12-31)$/.test(value);
const positiveCount = value => Number.isSafeInteger(value) && value > 0;
const need = (condition, message) => { if (!condition) throw Error(message); };

function reportedCount(observation, reportsSelected) {
  const count = observation.manager_count;
  // aggregate_archives counts selected accession reports; each observed CIK
  // requires a selected report. These are necessary bounds, not reaggregation.
  if (!positiveCount(count) || count > reportsSelected) return null;
  if (Object.hasOwn(observation, 'filings')) {
    const filings = observation.filings;
    // Older adapter inputs may omit this list. A provided list must retain the
    // aggregate's distinct opaque accession IDs; do not infer CIKs from them.
    if (!ownArray(filings) || !filings.length || filings.length > reportsSelected || !filings.every(text) ||
        new Set(filings).size !== filings.length || count > filings.length) return null;
  }
  return count;
}

// The checked-in sources use UTC with microseconds and +00:00. Keep their raw
// precision in provenance; project the latest required input to milliseconds
// for the existing display contract. Never stamp the build's current time.
function sourceTime(value, now) {
  if (typeof value !== 'string') return null;
  const parts = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(?:Z|\+00:00)$/.exec(value);
  if (!parts || !validHistoryDate(parts[1]) || +parts[2] > 23 || +parts[3] > 59 || +parts[4] > 59) return null;
  const seconds = Date.parse(`${parts[1]}T${parts[2]}:${parts[3]}:${parts[4]}Z`);
  if (!Number.isFinite(seconds)) return null;
  const micros = BigInt(seconds) * 1000n + BigInt((parts[5] || '').padEnd(6, '0'));
  if (micros > BigInt(now) * 1000n) return null;
  const millis = Number(micros >= 0 ? micros / 1000n : (micros - 999n) / 1000n);
  return { micros, utc: new Date(millis).toISOString(), date: parts[1] };
}

export function buildInstitutionalMarketSnapshot({ seed, mapping, asOfDate, symbols, inputHashes, now = Date.now() }) {
  need(Number.isSafeInteger(now), 'Invalid evaluation clock');
  need(validHistoryDate(asOfDate) && asOfDate <= new Date(now).toISOString().slice(0, 10), 'Invalid or future analysis date');
  need(ownArray(symbols) && symbols.length > 0 && symbols.every(symbolName) && new Set(symbols).size === symbols.length, 'Explicit unique US symbols are required');
  need(record(inputHashes) && hash(inputHashes.seed_sha256) && hash(inputHashes.mapping_sha256), 'Input byte hashes are required');
  need(record(seed) && record(seed.securities) && record(mapping) && (seed.mapping === undefined || record(seed.mapping)), 'Invalid cached source envelope');
  need(validHistoryDate(seed.publication_cutoff) && seed.publication_cutoff <= asOfDate, 'Publication cutoff exceeds the analysis date');
  const secTime = sourceTime(seed.retrieved_at, now);
  need(secTime && seed.publication_cutoff <= secTime.date, 'Invalid SEC acquisition time or future cutoff');
  need(ownArray(seed.periods) && seed.periods.length > 0 && seed.periods.every((period, index) => quarter(period) && period <= seed.publication_cutoff && (!index || seed.periods[index - 1] < period)), 'Invalid reporting periods');
  need(positiveCount(seed.reports_selected) && Number.isSafeInteger(seed.incomplete_manager_periods) && seed.incomplete_manager_periods >= 0, 'Missing report coverage metadata');
  need(ownArray(seed.archives) && seed.archives.length > 0 && seed.archives.every(item => record(item) && text(item.file) && hash(item.sha256)) && new Set(seed.archives.map(item => item.file)).size === seed.archives.length, 'Missing or conflicting SEC archive identities');

  // The separate checked-in mapping cache supersedes the older embedded cache,
  // including explicit unresolved entries. Never fall back to an old success.
  const mappings = { ...seed.mapping, ...mapping };
  const bySymbol = new Map();
  for (const cusip of Object.keys(seed.securities)) {
    const entry = mappings[cusip];
    if (record(entry) && symbolName(entry.symbol)) {
      if (!bySymbol.has(entry.symbol)) bySymbol.set(entry.symbol, []);
      bySymbol.get(entry.symbol).push(cusip);
    }
  }
  const requested = [...symbols].sort(), series = [], admitted = [], unavailable = [], mappingProofs = [], observationsProof = [];
  for (const symbol of requested) {
    const ids = bySymbol.get(symbol) || [];
    const reject = reason => unavailable.push({ symbol, reason });
    if (ids.length !== 1) { reject(ids.length ? '複数CUSIPが同じ銘柄へ対応し、比較対象を確定できません。' : '保存済み対応表に一意な銘柄対応がありません。'); continue; }
    const cusip = ids[0], identity = mappings[cusip], security = seed.securities[cusip];
    const mappingTime = sourceTime(identity.retrieved_at, now);
    if (!/^[A-Z0-9]{9}$/.test(cusip) || identity.source !== 'OpenFIGI' || !mappingTime) { reject('銘柄対応の出典・取得日時が未確認です。'); continue; }
    if (!record(security) || !ownArray(security.observations) || !security.observations.length) { reject('保有対象期別の観測が未取得または不正です。'); continue; }
    const seen = new Set();
    const valid = security.observations.every((observation, index) => {
      if (!record(observation) || !quarter(observation.period) || !seed.periods.includes(observation.period) || seen.has(observation.period) ||
        (index > 0 && security.observations[index - 1].period >= observation.period) ||
        !validHistoryDate(observation.filing_date_first) || !validHistoryDate(observation.filing_date_last) ||
        observation.filing_date_first < observation.period || observation.filing_date_last < observation.filing_date_first || observation.filing_date_last > seed.publication_cutoff) return false;
      seen.add(observation.period);
      return true;
    });
    if (!valid) { reject('保有対象期・提出日・重複観測の整合性が未確認です。'); continue; }
    const collected = (secTime.micros >= mappingTime.micros ? secTime : mappingTime).utc;
    const observations = security.observations.map(observation => ({
      date: observation.period, value: reportedCount(observation, seed.reports_selected), collected_at: collected,
    }));
    series.push({ metric: 'institutional_holders', market: 'US', instrument: symbol,
      population: `指定SECアーカイブ内の集計可能な公開13F報告運用会社（CIK）。集計期限 ${seed.publication_cutoff} / 比較対象CUSIP ${cusip} / 未完了の運用会社・期 ${seed.incomplete_manager_periods}件。市場全体・全保有者の完全集計ではありません。`,
      method: 'sec13f-manager-cik-positive-shares-v1：正のSH保有・オプション除外・訂正報告反映・CIK重複除外。報告運用会社数の実測集計であり売買の代理値ではありません。',
      source: '保存済みSEC Form 13F集計 / OpenFIGI銘柄対応（原アーカイブの再集計一致は未検証）',
      unit: 'reporting_managers', frequency: 'quarterly', scope: 'security', approximate: true, observations });
    admitted.push(symbol);
    mappingProofs.push({ symbol, cusip, source: identity.source, retrieved_at: identity.retrieved_at });
    observationsProof.push({ symbol, cusip, issuer_name: typeof security.name === 'string' ? security.name : null,
      security_class: typeof security.class === 'string' ? security.class : null,
      observations: security.observations.map((observation, index) => ({ period: observation.period,
        manager_count: observations[index].value,
        count_state: observations[index].value === null ? 'unknown' : 'reported_aggregate',
        filing_date_first: observation.filing_date_first, filing_date_last: observation.filing_date_last })) });
  }
  return { schema_version: MARKET_SNAPSHOT_VERSION, market: 'US', as_of_date: asOfDate,
    history: { version: MARKET_HISTORY_VERSION, series },
    provenance: { producer: INSTITUTIONAL_HISTORY_PRODUCER, knowledge_basis: 'retrieved_snapshot_not_point_in_time',
      timestamp_projection: 'latest_required_source_input_utc_truncated_to_milliseconds',
      input_files: { seed_sha256: inputHashes.seed_sha256, mapping_sha256: inputHashes.mapping_sha256 },
      sec: { retrieved_at: seed.retrieved_at, publication_cutoff: seed.publication_cutoff, periods: [...seed.periods],
        archives: seed.archives.map(item => ({ file: item.file, sha256: item.sha256 })),
        reports_selected: seed.reports_selected, incomplete_manager_periods: seed.incomplete_manager_periods },
      mappings: mappingProofs, reported_observations: observationsProof,
      selection: { requested_symbols: requested, admitted_symbols: admitted, unavailable },
      limitations: ['保存済み集計の原SEC ZIP・OpenFIGI原応答との再照合は未実施。', '件数は報告運用会社数であり購入者数・ファンド数・株数ではありません。',
        '非報告・非公開保有、集計期限後の提出、集計不能な運用会社・期を含む完全母集団ではありません。', '分析基準日は取得日時ではありません。古い保有対象期を当日の値へ繰り越しません。'] } };
}
