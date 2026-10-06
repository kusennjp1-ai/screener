# Market and stock indicator histories

This local change adds four market-history views and two per-stock histories without changing selection thresholds, ranking, filters, risk allocation or purchase conditions. Nothing in this change connects a new external provider, changes scheduling, or deploys the site.

## Available observations and limits

- New highs/lows reuse `book-market-v1`: the current bar's intraday high/low must strictly exceed the preceding 251 bars (252 including the current bar). The chart covers the current published-chart subset, not historical all-listed membership. Each date retains its own numerator and coverage.
- Put/call is a volume adapter only. No redistribution-cleared feed is configured; the UI says unavailable. Open interest is rejected as a substitute. Put volume divided by zero or missing call volume is unknown. The source must declare venues, product scope and permission to redistribute.
- S&P 500 and Nasdaq Composite ordinary distribution estimates require their actual index closes, NYSE and Nasdaq volume respectively, source URLs and an explicit actual-session calendar. ETFs are rejected. Ordinary days require close <= 99.8% of the previous session and strictly higher positive volume. A day expires after 25 elapsed sessions or a later closing price >= 105% of its close; expired events never revive. A full 25-session warmup, missing prices, missing/zero volume and calendar gaps remain unknown. Stalling days and existing market-exposure logic are untouched. The current bundle has no matching input, so both show unavailable.
- Institutional history plots actual quarterly reported-manager counts, without daily forward fills. Existing latest-two observations and the current qualification age/spacing checks are untouched. Local archive imports may include more than two reporting periods. Refreshes preserve older exact-CUSIP/class/issuer observations with their original cutoff; current-period absences never borrow old counts; qualification uses the exact latest two requested periods, rather than the last two available observations. The default two-archive download behavior is unchanged.
- Automatic base count is a separate, retrospective app estimate using prefix-confirmed boundaries. It requires a verified daily chart and session calendar. The disclosed detector parameters are: prior 20-session rise >=20%, a 25–126-session pullback of 8–40%, and a closing recovery to 95% of the anchor high. It emits disjoint bases only when confirmed. A lower low than the previous base resets to 1; a new pivot at least 20% above the preceding buy point advances the stage; less is tagged base-on-base. It is neither MarketSurge certification, Stage 2 nor VCP contraction count. Observation starts are left-censored until an actual reset is observed. Manual context stays separate.
- Entry history starts with newly saved observations. Current approach, current buying range, new price crossings, method-qualified subsets and daily-ready subsets are separate. The configurable approach references are 1%, 3% (default) or 5% below the pivot, unrelated to the book's above-pivot chasing discussion. The same `entryPosition`, assessment and readiness engines used in the app supply all observations.

## Immutable entry observations

`export-indicator-history.mjs` writes a gzip, SHA-256-addressed snapshot under `static-data/indicator-history/`, records its reference in the market manifest and computes the market panel's compact series. `record-candidate-history.mjs` adds that reference to a separate versioned catalog at the final build step. The first snapshot for each price session owns that session's history and manifest reference; later builds and financial corrections neither overwrite it nor emit a replacement same-date archive. The existing fresh-build restoration step now restores the indicator catalog and exact referenced bytes with digest/date/version checks before the next session is exported. Missing or regressed published history cannot silently erase existing observations. Up to 126 session references are retained.

A new crossing requires an actual preceding exchange session, unchanged rule/universe versions, unchanged security and production setup/pivot identity, the exact same pivot value, unchanged source basis, and identical overlapping 250-session OHLCV fingerprints. This last check tolerates a rolling-window shift but rejects historical price/volume revisions. Missing information remains incomparable, not zero. A later below-pivot close rearms a crossing; a close staying at/above the pivot does not create another event. Missing legacy candidate-selection snapshots are never backfilled as entry events.

Prices alone never establish a buy. The UI and data separate qualified and daily-ready subsets and expose comparable/unknown counts. Counts are as known in the first saved observation, not a reconstruction of past fundamentals from today's values.

## Optional local input contract

An explicitly authorized, licensed importer can provide `static-data/market-indicator-inputs.json`. This code does not fetch it from the network. Its `putCall` member uses:

```json
{
  "version": "market-put-call-volume-v1",
  "metric": "volume",
  "license": { "redistribution": "permitted" },
  "source": { "name": "licensed provider", "url": "https://provider.example/data" },
  "scope": { "label": "explicit venue/product universe", "venues": ["actual venues"], "products": ["actual products"] },
  "observations": [{ "date": "2026-10-02", "put_contracts": 600, "call_contracts": 1000 }]
}
```

`distribution.sp500` and `distribution.nasdaq` each require `price_symbol` (`^GSPC` / `^IXIC`), `volume_universe` (`NYSE` / `NASDAQ`), `source` containing `name`, `price_url`, `volume_url`, a nonempty `calendar_source`, ordered `sessions`, and `observations` with `date`, `close`, `volume`. These are separate source universes, not an ETF substitution or a claim of exact official IBD counts.

## Review and validation

The shared history component exposes date, source, universe, unit and an accessible table. Market histories are visible on the overview; stock histories have their own detail tab. Base estimates also appear in list/chart summaries and clearly named CSV columns. Complete detailed history remains in immutable detail payloads, not every initial list row.

Adverse tests cover strict count boundaries, zero vs missing, future independence, irreversible distribution retirement, warmup/gaps, security/pivot/source/history revisions, same-day regeneration, rearming, base overlap/reset/confirmation and unchanged current holder qualification. Full-cohort export/size/performance validation is still required before publication. This branch is for local review.
