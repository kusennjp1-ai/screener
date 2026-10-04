# Bounded financial statement artifacts

`python -m app.scripts.capture_financial_statement_batch` (from `backend`) runs
an explicitly selected batch and writes a new local artifact directory. It does
not select securities, publish assets, edit workflows, contact a second provider,
write a database, or change financial thresholds. Use the pure refresh planner
separately to choose work.

## Bind the plan before running

Supply `--plan`, `--base-artifact` and `--output-dir`. The original base artifact
must contain `as_of_date` and a `rows` or `results` array. Cohort securities must
have explicit `market: "US"` on their rows or inherited from the artifact. A US
listing, including an ADR, does not imply USD reporting currency.

```json
{
  "schema_version": "financial-statement-batch-plan-v1",
  "verified_us_cohort": {
    "symbols": ["NVDA", "AMD"],
    "base_artifact_sha256": "<SHA-256 of the exact base artifact bytes>"
  },
  "batch_allowlist": ["NVDA", "AMD"],
  "evaluation_time": "2026-10-04T11:00:00Z",
  "required_valid_through": "2026-10-05T11:00:00Z",
  "source_data_as_of": "2026-10-02",
  "selected": [
    {"symbol": "NVDA", "attributes": ["quarterly_income_stmt", "income_stmt"], "targets": ["annual_history"]},
    {"symbol": "AMD", "attributes": ["income_stmt"]}
  ]
}
```

`required_valid_through` carries a planner's maintenance horizon (defaulting to
plan evaluation for older plans). Optional canonical `targets` identify `eps`,
`sales` or `annual_history`. Selected annual-history work must include both
attributes and both original receipts must remain within 72 hours through that
horizon. Proof-only quarterly work retains its seven-day policy. A currently
fresh receipt that will expire before the explicit horizon is reacquired as
`renewal_due`; other valid attributes are reused. The horizon cannot exceed the
selected source's existing maximum age. Results disclose per-attribute required
validity and any remaining limitation, without extending any clock or TTL.

The selected list and explicit allowlist each contain at most 200 unique canonical
US symbols. `BRK-B` is canonical; lower-case, whitespace, `$` prefixes, foreign
suffixes and dot-form aliases are rejected. The collector checks the base digest,
cohort membership, source as-of, evaluation timezone and selected attribute order
before constructing a session or ticker. It accepts only the pinned yfinance
0.2.66 transport signatures. `--dry-run` validates inputs and trusted cache without
creating provider objects or output files.

The plan evaluation is the selection clock, which cannot be in the future. Each
result also records its actual evaluation clock after acquisition. Both bind to
the plan's source-data as-of. The acquisition timestamp is always the original
transport receipt, including on resume. No observation is promoted to a fact
known at the historical price snapshot; publication dates remain unknown.

## Artifacts and resumability

The directory contains `plan.json`, `attempts.json`, `cache-manifest.json`, sanitized `transport/`
receipts, original `acquisitions/SYMBOL-ATTRIBUTE.json`, `envelopes/SYMBOL.json`,
`results/SYMBOL.json`, and a bounded `summary.json`. Full HTTP bodies are not saved;
reviewed EPS/revenue subsets and full-response hashes are saved. Endpoints omit
query strings, credentials, headers and cookies.

Before each getter, `attempts.json` persists its run-scoped unique attempt ID,
symbol, attribute, original attempt time and `in_flight` state. The journal is
updated to `succeeded`, `failed`, `provider_blocked` or `budget_stopped` after source
preservation. It binds the exact output plan hash; completed summaries bind the
journal hash. An interrupted run therefore leaves an explicit in-flight attempt
for the archive/planner to reconcile rather than silently retrying it.

A getter's raw frames and transport evidence are saved before normalization or
another getter. Each successful source is immediately indexed in the manifest;
each symbol's envelope and result are persisted before proceeding to the next
symbol. A later provider stop, normalization exception or interrupted process
cannot discard those earlier files. The summary contains counts and per-symbol
file hashes rather than embedding the complete proofs for all 200 symbols.

Resume into a **new** output directory using `--cache-manifest` and its explicit
trusted `--cache-sha256`. The new output binds to its new base/evaluation; each reused entry preserves its
`origin_binding` (original base digest and source as-of). Fresh receipts can cross
price-snapshot/cohort generations after current identity, period and freshness
revalidation. The collector verifies each indexed file's hash, original receipt identity/hash/time,
normalized subset, provider subset and full saved frame. Receipt corruption fails
closed before provider construction. Stale valid receipts trigger only the
selected missing/stale getter. Valid cached attributes are reused without a
provider request. No mtime or cache-write time is used as source freshness.

Quarterly receipts expire after seven days; annual history receipts expire after
72 hours. Latest reporting periods must also be current (190 days quarterly,
550 days annual), properly ordered and within the source/evaluation/as-of clocks.
History uses the oldest original receipt included in that history. A quarterly
receipt between 72 hours and seven days can still support quarterly field proof,
but is omitted from the 72-hour history artifact. Existing scalar/proof policies
are unchanged.

To seed a cache from the reviewed three-symbol pilot, copy its original
`acquisitions/` files unchanged into a new trusted cache directory. Call
`index_retained_acquisitions(cache_directory, plan, original_base_bytes)` and
write its returned JSON as `cache-manifest.json` in that directory with
`write_json`. Record the manifest file's SHA-256. This helper validates the
original receipts and returns metadata only; it does not acquire, alter or reclock
sources. Failed or absent acquisitions are omitted, and successful stale ones
remain eligible for freshness evaluation on resume.

## Result interpretation

Only the two statement getters run, sequentially with the existing 1.5-second
pacing and no caller retries. The fail-stop session latches HTTP 403, HTTP 429 or
transport exceptions before yfinance can hide/retry them. Cookie/crumb transport
can add HTTP calls; the fixed bound is at most two statement getter calls per
selected symbol. After a latch, subsequent library calls are blocked before
transport.

Set `--acquisition-budget-seconds` (default 1080),
`--max-statement-getter-calls` (default/max 400) and `--max-transport-requests`
(default 1000) below the enclosing job's timeout. For a 25-minute job, the default
18-minute acquisition budget reserves time to process and upload partial results.
The wall deadline is checked before every getter and transport call, and each
transport timeout is capped to its remaining budget. A timeout at that deadline
is budget exhaustion. Cache reuse and source projection preserve original clocks.

Exit 0 means acquisition/processing completed. Exit 2 means provider stop. Exit 3
means rejected input, capture or processing failure. Exit 4 means acquisition
budget exhausted; `execution_stop` explains which budget and `provider_stop`
remains null. Partial artifacts and the manifest are flushed normally, and a next
explicit run may resume immediately from their valid original receipts. Exit 0 does **not** mean every
financial source is available or a security qualifies. Counts, field reasons and
annual-history reasons in the artifacts express that distinction. A valid
five-quarter source explicitly reports that the second quarterly YoY comparison
needs a missing sixth point. A valid nonpositive comparison base remains a source
valid semantic limitation, distinct from a fetch gap.

`financial_history` uses the existing consumer schema. Annual history requires
four consecutive reported diluted-EPS years for completeness, exact USD source
currency, current periods and the 72-hour original receipt. Basic annual EPS and
non-USD annual sources are explicitly unsupported. Every retained EPS/revenue
number is an unchanged provider cell; missing cells stay missing. No Q4 values,
filing/publication dates, currency conversion or adjusted EPS are invented.
