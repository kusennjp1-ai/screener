# Staged US source promotion and genuine Oct 5 catch-up review

Local review batch, 2026-10-06 UTC. Production remains unchanged. The checked-in
rollout record is disabled. No provider requests, new credentials, paid service,
scheduler changes, remote branch writes or publication were performed.

## Exact effect of merging while rollout remains disabled

**As written, a main merge stops this fork's old US daily-price release bundle
and latest-pointer uploads immediately.** The new Git pointer remains inactive.
This is an explicit hold on authoritative source promotion, justified by the
observed partial bundles; it must be reviewed as that material behavior change.
It is not a claim that enabling a new scheduler or full one-hour update path has
been completed, and it must not be presented as a silent freeze of all daily data.

The following paths still proceed with the rollout record set to false:

- Existing scheduled/manual price collection and full snapshot calculations.
- The legacy daily importer from `xang1234/stock-screener`, as before; it does
  not switch to this fork's partial source or an uninitialized Git pointer.
- Current/fallback market artifacts and the existing frontend quality gates.
- Verified Static Site export/provenance artifacts.
- The existing separate feature-run cache uploads and fast-mode imports.
- Research UI Release selection, financial carry, nonregression checks and
  website deployment when their existing gates admit a genuine advancing export.

Thus the source hold does not itself stop website price acquisition or its
verified data-export path. It also does not guarantee website progress: the
existing source, financial, UI/current-head CI and price/date gates can still
reject an update. The new complete-cohort source admission is inactive until
its reviewed pointer bootstrap and rollout are enabled. Existing non-US source
publication remains outside this US hold. A reviewer who does not approve this
source-only hold should not merge the workflow portion as-is; leaving partial
source promotion silently enabled is not an equivalent safe implementation.

## Protected-code and renewal integration boundary

This branch starts from local `4255021`, whose tree
`00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9` was supplied as identical to deployed
main `8a490df5b0a873637781a8e4e5351cece9313f37`. It does not include later
in-progress renewal work. It changes backend, `.github/scripts/` and workflow
paths covered by `financial_release_v1.json`'s protected inventory.

Already deployed UI/source authority remains bound to its old immutable commit;
the branch does not rewrite that proof or its source clocks. New combined-tree
controller/candidate authority cannot borrow a seal made for the prior tree.
Integrate selected commits with the actual renewal head, inspect conflicts and
source/certificate/cohort/request bindings, run current-head CI and the relevant
candidate/source/carry gates, and prepare a new seal where required. Ordinary
data carry may preserve the approved UI only if all its existing current-main
controller and financial-continuity checks still pass. No merge, reseal or
publication was performed by this task.

## Concrete workflow change

US daily-price candidates no longer call `gh release upload --clobber` in the
collection job. Fast mode never builds/promotes an authoritative daily source.
Full collection retains the candidate and captured predecessor as an Actions
artifact. After both existing downstream quality gates pass, the final research
index and chart-close observations are recorded. Only a successful full US build
can enter the serialized source-promotion job.

The final controller performs the earlier coverage-policy guard plus:

- Original compressed bundle SHA, internal/external coverage counts, actual
  fresh-row count and nonweakened predecessor coverage policy.
- Actual last completed NYSE session and generated/previous clocks; a late
  catch-up is marked late rather than represented as an on-time publication.
- Independently pinned prior required symbol/exchange cohort, unioned with
  newly liquid **final exported** rows. Prior members remain required even if
  their new liquidity is missing or lower. Missing rows never remove members.
- All required source closes fresh; valid finite OHLCV, ordered unique dates,
  no weekends/future bars or unexplained adjustment discontinuities; matching
  downstream chart date, last-bar date, scan close and source close.
- No undocumented nontrading exclusion. This version accepts no new exclusions;
  a separately reviewed dated-evidence contract is required to add one.

The old direct-publish entry point is retired and fails before any external
write even for healthy declared coverage. Its coverage validator is reused by
the staged controller. Existing non-US source publication and the separate
feature-run bundle workflow are outside this US daily-price pointer change.
The feature-run bundle is still a cache seed, not proof of current-session
closes; its fast export cannot promote daily prices through the new guard.

## Immutable bytes and a conditional latest pointer

GitHub Release asset replacement deletes before upload, so it cannot provide a
safe pointer replacement. This batch uses:

1. Immutable asset name `daily-price-us-YYYYMMDD-<full-sha256>.json.gz`, uploaded
   without `--clobber`. Existing names are downloaded and rehashed; a collision
   or readback failure aborts. Historic source bytes are never overwritten.
2. The latest JSON manifest on dedicated Git branch
   `data/daily-price-pointers`, path `daily-price-latest-us.json`.
3. Exact predecessor blob SHA and manifest SHA captured before collection,
   reread under the publication lock before validation and immediately before
   update. GitHub's Contents update supplies the expected previous blob SHA;
   conflicts fail without deleting the prior pointer. See the official
   [Contents update contract](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents).
4. New pointer readback must match the intended bytes. An uncertain update is
   reported without a blind retry. If a race occurs after immutable upload,
   only an unreferenced candidate remains; the winner's pointer is preserved.

The importer supports this pointer explicitly and validates its Git blob hash.
During collection it also verifies the exact captured manifest SHA, so a pointer
advance between capture and import cannot silently change the seed generation.
A selected Git pointer that is missing, invalid or inaccessible fails closed;
it cannot fall back to the older unreviewed release pointer. Legacy readers
remain unchanged while the rollout setting is disabled. Hash-named assets are
outside the existing dated-file cleanup regex, so they are preserved; reviewed
reachability-aware cleanup is a future task, not part of this batch.

The existing seed step did not set `GITHUB_DATA_REPOSITORY`, so backend default
`xang1234/stock-screener` supplied daily inputs while this fork uploaded into
`kusennjp1-ai/screener`. Different imported/uploaded hashes are therefore not
evidence of corruption by themselves. The staged enabled reader explicitly uses
the same repository as its captured predecessor. The disabled reader retains
the old default. This provenance change is part of owner review.

## Bootstrap and activation are deliberately pending

`.github/daily-price-promotion.json` contains `enabled: false`. The new branch
must already contain a separately verified initial pointer with its source
policy, immutable source hash, required-cohort map/hash and original clocks.
The code cannot invent an initial cohort from successful downloads, downgrade
an unknown coverage policy or initialize a pointer automatically.

Do not initialize from the current partial daily-price bundle. Before enabling:
review the cohort and source policy, resolve the actual missing/stale close
evidence below, verify the source bytes and original date, prepare the initial
pointer for review, and only then authorize its creation plus rollout. Ordinary
data-carry publication still needs its existing UI/financial/price gates. The new
source pointer is source authority, not website deployment authority.

## Actual retained catch-up inputs

The latest completed session during Oct 6 intraday is Oct 5. The approved site
contains Oct 2 prices. The following actual inputs were inspected without
changing their dates:

| Input | Evidence and role |
|---|---|
| Approved release 37456692717 | Retained ZIP SHA `1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb`; prior research SHA `76ff161f3b55ac1b9a60683982ec11ff4610a1265f31318668d9cf8eec59b03e`. Supplies protected prior rows/cohort and retained financial/UI authority. |
| Oct 5 raw market artifact 11390987790 | 103,946,656 bytes; SHA `6be2a221ba1612a66268c90c9382a15ac8c6e06716eceab4bc87d034df179928`. Acquisition/export diagnosis only; raw liquidity differs from final recalculation. |
| Oct 5 final export 11391282396 | 306,686,108 bytes; SHA `6b1b0942a2ef90165b2c0635c55da04af925aae8e7a579cfec7f6414eb0f435d`. From successful Static Site 37407740745, head `d6cd685fbe197deb5f83a12026de5d764f6d6f7f`. Actual candidate price/feature data, not automatically publication-ready. |
| Final Oct 5 research index | SHA `7ec75c35de765ccc9e9befeadba30fa8058c5d79f4470281175cef312d2760cb`; 5,901 rows, 1,898 liquid, 1,903 in union with prior 1,894 liquid names. All 5,901 prior public rows remain. |
| Oct 5 durable bundle from that full run | Declared 8,682/9,926 fresh, 1,136 missing, 108 stale, no enforced minimum. It cannot establish complete required-cohort authority merely because the frontend export passed. |

The independently rerun unchanged OHLCV verifier on actual final chart bytes
found **1,889/1,903 current matching closes** and **1,852/1,903 technically valid
252-session histories**. Thirteen charts are absent: SUN, ET, DDS, APGE, AXIA,
CRNX, EA, EQR, KALV, LBRDK, NUVL, TWO, WBS. LBRDA's latest bar remains Aug 21.
These fourteen are unresolved, not proven nontrading exclusions. An additional
37 supplied histories are shorter than 252 sessions; they have current closes
but cannot claim full-history technical eligibility. No cohort ordering/OHLCV
or discontinuity failures were found. The overlapping short-history count is
50 because it includes the 13 missing charts; do not add overlapping counts.

The earlier raw-market union was 1,967. Final recalculation produces 1,903,
which is the appropriate proposed publication cohort. No prior required member
was silently dropped: all 1,894 prior liquid names remain in that union. The
fourteen missing/stale closes therefore still block this stricter source
promotion despite passing the existing 90% aggregate frontend gate.

The retained verification package contains
`final-independent-cohort-audit.json`, the two immutable artifact ZIPs,
`prior-scan-rows.json`, `final-scan-rows.json`, and the verified provenance/index
bytes. Reproduction uses `.github/scripts/audit-retained-close-cohort.py` and
its paired `.mjs`; the ZIP is streamed and only selected chart entries are read,
without bulk extraction. The original public workflow/artifact identities and
full ZIP digests above make the retained inputs independently retrievable.

## Validation and limits

Initial focused checks: **63 Python tests** for calendars, close audit, legacy
guard retirement, immutable/pointer controller and importer; **4 Node tests**
for final-observation binding, missing-chart retention, identity/date mismatch,
traversal and symlinks. All workflow YAML and shell blocks parse; syntax
compilation and whitespace checks pass. Tests include late data, changed bytes,
lost prior members, unknown cohorts, bad counts, superseded predecessors,
upload failure and a race after immutable upload.

No full backend/frontend suite, live GitHub mutation, real pointer conflict,
workflow execution or production timing trial ran. The Contents write boundary
is mocked locally. Current source/target bytes fail the complete close cohort,
so no live publish should be proposed yet. The retained-artifact ordinary-carry
reuse experiment is a separate local branch/report; component timings must not
be conflated with the 54-minute activation run or full screening latency.

## Exact rejection rules: close freshness versus historical eligibility

`audit_required_closes` has no 252-session minimum. A short supplied history
passes close admission if it is nonempty/coherent, has valid current-session
OHLCV, and matches the source, chart and scan date/close and instrument identity.
The 37 additional short histories therefore are not latest-close acquisition
failures and do not independently freeze source promotion. A dedicated test
uses a one-bar source with an invalid/unknown 252-bar technical audit, admits
the current close, and verifies that the technical result is unchanged.

The existing `auditDailyBars` verifier still rejects historical technical
eligibility below 252 bars. Its existing aggregate frontend gate remains in
place; the source controller does not replace it or mark an unavailable
technical criterion valid. The fourteen missing/stale closes independently fail
the required-cohort close/date binding. No exception is inferred merely because
there was an acquisition announcement, an unavailable chart or a missing bar.

## Bounded next step for the fourteen close blockers

The retained rows identify the following securities, but contain no CIK, ISIN,
CUSIP or dated corporate-action proof. All remain unresolved in this batch:

| Symbol(s) | Retained issuer / venue | First bounded evidence check |
|---|---|---|
| LBRDA, LBRDK | Liberty Broadband / Nasdaq | Check each share class separately against issuer and exchange notices; LBRDA has an Aug 21 last bar, which alone proves neither delisting nor a merger close. |
| EA | Electronic Arts / Nasdaq | Distinguish a signed transaction announcement from the effective closing and last trading date. |
| WBS | Webster Financial / NYSE | Check effective issuer/exchange status as of Oct 5 and continuing symbol identity. |
| TWO | Two Harbors Investment / NYSE | Check effective listing/issuer-action status; preserve separate common/preferred identities. |
| SUN | Sunoco / NYSE | Check common-unit/issuer identity and actual transaction effective dates. |
| ET | Energy Transfer / NYSE | Check its own listing and unit identity; do not inherit SUN's status. |
| AXIA | Axia Energia ADR / NYSE | Verify ADR ticker/issuer transition and effective alias history; do not fabricate a ticker substitution. |
| DDS | Dillard's / NYSE | Verify class identity and active listing before treating absence as a provider omission. |
| APGE | Apogee Therapeutics / Nasdaq | Check official issuer/exchange status, then distinguish active omission from ingress rejection. |
| CRNX | Crinetics Pharmaceuticals / Nasdaq | Same bounded identity/status check, without inferring cessation from sector news. |
| KALV | KalVista Pharmaceuticals / Nasdaq | Check effective issuer/exchange status and last eligible session. |
| NUVL | Nuvalent / Nasdaq | Check effective issuer/exchange status and last eligible session. |

For each name record the exact official issuer/exchange URL, document capture
hash, publication time, effective last trading session, issuer/security/class
identifier and successor mapping if explicitly documented. Only an effective
cessation at or before Oct 5 can support a proposed dated nontrading exclusion.
Announced-but-unclosed transactions remain required. No official cessation
evidence has been collected in this batch, so the exclusion list stays empty.

For identities proven active, first inspect existing provider/import rejection
telemetry and exact retained histories. Only after the collection boundary is
reviewed, make at most one bounded fresh-price attempt per unresolved active
identity using the existing provider, permissions and rate budget. A full-history
refetch is justified only by the existing adjustment-boundary policy, and it
must be separately recorded; never infer split ratios or patch bars. Stop on
access/rate restrictions. Do not refetch the whole universe to resolve fourteen
specific missing/stale observations.

After evidence is resolved, rerun the old/new required-cohort union, source
coverage and identity checks, actual NYSE session/as-of consistency, independent
chart/scan/source comparison, original technical verifier, financial carry and
publication nonregression checks. The stopping condition is fourteen verified
current closes or individually reviewed dated nontrading outcomes, with no
remaining silent omissions. Until then the Oct 5 candidate and pointer
initialization remain ineligible for production promotion.

## Independent-review fixes

Three independently reproduced workflow/clock defects were fixed locally after
the first review. The rollout remains disabled.

1. Full-US export exit 78/79 can succeed without producing a market artifact.
   The build now emits `produced_candidate` only after a real immutable artifact
   ID exists. Promotion requires that output and both exact artifact IDs, so a
   successful fallback combine cannot turn a non-producing build into promotion.
2. A failed-job rerun may consume a candidate produced by attempt 1 while its
   own attempt is 2. Downloads now use the successful producer's immutable ID
   and digest outputs. Each package binds its actual producer run/attempt, source
   commit, role and complete consumed-file hashes. API artifact metadata and
   downloaded bytes are verified against those bindings. The consumer attempt
   never reconstructs a producer artifact name or searches for a latest fallback.
3. Validation time is not completion time. The pointer manifest labels its
   validation clock and validation-only deadline status. After immutable upload,
   the controller re-resolves the latest completed session immediately before
   the conditional pointer write. A separate retained completion receipt uses
   the clock after verified pointer readback, records lateness, and states whether
   the target is still the latest completed session. A 20:59:59 validation followed
   by 21:01 completion is reported late. This receipt measures the source pointer,
   not the later website or full-screening publication.

Negative tests exercise the real workflow admission expression for exits 78/79,
prior-attempt reuse on consumer attempts 2/3, wrong artifact identity/digest,
changed predecessor bytes, deadline crossing, clock rollback and a session
advance during upload. A failed source write/readback is never retried blindly.
The final focused run passes **75 Python tests and 4 Node tests**, plus YAML and
shell parsing, syntax compilation and `git diff --check`. No live workflow or
GitHub write was used to test these fixes.

## Current-controller revocation check

An enabled old workflow checkout is not continuing promotion authority. Before
immutable upload and again inside the final pointer update callback, the
controller freshly reads `refs/heads/main` and requires its exact commit to equal
the workflow's `GITHUB_SHA`; `GITHUB_REF` must be `refs/heads/main`. The rollout
file is read from that exact commit, its Git blob hash is checked, and its schema,
boolean `enabled: true` and pointer destination must match. A second main-ref
read brackets the policy read. Reads request `Cache-Control: no-cache`; neither
the old checkout nor `needs` outputs substitutes for live authority.

The final callback runs after the captured predecessor is reread and before the
Contents API update. It checks controller authority, then the current clock and
completed session, with no other remote operation before the conditional write.
A newer main commit, a disabled/unavailable policy or a different policy binding
fails closed. If detected after upload, the previous pointer is preserved and
only an unreferenced immutable candidate remains. Both the manifest and separate
completion receipt retain the verified controller commit/ref and rollout hashes.
This uses existing Contents reads and adds no permission or activation.

GitHub does not make the main-ref read and the separate data-branch Contents CAS
one transaction. A main change after the last authority read but before the PUT
remains a narrow read-to-write window; this guard must not be described as atomic
revocation across both refs. The data pointer itself still has the server-side
expected-blob precondition. A future strict cross-ref stop would require a
separately designed single authority/transaction boundary.

The owner-review continuation adds negative cases for an already advanced main,
main advancement during upload or policy reading, rollout disabling before or
during upload, invalid controller ref/SHA, wrong policy schema/destination/hash,
and unavailable authority. Workflow tests bind the CLI arguments to the actual
workflow context. The focused suite now passes **85 Python tests and 4 Node
tests**, plus YAML/shell parsing and whitespace checks. All API and mutation
boundaries in this continuation were mocked; no remote reads or writes ran.
