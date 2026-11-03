# Design acceptance (daily brief)

Since the daily brief became the whole static app, Design Acceptance
(`.github/workflows/design-acceptance.yml`) measures only the brief. A new UI
reaches GitHub Pages only when both `ci.yml` and `design-acceptance.yml`
succeed on the push to `main` for that exact commit
(`.github/scripts/publication-gate.mjs`).

## What is measured

`frontend/tools/design-review.mjs` writes report schema `brief-design-review-v1`.
The shared contract is `frontend/tools/brief-design-contract.mjs`. The harness
runs at 390 px and 1440 px, in dark and light, with 7 captures per combination
(28 in total): today, list, list one condition short, market, stock, weekly
stock, and watch. It uses the real published input that the workflow verified
(`select-release-source.mjs design`).

These checks block:

- axe (WCAG 2.2 AA) violations;
- tap targets under 44 px on phones or 24 px on desktop;
- font sizes or radii outside the scales in `theme/tokens.js`;
- an ASCII hyphen used as a minus sign;
- horizontal overflow;
- fixed chrome over 110 px on phones;
- page or console errors, and requests outside the site;
- visible `NaN`, `undefined`, `null` or `Infinity`;
- an analysis date that differs from the published date;
- broken legacy redirects, theme toggle, back navigation or chart candles;
- animations still running under reduced motion.

## Timing

CPU-4x timings are measured: first candidate row, stock open, tab switch and
longest initial task. An overrun is recorded in `timing_warnings`. It counts as
a deferred warning only while `docs/design-review/owner-waiver.json` carries
the owner's timing approval (`timing_instruction`, `timing_granted_at`).
Without that approval, an overrun blocks.

## Scores

`frontend/tools/check-design-review.mjs` first requires every capture (a
non-empty PNG) and no objective failure. Then it requires either a dated
screenshot review covering every capture (four scores of at least 8.0, each
with a reason) or the owner's waiver of subjective scores. No score is ever
recorded on the owner's behalf.

## Fail-closed paths

- A prepared financial correction candidate fails Design: the brief has no
  verified financial-display contract yet. The candidate is kept only as an
  UNAPPROVED diagnostic and is never sealed.
- Performance-exception tooling still expects the retired report format and
  fails closed. Limited-research previews are retired.
