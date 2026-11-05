// Print how complete the brief's fundamentals and market-environment inputs are
// for this build, using the same rule functions the screens use. Read-only: it
// writes nothing into the published data and never fills a gap.
//   node tools/report-data-coverage.mjs              inputs (SEC file, Yahoo history, market history)
//   node tools/report-data-coverage.mjs --published  what the published details actually carry
// --published also takes:
//   --root DIR                  the publication's logical root (default public; static-data inside it)
//   --json FILE                 write the machine-judged report (it carries the per-symbol SEC record digests)
//   --label TEXT                a note for the job-summary table's heading (e.g. the live publication before a republish)
//   --previous FILE             a report of the publication this build replaces (written with --json)
//   --ui-only-republish         this build republishes the same data with a new UI: a drop against --previous
//                               is said as one (a ::warning::, the round-1 default)
//   --require-sec-carry-forward fail (exit 1) when, for the same publication date, any SEC record of the
//                               previous report is missing or changed, or the check cannot be made (only
//                               when the owner turns it on; see research-ui-release.yml)
//   --allow-sec-coverage-drop   explicit approval: report such a drop as a warning instead
// Every other finding is a ::warning:: and a $GITHUB_STEP_SUMMARY table; the report never fails a build.
import { createHash } from 'node:crypto';
import { appendFileSync, realpathSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { admitBookFinancialsDetailed, SEC_PUBLICATION_REFUSAL_REASONS, SEC_RECORD_SCHEMA } from '../src/static/bookFinancialAdmission.js';
import { bookFinancialCurrent } from '../src/static/bookFinancialCurrent.js';
import { financialHistory } from '../src/static/financialHistory.js';
import { code33Layered } from '../src/static/code33Reference.js';
import { code33Explain, code33Parts, fundamentalTiles, secStatus } from '../src/static/fundamentalsExplain.js';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { setupReadiness } from '../src/static/setupReadiness.js';
import { environmentPoint } from '../src/static/marketLongHistory.js';
import { LONG_HISTORY_ENVIRONMENT_KEYS } from '../src/static/marketUpdateState.js';
import { readBookFinancials } from './book-financials-input.mjs';

const read = async path => { try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };

/** Trend-template rows the brief lists: qualified, then one condition short with nothing unknown. */
export function briefRows(audit, date) {
  if (!audit || audit.as_of_date !== date) return [];
  const method = row => row.methods?.minervini || {};
  const rows = audit.results || [];
  return [...rows.filter(row => method(row).qualified), ...rows.filter(row => !method(row).qualified && method(row).failed === 1 && method(row).unknown === 0)].map(row => row.symbol);
}

export function fundamentalsCoverage({ daily, sec, history, audit = null, now = Date.now() }) {
  const date = daily?.as_of_date;
  const symbols = [...new Set([...['minervini', 'minervini2'].flatMap(method => (daily?.candidates?.[method] || []).map(row => row.symbol)), ...briefRows(audit, date)])];
  const out = { as_of_date: date, candidates: symbols.length, sec: { same_day: sec?.as_of_date === date, available: 0, partial: 0, unavailable: 0, missing: 0 },
    history: { same_day: history?.as_of_date === date, available: 0, missing: 0 }, code33: { sec: 0, yahoo: 0, unknown: 0 },
    // Each SEC condition separately: a fiscal-Q4 EPS reported only annually leaves EPS (and so Code 33) unknown.
    sec_conditions: { eps: { pass: 0, fail: 0, unknown: 0 }, sales: { pass: 0, fail: 0, unknown: 0 }, margin: { pass: 0, fail: 0, unknown: 0 }, q4_eps_missing: 0 }, unknown_symbols: [] };
  for (const symbol of symbols) {
    const evidence = sec?.as_of_date === date ? sec.results?.[symbol] : null;
    if (!evidence) out.sec.missing++; else out.sec[evidence.status] = (out.sec[evidence.status] || 0) + 1;
    const raw = history?.as_of_date === date ? history.results?.[symbol] : null;
    if (raw?.status === 'available') out.history.available++; else out.history.missing++;
    const book = evidence ? bookFinancialCurrent(evidence, symbol, date, now, { symbol }) : null;
    const series = raw ? financialHistory(raw, symbol, date, now) : null;
    const report = book?.current ? book.report : null;
    if (report?.valid) {
      const c = out.sec_conditions;
      c.eps[report.epsAcceleration]++; c.sales[report.salesAcceleration]++; c.margin[report.marginImprovement]++;
      if (code33Parts(report)?.q4Eps) c.q4_eps_missing++;
    }
    const layered = code33Layered(report, series, date);
    if (layered.state === 'unknown') { out.code33.unknown++; if (out.unknown_symbols.length < 25) out.unknown_symbols.push(symbol); }
    else out.code33[layered.source === 'yahoo' ? 'yahoo' : 'sec']++;
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// SEC admission and the publication's fundamentals coverage block. One function computes the block
// for the export (manifest.markets.US.fundamentals_coverage), the quality gate (which recomputes it
// from the published files) and this report, so its numbers never come from two places.
const day = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const plainObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const sortedCounts = values => Object.fromEntries(Object.entries(values).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0));
const canonical = value => Array.isArray(value) ? value.map(canonical) : plainObject(value) ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const sha256 = value => createHash('sha256').update(value).digest('hex');

export const FUNDAMENTALS_COVERAGE_SCHEMA = 'fundamentals-coverage-v1';
export const SEC_ADMISSION_STATES = Object.freeze(['admitted', 'not_requested', 'refused', 'not_fetched']);

/** What the SEC input file (tools/sec-financials.py, as readBookFinancials returns it) says for one publication date. */
// The error sec-financials.py records when the SEC ticker map could not be read (every symbol is then no_cik).
const TICKER_MAP_ERROR = 'SEC ticker map unavailable';
export function secInputSummary(file, asOfDate) {
  if (!plainObject(file)) return { present: false, schema: null, as_of: null, same_day: false, records: null, eligible: null, requested: null, truncated: null, deadline_unreached: null, ticker_map_ok: null };
  const results = plainObject(file.results) ? file.results : null, coverage = plainObject(file.coverage) ? file.coverage : {};
  return { present: true, schema: Number.isSafeInteger(file.schema_version) ? file.schema_version : null, as_of: day(file.as_of_date) ? file.as_of_date : null,
    same_day: day(asOfDate) && file.as_of_date === asOfDate, records: results ? Object.keys(results).length : null,
    eligible: count(coverage.eligible), requested: count(coverage.requested), truncated: count(coverage.truncated), deadline_unreached: count(coverage.deadline?.unreached),
    // Known only from a file that lists its errors; an older file without the list says nothing about the map.
    ticker_map_ok: Array.isArray(file.errors) ? !file.errors.some(error => typeof error === 'string' && error.startsWith(TICKER_MAP_ERROR)) : null };
}

/**
 * One published row's SEC admission, as its research detail carries it (detail-only, never in the list):
 * admitted (the detail holds the record), not_fetched (no SEC input for this publication date: no_file or
 * other_date), not_requested (the same-day input has no record for the symbol) or refused (the record did
 * not pass admitBookFinancialsDetailed; `refusal` is its reason).
 */
export function secAdmissionState({ file, asOfDate, symbol, published, refusal = null }) {
  if (published) return { state: 'admitted', reason: null };
  if (!plainObject(file)) return { state: 'not_fetched', reason: 'no_file' };
  if (file.as_of_date !== asOfDate) return { state: 'not_fetched', reason: 'other_date' };
  if (!plainObject(file.results) || !Object.hasOwn(file.results, symbol)) return { state: 'not_requested', reason: null };
  // Admission accepted a record the published row does not carry: a later publication step removed it.
  return { state: 'refused', reason: refusal || 'projection' };
}

/**
 * Why a published row lost the same-day SEC record of its input, as observed (never a guess): the export's
 * own admission reason, else the carry/correction overlay's re-admission reason, else, when both admitted
 * it, what the final row shows: an instrument the overlay or the projection made non-corporate
 * (not_corporate, the projection then nulls book_financials), or another later step (projection).
 */
export function secRefusalReason({ exported = null, overlay = null, corporate = true } = {}) {
  return exported?.reason || overlay?.reason || (corporate ? 'projection' : 'not_corporate');
}

/**
 * The publication-level coverage block from the SEC input and every published row's admission
 * ({ symbol, state, reason, status }, status being the admitted record's status). Counts that the
 * input does not carry are null (read 未計測), never 0. The brief-listed counts stay in this report's
 * --published output: they follow the financial qualification, which the financial carry may change, and
 * the carry's comparator requires the manifest to stay identical across it.
 */
export function fundamentalsCoverageBlock({ file, asOfDate, states }) {
  const input = secInputSummary(file, asOfDate), same = input.same_day;
  const tally = state => states.filter(item => item.state === state).length, refused = {};
  for (const item of states) if (item.state === 'refused') refused[item.reason] = (refused[item.reason] || 0) + 1;
  return { schema_version: FUNDAMENTALS_COVERAGE_SCHEMA, as_of_date: asOfDate,
    sec_fetch_ran: same, sec_as_of: input.as_of, file_schema: input.schema, universe: states.length,
    requested: same ? input.records : null, eligible: same ? input.eligible : null, truncated: same ? input.truncated : null, deadline_unreached: same ? input.deadline_unreached : null,
    ticker_map_ok: same ? input.ticker_map_ok : null,
    admitted: tally('admitted'), with_quarters: states.filter(item => item.state === 'admitted' && ['available', 'partial'].includes(item.status)).length,
    not_requested: tally('not_requested'), not_fetched: tally('not_fetched'), refused: tally('refused'), refused_by_reason: sortedCounts(refused) };
}

const BLOCK_KEYS = ['schema_version', 'as_of_date', 'sec_fetch_ran', 'sec_as_of', 'file_schema', 'universe', 'requested', 'eligible', 'truncated', 'deadline_unreached', 'ticker_map_ok',
  'admitted', 'with_quarters', 'not_requested', 'not_fetched', 'refused', 'refused_by_reason'];
/** Structural check of a published block (an absent block is valid: older publications carry none). */
export function validFundamentalsCoverageBlock(block) {
  if (block === undefined) return true;
  if (!plainObject(block) || Object.keys(block).length !== BLOCK_KEYS.length || !BLOCK_KEYS.every(key => Object.hasOwn(block, key))) return false;
  if (block.schema_version !== FUNDAMENTALS_COVERAGE_SCHEMA || !day(block.as_of_date) || typeof block.sec_fetch_ran !== 'boolean') return false;
  if (!(block.sec_as_of === null || day(block.sec_as_of)) || !(block.file_schema === null || Number.isSafeInteger(block.file_schema))) return false;
  if (['universe', 'admitted', 'with_quarters', 'not_requested', 'not_fetched', 'refused'].some(key => count(block[key]) === null)) return false;
  if (['requested', 'eligible', 'truncated', 'deadline_unreached'].some(key => !(block[key] === null || count(block[key]) !== null))) return false;
  if (![null, true, false].includes(block.ticker_map_ok) || (!block.sec_fetch_ran && block.ticker_map_ok !== null)) return false;
  if (block.admitted + block.not_requested + block.not_fetched + block.refused !== block.universe || block.with_quarters > block.admitted) return false;
  if (!plainObject(block.refused_by_reason) || Object.values(block.refused_by_reason).some(value => !(count(value) > 0)) || Object.values(block.refused_by_reason).reduce((a, b) => a + b, 0) !== block.refused) return false;
  return !block.sec_fetch_ran || block.sec_as_of === block.as_of_date;
}

/** The log line export-research, the carry/correction overlay and the financial gate print for one stage. */
export function formatSecAdmission(asOfDate, { stage = null, file = null, input = secInputSummary(file, asOfDate), admitted, refused = {}, universe = null } = {}) {
  return `SEC admission ${asOfDate}${stage ? ` (${stage})` : ''}: file_schema ${input.schema ?? (input.present ? '未計測' : 'none')}, `
    + `records ${input.same_day ? input.records : input.present ? `0 for this date (file ${input.as_of ?? '未計測'})` : 0}, admitted ${admitted}${universe === null ? '' : ` of ${universe}`}, refused ${JSON.stringify(sortedCounts(refused))}`;
}

/** Append markdown to the job summary when the runner provides one; never fails the caller. */
export function appendStepSummary(text, env = process.env) {
  if (!env.GITHUB_STEP_SUMMARY) return;
  try { appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`); } catch { /* the summary is a display surface only */ }
}

/** Every published row's SEC admission and the digest of each published record (book_financials), read from the details. */
export async function publishedSecInventory({ root = 'public' } = {}) {
  const dataRoot = resolve(root, 'static-data');
  const inside = path => { const full = resolve(dataRoot, path); if (!full.startsWith(dataRoot + '/')) throw Error('Invalid published path'); return full; };
  const manifest = await read(resolve(dataRoot, 'manifest.json'));
  if (!manifest) return null;
  const entry = manifest.markets?.US || manifest;
  const index = decodeResearchIndex(await read(inside(entry.assets.research.path)));
  const date = index.as_of_date, evaluatedAt = Number(index.financial_evaluated_at);
  let file = null;
  try { file = await readBookFinancials(dataRoot); } catch { file = null; }
  let fileBytes = null;
  for (const name of ['book-financials.json.gz', 'book-financials.json']) {
    try { fileBytes = { name, sha256: sha256(await readFile(resolve(dataRoot, name))) }; break; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const states = [], records = {}, problems = [];
  let derived = 0;
  for (const summary of index.rows) {
    const detail = summary.research_detail_path ? await read(inside(summary.research_detail_path)) : null;
    const row = detail && detail.symbol === summary.symbol && detail.as_of_date === date ? detail : { ...summary, book_financials: null };
    const record = row.book_financials ?? null;
    if (record) records[summary.symbol] = sha256(JSON.stringify(canonical(record)));
    let state = row.sec_admission;
    if (state !== undefined) {
      // A declared admission must be the one its inputs give: the record in the detail and the same-day input.
      const expected = secAdmissionState({ file, asOfDate: date, symbol: summary.symbol, published: Boolean(record), refusal: state?.reason });
      if (!plainObject(state) || Object.keys(state).sort().join() !== 'reason,state' || state.state !== expected.state || state.reason !== expected.reason
        || (state.state === 'refused' && !SEC_PUBLICATION_REFUSAL_REASONS.includes(state.reason))) problems.push(summary.symbol);
    }
    if (!SEC_ADMISSION_STATES.includes(state?.state)) {
      // A detail written before the admission state existed: derive it from the same inputs (diagnostic).
      derived++;
      const raw = file?.as_of_date === date && plainObject(file.results) ? file.results[summary.symbol] : undefined;
      state = secAdmissionState({ file, asOfDate: date, symbol: summary.symbol, published: Boolean(record),
        refusal: raw === undefined ? null : admitBookFinancialsDetailed(raw, { symbol: summary.symbol, asOfDate: date, evaluatedAt, row }).reason });
    }
    states.push({ symbol: summary.symbol, state: state.state, reason: state.reason ?? null, status: record?.status ?? null });
  }
  return { as_of_date: date, file: { ...secInputSummary(file, date), ...(fileBytes || { name: null, sha256: null }) }, states, records, derived_states: derived, admission_problems: problems,
    block: fundamentalsCoverageBlock({ file, asOfDate: date, states }), manifest_block: entry.fundamentals_coverage ?? null };
}

/**
 * Whether a later build kept every SEC record of the publication it replaces (same publication date):
 * each symbol's published record must still be there with identical content. Records gained are
 * reported, never counted as a drop. Different dates are not comparable (a data release).
 */
export function compareSecCarryForward(previous, current) {
  if (!previous?.records || !current?.records) return { comparable: false, reason: 'missing_report' };
  if (previous.as_of_date !== current.as_of_date) return { comparable: false, reason: 'different_date', before_date: previous.as_of_date ?? null, after_date: current.as_of_date ?? null };
  const lost = [], changed = [];
  for (const [symbol, digest] of Object.entries(previous.records)) {
    if (!Object.hasOwn(current.records, symbol)) lost.push(symbol);
    else if (current.records[symbol] !== digest) changed.push(symbol);
  }
  const before = Object.keys(previous.records).length, after = Object.keys(current.records).length;
  return { comparable: true, as_of_date: current.as_of_date, before, after, kept: before - lost.length - changed.length, lost: lost.length, changed: changed.length,
    gained: Object.keys(current.records).filter(symbol => !Object.hasOwn(previous.records, symbol)).length,
    lost_symbols: lost.slice(0, 25), changed_symbols: changed.slice(0, 25), dropped: lost.length > 0 || changed.length > 0,
    file_unchanged: Boolean(previous.file?.sha256) && previous.file.sha256 === current.file?.sha256 };
}

const SEC_STATES = ['ok', 'stale', 'not_published', 'not_requested', 'refused', 'no_cik', 'no_companyfacts', 'no_quarterly', 'no_quarterly_values', 'transient', 'not_applicable', 'invalid'];
const UNKNOWN_KINDS = ['q4_eps', 'few_quarters', 'gap', 'stale', 'no_sec', 'other'];
/**
 * What the brief can actually show for each row it lists, read from the published
 * research index and canonical details (the logical files, before transport packing).
 */
export async function publishedCoverage({ root = 'public', now = Date.now(), limit = 25 } = {}) {
  const dataRoot = resolve(root, 'static-data');
  const inside = path => { const full = resolve(dataRoot, path); if (!full.startsWith(dataRoot + '/')) throw Error('Invalid published path'); return full; };
  const manifest = await read(resolve(dataRoot, 'manifest.json'));
  if (!manifest) return null;
  const entry = manifest.markets?.US || manifest;
  const coverage = entry.fundamentals_coverage ?? null;
  const index = decodeResearchIndex(await read(inside(entry.assets.research.path)));
  const date = index.as_of_date, audit = await read(resolve(root, 'qualification-audit.json'));
  const rows = new Map(index.rows.map(row => [row.symbol, row]));
  const listed = briefRows(audit, date);
  // sec_record counts any admitted record (an unavailable one too: no CIK, an SEC outage, the deadline);
  // with_quarters_listed only those that carry quarters (available or partial).
  const out = { as_of_date: date, listed: listed.length, sec_record: 0, with_quarters_listed: 0, tiles: { eps: 0, sales: 0, margin: 0 },
    sec_state: Object.fromEntries(SEC_STATES.map(state => [state, 0])), code33: { pass: 0, fail: 0, unknown: 0 },
    code33_unknown_reason: Object.fromEntries(UNKNOWN_KINDS.map(kind => [kind, 0])),
    sec_conditions: { eps: { pass: 0, fail: 0, unknown: 0 }, sales: { pass: 0, fail: 0, unknown: 0 }, margin: { pass: 0, fail: 0, unknown: 0 } },
    // Measurement only (no rule reads these here): readiness of the setup detector and the fill of base and group-rank fields.
    setup_ready: { pass: 0, fail: 0, unknown: 0 }, filled: { se_base_length_weeks: 0, se_base_depth_pct: 0, ibd_group_rank: 0 }, listed_without_sec: [] };
  const finite = value => typeof value === 'number' && Number.isFinite(value);
  for (const symbol of listed) {
    const summary = rows.get(symbol);
    const detail = summary?.research_detail_path ? await read(inside(summary.research_detail_path)) : null;
    const row = detail && detail.symbol === symbol && detail.as_of_date === date ? detail : { ...summary, book_financials: null };
    const book = row.book_financials ? bookFinancialCurrent(row.book_financials, symbol, date, now, row) : null;
    const report = book?.current ? book.report : null;
    const history = row.financial_history ? financialHistory(row.financial_history, symbol, date, now) : null;
    const sec = secStatus(row, book, { coverage }), code33 = code33Layered(report, history, date), explain = code33Explain(report, sec, code33);
    if (row.book_financials) out.sec_record++;
    else if (out.listed_without_sec.length < limit) out.listed_without_sec.push(symbol);
    if (['available', 'partial'].includes(row.book_financials?.status)) out.with_quarters_listed++;
    out.sec_state[sec.state] = (out.sec_state[sec.state] || 0) + 1;
    if (report) fundamentalTiles(report).forEach((tile, i) => { if (tile.value !== null) out.tiles[['eps', 'sales', 'margin'][i]]++; });
    if (report?.valid) { out.sec_conditions.eps[report.epsAcceleration]++; out.sec_conditions.sales[report.salesAcceleration]++; out.sec_conditions.margin[report.marginImprovement]++; }
    out.code33[code33.state]++;
    if (code33.state === 'unknown') out.code33_unknown_reason[explain.kind] = (out.code33_unknown_reason[explain.kind] || 0) + 1;
    out.setup_ready[setupReadiness(row).state]++;
    for (const key of Object.keys(out.filled)) if (finite(row[key])) out.filled[key]++;
  }
  return out;
}

/**
 * The --published report as data: the listed-row coverage, the publication's SEC admission (block and
 * per-symbol digests), the carry-forward comparison with the replaced publication, and the warnings.
 */
export async function publishedFundamentalsReport({ root = 'public', now = Date.now(), previous = null, uiOnlyRepublish = false } = {}) {
  const coverage = await publishedCoverage({ root, now });
  if (!coverage) return null;
  const inventory = await publishedSecInventory({ root });
  const { block, manifest_block: manifestBlock } = inventory;
  const warnings = [];
  const ratio = coverage.listed > 0 ? coverage.sec_record / coverage.listed : null;
  const quartersRatio = coverage.listed > 0 ? coverage.with_quarters_listed / coverage.listed : null;
  if (ratio !== null && ratio < 0.8) warnings.push(`SEC records cover ${coverage.sec_record}/${coverage.listed} brief-listed rows (${(ratio * 100).toFixed(1)}%, below 80%)`);
  if (coverage.listed > 0 && coverage.sec_record === 0) warnings.push(`No brief-listed row carries an SEC record (0/${coverage.listed})`);
  // An admitted record can be an unavailable one (an SEC outage, the deadline, no CIK): only quarters show results.
  if (quartersRatio !== null && quartersRatio < 0.8) warnings.push(`SEC quarters (available or partial records) cover ${coverage.with_quarters_listed}/${coverage.listed} brief-listed rows (${(quartersRatio * 100).toFixed(1)}%, below 80%)`);
  if (block.requested > 0 && block.with_quarters === 0) warnings.push(`The SEC input holds ${block.requested} records for this date, but no published row carries SEC quarters (0/${block.universe})`);
  if (block.deadline_unreached > 0) warnings.push(`The SEC fetch ran out of its time budget: ${block.deadline_unreached} symbols were not reached (transient, unknown)`);
  if (block.ticker_map_ok === false) warnings.push('The SEC ticker map was unavailable: every symbol reads as without a CIK, a delivery failure rather than the stocks\' own state');
  if (block.file_schema !== SEC_RECORD_SCHEMA) warnings.push(block.file_schema === null ? `The SEC input file is ${inventory.file.present ? 'missing its schema version' : 'absent'} (expected schema ${SEC_RECORD_SCHEMA})` : `The SEC input file has schema ${block.file_schema}, expected ${SEC_RECORD_SCHEMA}`);
  if (inventory.file.present && !block.sec_fetch_ran) warnings.push(`The SEC input file is for ${block.sec_as_of ?? '未計測'}, not for this publication (${inventory.as_of_date})`);
  const refusals = Object.entries(block.refused_by_reason).filter(([reason]) => reason !== 'not_corporate');
  if (refusals.length) warnings.push(`SEC records refused at admission: ${refusals.map(([reason, n]) => `${reason} ${n}`).join(', ')}`);
  if (manifestBlock !== null && JSON.stringify(canonical(manifestBlock)) !== JSON.stringify(canonical(block))) warnings.push('The manifest fundamentals_coverage block differs from the published details');
  const carry = previous ? compareSecCarryForward(previous, inventory) : null;
  return { schema_version: 'published-fundamentals-report-v1', as_of_date: coverage.as_of_date, ui_only_republish: uiOnlyRepublish,
    coverage: { ...coverage, sec_record_ratio: ratio, with_quarters_ratio: quartersRatio }, fundamentals_coverage: block, file: inventory.file, derived_states: inventory.derived_states,
    records: inventory.records, carry_forward: carry, warnings };
}

const cell = value => value === null || value === undefined ? '未計測' : typeof value === 'object' ? (Object.keys(value).length ? Object.entries(value).map(([key, n]) => `${key} ${n}`).join(', ') : 'none') : String(value);
const percent = ratio => ratio === null || ratio === undefined ? '未計測' : `${(ratio * 100).toFixed(1)}%`;
/** The job-summary table of one report; `label` names which publication it describes when a job prints two. */
export function fundamentalsSummaryTable(report, { label = null } = {}) {
  const c = report.coverage, b = report.fundamentals_coverage, f = report.file, carry = report.carry_forward;
  const lines = [`### Published fundamentals coverage ${report.as_of_date}${label ? ` (${label})` : ''}`, '', '| measure | value |', '| --- | --- |',
    `| brief-listed rows | ${cell(c.listed)} |`, `| with an SEC record / with SEC quarters | ${cell(c.sec_record)} (${percent(c.sec_record_ratio)}) / ${cell(c.with_quarters_listed)} (${percent(c.with_quarters_ratio)}) |`,
    `| SEC input file | ${f.present ? `${cell(f.name)}, schema ${cell(f.schema)}, for ${cell(f.as_of)}` : 'absent'} |`,
    `| records in the input for this date | ${cell(b.requested)} (eligible ${cell(b.eligible)}, truncated ${cell(b.truncated)}, deadline unreached ${cell(b.deadline_unreached)}; ticker map ${b.ticker_map_ok === null ? '未計測' : b.ticker_map_ok ? 'read' : 'unavailable'}) |`,
    `| published rows / admitted / with quarters | ${cell(b.universe)} / ${cell(b.admitted)} / ${cell(b.with_quarters)} |`,
    `| not requested / no same-day input | ${cell(b.not_requested)} / ${cell(b.not_fetched)} |`, `| refused by reason | ${cell(b.refused_by_reason)} |`,
    `| SEC states (listed) | ${cell(Object.fromEntries(Object.entries(c.sec_state).filter(([, n]) => n)))} |`,
    `| Code 33 (listed) | ${cell(c.code33)}; unknown: ${cell(Object.fromEntries(Object.entries(c.code33_unknown_reason).filter(([, n]) => n)))} |`,
    `| SEC conditions (listed) | EPS ${cell(c.sec_conditions.eps)}; sales ${cell(c.sec_conditions.sales)}; margin ${cell(c.sec_conditions.margin)} |`,
    `| setup readiness (listed, measurement only) | ${cell(c.setup_ready)} |`,
    `| filled (listed, measurement only) | ${cell(c.filled)} of ${cell(c.listed)} |`];
  if (carry) lines.push(carry.comparable ? `| SEC records kept from the replaced publication | ${carry.kept}/${carry.before} (lost ${carry.lost}, changed ${carry.changed}, gained ${carry.gained}; input file ${carry.file_unchanged ? 'unchanged' : 'changed'}) |`
    : `| SEC records kept from the replaced publication | not comparable (${carry.reason}) |`);
  return lines.join('\n');
}

export function environmentCoverage(history, sessions = 20) {
  const rows = (history?.breadth || []).slice(-sessions);
  const fields = ['trendTemplateCount', 'rs90TemplateCount', 'above200Percent', 'stage2', 'newHighs', 'breakoutsJudged', 'leaderCohort'];
  return { as_of_date: history?.as_of_date || null, last: rows.at(-1)?.date || null,
    present: Object.fromEntries(fields.map(field => [field, rows.filter(row => row[field] !== null && row[field] !== undefined).length + '/' + rows.length])) };
}

const FINAL_FIELDS = ['breakoutsJudged', 'breakoutsHeld', 'leaderCohort', 'leaderCohortAbove50', 'trendTemplateCount', 'rs90TemplateCount', 'above50Percent', 'above200Percent'];
/**
 * The final long-history row as the brief reads it (diagnostic only). An absent key is
 * reported as 'absent' (older-schema capture), a null as null; the derived rates use
 * the screens' own thresholds, so a small sample stays null rather than becoming a rate.
 */
export function finalEnvironmentRow(history) {
  const row = history?.breadth?.at(-1);
  if (!row || typeof row !== 'object') return { date: null, values: null, missing_environment_keys: null, derived: null };
  const point = environmentPoint(row);
  return { date: row.date ?? null, values: Object.fromEntries(FINAL_FIELDS.map(field => [field, Object.hasOwn(row, field) ? row[field] : 'absent'])),
    missing_environment_keys: LONG_HISTORY_ENVIRONMENT_KEYS.filter(key => !Object.hasOwn(row, key)),
    derived: { breakoutHoldPercent: point.breakoutHoldPercent, leaderHealthPercent: point.leaderHealthPercent } };
}

/**
 * The --published command. Returns the exit code: 0 unless --require-sec-carry-forward finds that a
 * same-day SEC record of the replaced publication is missing or changed (or that this cannot be checked)
 * and --allow-sec-coverage-drop was not given.
 */
export async function runPublished(args, { env = process.env, log = console.log, now = Date.now() } = {}) {
  const option = name => { const index = args.indexOf(name); return index >= 0 && typeof args[index + 1] === 'string' && !args[index + 1].startsWith('--') ? args[index + 1] : null; };
  const root = option('--root') || 'public', json = option('--json'), previousPath = option('--previous'), label = option('--label');
  const required = args.includes('--require-sec-carry-forward'), allowed = args.includes('--allow-sec-coverage-drop');
  const uiOnly = required || args.includes('--ui-only-republish');
  let previous = null, previousError = null;
  if (previousPath) {
    try { previous = JSON.parse(await readFile(previousPath, 'utf8')); if (!previous?.records) { previousError = previous?.unavailable || 'no SEC record inventory'; previous = null; } }
    catch (error) { previousError = String(error?.message || error).slice(0, 200); }
  } else if (required) previousError = 'no report of the replaced publication was given';
  let report = null, failure = null;
  try { report = await publishedFundamentalsReport({ root, now, previous, uiOnlyRepublish: uiOnly }); if (!report) failure = 'No published static-data bundle'; }
  catch (error) { failure = String(error?.message || error).slice(0, 200); }
  if (json) writeFileSync(json, JSON.stringify(report ?? { unavailable: failure }));
  const refuse = problem => {
    if (allowed) { log(`::warning::${problem}; continuing because allow_sec_coverage_drop was set explicitly`); return 0; }
    log(`::error::${problem}. A UI-only republish must keep the published same-day SEC records unchanged; set allow_sec_coverage_drop only with the owner's approval.`);
    return 1;
  };
  if (!report) {
    log(`::warning::Published fundamentals coverage unavailable: ${failure}`);
    return required ? refuse(`SEC records of the replaced publication cannot be verified: ${failure}`) : 0;
  }
  // A previous report that was given but cannot be read is 未計測 in the table, never a clean comparison.
  if (previousPath && previousError && !report.carry_forward) report.carry_forward = { comparable: false, reason: previousError };
  const { records, ...shown } = report; void records;
  log('Published coverage (fundamentals): ' + JSON.stringify(shown));
  for (const warning of report.warnings) log(`::warning::${warning}`);
  appendStepSummary(fundamentalsSummaryTable(report, { label }), env);
  const carry = report.carry_forward;
  if (required) {
    if (previousError) return refuse(`SEC records of the replaced publication cannot be verified: ${previousError}`);
    if (!carry.comparable) return refuse(`SEC records of the replaced publication cannot be compared (${carry.reason})`);
    if (carry.dropped) return refuse(`SEC coverage dropped from ${carry.before} to ${carry.kept} in a UI-only republish (lost ${carry.lost}${carry.lost_symbols.length ? `: ${carry.lost_symbols.join(' ')}` : ''}; changed ${carry.changed}${carry.changed_symbols.length ? `: ${carry.changed_symbols.join(' ')}` : ''})`);
    log(`SEC records carried forward unchanged in a UI-only republish: ${carry.kept}/${carry.before} for ${carry.as_of_date} (gained ${carry.gained}; input file ${carry.file_unchanged ? 'byte-identical' : 'changed'})`);
  } else if (carry?.comparable && carry.dropped) log(`::warning::SEC coverage dropped from ${carry.before} to ${carry.kept} ${uiOnly ? 'in a UI-only republish' : 'against the given previous report'} (lost ${carry.lost}${carry.lost_symbols.length ? `: ${carry.lost_symbols.join(' ')}` : ''}; changed ${carry.changed}${carry.changed_symbols.length ? `: ${carry.changed_symbols.join(' ')}` : ''})`);
  else if (carry && !carry.comparable) log(`::warning::SEC records of the replaced publication: 未計測 (not compared: ${carry.reason})`);
  return 0;
}

/** Whether this module is the command node runs (a symlinked checkout or a path with spaces still counts). */
export function invokedAsCommand(moduleUrl = import.meta.url, argv = process.argv) {
  try { return typeof argv[1] === 'string' && moduleUrl === pathToFileURL(realpathSync(argv[1])).href; } catch { return false; }
}

if (invokedAsCommand()) {
  const args = process.argv.slice(2);
  if (args.includes('--published')) process.exitCode = await runPublished(args);
  else {
    // Diagnostic only: a missing or malformed input must not turn this report into a build failure.
    try {
      const [daily, sec, history, market, audit] = await Promise.all([read('public/research-daily.json'), readBookFinancials('public/static-data'),
        read('public/static-data/financial-history.json'), read('public/static-data/market-history-source.json'), read('public/qualification-audit.json')]);
      console.log('Data coverage (fundamentals): ' + JSON.stringify(fundamentalsCoverage({ daily, sec, history, audit })));
      console.log('Data coverage (market environment, last 20 sessions): ' + JSON.stringify(environmentCoverage(market)));
      try { console.log('Data coverage (market environment, final session): ' + JSON.stringify(finalEnvironmentRow(market))); }
      catch (error) { console.log('Data coverage (market environment, final session) unavailable: ' + String(error?.message || error).slice(0, 200)); }
    } catch (error) { console.log(`::warning::Data coverage report unavailable: ${String(error?.message || error).slice(0, 200)}`); }
  }
}
