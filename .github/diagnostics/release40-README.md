# Read-only live-anchor cohort and quota measurement

## Immutable candidate and separate overlay

Candidate: `c2b90868d3c9e23b731172d1181345b795963f99`.
Tree: `6fbf30523ff84ad37b315bb760cecfde33af685e`.
This successor contains the saved forty-file candidate
`30a31d680e29059e8b74ad1b3e784e9010e1a489` plus four separately reviewed
pagination/telemetry repairs. All forty resulting file digests and the complete
candidate Git tree are checked before measurement. No candidate file is patched.

The eight files listed in `release40-config.json` form a separate diagnostic
commit, which must be a direct child of this exact successor. The workflow runs
only on a push to `diagnostic/release40-live-anchor-20261010`. Private preparation
does not itself authorize a remote save or run; independent review and the
parent's publication decision are required. No change to main or release merge
is performed by the diagnostic. A rerun is a fresh measurement.

## Fresh production anchor prefix

Each cold and warm process performs these steps at runtime, then repeats the
anchor proof after the history read:

1. Fetch the current public `publication.json` and `static-data/manifest.json`
   from the production bootstrap's exact site. These GETs carry no GitHub token,
   cookies or browser credentials. Redirects are rejected, cache is bypassed,
   each request has a ten-second deadline, and bodies are bounded to the production
   receipt limit (4 MiB) and 1 MiB for the manifest.
2. Run the unchanged production `parsePublicationReceipt`, `validateReceipt`
   and `dataChronology` checks. Require the receipt's raw-manifest digest and
   US as-of date to match the fresh manifest.
3. Obtain the exact referenced run attempt and all its jobs using the unchanged
   bounded GitHub transport. Validate run/repository/main-branch/publisher path,
   controller SHA, successful terminal state and job identities. The unchanged
   production `deploymentAnchor` chooses the successful Pages deployment's
   timestamp. There is no user-provided, cached or manually selected cutoff.
4. Pass that anchor to unchanged production `latestDeployment`, using a fresh,
   complete repository snapshot and exact workflow projections. Require its
   latest deployment identity to equal the receipt. Re-fetch and revalidate the
   anchor proof afterward. Receipt bytes, manifest bytes, run/deployment identity
   and job IDs must remain stable within and between both processes.

This is an explicitly labeled **production anchor prefix**, not a full
`livePublication` execution. It does not certify approval lineage, source
artifact retention, financial supersession, UI assets, or the complete public
price-observation validation. Those remain required by the real producer and
publisher pipeline. A successful prefix cannot authorize publication.

Missing, malformed, changed, inconsistent or unverifiable receipts fail closed.
Production has a separate legacy-bootstrap path, but this diagnostic does not
silently use it without its full legacy validation. The documented fallback is
no live-anchor acceptance: retain the rejection and, if desired, use the separate
already-reviewed default-cutoff diagnostic as a conservative measurement. Never
narrow a cohort to fit the budget. There is no frozen receipt or date fallback.

## Complete cohort and real cold/warm history

Every matching main-branch publisher and Static run at or after the derived
anchor, including failed runs and earlier attempts' jobs, is retained. More than
192 candidate runs fails before any history job reads because each run requires
at least one page. Actual multi-page weight is then measured. Weight above 192,
more than two foreign-active pages, or more than one own page fails closed.
There is no slicing, sampling, truncation or historical hard-coded cohort size.

The unchanged synchronous reader calls the unchanged native worker. The adapter
adds the same 200-start maximum that the production finite controller supplies;
production schema, identity, pagination, 304 and cache integrity checks remain.
Cold and warm run in separate Node processes in one genuine Actions job using
its automatic token and authenticated job-local disk cache. Fresh snapshot
membership, attempt, full identity and page-weight digests must agree.

Cache context binds the real diagnostic run, attempt and job, candidate SHA/tree,
reader version and request/event digests, with role `diagnostic`. It does not
register or impersonate a source or publisher role. Cleanup uses the production
authenticated cache API. A killed process or absent report never counts as a pass.

## Actual quota observations and separate windows

No fresh-5000 allowance is assumed. Initial actual remaining must cover 498
modeled owned starts plus the unchanged 228 reserve, or 726. Bounds are two
40-page repository snapshots, two 200-start history reads, and at most 18 CLI
starts: six job/own-run boundary reads and twelve fresh anchor-proof reads.
There are also at most eight bounded unauthenticated public-site GETs. Public
GETs are counted separately and are not GitHub REST quota observations.

Each response contributes only allowlisted actual `core` quota values. Native
snapshot fetches are pass-through observations of genuine responses, retaining
resource, limit, used, remaining and reset without replacing production parsing.
Missing or contradictory headers reject acceptance. CLI and native observations
are preserved separately, including differing reset epochs. They are never
combined into an invented common allowance or replenished from a later high
sample. If actual windows differ, budget acceptance remains false.

The report distinguishes `measured_cohort_accepted`, `budgetAccepted` (also
requiring both original source/publisher allocations to fit the conservative
observed window), and `whole_release_certified: false`. All owned starts are
conservatively deducted from earlier comparable quota balances. One modeled unit
per CLI start is sample accounting, **not a proven bound on the CLI's internal
wire requests or primary consumption**. Shared token balance changes are not
claimed to be exclusively attributable consumption. Missing elapsed time is
reported as null, never as measured zero. Bytes are decoded representations,
not compressed wire bytes.

The previous default-cutoff run observed distinct CLI/native reset epochs. This
diagnostic retains that strict distinction rather than weakening acceptance to
obtain a passing result. Even a positive result is only this measured cohort and
conservative window fit, not whole-path certification or deployment approval.

## Permissions, privacy and execution limits

Only `contents: read` and `actions: read` are requested. The existing automatic
Actions token is supplied only to the measurement step. No credential is created,
persisted, broadened, configured or logged; checkouts disable credential
persistence. No Pages writes, releases, brokers or external provider APIs run.

Only summary/cold/warm sanitized JSON files are uploaded for three days. These
contain allowlisted numbers, hashes, cohort/run identities, status and quota.
No raw public receipt, manifest, API bodies, arbitrary job names, request headers,
Authorization, cookies, raw ETags, cache, token hashes or stderr are uploaded.
Artifacts are normal Actions results, not a repository or Pages publication.

Bounds: 23-minute job, nine-minute token-free contracts, eleven-minute measurement
step, 600-second enclosing process, 260-second child, 30-second repository
snapshot, 120-second history worker, 1 MiB phase reports and 32 MiB cache. Inventory
concurrency is at most three; history is serial with production 200 ms spacing.
There are no diagnostic retries, waits for quota reset, or token changes.

## Private contracts

With Node 22.23.3 and no real token:

`RELEASE40_CANDIDATE_ROOT=/path/to/repaired-candidate node --test .github/diagnostics/release40-budget.test.mjs`

The integration fixture intercepts every native fetch and CLI route in parent
and child processes; unexpected routes throw without reaching the network. It
exercises genuine production receipt/anchor selection, cold 200, separate-process
warm 304, authenticated cache and cleanup. Negative cases cover absent/duplicate
receipts, bad manifests, foreign identities, missing deployment, changing anchor,
oversized weight, quota gaps/reset mismatch, changed cohort, expiry and warm misses.
