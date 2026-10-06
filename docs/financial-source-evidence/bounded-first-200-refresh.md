# One bounded statement refresh visit

This source-only implementation is disabled. It prepares one genuine refresh of
the earliest 200 complete annual histories from the original 1,894-symbol price
cohort. Existing applicability excludes BITU, ETHE and SBIT, leaving 1,891
financial-applicable symbols; every original price row and source object remains
retained. No public release, source-policy grant or recurring schedule is added.

The exact review files are in `.github/bounded-refresh-first-200/`. Their hashes,
the original run 37203329163 attempt 8, artifact 11307162746, ZIP/manifest/base/
cohort hashes and selected receipt-cache digest are compiled into the bridge.
The original Oct 2 price date and Oct 4 source observations are unchanged. New
financial observation times must come from new successful provider transports.
The required-valid-through horizon is Oct 7 23:34:38.925 UTC; both existing
statement getters are due through that horizon. There is no cached-time renewal.

The selected queue starts NVDA, AMD, VIRT, A and ends BBIO. The first source-age
deadline is Oct 7 10:46:54.945 UTC; the complete job must begin by 10:21:54.945.
An existing AAP quarterly reporting-period gap stays explicit. All 200 annual
histories are complete. Identity remains ticker-only: symbol/provider-symbol/US
and observed names, with no stronger CIK/issuer binding. Known identity conflicts
and global old transport/in-flight barriers reject the visit. No new metadata
requests or name heuristics are introduced.

## Acquisition and retention bounds

- At most 200 symbols, 400 getters, 1,000 HTTP transports; 1.5-second pacing,
  zero caller retries. Request timeout is clamped to remaining acquisition time.
- Whole job 25 minutes. Its first step records the actual start; setup/restore
  and staging consume that clock. Collection receives
  `min(1080, 1500 - elapsed - 420)` seconds, preserving a 420-second finalization
  and upload reserve. Missing/future/exhausted clocks reject before collection.
- First 403/429 or transport exception stops further transport. Empty successful
  HTTP responses and missing statement periods remain separate source gaps.
- Existing source ZIP caps stay 128 MiB compressed, 512 MiB expanded, 30,000
  members and 32 MiB per member. All archive caps stay unchanged.

The retention guard measures actual current files with raw deflate and SHA-256,
then reserves conservatively bounded future objects without assuming a future
compression ratio. It includes journals, cache/results, transport/acquisition
bytes, archive duplicates, manifest replacement and ZIP framing. It checks at
every getter/transport/result boundary. A retention stop keeps actual partial
acquisitions and journals, writes original complete empty projections for all unstarted symbols and
does not construct further provider work. A lower per-visit manifest ceiling is
checked before new archive objects are written.

Real original-source staging measured 189,306,901 expanded bytes and 28,781,211
encoded/framing bytes. After future reserves the remaining local capacity was
259,876,863 expanded bytes, 16,599,413 compressed bytes and 19,325 members. A
complete canonical ZIP was actually written and every member read back:
28,099,993 bytes, SHA-256
`2eeb4246aab020063387ba8367d8669ed59fa13450f9b7d1f0264b425633ec4d`.
This measures the local writer; the actual Actions artifact must still be
downloaded, bounded, hashed and read back before accepting it as a new source.
Partial evidence remains in the always-upload path. No archival rotation or
repeated acquisition is included.

## Dispatch admission and later source acceptance

The existing workflow is push-only on `improve/mandatory-financial-source-recovery`.
The committed `dispatch-admission.json` is closed and disabled. A separate exact
review must enable one first-attempt workflow run number and its finite dispatch
window. No public input, CLI flag or environment variable grants authority. A
second push/run or retry must fail closed. The parent must also verify no
concurrent recovery is pending before the admitted push.

Review this source-only change on a non-triggering branch. Pushing an enabled,
reviewed commit to the recovery branch is itself the provider dispatch. After
collection, independently review its actual source/artifact/manifest identities
and fresh receipt clocks. Existing public source-policy entries do not authorize
that future artifact. A separate exact source-policy append and renewal release
review are required for later publication. Current main, candidate, pin, intent
and renewal production registry are outside this implementation.

This patch is based on the existing recovery producer
`4b27798b9b04528737938bb5844a8d86a704c58d`. Any review/PR must target that source
branch or transplant this finite source-only diff deliberately. Its older full
tree must never be proposed as a replacement for current publication main.

## Offline verification

Final local suite: 204 Python tests and 22 Node tests passed. Exact source
prepare/cache/runner dry-run plus ZIP readback passed in 96.43 seconds, with
network and provider construction forbidden. Independent review accepted the
reservation and exact-run-number fence. Execution remains false/null.

The exact original archive replay verified all 7,613 objects, 3,782 attempts and
400 selected receipts with provider construction/socket/curl blocked. All 400
require fresh acquisition through the horizon; ordinary current/not-due receipts
still reuse or skip without traffic. Mock-provider lifecycle tests use the real
normalizer and prove new capture IDs/clocks while preserving old bytes, distinct
403/429 and missing-statement outcomes, complete 200-symbol stopped projections,
partial archive merge, manifest-failure atomicity, path/link rejection and ZIP
byte readback. Local Python 3.12/Node 24 differs from CI Python 3.11/Node 22; exact
remote CI and real provider acquisition remain unperformed.

The unchanged, hash-verified reviewed source certifier also replayed four
200-symbol archive-backed partial-stop fixtures: before the first getter (zero
transport calls), after one getter, at the second transport, and before result
normalization. All transports in the latter cases were mocked; these are no
evidence of real acquisition. Original archive/storage and financial batch
replay audits passed. Source certification already classifies exit 4 and
budget-stopped attempts. The current v2 preview/renewal policy admits only its
reviewed exit 0/3 and ordinary-failure scope: a stopped artifact remains
recoverable source evidence, not publication-ready input. A later continuation
with retained budget-stop history requires separate compatibility review; this
change does not loosen that policy or erase the history.
