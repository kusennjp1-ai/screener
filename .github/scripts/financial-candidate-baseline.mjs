// Candidate compiler migration proof. This is only for unpublished previews;
// the publication/correction comparator is deliberately unchanged.
import { execFileSync } from 'node:child_process';
import { linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyCandidateDerivedOutputs } from './financial-candidate-baseline-derived.mjs';
import { dataInventory, digest } from './financial-correction.mjs';
import { comparePreviewDataIsolated, comparisonHeapArguments } from './financial-preview-comparison.mjs';
import { dataFiles, inventoryDigest, safePath, sha256 } from './publication-state.mjs';

const read = (root, path) => {
  if (!safePath(path)) throw Error('Unsafe candidate-baseline asset path');
  return JSON.parse(readFileSync(join(root, path), 'utf8'));
};
const equal = (a, b, label) => { if (digest(a) !== digest(b)) throw Error(`Candidate baseline changed ${label}`); };
const additions = ['financial_semantics', 'assessment_version', 'instrument_applicability_universe'];
function linkData(source, destination) {
  const visit = (directory, relative = '') => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = relative + entry.name;
      if (!safePath(path)) throw Error('Unsafe candidate-baseline inventory');
      if (entry.isDirectory()) {
        if (path === 'static-data' || path.startsWith('static-data/')) { mkdirSync(join(destination, path), { recursive: true }); visit(join(directory, entry.name), `${path}/`); }
      } else if (path.startsWith('static-data/') || dataFiles.includes(path)) {
        if (!entry.isFile()) throw Error('Candidate-baseline data contains a link or special file');
        linkSync(join(source, path), join(destination, path));
      }
    }
  };
  mkdirSync(destination); visit(source);
}
function rewrite(root, path, transform) {
  const value = read(root, path); transform(value);
  // Break the shadow's hard link before writing. Original audit bytes are never
  // changed by normalization or cleanup.
  unlinkSync(join(root, path)); writeFileSync(join(root, path), JSON.stringify(value));
}
async function verifyCompilerMetadata(frontendRoot, before, after, rows) {
  const { RULE_SUMMARY_VERSION } = await import(pathToFileURL(join(frontendRoot, 'src/static/researchEngine.js')).href);
  const { applicabilityUniverse } = await import(pathToFileURL(join(frontendRoot, 'src/static/instrumentApplicability.js')).href);
  const asset = after.markets.US.assets.research, prior = before.markets.US.assets.research;
  if (asset.assessment_version !== RULE_SUMMARY_VERSION || asset.financial_semantics !== 'current_at_evaluation_not_historical_publication'
    || !Number.isSafeInteger(asset.financial_evaluated_at) || asset.financial_evaluated_at > Date.now()) throw Error('Invalid candidate compiler evaluation identity');
  equal(asset.instrument_applicability_universe, applicabilityUniverse(rows), 'recomputed financial-applicability universe');
  for (const key of additions) if (Object.hasOwn(prior, key)) equal(prior[key], asset[key], `existing compiler metadata ${key}`);
  return Object.fromEntries(additions.map(key => [key, { before: { present: Object.hasOwn(prior, key), ...(Object.hasOwn(prior, key) ? { value: prior[key] } : {}) }, after: { present: true, value: asset[key] } }]));
}

async function normalizeResearchRows(beforeRoot, frontendRoot, before, after, previousRows, rows) {
  const day = before.markets.US.as_of_date;
  if (day !== after.markets.US.as_of_date) throw Error('Candidate baseline changed the global price date');
  const old = new Map(previousRows.map(row => [row.symbol, row])), normalized = [], wrappers = [], explicitDates = [];
  const added = rows.filter(row => row.instrument_identity !== undefined && old.get(row.symbol)?.instrument_identity === undefined);
  const approved = new Set(['BITU', 'ETHE', 'SBIT']);
  const rawSources = new Map(added.map(row => [row.symbol, []]));
  if (added.length) {
    const scanPath = `static-data/${before.markets.US.pages.scan.path}`, scan = read(beforeRoot, scanPath);
    const collect = (values, path) => { for (const row of values || []) if (rawSources.has(row.symbol)) rawSources.get(row.symbol).push({ row, path }); };
    const collections = (payload, path) => { for (const key of ['rows', 'initial_rows', 'preview_rows', 'results', 'stocks', 'members']) if (Array.isArray(payload[key])) collect(payload[key], path); };
    collections(scan, scanPath);
    for (const ref of scan.chunks || []) { const path = `static-data/${ref.path}`; collections(read(beforeRoot, path), path); }
  }
  const { instrumentIdentityEvidence } = await import(pathToFileURL(join(frontendRoot, 'src/static/instrumentApplicability.js')).href);
  for (const row of rows) {
    const prior = old.get(row.symbol);
    if (!prior || row.as_of_date !== day || (Object.hasOwn(prior, 'as_of_date') && prior.as_of_date !== day)) throw Error('Candidate baseline row price date is not the unchanged global date');
    const next = { ...row };
    if (!Object.hasOwn(prior, 'as_of_date')) explicitDates.push(row.symbol);
    if (row.instrument_identity !== undefined && prior.instrument_identity === undefined) {
      const wrapper = row.instrument_identity, expected = { symbol: row.symbol, market: 'US', company_name: prior.company_name };
      if (!approved.has(row.symbol) || typeof expected.company_name !== 'string' || !expected.company_name
        || Object.keys(wrapper).join('|') !== 'observed_contexts' || !Array.isArray(wrapper.observed_contexts) || wrapper.observed_contexts.length !== 1) throw Error('Unreviewed candidate identity wrapper');
      equal(wrapper.observed_contexts[0], expected, `exact observed identity wrapper ${row.symbol}`);
      const sources = rawSources.get(row.symbol);
      if (!sources?.length || !safePath(prior.research_detail_path)) throw Error('Candidate identity lacks original raw sources');
      const detailPath = `static-data/${prior.research_detail_path}`;
      const evidence = [{ row: prior, path: `static-data/${before.markets.US.assets.research.path}` }, { row: read(beforeRoot, detailPath), path: detailPath }, ...sources];
      for (const item of evidence) {
        if (item.row.symbol !== expected.symbol || (item.row.market ?? 'US') !== expected.market || item.row.company_name !== expected.company_name) throw Error('Candidate identity conflicts with original raw identity');
        for (const context of instrumentIdentityEvidence(item.row)) for (const [key, value] of Object.entries(context)) {
          if (key === 'symbol' || key === 'market') { if (value !== expected[key]) throw Error('Conflicting original identity context'); }
          else if (['company_name', 'name', 'product_name', 'observed_name'].includes(key)) { if (value !== expected.company_name) throw Error('Conflicting original observed name'); }
          else throw Error('Original identity has an unrepresented identifier or classification');
        }
      }
      wrappers.push({ symbol: row.symbol, before: { present: false }, after: wrapper,
        provenance: [...new Set(evidence.map(item => item.path))].map(path => ({ path, sha256: sha256(readFileSync(join(beforeRoot, path))) })) });
      delete next.instrument_identity;
    }
    normalized.push(next);
  }
  return { beforeRows: previousRows.map(row => ({ ...row, as_of_date: day })), afterRows: normalized,
    report: { inherited_price_date: day, explicit_row_date_symbols: explicitDates, observed_identity_wrappers: wrappers } };
}

function normalizeChartIdentity(before, after, identity) {
  const out = structuredClone(after), changes = [];
  if (before.symbol !== identity.symbol || after.symbol !== identity.symbol) throw Error('Candidate chart symbol conflicts with predecessor asset');
  for (const key of ['', 'stock_data', 'fundamentals']) {
    const prior = key ? before[key] : before, next = key ? out[key] : out;
    if (!next || typeof next !== 'object' || Array.isArray(next)) continue;
    if (!prior || typeof prior !== 'object' || Array.isArray(prior)) throw Error('Candidate chart added an unreviewed identity container');
    const contexts = [prior, prior.financial_identity, prior.instrument_identity, ...(prior.instrument_identity?.observed_contexts || []),
      prior.financial_source_evidence?.identity, prior.financial_history, prior.book_financials,
      prior.financial_historical?.financial_history, prior.financial_historical?.book_financials,
      prior.financial_historical?.source_evidence?.identity, prior.financial_historical?.detail_identity, prior.institutional_evidence].filter(value => value && typeof value === 'object');
    for (const context of contexts) {
      for (const field of ['symbol', 'market']) if (context[field] !== undefined && context[field] !== identity[field]) throw Error('Original chart identity conflicts with verified predecessor context');
      for (const field of ['company_name', 'name', 'product_name', 'observed_name']) if (context[field] !== undefined && context[field] !== identity.company_name) throw Error('Original chart has a conflicting observed name');
      for (const field of ['cusip', 'isin', 'cik', 'issuer_cik', 'quoteType', 'quote_type']) if (context[field] != null && context[field] !== '') throw Error('Original chart has an unrepresented observed identifier or classification');
      if (Object.keys(context.observed_identifiers || {}).length) throw Error('Original chart has unrepresented observed identifiers');
    }
    for (const field of ['market', 'symbol']) if (next[field] !== undefined) {
      if (next[field] !== identity[field]) throw Error('Candidate chart changed an inherited identity');
      if (prior[field] === undefined) { changes.push({ container: key || 'root', field, before: { present: false }, after: next[field] }); delete next[field]; }
    }
    if (next.instrument_identity !== undefined && prior.instrument_identity === undefined) {
      const wrapper = next.instrument_identity;
      if (!wrapper || Object.keys(wrapper).join('|') !== 'observed_contexts' || !Array.isArray(wrapper.observed_contexts) || wrapper.observed_contexts.length !== 1) throw Error('Unreviewed chart identity wrapper');
      const context = wrapper.observed_contexts[0], keys = Object.keys(context).sort();
      if (!['market|symbol', 'company_name|market|symbol'].includes(keys.join('|')) || context.market !== identity.market || context.symbol !== identity.symbol
        || (context.company_name !== undefined && (context.company_name !== identity.company_name || prior.company_name !== identity.company_name))) throw Error('Chart wrapper invented or changed an observed identity');
      changes.push({ container: key || 'root', field: 'instrument_identity', before: { present: false }, after: wrapper });
      delete next.instrument_identity;
    }
  }
  return { value: out, changes };
}

export const normalizeCandidateChartIdentity = normalizeChartIdentity;

function normalizeChartRepresentations(beforeRoot, afterRoot, before, after, wrapperReport) {
  const oldCharts = read(beforeRoot, `static-data/${before.markets.US.assets.charts.path}`), newCharts = read(afterRoot, `static-data/${after.markets.US.assets.charts.path}`);
  const result = [];
  for (const wrapper of wrapperReport) {
    const old = oldCharts.symbols.filter(item => item.symbol === wrapper.symbol), next = newCharts.symbols.filter(item => item.symbol === wrapper.symbol);
    if (!old.length && !next.length) continue;
    if (old.length !== 1 || next.length !== 1) throw Error('Missing or duplicate candidate chart identity');
    const beforePath = `static-data/${old[0].path}`, afterPath = `static-data/${next[0].path}`;
    const checked = normalizeChartIdentity(read(beforeRoot, beforePath), read(afterRoot, afterPath), wrapper.after.observed_contexts[0]);
    result.push({ afterPath, value: checked.value, report: { symbol: wrapper.symbol, before_path: beforePath, after_path: afterPath,
      original_sha256: sha256(readFileSync(join(beforeRoot, beforePath))), inherited_market: 'US', changes: checked.changes } });
  }
  return result;
}


function normalizeRowAliases(prior, candidate, before, after, previousRows, rows, wrapperReport, derivedReport) {
  const day = before.markets.US.as_of_date, oldRows = new Map(previousRows.map(row => [row.symbol, row]));
  const wrappers = new Map(wrapperReport.map(item => [item.symbol, item.after]));
  const report = [];
  const normalize = (row, side) => {
    if (!oldRows.has(row.symbol) || (row.as_of_date !== undefined && row.as_of_date !== day)) throw Error('Alias has an unverified symbol or price date');
    row.as_of_date = day;
    if (side === 'after' && wrappers.has(row.symbol) && row.instrument_identity !== undefined) {
      equal(row.instrument_identity, wrappers.get(row.symbol), `exact alias identity ${row.symbol}`);
      delete row.instrument_identity;
    }
  };
  const aliases = (root, path, side) => rewrite(root, path, value => {
    for (const key of ['rows', 'initial_rows', 'preview_rows', 'results', 'stocks', 'members']) if (Array.isArray(value[key])) {
      for (const row of value[key]) normalize(row, side);
      report.push({side, path, collection:key, rows:value[key].length, inherited_price_date:day});
    }
  });
  for (const key of ['path', 'list_path']) if (before.markets.US.pages.scan[key]) {
    const paths = [`static-data/${before.markets.US.pages.scan[key]}`, `static-data/${after.markets.US.pages.scan[key]}`];
    const scans = [read(prior, paths[0]), read(candidate, paths[1])];
    for (const [side, root, path, scan] of [['before',prior,paths[0],scans[0]],['after',candidate,paths[1],scans[1]]]) {
      aliases(root, path, side);
      for (const ref of scan.chunks || []) aliases(root, `static-data/${ref.path}`, side);
    }
    if (digest(scans[0].sort ?? null) !== digest(scans[1].sort ?? null)) {
      if (!derivedReport) throw Error('Candidate sort migration requires independent derived replay');
      equal(scans[0].sort,{field:'composite_score',order:'desc'},'reviewed predecessor default sort');
      equal(scans[1].sort,{field:'se_setup_score',order:'desc'},'reviewed candidate default sort');
      rewrite(candidate,paths[1],value=>{value.sort=scans[0].sort;});
      report.push({path:paths[1],field:'sort',before:scans[0].sort,after:scans[1].sort,reason:'quarantine_unverified_ratings_default_setup_sort'});
    }
  }
  const bySymbol = new Map(rows.map(row => [row.symbol,row]));
  for (const wrapper of wrapperReport) {
    const path = `static-data/${bySymbol.get(wrapper.symbol).research_detail_path}`;
    rewrite(candidate,path,value=>{if(value.symbol!==wrapper.symbol)throw Error('Detail wrapper symbol mismatch');if(value.instrument_identity!==undefined){equal(value.instrument_identity,wrapper.after,'canonical detail observed identity');delete value.instrument_identity;}});
    report.push({path,field:'instrument_identity',provenance:wrapper.provenance});
  }
  return report;
}
function normalizeDerivedMetadata(prior, candidate, before, after, replay) {
  if (!replay) return [];
  const report=[];
  const normalize = (beforePath,afterPath,keys,expected) => {
    const old=read(prior,beforePath),next=read(candidate,afterPath);
    for(const key of keys) {
      if(expected && Object.hasOwn(expected,key)) equal(next[key],expected[key],`replayed ${key}`);
      report.push({path:afterPath,key,before:{present:Object.hasOwn(old,key),value:old[key]??null},after:{present:Object.hasOwn(next,key),value:next[key]??null}});
    }
    rewrite(candidate,afterPath,value=>{for(const key of keys){if(Object.hasOwn(old,key))value[key]=old[key];else delete value[key];}});
  };
  const metadata=Object.fromEntries(additions.map(key=>[key,after.markets.US.assets.research[key]]));
  for(const path of ['research-daily.json','portfolio-model.json','qualification-audit.json']) {
    const old=read(prior,path),next=read(candidate,path);
    for(const key of additions) if(Object.hasOwn(old,key)) equal(old[key],next[key],`existing derived metadata ${path}/${key}`);
    normalize(path,path,additions,metadata);
  }
  const oldDaily=read(prior,'research-daily.json');
  if(!['research-v5-book-evidence','research-v6-static-financial-current'].includes(oldDaily.rule_version))throw Error('Unreviewed predecessor daily policy');
  normalize('research-daily.json','research-daily.json',['rule_version'],{rule_version:'research-v6-static-financial-current'});
  for(const key of ['workbench','workbench_summary']) {
    const beforePath=`static-data/${before.markets.US.assets[key].path}`,afterPath=`static-data/${after.markets.US.assets[key].path}`;
    normalize(beforePath,afterPath,['rule_version','financial_semantics','daily_changes_snapshot','comparison_basis'],
      {rule_version:replay.workbench_rule_version,financial_semantics:metadata.financial_semantics,comparison_basis:replay.comparison_basis});
  }
  return report;
}

// Complete normalization in a separate scope: decoded universes and chart
// objects must not stay live while the strict comparator loads both shadows.
export async function prepareBaselineComparison(beforeRoot, afterRoot, frontendRoot, prior, candidate, onStage) {
  const before = read(beforeRoot, 'static-data/manifest.json'), after = read(afterRoot, 'static-data/manifest.json');
  const { decodeResearchIndex } = await import(pathToFileURL(join(frontendRoot, 'src/static/researchTransport.js')).href);
  const beforeResearch = decodeResearchIndex(read(beforeRoot, `static-data/${before.markets.US.assets.research.path}`));
  const afterResearch = decodeResearchIndex(read(afterRoot, `static-data/${after.markets.US.assets.research.path}`));
  if (beforeResearch.as_of_date !== before.markets.US.as_of_date || afterResearch.as_of_date !== after.markets.US.as_of_date) throw Error('Candidate baseline research index date disagrees with its manifest');
  const rows = afterResearch.rows;
  const derivedReplay = before.markets.US.assets.workbench
    ? await verifyCandidateDerivedOutputs(afterRoot, frontendRoot, after, read(afterRoot, `static-data/${after.markets.US.assets.research.path}`), rows, {onStage}) : null;
  onStage('derived_replay_complete');
  const compiler = await verifyCompilerMetadata(frontendRoot, before, after, rows);
  const rowNormalization = await normalizeResearchRows(beforeRoot, frontendRoot, before, after, beforeResearch.rows, rows);
  const chartNormalization = normalizeChartRepresentations(beforeRoot, afterRoot, before, after, rowNormalization.report.observed_identity_wrappers);
  const beforeInventory = inventoryDigest(dataInventory(beforeRoot)), afterInventory = inventoryDigest(dataInventory(afterRoot));
  linkData(beforeRoot, prior); linkData(afterRoot, candidate);
  for (const root of [prior, candidate]) {
    rewrite(root, 'static-data/manifest.json', value => { for (const key of additions) delete value.markets.US.assets.research[key]; });
  }
  for (const [root, manifest, values] of [[prior, before, rowNormalization.beforeRows], [candidate, after, rowNormalization.afterRows]]) {
    const path = `static-data/${manifest.markets.US.assets.research.path}`;
    unlinkSync(join(root, path)); writeFileSync(join(root, path), JSON.stringify({ as_of_date: manifest.markets.US.as_of_date, rows: values }));
  }
  const aliasReport = normalizeRowAliases(prior, candidate, before, after, beforeResearch.rows, rows, rowNormalization.report.observed_identity_wrappers, derivedReplay);
  const derivedReport = normalizeDerivedMetadata(prior, candidate, before, after, derivedReplay);
  for (const chart of chartNormalization) { unlinkSync(join(candidate, chart.afterPath)); writeFileSync(join(candidate, chart.afterPath), JSON.stringify(chart.value)); }
  onStage('bounded_representations_normalized');
  return {
    evaluatedAt: new Date(after.markets.US.assets.research.financial_evaluated_at).toISOString(),
    cohort: { symbols: Object.fromEntries(rows.map(row => [row.symbol, {}])) },
    proof: { schema_version: 'unpublished-candidate-baseline-proof-v1', publication_authority: 'none', compiler,
      row_representation: rowNormalization.report, chart_representation: chartNormalization.map(chart => chart.report),
      alias_representation: aliasReport, derived_replay: derivedReplay, derived_metadata: derivedReport,
      before_inventory_sha256: beforeInventory, after_inventory_sha256: afterInventory,
      compiler_owned_paths: additions.map(key => `/markets/US/assets/research/${key}`) },
  };
}

export async function compareCandidateBaselineData(beforeRoot, afterRoot, frontendRoot, {onStage=()=>{},auditDirectory=null}={}) {
  const scratch = mkdtempSync(join(dirname(afterRoot), '.candidate-baseline-'));
  try {
    const prior = join(scratch, 'before'), candidate = join(scratch, 'after');
    const input = { schema_version:'financial-candidate-normalization-phase-v1', beforeRoot:resolve(beforeRoot), afterRoot:resolve(afterRoot), frontendRoot:resolve(frontendRoot), prior:resolve(prior), candidate:resolve(candidate),
      before_inventory_sha256:inventoryDigest(dataInventory(beforeRoot)), after_inventory_sha256:inventoryDigest(dataInventory(afterRoot)),
      evaluated_at:new Date(read(afterRoot,'static-data/manifest.json').markets.US.assets.research.financial_evaluated_at).toISOString(),
      compiler_replay_sha256:sha256(readFileSync(new URL('./financial-candidate-baseline-derived.mjs',import.meta.url))),
      normalization_sha256:sha256(readFileSync(fileURLToPath(import.meta.url))) };
    const worker=fileURLToPath(new URL('./financial-baseline-normalization-worker.mjs',import.meta.url));
    const envelope=JSON.parse(execFileSync(process.execPath,[...comparisonHeapArguments(process.execArgv),worker],{
      input:JSON.stringify(input),encoding:'utf8',maxBuffer:8*1024*1024,env:process.env,stdio:['pipe','pipe','pipe'],
    }));
    if(!envelope || Object.keys(envelope).sort().join('|')!=='input_sha256|result|result_sha256'
      || Object.keys(envelope.result||{}).sort().join('|')!=='cohort|evaluatedAt|proof|shadows'
      ||envelope.result.evaluatedAt!==input.evaluated_at ||envelope.input_sha256!==digest(input)||envelope.result_sha256!==digest(envelope.result)
      ||envelope.result.proof.before_inventory_sha256!==input.before_inventory_sha256
      ||envelope.result.proof.after_inventory_sha256!==input.after_inventory_sha256)throw Error('Baseline normalization phase binding mismatch');
    const { cohort, proof, evaluatedAt, shadows } = envelope.result;
    onStage('bounded_representations_normalized');
    const checked = comparePreviewDataIsolated(prior, candidate, frontendRoot, cohort, {evaluatedAt,originals:[beforeRoot,afterRoot],auditDirectory,expectedInventories:shadows});
    if(auditDirectory)writeFileSync(join(auditDirectory,'normalization-phase.json'),JSON.stringify({input,...envelope},null,2)+'\n');
    onStage('strict_comparison_complete');
    if (inventoryDigest(dataInventory(beforeRoot)) !== proof.before_inventory_sha256
      || inventoryDigest(dataInventory(afterRoot)) !== proof.after_inventory_sha256) throw Error('Candidate baseline input changed during verification');
    return { ...proof, semantic_sha256: checked.semantic_sha256, universe_sha256: checked.universe_sha256 };
  } finally { rmSync(scratch, { recursive: true, force: true }); }
}
