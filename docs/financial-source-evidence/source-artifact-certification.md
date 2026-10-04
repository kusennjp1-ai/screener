# Source artifact certification

Certification is a separate, read-only validation authority. Acquisition may
finish with exit 3 because a statement getter is empty while retaining many
valid receipts. A successful certificate never changes that failed producer
run/job conclusion. It verifies the exact artifact, every retained acquisition,
archive link and projection; it does not assert full statement availability,
stock qualification, point-in-time knowledge, or permission to publish.

The closed request in `.github/financial-source-certification-request.json`
pins repository, producer workflow, head SHA, run, attempt, artifact ID/name,
ZIP SHA-256, archive manifest SHA-256, acquisition base SHA-256 and cohort
SHA-256. The output contract is `contracts/financial_source_certification_v1.json`;
the closed JSON Schema is `contracts/financial_source_certification_v1.schema.json`.
There are no private file-service identifiers in either public artifact.

## Boundaries and evidence

The CLI accepts a local ZIP and a saved attempt-specific GitHub API transcript.
It makes no network calls and never constructs a provider. It checks the source
run/job, exact artifact digest and creation interval, safe bounded ZIP extraction,
completed producer cycle, base/cohort, all immutable archive objects, original
attempt journals, successful and failed acquisition identities, source clocks,
frames, source subsets, envelopes, compact proofs and histories. It recomputes
historical stored projections at their original evaluation clocks, then builds
a separate current projection for every symbol in the explicit full cohort.
Missing receipts remain unknown; no denominator is narrowed to successful rows.

Ordinary empty statements require a recorded empty getter plus successful HTTP
responses. HTTP 403/429 remain provider blocks, including when a getter returned
an empty frame. Successful pre-block receipts can certify as exact source facts,
but the certificate retains `provider_state: blocked`. The certificate always
sets `further_provider_work_allowed: false`: validation grants no acquisition
authority. Original failure objects and journals stay unchanged. An empty getter
without successful transport evidence is an unknown failure, never silently
classified as a source-empty statement.

Counts distinguish ordinary current comparable proofs, nonpositive reference
proofs, source-limited zero/small bases, and unknown or expired data. History
completeness and comparison-base semantics remain separate. Current observations
from October 4 remain October 4 observations beside October 2 prices;
`point_in_time` stays false and publication dates stay unknown. Derived ratings
remain quarantined. No availability count is a stock-screen pass count.

Corrupt old receipts, malformed/ambiguous identities, contradictory normalization,
incomplete producer cycles/batches, and wrong run/attempt/artifact/base/cohort
bindings fail certification. Stale valid receipts do not fail integrity validation;
their current fields become unknown. Rebuilding a projection cannot renew source
observation timestamps or expiration.

## Reviewed historical projection migration

The archive includes one producer batch from before the reviewed uniform EPS
pair fallback. Its summary SHA-256 is
`856918a6ccea581b85bf2fdba601457c1da1631737717e4dc700f8d8e7dcc2ce`.
`financial_source_reviewed_migrations_v1.json` pins that batch, the original
APLD/AUB/AVAV envelope hashes, and each exact permitted field/value/metric/source
input/capture/time delta. Only these artifacts can replay through the original
preferred-row selector. Their original envelopes, compact proofs and histories
must match that historical replay. Current projection then uses the reviewed
complete same-metric EPS selector. The receipt lists the migration separately.

No previously available field may change through this adapter, no unlisted delta
is accepted, and source capture bytes and clocks remain immutable. APLD's added
q2 reference remains unavailable because its reporting period is stale; all
three changed derived raw scores remain quarantined. The adapter does not
broadly grandfather historical producers or source inconsistencies.

The initial certifier intentionally accepts completed acquisition batches with
1–200 selected symbols. It rejects zero-work cycles rather than inferring their
cohort or provenance from a prior archive. This bound does not require complete
availability or exclude unknown/not-applicable instruments from the cohort.

## Workflow and downstream trust

`financial-source-certification.yml` runs only on an explicit push to
`preview/financial-source-certification`, with `contents: read` and `actions:
read`. It tests offline boundaries, reads the pinned producer attempt/artifact
through GitHub, runs the offline CLI, and uploads a certificate only after all
checks succeed. It has no automatic post-collection trigger, schedule,
workflow-dispatch integration, provider acquisition, deployment or release step.
No producer workflow result is edited or replaced.

A local caller-supplied API transcript is not independently authenticated by an
offline program. Local output is review evidence; it is not proof that a CI job
ran. A future release guard must independently verify the exact successful
certifier workflow/run/attempt/job/head/artifact digest, then validate its closed
certificate and equality of the complete embedded producer identity to the
requested correction source. It must also independently verify the producer
attempt and artifact again, preserving their real failure conclusions. The
certifier's branch-push event and successful job are the validation authority;
the producer's separate branch-push event and failed job remain acquisition
history. The source check is bound, never waived.

The guard must retain existing required normal CI, Design Review, price-quality,
consumer compatibility, exact publication predecessor, cohort, input ownership,
price-preservation and chronology checks. Its destination-bound correction
projector still independently replays these source receipts using its own exact
policy/code identity. This change does not wire certification into publication.

## Local invocation

From a checkout with the reviewed Python dependencies and `PYTHONPATH=backend`:

```sh
python -m app.scripts.certify_statement_source \
  --request .github/financial-source-certification-request.json \
  --api-evidence /path/to/source-api-evidence.json \
  --source-zip /path/to/original-producer.zip \
  --output-dir /path/to/new-output \
  --evaluated-at 2026-10-04T14:30:00Z \
  --code-sha EXACT_VALIDATION_COMMIT
```

The saved API evidence must have exactly `run`, `jobs`, and `artifacts` keys.
Use the producer's attempt-specific endpoint, not the latest-attempt endpoint.
Output contains `certificate.json`, a SHA-256-addressed full-cohort projection,
and the exact saved API evidence, canonical request and validation-code hash
manifest used by the certificate.
The receipt hashes the validation policy/code files and original receipt inventory,
retains factual producer outcomes and all failures, and explicitly says
`published: false`. The CLI writes no certificate when validation fails.

Mixed or absent source currencies can produce `invalid_source_inputs` even when
all original numeric values and hashes are intact. Such fields remain unknown
with no proof tuple. Certification allows this only when both the stored and
current proof are unavailable, the raw receipt confirms ambiguous currency, and
a diagnostic copy passes every other source-input and arithmetic check. It
never converts currencies or turns audit-reference numbers into valid growth.
Consistent-currency arithmetic, identity or input contradictions still fail.
The execution summary labels cumulative failures separately from the exact
producer batch's failures and getter counts.
