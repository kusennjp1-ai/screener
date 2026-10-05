# Retained-archive lifecycle integration

This opt-in test uses the original reviewed source, certificate, predecessor and
captured diagnostic ZIPs. It preserves the full 5,901-row acquisition base and
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
- Reserve at least 16 GiB free scratch space after materializing the original
  inputs. The helper streams diagnostic extraction. It exercises production
  sealing with its uncompressed TAR, then gzip-wraps those exact TAR bytes for
  the offline transport. The report records each original TAR size and hash.
  Production packing is unchanged; its larger transport disk usage is not
  represented by the compressed fixture. Production activation restore still
  makes two full bundle copies.
- Give the workflow only `contents: read` and `actions: read`. There is no Pages
  permission, provider credential, deployment step or publication trigger.

Create an input JSON file with the schema in
`financial-release-archive-input.example.json`, using absolute local paths and a
new scratch directory. The example pins the October 5 diagnostic from run 37282323021 and
all three original ZIP hashes; do not silently substitute another artifact.
The previous diagnostic from run 37263438505 captures commit `e253d22762c1dd79eb4b35851f94dd142903e628`
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
  python3 .github/scripts/financial-lifecycle-watchdog.py \
    --timeout-seconds 4500 \
    --allocation-reason 'Test-only allocation: full retained-input run 37274346665 completed in 59m29s; UI performance budgets and validators are unchanged.' \
    --job-clock "$RUNNER_TEMP/financial-release-job-clock.json" \
    --job-timeout-seconds 5400 \
    --upload-reserve-seconds 600 \
    --minimum-runtime-seconds 3600 \
    --report-directory "$RUNNER_TEMP/financial-release-archive-lifecycle" \
    -- node --test --test-concurrency=1 .github/scripts/financial-release-archive-lifecycle.test.mjs
```

The watchdog defaults to 30 minutes. The dedicated rehearsal explicitly selects
75 minutes because full retained-input run `37274346665` completed in 59m29s:
activation passed, then carry failed its financial-identity assertion. The old
Node test timer did not interrupt synchronous work at 30 minutes. This measured
duration justifies the separate test-runtime allocation; every UI performance
budget, source check, trust rule and production assertion remains unchanged.
The chosen limit and measured reason are retained in `watchdog.json`. The
supervisor passes the same allocation to Node's cooperative test timer; the
external process remains responsible for actual deadline enforcement.

The first workflow step records a monotonic job clock before checkout, package
setup and input downloads. At test startup the supervisor caps the requested
75 minutes by the remaining 90-minute job budget minus an explicit 10-minute
artifact-upload reserve. If preparation leaves less than 60 useful test minutes
(rounded above the measured 59m29s rehearsal), it writes an
`insufficient_job_budget` record and exits 125 without launching the test.
The early clock, preparation elapsed time, requested/effective limits and reserve
are retained with the diagnostics. Do not recreate that clock immediately before
the test; doing so would erase preparation time from the budget.

The external watchdog enforces that whole-test allocation using a monotonic
clock, even while Node is blocked in synchronous work. It
creates a separate process session and stops only that test's process group,
then stops and reaps its adopted descendants, including detached sessions.
After a normal leader has been reaped, cleanup never signals its old numeric
process group; only still-owned adopted descendants authorize cleanup.
Ordinary exit codes are preserved; timeout is exit
124. The diagnostic step has a 77-minute backup limit inside the unchanged
90-minute job. The remaining-budget cap, rather than that backup alone, reserves
time for the following `if: always()` evidence upload.
This does not expand any validator, source policy or financial evaluation clock.
Without `FINANCIAL_RELEASE_ARCHIVE_INPUT`, this integration is explicitly skipped.
The fast synthetic carry regression runs separately with:

```sh
node --test .github/scripts/financial-release-lifecycle.test.mjs
node --test .github/scripts/financial-lifecycle-watchdog.test.mjs
```

## What executes

1. Verify every outer input hash and the diagnostic's corrected UI/data inventory.
2. Recreate and hash-check the exact captured baseline from the actual predecessor.
3. Run successful production sealing for original/current synthetic Design
   artifacts with unchanged protected code, real preview/projection/source bytes
   and explicit local-only pins, then compress the sealed TAR transport.
4. Invoke the production activation `plan`, `restore`, `compose`, pre-upload
   `recheck`, pre-deploy `recheck`, and normal `livePublication` reader.
5. Release only generated candidate staging. Preserve original inputs.
6. Prepare an explicitly synthetic next-price feed for the full current universe
   by appending an observation at each existing chart's unchanged final price.
   Prior bars and original source receipts are preserved.
7. Invoke the production advancing plan/restore/prepare-carry/export/history/
   compose/recheck/recheck/live-reader flow against the just-activated lineage.
8. Check the original source projection/base/lineage, next NVDA price date and
   retained historical snapshots in the carried publication.

The scratch directory retains `report.json`, phase logs, `trace.jsonl`,
`last-failure.json` and `watchdog.json`. Phase/command starts are saved before
blocking work; ends include actual elapsed durations and appear in CI stdout.
The external supervisor emits a bounded heartbeat every 30 seconds with elapsed
time, the last phase/command and whether new phase/command evidence appeared.
These heartbeat observations are also retained in `watchdog.json`; a stationary
phase is not described as progress merely because time passed.
The watchdog's separate timeout record identifies the last phase/command and
elapsed time without replacing the existing partial report, failure or trace.
Command arguments and environments are omitted from timing logs; failure output
is bounded. Publish only these diagnostics if needed, under
an explicitly **unapproved test report** artifact name. A skipped, incomplete or
failed run must never be reported as a successful activation integration.

The current example is bound to diagnostic artifact `11333869601`, SHA256
`2df75f7c8e8f0b43b4ea36ddc5c79531c97407d67593cdcb75e6127aa2dce0f9`,
which captures `34ecbf507a4270f796078d669c21c373c0d1279a` / tree
`9331c7c06b54dc2ad54fabff3d6503f3b24a673b`. Its real Design run failed
performance limits; this is a fresh controller reproduction input, not an
approved release. The new helper run must verify these captured bytes before
claiming the startup fix is exercised.

Run [37274346665](https://github.com/kusennjp1-ai/screener/actions/runs/37274346665)
completed initial simulated activation but rejected the following carry at a
BITU chart identity mismatch. The new captured exporter preserves inherited
chart scope during admitted carry. The prior failed result is retained; a new
full lifecycle pass is not inferred from the compact red/green regressions.
