# Independent validation of the exact retained run 4 artifact

This add-only review branch validates an existing source artifact. It does not
run the collector or change the original acquisition outcome. The source job and
run remain failed; their completed batch and cycle remain exit 0.

## Exact source and scope

- Producer: `kusennjp1-ai/screener`, Financial Statement Recovery run
  `37478731832`, attempt `1`, job `112320966070`, source commit
  `4715b218cc25720d1d3be455930554e1e6282136` and tree
  `311974ac309e994c01b246dcaa95f11ab16545d3`.
- Artifact `11420873789`, 33,424,519 bytes, SHA-256
  `266b2118cefe4a51dcf0981b4e60c35ba76524e1f35cf9633f8c26691f68d2bd`.
- Every one of the 10,055 captured file paths, sizes and hashes is bound by a
  committed inventory and the closed request. All 400 new receipts and their
  successful getter attempts are checked against the previous cumulative
  manifest. The 3,354 unselected current slots remain unchanged.
- New observations span October 6, 2026, 14:26:52.131–14:39:19.799 UTC. Current
  evaluation time never renews those observations. Original October 4 receipts
  and the original October 2 price/base/cohort bytes are retained.
- Cohort and identity semantics remain unchanged: the original price cohort has
  1,894 symbols; financial applicability excludes BITU/ETHE/SBIT. Existing
  symbol/provider-symbol/US identities do not assert newly verified CIKs.

The original final retention check reported an unowned addition. Exact writer
reproduction shows that the hidden empty archive lock is created after the
baseline when restored artifacts omit it. A separate repaired shadow replay
preserves every uploaded file and passes the unchanged guard. This is reproduced
attribution. The failed-run log did not name the path, and the full original
runtime hidden-file inventory was not uploaded. The companion cannot attest
that no other unuploaded entry existed or claim the original final guard passed.

## Finite authority and code binding

The dedicated workflow runs only on a push to
`preview/financial-source-postcapture-validation`. It has contents/actions read
permissions, no manual dispatch or schedule, and no provider credentials or
publication step. Its current attempt must be 1, its commit's first parent must
be deployed main `8a490df5b0a873637781a8e4e5351cece9313f37`, main must remain at
that commit, and the source branch must remain at the exact producer commit.
The local review base is `42550214e5ec0a3844cb9271e86b53be5ba5e24e`; its tree
`00a8eaa6b14b977f31f24ac9f708872c2dbe5ee9` equals that public main. A remote
review commit must use the actual public parent, not manufacture this ancestry.

The Node reader authenticates the current validator run/job/commit/tree and
source run/job/artifact, rejects incomplete inventories and overlapping recovery,
and requires the one known failed step. It downloads only the exact GitHub ZIP
and original job log, with byte caps and hashes, then rechecks immutable source
and validator identities. Its GitHub token is scoped only to that retrieval
step. The existing production source restore helper is unchanged.

The Python adapter checks the closed request and output schema, the full captured
inventory, original retention and journal differences, exact log and diagnostic
bindings, and the official validator code-tree blobs. It installs offline socket,
subprocess, HTTP, curl and yfinance acquisition guards before importing the
frozen financial verifier. The 40-file frozen closure is copied byte-for-byte
from reviewed commit `16145829c9f06a51a5404a4044229b32b638c3c6`, tree
`16accf63ff4caef0da2adae8f4f9bbe46c913886`; its original 18-file policy digest
remains `9c8de1e4d17b737f85db68fb9a031e24649134651b0cb01689a2f64e41c50114`.
Existing financial formulas, source age rules, historical migration rules and
unknown classifications are reused unchanged.

The original v1 full certifier is also called and must retain its rejection:
“Producer conclusion must retain actual cycle failure.” The companion instead
records independent validation of the retained bytes. Its own running job cannot
attest its eventual successful conclusion; a later reviewer must authenticate
that actual terminal result and output artifact separately.

## Validation and retention

The workflow uses Python 3.11 and Node 22. It runs the closed identity/clock/byte
negative tests, restores the exact source, then invokes:

```sh
python .github/scripts/validate-postcapture-source.py \
  --source-zip "$RUNNER_TEMP/postcapture-source/source.zip" \
  --api-evidence "$RUNNER_TEMP/postcapture-source/api-evidence.json" \
  --job-log "$RUNNER_TEMP/postcapture-source/job.log" \
  --output "$RUNNER_TEMP/postcapture-reports/companion"
```

There is no command-line clock, request, trust or verifier override. Evaluation
uses actual UTC. Receipt/source histories remain immutable; expired fields stay
unknown under the unchanged projector. Tests may inject direct test-only
functions and synthetic validator metadata, which do not establish a real
independent GitHub result.

On failure or success, the workflow retains diagnostic reports, original source
API/log evidence and any completed companion output for 14 days. It does not
reupload the original ZIP as a new producer or erase the failed run. The original
artifact remains separately retained in its existing GitHub and recovery backup
identities. The 25-minute job cap and source archive byte/member caps are not
raised.

## Remaining admission boundary

This companion grants no source admission, qualification, publication, provider
work or renewal authority. Existing v1/v2 schemas, source inventories, policies,
pins, release intents and publication readers are unchanged. The current
controller cannot consume this new receipt as a v1 certificate. Any future use
requires a separately reviewed finite controller/schema route, exact source and
validator-code admission, an independently authenticated successful validator
run and artifact, and the normal subsequent publication gates. No source
reacquisition is needed to validate these already captured observations.
