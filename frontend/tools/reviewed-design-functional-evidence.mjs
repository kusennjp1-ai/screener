import { mobileChromeBudget } from './mobile-chrome-contract.mjs';
import { LEADER_DETAIL_CONTRACT, LEGACY_LEADER_DETAIL_CONTRACT, supportedDetailContract, leaderDetailFailures } from './leader-detail-design-contract.mjs';
import { validateSvgChart, SVG_CHART_RENDERER, SVG_EVIDENCE_CONTRACTS } from './svg-chart-evidence.mjs';
import { LEADER_FEED_CONTRACT, leaderFeedFailures } from './leader-feed-design-contract.mjs';
// Completeness/consistency checks for immutable historical browser observations.
// This is NOT source authentication, current data validation, or image review.
// The caller must independently authenticate the capture and run the unchanged
// objective policy; original failures and timing advisories are not rewritten.
import assert from 'node:assert/strict';
import { requiredScreeningCaptures, DESIGN_GROUPS } from './screening-priority-acceptance.mjs';
import { CHART_DESIGN_SYMBOLS } from './chart-design-cases.mjs';
import { validateRsSelection, validateImmediateTouchClose } from './chart-interaction-evidence.mjs';
import { validateMarketHistoryEvidence } from './market-history-functional-evidence.mjs';
import { FINANCIAL_DESIGN_CASES, financialDesignScreens } from './financial-design-cases.mjs';
import { checkExpandedChartGeometry } from './expanded-chart-geometry.mjs';
import { checkFinancialViewportGeometry } from './financial-viewport-geometry.mjs';
import { observedBarrels } from '../src/static/technicalObservation.js';
import { observedSignalLabel, observedSourceLabel } from '../src/static/observationLabels.js';

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const number = value => typeof value === 'number' && Number.isFinite(value);
const nonnegative = value => number(value) && value >= 0;
const count = value => Number.isSafeInteger(value) && value >= 0;
const sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const path = value => typeof value === 'string' && /^[A-Za-z0-9._/-]+$/.test(value) && value.split('/').every(part => part && part !== '.' && part !== '..');
const check = (condition, message) => assert(condition, message);
const exactSet = (values, expected, label) => {
  assert(Array.isArray(values) && values.length === expected.length && new Set(values).size === values.length, label + ': incomplete/duplicate records');
  assert.deepEqual([...values].sort(), [...expected].sort(), label + ': wrong identities');
};
const rect = (value, label, nullable = false, allowZero = false) => {
  if (nullable && value === null) return;
  assert(object(value) && ['top', 'bottom', 'width', 'height'].every(key => number(value[key])) && (allowZero ? value.width >= 0 && value.height >= 0 : value.width > 0 && value.height > 0), label + ': incomplete rectangle');
  for (const key of ['left', 'right']) if (Object.hasOwn(value, key)) assert(number(value[key]), label + ': invalid rectangle edge');
};
const viewport = (value, width, height, label) => assert(object(value) && value.width === width && value.height === height, label + ': wrong viewport');
const mainHeight = width => width === 1440 ? 900 : 844;
const rowIds = ['eps_growth_yy', 'sales_growth_yy', 'annual_eps_growth_3y', 'eps_rating', 'composite_rating', 'roe', 'profit_margin'];
const tableNames = ['ミネルヴィニ合格 注目銘柄 トップ20の表（横スクロール）', '主導業種グループの主導銘柄の表（横スクロール）', 'テクニカル参考候補 トップ20の表（横スクロール）', '業種グループ トップ10の表（横スクロール）'];

function screenEvidence(screen, binding, layoutContract, detailContract) {
  const [name, widthText, theme] = screen.key.split('/'), width = Number(widthText);
  const height = name.endsWith('-expanded-short') ? width === 1440 ? 760 : 568 : mainHeight(width);
  const label = screen.key, metrics = screen.metrics;
  assert(path(screen.screenshot) && screen.screenshot.endsWith('.png') && sha(screen.sha256), label + ': missing PNG identity');
  assert(Array.isArray(screen.axe) && screen.axe.length === 0, label + ': missing/failed axe evidence');
  assert(object(metrics), label + ': missing objective metrics');
  viewport(metrics.viewport, width, height, label);
  for (const field of ['smallTargets', 'fontIssues', 'radiusIssues', 'asciiNegativeValues']) assert(Array.isArray(metrics[field]) && metrics[field].length === 0, label + ': missing/failed ' + field);
  assert(Array.isArray(metrics.heroActionTargets), label + ': missing action-target observations');
  for (const item of metrics.heroActionTargets) { assert(object(item) && text(item.tag), label + ': malformed action target'); rect(item.rect, label, false, true); }
  for (const field of ['scrollY', 'pageHeight', 'headerHeight', 'bottomNavHeight', 'chromeHeight', 'visibleCompareCardFraction']) assert(nonnegative(metrics[field]), label + ': missing/invalid ' + field);
  for (const field of ['visibleCandidates', 'visibleScanCards', 'visibleCompareCards', 'runningAnimations']) assert(count(metrics[field]), label + ': missing/invalid ' + field);
  for (const field of ['hero', 'firstRow', 'chart', 'chartCard', 'detail', 'firstScanCard', 'comparisonGrid']) rect(metrics[field], label + '/' + field, true);
  assert(metrics.horizontalOverflow === false, label + ': horizontal overflow or missing observation');
  assert(metrics.chromeHeight === metrics.headerHeight + metrics.bottomNavHeight, label + ': inconsistent chrome metrics');
  assert(screen.reduced_motion_running_animations === 0, label + ': missing/failed reduced-motion observation');
  if (width === 390) assert(metrics.chromeHeight <= mobileChromeBudget(metrics), label + ': fixed chrome exceeds the measured toolbar budget');
  if(layoutContract===LEADER_FEED_CONTRACT)assert.deepEqual(leaderFeedFailures(metrics,name),[],label+': feed contract failed');
  else {
  if (['home', 'near-pass'].includes(name) && width === 1440) assert(metrics.hero && metrics.hero.height <= 320 && metrics.chart && metrics.chart.top <= 540, label + ': home geometry failed');
  if (name === 'compact') assert(metrics.firstRow && metrics.firstRow.top <= 260 && metrics.chart && metrics.chart.top <= 420 && metrics.visibleCandidates >= 12, label + ': compact geometry failed');
  if (['home', 'near-pass'].includes(name) && width === 390) assert(metrics.visibleCandidates >= 3, label + ': insufficient visible candidates');
  }
  if(supportedDetailContract(detailContract)){
    if(name==='detail'&&width<=700)assert(metrics.detailEvidence?.version===detailContract,label+': detail observation version differs from report');
    assert.deepEqual(leaderDetailFailures(metrics,name),[],label+': detail contract failed');
  }
  else if (name === 'detail' && width === 390) assert(metrics.chartCard && metrics.detail && metrics.chartCard.top - metrics.detail.top <= 160, label + ': detail/chart spacing failed');
  if (['comparison', 'comparison-near-pass'].includes(name)) {
    if (width === 1440) assert(metrics.pageHeight <= 900 && metrics.visibleCompareCards >= 6 && metrics.comparisonGrid && metrics.comparisonGrid.height <= 700, label + ': comparison geometry failed');
    else assert(metrics.visibleCompareCardFraction >= 1.5, label + ': insufficient visible comparison cards');
  }
  if (name === 'market') assert(metrics.pageHeight <= (width === 390 ? 1600 : 1000), label + ': market height failed');
  if (name === 'scan') {
    if (width === 390) assert(metrics.pageHeight <= 3000, label + ': scan height failed');
    assert(Array.isArray(screen.sparkline_columns), label + ': missing sparkline observations');
    // Preserve actual displayed-column scope; desktop has both columns, mobile
    // uses cards and may have no table headers. Never manufacture a measurement.
    const ids = screen.sparkline_columns.map(item => item.id);
    assert(new Set(ids).size === ids.length && ids.every(id => ['rs_trend', 'price_change_1d'].includes(id)), label + ': duplicate/unknown sparkline columns');
    if (width === 1440) exactSet(ids, ['rs_trend', 'price_change_1d'], label + ' sparkline columns');
    for (const column of screen.sparkline_columns) assert(count(column.geometry) && column.geometry > 0, label + ': empty sparkline geometry');
  }
  const scoped = /^(?:carry-)?financial-/.test(name) || ['daily-observations', 'daily-watchlist'].includes(name) || (supportedDetailContract(detailContract) && /^case-[A-Z0-9.-]+-inline(?:-annotations)?$/.test(name) && screen.viewport_geometry !== undefined);
  if (scoped) {
    assert(screen.screenshot_scope === 'scrolled-viewport' && screen.metrics_scope === 'original-viewport' && screen.screenshot_target === null, label + ': missing viewport capture scope');
    const geometry = screen.viewport_geometry;
    assert(object(geometry) && object(geometry.chrome) && object(geometry.content) && Array.isArray(geometry.targets) && geometry.targets.length > 0, label + ': incomplete viewport evidence');
    viewport(geometry.viewport, width, height, label);
    rect(geometry.chrome.header, label + ' header');
    rect(geometry.chrome.navigation, label + ' navigation', width !== 390);
    if(detailContract===LEADER_DETAIL_CONTRACT&&width===390&&(/^(?:carry-)?financial-/.test(name)||/^case-[A-Z0-9.-]+-inline(?:-annotations)?$/.test(name))){
      assert(geometry.section_navigation?.kind==='stock-sections',label+': missing actual stock-section navigation');
      const section=name.endsWith('-selection')?'evidence':name.endsWith('-purchase')?'conditions':name.startsWith('case-')?'chart':'financial';
      assert(geometry.section_navigation.tabs?.find(tab=>tab.selected==='true')?.id===`detail-tab-${section}`,label+': captured a different selected section');
    }
    for (const field of ['top', 'bottom', 'left', 'right']) assert(number(geometry.content[field]), label + ': missing content bound');
    assert(nonnegative(geometry.scroll_y), label + ': missing viewport scroll');
    const selectors = geometry.targets.map(item => item.selector);
    assert(selectors.every(text) && new Set(selectors).size === selectors.length, label + ': duplicate/missing viewport targets');
    for (const target of geometry.targets) {
      assert(target.count === 1 && target.shown === true && object(target.clip) && text(target.text), label + ': hidden/ambiguous viewport target');
      rect(target.rect, label + ' target');
      for (const field of ['top', 'bottom', 'left', 'right']) assert(number(target.clip[field]) && number(target.rect[field]), label + ': missing viewport bound');
      assert(Array.isArray(target.hit_samples) && target.hit_samples.length >= 9 && target.hit_samples.every(value => value === true), label + ': missing/failed hit samples');
    }
    checkFinancialViewportGeometry(geometry, check, label, { width, height });
  } else assert(screen.viewport_geometry === undefined && screen.screenshot_scope === undefined, label + ': unexpected viewport capture scope');
  if (binding.scope === 'carry') assert(screen.preview_provenance_sha256 === binding.provenance_sha256, label + ': different carry provenance');
  assert(['dark', 'light'].includes(theme), label + ': unknown theme');
}

function chartGeometry(geometry, width, height, label, fullChart) {
  assert(object(geometry), label + ': missing chart geometry'); viewport(geometry.viewport, width, height, label);
  for (const field of ['plot', 'date_axis', 'footer', 'content', 'close']) rect(geometry[field], label + '/' + field, false, field === 'footer' && geometry.footer_placement === 'header' && geometry.navigation_count === 0);
  rect(geometry.warning, label + '/warning', true);
  for (const field of ['plot', 'date_axis', 'footer', 'content', 'close', ...(geometry.warning ? ['warning'] : [])]) for (const edge of ['left', 'right']) assert(number(geometry[field][edge]), label + ': missing chart edge');
  for (const field of ['scroll_top', 'scroll_height', 'content_client_height']) assert(nonnegative(geometry[field]), label + ': missing chart scroll');
  for (const field of ['plot_visible', 'date_axis_visible', 'date_axis_hit', 'footer_visible', 'footer_hit', 'close_visible', 'close_hit']) assert(typeof geometry[field] === 'boolean', label + ': missing visibility evidence');
  assert(count(geometry.date_axis_canvases) && count(geometry.navigation_count) && ['header', 'footer'].includes(geometry.footer_placement) && text(geometry.footer_position) && Array.isArray(geometry.footer_controls), label + ': missing chart controls');
  assert(geometry.warning === null ? geometry.warning_visible === null : typeof geometry.warning_visible === 'boolean', label + ': missing warning visibility');
  for (const button of geometry.footer_controls) { assert(text(button.text) && typeof button.visible === 'boolean' && typeof button.hit === 'boolean', label + ': incomplete navigation button'); rect(button.rect, label + ' navigation target'); }
  checkExpandedChartGeometry(geometry, check, label, { fullChart });
}

export function validateInlineChartEvidence(value,width,height,label='inline chart') {
      assert(object(value),label+': missing inline controls/plot geometry');
      for(const state of ['default','annotations']){
        const geometry=value[state];
        assert(object(geometry)&&Array.isArray(geometry.targets),label+': missing inline viewport '+state);
        viewport(geometry.viewport,width,height,label);
        exactSet(geometry.targets.map(t=>t.selector),['.research-chart .leader-svg-controls','.research-chart svg[data-chart-plot]'],label+' inline targets');
        for(const target of geometry.targets){rect(target.rect,label);assert(Array.isArray(target.hit_samples)&&target.hit_samples.length>=9&&target.hit_samples.every(hit=>hit===true),label+': incomplete inline hit proof');}
        checkFinancialViewportGeometry(geometry,check,label+'/'+state,{width,height:height});
      }
  return true;
}

export function validateInlineCaptureEvidence(record, screens) {
  const {width,height}=record.viewport;
  const atCapture={};
  for(const [state,suffix] of [['default','inline'],['annotations','inline-annotations']]) {
    const key=`case-${record.symbol}-${suffix}/${width}/${record.theme}`;
    const matches=screens.filter(screen=>screen.key===key);
    assert(matches.length===1, key+': missing or duplicate inline capture');
    const screen=matches[0];
    assert(screen.screenshot_scope==='scrolled-viewport' && screen.metrics_scope==='original-viewport' && screen.screenshot_target===null, key+': missing inline viewport scope');
    atCapture[state]=screen.viewport_geometry;
  }
  // Validate the independently observed screenshot-time rectangles, not just
  // pre-capture geometry that a theme operation or asynchronous layout can stale.
  return validateInlineChartEvidence(atCapture,width,height,'inline screenshot');
}

function chartEvidence(report) {
  assert(Array.isArray(report.chart_cases), 'Missing chart cases');
  const expected = DESIGN_GROUPS.flatMap(group => CHART_DESIGN_SYMBOLS.map(symbol => symbol + '/' + group));
  exactSet(report.chart_cases.map(record => `${record.symbol}/${record.viewport?.width}/${record.theme}`), expected, 'Chart cases');
  for (const record of report.chart_cases) {
    const width = record.viewport.width, label = `${record.symbol}/${width}/${record.theme}`;
    viewport(record.viewport, width, mainHeight(width), label);
    assert(!Object.hasOwn(record, 'error') && record.as_of_date === report.data.as_of_date && count(record.bars) && record.bars > 0 && typeof record.annotation_candidate === 'boolean' && text(record.annotation_summary) && Array.isArray(record.shapes), label + ': incomplete chart source');
    assert(record.history_warning === null || text(record.history_warning), label + ': missing history warning state');
    if(supportedDetailContract(report.detail_contract) && record.renderer===SVG_CHART_RENDERER){
      validateInlineChartEvidence(record.inline_geometry,width,mainHeight(width),label);
      validateInlineCaptureEvidence(record, report.screens);
    }
    assert(object(record.canonical) && ['pivot', 'upper', 'stop'].every(field => record.canonical[field] === null || number(record.canonical[field])), label + ': missing canonical levels');
    assert(Array.isArray(record.views) && [3, 4].includes(record.views.length), label + ': incomplete chart views');
    exactSet(record.views.map(view => view.view), ['inline-default', 'expanded-default', 'expanded-annotations', ...(record.views.length === 4 ? ['expanded-return-navigation'] : [])], label + ' views');
    if(record.renderer !== undefined) assert(record.renderer === SVG_CHART_RENDERER,label+': unknown chart renderer');
    const svg=record.renderer === SVG_CHART_RENDERER;
    for (const view of record.views) {
      if(report.svg_evidence_contract!==undefined)assert(SVG_EVIDENCE_CONTRACTS.includes(report.svg_evidence_contract)&&view.evidence_contract===report.svg_evidence_contract,label+': missing/unknown SVG provenance contract');
      if(svg)validateSvgChart(view,record.source_bars,label,record.rs_source);
      assert(view.symbol === record.symbol && view.as_of_date === record.as_of_date && (svg ? ['vcp-on','vcp-off'].includes(view.annotation_mode) : ['simple', 'detail'].includes(view.annotation_mode)), label + ': wrong rendered chart identity');
      for (const field of ['pivot', 'upper', 'stop']) {
        const expected = record.history_warning ? null : record.canonical[field];
        assert(expected === null ? view[field] === '' || view[field] === null : typeof view[field] === 'string' && view[field].trim() !== '' && number(Number(view[field])) && Math.abs(Number(view[field]) - expected) < 1e-8, label + ': canonical level differs');
      }
      if (!svg && width === 390 && view.view === 'inline-default') assert(view.annotation_mode === 'simple', label + ': mobile annotations are not simple');
    }
    assert(object(record.source_warning) && typeof record.source_warning.expected === 'boolean', label + ': missing warning evidence');
    if (record.source_warning.expected) assert(record.source_warning.inline_visible === true && record.source_warning[width === 390 ? 'mobile_expanded_visible' : 'desktop_expanded_visible'] === true, label + ': source warning hidden');
    chartGeometry(record.expanded_geometry, width, mainHeight(width), label + '/expanded', width >= 900);
    // Immutable earlier captures retain their original contract. New captures
    // explicitly bind the opened annotation state, including its real date axis.
    if (report.expanded_annotation_geometry_contract !== undefined) {
      assert(report.expanded_annotation_geometry_contract === 'full-plot-v1', label + ': unknown expanded annotation geometry contract');
      chartGeometry(record.expanded_annotation_geometry, width, mainHeight(width), label + '/expanded-annotations', true);
    }
    chartGeometry(record.expanded_short_geometry, width, width === 1440 ? 760 : 568, label + '/short', true);
    chartGeometry(record.expanded_scrolled_geometry, width, 480, label + '/scrolled', false);
    assert(record.expanded_scrolled_geometry.date_axis_visible === true && record.expanded_scrolled_geometry.date_axis_hit === true && record.expanded_scrolled_geometry.scroll_top > 0, label + ': date-axis scrolling incomplete');
    chartGeometry(record.expanded_reopened_geometry, width, mainHeight(width), label + '/reopened', width >= 900);
    assert(text(record.selected_one_month_range) && text(record.visual_overlap_review), label + ': missing range/review evidence');
    // New captures bind interaction evidence as well as pixel geometry. Old
    // authenticated v2 archives retain their original exact requirements.
    if (report.svg_evidence_contract === 'leader-svg-provenance-v3') {
      validateRsSelection(record.rs_selection, record.as_of_date);
      for (const field of ['closed', 'route_preserved', 'marker_cleared', 'focus_restored']) assert(record.browser_back?.[field] === true, label + ': browser back evidence missing');
      if (width <= 700) validateImmediateTouchClose(record.immediate_touch_close);
    }
  }
}

function viewsEvidence(record, expected, screens, label) {
  assert(Array.isArray(record.views), label + ': missing scoped views');
  exactSet(record.views.map(view => view.screen), expected, label + ' views');
  for (const view of record.views) {
    const screen = screens.get(`${view.screen}/${record.viewport.width}/${record.theme}`);
    assert(view.scope === 'scrolled-viewport' && screen && Array.isArray(view.targets), label + ': incomplete scoped view');
    exactSet(view.targets, screen.viewport_geometry.targets.map(target => target.selector), label + ' view targets');
  }
}

function financialEvidence(report, binding, screens, carry = false) {
  const records = carry ? report.financial_carry_cases : report.financial_cases, prefix = carry ? 'carry-' : '';
  assert(Array.isArray(records), 'Missing ' + prefix + 'financial cases');
  exactSet(records.map(record => `${record.symbol}/${record.viewport?.width}/${record.theme}`), [1440, 390].flatMap(width => FINANCIAL_DESIGN_CASES.map(item => `${item.symbol}/${width}/${width === 1440 ? 'dark' : 'light'}`)), prefix + 'financial cases');
  for (const record of records) {
    const label = `${prefix}financial-${record.symbol}/${record.viewport.width}/${record.theme}`, item = FINANCIAL_DESIGN_CASES.find(item => item.symbol === record.symbol);
    viewport(record.viewport, record.viewport.width, mainHeight(record.viewport.width), label);
    assert(!Object.hasOwn(record, 'error') && record.category === item.category && record.method === 'oneil' && record.as_of_date === report.data.as_of_date && record.research_generation === report.data.research_generation && text(record.financial_evaluated_at) && Number.isFinite(Date.parse(record.financial_evaluated_at)), label + ': incomplete financial identity');
    const expected = financialDesignScreens(record.viewport, record.theme).filter(name => name.startsWith(`financial-${record.symbol}-`)).map(name => prefix + name);
    viewsEvidence(record, expected, screens, label);
    for (const view of record.views) {
      let targets;
      if (view.screen.endsWith('-annual-viewport')) targets = ['.financial-evidence-heading h4', '.financial-evidence-status', '.financial-evidence-value strong', '.financial-evidence-value span', ...[1,2,3].map(index => `.financial-evidence-metadata > div:nth-child(${index})`)].map(selector => '#financial-evidence-annual_eps_growth_3y ' + selector);
      else if (view.screen.endsWith('-evidence')) targets = ['#financial-evidence-eps_growth_yy'];
      else if (view.screen.endsWith('-selection')) targets = ['#detail-panel-evidence > h3', ...[1,2,3].map(index => `#detail-panel-evidence .research-rules > li:nth-child(${index})`)];
      else if (view.screen.endsWith('-purchase')) targets = ['#detail-panel-conditions > h3', ...[1,2].map(index => `#detail-panel-conditions .condition-rules > li:nth-child(${index})`)];
      else if (view.screen.endsWith('-history')) targets = ['#detail-panel-financial > details.research-disclosure > summary', ...(carry ? ['#detail-panel-financial > details.research-disclosure > p'] : record.history_status === 'unavailable' ? ['#detail-panel-financial > details.research-disclosure > :nth-child(2)'] : ['#detail-panel-financial > details.research-disclosure > div:first-of-type > table.financial-history-table > caption', '#detail-panel-financial > details.research-disclosure > div:first-of-type > table.financial-history-table'])];
      if((report.detail_contract===LEGACY_LEADER_DETAIL_CONTRACT || (report.detail_contract===LEADER_DETAIL_CONTRACT && record.viewport.width>700)) && view.screen.endsWith('-selection'))targets.unshift('#detail-tab-evidence');
      if((report.detail_contract===LEGACY_LEADER_DETAIL_CONTRACT || (report.detail_contract===LEADER_DETAIL_CONTRACT && record.viewport.width>700)) && view.screen.endsWith('-purchase'))targets.unshift('#detail-tab-conditions');
      exactSet(view.targets, targets, label + ' actual financial targets');
    }

    assert(object(record.source) && Array.isArray(record.financial_rows), label + ': missing financial evidence');
    exactSet(record.financial_rows.map(row => row.id), rowIds, label + ' financial rows');
    for (const row of record.financial_rows) {
      assert(['pass', 'fail', 'unknown', 'reference', 'not_applicable'].includes(row.state) && ['role', 'actual', 'condition', 'status', 'text'].every(field => text(row[field])) && object(row.metadata), label + ': incomplete financial row');
      for (const key of ['対象期', '提供元', '取得', '指標', '基準', '単位']) assert(text(row.metadata[key]), label + ': missing financial source label');
      if (row.state === 'unknown') assert(text(row.explanation), label + ': unexplained financial unknown');
    }
    const summary = record.financial_summary, required = record.financial_rows.filter(row => row.role === '必須');
    assert(object(summary) && summary.required === required.length && summary.required > 0 && summary.failed === required.filter(row => row.state === 'fail').length && summary.unknown === required.filter(row => row.state === 'unknown').length && summary.heading === `財務の必須条件 ${summary.required}件 · 未達 ${summary.failed}件 · 未確認 ${summary.unknown}件`, label + ': inconsistent financial totals');
    for (const key of ['selection', 'purchase']) {
      const value = record[key];
      assert(object(value) && ['passed', 'total', 'failed', 'unknown'].every(field => count(value[field])) && value.total > 0 && value.passed + value.failed + value.unknown === value.total && Array.isArray(value.rules) && value.rules.length === value.total && value.rules.every(text), label + ': incomplete ' + key + ' totals/rules');
      const heading = `${key === 'selection' ? '選定' : '購入条件'} ${value.passed}/${value.total} · 未達 ${value.failed} · 未確認 ${value.unknown}`;
      assert(key === 'selection' ? value.heading === heading : typeof value.heading === 'string' && value.heading.startsWith(heading + ' · '), label + ': inconsistent ' + key + ' heading');
    }
    const csv = record.csv, selected = record.selection;
    assert(object(csv) && csv.source === 'actual browser download' && text(csv.filename) && Array.isArray(csv.headers) && csv.headers.every(text) && object(csv.row), label + ': missing actual CSV observation');
    exactSet(csv.headers, Object.keys(csv.row), label + ' CSV columns');
    const row = csv.row;
    assert(row.symbol === record.symbol && row.as_of_date === record.as_of_date && row.method === 'oneil' && ['true', 'false'].includes(row.qualified), label + ': CSV identity changed');
    for (const [column, field] of [['passed', 'passed'], ['total', 'total'], ['unknown', 'unknown'], ['failed_count', 'failed'], ['unknown_count', 'unknown']]) assert(row[column] === String(selected[field]), label + ': CSV decision count differs');
    if (selected.unknown > 0 || selected.failed > 0) assert(row.qualified === 'false', label + ': unknown/failed mandatory rules qualify in CSV');
    if (!carry) assert(count(record.source.unknown) && typeof record.source.qualified === 'boolean' && (!record.source.unknown || record.source.qualified === false), label + ': source unknown qualifies');
    if (carry) {
      assert(record.evidence_kind === 'supplemental-expired-carry' && record.satisfies_fresh_category === false && record.preview_provenance_sha256 === binding.provenance_sha256, label + ': carry claims fresh authority');
      assert(csv.validation === 'passed' && path(csv.artifact) && sha(csv.sha256) && count(csv.bytes) && csv.bytes > 0 && Number.isFinite(Date.parse(csv.observed_browser_at)), label + ': incomplete carry CSV artifact');
      assert(object(record.history_withheld) && record.history_withheld.tables === 0 && record.history_withheld.annual_points === 0 && text(record.history_withheld.text), label + ': expired financial history not withheld');
    }
  }
}

function dailyEvidence(report, screens) {
  assert(Array.isArray(report.daily_observations), 'Missing Daily operations');
  exactSet(report.daily_observations.map(record => `${record.viewport?.width}/${record.theme}`), ['1440/dark', '390/light'], 'Daily cases');
  for (const record of report.daily_observations) {
    const label = `daily/${record.viewport.width}/${record.theme}`, source = record.source;
    viewport(record.viewport, record.viewport.width, mainHeight(record.viewport.width), label);
    assert(!Object.hasOwn(record, 'error') && object(source) && text(source.symbol) && source.as_of_date === report.data.as_of_date && object(source.buy) && object(source.sell), label + ': incomplete Daily source');
    const initial = record.initial_rows;
    assert(object(initial) && count(initial.count) && initial.count > 0 && initial.count <= 20 && Array.isArray(initial.symbols) && initial.symbols.length === initial.count && initial.symbols.every(text) && new Set(initial.symbols).size === initial.count && initial.symbols.includes(source.symbol), label + ': incomplete/duplicate initial rows');
    assert(path(source.index_path) && [source.buy.last_close, source.buy.trigger_price].every(value => number(value) && value > 0), label + ': missing Daily source prices/index');
    assert(object(record.displayed) && text(record.displayed.observation) && text(record.displayed.watch) && ['unknown', 'future', 'old', 'unverified'].includes(record.displayed.freshness), label + ': missing Daily display or calendar age promoted to latest-session verification');
    const observation = record.displayed.observation, watch = record.displayed.watch;
    for (const value of [`記録終値 ${source.buy.last_close.toFixed(2)} · シグナル基準値 ${source.buy.trigger_price.toFixed(2)}`, `配信基準日 ${source.as_of_date}`, `旧モデルの確認項目 ${observedBarrels(source.buy)}`, `記録時のシグナル ${observedSignalLabel(source.buy.active)}`, `検出経路 ${observedSourceLabel(source.buy.vcp_source)}`, 'テクニカル観測のみ · 購入条件は未判定']) assert(observation.includes(value), label + ': Daily observation differs from source/scope');
    for (const value of [`配信基準日 ${source.as_of_date}`, '売却モデル参考', '実際の保有・注文は未確認']) assert(watch.includes(value), label + ': watch lacks historical/holdings scope');
    assert(!/BUY NOW|今日の買い候補|日次の買い条件通過|now |size |株数|資金/.test(observation) && !/要売却|保有継続|損切り |利確 |[+-]?\d+(?:\.\d+)?R/.test(watch), label + ': unsupported current purchase/holding instruction');
    assert(record.watch_keyboard_added === true && record.watch_keyboard_removed === true && record.research_keyboard_destination?.symbol === source.symbol && record.research_keyboard_destination?.hash === '#/?symbol=' + encodeURIComponent(source.symbol), label + ': failed keyboard navigation/watch');
    viewsEvidence(record, ['daily-observations', 'daily-watchlist'], screens, label);
    for (const view of record.views) exactSet(view.targets, [`[data-testid=${JSON.stringify((view.screen === 'daily-observations' ? 'todays-buys-row-' : 'watchlist-row-') + source.symbol)}]`], label + ' actual Daily target');
    assert(Array.isArray(record.table_keyboard_scroll), label + ': missing table keyboard observations');
    exactSet(record.table_keyboard_scroll.map(item => item.name), tableNames, label + ' tables');
    for (const table of record.table_keyboard_scroll) assert(nonnegative(table.width) && table.width > 0 && nonnegative(table.content) && table.content >= table.width && (table.content > table.width + 1 ? table.moved === true : table.moved === null), label + ': failed/unmeasured table scroll');
  }
}

export function validateFunctionalEvidence(report, binding) {
  assert(object(report) && object(binding) && ['ordinary', 'carry'].includes(binding.scope) && report.commit === binding.commit && report.input_basis === 'same_verified_input' && !report.assessment_mode, 'Functional evidence scope differs');
  assert(object(report.data) && report.data.as_of_date === binding.as_of_date && report.data.research_generation === binding.research_generation, 'Functional data identity differs');
  assert(Array.isArray(report.screens), 'Missing screenshots');
  assert(report.mobile_map_contract===undefined||report.mobile_map_contract==='mobile-market-map-v1','Unknown mobile map contract');
  exactSet(report.screens.map(screen => screen.key), requiredScreeningCaptures(binding.scope, report.mobile_map_contract === 'mobile-market-map-v1'), 'Screen captures');
  assert(new Set(report.screens.map(screen => screen.screenshot)).size === report.screens.length, 'Duplicate screenshot path');
  assert(report.detail_contract === undefined || supportedDetailContract(report.detail_contract), 'Unknown detail contract');
  assert(report.layout_contract === undefined || report.layout_contract === LEADER_FEED_CONTRACT, 'Unknown layout contract');
  for (const screen of report.screens) screenEvidence(screen, binding, report.layout_contract, report.detail_contract);
  const screens = new Map(report.screens.map(screen => [screen.key, screen]));
  chartEvidence(report); financialEvidence(report, binding, screens); dailyEvidence(report, screens);
  if (report.svg_evidence_contract === 'leader-svg-provenance-v3') validateMarketHistoryEvidence(report);
  if (binding.scope === 'carry') {
    financialEvidence(report, binding, screens, true);
    assert(Array.isArray(report.financial_carry_browser_ui), 'Missing actual carry UI response groups');
    exactSet(report.financial_carry_browser_ui.map(record => `${record.viewport?.width}/${record.theme}`), DESIGN_GROUPS, 'Carry browser groups');
    for (const group of report.financial_carry_browser_ui) {
      viewport(group.viewport, group.viewport.width, mainHeight(group.viewport.width), 'Carry browser group');
      assert(group.provenance_sha256 === binding.provenance_sha256 && Array.isArray(group.observations) && group.observations.some(item => item.path === 'index.html') && group.observations.some(item => item.path.endsWith('.js')), 'Incomplete actual carry UI bootstrap');
      const observed = new Map();
      for (const item of group.observations) {
        assert(path(item.path) && sha(item.sha256) && count(item.bytes) && item.bytes > 0 && item.source === 'actual browser response', 'Malformed carry UI response');
        const identity = item.sha256 + '/' + item.bytes;
        assert(!observed.has(item.path) || observed.get(item.path) === identity, 'Carry browser response changed within group'); observed.set(item.path, identity);
      }
    }
  }
  return true;
}
