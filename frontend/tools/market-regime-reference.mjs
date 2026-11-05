#!/usr/bin/env node
/**
 * Market-regime reference builder: the market tab's 「過去の傾向」 block shows numbers from this file's output
 * only (frontend/src/static/reference/market-regime-reference-v1.json). Nothing in src/ types a percentage.
 *
 * Input: the market-regime study's CI output, either its results.json (--results, preferred: exact values) or
 * its markdown report (--markdown, the round-1 fallback: values rounded to whole percent). The committed source
 * is a byte-identical copy of the Design Acceptance run's markdown
 * (tools/reference-sources/market-regime-study-v2/ci-results-run41844557380.md).
 *
 * It refuses to build unless the study version, the distribution-day and follow-through method ids, every state
 * definition (bucket labels and rule text) and, with JSON input, the app rules the study ran with (DISTRIBUTION_WARN,
 * SPLIT_RULE, ENV_RULES) equal the app's current ones: a state shown on screen joins a study row only when it is
 * judged the same way.
 *
 * Output: per index indicator (^GSPC / ^IXIC × ma.quadrant, high.near, dd.graded, dd.binary, ftd.state,
 * combo.ftd_recent) and state, at h = 21 sessions: n, episodes, P(21-session drawdown <= -5%), the first-half
 * share, the labels of the drawdown and mean statistics (the mean as a label and, when that label is robust, its
 * direction only: never a number), and the comparator (the baseline of the same sample, or for a two-state
 * indicator the other state) with its share. The breadth panel's rule.* indicators carry their labels only.
 *
 * --check <reference> compares a fresh build with a committed one: labels and mean directions must be equal, every
 * share and first-half share within ±1 percentage point (a markdown build is rounded to 1 pt), and no first-half
 * share may cross the 〔偏り〕 bounds. Changes of n and episodes are counted as information. It prints the drift and
 * exits 1 when outside.
 * Diagnostic research only: nothing here changes a rule, threshold, verdict or published value.
 */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, relative, resolve, isAbsolute } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { APP_RULES, DD_GRADES, FTD_BUCKETS, FTD_RECENT_SESSIONS, FTD_WINDOW_SESSIONS, STUDY_VERSION, indexIndicators } from './market-regime-study.mjs';
import { BIAS_SHARE } from '../src/static/reference/marketRegimeReference.js';

export const REFERENCE_VERSION = 'market-regime-reference-v1';
export const HORIZON = 21;
export const TOLERANCE_POINTS = 1;
export const INDICES = Object.freeze(['^GSPC', '^IXIC']);
/** Stable state ids, in the study's bucket order. */
export const STATE_IDS = Object.freeze({
  'ma.quadrant': Object.freeze(['above_both', 'above200_below50', 'below200_above50', 'below_both']),
  'high.near': Object.freeze(['near', 'below']),
  'dd.graded': Object.freeze(['0-2', '3-4', '5-6', '7+']),
  'dd.binary': Object.freeze(['warn', 'below_warn']),
  'ftd.state': Object.freeze(FTD_BUCKETS.map(([state]) => state)),
  'combo.ftd_recent': Object.freeze(['recent', 'other']),
});
/** The breadth panel's rules, stored as labels only (the market tab tags them 〔参考〕). */
export const BREADTH_RULES = Object.freeze(['rule.split', 'rule.lows', 'rule.template', 'rule.stage', 'rule.leaders', 'rule.breakout']);
const BREADTH_BUCKETS = Object.freeze(['注意サイン (warning)', 'なし']);
const LABELS = new Set(['robust', 'weak', 'unstable', 'insufficient']);
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const finite = value => typeof value === 'number' && Number.isFinite(value);
const isDay = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
const round2 = value => finite(value) ? Math.round(value * 100) / 100 : null;
const fail = message => { throw Error(`market-regime reference: ${message}`); };

/** The study's current definition of each index indicator (bucket labels and rule text), from its own code. */
export function studyDefinitions() {
  const out = {};
  for (const symbol of INDICES) for (const indicator of indexIndicators({ symbol, dd: [], ftd: [], ma: [] })) {
    const suffix = indicator.key.slice(symbol.length + 1);
    if (STATE_IDS[suffix]) out[indicator.key] = { suffix, symbol, rule: indicator.rule, buckets: indicator.buckets.map(b => b.label) };
  }
  for (const key of BREADTH_RULES) out[key] = { suffix: key, symbol: null, rule: null, buckets: [...BREADTH_BUCKETS] };
  return out;
}

// ---- markdown input ------------------------------------------------------------------------------------------
const cells = line => line.trim().replace(/^\|/, '').replace(/\|$/, '').split(/(?<!\\)\|/).map(cell => cell.trim().replace(/\\\|/g, '|'));
const percent = text => { const m = /^(−|-)?(\d+(?:\.\d+)?)%$/.exec(text || ''); return m ? (m[1] ? -1 : 1) * Number(m[2]) : null; };
const integer = text => /^\d+$/.test(text || '') ? Number(text) : null;
const labelOf = text => { const value = String(text || '').replace(/\*/g, '').trim(); return LABELS.has(value) ? value : null; };
/** The estimate in front of a Δ cell (「+0.74 [−0.29, +0.31] p 0.005」), or null. */
const delta = text => { const m = /^(−|-|\+)?(\d+(?:\.\d+)?) \[/.exec(text || ''); return m ? (m[1] === '−' || m[1] === '-' ? -1 : 1) * Number(m[2]) : null; };
/**
 * The direction of a robust mean contrast ('higher' / 'lower' than its comparator), never its size; null unless the
 * mean label is robust. A two-state indicator's contrast is the first state minus the second, so the second state
 * takes the opposite direction.
 */
export const meanDirection = (label, estimate) => label === 'robust' && finite(estimate) && estimate !== 0 ? (estimate > 0 ? 'higher' : 'lower') : null;

/** The study's markdown report as the builder's neutral shape (see fromResults for the JSON one). */
export function parseStudyMarkdown(text) {
  const version = /^(market-regime-study-v\d+) \(pre-registered/m.exec(text)?.[1] ?? null;
  const asOf = /· as of (\d{4}-\d{2}-\d{2}) ·/.exec(text)?.[1] ?? null;
  const input = name => { const line = text.split('\n').find(row => row.startsWith(`| ${name}`)); if (!line) return null; const c = cells(line); return { first: c[2], last: c[3], sessions: integer(c[4]), basis: c[1] }; };
  const history = text.split('\n').find(row => row.startsWith('| long history'));
  const samples = { '^GSPC': input('^GSPC OHLCV'), '^IXIC': input('^IXIC OHLCV'), breadth: history ? (c => ({ first: c[2], last: c[3], sessions: integer(c[4]), basis: c[1].split(';')[0].trim() }))(cells(history)) : null };
  const overall = /Chance level \([^)]*\): robust labels median ([\d.]+), 95th percentile ([\d.]+), max (\d+);[^\n]*?the actual (\d+)\./.exec(text);
  const chance = { all: overall ? { actual: Number(overall[4]), median: Number(overall[1]), p95: Number(overall[2]) } : null };
  for (const m of text.matchAll(/^- (index:\^GSPC|index:\^IXIC|breadth): \d+ sessions, \d+ shifts \([^)]*\); robust labels actual (\d+), placebo median ([\d.]+), 95th percentile ([\d.]+)\.$/gm))
    chance[m[1]] = { actual: Number(m[2]), median: Number(m[3]), p95: Number(m[4]) };
  const indicators = {};
  const body = text.split(/^## All indicators$/m)[1] || '';
  for (const section of body.split(/^### /m).slice(1)) {
    const lines = section.split('\n'), key = /— `([^`]+)`$/.exec(lines[0])?.[1];
    if (!key) continue;
    const description = lines.find(line => line.includes('. Outcome: ')) || '';
    const judged = /Judged (\d+) sessions \((\d{4}-\d{2}-\d{2}) to (\d{4}-\d{2}-\d{2})\)/.exec(description);
    const rows = lines.filter(line => line.startsWith('| ') && !line.startsWith('| bucket') && !line.startsWith('|---')).map(cells).filter(c => integer(c[1]) === HORIZON);
    const baseline = rows.find(c => c[0] === 'baseline');
    const buckets = rows.filter(c => c[0] !== 'baseline').map(c => ({ label: c[0], n: integer(c[2]), episodes: integer(c[3]), firstHalfShare: percent(c[4]), pDd5: percent(c[8]),
      complement: c[10] === '(the contrast above)', meanDelta: delta(c[10]), labelMean: labelOf(c[11]), labelDd5: labelOf(c[13]) }));
    // A two-state indicator is tested once, on its first state: the second state takes the contrast row's labels
    // and the opposite sign of its mean contrast.
    buckets.forEach((b, g) => { if (b.complement && g > 0) Object.assign(b, { labelMean: buckets[g - 1].labelMean, labelDd5: buckets[g - 1].labelDd5, meanDelta: finite(buckets[g - 1].meanDelta) ? -buckets[g - 1].meanDelta : null }); });
    indicators[key] = { rule: description.split('. Outcome: ')[0], judged: judged ? { sessions: Number(judged[1]), first: judged[2], last: judged[3] } : null,
      baseline: baseline ? { n: integer(baseline[2]), pDd5: percent(baseline[8]) } : null, buckets };
  }
  return { kind: 'ci-markdown', precision: 'rounded-1pt', version, asOf, appRules: null, samples, chance, indicators };
}

// ---- results.json input --------------------------------------------------------------------------------------
const share = value => finite(value) ? round2(100 * value) : null;
/** The study's results.json (runStudy's output) as the builder's neutral shape, with exact values. */
export function fromResults(study) {
  const samples = { breadth: study?.inputs?.history ? { first: study.inputs.history.first, last: study.inputs.history.last, sessions: study.inputs.history.sessions, basis: study.inputs.history.basis } : null };
  for (const item of study?.inputs?.indices || []) samples[item.symbol] = { first: item.first, last: item.last, sessions: item.sessions, basis: item.source ?? null };
  const c = study?.tests?.chance, chance = { all: c?.available ? { actual: c.actual, median: c.robust.median, p95: c.robust.p95 } : null };
  for (const panel of c?.panels || []) if (panel.robust) chance[panel.panel] = { actual: panel.actual, median: panel.robust.median, p95: panel.robust.p95 };
  const indicators = {};
  for (const r of study?.indicators || []) {
    const win = r.available ? r.windows?.[HORIZON] ?? r.windows?.[String(HORIZON)] : null;
    const buckets = (win?.buckets || []).map((b, g, all) => {
      const source = b.role === 'complement' ? all[g - 1] : b;
      const estimate = finite(source?.mean?.est) ? (b.role === 'complement' ? -source.mean.est : source.mean.est) : null;
      return { label: b.label, n: b.n, episodes: b.episodes, firstHalfShare: share(b.firstHalfShare), pDd5: share(b.pDd5), complement: b.role === 'complement', meanDelta: estimate, labelMean: source?.mean?.label ?? null, labelDd5: source?.dd5?.label ?? null };
    });
    indicators[r.key] = { rule: r.rule, judged: r.available ? { sessions: r.judged, first: r.firstJudged, last: r.lastJudged } : null, baseline: win ? { n: win.baseline.n, pDd5: share(win.baseline.pDd5) } : null, buckets };
  }
  return { kind: 'results-json', precision: 'exact', version: study?.schema_version ?? null, asOf: study?.as_of_date ?? null, appRules: study?.method?.appRules ?? null, samples, chance, indicators };
}

// ---- the reference --------------------------------------------------------------------------------------------
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** Every refusal reason of a parsed study against the app's current definitions (empty when it may be built). */
export function refusals(parsed, definitions = studyDefinitions()) {
  const out = [];
  if (parsed.version !== STUDY_VERSION) out.push(`study version ${parsed.version} is not ${STUDY_VERSION}`);
  if (!isDay(parsed.asOf)) out.push('the study has no as-of date');
  if (parsed.kind === 'results-json') {
    const rules = parsed.appRules || {};
    if (rules.DISTRIBUTION_METHOD !== APP_RULES.DISTRIBUTION_METHOD) out.push(`distribution method ${rules.DISTRIBUTION_METHOD} is not ${APP_RULES.DISTRIBUTION_METHOD}`);
    if (rules.FOLLOW_THROUGH_METHOD !== APP_RULES.FOLLOW_THROUGH_METHOD) out.push(`follow-through method ${rules.FOLLOW_THROUGH_METHOD} is not ${APP_RULES.FOLLOW_THROUGH_METHOD}`);
    for (const name of ['DISTRIBUTION_WARN', 'SPLIT_RULE', 'ENV_RULES']) if (!same(rules[name], APP_RULES[name])) out.push(`appRules.${name} differs from the app's`);
  }
  for (const [key, definition] of Object.entries(definitions)) {
    const found = parsed.indicators[key];
    if (!found) { out.push(`${key} is missing`); continue; }
    // The rule text names the method id and window (e.g. the distribution method, the 280-session FTD window).
    if (definition.rule !== null && found.rule !== definition.rule) out.push(`${key} rule "${found.rule}" is not "${definition.rule}"`);
    if (!same(found.buckets.map(b => b.label), definition.buckets)) out.push(`${key} states differ from the study's current buckets`);
    if (definition.symbol && !found.baseline) out.push(`${key} has no h=${HORIZON} baseline`);
    for (const b of found.buckets) if (!b.labelDd5 || !b.labelMean) out.push(`${key} ${b.label} has no label`);
  }
  for (const name of INDICES) if (!parsed.samples[name]?.first || !parsed.samples[name]?.last) out.push(`${name} sample period is missing`);
  return out;
}

/** The versioned reference from a parsed study (fromResults / parseStudyMarkdown) and its source record. */
export function buildReference(parsed, source) {
  const definitions = studyDefinitions(), refused = refusals(parsed, definitions);
  if (refused.length) fail(`refused: ${refused.join('; ')}`);
  const indicators = {};
  for (const [key, definition] of Object.entries(definitions)) {
    if (!definition.symbol) continue;
    const found = parsed.indicators[key], ids = STATE_IDS[definition.suffix], two = found.buckets.length === 2;
    const states = {};
    found.buckets.forEach((b, g) => {
      const other = two ? found.buckets[1 - g] : null;
      states[ids[g]] = { label: b.label, n: b.n, episodes: b.episodes, pDd5: b.pDd5, firstHalfShare: b.firstHalfShare, labelDd5: b.labelDd5, labelMean: b.labelMean,
        meanDirection: meanDirection(b.labelMean, b.meanDelta), comparator: two ? 'other_state' : 'baseline', comparatorState: two ? ids[1 - g] : null, comparatorPDd5: two ? other.pDd5 : found.baseline.pDd5 };
    });
    indicators[key] = { judged: found.judged, baseline: found.baseline, states };
  }
  const breadth = {};
  for (const key of BREADTH_RULES) { const warning = parsed.indicators[key].buckets[0]; breadth[key] = { labelDd5: warning.labelDd5, labelMean: warning.labelMean }; }
  return {
    schema_version: REFERENCE_VERSION, study_version: parsed.version, study_as_of: parsed.asOf,
    source: { kind: parsed.kind, sha256: source.sha256, ci_run: source.ciRun ?? null, artifact: source.artifact ?? null, precision: parsed.precision, path: source.path ?? null },
    methods: { distribution: APP_RULES.DISTRIBUTION_METHOD, followThrough: APP_RULES.FOLLOW_THROUGH_METHOD, followThroughWindowSessions: FTD_WINDOW_SESSIONS },
    outcome: { horizonSessions: HORIZON, drawdownPercent: -5, statistic: 'share of sessions whose worst close within the next 21 sessions was 5% or more below the observed close' },
    samples: { '^GSPC': parsed.samples['^GSPC'], '^IXIC': parsed.samples['^IXIC'], breadth: parsed.samples.breadth },
    chance: parsed.chance,
    buckets: { ddGrades: DD_GRADES.map(([low, high]) => [low, high === Infinity ? null : high]), ddWarn: APP_RULES.DISTRIBUTION_WARN, nearHighPercent: APP_RULES.SPLIT_RULE.nearHighPercent,
      ftdRecentSessions: FTD_RECENT_SESSIONS, states: Object.fromEntries(Object.entries(STATE_IDS).map(([suffix, ids]) => [suffix, [...ids]])) },
    indicators, breadth,
  };
}

/** The 〔偏り〕 test of the market tab (marketRegimeReference.js biasTag), on a first-half share. */
const biased = value => finite(value) && (value >= BIAS_SHARE.atLeast || value <= BIAS_SHARE.atMost);

/**
 * Labels and mean directions must be equal, every share and first-half share within ±tolerance points, and no
 * first-half share may cross the 〔偏り〕 bounds (that flips a tag on screen). Returns { ok, drift: [{ key, state,
 * field, committed, fresh, within }], counts }, where counts.sizes is the number of states whose n or episodes
 * changed (information only: a later study has more sessions).
 */
export function compareReferences(committed, fresh, tolerance = TOLERANCE_POINTS) {
  const drift = [];
  let sizes = 0;
  const note = (key, state, field, a, b, within) => drift.push({ key, state, field, committed: a ?? null, fresh: b ?? null, within });
  for (const key of new Set([...Object.keys(committed?.indicators || {}), ...Object.keys(fresh?.indicators || {})])) {
    const a = committed?.indicators?.[key]?.states || {}, b = fresh?.indicators?.[key]?.states || {};
    for (const state of new Set([...Object.keys(a), ...Object.keys(b)])) {
      const x = a[state], y = b[state];
      if (!x || !y) { note(key, state, 'state', x ? 'present' : 'absent', y ? 'present' : 'absent', false); continue; }
      for (const field of ['labelDd5', 'labelMean', 'meanDirection']) if ((x[field] ?? null) !== (y[field] ?? null)) note(key, state, field, x[field], y[field], false);
      for (const field of ['pDd5', 'comparatorPDd5', 'firstHalfShare']) {
        if (x[field] === y[field]) continue;
        const both = finite(x[field]) && finite(y[field]);
        const flips = field === 'firstHalfShare' && biased(x[field]) !== biased(y[field]);
        note(key, state, field, x[field], y[field], both && !flips && Math.abs(x[field] - y[field]) <= tolerance + 1e-9);
      }
      if (x.n !== y.n || x.episodes !== y.episodes) sizes++;
    }
  }
  for (const key of new Set([...Object.keys(committed?.breadth || {}), ...Object.keys(fresh?.breadth || {})]))
    for (const field of ['labelDd5', 'labelMean']) if (committed?.breadth?.[key]?.[field] !== fresh?.breadth?.[key]?.[field]) note(key, 'warning', field, committed?.breadth?.[key]?.[field], fresh?.breadth?.[key]?.[field], false);
  return { ok: drift.every(d => d.within), drift, counts: { sizes } };
}

export function driftMarkdown(result, committed, fresh) {
  const lines = [`### Market-regime reference drift (diagnostic, never a gate)`, '',
    `Committed ${committed.schema_version} from ${committed.source?.kind} (study as of ${committed.study_as_of}, CI run ${committed.source?.ci_run ?? 'n/a'}) against a fresh build from ${fresh.source?.kind} (study as of ${fresh.study_as_of}). Labels and mean directions must be equal; shares and first-half shares within ±${TOLERANCE_POINTS} pt, without crossing the ${BIAS_SHARE.atMost}/${BIAS_SHARE.atLeast}% bias bounds.`, ''];
  if (!result.drift.length) lines.push('No drift: every label and share matches.');
  else {
    lines.push(`${result.ok ? 'Within tolerance' : '**Outside tolerance**'}: ${result.drift.length} difference(s).`, '', '| indicator | state | field | committed | fresh | within |', '|---|---|---|---|---|---|');
    for (const d of result.drift) lines.push(`| ${d.key} | ${d.state} | ${d.field} | ${d.committed ?? '—'} | ${d.fresh ?? '—'} | ${d.within ? 'yes' : 'no'} |`);
  }
  if (result.counts?.sizes) lines.push('', `Information only: n or episodes changed for ${result.counts.sizes} state(s).`);
  return `${lines.join('\n')}\n`;
}

export const serialize = reference => `${JSON.stringify(reference, null, 1)}\n`;
const repoPath = path => { const rel = relative(ROOT, resolve(path)); return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split('\\').join('/') : null; };

/** Read one input file into { parsed, source }. */
export async function readInput({ results, markdown, ciRun = null, artifact = null }) {
  if (Boolean(results) === Boolean(markdown)) fail('give exactly one of --results <results.json> or --markdown <ci-results.md>');
  const path = results || markdown, bytes = await readFile(path);
  const parsed = results ? fromResults(JSON.parse(bytes)) : parseStudyMarkdown(bytes.toString('utf8'));
  return { parsed, source: { sha256: sha256(bytes), ciRun, artifact, path: repoPath(path) } };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: { results: { type: 'string' }, markdown: { type: 'string' }, 'ci-run': { type: 'string' }, artifact: { type: 'string' },
    out: { type: 'string' }, check: { type: 'string' }, summary: { type: 'string' } } });
  const id = (value, name) => { if (value === undefined) return null; if (!/^\d+$/.test(value)) fail(`invalid --${name}`); return Number(value); };
  const { parsed, source } = await readInput({ results: values.results, markdown: values.markdown, ciRun: id(values['ci-run'], 'ci-run'), artifact: id(values.artifact, 'artifact') });
  const reference = buildReference(parsed, source);
  if (values.out) { await mkdir(dirname(resolve(values.out)), { recursive: true }); await writeFile(values.out, serialize(reference)); }
  if (values.check) {
    const committed = JSON.parse(await readFile(values.check, 'utf8')), result = compareReferences(committed, reference), text = driftMarkdown(result, committed, reference);
    process.stdout.write(text);
    if (values.summary) await writeFile(values.summary, text, { flag: 'a' });
    if (!result.ok) process.exitCode = 1;
  } else if (!values.out) process.stdout.write(serialize(reference));
  return reference;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error => { console.error(error?.message || String(error)); process.exit(1); });
