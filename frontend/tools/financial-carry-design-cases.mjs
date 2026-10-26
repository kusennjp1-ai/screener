// Supplemental evidence only. These cases never satisfy the original fresh
// categories, change a financial helper, or choose replacement symbols.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeResearchIndex, researchListRow, RESEARCH_METHODS } from '../src/static/researchTransport.js';
import { currentFinancialHistory, mergeFinancialDetail, projectFinancialRow, FINANCIAL_FIELDS } from '../src/static/financialCurrent.js';
import { annualHistoryMetadataValid, financialHistoryDeadlines } from '../src/static/financialHistory.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../src/static/financialEvidencePresentation.js';
import { assess, researchCsv } from '../src/static/researchEngine.js';
import { isFinancialPublicationExclusion, FINANCIAL_PUBLICATION_EXCEPTION } from '../src/static/financialPublicationException.js';
import { entryReadiness } from '../src/static/entryReadiness.js';
import { modelMarket } from '../src/static/portfolioPlan.js';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens, parseFinancialCsv } from './financial-design-cases.mjs';
import { scrollFinancialViewport } from './financial-viewport-geometry.mjs';
import { createDesignAssetObserver } from './design-static-assets.mjs';
import { dataInventoryDigest, inventoryDigest, uiInventory } from '../../.github/scripts/publication-state.mjs';
import { validateTransportPreview, verifyTransportPublication } from '../../.github/scripts/static-transport-publication.mjs';

export const FINANCIAL_CARRY_DESIGN_CASES = Object.freeze(FINANCIAL_DESIGN_CASES.map(item => Object.freeze({ ...item })));
export const financialCarryDesignScreens = (viewport, theme) => financialDesignScreens(viewport, theme).map(screen => `carry-${screen}`);
export const financialCarrySha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const ready = locator => locator.waitFor({ state: 'visible', timeout: 60000 });
const requireValue = (value, message) => { if (!value) throw Error(message); };
const stateText = { pass: '✓ 通過', fail: '× 未達', unknown: '? 未確認', reference: '参考・取得済み', not_applicable: '対象外' };
const purchaseStateText = { pass: '通過', fail: '未達', unknown: '未確認', not_applicable: '対象外' };
const normalize = text => text.replace(/\s+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const namedCase = item => requireValue(FINANCIAL_CARRY_DESIGN_CASES.some(value => value.symbol === item?.symbol && value.category === item.category), 'Unknown named financial carry case; substitutions are prohibited');

export function verifyFinancialCarryClock(evaluatedAt, browserNow, label) {
  const now = Date.parse(evaluatedAt);
  requireValue(Number.isFinite(browserNow) && Number.isFinite(now) && Math.abs(browserNow - now) < 90000, `${label} evaluation clock is missing or not current`);
  return now;
}

export function verifyFinancialCarryIdentity(summary, detail, item, date) {
  namedCase(item);
  requireValue(summary?.symbol === item.symbol && detail?.symbol === item.symbol && summary.as_of_date === date && detail.as_of_date === date,
    'Browser detail/research symbol/date mismatch');
  requireValue(summary.market === 'US' && (!detail.market || detail.market === summary.market), 'Browser financial market mismatch');
  requireValue(Number.isFinite(summary.financial_current?.t) && same(detail.financial_current, summary.financial_current),
    'Browser detail and research financial proofs do not match');
  // Transport reconstructs object keys in shared column order. Compare every
  // retained value, own field and array position without treating that key order
  // as a data change. Exact detail bytes stay pinned by the asset observer.
  requireValue(summary.financial_history && detail.financial_history &&
    isDeepStrictEqual(researchListRow(summary).financial_history, researchListRow(detail).financial_history), 'Browser detail and research financial history differ');
}

export function verifyFinancialCarryExclusion(row, item, now) {
  namedCase(item);
  const exclusions = Object.fromEntries(RESEARCH_METHODS.map(method => {
    const result = assess(row, method, now), exclusion = result.financial_exclusion;
    requireValue(result.qualified === false && isFinancialPublicationExclusion(exclusion) && exclusion.symbol === item.symbol,
      `${item.symbol}/${method}: expired carry must retain the approved unknown exclusion`);
    return [method, exclusion];
  }));
  requireValue(Object.values(exclusions).every(value => isDeepStrictEqual(value, exclusions[RESEARCH_METHODS[0]])),
    `${item.symbol}: financial exclusions differ across methods`);
  return exclusions;
}

export function financialCarryCaseSource(row, item, date, now = Date.now()) {
  namedCase(item);
  requireValue(row?.symbol === item.symbol && row.as_of_date === date && row.market === 'US', `${item.symbol}: carry source identity/date mismatch`);
  requireValue(Number.isFinite(now) && date <= new Date(now).toISOString().slice(0, 10), 'Invalid current carry evaluation clock');
  const current = projectFinancialRow(row, { now, asOfDate: date });
  requireValue(current.financial_current?.s === item.symbol && current.financial_current.m === 'US' && current.financial_current.a === date &&
    Number.isFinite(current.financial_current.t) && current.financial_current.t <= now, `${item.symbol}: carry financial proof identity/clock mismatch`);
  requireValue(current.instrument_applicability.status === 'unverified', `${item.symbol}: identity-conflicting or noncorporate evidence is not an expired carry case`);
  const data = current.financial_history;
  const history = currentFinancialHistory(data, item.symbol, date, now, current);
  const deadlines = financialHistoryDeadlines(data);
  requireValue(data?.symbol === item.symbol && data.as_of_date === date && data.status === 'available' && data.basis === 'reported_diluted_eps' &&
    typeof data.source === 'string' && data.source.trim() && !/^(unknown|unavailable|n\/a|未確認|未取得)$/i.test(data.source.trim()) &&
    annualHistoryMetadataValid(data, item.symbol) && data.annual?.length > 0 && deadlines.length > 0 && deadlines.every(time => time < now),
  `${item.symbol}: original sourced annual evidence must be present and genuinely expired`);
  requireValue(!history.valid && history.annual.length === 0 && history.quarterly.length === 0 && history.annualGrowth === null && history.annualComparisons.length === 0,
    `${item.symbol}: expired annual history must remain withheld`);
  const fields = current.financial_current_state.fields;
  requireValue(Object.values(fields).every(field => !['invalid_evaluation_context', 'identity_mismatch', 'invalid_envelope', 'future_source_timestamp', 'invalid_source_inputs'].includes(field.reason)),
    `${item.symbol}: malformed proof cannot establish expired carry evidence`);
  requireValue(FINANCIAL_FIELDS.every(field => current[field] === null && fields[field].value === null && fields[field].availability === 'unknown'),
    `${item.symbol}: expired carry cannot restore financial values or availability`);
  const annualRule = assess(current, 'oneil', now).rules.find(rule => rule.label.includes('3年'));
  requireValue(annualRule?.state === 'unknown', `${item.symbol}: expired annual rule must remain unknown`);
  const exclusions = verifyFinancialCarryExclusion(current, item, now);
  return { category: item.category, evidence_kind: 'expired-original-source', satisfies_fresh_category: false,
    financial_exclusions: exclusions,
    selected_history_json_sha256: financialCarrySha256(JSON.stringify(data)), current_use_proof_json_sha256: financialCarrySha256(JSON.stringify(current.financial_current ?? null)),
    original_annual_periods: data.annual.length, original_source: data.source, original_observed_at: data.annual_source?.observed_at || data.retrieved_at,
    original_history_deadlines: deadlines.map(time => new Date(time).toISOString()), currency: data.annual_currency || data.currency,
    annual: history.annual, annual_complete: history.annualComplete, annual_growth: history.annualGrowth, annual_comparisons: history.annualComparisons,
    annual_rule_state: annualRule.state, quarterly_eps: fields.eps_growth_yy, quarterly_sales: fields.sales_growth_yy,
    financial_fields: fields, evaluated_at: new Date(now).toISOString() };
}

export function verifyFinancialCarryCsv({ bytes, summary, item, date, browserNow, annualState }) {
  namedCase(item);
  requireValue(summary?.symbol === item.symbol && summary.as_of_date === date, 'CSV source symbol/date mismatch');
  const exported = parseFinancialCsv(Buffer.from(bytes).toString('utf8'));
  const matches = exported.rows.filter(row => row.symbol === item.symbol);
  requireValue(matches.length === 1, `${item.symbol}: CSV must contain exactly one matching symbol`);
  const now = verifyFinancialCarryClock(matches[0].financial_evaluated_at, browserNow, 'CSV');
  const canonical = parseFinancialCsv(researchCsv([{ row: summary }], 'oneil', date, now));
  requireValue(same(exported.headers, canonical.headers), 'CSV labels differ from canonical export');
  requireValue(same(matches[0], canonical.rows[0]), 'Downloaded CSV values/states differ from current source');
  const exclusion = verifyFinancialCarryExclusion(summary, item, now).oneil;
  requireValue(matches[0].qualified === 'false' && matches[0].financial_exclusion_policy === exclusion.policy &&
    matches[0].financial_exclusion_reason === exclusion.reason, 'CSV must retain the approved unknown exclusion');
  requireValue(annualState === 'unknown' && matches[0].annual_eps_rule_state === annualState && matches[0].annual_eps_reporting_currency === '', 'CSV must withhold expired annual values/currency and preserve unknown state');
  return { sha256: financialCarrySha256(bytes), bytes: bytes.length, headers: exported.headers, row: matches[0],
    observed_browser_at: new Date(browserNow).toISOString(), source: 'actual browser download' };
}

export function verifyFinancialCarryObservation(observation, binding) {
  requireValue(binding && observation?.source === 'actual browser response' && observation.transport_generation === binding.transport_generation,
    'Carry response does not belong to the verified preview transport');
  const expected = binding.logical_files[observation.logical_path], physical = binding.physical_files[observation.physical_path];
  requireValue(expected && physical && expected.sha256 === observation.decoded_sha256 && expected.bytes === observation.decoded_bytes &&
    physical.sha256 === observation.encoded_sha256 && physical.bytes === observation.encoded_bytes,
    'Carry browser response differs from the verified logical/physical inventory');
}

async function observeCarryJson({ assets, page, path, action, currentUrl, binding }) {
  const responses = new Map(), listener = response => responses.set(response.url(), response);
  page.on('response', listener);
  try {
    const result = await assets.observeJson(page, path, action);
    const response = responses.get(new URL(result.observation.physical_path, currentUrl).href);
    requireValue(response?.ok(), 'Carry physical browser response was not observed');
    const bytes = Buffer.from(await response.body());
    result.observation.encoded_bytes = bytes.length;
    result.observation.encoded_sha256 = financialCarrySha256(bytes);
    verifyFinancialCarryObservation(result.observation, binding);
    return result;
  } finally { page.off('response', listener); }
}

export async function financialCarryBrowserBootstrap(manifestResponse, publicationResponse, binding) {
  requireValue(binding && manifestResponse?.ok() && publicationResponse?.ok(), 'Carry preview browser bootstrap is missing');
  const manifest = Buffer.from(await manifestResponse.body()), publication = Buffer.from(await publicationResponse.body());
  requireValue(financialCarrySha256(manifest) === binding.manifest_sha256 && financialCarrySha256(publication) === binding.publication_sha256,
    'Carry browser bootstrap bytes differ from verified preview');
  return { manifest_sha256: financialCarrySha256(manifest), publication_sha256: financialCarrySha256(publication),
    transport_generation: binding.transport_generation, source: 'actual browser response' };
}

export function verifyFinancialCarryTransportBinding({ provenance, publication, manifestBytes, uiDigest, commit, provenanceHash, baselineDigest }) {
  validateTransportPreview(publication);
  const manifest = JSON.parse(manifestBytes), bindings = publication.transport.root.bindings;
  requireValue(provenance.schema === 'design-financial-carry-preview-v1' && provenance.publication_authority === 'none' && provenance.financial_admission === false && provenance.ui_sha === commit,
    'Carry preview must bind exact code without publication authority');
  requireValue(publication.ui_sha === commit && publication.ui_digest === uiDigest && publication.data_manifest_sha256 === financialCarrySha256(manifestBytes) &&
    manifest.financial_generation === provenance.financial_generation && bindings.financialGeneration === provenance.financial_generation &&
    bindings.financialLineageSha256 === provenance.financial_lineage_sha256 && bindings.appCommit === commit && bindings.sourceCommit === commit &&
    bindings.candidateId === provenanceHash, 'Carry preview transport/code/lineage/provenance binding mismatch');
  requireValue(baselineDigest === provenance.logical_data_inventory_sha256 && publication.transport.logical_data_inventory_sha256 === baselineDigest,
    'Carry baseline/current logical data inventory differs from preview provenance');
}

// Validate before starting the browser; full transport verification binds every
// physical member, all logical data (including top-level JSON), and the UI.
export async function prepareFinancialCarryDesignBinding({ provenancePath, currentRoot, baselineRoot, commit }) {
  requireValue(baselineRoot, 'Carry Design requires an identical logical baseline');
  const file = await lstat(provenancePath);
  requireValue(file.isFile() && !file.isSymbolicLink() && file.size <= 16 * 1024 * 1024, 'Invalid bounded carry preview provenance');
  const bytes = await readFile(provenancePath), provenance = JSON.parse(bytes);
  const { validateDesignCarryPreview } = await import('../../.github/scripts/design-financial-carry.mjs');
  validateDesignCarryPreview(provenance);
  requireValue(provenance.ui_sha === commit && provenance.publication_authority === 'none' && provenance.financial_admission === false,
    'Carry preview must bind the exact current code without publication authority');
  const manifestBytes = await readFile(resolve(currentRoot, 'static-data/manifest.json'));
  const publicationBytes = await readFile(resolve(currentRoot, 'publication.json'));
  const publication = validateTransportPreview(JSON.parse(publicationBytes));
  const uiFiles = uiInventory(currentRoot), uiDigest = inventoryDigest(uiFiles), provenanceHash = financialCarrySha256(bytes);
  const baselineDigest = dataInventoryDigest(baselineRoot);
  verifyFinancialCarryTransportBinding({ provenance, publication, manifestBytes, uiDigest, commit, provenanceHash, baselineDigest });
  const verified = await verifyTransportPublication({ root: currentRoot, frontendRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..'), publication });
  requireValue(verified, 'Carry packed transport verification is required');
  requireValue(financialCarrySha256(await readFile(provenancePath)) === provenanceHash, 'Carry preview provenance changed during verification');
  return { schema: 'financial-carry-design-evidence-binding-v1', evidence_kind: 'supplemental-expired-carry', satisfies_fresh_categories: false,
    publication_authority: 'none', financial_admission: false, provenance_sha256: provenanceHash, ui_sha: commit, ui_digest: uiDigest,
    baseline_sha: provenance.baseline_sha, baseline_ui_digest: inventoryDigest(uiInventory(baselineRoot)), source_financial_generation: provenance.source_financial_generation,
    financial_generation: provenance.financial_generation, financial_lineage_sha256: provenance.financial_lineage_sha256,
    logical_data_inventory_sha256: baselineDigest, physical_inventory_sha256: publication.transport.physical_inventory_sha256,
    manifest_sha256: financialCarrySha256(manifestBytes), publication_sha256: financialCarrySha256(publicationBytes),
    transport_generation: publication.transport.root.generation, transport_root: publication.transport.root,
    ui_files: uiFiles, logical_files: verified.logicalInventory, physical_files: verified.physicalInventory,
    preview_timestamps: provenance.timestamps, verified_at: new Date().toISOString() };
}

export function verifyFinancialCarryMeasurementBinding(before, after) {
  requireValue(before.provenance_sha256 === after.provenance_sha256 && before.physical_inventory_sha256 === after.physical_inventory_sha256 &&
    /^[a-f0-9]{64}$/.test(before.baseline_ui_digest || '') && before.baseline_ui_digest === after.baseline_ui_digest,
    'Carry preview inputs or baseline UI changed during browser measurement');
}

export function observeFinancialCarryUi({ page, currentUrl, binding, check, report, viewport, theme }) {
  const pending = new Set(), observations = [], root = new URL(currentUrl);
  const listener = response => {
    const url = new URL(response.url());
    const isCode = ['document', 'script', 'stylesheet'].includes(response.request().resourceType());
    if (url.origin !== root.origin || !url.pathname.startsWith(root.pathname)) {
      if (isCode) check(false, `Carry browser loaded UI outside its pinned origin: ${url.href}`);
      return;
    }
    const path = decodeURIComponent(url.pathname.slice(root.pathname.length)) || 'index.html';
    if (!Object.hasOwn(binding.ui_files, path)) {
      if (isCode) check(false, `Carry browser loaded an unpinned UI asset: ${path}`);
      return;
    }
    const job = (async () => {
      requireValue(response.ok(), `Carry browser UI ${path}: HTTP ${response.status()}`);
      const bytes = Buffer.from(await response.body()), hash = financialCarrySha256(bytes);
      requireValue(hash === binding.ui_files[path], `Carry browser UI changed: ${path}`);
      observations.push({ path, sha256: hash, bytes: bytes.length, source: 'actual browser response' });
    })().catch(error => check(false, error.message)).finally(() => pending.delete(job));
    pending.add(job);
  };
  page.on('response', listener);
  return async () => {
    await Promise.all([...pending]);
    page.off('response', listener);
    check(observations.some(item => item.path === 'index.html') && observations.some(item => item.path.endsWith('.js')), 'Carry browser did not observe its actual HTML/JavaScript bootstrap');
    (report.financial_carry_browser_ui ||= []).push({ viewport, theme, provenance_sha256: binding.provenance_sha256, observations });
  };
}

// A separate digest avoids a self-referential report hash. Screens remain in
// ordinary objective/subjective accounting and failures are never removed.
export async function sealFinancialCarryDesignReport({ report, output, binding }) {
  const screenshots = {}, downloads = {};
  for (const screen of report.screens) {
    const hash = financialCarrySha256(await readFile(resolve(output, screen.screenshot)));
    requireValue(screen.sha256 === hash, `Carry screenshot changed after capture: ${screen.key}`);
    screenshots[screen.key] = { path: screen.screenshot, sha256: hash };
  }
  for (const item of report.financial_carry_cases || []) if (item.csv?.artifact) {
    const bytes = await readFile(resolve(output, item.csv.artifact));
    requireValue(financialCarrySha256(bytes) === item.csv.sha256 && bytes.length === item.csv.bytes, `Carry CSV changed after download: ${item.csv.artifact}`);
    downloads[item.csv.artifact] = { sha256: item.csv.sha256, bytes: bytes.length };
  }
  const reportBytes = await readFile(resolve(output, 'report.json'));
  requireValue(same(JSON.parse(reportBytes), report), 'Final Design report changed before evidence binding');
  const result = { schema: 'financial-carry-design-review-v1', publication_authority: 'none', financial_admission: false,
    preview_provenance_sha256: binding.provenance_sha256, ui_sha: binding.ui_sha, ui_digest: binding.ui_digest,
    baseline_ui_digest: binding.baseline_ui_digest,
    logical_data_inventory_sha256: binding.logical_data_inventory_sha256, physical_inventory_sha256: binding.physical_inventory_sha256,
    publication_sha256: binding.publication_sha256, manifest_sha256: binding.manifest_sha256,
    transport_generation: binding.transport_generation, report_sha256: financialCarrySha256(reportBytes), screenshots, downloads,
    objective_failures: report.failures.length, satisfies_fresh_categories: false, sealed_at: new Date().toISOString() };
  await writeFile(resolve(output, 'financial-carry-evidence.json'), JSON.stringify(result, null, 2));
  return result;
}

async function inspectFinancialRows(panel, expected, check, key) {
  const observed = [];
  for (const row of expected.rows) {
    const element = panel.locator(`#financial-evidence-${row.id}`);
    await ready(element);
    const actual = await element.evaluate(node => ({
      id: node.id.replace('financial-evidence-', ''), state: node.dataset.state,
      role: node.querySelector('.financial-evidence-role')?.textContent,
      actual: node.querySelector('.financial-evidence-value strong')?.textContent,
      condition: node.querySelector('.financial-evidence-value span')?.textContent,
      status: node.querySelector('.financial-evidence-status')?.textContent,
      explanation: node.querySelector('.financial-evidence-reason')?.textContent || null,
      metadata: Object.fromEntries([...node.querySelectorAll('dl > div')].map(value => [value.querySelector('dt').textContent, value.querySelector('dd').textContent])),
      text: node.textContent,
    }));
    for (const [field, value] of Object.entries({ state: row.state, role: row.required ? '必須' : '参考', actual: row.actual,
      condition: row.condition, status: stateText[row.state], explanation: row.explanation })) {
      check(actual[field] === value, `${key}/${row.id}: rendered ${field} differs from current source-backed presentation`);
    }
    for (const [label, value] of Object.entries({ 対象期: row.period, 提供元: row.source, 取得: row.observedAt, 指標: row.metric, 基準: row.basis, 単位: row.unit })) {
      check(actual.metadata[label] === value, `${key}/${row.id}: ${label} differs from source evidence`);
    }
    if (row.referenceActual) check(actual.text.includes(`参考計算：${row.referenceActual}`), `${key}/${row.id}: comparison-only reference label/value missing`);
    if (row.state === 'unknown') check(Boolean(actual.explanation), `${key}/${row.id}: unknown state lacks a reason`);
    observed.push(actual);
  }
  return observed;
}

export async function verifyFinancialCarryCases({ page, viewport, theme, capture, check, report, currentUrl, binding, output }) {
  if (!financialCarryDesignScreens(viewport, theme).length) return;
  const staticUrl = path => new URL(`static-data/${path}`, currentUrl).href;
  report.financial_carry_cases ||= [];
  let assets;
  try {
    assets = await createDesignAssetObserver({ baseURL: currentUrl });
    const manifest = assets.manifest, entry = manifest.markets?.US || manifest;
    const researchData = await assets.readJson(entry.assets.research.path);
    const data = decodeResearchIndex(researchData);
    const date = entry.as_of_date, generation = manifest.research_generation || manifest.generated_at;
    for (const item of FINANCIAL_CARRY_DESIGN_CASES) {
      const key = `carry-financial-${item.symbol}/${viewport.width}/${theme}`;
      const record = { evidence_kind: 'supplemental-expired-carry', satisfies_fresh_category: false, preview_provenance_sha256: binding?.provenance_sha256 || null, symbol: item.symbol, category: item.category, viewport, theme, method: 'oneil',
        as_of_date: date, research_generation: generation, manifest_generated_at: manifest.generated_at, views: [] };
      report.financial_carry_cases.push(record);
      try {
        const matches = data.rows.filter(row => row.symbol === item.symbol);
        requireValue(matches.length === 1, `${item.symbol}: research must contain exactly one matching symbol`);
        const summary = matches[0];
        requireValue(summary?.research_detail_path, `${item.symbol}: published detail path missing`);
        await page.goto(`${currentUrl}#/?method=oneil&symbol=${encodeURIComponent(item.symbol)}`);
        const [loadedManifest, researchResponse, loadedPublication] = await Promise.all([
          page.waitForResponse(response => response.url() === staticUrl('manifest.json') && response.ok()),
          observeCarryJson({ assets, page, path: entry.assets.research.path, action: () => page.reload(), currentUrl, binding }),
          assets.packed ? page.waitForResponse(response => response.url() === new URL('publication.json', currentUrl).href) : null,
        ]);
        await assets.assertBrowserBootstrap(loadedManifest, loadedPublication);
        requireValue(JSON.stringify(researchResponse.value) === JSON.stringify(researchData), 'Browser research data differs from the verified logical source');
        record.loaded_research_transport = researchResponse.observation;
        record.loaded_bootstrap = await financialCarryBrowserBootstrap(loadedManifest, loadedPublication, binding);
        const browserManifest = await loadedManifest.json();
        requireValue((browserManifest.research_generation || browserManifest.generated_at) === generation &&
          (browserManifest.markets?.US || browserManifest).assets.research.path === entry.assets.research.path,
        'Browser loaded a different publication generation/research asset');
        await page.waitForFunction(symbol => document.querySelector('.symbol-title h2')?.textContent.trim() === symbol, item.symbol);
        const financialTab = page.getByRole('tab', { name: '財務・機関', exact: true });
        await ready(financialTab);
        const { value: detail, observation } = await observeCarryJson({ assets, page, path: summary.research_detail_path, action: () => financialTab.click(), currentUrl, binding });
        record.loaded_detail_transport = observation;
        verifyFinancialCarryIdentity(summary, detail, item, date);
        verifyFinancialCarryObservation(observation, binding);
        verifyFinancialCarryObservation(researchResponse.observation, binding);
        const panel = page.getByRole('region', { name: '財務の判定根拠', exact: true });
        await ready(panel);
        const clockDisclosure = panel.locator(':scope > details').filter({ has: page.locator('summary', { hasText: '財務の対象日・判定範囲' }) });
        await clockDisclosure.locator('summary').click();
        const panelText = await panel.innerText();
        await clockDisclosure.locator('summary').click();
        const evaluatedAt = panelText.match(/財務の確認時刻 (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1];
        const now = Date.parse(evaluatedAt), browserNow = await page.evaluate(() => Date.now());
        verifyFinancialCarryClock(evaluatedAt, browserNow, 'Rendered financial');
        const selected = mergeFinancialDetail(summary, detail, { now, asOfDate: date, generation, detailGeneration: generation,
          expectedDetailPath: summary.research_detail_path, detailPath: summary.research_detail_path });
        record.financial_exclusions = Object.fromEntries(Object.entries({ summary, detail, selected }).map(([name, row]) =>
          [name, verifyFinancialCarryExclusion(row, item, now)]));
        record.source = financialCarryCaseSource(selected, item, date, now);
        const exclusionNote = page.locator('.symbol-qualification-context[data-financial-exclusion][data-qualification="excluded"]');
        await ready(exclusionNote);
        check(await exclusionNote.getAttribute('data-financial-exclusion') === FINANCIAL_PUBLICATION_EXCEPTION.version &&
          (await exclusionNote.innerText()).includes(FINANCIAL_PUBLICATION_EXCEPTION.label), `${key}: approved unknown exclusion is not displayed`);
        record.exclusion_note = { policy: await exclusionNote.getAttribute('data-financial-exclusion'), text: await exclusionNote.innerText(),
          source: 'rendered DOM; pixel review remains separate' };
        record.observed_browser_at = new Date(browserNow).toISOString();
        record.financial_evaluated_at = evaluatedAt;
        record.loaded_detail_path = summary.research_detail_path;
        check(panelText.includes(`価格の基準日 ${date}`) && panelText.includes('基準日当時に公表済みだったことの証明ではありません'), `${key}: source observation and price/publication clocks are not separated`);
        const evidence = buildFinancialEvidencePresentation(selected, { method: 'oneil', date, generation, now });
        const expected = financialEvidencePresentation({ evidence, history: selected.financial_history, symbol: item.symbol, date, generation, method: 'oneil', now });
        record.financial_rows = await inspectFinancialRows(panel, expected, check, key);
        const requiredFailed = expected.rows.filter(row => row.required && row.state === 'fail').length;
        record.financial_summary = { required: expected.requiredCount, failed: requiredFailed, unknown: expected.requiredUnknown, heading: await panel.locator('header p').textContent() };
        check(record.financial_summary.heading === `財務の必須条件 ${expected.requiredCount}件 · 未達 ${requiredFailed}件 · 未確認 ${expected.requiredUnknown}件`, `${key}: financial totals must show failed and unknown conditions separately`);
        const takeViewport = async (view, viewportTargets) => {
          const screen = `carry-financial-${item.symbol}-${view}`;
          await scrollFinancialViewport(page, viewportTargets);
          await capture(page, viewport, theme, screen, { scope: 'scrolled-viewport', viewportTargets });
          record.views.push({ screen, scope: 'scrolled-viewport', targets: viewportTargets,
            limitation: 'Visibility proof covers the named targets at this scroll position; it does not imply the complete section fits above the fold.' });
        };
        // Keep the evidence screen at the original viewport size with the first
        // complete financial row below the real page header. Its full row target
        // includes the source metadata and any nonpositive-comparison reason.
        // Annual/history evidence has separate views; all rows are audited above.
        await panel.locator('#financial-evidence-eps_growth_yy > details > summary').click();
        await takeViewport('evidence', ['#financial-evidence-eps_growth_yy']);
        await panel.locator('#financial-evidence-eps_growth_yy > details > summary').click();
        const annualSelector = '#financial-evidence-annual_eps_growth_3y';
        await panel.locator(`${annualSelector} > details > summary`).click();
        await takeViewport('annual-viewport', ['.financial-evidence-heading h4', '.financial-evidence-status', '.financial-evidence-value strong',
          '.financial-evidence-value span', '.financial-evidence-metadata > div:nth-child(1)', '.financial-evidence-metadata > div:nth-child(2)',
          '.financial-evidence-metadata > div:nth-child(3)'].map(selector => `${annualSelector} ${selector}`));
        {
          const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: '取得した財務履歴 — 年次EPS・四半期業績' }) });
          await disclosure.locator('summary').click();
          requireValue(await disclosure.evaluate(node => node.open), 'Annual history disclosure did not open');
          const tables = await disclosure.getByRole('table').count();
          const historyText = await disclosure.innerText();
          check(tables === 0, `${key}: expired annual/quarterly history must not render numeric tables`);
          check(historyText.includes('この銘柄の有効な報告財務履歴は未取得、または取得から72時間を超えています。'), `${key}: withheld history explanation is missing`);
          record.history_withheld = { tables, text: historyText, annual_points: record.source.annual.length };
          if (item.history) await takeViewport('history', ['#detail-panel-financial > details.research-disclosure > summary',
            '#detail-panel-financial > details.research-disclosure > p']);
        }
        await page.getByRole('tab', { name: '判定根拠', exact: true }).click();
        const selection = page.locator('#detail-panel-evidence');
        await ready(selection);
        const assessment = assess(selected, 'oneil', now);
        const selectedRules = await selection.locator('.research-rules > li').allTextContents();
        record.selection = { heading: await selection.locator('h3').textContent(), rules: selectedRules, passed: assessment.passed, total: assessment.total, failed: assessment.failed, unknown: assessment.unknown };
        check(record.selection.heading === `選定 ${assessment.passed}/${assessment.total} · 未達 ${assessment.failed} · 未確認 ${assessment.unknown}`, `${key}: selected-method totals differ from current assessment`);
        check(selectedRules.length === assessment.rules.length, `${key}: selected-method rule count differs`);
        assessment.rules.forEach((rule, index) => check(normalize(selectedRules[index] || '').includes(normalize(rule.label)) &&
          (selectedRules[index] || '').includes(stateText[rule.state]), `${key}: selected-method rule ${index} label/state mismatch`));
        for (const financial of expected.rows.filter(row => row.required)) {
          const rule = assessment.rules.find(rule => rule.label === financial.condition);
          check(rule?.state === financial.state, `${key}/${financial.id}: selection/financial state mismatch`);
        }
        if (item.decisions) await takeViewport('selection', [...(viewport.width>700?['#detail-tab-evidence']:[]), '#detail-panel-evidence > h3', ...[1, 2, 3].map(index => `#detail-panel-evidence .research-rules > li:nth-child(${index})`)]);
        await page.getByRole('tab', { name: '購入条件', exact: true }).click();
        const purchase = page.locator('#detail-panel-conditions');
        await ready(purchase);
        const readiness = entryReadiness(selected, date, modelMarket(data.rows), now, 'oneil');
        const purchaseRuleLabels = await purchase.locator('.condition-rules > li > details > summary b').allTextContents();
        const purchaseRuleStates = await purchase.locator('.condition-rules > li > details > summary .rule-state').allTextContents();
        const purchaseRules = purchaseRuleLabels.map((label, index) => `${label} ${purchaseRuleStates[index] || ''}`);
        record.purchase = { heading: await purchase.locator('h3').textContent(), rules: purchaseRules, passed: readiness.passed, total: readiness.total, failed: readiness.failed, unknown: readiness.unknown };
        check(record.purchase.heading.startsWith(`購入条件 ${readiness.passed}/${readiness.total} · 未達 ${readiness.failed} · 未確認 ${readiness.unknown} · `), `${key}: purchase totals differ from separate common purchase model`);
        check(await purchase.locator('.condition-rules > li').count() === readiness.rules.length && purchaseRules.length === readiness.rules.length && purchaseRuleStates.length === readiness.rules.length, `${key}: purchase rule count differs`);
        readiness.rules.forEach((rule, index) => check((purchaseRuleLabels[index] || '').includes(rule.label) &&
          purchaseRuleStates[index] === purchaseStateText[rule.state], `${key}: purchase rule ${rule.id} label/state mismatch`));
        await purchase.locator('.condition-rules details > summary').first().click();
        check((await purchase.innerText()).includes('選択中の手法とは別に'), `${key}: purchase model/selected method distinction missing`);
        if (item.decisions) await takeViewport('purchase', [...(viewport.width>700?['#detail-tab-conditions']:[]), '#detail-panel-conditions > h3', ...[1, 2].map(index => `#detail-panel-conditions .condition-rules > li:nth-child(${index})`)]);
        if (viewport.width === 390) await page.locator('.mobile-header-back:visible, .mobile-back:visible').first().click();
        await page.getByRole('button', { name: '候補を絞り込む', exact: true }).click();
        const filters = page.getByRole('dialog', { name: '候補を絞り込む', exact: true });
        await ready(filters);
        check(await filters.getByRole('button', { name: 'オニール', exact: true }).getAttribute('aria-pressed') === 'true', `${key}: export is not using the selected オニール method`);
        const [download] = await Promise.all([
          page.waitForEvent('download'),
          filters.getByRole('button', { name: '全検索結果をCSV保存 ↓', exact: true }).click(),
        ]);
        const stream = await download.createReadStream(), chunks = [];
        requireValue(stream, 'CSV download stream unavailable');
        for await (const chunk of stream) chunks.push(chunk);
        const csvBytes = Buffer.concat(chunks);
        const artifact = `carry-financial-${item.symbol}-${viewport.width}-${theme}.csv`;
        await writeFile(resolve(output, artifact), csvBytes);
        record.csv = { filename: download.suggestedFilename(), artifact, sha256: financialCarrySha256(csvBytes), bytes: csvBytes.length,
          source: 'actual browser download', validation: 'pending' };
        Object.assign(record.csv, verifyFinancialCarryCsv({ bytes: csvBytes, summary,
          item, date, browserNow: await page.evaluate(() => Date.now()), annualState: expected.rows.find(row => row.id === 'annual_eps_growth_3y').state }), { validation: 'passed' });
        await filters.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
      } catch (error) {
        if (record.csv?.validation === 'pending') record.csv.validation = 'failed';
        record.error = error.message;
        check(false, `${key}: supplemental expired carry verification interrupted: ${error.message}`);
      }
    }
  } catch (error) { check(false, `carry-financial/${viewport.width}/${theme}: preview case setup failed: ${error.message}`); }
  finally { assets?.dispose(); }
}
