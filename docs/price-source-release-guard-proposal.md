# Daily-price source promotion: unactivated local proposal

Status: local review only, based on main tree `c0726c56123f3197bd5cdbcdf8c957445fe02013`
(materialized as local commit `1d82a224913d90dbb72e6235689672f9e85362dd`).
No workflow invokes the proposed publisher. No release, provider, dispatch,
schedule, rate limit, refresh budget, or ingestion behavior changes are activated.

## Cause and evidence

[Run 37399803339](https://github.com/kusennjp1-ai/screener/actions/runs/37399803339)
exported a fast, partial refresh and called `gh release upload --clobber` before
the website's later quality gate. The source candidate declared 1,190 fresh of
9,926 active symbols, 4,462 missing and 4,274 stale, with
`min_symbol_coverage=None`. Upload eligibility checked artifact existence, not
a source promotion policy. The frontend rejection therefore did not protect the
bootstrap source release.

The same [build-market log](https://github.com/kusennjp1-ai/screener/actions/runs/37399803339/job/112066812887)
records the imported Oct 2 US manifest: 10,161/10,511 fresh, 34 missing, 316 stale,
`min_symbol_coverage=0.9`, and `allow_stale_complete=False`. This is an observed
declaration for that prior source release. Its generating command and exact
bundle bytes were not recovered in this investigation; it does not establish a
general US publication rule or prove all those histories survived ingestion.

## Existing contracts are distinct

- `build_daily_price_bundle --require-complete` already requires 100% fresh
  symbol coverage when its optional minimum is omitted.
- CN final bootstrap explicitly uses `--require-complete --allow-stale-complete
  --min-symbol-coverage 0.90`. Its denominator is the active CN universe and its
  covered numerator includes stale histories. It is not a 90% fresh-price rule.
- `price_coverage_policy.py` defines US 95% readiness for cache-only workflows.
  That is a separate contract, not a general source-promotion declaration.
- The website's 90% verified liquid-stock-history gate is also a separate
  population and contract.
- General static-site source publication currently passes none of the coverage
  enforcement arguments. Its intended general promotion policy remains
  undefined. This proposal does not select one or inherit the website floor.

## Proposed boundary

`app.scripts.publish_daily_price_bundle` would replace only the two direct daily
price upload commands once a policy and activation are reviewed. It accepts a
candidate bundle, its manifest, the previously fetched authoritative manifest,
and the actual workflow mode. Before any GitHub command it requires:

1. Full refresh mode and export scope covering the active market, not a shard.
2. An enforced, positive coverage floor under the exporter's existing fresh vs.
   stale-allowed semantics; counts must agree with the declared ratio.
3. A known previous source policy, with no lowered floor, no weakening from
   fresh-only to stale-allowed, and no market mismatch/date rollback.
4. Canonical market asset names, the existing schema/bar-period contract, and a
   matching candidate bundle SHA-256.

The only exporter change adds `require_complete` and `symbol_scope` to its
existing bundle/manifest/statistics metadata. Export results, selected symbols,
coverage calculation, price rows, and provider requests otherwise stay the same.
Legacy manifests with a missing floor cannot establish an enforced policy.
New manifests from strict `--require-complete` explicitly establish its existing
100% default, including when used as the previous manifest on a later run.

Rejected candidates remain available locally and all publisher calls are
prevented. Collection and CN shard checkpoint publication remain independent.
For any future workflow activation, archive candidate diagnostics before this
guard and retain the already downloaded prior manifest without changing the
provider request budget. No activation is included here; the current direct
workflow uploads remain unchanged.

This is a coverage-policy guard, not a repair for missing histories or the
Oct 5 bars attached to an Oct 2 feature snapshot. It does not establish the
unknown cause of the 800 missing liquid-stock histories or label the 481
future-bar/date mismatches as malformed OHLCV. It also does not make the existing
two-asset GitHub upload atomic: failure after a permitted first upload remains a
separate publication concern. Prior-release immutability here is proved for
pre-publication validation failures, not arbitrary network failures.

## Offline regression

Run without installing dependencies or contacting any provider/GitHub service:

```sh
PYTHONPATH=backend python -m unittest discover -s backend/tests/unit -p test_daily_price_promotion_guard.py -v
```

The mocked GitHub boundary models both deletion and upload caused by clobber.
The exact incident counts cannot call either operation, and previous remote
bytes plus all local candidate/previous files remain unchanged. Healthy strict
coverage and the existing CN stale-allowed 90% history policy pass. Fast and
shard sources, unknown/unenforced/weakened policies, below-floor candidates,
inconsistent counts, and a bundle digest mismatch fail before any write.

The focused standard-library tests and Python syntax checks are local validation;
the full backend suite, live publisher, and production workflows were not run.
