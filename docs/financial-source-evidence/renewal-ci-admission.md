# Disabled exact-main CI admission for financial renewal

This local change adds a bounded `workflow_run` route without activating it.
The existing renewal registry has `ci_admission: null`, publication remains false,
and source/controller/consumer-transition production lists remain unchanged.
It introduces no provider calls, credentials, permission expansion or schedule.
The frozen actual-data rehearsal at `e0218b2b7479719549809e0f9bf14bd9bc844fa8`
does not test this separate change.

## Reviewed commit sequence

The optional admission lives inside the existing separately hash-bound renewal
registry, not in a newly excluded code path.

| Stage | Committed change | Automatic action |
|---|---|---|
| R | Reviewed code, source authority and request; null CI admission and publication false | None |
| A | Direct child of R; only the existing registry blob changes to a certify admission naming R/tree and the request's exact raw hash | First successful main push CI may start certification |
| B | Existing candidate pin and explicit release intent, bound to the sealed A record; registry bytes stay identical to A | None |
| C | Direct child of B; only the existing registry blob changes, appending the exact A/B review, enabling the separately reviewed publication flag and naming B/tree plus all three raw control hashes in the publish admission | First successful main push CI may start the existing publisher |

Every complete Git tree, including modes and unprotected control paths, is
compared across R/A, A/B and B/C. A/B adds only the two new pin and intent files
and retains identical raw registry bytes, including when B is a merge. The
internal registry deltas are closed too: no
unrelated policy, prior authority or consumer-transition change is permitted.
No commit contains its own future SHA or future CI run ID. Actual A/C identity
comes from checkout, immutable Git objects, current main and independently
authenticated CI/caller records.

Existing manual records keep their exact old shape. Legacy registries may omit
only the new nullable field; validation treats that absence as null while every
raw-byte hash still uses the original bytes. Automatic records must contain their
closed admission proof. A manual-looking record cannot authenticate an automatic
certifier event. Mixing a publish admission with an unproved manual publisher is
rejected; the original manual path uses its original null-admission sequence.

## Current and historical proof

Admission binds the triggering successful CI push to main, first upstream and
downstream attempts, repository name and ID, exact workflow paths/source SHA,
current checkout/main SHA and tree, and each required CI job's ID/head/attempt.
Exact-attempt and latest-run endpoints must agree. Newer CI runs/attempts,
forks, PRs, alternate branches, ambiguous jobs, altered raw controls, dirty
checkouts and changed registry bytes fail closed.

The certifier saves the literal proof inside `certification-controller.json`,
whose digest is already sealed by the candidate record. The publisher retains
its own proof in the existing authority transition. Original source clocks,
failed producer status, source certificates, A/B/C inventories, price/UI/universe
equality, financial replay and physical/TAR limits remain mandatory.

Every active proof requires the actual workflow's named admission step and active
job. Certification rechecks admission after archive readback and then samples
financial expiry. Both publication rechecks repeat predecessor and current CI
admission after physical/TAR work and sample financial expiry last.

The preparing publisher has a distinct internal verification path: only its exact
active run may validate the newest transition as current. Every older transition
remains historical. The live reader exposes no allow-running option and requires
terminal successful admission and deployment for automatic publisher history.
Subsequent ordinary carry preserves that history after current intent removal.

## Ordinary data and competing events

Pending, disabled or incomplete renewal controls do not freeze ordinary advancing
price/data publication. Design Acceptance and Static Site events retain their
ordinary route. If they advance the live predecessor, renewal becomes stale and
fails its existing identity checks.

The existing publisher keeps its workflow-level serial concurrency group. A new
read-only routing job precedes the protected publication job. For an exact
eligible head, it can authenticate an ordinary non-CI source and emit the named
positive marker `Ordinary non-CI publication: ID/ATTEMPT`.

Replay admission requires a complete bounded run inventory. An earlier same-head
run blocks unless its entire successful workflow, successful routing marker,
ordinary publication job and exact upstream non-CI attempt are independently
verified. Missing markers never imply permission. Failed, cancelled, running or
ambiguous prior runs block. Later queued runs are allowed only while the current
older job holds the verified unchanged serial lock; later running or consuming
runs block. A later rejected duplicate cannot invalidate historical publication.

A stale or uncertain competing run can therefore require a newly reviewed finite
admission commit. This is an explicit operational limitation, not an automatic
retry permission.

## Bounds and remaining evidence

The existing 64 KiB control bound remains. Complete Git inventories allow at most
30,000 regular blobs. Run/job inventories require complete pages and fail at the
API's 1,000-result limit. The new router and admission steps have five-minute
bounds; existing certification/publication proof limits are not raised.

The complete uncached synthetic automatic lifecycle passed 5/5 tests in
866.381 seconds. Certification made 451 reads (181 immutable, 270 mutable), and
publication made 1,548 (991 immutable, 557 mutable), including both final gates.
The 1,999-read positive workflow total excludes negative tests, historical-reader
probes and the subsequent ordinary carry. Single-page synthetic inventories do
not establish actual hourly usage or concurrent repository usage. GitHub documents
a default GITHUB_TOKEN budget of
[1,000 REST requests per hour per repository](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).

Automatic CLI invocations now reuse only validated immutable Git responses for
the exact repository: full-SHA commits, complete recursive full-SHA trees, and
literal file paths at full-SHA revisions. Trees are independently reconstructed
as Git Merkle objects and contents must match their Git blob hashes, byte counts
and paths. Commit API responses retain the existing SHA/tree/parent identity
contract; their JSON is not a reconstruction of the original raw commit object.
Missing verification fields leave a response uncached; contradictory hashes fail.

Each invocation has a fresh 128-entry, 32 MiB bound and disposes its cache after
success or error. Overflow falls back to fresh reads. No cache survives a CLI
command or final recheck. Pagination, alternate repositories, mutable references,
run/job state, artifact availability and unknown endpoint/query forms always
perform fresh reads. Predecessor and expiry checks are unchanged. Manual CLI
execution does not enable this cache. The cache-integrated lifecycle measurement
below verifies these savings on the synthetic fixture; actual operational quota
remains separately assessed. No token or permission expansion is introduced.

Local automatic lifecycle and independent review are separate gates. A successful
small synthetic run is not actual financial acquisition, a real GitHub automatic
admission, target-runtime CI or permission to activate the registry.

## Operational quota preflight in the disabled combined successor

The combined successor retains the staged actual-input diagnostic from local
`1665d197d6e7812e6652d9e82513cde0aba0b93d` (tree
`72151036a02bcc7fb451de33489d99ae218ee845`) and the automatic runtime at
`4f52bae5bc4ecd9f19af455ec1be2c96d850863f`. Their changed-path sets are disjoint.
The ongoing actual-data run at that staged tree remains separate evidence; its
manual producer/caller records cannot be relabeled as automatic certification.
All production source/controller/consumer entries stay empty, publication stays
false, and CI admission stays null.

The cached automatic lifecycle at `4f52bae` passed 5/5 in 577.483 seconds.
Certification used 330 reads, publication 722, and ordinary carry separately 227.
All 24 positive commands retained identical mutable read sequences/counts;
certification and publication together retained all 827 mutable reads. Those are
single-page synthetic measurements. They are minimum demand observations, not
reserved capacity or worst-case limits under pagination, competing jobs or
secondary limits.

Automatic admission now checks the existing job token's official
[`GET /rate_limit`](https://docs.github.com/en/rest/rate-limit/rate-limit) with
included HTTP headers. The validated `x-ratelimit-*` core headers govern when
valid overview body counters differ; both are recorded. The request does not
consume primary REST quota, but every probe is counted as an actual request and
may encounter [secondary limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api).
It creates no reservation and cannot measure concurrent future consumption.

Admission requires remaining core allowance of at least 330 for certification
or 722 for publication. Subsequent commands recheck their measured demand:
certification prepare 78, source 29, surfaces 72, bounds 29 and seal 93;
publication plan 145, restore 88, compose 88 and each recheck 182. The final
post-archive certification boundary refreshes quota before its remaining 21-read
proof; both post-physical publication boundaries refresh it before their
remaining 29-read proof. Existing current-main, predecessor, source and expiry
checks still execute, with real financial expiry checked last.

Each probe has a 15-second request timeout, 64 KiB response cap and 60-second
HTTP-Date age tolerance. It rejects malformed/duplicate/noncore headers, invalid
counter arithmetic, insufficient allowance under the actual returned token
limit, regressing request/response clocks, future or stale HTTP Date, and reset
at or before response receipt. Non-200, Retry-After, timeout and uncertain process
results fail closed. Valid safe Date/core/reset and sanitized Retry-After are
retained on denials. A changed future reset is freshly assessed; no cached reset,
wait, automatic retry, or hypothetical nine-minute delay grants capacity.

Cheap existing local context/event checks run before a quota probe. Disabled,
incomplete, manual and ordinary publication paths do not acquire quota proof.
Each actual automatic probe writes sanitized JSON under the job's separate
`RUNNER_TEMP/financial-renewal-quota` directory and to stderr. Nothing enters a
sealed candidate, source certificate, publication identity or resumable authority
state. Local recording is mandatory. An optional independent artifact upload
runs even after a denied job; its storage failure is non-fatal, so an outage after
successful deployment cannot invalidate the published caller's terminal success.
The existing last financial recheck remains immediately before deployment.

Normal GitHub/API failures, pagination completeness, source availability,
concurrency and historical admission rules remain unchanged. A held or ambiguous
attempt is not silently retried or treated as unadmitted; a fresh reviewed finite
admission may be needed. Actual remaining/reset headers and concurrent workload
must be assessed operationally. The earlier combined 1,052 reads do not alone
prove an hourly breach, and modeled margins do not prove available quota.
