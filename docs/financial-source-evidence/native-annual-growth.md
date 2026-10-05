# Current provider-reported native-currency annual EPS

This is a destination-only policy for annual growth and four-year completeness.
It is not wired to a publication or source-certification controller.

## Two separate policies

`export_statement_projection.py` and every original source-replay module remain
unchanged. They replay the original USD-only producer projections, so an archived
`unsupported_currency` result remains valid historical evidence rather than
appearing corrupt after a consumer update.

The explicit opt-in `export_native_annual_projection.py` runs that exporter first,
then writes a new immutable destination projection. Its
`financial-correction-native-annual-v1` policy binds its own code/contract hashes,
the exact old projection hash and old policy hashes, and the identical original
receipt inventory. Existing source certificates remain evidence of the old
policy only. This tree is not automatically an authorized certifier tree.

A future preview integration must explicitly select and bind the destination
policy. Release-controller and publication-receipt validation remain legacy
strict. Neither this script nor a frontend version change authorizes promotion.

## Scope and evidence

A new annual history requires the exact recorded singleton currency, the original
`annualDilutedEPS` source metric, finite diluted EPS in four consecutive annual
periods, unchanged issuer/period validation, the existing 345–385-day cadence,
550-day latest-period age and 72-hour source age. The supported exact currency
codes are enumerated in `native_annual_history_v1.json`; GBP and GBp never alias.
There is no FX conversion, price/EPS valuation, basic-EPS substitution, skipped
missing year or inferred ADR/share multiplier. A nonpositive baseline preserves
known completeness but leaves ordinary annual growth unknown. A zero latest EPS
with a positive baseline remains −100%.

The shared evidence standard is provider-reported per-share EPS. Split/ADR
restatement and share-unit equivalence are not independently verified for either
USD or native series. An exact singleton set establishes agreement of recorded
source currency codes; it does not independently prove a code existed on every
cell. New affirmative unit/basis/currency assertions or conflicts require a new
review, not an inferred conversion.

Existing accepted USD history objects, quarterly histories, financial scalars,
source envelopes and compact scalar proofs stay unchanged. Only the new native
annual histories have a versioned annual receipt proof. Their annual and
quarterly reporting currencies and original acquisition clocks are independent.
Adding annual coverage cannot refresh or shorten a quarterly series' lifetime.
Original source clocks remain in the proof, display, expiry timeline and compact
transport. The current history's root clock is the oldest included receipt.

`bookFinancialEvidence` and `bookFinancialCurrent` retain the separate dated
SEC/USD contract. Prices, trading-currency filters, ADV and portfolio USD values
are separate inputs and are not reinterpreted. List, detail, chart payload,
presentation and CSV use the same `assess` annual conditions. CSV includes the
annual reporting currency, condition state and evidence. Cash EPS labels use the
series currency; percentage changes remain dimensionless.

## Historical compatibility

Unversioned history stays on the old USD-only validator. Profile currency alone
cannot mint the new native contract. Both destination policy IDs are explicit in
the consumer overlay. The new annual proof retains receipt hash, source-payload
hash, capture ID and observation time and is bound to the projection's original
receipt list. These verification inputs remain in the measured compact index.

The changed history/assessment code changes the rule fingerprint. Existing
candidate catalogs and saved observations must remain byte-immutable; current
policy comparisons must report incompatible policy rather than creating a new
historical pass/drop event. Use the separately reviewed current-comparison gate
when integrating this consumer into a preview. Thresholds are unchanged.

## Reproducible offline verification

Run the new exporter with the same explicit archive, base, cohort, target base,
target publication identity and evaluation-time arguments as the old exporter.
It returns both immutable projection paths and their hashes. Then run:

```
node frontend/tools/verify-native-annual-projection.mjs \
  OLD_PROJECTION NEW_PROJECTION TARGET_BASE AUDITED_111_INVENTORY OUTPUT_REPORT
```

The diagnostic uses the real target rows, exact 111-case inventory and both
projections. It verifies unchanged scalar/quarterly/USD outputs, actual annual
cells/rates, exclusions, method impact, transport, list/detail/chart, CSV and
filter parity. It makes no provider calls and writes only the requested local
report. The diagnostic's exact golden counts deliberately describe this audited
October 4 cohort; they are not a general future-data assumption.

At the October 4 15:30 UTC evaluation of the October 2 price snapshot, the final
archive's 1,894-symbol cohort adds 99 complete native annual histories: 81 ordinary
positive-base comparisons and 18 complete nonpositive-base series. The 12 mixed
or incomplete cases remain unchanged; 1,702 accepted USD histories remain
unchanged. Five annual-rule passes are ATAT, BZ, FUTU, MDA and TCOM; 76 fail an
annual 25% condition. These are not overall stock qualifications.

On the full 5,901-row target, O'Neil annual pass/fail/unknown counts change from
31/1,132/4,735 to 36/1,208/4,654, with 81 fewer unknown conditions. IBD annual
completeness passes increase from 1,757 to 1,856, with 99 fewer unknown conditions.
The target includes 55 already known histories outside the corrected cohort and
three instrument exclusions. Overall O'Neil and IBD qualifiers remain zero.
Minervini and Minervini 2 remain 493 and 500 full-universe qualifiers. The report
must be rerun against the integrated current consumer and measured transport
before promotion; its input receipts do not claim October 2 public knowledge.

## Why no current O'Neil qualification

This is not an IBD proxy-rating dependency: O'Neil has no EPS/Composite rating
condition. The diagnostic now emits full-universe, exact-cohort and verified-price
cohort counts for every O'Neil rule, plus ten canonical-ranked eligible rows with
zero measured failed rules and only unknown blockers, their exact reasons,
source/receipt context, periods and clocks.

For the 1,894 intended cohort, the eight rule distributions (pass/fail/unknown /
not-applicable) are: quarterly EPS 596/820/475/3; sales 430/1,303/158/3; annual EPS
36/1,182/673/3; high-distance 664/1,182/48/0; rising-day volume 131/1,715/48/0;
RS 458/1,388/48/0; institutional holders 1,299/535/60/0; market 1,850/0/44/0.
These are overlapping conditions, not additive numbers of rejected stocks.
There is no universal market/institutional/proof-expiry blocker. All 1,846 rows
with verified daily-price evidence pass the market condition at this clock.

There are 32 eligible rows with zero measured failed rules, including AVT (7 pass,
1 unknown), SMTC and MSGS (6 pass, 2 unknown), then MDA and MWH (3 pass, 5 unknown).
AVT lacks annual diluted EPS for June 2026, but its retained earlier EPS already
declines 8.26 → 5.43 → 2.75. Filling the final cell cannot make those known annual
changes meet 25%; the existing engine intentionally leaves an incomplete whole
annual rule unknown. SMTC and MSGS have known nonpositive-base limitations,
rather than missing quarterly acquisitions. Most remaining zero-fail candidates
lack enough daily history for several technical conditions. These rows are not
recommendations or latent assured qualifiers.
