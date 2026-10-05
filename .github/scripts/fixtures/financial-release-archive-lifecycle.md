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

Allow 30 minutes for the test and a longer workflow timeout for materialization.
Without `FINANCIAL_RELEASE_ARCHIVE_INPUT`, this integration is explicitly skipped.
The fast synthetic carry regression runs separately with:

```sh
node --test .github/scripts/financial-release-lifecycle.test.mjs
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

The scratch directory retains `report.json`, phase logs, `trace.jsonl` and
`last-failure.json` on failure. Publish only these diagnostics if needed, under
an explicitly **unapproved test report** artifact name. A skipped, incomplete or
failed run must never be reported as a successful activation integration.
