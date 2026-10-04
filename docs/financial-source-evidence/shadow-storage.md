# Financial source evidence: shadow storage

This slice captures and stores lineage. It does not enable source-age masking,
change provider fallback preference, recalculate ratings, rewrite historical
scans, or authorize publication. Apply migration `20261003_0026` before starting
these writers. Existing rows keep SQL NULL evidence until they are next read or
written; reads expose diagnostic unknown lineage without writing it back.

## Pure helper API

`app.services.financial_source_evidence` provides:

- `make_capture_context`: explicit source acquisition timestamp, security,
  producer, provider identity, source subset and optional provider revision.
- `make_observed_record`: finite field value, unit/basis and field-specific period
  details. Source clocks cannot come from import, merge or calculation time.
- `make_derived_record`: dependency observation IDs, algorithm version and a
  separate calculation time; observation time is always NULL.
- `make_envelope`: hoists source subsets into `captures[capture_id]`, once per
  acquisition. Observation records bind the capture ID and subset digest.
- `merge_financial_payloads`: the prior per-key non-null-primary scalar merge,
  including legacy aliases. No freshness substitution occurs. Contradictory
  aliases cannot qualify selected lineage. Explicit new uninstrumented numbers,
  including an equal number, replace the selected evidence with unknown lineage.
- `validate_envelope`: validates JSON, bound record digests and source subsets.
- `restore_retained_raw_envelope`: reconstructs a retained original envelope
  using references within the same JSON object. No external archive is needed.
- `project_current_financials`: a pure, unused review/test seam. Stage 1 has no
  approved semantic contracts. Its seven-day observation policy is separate
  from weekly artifact or reported-EPS age policies. EPS/SMR/Composite ratings
  always remain unknown in this optional projection. Production values are raw.

Shared cases are in `contracts/financial_source_evidence_v1.json`.

## Retention and malformed legacy data

Original producer envelopes and legacy contexts remain reconstructible.
`retained_raw_envelopes` uses `inline-capture-references-v1` where needed to refer
to the shared source-subset pool. Cumulative merge outputs are not recursively
archived. Selected and losing observations are deduplicated by their observation
ID. Operational `storage_revision` is excluded from source archive identities.
Rare conflicting capture IDs preserve both source subsets in
`retained_capture_variants` and cannot certify a selected observed record.

Malformed JSON-shaped envelopes are retained as diagnostic originals; invalid
records never attach to values. Legacy NaN/infinite scalars keep their prior
in-memory behavior, but are ineligible observations. Their audit JSON uses an
explicit `non_finite_number` diagnostic object, never a numeric string treated
as a financial value. New observation constructors reject non-finite numbers.

A deterministic synthetic one-field sequence measured 51,478 bytes for 20
captures and 252,928 bytes for 100 captures (compact JSON). Each source subset
occurs once, with 20/100 candidates and 40/200 retained source/context artifacts.
Repeated identical merges and operational revision changes add no archives.
Retention remains linear and grows with distinct observations; it is deliberately
not capped or pruned without an approved durable archive. These full envelopes
belong in detail/snapshot storage, not compact list rows. Actual producer/weekly
artifact budgets still require integration measurement before activation.

## Atomic storage and cache publication

The nullable JSON column and existing scalar columns commit together. Missing
or NULL incoming scoped fields retain the stored pair. Finite incoming values
without a matching observation become diagnostic unknown; they cannot inherit
an older observation just because the number matches. The old provenance map
keeps its independent existing meaning.

SQLite uses `BEGIN IMMEDIATE`; PostgreSQL uses a deterministic per-symbol
transaction advisory lock. Both serialize read/merge/write, including concurrent
first inserts. `storage_revision` increments under that lock and is an operational
generation, never a source observation or vendor revision. Imported generations
are ignored.

Redis publication follows a successful database commit and read. A short new
transaction takes the same lock, verifies that the candidate generation and
financial pair still match the committed row, then publishes with the existing
seven-day TTL. A delayed writer cannot replace a newer pair. Commit failure
publishes nothing; Redis failure leaves the previously cached snapshot unchanged.
There is no persistent Redis generation authority, so a rebuilt/restored DB row
with a lower revision can refill normally. Normal DB restore procedures should
invalidate pre-restore cache data; the existing TTL remains the safety bound for
untouched cache entries, and source clocks are never renewed.

New cache keys use the `financial-source-v1` suffix. Explicit invalidation removes
both the new key and legacy scoped/unscoped keys. Old cache keys are not read.
Both DB serializers reconcile the actual scalar against the envelope, so old
writers that update a scalar without its evidence produce unknown lineage on a
subsequent DB read. This does not retroactively observe an old writer or guarantee
cross-process ordering for unsupported writers that bypass these locks.

## Verification limits

Focused SQLite tests cover migration of an old DB, idempotent upgrade for a new
DB, downgrade preserving raw values, single/bulk/cached-only/Redis parity,
concurrent partial writes, source subset hashes, field/identity/period binding,
commit and cache failures, delayed cache publication, DB rebuild and malformed
legacy inputs. PostgreSQL coverage is included as
`test_postgres_advisory_lock_serializes_concurrent_source_pairs`; it requires the
existing PostgreSQL CI harness and is skipped under SQLite. No local PostgreSQL
server was available in this executor.

The unrelated existing price-cache fallback test
`test_price_cache_batch_pipeline_fallback_preserves_market` fails identically
at the untouched base commit `bf41dd288ccb92fbe005f29b04048723adf725fa`; no price
cache behavior is changed here. Full backend/frontend CI and production data
activation are separate gates.
