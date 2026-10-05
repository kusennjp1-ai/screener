# Required US statement selection (inactive preparation)

`backend/app/services/mandatory_statement_selection.py` is a pure helper. No
runtime caller, provider acquisition, cache writer, scanner, API, or export path
is changed. This commit does not repair the live fetch path by itself.

## Contract

Both public functions require explicit `symbol`, canonical `market`, timezone-
aware `now` (datetime or RFC3339), and `as_of_date` (`YYYY-MM-DD`). The opt-in
`us_mandatory_source_policy` defaults to `False`; it applies only to `market="US"`.
Invalid evaluation context raises `ValueError` while the policy is active; a bad
caller clock must not be mistaken for a provider fetch gap.

`mandatory_statement_refresh_fields(payload, ...)` returns a tuple containing
only `eps_growth_yy` and/or `sales_growth_yy`. It delegates qualification to
`build_static_financial_current`, including its seven-day acquisition-receipt
age, 190-day quarterly reporting-period age, provider identity, digest, units,
cadence, captured inputs, and arithmetic checks. It never trusts a fresh DB or
aggregate refresh clock as a substitute for the selected receipt.

Proof reasons `0` and `f` both mean the required source has been acquired. `f`
remains ordinary-growth-ineligible because the comparable base is nonpositive;
the helper neither upgrades it nor repeatedly requests it. Derived scores and
all other financial fields are outside source completeness. Disabled and non-US
refresh queries return an empty tuple.

`merge_mandatory_statement_payloads(primary, fallback, ...)` evaluates exactly
two supplied candidates:

1. Keep a supported current primary, even if the fallback is newer.
2. Otherwise select a supported current fallback with its exact owner receipt.
3. When neither qualifies, preserve the ordinary raw reference selection and
   continue to report the unresolved source gap. An unproved non-null primary is
   not overwritten by an unproved fallback.

The helper selects ownership by candidate position and reconciles through
`financial_payload_boundary.reconcile_financial_selection`. Equal numbers never
establish ownership. Original raw envelopes, candidates, alias values and source
clocks remain archived. The selected annual EPS alias follows `eps_growth_yy`;
repairing an original conflicting alias alone does not certify that receipt.
Alias-only inputs receive a diagnostic entry in the same content-addressed raw
archive because the ordinary merger otherwise archives only scalar-bearing
payload contexts. That entry survives canonical evidence roundtrips.

All other keys retain the ordinary non-null-primary/fallback preference. When
disabled or outside US, merge delegates directly to `merge_financial_payloads`,
including its existing identity checks and alias behavior. No merge timestamp
is generated. Both inputs remain unchanged.

## Integration still required

Any future caller must explicitly opt in, request only the reported missing
statement fields, bound provider attempts, and re-evaluate the returned source.
An unsuccessful acquisition leaves an unresolved gap; this helper contains no
retry loop. The acquisition must also be reachable independently of unrelated
provider failures. Every subsequent storage/export boundary must preserve the
selected scalar/receipt pair instead of overlaying the original snapshot again.
Those runtime decisions and their acceptance checks are intentionally outside
this commit.

## Verification

Synthetic tests use the actual statement arithmetic and receipt producers. They
cover stale/non-null primaries, current primary preference, equal values with
different owners, fresh DB clocks with old receipts, malformed/empty/foreign
provider responses, partial recovery, source-valid nonpositive bases, alias
conflicts, unrelated fields, disabled/non-US behavior, exact freshness boundaries,
and canonical SQLite/Redis/JSON roundtrips. They make no provider requests.
