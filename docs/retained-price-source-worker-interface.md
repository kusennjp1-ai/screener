# Retained source worker interface (local inactive plumbing)

CLI: `python3.11 .github/scripts/run-retained-price-source.py --inputs /absolute/input/inputs.json --output /absolute/new-output --job-start /absolute/first-step-epoch --parent-network-namespace 'net:[...]'`. The adapter enters a distinct network namespace and removes credentials and all inherited compiler/carry/Vite settings first. The original reviewed 95-minute process, 110-minute job, 10-minute upload margin, process cleanup, and 8 GiB reserve apply. `--worker` is the supervisor's internal entry. No evaluation-time CLI option exists.

`inputs.json` has exactly these fields:

```
{
  "schema_version": "retained-price-source-worker-input-v1",
  "mode": "producer" | "replay",
  "request": {"path": "/absolute/input/request.json", "bytes": 1, "sha256": "64 lowercase hex"},
  "original_api_evidence": {"path": "/absolute/input/original-api-evidence.json", "bytes": 1, "sha256": "64 lowercase hex"},
  "invocation_evidence": {"path": "/absolute/input/invocation-evidence.json", "bytes": 1, "sha256": "64 lowercase hex"},
  "candidate_zip": "/absolute/input/candidate.zip",
  "companion_zip": "/absolute/input/companion.zip",
  "prior_zip": "/absolute/input/prior.zip",
  "approved_ui": {"sha": "1e1943e1d5f78a738a05baa69eb9f2e8508e32ac", "tree": "1c0219a170dcbdeb1af539e4cf7a04018251ca02", "frontend_tree": "0ba620a84264e1ff026898beed3fbc8ad5894618"},
  "dependencies": {"node_modules": "/absolute/prepared/node_modules", "receipt": {"path": "/absolute/input/dependencies.json", "bytes": 1, "sha256": "64 lowercase hex"}},
  "producer_declaration": null | {"path": "/absolute/input/producer-declaration.json", "bytes": 1, "sha256": "64 lowercase hex"}
}
```

Every bound JSON file is a real regular file under the input directory; caps are 64 MiB individually, 128 MiB combined. Originals are the exact reviewed #419 ZIP, companion, and #99 historical ZIP. The original API proof retains the existing safe restorer's `oct6-retained-price-rehearsal-api-v1` schema. Its selected original records, including every original run/job/artifact/source clock, enter the immutable projection literally; fresh caller/check observations remain in the physical audit. The online adapter must independently authenticate these API bytes before launching the worker. Offline hashes do not confer online authentication.

`invocation-evidence.json` has exactly: `schema_version:"retained-price-source-invocation-v1"`, `mode`, `request_sha256`, `controller:{head,tree}`, `caller:{run_id,run_attempt,head_sha,job:{id,started_at}}`, and `selected_producer`. Producer mode uses `selected_producer:null`. Replay uses `selected_producer:{run_id,run_attempt,head_sha,job:{id,started_at,completed_at},declaration_sha256}` and requires an exact declaration binding. All IDs are positive integers, Git hashes are 40 lowercase hex, clocks are timezone-qualified ISO strings. The adapter verifies genuine Static Site producer role and selected declaration against online API records. The worker also verifies the local controller Git head/tree and all input byte bindings.

Dependency receipt has exactly `schema_version:"retained-price-source-dependencies-v1"`, `approved_ui`, `package_lock:{bytes,sha256}`, `node_version`, `npm_version`, `command:["npm","ci","--ignore-scripts","--no-audit","--no-fund"]`, and `files`. `files` is the complete relative node_modules inventory: regular entries `{bytes,sha256}`, symlinks `{symlink:"literal target"}` whose resolution remains inside node_modules. The worker checks the approved Git package-lock bytes, Node/npm versions, all inventory members, and keeps dependencies unchanged. No install/fetch occurs offline.

`producer-declaration.json` is the exact worker-produced `payload.json` from the authenticated source producer. Its producer identity and evaluation instant must match the API-verified selected producer and fall inside the real producer job. In producer mode, the worker samples the clock immediately before compilation. Replay uses only the authenticated declaration's recorded evaluation instant. Current ordinary carry/expiry remains outside this worker and uses actual current time.

Outputs:

- `runtime/frontend/public`: complete pre-carry repaired source bytes, including the literal restoration receipt and a bounded `static-data/retained-price-source-audit/` directory of immutable raw evidence.
- `runtime/frontend/dist`: genuine approved-UI Vite build proof. The publisher must independently compose the currently approved UI.
- `payload.json`: closed immutable semantic inventory/projection, original identities/clocks, recorded producer evaluation, graph and complete validation, approved UI and build inventories. Replay compares this whole object exactly with the authenticated producer declaration.
- `physical-inventory.json`: complete literal public and build file hashes, including all varying operational audit bytes; source semantics never replace this physical accounting.
- `report.json`, `compiler-evaluation.json`, and source-audit receipts: actual phase/clock/resource observations. Original restoration/scoped receipts are preserved byte-for-byte. Explicit observation bindings identify the only projected differences; unknown receipt fields fail closed.

No source companion, external artifact upload, authority flag, source promotion, provider work, financial carry, or deployment is performed by the worker. The controller alone performs separately authorized source authentication and companion creation after successful readback.

The build contract is fixed in `BUILD_CONTRACT` and copied into `payload.build.contract`. Real Vite runs the approved config with `publicDir:false`, `build.outDir:"dist"`, `build.emptyOutDir:true`, `VITE_BASE_PATH:"/screener/"`, and `VITE_STATIC_SITE:"true"`. No quote endpoint is configured. The worker then copies the complete reconstructed data/audit scope, the original restoration receipt, and the source scorecard to dist. Original `assets/`, `index.html`, `precache-manifest.json` and four approved public UI filenames are explicitly inventoried as omitted original UI. The approved four public UI files are overlaid. The scorecard must equal the approved Git scorecard. Any other original non-data root member or unexpected Vite output rejects. Vite's approved precache hook enumerates its actual emitted bundle; it does not timestamp output or enumerate public data. No build/compiler clock is normalized away.

In replay only, the unchanged quality and graph-validation entry points receive a fixed generated Node preload for the authenticated producer evaluation instant. Producer validation, compiler/history, Vite build, original-source API authentication, ordinary carry, and final current-time rechecks never receive this preload. Python records actual execution timestamps separately, and the phase report marks `historical_replay_validation:true`.

## Fixed online driver

`retained-price-source-driver.mjs` exports `produceRetainedSource`, `verifyProducedRetainedSource`, `createRetainedSourceCompanion`, `replayRetainedSource`, and `runRetainedSourceCommand`. Every callable takes `{root,authority,...}` with the core admission exports passed explicitly; the driver never imports the core at module initialization. Only fixture tests inject API/runtime functions.

The core CLI delegates `produce --output ABS --job-start ABS`, `verify-produced --output ABS`, and `companion --output ABS --artifact-id ID --artifact-digest sha256:HASH`. Production output, sibling inputs, prepared dependencies, driver plan, and provenance remain under `RUNNER_TEMP`. An exact approved Git fetch adds immutable objects without changing refs, FETCH_HEAD, or tracked worktree files. Setup uses locked npm installation before entering the offline namespace. The unshare launch drops back to the original runner UID/GID and passes only fixed runtime environment values. The read-only Python `verify_completed_output` rehashes both full trees and reconstructs all explicit semantic projections from literal audit members before upload.

The companion is written to `RUNNER_TEMP/export-provenance/source.json` after the real candidate upload. Its ordinary manifest/price observation fields are retained. `retained_price_repair` uses `retained-price-source-declaration-v1` and includes literal `payload_json` and `physical_inventory_json` with exact SHA-256, request/controller/predecessor bindings, and the fresh API-verified new artifact ID/name/ZIP size/digest. Combined embedded proof bytes cannot exceed 64 MiB; the entire companion is also bounded to 64 MiB.

`replayRetainedSource` additionally requires `{source,selectedRoot,output,jobStart}`. The core freshly authenticates `source` before the driver trusts any declaration or clock. `selectedRoot` must contain every member of the extracted uploaded dist archive, including original producer UI and audits. The driver compares its full physical inventory against the authenticated producer descriptor, independently replays original #419/#99 bytes, compares the entire canonical payload byte-for-byte, reauthenticates source/predecessor, and returns `{offline_recovery_verified,verification,verification_file,sourceRoot,producerRoot,replayRoot}`. `sourceRoot` has the replay's current literal operational audit. The publisher must preserve the producer's separate literal audit from `producerRoot` alongside replay evidence when composing its data-only output.

`extractRetainedProducerArchive({root,source,archive,destination,authority,api})` replaces generic TAR extraction for the finite source. It authenticates the complete physical inventory first, preserves the reviewed scanner's 2 GiB TAR and 128 MiB member caps, requires 8 GiB remaining reserve plus all copied bytes, and uses the unchanged reviewed scanner, exclusive file creation, staging, full streaming hashes, and no-replace commit. Unknown files or directories, links, duplicate members, changed hashes, nonzero trailing bytes, or insufficient storage reject before a complete destination is committed. The selector must also bound ZIP expansion to the same TAR limit.

`verifyRetainedRestoreBinding({root,source,record,live,authority,api})` is asynchronous and read-only. `record` has exactly `{verification,verification_file,restored_data_digest}`. It authenticates the current publisher/job/controller/source/predecessor, verifies the private receipt and real independent replay outputs, independently reprojects the selected producer's literal audit with the exact worker helper, and compares all data/UI bytes directly across producer and replay physical inventories. Its result exposes `{replayRoot,sourceRoot}` for the pre-carry price baseline check; ordinary financial ownership, equality, and actual-current-time expiry checks remain mandatory separately.

The restored data digest is derived independently from every producer data member plus replay audit members copied under `static-data/retained-price-source-replay-audit/`. It is included in the private verification receipt, so a caller boolean or state-only digest cannot confer source admission. Publisher replay requires the original fixed `RUNNER_TEMP/retained-price-publisher-job-start` file written by the first publisher step. That file is combined with the API job start using the earlier instant, and is never refreshed at restore or final recheck.

Arithmetic setup exposes `RETAINED_PRICE_PYTHON`: the producer must use `RUNNER_TEMP/retained-price-python/bin/python3.11`; replay uses the already prepared `RUNNER_TEMP/financial-replay-runtime/bin/python3.11`. The driver verifies the actual executable, venv prefix, Python 3.11, NumPy 1.26.3, and pandas 2.2.0. Only the isolated worker's PATH receives that venv bin prefix, including unchanged helpers invoking `python3`.

Original API response projection is closed to the eleven exact original run/job/artifact/Git request keys and two known observational request keys. All eleven original response objects and their literal hashes are immutable. The repository response is retained in full except `pushed_at`, `updated_at`, and `size`; its projected hash is recomputed, while the raw response/hash remain in the physical audit. Current main ref, caller, observation time, and current-controller observation are explicitly operational. Repository identity, owner, visibility, private/public flag, default branch, and all other fields remain bound. Unknown response endpoints reject. `observation-bindings.json` records the exact excluded fields and their literal/projected bindings.
