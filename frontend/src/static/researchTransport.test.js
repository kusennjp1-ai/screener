import { describe, expect, it } from 'vitest';
import { encodeResearchIndex, decodeResearchIndex, researchListRow, RESEARCH_METHODS, RESEARCH_TRANSPORT_VERSION } from './researchTransport';
import { prepareResearchBundle } from './researchPreprocess';
import { assess, rankCandidates, researchCsv, RULE_SUMMARY_VERSION } from './researchEngine';
import { withAuditFixture } from './testAuditFixture';

const date = '2026-09-29';
const sample = extra => withAuditFixture({ symbol: 'TEST', market: 'US', currency: 'USD', current_price: 102, adv_usd: 25000000,
  rs_rating: 90, eps_rating: 80, composite_rating: 90, ibd_group_rank: 20, eps_growth_yy: 25, sales_growth_yy: 25,
  annual_eps_growth_3y: [25, 25, 25], se_pivot_price: 100, ...extra }, date);
const ordersFor = rows => Object.fromEntries(RESEARCH_METHODS.map(method => [method, rankCandidates(rows, method).map(({row}) => rows.findIndex(source=>source.symbol===row.symbol))]));
const encode = rows => encodeResearchIndex({ as_of_date: date, rows }, ordersFor(rows));

describe('lossless compact research transport', () => {
  it('decodes retained v1 dictionaries without changing absence, null, false or exact numbers', () => {
    const legacy = { schema: 'research-table-v1', as_of_date: date, count: 5, fields: [['symbol'], ['value']],
      columns: [{ values: ['A', 'B', 'C', 'D', 'E'] }, { pool: [null, false, 0, 24.999999999999996], refs: [-1, 0, 1, 2, 3] }] };
    expect(decodeResearchIndex(legacy).rows).toEqual([{ symbol: 'A' }, { symbol: 'B', value: null }, { symbol: 'C', value: false }, { symbol: 'D', value: 0 }, { symbol: 'E', value: 24.999999999999996 }]);
  });
  it('uses explicitly versioned sparse columns without losing exact values or absence', () => {
    const rows = Array.from({ length: 80 }, (_, i) => ({ symbol: `S${i}`,
      ...(i === 0 || i > 60 ? {} : { value: [null, false, 0, 24.999999999999996][i - 1] ?? (i === 1 ? null : i + 1e-12) }) }));
    const wire = encodeResearchIndex({ as_of_date: date, rows });
    expect(wire.schema).toBe(RESEARCH_TRANSPORT_VERSION);
    expect(wire.schema).not.toBe('research-table-v1');
    expect(wire.column_encoding).toBe('sparse-binary-and-signed-zero-v1');
    expect(wire.columns.some(column => column.present)).toBe(true);
    expect(decodeResearchIndex(JSON.parse(JSON.stringify(wire))).rows).toEqual(rows);
    expect(() => decodeResearchIndex({ ...wire, schema: 'research-table-v1' })).toThrow();
    expect(() => decodeResearchIndex({ ...wire, column_encoding: 'future' })).toThrow();
    expect(() => decodeResearchIndex({ ...wire, column_encoding: undefined })).toThrow();
  });
  it.each([
    { present: [1, 2], missing: [[1, 2], [1, 2]] },
    { present: [1], missing: [[0, 2], [1, 3]] },
    { present: [1, 2], missing: [[0, 1], [1, 2]] },
    { present: [1, 2, 3], missing: [[-1, 0]] },
    { present: [1, 2, 3], missing: [[0, 0]] },
    { present: [1, 2], missing: [[2, 4]] },
    { present: [1, 2], missing: [[1.5, 2.5]] },
    { present: [1, 2], missing: [[1]] },
    { present: [1, 2], missing: [[1, 2, 3]] },
    { present: [1, 2], missing: [] },
    { present: [1, 2, 3, 4], missing: [] },
    { present: [1, 2], missing: null },
    { present: null, missing: [[0, 3]] },
    { present: [1, 2], missing: [[1, 2]], values: [1, null, 2] },
  ])('rejects malformed sparse intervals, counts and mixed representations: %j', column => {
    const wire = { schema: RESEARCH_TRANSPORT_VERSION, column_encoding: 'present-values-and-missing-runs-v1', as_of_date: date, count: 3, fields: [['value']], columns: [column] };
    expect(() => decodeResearchIndex(wire)).toThrow();
  });
  it('rejects duplicate fields and applies ordinary copy columns after sparse reconstruction', () => {
    const wire = { schema: RESEARCH_TRANSPORT_VERSION, column_encoding: 'present-values-and-missing-runs-v1', as_of_date: date, count: 3,
      fields: [['value'], ['alias']], columns: [{ present: [0, 1.125], missing: [[1, 2]] }, { copy: 0, patch: [] }] };
    expect(decodeResearchIndex(wire).rows).toEqual([{ value: 0, alias: 0 }, {}, { value: 1.125, alias: 1.125 }]);
    expect(() => decodeResearchIndex({ ...wire, fields: [['value'], ['value']] })).toThrow('Duplicate research field');
  });
  it.each([undefined,null])('keeps the valid payload date when expected date is %s',expectedDate=>{
    expect(prepareResearchBundle([{as_of_date:date,rows:[]}],expectedDate).date).toBe(date);
  });
  it.each([undefined,null,'2026-02-30','invalid',42])('rejects malformed payload date %s without an expected date',actualDate=>{
    expect(()=>prepareResearchBundle([{as_of_date:actualDate,rows:[]}])).toThrow('Snapshot date mismatch');
  });
  it.each(['','invalid','2026-02-30','2026-09-28'])('does not discard an explicit unmatched expected date %s',expectedDate=>{
    expect(()=>prepareResearchBundle([{as_of_date:date,rows:[]}],expectedDate)).toThrow('Snapshot date mismatch');
  });
  it('preserves absent, null, false, zero and exact floating point values', () => {
    const rows = [sample({ price_activity: { lowRange: false, range60pct: 0 }, eps_growth_yy: 24.999999999999996 }),
      { symbol: 'UNKNOWN', current_price: null, technical_audit: null, se_setup_ready: false },
      { symbol: 'ABSENT' }];
    const decoded = decodeResearchIndex(JSON.parse(JSON.stringify(encode(rows))));
    expect(decoded.rows).toEqual(rows.map(researchListRow));
    expect(Object.hasOwn(decoded.rows[2], 'technical_audit')).toBe(false);
  });
  it('keeps canonical threshold states, evidence, CSV and ordering unchanged at exact boundaries', () => {
    const rows = Array.from({ length: 36 }, (_, i) => {
      const row = sample({ symbol: `T${i}`, eps_growth_yy: 25 + (i % 3 - 1) * 1e-12, rs_rating: 70 + (i % 3 - 1) * 1e-12 });
      row.technical_audit.values.sma50 = row.current_price + (i % 3 - 1) * 1e-12;
      row.technical_audit.values.aboveLow = 30 + (i % 3 - 1) * 1e-12;
      row.chart_path = `verified-charts/${row.symbol}-0123456789abcdef.json`;
      row.research_detail_path = `research-details/${row.symbol}-fedcba9876543210.json`;
      return row;
    });
    const decoded = prepareResearchBundle([JSON.parse(JSON.stringify(encode(rows)))], date);
    for (const method of RESEARCH_METHODS) {
      expect(decoded.rankings[method].map(({row}) => row.symbol)).toEqual(rankCandidates(rows, method).map(({row}) => row.symbol));
      expect(researchCsv(decoded.rankings[method], method, date,0)).toBe(researchCsv(rankCandidates(rows, method), method, date,0));
      rows.forEach((row, i) => expect(assess(decoded.rows[i], method)).toEqual(assess(row, method)));
    }
    expect(decoded.rows[0].chart_path).toBe(rows[0].chart_path);
    expect(decoded.rows[0].research_detail_path).toBe(rows[0].research_detail_path);
  });
  it('retains publication dates needed to reject unpublished institutional information', () => {
    const row = sample({ institutional_evidence: { symbol: 'TEST', status: 'available', unit: '13f_reporting_manager_cik', publication_cutoff: '2026-10-01',
      observations: [{ period: '2026-03-31', manager_count: 100, filing_date_first: '2026-05-01', filing_date_last: '2026-05-15' }, { period: '2026-06-30', manager_count: 110, filing_date_first: '2026-08-01', filing_date_last: '2026-08-15' }],
      source: 'Detail-only source', refresh: { notes: 'Detail only' } } });
    const compact = decodeResearchIndex(encode([row])).rows[0];
    expect(assess(compact, 'oneil')).toEqual(assess(row, 'oneil'));
    expect(assess(compact, 'oneil').rules.find(rule => rule.label.startsWith('I：')).state).toBe('unknown');
    expect(compact.institutional_evidence.source).toBeUndefined();
  });
  it('rejects damaged columns, foreign paths, invalid ranking and mixed dates', () => {
    const packed = encode([sample()]);
    const wrongColumn = structuredClone(packed); wrongColumn.columns[0] = { copy: 100, patch: [] };
    expect(() => decodeResearchIndex(wrongColumn)).toThrow();
    const wrongPath = structuredClone(packed); wrongPath.fields[0] = ['__proto__', 'bad'];
    expect(() => decodeResearchIndex(wrongPath)).toThrow();
    expect(prepareResearchBundle([{ ...packed, orders: { ...packed.orders, minervini: [0, 0] } }], date).rankings.minervini).toHaveLength(1);
    expect(() => prepareResearchBundle([packed], '2026-09-28')).toThrow('Snapshot date mismatch');
  });
  it('recalculates rankings and portfolio input after an explicit verification invalidates a row', () => {
    const row = sample();
    const loaded = prepareResearchBundle([encode([row])], date);
    const updated = { ...loaded.rows[0], method_summary: undefined, technical_audit: { valid: false, as_of_date: date, errors: ['再検証に失敗'] } };
    const next = prepareResearchBundle([{ rows: [updated], as_of_date: date }], date);
    expect(next.rankings.minervini[0].assessment.qualified).toBe(false);
    expect(next.prepared.candidates).toEqual([]);
    expect(next.rankings.minervini[0].row).toBe(next.rows[0]);
  });
});


describe('published rule-summary invalidation',()=>{
 const summarize=row=>({...row,method_summary:{version:RULE_SUMMARY_VERSION,...Object.fromEntries(RESEARCH_METHODS.map(method=>{const {rules,...summary}=assess(row,method);expect(summary.total).toBe(rules.length);return [method,summary];}))}});
 it.each(['research-summary-v2',undefined])('does not preserve old ordering with %s summaries',version=>{
  const rows=[sample({symbol:'OLD_FIRST',rs_rating:60}),sample({symbol:'NOW_FIRST',rs_rating:90})].map(summarize);
  for(const row of rows) row.method_summary=version?{...row.method_summary,version}:undefined;
  const orders=Object.fromEntries(RESEARCH_METHODS.map(method=>[method,[0,1]]));
  const bundle=prepareResearchBundle([{as_of_date:date,rows,orders}],date);
  for(const method of RESEARCH_METHODS)expect(bundle.rankings[method].map(x=>x.row.symbol)).toEqual(rankCandidates(bundle.rows,method).map(x=>x.row.symbol));
  expect(bundle.rankings.minervini[0].row.symbol).toBe('NOW_FIRST');
 });
 it.each(['conflict','stale','missing'])('drops cached success when the audit becomes %s',mode=>{
  const strong=summarize(sample({symbol:'OLD_FIRST',rs_rating:95}));
  const other=summarize(sample({symbol:'NOW_FIRST',rs_rating:90}));
  const replacement=structuredClone(strong);
  if(mode==='conflict')replacement.current_price=103;
  if(mode==='stale')replacement.technical_audit.as_of_date='2026-09-28';
  if(mode==='missing')delete replacement.technical_audit;
  const rows=mode==='conflict'?[strong,replacement,other]:[replacement,other];
  const orders=Object.fromEntries(RESEARCH_METHODS.map(method=>[method,[0,1]]));
  const bundle=prepareResearchBundle([{as_of_date:date,rows,orders}],date);
  expect(bundle.rows[0].method_summary).toBeUndefined();
  expect(bundle.rankings.minervini[0].row.symbol).toBe('NOW_FIRST');
  expect(bundle.rankings.minervini.find(x=>x.row.symbol==='OLD_FIRST').assessment.qualified).toBe(false);
 });
 it('recomputes current-version summaries and preserves shared prepared row identity',()=>{
  const rows=[sample({symbol:'A'}),sample({symbol:'B'})].map(summarize),orders=ordersFor(rows);
  const bundle=prepareResearchBundle([{as_of_date:date,rows,orders}],date);
  for(const method of RESEARCH_METHODS)expect(bundle.rankings[method].map(item=>bundle.rows.indexOf(item.row))).toEqual(orders[method]);
 });
});

it.each([[],[9,0,1,9,0],{}, {passed:9,failed:0,unknown:0,total:9,qualified:true,score:99,templateMismatch:false}])('reranks when current-version summary content is malformed: %j',malformed=>{
 const rows=[sample({symbol:'LOW',rs_rating:60}),sample({symbol:'HIGH',rs_rating:90})];
 for(const row of rows) row.method_summary={version:RULE_SUMMARY_VERSION,...Object.fromEntries(RESEARCH_METHODS.map(method=>{const {rules,...summary}=assess(row,method);expect(summary.total).toBe(rules.length);return [method,summary];}))};
 const orders=ordersFor(rows);orders.minervini=[0,1];
 rows[0].method_summary.minervini=malformed;
 const bundle=prepareResearchBundle([{as_of_date:date,rows,orders}],date);
 expect(bundle.rankings.minervini.map(x=>x.row.symbol)).toEqual(['HIGH','LOW']);
 const {rules,...expected}=assess(rows[0],'minervini');expect(rules.length).toBe(expected.total);expect(bundle.rankings.minervini[1].assessment).toEqual(expected);
});
