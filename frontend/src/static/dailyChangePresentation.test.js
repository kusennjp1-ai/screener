import { expect, it } from 'vitest';
import { CHANGE_LABELS, compareSnapshots, HISTORY_METHODS } from './candidateHistory';
import { dailyChangePresentation } from './dailyChangePresentation';
import { summarizeWorkbench } from './workbenchSummary';

const counts = extra => ({ ...Object.fromEntries(Object.keys(CHANGE_LABELS).map(key => [key, 0])), ...extra });
const query = (values, history = { previous_as_of: '2026-09-28' }) => ({ data: {
  history, changes: { minervini: { counts: counts(values) } },
} });

it('retains valid transition counts, including a genuinely zero-change comparison', () => {
  expect(dailyChangePresentation(query({ new: 7, returned: 2, dropped: 3 }), 'minervini').label).toBe('変化：新たに通過 7 · 再通過 2 · 脱落 3');
  expect(dailyChangePresentation(query({ continued: 4, unchanged: 20 }), 'minervini').label).toBe('変化：新たに通過 0 · 再通過 0 · 脱落 0');
});

it('distinguishes all-incomparable, partially comparable and empty populations', () => {
  expect(dailyChangePresentation(query({ incomparable: 20 }), 'minervini')).toMatchObject({ label: '変化：全20銘柄が比較不能', fullyIncomparable: true });
  const partial = dailyChangePresentation(query({ incomparable: 18, unchanged: 2 }), 'minervini');
  expect(partial.label).toBe('変化：比較不能 18 / 20銘柄');
  expect(partial.fullyIncomparable).toBeUndefined();
  expect(partial.explanation).toContain('比較できた2銘柄分');
  expect(dailyChangePresentation(query({}), 'minervini').label).toBe('変化：比較対象なし');
});

it('keeps first recording, loading, failure and missing-method summaries distinct', () => {
  expect(dailyChangePresentation(query({ incomparable: 3 }, { previous_as_of: null }), 'minervini').label).toBe('変化：記録開始（次回から）');
  expect(dailyChangePresentation({}, 'minervini').label).toBe('変化：読み込み中');
  expect(dailyChangePresentation({ ...query({ new: 7 }), isError: true }, 'minervini').label).toBe('変化：取得できません');
  expect(dailyChangePresentation(query({ new: 7 }), 'oneil')).toEqual({ label: '変化：集計未取得' });
  for (const data of [{}, { history: { previous_as_of: null }, changes: {} }, { history: {}, changes: { minervini: { counts: { new: 0 } } } }]) {
    expect(dailyChangePresentation({ data }, 'minervini')).toEqual({ label: '変化：集計未取得' });
  }
});

it.each([undefined, null, -1, 1.5, '2'])('does not turn an unavailable or invalid incomparable count (%s) into zero', incomparable => {
  expect(dailyChangePresentation(query({ incomparable }), 'minervini')).toEqual({ label: '変化：集計未取得' });
});

it('does not assert coverage for counts that disagree with the published population', () => {
  const value = query({ incomparable: 3 });
  value.data.changes.minervini.item_count = 4;
  expect(dailyChangePresentation(value, 'minervini')).toEqual({ label: '変化：集計未取得' });
});

it.each(['rule-version', 'unknown-evidence'])('describes %s coverage from the lightweight summary without guessing the cause', cause => {
  const snapshot = (as_of, rule_version, state) => ({ as_of, rule_version, universe_version: 'u1', definitions: {}, records: [{ symbol: 'A', market: 'US', liquid: true,
    methods: Object.fromEntries(HISTORY_METHODS.map(method => [method, { state, rules: [] }])),
  }] });
  const old = snapshot('2026-09-28', 'r1', 'fail'), current = snapshot('2026-09-29', cause === 'rule-version' ? 'r2' : 'r1', cause === 'unknown-evidence' ? 'unknown' : 'pass');
  const changes = compareSnapshots(current, old);
  const data = summarizeWorkbench({ history: { previous_as_of: old.as_of }, changes });
  expect(data.changes.minervini).not.toHaveProperty('items');
  expect(data.changes.minervini.counts).toEqual(changes.minervini.counts);
  const presentation = dailyChangePresentation({ data }, 'minervini');
  expect(presentation).toMatchObject({ ready: true, label: '変化：全1銘柄が比較不能', fullyIncomparable: true });
  expect(presentation.explanation).toContain('通過・脱落の変化は判定できません');
  expect(presentation.explanation).not.toMatch(/ルール版|定義変更|未確認/);
});
