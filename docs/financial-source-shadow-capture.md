# Financial source capture: bounded shadow stage

This stage records evidence alongside existing scalar values. It does not enable
current-use projection, change financial calculations, repair legacy units,
substitute sources, rank a new cohort, or refresh any vendor data by itself.

## Instrumented paths

`YFinanceService.get_fundamentals`, `get_quarterly_growth`, the bulk sequential
and parallel fundamentals paths, and snapshot Yahoo hydration use the shared
`financial_source_capture` helper. Captured fields are:

| Origin | Fields | Existing output unit |
|---|---|---|
| Yahoo `financialData` | `profit_margin`, `roe`; bulk also `revenue_growth` | Single-symbol margin/ROE retain fractions; bulk retains percent points, rounded to two decimals |
| Yahoo quarterly statement / cadence calculation | `eps_growth_qq`, `eps_growth_yy`, `sales_growth_qq`, `sales_growth_yy` | Percent points |
| Yahoo annual statement / existing EPS calculation | `eps_5yr_cagr` | Percent points; the existing turnaround/negative-EPS rules are recorded, not replaced |
| Yahoo quarterly statement / existing EPS calculation | `eps_q1_yoy`, `eps_q2_yoy` | Percent points, with existing clipping/rounding |
| Existing EPS raw-score calculation | `eps_raw_score` | Derived score, bound to all actual input observation IDs; no observation clock of its own |

The arithmetic helpers opt into `_financial_source_context`; their default
return dictionaries and numerical behavior remain unchanged. Context records
the actual metric row, selected columns, period dates, input values, cadence,
formula version, rounding and clipping. Q1 uses columns 0/4, Q2 uses 1/5.
The EPS positional calculations also retain all intervening period dates and
actual day gaps. Only quarterly-spaced columns with a one-year comparison carry
`quarterly_eps_yoy/v1`; semiannual, irregular and undated comparisons keep the
legacy scalar but use `positional_eps_growth/v1` and their actual/unknown cadence.
Annual CAGR retains the selected original fiscal dates before reducing to years.
HK/JP comparable-period remapping remains explicit in its basis and metadata.

## Provider adapter boundaries

The provider-plan executor preserves its original key-existence fallback rule:
a present key, including `None`, blocks missing-only fallback; other overlays
still skip incoming `None`. Evidence follows the selected owner of each key,
including equal zero/negative values. Losing envelopes and captures remain raw
context. The Finviz EPS supplement selects Yahoo EPS evidence only; an unused
Yahoo profile observation cannot certify an equal Finviz margin or ROE.

Supported case/whitespace identities are resolved on temporary evidence inputs,
while public scalar payloads retain their original spelling and choices.
Unsupported or conflicting shadow identities retain unverified diagnostics and
never turn a successful scalar fetch into a provider failure. Observation
identities are never rewritten, and the core merger still rejects different
security payloads.

## Acquisition boundaries and limitations

The reviewed vendor contract is exactly `yfinance==0.2.66`. Its process-wide
`YfData.cache_get` LRU can return an old response to a newly constructed Ticker.
Passive, idempotent `get`/`cache_get` wrappers therefore preserve the original
successful response receipt. Calls forward their original arguments exactly,
preserve cache inspection/clearing methods, make no extra request, and do not
alter retries or exceptions. A `ContextVar` isolates each producer's receipts.

Existing cached responses without a receipt, cached getter data without retained
matching evidence, unreviewed versions/signatures and unresolved identity
aliases remain unknown. The provider symbol must resolve to the same canonical
security and market as the requested identity. A source subset must match the
getter's actual metric/date/value cells. Upstream errors, contradictory response
symbols/types, unsupported metrics and ambiguous info-field ownership cannot
produce observations, even if two sources contain equal numbers.

Only recognized quoteSummary, quoteResponse and income-timeseries paths are
inspected. Info proof requires both expected valid info responses and exactly
one field origin in `financialData`. No request URL, query token, cookie or
header is retained. Receipts retain bounded financial subsets: responses over
4 MiB, subsets over 128 KiB, over 500 result rows, over 64 periods/points, unknown
EPS/revenue metrics or non-three-letter currency codes are left unverified.
The 16 reviewed EPS/revenue metric names are explicit in the helper. Shared
capture payloads are hoisted once into the evidence envelope; each field binds
their digest and capture ID. A transport digest is not a vendor revision.

Finviz `screener_view` paginates internally without exposing per-page receipts.
Snapshot category windows (`started_at`/`completed_at`) are diagnostic only;
their end time never becomes a field observation. Raw category labels, including
`EPS Y/Y TTM` and `Sales Y/Y TTM`, remain in snapshot raw payloads. Finviz fields
remain unverified and are not declared equivalent to Yahoo statement YoY.
Direct Finviz-service capture, other market adapters, `annual_eps_growth_3y`,
and EPS/SMR/Composite cohort lineage are outside this bounded implementation.

Yahoo statement refresh summaries are emitted only when actual observed
financial fields exist and use the oldest included source clock. Individual
records retain their own clocks. A profile getter completion is explicitly
named `yahoo_profile_fetch_completed_at`; it is not an acquisition timestamp.
Empty/swallowed failures do not create observations or statement success clocks.

## Snapshot transport

Weekly export preserves optional raw payloads and the complete evidence envelope.
The historical `row_hash` is retained separately from `export_payload_sha256`,
which binds the enriched normalized transport payload. Import checks that digest
before canonicalization and validates supported nested evidence. It preserves
the original observation identity and clocks; canonicalization cannot rewrite
them to certify a different security. Legacy bundles without these optional
fields continue to import as legacy data. Export does not mutate source rows.

Current-use activation, consumer/export parity, manifest age-policy changes,
historical-retention policy changes, whole-universe replay and publication remain
separate work. No claim of live source validation or restored current coverage is
made. Tests use synthetic fixtures, real pinned vendor normalization with its
transport stubbed, and hard network-denial fixtures for the vendor contract.
