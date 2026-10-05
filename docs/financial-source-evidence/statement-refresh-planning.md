# Bounded statement refresh planning

`backend/app/services/statement_refresh_planning.py` is a pure planner. It does
not fetch statements, open a provider session, write a cache, modify a scalar,
change a scanner, schedule jobs, or publish artifacts. Integration is separate.

## Input and trust boundary

Call `plan_statement_refresh` with the explicit canonical eligible-symbol cohort,
one canonical market, evaluation time, persisted validated statuses and actual
attempt records. The maximum selected batch is **200 symbols**, irrespective of
how many statement attributes each symbol needs. Duplicate/noncanonical cohort
members and metadata for foreign symbols raise an error. Missing status is an
unknown EPS proof, unknown sales proof and missing annual-history acquisition;
it is never a numeric zero.

`SymbolStatus`, `ProofStatus`, `HistoryStatus` and `VerifiedAcquisition` are an
**internal adapter contract**, not a validator for arbitrary JSON. Do not create
these by trusting flags from an unverified cache or public artifact. The caller
must derive them as follows:

1. Validate the original financial evidence envelope, original capture digest,
   observation/value binding, provider identity and producer contract. Use the
   existing `validate_envelope` and `build_static_financial_current` path for
   supported scalar proofs; do not certify a scalar from its presence alone.
2. Decide the precise EPS and sales fields required by the consuming gate. All
   required fields must be proved by that existing verifier. Its `0` and `f`
   reasons mean source-valid proof; `f` preserves the nonpositive comparison
   state without inventing positive-base growth. Aggregate all original receipts
   and the earliest exact proof expiry (`p[field_index][5]`). No required field
   may disappear from the aggregate just because it failed validation. A mixed
   complete/incomplete aggregate is `gap`.
3. Set acquisition `attributes` to the canonical union needed by those fields:
   `quarterly_income_stmt`, then `income_stmt`. Most quarterly EPS/sales gates
   need the first; an annual EPS CAGR proof also needs the second. Derived
   EPS/SMR/composite ratings and `eps_raw_score` are not acquisition requirements.
4. Copy only audited original acquisition identity, receipt ID, retained source
   digest and original observed-at timestamp into `VerifiedAcquisition`. Its
   three verification flags default to false. For proof bindings use
   `static-financial-current-v2`; this labels the adapter contract and does not
   replace the original field's provider/producer/basis/cadence checks. The
   planner rechecks exact symbol/market/contract binding, digest/ID shape, all
   flags, timezone, future timestamps and the original 7-day source ceiling.
5. Independently validate annual `financial_history` using the existing reported
   diluted EPS basis, statement currency and period requirements. `available`
   means the required annual chain is structurally valid, including finite
   explicit cells; it does not require positive growth. Re-evaluate this
   structural status against the current evaluation/as-of context on each run.
   Carry the original valid annual chain's exact existing reporting-period
   deadline in `HistoryStatus.expires_at`. Its effective lifetime is the minimum
   of that deadline and the oldest included source receipt plus 72 hours. This
   makes a newly crossed reporting-period deadline due work even when the source
   receipt is only hours old. An expiry before its source clock is invalid
   availability metadata; do not use historical replay to label an already-stale
   annual acquisition available.
   Preserve the real source receipt under contract `financial_history`; if the
   artifact combines acquisitions, use the oldest required original clock and
   retain the bindings for all constituent source snapshots. A cache's `retrieved_at`,
   `updated_at`, file mtime, proof evaluation time or successful cache write is
   never sufficient to produce this receipt. On replay preserve the original
   observed-at clock; reserialization does not renew acquisition freshness.
   Bind each receipt's `attribute` to its audited statement getter. Populate
   `HistoryStatus.receipts` with the actually included original acquisitions;
   its primary `receipt` must be a member with the oldest original clock.
   Duplicate, unverified, incorrectly scoped or mismatched constituent receipts
   invalidate the availability metadata. Legacy unscoped receipts retain
   conservative behavior and are not assigned invented acquisition identities.
6. Use `source_period_missing` only after a verified actual acquisition shows
   that a required metric/period is absent. A null scalar, unsupported producer,
   failed getter, invalid identity, bad digest or empty transport failure is not
   proof that the source genuinely lacks the period. These remain gaps/failures.
   Never interpolate a missing year, infer zero, or derive Q4 by subtraction.

If an audited acquisition has a known semantic limitation, such as a zero
comparison base, an unsupported scalar contract, or an algorithm's minimum-base
restriction, use `source_limited` with an explicit bounded `source_reason`,
verified original receipts and the exact existing source/reporting-period expiry.
This means acquired-but-not-certifiable: the scalar remains unknown in current
financial proof, and no proof tuple is invented. It is distinct from an absent
source period and from the existing `nonpositive_proved` state. A valid limitation
does not cause immediate refill, but its actual expiry or requested maintenance
horizon can make acquisition due. Missing/invalid receipt or expiry metadata
falls back to a proof gap instead of suppressing work.

The planner deliberately does not duplicate proof arithmetic, reporting-period
validation, currency/basis verification or source identity resolution against raw
provider payloads. The trusted adapter owns these checks. An unsupported/missing
proof or invalid acquisition cannot count as current coverage.

## Existing freshness policies

Scalar source freshness imports `SOURCE_POLICY` (7 days). The exact proof expiry
comes from the existing verifier, which applies the existing latest-quarter
190-day and latest-annual-period 550-day rules. The planner accepts no replacement
for those rules. It rejects an asserted proof expiry beyond the oldest original
source receipt's 7-day ceiling.

Independent annual-history acquisition keeps the existing **72-hour** consumer
TTL from `frontend/src/static/financialHistory.js`. Equality at a deadline is
still valid; it becomes expired after that deadline. This does not confer
positive growth or override structural history validation. Original receipts in
the future are rejected, with no cache-clock tolerance.

The optional absolute `refresh_through` is a **scheduling horizon**, not a validity
threshold. Without it, only currently required acquisition work is ready. With
it, otherwise valid evidence expiring by that horizon can be refreshed before a
later scheduled run. The plan retains this as `required_valid_through`, including
when exported for collection; due-only plans use the evaluation time. These
causes are labeled `*_expiring`, separately from
actual proof gaps and expired annual history. Nonpositive-but-proved evidence
creates no refill demand unless its existing validity is due to expire.

## Queue, continuation and diagnostic counts

`required_work` contains each symbol's outstanding requirements, including ones
held for a retry decision. `batch` selects at most the requested 1–200 symbols
with ready requirements. A symbol can have a deferred missing EPS period and
still need a ready sales or annual-history acquisition. Only ready requirements
contribute to that work item's canonical statement attribute list.

Cause counts distinguish EPS/sales proof gaps, annual-history acquisition gaps,
annual-history expiry, genuine absent source periods, source-valid nonpositive
states, and quarantined derived ratings. Counts are diagnostic observations per
symbol/target, not a sum of mutually exclusive stocks; absent categories have no
entry. Quarantined ratings alone never add a required work item.
Acquired semantic limitations are counted separately as
`eps_source_limited:<source_reason>` or `sales_source_limited:<source_reason>`;
their due work is labeled `*_source_limited_expired` or `*_source_limited_expiring`.

Ordering is deterministic: never-serviced symbols first, then the oldest actual
service time, then canonical symbol. Service time uses verified original receipts
and persisted actual attempts only. The complete cohort is considered every call;
there is no permanent first-200 slice. Repeating the same inputs returns the same
plan. Persist actual attempts and acquired results between calls to advance
rotation. **Merely planning does not reserve a batch or advance a cursor**; the
executor needs a single-writer/lease discipline before executing overlapping
plans.

## Explicit, bounded retry and global provider stop

Persist an `AcquisitionAttempt` before invoking its named statement attributes,
including unique attempt ID, actual attempt time, outcome and any HTTP status.
An attempt timestamp is rotation/failure metadata, never proof of acquisition.
Success without a new verified receipt cannot fill a gap or repeatedly refresh
an early maintenance request. Attempt holds apply only to intersecting statement
attributes. A newly due expiry of evidence actually acquired after a successful
attempt does not remain suppressed by that old attempt.

Match the latest attempt separately for each required statement attribute using
that attribute's verified original receipt. Sequential getters have different
clocks: history's oldest quarterly receipt can legitimately precede the later
annual getter attempt. Comparing those two clocks as though they described one
getter would block valid maintenance. Likewise, a later annual success must not
erase an unresolved quarterly failure. If the current history projection omits
an expired quarter, its independently verified EPS/sales receipt can supply the
quarterly clock for attempt matching only; it does not change history's oldest
included receipt or its TTL.

Failures, partial results, in-flight records and genuine missing source periods
are not retried immediately. The caller must provide a finite `retry_not_before`
(or source-period `recheck_after`) strictly later than the event it describes.
Without a deadline the requirement is `retry_decision_required`. The planner
introduces no hidden backoff/freshness constants. The operating caller should
record a reason and choose bounded delays within its own approved run budget;
transport rate-limit hints may inform that decision. A missing-period recheck
should reflect expected new reporting or an explicit follow-up decision, not a
loop repeatedly downloading the same absent year. An unresolved in-flight record
needs the executor's lease/recovery decision before a retry deadline is set.

Any retained 403/429 or `provider_blocked` attempt stops **all** selected symbols.
`ProviderStop` preserves this global barrier even if the initiating symbol leaves
the cohort. A cooldown deadline alone never reopens it: after the deadline, an
explicit `ProviderResume` must bind that exact blocked attempt and record a
recovery decision at or after the deadline. Another block invalidates that
resume. Conflicting metadata for the same blocked attempt raises an error. No
other provider identity, domain route, automatic probe or scope bypass exists in
this planner. Execution must stop immediately if a new block occurs after a plan
was made; the plan cannot predict future provider availability.

## Collector envelope

`export_statement_batch_plan` produces only this versioned JSON shape:

```json
{
  "schema_version": "financial-statement-batch-plan-v1",
  "verified_us_cohort": {
    "symbols": ["AAPL"],
    "base_artifact_sha256": "<64 lowercase hex digits>"
  },
  "batch_allowlist": ["AAPL"],
  "evaluation_time": "2026-10-04T10:00:00Z",
  "required_valid_through": "2026-10-04T10:00:00Z",
  "source_data_as_of": "2026-10-02",
  "selected": [
    {"symbol": "AAPL", "attributes": ["quarterly_income_stmt", "income_stmt"],
     "targets": ["eps", "sales", "annual_history"]}
  ]
}
```

The caller supplies the base artifact digest/as-of date and explicit at-most-200
allowlist. Selected symbols must be a unique subset of that allowlist, which must
be a subset of the **same exact cohort retained in the plan**. The helper supports
US collector envelopes only and rejects future/invalid as-of dates and malformed
digests. Annual-history acquisition requests both statement getters for a coherent
independent history artifact; EPS/sales requests carry their gate's actual needed
attributes. Only those two getter names are supported.

`targets` contains only ready requirements in canonical EPS/sales/annual-history
order. It also supplies the reuse context: an `annual_history` target requires
**both** included receipts to meet the existing **72-hour** history TTL through
`max(actual use time, required_valid_through)`. A currently valid quarterly
receipt that would expire for history before that horizon must be reacquired,
even though scalar quarterly proof alone retains its existing 7-day policy.
Normal proof-only quarterly requests continue to reuse a 7-day receipt. The
collector's independent annual acquisition policy remains 72 hours. Export
rejects horizons longer than the shortest selected acquisition policy; fetching
now cannot satisfy an impossible future-validity request.

The executor must apply this intent when deciding cache reuse. Reusing anything
that is merely valid **now** would silently turn a maintenance batch into a no-op.
History's `retrieved_at` still comes from its oldest included actual receipt;
refreshing only the annual getter cannot renew an older included quarterly clock.

The collector must independently hash the provided base bytes, check its as-of
date and verified US cohort membership, recheck selected/allowlist scope and
provider stop state, and enforce the bound before constructing a provider.
A hash-shaped string in an envelope alone does not prove any of those facts.
Original source receipt verification remains necessary after collection.

## Capacity and scheduling

`statement_refresh_capacity` reports nominal throughput and a conservative whole
cycle budget, separately from freshness:

- 1,894 eligible symbols at 200 per batch require **10 bootstrap batches**.
- One daily batch has nominal throughput 200/day and a 240-hour cycle, exceeding
  the 72-hour history TTL. It cannot maintain the full cohort.
- Four evenly spaced daily batches have nominal throughput **800/day**, above
  1,894 / 3 = **631.33/day**. The conservative cycle is **60 hours**; add the
  caller's explicit bounded run budget. With a one-hour budget the report is
  61 hours. A cycle budget **at or beyond 72 hours reports insufficient capacity**.
- Scheduling an explicit horizon before expiry is necessary to avoid waiting
  until the next batch after expiry. Production can derive its horizon from its
  conservative cycle/run budget, then rotate the oldest receipts. It must not
  change the 72-hour validity rule to hide insufficient throughput.

`guaranteed_coverage` is always false. Nominal capacity assumes successful
acquisitions and normal provider availability; blocks, missing source periods,
failed getters, unavailable currency/identity proof, missed runs and long runtimes
can reduce actual coverage. Inspect deferred requirements and current receipts,
not a throughput estimate, when reporting actual completeness.

## Offline verification

The focused suite covers 1,894-symbol bootstrap/continuation, independent 72-hour
expiry, 40 successful six-hour batches with an explicit scheduling horizon,
cache-clock laundering, stable tie order, empty/valid/partial cohorts, actual
nonpositive proof, duplicate/foreign symbols, future/unverified receipts, partial
and failed attempts, missing source periods, global 403/429 stops, explicit
recovery, bound envelope/attributes, and insufficient cycle budgets.

```sh
PYTHONPATH=backend python -m pytest --noconftest backend/tests/unit/test_statement_refresh_planning.py
```

`--noconftest` intentionally avoids the repository's automatic runtime/database
fixtures for this pure offline suite. The same tests also run in the normal
backend harness. No live provider calls are part of these tests.

When the separately packaged collector is installed, also run
`test_statement_refresh_collection.py`. This coupled regression uses the actual
collector and pinned provider normalizer with synthetic transport plus independent
socket/curl network guards. It acquires original receipts, verifies current-cache
reuse without clock changes, exports maintenance at age 66 hours through hour 78,
asserts both getters really run, audits the newly persisted clocks, and confirms
the next planner run needs no repeat annual refresh. The test is skipped only in
the standalone planner checkout where the collector module is absent.
