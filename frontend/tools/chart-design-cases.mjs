import { decodeResearchIndex } from '../src/static/researchTransport.js';
import { entryPlan } from '../src/static/researchEngine.js';
import { buildBookAnnotations } from '../src/components/Charts/bookAnnotations.js';
import { chartHistoryWarning } from '../src/components/Charts/researchChartModel.js';
import { money } from '../src/static/positionGeometry.js';
import { expandedChartGeometry, checkExpandedChartGeometry } from './expanded-chart-geometry.mjs';

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
      await ready(chart.locator('canvas'));
      check((await page.locator('.symbol-title h2').textContent())?.trim() === symbol, `${key}: detail symbol mismatch`);
      const record = { symbol, viewport, theme, as_of_date: asOf, bars: payload.bars.length, history_warning: warning || null,
        annotation_candidate: annotations.candidate, annotation_summary: annotations.summary,
        shapes: annotations.boxes.map(({ start, end, label, curve, arrow }) => ({ start, end, label, curve: Boolean(curve), arrow: Boolean(arrow) })),
        canonical: { pivot: plan.pivot ?? null, upper: plan.upper ?? null, stop: plan.stopExample ?? null }, views: [] };
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
        const values = await element.evaluate(node => ({ symbol: node.dataset.chartSymbol, as_of_date: node.dataset.chartAsof, pivot: node.dataset.chartPivot, upper: node.dataset.chartUpper, stop: node.dataset.chartStop, annotation_mode: node.dataset.chartAnnotationMode }));
        check(values.symbol === symbol && values.as_of_date === asOf, `${key}/${view}: rendered symbol/as-of mismatch`);
        for (const [name, expected] of Object.entries(record.canonical)) check(sameLevel(values[name], warning ? null : expected), `${key}/${view}: ${name} differs from canonical published value`);
        record.views.push({ view, ...values });
      };
      await inspect(chart, 'inline-default');
      if (viewport.width === 390) check(await chart.getAttribute('data-chart-annotation-mode') === 'simple', `${key}: mobile initial annotations are not simple`);
      await chart.scrollIntoViewIfNeeded();
      record.source_warning = { expected: Boolean(plan.sourceContext?.warning) };
      if (record.source_warning.expected) {
        record.source_warning.inline_visible = await sourceWarningVisible(page.locator('.research-symbol-head .entry-source-badge'));
        check(record.source_warning.inline_visible, `${key}: first-book proximity warning is missing from the initial inline viewport`);
      }
      await capture(page, viewport, theme, `case-${symbol}-inline`);
      const inlineToggle = page.locator('.research-chart').getByRole('button', { name: /^図解/ });
      if (await inlineToggle.getAttribute('aria-pressed') !== 'true') await inlineToggle.click();
      await capture(page, viewport, theme, `case-${symbol}-inline-annotations`);
      const gauge = page.locator('.entry-gauge');
      if (Number.isFinite(plan.pivot)) {
        const label = await gauge.getAttribute('aria-label');
        for (const price of [plan.price, plan.pivot, plan.upper, plan.stopExample]) check(label?.includes(money(price)), `${key}: entry card canonical level ${money(price)} missing`);
      }
      await page.getByRole('button', { name: '日次チャートを分析', exact: true }).click();
      const dialog = page.getByRole('dialog'), expanded = dialog.locator(`[data-chart-symbol="${symbol}"]`);
      await ready(expanded.locator('canvas'));
      await inspect(expanded, 'expanded-default');
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
      const expandedToggle = dialog.getByRole('button', { name: /^図解/ });
      if (await expandedToggle.getAttribute('aria-pressed') !== 'true') await expandedToggle.click();
      await inspect(expanded, 'expanded-annotations');
      await capture(page, viewport, theme, `case-${symbol}-expanded-annotations`);
      // Additional geometry checks never replace the required 900px/844px
      // screenshots or alter performance measurement viewports/budgets.
      const shortViewport = { width: viewport.width, height: viewport.width >= 900 ? 760 : 568 };
      await page.setViewportSize(shortViewport);
      await capture(page, shortViewport, theme, `case-${symbol}-expanded-short`);
      record.expanded_short_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_short_geometry, check, `${key}/expanded-short`, { fullChart: viewport.width >= 900 });
      if (viewport.width < 900) check(Math.abs(record.expanded_short_geometry.plot.height - 420) <= 1, `${key}: mobile plot no longer retains its readable 420px height`);
      const scroller = dialog.locator('[data-testid="expanded-chart-scroll"]');
      // On a very short viewport the plot must remain readable, and scrolling
      // must expose the real date axis without moving/covering footer controls.
      await page.setViewportSize({ width: viewport.width, height: 480 });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await expanded.evaluate(node => {
        const body = node.closest('[role="dialog"]').querySelector('[data-testid="expanded-chart-scroll"]');
        const axis = node.querySelector('.tv-lightweight-charts > table').rows;
        const bottom = axis[axis.length - 1].getBoundingClientRect().bottom;
        body.scrollTop += bottom - body.getBoundingClientRect().bottom;
      });
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      record.expanded_scrolled_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_scrolled_geometry, check, `${key}/expanded-scrolled`);
      check(record.expanded_scrolled_geometry.date_axis_visible && record.expanded_scrolled_geometry.date_axis_hit, `${key}: date axis is not reachable by scrolling the short modal`);
      check(record.expanded_scrolled_geometry.scroll_top > 0, `${key}: short modal did not provide scrollable chart content`);
      await page.setViewportSize(viewport);
      await scroller.evaluate(node => { node.scrollTop = 0; });
      const sourceSummary = dialog.locator('.entry-source-note summary');
      if (await sourceSummary.count()) {
        for (let repetition = 0; repetition < 2; repetition++) {
          await sourceSummary.click();
          check(await sourceSummary.evaluate(node => node.parentElement.open), `${key}: source disclosure did not open`);
          await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          checkExpandedChartGeometry(await dialog.evaluate(expandedChartGeometry), check, `${key}/source-disclosure`);
          await sourceSummary.click();
          check(!await sourceSummary.evaluate(node => node.parentElement.open), `${key}: source disclosure did not close`);
        }
        await scroller.evaluate(node => { node.scrollTop = 0; });
      }
      const nextButton = dialog.getByRole('button', { name: '次の銘柄', exact: true });
      if (await nextButton.count()) {
        await nextButton.click();
        await page.waitForFunction(previous => {
          const current = document.querySelector('[role="dialog"] [data-chart-symbol]')?.dataset.chartSymbol;
          return current && current !== previous;
        }, symbol);
        await ready(dialog.locator('[data-chart-symbol] canvas'));
        await dialog.getByRole('button', { name: '前の銘柄', exact: true }).click();
        await ready(expanded.locator('canvas'));
        await inspect(expanded, 'expanded-return-navigation');
      }
      record.visual_overlap_review = 'Screenshot review required; metadata equality does not prove pixel-level label placement.';
      report.chart_cases.push(record);
      await page.keyboard.press('Escape');
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
      const opener = page.getByRole('button', { name: '日次チャートを分析', exact: true });
      check(await opener.evaluate(node => node === document.activeElement), `${key}: closing expanded chart did not restore focus to its opener`);
      // Cached reopen has no loading transition: verify that the portal still
      // attaches its size observer and exposes the close button and full chart.
      await opener.click();
      await ready(expanded.locator('canvas'));
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      record.expanded_reopened_geometry = await dialog.evaluate(expandedChartGeometry);
      checkExpandedChartGeometry(record.expanded_reopened_geometry, check, `${key}/expanded-cached-reopen`, { fullChart: viewport.width >= 900 });
      await dialog.getByRole('button', { name: 'チャートを閉じる', exact: true }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10000 });
      check(await opener.evaluate(node => node === document.activeElement), `${key}: close button did not restore focus to its opener`);
    } catch (error) {
      check(false, `${key}: chart case verification interrupted: ${error.message}`);
    } finally {
      await page.setViewportSize(viewport);
    }
  }
}
