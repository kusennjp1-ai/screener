import { financialViewportGeometry, scrollFinancialViewport, checkFinancialViewportGeometry } from './financial-viewport-geometry.mjs';
import { observeSvgChart, validateSvgChart } from './svg-chart-evidence.mjs';
import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { entryPlan } from '../src/static/researchEngine.js';
import { buildBookAnnotations } from '../src/components/Charts/bookAnnotations.js';
import { chartHistoryWarning } from '../src/components/Charts/researchChartModel.js';
import { money } from '../src/static/positionGeometry.js';
import { expandedChartGeometry, checkExpandedChartGeometry } from './expanded-chart-geometry.mjs';
import { observeRsSelection, observeImmediateTouchClose, validateImmediateTouchClose } from './chart-interaction-evidence.mjs';

export const CHART_DESIGN_SYMBOLS = ['MSM', 'ADI', 'TGTX'];
const ready = locator => locator.first().waitFor({ state: 'visible', timeout: 60000 });
const sameLevel = (raw, expected) => Number.isFinite(expected) ? raw !== null && raw !== '' && Math.abs(Number(raw) - expected) < 1e-8 : raw === '' || raw === null;

// Consume exactly the build's published snapshot. No fixture-price injection,
// historical clock override, or forced annotations are used for these captures.
export async function verifyChartCases({ page, viewport, theme, capture, check, report, currentUrl }) {
  const get = async path => {
    const response = await page.request.get(new URL(`static-data/${path}`, currentUrl).href);
    if (!response.ok()) throw Error(`${path}: HTTP ${response.status()}`);
    return response.json();
  };
  const manifest = await get('manifest.json'), entry = manifest.markets?.US || manifest;
  const data = decodeResearchIndex(await get(entry.assets.research.path));
  report.chart_cases ||= [];
  report.expanded_annotation_geometry_contract = 'full-plot-v1';
  for (const symbol of CHART_DESIGN_SYMBOLS) {
    const key = `${symbol}/${viewport.width}/${theme}`;
    try {
      const row = data.rows.find(item => item.symbol === symbol);
      if (!row?.chart_path) throw Error('Published research row/chart path unavailable');
      const payload = await get(row.chart_path), plan = entryPlan(row, null, 'minervini');
      const warning = chartHistoryWarning(payload.bars), annotations = buildBookAnnotations(warning ? null : payload.bars);
      const asOf = entry.as_of_date;
      check(payload.symbol === symbol && payload.as_of_date === asOf && payload.bars.at(-1)?.date === asOf, `${key}: chart identity/as-of mismatch`);
      await page.goto(`${currentUrl}#/?symbol=${encodeURIComponent(symbol)}`);
      await page.reload(); // the same home route must consume the new initial symbol
      const chart = page.locator(`.research-chart [data-chart-symbol="${symbol}"]`);
      await ready(chart);
      // A reload resets the theme. Establish the requested real UI state before
      // positioning or measuring; capture must not invalidate an earlier scroll.
      if (await page.locator('.leader-shell').getAttribute('data-theme') !== theme) {
        await page.getByRole('button', { name: theme === 'light' ? 'ライトモードに切り替え' : 'ダークモードに切り替え', exact: true }).click();
      }
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(800);
      check(await page.locator('.leader-shell').getAttribute('data-theme') === theme, `${key}: requested theme was not established before chart measurement`);
      check((await page.locator('.symbol-title h2').textContent())?.trim() === symbol, `${key}: detail symbol mismatch`);
      const record = { symbol, viewport, theme, as_of_date: asOf, bars: payload.bars.length, history_warning: warning || null,
        annotation_candidate: annotations.candidate, annotation_summary: annotations.summary,
        shapes: annotations.boxes.map(({ start, end, label, curve, arrow }) => ({ start, end, label, curve: Boolean(curve), arrow: Boolean(arrow) })),
        canonical: { pivot: plan.pivot ?? null, upper: plan.upper ?? null, stop: plan.stopExample ?? null }, views: [], renderer:'leader-svg-v1', rs_source:{benchmark_symbol:payload.benchmark_symbol??null}, source_bars:payload.bars.map(({date,open,high,low,close,volume})=>({date,open,high,low,close,volume})) };
      report.chart_cases.push(record); // retain real observations even if validation fails
      record.rs_selection = await observeRsSelection(page, payload, symbol);
      const sourceWarningVisible = async locator => {
        if (await locator.count() !== 1 || !await locator.isVisible()) return false;
        return locator.evaluate(node => {
          const box = node.getBoundingClientRect();
          const header = node.closest('[role="dialog"]') ? null : document.querySelector('.leader-header');
          const top = header?.getBoundingClientRect().bottom || 0;
          return box.top >= top && box.bottom <= innerHeight && box.left >= 0 && box.right <= innerWidth;
        });
      };
      const inspect = async (element, view) => {
        const values = await element.evaluate(observeSvgChart);
        record.views.push({ view, ...values });
        validateSvgChart(values,record.source_bars,`${key}/${view}`,record.rs_source);
        check(values.symbol === symbol && values.as_of_date === asOf, `${key}/${view}: rendered symbol/as-of mismatch`);
        for (const [name, expected] of Object.entries(record.canonical)) check(sameLevel(values[name], warning ? null : expected), `${key}/${view}: ${name} differs from canonical published value`);
      };
      await inspect(chart, 'inline-default');
      check(record.views[0].annotation_mode === 'vcp-off', `${key}: VCP annotations must start closed`);
      const inlineTargets=['.research-chart .leader-svg-controls','.research-chart svg[data-chart-plot]'];
      if(viewport.width===390)await page.locator('.research-chart .leader-svg-extra-controls summary').click();
      await scrollFinancialViewport(page,inlineTargets);
      const inspectInlineViewport=async()=>{const geometry=await page.evaluate(financialViewportGeometry,inlineTargets);checkFinancialViewportGeometry(geometry,check,`${key}/inline-controls-and-plot`,viewport);return geometry;};
      record.inline_geometry={default:await inspectInlineViewport()};
      record.source_warning = { expected: Boolean(plan.sourceContext?.warning) };
      if (record.source_warning.expected) {
        record.source_warning.inline_visible = await sourceWarningVisible(page.locator('.research-symbol-head .entry-source-badge'));
        check(record.source_warning.inline_visible, `${key}: first-book proximity warning is missing from the initial inline viewport`);
      }
      await capture(page, viewport, theme, `case-${symbol}-inline`, { scope: 'scrolled-viewport', viewportTargets: inlineTargets });
      const inlineToggle = page.locator('.research-chart').getByRole('button', { name: 'VCP注記', exact:true });
      if (await inlineToggle.getAttribute('aria-pressed') !== 'true') await inlineToggle.click();
      validateSvgChart(await chart.evaluate(observeSvgChart),record.source_bars,`${key}/inline-annotations`,record.rs_source);
      record.inline_geometry.annotations=await inspectInlineViewport();
      await capture(page, viewport, theme, `case-${symbol}-inline-annotations`, { scope: 'scrolled-viewport', viewportTargets: inlineTargets });
      if (Number.isFinite(plan.pivot)) {
        // Mobile entry planning is deliberately on the Conditions tab and
        // collapsed by default. Inspect it through the same controls a user
        // follows, then restore the chart before testing its expanded view.
        const mobile = viewport.width <= 700;
        const chartScroll = await page.evaluate(() => scrollY);
        if (mobile) {
          await page.getByRole('tab', { name: '購入条件', exact: true }).click();
          const disclosure = page.locator('.stock-entry-disclosure');
          if (!await disclosure.evaluate(node => node.open)) await disclosure.locator(':scope > summary').click();
        }
        const gauge = page.locator('.entry-gauge');
        await ready(gauge);
        const label = await gauge.getAttribute('aria-label');
        for (const price of [plan.price, plan.pivot, plan.upper, plan.stopExample]) check(label?.includes(money(price)), `${key}: entry card canonical level ${money(price)} missing`);
        if (mobile) {
          await page.locator('.stock-entry-disclosure > summary').click();
          await page.getByRole('tab', { name: 'チャート', exact: true }).click();
          await ready(chart);
          await page.evaluate(y => window.scrollTo({ top: y, behavior: 'instant' }), chartScroll);
        }
      }
      await page.getByRole('button', { name: '日次チャートを分析', exact: true }).click();
      const dialog = page.getByRole('dialog'), expanded = dialog.locator(`[data-chart-symbol="${symbol}"]`);
      await ready(expanded);
      await inspect(expanded, 'expanded-default');
      check(record.views.at(-1).annotation_mode === 'vcp-off', `${key}: expanded VCP annotations must start closed`);
      const decisionDetails = dialog.locator('.chart-decision-details');
      check(await decisionDetails.count() === 1 && await dialog.locator('[aria-label="チャートの判断要約"] details').count() === 1, `${key}: chart source/risk/rule context must share one disclosure`);
      if (viewport.width < 900) {
        const legend = dialog.getByTestId('mobile-chart-legend');
        check(await legend.evaluate(node => !node.open && Boolean(node.closest('[role="dialog"]').querySelector('[data-chart-symbol]').compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)), `${key}: mobile color legend must remain available below the plot on demand`);
        check(await dialog.locator('.leader-svg-legend span').filter({hasText:/^SMA(50|150|200) /}).count() === 3, `${key}: measured moving-average values are missing`);
      }
      if (record.source_warning.expected && viewport.width === 390) {
        record.source_warning.mobile_expanded_visible = await sourceWarningVisible(dialog.locator('[data-testid="mobile-chart-readiness"] .entry-source-badge'));
        check(record.source_warning.mobile_expanded_visible, `${key}: first-book proximity warning is missing from the expanded mobile header`);
      }
      await capture(page, viewport, theme, `case-${symbol}-expanded`);
      record.expanded_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_geometry, check, `${key}/expanded`, { fullChart: viewport.width >= 900 });
      if (record.source_warning.expected && viewport.width >= 900) {
        record.source_warning.desktop_expanded_visible = await sourceWarningVisible(dialog.locator('[aria-label="チャートの判断要約"] .entry-source-note [role="note"]'));
        check(record.source_warning.desktop_expanded_visible, `${key}: desktop source warning is not visible with the fitted chart`);
      }
      const expandedToggle = dialog.getByRole('button', { name: 'VCP注記', exact:true });
      if(viewport.width===390)await dialog.locator('.leader-svg-extra-controls summary').click();
      if (await expandedToggle.getAttribute('aria-pressed') !== 'true') await expandedToggle.click();
      await inspect(expanded, 'expanded-annotations');
      await capture(page, viewport, theme, `case-${symbol}-expanded-annotations`);
      record.expanded_annotation_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_annotation_geometry, check, `${key}/expanded-annotations`, { fullChart: true });
      // Additional geometry checks never replace the required 900px/844px
      // screenshots or alter performance measurement viewports/budgets.
      const shortViewport = { width: viewport.width, height: viewport.width >= 900 ? 760 : 568 };
      await page.setViewportSize(shortViewport);
      await capture(page, shortViewport, theme, `case-${symbol}-expanded-short`);
      record.expanded_short_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_short_geometry, check, `${key}/expanded-short`, { fullChart: true });
      const scroller = dialog.locator('[data-testid="expanded-chart-scroll"]');
      // On a very short viewport the plot must remain readable, and scrolling
      // must expose the real date axis without moving/covering footer controls.
      await page.setViewportSize({ width: viewport.width, height: 480 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expanded.evaluate(node => {
        const body = node.closest('[role="dialog"]').querySelector('[data-testid="expanded-chart-scroll"]');
        const axis = node.querySelector('[data-chart-date-axis]');
        const bottom = axis.getBoundingClientRect().bottom;
        body.scrollTop += bottom - body.getBoundingClientRect().bottom;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      record.expanded_scrolled_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_scrolled_geometry, check, `${key}/expanded-scrolled`);
      check(record.expanded_scrolled_geometry.date_axis_visible && record.expanded_scrolled_geometry.date_axis_hit, `${key}: date axis is not reachable by scrolling the short modal`);
      check(record.expanded_scrolled_geometry.scroll_top > 0, `${key}: short modal did not provide scrollable chart content`);
      await page.setViewportSize(viewport);
      await scroller.evaluate(node => { node.scrollTop = 0; });
      // Fitted height changes must not reset a chosen period. This functional
      // check runs after all required captures, outside performance timing.
      const rangeLabel = expanded;
      const initialRange = await rangeLabel.getAttribute('aria-label');
      if(viewport.width<=700)await dialog.getByRole('combobox',{name:'表示期間',exact:true}).selectOption('21');
      else await dialog.getByRole('button', { name: '1か月', exact: true }).click();
      await page.waitForFunction(previous => {
        const text = document.querySelector('[role="dialog"] svg[data-chart-plot]')?.getAttribute('aria-label');
        return Boolean(text && text !== previous);
      }, initialRange);
      record.selected_one_month_range = await rangeLabel.getAttribute('aria-label');
      const sourceSummary = dialog.locator('.chart-decision-details > summary');
      if (await sourceSummary.count()) {
        for (let repetition = 0; repetition < 2; repetition++) {
          if (repetition === 0) await sourceSummary.press('Enter');
          else await sourceSummary.click();
          check(await sourceSummary.evaluate(node => node.parentElement.open), `${key}: source disclosure did not open`);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          checkExpandedChartGeometry(await dialog.evaluate(expandedChartGeometry), check, `${key}/source-disclosure`);
          await sourceSummary.click();
          check(!await sourceSummary.evaluate(node => node.parentElement.open), `${key}: source disclosure did not close`);
        }
        await scroller.evaluate(node => { node.scrollTop = 0; });
      }
      // Let the existing100ms visible-range notification settle after resize.
      await page.setViewportSize(shortViewport);
      await page.waitForTimeout(180);
      check(await rangeLabel.getAttribute('aria-label') === record.selected_one_month_range, `${key}: fitted resize reset the selected period`);
      await page.setViewportSize(viewport);
      await page.waitForTimeout(180);
      check(await rangeLabel.getAttribute('aria-label') === record.selected_one_month_range, `${key}: disclosure or restored height reset the selected period`);
      const nextButton = dialog.getByRole('button', { name: '次の銘柄', exact: true });
      if (await nextButton.count()) {
        await nextButton.click();
        await page.waitForFunction(previous => {
          const current = document.querySelector('[role="dialog"] [data-chart-symbol]')?.dataset.chartSymbol;
          return current && current !== previous;
        }, symbol);
        await ready(dialog.locator('svg[data-chart-symbol]'));
        await dialog.getByRole('button', { name: '前の銘柄', exact: true }).click();
        await ready(expanded);
        await inspect(expanded, 'expanded-return-navigation');
      }
      record.visual_overlap_review = 'Screenshot review required; metadata equality does not prove pixel-level label placement.';
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
      const opener = page.getByRole('button', { name: '日次チャートを分析', exact: true });
      check(await opener.evaluate(node => node === document.activeElement), `${key}: closing expanded chart did not restore focus to its opener`);
      // Cached reopen has no loading transition: verify that the portal still
      // attaches its size observer and exposes the close button and full chart.
      await opener.click();
      await ready(expanded);
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      record.expanded_reopened_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_reopened_geometry, check, `${key}/expanded-cached-reopen`, { fullChart: viewport.width >= 900 });
      await dialog.getByRole('button', { name: 'チャートを閉じる', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
      check(await opener.evaluate(node => node === document.activeElement), `${key}: close button did not restore focus to its opener`);
      const routeBeforeBack=page.url();
      await opener.click();await ready(expanded);
      await page.waitForFunction(()=>Boolean(history.state?.__screenerChartDialog));
      await page.goBack();await dialog.waitFor({state:'hidden',timeout:10000});
      check(page.url()===routeBeforeBack&&!await page.evaluate(()=>Boolean(history.state?.__screenerChartDialog)),`${key}: browser back did not preserve route/clear chart history marker`);
      check(await opener.evaluate(node=>node===document.activeElement),`${key}: browser back did not restore opener focus`);
      record.browser_back={closed:true,route_preserved:true,marker_cleared:true,focus_restored:true};
      if (viewport.width <= 700) {
        record.immediate_touch_close = await observeImmediateTouchClose(page, dialog, opener);
        validateImmediateTouchClose(record.immediate_touch_close);
      }
    } catch (error) {
      const partial=report.chart_cases.find(record=>record.symbol===symbol&&record.viewport.width===viewport.width&&record.theme===theme);
      if(partial)partial.error=error.message;
      check(false, `${key}: chart case verification interrupted: ${error.message}`);
    } finally {
      await page.setViewportSize(viewport);
    }
  }
}
