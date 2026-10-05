import { expect, it } from 'vitest';
import { compareCurrentObservations, compareSnapshots, HISTORY_METHODS, UNIVERSE_VERSION } from './candidateHistory';
import { INSTRUMENT_APPLICABILITY_VERSION } from './instrumentApplicability';

const legacy = '62608490484974eb799ee1ebc99f8599d212afb4819fcecae17589a11de48f7a';
const active = 'cc4035a0098344e48ba472459dbed4fe953b9ab8fe424af3fd1a91192e5f3d57';
const ref = (day, mark) => ({ path: `candidate-history/${day}-${mark.repeat(16)}.json.gz`, sha256: mark.repeat(64), as_of: day });
const row = (symbol, state, liquid = true) => ({ symbol, market: 'US', liquid,
  methods: Object.fromEntries(HISTORY_METHODS.map(method => [method, { state, rules: [[state, null, null]] }])) });
const snapshot = (day, records, modern = true) => ({ schema_version: 1, as_of: day, generated_at: `${day}T22:00:00Z`,
  rule_version: modern ? active : legacy, universe_version: UNIVERSE_VERSION,
  ...(modern ? { instrument_applicability_version: INSTRUMENT_APPLICABILITY_VERSION } : {}),
  definitions: Object.fromEntries(HISTORY_METHODS.map(method => [method, [{ id: `${method}:1`, label: 'Recorded condition' }]])), records });

it('does not surface 1892 legacy-policy transitions in the 1896-row current-policy view', () => {
  const before = [], firstRows = [];
  for (let i = 0; i < 1892; i++) {
    const symbol = `ROW${String(i).padStart(4, '0')}`;
    const previousState = i < 19 ? 'fail' : i < 125 ? 'pass' : i < 1169 ? 'unknown' : 'fail';
    const nextState = i < 121 ? 'pass' : i < 125 ? 'fail' : i < 1169 ? 'unknown' : 'fail';
    before.push(row(symbol, previousState)); firstRows.push(row(symbol, nextState));
  }
  for (const symbol of ['ATEC', 'IBRX', 'INGR', 'THRM']) { before.push(row(symbol, 'fail', false)); firstRows.push(row(symbol, 'unknown', null)); }
  const previous = snapshot('2026-10-01', before, false), first = snapshot('2026-10-02', firstRows, false);
  const current = snapshot('2026-10-02', firstRows.map(record => ({ ...record, liquid: true })));
  const original = JSON.stringify([previous, first, current]);
  expect(compareSnapshots(first, previous).minervini.counts).toEqual({ new: 19, continued: 102, returned: 0, dropped: 4, incomparable: 1044, unchanged: 723 });
  const result = compareCurrentObservations({ current, currentRef: ref(current.as_of, 'a'), recordedCurrent: { snapshot: first, ref: ref(first.as_of, 'b') }, previous, previousRef: ref(previous.as_of, 'c'), history: [previous] });
  expect(result.changes.minervini.counts).toEqual({ new: 0, continued: 0, returned: 0, dropped: 0, incomparable: 1896, unchanged: 0 });
  expect(result.daily_changes_snapshot).toBeNull();
  expect(result.comparison_basis).toMatchObject({ mode: 'incompatible_policy', current_source: 'current_snapshot', active_policy: { rule_version: active }, saved_first: { policy: { rule_version: legacy } }, previous: { policy: { rule_version: legacy } } });
  expect(JSON.stringify([previous, first, current])).toBe(original);
});

it('keeps first-recorded same-policy events when a same-date source correction changes current states', () => {
  const previous = snapshot('2026-10-01', [row('TEST', 'fail')]);
  const first = snapshot('2026-10-02', [row('TEST', 'fail')]);
  const current = snapshot('2026-10-02', [row('TEST', 'pass')]);
  const firstRef = ref(first.as_of, 'b');
  const result = compareCurrentObservations({ current, currentRef: ref(current.as_of, 'a'), recordedCurrent: { snapshot: first, ref: firstRef }, previous, previousRef: ref(previous.as_of, 'c'), history: [previous] });
  expect(result.changes.minervini.items[0].state).toBe('unchanged');
  expect(result.daily_changes_snapshot).toEqual(firstRef);
  expect(result.comparison_basis.mode).toBe('saved_first_same_policy');
});

it('rejects historical return attribution from a different applicability policy', () => {
  const previous = snapshot('2026-10-01', [row('TEST', 'fail')]), current = snapshot('2026-10-02', [row('TEST', 'pass')]);
  const earlier = { ...snapshot('2026-09-30', [row('TEST', 'pass')]), instrument_applicability_version: 'old-policy' };
  const result = compareCurrentObservations({ current, currentRef: ref(current.as_of, 'a'), previous, previousRef: ref(previous.as_of, 'b'), history: [earlier, previous] });
  expect(result.changes.minervini.items[0].state).toBe('new');
  expect(result.comparison_basis.mode).toBe('saved_first_same_policy');
});

it('does not fabricate a transition when the first observation used another policy even if previous matches', () => {
  const previous = snapshot('2026-10-01', [row('TEST', 'fail')]), current = snapshot('2026-10-02', [row('TEST', 'pass')]);
  const first = snapshot('2026-10-02', [row('TEST', 'fail')], false);
  const result = compareCurrentObservations({ current, currentRef: ref(current.as_of, 'a'), recordedCurrent: { snapshot: first, ref: ref(first.as_of, 'b') }, previous, previousRef: ref(previous.as_of, 'c') });
  expect(result.comparison_basis.mode).toBe('incompatible_policy');
  expect(result.changes.minervini.items[0].state).toBe('incomparable');
});

it('fails closed on missing active policy or a mismatched first-record date', () => {
  const current = snapshot('2026-10-02', [row('TEST', 'pass')]);
  expect(() => compareCurrentObservations({ current: { ...current, instrument_applicability_version: undefined }, currentRef: ref(current.as_of, 'a') })).toThrow();
  expect(() => compareCurrentObservations({ current, currentRef: ref(current.as_of, 'a'), recordedCurrent: { snapshot: snapshot('2026-10-01', []), ref: ref('2026-10-01', 'b') } })).toThrow();
});
