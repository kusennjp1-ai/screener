# Offline retained-price validation boundary

The newer October 6 source has its own separately bound plan in
[`retained-price-recovery-oct6-validation-plan.md`](retained-price-recovery-oct6-validation-plan.md).
Its counts, source clocks, DXY history and group arithmetic differ. The October 5
fixture and detailed numbers below remain immutable historical preparation and
must not be substituted into the October 6 replay.

Status: local, unpublished preparation. No provider acquisition,
workflow dispatch, main change or publication is authorized by this document.
The modules below do not grant publication authority.

## Implemented reusable materialization

`restore-retained-price-candidate.py` accepts a pinned ordinary candidate ZIP,
size and SHA-256, validates its complete ZIP/TAR structure before writes, then
streams one regular file at a time into a new directory. It records each exact
restored file's length/hash and atomically commits the directory without replacing
an existing output. Original archives stay outside the output. Links, special
files, traversal, duplicate paths, changed inputs and incomplete writes fail.
The disk preflight requires payload bytes plus an unoverrideable 8 GiB reserve;
the actual candidate is 1,884,324,529 payload bytes across 19,475 files. The local
workspace cannot meet this full-restoration budget.

`prepare-retained-price-residual.mjs` extends the v3 input using the exact
reviewed 51-symbol scope, raw file digests, original chart index and four literal
candidate histories. It refuses incomplete or expanded scope, changed files,
current/unknown chart-date claims and overwriting an output. Its receipt remains
unpublished and explicitly says the full compiler has not passed.

`materialize-retained-price-graph.mjs` takes the exact prepared compiler input,
its digest, the new full restoration receipt and digest, exact approved selection
and performance catalog bytes, and a complete aggregate-dependency proof. It
verifies all used dependencies against the restored inventory before staging
any change. It operates only on a disposable tree and records a closed mutation
inventory with paths, fields, before/after hashes and reasons. Its receipt says
`publication_authority: false`, `ready_to_publish: false` and
`full_compiler_passed: false`.

The reviewed scope is:

- Sixty immutable prior histories, including ten chart-only instruments; no
  chart is fabricated for DHY, FSEA or GBTG.
- Fifty full scan rows whose histories are restored, four additional current
  rows with genuinely stale candidate histories, and 48 undated row quarantines
  (EQR plus the 47 residual rows): 102 affected rows in total. Full financial
  inputs and absent/null ownership slots come from
  the full source rows, never the lossy compact research index.
- All affected scan rows/previews/chunks; active, raw and generated chart/detail
  aliases; chart-index rank/buy/sell/RS aliases; canonical analysis inputs.
  Membership remains 5,901 rows and 8,740 actual chart-index members.
- Current group member price/return/RS/composite/stage/sparkline fields become
  unknown. Unchanged aggregates are preserved only when their complete admitted
  contributors, weights, counts, leader and tie-break inputs are equal. LBRDA is
  a demonstrated exception: its source group RS is 8.22 despite a stale price.
  The correction first reproduces all 195 original current rankings with the
  exact audited producer function, then removes that single contributor and
  recomputes its aggregate, current rank order, detail aliases, movers and home
  aliases. The proof binds every unaffected full row and group member too.
- Candidate-history catalogs are rebased to the exact approved predecessor.
  Rejected target-day snapshots and catalogs are archived as evidence; ordinary
  compilation records the repaired target once. Original approved snapshots
  remain raw-byte bound. Performance history obeys the same closure.
- A missing financial-history payload receives only an empty unavailable target
  analysis scaffold before the carry baseline. No acquisition/capture timestamp
  or financial value is created. An existing payload stays literal.

The exact producer file at original head
`d6cd685fbe197deb5f83a12026de5d764f6d6f7f` was read through the official connector.
Its 117,835 UTF-8 bytes hash to
`d8316b2ccb45b703becaa850a674ea58aa459a687b2f57214063a502775afa6a`, equal to the
audited local builder. Its serialized current group scope admits nonempty groups
with non-null primary source RS. Means, median, deviation, counts, >=80 share,
market-cap weights, leader sorting and rank sorting are covered by the proof.
Historical rank and RRG streams have independent dated database scopes; their
122/195 differences from current rankings are not a demonstrated contradiction.
Their original bytes/clocks remain reference observations, not recomputed prices.
A bounded original-source audit can compute each complete full-row digest and
retain only the group-input fields via
`proveRecoveryAggregateEquivalenceFromRowBindings`. The real materializer still
recomputes every binding itself from the complete restored chunks; caller-supplied
streaming bindings are not release authority.

## Concrete artifact-only rehearsal

Use a disposable worker with enough disk for full candidate restoration, the
canonical compiler, predecessor financial/audit materialization, staging copies
and final transport. The pinned candidate ZIP, pinned #99 ZIP and exact metadata
companion are immutable inputs. The complete IDs/hashes are in the reviewed
JSON fixture. No fresh provider request is part of this route.

1. Independently validate API repository/run/attempt/head/job/step/artifact
   identity and exact original ZIP bytes. Verify the companion's sole
   source.json, source manifest, actual observation map and pinned #99 receipt,
   required denominator and known-price ledger. Revalidate the live financial
   predecessor independently; a changed live publication invalidates the old
   binding and needs a new review plan.
2. Restore the candidate with the new safe helper. Use the existing scoped
   reader for the exact approved prior chart/detail/catalog paths. Recompute
   the prepared input from those independently validated originals, and compare
   it byte-for-byte with the reviewed v3 preparation, then run the reviewed
   residual extension (`prepare-retained-price-residual.mjs`) against the exact
   four candidate charts and all 51 original compact rows. Compare its complete v4 result to the reviewed bytes.
   Preserve all immutable original evidence outside the mutable tree.
3. Read complete full scan rows, build the closed group proof, and materialize
   the reviewed graph. No current-value exception can be inferred from the
   90% ratio. Resolve the separate 51-row residual date inventory before
   claiming a truthful current-price artifact. V4 prepares that finite
   quarantine; only the real full-tree replay establishes all public aliases.
4. Run the approved canonical `frontend/tools/export-research.mjs`, then
   `syncRecoveryHome` from the final scan counts and preview. This synchronization
   must precede the financial-only baseline. It retains original benchmark,
   market, institutional, earnings and historical-reference clocks. Capture a
   full inventory of this compiled target and the closed transformation receipt.
5. Restore the current independently verified active financial source and
   prepare its ordinary generation carry from this exact target base. Run the
   approved compiler/history build with the existing carry environment. Verify
   owned-field projection, unowned-field equality, source clocks and expiry,
   financial lineage, complete audit inventory and the same approved UI. The
   carry comparator gets no historical exemption; late expiry must still reject.
6. Run the existing cross-view, 90% retained denominator, price-history
   nonregression, UI consumer, transport and Pages logical/physical/TAR checks.
   Verify row/chart/detail/index/CSV/eligibility for all affected symbols. Recheck
   identity, source and live predecessor immediately before finalizing evidence.
7. Preserve the final repaired target and full reports as a new explicitly
   labeled rehearsal artifact with its genuine producer run/attempt/head. Keep
   the final inventory, compiler version/time, financial predecessor identity,
   carry reports, source clocks and all original archive bindings in provenance.
   A rehearsal artifact has no deployment permission.

The 44-row synthetic lifecycle exercises the real two-pass compiler, target-only
envelope, unavailable scaffold, source carry, expiry rejection, history rewrite,
transport pack/readback and Pages checks. Separate materializer tests exercise
home/group closure. Seven React/CSV tests run unchanged approved consumers and
prove that old prices and EQR's undated scalar are not displayed as current.
It includes a restored prior history, an existing stale candidate history, EQR,
and a second undated scalar. These tests establish implementation behavior,
not a real-input release proof.

## Exact full-cohort CI replay still required

Use a fresh disposable CI worker with disk for the 1,884,324,529-byte candidate
payload, the independently restored live predecessor, baselines, output and the
restorer's 8 GiB reserve. Do not lower that reserve to fit this local workspace.
The worker is artifact-only: no provider credentials, no provider job dependency,
no acquisition, no source promotion, no Pages deployment and no publication.

The immutable candidate input is Static Site 37407740745/1, head
`d6cd685fbe197deb5f83a12026de5d764f6d6f7f`, artifact 11391282396,
306,686,108 bytes, SHA-256
`6b1b0942a2ef90165b2c0635c55da04af925aae8e7a579cfec7f6414eb0f435d`.
The companion is artifact 11391587354, 30,243 bytes, SHA-256
`a78e9bdf99f9252c11a9ae917df12e37d26e04d0b8f6b233287d13074b98d6c3`.
Use the current independently validated live publication as the financial
predecessor. The old #99 archive is only historical price-source evidence and
an optional diagnostic carry fixture; it grants no production carry authority.

The worker must produce the following reviewable reports before a new artifact
can even be considered for admission:

1. Pin API run/attempt/head/artifact identities, original ZIP hashes, companion
   source bytes, approved UI/compiler/controller trees and the actual live
   predecessor. Recompute v3 and the exact residual extension from originals.
   Record that all outputs are unpublished and have no activation authority.
2. Restore once with `restore-retained-price-candidate.py`. Build the complete
   aggregate proof from all six original scan chunks and original group/home/RRG
   bytes. Pass that proof and both prior approved history catalogs to
   `materializeRecoveryGraph`. Record every changed path and field, and all
   unchanged paths. A 102-row source list alone is not dependency closure.
3. Verify 5,901 row identities with exactly 102 transformed and 5,799 unchanged
   full source rows before the compiler; compare each financial field's presence,
   value and source clock on all 5,901. Keep 60 restored prior histories separate
   from four candidate stale histories and 48 chartless quarantines. Preserve
   every original bar and rejected alias in the bound audit evidence. Keep the
   8,740 actual chart members and three ledger-only absences without fabrication.
4. Run the unchanged canonical compiler over the entire tree, then
   `syncRecoveryHome`, then take the financial carry baseline. Check all 5,901
   research rows, scan chunks/previews, canonical and generated details/charts,
   every chart-index alias, four method CSVs, group members/aggregates, home
   previews and active selection/performance catalogs. Count zero finite current
   prices with stale or missing source observation dates; require the unchanged
   1,850/1,904 verified coverage and required-set digest. A changed count must
   stop for investigation, not rewrite the expected denominator.
5. Compare complete group contributor vectors, weights, source ordering,
   >=80 counts, group leaders, tie-break inputs and unaffected full-row hashes.
   Preserve aggregates with equal dependencies. For the exact LBRDA exception,
   require `retained-price-aggregate-correction-v1`: all original current
   arithmetic must reproduce before the producer function may recalculate.
   Only a removed contributor bound to a reviewed stale candidate history is
   allowed. Source rank deltas use old_delta + old_rank - corrected_rank; null
   deltas stay null. Bind independent dated rank-history/RRG separately and
   leave all their bytes and clocks literal. Any other contributor change,
   changed leader, missing group or original arithmetic mismatch blocks replay.
   VBX, XVO and XVUG have null full-source group values; prove their absence
   from every group and bind their complete full-row hashes separately.
6. Prepare ordinary carry from this exact compiled baseline and the actual
   renewed live predecessor; run the second compiler/history pass. Require owned
   field projection, unchanged unowned fields, lineage and audit inventory,
   genuine retrieval clocks and real-time expiry rejection. Do not modify the
   financial R/A/B/C implementation or grant a history exemption. Revalidate
   the live predecessor immediately before final evidence assembly.
7. Build the same approved UI. Run automated real-data browser/consumer checks
   for all 102 symbols and a full-universe CSV comparison: list/detail/current
   price, liquid filter, rank, entry readiness, chart modal and mobile header.
   The four stale and 48 undated rows must show unknown current values and no
   action eligibility; preserved historical dates must remain literal. Include
   screenshots for one restored history, one stale candidate and one undated
   row. Use all 5,901 rows for nonregression checks, not screenshots alone.
8. Pack once; read back the transport and audit inventories; run all existing
   logical/physical/TAR Pages bounds, cross-view and price-history nonregression
   checks. Upload a new explicitly unpublished rehearsal artifact containing the
   complete repaired tree, source/transform/compiler/carry/UI/transport reports
   and genuine new producer run identity. Report failed and unrun stages.

Only after that successful actual full-cohort replay and review should the
separate producer/restore admission delta below be implemented. Its verifier
must independently replay the correction, not trust this fixture or a receipt
written by the proposed artifact itself. Any changed actual live financial
predecessor invalidates a previously prepared production carry binding.

## Finite LBRDA group impact

The original Media-Diversified current aggregate includes LBRDA at RS 8.22.
Removing it changes the contributor count 17 to 16, mean 50.87 to 53.54,
median 57.50 to 57.86, deviation 24.94 to 23.24 and >=80 share 17.65% to
18.75% (the >=80 count remains 3). The weighted average changes 54.33 to
54.78 after removing LBRDA's 4,672,613,888 weight from 476,945,849,268. STRZ remains leader at 91.36. The group
moves from rank 86 to 73, and the 13 groups previously ranked 73–85 move down
one. Its 1w/1m/3m rank deltas change 29/27/27 to 42/40/40; 6m remains unknown.
Home top ten remains equal, but weekly gainers must be rebuilt: Media-Diversified
enters and Wholesale-Food exits; Retail-Discount's delta changes 44 to 43.

These are current aggregate dependencies. The source's separate dated group
history reports Media-Diversified at 87 on Oct5, and LBRDA's source scanner
`ibd_group_rank` is 124. Preserve those original evidence streams and timestamps;
never relabel them as newly computed observations. Affected current row rank
fields are unknown, while unaffected scanner ranks remain literal. Exact
weighted-statistic and complete 5,901-row bindings are part of the finite
correction proof, not permission to skip the full artifact rehearsal.

The pinned original workflow uses Python 3.11. The arithmetic adapter executes
the exact producer function with explicit 3.11 sequential summation, preserving
original manifest/chunk row order even on a newer diagnostic host. Python 3.12
changed float summation, and group-display order also differs from producer
order. Neither may silently change two unrelated rounded means/ranks. The
fixture binds the exact original workflow bytes and Git blob; reproducing all
195 original current rankings remains mandatory before computing a correction.

## Deferred producer and restore-verification delta

No workflow or selector delta is implemented. The smallest reviewed future
integration would add an explicit offline correction mode to the existing
Static Site producer. It would avoid provider/build-market jobs and still use a
genuine new successful `combine-and-build` job, including `Build static frontend`,
with a new `static-site-data-<new-run>-<attempt>` artifact and companion. It must
not borrow run 37407740745's success, output hashes or identity. PR80 source
promotion remains disabled for this correction mode.

The source selector's current workflow/repository/main/event/job/step/attempt
checks remain. A declared repair reference in the companion is only a request
for full verification; it is not approval to skip enrichment. At selection,
validate its shape and exact new source/artifact/receipt reference. At restore,
independently validate original archives, prior published bytes/ledger, current
live financial predecessor, reviewed producer/compiler/UI identity, and replay
the reviewed closed transformation and base compiler. Compare the resulting
complete file inventory with the selected artifact, including every unchanged
file, every allowed change and every required member.

A digest in a self-consistent caller receipt cannot grant this permission.
Acceptance requires trusted controller code, independently bound originals,
reviewed exact inputs and successful replay of the closed transformation. A
changed compiler or repair scope needs a new reviewed binding. Deterministic
byte replay may use the recorded compiler evaluation time; real-time financial
expiry is checked separately by the unchanged current carry/final guards.

Only after that full verification may the restore step emit a distinct
`offline_recovery_verified` output, bound to the selected artifact, receipt and
current live predecessor. The workflow would give restore its own step ID and
exclude only that verified case from the existing provider-backed
`Prepare independently verifiable book evidence` and UI-only enrichment
branches (and unnecessary SEC cache restore). It must not set `published_input`
or accept a workflow input boolean. Ordinary fresh sources continue through
their existing enrichment. Compiler, carry, audits, UI, final transport/Pages
bounds and last-moment source/predecessor rechecks remain unconditional where
they currently apply.

Required admission tests before wiring: forged/self-consistent receipt;
unreviewed compiler/producer; extra changed or omitted original files; omitted
prior required members; changed unaffected group contributor; original ZIP,
companion, source or predecessor hash mismatch; stale/absent per-symbol date;
receipt replay after live predecessor changes; declared repair without full
restore verification; plain caller boolean or cloned verifier result; changed
artifact after verification; expiration before final publication. Ordinary
fresh-source selection/enrichment remains a positive regression case.

## Merge and activation ordering

Wait for the current financial rehearsal and the actual #419 source result.
Choose the newest source that actually passes the same integrity proof. If the
offline repair is still needed, combine the reviewed inactive repair plumbing
and the reviewed finite-renewal controller at one final revision, then run the final-head
proof once. Do not reuse a seal from an older controller. Activate financial
renewal first; then create a new price-recovery binding to that live renewed
predecessor and carry its active lineage. Publishing price first would invalidate
the #99-bound renewal proof and force a needless reseal. Neither a source date
advance nor a green scheduled run alone changes this order.
