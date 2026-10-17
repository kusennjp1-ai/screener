# Closed run7 pre-provider abort proof

This fixture is historical evidence, never execution intent. It binds only run
38997227416, attempt 1, job 117292325413, head
b6378b8077b51f18d63e6dbb4d221ac47144bee4.

- `job-log.json` preserves the complete 67,609-byte log as base64, SHA-256
  `5ce16137dfe39a063a3f0903031eb93bdb1f792a08dee1549c97bdf3b152ae56`.
- `request.json` preserves the spent v3 request byte-for-byte, SHA-256
  `846a0d2a07e2a43b6eee3837f19dfb01e233866a8b3e1912a57d025d3a043e00`.
- `terminal.json` retains the matching latest/attempt run identities, full job
  and step inventory, and the exact empty artifact inventory.
- `caller.mjs.txt`, `helper.mjs.txt`, and `workflow.yml.txt` are the immutable
  run7 code, not the repaired controller. `code-proof.json` records their blob
  and SHA-256 identities, alongside the request. `git-trees.json` supplies the
  binary Git tree objects that bind each path to `activation.commit`; the tests
  hash the entire proof back to the exact reviewed activation head.

The complete log identifies the failure in initial authenticateRecovery at
caller line 154. The immutable caller puts workspace creation at line 158,
live-publication verifier preparation at line 159, source restoration after
that, and its sole provider-child invocation at line 196. The workflow has one
caller invocation. Thus this terminal failure preceded provider execution; an
empty artifact list alone would not prove that. The generic download error does
not reveal the underlying transport failure cause.

Original read-only evidence:
- https://github.com/kusennjp1-ai/screener/actions/runs/38997227416
- https://github.com/kusennjp1-ai/screener/actions/runs/38997227416/job/117292325413
- https://github.com/kusennjp1-ai/screener/commit/b6378b8077b51f18d63e6dbb4d221ac47144bee4

Only the fixed v4 chain run8 → abort7 → abort6 → abort5 → source4 uses this new
proof. Source4's artifact interval is still bounded by abort5. The reviewed
v1/v2/v3 paths and all acquisition/publication restrictions remain unchanged.
