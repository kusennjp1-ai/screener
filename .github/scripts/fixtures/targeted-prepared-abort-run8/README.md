# Closed run8 prepared/no-provider abort proof

Historical evidence only. This directory is not an execution request or an
activation. It binds run 39013437787, attempt 1, number 8, head
49ca70d2c09dac84ce2ae1100617f9aba3a78527, tree
19d995aaa270712f015a5a5e6b47f23522a110fb, job 117340568549.

`job-log.json` preserves the full log as base64. The complete job log is 84,586 bytes, SHA-256
37a202f5d7d992b2f61f154715ffd4758f9e2a652c3ecb65805019c9bbd7f1b0.
The spent request is byte-identical, SHA-256
13bbc9b0edff90a99f28d111bab483c0f61c9f2efc4f739548dff1e859b08d63.
The terminal job API reports completed_at 07:41:58Z. The final Complete job step
ended 07:41:53Z; those are distinct observations, not interchangeable clocks.

The retained artifact is not empty: ID 12093719779, 29,737,343 ZIP bytes, SHA-256
3518d1a73c0ec4999fdaa67d6deafd7a19157e69a15f5a184b645aa1cf9c34f5.
The ZIP is deliberately not committed. Runtime requires this fixed artifact's
exact metadata, exact size and actual byte digest. Its bounded download uses
private exclusive file output, a child-local file-size limit, a 60-second timeout
and unconditional cleanup. A metadata digest, audit flag, missing batch, fake
completed phase, member-only comparison or test report cannot substitute for
those actual bytes. An unavailable, expired or edited ZIP fails closed.

The independently reviewed ZIP contains 8,448 members. The prepared cycle still
binds source4 manifest 2593d2c737724da007a72091b7b85d6007530e0fb6fc7e4e0765d75692b007d0.
All 8,431 archive files, 8,417 objects, 4,154 receipts, 4,182 attempts and 1,894 cohort
members/order match source4. The original inputs and replayed plan/cache remain
exact. There is no batch and no new getter/transport. Initial invocation at
07:35:31.877Z and provider invocation at 07:41:41.937Z differ only in their actual
authenticated_at clocks. The immutable Python cycle's guard at line 363 raises
before its sole collector call 375. Full log, code control flow and audited exact
retained bytes jointly establish this closed prepared/no-provider case.

activation.commit and git-trees.json bind code-proof.json's exact caller, Python
cycles, workflow and spent request files to the immutable run8 head. The small
retained cycle/invocation fixtures and audit-result.json document the reviewed
byte content; no audit result is accepted as runtime authority. terminal.json is
an offline projection of the recorded API identity/job/artifact fields. The
artifact inventory's total_count is reconstructed from its single recorded
artifact for the offline fixture; runtime independently requires GitHub's full
bounded inventory count and list to agree.

Only v5 run9 → prepared-abort8 → abort7 → abort6 → abort5 → source4 is added.
Every historical run/log/request/empty artifact proof remains required. Source4
remains the original completed source restored and fully validated by Python;
its artifact creation interval is bounded by its true successor abort5. There
is no recursive recovery, generalized skip, provider retry or source8 restore.

Offline proof tests:
node --test .github/scripts/verify-statement-pre-provider-abort.test.mjs

Authentic offline integration requires the independently downloaded ZIP:
node .github/scripts/verify-statement-prepared-abort.integration.mjs /path/to/artifact.zip

The integration reads the supplied bytes locally, authenticates the closed
chain using recorded API/log fixtures, and tests corrupt ZIP/rebound source
rejection. It performs no GitHub or provider request and makes no runtime claim.

Sources:
https://github.com/kusennjp1-ai/screener/actions/runs/39013437787
https://github.com/kusennjp1-ai/screener/actions/runs/39013437787/job/117340568549
https://github.com/kusennjp1-ai/screener/commit/49ca70d2c09dac84ce2ae1100617f9aba3a78527
