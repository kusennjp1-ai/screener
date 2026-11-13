# Round 3 evidence (not for merge)

This branch keeps the round 3 audit record. It is meant to survive the sandbox, not to merge into main.

- `round3-plan-full.md`: the full plan. `docs/round3/plan.md` is its summary.
- `reports/`: the snapshot builder's, the four personas' (audit-*), the four skeptics' (verify-*) and the planner's return texts, copied verbatim from the workflow journal.
- `diffs/`: p2's proposed fixes. `fix-a` covers the CIK normalization and its tests; `fix-b` covers the coverage report.
- `scripts/`: the snapshot rebuild scripts and each persona's and skeptic's analysis scripts.
- `MANIFEST.md`, `README.md`: the snapshot's inputs (asset ids, sha256) and how it was built.

Large data (the feature-run bundle, the price bundle, the rendered PNGs) is not committed. Paths inside the texts point at the session scratchpad, which no longer exists after the session.
