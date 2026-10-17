import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import ResearchDetail from './ResearchDetail';
import { bookRuleComparisons } from '../bookRuleComparisons';
import { assess } from '../researchEngine';
import { mergeFinancialDetail } from '../financialCurrent';
import { decodeResearchIndex, encodeResearchIndex, researchListRow } from '../researchTransport';
import { createResearchReceiver } from '../researchWorkerPackets';
import { nativeAnnualFixture } from '../../test/fixtures/nativeAnnual';
import { withAuditFixture } from '../testAuditFixture';
import { withFinancialProof, FINANCIAL_TEST_DATE as date, FINANCIAL_TEST_NOW as now } from '../testFinancialFixture';

vi.mock('./QualificationVerification', () => ({ default: () => <div data-testid="qualification-verification" /> }));
vi.mock('./ResearchChart', () => ({ default: () => <div data-testid="research-chart" /> }));

let workerHandler;
beforeAll(async () => {
  vi.stubGlobal('self', {});
  await import('../researchWorker.js');
  workerHandler = self.onmessage;
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const generation = 'annual-transport-fixture';
function fixture(kind = 'legacy', values = [1, 1.2, 1.6, 2]) {
  const history = nativeAnnualFixture(kind === 'legacy' ? 'USD' : kind, values);
  history.symbol = history.annual_source.symbol = 'BOOK';
  history.retrieved_at = history.annual_source.observed_at = new Date(now - 1000).toISOString();
  if (kind === 'legacy') for (const key of ['schema_version', 'annual_currency', 'quarterly_currency', 'quarterly_retrieved_at', 'annual_source']) delete history[key];
  return withFinancialProof(withAuditFixture({ symbol: 'BOOK', market: 'US', as_of_date: date,
    current_price: 104, se_pivot_price: 100, rs_rating: 90, sales_growth_yy: 30,
    research_detail_path: 'research-details/BOOK-0123456789abcdef.json', financial_history: history }, date));
}
const annualCard = (row, clock = now) => bookRuleComparisons(row, { date, now: clock, method: 'oneil' }).cards.find(card => card.id === 'oneil-annual');
const annualRule = row => assess(row, 'oneil', now).rules.find(rule => rule.label.includes('3年'));
const mergeOptions = (row, clock = now) => ({ now: clock, asOfDate: date, generation, detailGeneration: generation,
  expectedDetailPath: row.research_detail_path, detailPath: row.research_detail_path });

// Exercise the actual Worker prepare/decode and acknowledged packet delivery,
// including JSON transport and structured cloning, rather than mock its result.
async function stages(full, clock = now) {
  const compact = researchListRow(full);
  const wire = JSON.parse(JSON.stringify(encodeResearchIndex({ as_of_date: date, rows: [full] })));
  const decoded = decodeResearchIndex(wire).rows[0];
  const messages = [];
  vi.stubGlobal('self', { postMessage: message => messages.push(structuredClone(message)) });
  await workerHandler({ data: { operation: 'prepare', payloads: [wire], date, evaluation: { now: clock, generation } } });
  const receive = createResearchReceiver();
  let bundle;
  while (!bundle) {
    expect(messages).toHaveLength(1);
    const message = messages.shift();
    expect(message).not.toHaveProperty('error');
    bundle = receive(message.packet);
    if (!bundle) await workerHandler({ data: { operation: 'next-packet' } });
  }
  const worker = bundle.rows[0];
  expect(bundle.rankings.oneil[0].row).toBe(worker);
  const hydrated = mergeFinancialDetail(worker, full, mergeOptions(full, clock));
  return { full, compact, decoded, worker, hydrated };
}

function renderAnnual(row, clock = now) {
  const result = render(<ResearchDetail selected={row} method="oneil" date={date} now={clock}
    market={{ cap: .5, label: '上昇' }} version={generation} watch={[]} detail={{ isSuccess: true }} onVerificationToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole('tab', { name: '書籍検証' }));
  expect(screen.getByRole('region', { name: '4冊の条件と現行判定' })).toBeInTheDocument();
  return { ...result, card: result.container.querySelector('[data-rule-id="oneil-annual"]') };
}

describe.each(['legacy', 'CAD'])('%s annual evidence stays fail-closed through transport and hydration', kind => {
  it.each([
    ['point currency', row => { row.financial_history.annual[2].currency = 'EUR'; }],
    ['point basis', row => { row.financial_history.annual[2].basis = 'basic_eps'; }],
    ['point source', row => { row.financial_history.annual[2].source = 'Different provider'; }],
    ['point unit', row => { row.financial_history.annual[2].unit = 'cents_per_share'; }],
    ['undefined point metadata', row => { row.financial_history.annual[2].basis = undefined; }],
    ['null point metadata', row => { row.financial_history.annual[2].basis = null; }],
    ['point scale', row => { row.financial_history.annual[2].scale = 100; }],
    ['annual currency', row => { row.financial_history.annual_currency = 'JPY'; }],
    ['annual basis', row => { row.financial_history.basis = 'adjusted_eps'; }],
    ['history issuer', row => { row.financial_history.symbol = 'OTHER'; }],
    ['history date', row => { row.financial_history.as_of_date = '2026-10-01'; }],
    ['observed issuer', row => { row.financial_identity = { observed_scope: { symbol: 'OTHER' } }; }],
    ['observed market', row => { row.financial_identity = { observed_scope: { market: 'JP' } }; }],
    ['observed date', row => { row.financial_identity = { observed_scope: { as_of_date: '2026-10-01' } }; }],
    ['missing source', row => { row.financial_history.source = null; }],
    ['unknown source', row => { row.financial_history.source = 'unknown'; }],
    ['malformed clock', row => { row.financial_history.retrieved_at = '2026-10-03'; }],
    ['expired clock', row => { row.financial_history.retrieved_at = new Date(now - 73 * 3600000).toISOString(); }],
    ['future clock', row => { row.financial_history.retrieved_at = new Date(now + 60000).toISOString(); }],
    ['missing year', row => { row.financial_history.annual.splice(1, 1); }],
    ['skipped year', row => { row.financial_history.annual[0].end = '2020-12-31'; }],
    ['duplicate period', row => { row.financial_history.annual[1].end = row.financial_history.annual[0].end; }],
    ['reversed periods', row => { row.financial_history.annual.reverse(); }],
    ['malformed period', row => { row.financial_history.annual[1].end = '2023-02-30'; }],
    ['future period', row => { row.financial_history.annual[3].end = '2026-12-31'; }],
    ['expired fiscal window', row => { row.financial_history.annual.forEach((point, i) => { point.end = `${2019 + i}-12-31`; }); }],
  ])('retains unknown for %s in the actual book card', async (_name, mutate) => {
    const full = fixture(kind); mutate(full);
    const original = structuredClone(full);
    const pipeline = await stages(full);
    for (const candidate of Object.values(pipeline)) expect(annualCard(candidate)).toMatchObject({ state: 'unknown', value: null, strictThresholdState: 'unknown' });
    const { card } = renderAnnual(pipeline.hydrated);
    expect(card).toHaveAttribute('data-rule-state', 'unknown');
    expect(card).not.toHaveTextContent('25.99%');
    expect(full).toEqual(original);
  });
});

it.each(['legacy', 'USD', 'CAD', 'EUR', 'GBP', 'CNY'])('keeps a legitimate %s history and exact values across every stage', async kind => {
  const full = fixture(kind);
  full.financial_history.annual[0].revenue = 100.123456789;
  full.financial_history.annual[0].netIncome = 10.123456789;
  const pipeline = await stages(full);
  for (const candidate of Object.values(pipeline)) {
    expect(candidate.financial_history.annual.map(({ end, eps }) => ({ end, eps }))).toEqual(full.financial_history.annual.map(({ end, eps }) => ({ end, eps })));
    expect(annualCard(candidate)).toEqual(annualCard(full));
    expect(annualRule(candidate)).toEqual(annualRule(full));
  }
  expect(pipeline.compact.financial_history.annual[0]).toEqual({ end: '2022-12-31', eps: 1 });
  const { card } = renderAnnual(pipeline.hydrated);
  expect(card).toHaveAttribute('data-rule-state', 'pass');
  expect(card).toHaveTextContent('25.99%');
  expect(card).toHaveTextContent('同じ4期で毎年25%以上）：この比較は未充足');
});

it.each(['legacy', 'CAD'])('preserves genuine partial-known-failure semantics for %s', async kind => {
  // The optional excerpt now shares fail-dominant AND semantics with its card.
  const full = fixture(kind, [8, 4, 2, null]);
  const pipeline = await stages(full);
  for (const candidate of Object.values(pipeline)) {
    expect(annualRule(candidate)).toEqual(annualRule(full));
    expect(annualRule(candidate).state).toBe('fail');
    expect(annualCard(candidate).state).toBe('fail');
  }
  expect(renderAnnual(pipeline.hydrated).card).toHaveAttribute('data-rule-state', 'fail');
});

it.each(['legacy', 'CAD'])('does not turn ambiguous partial failures into proven failures for %s', async kind => {
  const full = fixture(kind, [8, 4, 2, null]);
  full.financial_history.annual[2].unit = 'cents_per_share';
  for (const candidate of Object.values(await stages(full))) {
    expect(annualRule(candidate)).toMatchObject({ state: 'unknown', comparisons: [] });
  }
});

it('retains the offending legacy metadata and a JSON-stable rejection-only marker', async () => {
  const full = fixture();
  Object.assign(full.financial_history.annual[2], { currency: 'EUR', basis: undefined, source: null, unit: { scale: 100 } });
  const pipeline = await stages(full);
  expect(pipeline.compact.financial_history.annual[2]).toEqual({ ...full.financial_history.annual[2], invalid_transport_metadata: true });
  for (const candidate of [pipeline.decoded, pipeline.worker, pipeline.hydrated]) {
    expect(candidate.financial_history.annual[2]).toMatchObject({ currency: 'EUR', source: null, unit: { scale: 100 }, invalid_transport_metadata: true });
    expect(annualCard(candidate).state).toBe('unknown');
  }
  expect(researchListRow(pipeline.compact)).toEqual(pipeline.compact);
  expect(full.financial_history.annual[2]).not.toHaveProperty('invalid_transport_metadata');
});

it.each([
  ['undefined proof extension', history => { history.annual_source.extra = undefined; }],
  ['wrong proof issuer', history => { history.annual_source.symbol = 'OTHER'; }],
  ['wrong proof unit', history => { history.annual_source.unit = 'cents_per_share'; }],
  ['wrong share basis', history => { history.annual_source.share_basis = 'adr_converted'; }],
  ['missing receipt', history => { history.annual_source.receipt_sha256 = null; }],
])('keeps the native contract fail-closed for %s', async (_name, mutate) => {
  const full = fixture('CAD'); mutate(full.financial_history);
  const pipeline = await stages(full);
  for (const candidate of Object.values(pipeline)) expect(annualCard(candidate).state).toBe('unknown');
  expect(renderAnnual(pipeline.hydrated).card).toHaveAttribute('data-rule-state', 'unknown');
});

it.each(['legacy', 'CAD'])('rechecks the annual 72-hour boundary for %s after worker delivery', async kind => {
  const full = fixture(kind);
  const expires = now + 1000;
  full.financial_history.retrieved_at = new Date(expires - 72 * 3600000).toISOString();
  if (kind !== 'legacy') full.financial_history.annual_source.observed_at = full.financial_history.retrieved_at;
  const { worker } = await stages(full);
  const atBoundary = mergeFinancialDetail(worker, full, mergeOptions(full, expires));
  expect(annualCard(atBoundary, expires).state).toBe('pass');
  const { card, rerender, container } = renderAnnual(atBoundary, expires);
  expect(card).toHaveAttribute('data-rule-state', 'pass');
  const expired = mergeFinancialDetail(worker, full, mergeOptions(full, expires + 1));
  rerender(<ResearchDetail selected={expired} method="oneil" date={date} now={expires + 1}
    market={{ cap: .5, label: '上昇' }} version={generation} watch={[]} detail={{ isSuccess: true }} onVerificationToggle={vi.fn()} />);
  expect(container.querySelector('[data-rule-id="oneil-annual"]')).toHaveAttribute('data-rule-state', 'unknown');
});

it.each([
  ['generation', (_detail, options) => { options.detailGeneration = 'previous'; }],
  ['path', (_detail, options) => { options.detailPath = 'research-details/BOOK-old.json'; }],
  ['symbol', detail => { detail.symbol = 'OTHER'; }],
  ['market', detail => { detail.market = 'JP'; }],
  ['date', detail => { detail.as_of_date = '2026-10-01'; }],
  ['proof epoch', detail => { detail.financial_current.t -= 1; }],
])('keeps summary rejection and refuses late/foreign %s detail', async (_name, mutate) => {
  const full = fixture(); full.financial_history.annual[2].currency = 'EUR';
  const { worker } = await stages(full);
  const detail = fixture(); detail.detail_only_marker = 'must not merge';
  const options = mergeOptions(full); mutate(detail, options);
  const result = mergeFinancialDetail(worker, detail, options);
  expect(result).not.toHaveProperty('detail_only_marker');
  expect(result.financial_current).toEqual(worker.financial_current);
  expect(annualCard(result).state).toBe('unknown');
  expect(renderAnnual(result).card).toHaveAttribute('data-rule-state', 'unknown');
});

it('does not replace rejected summary evidence with a richer matching detail', async () => {
  const full = fixture(); full.financial_history.annual[2].basis = 'basic_eps';
  const { worker } = await stages(full);
  const detail = fixture(); detail.detail_only_marker = 'matched detail';
  const result = mergeFinancialDetail(worker, detail, mergeOptions(full));
  expect(result.detail_only_marker).toBe('matched detail');
  expect(result.financial_history).toBe(worker.financial_history);
  expect(annualCard(result).state).toBe('unknown');
  expect(renderAnnual(result).card).toHaveAttribute('data-rule-state', 'unknown');
});
