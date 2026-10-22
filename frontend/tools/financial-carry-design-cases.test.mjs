// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { isDeepStrictEqual } from 'node:util';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FINANCIAL_CARRY_DESIGN_CASES, financialCarryDesignScreens, financialCarryCaseSource, financialCarrySha256,
  verifyFinancialCarryClock, verifyFinancialCarryIdentity, verifyFinancialCarryExclusion, verifyFinancialCarryCsv, verifyFinancialCarryObservation,
  financialCarryBrowserBootstrap, verifyFinancialCarryTransportBinding, prepareFinancialCarryDesignBinding, verifyFinancialCarryMeasurementBinding,
  observeFinancialCarryUi, sealFinancialCarryDesignReport } from './financial-carry-design-cases.mjs';
import { bootstrap } from '../../.github/scripts/publication-state.mjs';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens, financialCaseSource } from './financial-design-cases.mjs';
import { withFinancialProof } from '../src/static/testFinancialFixture.js';
import { nativeAnnualFixture } from '../src/test/fixtures/nativeAnnual.js';
import { projectFinancialRow } from '../src/static/financialCurrent.js';
import { captureFinancialPublicationInput } from '../src/static/financialPublicationInput.js';
import { researchCsv, assess, rankCandidates } from '../src/static/researchEngine.js';
import { encodeResearchIndex, decodeResearchIndex, RESEARCH_METHODS } from '../src/static/researchTransport.js';
import { buildPortfolioPlan } from '../src/static/portfolioPlan.js';

// Synthetic unit fixtures only. The production harness has no fixture route,
// source substitution, historical clock override, or invented receipt data.
const date = '2026-10-02', prepared = Date.parse('2026-10-04T15:00:00Z'), now = Date.parse('2026-10-15T15:00:00Z');
const item = symbol => FINANCIAL_CARRY_DESIGN_CASES.find(value => value.symbol === symbol);
const row = (symbol = 'NVDA') => {
  const history = nativeAnnualFixture(symbol === 'FUTU' ? 'HKD' : 'USD');
  history.symbol = history.annual_source.symbol = symbol;
  return withFinancialProof({ symbol, market: 'US', as_of_date: date, technical_audit: { as_of_date: date },
    eps_growth_yy: 30, sales_growth_yy: 30, financial_history: history }, prepared, date);
};
const response = (bytes, resourceType = 'fetch', url = 'https://example.test/screener/') => ({
  ok: () => true, status: () => 200, body: async () => Buffer.from(bytes), url: () => url,
  request: () => ({ resourceType: () => resourceType }),
});
const fixtureBinding = () => ({ provenance_sha256: 'a'.repeat(64), ui_sha: 'b'.repeat(40), ui_digest: 'c'.repeat(64), baseline_ui_digest: '0'.repeat(64),
  logical_data_inventory_sha256: 'd'.repeat(64), physical_inventory_sha256: 'e'.repeat(64),
  manifest_sha256: financialCarrySha256('manifest'), publication_sha256: financialCarrySha256('publication'), transport_generation: 'f'.repeat(64) });

describe('supplemental carry evidence never replaces fresh acceptance', () => {
  it('keeps all 28 original fresh keys and adds 28 distinct same-symbol carry keys', () => {
    const keys = fn => [1440, 390].flatMap(width => ['dark', 'light'].flatMap(theme => fn({ width }, theme).map(screen => `${screen}/${width}/${theme}`)));
    const fresh = keys(financialDesignScreens), carry = keys(financialCarryDesignScreens);
    expect(fresh).toHaveLength(28); expect(carry).toHaveLength(28);
    expect(new Set([...fresh, ...carry]).size).toBe(56);
    expect(carry).toEqual(fresh.map(key => `carry-${key}`));
    expect(FINANCIAL_CARRY_DESIGN_CASES).toEqual(FINANCIAL_DESIGN_CASES);
    expect(FINANCIAL_CARRY_DESIGN_CASES.map(value => value.symbol)).toEqual(['NVDA', 'FUTU', 'AAOI', 'ALH', 'AVT']);
    expect(financialCarryDesignScreens({ width: 800 }, 'dark')).toEqual([]);
  });

  it('all five expired cases stay null/unknown with annual numbers withheld while fresh assertions still fail', () => {
    for (const value of FINANCIAL_CARRY_DESIGN_CASES) {
      const raw = row(value.symbol), before = JSON.stringify(raw);
      const projected = projectFinancialRow(raw, { now, asOfDate: date });
      const result = financialCarryCaseSource(projected, value, date, now);
      expect(result).toMatchObject({ satisfies_fresh_category: false, annual: [], annual_growth: null, annual_comparisons: [], annual_rule_state: 'unknown' });
      expect(Object.values(result.financial_fields).every(field => field.value === null && field.availability === 'unknown')).toBe(true);
      expect(result.original_observed_at).toBe(raw.financial_history.annual_source.observed_at);
      expect(result.selected_history_json_sha256).toBe(financialCarrySha256(JSON.stringify(raw.financial_history)));
      expect(JSON.stringify(raw)).toBe(before);
      expect(() => financialCaseSource(projected, value, date, now)).toThrow('unavailable or expired');
    }
  });

  it('requires the approved exclusion for every method after serialization as well as unknown annual values', () => {
    const raw = { ...row(), financial_generation: 'a'.repeat(64), financial_evaluated_at: now,
      financial_knowledge_basis: 'current_observation_at_source_capture', financial_point_in_time: false,
      financial_source_publication_date: null, financial_policy_version: 'financial-correction-native-annual-v1',
      financial_historical: { values: { eps_growth_yy: 999, sales_growth_yy: 999 } } };
    const json = value => JSON.parse(JSON.stringify(value));
    const lost = json(projectFinancialRow(raw, { now, asOfDate: date }));
    expect(assess(lost, 'oneil', now).rules.find(rule => rule.label.includes('3年')).state).toBe('unknown');
    expect(() => verifyFinancialCarryExclusion(lost, item('NVDA'), now)).toThrow('approved unknown exclusion');
    raw.financial_publication_input = captureFinancialPublicationInput(raw);
    const retained = json(projectFinancialRow(raw, { now, asOfDate: date }));
    expect(Object.keys(verifyFinancialCarryExclusion(retained, item('NVDA'), now))).toEqual(RESEARCH_METHODS);
    expect(financialCarryCaseSource(retained, item('NVDA'), date, now).financial_exclusions).toMatchObject({
      minervini: { status: 'excluded_unknown' }, minervini2: { status: 'excluded_unknown' },
      oneil: { status: 'excluded_unknown' }, ibd: { status: 'excluded_unknown' } });
  });

  it('rejects current evidence, missing/replaced history, wrong identities and invented case names', () => {
    expect(() => financialCarryCaseSource(row(), item('NVDA'), date, prepared)).toThrow('genuinely expired');
    for (const mutate of [value => { value.symbol = 'OTHER'; }, value => { value.as_of_date = '2026-10-01'; },
      value => { value.financial_history = null; }, value => { value.financial_history.annual = []; },
      value => { value.financial_history.annual_source.receipt_sha256 = 'bad'; },
      value => { value.financial_history.symbol = 'OTHER'; }, value => { value.financial_current.s = 'OTHER'; },
      value => { value.financial_current = null; }, value => { value.financial_current.r = 'malformed'; },
      value => { value.financial_current.t = now + 1; }, value => { value.financial_identity = { observed_scope: { symbol: 'OTHER' } }; }]) {
      const raw = row(); mutate(raw);
      expect(() => financialCarryCaseSource(raw, item('NVDA'), date, now)).toThrow();
    }
    expect(() => financialCarryCaseSource(row('OTHER'), { symbol: 'OTHER', category: 'ordinary-usd' }, date, now)).toThrow('substitutions');
    expect(() => financialCarryCaseSource(row(), { symbol: 'NVDA', category: 'invented' }, date, now)).toThrow('substitutions');
  });

  it('rejects summary/detail proof changes even when their timestamps match', () => {
    const summary = row(), detail = structuredClone(summary);
    expect(() => verifyFinancialCarryIdentity(summary, detail, item('NVDA'), date)).not.toThrow();
    for (const mutate of [value => { value.symbol = 'FUTU'; }, value => { value.as_of_date = '2026-10-01'; },
      value => { value.market = 'JP'; }, value => { value.financial_current.p['1'][0] += 1; },
      value => { value.financial_history.annual_source.receipt_sha256 = 'c'.repeat(64); }]) {
      const changed = structuredClone(detail); mutate(changed);
      expect(() => verifyFinancialCarryIdentity(summary, changed, item('NVDA'), date)).toThrow();
    }
  });

  it('requires the same full history inputs for the five named availability exceptions', () => {
    const detail = row();
    detail.financial_history.quarterly = [{ end: '2026-06-30', eps: 1, revenue: 20 }];
    detail.financial_history.annual.forEach(point => { point.revenue = 100; point.netIncome = null; });
    const summary = structuredClone(detail);
    expect(() => verifyFinancialCarryIdentity(summary, detail, item('NVDA'), date)).not.toThrow();
    const omitted = structuredClone(summary);
    delete omitted.financial_history.quarterly;
    expect(() => verifyFinancialCarryIdentity(omitted, detail, item('NVDA'), date)).toThrow('history differ');
    const changed = structuredClone(detail);
    changed.financial_history.quarterly[0].eps += 1;
    expect(() => verifyFinancialCarryIdentity(summary, changed, item('NVDA'), date)).toThrow('history differ');
    detail.financial_history.annual[0].eps += 1;
    expect(() => verifyFinancialCarryIdentity(summary, detail, item('NVDA'), date)).toThrow('history differ');
  });

  it('compares every expired case after the real mixed-universe transport roundtrip', () => {
    const details = FINANCIAL_CARRY_DESIGN_CASES.map(value => row(value.symbol));
    const ordinary = row('OTHER');
    const before = JSON.stringify(details);
    // Ordinary rows use compact histories. Their columns establish a different
    // property insertion order when the full five-symbol histories are decoded.
    const wire = JSON.parse(JSON.stringify(encodeResearchIndex({ as_of_date: date, rows: [ordinary, ...details] })));
    const summaries = decodeResearchIndex(wire).rows.slice(1);
    for (const [index, detail] of details.entries()) {
      const summary = summaries[index], value = item(detail.symbol);
      expect(JSON.stringify(summary.financial_history)).not.toBe(JSON.stringify(detail.financial_history));
      expect(isDeepStrictEqual(summary.financial_history, detail.financial_history)).toBe(true);
      expect(() => verifyFinancialCarryIdentity(summary, detail, value, date)).not.toThrow();
      expect(financialCarryCaseSource(summary, value, date, now).annual_rule_state).toBe('unknown');
      for (const method of RESEARCH_METHODS) {
        expect(assess(summary, method, now)).toEqual(assess(detail, method, now));
        expect(assess(summary, method, now)).toMatchObject({ qualified: false,
          financial_exclusion: { status: 'excluded_unknown', label: '財務未確認・判定対象外' } });
        expect(rankCandidates([summary], method, { qualifiedOnly: true, now })).toEqual([]);
      }
      const plan = buildPortfolioPlan([summary], date, 100000, now);
      expect(plan.positions).toEqual([]); expect(plan.dailyPositions).toEqual([]);
    }
    expect(JSON.stringify(details)).toBe(before);
  });

  it.each([
    ['receipt', value => { value.annual_source.receipt_sha256 = 'c'.repeat(64); }],
    ['clock', value => { value.retrieved_at = '2026-10-05T11:00:00.000Z'; }],
    ['currency', value => { value.currency = 'JPY'; }],
    ['period', value => { value.annual[0].end = '2021-12-31'; }],
    ['EPS', value => { value.annual[0].eps += .0000000000001; }],
    ['array order', value => { value.annual.reverse(); }],
    ['quarterly omission', value => { delete value.quarterly; }],
    ['nested presence', value => { value.quarterly_retrieved_at = undefined; }],
    ['signed zero', value => { value.annual[0].revenue = -0; }],
  ])('rejects changed %s after transport reconstruction despite reordered object keys', (_, mutate) => {
    const detail = row();
    detail.financial_history.annual[0].revenue = 0;
    const wire = JSON.parse(JSON.stringify(encodeResearchIndex({ as_of_date: date, rows: [row('OTHER'), detail] })));
    const summary = decodeResearchIndex(wire).rows[1];
    mutate(summary.financial_history);
    expect(() => verifyFinancialCarryIdentity(summary, detail, item('NVDA'), date)).toThrow('history differ');
  });

  it('keeps fresh harness and objective gates active and independently accounts for supplemental captures', () => {
    const harness = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
    const cases = readFileSync(new URL('./financial-carry-design-cases.mjs', import.meta.url), 'utf8');
    expect(harness).toContain('await verifyFinancialCases({ page, viewport, theme, capture, check, report, currentUrl: current.url, output });');
    expect(harness).toContain('...financialDesignScreens(viewport, theme)');
    expect(harness).toContain('carryProvenancePath ? financialCarryDesignScreens(viewport, theme) : []');
    expect(harness).toContain('if (report.failures.length) process.exitCode = 1;');
    expect(harness).toContain('DESIGN_CARRY_PREVIEW_PROVENANCE');
    expect(cases).toContain('path: entry.assets.research.path, action: () => page.reload()');
    expect(cases).toContain('await assets.observeJson(page, path, action)');
    expect(cases).toContain('tables === 0');
    expect(cases).toContain('await download.createReadStream()');
    expect(cases).not.toContain('page.route(');
    expect(cases).not.toContain('Date.now =');
    expect(cases).toContain("await capture(page, viewport, theme, screen, { scope: 'scrolled-viewport', viewportTargets });");
  });
});

describe('actual browser time, downloaded CSV and transport identity', () => {
  it('requires clocks within 90 seconds of actual browser time, in both directions', () => {
    expect(verifyFinancialCarryClock(new Date(now).toISOString(), now + 89999, 'Test')).toBe(now);
    for (const clock of [now - 90000, now + 90000, NaN]) expect(() => verifyFinancialCarryClock(new Date(now).toISOString(), clock, 'Test')).toThrow('not current');
    expect(() => verifyFinancialCarryClock('not a date', now, 'Test')).toThrow();
  });
  it('binds actual CSV bytes to the exact named row, canonical export and its evaluation time', () => {
    const summary = row(), bytes = Buffer.from(researchCsv([{ row: summary }], 'oneil', date, now));
    const args = { bytes, summary, item: item('NVDA'), date, browserNow: now + 1000, annualState: 'unknown' };
    expect(verifyFinancialCarryCsv(args)).toMatchObject({ sha256: financialCarrySha256(bytes), bytes: bytes.length, row: { symbol: 'NVDA', annual_eps_rule_state: 'unknown', annual_eps_reporting_currency: '' } });
    for (const changed of [Buffer.from(bytes.toString().replace('NVDA', 'FUTU')), Buffer.from(bytes.toString().replace('oneil', 'ibd')),
      Buffer.from(bytes.toString().replace('current_at_evaluation_not_historical_publication', 'historical')),
      Buffer.from(`${bytes.toString()}\r\n${bytes.toString().split('\r\n')[1]}`)]) expect(() => verifyFinancialCarryCsv({ ...args, bytes: changed })).toThrow();
    expect(() => verifyFinancialCarryCsv({ ...args, browserNow: now + 90000 })).toThrow('not current');
    expect(() => verifyFinancialCarryCsv({ ...args, annualState: 'pass' })).toThrow('withhold');
  });
  it('rejects logical bytes or physical identity outside the verified preview generation', () => {
    const binding = { ...fixtureBinding(), logical_files: { 'static-data/detail.json': { sha256: 'a'.repeat(64), bytes: 50 } }, physical_files: { 'static-data/_transport/gzip/a.gz': { sha256: 'b'.repeat(64), bytes: 40 } } };
    const observation = { logical_path: 'static-data/detail.json', physical_path: 'static-data/_transport/gzip/a.gz', decoded_sha256: 'a'.repeat(64), decoded_bytes: 50,
      encoded_sha256: 'b'.repeat(64), encoded_bytes: 40, transport_generation: binding.transport_generation, source: 'actual browser response' };
    expect(() => verifyFinancialCarryObservation(observation, binding)).not.toThrow();
    for (const changed of [{ decoded_sha256: 'c'.repeat(64) }, { decoded_bytes: 51 }, { encoded_sha256: 'c'.repeat(64) }, { encoded_bytes: 41 }, { physical_path: 'other.gz' }, { logical_path: 'other.json' }, { transport_generation: 'd'.repeat(64) }, { source: 'fixture' }]) expect(() => verifyFinancialCarryObservation({ ...observation, ...changed }, binding)).toThrow();
  });
  it('checks actual browser bootstrap bytes, never a caller label', async () => {
    const binding = fixtureBinding();
    expect(await financialCarryBrowserBootstrap(response('manifest'), response('publication'), binding)).toMatchObject({ source: 'actual browser response', publication_sha256: binding.publication_sha256 });
    await expect(financialCarryBrowserBootstrap(response('changed'), response('publication'), binding)).rejects.toThrow('bytes differ');
    await expect(financialCarryBrowserBootstrap(response('manifest'), null, binding)).rejects.toThrow('missing');
  });
});

describe('preview provenance and physical/UI/report binding', () => {
  it('rejects baseline UI swaps independently of unchanged data and current UI', () => {
    const before = fixtureBinding();
    expect(() => verifyFinancialCarryMeasurementBinding(before, { ...before })).not.toThrow();
    for (const field of ['baseline_ui_digest', 'provenance_sha256', 'physical_inventory_sha256']) {
      expect(() => verifyFinancialCarryMeasurementBinding(before, { ...before, [field]: '9'.repeat(64) })).toThrow('changed during browser measurement');
    }
    expect(() => verifyFinancialCarryMeasurementBinding({ ...before, baseline_ui_digest: undefined }, { ...before, baseline_ui_digest: undefined })).toThrow();
    const harness = readFileSync(new URL('./design-review.mjs', import.meta.url), 'utf8');
    expect(harness).toContain('verifyFinancialCarryMeasurementBinding(carryBinding, finalBinding);');
  });
  const transportFixture = () => {
    const hash = character => character.repeat(64), commit = 'a'.repeat(40), generation = hash('b'), lineage = hash('c'), uiDigest = hash('d'), provenanceHash = hash('e'), baselineDigest = hash('f');
    const manifestBytes = Buffer.from(JSON.stringify({ financial_generation: generation })), manifestHash = financialCarrySha256(manifestBytes);
    const provenance = { schema: 'design-financial-carry-preview-v1', publication_authority: 'none', financial_admission: false, ui_sha: commit, financial_generation: generation, financial_lineage_sha256: lineage, logical_data_inventory_sha256: baselineDigest };
    const publication = { schema: 'static-json-transport-preview-v1', publication_authority: 'none', ui_sha: commit, ui_digest: uiDigest, data_manifest_sha256: manifestHash,
      transport: { schema_version: 'static-json-transport-publication-v1', ui_sha: commit, ui_digest: uiDigest, logical_data_inventory_sha256: baselineDigest, physical_inventory_sha256: hash('0'),
        root: { path: `static-data/_transport/root-${hash('1')}.json`, bytes: 100, sha256: hash('1'), generation: hash('2'),
          bindings: { manifestSha256: manifestHash, uiInventorySha256: uiDigest, financialGeneration: generation, financialLineageSha256: lineage, sourceCommit: commit, appCommit: commit, candidateId: provenanceHash } } } };
    return { provenance, publication, manifestBytes, uiDigest, commit, provenanceHash, baselineDigest };
  };
  it('checks exact provenance, checkout, generation, lineage, UI digest and full baseline/current data equality', () => {
    expect(() => verifyFinancialCarryTransportBinding(transportFixture())).not.toThrow();
    for (const mutate of [value => { value.provenance.publication_authority = 'publish'; }, value => { value.provenance.financial_admission = true; },
      value => { value.provenance.schema = 'other'; }, value => { value.provenance.ui_sha = 'b'.repeat(40); },
      value => { value.provenance.financial_generation = '9'.repeat(64); }, value => { value.provenance.financial_lineage_sha256 = '9'.repeat(64); },
      value => { value.provenanceHash = '9'.repeat(64); }, value => { value.baselineDigest = '9'.repeat(64); },
      value => { value.uiDigest = '9'.repeat(64); }, value => { value.manifestBytes = Buffer.from('{}'); },
      value => { value.publication.transport.root.bindings.sourceCommit = '9'.repeat(40); },
      value => { value.publication.transport.logical_data_inventory_sha256 = '9'.repeat(64); }]) {
      const value = transportFixture(); mutate(value); expect(() => verifyFinancialCarryTransportBinding(value)).toThrow();
    }
  });
  it('browser preflight uses the producer closed schema, including caller and assessment evidence', async () => {
    const output = await mkdtemp(join(tmpdir(), 'carry-schema-test-'));
    try {
      const fixture = transportFixture(), hash = 'a'.repeat(64), code = fixture.commit, identity = `1/1/${hash}/${hash}`;
      const instant = new Date(Date.now() - 1000).toISOString();
      const paths = ['state.json', 'attempt.json', 'source/artifact.zip', 'source/artifact.tar', 'companion/artifact.zip', 'companion/source.json',
        'predecessor.json', 'history-responses.json', 'target-base.json', 'carry-projection.json', 'history-reconciliation.json', 'quality.log', 'retained-universe.json', 'assessment.json'];
      const record = { ...fixture.provenance, ui_tree: code, baseline_sha: code, baseline_tree: code, source_financial_generation: hash,
        previous_publication_identity: identity, timestamps: { prepared_at: instant, verified_at: instant },
        caller: { repository: bootstrap.repository, run_id: 3, run_attempt: 1, event: 'pull_request', head_sha: code, checkout_sha: code, started_at: instant },
        source: { artifact_id: 1, run_id: 2, run_attempt: 1, head_sha: code, artifact_sha256: hash, manifest_sha256: hash },
        live: { identity, receipt_sha256: hash, manifest_sha256: hash, financial_generation: hash, root_sha256: hash },
        evidence: { files: Object.fromEntries(paths.map(path => [path, hash])), source_input_sha256: hash, predecessor_history_sha256: hash, baseline_sha256: hash, audit_inventory_sha256: hash },
        assessment: { compatibility: hash, equality: hash, retained_universe: hash } };
      const provenancePath = join(output, 'provenance.json'), args = { provenancePath, currentRoot: output, baselineRoot: output, commit: code };
      await writeFile(provenancePath, JSON.stringify(record));
      // Shape validation succeeds, then absent actual assets must still block.
      await expect(prepareFinancialCarryDesignBinding(args)).rejects.toThrow('ENOENT');
      for (const mutate of [value => { delete value.caller; }, value => { value.caller.checkout_sha = 'f'.repeat(40); },
        value => { delete value.evidence.files['assessment.json']; }, value => { value.assessment.equality = true; }]) {
        const changed = structuredClone(record); mutate(changed); await writeFile(provenancePath, JSON.stringify(changed));
        await expect(prepareFinancialCarryDesignBinding(args)).rejects.toThrow(/closed Design carry|caller|assessment/i);
      }
    } finally { await rm(output, { recursive: true, force: true }); }
  });
  it('hashes actual loaded UI bytes and rejects changed or unpinned code', async () => {
    const page = new EventEmitter(), failures = [], report = {}, binding = { ...fixtureBinding(), ui_files: { 'index.html': financialCarrySha256('html'), 'assets/main.js': financialCarrySha256('js') } };
    const done = observeFinancialCarryUi({ page, currentUrl: 'https://example.test/screener/', binding, check: (valid, message) => { if (!valid) failures.push(message); }, report, viewport: { width: 1440 }, theme: 'dark' });
    page.emit('response', response('html', 'document'));
    page.emit('response', response('js', 'script', 'https://example.test/screener/assets/main.js'));
    page.emit('response', response('tamper', 'script', 'https://example.test/screener/assets/main.js'));
    page.emit('response', response('unexpected', 'script', 'https://example.test/screener/assets/extra.js'));
    await done();
    expect(failures).toHaveLength(2);
    expect(failures.join(' ')).toContain('changed'); expect(failures.join(' ')).toContain('unpinned');
    expect(report.financial_carry_browser_ui[0].observations).toHaveLength(2);
    expect(page.listenerCount('response')).toBe(0);
  });
  it('seals exact screenshots and the complete report without clearing fresh failures or assigning scores', async () => {
    const output = await mkdtemp(join(tmpdir(), 'carry-report-test-'));
    try {
      const bytes = Buffer.from('synthetic screenshot bytes for hash test only');
      const csv = Buffer.from('synthetic CSV bytes for hash test only');
      const report = { screens: [{ key: 'carry-financial-NVDA-evidence/1440/dark', screenshot: 'fixture.png', sha256: financialCarrySha256(bytes) }],
        financial_carry_cases: [{ csv: { artifact: 'fixture.csv', sha256: financialCarrySha256(csv), bytes: csv.length } }], failures: ['Original NVDA fresh category failed'] };
      await writeFile(join(output, 'fixture.png'), bytes); await writeFile(join(output, 'fixture.csv'), csv); await writeFile(join(output, 'report.json'), JSON.stringify(report));
      const sealed = await sealFinancialCarryDesignReport({ report, output, binding: fixtureBinding() });
      expect(sealed).toMatchObject({ objective_failures: 1, satisfies_fresh_categories: false, publication_authority: 'none', financial_admission: false });
      expect(sealed.report_sha256).toBe(financialCarrySha256(await readFile(join(output, 'report.json'))));
      expect(report.failures).toEqual(['Original NVDA fresh category failed']);
      expect(sealed).not.toHaveProperty('scores');
      expect(sealed.downloads['fixture.csv'].sha256).toBe(financialCarrySha256(csv));
      await writeFile(join(output, 'fixture.csv'), 'replaced');
      await expect(sealFinancialCarryDesignReport({ report, output, binding: fixtureBinding() })).rejects.toThrow('changed after download');
      await writeFile(join(output, 'fixture.csv'), csv);
      await writeFile(join(output, 'fixture.png'), 'replaced');
      await expect(sealFinancialCarryDesignReport({ report, output, binding: fixtureBinding() })).rejects.toThrow('changed after capture');
    } finally { await rm(output, { recursive: true, force: true }); }
  });
});
