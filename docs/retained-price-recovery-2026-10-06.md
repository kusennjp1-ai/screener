# Retained-price recovery: exact local preparation

This is an unpublished, provider-free preparation. It does not change main,
workflows, the 90% website gate, the price nonregression gate, PR80 source
promotion, financial source authority, or the approved UI. It prepares an
October 5 catch-up; October 6 is already the latest completed US session.
Nothing in this repair establishes October 6 stock prices.

## Why the existing sound majority did not publish

Successful Static Site run `37407740745/1`, head
`d6cd685fbe197deb5f83a12026de5d764f6d6f7f`, completed October 6 at
05:09:20 UTC. US job `112092436702` and combine job `112113043288` succeeded,
including the frontend quality step. Final artifact `11391282396` contains
306,686,108 bytes, SHA-256
`6b1b0942a2ef90165b2c0635c55da04af925aae8e7a579cfec7f6414eb0f435d`.
Its exact metadata companion is `11391587354`, 30,243 bytes, SHA-256
`a78e9bdf99f9252c11a9ae917df12e37d26e04d0b8f6b233287d13074b98d6c3`.
Both were independently reread; companion `source.json` equals the retained
376,238-byte source file exactly.

Against release #99's actual known-price ledger, the candidate advances 8,681
known series, but LPSN regresses from September 4 to July 16. The unchanged
`chooseExport` rejects that regression. Research UI Release `37514556503`,
job `112444017427`, explicitly reported no advancing data or newly verified UI;
deployment was skipped. Its green run state did not mean a website deployment.

There are 62 absent known series. Fifty-nine have actual retained charts in
#99; together with LPSN they form the 60 recoverable histories. Fifty are among
the existing 5,901 research rows and ten exist only in the chart index. DHY,
FSEA, and GBTG exist only in the known-price ledger: no chart is fabricated.

The authoritative prior denominator is the #99 receipt's **1,895 required
symbols**, not its 1,894 currently liquid rows. The unchanged retained-universe
function gives **1,850 / 1,904 (97.16%)** for the October 5 candidate without
claiming two potential liquidity exits. The recovery keeps that exact union.
The earlier 1,852/1,903 technical-history audit used the prior-liquid union and
is a different statistic. Short current histories remain distinct from missing
current closes; the 252-session technical gate is not weakened.

## Files and implementation boundary

- `read-retained-price-archive.py` streams the pinned ZIP/TAR twice. It never
  expands the full archive. It verifies the ZIP hash, all TAR structures, and
  the selected packed metadata/payload chain, lengths, hashes, JSON and gzip.
  It caps requested output at 64 MiB. Its receipt is independently hash-pinned by the review fixture and explicitly scoped, not a
  complete site or financial-audit validation.
- `retained-price-recovery.mjs` constructs a digest-bound plan from the exact
  predecessor receipt, dated source/index rows and actual price ledger. It
  preserves prior required members and checks stable row identity. The compiler
  emits 60 atomic patches and immutable snapshots; it writes no website.
- `prepare-retained-price-recovery.mjs` verifies extracted input receipts and
  bytes, the original metadata companion ZIP and source member, then prepares
  exclusive local outputs. Every review count and date must match the committed
  fixture. A newer artifact requires its own separately reviewed input plan.
- `fixtures/retained-price-recovery-inputs.json` binds the exact original run,
  attempt, jobs, artifacts, SHA-256 values, sizes, dates and expected counts.

Each affected research symbol's old row, chart and canonical detail remain
together in a hashed historical snapshot. The new analysis row has no current
price, liquidity, RS, pivot or setup pass. A positive field inventory prevents
unknown future scanner fields from leaking into it. The immutable original
chart keeps its old as-of date, original capture clock and exact bars. In the
v3 compiler input only, the chart envelope's `as_of_date` means the target
analysis date. Its original date is recorded separately, `generated_at` stays
literal, and every bar date/value remains unchanged. Current price, indicators,
rank and action fields stay unknown. The unchanged technical audit and approved
chart consumer reject the old final session; UI tests confirm that the header
says price unverified, the chart does not render old candles, and CSV price is
blank. This envelope lets the ordinary financial-only projection bind to the
target analysis scope without adding a historical-carry exception.

Financial input fields pass through unchanged, including absent/null slots,
proofs and source clocks; their digest is recorded separately. The recovery
neither nulls owned finance nor revives expired finance. Ordinary financial
carry must independently reproject the active owned source onto the resulting
target. All new rows, method summaries, shared RS ranks, portfolios and saved
comparisons must then come from the canonical compiler. The source's current
knowledge semantics remain distinct from historical point-in-time facts.

The ten chart-only instruments remain chart-index members; no research rows
are invented for them. The three ledger-only absences remain explicit unknowns.

## Actual local evidence

The exact #99 ZIP was scoped into four metadata files (6,958,770 decoded bytes).
The exact candidate ZIP supplied three metadata files (4,515,390 decoded bytes).
The 60 previous charts and 50 previous details required only 3,268,151 payload
bytes. All selected byte bindings passed. No full decode was attempted with the
approximately 1.5 GB initial free-disk budget.

The preserved v2 preparation produced `plan.json`, `compiler-inputs.json`
and `receipt.json`, totaling 20,879,212 bytes. The active v3 preparation totals
20,887,024 bytes and adds the separately reviewed EQR row-only quarantine.
Its compiler input SHA-256 is
`cf5d5c00812be7287f36d786f95459c8563054f60a48eae7a5bfa04c3a8a103a`.
The receipt says
`publication_authority: false` and `ready_to_publish: false`. It preserves all
5,901 research members and the exact 1,850/1,904 coverage. EQR has no chart or
actual observation date in either input but exposed a price and ADV; v3 archives
that row and clears current price-derived fields, without inventing bars or
dates. It therefore has 60 histories, 50 restored research rows, one additional
row-only quarantine, ten chart-only histories and three ledger-only absences.
Independent review reproduced the exact v3 planner/compiler bytes and verified
all 20 EQR financial input fields against the source. The v1/v2 outputs and
independent reports remain untouched.

Focused continuation validation: 31 extractor adversarial tests; 26 full
restoration safety tests; 30 Node preparation/materialization/lifecycle tests;
and seven approved-UI chart/header/CSV/liquid-filter tests. The lifecycle fixture
uses 22 synthetic rows and invokes the real canonical compiler twice, unchanged
financial carry, expiry rejection, packed transport and Pages checks. This is
not full validation of the real 5,901-row graph. Full source materialization,
aggregate equivalence from all full rows, complete real financial carry and
final artifact bounds remain pending.

## Smallest next artifact-only replay

After the current financial rehearsal reaches its stopping condition, use a
disposable CI worker with enough disk for the existing full validation. Keep
all inputs immutable and publication disabled. Do not modify the old artifact,
its companion, dates, successful step results, or producer identity.

1. Download exactly the two pinned source artifacts and companion; verify API
   repository, run/attempt/head, successful original jobs, ZIP sizes/hashes and
   member provenance. Verify the current live predecessor is still #99 before
   reusing this plan. A later publication invalidates this predecessor binding.
2. Restore the candidate into a new working tree. Apply only the 60 history
   patches and the reviewed EQR row-only quarantine:
   replace/add chart-index references, repair the 51 matching full scan rows and
   every scan preview/chunk alias, and retain the complete historical snapshots.
   Do not replace unaffected full scan rows with compact research-index rows.
3. Clear/regenerate all dependent canonical details, research/scan summaries,
   method rankings, workbench/portfolio and candidate-history outputs. Preserve
   retained OHLCV exactly; leave the current chart consumer's date check intact.
   Run the ordinary canonical compiler and unchanged cross-view, 90% retained
   denominator, actual-price nonregression and budget checks. Do not execute
   provider-backed repair, SEC, benchmark, institutional or earnings fetches.
   Missing ancillary evidence stays unavailable with original clocks.
4. Carry the active, independently verified financial source through the normal
   target-specific proof path. Recheck identity, all original source clocks,
   expiry, rules, complete audits, exact UI digest and predecessor at the normal
   boundaries. No old seal authorizes the newly compiled target.
5. Run full transport/financial-audit validation and Pages logical/physical/TAR
   limits. Read back every modified symbol and a normal/split/short-history
   sample through the same consumers. Prove 60 exact retained histories, 51
   unknown current rows, 10 chart-only members and three ledger-only absences.
6. Retain a new explicitly named repair artifact and complete repair receipt,
   recording both input artifacts and the new producer's real run/attempt/head,
   output hashes, observation ledger, compiler version and financial proof.
   No deployment occurs in this rehearsal.

The existing publisher accepts verified Static Site artifacts, not arbitrary
local repaired bytes. The least disruptive eventual production integration is
an explicit reviewed artifact-only recovery mode in Static Site that creates a
new real successful combine artifact and companion under its own run/attempt.
The source workflow/job identity checks remain unchanged. A separately reviewed
restore verification output is also required before excluding the ordinary
provider-backed enrichment branch; the current publisher cannot infer that
permission from a local receipt, a caller boolean or `published_input`.
Ordinary same-UI financial carry still applies. Merely renaming local repaired bytes as the
old successful artifact, changing its companion dates, deleting LPSN from the
observation map or bypassing `chooseExport` is not acceptable. No workflow
change, dispatch or publication is included in this local batch.

## Activation hold and unresolved current-value inventory

Actual scheduled Static Site run `37548113596` (#415) began at 23:43:27 UTC on
main `1356148aecb8dc03b01fda103d2dd416cce05db6`. While that source builds, new
Oct5-specific workflow/admission implementation is on hold. A terminal, verified
newer source can supersede this repair only after its real retained-universe,
history nonregression and per-symbol observation checks pass. Its date must never
be substituted into the pinned Oct5 review fixture.

A final read-only scan found 51 additional finite current-price scalars in the
v3 output with stale (four) or absent (47) original actual observations. Five
are protected: LBRDA (Aug21), AXIA, CRNX, TWO and WBS (undated). Existing technical
qualification rejects them, but price/CSV/liquid displays can still expose
unsupported current scalars. No repair expansion was made. An in-memory
price/ADV suppression counterfactual preserves 1,850/1,904 and the exact required
set digest `68b76d3c38e3d9a84ec098c4597bb0a2548e4c7bfa75b1e02aad3604e0f5330d`.
This separate inventory requires owner review or evidence from the new source;
v3 must not be described as publication-ready merely because its ratio passes.

The concrete full-graph and publication-verification boundary is preserved in
`retained-price-recovery-validation-plan.md`. Production selection and workflow
files are unchanged.

## Fastest-current versus retained catch-up

The retained catch-up needs **zero new provider calls**. It cannot supply any
October 6 stock close. Fresh October 6 work needs genuinely dated bars for the
verified sound cohort and benchmark context. Preserve and validate overlap and
adjustment/identity boundaries; fetch full history only on a proven boundary
change. Do not acquire only enough names to game the 90% floor.

A separately authorized tiny ordinary-symbol pilot can use AAPL, MSFT, JPM and
the independently identified SPY benchmark: retained October 5 AAPL/MSFT/JPM
histories each have 310 bars and match row/chart closes. Request one bounded
daily window covering retained overlap and the current session, with the
existing provider/rate budget and raw receipts, no retries or mapping changes.
The four exceptional symbols DDS/SUN/ET/VMRK stay outside this new pilot and
their exhausted admission is not reused. Verify ordinary-source identity before
fetching; verify SPY identity/history scope independently rather than treating
it as one of the research rows. No pilot is authorized by this document.

Measured bottlenecks remain scheduler delay (several hours in the retained Oct5
sample), full acquisition/build (104m47s execution), fast build (44m31s, failed),
and expensive publisher proof work (54m26s in the activation sample, not an
ordinary-carry estimate). A retained-byte replay removes acquisition time but
does not remove compiler/carry/queue costs. No end-to-end duration for this new
replay has been measured. Calendar 4.5.3's erroneous January 9, 2025 session must
remain a disclosed calendar defect, not a fabricated missing bar or a reason
to weaken history validation; no dependency change is included here.
