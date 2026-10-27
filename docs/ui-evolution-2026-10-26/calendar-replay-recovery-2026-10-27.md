# Release replay recovery

The UI and Design checks for `c36b1ff9a6c16562a23293efd354abee6d65c30f`
passed, but [Release 40424119543](https://github.com/kusennjp1-ai/screener/actions/runs/40424119543)
stopped before deployment with `Ordinary calendar independent target base changed`.
Those check results did not constitute a successful publication.

## Cause and correction

The market exporter resolved its committed dated source against the process
working directory. Normal preparation ran inside the selected frontend checkout
and found its October 23 seed. The independent replay intentionally ran the same
compiler from an empty scratch frontend directory and did not find that seed.
Its derived market series and manifest reference therefore differed. The carry
target binds the complete manifest bytes, so the strict target comparison
correctly rejected the release even though the stock rows were unchanged.

The exporter now resolves the fallback relative to its selected module. An
exact-date source in the authenticated data bundle still takes precedence.
An unrelated working directory cannot supply or replace the selected seed.

The calendar compiler proof also binds `frontend/data` in its tracked/untracked
cleanliness check and its reference inventory. Separate `ibd_reference/` and
`frontend_data/` namespaces retain every reference hash without path collisions.
The existing proof schema and compiler keys are unchanged; older selected UIs
may have no frontend data directory. Independent target, complete baseline,
source inventory, raw-price, clock and publication-authority comparisons remain
in force. No financial or performance gate was relaxed.

## Verification

- Export, source restoration and packed-reader tests: 15 passed. They include
  identical source/derived/manifest bytes from a foreign working directory with
  a spoofed local seed, and exact-date daily-source precedence.
- The lifecycle fixture now optionally includes breadth and the actual dated
  seed calendar. Its old default calendar ended October 16 and did not exercise
  this October 23 path. The default fixture behavior remains unchanged.
- The new ordinary lifecycle exercises preparation, independent composition
  and recheck with the real committed source: 280 observations per index and
  63 put/call observations. Modifying the selected seed is rejected before
  preparation.
- All eight ordinary calendar lifecycle tests passed in a native Linux
  snapshot (94 seconds), including packed input and strict tampering checks.
- A separate disposable snapshot restored only the old working-directory
  lookup. The new lifecycle regression then failed at composition with the
  exact release error, `Ordinary calendar independent target base changed`.
  Restoring the fix passes; the comparison was not bypassed.
- Targeted lint, Node syntax checks and `git diff --check` passed.

Native lifecycle and counterfactual results are recorded in the task workspace
under `work/calendar-recovery-*.log`. Fresh CI, capture validation and an actual
successful release are still required; this note is not publication evidence.
