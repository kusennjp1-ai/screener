# PR 70: explicit 20-card feed and 50-card stress evidence

The research feed now defaults to 20 cards per page, with an explicit 50-card option, a full-result range and page navigation. This is a browsing change for tall evidence cards. Filtering, ranking, source validation and CSV export still process the complete result set. The separate Scan table is unchanged; it is not the proposed feed/table toggle for the same research universe.

## Captured revision and checks

- PR head: `df48bfb04ae54ad86768e2afc582823ec6962494`.
- Actual GitHub preview checkout: `84beaab9733a42aa0a8280b8be8116700c781679`.
- Their complete trees are identical: `2e3326ea196590e82f6bbda9a83bcecf84a5b35c`.
- [CI 37190128460](https://github.com/kusennjp1-ai/screener/actions/runs/37190128460) passed: 2,402 frontend tests, six smoke tests, 30 static browser cases, backend quality gates and Compose smoke.
- [Design 37190128474](https://github.com/kusennjp1-ai/screener/actions/runs/37190128474) captured 154 screenshots and failed acceptance. It has no matching formal pixel-review record.
- The capture run and input-artifact run are now separate provenance fields. The input run was `37178754997`; both builds used the same checked source input. Each exported version independently contained 5,901 symbols and 1,894 default liquid candidates; their symbol sets agreed.

## Timings from this run

All workloads retain CPU 4x, all three cold-document measurements and the same navigation/click-to-second-animation-frame endpoints. Committed method, row identity, condition counts, page size, range, evaluation epoch and full-universe counts are checked at that endpoint. Witness collection and transport overhead remain included in the measured time.

| Workload | Width | Initial median | Switch maximum | Longest initial task | P1 |
| --- | ---: | ---: | ---: | ---: | --- |
| Legacy dense 50-row control | 1440 | 1,912 ms | 595 ms | 262 ms | Fail |
| Legacy dense 50-row control | 390 | 1,698 ms | 502 ms | 289 ms | Fail |
| Current default 20 cards | 1440 | 2,551 ms | 484 ms | 187 ms | Fail |
| Current default 20 cards | 390 | 2,216 ms | 311 ms | 159 ms | Pass |
| Current optional 50 cards | 1440 | 2,761 ms | 677 ms | 219 ms | Fail |
| Current optional 50 cards | 390 | 2,388 ms | 464 ms | 206 ms | Fail |

P1 remains 3,500 / 400 / 200 ms. Desktop default switch measurements were 484, 386 and 413 ms; Q1's separate 480 ms switch allowance also fails. Optional 50-card failures stay explicit and do not replace the approved 20-card release criterion. The legacy control and new feed have different DOM workloads, so this is not an equal-workload speedup claim. Prior baseline timings varied materially across runs.

D9's production-context-v2 cold first-frame measurements were 64.6 ms at 1440 px and 63.2 ms at 390 px against the unchanged 50 ms limit. The source styling, cold React mount, all 207 points, actual CSS size and DPR are retained. This context is different from the historical bare-div harness and is not a paired before/after radar benchmark.

Inspection of the new context witness exposed a more important limitation: the radar plot still had opacity zero at that endpoint because of its production entrance animation. The points had been drawn and aligned, but these numbers did not establish visible readiness. The follow-up removes that animation and adds synchronous visibility/pixel evidence at the existing frame boundary. It must be measured again; removing the animation is not evidence that the 50 ms budget will pass.

## Concrete follow-up corrections

The 73 objective failure entries comprise 60 repeated radius-token findings, six CSV comparison findings and seven performance/summary findings. They must not be described as a clean objective visual run.

- Both new page controls used a 6 px radius outside the existing scale. They now use 8 px; the acceptance rule remains unchanged.
- The untimed Design search/CSV walkthrough still looked for a hard-coded “next 50” button. It now follows the actual 20/50 control and complete visible ranges, rejecting skipped, missing and duplicate symbols. Eight focused DOM-backed regressions cover searches with 57 matches; these are not substitutes for a browser rerun.
- The real DV screenshot showed method qualification 9/9 beside a differently defined daily rule also named “selection conditions.” The daily rule now says “共通購入モデルへの適合,” with an explanation that the application checks both Minervini and IBD. Its stable ID, AND predicate and separate unknown/failed states are unchanged. Shared feed, detail, chart and allocation presentations consume the same label. The CSV's method-qualification columns retain their existing meaning.

These changes do not validate investment returns or improve stock-selection accuracy empirically. The source-freshness work improves the correctness and visibility of evidence; comparative historical evaluation remains separate. This captured revision did not meet release acceptance and was not published.
