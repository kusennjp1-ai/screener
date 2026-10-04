# Compound rule states

Compound conditions use three-state AND: an independently supported failure wins
against an unknown subcondition; otherwise an unknown wins against passes. Method
IDs, thresholds and existing source acceptance guards are unchanged. Standalone
missing growth fields are never recast as failures.

For O’Neil's annual EPS rule, the consumer retains the existing current-history
identity, source/basis/currency and observation-clock checks. It also requires all
four ordered consecutive fiscal endpoints and the existing latest-period age
limit before emitting any partial comparison. It never skips a missing year.
Each adjacent pair needs finite reported EPS and a positive baseline to produce a
finite rate. Null EPS remains null; a nonpositive baseline stays a separate
noncomparable condition. Native annual histories retain their explicit source
contract. Legacy USD histories with unsupported annual-level or per-point
source/currency overrides cannot authorize new partial comparison evidence.

`annualComplete` retains its old meaning: all four EPS values are present in a
valid annual window. `annualGrowth` remains null unless all three rates are
comparable. `annualComparisons` reports the individual known rates and unresolved
pairs. A partial annual failure has a null aggregate minimum; the displayed and
CSV evidence names the confirmed failed pairs and unresolved years. IBD's annual
criterion continues to test completeness only, independent of growth success.
Presentation requires its bound partial condition to agree with the actual
failure; a stale pass with a null value cannot pass that binding check.

Market trend booleans use strict boolean comparisons. Multiple moving-average
conditions and rising-day/volume conditions combine independently supported
subconditions only after the existing whole daily-audit gate. No raw technical
values can rescue a rejected audit. Malformed operands remain unknown, and
invalid volume ratios are not displayed as measured values.

The research summary version is bumped. The existing workbench fingerprint hashes
both changed rule/history files, so existing observations remain immutable and
comparisons across the old/new policy are marked incomparable rather than new
historical market events.

Run focused Vitest checks in `compoundRuleStates.test.js`, the financial history
and financial evidence tests, and the summary/encoding/missing-condition tests.
The offline diagnostic compares an unchanged projection and bound target against
the prior frontend policy, asserts zero pass/qualification/rank increases, and
checks all list/detail/chart/presentation/CSV/filter surfaces:

```
node frontend/tools/verify-compound-rule-states.mjs \
  BASELINE_FRONTEND TARGET_BASE NATIVE_PROJECTION OUTPUT_REPORT
```

It makes no provider requests or remote writes. The diagnostic's 1,894 liquid
and 1,846 verified-price cohort assertions describe the restored October 4 source
batch and October 2 price snapshot.

## Restored-cohort impact

At the unchanged October 4 15:30 UTC evaluation, the logical correction moves
296 of 1,894 liquid rows from unknown to failed on O’Neil's annual rule. Counts
are 36 pass, 1,478 fail, 377 unknown and 3 inapplicable (previously
36 / 1,182 / 673 / 3). On 1,846 verified-price rows, 291 change: counts are
35 / 1,462 / 346 / 3 (previously 35 / 1,171 / 637 / 3).

All method pass counts, overall qualification counts, and ranking orders are
unchanged. The verified-price set with zero failed rules and only unknown
blockers falls from three to zero: AVT, SMTC and MSGS now retain their proven
annual failures. Across the full 5,901-row target, 316 annual rules change,
including 20 pre-existing histories outside the restored acquisition cohort.
No other rule changes on these actual rows.

AVT retains missing June 2026 EPS, null annualGrowth and null annualComplete.
Its June 2023–2024 and 2024–2025 comparisons are −34.26% and −49.36%.
SMTC retains complete EPS availability, but two nonpositive-base comparisons
remain unknown; its January 2023–2024 comparison proves failure. IBD completeness
is unchanged. Of the 99 native annual histories, 81 have fully comparable rates;
18 retain nonpositive baselines, of which 10 also contain a proven failure.
Their canonical annual states are 5 pass / 86 fail / 8 unknown.
