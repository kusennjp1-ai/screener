# Public archive for older financial audit carries

## Owner decision

On 2026-11-03 the owner chose option N1 from the Pages headroom plan: older
financial audit carry projections move off GitHub Pages into a durable, public
and independently verifiable store. Every receipt and the active audit material
stay on Pages, so Pages audit bytes stop growing with each publication. This
replaces the earlier policy that the live site was the only lasting copy of the
full audit history.

Nothing about financial values, formulas, source clocks, approval, renewal
authority, packing policy, transport hash mechanics, `MAX_SITE_BYTES` or any
threshold changes.

## Model: hosted ∪ archived

- `publication.financial_audit_files` keeps its exact meaning: the audit files
  hosted on this Pages publication. The codec, the nested audit reader,
  `restorePublishedFinancialSource` and every map-equals-directory check are
  unchanged.
- `publication.financial_audit_archive` (new, optional) lists audit files that
  are no longer hosted but are kept as public GitHub Release assets.
- The full audit history of a publication is the hosted map plus the archive
  index. Every earlier audit file must be present in one of them with the same
  SHA-256 (`assertFinancialAuditPreserved`, rules a-d below).

Keep and drop rules:

| File | On Pages | In the archive |
| --- | --- | --- |
| `release-*.json` and `renewal-*.json` receipts | always | never |
| `source-projection-*` and `source-base-*` | always | never |
| Active `carry-projection-*` (the new receipt's evaluation) | always | never in the same publication |
| Older `carry-projection-*` | until an archived copy is verified in a publish run | once verified |

The live active carry of publication N becomes archivable once publication N+1
has its own active carry.

## Index schema (inside `publication.json`)

The index lives in `publication.json`, whose SHA-256 is part of the live
publication identity and of the next receipt's `previous_publication_identity`.
It therefore has the same trust as `financial_audit_files`. A separate file
under `static-data/` would join the data inventory and break several closed
comparators, so none is used.

```json
"financial_audit_archive": {
  "schema_version": "financial-audit-archive-v1",
  "repository": "kusennjp1-ai/screener",
  "files": {
    "static-data/financial-corrections/carry-projection-<S>.json": {
      "kind": "carry-projection",
      "sha256": "<S>",
      "bytes": 120813637,
      "financial_generation": "<64 hex>",
      "receipts": ["static-data/financial-corrections/release-<R>.json"],
      "encoding": {"kind": "gzip", "sha256": "<sha256 of the archived asset>", "bytes": 9292103},
      "url": "https://github.com/kusennjp1-ai/screener/releases/download/financial-audit-archive-carry-projection-<S>/carry-projection-<S>.json.gz",
      "archived_at": "<release published_at>",
      "verified_at": "<same-run full verification time>",
      "removed_by": {"run_id": 1, "run_attempt": 1, "previous_publication_identity": "<run>/<attempt>/<sha>/<sha>"}
    }
  }
}
```

`validateFinancialAuditArchive` (in `.github/scripts/financial-audit-history.mjs`)
is closed and offline. It runs inside `validateReceipt`, so every reader of a
publication (the publisher, Design, the certifications, the rehearsals and the
post-close watchdog) validates the structure. It enforces exact keys, the
repository, a 1 MiB index cap and the existing 200,000-entry cap, carry-only
content-addressed keys, the derived URL, gzip encoding bounds, ISO timestamps,
removal provenance, and that every listed receipt is a hosted `release-*` file
with its hash. Preview publications can never hold an index.

An entry's identity is its **logical** SHA-256 (the hash in the file name). The
encoded SHA-256 only records the archived asset's own bytes. A different zlib
runtime that re-encodes the same logical file is still a valid copy.

## Tags, assets and the archive workflow

- One immutable release per archived file. Tag
  `financial-audit-archive-carry-projection-<S>`, single asset
  `carry-projection-<S>.json.gz`, created with `make_latest: "false"`.
- The tag prefix `financial-audit-` is reserved. No tool may prune, edit or
  delete a release under it. `release-asset-cleanup.yml` refuses any reserved
  policy at startup and again immediately before every `gh release view`,
  `download` and `delete-asset`. A repository-wide workflow test refuses any
  `gh release upload|delete|edit|delete-asset|create` that targets a reserved
  or non-literal tag.
- `.github/workflows/financial-audit-archive.yml` runs after every Research UI
  Release completion, on a push that changes the archive workflow or module, every
  three hours (fallback: `workflow_run` cannot fire past depth three), and weekly
  for a full sweep.
  - `collect` (permissions `contents: read`, no token) reads live Pages
    anonymously, stages each not-yet-archived hosted carry's exact nested gzip
    bin and verifies it decodes to its logical hash.
  - `upload` is the only job with `contents: write`, and only its upload step
    receives `GH_TOKEN`. It creates a draft, uploads the asset, re-reads its
    state, size and digest, then publishes. It never uses `--clobber`, never
    edits or deletes a published release, and only repairs an incomplete asset in
    a release that is still a draft under the reserved prefix. A published
    release whose bytes do not reproduce the file is a conflict: it is left
    untouched and the job fails.
  - `verify-public` downloads every staged copy anonymously and decodes it.

## Publisher behaviour

A new publish-job step, "Verify the public audit archive before omitting older
carries", runs `node .github/scripts/select-release-source.mjs audit-archive`
after the plan and before the approved UI tree is checked out, so only the
controller's own tooling runs, including in data mode. It uses the existing
read-only job token for one paginated releases listing. Every download is
anonymous (no `Authorization` header, https only, at most three redirects to
`github.com`, `release-assets.githubusercontent.com` or
`objects.githubusercontent.com`, no transfer encoding).

1. Already indexed entries fail closed: release metadata for every entry, an
   anonymous range probe for every entry, and a full download plus canonical
   decode for missing digests and two rotating entries per run.
2. New candidates (plain carries only) must have a published release whose
   asset downloads in full, matches its digest and decodes with the canonical
   one-member gzip decoder to exactly the logical bytes and length. Any failure
   keeps that carry hosted with a `::warning::`. Each candidate's Pages and
   Releases reads share a 30 s deadline (`CANDIDATE_TIMEOUT_MS`) and all
   candidates share an 8 minute budget (`CANDIDATE_BUDGET_MS`), well inside the
   step's 20 minute limit. A stalled or slow host therefore only keeps the
   affected and remaining carries hosted, with a warning. Already indexed
   entries (step 1) have no such deadline and still fail closed.
3. During restore, every verified drop is bound offline to the hosted receipts
   that reference it. A drop with no referencing receipt, or with disagreeing
   generations, stays hosted. Only the bound drops are left out of the new
   tree; the authenticated restored source root still holds every hosted file.
4. Compose writes `prior index ∪ verified drops not in the final hosted map`.
   Preservation rules: (a) archived entries never change or disappear; (b) every
   previously hosted file is hosted or archived with the same hash; (c) the
   archive only receives previously hosted files; (d) nothing pinned by the new
   receipt or still hosted is newly archived.
5. Both rechecks verify the index digest against this run's composition (or the
   live index verbatim when no admission ran, e.g. a queued run with older
   workflow YAML) and verify archive availability again.

Pruning is enabled only for plain carries. It is off for activation, renewal,
limited preview, corrections, finite price repair, publisher-tooling and pinned
ordinary-carry routes, while any renewal receipt is in the chain, and while the
committed `.github/financial-source-renewal-request.json` names the live
publication. Those routes carry the index verbatim. A correction refuses a live
index because it publishes no audit inventory. Pruning has a code-level kill
switch (`ARCHIVE_POLICY.pruning_enabled`).

A renewal request can only be admitted while the live publication is its exact
predecessor (`verifyRenewalPredecessor`), so `renewalRequestHold` pauses the
publisher's pruning and the archive `collect` job only while the request names
the live publication: its exact identity, its `publication.json` SHA-256, or its
run and attempt (`collect` reads Pages anonymously and has no deployment
identity, so it uses the last two). A request that names an earlier publication
can never be admitted again and does not pause anything. A request that cannot
be read or parsed pauses both, as does any request while the live identity is
unknown. The request committed on main since 2026-10-07 (e2f0b5a) names run
37456692717, not the live run 41779082131, so it can never be admitted and does
not pause the first transition.

Admission stops adding entries when either the 1 MiB index cap or the 4 MiB
`publication.json` cap would be exceeded (degrade, not fail).

## Degrade versus fail closed

| Situation | Result |
| --- | --- |
| Archive workflow failed, release missing or still a draft, listing unavailable before any index exists | Nothing is removed; today's behaviour. The TAR guard still fails closed at the limit. |
| A candidate download stalls, or the candidate budget runs out | The stalled carry, or every candidate not yet tried, stays hosted with a warning; the run continues. |
| A candidate copy is tampered, redirects to an unknown host, or does not decode | That file stays hosted with a warning. |
| An already indexed copy is missing, changed or undecodable | Admission and recheck fail. Pages stays at the last good publication. |
| GitHub API or Releases outage while an index exists | Fail closed; the post-close watchdog retries once. |

## Durability and the rollback rule

The archived history depends on GitHub Releases of this public repository.
Enabling immutable releases is recommended (check its effect on the existing
`--clobber` uploads to `daily-price-data`, `weekly-reference-data`,
`ibd-classification-data` and `cn-daily-price-shards` first). Pages artifacts
are kept for 7 days only and the 90-day correction artifact is correction-only;
neither is a lasting copy.

Never deploy a controller older than this change. Older code drops the unknown
index field while the bytes remain in Releases. `verify-history --orphans` (run
by the weekly sweep) reports every reserved release that is neither indexed nor
hosted, so such a rollback raises an alarm. Recovery means rebuilding index
entries from the release bodies, which needs owner review.

Any change under `.github/scripts` or `.github/workflows` alters the
`protected_prefixes` inventory, so a pending activation candidate needs the
existing exact-controller rebind.

## Runbook

- An indexed copy went missing or was corrupted: re-upload exactly the encoded
  bytes the index records (`encoding.sha256` and `encoding.bytes`, for example
  from a Pages artifact of 7 days or less) as the same tag and single asset, then
  rerun the publisher. An index entry never changes, so an indexed entry accepts
  only that exact encoding; a different encoding of the same logical file
  (accepted for a new candidate) does not satisfy it. If those encoded bytes are
  no longer available, publication stays blocked until an owner decides.
- A conflict in the archive workflow: inspect the published release named in the
  log. Tooling never modifies it; an owner decides how to replace it.
- Headroom ordering: before the first archive run, publications behave as before.
  If one fails the TAR guard, the next run after the archive workflow succeeds.
- First transition (measured on the 2026-11-04 live publication, run
  41779082131): Pages hosts 25 release receipts and 24 carry projection bins
  (222,146,560 TAR bytes in total, the active carry included) with no index; the
  TAR is 965,406,720 bytes. No renewal receipt is hosted and the committed
  renewal request names a superseded publication, so prune mode applies. The
  first archive run (the push after merge) stages and publishes all 24 bins.
  The next plain carry publication omits all 24 that verify, hosts its own new
  carry (about 9.2 MB) and adds about 1.2 KB of index per archived carry, so its
  TAR is about 752 MB before that day's other data changes. Until a copy
  verifies, that carry simply stays hosted.

## Independent verification

```sh
node .github/scripts/financial-audit-archive.mjs verify-history --full
```

It reads live `publication.json` anonymously, checks that every hosted receipt's
`evaluation_projection`, `source_projection` and `source_base` is hosted or
archived with the same hash, and downloads and canonically decodes every archive
entry (`--orphans` additionally lists reserved releases with the read token).

The same check by hand for one entry:

```sh
site=https://kusennjp1-ai.github.io/screener
path=static-data/financial-corrections/carry-projection-<S>.json
curl -fsS "$site/publication.json" > publication.json
jq -r --arg p "$path" '.financial_audit_archive.files[$p] | .url, .encoding.sha256' publication.json
curl -fsSL -o carry.json.gz "$(jq -r --arg p "$path" '.financial_audit_archive.files[$p].url' publication.json)"
sha256sum carry.json.gz          # must equal .encoding.sha256
gzip -dc carry.json.gz | sha256sum   # must equal <S>, the hash in the file name
# Every receipt listed for the entry is hosted and names the same hash:
for r in $(jq -r --arg p "$path" '.financial_audit_archive.files[$p].receipts[]' publication.json); do
  curl -fsS "$site/$r" | jq -r '.evaluation_projection | "\(.path) \(.sha256)"'
done
```

`gzip -dc` is more permissive than the publisher's canonical decoder; the CLI is
the authoritative check.

## Tests

- `.github/scripts/financial-audit-archive.test.mjs`: schema, rules a-d with a
  property test against the original check, canonical decoding, anonymous
  bounded downloads, listing pagination and fallback, prune guards, admission
  (drop, keep, fail closed, caps), receipt binding, uploader state machine and
  the independent verifier, against an offline Releases fake.
- `.github/scripts/financial-audit-archive-lifecycle.test.mjs`: the real
  publisher and archive CLIs over packed R0 → C5 publications, including a
  tampered copy, an older-workflow run, a lost copy, and a published-input run
  whose ordinary calendar replay agrees after omission.
- `.github/scripts/financial-audit-archive-workflow.test.mjs`: permissions, token
  scope, step order and repository-wide reserved-tag mutations.
- `.github/scripts/test_release_asset_cleanup.py`: the real cleanup program with a
  fake `gh`.
- `financial-postcapture-pages-rehearsal.yml` uses pinned pre-archive inputs
  without an index, so its offline recheck makes no archive calls. A future
  rehearsal pinned after this change needs an offline archive stub.
