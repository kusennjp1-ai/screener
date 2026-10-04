# Financial evidence presentation (bounded public static integration)

This UI uses the shared compact current-use projection for the public static
application. It does not activate SQL/API current-use semantics, fetch vendors,
change investment thresholds, or rewrite historical observations. Release still
requires the coordinated static exporter/proof/projector work, transport gates,
and Design Acceptance described below.

The one adapter, `buildFinancialEvidencePresentation`, revalidates compact proof
through `projectFinancialRow` and copies conditions from `assess` at the same
explicit evaluation instant. `ResearchPage` supplies its output as an explicit
prop, bound to the selected symbol, price snapshot, and publication generation.

## Visible behavior

- The existing evidence tab explains that Minervini's 9 checks are 8 technical
  trend conditions plus daily-price integrity. A 9/9 does not certify all SEPA
  elements. A compact button opens the financial tab. A compact four-part EPS/sales/continuity/quality strip appears between the
  symbol header and chart. It uses one desktop row or two short mobile rows;
  each control opens the corresponding existing evidence directly.
- The financial tab displays annual/quarterly history immediately, with aligned
  period and numeric columns and an explicit message when quarterly rows are
  absent. Other callers retain the existing history disclosure.
- When the explicit presentation prop is supplied, `FinancialEvidencePanel`
  displays every metric's value, condition/reference role, status, reporting and
  comparison periods, source, observation time, and calculation basis. Unknown
  reasons are visible; unknown required data are not labeled measured failures.
- Current scalar values with missing source, period, basis, observation time,
  normalized unit, binding, or expiry are withheld. Retained old numbers appear
  only in the separately labeled, initially closed historical disclosure and have no
  pass/fail state. Expiry does not erase historical records.
- Reference rows use a neutral “参考・取得済み” status when available. A reference
  has no invented pass/fail threshold. ROE and margin are always references;
  SEC/book margin-improvement calculations remain separate and unchanged.

## Explicit input contract

`FinancialEvidencePanel` receives `{ evidence, history, symbol, date, generation,
method, now }`. `now` is an explicit finite epoch-millisecond evaluation instant.
`history` is the independent `financial_history` payload. Never pass a raw stock
row as `evidence` or build this payload by spreading one.

`evidence` is a **presentation of already projected and assessed data**, not a
new source-verification API. Only a reviewed adapter from the current-use
projector and the existing `assess` result may create it. A source payload with
`availability: 'current'` is not sufficient proof of source lineage, comparable
basis, or an eligible derived rating.

```js
{
  schema: 'financial-evidence-presentation-v1',
  symbol: 'TEST',
  as_of_date: '2026-10-02',
  generation: 'exact-content-generation',
  method: 'oneil', // minervini, minervini2, oneil, ibd
  evaluated_at: '2026-10-03T12:00:00Z',
  valid_until: '2026-10-06T11:00:00Z',
  metrics: {
    eps_growth_yy: {
      value: 30, // canonical projected number, never a numeric string
      unit: 'percent_points', // 30 means 30%; never infer from the value's size
      availability: 'current', // or unknown, with reason and value: null
      source: 'actual bound provider',
      observed_at: '2026-10-03T11:00:00Z',
      valid_until: '2026-10-10T11:00:00Z',
      period_end: '2026-06-30',
      comparable_period_end: '2025-06-30',
      basis: 'reviewed canonical calculation basis',
      condition: {
        label: 'C：四半期 EPS 前年同期比 ≥ 25%',
        value: 30,
        state: 'pass', // copied from the existing engine; not recalculated here
      },
    },
    annual_eps_growth_3y: {
      // Uses history for numbers/metadata; no legacy annual scalar fallback.
      condition: { label: 'existing assess label', value: 100, state: 'pass' },
    },
  },
  historical: [
    {
      id: 'eps_growth_yy', value: 282.48, unit: 'percent_points',
      source: 'retained provider', observed_at: '2026-06-13T12:00:00Z',
      period_end: '2026-03-31', comparable_period_end: '2025-03-31',
      basis: 'retained basis', reason: 'stale_source',
    },
  ],
}
```

These are synthetic examples. Timestamp fields require strict timezone-bearing
`YYYY-MM-DDTHH:mm:ss[.fraction](Z|±HH:mm)` strings, with valid calendar dates,
hours 00–23, minutes/seconds 00–59, and valid numeric offset parts. Invalid dates
such as February 30 and times such as 24:00 are rejected before `Date.parse` can
normalize them. Valid timezone offsets identify the same underlying instant;
fractional seconds retain JavaScript millisecond precision. Placeholder source
labels such as `unknown` do not satisfy current-source validation.
`valid_until` is the last accepted instant (inclusive). The adapter must set the
envelope validity to the earliest dependency expiry. The presenter can only
remove availability after that instant; it never grants new availability.
Scalar source age uses the existing inclusive 7-day policy. It rejects a scalar
expiry beyond that source deadline. An earlier adapter-supplied deadline wins.
This is a display defense, not the owner of the application freshness policy.

Supported metric IDs are `eps_growth_yy`, `sales_growth_yy`,
`annual_eps_growth_3y`, `eps_rating`, `composite_rating`, `roe`, and
`profit_margin`. Numbers for growth, ROE, and margin must already be normalized
by the upstream projector. The presenter never guesses or converts units:

| Metrics | Required scalar unit | Display |
| --- | --- | --- |
| EPS/sales YoY, ROE, net margin | `percent_points` | 30 → 30%; 0.3 → 0.3% |
| EPS/Composite estimates | `rating_1_99` | Remain quarantined in this version |
| Independently derived annual growth | Validated `reported_diluted_eps` history in `USD` | Existing history validator computes percentage growth; no scalar fallback |

Missing units and labels such as `fraction`, `ratio`, `%`, or `unknown` withhold
the current scalar. A `fraction` of 0.3 is **never** converted into 30%, and a
number's magnitude never establishes its unit. ROE and margin follow these same
checks even though they are reference metrics. Rating unit metadata must match
before it can reach the separate derivation/cohort quarantine; correct units
cannot remove that quarantine.

Historical entries with missing, ambiguous, or mismatched units retain the raw
number with the explicit label `単位未確認・原値`, without appending `%` or a
rating unit. Only an exact matching unit permits the normal historical suffix.
The original supplied unit, when present, remains visible as metadata.

The presenter does not recognize raw aliases, compare candidate sources, or
make basis substitutions.

Each required row carries its corresponding engine rule's exact `label`, `value`,
and `state`. An unknown rule also carries `reason`. The presenter checks the
rule-value binding and renders its label, including the existing threshold. It
does **not** calculate 25/80/90 cutoffs or use a second threshold table. Adapter
tests must show the selected engine rule and field correspond before activation.

The method role map is intentionally limited to current semantics:

| Method | Required financial rows | Other rows |
| --- | --- | --- |
| Minervini / Minervini 2 | None; the 9 checks stay technical | References |
| O'Neil | Quarterly EPS YoY, sales YoY, each of 3 annual growths | References |
| IBD | Quarterly EPS YoY, sales YoY, complete 3-year annual history, EPS estimate, Composite estimate | References |

The IBD annual condition binds to `annualComplete === true`, without adding an
annual 25% requirement. The O'Neil annual condition binds to the minimum of the
three valid annual rates already computed by `financialHistory`. Negative or
zero base years can leave IBD history complete while O'Neil growth is unknown.
The test fixtures obtain labels and decisions from the existing engine to catch
semantic drift.

The existing 72-hour USD reported-diluted-EPS validator is unchanged. Annual
display additionally requires a readable source and acquisition time. Valid
annual history can remain a reference independently of unavailable legacy
scalars. A required annual pass still needs the bound engine condition.
Reported quarterly EPS/revenue history never populates legacy quarterly YoY
fields or estimated ratings. An absent annual history is never replaced with
`annual_eps_growth_3y` raw row values.

In this contract version EPS and Composite estimates are **always unknown** with
`unverified_derivation_and_cohort`, even if a payload sets `verified: true` or
claims current availability. Their raw numbers belong only in historical
records. Recovery requires a separately reviewed derivation/cohort contract and
version change, not a display-side flag.

## Integration and activation requirements

1. Finish the shared source/compact projection and static consumer parity,
   raw-detail isolation, historical-write protection, and all expiry/worker race
   handling. SQL/API activation is a separate, unactivated scope. Preserve source 7-day and history 72-hour policies and byte budgets.
2. A single adapter builds this presentation from the projected selected symbol
   and its authoritative assessment at the same instant/generation. Bind all
   current/historical entries to that identity. Pass its output explicitly as
   `ResearchDetail.financialEvidence`; do not add a permissive raw-row fallback.
3. Supply the existing independent `selected.financial_history` with the same
   symbol/date. Bind the annual condition to the independently validated history
   result. Preserve underlying historical records and dated assessments.
4. Rebuild this prop with the same runtime evaluation epoch as summaries, orders,
   portfolio, filters, CSV, and detail merges. A local visual expiry check cannot
   fix stale selection counts or rankings. Reject late symbol/generation/epoch
   results before they reach the component.
5. Run production-artifact parity and size gates, actual browser validation at
   1440×900, 390×844, and short-height layouts in both themes, and the unchanged
   Design Acceptance/release process. The panel occupies the existing financial
   tab rather than adding a tall stack before the chart.

This branch must not be independently published as proof of corrected financial
freshness. Neither the prototype data examples nor the presentation tests replace
source/consumer integration or full Design Acceptance.

## Local verification

- `npm ci --no-audit --no-fund` used the existing lockfile without changing it.
- After unit/timestamp hardening, the full frontend Vitest suite passed: 187 test
  files, 1,823 tests. Coverage includes positive/negative/zero values, explicit
  percent/fraction/rating units, unconverted historical raw values, invalid
  calendars/times and valid offset/leap-day timestamps, source placeholders,
  exact 7-day/72-hour boundaries, method roles, the independent annual/quarterly
  history distinction, prop-only integration, identity changes, and the unchanged
  rule engine.
- Full frontend ESLint passed with zero errors and eight existing warnings.
- `npx vite build --outDir /tmp/screener-financial-ui-hardened-build` passed. This compiled
  the client only; it did not generate or publish research artifacts and does
  not establish the production data-byte budget or full `npm run build` gate.
- All four supplied live screenshots were visually inspected before the change.
  A temporary local Vite review fixture was attempted through the cloud browser
  at `http://127.0.0.1:4175/financial-evidence-preview.html`; navigation returned
  `net::ERR_BLOCKED_BY_CLIENT`. The server was stopped and temporary fixture
  files removed. No local-browser or alternate-network bypass was used. New UI
  screenshots, responsive geometry, and Design Acceptance remain unverified.

## Public static UI activation checks

- EPS/sales summaries and detailed rows use the identical presenter; the adapter
  takes condition labels and states from the existing engine. No new threshold
  table or mandatory financial gate is added to the 9-rule technical screen.
- Current financial evaluation time and actual source acquisition are shown
  separately from the selected price snapshot. A later acquisition is current
  research evidence, not proof of availability at the price-snapshot date.
- Static Scan, legacy Daily, expanded-chart fallback, group details and shared
  static sidebar use projected rows. The sidebar's explicit static mode prevents
  null values from being refilled by raw fundamentals; ordinary API callers are
  outside this activation. Legacy dependent scores and Code33 are unknown.
- Detail requests are keyed by symbol, date, path and generation. The merge
  retains list ownership of current values. A late same-date generation or
  previous-symbol response cannot supply current financial evidence.
- The legacy financial leader list explains unknown Code33/financial input
  counts; the technical-reference list keeps its existing independent filters.
- `tests/static/financial-evidence.spec.js` uses explicitly synthetic compact
  data at 1440x900, 1440x760, 360x844 and 360x568, both themes. It checks summary
  height, plot height, one-action targets, overflow, expiry, axe and screenshots.
  Listing the tests only validates discovery. Browser/visual acceptance remains
  unrun locally because the prior cloud-browser request was blocked; there was
  no alternate-network/browser bypass and no visual acceptance claim.

Current book continuity and margin references use the unchanged 180-day book
quarter-age policy against the actual evaluation day. The original price
snapshot and filing cutoff still determine the historical measurements; their
records are retained after current expiry. `bookFinancialCurrent` exposes the
inclusive UTC deadline for the shared runtime clock, with transition at deadline
plus one millisecond. Book details explicitly distinguish those dated records
from current eligibility. Independent financial-history 190-day/72-hour and
annual 550-day policies are unchanged.

The detail metadata retains the actual source metric (Basic EPS, Diluted EPS,
Total Revenue or Operating Revenue) and labels it readably. Supported compact
calculation-basis identifiers are translated for display only; values and engine
conditions are unchanged. Independent annual history remains explicitly reported
diluted EPS, even when the current quarterly source uses Basic EPS.
