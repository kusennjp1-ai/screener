# Four-symbol Oct 5 price recovery pilot

Prepared locally on October 6, 2026 against `7cb60f3`. This is an acquisition
proposal, with `acquisition_enabled: false`, not a runnable dispatcher or a
publication candidate. No provider was contacted and no database, mapping,
rollout, main branch or PR 80 was changed. The exact envelope and evidence hashes
are in [the JSON proposal](financial-source-evidence/four-symbol-price-recovery-proposal-2026-10-06.json).

## Smallest proposed acquisition

Use the existing Yahoo Finance provider and pinned yfinance **0.2.66**. Make two
synchronous `yf.download` calls, requesting four securities in total:

| Provider symbols | Inclusive start, New York | Exclusive end, New York | Purpose |
|---|---|---|---|
| ET, SUN, DDS | 2026-09-29 00:00 EDT | 2026-10-06 00:00 EDT | Four overlapping prior sessions plus the Oct 5 close |
| VMRK | 2024-10-06 00:00 EDT | 2026-10-06 00:00 EDT | At most two years of history for the continuing issue; no retained EQR chart exists |

The frozen exclusive end is Unix **1791259200**, or October 6 04:00 UTC. Use
explicit timezone-aware start/end values and no relative `period`. Options are
`interval=1d`, `threads=False`, `group_by=ticker`, `auto_adjust=False`,
`back_adjust=False`, `repair=False`, `actions=True`, `prepost=False`,
`rounding=False`, `ignore_tz=False`, `keepna=True`, `timeout=10`,
`progress=False`. Retaining NaNs lets the existing integrity checks reject
missing values explicitly. It does not authorize repaired or invented bars.

All normalized price bars must have a timestamp-derived New York session no
later than **Oct 5**. Require a valid Oct 5 bar; reject duplicate, non-session,
future or incoherent bars. Do not derive a close from `regularMarketPrice`,
`regularMarketTime`, a profile, an unbounded metadata probe or the old scan
scalar. Preserve actual per-response October 6 UTC acquisition clocks. This is
a late catch-up and cannot demonstrate a past close-plus-one-hour success.

## Actual retained history and identity bindings

I read the three selected chart entries directly from the retained approved
release archive. Each contains **309 bars, July 14, 2025 through October 2, 2026**:

| Required prior member | Oct 2 close | Exact retained chart SHA-256 |
|---|---:|---|
| ET | 20.47 | `060e1a8a82bb3368f050716cbd8c974a79662261879d00b19cb2757ae2e6c3f6` |
| SUN | 74.73 | `e02d89977bceb0ffbf19b0d1e74b1a2e6cc501fef6b8e729c8dfa0893e8257db` |
| DDS | 654.11 | `6314ad01fdf46aa13ba13c2c38a98674c9f8866d50f9683670ce55b5c2ccda12` |

EQR has no prior chart. Its 63.65999984741211 scalar repeats in the Oct 5 export
and does not establish a current close or historical series. Request VMRK's
provider-supplied history directly after continuity review; do not attach that
scalar or any fabricated history to it. If VMRK supplies only a short series,
current-close validity and 252-session technical eligibility remain separate.

Retained price and financial rows explicitly say their instrument identity is
only ticker-bound. The official evidence below supports a proposed transition;
it does **not** retroactively turn old provider bars or financial receipts into
identifier-certified evidence. Review a dated instrument record before joining:

| Prior → provider | Identity and dated continuation | Required mapping |
|---|---|---|
| ET → ET | Energy Transfer LP, CIK 0001276187, common limited-partner units; TXSE transfer Oct 5 | XNYS through Oct 2, TXSE from Oct 5; not ET preferred |
| SUN → SUN | Sunoco LP, CIK 0001552275, CUSIP 86765K109, common limited-partner units; TXSE transfer Oct 5 | Same dated MIC transition; not SunocoCorp SUNC |
| DDS → DDS | Dillard's Inc., CIK 0000028917, SEC file 1-6140, Class A common $0.01; registration/notice scheduled Oct 5 | Confirm effective TXSE observation; not DDT or Class B |
| EQR → VMRK | Continuing CIK 0000906107, file 1-12252, common beneficial-interest shares $0.01; issuer says new ticker from Aug 18 and old certificates remain valid | One continuing instrument and dated alias on XNYS; preserve the EQR audit reference |

The official [ET filing](https://www.sec.gov/Archives/edgar/data/1276187/000127618726000044/et-20260903.htm),
[SUN filing](https://www.sec.gov/Archives/edgar/data/1552275/000155227526000075/sun-20260903.htm),
[TXSE completion](https://www.txse.com/press/texas-stock-exchange-celebrates-move-of-energy-transfer-partnership-s-primary-listings),
[DDS registration](https://www.sec.gov/Archives/edgar/data/28917/000110465926111370/tm2626135d1_8a12b.htm),
[DDS exchange notice](https://www.txse.com/alerts/adbdaf8a-27af-4643-9e6a-c0655cf92561),
and [EQR continuation filing](https://www.sec.gov/Archives/edgar/data/906107/000114036126033377/ef20080318_8k.htm)
are the dated identity evidence already collected in the official triage.

Current `catalog.py` and `mic_aliases.py` have XNYS/XNAS/XASE, but no TXSE.
`SecurityMasterResolver` has no dated issuer/class alias model. The source guard
also correctly rejects a prior required member's unexplained exchange change or
disappearance. Before integration, represent these transitions explicitly by
issuer plus security/class plus effective date, preserving each prior required
member once. A global EQR string replacement or a TXSE-to-NYSE coercion would
not satisfy this contract. Unknown provider venue aliases remain quarantined.

Provider symbol, issuer/name, instrument type/class, venue, currency and timezone
must agree with the reviewed official mapping. Missing or contradictory
instrument evidence cannot be waived by a matching ticker or close. For the
three retained series, compare all four overlap sessions and apply existing
`requires_full_history` and `coherent_history` checks before any merge. A changed
adjustment basis blocks this pilot and produces a separate full-history proposal;
it does not trigger an automatic fifth history request. Financial receipts keep
their original identities and clocks and are not reassigned by this price pilot.

## Request cap and source-proof gaps in today's path

The scheduled route is `StaticDailyPriceRefreshService` → `BulkDataFetcher` →
`PriceProviderPlanExecutor` → Yahoo/yfinance. The US price provider plan has no
second provider. The wrapper currently accepts only relative periods: `7d` for
top-ups and `2y` for bootstraps. It stores returned frames in the cache/database,
so it must not be invoked as-is for this isolated proof-gathering exercise.

Its retry schedule is 30/60/120 seconds, up to four attempts. With four symbols,
one transient failure exceeds the 20% threshold and can repeat successful names
too. The static outer rate-limit retry is India-only, but yfinance itself also
retries HTTP errors using another cookie strategy. Its `multi.py` loops over
symbols and calls individual history retrievals; the repository comments that
call a batch “one HTTP request” are inaccurate. I inspected the installed pinned
vendor sources directly, without executing a fetch.

Proposed hard limits for the entire pilot:

- Two synchronous download calls, four bounded history-chart requests.
- At most four metadata-only timezone chart probes and two ordinary cookie/crumb
  bootstrap requests: **ten HTTP requests total**, including all helpers.
- One in-flight request; no redirects, outer retries, alternative auth strategy,
  fallback providers, profile/statement/search calls or extra full-history fetch.
- Before every transport call, retain existing aggregate/US rate and circuit
  controls, never faster than their effective limit or one request/second.
  Stop if controls are unavailable or open; do not change deployed rate settings.
- Ten-second request timeout and a five-minute whole-pilot ceiling. Stop earlier
  on 401/403/429, unexpected endpoint/redirect, timeout, exhausted cap or missing
  raw proof. The stop must latch across subsequent ticker callbacks, even when
  yfinance catches an exception internally.

These caps are **proposed, not implemented guarantees**. They require a tested
restrictive session transport guard before acquisition. Automatic redirects must
be disabled so hidden hops cannot exceed the count. Do not change the existing
session fingerprint, proxy, credentials or identity in response to a denial.
No session-bootstrap body, cookie, crumb or authorization header belongs in the
saved evidence or logs.

yfinance's cold timezone lookup uses `range=1d` and may include Oct 6 intraday
data. Its response must be tagged metadata-only and never enter normalized
history, latest price, volume or screening metrics. The actual four history
queries have the explicit exclusive end. If the requirement instead prohibits
even retrieving intraday-containing discovery responses, the unmodified cold
path is unsuitable; a reviewed bounded metadata lookup is required first.

The existing `financial_source_capture.py` recognizes quote/financial endpoints,
not `/v8/finance/chart/`. It stores selected financial subsets and hashes; it is
not an immutable daily-price raw archive. Before normalization, retain chart
response bytes under a SHA-named exclusive-create file, maximum 8 MiB per body
and 32 MiB total, with exact sanitized request parameters, response status,
start/completion clocks, body size/hash, vendor/controller version and reviewed
identity-manifest hash. Rehash before replay. A cached frame without its original
transport receipt does not acquire a fresh observation timestamp.

## Explicitly outside this pilot

AXIA's common ADR continues OTC as AXIAY from **Aug 7**, after its Aug 6 NYSE
session; CUSIP 15234Q207 / ISIN US15234Q2075. Its scope decision remains separate.

The nine retired original issues remain dated proposals, not silent removals:
LBRDA/LBRDK last traded **Aug 19**, ceased **Aug 20**, formal suspension **Aug 21**;
EA last **Aug 4**, suspension **Aug 5**; APGE last **Sep 2**, closed **Sep 3**;
CRNX last **Aug 31**, closed **Sep 1**; KALV last **Jun 10**, ceased **Jun 11**;
NUVL last **Jul 14**, closed **Jul 15**; TWO common cancelled **Aug 25**;
WBS common exchanged/cancelled **Aug 20**. Exact last trading dates for TWO/WBS
are not asserted. The retained LBRDA Aug 21 bar remains an official-date conflict.
Their official sources/class identifiers are preserved in the JSON proposal.

## Review and stopping point

The next implementation is one local bounded start/end adapter plus transport
meter/stop latch and raw-chart capture, with offline fixtures for cap exhaustion,
403/429, redirects, cache clocks, identity mismatch, changed overlap and Oct 6
contamination. It must finish before anyone authorizes the ten-request envelope.
This task prepared configuration and inspected retained/vendor evidence only.

After a separately approved acquisition, stop at four independently validated
Oct 5 instrument observations or explicit unresolved blockers. Do not publish
from this packet. A publication proposal still requires the dated cohort
transition, prior/new member retention, chart/scan/source date and close equality,
all affected indicators/selection recomputed, original technical verifier and
financial continuity gates. Nine retirements plus the OTC scope decision remain
independent prerequisites for the full required-cohort source promotion.
