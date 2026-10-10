# Read-only measurement for the saved 40-file candidate

Prepared overlay only. It has not been pushed, dispatched, or run against GitHub.

## Exact target and publication boundary

Candidate: `30a31d680e29059e8b74ad1b3e784e9010e1a489`.
Tree: `365a32816ad7750ce9a26f1eabec20043f8d3181`.
Base: `2e289c42c00e0d0bad05263ab8273a257dc0ae8e`.

The seven files listed in `release40-config.json` are a separate diagnostic
overlay, not part of the approved forty source files. The proposed diagnostic
commit must be a direct child of the saved candidate and change only these seven
files. The candidate is checked out separately at its immutable SHA, and all
forty approved file digests and the complete Git tree are verified before API
measurement. No candidate source is patched.

The workflow runs only on a push to
`diagnostic/release40-cohort-quota-20261010`. Preparing these files does not
authorize that push. Independent review and the parent's publication decision
are required before creating the branch or commit remotely. It does not require
dispatch support or adding a workflow to main. A new push or rerun is a new
measurement with fresh observations, not an assertion that prior results apply.

## What is actually exercised

- The pinned production `latestDeployment` function selects the cohort from a
  fresh, complete, unfiltered repository snapshot and its exact workflow
  projections. Its default cutoff is **2026-10-03T01:12:40Z**. No live-anchor
  receipt is fabricated or supplied. This conservative default cohort is not
  claimed to equal a producer's narrower, verified live-anchor cohort.
- Every matching main-branch publisher and Static run, including failed runs and
  earlier attempts' jobs, is retained. A cohort above 192 runs fails before job
  reads. Page weight is then measured, rather than equated to run count. Full
  weight above 192 or more than two foreign-active pages fails closed. No slicing,
  sampling, invented 171-run baseline, or truncation can produce acceptance.
- The unchanged production synchronous reader invokes the unchanged production
  native worker. The diagnostic adapter supplies the same finite 200-request cap
  used by the production controller. All normal schema, pagination, scope,
  cache-integrity and conditional-304 checks remain in that reader and worker.
- Cold and warm are separate Node processes in the same genuine Actions job,
  using the same automatic Actions token and authenticated job-local disk cache.
  Each process obtains a new full repository snapshot at the same cutoff. Run
  membership, attempt, full run identity and page-weight digests must agree.
  A changed cohort is reported as not accepted, not silently made comparable.
- Cache context uses the real diagnostic run/attempt/job and the pinned candidate
  code SHA/tree, with role `diagnostic`. It grants no producer or publisher
  registration. The actual production finite controller is not bypassed or
  impersonated: it is deliberately not registered in this diagnostic job.
- Two additional bounded GETs inspect the first catalogue page for
  `research-ui-release.yml` and `static-site.yml`. They do not follow pagination.
  Their purpose is to establish the actual Link route aliases involved in the
  candidate's observed `unapproved-github-route` failure. Only same-repository,
  expected-workflow GitHub origin/path and allowlisted branch/page/per-page query
  values are retained. Unknown or data-bearing links fail closed without logging
  their raw text. The seven diagnostic files do not repair the candidate.

## Quota and result semantics

Every reported quota comes from an actual response. The first required-run GET
must have at least 716 remaining: an intentionally conservative ceiling of 488
owned starts plus a 228 reserve. There are at most two 40-page snapshots, two
200-start history passes and eight CLI reads, including the two route probes.
Each route probe has a 15-second and 8 MiB response limit. Native inventory has at most three
requests in flight; history is the production serial worker with 200 ms spacing.
There are no diagnostic retries, sleeps until quota reset, token changes, or
fresh-5000 assumptions. A denial or missing header fails closed.

The summary separates:

- `measured_cohort_accepted`: complete stable cold/warm cohort, production page
  and active limits, one nonexpired observed quota window, and warm terminal
  misses within the unchanged 16-page pool.
- `budgetAccepted`: the above plus a conservative actual-window fit for both
  source and publisher original allocations from the pinned policy. For safety,
  all owned starts are subtracted from every earlier comparable quota sample;
  a later high regional sample cannot replenish a lower observation. This may
  understate available quota. Native snapshot headers also lower the balance;
  an injected pass-through fetch observer collects the actual `core` resource,
  quota arithmetic and window without replacing the production snapshot parser.
- `whole_release_certified: false`: the full producer/publisher lifecycle, role
  registration, future phases and live production opener are not executed here.
  A positive diagnostic result is not deployment approval. A 1000-limit Actions
  token cannot satisfy the candidate's 4937 source allocation.

CLI starts and native observations are counted separately from unknowable CLI
internal wire requests. Shared quota-header changes are never labeled exclusive
consumption. One modeled quota-debt unit per CLI start is conservative sample
accounting, not a claim of bounded internal CLI wire or primary consumption.
The last probe's real balance is checked again before the snapshot/history work.
Snapshot and history bytes are decoded representation bytes, not
compressed wire bytes.

## Permissions, data and bounds

Only `contents: read` and `actions: read` are requested. Authentication is the
existing automatic Actions job token supplied to the single measurement step.
No credential is generated, saved, broadened, configured or logged. No secrets,
provider APIs, broker, release creation, Pages publication, or production writes
are used. Checkouts use `persist-credentials: false`.

The three uploaded JSON files contain explicit allowlisted numbers, hashes,
cohort identities, statuses and quota headers. No raw API bodies, arbitrary job
names, ETags, request headers, authorization, cookies, token hashes, cache state,
or stderr are uploaded. The cache is removed using the production authenticated
cleanup API. Artifacts expire after three days. GitHub artifact upload is the
normal workflow-results channel, not a repository or Pages write.

Bounds: 20-minute job, 9-minute offline tests, 8-minute measurement step,
420-second enclosing process, 190-second child, 30-second snapshot,
120-second history, 1 MiB per phase report, 32 MiB production cache. A killed
process or missing report is a failure, never a successful measurement.

## Private checks

Run with Node 22.23.3 and no real API token:

`RELEASE40_CANDIDATE_ROOT=/path/to/candidate node --test .github/diagnostics/release40-budget.test.mjs`

The integration fixture overrides all fetches in the parent and child processes;
unexpected routes throw instead of reaching the network. It exercises a genuine
cold-200 / separate-process warm-304 sequence through the production modules,
complete selector, authenticated persistent cache and cleanup. The other tests
cover oversized cohorts, actual page weight, real low quota, changed membership,
reset mismatch, expiration, excess terminal misses and sensitive-header removal.
