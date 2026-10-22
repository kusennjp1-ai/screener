// Assessment only: this module never grants publication or activation authority.
// Exact local classifications retain the original failing Design report.
import { FINANCIAL_DESIGN_CASES, financialDesignScreens } from './financial-design-cases.mjs';

export const LIMITED_RESEARCH_SCOPE = 'limited-research-preview-v1';
const finite = value => Number.isFinite(value) && value >= 0;

export function measuredPerformanceFailures(report) {
  const failures = new Set();
  for (const item of report.performance || []) {
    if (item.label !== 'current' || ![1440, 390].includes(item.viewport?.width) || item.runs?.length !== 3 ||
        !item.runs.every(run => ['candidate_ms', 'method_switch_ms', 'longest_initial_task_ms'].every(key => finite(run[key])))) continue;
    const median = [...item.runs.map(run => run.candidate_ms)].sort((a, b) => a - b)[1];
    const switching = Math.max(...item.runs.map(run => run.method_switch_ms));
    const longest = Math.max(...item.runs.map(run => run.longest_initial_task_ms));
    if (item.candidate_median_ms !== median || item.maximum_switch_ms !== switching || item.longest_initial_task_ms !== longest) continue;
    const width = item.viewport.width;
    if (median > 4200) failures.add(`${width}: Q1 candidate median ${median}ms > 4200ms`);
    if (switching > 480) failures.add(`${width}: Q1 method switch ${switching}ms > 480ms`);
    if (median > 3500 || switching > 400 || longest > 200) failures.add(`${width}: P1 exact limits not met (3500ms / 400ms / 200ms)`);
  }
  for (const item of report.radar || []) {
    if (![1440, 390].includes(item.viewport?.width) || item.runs?.length !== 3 || !item.runs.every(run => finite(run.first_frame_ms))) continue;
    const width = item.viewport.width, maximum = Math.max(...item.runs.map(run => run.first_frame_ms));
    if (maximum > 50) failures.add(`${width}: D9 first paint opportunity ${maximum.toFixed(1)}ms > 50ms`);
    item.runs.forEach((run, index) => {
      if (run.first_frame_ms > 50) failures.add(`${width}: D9 run ${index + 1}: first frame ${run.first_frame_ms}ms (limit 50ms)`);
    });
  }
  return failures;
}

export function buildLimitedResearchAssessment(report, approvedLimitations = []) {
  if (report.assessment_mode !== LIMITED_RESEARCH_SCOPE) throw Error('Explicit limited assessment mode required');
  if (!Array.isArray(approvedLimitations) || approvedLimitations.some(value => typeof value !== 'string' || !value) || new Set(approvedLimitations).size !== approvedLimitations.length) throw Error('Limitations must be a unique array of exact failure strings');
  if (!Array.isArray(report.failures) || report.failures.some(value => typeof value !== 'string')) throw Error('Original Design failures are required');
  const measurable = measuredPerformanceFailures(report);
  const accepted = approvedLimitations.filter(value => report.failures.includes(value) && measurable.has(value));
  const blocking = report.failures.filter(value => !accepted.includes(value));
  for (const value of approvedLimitations) if (!accepted.includes(value)) blocking.push(`Unaccepted limitation (not an exact recorded, measured performance failure): ${value}`);
  if (!/^[a-f0-9]{40}$/.test(report.commit || '') || !Number.isFinite(Date.parse(report.measured_at)) || !report.data?.as_of_date || !report.data?.research_generation) blocking.push('Limited assessment identity/clock/data binding is incomplete');
  const screens = (Array.isArray(report.screens) ? report.screens : []).map(screen => ({ key: screen?.key, sha256: screen?.sha256 }));
  const screenKeys = new Set(screens.map(screen => screen.key));
  if (!screens.length || screenKeys.size !== screens.length || screens.some(screen => typeof screen.key !== 'string' || !screen.key || !/^[a-f0-9]{64}$/.test(screen.sha256 || ''))) blocking.push('Limited assessment requires a nonempty unique screenshot inventory with authentic byte hashes');
  for (const [width, theme] of [[1440, 'dark'], [390, 'light']]) {
    for (const name of financialDesignScreens({ width }, theme)) {
      const key = `${name}/${width}/${theme}`;
      if (!screenKeys.has(key)) blocking.push(`Required financial screenshot missing: ${key}`);
    }
  }
  const cases = report.financial_cases || [];
  const expected = FINANCIAL_DESIGN_CASES.flatMap(item => [[1440, 'dark'], [390, 'light']].map(([width, theme]) => ({ ...item, width, theme })));
  if (cases.length !== expected.length) blocking.push('Limited assessment requires exactly ten original financial case/viewport records');
  for (const item of expected) {
    const records = cases.filter(record => record.symbol === item.symbol && record.category === item.category && record.viewport?.width === item.width && record.theme === item.theme);
    const record = records[0], category = record?.source?.original_category;
    if (records.length !== 1 || record.error || !record.csv || !record.selection || !record.purchase || !record.financial_rows?.length || !Number.isFinite(Date.parse(record.financial_evaluated_at)) ||
        record.as_of_date !== report.data?.as_of_date || record.research_generation !== report.data?.research_generation || category?.category !== item.category ||
        !['demonstrated', 'unavailable'].includes(category?.status) || (category.status === 'unavailable' && !category.reason) ||
        (record.source.unknown > 0 && record.source.qualified !== false)) blocking.push(`${item.symbol}/${item.width}/${item.theme}: incomplete or inconsistent actual financial observation`);
  }
  return {
    schema_version: 'limited-research-assessment-v1', scope_id: LIMITED_RESEARCH_SCOPE,
    label: 'LIMITED RESEARCH PREVIEW', publication_authority: 'none',
    ui_sha: report.commit, evaluated_at: report.measured_at, data_identity: report.data,
    original_design_failures: [...report.failures], accepted_performance_limitations: accepted,
    financial_cases: cases, screens, performance_measurements: report.performance || [],
    radar_measurements: report.radar || [], blocking_failures: blocking,
  };
}
