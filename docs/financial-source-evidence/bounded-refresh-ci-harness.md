# Isolated retained-source CI validation

This additive harness validates the disabled source delta from `d3f5134` on
Python 3.11 and Node 22. Its exact push trigger is
`preview/bounded-statement-refresh-ci`; the existing recovery trigger remains
`improve/mandatory-financial-source-recovery`. No existing production file is
changed. The source branch is older than publication main, so this review tree
must not replace main.

The workflow has only `contents: read` and `actions: read`, does not retain
checkout credentials, uses explicit Bash pipefail, and has no schedule, Pages
step, custom secret, provider dispatch or admission update. Only the historical
artifact-read step receives the built-in read-scoped GitHub token. No new
workflow_dispatch endpoint is assumed: an owner-reviewed push to this exact
review branch would start the uniquely named test workflow. No remote push or
run has been performed during local preparation.

## Restore authority boundary

The production restore CLI intentionally rejects this review branch and test
workflow. That restriction is unchanged and has a negative regression test.
The separate CI-only reader does not impersonate a current recovery run. It
checks the actual CI caller's API identity, repository IDs, branch, workflow,
event, head, attempt and in-progress state, plus frozen main `8a490df5`.

It reads only the reviewed source run 37203329163, attempt 8, artifact 11307162746,
from source head `4b27798b9b04528737938bb5844a8d86a704c58d`. The reviewed envelope
and false/null admission are byte-pinned. Source run/job identity and clocks,
complete inventories, terminal predecessor, absence of any nonterminal recovery,
artifact identity/size/digest and repository/attempt interval must all pass.
Existing production `checkedArtifact` and `extractSourceArchive` checks are
reused without an override. Downloaded ZIP bytes must equal the original
27,524,165-byte artifact and SHA-256
`c4b07d50e357fb556fda62c419f0d549a1a7e62fd62dccd3a501d4d563939dbb`.
Missing, changed, expired, stale or concurrent inputs fail closed.

## Offline replay and outputs

The workflow runs the existing 234 Python and 22 Node tests, then the additional
12 Python deny-route tests and six Node CI-reader tests. After the authorized
GitHub restore, the Python replay denies provider construction, socket connect
and DNS, native curl, requests sessions and subprocess launch. It records any
denied attempt; even a swallowed denial fails the final validation. These are
instrumented routes used by the reviewed code, not a claim of OS-level network
namespace isolation.

The unchanged bridge prepares the exact original inputs/cache and invokes the
runner with `dry_run=True`. It then explicitly exercises retention capacity,
forced pre-merge byte verification, exact unchanged archive/cycle bindings,
canonical ZIP readback and the final physical inventory comparison. The source
manifest, base/cohort bytes and all original observation clocks remain intact.
There must be 1,894 cohort members, 1,891 applicable symbols, 200 selected symbols,
400 original selected receipts, false/null admission and no acquisition batch.

Only reports are uploaded as
`bounded-refresh-validation-<CI head SHA>-<attempt>` with 14-day retention:

- Runtime versions and the original/additional test logs; Python JUnit results
- `source-api-evidence.json`, labeled test evidence with no publication authority
- `validation-report.json`, including exact source hashes, zero denied acquisition
  attempts, completed/unpublished dry-run cycle, capacity and ZIP-readback metrics

The retained source ZIP, extracted archive, selected receipt cache and generated
dry-run data are excluded from upload. A newly generated canonical ZIP digest is
reported, not compared to a historical ZIP digest, because file timestamps and
the CI code revision can differ. Original source/input digests remain exact.

## Local verification and limits

Locally, all 246 Python and 28 Node tests passed. The full retained-source wrapper
passed in 157.76 seconds with no attempted provider/network/process calls and
unchanged source/cache hashes. It wrote and read back a 28,099,993-byte canonical
ZIP. Python 3.11 syntax parsing also passed; the local executable was Python
3.12.14 and Node 24, so this is not remote CI evidence for the target runtimes.

The actual finite review clock remains enforced: replay must start by
2026-10-07T10:21:54.945Z, and setup must leave room under the existing 25-minute
job / 420-second finalization reserve. No historical-clock override was added.
Source or main changes, artifact expiry, and clock expiry are explicit blockers;
they do not authorize another source, fresh acquisition or automatic retry.
An owner-reviewed public push/run and artifact readback remain outstanding.
