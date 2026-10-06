# Bounded local four-symbol price adapter

This implementation collects local price proof only. It does not write a
database, financial queue, universe mapping, source pointer, release, workflow
or website. Default admission is offline. The checked-in admission record has
`capture_approved: false`, pending identity review and no approved controller.

It implements the envelope in the frozen
[proposal](financial-source-evidence/four-symbol-price-recovery-proposal-2026-10-06.json)
without changing that proposal's original bytes or observation clock. Its old
`implementation_status` is historical; this document describes the implemented
adapter. ET/SUN/DDS request Sept 29 through Oct 5, with four overlap sessions.
VMRK requests at most two years ending Oct 5 and cannot splice an EQR scalar or
legacy chart. Official CIK/class/date transitions are reused unchanged. AXIAY
OTC and the nine dated retirement proposals remain outside this adapter.

## Enforced transport and proof boundaries

- Two synchronous yfinance download calls and four bounded history requests.
  Each symbol can also have one metadata-only timezone probe. One ordinary
  cookie bootstrap and one crumb request give **ten total HTTP requests**.
- Every session request is intercepted before egress. Duplicate role/symbol
  requests, unexpected hosts/endpoints/options, POSTs, alternative consent/auth
  flows, redirects and requests outside the exact date bounds stop the run.
  A stop remains latched even if yfinance catches an exception and continues.
- HTTP 401/403/429, chart errors and transport failures stop subsequent calls
  within this process. The latch does not itself establish shared/global backoff.
  The normal `fc.yahoo.com` cookie bootstrap alone may return 404; its body is
  never retained or admitted as prices. No fallback provider or denial bypass
  exists. curl retries are explicitly zero and automatic redirects are disabled.
- The existing session impersonation/environment configuration is retained;
  no alternative proxy or identity is selected. Ordinary bootstrap cookies stay
  in memory only. Cookie/crumb/authorization values and bootstrap bodies are not
  written to proof or logs. No vendor price cache is reused without a receipt.
- Before egress, the existing shared Redis rate keys are reserved atomically,
  at the same or slower effective global/US rate, including existing batch keys.
  An unavailable/open circuit fails closed, including a circuit that opens while
  waiting. There is no in-process fallback. Other legacy callers do not meter
  every transport operation, so this does not claim global enforcement beyond
  this pilot's own requests.
- One in-flight request, at most ten seconds per request and five minutes for
  the pilot. Cancellation, clock rollback and crossing the allowed Oct 6 UTC
  capture date latch a stop. Body callbacks use libcurl's explicit abort
  sentinel; returning zero would not reliably stop this curl_cffi version.

The raw chart body is captured before normalization under a SHA-named,
exclusive-create file. Receipts bind sanitized request parameters, role, actual
UTC start/completion clocks, body hash/size, proposal hash, controller commit and
admission hash. Missing or failed receipt writes stop later requests. Replaying
a history rereads and rehashes the actual body; a cached frame without original
proof cannot be relabeled as a new observation.

yfinance's timezone probe can include Oct 6 intraday values. Such bodies are
captured with role `metadata_only`; they cannot supply a bar, close, volume or
screening input. Normalization uses only the four explicitly bounded history
responses, verifies `dataGranularity=1d`, derives sessions in New York time and
rejects any timestamp at or after Oct 6 00:00 EDT (04:00 UTC). Current quote
metadata such as `regularMarketPrice` is ignored.

## Identity and history admission

Permission to collect and permission to use an issuer mapping are separate.
The four-symbol capture may retain quarantined evidence; pending mappings cannot
produce admitted observations. An identity record must explicitly match the
official issuer, CIK/security identifiers, share/unit class, prior and provider
symbols, effective date, target MIC and source URLs. Its reviewed expected
provider name, venue, currency, timezone and instrument type must agree with the
actual payload. A stale NYSE venue cannot be called TXSE. An unknown provider
venue remains quarantined until evidence supports a reviewed mapping.

The chart payload itself generally does not certify a CIK or share class. Output
states the narrower basis: reviewed official mapping plus provider metadata.
It does not claim provider-issued identifier certification or change financial
receipt identity. Any identifier present in the payload must not contradict the
official record.

The three prior charts are streamed from the original approved ZIP/TAR after
full archive SHA verification; only their selected bytes are held in memory.
Each chart must match its exact recorded SHA. All four overlap sessions must
match OHLC and volume; existing `coherent_history` and `requires_full_history`
checks remain in force. A changed split/adjustment basis or missing overlap
quarantines the result and requires a separate reviewed full-history request.
There is no automatic fifth history request and no fabricated adjustment.

VMRK has no legacy chart in this contract. Only its captured provider history
is considered. A short valid history can establish an Oct 5 close while
`technical_history_252_available` remains false. That flag describes history
availability, not a passed technical selection rule. Normalized files explicitly
set `publication_authority: false` and preserve actual acquisition clocks.

## Exact offline admission command

Run from the repository root with the prepared Python environment active. Set
`PRICE_PILOT_RETAINED_ARCHIVE` to the caller's retained
`screener-uploaded-pages-release-37456692717-attempt1.zip`, whose exact SHA-256 is
`1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb`.
Set `PRICE_PILOT_OUTPUT` to a new directory beneath an existing caller-owned
parent directory. The admission command checks these inputs without acquiring
prices or creating that output directory.

```bash
: "${PRICE_PILOT_RETAINED_ARCHIVE:?Set the path to the retained release ZIP}"
: "${PRICE_PILOT_OUTPUT:?Set the path to a new pilot output directory}"
PYTHONPATH=backend python -m app.scripts.bounded_price_recovery admit \
  --proposal docs/financial-source-evidence/four-symbol-price-recovery-proposal-2026-10-06.json \
  --admission docs/financial-source-evidence/four-symbol-price-pilot-admission-pending-2026-10-06.json \
  --admission-sha256 381c93462d6fd6d10842542b150fb17be13d395c19b5061ae025d5663a87949d \
  --prior-release "$PRICE_PILOT_RETAINED_ARCHIVE" \
  --output "$PRICE_PILOT_OUTPUT"
```

This command was run against the actual retained archive. It verified ET/SUN/DDS
history hashes, returned `execution_enabled: false` and `capture_approved: false`,
and created no acquisition output. It also reports missing runtime modules and
the vendor-source contract. It cannot contact Yahoo or initialize Redis.

Only after review may a separate admission copy set `capture_approved: true`
and the exact clean controller commit. Any reviewed identity records must be
approved individually; pending records remain quarantined. A later execution
would use `run --execute`, that separate file and its newly computed full SHA,
on an existing full backend runtime with functioning shared controls. There is
no ready-to-run approved acquisition command in this deliverable.

## Current Static Site cannot execute this pilot unchanged

The inspected workflow sets `REDIS_ENABLED: "false"` in both build and combine
jobs (lines 161 and 561). `live_rate_gate` explicitly rejects that setting before
requesting a Redis client. Its existing in-process limiter is not substituted.
The usual fast/full workflow concurrency groups also differ, so they do not
establish a common provider lock across those jobs or other Yahoo consumers.

A separately reviewed one-off CI job with an ephemeral official Redis service,
`REDIS_ENABLED=true`, the full pinned runtime and the ten-request envelope could
satisfy the **mechanical** rate/circuit guard. The service would coordinate only
clients attached to that job's instance. It would not establish global budgeting
with other CI runners, workflows or deployed workers. Repository/source access
could remain read-only, while local proof files and ephemeral budget keys are
necessarily written. No such service or workflow has been configured here.

Before any dispatch, the owner must review concurrent provider activity and the
actual isolation/budget scope. The admission record therefore separately
requires `provider_budget.review_status=approved_for_ten_request_pilot`, an
explicit `existing_shared_redis` or `isolated_ci_job` scope and a review note.
Its checked-in value is `unreviewed`. Receipts retain the approved scope and
explicitly say `cross_job_global_budget_proven: false`; an ephemeral Redis
instance is never presented as proof of cross-job coordination. Global egress
coordination remains an architecture requirement for a reliable close deadline.

## Runtime and retention bounds

The adapter requires the inspected yfinance 0.2.66 source hashes and tested
curl_cffi **0.16.3**, including hashes of its callback, request and request-option
implementations. A mismatch aborts before provider access. Calendar/runtime
checks are before acquisition. The lightweight test runtime lacks Redis,
Pydantic/Pydantic Settings, SQLAlchemy and exchange-calendars; it can run offline
admission and synthetic tests but is not a complete live acquisition runtime.
No dependencies, new environment, credentials or service were installed.

The output directory must be new; files are never overwritten:

| Output | Hard retained size bound |
|---|---:|
| At most eight raw chart bodies | 8 MiB each, **32 MiB aggregate** |
| At most ten response receipts | 16 KiB each |
| At most four admitted observation files | 1 MiB each |
| One terminal report | 1 MiB |
| Total | **Under 38 MiB** (39,845,888-byte announced ceiling) |

Bootstrap bodies are not retained. Output remains local until reviewed; there is
no upload, cleanup job or automatic deletion. Keep failed/quarantined receipts
with the attempted capture so a later review does not repeat requests blindly.
The prior archive and universe datasets are not copied into this directory.

## Verification and limits

Twenty-six adapter tests pass against recorded synthetic bodies. Two execute
the real pinned yfinance and curl request wrapper with only the low-level
transport replaced: the healthy run uses exactly ten intercepted requests; a
403 run stops after one. No network was used. The healthy replay independently
normalizes four observations, excludes actual synthetic Oct 6 metadata bars,
and keeps current acquisition clocks. Tests also cover exhaustion, hidden
retry/redirect, 429/transport failure, cancellation, raw/receipt limits, cache
and byte mutation, UTC midnight, DST/exclusive end, issuer/class/MIC mismatch,
split/overlap mismatch and VMRK's missing legacy history.

The ten pure existing history-integrity cases and 27 existing calendar/close
contract cases were checked separately. A broader cache/database test attempt
was blocked: 15 tests lacked SQLAlchemy/Pydantic and ten lacked the database
fixture under `--noconftest`; these are not reported as passing. The new vendor
replay injects the existing `chrome` setting because the lightweight runtime
does not contain the full configuration dependencies. No full backend suite,
live shared-budget race, provider acquisition or production publication ran.

The remaining review is this controller, its exact request envelope and each
identity mapping. Any later publication still needs a dated cohort transition,
all required prior members, source/chart/scan date and price agreement, technical
recomputation and financial-continuity gates. This pilot does not alter those
gates or establish the requested full-screening one-hour target.

## Finite one-shot GitHub admission

The consumed admission is now the dedicated GitHub capture run, not a new
writable Git branch or authority service. The pending record binds repository,
workflow path/ID, branch, controller SHA, expected run number and attempt 1.
Both repository identities must be the known repository ID `1203919607`;
a recreated repository with the same name is rejected. The acquisition job must
also match the bound `run_id` and `head_sha`, not only its display name/status.
The separately named `four-symbol-price-capture.yml` workflow is not supplied
or activated by this preview, its workflow ID remains unset, and all capture,
identity and budget approvals remain pending.

Before any provider request, the controller reads the current run, exact attempt,
active workflow, current branch head, complete bounded workflow history,
attempt/job history and immutable terminal-artifact metadata. Missing/deleted or
oversized inventories fail closed. This dedicated pilot admits only the first
capture run and its first attempt. Every earlier capture attempt is spent,
including zero-request, canceled, failed, denied or uncertain attempts. A missing,
expired or apparently successful terminal artifact cannot make it reusable.
Because all earlier attempts are rejected, artifact contents are never treated
as a permission to resume. The offline preview uses a different workflow and
neither acquires data nor consumes this finite admission.

GitHub cannot distinguish two Python processes within the same in-progress step.
A fixed exclusive-create, fsynced marker in the trusted `RUNNER_TEMP` directory
therefore also consumes the local invocation before acquisition. It is outside
the caller's output path and independent of Redis or admission-file bytes.
A fresh same-job process cannot reset it by selecting another output or Redis
instance. Across jobs/reruns, the GitHub run number/attempt/controller checks
provide the durable barrier. The future reviewed capture workflow must invoke
one acquisition step using `exec`, never loop/restart it; a replaced or duplicate
job is rejected. A runner loss without terminal evidence remains uncertain and
spent, not permission to restart.

The claim and terminal journal are append-only local outputs. A future capture
workflow must retain `price-pilot-attempt.json` as the immutable artifact
`price-pilot-terminal-{run_id}-{run_attempt}`, with raw proof retained separately.
There is no artifact upload in the capture CLI itself and no GitHub write API
in the barrier. Its maximum two additional 64 KiB journal files still fit the
announced 38 MiB retained-output ceiling. A further capture would require new
owner review of a new finite pilot policy; the current one has no reset/resume
or automatic cooldown-expiry route.

Fourteen barrier tests cover fresh processes, new output/Redis values, concurrent
claims, uncertain rereads, altered branch/controller, reruns/new runs, canceled
or terminal runs, missing/deleted histories and existing/expired artifacts.
All pass with synthetic read-only GitHub responses. This barrier is not a claim
of global provider backoff: the adapter still does not update every other job's
circuit state after a denial.

## Actual-acquisition trigger remains a separate operational decision

The connected GitHub tools do not expose workflow dispatch, and the available
cloud browser is logged out. The frozen capture controller currently accepts
only `workflow_dispatch`; no actual capture workflow is supplied here. Therefore,
after a capture workflow and its inputs are separately reviewed and installed,
the current route would require the user to press **Run workflow**. A green
offline preview does not remove that dependency. Do not substitute a hidden API
call, create credentials or treat a branch push as capture authorization.

A feasible alternative is a separately reviewed, one-shot **intent-only push**.
It is a proposal, not enabled behavior in this revision:

1. Review and freeze collector source commit **C** after offline CI on current
   main's safety baseline. Place it on one exact dedicated capture branch, with
   no activation-request file. A future push trigger must filter only that exact
   request path; source staging must not itself launch acquisition.
2. Separately review the canonical intent bytes **R** and their full SHA: the
   exact source C, four instruments and identity evidence, completed session,
   actual retrieval window, ten-request cap, retained input hashes, budget scope,
   repository/workflow IDs, exact branch, one run number and attempt 1. The
   authority for C and R must be fixed outside the incoming candidate head,
   using a separately pinned reviewed source/intent record or the existing
   immutable report-artifact mechanism. Candidate-supplied fields or a green
   test artifact alone cannot approve themselves.
3. Prepare activation commit **I** whose only parent is C and whose sole change
   is adding R at the allowlisted request path. Review the final full I SHA,
   C→I diff and exact R digest before publishing that specific commit. The
   workflow/bootstrap bytes must be identical to the reviewed C. This avoids
   embedding a commit's own hash into itself: C identifies collector source;
   I identifies the later, separately reviewed intent delivery.
4. Before egress, the future push adapter must independently validate the fixed
   authority record, repository ID, exact branch, non-forced/non-deleted push,
   `before=C`, `after=I`, I's parent and one-file diff, intent digest and source
   inventory. It must execute the verified C controller and preserve the finite
   run/attempt, same-job marker, identity, clock and budget checks. Never use
   `controller_sha=GITHUB_SHA` as an approval rule for arbitrary pushed code.
5. The owner admits only that exact activation push. The collector job keeps
   repository read permission and ordinary report artifacts; no new credential,
   provider permission, source-publisher permission or main write is needed.
   Later pushes, retries and uncertain/denied attempts remain spent.

The separate source/intent authority record and push verifier still need an
implementation review and negative tests; they are not supplied by this
dispatch-only controller. If those exact independent bindings cannot be
established with available tools, the manual dispatch dependency remains.
No push-trigger capture workflow or provider execution is enabled by this plan.

## Prepared artifact-only offline CI

The local preview definition is `.github/workflows/price-pilot-offline-preview.yml`.
It accepts only an explicitly admitted push to
`preview/four-symbol-price-pilot-offline`, or manual dispatch on that branch with
an exact SHA. It has no main/schedule/workflow-run trigger, no provider acquisition
path and only `contents: read` repository permission. The only remote output of
a future admitted run is its standard report artifact, retained for 14 days.
No branch push, workflow dispatch or service start was performed locally.

The harness builds the full existing backend/test dependency set with the tested
vendor/calendar pins. Its networked build phase contains dependency files only,
no application source, data or provider credentials. Official Python and Redis
images are resolved to immutable digests and recorded. The actual test container
and two disposable Redis servers run with **Docker network mode none**. Redis
uses `--port 0` and job-owned Unix sockets; there is no external route or TCP
listener. The checkout is read-only and only test output/socket directories are
shared. This boundary also contains native curl_cffi calls; Python socket patches
alone would not suffice. Actual container configuration and loopback-only
interfaces are checked before the tests.

The proposed CI executes 26 adapter tests, 14 finite-admission tests and 66
real-Redis integration cases. The latter use actual `STRICT_RESERVE` Lua and
independent clients to test atomic reservations, circuit changes, cancellation,
wait limits, malformed/nonnumeric/nonfinite state and invalid intervals. Lua
validates all inputs and existing budget values before any SET. A separate
server test explicitly demonstrates that isolated Redis instances cannot prove
cross-job global budgeting. Required integration skips are a CI failure.
Ten additional portable harness/provenance tests check the exact GitHub
run/attempt/SHA/branch and the network-boundary validator.

Portable checks and exact commands are in
[the harness guide](../.github/scripts/price-pilot-offline-README.md). Locally the
40 adapter/admission tests passed, and the inert-configuration correction passes
ten harness tests; the 66 Redis cases have only been collected locally. The first
offline CI run installed the full dependencies and passed `pip check`, then
stopped at the required DATABASE_URL import before Redis/tests. Only the
disconnected test container now receives a credential-free `.invalid` database
URL, checked before and after import. **Actual Redis Lua/concurrency execution
and the complete corrected CI result remain pending.**
No local Redis installation was performed and mocked Redis results are not
reported as real Lua execution. Earlier ten pure history-integrity and 27
calendar/close checks also passed; the broader database test limitation remains
as recorded above.

Integrate this additive change onto the verified current main that includes
PR80's safety guards; do not replace main with this older research branch.
After offline CI and code review, actual acquisition still needs the complete
runtime, one exact finite capture workflow/run admission, genuine instrument
mapping evidence and reviewed provider isolation/budget scope. Neither an
offline green run nor job-local Redis approves capture or proves the requested
one-hour full-screening deadline.
