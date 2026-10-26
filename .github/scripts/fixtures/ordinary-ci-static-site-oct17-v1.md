# Historical ordinary CI workflow fixture

`ordinary-ci-static-site-oct17-v1.yml` is the unmodified Git blob
`5496e4c947e728c4c122b69ac8bd8ce03964d72c` for
`.github/workflows/static-site.yml`, introduced by commit
`539d5400da43e543e0846e537d2e6eb12c9bcdc6`
(“Repair disabled ordinary carry compatibility and authenticate no-export CI holds”).
It was extracted with `git cat-file blob 5496e4c947e728c4c122b69ac8bd8ce03964d72c`.

The dated October 17 ordinary CI controller authenticates this exact blob.
Tests place these bytes in their synthetic historical Git trees so subsequent
changes to the daily export workflow do not alter historical admission proofs.
The fixture does not execute or extend any publication authority. The production
controller's pinned blob, bounded admission dates, and all source, job, artifact,
and parent checks remain unchanged. A regression test verifies that the current
workflow, despite retaining its marker, cannot satisfy that historical authority.

Keep the YAML bytes unchanged; its full Git blob hash is asserted in the tests.
The fixture makes historical tests independent of deep Git history and network
access in fresh Actions checkouts.
