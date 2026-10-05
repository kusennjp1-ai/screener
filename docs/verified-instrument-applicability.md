# Verified instrument applicability

`financial-instrument-applicability-v1` is a bounded registry of BITU, SBIT and ETHE. Its official source URLs, recorded instrument identifiers and identity-binding limitations are retained in `contracts/financial_instrument_applicability_v1.json`. The identical `frontend/contracts` copy permits a frontend-only Docker build.

The shared `instrumentApplicability` helper independently checks an exact ticker and market, an exact product name after Unicode/whitespace/case normalization, and any available identifiers. CIK comparison accepts the same numeric value with zero padding. Conflicting names, markets, tickers or known identifiers, and missing names on a reviewed ticker, quarantine the identity. Registry identifiers are never treated as observed receipt identifiers. The currently published three rows are bound by ticker and product name only.

The canonical row key is `instrument_applicability`:

- `not_applicable`: the verified fund is outside corporate stock-method qualification.
- `quarantined`: a reviewed ticker has conflicting or incomplete identity; current corporate qualification is withheld.
- `unverified`: no reviewed classification. Existing ordinary-company behavior remains unchanged. A name containing ETF, trust or fund does not classify an instrument.

The current projection withholds corporate financial scalars, aliases, proofs and history for the first two states. Historical values and histories remain in `financial_historical`, with explicit reference labeling. Minimal observed identity contexts survive compact transport so removing the full historical report cannot remove a quarantine. This does not establish that a recorded CUSIP is present in a provider receipt.

All four research methods use the guard. Technical rule measurements and pass counts remain reference measurements; even 9/9 technical measurements cannot set `qualified` for a verified fund. Financial rules use a distinct `not_applicable` state, not failed EPS growth or unknown evidence. Summary encoding, current snapshots, filters, CSV, entry readiness, list/detail/chart views and financial panels preserve the distinction. A new rule summary version prevents a legacy packed technical pass from becoming current authority.

`applicabilityUniverse` retains the existing price/liquidity predicate (US, price at least $10, average daily dollar volume at least $20 million). Its `us-corporate-financial-applicable-v1` count is separate from `us-published-equities-price10-adv20m-v1`, and includes an explicit reason/source for each exclusion. On the reviewed October 2 publication: 5,901 published price rows, 1,894 price/liquidity rows, and 1,891 financially applicable rows after three verified-fund exclusions. The other 43 name-review flags remain unclassified. The historical acquisition record of 402 processed symbols is not recalculated or rewritten.

No price bars, selection thresholds, provider acquisition behavior, or historical candidate archives are changed by this guard. Expanding the registry requires new reviewed identity evidence and a deliberate contract/version change.
