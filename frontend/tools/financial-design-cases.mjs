import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { currentFinancialHistory, mergeFinancialDetail, projectFinancialRow } from '../src/static/financialCurrent.js';
import { nativeAnnualHistoryContract } from '../src/static/financialHistory.js';
import { buildFinancialEvidencePresentation, financialEvidencePresentation } from '../src/static/financialEvidencePresentation.js';
import { assess, researchCsv } from '../src/static/researchEngine.js';
import { entryReadiness } from '../src/static/entryReadiness.js';
import { modelMarket } from '../src/static/portfolioPlan.js';
import { scrollFinancialViewport } from './financial-viewport-geometry.mjs';

// Selected from the receipt-replayed 2026-10-04 native annual projection:
// NVDA: ordinary USD; FUTU: HKD annualDilutedEPS receipt; AAOI: negative
// comparison EPS; ALH: one numeric annual EPS and three missing years;
// AVT: two measured annual declines and a missing latest annual EPS.
// These names are contracts, not a search that silently replaces a failed case.
export const FINANCIAL_DESIGN_CASES = Object.freeze([
  { symbol: 'NVDA', category: 'ordinary-usd', decisions: true },
  { symbol: 'FUTU', category: 'native-hkd-annual', history: true },
  { symbol: 'AAOI', category: 'nonpositive-eps-baseline' },
  { symbol: 'ALH', category: 'short-annual-history', history: true },
  { symbol: 'AVT', category: 'annual-declines-with-missing-year' },
]);
export const financialDesignTheme = width => width === 1440 ? 'dark' : width === 390 ? 'light' : null;
export function financialDesignScreens(viewport, theme) {
  return theme !== financialDesignTheme(viewport.width) ? [] : FINANCIAL_DESIGN_CASES.flatMap(item => [
    `financial-${item.symbol}-evidence`,
    `financial-${item.symbol}-annual-viewport`,
    ...(item.history ? [`financial-${item.symbol}-history`] : []),
    ...(item.decisions ? [`financial-${item.symbol}-selection`, `financial-${item.symbol}-purchase`] : []),
  ]);
}
const ready = locator => locator.waitFor({ state: 'visible', timeout: 60000 });
const requireValue = (value, message) => { if (!value) throw Error(message); };
const stateText = { pass: '✓ 通過', fail: '× 未達', unknown: '? 未確認', reference: '参考・取得済み', not_applicable: '対象外' };
const purchaseStateText = { pass: '通過', fail: '未達', unknown: '未確認', not_applicable: '対象外' };
const normalize = text => text.replace(/\s+/g, ' ').trim();
export const financialHistoryCell = value => Number.isFinite(value) ? value.toLocaleString('en-US', { maximumFractionDigits: 3 }).replace(/^-/, '−') : '未取得';

export function financialCaseSource(row, item, date, now = Date.now()) {
  requireValue(row?.symbol === item.symbol && row.as_of_date === date, `${item.symbol}: published source identity/date mismatch`);
  const current = projectFinancialRow(row, { now, asOfDate: date });
  const history = currentFinancialHistory(current.financial_history, item.symbol, date, now, current);
  const data = current.financial_history;
  requireValue(history.valid && history.annual.length, `${item.symbol}: current sourced annual history is unavailable or expired`);
  const currency = data.annual_currency || data.currency;
  const annual = history.annual.map(({ end, eps }) => ({ end, eps }));
  const finiteAnnual = annual.filter(point => Number.isFinite(point.eps));
  const eps = current.financial_current_state.fields.eps_growth_yy;
  const sales = current.financial_current_state.fields.sales_growth_yy;
  const annualRule = assess(current, 'oneil', now).rules.find(rule => rule.label.includes('3年'));
  if (item.category === 'ordinary-usd') {
    requireValue(currency === 'USD' && history.annualComplete && history.annualGrowth?.length === 3 &&
      eps.availability === 'current' && sales.availability === 'current', 'NVDA no longer proves ordinary current USD EPS, sales and annual growth');
  } else if (item.category === 'native-hkd-annual') {
    requireValue(currency === 'HKD' && nativeAnnualHistoryContract(data, item.symbol) && history.annualComplete && history.annualGrowth?.length === 3,
      'FUTU no longer proves current receipt-bound native HKD annual EPS');
  } else if (item.category === 'nonpositive-eps-baseline') {
    requireValue(eps.reason === 'nonpositive_comparison_base' && eps.source_validated && eps.value === null && Number.isFinite(eps.reference_value) &&
      history.annualComplete && history.annualComparisons.some(value => value.reason === 'nonpositive_comparison_base'),
      'AAOI no longer proves sourced nonpositive quarterly and annual EPS baselines');
  } else if (item.category === 'short-annual-history') {
    requireValue(finiteAnnual.length > 0 && finiteAnnual.length < 4 && history.annualComplete !== true && history.annualGrowth === null &&
      (Date.parse(date) - Date.parse(annual.at(-1).end)) / 86400000 <= 550,
      'ALH no longer proves genuinely insufficient numeric annual EPS history');
  } else if (item.category === 'annual-declines-with-missing-year') {
    requireValue(history.annualComplete !== true && history.annualGrowth === null && history.annualComparisons.length === 3 &&
      history.annualComparisons.filter(value => Number.isFinite(value.growth) && value.growth < 0).length === 2 &&
      history.annualComparisons.filter(value => value.reason === 'missing_annual_eps').length === 1 && annualRule?.state === 'fail',
      'AVT no longer proves two measured annual declines plus one missing comparison with a failed annual rule');
  } else throw Error(`Unknown financial Design category: ${item.category}`);
  return { category: item.category, currency, annual, numeric_annual_periods: finiteAnnual.length,
    annual_complete: history.annualComplete, annual_growth: history.annualGrowth, annual_comparisons: history.annualComparisons, annual_rule_state: annualRule?.state,
    annual_observed_at: data.annual_source?.observed_at || data.retrieved_at,
    annual_source: data.annual_source || null, quarterly_eps: eps, quarterly_sales: sales };
}

// Parse the actual browser download, including quoted commas/newlines. This
// report is an export audit; it is not a screenshot or a visual review score.
export function parseFinancialCsv(text) {
  text = text.replace(/^\uFEFF/, '');
  const rows = [], row = [];
  let value = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (!quoted && (character === ',' || character === '\n' || character === '\r')) {
      row.push(value); value = '';
      if (character !== ',') {
        rows.push(row.splice(0));
        if (character === '\r' && text[index + 1] === '\n') index++;
      }
    } else value += character;
  }
  requireValue(!quoted, 'CSV has an unterminated quoted field');
  if (value || row.length) { row.push(value); rows.push(row); }
  const [headers, ...records] = rows;
  requireValue(headers?.length && new Set(headers).size === headers.length, 'CSV headers missing or duplicated');
  return { headers, rows: records.map(cells => {
    requireValue(cells.length === headers.length, 'CSV record/header length mismatch');
    return Object.fromEntries(headers.map((header, index) => [header, cells[index]]));
  }) };
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

export async function verifyFinancialCases({ page, viewport, theme, capture, check, report, currentUrl }) {
  if (!financialDesignScreens(viewport, theme).length) return;
  const staticUrl = path => new URL(`static-data/${path}`, currentUrl).href;
  const get = async path => {
    const response = await page.request.get(staticUrl(path));
    requireValue(response.ok(), `${path}: HTTP ${response.status()}`);
    return response.json();
  };
  report.financial_cases ||= [];
  try {
    const manifest = await get('manifest.json'), entry = manifest.markets?.US || manifest;
    const data = decodeResearchIndex(await get(entry.assets.research.path));
    const date = entry.as_of_date, generation = manifest.research_generation || manifest.generated_at;
    for (const item of FINANCIAL_DESIGN_CASES) {
      const key = `financial-${item.symbol}/${viewport.width}/${theme}`;
      const record = { symbol: item.symbol, category: item.category, viewport, theme, method: 'oneil',
        as_of_date: date, research_generation: generation, manifest_generated_at: manifest.generated_at, views: [] };
      report.financial_cases.push(record);
      try {
        const summary = data.rows.find(row => row.symbol === item.symbol);
        requireValue(summary?.research_detail_path, `${item.symbol}: published detail path missing`);
        await page.goto(`${currentUrl}#/?method=oneil&symbol=${encodeURIComponent(item.symbol)}`);
        const [loadedManifest] = await Promise.all([
          page.waitForResponse(response => response.url() === staticUrl('manifest.json') && response.ok()),
          page.waitForResponse(response => response.url() === staticUrl(entry.assets.research.path) && response.ok()),
          page.reload(),
        ]);
        const browserManifest = await loadedManifest.json();
        requireValue((browserManifest.research_generation || browserManifest.generated_at) === generation &&
          (browserManifest.markets?.US || browserManifest).assets.research.path === entry.assets.research.path,
        'Browser loaded a different publication generation/research asset');
        await page.waitForFunction(symbol => document.querySelector('.symbol-title h2')?.textContent.trim() === symbol, item.symbol);
        const financialTab = page.getByRole('tab', { name: '財務・機関', exact: true });
        await ready(financialTab);
        const [loadedDetail] = await Promise.all([
          page.waitForResponse(response => response.url() === staticUrl(summary.research_detail_path) && response.ok()),
          financialTab.click(),
        ]);
        const detail = await loadedDetail.json();
        requireValue(detail.symbol === item.symbol && detail.as_of_date === date, 'Browser detail symbol/date mismatch');
        requireValue(detail.financial_current?.t === summary.financial_current?.t && Number.isFinite(detail.financial_current?.t),
          'Browser detail and research financial generations do not match');
        const panel = page.getByRole('region', { name: '財務の判定根拠', exact: true });
        await ready(panel);
        const panelText = await panel.innerText();
        const evaluatedAt = panelText.match(/財務の確認時刻 (\d{4}-\d{2}-\d{2}T[\d:.]+Z)/)?.[1];
        const now = Date.parse(evaluatedAt), browserNow = await page.evaluate(() => Date.now());
        requireValue(Number.isFinite(now) && Math.abs(browserNow - now) < 90000, 'Rendered financial evaluation clock is missing or not current');
        const selected = mergeFinancialDetail(summary, detail, { now, asOfDate: date, generation, detailGeneration: generation,
          expectedDetailPath: summary.research_detail_path, detailPath: summary.research_detail_path });
        record.source = financialCaseSource(selected, item, date, now);
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
          const screen = `financial-${item.symbol}-${view}`;
          await scrollFinancialViewport(page, viewportTargets);
          await capture(page, viewport, theme, screen, { scope: 'scrolled-viewport', viewportTargets });
          record.views.push({ screen, scope: 'scrolled-viewport', targets: viewportTargets,
            limitation: 'Visibility proof covers the named targets at this scroll position; it does not imply the complete section fits above the fold.' });
        };
        // Keep the evidence screen at the original viewport size with the first
        // complete financial row below the real page header. Its full row target
        // includes the source metadata and any nonpositive-comparison reason.
        // Annual/history evidence has separate views; all rows are audited above.
        await takeViewport('evidence', ['#financial-evidence-eps_growth_yy']);
        const annualSelector = '#financial-evidence-annual_eps_growth_3y';
        await takeViewport('annual-viewport', ['.financial-evidence-heading h4', '.financial-evidence-status', '.financial-evidence-value strong',
          '.financial-evidence-value span', '.financial-evidence-metadata > div:nth-child(1)', '.financial-evidence-metadata > div:nth-child(2)',
          '.financial-evidence-metadata > div:nth-child(3)'].map(selector => `${annualSelector} ${selector}`));
        if (item.history) {
          const disclosure = page.locator('details').filter({ has: page.locator('summary', { hasText: '取得した財務履歴 — 年次EPS・四半期業績' }) });
          await disclosure.locator('summary').click();
          requireValue(await disclosure.evaluate(node => node.open), 'Annual history disclosure did not open');
          const table = disclosure.getByRole('table', { name: '年次の希薄化EPS', exact: true });
          const cells = await table.locator('tbody tr').evaluateAll(rows => rows.map(row => [...row.cells].map(cell => cell.textContent)));
          const expectedCells = record.source.annual.map(({ end, eps }) => [end, financialHistoryCell(eps)]);
          check(JSON.stringify(cells) === JSON.stringify(expectedCells), `${key}: annual history periods/EPS differ from source`);
          check((await table.locator('thead').innerText()).includes(`EPS（${record.source.currency} / 提供元の株式単位）`), `${key}: annual native-currency/share-unit heading missing`);
          check((await disclosure.innerText()).includes(record.source.annual_observed_at), `${key}: annual source observation time missing`);
          record.history_cells = cells;
          await takeViewport('history', ['#detail-panel-financial > details.research-disclosure > summary',
            '#detail-panel-financial > details.research-disclosure > div:first-of-type > table.financial-history-table > caption',
            '#detail-panel-financial > details.research-disclosure > div:first-of-type > table.financial-history-table']);
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
        if (item.decisions) await takeViewport('selection', ['#detail-panel-evidence > h3', ...[1, 2, 3].map(index => `#detail-panel-evidence .research-rules > li:nth-child(${index})`)]);
        await page.getByRole('tab', { name: '購入条件', exact: true }).click();
        const purchase = page.locator('#detail-panel-conditions');
        await ready(purchase);
        const readiness = entryReadiness(selected, date, modelMarket(data.rows), now, 'oneil');
        const purchaseRules = await purchase.locator('.condition-rules > li').allTextContents();
        record.purchase = { heading: await purchase.locator('h3').textContent(), rules: purchaseRules, passed: readiness.passed, total: readiness.total, failed: readiness.failed, unknown: readiness.unknown };
        check(record.purchase.heading.startsWith(`購入条件 ${readiness.passed}/${readiness.total} · 未達 ${readiness.failed} · 未確認 ${readiness.unknown} · `), `${key}: purchase totals differ from separate common purchase model`);
        check(purchaseRules.length === readiness.rules.length, `${key}: purchase rule count differs`);
        readiness.rules.forEach((rule, index) => check((purchaseRules[index] || '').includes(rule.label) &&
          (purchaseRules[index] || '').endsWith(purchaseStateText[rule.state]), `${key}: purchase rule ${rule.id} label/state mismatch`));
        check((await purchase.innerText()).includes('選択中の手法とは別に'), `${key}: purchase model/selected method distinction missing`);
        if (item.decisions) await takeViewport('purchase', ['#detail-panel-conditions > h3', ...[1, 2].map(index => `#detail-panel-conditions .condition-rules > li:nth-child(${index})`)]);
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
        const exported = parseFinancialCsv(Buffer.concat(chunks).toString('utf8'));
        const matches = exported.rows.filter(row => row.symbol === item.symbol);
        requireValue(matches.length === 1, `${item.symbol}: CSV must contain exactly one matching symbol`);
        const csvNow = Date.parse(matches[0].financial_evaluated_at);
        requireValue(Number.isFinite(csvNow) && Math.abs(await page.evaluate(() => Date.now()) - csvNow) < 90000, 'CSV evaluation clock is missing or not current');
        const canonical = parseFinancialCsv(researchCsv([{ row: summary }], 'oneil', date, csvNow));
        check(JSON.stringify(exported.headers) === JSON.stringify(canonical.headers), `${key}: CSV labels differ from canonical export`);
        check(JSON.stringify(matches[0]) === JSON.stringify(canonical.rows[0]), `${key}: downloaded CSV values/states differ from current source`);
        check(matches[0].annual_eps_rule_state === expected.rows.find(row => row.id === 'annual_eps_growth_3y').state, `${key}: CSV/financial annual state mismatch`);
        record.csv = { filename: download.suggestedFilename(), headers: exported.headers, row: matches[0], source: 'actual browser download' };
        await filters.getByRole('button', { name: '絞り込みを閉じる', exact: true }).click();
      } catch (error) {
        record.error = error.message;
        check(false, `${key}: financial case verification interrupted: ${error.message}`);
      }
    }
  } catch (error) { check(false, `financial/${viewport.width}/${theme}: published case setup failed: ${error.message}`); }
}
