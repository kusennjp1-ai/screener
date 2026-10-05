// Exact replay of compiler-owned baseline outputs; no publication permission.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { digest } from './financial-correction.mjs';
import { safePath, sha256 } from './publication-state.mjs';
const read = (root, path) => { if (!safePath(path)) throw Error('Unsafe baseline derived path'); return JSON.parse(readFileSync(join(root, path))); };
const equal = (left, right, label) => { if (digest(left) !== digest(right)) throw Error(`Candidate derived replay failed: ${label}`); };
const moduleAt = (root, path) => import(pathToFileURL(join(root, path)).href);
// Same canonical byte sequence as financial-correction.digest, without one
// giant canonical string beside all live canonical detail objects.
export function digestCanonicalInput(value) {
  const output=createHash('sha256');
  const visit=value=>{
    if(Array.isArray(value)) {
      output.update('[');
      for(let index=0;index<value.length;index++){if(index)output.update(',');if(Object.hasOwn(value,index))visit(value[index]);}
      output.update(']');
    } else if(value&&typeof value==='object') {
      output.update('{');
      Object.keys(value).sort().forEach((key,index)=>{if(index)output.update(',');output.update(JSON.stringify(key));output.update(':');visit(value[key]);});
      output.update('}');
    } else {
      if(value===undefined || typeof value==='number'&&!Number.isFinite(value))throw Error('Noncanonical correction data');
      output.update(JSON.stringify(value));
    }
  };
  visit(value);return output.digest('hex');
}
export async function verifyCandidateDerivedOutputs(root, frontendRoot, manifest, wire, rows, {onStage=()=>{}}={}) {
  const entry = manifest.markets.US, now = entry.assets.research.financial_evaluated_at, day = entry.as_of_date;
  const [{ assess, rankCandidates, compareReference }, { buildPortfolioPlan }, { applicabilityUniverse }, quality, workbenchTools, summaries, { sectorStrength }, scanTools, { scanListRow }] = await Promise.all([
    moduleAt(frontendRoot, 'src/static/researchEngine.js'), moduleAt(frontendRoot, 'src/static/portfolioPlan.js'),
    moduleAt(frontendRoot, 'src/static/instrumentApplicability.js'), moduleAt(frontendRoot, 'tools/research-quality.mjs'),
    moduleAt(frontendRoot, 'tools/workbench-comparison.mjs'), moduleAt(frontendRoot, 'src/static/workbenchSummary.js'),
    moduleAt(frontendRoot, 'src/static/sectorStrength.js'), moduleAt(frontendRoot, 'src/static/scanClient.js'), moduleAt(frontendRoot, 'tools/scan-list-payload.mjs'),
  ]);
  const canonical = rows.map(row => {
    const detail = read(root, `static-data/${row.research_detail_path}`);
    if (detail.symbol !== row.symbol || detail.as_of_date !== day) throw Error('Canonical baseline identity/date mismatch');
    return detail;
  });
  onStage('canonical_details_loaded');
  quality.validateResearchListSummaries(wire, rows, now);
  quality.validatePublishedSummaries(canonical, now);
  quality.validateResearchParity(wire, canonical, now);
  onStage('canonical_transport_replayed');
  const metadata = Object.fromEntries(['financial_semantics', 'assessment_version', 'instrument_applicability_universe'].map(key => [key, entry.assets.research[key]]));
  equal(metadata.instrument_applicability_universe, applicabilityUniverse(canonical), 'canonical applicability universe');
  const audit = read(root, 'qualification-audit.json'), daily = read(root, 'research-daily.json'), portfolio = read(root, 'portfolio-model.json');
  for (const value of [audit, daily, portfolio]) {
    for (const [key, expected] of Object.entries(metadata)) equal(value[key], expected, `compiler metadata ${key}`);
    if (value.financial_evaluated_at !== now) throw Error('Mixed candidate derived evaluation time');
  }
  equal(audit.results, JSON.parse(JSON.stringify(canonical.map(row => ({ symbol: row.symbol, audit: row.technical_audit,
    methods: Object.fromEntries(['minervini', 'minervini2', 'ibd'].map(method => [method, assess(row, method, now)])) })))), 'qualification audit');
  const candidates = Object.fromEntries(['oneil', 'minervini', 'minervini2', 'ibd'].map(method => [method,
    rankCandidates(canonical, method, { liquidOnly: true, now }).filter(item => item.assessment.qualified).slice(0, 50)
      .map(({ row, assessment }) => ({ symbol: row.symbol, rs_estimate: row.rs_rating, passed: assessment.passed, total: assessment.total }))]));
  equal(daily.candidates, candidates, 'daily candidates');
  equal(daily.ibd_comparison, compareReference(candidates.ibd, read(root, 'ibd-reference.json'), day), 'IBD comparison');
  if (daily.rule_version !== 'research-v6-static-financial-current') throw Error('Unknown daily compiler policy');
  for (const [key, value] of Object.entries(buildPortfolioPlan(canonical, day, 100000, now))) equal(portfolio[key], JSON.parse(JSON.stringify(value)), `portfolio ${key}`);
  onStage('daily_audit_portfolio_replayed');
  const workbench = read(root, `static-data/${entry.assets.workbench.path}`), summary = read(root, `static-data/${entry.assets.workbench_summary.path}`);
  for (const [value, ref] of [[workbench, entry.assets.workbench], [summary, entry.assets.workbench_summary]]) {
    if (sha256(readFileSync(join(root, `static-data/${ref.path}`))) !== ref.sha256) throw Error('Candidate workbench digest mismatch');
    if (value.financial_evaluated_at !== now || value.financial_semantics !== metadata.financial_semantics) throw Error('Mixed workbench compiler evaluation');
  }
  await workbenchTools.verifyWorkbenchComparison({root: join(root, 'static-data'), workbench, canonicalRows: canonical});
  equal(summary, summaries.summarizeWorkbench(workbench, entry.assets.workbench), 'workbench summary');
  let prices=null; try {prices=read(root,'static-data/sector-prices.json');} catch(error) {if(error.code!=='ENOENT')throw error;}
  equal(workbench.sectors, sectorStrength(canonical, prices, day, now), 'sector calculations');
  onStage('workbench_and_sectors_replayed');
  const compactBySymbol = new Map(canonical.map((row,index)=>{
    const {book_diagnostics,book_technical_evidence,book_financials,...compact}=row;
    void book_diagnostics;void book_technical_evidence;void book_financials;
    compact.research_detail_path=rows[index].research_detail_path;
    return [row.symbol,compact];
  }));
  const checkAliases=(value,label,isListChunk=false)=>{
    for(const collection of ['rows','initial_rows','preview_rows','results','stocks','members']) if(Array.isArray(value[collection])) for(const row of value[collection]) {
      const compact=compactBySymbol.get(row.symbol);if(!compact)throw Error('Unknown candidate alias symbol');
      const expected=isListChunk || label==='top'&&collection==='preview_rows' ? scanListRow(compact) : compact;
      equal(row,expected,`canonical alias ${label}/${collection}/${row.symbol}`);
    }
  };
  const scan = read(root, `static-data/${entry.pages.scan.path}`);
  const ordered = scanTools.sortStaticScanRows(scanTools.filterStaticScanRows(canonical, scan.default_filters || {}, {now}), 'se_setup_score', 'desc', {now});
  for (const key of ['path', 'list_path']) if (entry.pages.scan[key]) {
    const value = read(root, `static-data/${entry.pages.scan[key]}`);
    equal(value.sort, {field:'se_setup_score',order:'desc'}, 'scan default sort');
    checkAliases(value,'top');
    for(const ref of value.chunks||[]) checkAliases(read(root,`static-data/${ref.path}`),ref.path,key==='list_path');
    for(const screen of value.preset_screens||[]) {
      const count=scanTools.filterStaticScanRows(canonical,screen.filters||{},{now}).length;
      if(screen.match_count!==(screen.limit?Math.min(count,screen.limit):count))throw Error('Candidate preset count mismatch');
    }
    equal(value.preview_rows.map(row => row.symbol), ordered.slice(0,10).map(row => row.symbol), 'scan preview order');
    equal(value.initial_rows.map(row => row.symbol), key === 'path' ? ordered.slice(0,50).map(row => row.symbol) : [], 'scan initial order');
    if (value.default_filtered_rows_total !== ordered.length) throw Error('Candidate scan filter count mismatch');
  }
  onStage('scan_aliases_replayed');
  const canonicalInputSha=digestCanonicalInput(canonical);
  onStage('canonical_input_hashed');
  return { canonical_rows: canonical.length, canonical_input_sha256: canonicalInputSha,
    replayed: ['qualification-audit.json', 'research-daily.json', 'portfolio-model.json', entry.assets.workbench.path, entry.assets.workbench_summary.path],
    workbench_rule_version: workbench.rule_version, comparison_basis: workbench.comparison_basis, scan_sort: {field:'se_setup_score',order:'desc'} };
}
