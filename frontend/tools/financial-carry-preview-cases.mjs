// Supplementary observations of the actual carried financial input. These
// captures neither satisfy nor replace the strict current-source Design cases.
import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { currentFinancialHistory, mergeFinancialDetail, projectFinancialRow } from '../src/static/financialCurrent.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../src/static/financialEvidencePresentation.js';
import { FINANCIAL_DESIGN_CASES, financialDesignTheme } from './financial-design-cases.mjs';
import { scrollFinancialViewport } from './financial-viewport-geometry.mjs';
import { createDesignAssetObserver } from './design-static-assets.mjs';

export const CARRY_PREVIEW_BASIS = 'same_prices_carried_financials_preview';
export const CARRY_PREVIEW_LABEL = 'same prices / different carried financial input';
const contexts = new WeakSet();
const requireValue = (value, message) => { if (!value) throw Error(`Design carry preview: ${message}`); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const freeze = value => {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
};

export async function readCarryPreviewContext({ inputBasis, receiptPath, currentRoot, baselineRoot }) {
  if (inputBasis !== CARRY_PREVIEW_BASIS) {
    requireValue(!receiptPath, 'receipt requires the explicit carried-financial comparison basis');
    return null;
  }
  requireValue(isAbsolute(receiptPath || '') && isAbsolute(currentRoot || '') && isAbsolute(baselineRoot || ''), 'verified receipt and both absolute build roots are required');
  const info = await lstat(receiptPath);
  requireValue(info.isFile() && !info.isSymbolicLink() && info.size <= 16 * 1024 * 1024, 'invalid receipt file');
  const before = await readFile(receiptPath);
  // The controller rechecks source/target/UI/packed assets and the live source.
  // Parsing a file or finding a schema label alone never authorizes preview.
  const { verifyDesignCarryPreview } = await import('../../.github/scripts/design-financial-carry-preview.mjs');
  const receipt = await verifyDesignCarryPreview({ receiptPath, currentRoot, baselineRoot });
  const after = await readFile(receiptPath);
  requireValue(digest(before) === digest(after) && isDeepStrictEqual(receipt, JSON.parse(after)), 'receipt changed during verification');
  requireValue(receipt.schema === 'design-financial-carry-preview-v1' && receipt.publication_authority === 'none' && receipt.release_accepted === false && receipt.comparison_basis === CARRY_PREVIEW_BASIS,
    'invalid preview-only authority or comparison basis');
  const context = freeze({ receipt, receipt_sha256: digest(after) });
  contexts.add(context);
  return context;
}

export function financialCarryPreviewScreens(viewport, theme, context) {
  if (!context) return [];
  requireValue(contexts.has(context), 'unverified receipt context');
  return theme !== financialDesignTheme(viewport.width) ? [] : FINANCIAL_DESIGN_CASES.flatMap(({ symbol }) => [
    `financial-carry-preview-${symbol}-evidence`, `financial-carry-preview-${symbol}-annual-viewport`,
  ]);
}

// A pure observation adapter, not an alternate acceptance gate. Unit tests may
// supply clocks; the browser path below only supplies its rendered real clock.
export function carryPreviewEvidence(row, { symbol, date, generation, now }) {
  requireValue(row?.symbol === symbol && row.as_of_date === date, `${symbol}: source identity/date mismatch`);
  requireValue(Number.isSafeInteger(now) && now >= Date.parse(date) && typeof generation === 'string' && generation.length > 0, `${symbol}: invalid observation context`);
  const current = projectFinancialRow(row, { now, asOfDate: date });
  const history = currentFinancialHistory(current.financial_history, symbol, date, now, current);
  const evidence = buildFinancialEvidencePresentation(current, { method: 'oneil', date, generation, now });
  const presentation = financialEvidencePresentation({ evidence, history: current.financial_history, symbol, date, generation, method: 'oneil', now });
  return { presentation, source: {
    financial_source_evaluated_at: Number.isFinite(row.financial_current?.t) ? new Date(row.financial_current.t).toISOString() : null,
    annual_observed_at: row.financial_history?.annual_source?.observed_at || row.financial_history?.retrieved_at || null,
    quarterly_observed_at: row.financial_history?.quarterly_retrieved_at ?? row.financial_history?.retrieved_at ?? null,
    annual_source: row.financial_history?.annual_source || null,
    annual_current: history.valid && history.annual.length > 0,
    annual_complete: history.annualComplete,
    annual_growth: history.annualGrowth,
    annual_comparisons: history.annualComparisons,
    quarterly_eps: current.financial_current_state.fields.eps_growth_yy,
    quarterly_sales: current.financial_current_state.fields.sales_growth_yy,
    required_unknown: presentation.requiredUnknown,
    unknown_reasons: presentation.rows.filter(value => value.state === 'unknown').map(({ id, reason }) => ({ id, reason })),
  } };
}

const stateText = { pass: '✓ 通過', fail: '× 未達', unknown: '? 未確認', reference: '参考・取得済み', not_applicable: '対象外' };
const ready = locator => locator.waitFor({ state: 'visible', timeout: 60000 });
async function inspectRows(panel, expected, check, key) {
  const observed = [];
  for (const row of expected.rows) {
    const element = panel.locator(`#financial-evidence-${row.id}`);
    await ready(element);
    const actual = await element.evaluate(node => ({ id: node.id.replace('financial-evidence-', ''), state: node.dataset.state,
      actual: node.querySelector('.financial-evidence-value strong')?.textContent,
      condition: node.querySelector('.financial-evidence-value span')?.textContent,
      status: node.querySelector('.financial-evidence-status')?.textContent,
      explanation: node.querySelector('.financial-evidence-reason')?.textContent || null,
      metadata: Object.fromEntries([...node.querySelectorAll('dl > div')].map(value => [value.querySelector('dt').textContent, value.querySelector('dd').textContent])),
    }));
    for (const [field, value] of Object.entries({ state: row.state, actual: row.actual, condition: row.condition, status: stateText[row.state], explanation: row.explanation })) {
      check(actual[field] === value, `${key}/${row.id}: carried ${field} differs from actual-clock presentation`);
    }
    for (const [label, value] of Object.entries({ 対象期: row.period, 提供元: row.source, 取得: row.observedAt, 指標: row.metric, 基準: row.basis, 単位: row.unit })) {
      check(actual.metadata[label] === value, `${key}/${row.id}: carried ${label} differs from source evidence`);
    }
    if (row.state === 'unknown') check(Boolean(actual.explanation), `${key}/${row.id}: unknown state lacks a reason`);
    observed.push(actual);
  }
  return observed;
}

export async function verifyFinancialCarryPreviewCases({ page, viewport, theme, capture, check, report, currentUrl, context }) {
  if (!financialCarryPreviewScreens(viewport, theme, context).length) return;
  const receipt = context.receipt;
  const staticUrl = path => new URL(`static-data/${path}`, currentUrl).href;
  report.financial_carry_preview_cases ||= [];
  let assets;
  try {
    assets = await createDesignAssetObserver({ baseURL: currentUrl });
    const manifest = assets.manifest, entry = manifest.markets?.US || manifest;
    requireValue(manifest.financial_generation === receipt.financial.generation, 'manifest financial generation differs from verified receipt');
    const data = decodeResearchIndex(await assets.readJson(entry.assets.research.path));
    const date = entry.as_of_date, generation = manifest.research_generation || manifest.generated_at;
    for (const { symbol } of FINANCIAL_DESIGN_CASES) {
      const key = `financial-carry-preview-${symbol}/${viewport.width}/${theme}`;
      const record = { symbol, viewport, theme, method: 'oneil', supplementary: true, release_accepted: false, publication_authority: 'none',
        comparison_basis: CARRY_PREVIEW_BASIS, receipt_sha256: context.receipt_sha256, financial_generation: manifest.financial_generation,
        as_of_date: date, research_generation: generation, views: [] };
      report.financial_carry_preview_cases.push(record);
      try {
        const summary = data.rows.find(row => row.symbol === symbol);
        requireValue(summary?.research_detail_path, `${symbol}: published detail path missing`);
        await page.goto(`${currentUrl}#/?method=oneil&symbol=${encodeURIComponent(symbol)}`);
        const [loadedManifest, , loadedPublication] = await Promise.all([
          page.waitForResponse(response => response.url() === staticUrl('manifest.json') && response.ok()),
          page.waitForResponse(response => response.url() === staticUrl(entry.assets.research.path) && response.ok()),
          assets.packed ? page.waitForResponse(response => response.url() === new URL('publication.json', currentUrl).href) : null,
          page.reload(),
        ]);
        await assets.assertBrowserBootstrap(loadedManifest, loadedPublication);
        await page.waitForFunction(value => document.querySelector('.symbol-title h2')?.textContent.trim() === value, symbol);
        const tab = page.getByRole('tab', { name: '財務・機関', exact: true });
        await ready(tab);
        const { value: detail, observation } = await assets.observeJson(page, summary.research_detail_path, () => tab.click());
        record.loaded_detail_transport = observation;
        record.loaded_detail_path = summary.research_detail_path;
        requireValue(detail.symbol === symbol && detail.as_of_date === date, 'browser detail identity/date mismatch');
        requireValue(detail.financial_current?.t === summary.financial_current?.t && Number.isFinite(detail.financial_current?.t), 'browser detail and research financial generations do not match');
        const panel = page.getByRole('region', { name: '財務の判定根拠', exact: true });
        await ready(panel);
        const panelText = await panel.innerText();
        const evaluatedAt = panelText.match(/財務の確認時刻 (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1];
        const now = Date.parse(evaluatedAt), browserNow = await page.evaluate(() => Date.now());
        requireValue(Number.isFinite(now) && Math.abs(browserNow - now) < 90000, 'rendered evaluation clock is missing or not current');
        const selected = mergeFinancialDetail(summary, detail, { now, asOfDate: date, generation, detailGeneration: generation,
          expectedDetailPath: summary.research_detail_path, detailPath: summary.research_detail_path });
        const { source, presentation } = carryPreviewEvidence(selected, { symbol, date, generation, now });
        record.source = source;
        record.financial_evaluated_at = evaluatedAt;
        record.financial_rows = await inspectRows(panel, presentation, check, key);
        const failed = presentation.rows.filter(row => row.required && row.state === 'fail').length;
        record.financial_summary = { required: presentation.requiredCount, failed, unknown: presentation.requiredUnknown, heading: await panel.locator('header p').textContent() };
        check(record.financial_summary.heading === `財務の必須条件 ${presentation.requiredCount}件 · 未達 ${failed}件 · 未確認 ${presentation.requiredUnknown}件`, `${key}: required failed/unknown counts differ from actual-clock presentation`);
        check(panelText.includes(`価格の基準日 ${date}`) && panelText.includes('基準日当時に公表済みだったことの証明ではありません'), `${key}: source observation and price/publication clocks are not separated`);
        const annual = '#financial-evidence-annual_eps_growth_3y';
        const annualReason = presentation.rows.find(row => row.id === 'annual_eps_growth_3y')?.explanation ? ['.financial-evidence-reason'] : [];
        for (const [view, viewportTargets] of [
          ['evidence', ['#financial-evidence-eps_growth_yy']],
          ['annual-viewport', ['.financial-evidence-heading h4', '.financial-evidence-status', '.financial-evidence-value strong', '.financial-evidence-value span', ...annualReason,
            '.financial-evidence-metadata > div:nth-child(1)', '.financial-evidence-metadata > div:nth-child(2)', '.financial-evidence-metadata > div:nth-child(3)'].map(selector => `${annual} ${selector}`)],
        ]) {
          const screen = `financial-carry-preview-${symbol}-${view}`;
          await scrollFinancialViewport(page, viewportTargets);
          await capture(page, viewport, theme, screen, { scope: 'scrolled-viewport', viewportTargets });
          record.views.push({ screen, scope: 'scrolled-viewport', targets: viewportTargets,
            limitation: 'Supplementary actual-clock carried-input evidence; does not satisfy strict current-source captures or release acceptance.' });
        }
      } catch (error) {
        record.error = error.message;
        check(false, `${key}: supplementary verification interrupted: ${error.message}`);
      }
    }
  } catch (error) { check(false, `financial-carry-preview/${viewport.width}/${theme}: setup failed: ${error.message}`); }
  finally { assets?.dispose(); }
}
