# Retained-archive lifecycle integration

This opt-in test uses the original reviewed source, certificate, predecessor and
captured diagnostic ZIPs. Both raw v1 and packed v2 captures are supported. It
preserves the full 5,901-row acquisition base and
replays the current baseline with the captured production code. It does not
replace the production trust registry or fetch provider data.

The GitHub CI/Design/deployment responses are **synthetic transport evidence**.
The diagnostic is unapproved fixture material. Passing this test does
not establish that its real Design job passed and does not authorize publishing
it. Control pins and publication receipts exist only inside the disposable test
clone. Never upload the clone, candidate ZIPs, Pages dist or control files as
accepted release artifacts.

## Inputs and runner

- Use a dedicated Linux runner with Node 22, Python 3, Git, GNU tar and sha256sum.
- Install the existing `.github/scripts/financial-release-projection-requirements.txt`.
  The exporter does not require npm install or a browser for this integration.
- Checkout with full Git history, including the diagnostic receipt's literal
  captured commit and exact tree. The helper checks out that commit before
  exercising the publisher; changing the surrounding test branch cannot change
  the captured controller.
- Packed captures require the controller's single-pass
  `verifyCandidateTransport(..., {restore})` interface. Never patch a retained
  captured checkout to add it; take a new capture after integration.
- Reserve at least 16 GiB free scratch space after materializing the original
  inputs. The helper streams diagnostic extraction. It exercises production
  sealing with its uncompressed TAR, then gzip-wraps those exact TAR bytes for
  the offline transport. The report records each original TAR size and hash.
  For a packed capture, the TAR contains the original packed corrected tree and
  `transport.json`; its v2 record seals that file's exact hash. Outer gzip is only
  a scratch-space optimization and is distinct from the production lossless
  transport. Authenticated logical trees also need space during verification.
- Give the workflow only `contents: read` and `actions: read`. There is no Pages
  permission, provider credential, deployment step or publication trigger.

Create an input JSON file with the schema in
`financial-release-archive-input.example.json`, using absolute local paths and a
new scratch directory. The example pins the reviewed October 5 diagnostic and
all three original ZIP hashes; do not silently substitute another artifact.
That original diagnostic captures commit `e253d22762c1dd79eb4b35851f94dd142903e628`
and tree `351f5e3ea64606f1e28df284a840bd0e56856069`. Run
[37269230373](https://github.com/kusennjp1-ai/screener/actions/runs/37269230373)
verified its complete input inventory and baseline, then reproduced the selector's
unsettled top-level-await failure before activation. It is a retained failing
reproduction, not a passing lifecycle receipt. A fixed-controller rehearsal
requires a newly captured diagnostic with matching protected-source inventory
and separately recorded ZIP hash; never patch the old captured files or claim
that a new test branch changes their code.
`predecessor_root` must contain the exact extracted predecessor TAR. Input
materialization belongs to the workflow; the test never downloads these files.

```sh
python3 -m pip install -r .github/scripts/financial-release-projection-requirements.txt
git cat-file -e e253d22762c1dd79eb4b35851f94dd142903e628^{tree}
FINANCIAL_RELEASE_ARCHIVE_INPUT="$RUNNER_TEMP/financial-release-input.json" \
  node --test --test-concurrency=1 .github/scripts/financial-release-archive-lifecycle.test.mjs
```

The diagnostic runner keeps its existing external 75-minute maximum and
90-minute CI job bound. `FINANCIAL_RELEASE_ARCHIVE_WATCHDOG_SECONDS` aligns the
cooperative Node test timer with the supervisor's effective allocation and may
not exceed 4,500 seconds; without the supervisor it retains the 1,800-second
default. Do not raise either bound to make packed replay pass. Use the existing
monotonic supervisor, early job clock, remaining-budget cap and upload reserve
from the dedicated diagnostic workflow. Its supervisor records phase/command
starts before synchronous work, bounded failure output, monotonic durations and
stationary-phase heartbeats. These controls do not alter financial clocks.
For example:

```sh
FINANCIAL_RELEASE_ARCHIVE_INPUT="$RUNNER_TEMP/financial-release-input.json" \
  python3 .github/scripts/financial-lifecycle-watchdog.py \
  --timeout-seconds 4500 \
  --allocation-reason 'Retained packed-input rehearsal; existing runtime limits unchanged.' \
  --job-clock "$RUNNER_TEMP/financial-release-job-clock.json" \
  --job-timeout-seconds 5400 --upload-reserve-seconds 600 \
  --minimum-runtime-seconds 3600 \
  --report-directory "$RUNNER_TEMP/financial-release-archive-lifecycle" \
  -- node --test --test-concurrency=1 .github/scripts/financial-release-archive-lifecycle.test.mjs
```

The diagnostic workflow is deliberately unbound: the checked-in
`financial-release-archive-capture.json` has `capture: null`. Before publishing a
rehearsal branch, replace it with the independently verified diagnostic
`artifact_id`, `archive_bytes`, `archive_sha256`, `ui_sha` and `ui_tree`. The guard
rejects missing or malformed bindings before dependencies or downloads. No real
artifact ID or captured revision is inferred from the running Design job.

The workflow explicitly fetches that exact captured SHA, verifies its tree and
then places both identities in the input manifest for comparison with the
actual preview receipt. `fetch-depth: 0` alone does not guarantee the presence
of a pull-request merge object. Read-only permissions and
`persist-credentials: false` remain in place. The public repository uses plain
`git fetch --no-tags origin "$CAPTURED_SHA"`; artifact API reads retain the existing
read-only job token.

Create the job clock before checkout, dependency setup and materialization. The
report directory must equal `directory` in the input JSON. Archive hashes must
come from separately verified retained inputs. A new packed diagnostic needs its
own artifact ID, ZIP hash, literal captured SHA/tree and protected-source
inventory; keep the reviewed source/certificate/predecessor hashes unchanged.
The historical example is deliberately not silently rebound to a new capture.

For a bounded input preflight, use a separate new scratch directory and run:

```sh
node --input-type=module - "$RUNNER_TEMP/financial-release-input.json" <<'JS'
import {runArchiveLifecycle} from './.github/scripts/fixtures/financial-release-archive-lifecycle.mjs';
await runArchiveLifecycle(process.argv[2], {preflightOnly:true});
JS
```

This verifies the four ZIP hashes, source/certificate/predecessor bindings,
captured checkout/protected code, physical transport, original logical UI/data
inventory and logical price observations, then stops before baseline replay or
synthetic activation. It records `outcome: "preflight-only"`. A passing preflight
cannot substitute for activation/carry completion. Use another new directory for
the full run.

Packed input preflight performs one authenticated full decode, checks physical
fingerprints before and after, then removes its logical scratch tree. Activation
and final carry each get one separate authenticated logical tree for fixture
assertions; the activation tree is moved directly into synthetic next-price
preparation. There is no cross-stage verification cache. Production CLI rechecks
remain unchanged. Measure these costs on retained inputs before admitting a full
run; their time counts toward the same outer deadline.
Without `FINANCIAL_RELEASE_ARCHIVE_INPUT`, this integration is explicitly skipped.
The fast synthetic carry regression runs separately with:

```sh
node --test .github/scripts/financial-release-lifecycle.test.mjs
```

## What executes

1. Verify every outer input hash and the diagnostic's transport seals, original
   logical UI/data inventory and unchanged logical price observations. Raw
   candidates keep v1 records; packed candidates use v2 plus `transport_sha256`.
2. Recreate and hash-check the exact captured baseline from the actual predecessor.
3. Run successful production sealing for original/current synthetic Design
   artifacts with unchanged protected code, real preview/projection/source bytes
   and explicit local-only pins, then compress the sealed TAR transport.
4. Invoke the production activation `plan`, `restore`, `compose`, pre-upload
   `recheck`, pre-deploy `recheck`, and normal `livePublication` reader. Authenticate
   the resulting packed publication before applying logical financial assertions;
   keep the physical publication as the simulated live endpoint.
5. Release only generated candidate staging. Preserve original inputs.
6. Prepare an explicitly synthetic next-price feed for the full current universe
   by appending an observation at each existing chart's unchanged final price.
   The market date `2026-10-05` and evaluation clock exactly 24 hours after the
   captured evaluation are artificial fixture inputs. This is not a provider
   fetch or evidence that any real later market observation occurred. Prior bars
   and original source receipts are preserved. The fixture also advances only
   `financial-history.json.as_of_date`, its containing analysis-date header,
   before the ordinary export; all nested history values and source timestamps
   remain unchanged. This preserves the strict production metadata comparison.
7. Invoke the production advancing plan/restore/prepare-carry/export/history/
   compose/recheck/recheck/live-reader flow against the just-activated lineage.
8. Authenticate final carried logical bytes and check the original source
   projection/base/lineage, unchanged source receipt timestamps and proof tuples,
   advanced NVDA and every canonical target chart date, full target symbol universe
   and retained historical snapshots. Only the carry's declared evaluation clock
   advances; source and proof clocks are not refreshed.

The scratch directory retains `report.json`, phase logs, `trace.jsonl` and
`last-failure.json` on failure. Publish only these diagnostics if needed, under
an explicitly **unapproved test report** artifact name. A skipped, incomplete or
failed run must never be reported as a successful activation integration. A
complete report has `outcome: "activation-and-synthetic-next-price-carry-passed"`.
Even that outcome grants no real CI/Design approval, performance exception,
activation intent, publication permission or deployment authority.

## Reconciled successful-run fixes

The history-header repair and watchdog were recovered from the exact source of
successful retained-input run 37321769815, commit
[`f661299`](https://github.com/kusennjp1-ai/screener/commit/f661299ec14b2a115b8e77984bf560784bcfaf7b).
The bounded history regression first reproduces the stale-header compose failure,
then exercises the repaired fixture through compose and both rechecks, including
rejection of changed source clocks, removed-symbol history and protected derived
metadata. The watchdog tests include host-uptime-independent clock fixtures and
the invalid pre-boot-clock rejection. Packed lifecycle/controller selection
options remain available alongside those historical repairs.

```sh
node --test --test-concurrency=1 \
  .github/scripts/financial-carry-history-date.test.mjs \
  .github/scripts/financial-lifecycle-watchdog.test.mjs \
  .github/scripts/static-transport-carry.test.mjs \
  .github/scripts/financial-release-archive-lifecycle.test.mjs
```
