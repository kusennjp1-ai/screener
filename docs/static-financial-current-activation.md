# Static current financial projection

This bounded activation applies to the public static application. Nonstatic
SQL, API queries, stored historical rows, and old saved candidate/model
observations remain **unactivated**. No financial threshold, rating weight,
source-age policy, or Minervini Research technical rule was changed. Historical
annual/SEC inputs remain independent; reported quarterly history cannot fill a
different legacy growth basis.

The browser accepts only `static-financial-current-v2` compact source proofs,
bound to the exact symbol, market, snapshot, value, source contract, reporting
periods, acquisition time, and expiry. Source/capture digest validation remains
in Python. The browser does not reproduce Python JSON digests. Missing, old,
malformed, mismatched, future, or expired proofs produce unknown values.
Genuine zero and negative eligible values survive. EPS loss narrowing and
turnaround remain fresh sourced references with an unknown ordinary-growth
condition; their original percentages never become ordinary growth passes.
Comparison labels come from validated source cells. Zero-base division and
annual heuristics stay unknown. Existing clipped calculations are identified.

EPS/SMR/Composite ratings and legacy financial-dependent scanner scores,
ratings, pass claims, and Code 33 remain unknown. Their raw values and nested
scanner records survive in the separate historical namespace on full detail.
Pure technical setup, price, RS, and the nine Minervini Research checks retain
their existing semantics. Group representative labels that used an unsupported
financial score tiebreak are withheld; group RS aggregates remain intact.

Research rows, rankings, filter counts, CSV, and portfolio preparation share a
single explicit evaluation epoch. Published cached orders and summaries never
authorize a current pass. Research workers reject mismatched generation/epoch
responses, and expiry withholds the prior bundle until the replacement is ready.
Timers, focus, and visibility changes cover open and suspended views. Full
selected detail also participates in the clock, including the separate existing
180-day SEC/book reference boundary. Scalar sources retain seven days; independent
reported history retains 72 hours. Actual evaluation timestamps and explicit
current-at-evaluation semantics accompany current decision downloads, so facts
acquired after the price snapshot are never labeled available at its historical
publication time.

The unchanged `research-table-v1` codec expands proof tuples into lossless
dictionary columns and restores the original tuple contract on decode. Exact
numbers are never rounded for transport. Unused published order permutations
are omitted from new indexes. Old indexes with orders remain readable and are
re-evaluated. Full source envelopes and raw references remain outside initial
row transport. The hard 8,000,000 raw / 1,000,000 gzip byte gates remain enforced.

## Offline acceptance evidence

The retained 5,901-row publication was replayed at
`2026-10-03T16:35:00.000Z`. Research Minervini remained 492 total / 258 liquid;
Minervini 2 remained 499 / 259. All 17 former IBD qualifiers became incomplete,
and strict portfolio candidates became zero. This establishes data availability
and unchanged technical qualification, not profitability.

Legacy scan effects were measured separately using the actual current frontend
filter definitions. Default volume-filter results remained 931. The Home
headline was already empty and remained empty. CANSLIM raw matches changed
49→0, IBD Composite 102→0, IBD50 215→0 (previous displayed cap 50), Kell growth
33→0, Growth 28→0, and IPO 194→0. Technical-only preset counts remained unchanged.
The removed matches lack required evidence; they are not measured failures.

| Retained / synthetic input | Rows | Available proofs | Raw bytes | Gzip bytes |
| --- | ---: | ---: | ---: | ---: |
| Retained publication, compact unknown metadata | 5,901 | 0 | 3,579,615 | 897,594 |
| Producer-certified fixed fiscal calendar | 5,901 | 41,307 | 4,051,095 | 983,961 |
| Producer-certified varied fiscal calendars | 5,901 | 41,307 | 4,110,303 | 990,784 |

The varied fixture uses 20 quarterly calendars, 84 annual calendars, four
independent quarterly/annual Basic/Diluted EPS combinations, distinct values,
and distinct acquisition clocks. All 41,307 proofs and current decisions survive
roundtrip exactly. Only about 9 KB gzip remains in that bounded fixture; these
results are not a universal guarantee about future source diversity. Every real
export must still pass the unchanged hard gate.

One same-process Node run on the exact same legacy index/time measured 232 ms
for the old cached preparation and 1,539 ms for current recomputation. A separate
new-metadata preparation took 727 ms. Warm isolated stages measured about
52 ms decode, 7 ms merge, 151 ms projection, 773 ms assessment/sort, 238 ms
portfolio preparation, and 88 ms expiry indexing. These are CPU observations,
not browser cold-load, network, main-thread responsiveness, or Design Acceptance
measurements. The slower current recomputation is confined to data/expiry epochs;
method switches and ordinary 15-second readiness ticks reuse the prepared bundle.

## Reproduction

`frontend/tools/generate-static-financial-stress.py` deterministically creates
`legacy`, `fixed`, and `varied` inputs from an encoded or decoded retained
research index. It uses the actual source arithmetic/capture constructors and
strict Python proof validator, performs no vendor requests, and produces a SHA
and dimension report. Generated stress files are test-only and must never be
published as market observations.

With the backend test environment active, run it for each variant:

```sh
python frontend/tools/generate-static-financial-stress.py \
  --repo "$PWD" --input /path/to/retained-research-index.json \
  --output /tmp/financial-varied.json --variant varied
```

Retain a read-only checkout of baseline commit `3063e64` for the comparator.
After generating `legacy`, `fixed`, and `varied` inputs, run:

```sh
node frontend/tools/verify-static-financial-projection.mjs \
  /path/to/retained/raw /path/to/baseline/frontend/src/static \
  /tmp/financial-legacy.json /tmp/financial-fixed.json /tmp/financial-varied.json
```

The replay verifies the recorded publication hash, all 5,901 rows, unchanged
input JSON, exact technical counts, incomplete former IBD qualifiers, independent
history, old/new order compatibility, all proof values after transport, portfolio
parity, legacy filters, and the unchanged byte gates. Normal unit coverage uses
the small shared producer fixtures rather than shipping the large stress arrays.

The end-to-end exporter test additionally checks index/list/detail consistency,
zero preservation, raw historical retention, current preset counts, decision
artifact timing labels, and byte-identical untouched historical files. Browser
geometry, cold-load behavior, and release/design checks remain separate gates.

## EPS comparison v2 recheck

The retained 5,901-row replay still yields zero current financial values and
unchanged technical counts. The v2 varied source stress transports 41,307
source-valid proofs, of which 5,901 are current turnaround references with
unknown ordinary-growth conditions. Exact proof and decision roundtrip passes
at 4,188,310 raw / 993,889 gzip bytes. The original hard cap remains unchanged;
6,111 gzip bytes of headroom is a bounded fixture result, not a general forecast.
Full raw inputs/captures are unchanged and no provider was contacted.

A special comparison survives raw projection, compact encoding, JSON decode,
reprojection and selected-detail merge with an explicit null ordinary scalar.
Its tuple reference remains bound to the source/metric/unit/period/expiry and
never qualifies a growth threshold. The v2 browser rejects v1 compact proofs.
