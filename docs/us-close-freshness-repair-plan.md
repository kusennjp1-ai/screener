# US close freshness: bounded repair and execution plan

Prepared 2026-10-06 UTC. Local-only review batch, based on deployed controller
tree `00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9` (local commit `4255021`).
No remote branch, schedule, provider, release asset, or website was changed.

## Decision

The current path cannot deliver the user's close+60-minute requirement.
Scheduling alone cannot fix it. Use a dedicated, warm daily-price path, retain
the existing financial source, and carry its unchanged proofs with full binding
and clock checks. Prove the budget on the actual required cohort before claiming
the target is met. A realtime quote is a separate observation and must never
replace canonical daily OHLCV, selection inputs, or exchange-volume evidence.

Two outcomes must be visible and separately timestamped:

1. **Close prices ready:** same-session validated OHLCV and chart bars for the
   entire pinned required cohort; latest close, absolute/percentage change,
   current volume, rolling share/dollar volume, moving averages, relative
   strength, price-to-pivot distance and chart price-derived overlays are
   recomputed from those bars. Each derived value has the same input generation
   or remains explicitly tied to its older generation. A changed badge alone
   does not meet this milestone.
2. **Screening ready:** universe rankings, trend-template/setups, pivot and
   breakout/approach decisions, candidate filters/ranks, breadth, group rankings,
   daily comparison and historical snapshots are all recomputed against that
   same session. Unchanged financial values retain their actual observation and
   expiry clocks. Close+60 minutes is the intended target for this full outcome;
   feasibility is unproven, and an earlier price-only outcome must not claim
   screening completion.

## Observed path and failure

`Static Site` imports weekly reference, classification, durable daily prices and
(fast mode) the previous feature run. `export_static_site --prices-only` fetches
the top 1,200 feature-ranked symbols plus benchmarks and retains the old scan.
The full route refreshes all active symbols and rebuilds the feature snapshot.
Both then serialize charts and sections, build a daily-price bundle, and directly
upload it with `--clobber` before the combine/frontend quality gate. Combine may
restore fallback artifacts and performs additional evidence exports. Only a
successful verified data artifact is eligible for `Research UI Release`, whose
serial publication lock selects nonregressing price observations and preserves
the approved UI and financial lineage.

The archived [failed fast run 413](https://github.com/kusennjp1-ai/screener/actions/runs/37399803339)
proves why partial refresh is unsafe:

- 1,208 provider fetches succeeded, yet only 1,190 of 9,926 active names were
  fresh in the promoted source. It declared 4,462 missing and 4,274 stale names.
- 481 liquid charts ended Oct 5 but were labeled Oct 2 from the prior feature
  run. 466 also disagreed with the Oct 2 scan close. This is a date-binding error,
  not evidence that all underlying bars were malformed.
- 800 liquid names had no exported history. The importer counted input rows,
  while incoherent histories could be silently rejected; counts did not prove
  persisted coverage. Their exact upstream absence versus rejection is unknown.
- The later frontend guard correctly failed at 02:28 UTC; the partial durable
  source had already been replaced at 02:16 UTC. No website was published by it.

Reference: existing `daily-quality-failure-37399803339/REPORT.md` and retained
69 MB immutable ZIP in the parent workspace. Its whole-ZIP digest is
`7ae1b20bb2507c97349893d521c578b822be350e3615c1c449633a4f4f70a2a0`.
Increasing the 1,200 cap or stamping yesterday's rows with today's date would
not repair this contract.

## Timing evidence

Raw API job/step timestamps are retained in
`us-close-timing-evidence-2026-10-06.json`; exact triggering schedule log excerpts
are in `us-close-schedule-evidence-2026-10-06.json`.

| Run | Queue before first job | Job execution / critical steps |
|---|---:|---|
| Static full 414 | 13m54s | 104m47s total; backend 84m18s; export 73m51s; combine 20m20s |
| Static fast 413 (failed) | 9m57s | 44m31s total; backend 32m35s; combine 11m48s; no publisher |
| Publisher 99 (activation) | 2h42m36s | 54m26s; plan 12m47s; compose 11m30s; rechecks 12m43s and 12m44s; Pages deploy 29s |

The publisher case is an activation, not a measured routine financial carry.
Do not assert every daily carry costs 54 minutes or add the two samples into a
measured end-to-end daily run. It does establish repeated validation cost worth
removing safely, and the full Static Site sample alone exceeds one hour.

The retained historical sample contains 25 API-returned scheduled Static Site
runs dated Sep 26–Oct 6, mixing full/fast, success/failure and cancelled runs.
It is not an exhaustive or homogeneous production SLA sample. Of 21 runs with
jobs, nearest-rank p95 created-to-first-job queue time is **834 seconds**
(13m54s); four were cancelled before a job. Across six successful runs,
first-job-to-run-updated p95 is **10,157 seconds** (169m17s, the maximum because
the sample is small). This statistic is execution time, not freshness or a
forecast. Successful fallback deployment can still contain older prices.

Scheduler lateness is separate and worse. The exact Oct 5 schedules are printed
in each run's select-markets log:

| Intended trigger | Run created | Creation delay |
|---|---|---:|
| 16:04 ET = 20:04 UTC | Oct 6 01:15:31 UTC | 5h11m31s |
| 16:10 ET = 20:10 UTC | Oct 6 01:16:08 UTC | 5h06m08s |
| 16:58 ET = 20:58 UTC | Oct 6 01:33:52 UTC | 4h35m52s |
| 23:30 UTC safety net | Oct 6 03:10:38 UTC | 3h40m38s |

Current workflow also has 16:31 ET. Its staggered fast concurrency group uses
cancel-in-progress; later triggers can cancel earlier work. A session-keyed
idempotent owner should replace repeated overlapping full jobs.

GitHub [documents delayed and dropped scheduled jobs](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule).
An external punctual dispatcher alone still leaves GitHub runner and publication
queues. Meeting a hard deadline requires a reserved/warm execution path plus
independent observation of publication. No finite provider/cloud SLA has been
established here; describe the requirement as a target until measured.

## Local implementation in this batch

- Rebased earlier unactivated `publish_daily_price_bundle` proposal: refuses
  fast/partial scope, unknown or weakened coverage policy, inconsistent counts,
  market/date regression and bundle digest mismatch before either upload. Its
  mocked incident test proves no upload/deletion on the 1,190/9,926 case.
- `MarketCalendarService.session_close`: actual exchange schedule close in UTC,
  with no weekday/16:00 fallback when calendar evidence is unavailable.
- `CloseSession`: explicit US session, collection admission at actual close+5m,
  deadline at close+60m, timezone-aware clocks and late status. Five minutes is
  an admission buffer, not proof that vendor data is final by then.
- `audit_required_closes`: independently pinned required symbol/exchange cohort,
  complete fresh dates, source/manifest clock and identity agreement,
  no regressions/future/duplicate/unordered dates, finite valid OHLCV and a hash
  of validated close observations. It rejects shrinking the cohort to whatever
  was fetched. Late but valid data remains useful while reporting a missed
  deadline; it is never labeled an on-time success.
- `inspect_us_close_session`: read-only command for the operational scheduler to
  obtain exact session timing after the workflow integration is reviewed.

These modules are **not wired to production workflows**. The close audit checks
necessary date/identity/OHLCV conditions only. It does not replace bundle-byte
hash verification, provider provenance, adjustment coherence, long-history
eligibility, source certification or existing frontend quality gates. Generated
time is not evidence of provider observation time. The required cohort/hash must
be selected independently and trusted by its caller. No fabricated prices,
adjustments, rate increase or 403 bypass is included.

## Proposed implementation batches

### 1. Protect source promotion and pin the session

Capture the prior manifest and immutable source hash before collection. Move
latest-pointer promotion after both candidate source admission and downstream
date/price consistency checks; collection checkpoints must never be authoritative
latest bundles. Make dated bundles immutable with content hashes, upload/read
back first, then replace only the latest pointer under a single market/session
publisher lock with predecessor identity recheck. Do not clobber an asset still
named by a live pointer. Preserve the current source if any check fails.

Review the required universe and treatment of suspensions/delistings before
activation. Every required member must have a fresh close; explicitly excluded
nontrading identities need dated reasons and must not remain eligible for fresh
screening. Do not silently reuse CN's 90% history rule, US's 95% cache readiness,
or frontend's 90% liquid-history gate as the promotion contract. The currently
degraded source's unknown floor cannot be automatically treated as authority;
its restoration needs a reviewed prior source or a newly fully verified source.
Add accepted/rejected input counts and per-symbol reasons to ingress telemetry.

### 2. Make the critical path incremental

Before the close, stage weekly reference, unchanged financial source/certificate,
canonical historical prices, dependency environment and approved UI bytes on a
warm worker. Verify these inputs before the window. At close+5m collect one
bounded end-of-session delta for the full required cohort, retaining the existing
request rates and full-history refetch on changed adjustment boundaries. Retry
only missing/invalid members within an explicit remaining-time budget. Record
provider observation time, exchange session, adjustment basis and venue-volume
semantics; enforce timeouts and fail closed when fresh evidence is unavailable.

Use one canonical session date across prices, scan rows, chart bars, price-derived
metrics and source manifest. Regenerate dependent values against the new prices;
retain unchanged content-addressed historical files rather than reserializing
all history. Reuse reference/fundamental calculations only if their input hashes
are identical. Rank-dependent features still need the entire same-session
cohort. Benchmark the price/feature pipeline separately from publication.

### 3. Reuse immutable verification within one publisher run

First separate pure expensive verification from mutable authority checks in
`verifyCandidatePayload`, `verifyExceptionActivation`, `carryAssessment` and
the repeated `select-release-source` rechecks. Run the complete source/native
projection/semantic comparison once per exact input tuple. The local seal must
bind controller commit/tree and protected-code hash; source/certificate exact
run/attempt/job/artifact IDs and hashes; full source/base/cohort and projection
hashes; logical and physical inventories; active lineage; predecessor identity;
target price/date observations and target-base hash; UI source/digest; rule/
projector hashes; first evaluation time; receipt clocks and minimum expiry.

At every subsequent boundary, independently rehash all referenced local files,
verify those bindings and current validity clocks, and re-read live publication,
current main, current CI/Design/source authority and artifact identity. Any
change, missing source, expiry, clock rollback, altered cohort, unknown policy,
or different target invalidates reuse and requires full reproof or fails closed.
Use immutable input directories for the run and a cryptographic seal, not mtime,
path existence, an environment boolean or an untrusted saved success flag.
Preserve all audit bytes in the publication. Do not persist trusted results
across runs until a separately reviewed certification protocol exists.

For ordinary price carry, verify the existing source lineage once but derive and
verify the new target-specific financial carry and comparison for each new price
generation. A proof for yesterday's target cannot authorize today's selection.
Never refresh financial observation/expiry timestamps just because prices move.

### 4. Operational execution and acceptance

Use the NYSE calendar to schedule warm preparation before the actual session
close, collect after close+5m, and compute deadline close+60m, including early
close days. A persistent/reserved worker with a durable session ledger and a
small independent deadline observer is necessary given the measured scheduler
and queue delays. Reuse an already authorized always-on environment if one is
available; otherwise present the hosting/cost/access choice for review. No new
service, credential, fee, scheduler or recurring task was activated here.

Initial design budget (unmeasured): prepare before close; collect/validate by
close+25m; recalculate/cohort audit by close+40m; carry/compose/final checks by
close+50m; publish and independently read back by close+55m. Keep five minutes
of margin. If collection cannot meet this at current permitted rates, do not
weaken the cohort: report the budget failure and review source/execution choices.

An independent observer checks canonical live session, source identity, complete
cohort and both milestone generations at close+45m and close+60m. Surface missing
symbols, stage duration, source lag, queue delay and deadline misses explicitly;
preserve last verified data with its real date. Alerts to user/third-party
channels require an authorized destination. Collect at least 20 actual sessions
plus replayed DST/holiday/early-close/provider-failure fixtures before evaluating
distribution of latency; a p95 target is not a guarantee of every session.

## Incremental history requirements

Retain per-date immutable snapshots of the explicit universe, symbol identity,
validated OHLCV source, canonical pivot, previous/current price, approach band,
volume gate, crossing result and rule version. Count breakout/approach events
from consecutive comparable first-published snapshots; retries must be idempotent
and later corrections must be separate records, never retro-labeled events.
The current 20-day breakout proxy in `bookMarketEvidence.js` cannot substitute
for canonical entry pivots. `candidateHistory` selection-only states are
insufficient to reconstruct genuine historical crossings.

New-high/new-low counts require a declared universe and required history length,
with missing coverage exposed. Separate distribution-day series must preserve
actual S&P 500 closes paired with NYSE volume and actual Nasdaq Composite closes
paired with Nasdaq volume, following the separately reviewed IBD method. SPY/
QQQ volume and partial-venue realtime feed volume are not interchangeable with
those inputs. Keep source/licensing and volume semantics explicit; no provider
substitution is authorized by this plan.

## Verification and remaining review

Run the new contract tests with repository pandas 2.2.0/numpy 1.26.3 and
exchange-calendars 4.5.3; real NYSE dates are checked against
[NYSE hours and calendar](https://www.nyse.com/trade/hours-calendars).
The first disposable test environment used pandas 3.0.6, whose timestamp unit
behavior failed with exchange-calendars 4.11.2; it was corrected to the declared
repository pandas/numpy versions before final verification. No dependency file
was changed. The guard's 13 stdlib tests are independent of provider/network.

Final focused verification: **40 passed** (18 existing calendar tests, 9 new
contract tests with multiple adverse cases, 13 source-promotion tests). The
command used `pytest --noconftest` to avoid unrelated database/application test
fixtures. Syntax compilation and `git diff --check` passed. A real-calendar CLI
check for Nov 27, 2026 produced close 18:00 UTC, collection 18:05 UTC, deadline
19:00 UTC. Test output is retained at `/tmp/screener-close-focused-tests.log` in
this executor; no live collection or external write was invoked by the tests.

Full backend/frontend suites, live collection, workflow activation, immutable
promotion, financial proof reuse and production timing verification are not
implemented or run in this first bounded batch. `bd` is not installed here;
remaining work is captured in this plan. Parent review is the stop boundary
before any remote or scheduled/publisher mutation.
