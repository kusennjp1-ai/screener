# US reference universe comes from the official listing directory

The weekly US reference bundle (universe membership plus reference fundamentals) is built from the NASDAQ Trader symbol directory and Yahoo fundamentals, not the Finviz screener. Every static export publishes the bundle's own as-of date, and the export flags any bundle older than eight days as stale.

## Context

Finviz screener pages first returned partial results (about 50.6% coverage, which the 98% gate correctly blocked). Since October 2026 they have returned HTTP 403 to GitHub-hosted runners. The last US bundle is from 2026-06-13. The daily build imported it silently every day and stamped the rows as freshly updated.

Because the bundle defines universe membership, it also defines which symbols get daily prices. Listings since June were absent and delisted names stayed active. Upstream had the same stale US bundle.

## Considered Options

- **Keep Finviz and work around the 403.** Rejected: circumventing access controls is not an acceptable fix.
- **Licensed Finviz Elite export.** Viable, but it costs money, and it would leave the universe tied to one screener vendor.
- **SEC `company_tickers_exchange.json`.** Useful later for CIK linkage. It requires the `SEC_USER_AGENT` secret, which is not configured, so SEC returns 403 today. It also omits most funds.
- **NASDAQ Trader symbol directory.** Chosen. It is official, updated daily, reachable from Actions, carries exchange, ETF and test-issue flags, and has a source timestamp.

## Decision

- **Membership.** Membership is the directory merged with the prior universe for identity continuity:
  - Still-listed symbols keep their prior name, classification and, on venues the Market Catalog does not model (NYSE Arca, Cboe BZX, TXSE), their prior exchange identity.
  - Real moves between NYSE, NASDAQ and NYSE American are applied.
  - New listings join only as common stock, ADRs, ETFs or ETNs on those three exchanges.
- **Removals** are explicit and bounded (at most 10% of the prior active universe per run) and fail closed beyond that bound. A weekly build has no same-source reconciliation baseline, so the pipeline never removes symbols by itself.
- **Fundamentals** come from this run's Yahoo fetch for operating companies:
  - Seeded prior-bundle fundamentals are purged first, so a field this run cannot fetch stays unknown.
  - Only immutable facts (`ipo_date`, `first_trade_date`) carry over.
  - Funds carry reference-only rows (`fundamentals_applicable: false`).
- **Gates.** The all-symbol 98% gate is unchanged. An additional 98% gate on operating companies keeps fund rows from masking missing company data.
- **Provenance.** Each static market entry carries `reference_data`: as-of date, revision, age, limit, `stale` flag and universe sources. It sits outside the watchdog's `freshness` keys and outside the publication chronology.

## Consequences

- New listings reach the site after the first official weekly run, and delisted names leave it.
- Yahoo growth fields are absent for roughly a third of companies in the sample. Those values are unknown, not zero.
- Finviz-only fields (for example Finviz institutional ownership) are no longer available for US symbols.
- Showing the reference date in the UI is a separate, screenshot-reviewed change.
- `--us-source finviz` remains for comparison only.
