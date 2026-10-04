# Static current proof, version 1

`static_financial_evidence` adds metadata to public static exports. It does not
project or null their existing scalars, change scanner classifications, query
vendors, write a source observation, modify stored history, or activate live API
or SQL behavior. This sequencing lets an older approved UI receive a data-only
refresh without changing its behavior. Current-value withholding belongs to the
separately reviewed compatible static frontend.

## Boundary and representation

The canonical registry is `contracts/static_financial_current_v1.json`; Python
constants are checked against it in tests. `financial_current` has:

| Key | Meaning |
| --- | --- |
| `v` | Supported summary version, currently 1 |
| `t` | Static export evaluation instant, integer UTC epoch milliseconds |
| `s`, `m`, `a` | Exact symbol, canonical market, artifact as-of date |
| `r` | One reason character for each of the existing 16 canonical fields |
| `p` | Available proofs keyed by the canonical field's decimal index |

Each proof is `[value, contract_id, metric, periods_newest_first, observed_ms,
expires_ms]`. The fixed contract ID binds source, producer, basis, unit and
cadence. The value is the original finite number, including zero and negative
values, without a transport-specific rounding step. The period chain contains
every selected quarter/year needed to exclude gaps, not only endpoints.

Python calls the existing strict envelope validator before semantic checks.
This verifies observation digests, retained source-subset digests and exact
envelope/observation identity. Selected values, aliases, actual metric cells,
provider identity, retained currency, periods and existing arithmetic are then
checked. Arithmetic is recomputed only to validate the recorded result; export
values are never replaced. Any unsupported/malformed input remains unknown.

This summary is a trusted static-export assertion, not a cryptographic signature
for untrusted third-party metadata. The browser must require the supported
version, exact row value and `{s,m,a,t}` snapshot binding, consistent reason/proof
membership, valid contracts/periods, and its own evaluation time in the permitted
interval. A late detail/cache merge cannot borrow another symbol, market, as-of
date or export generation's proof. Missing/old summaries must fail closed. The
browser must not attempt to reconstruct Python's JSON hashes: `1.0` and `1` have
different Python serializations despite being the same JavaScript number.

## Bounded semantic approval

Only these concrete PR69 source-capture paths qualify:

- Yahoo quarterly statements, `quarterly_qoq/v1`, for EPS/sales QoQ
- Yahoo quarterly statements, `comparable_period_yoy/v1`, for EPS/sales quarter YoY
- Yahoo quarterly statements, `quarterly_eps_yoy/v1`, for Q1/Q2 EPS YoY, with the
  captured exact positional comparison and complete quarterly chain
- Yahoo annual statements, `annual_eps_cagr/v1`, for positive-EPS CAGR only

All use `percent_points`, an explicit supported EPS/revenue metric, and one
retained statement currency. Basic and diluted EPS remain explicitly identified
by the proof's metric; no Finviz TTM or independent reported-EPS equivalence is
inferred. Annual turnaround/negative-EPS heuristics retain their original raw
values but do not qualify as positive CAGR. Semiannual, annual or irregular
positional comparisons cannot certify a quarter field. Remapped HK/JP comparable
period values cannot qualify as QoQ.

`annual_eps_growth_3y`, info-only revenue growth, margin and ROE have no approved
period-complete contract in this capture stage. They remain references. The
derived raw EPS score and EPS/SMR/Composite ratings remain unverified regardless
of source age; this helper never reranks a cohort or renormalizes a rating.

## Existing age policy interpretation

The existing source age remains seven days, inclusive at the exact boundary.
The existing reported-history limits of 190 days for a latest quarter and 550
days for a latest annual period are also used as conservative reporting-period
limits for this static proof. Both the artifact as-of date and actual evaluation
UTC day must satisfy that bound. Each field uses its own latest period: Q2 does
not borrow Q1's reporting date. Its expiry is the earlier of source acquisition
plus seven days and the final millisecond of its latest-period-plus-age UTC day.
Future source timestamps or reporting dates fail closed.

Cadence gaps reuse the existing producer bounds: 70–130 days for growth-cadence
quarters and 70–110 for EPS-rating quarters. Quarter YoY requires exactly four
consecutive quarter steps. The narrower existing `financialHistory` 345–385-day
year comparison also applies to YoY endpoints and consecutive annual periods;
the capture's broader candidate search alone does not establish current quarter
equivalence. No new financial threshold is introduced.

Independent `financial_history` keeps its own 72-hour, period, currency and basis
policy. This module does not read it, substitute it into quarter metrics, or
populate SEC/book evidence. The weekly artifact age policy is unchanged.

## Raw retention and export surfaces

Full scan payloads and on-demand chart/detail payloads retain the original source
envelope. Additive `financial_reference = {v,s,m,a,values}` records original
scoped values and aliases with their original JSON types; missing unit metadata
is never replaced with a percent label. The compatible frontend's compact list
and research-index serializers keep only compact proof, while historical raw
values and full source records belong in detail/snapshot storage.

Scan chunks, previews and initial rows get the same proof. Chart scan rows and
independently cached fundamentals are validated separately; equal numbers are
not evidence ownership. Verification-only chart exports get the same metadata.
Group constituents carry the subset of proof matching fields actually exported
after the shared API schema has serialized them. Legacy group rows without
evidence receive unknown metadata. Historical group ranking entries are intact.

## Validation and transport gates

Shared fixtures include fresh/expired/missing/future source and periods, tampered
hashes, mismatched identity/value/unit, gapped/semiannual/positional reporting,
unapproved TTM, zero/negative values, derived scores and exact expiry boundaries.
Additional tests exercise JSON-shaped malformed metadata and huge numeric inputs,
source-normalization/cache clocks, independent chart evidence, and byte/value
equality of every legacy scan artifact field with metadata removed. Shared live
API models remain unchanged.

The implementation's focused offline run passed 250 tests with two PostgreSQL-
only skips across source, producer, transport, adapter, cache, snapshot and static
export suites. After adding annual-boundary fixtures, the final helper/export
seam run passed all 39 tests. The real `yfinance==0.2.66` normalization test uses a
stubbed transport with network denied and confirms cached receipt clocks cannot
be refreshed by import/build timestamps. No live-provider or PostgreSQL claim is
made; compatible frontend activation and complete integration remain separate
gates.

The retained 5,901-row research index has no eligible source proofs. With compact
unknown metadata, the unchanged table encoder measured 3,798,187 raw and 968,007
gzip bytes (original artifact: 3,749,954 / 966,268). This does not establish future
high-availability headroom: a synthetic seven-available-fields-per-row tuple
stress exceeds the unchanged 8 MB raw / 1 MB gzip limits. The compatible frontend
must pass those same limits with proof-aware dictionary transport and the
producer-certified 5,901-row stress before activation. Full raw envelopes must
stay outside the compact index. No budget increase or publication is authorized
by these tests.
