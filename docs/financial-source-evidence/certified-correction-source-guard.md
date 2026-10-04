# Certified correction source guard (local integration)

The existing `verifyCorrectionSource(source, api)` continues to require a
successful acquisition producer. A caller may explicitly supply the closed
third argument `{reference, certificateZipPath}` to validate source artifacts
using a separate successful certifier. This is a source gate only. The release
controller, correction intent/receipt schema, workflows and preview entry points
do not supply this argument. Correction publication remains held.

`contracts/financial_source_certificate_reference_v1.json` defines every required
reference key: schema version, repository, certifier workflow, full head SHA,
run, attempt, job ID, artifact ID/name/ZIP digest and certificate body digest.
Missing keys, extra keys, arbitrary trust objects and blanket failed-producer
flags fail closed. `terminal_partial_receipts` remains a separate local preview
mode with no publication authority; it does not authenticate a certificate.

## Independent trust checks

The guard reads the immutable certifier attempt, its complete bounded job and
artifact inventories, and the exact commit and recursive tree from GitHub. It
checks repository IDs and names, branch/push context, successful terminal run
and job, pinned job ID, full head, exact artifact and creation interval, expiry,
byte length, ZIP digest and certificate body digest. Missing or duplicate jobs,
artifacts and reviewed code entries reject the source.

The trust manifest was computed from reviewed local Git objects, not from
certificate assertions. It contains two explicit tree/request records:

- Partial source attempt 3: reviewed commit
  `5bfa00bfab04b0e40de98622b10816a7b93bffca`, tree
  `08f4b10a0fb57671802fa803fc25b140eb0ad3dc`.
- Final source attempt 8: reviewed commit
  `16145829c9f06a51a5404a4044229b32b638c3c6`, tree
  `16accf63ff4caef0da2adae8f4f9bbe46c913886`.

Only `.github/financial-source-certification-request.json` differs between
these two trees. Both use the same 18 reviewed validation file SHA-256 and Git
blob hashes. Each record also pins the committed request blob, original and
canonical request hashes, and complete producer source identity. The controller independently
requires the certifier's Git commit/tree and file entries to match. The full
tree also covers imported code and workflow inputs outside the code manifest.
The local copied contract/schema hashes, certificate policy/contract hashes and
retained validation manifest must match this controller-owned review.

The selected tree's reviewed source request must exactly match the requested
correction source and the certificate's canonical request hash. Attempt 3's
certificate cannot validate attempt 8, or vice versa. Unlisted request blobs
and unlisted trees fail even when all runtime/policy files match. A future
changed source request, workflow or validation implementation requires another
reviewed trust configuration; this remains an explicit reviewed set, not an
unattended recurring certificate mechanism. A different commit with an identical
reviewed tree is acceptable only when its exact run/head/job/artifact is pinned.

The offline Python helper validates the closed JSON Schema, rejects duplicate
JSON keys and nonfinite values, checks safe and bounded ZIP members, and hashes
the request, API transcript, validation manifest and projection. It verifies
projection scope/counts, receipt inventory and original source clock bounds.
It executes only controller-local code and never extracts or runs ZIP code.

The complete embedded source identity must equal the correction's original
requested repository, workflow, producer head/run/attempt/artifact/base/cohort.
The guard independently reads that producer attempt and artifact again and
compares the original job identity, clocks and actual terminal conclusions with
the retained API transcript and certificate. A valid partial source can return
`job.conclusion: failure` and `producer_exit_code: 3` alongside a separately
successful certifier job. No failure is rewritten as successful acquisition.
Provider blocks, failures, unknowns and original source clocks remain in the
returned evidence; certification grants no further provider work.

## Preserved publication boundary

The result explicitly reports `authority: source_artifact_validation_only` and
`publication_authority: none`. It does not substitute the certifier projection
for the destination-bound correction projector, renew source clocks or imply
full availability. Ordinary chronology, current predecessor, normal controller
CI, approved consumer CI and Design Acceptance, ownership, price preservation,
cohort completeness, compatibility and quality/budget checks remain unchanged.
The caller must still restore and verify the original source ZIP before any
projection. The verifier itself performs no provider calls or publication.

The separate [coordinated activation implementation](financial-release-activation.md)
now binds the certificate reference into its typed request and retained receipt,
then revalidates it with the existing consumer and predecessor gates. That path
holds activation until an exact retained-candidate pin and all normal gates are
present. Its dated carry preserves the original source lineage and clocks. The original closed
`financial-correction-v1` intent remains prepare-only; adding certificate fields
to that older intent or receipt still fails.

## Local verification

Use Node 22+ and Python 3.11+ with the explicitly pinned helper dependency:

```sh
python3 -m pip install -r .github/scripts/financial-correction-certification-requirements.txt
node --test .github/scripts/verify-certified-correction-source.test.mjs \
  .github/scripts/financial-correction.test.mjs \
  .github/scripts/financial-candidate-preview.test.mjs \
  .github/scripts/financial-candidate-baseline.test.mjs
```

The integrated CI controller-contract step installs this pinned helper dependency
and runs the certificate tests with the existing correction and preview tests.
This adds validation coverage; it does not activate publication.

The real retained integration fixture uses successful certifier run
`37210092695`, attempt `1`, job `111459343111`, head
`91793baaf6bbf34ca87bcc322e9c4bc4d33aa22d`, artifact `11306690742`, ZIP SHA-256
`e0a17bd0f59554a0a4cc5e5200a77b334c1e9ac98d65bd851b3bba9f301678b2` and
certificate SHA-256
`7eb44cff44bf66b7a8a6dd8061cfa31cfb3b144a46f966aacb87330554bc309e`.
Offline replay with saved raw GitHub responses accepts source run `37203329163`,
attempt `3`, while retaining failed source job `111445562005` and exit `3`.
Its cohort is 1,894, attempted count is 1,002, and retained-statement symbol
count is 998. This fixture establishes source validation for that partial
archive; it does not claim current full coverage or publication readiness.
Saved API responses are local replay evidence, not authenticated live state.

The added attempt 8 trust record is a reviewed source identity, not a successful
certificate assertion. Its source artifact is `11307162746` with ZIP SHA-256
`c4b07d50e357fb556fda62c419f0d549a1a7e62fd62dccd3a501d4d563939dbb`.
The guard still requires that request's separate successful terminal certifier
run, exact job and hash-bound artifact before accepting its certificate.
