# Recovered disabled next-200 baseline

This documentation was reconstructed after the workspace reset on 2026-10-07. It is not the original prose from local base c19ab4f0. The authoritative recovered inputs are the unchanged Library ZIP a8569adf8285a7e3ff37ec0df1307c5d1f8001d1545d21625b857039badf0fef and its accepted guard patch 911315c92c4c82e87ae0b0fa19c190e0b4bef87ea6a441dd9abcb049536f3655.

The recovered runtime and review metadata remain disabled. Execution has no run number, all four missing-prior decisions remain retry_decision_required, and no provider visit or publication is authorized. The consumer queue, original receipts, observation times, finite admission window, getter/request caps, pacing, zero retries, and finalization reserve are unchanged.

The new diagnostic integration is explicitly based on commit 22548890d0fe161edf7be3943b1775c4f293d0d9, tree 8245b42cdff76c1fe51c652227a0eb8d6809cf63. It preserves that base's admitted historical source authority. The old local base and final offline-CI commit were lost; this is not a claim to have recovered their exact Git objects or reproduced their prior test results.

That base does not contain several support modules that existed in the old local baseline. The recovery manifest lists every unresolved dependency. Its offline runner fails before testing or restoring anything while those dependencies remain unresolved. The statement-baseline validator must be recovered or replaced through a separately reviewed implementation; its security checks cannot be inferred from the recovered queue alone.

The all-active-run observer is unchanged and remains a snapshot, not a shared lock. Actual acquisition still requires independently reviewed race-free exclusion, the four real one-visit decisions, fresh source/companion/predecessor authentication, exact future execution identity, target-runtime CI, physical capacity, artifact verification, and separate publication review.
