# Disabled finite push route for the four-symbol pilot

This local implementation prepares a route that does not require an interactive
`workflow_dispatch`. It has not collected provider data. The committed policy is
disabled, capture approval is false, and all price identity reviews remain
pending. The offline preview and the finite capture workflow have different
paths and branches. Uploading the offline preview cannot start this pilot.

## Exact review and two pushes

The repository is `kusennjp1-ai/screener`, immutable repository ID `1203919607`.
The sole capture branch is `capture/four-symbol-price-pilot`. The workflow is
`.github/workflows/four-symbol-price-push.yml`; permissions are only
`contents: read` and `actions: read`. Artifact upload uses the ordinary Actions
artifact mechanism. There is no Git ref, release, source pointer, database,
financial queue, or website publication write.

1. Review the full final source commit **C**, including the source policy,
   workflow, bounds, and tests. A future enabled C requires separate acquisition
   review. Push only that exact C to the capture branch after authorization.
   C must contain no `.github/price-pilot-intent.json`. Its first run, attempt 1,
   registers the source and skips acquisition. This run emits a small immutable
   `price-pilot-source-RUN_ID-1` artifact. A disabled source can register, but its
   receipt cannot authorize a later acquisition.
2. Read back the completed source run, all jobs, and the exact artifact ID and
   SHA-256. Construct and separately review canonical **R** bytes using C's
   template. Only controller/source-registration references and explicitly
   reviewed capture, identity, finite-run, and budget states can differ. The
   four instruments, official mappings, date envelope, proposal hash, and
   retained prior-release identity cannot change.
3. Run the offline preparer with the explicit reviewed C and R digest. It emits
   a specification, not permission. The owner must review the exact resulting
   activation **I** before its push: I's only parent is C, its only change is
   adding `.github/price-pilot-intent.json`, and its message binds C and R's hash.
   No commit is pushed by the preparer. A normal connector branch push can send
   the reviewed I; no workflow-dispatch API or new credential is needed.
4. Acquisition is allowed only in workflow run 2, attempt 1. Runtime verification
   requires exactly the successful unarmed registration run and current run in
   complete history. It checks repository, workflow ID/path, branch, producer
   run/attempt/head, current job/runner/step, and the immutable registration ZIP.
   The receipt and artifact must lie inside the exact registration job/run
   interval and be at most two hours old. The branch must still point to I.
   Acquisition executes a clean checkout of C; the Actions event/head remains I.

The run/attempt history is the durable one-shot boundary. Cancellation, denial,
uncertain completion, rerun, extra push, missing predecessor, or stale proof
consumes the admission. A fresh process, output directory, or Redis instance
cannot make another run eligible. A fixed, exclusive, fsynced runner marker also
prevents a second process inside the same live job. Missing terminal artifacts
never grant a retry. No writable journal branch is introduced.

The commit-message hash and source receipt provide integrity and provenance.
They do not prove human approval. The operator's exact C/R/I review and approved
push remain the external authorization boundary. A workflow writer could replace
the entire workflow; this mechanism does not grant arbitrary repository heads
authority merely because they supply `GITHUB_SHA` or create an approval JSON.

## Offline preparation command

Run from the repository with caller-supplied, separately reviewed values:

```sh
PYTHONPATH=backend python -m app.scripts.price_pilot_push prepare \
  --source-commit "$REVIEWED_SOURCE_COMMIT" \
  --intent "$REVIEWED_INTENT_FILE" \
  --reviewed-intent-sha256 "$REVIEWED_INTENT_SHA256" \
  --output "$NEW_PUSH_SPEC_FILE"
```

This command fails with the checked-in disabled policy and pending template.
It never enables policy, rewrites intent, chooses an arbitrary current head,
creates an activation commit, or performs a remote write.

## Preserved collection and retention limits

The adapter remains fixed to ET/SUN/DDS and EQR's documented continuation VMRK,
with the October 5, 2026 closing session and actual October 6 UTC retrieval.
October 6 intraday bars cannot enter history. After October 6's close this is a
historical catch-up, not the latest completed session or evidence of a past
close-plus-one-hour result. Passing midnight UTC fails the current pilot; a later
retrieval date requires a newly reviewed proposal, source, and finite admission.

The ten aggregate provider HTTP requests include yfinance helpers, with five
minutes maximum acquisition, immediate denial/transport stop, no hidden retry,
redirect, or alternate provider. Redis coordinates this isolated job only; no
cross-job global provider budget is claimed. Approval must explicitly accept
that isolation scope. The existing Static Site workflow still disables Redis
and is not a runnable environment for this pilot.

The retained input is immutable artifact `11421722413`,
`github-pages-37456692717-1`, 363,691,194 bytes, from run `37456692717`, source
`8a490df5b0a873637781a8e4e5351cece9313f37`, ZIP SHA-256
`1ab2594be91d3bbc8716481c730a9afdf22eb4ca554fcd5d02770b92252de4eb`.
Its archive is streamed locally with a 384 MiB/180-second ceiling, hash checked,
and never re-uploaded. Registration evidence is capped at 256 KiB/30 seconds.
Provider proof output remains below 38 MiB, retained for 14 days. The receipt
and input staging files are separate from provider proof output.

Pending identity may permit only quarantined raw capture after separate capture
approval; it cannot admit observations or splice histories. ET/SUN/DDS require
the exact retained overlap and issuer/class/venue checks. VMRK has no EQR chart
to splice. No fabricated bars, financial identity reassignment, automatic
refetch after mismatches, or source promotion is added.

## Validation and integration boundary

Synthetic tests cover scope mutation, wrong branch/head/repository, parent and
extra-file changes, stale/source-mismatched registration, exact job identity,
retried/cancelled/uncertain history, bounded artifact timeout, and workflow gates.
They join the existing adapter and actual Redis tests in the disconnected
offline preview. JUnit reporting preserves upstream declared counts and reports
actual emitted testcase elements separately.

The earlier successful offline preview proves its own frozen runtime and source,
not this later push route. This route still needs independent source review and
its own offline preview before any provider activation. Integration must retain
the already merged PR80/main source-promotion safeguards. The current local
branch does not change main or the daily source authority.
