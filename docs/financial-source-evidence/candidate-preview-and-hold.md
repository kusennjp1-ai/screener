# Unpublished financial candidate preview and publication hold

Status: local preparation only. No activation implementation, deploy path,
workflow permission change or source acquisition is included.

The published a9 consumer cannot execute the new correction hook. Publishing
the candidate consumer first could create a public interval in which all current
financial fields are unknown. The candidate preview therefore uses its own
receipt type and cannot pass either publication receipt validator. It builds the
exact unpublished consumer with the published predecessor, then applies the
offline statement projection to that baseline. The existing strict CI and Design
Acceptance requirements for publishing a new UI remain unchanged.

## Local command and exact inputs

Run from a clean, committed controller checkout with existing frontend
dependencies. The candidate may be another local checkout, but its committed
tree is exported with `git archive`; working-tree edits are never executed.

```sh
node .github/scripts/financial-candidate-preview.mjs prepare \
  --request /absolute/review/request.json \
  --evidence /absolute/review/evidence.json \
  --candidate-root /absolute/candidate-checkout \
  --predecessor-zip /absolute/original-pages-artifact.zip \
  --source-zip /absolute/original-statement-artifact.zip \
  --output /absolute/new-preview-directory \
  --python /absolute/python
```

An optional `--predecessor-root /absolute/already-extracted-pages-tree` reuses an
existing extraction after streaming the original ZIP/TAR and comparing every
member path, type, byte count and SHA-256. Extra files and links are rejected.
This avoids a second full extraction; the exact original ZIP still accompanies
the preview, and the supplied tree is checked again for mutation before success.

The closed request has `schema_version: financial-candidate-preview-v1`,
`kind: unpublished_financial_candidate`, `candidate_ui: {sha, tree}` (full Git
commit and tree IDs), `source_policy`, and `correction`, the existing closed
`financial-correction-v1` intent. The intent binds the exact predecessor
run/attempt/receipt/manifest identity and the complete original source
repository/workflow/head/run/attempt/artifact/ZIP/archive/base/cohort digests.

`source_policy` must explicitly be `successful_capture` or
`terminal_partial_receipts`. The latter is a separate review-only validator:
the exact run and source job must both be completed failures, with only the
bounded receipt-collection step failed. Original artifact identity/timing and all
ZIP/archive/base/cohort hashes remain mandatory, and the immutable batch summary
must retain its explicit exit code 3 and unavailable-source semantics. It cannot
accept a running, cancelled, failed-checkout or unrelated failed execution. The
cycle record must also be completed/exit 3 and bind the exact archive, acquisition
base and source code revision; a crash after batch collection but before archive
merge or final verification is rejected. Its original digest and outcomes are
retained in the preview receipt. The
publication source validator is unchanged and still rejects a failed producer.
No fabricated success values are passed to it.

The preview report and receipt retain the original run/job failures and failed
steps, original batch-summary digest and reported counts/provider/execution-stop
diagnostics, and separately recomputed full-cohort field-reason/receipt counts.
Reported acquisition counts never become evidence for current values. Only the
offline projector's independently replayed archive proofs supply those values.
An eventual successful independent artifact certifier is a separate mechanism;
the preview grants no certification or publication authority.

The evidence JSON has exactly `live`, `predecessor_artifact`, and `source`.
`live` is a captured `livePublication()` result; `predecessor_artifact` is the
immutable Pages artifact metadata selected for that deployment. `source` has
exactly `run`, `jobs`, `artifacts`: complete responses from the pinned source
attempt, its jobs, and that run's artifact list. These are recorded read-only
observations, not proof that the predecessor remains live now. Their bytes are
bound in the preview receipt. Nested seed provenance never substitutes for the
outer source run/attempt. The original artifact ZIP digests are recomputed before
safe extraction. Legacy a9 input is allowed only when its entire UI inventory
matches the existing bootstrap; its empty receipt hash remains explicit.

Preparation executes the candidate exporter, quality checker and Vite build
directly. It does not execute npm lifecycle hooks, enrichment/repair scripts,
candidate-history recording, providers, GitHub or Pages commands. The existing
ZIP restoration helpers receive the already-present local ZIPs, preventing
their download paths from running. Dependency installation and network sandboxing
remain executor setup concerns; this is an offline code path, not an OS sandbox.

The controller chooses one actual current evaluation instant. Both builds and
the projector use it, while the final compatibility check uses the actual clock
again. Observation clocks remain their original October 4 captures, independently
for annual and quarterly data. The price date remains October 2. Generated-at
metadata is retained; it cannot assert a publication or source observation time.
`point_in_time` is false and `source_publication_date` is null. Existing three-fund
applicability coverage stays bounded; this change does not add GBTC or infer its
type from a ticker/name heuristic.

## Output and invariants

The output retains the exact original predecessor ZIP, the full extracted
predecessor when one was not supplied, original statement ZIP/archive, committed candidate source TAR,
baseline and corrected builds, target base, projection, verification report,
request/evidence bytes and content-bound preview receipt. Both build roots omit
`publication.json`. `UNPUBLISHED.txt` and the receipt explicitly state that the
artifact is not public and has no publication authority. Original predecessor
material still contains its original publication receipt when one existed.
Redundant unpacked TAR and successful build staging copies are removed so the
large predecessor does not unnecessarily consume several additional copies of
disk space. Failed preparation retains the remaining local diagnostic inputs.

Both builds must pass the unchanged data-quality and retained-universe gates.
The first semantic comparison rejects any price or nonfinancial drift caused by
the candidate compiler, while permitting policy projection of financial fields
throughout the original full universe. The second comparison permits financial
changes only for the projected cohort. It checks full OHLCV/history values,
stable symbol/series sets, market/date identity, price/liquidity fields, untouched
files, protected mixed-file fields, and immutable history. Changed content-addressed
paths do not excuse changed semantic content. The corrected build must also pass
the candidate's full financial compatibility check and have exactly the same
non-data UI inventory as its baseline. A failed comparison retains local
diagnostic input/build material but emits no successful preview receipt.

This strict baseline check may reveal previously unaccounted-for compiler
migration differences in the real predecessor. Such a failure requires an
explicitly scoped, independently reviewed comparison or compiler fix. It is not
permission to remove fields from the protected inventory until the build passes.

The separate baseline helper currently allows only three verified additions on
the research manifest reference: `assessment_version`, `financial_semantics`,
and the independently recomputed `instrument_applicability_universe`. Existing
values cannot be replaced. Its report includes the complete before/after values.
All other manifest keys retain the existing strict comparison, including market
and date values. Unknown metadata fails closed.

Compact research rows may make the unchanged global price date explicit only
when every new row date equals both predecessor and candidate global dates.
The only allowed identity-wrapper additions are BITU, ETHE and SBIT, each with
one exact observed symbol/market/company-name context, independently checked
against the predecessor's compact index, canonical detail and raw scan rows.
The report binds those original paths and hashes. Invented identifiers or
classifications, conflicting names, duplicate contexts and other symbols fail.
The same three instruments' chart containers may make the inherited US market
and verified symbol explicit and add one wrapper of exact existing observed
symbol/market/name fields. Original root, stock-data, fundamentals, retained
history and other explicit identity contexts must agree. Invented names, IDs,
classifications or conflicting markets fail; bars and all unrelated fields remain
in the strict comparison. The diagnostic report binds the original chart hash
and each normalized path/value. Historical-comparison changes are not included
in this exception. These representational checks apply only to the
unpublished candidate baseline; baseline-to-corrected comparison is unchanged.

## Pending correction hold

Presence of `.github/pending-financial-correction.json` is fail-closed for every
new-UI promotion in both planning and final recheck. A valid record has exactly:

```json
{
  "schema_version": "pending-financial-correction-v1",
  "status": "pending",
  "reason": "review_corrected_candidate_before_ui_promotion",
  "candidate_ui": {"sha": "FULL_COMMIT_SHA", "tree": "FULL_TREE_SHA"},
  "correction": {"...": "complete existing typed correction intent"}
}
```

The example is schematic, not a valid record. No active record is silently
invented or enabled by this implementation. The exact candidate/predecessor pins
constrain preview and future clearance, never whether the hold applies. New
merge-created SHAs, unknown/removed candidate refs, changed trees, superseded
predecessors, invalid JSON, wrong schemas and a `status: cleared` object all keep
new UI held. A broken symlink also remains a hold. The publication controller
falls back to its unchanged verified-data path using the currently published
UI; validated data advances, ordinary no-ops, and byte-preserving metadata
migration keep their previous behavior. Design Acceptance can still build and
evaluate candidate UI, but grants no hold clearance.

Absence of the file preserves normal releases. Consequently removing the hold
file is a consequential code change that must be reviewed. This implementation
provides no automatic deletion or clearance, and does not claim a git file alone
can prevent an authorized repository writer from removing enforcement code.

## Proposed later handoff (not implemented or accepted by the controller)

A future reviewed main-branch change should contain a closed
`financial-candidate-promotion-request-v1` record with these exact identities:

- Pending hold content digest and exact predecessor identity.
- Candidate commit/tree and expected UI inventory digest; controller commit/tree.
- Prepared preview outer workflow/run/attempt/job, artifact ID/name/ZIP digest,
  preview receipt digest, source/projection/generation digests, and baseline and
  corrected complete data inventory digests.
- An immutable durable-backup attestation digest covering original predecessor
  ZIP, original source ZIP/archive, candidate source, both bundles, projection,
  evidence, verification report and receipt, plus restored/read-back byte counts
  and SHA-256 digests for every retained artifact.
- A bounded reason and explicit requested operation, with no generic booleans,
  `allow_equal_date`, caller-supplied successful-check flags, private Library IDs
  or private links.

Before a future implementation could activate, independent code must retrieve
and verify the prepared artifact's exact successful outer attempt/job interval,
safe extraction and every digest; reproduce the compatibility and scope checks;
verify the current live predecessor and source attempt; re-evaluate proof and
history freshness with the actual clock; and verify strict required CI jobs plus
Design Acceptance for the exact new consumer SHA. A preview artifact is never
gate evidence. A merge-created SHA/tree needs a newly exact binding and checks.
All must be rechecked under the existing serial publication lock immediately
before any deploy. Ordinary data-mode fallback must not authorize this new UI.

Durable backup requires independent storage read-back and restore verification.
A `backup_success: true` field, Library upload response, screenshot, or expiring
Actions artifact is insufficient. Private storage locators belong in the
operator's private evidence, never public repository code. The public handoff may
bind the verified attestation digest, but a verifier for that attestation and its
authority is still required. There is currently no such activation verifier or
deployment exception; the existing workflow's correction preparation continues
to exclude both Pages artifact upload and deployment.

## Current candidate event comparisons

The current event view requires the previous snapshot and the saved first
observation for the current price date to match the executing rule fingerprint,
universe version and financial-applicability version. If either differs, the
current selection is compared as explicitly incomparable; legacy-policy new,
returned and dropped events cannot reappear as current events. Within the same
policy and date, the first saved observation continues to define events even
when a later financial correction changes current selection. Original catalog
and snapshot bytes remain immutable.

`comparison_basis` records the active policy, selected observation source, exact
saved references and their original policy identities. The UI labels that basis
and suppresses an unverified legacy cached basis. Build quality and correction
compatibility checks independently reload and hash the original snapshots,
recreate the current snapshot from canonical rows, and reproduce every event
and basis field. The regression models the observed legacy 1,892-row event set
and verifies all 1,896 current rows are incomparable with zero transitions under
the new policy. This is an observation comparison, with no historical-return
claim.

The baseline comparator permits the same explicitly verified global price date
and original identity wrappers in canonical details and scan aliases. Every
other row value still enters the strict nonfinancial comparison. A default-sort
migration is limited to descending `composite_score` to descending
`se_setup_score`, reflecting the reviewed quarantine of unverified ratings;
initial/preview membership and order are independently recomputed first. The
visible mobile sort label is tested as セットアップ点.

Before accepting compiler metadata on daily research, qualification audit,
portfolio or workbench, a separate verifier reloads canonical detail inputs and
recomputes their outputs. It checks compact transport parity, all candidate
rankings, each audit assessment, every portfolio result, sector calculations and
current-policy event provenance. The report records input digests and exact
before/after metadata. Workbench event counts and items are never normalized or
allowlisted. Original snapshots and all price/history/nonfinancial values remain
subject to the unchanged strict correction comparison. These rules apply only
to predecessor-to-candidate baseline migration.

## Explicit certified native preview (v2)

`financial-candidate-preview-v2` is a separate closed, local-review request. Its
only top-level fields are `schema_version`, `kind`, `candidate_ui`, `correction`,
`source_validation` and `destination_projection`. The existing candidate and
correction identity objects keep their exact v1 contracts. The two new objects
are required together:

```json
{
  "source_validation": {
    "guard": "certified_source_artifact_v1",
    "certificate": {"schema_version": "financial-source-certificate-reference-v1"}
  },
  "destination_projection": {
    "projector": "native_annual_destination_v1",
    "policy": "financial-correction-native-annual-v1"
  }
}
```

The abbreviated certificate above must contain every exact field from
`financial_source_certificate_reference_v1.json`: repository, workflow, head
SHA, run, attempt, job, artifact ID/name/ZIP digest and certificate body digest.
The CLI additionally requires `--certificate-zip`. V1 requests reject that flag
and keep their existing successful-capture or terminal-partial behavior. No
environment variable selects a source guard or destination policy.

The v2 evidence file has exactly `live`, `predecessor_artifact`, `source` and
`certifier`. Source holds the original raw `run`, `jobs` and `artifacts` objects.
Certifier holds its raw `run`, `jobs`, `artifacts`, `commit` and recursive `tree`.
The existing certified-source guard reads only those captured objects through a
closed adapter; an unexpected API lookup throws. It validates the controller's
reviewed source request/tree, the exact certificate ZIP and original producer
identities. The ZIP, original cycle and batch digests are retained. No recorded
response is presented as a fresh remote check.

The original producer's success/failure and exit code stay factual. All
cumulative failure records, availability limits, provider state and original
receipt clocks remain in the receipt's verified certificate record. A successful
producer or certifier never implies complete financial availability.

The selected native projector uses the same pinned source/target arguments as
the legacy projector. Both destination projections must remain inside the
preview's projection directory. The native result binds the original destination
projection's bytes, policy and unchanged receipt inventory, plus the executing
native projector/contract digests. The certificate's original source-availability
projection remains a separate record and never claims to certify the native
policy. Receipt checks bind both complete records and their digests, while still
requiring `publication_authority: none`; neither release receipt validator
accepts v1 or v2 previews. The publication workflow and source selector are not
modified by this wiring.
