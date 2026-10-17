# Bounded artifact-only financial recovery

This repair does not activate acquisition. It preserves the exact consumed
run-5 `request.json`; a code-only commit does not match the workflow's activation
path filter. Do not delete that request or rerun its workflow.
The original recovery branch, workflow identity, read-only token permissions,
non-cancelling global serial group, pinned free transport and 25-minute job cap
are preserved. The expired first-200 request/admission is not consulted.

## Separate review before activation

1. Save and review this controller as one code-only child of the existing recovery
   head `afba716470995a59c41043f982e1c09f987b1c53`. Never replace that
   branch with a PR99 UI tree. Run the offline caller/collector/archive/planner/
   retention tests. No provider call is needed for this review.
2. Re-read the complete recovery inventory. The only supported continuation is
   run 6 -> exact pre-provider abort `38991458566/1` (run 5) -> retained source
   `37478731832/1` (run 4), artifact `11420873789`. Run 5 failed before its only
   provider-child call; its pinned complete job log, immutable head/request,
   exact terminal attempt/job/steps and empty artifact inventory must all agree.
   Empty artifacts or an arbitrary failure alone never permit skipping a run.
   Run 4 also failed, although its cycle and original receipts were retained.
   Any rerun, intervening/newer execution, changed proof, missing original source
   or blocked provider stops. There is no recursive skip or cold fallback.
3. Re-authenticate the currently selectable ordinary price export. The template
   records run `38835669174/1`, artifact `12024303013`, and its checked companion.
   `research_sha256` comes from the companion-bound manifest's
   `research_generation`; execution must also verify the actual research bytes.
   These recorded identities are evidence to recheck, not a claim they stay
   current. A changed source or live publication boundary stops execution.
4. Create a **new** finite request from the template after the source decision
   is reviewed. Fill a unique lowercase operation ID, actual current UTC
   creation/expiry (at most two hours), the exact saved controller commit/tree,
   and the freshly verified next workflow run number. Never retime an old
   request or reuse the preflight/first-200 intent. Do not alter target receipts,
   hold states or limits to make a request pass.
5. Review and save a single child commit that **only modifies** `request.json`
   with the new closed v2 request. The repair parent must retain the exact old
   request bytes and have the aborted activation as its sole parent.
   This push is the consequential acquisition activation. It must be separately
   authorized. The caller checks its exact clean checkout, single parent/tree,
   replacement-only diff, genuine in-progress push run and attempt 1, expected run
   number, unique run for that head, current branch head and serial predecessor.
   Any run/rerun consumes this activation; a failure is not retry permission.

No new activation request is supplied by this repair. The v2 template deliberately
has missing current clocks/controller identity and cannot execute. Missing controls
fail closed. The old v1 ordinary predecessor path still rejects absent artifacts.

## Existing publication-verifier compatibility

Run 5's inherited verifier only understood bootstrap/gates approvals and rejected
the already published `performance-exception-v2` receipt. The repair fetches the
existing main verifier from exact commit
`8cf7d9b231a5926696d261da51a4bab531f33cfa`, tree
`82d9278408ebdb927a5124453d5c004ebf0306b8`, into a new temporary checkout outside
the controller. Commit/tree and clean tracked/untracked status are checked before
import and around every invocation. Fetch is finite (120 seconds), read-only and
uses the public repository without adding credentials. Setup consumes the existing
job budget. A missing, dirty or different verifier has no alternate fallback.

All live-publication reads use that verifier's existing complete performance
certificate, financial-lineage, deployment, byte and chronology checks. Recognizing
the receipt type is not acceptance by itself. This repair adds no approval type,
new financial authority or exemption from those checks.

## Acquisition and retention bounds

The current canonical price base preserves all original 1,894 cohort symbols
and their order. Full archive planning still uses the existing 200-symbol
planner. Only NVDA and AAOI's independently due, unblocked EPS, sales and annual
requirements are filtered from that complete queue, preserving queue order.
Every getter is bound to the exact prior successful receipt and attempt journal.
FUTU, ALH and AVT annual holds remain untouched and need separate receipt-bound
review; this operation cannot make all Design fresh cases pass.

Maximum two symbols, four statement getters, 1,080 acquisition seconds, 1,000
transport requests, zero caller retries. Setup is charged to the real 25-minute
job clock, reserving 420 seconds for finalization/upload. After expensive full-archive preparation, a one-shot pipe asks the parent for
a new real GitHub recheck. The provider child never receives the GitHub token.
The parent rechecks the original immutable request and remote source identities;
it does not rewrite the request creation/expiry or initial invocation. The new
provider invocation is retained before the unchanged retention inventory. Its
authentication must be at most 120 seconds old before collection, and the new
request must cover the whole remaining acquisition allowance. Existing 403/429/provider stops, due/hold
checks and retention byte/ZIP budgets remain active at provider boundaries.

The full source archive is copied, never narrowed. Original base/cohort/cycle,
new current inputs, request, invocation, original receipt bindings and new
attempts are retained. The archive writer's empty `.archive.lock` is owned
before the unchanged retention inventory (Actions may omit hidden files).
The guard still rejects unowned additions and changed original bytes. Actual
uploaded ZIP readback is required after execution; local ZIP verification does
not authenticate the future Actions artifact.

A completed or partial artifact is acquisition evidence only. It creates no
financial admission, activation, renewal, publication receipt or security grant.
Existing financial-generation and Design fresh-case/publication gates still
apply. Do not treat an available/new receipt as evidence of sufficient annual
period coverage, or a completed source cycle as a successful workflow.
