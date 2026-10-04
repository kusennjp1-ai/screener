# Public static financial evidence activation

This change is not a historical performance re-evaluation. It makes the public
static application distinguish source-supported current financial facts from
retained historical values whose source, period, unit or freshness cannot be
verified. Method thresholds are unchanged. Missing evidence is unknown, not
zero and not an automatic failure.

The scope is the registered EPS/sales growth fields, annual-growth proxies,
ROE/margin, and dependent EPS/SMR/Composite/scanner ratings and legacy Code 33
claims. It does not certify all other vendor fields, such as market
capitalization, valuation ratios or institutional ownership. Their separate
existing evidence paths and limitations remain applicable.

## Scope and migration

1. The capture/storage foundation records observations and source evidence
   atomically. It does not change legacy raw scalar values or classifications.
2. Static exports add versioned current-use proof summaries. Old bundles without
   these summaries remain readable; their unsupported financial facts are
   unknown in the new UI. Full historical values remain available as reference
   data. A fresh retrieval timestamp must not rejuvenate an old source response.
3. The new static UI projects current evidence before filtering, ranking,
   portfolio selection or presentation. Detail responses must match the symbol,
   snapshot and generation already selected. They cannot restore a withheld
   value from a different or older source. Open pages re-evaluate at the next
   evidence expiry and after visibility/focus changes.
4. This activation does not change online SQL/API screening semantics. Static
   pages must not silently fall back to an unprojected online response. Such
   responses require separate consumer and query-level integration.

The visible financial summary and the expanded evidence panel use the same
projected state. Their labels distinguish method requirements from references.
The Minervini technical template is not labeled as complete SEPA qualification.
Newly observed research evidence does not establish that the fact was available
at a historical scan time.

## Existing publication controls

The release controller and its acceptance thresholds are unchanged.

- A new UI requires successful CI and Design Acceptance for the exact current
  main commit. Both checks are re-evaluated before upload and deployment.
- Data-only releases retain every approved UI byte and the approved UI's pinned
  exporter. Their source must be an exact successful validated artifact attempt;
  market dates and retained price observations cannot regress.
- An equal-date changed payload is not an advancing data-only release. A new UI
  that passes both gates can reuse the exact verified live artifact and rebuild
  its current-use projection without inventing a newer price date. The receipt
  records the new UI approval, retained source artifact, actual price dates and
  hash of the resulting manifest.
- Expired/missing source artifacts, changed live identity, missing required
  symbols and invalid provenance remain blocking errors. A newer live release
  supersedes the pending plan.

The CLI regression suite explicitly exercises successful same-date new-UI
correction, rejection when Design has not passed, and rejection when a gate
changes before deployment. These are offline synthetic fixtures; they are not
proof that a production publication occurred.

## Promotion evidence required

Before promotion, record the final commit and obtain all of the following:

- Full frontend and relevant backend suites, export/transport parity, old/new
  bundle migration, malformed evidence and numeric zero/negative cases.
- Real archived-universe comparison of qualification/unknown states, list and
  detail consistency, and compressed transport budgets. Describe changes as
  evidence handling, not improved stock returns.
- Exact source/period expiry, cached-order invalidation, symbol-switch races,
  asynchronous detail-generation mismatch and static fallback regressions.
- Browser checks of the first-view summary and detailed evidence at desktop,
  360-pixel mobile and short-height viewports. Synthetic fixtures are identified
  separately from real-data captures. Record actual performance failures even
  when visual review passes.
- Terminal CI and Design outcomes for the final UI. Existing unsuccessful
  performance checks are not waived by an earlier release's risk acceptance.

After an authorized normal merge, monitor the main checks and the existing
Research UI Release workflow. If the new UI gates fail, it remains unpublished;
ordinary validated data updates continue with the currently approved UI. After
a successful deployment, verify the live receipt's exact UI commit, manifest
and asset hashes, then inspect actual live financial states in the cloud browser.
Report current financial coverage separately from price/evidence coverage.
