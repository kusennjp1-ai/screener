# Market-regime study — CI: live long history + Yahoo index history since 1990

market-regime-study-v2 (pre-registered in frontend/tools/market-regime-study.mjs, with its deviations from v1) · as of 2026-11-03 · rotation placebo: up to 399 shifts per panel, margin 343 sessions · robust = placebo p ≤ 0.05 and both halves agree in sign

Diagnostic research only: nothing here changes a rule, threshold, verdict or published value. Returns are forward index returns from the close of the session the state was observed (strictly causal). Δ columns are in percentage points: a bucket minus the unconditional baseline of the same sample (three or more buckets), or for a two-state indicator one contrast, the first state minus the second. [band] is the 90% range of Δ when the indicator series is rotated against the outcomes (what chance alone produced on this data); p is the two-sided rotation-placebo p.

## Inputs

| input | basis | first | last | sessions | notes |
|---|---|---|---|---|---|
| long history (as of 2026-11-03) | current-published-universe-retrospective; historical membership verified: false | 2021-10-14 | 2026-11-03 | 1269 | universe 4503; sha256 2903a4a1b40f; all study fields present; sp500 vs index source max diff 0.0000% over 1269; implausible moves 0 |
| ^GSPC OHLCV | Yahoo Finance index OHLCV; calendar independent | 1990-01-02 | 2026-11-03 | 9278 | valid bars 9277, invalid 1, missing sessions 0, off-calendar 0, valid runs 2, implausible moves 0; last bar 2026-11-03 |
| ^IXIC OHLCV | Yahoo Finance index OHLCV; calendar independent | 1990-01-02 | 2026-11-03 | 9278 | valid bars 9278, invalid 0, missing sessions 0, off-calendar 0, valid runs 1, implausible moves 0; last bar 2026-11-03 |

- The long history is a CURRENT-UNIVERSE RETROSPECTIVE: stocks delisted before the capture are missing, so early breadth tends to read healthier than it was. This study cannot measure that bias (see the survivorship section); read breadth results with it in mind.

## Tests and chance level

51 of 51 indicators had judged sessions; 167 contrasts (a two-state indicator is one) × 4 windows × 2 statistics = **1336 tests**, from 408 indicator-level tests (indicator × window × statistic). The windows overlap: each starts at the same close.
Labels: robust 121 (in 8 input groups) · weak 390 · unstable 447 · insufficient 378. robust = rotation-placebo p ≤ 0.05 and both halves' Δ have the full-sample sign. Labels share a group when their indicators share an input series; the same rule on ^GSPC, ^IXIC and the long-history S&P is one input.

Chance level (rotation placebo: the whole labelling rerun on each of 251 shifts, one shift for every indicator of a panel so the tests' dependence is kept): robust labels median 51, 95th percentile 102.5, max 183; 4% of shifts reached the actual 121. Robust groups: actual 8, placebo median 9, 95th percentile 13.
- index:^GSPC: 9278 sessions, 383 shifts (344–8918); robust labels actual 58, placebo median 5, 95th percentile 21.9.
- index:^IXIC: 9278 sessions, 383 shifts (344–8918); robust labels actual 50, placebo median 5, 95th percentile 26.9.
- breadth: 1269 sessions, 251 shifts (344–924); robust labels actual 13, placebo median 32, 95th percentile 91.5.

**121 robust labels exceed the placebo 95th percentile (102.5).** Read them with the split and survivorship caveats.

## Labels passing the split rule (placebo p ≤ 0.05, halves agree) — chance level median 51, 95th percentile 102.5 (placebo)

| group | indicator | state | h | n | episodes | mean | reference | Δmean [placebo band] p | P(DD≤−5%) | ΔP(DD≤−5%) [placebo band] p | which |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | S&Pの分配日 ≥ 5 (distribution days) `^GSPC.dd.binary` | 5日以上 (warning) vs 4日以下 | 5 | 3769 / 5453 | 170 / 175 | +0.29% | +0.13% | +0.16 [−0.16, +0.17] p 0.154 | 4% / 2% | +2.2 [−1.3, +1.5] p 0.010 | dd5 |
| 1 | S&Pの分配日 ≥ 5 (distribution days) `^GSPC.dd.binary` | 5日以上 (warning) vs 4日以下 | 10 | 3765 / 5452 | 140 / 132 | +0.48% | +0.32% | +0.16 [−0.33, +0.33] p 0.361 | 11% / 6% | +4.7 [−2.4, +2.6] p 0.005 | dd5 |
| 1 | S&Pの分配日 ≥ 5 (distribution days) `^GSPC.dd.binary` | 5日以上 (warning) vs 4日以下 | 21 | 3754 / 5452 | 105 / 72 | +1.04% | +0.65% | +0.40 [−0.59, +0.59] p 0.274 | 20% / 14% | +5.6 [−4.7, +4.6] p 0.048 | dd5 |
| 1 | S&Pの分配日 graded `^GSPC.dd.graded` | 7+ | 5 | 1227 | 120 | +0.26% | baseline +0.19% | +0.07 [−0.22, +0.19] p 0.620 | 7% | +3.6 [−1.5, +2.0] p 0.019 | dd5 |
| 1 | S&Pの分配日 graded `^GSPC.dd.graded` | 0-2 | 10 | 2310 | 142 | +0.38% | baseline +0.38% | −0.00 [−0.24, +0.27] p 0.981 | 5% | −3.0 [−2.2, +2.0] p 0.014 | dd5 |
| 1 | S&Pの分配日 graded `^GSPC.dd.graded` | 7+ | 10 | 1227 | 105 | +0.62% | baseline +0.38% | +0.24 [−0.38, +0.36] p 0.260 | 15% | +6.8 [−2.8, +3.4] p 0.005 | dd5 |
| 1 | S&Pの分配日 graded `^GSPC.dd.graded` | 7+ | 21 | 1221 | 89 | +1.35% | baseline +0.81% | +0.54 [−0.71, +0.63] p 0.192 | 26% | +9.9 [−4.5, +5.2] p 0.005 | dd5 |
| 1 | S&P 500 vs 50-day SMA (50日線) `^GSPC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 5 | 6211 / 3003 | 133 / 172 | +0.14% | +0.32% | −0.18 [−0.16, +0.14] p 0.053 | 1% / 7% | −5.5 [−1.8, +1.5] p 0.014 | dd5 |
| 1 | S&P 500 vs 50-day SMA (50日線) `^GSPC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 10 | 6209 / 3000 | 77 / 130 | +0.33% | +0.52% | −0.19 [−0.31, +0.30] p 0.322 | 4% / 15% | −10.4 [−3.2, +2.8] p 0.005 | dd5 |
| 1 | S&P 500 vs 50-day SMA (50日線) `^GSPC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 21 | 6200 / 2998 | 46 / 97 | +0.64% | +1.19% | −0.55 [−0.57, +0.58] p 0.120 | 12% / 26% | −14.2 [−5.0, +4.2] p 0.005 | dd5 |
| 1 | S&P 500 vs 200-day SMA (200日線) `^GSPC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 5 | 6917 / 2157 | 51 / 62 | +0.20% | +0.21% | −0.01 [−0.16, +0.19] p 0.947 | 1% / 9% | −7.4 [−2.9, +2.1] p 0.005 | dd5 |
| 1 | S&P 500 vs 200-day SMA (200日線) `^GSPC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 10 | 6912 / 2157 | 36 / 48 | +0.41% | +0.40% | +0.01 [−0.32, +0.38] p 0.841 | 4% / 18% | −13.6 [−4.7, +3.5] p 0.014 | dd5 |
| 1 | S&P 500 vs 200-day SMA (200日線) `^GSPC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 21 | 6901 / 2157 | 20 / 38 | +0.87% | +0.80% | +0.06 [−0.68, +0.71] p 0.740 | 11% / 32% | −20.9 [−7.8, +6.3] p 0.005 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の上 (above both) | 5 | 5511 | 118 | +0.14% | baseline +0.21% | −0.07 [−0.06, +0.06] p 0.067 | 1% | −1.9 [−0.8, +0.6] p 0.014 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 200日線の上・50日線の下 (above 200, below 50) | 5 | 1406 | 165 | +0.46% | baseline +0.21% | +0.26 [−0.18, +0.17] p 0.014 | 2% | −1.0 [−1.3, +1.5] p 0.236 | mean |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の下 (below both) | 5 | 1528 | 74 | +0.24% | baseline +0.21% | +0.04 [−0.17, +0.16] p 0.798 | 11% | +7.8 [−1.6, +2.2] p 0.005 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の上 (above both) | 10 | 5509 | 68 | +0.33% | baseline +0.40% | −0.08 [−0.11, +0.12] p 0.264 | 4% | −3.9 [−1.3, +1.1] p 0.014 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の下 (below both) | 10 | 1528 | 58 | +0.41% | baseline +0.40% | +0.01 [−0.33, +0.31] p 0.928 | 21% | +13.2 [−3.1, +3.6] p 0.005 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の上 (above both) | 21 | 5500 | 40 | +0.70% | baseline +0.85% | −0.15 [−0.22, +0.23] p 0.322 | 10% | −5.9 [−2.2, +1.9] p 0.005 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 200日線の上・50日線の下 (above 200, below 50) | 21 | 1401 | 84 | +1.50% | baseline +0.85% | +0.65 [−0.60, +0.50] p 0.034 | 15% | −1.5 [−3.8, +4.4] p 0.553 | mean |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の下 (below both) | 21 | 1528 | 51 | +1.04% | baseline +0.85% | +0.19 [−0.62, +0.62] p 0.712 | 35% | +18.7 [−5.4, +6.0] p 0.005 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の上 (above both) | 63 | 5461 | 8 | +2.45% | baseline +2.52% | −0.08 [−0.54, +0.55] p 0.957 | 25% | −6.4 [−3.1, +3.1] p 0.014 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 200日線の上・50日線の下 (above 200, below 50) | 63 | 1398 | 37 | +3.80% | baseline +2.52% | +1.28 [−1.12, +0.91] p 0.029 | 25% | −6.3 [−5.5, +6.0] p 0.053 | mean |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 200日線の下・50日線の上 (below 200, above 50) | 63 | 629 | 17 | +1.60% | baseline +2.52% | −0.93 [−2.11, +2.24] p 0.399 | 49% | +17.9 [−12.8, +11.9] p 0.024 | dd5 |
| 1 | S&P 500 50/200-day position `^GSPC.ma.quadrant` | 50日線・200日線の下 (below both) | 63 | 1528 | 29 | +2.01% | baseline +2.52% | −0.52 [−1.57, +1.52] p 0.495 | 53% | +21.3 [−8.2, +9.6] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日5+・50日線以下 | 5 | 2222 | 161 | +0.38% | baseline +0.19% | +0.19 [−0.14, +0.15] p 0.029 | 6% | +3.1 [−1.2, +1.4] p 0.014 | mean, dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線以下 | 5 | 781 | 120 | +0.15% | baseline +0.19% | −0.05 [−0.24, +0.23] p 0.784 | 9% | +5.6 [−1.7, +2.6] p 0.014 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線の上 | 5 | 4644 | 177 | +0.12% | baseline +0.19% | −0.07 [−0.08, +0.08] p 0.159 | 1% | −2.0 [−0.8, +0.7] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日5+・50日線以下 | 10 | 2219 | 129 | +0.61% | baseline +0.38% | +0.23 [−0.27, +0.25] p 0.130 | 14% | +6.3 [−2.3, +2.4] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線以下 | 10 | 781 | 101 | +0.25% | baseline +0.38% | −0.13 [−0.44, +0.39] p 0.538 | 17% | +8.9 [−3.5, +4.3] p 0.014 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線の上 | 10 | 4643 | 134 | +0.32% | baseline +0.38% | −0.06 [−0.16, +0.16] p 0.524 | 4% | −3.7 [−1.5, +1.3] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日5+・50日線以下 | 21 | 2217 | 103 | +1.33% | baseline +0.81% | +0.52 [−0.45, +0.45] p 0.072 | 25% | +8.4 [−3.6, +3.8] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線以下 | 21 | 781 | 83 | +0.79% | baseline +0.81% | −0.02 [−0.72, +0.67] p 0.865 | 29% | +12.8 [−5.6, +5.9] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線の上 | 21 | 4643 | 84 | +0.62% | baseline +0.81% | −0.19 [−0.30, +0.30] p 0.322 | 12% | −4.8 [−2.3, +2.2] p 0.005 | dd5 |
| 1 | S&P: distribution days x 50-day line `^GSPC.combo.dd_ma50` | 分配日4以下・50日線以下 | 63 | 780 | 43 | +2.25% | baseline +2.43% | −0.18 [−1.37, +1.40] p 0.712 | 46% | +14.0 [−8.1, +8.4] p 0.005 | dd5 |
| 1 | NASの分配日 graded `^IXIC.dd.graded` | 7+ | 5 | 1307 | 101 | +0.21% | baseline +0.27% | −0.06 [−0.24, +0.26] p 0.611 | 11% | +4.0 [−2.3, +2.4] p 0.014 | dd5 |
| 1 | NASの分配日 graded `^IXIC.dd.graded` | 7+ | 10 | 1307 | 88 | +0.47% | baseline +0.54% | −0.07 [−0.48, +0.51] p 0.755 | 21% | +6.0 [−3.7, +3.8] p 0.005 | dd5 |
| 1 | NASの分配日 graded `^IXIC.dd.graded` | 3-4 | 21 | 2782 | 123 | +1.23% | baseline +1.15% | +0.08 [−0.38, +0.36] p 0.712 | 23% | −3.2 [−2.6, +2.5] p 0.034 | dd5 |
| 1 | NASの分配日 graded `^IXIC.dd.graded` | 7+ | 21 | 1307 | 79 | +1.52% | baseline +1.15% | +0.37 [−0.88, +0.86] p 0.505 | 34% | +7.5 [−5.3, +5.5] p 0.024 | dd5 |
| 1 | NASの分配日 graded `^IXIC.dd.graded` | 3-4 | 63 | 2751 | 7 | +3.84% | baseline +3.50% | +0.34 [−0.74, +0.72] p 0.466 | 39% | −4.3 [−3.1, +3.0] p 0.034 | dd5 |
| 1 | Nasdaq Composite vs 50-day SMA (50日線) `^IXIC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 5 | 6089 / 3125 | 127 / 158 | +0.32% | +0.16% | +0.16 [−0.25, +0.24] p 0.279 | 4% / 13% | −9.7 [−2.6, +2.4] p 0.005 | dd5 |
| 1 | Nasdaq Composite vs 50-day SMA (50日線) `^IXIC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 10 | 6088 / 3121 | 84 / 117 | +0.66% | +0.31% | +0.35 [−0.48, +0.42] p 0.188 | 10% / 24% | −14.5 [−4.1, +3.7] p 0.014 | dd5 |
| 1 | Nasdaq Composite vs 50-day SMA (50日線) `^IXIC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 21 | 6080 / 3118 | 47 / 88 | +1.21% | +1.03% | +0.18 [−0.90, +0.78] p 0.712 | 20% / 38% | −17.4 [−6.0, +5.7] p 0.005 | dd5 |
| 1 | Nasdaq Composite vs 50-day SMA (50日線) `^IXIC.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 63 | 6040 / 3116 | 9 / 34 | +3.36% | +3.76% | −0.39 [−2.16, +2.08] p 0.870 | 39% / 52% | −12.8 [−8.5, +8.3] p 0.010 | dd5 |
| 1 | Nasdaq Composite vs 200-day SMA (200日線) `^IXIC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 5 | 6752 / 2322 | 45 / 55 | +0.31% | +0.23% | +0.09 [−0.26, +0.23] p 0.476 | 4% / 16% | −12.4 [−4.2, +3.4] p 0.005 | dd5 |
| 1 | Nasdaq Composite vs 200-day SMA (200日線) `^IXIC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 10 | 6747 / 2322 | 38 / 44 | +0.62% | +0.45% | +0.16 [−0.49, +0.45] p 0.481 | 10% / 28% | −18.1 [−6.3, +6.1] p 0.005 | dd5 |
| 1 | Nasdaq Composite vs 200-day SMA (200日線) `^IXIC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 21 | 6736 / 2322 | 24 / 32 | +1.32% | +0.93% | +0.39 [−1.02, +0.92] p 0.413 | 21% / 41% | −20.8 [−7.3, +8.0] p 0.005 | dd5 |
| 1 | Nasdaq Composite vs 200-day SMA (200日線) `^IXIC.ma200` | 200日線の上 (above) vs 200日線以下 (at/below) | 63 | 6694 / 2322 | 10 / 25 | +3.87% | +3.16% | +0.71 [−2.92, +2.51] p 0.519 | 38% / 56% | −17.8 [−10.5, +12.4] p 0.005 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の上 (above both) | 5 | 5382 | 109 | +0.32% | baseline +0.29% | +0.03 [−0.10, +0.08] p 0.543 | 3% | −3.8 [−1.2, +1.1] p 0.005 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の下 (below both) | 5 | 1680 | 69 | +0.16% | baseline +0.29% | −0.13 [−0.22, +0.23] p 0.313 | 18% | +11.7 [−2.6, +3.3] p 0.005 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の上 (above both) | 10 | 5381 | 75 | +0.67% | baseline +0.57% | +0.10 [−0.19, +0.16] p 0.332 | 9% | −5.8 [−1.8, +1.8] p 0.014 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の下 (below both) | 10 | 1680 | 55 | +0.37% | baseline +0.57% | −0.20 [−0.43, +0.44] p 0.394 | 31% | +16.9 [−4.5, +5.1] p 0.005 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の上 (above both) | 21 | 5373 | 43 | +1.28% | baseline +1.22% | +0.06 [−0.37, +0.32] p 0.726 | 19% | −6.7 [−2.7, +2.8] p 0.005 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の下 (below both) | 21 | 1680 | 44 | +0.92% | baseline +1.22% | −0.30 [−0.84, +0.93] p 0.471 | 46% | +19.8 [−6.4, +6.3] p 0.005 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の上 (above both) | 63 | 5333 | 11 | +3.59% | baseline +3.69% | −0.10 [−0.91, +0.87] p 0.957 | 38% | −5.3 [−3.7, +3.8] p 0.029 | dd5 |
| 1 | Nasdaq Composite 50/200-day position `^IXIC.ma.quadrant` | 50日線・200日線の下 (below both) | 63 | 1680 | 26 | +3.15% | baseline +3.69% | −0.53 [−2.04, +2.16] p 0.596 | 59% | +16.4 [−9.5, +8.2] p 0.005 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日5+・50日線以下 | 5 | 2132 | 143 | +0.30% | baseline +0.27% | +0.03 [−0.18, +0.21] p 0.885 | 11% | +4.2 [−1.8, +1.9] p 0.005 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日5+・50日線の上 | 5 | 1166 | 144 | +0.25% | baseline +0.27% | −0.02 [−0.26, +0.26] p 0.899 | 3% | −4.1 [−3.0, +3.3] p 0.005 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線以下 | 5 | 993 | 129 | −0.13% | baseline +0.27% | −0.40 [−0.31, +0.26] p 0.058 | 18% | +11.0 [−2.9, +3.8] p 0.014 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線の上 | 5 | 4923 | 164 | +0.34% | baseline +0.27% | +0.07 [−0.10, +0.10] p 0.245 | 4% | −3.1 [−1.1, +0.9] p 0.014 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日5+・50日線以下 | 10 | 2132 | 118 | +0.55% | baseline +0.54% | +0.01 [−0.35, +0.35] p 0.971 | 21% | +6.7 [−2.9, +3.2] p 0.005 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日5+・50日線の上 | 10 | 1166 | 118 | +0.52% | baseline +0.54% | −0.02 [−0.49, +0.46] p 0.933 | 8% | −6.3 [−4.9, +5.1] p 0.014 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線以下 | 10 | 989 | 109 | −0.22% | baseline +0.54% | −0.76 [−0.53, +0.52] p 0.034 | 31% | +16.0 [−4.6, +5.5] p 0.014 | mean, dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線の上 | 10 | 4922 | 117 | +0.69% | baseline +0.54% | +0.15 [−0.20, +0.17] p 0.164 | 10% | −4.6 [−1.6, +1.5] p 0.014 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日5+・50日線以下 | 21 | 2132 | 95 | +1.37% | baseline +1.15% | +0.23 [−0.66, +0.69] p 0.668 | 34% | +8.2 [−4.2, +4.4] p 0.010 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線以下 | 21 | 986 | 87 | +0.29% | baseline +1.15% | −0.86 [−0.95, +0.98] p 0.144 | 45% | +18.5 [−6.8, +6.8] p 0.014 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線の上 | 21 | 4914 | 77 | +1.27% | baseline +1.15% | +0.12 [−0.38, +0.34] p 0.563 | 20% | −6.3 [−2.5, +2.3] p 0.005 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線以下 | 63 | 986 | 42 | +2.21% | baseline +3.50% | −1.28 [−2.11, +2.08] p 0.260 | 58% | +14.0 [−9.1, +9.3] p 0.014 | dd5 |
| 1 | NAS: distribution days x 50-day line `^IXIC.combo.dd_ma50` | 分配日4以下・50日線の上 | 63 | 4882 | 12 | +3.53% | baseline +3.50% | +0.03 [−0.79, +0.82] p 0.841 | 39% | −4.6 [−3.3, +3.1] p 0.029 | dd5 |
| 1 | S&P 500 (long history) vs 50-day SMA (50日線) `spx.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 10 | 814 / 386 | 11 / 19 | +0.41% | +0.61% | −0.21 [−1.02, +0.70] p 0.792 | 4% / 17% | −12.8 [−8.5, +7.5] p 0.025 | dd5 |
| 1 | S&P 500 (long history) vs 50-day SMA (50日線) `spx.ma50` | 50日線の上 (above) vs 50日線以下 (at/below) | 21 | 805 / 384 | 7 / 12 | +0.73% | +1.69% | −0.96 [−2.02, +1.24] p 0.449 | 12% / 32% | −19.3 [−12.7, +13.9] p 0.004 | dd5 |
| 1 | S&P 500 (long history) 50/200-day position `spx.ma.quadrant` | 50日線・200日線の上 (above both) | 10 | 721 | 8 | +0.53% | baseline +0.62% | −0.09 [−0.32, +0.22] p 0.861 | 1% | −3.9 [−2.3, +2.7] p 0.022 | dd5 |
| 1 | S&P 500 (long history) 50/200-day position `spx.ma.quadrant` | 50日線・200日線の上 (above both) | 21 | 712 | 5 | +1.17% | baseline +1.31% | −0.14 [−0.63, +0.39] p 0.920 | 8% | −6.5 [−4.3, +4.4] p 0.029 | dd5 |
| 1 | 新安値 > 新高値 (new lows outnumber new highs) `rule.lows` | 注意サイン (warning) vs なし | 10 | 492 / 767 | 25 / 14 | +0.66% | +0.34% | +0.31 [−0.45, +0.71] p 0.507 | 12% / 5% | +7.7 [−5.8, +5.7] p 0.022 | dd5 |
| 1 | 新安値 > 新高値 and S&P 500 at/below its 200-day `combo.lows_below200` | 両方 (both) vs それ以外 (otherwise) | 5 | 131 / 934 | 9 / 11 | +0.43% | +0.29% | +0.14 [−0.42, +0.68] p 0.916 | 8% / 1% | +7.1 [−3.2, +5.4] p 0.044 | dd5 |
| 1 | 新高値−新安値 (net new highs, % of coverage) `q.netHighsPercent` | Q3 | 5 | 197 | 55 | +0.93% | baseline +0.38% | +0.55 [−0.28, +0.30] p 0.007 | 0% | −0.9 [−1.8, +1.8] p 0.471 | mean |
| 1 | 新高値−新安値 (net new highs, % of coverage) 21-session change `d21.netHighsPercent` | Q3 | 21 | 253 | 6 | +0.99% | baseline +1.50% | −0.51 [−0.53, +0.47] p 0.124 | 17% | +5.6 [−4.5, +4.1] p 0.025 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 不要 (no 6% correction) | 5 | 3478 | 20 | +0.18% | baseline +0.19% | −0.00 [−0.11, +0.11] p 0.995 | 1% | −2.3 [−1.4, +1.6] p 0.005 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 調整中 (correction) | 5 | 398 | 89 | +0.92% | baseline +0.19% | +0.74 [−0.29, +0.31] p 0.005 | 12% | +9.2 [−2.1, +2.9] p 0.005 | mean, dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 反発中 (rally attempt) | 5 | 829 | 84 | +0.21% | baseline +0.19% | +0.03 [−0.22, +0.22] p 0.856 | 10% | +6.7 [−1.8, +2.5] p 0.005 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 不要 (no 6% correction) | 10 | 3478 | 20 | +0.36% | baseline +0.37% | −0.01 [−0.21, +0.21] p 0.990 | 3% | −4.5 [−2.7, +2.9] p 0.005 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 調整中 (correction) | 10 | 398 | 75 | +0.89% | baseline +0.37% | +0.52 [−0.46, +0.47] p 0.072 | 21% | +13.5 [−3.8, +4.7] p 0.005 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 反発中 (rally attempt) | 10 | 829 | 71 | +0.58% | baseline +0.37% | +0.21 [−0.36, +0.38] p 0.370 | 17% | +8.9 [−3.2, +3.6] p 0.014 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 不要 (no 6% correction) | 21 | 3478 | 20 | +0.72% | baseline +0.78% | −0.06 [−0.44, +0.42] p 0.889 | 9% | −7.8 [−4.4, +5.7] p 0.005 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 調整中 (correction) | 21 | 398 | 60 | +2.00% | baseline +0.78% | +1.22 [−0.70, +0.81] p 0.014 | 34% | +17.2 [−6.3, +7.3] p 0.005 | mean, dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 反発中 (rally attempt) | 21 | 829 | 59 | +1.49% | baseline +0.78% | +0.71 [−0.63, +0.70] p 0.091 | 27% | +10.8 [−5.3, +6.3] p 0.029 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | FTD失敗 (failed) | 21 | 938 | 29 | +0.14% | baseline +0.78% | −0.64 [−0.82, +0.82] p 0.221 | 26% | +9.2 [−7.2, +8.0] p 0.048 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 不要 (no 6% correction) | 63 | 3478 | 15 | +2.07% | baseline +2.33% | −0.25 [−1.23, +1.23] p 0.750 | 21% | −10.2 [−7.1, +8.5] p 0.005 | dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 調整中 (correction) | 63 | 398 | 31 | +4.20% | baseline +2.33% | +1.87 [−1.35, +1.53] p 0.048 | 51% | +19.4 [−9.3, +9.7] p 0.024 | mean, dd5 |
| 2 | S&PのFTD state `^GSPC.ftd.state` | 反発中 (rally attempt) | 63 | 829 | 31 | +3.12% | baseline +2.33% | +0.79 [−1.19, +1.30] p 0.365 | 44% | +12.3 [−7.6, +8.9] p 0.029 | dd5 |
| 2 | S&P: FTD confirmed within 25 sessions `^GSPC.combo.ftd_recent` | FTD確認から25日以内 vs それ以外 (any other judged state) | 10 | 1023 / 7686 | 63 / 39 | +0.45% | +0.36% | +0.10 [−0.45, +0.48] p 0.764 | 12% / 7% | +4.8 [−4.0, +4.3] p 0.043 | dd5 |
| 2 | S&P: FTD confirmed within 25 sessions `^GSPC.combo.ftd_recent` | FTD確認から25日以内 vs それ以外 (any other judged state) | 21 | 1023 / 7675 | 52 / 35 | +0.44% | +0.82% | −0.38 [−0.83, +0.85] p 0.433 | 26% / 15% | +10.2 [−6.4, +7.6] p 0.034 | dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 不要 (no 6% correction) | 5 | 2098 | 30 | +0.20% | baseline +0.27% | −0.07 [−0.26, +0.20] p 0.625 | 3% | −3.7 [−2.8, +3.6] p 0.019 | dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 調整中 (correction) | 5 | 646 | 151 | +1.06% | baseline +0.27% | +0.78 [−0.29, +0.32] p 0.005 | 15% | +7.7 [−2.8, +4.1] p 0.034 | mean, dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 反発中 (rally attempt) | 5 | 1257 | 138 | +0.28% | baseline +0.27% | +0.00 [−0.22, +0.25] p 0.966 | 14% | +7.0 [−2.3, +2.4] p 0.005 | dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 15日以内のFTDなし (attempt expired) | 5 | 374 | 16 | +0.44% | baseline +0.27% | +0.17 [−0.55, +0.50] p 0.563 | 0% | −6.8 [−5.1, +7.0] p 0.019 | dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 調整中 (correction) | 10 | 646 | 119 | +1.38% | baseline +0.55% | +0.84 [−0.47, +0.48] p 0.010 | 27% | +12.0 [−4.5, +6.6] p 0.024 | mean, dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 反発中 (rally attempt) | 10 | 1257 | 109 | +0.59% | baseline +0.55% | +0.05 [−0.39, +0.45] p 0.803 | 23% | +8.6 [−3.7, +4.1] p 0.010 | dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 15日以内のFTDなし (attempt expired) | 10 | 374 | 16 | +0.61% | baseline +0.55% | +0.06 [−1.09, +1.01] p 0.962 | 4% | −10.6 [−9.3, +10.9] p 0.038 | dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 調整中 (correction) | 21 | 646 | 87 | +2.17% | baseline +1.15% | +1.02 [−0.76, +0.81] p 0.038 | 39% | +13.2 [−6.0, +7.1] p 0.014 | mean, dd5 |
| 2 | NASのFTD state `^IXIC.ftd.state` | 調整中 (correction) | 63 | 646 | 45 | +4.02% | baseline +3.48% | +0.53 [−1.65, +1.69] p 0.596 | 56% | +12.3 [−7.5, +8.7] p 0.005 | dd5 |
| 3 | S&P 500 within 5% of the 252-session closing high `^GSPC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 5 | 6253 / 2769 | 60 / 88 | +0.16% | +0.29% | −0.13 [−0.15, +0.15] p 0.202 | 1% / 8% | −6.5 [−2.3, +2.0] p 0.005 | dd5 |
| 3 | S&P 500 within 5% of the 252-session closing high `^GSPC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 10 | 6248 / 2769 | 40 / 64 | +0.35% | +0.53% | −0.18 [−0.31, +0.30] p 0.385 | 4% / 16% | −11.7 [−3.8, +3.7] p 0.005 | dd5 |
| 3 | S&P 500 within 5% of the 252-session closing high `^GSPC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 21 | 6237 / 2769 | 20 / 57 | +0.74% | +1.07% | −0.33 [−0.69, +0.60] p 0.466 | 11% / 29% | −18.4 [−6.7, +6.4] p 0.005 | dd5 |
| 3 | S&P 500 within 5% of the 252-session closing high `^GSPC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 63 | 6195 / 2769 | 8 / 36 | +2.36% | +2.70% | −0.35 [−1.79, +1.70] p 0.808 | 25% / 46% | −21.0 [−10.2, +10.1] p 0.005 | dd5 |
| 3 | Nasdaq Composite within 5% of the 252-session closing high `^IXIC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 5 | 5092 / 3930 | 85 / 97 | +0.27% | +0.30% | −0.03 [−0.25, +0.21] p 0.938 | 3% / 12% | −9.4 [−3.6, +3.4] p 0.005 | dd5 |
| 3 | Nasdaq Composite within 5% of the 252-session closing high `^IXIC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 10 | 5090 / 3927 | 53 / 81 | +0.56% | +0.58% | −0.02 [−0.48, +0.41] p 0.928 | 8% / 23% | −14.2 [−5.2, +5.3] p 0.005 | dd5 |
| 3 | Nasdaq Composite within 5% of the 252-session closing high `^IXIC.high.near` | 1年高値から5%以内 (near high) vs 5%超の下 (further below) | 21 | 5080 / 3926 | 31 / 63 | +1.07% | +1.36% | −0.29 [−0.89, +0.79] p 0.683 | 19% / 35% | −15.7 [−6.3, +7.1] p 0.005 | dd5 |
| 4 | リーダーの健全度 (leader health) `rule.leaders` | 注意サイン (warning) vs なし | 10 | 272 / 984 | 19 / 14 | +1.33% | +0.22% | +1.11 [−0.68, +0.94] p 0.044 | 11% / 7% | +3.8 [−7.0, +7.0] p 0.354 | mean |
| 5 | 50日線より上 (% above 50-day) `q.above50Percent` | Q5 上位20% (top fifth of earlier sessions) | 5 | 203 | 19 | +0.03% | baseline +0.38% | −0.35 [−0.29, +0.42] p 0.040 | 1% | +0.6 [−2.5, +1.7] p 0.380 | mean |
| 6 | 200日線より上 (% above 200-day) 21-session change `d21.above200Percent` | Q3 | 21 | 227 | 13 | +1.34% | baseline +1.50% | −0.16 [−0.94, +0.59] p 0.931 | 4% | −7.8 [−4.9, +8.8] p 0.004 | dd5 |
| 7 | ブレイクアウト成功率 (breakout hold %) 21-session change `d21.breakoutHoldPercent` | Q3 | 21 | 280 | 15 | +0.28% | baseline +1.56% | −1.28 [−0.95, +0.87] p 0.022 | 17% | +5.5 [−7.1, +7.6] p 0.212 | mean |
| 8 | ステージ2−ステージ4 (stage 2 % minus stage 4 %) 21-session change `d21.stageSpread` | Q2 | 10 | 101 | 21 | +1.82% | baseline +0.70% | +1.12 [−0.87, +0.84] p 0.029 | 0% | −3.3 [−5.7, +7.0] p 0.347 | mean |

## Survivorship diagnostics (long history): a relative-tilt check only

These cannot measure the survivorship (delisting) bias: the capture holds aggregates of today's names only, so neither the delisted names nor a run restricted to names with history across the whole window can be formed from it.

| year | sessions | eligible / universe (listing age) | coverage / universe | mean above50% residual |
|---|---|---|---|---|
| 2021 | 55 | 80% | 77% | — |
| 2022 | 251 | 85% | 83% | 1.282 |
| 2023 | 250 | 90% | 87% | -1.689 |
| 2024 | 252 | 92% | 88% | 1.37 |
| 2025 | 250 | 94% | 93% | 0.244 |
| 2026 | 211 | 97% | 97% | -0.574 |

eligible / universe is the share of today's names with enough price history on that session (listing age), not a count of delisted names.

OLS above50Percent = 44.8688 + 4.3406·(^GSPC % vs 50-day) − 0.244·(% vs 200-day), R² 0.6655, n 1070, from 2022-08-01 (the first session with both states judged; 199 breadth sessions are outside the fit). Mean residual first half (2022-08-01–2024-09-16) -0.126 pt, second half (2024-09-17–2026-11-03) 0.126 pt. With an intercept the residuals sum to zero, so the halves mirror each other and a constant (level) bias leaves no trace; a bias that tracks the index is absorbed by the fit. The residuals show only whether breadth drifts against the index over time.

## All indicators

### S&Pの分配日 ≥ 5 (distribution days) — `^GSPC.dd.binary`

index-down-strictly-over-0.2-higher-volume-age25-high5-v1; market tab warning at >= DISTRIBUTION_WARN. Outcome: ^GSPC (index OHLCV). Judged 9227 sessions (1990-02-06 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9222 | | split 2008-05-30, embargo 5 | +0.19% | +0.33% | 58% | 3% | 0% | | | | |
| 5日以上 (warning) | 5 | 3769 | 170 | 50% | +0.29% | +0.44% | 58% | 4% | 1% | +0.16 [−0.16, +0.17] p 0.154 | weak | +2.2 [−1.3, +1.5] p 0.010 | **robust** |
| 4日以下 | 5 | 5453 | 175 | 50% | +0.13% | +0.27% | 57% | 2% | 0% | (the contrast above) | | | |
| baseline | 10 | 9217 | | split 2008-06-03, embargo 10 | +0.38% | +0.62% | 60% | 8% | 2% | | | | |
| 5日以上 (warning) | 10 | 3765 | 140 | 50% | +0.48% | +0.73% | 60% | 11% | 2% | +0.16 [−0.33, +0.33] p 0.361 | unstable | +4.7 [−2.4, +2.6] p 0.005 | **robust** |
| 4日以下 | 10 | 5452 | 132 | 50% | +0.32% | +0.54% | 60% | 6% | 1% | (the contrast above) | | | |
| baseline | 21 | 9206 | | split 2008-06-11, embargo 21 | +0.81% | +1.23% | 64% | 17% | 4% | | | | |
| 5日以上 (warning) | 21 | 3754 | 105 | 50% | +1.04% | +1.51% | 64% | 20% | 5% | +0.40 [−0.59, +0.59] p 0.274 | weak | +5.6 [−4.7, +4.6] p 0.048 | **robust** |
| 4日以下 | 21 | 5452 | 72 | 50% | +0.65% | +1.10% | 64% | 14% | 3% | (the contrast above) | | | |
| baseline | 63 | 9164 | | split 2008-07-11, embargo 63 | +2.45% | +3.19% | 70% | 32% | 14% | | | | |
| 5日以上 (warning) | 63 | 3738 | 15 | 50% | +2.61% | +3.29% | 71% | 33% | 17% | +0.28 [−1.22, +1.04] p 0.702 | unstable | +1.6 [−7.1, +6.6] p 0.692 | unstable |
| 4日以下 | 63 | 5426 | 5 | 50% | +2.33% | +3.11% | 70% | 31% | 11% | (the contrast above) | | | |

### S&Pの分配日 graded — `^GSPC.dd.graded`

index-down-strictly-over-0.2-higher-volume-age25-high5-v1. Outcome: ^GSPC (index OHLCV). Judged 9227 sessions (1990-02-06 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9222 | | split 2008-05-30, embargo 5 | +0.19% | +0.33% | 58% | 3% | 0% | | | | |
| 0-2 | 5 | 2310 | 168 | 49% | +0.18% | +0.29% | 58% | 2% | 0% | −0.02 [−0.14, +0.15] p 0.755 | unstable | −1.1 [−1.2, +1.2] p 0.115 | weak |
| 3-4 | 5 | 3143 | 295 | 51% | +0.10% | +0.23% | 56% | 2% | 0% | −0.10 [−0.11, +0.10] p 0.135 | weak | −0.8 [−0.8, +0.9] p 0.101 | weak |
| 5-6 | 5 | 2542 | 245 | 53% | +0.30% | +0.40% | 59% | 3% | 0% | +0.10 [−0.11, +0.14] p 0.168 | weak | +0.2 [−0.9, +1.0] p 0.688 | weak |
| 7+ | 5 | 1227 | 120 | 45% | +0.26% | +0.52% | 58% | 7% | 1% | +0.07 [−0.22, +0.19] p 0.620 | unstable | +3.6 [−1.5, +2.0] p 0.019 | **robust** |
| baseline | 10 | 9217 | | split 2008-06-03, embargo 10 | +0.38% | +0.62% | 60% | 8% | 2% | | | | |
| 0-2 | 10 | 2310 | 142 | 49% | +0.38% | +0.59% | 60% | 5% | 1% | −0.00 [−0.24, +0.27] p 0.981 | unstable | −3.0 [−2.2, +2.0] p 0.014 | **robust** |
| 3-4 | 10 | 3142 | 211 | 51% | +0.27% | +0.52% | 60% | 7% | 1% | −0.11 [−0.18, +0.17] p 0.293 | weak | −1.2 [−1.4, +1.4] p 0.183 | weak |
| 5-6 | 10 | 2538 | 174 | 53% | +0.41% | +0.66% | 60% | 9% | 2% | +0.03 [−0.20, +0.22] p 0.832 | unstable | +0.8 [−1.8, +1.6] p 0.404 | weak |
| 7+ | 10 | 1227 | 105 | 45% | +0.62% | +0.98% | 61% | 15% | 3% | +0.24 [−0.38, +0.36] p 0.260 | weak | +6.8 [−2.8, +3.4] p 0.005 | **robust** |
| baseline | 21 | 9206 | | split 2008-06-11, embargo 21 | +0.81% | +1.23% | 64% | 17% | 4% | | | | |
| 0-2 | 21 | 2310 | 120 | 49% | +0.77% | +1.19% | 63% | 14% | 2% | −0.04 [−0.46, +0.47] p 0.827 | unstable | −2.8 [−3.8, +3.6] p 0.288 | unstable |
| 3-4 | 21 | 3142 | 104 | 50% | +0.56% | +1.05% | 64% | 15% | 4% | −0.25 [−0.25, +0.25] p 0.115 | weak | −1.9 [−2.3, +2.2] p 0.164 | weak |
| 5-6 | 21 | 2533 | 120 | 53% | +0.90% | +1.28% | 64% | 17% | 4% | +0.09 [−0.37, +0.34] p 0.673 | unstable | +0.2 [−3.0, +3.1] p 0.986 | unstable |
| 7+ | 21 | 1221 | 89 | 45% | +1.35% | +1.89% | 66% | 26% | 8% | +0.54 [−0.71, +0.63] p 0.192 | weak | +9.9 [−4.5, +5.2] p 0.005 | **robust** |
| baseline | 63 | 9164 | | split 2008-07-11, embargo 63 | +2.45% | +3.19% | 70% | 32% | 14% | | | | |
| 0-2 | 63 | 2299 | 31 | 49% | +2.59% | +3.35% | 70% | 31% | 11% | +0.15 [−0.89, +0.82] p 0.851 | unstable | −0.9 [−5.3, +5.4] p 0.827 | unstable |
| 3-4 | 63 | 3127 | 7 | 50% | +2.14% | +2.97% | 70% | 31% | 12% | −0.31 [−0.54, +0.52] p 0.327 | weak | −0.4 [−3.4, +3.1] p 0.803 | weak |
| 5-6 | 63 | 2521 | 16 | 53% | +2.11% | +2.98% | 69% | 31% | 16% | −0.33 [−0.61, +0.72] p 0.462 | weak | −0.8 [−4.5, +3.7] p 0.654 | unstable |
| 7+ | 63 | 1217 | 44 | 45% | +3.64% | +4.27% | 74% | 36% | 19% | +1.20 [−1.31, +1.20] p 0.106 | unstable | +4.6 [−6.7, +7.3] p 0.303 | weak |

### S&PのFTD state — `^GSPC.ftd.state`

rally-attempt-gain1.2-day4-15-decline6-v1 on the trailing 280 sessions. Outcome: ^GSPC (index OHLCV). Judged 8719 sessions (1991-02-07 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 8714 | | split 2008-05-30, embargo 5 | +0.19% | +0.32% | 58% | 3% | 0% | | | | |
| 不要 (no 6% correction) | 5 | 3478 | 20 | 58% | +0.18% | +0.30% | 59% | 1% | 0% | −0.00 [−0.11, +0.11] p 0.995 | unstable | −2.3 [−1.4, +1.6] p 0.005 | **robust** |
| 判定保留 (window opens on the peak) | 5 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 5 | 398 | 89 | 48% | +0.92% | +1.07% | 63% | 12% | 3% | +0.74 [−0.29, +0.31] p 0.005 | **robust** | +9.2 [−2.1, +2.9] p 0.005 | **robust** |
| 反発中 (rally attempt) | 5 | 829 | 84 | 48% | +0.21% | +0.53% | 58% | 10% | 2% | +0.03 [−0.22, +0.22] p 0.856 | unstable | +6.7 [−1.8, +2.5] p 0.005 | **robust** |
| 15日以内のFTDなし (attempt expired) | 5 | 301 | 10 | 21% | +0.62% | +0.67% | 65% | 1% | 0% | +0.43 [−0.48, +0.39] p 0.058 | weak | −2.1 [−3.1, +6.0] p 0.476 | weak |
| 確認 (FTD confirmed) | 5 | 2770 | 67 | 38% | +0.12% | +0.26% | 55% | 3% | 0% | −0.07 [−0.12, +0.13] p 0.356 | weak | −0.6 [−1.7, +1.9] p 0.639 | unstable |
| FTD失敗 (failed) | 5 | 938 | 37 | 66% | −0.08% | +0.22% | 54% | 4% | 1% | −0.26 [−0.24, +0.22] p 0.067 | weak | +1.2 [−2.1, +3.3] p 0.399 | weak |
| baseline | 10 | 8709 | | split 2008-06-03, embargo 10 | +0.37% | +0.61% | 60% | 8% | 2% | | | | |
| 不要 (no 6% correction) | 10 | 3478 | 20 | 58% | +0.36% | +0.56% | 62% | 3% | 0% | −0.01 [−0.21, +0.21] p 0.990 | unstable | −4.5 [−2.7, +2.9] p 0.005 | **robust** |
| 判定保留 (window opens on the peak) | 10 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 10 | 398 | 75 | 48% | +0.89% | +0.90% | 60% | 21% | 9% | +0.52 [−0.46, +0.47] p 0.072 | weak | +13.5 [−3.8, +4.7] p 0.005 | **robust** |
| 反発中 (rally attempt) | 10 | 829 | 71 | 48% | +0.58% | +1.09% | 63% | 17% | 6% | +0.21 [−0.36, +0.38] p 0.370 | weak | +8.9 [−3.2, +3.6] p 0.014 | **robust** |
| 15日以内のFTDなし (attempt expired) | 10 | 301 | 10 | 21% | +1.22% | +1.36% | 75% | 3% | 0% | +0.85 [−0.91, +0.77] p 0.067 | weak | −4.5 [−6.9, +10.6] p 0.409 | weak |
| 確認 (FTD confirmed) | 10 | 2765 | 61 | 38% | +0.28% | +0.48% | 57% | 8% | 1% | −0.09 [−0.24, +0.22] p 0.558 | weak | −0.2 [−3.2, +3.5] p 0.976 | unstable |
| FTD失敗 (failed) | 10 | 938 | 36 | 66% | −0.03% | +0.46% | 57% | 13% | 1% | −0.40 [−0.42, +0.41] p 0.115 | weak | +5.1 [−4.0, +5.0] p 0.096 | weak |
| baseline | 21 | 8698 | | split 2008-06-11, embargo 21 | +0.78% | +1.21% | 64% | 16% | 4% | | | | |
| 不要 (no 6% correction) | 21 | 3478 | 20 | 58% | +0.72% | +1.10% | 65% | 9% | 1% | −0.06 [−0.44, +0.42] p 0.889 | unstable | −7.8 [−4.4, +5.7] p 0.005 | **robust** |
| 判定保留 (window opens on the peak) | 21 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 21 | 398 | 60 | 48% | +2.00% | +2.44% | 65% | 34% | 18% | +1.22 [−0.70, +0.81] p 0.014 | **robust** | +17.2 [−6.3, +7.3] p 0.005 | **robust** |
| 反発中 (rally attempt) | 21 | 829 | 59 | 48% | +1.49% | +2.62% | 67% | 27% | 12% | +0.71 [−0.63, +0.70] p 0.091 | weak | +10.8 [−5.3, +6.3] p 0.029 | **robust** |
| 15日以内のFTDなし (attempt expired) | 21 | 301 | 10 | 21% | +2.36% | +2.38% | 85% | 5% | 1% | +1.58 [−1.81, +1.55] p 0.101 | weak | −11.5 [−12.4, +16.6] p 0.139 | weak |
| 確認 (FTD confirmed) | 21 | 2754 | 39 | 38% | +0.50% | +0.88% | 61% | 19% | 4% | −0.27 [−0.44, +0.44] p 0.356 | weak | +2.3 [−5.8, +5.9] p 0.591 | unstable |
| FTD失敗 (failed) | 21 | 938 | 29 | 66% | +0.14% | +1.12% | 58% | 26% | 6% | −0.64 [−0.82, +0.82] p 0.221 | unstable | +9.2 [−7.2, +8.0] p 0.048 | **robust** |
| baseline | 63 | 8656 | | split 2008-07-11, embargo 63 | +2.33% | +3.05% | 70% | 32% | 14% | | | | |
| 不要 (no 6% correction) | 63 | 3478 | 15 | 58% | +2.07% | +2.82% | 72% | 21% | 6% | −0.25 [−1.23, +1.23] p 0.750 | weak | −10.2 [−7.1, +8.5] p 0.005 | **robust** |
| 判定保留 (window opens on the peak) | 63 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 63 | 398 | 31 | 48% | +4.20% | +4.66% | 67% | 51% | 32% | +1.87 [−1.35, +1.53] p 0.048 | **robust** | +19.4 [−9.3, +9.7] p 0.024 | **robust** |
| 反発中 (rally attempt) | 63 | 829 | 31 | 48% | +3.12% | +4.10% | 68% | 44% | 27% | +0.79 [−1.19, +1.30] p 0.365 | unstable | +12.3 [−7.6, +8.9] p 0.029 | **robust** |
| 15日以内のFTDなし (attempt expired) | 63 | 301 | 10 | 21% | +3.91% | +4.93% | 76% | 19% | 1% | +1.58 [−4.38, +4.05] p 0.538 | weak | −12.4 [−20.2, +27.5] p 0.409 | weak |
| 確認 (FTD confirmed) | 63 | 2712 | 18 | 38% | +2.37% | +3.16% | 69% | 36% | 15% | +0.04 [−1.23, +1.22] p 0.957 | unstable | +4.6 [−8.6, +8.5] p 0.389 | unstable |
| FTD失敗 (failed) | 63 | 938 | 20 | 66% | +1.15% | +2.48% | 64% | 41% | 25% | −1.18 [−2.16, +2.20] p 0.375 | unstable | +9.4 [−11.1, +11.2] p 0.168 | unstable |

### S&P 500 vs 50-day SMA (50日線) — `^GSPC.ma50`

indexSummary vsMa > 0. Outcome: ^GSPC (index OHLCV). Judged 9219 sessions (1990-03-27 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9214 | | split 2008-07-14, embargo 5 | +0.20% | +0.33% | 58% | 3% | 0% | | | | |
| 50日線の上 (above) | 5 | 6211 | 133 | 48% | +0.14% | +0.28% | 58% | 1% | 0% | −0.18 [−0.16, +0.14] p 0.053 | weak | −5.5 [−1.8, +1.5] p 0.014 | **robust** |
| 50日線以下 (at/below) | 5 | 3003 | 172 | 54% | +0.32% | +0.50% | 58% | 7% | 1% | (the contrast above) | | | |
| baseline | 10 | 9209 | | split 2008-07-16, embargo 10 | +0.39% | +0.63% | 60% | 8% | 2% | | | | |
| 50日線の上 (above) | 10 | 6209 | 77 | 48% | +0.33% | +0.54% | 61% | 4% | 0% | −0.19 [−0.31, +0.30] p 0.322 | weak | −10.4 [−3.2, +2.8] p 0.005 | **robust** |
| 50日線以下 (at/below) | 10 | 3000 | 130 | 54% | +0.52% | +0.92% | 60% | 15% | 4% | (the contrast above) | | | |
| baseline | 21 | 9198 | | split 2008-07-24, embargo 21 | +0.82% | +1.23% | 64% | 17% | 4% | | | | |
| 50日線の上 (above) | 21 | 6200 | 46 | 48% | +0.64% | +1.06% | 64% | 12% | 2% | −0.55 [−0.57, +0.58] p 0.120 | weak | −14.2 [−5.0, +4.2] p 0.005 | **robust** |
| 50日線以下 (at/below) | 21 | 2998 | 97 | 54% | +1.19% | +1.83% | 65% | 26% | 9% | (the contrast above) | | | |
| baseline | 63 | 9156 | | split 2008-08-22, embargo 63 | +2.43% | +3.16% | 70% | 32% | 14% | | | | |
| 50日線の上 (above) | 63 | 6161 | 5 | 48% | +2.25% | +2.97% | 70% | 28% | 9% | −0.54 [−1.19, +1.27] p 0.601 | insufficient | −12.2 [−7.5, +7.7] p 0.005 | insufficient |
| 50日線以下 (at/below) | 63 | 2995 | 31 | 53% | +2.79% | +3.76% | 71% | 40% | 23% | (the contrast above) | | | |

### S&P 500 vs 200-day SMA (200日線) — `^GSPC.ma200`

indexSummary vs200 > 0. Outcome: ^GSPC (index OHLCV). Judged 9079 sessions (1990-10-15 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9074 | | split 2008-10-21, embargo 5 | +0.21% | +0.33% | 58% | 3% | 0% | | | | |
| 200日線の上 (above) | 5 | 6917 | 51 | 47% | +0.20% | +0.32% | 59% | 1% | 0% | −0.01 [−0.16, +0.19] p 0.947 | unstable | −7.4 [−2.9, +2.1] p 0.005 | **robust** |
| 200日線以下 (at/below) | 5 | 2157 | 62 | 59% | +0.21% | +0.37% | 56% | 9% | 1% | (the contrast above) | | | |
| baseline | 10 | 9069 | | split 2008-10-23, embargo 10 | +0.40% | +0.64% | 61% | 8% | 2% | | | | |
| 200日線の上 (above) | 10 | 6912 | 36 | 47% | +0.41% | +0.61% | 61% | 4% | 1% | +0.01 [−0.32, +0.38] p 0.841 | unstable | −13.6 [−4.7, +3.5] p 0.014 | **robust** |
| 200日線以下 (at/below) | 10 | 2157 | 48 | 59% | +0.40% | +0.81% | 58% | 18% | 5% | (the contrast above) | | | |
| baseline | 21 | 9058 | | split 2008-10-31, embargo 21 | +0.85% | +1.26% | 64% | 16% | 4% | | | | |
| 200日線の上 (above) | 21 | 6901 | 20 | 47% | +0.87% | +1.24% | 66% | 11% | 2% | +0.06 [−0.68, +0.71] p 0.740 | unstable | −20.9 [−7.8, +6.3] p 0.005 | **robust** |
| 200日線以下 (at/below) | 21 | 2157 | 38 | 58% | +0.80% | +1.46% | 60% | 32% | 12% | (the contrast above) | | | |
| baseline | 63 | 9016 | | split 2008-12-02, embargo 63 | +2.52% | +3.21% | 71% | 31% | 13% | | | | |
| 200日線の上 (above) | 63 | 6859 | 5 | 48% | +2.72% | +3.24% | 74% | 25% | 7% | +0.84 [−1.97, +1.91] p 0.394 | insufficient | −26.7 [−11.8, +9.6] p 0.005 | insufficient |
| 200日線以下 (at/below) | 63 | 2157 | 28 | 57% | +1.89% | +2.95% | 61% | 52% | 32% | (the contrast above) | | | |

### S&P 500 50/200-day position — `^GSPC.ma.quadrant`

indexSummary vsMa, vs200. Outcome: ^GSPC (index OHLCV). Judged 9079 sessions (1990-10-15 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9074 | | split 2008-10-21, embargo 5 | +0.21% | +0.33% | 58% | 3% | 0% | | | | |
| 50日線・200日線の上 (above both) | 5 | 5511 | 118 | 47% | +0.14% | +0.27% | 58% | 1% | 0% | −0.07 [−0.06, +0.06] p 0.067 | weak | −1.9 [−0.8, +0.6] p 0.014 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 5 | 1406 | 165 | 50% | +0.46% | +0.63% | 62% | 2% | 1% | +0.26 [−0.18, +0.17] p 0.014 | **robust** | −1.0 [−1.3, +1.5] p 0.236 | weak |
| 200日線の下・50日線の上 (below 200, above 50) | 5 | 629 | 50 | 57% | +0.13% | +0.37% | 58% | 3% | 0% | −0.07 [−0.28, +0.27] p 0.582 | unstable | +0.3 [−2.3, +3.3] p 0.697 | unstable |
| 50日線・200日線の下 (below both) | 5 | 1528 | 74 | 59% | +0.24% | +0.38% | 55% | 11% | 2% | +0.04 [−0.17, +0.16] p 0.798 | unstable | +7.8 [−1.6, +2.2] p 0.005 | **robust** |
| baseline | 10 | 9069 | | split 2008-10-23, embargo 10 | +0.40% | +0.64% | 61% | 8% | 2% | | | | |
| 50日線・200日線の上 (above both) | 10 | 5509 | 68 | 47% | +0.33% | +0.52% | 61% | 4% | 0% | −0.08 [−0.11, +0.12] p 0.264 | unstable | −3.9 [−1.3, +1.1] p 0.014 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 10 | 1403 | 124 | 50% | +0.73% | +1.12% | 64% | 7% | 2% | +0.32 [−0.33, +0.28] p 0.082 | weak | −0.8 [−2.3, +2.7] p 0.577 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 10 | 629 | 38 | 57% | +0.37% | +0.88% | 60% | 11% | 1% | −0.04 [−0.51, +0.47] p 0.841 | unstable | +3.5 [−4.6, +5.1] p 0.236 | weak |
| 50日線・200日線の下 (below both) | 10 | 1528 | 58 | 59% | +0.41% | +0.78% | 57% | 21% | 6% | +0.01 [−0.33, +0.31] p 0.928 | unstable | +13.2 [−3.1, +3.6] p 0.005 | **robust** |
| baseline | 21 | 9058 | | split 2008-10-31, embargo 21 | +0.85% | +1.26% | 64% | 16% | 4% | | | | |
| 50日線・200日線の上 (above both) | 21 | 5500 | 40 | 47% | +0.70% | +1.08% | 65% | 10% | 1% | −0.15 [−0.22, +0.23] p 0.322 | unstable | −5.9 [−2.2, +1.9] p 0.005 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 21 | 1401 | 84 | 50% | +1.50% | +2.00% | 71% | 15% | 3% | +0.65 [−0.60, +0.50] p 0.034 | **robust** | −1.5 [−3.8, +4.4] p 0.553 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 21 | 629 | 27 | 57% | +0.22% | +0.94% | 56% | 25% | 6% | −0.63 [−0.92, +0.92] p 0.298 | unstable | +9.2 [−8.2, +8.1] p 0.082 | weak |
| 50日線・200日線の下 (below both) | 21 | 1528 | 51 | 59% | +1.04% | +1.70% | 61% | 35% | 14% | +0.19 [−0.62, +0.62] p 0.712 | unstable | +18.7 [−5.4, +6.0] p 0.005 | **robust** |
| baseline | 63 | 9016 | | split 2008-12-02, embargo 63 | +2.52% | +3.21% | 71% | 31% | 13% | | | | |
| 50日線・200日線の上 (above both) | 63 | 5461 | 8 | 47% | +2.45% | +3.05% | 72% | 25% | 7% | −0.08 [−0.54, +0.55] p 0.957 | unstable | −6.4 [−3.1, +3.1] p 0.014 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 63 | 1398 | 37 | 51% | +3.80% | +4.08% | 79% | 25% | 11% | +1.28 [−1.12, +0.91] p 0.029 | **robust** | −6.3 [−5.5, +6.0] p 0.053 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 63 | 629 | 17 | 57% | +1.60% | +1.65% | 54% | 49% | 27% | −0.93 [−2.11, +2.24] p 0.399 | unstable | +17.9 [−12.8, +11.9] p 0.024 | **robust** |
| 50日線・200日線の下 (below both) | 63 | 1528 | 29 | 57% | +2.01% | +3.33% | 64% | 53% | 34% | −0.52 [−1.57, +1.52] p 0.495 | unstable | +21.3 [−8.2, +9.6] p 0.005 | **robust** |

### S&P 500 within 5% of the 252-session closing high — `^GSPC.high.near`

indexSummary fromHigh >= -SPLIT_RULE.nearHighPercent (full year required). Outcome: ^GSPC (index OHLCV). Judged 9027 sessions (1990-12-28 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9022 | | split 2008-11-26, embargo 5 | +0.20% | +0.33% | 58% | 3% | 0% | | | | |
| 1年高値から5%以内 (near high) | 5 | 6253 | 60 | 49% | +0.16% | +0.29% | 58% | 1% | 0% | −0.13 [−0.15, +0.15] p 0.202 | unstable | −6.5 [−2.3, +2.0] p 0.005 | **robust** |
| 5%超の下 (further below) | 5 | 2769 | 88 | 52% | +0.29% | +0.49% | 57% | 8% | 1% | (the contrast above) | | | |
| baseline | 10 | 9017 | | split 2008-12-01, embargo 10 | +0.40% | +0.64% | 61% | 8% | 2% | | | | |
| 1年高値から5%以内 (near high) | 10 | 6248 | 40 | 49% | +0.35% | +0.57% | 61% | 4% | 0% | −0.18 [−0.31, +0.30] p 0.385 | unstable | −11.7 [−3.8, +3.7] p 0.005 | **robust** |
| 5%超の下 (further below) | 10 | 2769 | 64 | 52% | +0.53% | +0.92% | 59% | 16% | 4% | (the contrast above) | | | |
| baseline | 21 | 9006 | | split 2008-12-09, embargo 21 | +0.84% | +1.25% | 64% | 16% | 4% | | | | |
| 1年高値から5%以内 (near high) | 21 | 6237 | 20 | 49% | +0.74% | +1.13% | 65% | 11% | 1% | −0.33 [−0.69, +0.60] p 0.466 | unstable | −18.4 [−6.7, +6.4] p 0.005 | **robust** |
| 5%超の下 (further below) | 21 | 2769 | 57 | 52% | +1.07% | +1.91% | 62% | 29% | 10% | (the contrast above) | | | |
| baseline | 63 | 8964 | | split 2009-01-09, embargo 63 | +2.46% | +3.16% | 70% | 31% | 13% | | | | |
| 1年高値から5%以内 (near high) | 63 | 6195 | 8 | 50% | +2.36% | +2.93% | 72% | 25% | 7% | −0.35 [−1.79, +1.70] p 0.808 | unstable | −21.0 [−10.2, +10.1] p 0.005 | **robust** |
| 5%超の下 (further below) | 63 | 2769 | 36 | 51% | +2.70% | +4.19% | 66% | 46% | 27% | (the contrast above) | | | |

### S&P: distribution days x 50-day line — `^GSPC.combo.dd_ma50`

dd >= 5 crossed with close vs 50-day SMA. Outcome: ^GSPC (index OHLCV). Judged 9193 sessions (1990-03-27 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9188 | | split 2008-06-24, embargo 5 | +0.19% | +0.32% | 58% | 3% | 0% | | | | |
| 分配日5+・50日線以下 | 5 | 2222 | 161 | 52% | +0.38% | +0.53% | 59% | 6% | 1% | +0.19 [−0.14, +0.15] p 0.029 | **robust** | +3.1 [−1.2, +1.4] p 0.014 | **robust** |
| 分配日5+・50日線の上 | 5 | 1541 | 192 | 48% | +0.15% | +0.34% | 58% | 2% | 0% | −0.04 [−0.16, +0.16] p 0.755 | weak | −1.2 [−1.2, +1.6] p 0.101 | weak |
| 分配日4以下・50日線以下 | 5 | 781 | 120 | 57% | +0.15% | +0.35% | 56% | 9% | 1% | −0.05 [−0.24, +0.23] p 0.784 | unstable | +5.6 [−1.7, +2.6] p 0.014 | **robust** |
| 分配日4以下・50日線の上 | 5 | 4644 | 177 | 48% | +0.12% | +0.26% | 57% | 1% | 0% | −0.07 [−0.08, +0.08] p 0.159 | weak | −2.0 [−0.8, +0.7] p 0.005 | **robust** |
| baseline | 10 | 9183 | | split 2008-06-26, embargo 10 | +0.38% | +0.62% | 60% | 8% | 2% | | | | |
| 分配日5+・50日線以下 | 10 | 2219 | 129 | 52% | +0.61% | +0.96% | 61% | 14% | 4% | +0.23 [−0.27, +0.25] p 0.130 | weak | +6.3 [−2.3, +2.4] p 0.005 | **robust** |
| 分配日5+・50日線の上 | 10 | 1540 | 155 | 48% | +0.30% | +0.57% | 60% | 6% | 0% | −0.08 [−0.31, +0.27] p 0.712 | unstable | −2.3 [−2.2, +2.5] p 0.077 | weak |
| 分配日4以下・50日線以下 | 10 | 781 | 101 | 57% | +0.25% | +0.79% | 58% | 17% | 4% | −0.13 [−0.44, +0.39] p 0.538 | unstable | +8.9 [−3.5, +4.3] p 0.014 | **robust** |
| 分配日4以下・50日線の上 | 10 | 4643 | 134 | 48% | +0.32% | +0.52% | 61% | 4% | 0% | −0.06 [−0.16, +0.16] p 0.524 | weak | −3.7 [−1.5, +1.3] p 0.005 | **robust** |
| baseline | 21 | 9172 | | split 2008-07-07, embargo 21 | +0.81% | +1.23% | 64% | 17% | 4% | | | | |
| 分配日5+・50日線以下 | 21 | 2217 | 103 | 52% | +1.33% | +1.96% | 65% | 25% | 8% | +0.52 [−0.45, +0.45] p 0.072 | weak | +8.4 [−3.6, +3.8] p 0.005 | **robust** |
| 分配日5+・50日線の上 | 21 | 1531 | 117 | 48% | +0.63% | +1.02% | 64% | 13% | 2% | −0.18 [−0.52, +0.49] p 0.596 | unstable | −4.1 [−4.0, +4.3] p 0.096 | weak |
| 分配日4以下・50日線以下 | 21 | 781 | 83 | 57% | +0.79% | +1.48% | 65% | 29% | 11% | −0.02 [−0.72, +0.67] p 0.865 | unstable | +12.8 [−5.6, +5.9] p 0.005 | **robust** |
| 分配日4以下・50日線の上 | 21 | 4643 | 84 | 48% | +0.62% | +1.05% | 63% | 12% | 2% | −0.19 [−0.30, +0.30] p 0.322 | weak | −4.8 [−2.3, +2.2] p 0.005 | **robust** |
| baseline | 63 | 9130 | | split 2008-08-05, embargo 63 | +2.43% | +3.16% | 70% | 32% | 14% | | | | |
| 分配日5+・50日線以下 | 63 | 2215 | 38 | 52% | +2.98% | +3.95% | 72% | 38% | 22% | +0.56 [−0.97, +0.90] p 0.389 | unstable | +6.1 [−5.8, +5.7] p 0.072 | weak |
| 分配日5+・50日線の上 | 63 | 1517 | 33 | 48% | +2.05% | +2.71% | 69% | 25% | 11% | −0.37 [−0.89, +1.00] p 0.668 | weak | −6.7 [−5.7, +5.8] p 0.053 | weak |
| 分配日4以下・50日線以下 | 63 | 780 | 43 | 57% | +2.25% | +3.06% | 69% | 46% | 27% | −0.18 [−1.37, +1.40] p 0.712 | unstable | +14.0 [−8.1, +8.4] p 0.005 | **robust** |
| 分配日4以下・50日線の上 | 63 | 4618 | 12 | 48% | +2.31% | +3.07% | 70% | 29% | 9% | −0.11 [−0.52, +0.63] p 0.851 | unstable | −3.1 [−3.1, +3.5] p 0.101 | weak |

### S&P: FTD confirmed within 25 sessions — `^GSPC.combo.ftd_recent`

state confirmed and ftd.sessionsSince <= 25. Outcome: ^GSPC (index OHLCV). Judged 8719 sessions (1991-02-07 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 8714 | | split 2008-05-30, embargo 5 | +0.19% | +0.32% | 58% | 3% | 0% | | | | |
| FTD確認から25日以内 | 5 | 1023 | 65 | 52% | +0.21% | +0.37% | 56% | 4% | 0% | +0.02 [−0.24, +0.25] p 0.933 | unstable | +1.3 [−2.2, +2.3] p 0.341 | weak |
| それ以外 (any other judged state) | 5 | 7691 | 51 | 50% | +0.18% | +0.32% | 58% | 3% | 0% | (the contrast above) | | | |
| baseline | 10 | 8709 | | split 2008-06-03, embargo 10 | +0.37% | +0.61% | 60% | 8% | 2% | | | | |
| FTD確認から25日以内 | 10 | 1023 | 63 | 52% | +0.45% | +0.96% | 61% | 12% | 2% | +0.10 [−0.45, +0.48] p 0.764 | unstable | +4.8 [−4.0, +4.3] p 0.043 | **robust** |
| それ以外 (any other judged state) | 10 | 7686 | 39 | 50% | +0.36% | +0.57% | 60% | 7% | 2% | (the contrast above) | | | |
| baseline | 21 | 8698 | | split 2008-06-11, embargo 21 | +0.78% | +1.21% | 64% | 16% | 4% | | | | |
| FTD確認から25日以内 | 21 | 1023 | 52 | 52% | +0.44% | +1.10% | 61% | 26% | 7% | −0.38 [−0.83, +0.85] p 0.433 | unstable | +10.2 [−6.4, +7.6] p 0.034 | **robust** |
| それ以外 (any other judged state) | 21 | 7675 | 35 | 50% | +0.82% | +1.22% | 64% | 15% | 4% | (the contrast above) | | | |
| baseline | 63 | 8656 | | split 2008-07-11, embargo 63 | +2.33% | +3.05% | 70% | 32% | 14% | | | | |
| FTD確認から25日以内 | 63 | 1023 | 25 | 50% | +1.86% | +2.72% | 63% | 44% | 23% | −0.53 [−1.64, +1.75] p 0.559 | insufficient | +13.8 [−10.4, +10.4] p 0.025 | insufficient |
| それ以外 (any other judged state) | 63 | 7633 | 2 | 50% | +2.39% | +3.06% | 71% | 30% | 13% | (the contrast above) | | | |

### NASの分配日 ≥ 5 (distribution days) — `^IXIC.dd.binary`

index-down-strictly-over-0.2-higher-volume-age25-high5-v1; market tab warning at >= DISTRIBUTION_WARN. Outcome: ^IXIC (index OHLCV). Judged 9253 sessions (1990-02-06 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9248 | | split 2008-06-18, embargo 5 | +0.27% | +0.49% | 58% | 7% | 1% | | | | |
| 5日以上 (warning) | 5 | 3311 | 154 | 48% | +0.29% | +0.55% | 58% | 8% | 1% | +0.02 [−0.20, +0.23] p 0.904 | unstable | +2.0 [−2.2, +2.8] p 0.164 | weak |
| 4日以下 | 5 | 5937 | 153 | 51% | +0.26% | +0.46% | 57% | 6% | 1% | (the contrast above) | | | |
| baseline | 10 | 9243 | | split 2008-06-20, embargo 10 | +0.54% | +0.87% | 60% | 15% | 3% | | | | |
| 5日以上 (warning) | 10 | 3311 | 130 | 48% | +0.54% | +0.83% | 59% | 17% | 4% | +0.00 [−0.39, +0.42] p 0.995 | unstable | +3.2 [−3.5, +4.0] p 0.159 | weak |
| 4日以下 | 10 | 5932 | 109 | 51% | +0.54% | +0.90% | 61% | 14% | 3% | (the contrast above) | | | |
| baseline | 21 | 9232 | | split 2008-06-30, embargo 21 | +1.15% | +1.67% | 63% | 26% | 9% | | | | |
| 5日以上 (warning) | 21 | 3311 | 103 | 48% | +1.23% | +1.65% | 63% | 30% | 9% | +0.13 [−0.79, +0.82] p 0.784 | unstable | +5.9 [−5.0, +5.4] p 0.077 | weak |
| 4日以下 | 21 | 5921 | 70 | 51% | +1.10% | +1.67% | 63% | 24% | 8% | (the contrast above) | | | |
| baseline | 63 | 9190 | | split 2008-07-30, embargo 63 | +3.50% | +4.13% | 69% | 43% | 21% | | | | |
| 5日以上 (warning) | 63 | 3301 | 27 | 48% | +3.84% | +4.48% | 69% | 46% | 22% | +0.52 [−1.54, +1.48] p 0.597 | insufficient | +4.0 [−6.0, +6.3] p 0.289 | insufficient |
| 4日以下 | 63 | 5889 | 3 | 51% | +3.32% | +4.01% | 69% | 42% | 21% | (the contrast above) | | | |

### NASの分配日 graded — `^IXIC.dd.graded`

index-down-strictly-over-0.2-higher-volume-age25-high5-v1. Outcome: ^IXIC (index OHLCV). Judged 9253 sessions (1990-02-06 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9248 | | split 2008-06-18, embargo 5 | +0.27% | +0.49% | 58% | 7% | 1% | | | | |
| 0-2 | 5 | 3151 | 185 | 54% | +0.25% | +0.47% | 58% | 6% | 1% | −0.02 [−0.15, +0.14] p 0.808 | unstable | −0.7 [−1.6, +1.5] p 0.452 | weak |
| 3-4 | 5 | 2786 | 312 | 49% | +0.28% | +0.45% | 57% | 6% | 1% | +0.01 [−0.15, +0.13] p 0.861 | unstable | −0.7 [−1.2, +1.2] p 0.317 | weak |
| 5-6 | 5 | 2004 | 240 | 50% | +0.33% | +0.55% | 58% | 6% | 1% | +0.06 [−0.18, +0.19] p 0.596 | unstable | −0.5 [−1.5, +2.0] p 0.692 | unstable |
| 7+ | 5 | 1307 | 101 | 44% | +0.21% | +0.55% | 57% | 11% | 2% | −0.06 [−0.24, +0.26] p 0.611 | unstable | +4.0 [−2.3, +2.4] p 0.014 | **robust** |
| baseline | 10 | 9243 | | split 2008-06-20, embargo 10 | +0.54% | +0.87% | 60% | 15% | 3% | | | | |
| 0-2 | 10 | 3150 | 142 | 54% | +0.53% | +0.91% | 60% | 14% | 3% | −0.01 [−0.27, +0.26] p 0.947 | unstable | −0.8 [−2.5, +2.5] p 0.606 | weak |
| 3-4 | 10 | 2782 | 220 | 49% | +0.55% | +0.88% | 61% | 13% | 3% | +0.01 [−0.23, +0.22] p 0.880 | unstable | −1.5 [−1.8, +2.0] p 0.178 | weak |
| 5-6 | 10 | 2004 | 184 | 50% | +0.58% | +0.82% | 60% | 14% | 3% | +0.05 [−0.32, +0.36] p 0.851 | unstable | −0.5 [−2.6, +3.2] p 0.813 | unstable |
| 7+ | 10 | 1307 | 88 | 44% | +0.47% | +0.87% | 59% | 21% | 5% | −0.07 [−0.48, +0.51] p 0.755 | unstable | +6.0 [−3.7, +3.8] p 0.005 | **robust** |
| baseline | 21 | 9232 | | split 2008-06-30, embargo 21 | +1.15% | +1.67% | 63% | 26% | 9% | | | | |
| 0-2 | 21 | 3139 | 109 | 54% | +0.98% | +1.72% | 62% | 25% | 9% | −0.16 [−0.46, +0.45] p 0.567 | unstable | −1.2 [−3.9, +3.5] p 0.563 | unstable |
| 3-4 | 21 | 2782 | 123 | 48% | +1.23% | +1.65% | 64% | 23% | 8% | +0.08 [−0.38, +0.36] p 0.712 | unstable | −3.2 [−2.6, +2.5] p 0.034 | **robust** |
| 5-6 | 21 | 2004 | 114 | 50% | +1.04% | +1.53% | 62% | 28% | 9% | −0.10 [−0.51, +0.51] p 0.740 | unstable | +1.4 [−3.8, +4.4] p 0.505 | unstable |
| 7+ | 21 | 1307 | 79 | 44% | +1.52% | +1.97% | 66% | 34% | 11% | +0.37 [−0.88, +0.86] p 0.505 | weak | +7.5 [−5.3, +5.5] p 0.024 | **robust** |
| baseline | 63 | 9190 | | split 2008-07-30, embargo 63 | +3.50% | +4.13% | 69% | 43% | 21% | | | | |
| 0-2 | 63 | 3138 | 24 | 53% | +2.85% | +3.65% | 65% | 44% | 24% | −0.65 [−0.94, +0.96] p 0.293 | weak | +1.1 [−3.9, +3.9] p 0.635 | unstable |
| 3-4 | 63 | 2751 | 7 | 49% | +3.84% | +4.26% | 73% | 39% | 18% | +0.34 [−0.74, +0.72] p 0.466 | weak | −4.3 [−3.1, +3.0] p 0.034 | **robust** |
| 5-6 | 63 | 1995 | 27 | 50% | +3.59% | +4.10% | 67% | 44% | 20% | +0.09 [−1.00, +1.01] p 0.894 | weak | +0.6 [−4.2, +4.4] p 0.760 | unstable |
| 7+ | 63 | 1306 | 46 | 44% | +4.21% | +5.06% | 71% | 49% | 25% | +0.71 [−1.73, +1.79] p 0.495 | weak | +5.4 [−6.7, +7.6] p 0.192 | weak |

### NASのFTD state — `^IXIC.ftd.state`

rally-attempt-gain1.2-day4-15-decline6-v1 on the trailing 280 sessions. Outcome: ^IXIC (index OHLCV). Judged 8999 sessions (1991-02-07 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 8994 | | split 2008-12-17, embargo 5 | +0.27% | +0.50% | 58% | 7% | 1% | | | | |
| 不要 (no 6% correction) | 5 | 2098 | 30 | 39% | +0.20% | +0.42% | 58% | 3% | 0% | −0.07 [−0.26, +0.20] p 0.625 | unstable | −3.7 [−2.8, +3.6] p 0.019 | **robust** |
| 判定保留 (window opens on the peak) | 5 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 5 | 646 | 151 | 67% | +1.06% | +1.10% | 62% | 15% | 3% | +0.78 [−0.29, +0.32] p 0.005 | **robust** | +7.7 [−2.8, +4.1] p 0.034 | **robust** |
| 反発中 (rally attempt) | 5 | 1257 | 138 | 59% | +0.28% | +0.66% | 56% | 14% | 2% | +0.00 [−0.22, +0.25] p 0.966 | unstable | +7.0 [−2.3, +2.4] p 0.005 | **robust** |
| 15日以内のFTDなし (attempt expired) | 5 | 374 | 16 | 47% | +0.44% | +0.60% | 62% | 0% | 0% | +0.17 [−0.55, +0.50] p 0.563 | weak | −6.8 [−5.1, +7.0] p 0.019 | **robust** |
| 確認 (FTD confirmed) | 5 | 3474 | 101 | 53% | +0.23% | +0.44% | 57% | 5% | 1% | −0.04 [−0.13, +0.14] p 0.659 | unstable | −1.7 [−2.2, +2.1] p 0.207 | weak |
| FTD失敗 (failed) | 5 | 1145 | 58 | 44% | +0.04% | +0.58% | 58% | 9% | 1% | −0.24 [−0.30, +0.28] p 0.173 | weak | +2.1 [−3.0, +4.1] p 0.337 | weak |
| baseline | 10 | 8989 | | split 2008-12-19, embargo 10 | +0.55% | +0.90% | 60% | 15% | 3% | | | | |
| 不要 (no 6% correction) | 10 | 2093 | 30 | 39% | +0.41% | +0.69% | 60% | 10% | 0% | −0.14 [−0.50, +0.42] p 0.606 | unstable | −4.9 [−4.4, +5.4] p 0.072 | weak |
| 判定保留 (window opens on the peak) | 10 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 10 | 646 | 119 | 67% | +1.38% | +1.61% | 60% | 27% | 9% | +0.84 [−0.47, +0.48] p 0.010 | **robust** | +12.0 [−4.5, +6.6] p 0.024 | **robust** |
| 反発中 (rally attempt) | 10 | 1257 | 109 | 59% | +0.59% | +1.18% | 60% | 23% | 7% | +0.05 [−0.39, +0.45] p 0.803 | unstable | +8.6 [−3.7, +4.1] p 0.010 | **robust** |
| 15日以内のFTDなし (attempt expired) | 10 | 374 | 16 | 47% | +0.61% | +1.02% | 64% | 4% | 0% | +0.06 [−1.09, +1.01] p 0.962 | unstable | −10.6 [−9.3, +10.9] p 0.038 | **robust** |
| 確認 (FTD confirmed) | 10 | 3474 | 80 | 53% | +0.52% | +0.83% | 61% | 12% | 3% | −0.03 [−0.24, +0.26] p 0.885 | unstable | −2.4 [−3.2, +3.1] p 0.231 | weak |
| FTD失敗 (failed) | 10 | 1145 | 52 | 44% | +0.33% | +1.06% | 59% | 18% | 3% | −0.21 [−0.58, +0.56] p 0.534 | unstable | +3.5 [−5.0, +6.9] p 0.293 | weak |
| baseline | 21 | 8978 | | split 2008-12-30, embargo 21 | +1.15% | +1.68% | 63% | 26% | 8% | | | | |
| 不要 (no 6% correction) | 21 | 2082 | 30 | 39% | +0.81% | +1.50% | 62% | 22% | 3% | −0.34 [−1.02, +0.83] p 0.538 | unstable | −3.9 [−5.6, +6.8] p 0.288 | weak |
| 判定保留 (window opens on the peak) | 21 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 21 | 646 | 87 | 67% | +2.17% | +2.41% | 62% | 39% | 19% | +1.02 [−0.76, +0.81] p 0.038 | **robust** | +13.2 [−6.0, +7.1] p 0.014 | **robust** |
| 反発中 (rally attempt) | 21 | 1257 | 81 | 59% | +1.52% | +2.08% | 63% | 32% | 15% | +0.37 [−0.68, +0.80] p 0.438 | unstable | +6.3 [−4.8, +4.8] p 0.053 | weak |
| 15日以内のFTDなし (attempt expired) | 21 | 374 | 15 | 47% | +1.42% | +2.25% | 65% | 17% | 0% | +0.26 [−2.06, +1.95] p 0.885 | weak | −9.3 [−14.1, +14.1] p 0.293 | weak |
| 確認 (FTD confirmed) | 21 | 3474 | 54 | 53% | +1.12% | +1.54% | 64% | 23% | 7% | −0.04 [−0.49, +0.54] p 0.952 | unstable | −2.8 [−4.1, +3.9] p 0.264 | weak |
| FTD失敗 (failed) | 21 | 1145 | 42 | 44% | +0.83% | +2.13% | 63% | 30% | 12% | −0.33 [−1.17, +1.13] p 0.572 | unstable | +4.1 [−7.5, +8.6] p 0.380 | weak |
| baseline | 63 | 8936 | | split 2009-01-30, embargo 63 | +3.48% | +4.11% | 69% | 43% | 21% | | | | |
| 不要 (no 6% correction) | 63 | 2071 | 21 | 39% | +2.16% | +2.91% | 65% | 43% | 16% | −1.32 [−2.87, +2.30] p 0.356 | unstable | −0.9 [−8.4, +9.9] p 0.851 | unstable |
| 判定保留 (window opens on the peak) | 63 | 0 | 0 | — | — | — | — | — | — | — | insufficient | — | insufficient |
| 調整中 (correction) | 63 | 646 | 45 | 65% | +4.02% | +5.20% | 66% | 56% | 37% | +0.53 [−1.65, +1.69] p 0.596 | unstable | +12.3 [−7.5, +8.7] p 0.005 | **robust** |
| 反発中 (rally attempt) | 63 | 1247 | 44 | 59% | +3.90% | +5.10% | 68% | 50% | 27% | +0.42 [−1.36, +1.38] p 0.630 | unstable | +6.1 [−5.9, +5.4] p 0.067 | unstable |
| 15日以内のFTDなし (attempt expired) | 63 | 353 | 13 | 50% | +6.77% | +6.59% | 88% | 36% | 8% | +3.29 [−4.82, +4.57] p 0.211 | weak | −7.7 [−18.8, +19.0] p 0.514 | unstable |
| 確認 (FTD confirmed) | 63 | 3474 | 25 | 53% | +3.82% | +3.87% | 72% | 39% | 19% | +0.33 [−1.29, +1.36] p 0.688 | weak | −4.3 [−5.1, +4.7] p 0.154 | weak |
| FTD失敗 (failed) | 63 | 1145 | 27 | 44% | +3.09% | +5.72% | 66% | 47% | 26% | −0.39 [−3.18, +2.77] p 0.750 | unstable | +3.5 [−10.6, +11.1] p 0.606 | weak |

### Nasdaq Composite vs 50-day SMA (50日線) — `^IXIC.ma50`

indexSummary vsMa > 0. Outcome: ^IXIC (index OHLCV). Judged 9219 sessions (1990-03-27 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9214 | | split 2008-07-14, embargo 5 | +0.27% | +0.49% | 58% | 7% | 1% | | | | |
| 50日線の上 (above) | 5 | 6089 | 127 | 47% | +0.32% | +0.51% | 59% | 4% | 0% | +0.16 [−0.25, +0.24] p 0.279 | unstable | −9.7 [−2.6, +2.4] p 0.005 | **robust** |
| 50日線以下 (at/below) | 5 | 3125 | 158 | 55% | +0.16% | +0.45% | 55% | 13% | 3% | (the contrast above) | | | |
| baseline | 10 | 9209 | | split 2008-07-16, embargo 10 | +0.54% | +0.88% | 60% | 15% | 3% | | | | |
| 50日線の上 (above) | 10 | 6088 | 84 | 47% | +0.66% | +0.91% | 62% | 10% | 1% | +0.35 [−0.48, +0.42] p 0.188 | unstable | −14.5 [−4.1, +3.7] p 0.014 | **robust** |
| 50日線以下 (at/below) | 10 | 3121 | 117 | 55% | +0.31% | +0.77% | 57% | 24% | 7% | (the contrast above) | | | |
| baseline | 21 | 9198 | | split 2008-07-24, embargo 21 | +1.15% | +1.67% | 63% | 26% | 9% | | | | |
| 50日線の上 (above) | 21 | 6080 | 47 | 47% | +1.21% | +1.69% | 65% | 20% | 5% | +0.18 [−0.90, +0.78] p 0.712 | unstable | −17.4 [−6.0, +5.7] p 0.005 | **robust** |
| 50日線以下 (at/below) | 21 | 3118 | 88 | 55% | +1.03% | +1.59% | 60% | 38% | 16% | (the contrast above) | | | |
| baseline | 63 | 9156 | | split 2008-08-22, embargo 63 | +3.50% | +4.12% | 69% | 44% | 22% | | | | |
| 50日線の上 (above) | 63 | 6040 | 9 | 47% | +3.36% | +3.74% | 69% | 39% | 17% | −0.39 [−2.16, +2.08] p 0.870 | unstable | −12.8 [−8.5, +8.3] p 0.010 | **robust** |
| 50日線以下 (at/below) | 63 | 3116 | 34 | 55% | +3.76% | +5.41% | 68% | 52% | 30% | (the contrast above) | | | |

### Nasdaq Composite vs 200-day SMA (200日線) — `^IXIC.ma200`

indexSummary vs200 > 0. Outcome: ^IXIC (index OHLCV). Judged 9079 sessions (1990-10-15 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9074 | | split 2008-10-21, embargo 5 | +0.29% | +0.51% | 58% | 7% | 1% | | | | |
| 200日線の上 (above) | 5 | 6752 | 45 | 46% | +0.31% | +0.51% | 59% | 4% | 0% | +0.09 [−0.26, +0.23] p 0.476 | unstable | −12.4 [−4.2, +3.4] p 0.005 | **robust** |
| 200日線以下 (at/below) | 5 | 2322 | 55 | 61% | +0.23% | +0.48% | 55% | 16% | 3% | (the contrast above) | | | |
| baseline | 10 | 9069 | | split 2008-10-23, embargo 10 | +0.57% | +0.90% | 60% | 15% | 3% | | | | |
| 200日線の上 (above) | 10 | 6747 | 38 | 46% | +0.62% | +0.90% | 62% | 10% | 1% | +0.16 [−0.49, +0.45] p 0.481 | unstable | −18.1 [−6.3, +6.1] p 0.005 | **robust** |
| 200日線以下 (at/below) | 10 | 2322 | 44 | 60% | +0.45% | +0.97% | 57% | 28% | 8% | (the contrast above) | | | |
| baseline | 21 | 9058 | | split 2008-10-31, embargo 21 | +1.22% | +1.72% | 64% | 26% | 8% | | | | |
| 200日線の上 (above) | 21 | 6736 | 24 | 46% | +1.32% | +1.73% | 65% | 21% | 4% | +0.39 [−1.02, +0.92] p 0.413 | unstable | −20.8 [−7.3, +8.0] p 0.005 | **robust** |
| 200日線以下 (at/below) | 21 | 2322 | 32 | 60% | +0.93% | +1.64% | 58% | 41% | 20% | (the contrast above) | | | |
| baseline | 63 | 9016 | | split 2008-12-02, embargo 63 | +3.69% | +4.18% | 69% | 43% | 21% | | | | |
| 200日線の上 (above) | 63 | 6694 | 10 | 47% | +3.87% | +4.10% | 71% | 38% | 15% | +0.71 [−2.92, +2.51] p 0.519 | unstable | −17.8 [−10.5, +12.4] p 0.005 | **robust** |
| 200日線以下 (at/below) | 63 | 2322 | 25 | 59% | +3.16% | +4.79% | 63% | 56% | 37% | (the contrast above) | | | |

### Nasdaq Composite 50/200-day position — `^IXIC.ma.quadrant`

indexSummary vsMa, vs200. Outcome: ^IXIC (index OHLCV). Judged 9079 sessions (1990-10-15 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9074 | | split 2008-10-21, embargo 5 | +0.29% | +0.51% | 58% | 7% | 1% | | | | |
| 50日線・200日線の上 (above both) | 5 | 5382 | 109 | 45% | +0.32% | +0.50% | 59% | 3% | 0% | +0.03 [−0.10, +0.08] p 0.543 | unstable | −3.8 [−1.2, +1.1] p 0.005 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 5 | 1370 | 141 | 51% | +0.27% | +0.55% | 58% | 6% | 1% | −0.02 [−0.25, +0.24] p 0.981 | unstable | −0.6 [−2.1, +2.5] p 0.663 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 5 | 642 | 55 | 61% | +0.39% | +0.64% | 58% | 10% | 0% | +0.10 [−0.38, +0.39] p 0.712 | weak | +2.7 [−3.8, +4.4] p 0.269 | weak |
| 50日線・200日線の下 (below both) | 5 | 1680 | 69 | 60% | +0.16% | +0.42% | 53% | 18% | 4% | −0.13 [−0.22, +0.23] p 0.313 | unstable | +11.7 [−2.6, +3.3] p 0.005 | **robust** |
| baseline | 10 | 9069 | | split 2008-10-23, embargo 10 | +0.57% | +0.90% | 60% | 15% | 3% | | | | |
| 50日線・200日線の上 (above both) | 10 | 5381 | 75 | 45% | +0.67% | +0.89% | 62% | 9% | 1% | +0.10 [−0.19, +0.16] p 0.332 | unstable | −5.8 [−1.8, +1.8] p 0.014 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 10 | 1366 | 104 | 51% | +0.40% | +0.90% | 59% | 14% | 4% | −0.18 [−0.46, +0.45] p 0.534 | unstable | −0.2 [−3.8, +4.0] p 0.861 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 10 | 642 | 41 | 61% | +0.65% | +1.29% | 60% | 19% | 3% | +0.08 [−0.70, +0.72] p 0.913 | unstable | +4.6 [−6.7, +6.7] p 0.269 | weak |
| 50日線・200日線の下 (below both) | 10 | 1680 | 55 | 60% | +0.37% | +0.82% | 56% | 31% | 10% | −0.20 [−0.43, +0.44] p 0.394 | unstable | +16.9 [−4.5, +5.1] p 0.005 | **robust** |
| baseline | 21 | 9058 | | split 2008-10-31, embargo 21 | +1.22% | +1.72% | 64% | 26% | 8% | | | | |
| 50日線・200日線の上 (above both) | 21 | 5373 | 43 | 45% | +1.28% | +1.69% | 66% | 19% | 4% | +0.06 [−0.37, +0.32] p 0.726 | unstable | −6.7 [−2.7, +2.8] p 0.005 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 21 | 1363 | 76 | 51% | +1.47% | +1.97% | 65% | 26% | 7% | +0.25 [−0.80, +0.79] p 0.591 | unstable | +0.3 [−5.2, +5.4] p 0.986 | weak |
| 200日線の下・50日線の上 (below 200, above 50) | 21 | 642 | 30 | 61% | +0.95% | +2.25% | 62% | 30% | 13% | −0.27 [−1.35, +1.44] p 0.678 | unstable | +4.0 [−10.1, +9.2] p 0.409 | weak |
| 50日線・200日線の下 (below both) | 21 | 1680 | 44 | 60% | +0.92% | +1.37% | 57% | 46% | 22% | −0.30 [−0.84, +0.93] p 0.471 | unstable | +19.8 [−6.4, +6.3] p 0.005 | **robust** |
| baseline | 63 | 9016 | | split 2008-12-02, embargo 63 | +3.69% | +4.18% | 69% | 43% | 21% | | | | |
| 50日線・200日線の上 (above both) | 63 | 5333 | 11 | 46% | +3.59% | +3.76% | 70% | 38% | 15% | −0.10 [−0.91, +0.87] p 0.957 | unstable | −5.3 [−3.7, +3.8] p 0.029 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 63 | 1361 | 38 | 51% | +4.97% | +5.80% | 76% | 41% | 16% | +1.28 [−1.78, +1.84] p 0.288 | weak | −1.6 [−6.4, +6.0] p 0.630 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 63 | 642 | 22 | 61% | +3.17% | +4.34% | 62% | 48% | 27% | −0.51 [−3.04, +3.48] p 0.726 | weak | +4.8 [−13.1, +13.6] p 0.510 | weak |
| 50日線・200日線の下 (below both) | 63 | 1680 | 26 | 59% | +3.15% | +5.11% | 63% | 59% | 41% | −0.53 [−2.04, +2.16] p 0.596 | unstable | +16.4 [−9.5, +8.2] p 0.005 | **robust** |

### Nasdaq Composite within 5% of the 252-session closing high — `^IXIC.high.near`

indexSummary fromHigh >= -SPLIT_RULE.nearHighPercent (full year required). Outcome: ^IXIC (index OHLCV). Judged 9027 sessions (1990-12-28 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9022 | | split 2008-11-26, embargo 5 | +0.28% | +0.50% | 58% | 7% | 1% | | | | |
| 1年高値から5%以内 (near high) | 5 | 5092 | 85 | 44% | +0.27% | +0.47% | 59% | 3% | 0% | −0.03 [−0.25, +0.21] p 0.938 | unstable | −9.4 [−3.6, +3.4] p 0.005 | **robust** |
| 5%超の下 (further below) | 5 | 3930 | 97 | 58% | +0.30% | +0.56% | 56% | 12% | 2% | (the contrast above) | | | |
| baseline | 10 | 9017 | | split 2008-12-01, embargo 10 | +0.57% | +0.90% | 60% | 15% | 3% | | | | |
| 1年高値から5%以内 (near high) | 10 | 5090 | 53 | 44% | +0.56% | +0.81% | 61% | 8% | 1% | −0.02 [−0.48, +0.41] p 0.928 | unstable | −14.2 [−5.2, +5.3] p 0.005 | **robust** |
| 5%超の下 (further below) | 10 | 3927 | 81 | 58% | +0.58% | +1.09% | 59% | 23% | 6% | (the contrast above) | | | |
| baseline | 21 | 9006 | | split 2008-12-09, embargo 21 | +1.20% | +1.69% | 64% | 26% | 8% | | | | |
| 1年高値から5%以内 (near high) | 21 | 5080 | 31 | 44% | +1.07% | +1.52% | 65% | 19% | 3% | −0.29 [−0.89, +0.79] p 0.683 | unstable | −15.7 [−6.3, +7.1] p 0.005 | **robust** |
| 5%超の下 (further below) | 21 | 3926 | 63 | 57% | +1.36% | +2.25% | 62% | 35% | 15% | (the contrast above) | | | |
| baseline | 63 | 8964 | | split 2009-01-09, embargo 63 | +3.57% | +4.13% | 69% | 43% | 21% | | | | |
| 1年高値から5%以内 (near high) | 63 | 5038 | 13 | 45% | +3.03% | +3.46% | 69% | 39% | 15% | −1.22 [−2.35, +2.39] p 0.490 | unstable | −10.3 [−8.5, +10.9] p 0.053 | weak |
| 5%超の下 (further below) | 63 | 3926 | 29 | 57% | +4.25% | +5.94% | 69% | 49% | 29% | (the contrast above) | | | |

### NAS: distribution days x 50-day line — `^IXIC.combo.dd_ma50`

dd >= 5 crossed with close vs 50-day SMA. Outcome: ^IXIC (index OHLCV). Judged 9219 sessions (1990-03-27 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 9214 | | split 2008-07-14, embargo 5 | +0.27% | +0.49% | 58% | 7% | 1% | | | | |
| 分配日5+・50日線以下 | 5 | 2132 | 143 | 52% | +0.30% | +0.51% | 56% | 11% | 2% | +0.03 [−0.18, +0.21] p 0.885 | unstable | +4.2 [−1.8, +1.9] p 0.005 | **robust** |
| 分配日5+・50日線の上 | 5 | 1166 | 144 | 39% | +0.25% | +0.58% | 60% | 3% | 0% | −0.02 [−0.26, +0.26] p 0.899 | weak | −4.1 [−3.0, +3.3] p 0.005 | **robust** |
| 分配日4以下・50日線以下 | 5 | 993 | 129 | 62% | −0.13% | +0.18% | 52% | 18% | 4% | −0.40 [−0.31, +0.26] p 0.058 | weak | +11.0 [−2.9, +3.8] p 0.014 | **robust** |
| 分配日4以下・50日線の上 | 5 | 4923 | 164 | 49% | +0.34% | +0.48% | 58% | 4% | 0% | +0.07 [−0.10, +0.10] p 0.245 | unstable | −3.1 [−1.1, +0.9] p 0.014 | **robust** |
| baseline | 10 | 9209 | | split 2008-07-16, embargo 10 | +0.54% | +0.88% | 60% | 15% | 3% | | | | |
| 分配日5+・50日線以下 | 10 | 2132 | 118 | 52% | +0.55% | +0.86% | 57% | 21% | 6% | +0.01 [−0.35, +0.35] p 0.971 | unstable | +6.7 [−2.9, +3.2] p 0.005 | **robust** |
| 分配日5+・50日線の上 | 10 | 1166 | 118 | 39% | +0.52% | +0.82% | 63% | 8% | 1% | −0.02 [−0.49, +0.46] p 0.933 | unstable | −6.3 [−4.9, +5.1] p 0.014 | **robust** |
| 分配日4以下・50日線以下 | 10 | 989 | 109 | 62% | −0.22% | +0.57% | 55% | 31% | 11% | −0.76 [−0.53, +0.52] p 0.034 | **robust** | +16.0 [−4.6, +5.5] p 0.014 | **robust** |
| 分配日4以下・50日線の上 | 10 | 4922 | 117 | 49% | +0.69% | +0.93% | 62% | 10% | 1% | +0.15 [−0.20, +0.17] p 0.164 | unstable | −4.6 [−1.6, +1.5] p 0.014 | **robust** |
| baseline | 21 | 9198 | | split 2008-07-24, embargo 21 | +1.15% | +1.67% | 63% | 26% | 9% | | | | |
| 分配日5+・50日線以下 | 21 | 2132 | 95 | 52% | +1.37% | +1.81% | 61% | 34% | 13% | +0.23 [−0.66, +0.69] p 0.668 | unstable | +8.2 [−4.2, +4.4] p 0.010 | **robust** |
| 分配日5+・50日線の上 | 21 | 1166 | 95 | 39% | +0.94% | +1.50% | 66% | 22% | 3% | −0.20 [−0.83, +0.87] p 0.688 | unstable | −4.2 [−6.0, +6.3] p 0.255 | weak |
| 分配日4以下・50日線以下 | 21 | 986 | 87 | 62% | +0.29% | +1.07% | 56% | 45% | 24% | −0.86 [−0.95, +0.98] p 0.144 | unstable | +18.5 [−6.8, +6.8] p 0.014 | **robust** |
| 分配日4以下・50日線の上 | 21 | 4914 | 77 | 49% | +1.27% | +1.74% | 65% | 20% | 5% | +0.12 [−0.38, +0.34] p 0.563 | unstable | −6.3 [−2.5, +2.3] p 0.005 | **robust** |
| baseline | 63 | 9156 | | split 2008-08-22, embargo 63 | +3.50% | +4.12% | 69% | 44% | 22% | | | | |
| 分配日5+・50日線以下 | 63 | 2130 | 45 | 52% | +4.47% | +5.44% | 70% | 49% | 25% | +0.97 [−1.45, +1.53] p 0.332 | weak | +5.9 [−5.8, +6.2] p 0.115 | weak |
| 分配日5+・50日線の上 | 63 | 1158 | 35 | 39% | +2.66% | +3.48% | 67% | 40% | 17% | −0.83 [−1.81, +1.90] p 0.510 | weak | −3.5 [−7.0, +7.5] p 0.409 | weak |
| 分配日4以下・50日線以下 | 63 | 986 | 42 | 61% | +2.21% | +5.28% | 64% | 58% | 42% | −1.28 [−2.11, +2.08] p 0.260 | unstable | +14.0 [−9.1, +9.3] p 0.014 | **robust** |
| 分配日4以下・50日線の上 | 63 | 4882 | 12 | 49% | +3.53% | +3.86% | 69% | 39% | 17% | +0.03 [−0.79, +0.82] p 0.841 | unstable | −4.6 [−3.3, +3.1] p 0.029 | **robust** |

### NAS: FTD confirmed within 25 sessions — `^IXIC.combo.ftd_recent`

state confirmed and ftd.sessionsSince <= 25. Outcome: ^IXIC (index OHLCV). Judged 8999 sessions (1991-02-07 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 8994 | | split 2008-12-17, embargo 5 | +0.27% | +0.50% | 58% | 7% | 1% | | | | |
| FTD確認から25日以内 | 5 | 1401 | 100 | 58% | +0.19% | +0.54% | 58% | 9% | 1% | −0.10 [−0.31, +0.32] p 0.615 | weak | +2.4 [−2.9, +3.0] p 0.226 | weak |
| それ以外 (any other judged state) | 5 | 7593 | 77 | 49% | +0.29% | +0.48% | 58% | 6% | 1% | (the contrast above) | | | |
| baseline | 10 | 8989 | | split 2008-12-19, embargo 10 | +0.55% | +0.90% | 60% | 15% | 3% | | | | |
| FTD確認から25日以内 | 10 | 1401 | 89 | 58% | +0.47% | +1.16% | 62% | 19% | 5% | −0.09 [−0.57, +0.56] p 0.750 | unstable | +4.7 [−4.7, +5.0] p 0.120 | weak |
| それ以外 (any other judged state) | 10 | 7588 | 55 | 49% | +0.56% | +0.85% | 60% | 14% | 3% | (the contrast above) | | | |
| baseline | 21 | 8978 | | split 2008-12-30, embargo 21 | +1.15% | +1.68% | 63% | 26% | 8% | | | | |
| FTD確認から25日以内 | 21 | 1401 | 67 | 58% | +0.94% | +1.84% | 63% | 31% | 13% | −0.25 [−1.04, +1.03] p 0.639 | weak | +5.7 [−6.6, +6.1] p 0.144 | weak |
| それ以外 (any other judged state) | 21 | 7577 | 39 | 49% | +1.19% | +1.66% | 64% | 25% | 8% | (the contrast above) | | | |
| baseline | 63 | 8936 | | split 2009-01-30, embargo 63 | +3.48% | +4.11% | 69% | 43% | 21% | | | | |
| FTD確認から25日以内 | 63 | 1401 | 36 | 57% | +3.87% | +4.07% | 68% | 44% | 28% | +0.45 [n/a] p n/a | insufficient | +1.2 [n/a] p n/a | insufficient |
| それ以外 (any other judged state) | 63 | 7535 | 1 | 49% | +3.41% | +4.11% | 69% | 43% | 20% | (the contrast above) | | | |

### S&P 500 (long history) vs 50-day SMA (50日線) — `spx.ma50`

indexSummary vsMa > 0. Outcome: ^GSPC (long-history sp500 closes). Judged 1210 sessions (2022-01-07 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1205 | | split 2024-06-10, embargo 5 | +0.23% | +0.35% | 58% | 2% | 0% | | | | |
| 50日線の上 (above) | 5 | 816 | 17 | 43% | +0.19% | +0.30% | 58% | 1% | 0% | −0.11 [−0.50, +0.39] p 0.854 | weak | −4.7 [−4.2, +2.8] p 0.051 | weak |
| 50日線以下 (at/below) | 5 | 389 | 22 | 65% | +0.30% | +0.51% | 56% | 6% | 1% | (the contrast above) | | | |
| baseline | 10 | 1200 | | split 2024-06-13, embargo 10 | +0.47% | +0.69% | 60% | 8% | 1% | | | | |
| 50日線の上 (above) | 10 | 814 | 11 | 43% | +0.41% | +0.63% | 62% | 4% | 0% | −0.21 [−1.02, +0.70] p 0.792 | weak | −12.8 [−8.5, +7.5] p 0.025 | **robust** |
| 50日線以下 (at/below) | 10 | 386 | 19 | 66% | +0.61% | +1.14% | 57% | 17% | 4% | (the contrast above) | | | |
| baseline | 21 | 1189 | | split 2024-06-21, embargo 21 | +1.04% | +1.45% | 65% | 19% | 4% | | | | |
| 50日線の上 (above) | 21 | 805 | 7 | 42% | +0.73% | +1.22% | 65% | 12% | 1% | −0.96 [−2.02, +1.24] p 0.449 | weak | −19.3 [−12.7, +13.9] p 0.004 | **robust** |
| 50日線以下 (at/below) | 21 | 384 | 12 | 66% | +1.69% | +2.80% | 63% | 32% | 9% | (the contrast above) | | | |
| baseline | 63 | 1147 | | split 2024-07-23, embargo 63 | +3.28% | +4.05% | 74% | 37% | 14% | | | | |
| 50日線の上 (above) | 63 | 766 | 1 | 43% | +2.74% | +3.76% | 75% | 29% | 10% | −1.62 [n/a] p n/a | insufficient | −23.3 [n/a] p n/a | insufficient |
| 50日線以下 (at/below) | 63 | 381 | 5 | 64% | +4.36% | +5.54% | 71% | 52% | 22% | (the contrast above) | | | |

### S&P 500 (long history) vs 200-day SMA (200日線) — `spx.ma200`

indexSummary vs200 > 0. Outcome: ^GSPC (long-history sp500 closes). Judged 1070 sessions (2022-08-01 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1065 | | split 2024-09-19, embargo 5 | +0.31% | +0.40% | 59% | 1% | 0% | | | | |
| 200日線の上 (above) | 5 | 882 | 7 | 46% | +0.27% | +0.36% | 59% | 0% | 0% | −0.21 [−0.56, +0.36] p 0.657 | insufficient | −6.9 [−4.7, +3.4] p 0.025 | insufficient |
| 200日線以下 (at/below) | 5 | 183 | 5 | 70% | +0.48% | +0.76% | 58% | 7% | 1% | (the contrast above) | | | |
| baseline | 10 | 1060 | | split 2024-09-24, embargo 10 | +0.62% | +0.79% | 63% | 5% | 1% | | | | |
| 200日線の上 (above) | 10 | 877 | 5 | 46% | +0.52% | +0.69% | 63% | 3% | 0% | −0.58 [−1.06, +0.61] p 0.420 | insufficient | −15.5 [−11.9, +8.7] p 0.069 | insufficient |
| 200日線以下 (at/below) | 10 | 183 | 5 | 70% | +1.09% | +1.75% | 61% | 18% | 4% | (the contrast above) | | | |
| baseline | 21 | 1049 | | split 2024-10-01, embargo 21 | +1.31% | +1.67% | 68% | 14% | 2% | | | | |
| 200日線の上 (above) | 21 | 866 | 3 | 46% | +1.16% | +1.53% | 69% | 11% | 1% | −0.87 [−2.12, +1.23] p 0.664 | insufficient | −22.3 [−15.7, +16.6] p 0.047 | insufficient |
| 200日線以下 (at/below) | 21 | 183 | 5 | 70% | +2.03% | +4.11% | 61% | 33% | 11% | (the contrast above) | | | |
| baseline | 63 | 1007 | | split 2024-10-30, embargo 63 | +4.49% | +4.49% | 82% | 30% | 9% | | | | |
| 200日線の上 (above) | 63 | 824 | 1 | 46% | +4.07% | +4.32% | 83% | 28% | 6% | −2.28 [n/a] p n/a | insufficient | −7.9 [n/a] p n/a | insufficient |
| 200日線以下 (at/below) | 63 | 183 | 4 | 70% | +6.35% | +6.16% | 78% | 36% | 22% | (the contrast above) | | | |

### S&P 500 (long history) 50/200-day position — `spx.ma.quadrant`

indexSummary vsMa, vs200. Outcome: ^GSPC (long-history sp500 closes). Judged 1070 sessions (2022-08-01 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1065 | | split 2024-09-19, embargo 5 | +0.31% | +0.40% | 59% | 1% | 0% | | | | |
| 50日線・200日線の上 (above both) | 5 | 723 | 13 | 44% | +0.25% | +0.33% | 60% | 0% | 0% | −0.06 [−0.16, +0.12] p 0.682 | weak | −1.1 [−1.0, +1.0] p 0.055 | weak |
| 200日線の上・50日線の下 (above 200, below 50) | 5 | 159 | 20 | 55% | +0.39% | +0.48% | 57% | 0% | 0% | +0.08 [−0.51, +0.55] p 0.748 | unstable | −1.4 [−2.2, +3.4] p 0.398 | weak |
| 200日線の下・50日線の上 (below 200, above 50) | 5 | 62 | 5 | 89% | −0.21% | −0.20% | 47% | 5% | 0% | −0.52 [−0.68, +0.79] p 0.146 | insufficient | +3.4 [−2.8, +5.2] p 0.193 | insufficient |
| 50日線・200日線の下 (below both) | 5 | 121 | 7 | 60% | +0.83% | +1.19% | 64% | 8% | 2% | +0.52 [−0.45, +0.67] p 0.223 | insufficient | +6.9 [−2.8, +4.8] p 0.058 | insufficient |
| baseline | 10 | 1060 | | split 2024-09-24, embargo 10 | +0.62% | +0.79% | 63% | 5% | 1% | | | | |
| 50日線・200日線の上 (above both) | 10 | 721 | 8 | 44% | +0.53% | +0.67% | 64% | 1% | 0% | −0.09 [−0.32, +0.22] p 0.861 | weak | −3.9 [−2.3, +2.7] p 0.022 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 10 | 156 | 16 | 55% | +0.45% | +1.14% | 59% | 8% | 1% | −0.16 [−0.93, +1.03] p 0.792 | unstable | +3.1 [−6.2, +8.6] p 0.544 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 10 | 62 | 4 | 89% | −0.41% | +0.08% | 52% | 23% | 2% | −1.02 [−1.02, +1.41] p 0.106 | insufficient | +17.4 [−8.9, +15.1] p 0.069 | insufficient |
| 50日線・200日線の下 (below both) | 10 | 121 | 6 | 60% | +1.86% | +2.74% | 66% | 16% | 6% | +1.25 [−0.86, +1.35] p 0.139 | insufficient | +10.5 [−7.2, +10.5] p 0.106 | insufficient |
| baseline | 21 | 1049 | | split 2024-10-01, embargo 21 | +1.31% | +1.67% | 68% | 14% | 2% | | | | |
| 50日線・200日線の上 (above both) | 21 | 712 | 5 | 44% | +1.17% | +1.43% | 70% | 8% | 0% | −0.14 [−0.63, +0.39] p 0.920 | unstable | −6.5 [−4.3, +4.4] p 0.029 | **robust** |
| 200日線の上・50日線の下 (above 200, below 50) | 21 | 154 | 9 | 54% | +1.12% | +2.37% | 68% | 23% | 3% | −0.20 [−1.65, +1.68] p 0.905 | unstable | +8.3 [−12.4, +14.0] p 0.332 | unstable |
| 200日線の下・50日線の上 (below 200, above 50) | 21 | 62 | 3 | 89% | −2.10% | −2.55% | 35% | 42% | 8% | −3.41 [−1.35, +2.70] p 0.041 | insufficient | +27.5 [−18.4, +21.5] p 0.070 | insufficient |
| 50日線・200日線の下 (below both) | 21 | 121 | 6 | 60% | +4.15% | +5.91% | 74% | 28% | 13% | +2.83 [−1.55, +2.46] p 0.066 | insufficient | +13.7 [−14.3, +14.7] p 0.113 | insufficient |
| baseline | 63 | 1007 | | split 2024-10-30, embargo 63 | +4.49% | +4.49% | 82% | 30% | 9% | | | | |
| 50日線・200日線の上 (above both) | 63 | 673 | 1 | 45% | +3.64% | +4.09% | 82% | 24% | 4% | −0.85 [n/a] p n/a | insufficient | −5.7 [n/a] p n/a | insufficient |
| 200日線の上・50日線の下 (above 200, below 50) | 63 | 151 | 6 | 49% | +6.01% | +7.25% | 87% | 47% | 14% | +1.52 [n/a] p n/a | insufficient | +17.4 [n/a] p n/a | insufficient |
| 200日線の下・50日線の上 (below 200, above 50) | 63 | 62 | 2 | 89% | +0.10% | −0.68% | 44% | 52% | 37% | −4.39 [n/a] p n/a | insufficient | +22.0 [n/a] p n/a | insufficient |
| 50日線・200日線の下 (below both) | 63 | 121 | 4 | 60% | +9.55% | +8.49% | 96% | 28% | 15% | +5.06 [n/a] p n/a | insufficient | −1.5 [n/a] p n/a | insufficient |

### S&P 500 (long history) within 5% of the 252-session closing high — `spx.high.near`

indexSummary fromHigh >= -SPLIT_RULE.nearHighPercent (full year required). Outcome: ^GSPC (long-history sp500 closes). Judged 1018 sessions (2022-10-13 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1013 | | split 2024-10-25, embargo 5 | +0.38% | +0.43% | 60% | 1% | 0% | | | | |
| 1年高値から5%以内 (near high) | 5 | 778 | 6 | 43% | +0.29% | +0.36% | 60% | 0% | 0% | −0.41 [−0.59, +0.28] p 0.252 | weak | −2.7 [−2.7, +3.7] p 0.131 | unstable |
| 5%超の下 (further below) | 5 | 235 | 9 | 73% | +0.69% | +0.68% | 59% | 3% | 1% | (the contrast above) | | | |
| baseline | 10 | 1008 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| 1年高値から5%以内 (near high) | 10 | 773 | 5 | 43% | +0.55% | +0.72% | 64% | 2% | 0% | −0.87 [−1.12, +0.52] p 0.186 | weak | −3.5 [−6.5, +9.8] p 0.248 | unstable |
| 5%超の下 (further below) | 10 | 235 | 7 | 73% | +1.42% | +1.76% | 67% | 6% | 4% | (the contrast above) | | | |
| baseline | 21 | 997 | | split 2024-11-06, embargo 21 | +1.58% | +1.82% | 70% | 12% | 2% | | | | |
| 1年高値から5%以内 (near high) | 21 | 762 | 2 | 43% | +1.29% | +1.68% | 71% | 9% | 0% | −1.26 [−2.16, +1.03] p 0.382 | insufficient | −9.4 [−10.3, +17.3] p 0.138 | insufficient |
| 5%超の下 (further below) | 21 | 235 | 7 | 73% | +2.55% | +2.89% | 67% | 19% | 8% | (the contrast above) | | | |
| baseline | 63 | 955 | | split 2024-12-06, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| 1年高値から5%以内 (near high) | 63 | 720 | 1 | 42% | +3.62% | +4.18% | 81% | 28% | 6% | −4.71 [n/a] p n/a | insufficient | +4.9 [n/a] p n/a | insufficient |
| 5%超の下 (further below) | 63 | 235 | 7 | 73% | +8.33% | +8.51% | 91% | 23% | 9% | (the contrast above) | | | |

### 指数と個別株の乖離 (bifurcation) — `rule.split`

bifurcation(): index within 5% of its 252-session closing high and above200Percent < 50. Outcome: ^GSPC (long-history sp500 closes). Judged 1018 sessions (2022-10-13 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1013 | | split 2024-10-25, embargo 5 | +0.38% | +0.43% | 60% | 1% | 0% | | | | |
| 注意サイン (warning) | 5 | 189 | 14 | 46% | +0.40% | +0.51% | 62% | 0% | 0% | +0.02 [−0.46, +0.45] p 0.949 | unstable | −1.1 [−2.9, +3.6] p 0.671 | weak |
| なし | 5 | 824 | 11 | 51% | +0.38% | +0.39% | 59% | 1% | 0% | (the contrast above) | | | |
| baseline | 10 | 1008 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| 注意サイン (warning) | 10 | 184 | 13 | 47% | +0.66% | +1.20% | 72% | 7% | 0% | −0.11 [−0.89, +0.84] p 0.807 | insufficient | +4.0 [−8.0, +7.8] p 0.343 | insufficient |
| なし | 10 | 824 | 5 | 51% | +0.77% | +0.78% | 63% | 3% | 1% | (the contrast above) | | | |
| baseline | 21 | 997 | | split 2024-11-06, embargo 21 | +1.58% | +1.82% | 70% | 12% | 2% | | | | |
| 注意サイン (warning) | 21 | 173 | 9 | 50% | +2.10% | +3.09% | 79% | 14% | 0% | +0.62 [−1.43, +1.61] p 0.661 | insufficient | +3.5 [−14.1, +14.2] p 0.584 | insufficient |
| なし | 21 | 824 | 4 | 50% | +1.48% | +1.51% | 68% | 11% | 2% | (the contrast above) | | | |
| baseline | 63 | 955 | | split 2024-12-06, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| 注意サイン (warning) | 63 | 155 | 4 | 56% | +6.20% | +7.29% | 90% | 30% | 7% | +1.69 [n/a] p n/a | insufficient | +3.1 [n/a] p n/a | insufficient |
| なし | 63 | 800 | 1 | 49% | +4.51% | +4.46% | 83% | 27% | 7% | (the contrast above) | | | |

### 新安値 > 新高値 (new lows outnumber new highs) — `rule.lows`

newLows > newHighs. Outcome: ^GSPC (long-history sp500 closes). Judged 1269 sessions (2021-10-14 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1264 | | split 2024-04-29, embargo 5 | +0.24% | +0.34% | 58% | 2% | 0% | | | | |
| 注意サイン (warning) | 5 | 497 | 42 | 64% | +0.31% | +0.43% | 55% | 3% | 0% | +0.13 [−0.28, +0.38] p 0.693 | unstable | +1.7 [−2.6, +2.7] p 0.256 | unstable |
| なし | 5 | 767 | 31 | 41% | +0.19% | +0.33% | 59% | 2% | 0% | (the contrast above) | | | |
| baseline | 10 | 1259 | | split 2024-05-01, embargo 10 | +0.47% | +0.69% | 60% | 8% | 1% | | | | |
| 注意サイン (warning) | 10 | 492 | 25 | 64% | +0.66% | +0.94% | 59% | 12% | 2% | +0.31 [−0.45, +0.71] p 0.507 | weak | +7.7 [−5.8, +5.7] p 0.022 | **robust** |
| なし | 10 | 767 | 14 | 41% | +0.34% | +0.61% | 61% | 5% | 1% | (the contrast above) | | | |
| baseline | 21 | 1248 | | split 2024-05-09, embargo 21 | +0.97% | +1.32% | 64% | 19% | 4% | | | | |
| 注意サイン (warning) | 21 | 481 | 15 | 64% | +1.44% | +1.67% | 63% | 25% | 7% | +0.76 [−0.61, +1.53] p 0.299 | insufficient | +10.4 [−12.9, +8.4] p 0.040 | insufficient |
| なし | 21 | 767 | 6 | 41% | +0.68% | +1.26% | 65% | 15% | 2% | (the contrast above) | | | |
| baseline | 63 | 1206 | | split 2024-06-10, embargo 63 | +2.90% | +3.81% | 71% | 39% | 15% | | | | |
| 注意サイン (warning) | 63 | 459 | 1 | 68% | +3.66% | +4.42% | 68% | 49% | 19% | +1.24 [n/a] p n/a | insufficient | +16.2 [n/a] p n/a | insufficient |
| なし | 63 | 747 | 1 | 39% | +2.42% | +3.60% | 72% | 33% | 13% | (the contrast above) | | | |

### TT達成数の急減 (trend-template drop) — `rule.template`

environmentRules template: 10-session drop >= 20% from a base >= 20. Outcome: ^GSPC (long-history sp500 closes). Judged 1259 sessions (2021-10-28 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1254 | | split 2024-05-06, embargo 5 | +0.23% | +0.33% | 57% | 2% | 0% | | | | |
| 注意サイン (warning) | 5 | 185 | 23 | 65% | +0.27% | +0.28% | 54% | 3% | 0% | +0.05 [−0.57, +0.60] p 0.982 | unstable | +0.4 [−2.8, +4.3] p 0.763 | unstable |
| なし | 5 | 1069 | 15 | 47% | +0.22% | +0.34% | 58% | 2% | 0% | (the contrast above) | | | |
| baseline | 10 | 1249 | | split 2024-05-08, embargo 10 | +0.45% | +0.67% | 60% | 8% | 1% | | | | |
| 注意サイン (warning) | 10 | 185 | 23 | 65% | +0.73% | +1.11% | 58% | 14% | 0% | +0.33 [−0.83, +1.06] p 0.624 | unstable | +6.7 [−7.2, +9.3] p 0.182 | weak |
| なし | 10 | 1064 | 9 | 47% | +0.40% | +0.63% | 61% | 7% | 1% | (the contrast above) | | | |
| baseline | 21 | 1238 | | split 2024-05-16, embargo 21 | +0.95% | +1.30% | 64% | 19% | 4% | | | | |
| 注意サイン (warning) | 21 | 185 | 16 | 62% | +1.78% | +1.52% | 64% | 25% | 3% | +0.97 [n/a] p n/a | insufficient | +7.0 [n/a] p n/a | insufficient |
| なし | 21 | 1053 | 1 | 48% | +0.81% | +1.30% | 64% | 18% | 4% | (the contrast above) | | | |
| baseline | 63 | 1196 | | split 2024-06-17, embargo 63 | +2.93% | +3.83% | 71% | 40% | 15% | | | | |
| 注意サイン (warning) | 63 | 179 | 7 | 63% | +4.68% | +4.88% | 67% | 53% | 19% | +2.06 [n/a] p n/a | insufficient | +15.2 [n/a] p n/a | insufficient |
| なし | 63 | 1017 | 1 | 48% | +2.62% | +3.79% | 71% | 37% | 14% | (the contrast above) | | | |

### ステージ構成 (stage 4 % > stage 2 %) — `rule.stage`

environmentRules stage. Outcome: ^GSPC (long-history sp500 closes). Judged 1269 sessions (2021-10-14 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1264 | | split 2024-04-29, embargo 5 | +0.24% | +0.34% | 58% | 2% | 0% | | | | |
| 注意サイン (warning) | 5 | 897 | 7 | 54% | +0.31% | +0.51% | 60% | 3% | 0% | +0.25 [−0.29, +0.38] p 0.365 | unstable | +2.6 [−3.6, +2.9] p 0.161 | weak |
| なし | 5 | 367 | 9 | 40% | +0.06% | +0.09% | 54% | 1% | 0% | (the contrast above) | | | |
| baseline | 10 | 1259 | | split 2024-05-01, embargo 10 | +0.47% | +0.69% | 60% | 8% | 1% | | | | |
| 注意サイン (warning) | 10 | 892 | 6 | 54% | +0.58% | +0.98% | 64% | 10% | 2% | +0.40 [−0.53, +0.74] p 0.562 | insufficient | +8.6 [−9.9, +8.4] p 0.088 | insufficient |
| なし | 10 | 367 | 9 | 40% | +0.18% | +0.09% | 52% | 2% | 0% | (the contrast above) | | | |
| baseline | 21 | 1248 | | split 2024-05-09, embargo 21 | +0.97% | +1.32% | 64% | 19% | 4% | | | | |
| 注意サイン (warning) | 21 | 881 | 6 | 55% | +1.05% | +1.68% | 65% | 23% | 5% | +0.28 [−0.96, +1.52] p 0.931 | insufficient | +13.8 [−16.8, +13.4] p 0.080 | insufficient |
| なし | 21 | 367 | 9 | 38% | +0.78% | +0.84% | 61% | 9% | 0% | (the contrast above) | | | |
| baseline | 63 | 1206 | | split 2024-06-10, embargo 63 | +2.90% | +3.81% | 71% | 39% | 15% | | | | |
| 注意サイン (warning) | 63 | 863 | 3 | 56% | +3.10% | +3.90% | 70% | 37% | 20% | +0.70 [n/a] p n/a | insufficient | −7.1 [n/a] p n/a | insufficient |
| なし | 63 | 343 | 4 | 35% | +2.39% | +3.64% | 71% | 44% | 4% | (the contrast above) | | | |

### リーダーの健全度 (leader health) — `rule.leaders`

environmentRules leaders: < 50%. Outcome: ^GSPC (long-history sp500 closes). Judged 1266 sessions (2021-10-19 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1261 | | split 2024-04-30, embargo 5 | +0.23% | +0.34% | 58% | 2% | 0% | | | | |
| 注意サイン (warning) | 5 | 272 | 20 | 63% | +0.59% | +0.62% | 60% | 3% | 0% | +0.46 [−0.41, +0.49] p 0.128 | unstable | +1.2 [−2.6, +4.0] p 0.423 | weak |
| なし | 5 | 989 | 21 | 46% | +0.13% | +0.30% | 57% | 2% | 0% | (the contrast above) | | | |
| baseline | 10 | 1256 | | split 2024-05-03, embargo 10 | +0.46% | +0.68% | 60% | 8% | 1% | | | | |
| 注意サイン (warning) | 10 | 272 | 19 | 62% | +1.33% | +1.72% | 65% | 11% | 1% | +1.11 [−0.68, +0.94] p 0.044 | **robust** | +3.8 [−7.0, +7.0] p 0.354 | unstable |
| なし | 10 | 984 | 14 | 47% | +0.22% | +0.52% | 59% | 7% | 1% | (the contrast above) | | | |
| baseline | 21 | 1245 | | split 2024-05-10, embargo 21 | +0.96% | +1.31% | 64% | 19% | 4% | | | | |
| 注意サイン (warning) | 21 | 262 | 15 | 63% | +2.34% | +2.44% | 67% | 24% | 6% | +1.74 [−0.97, +1.50] p 0.088 | insufficient | +6.2 [−11.9, +10.4] p 0.427 | insufficient |
| なし | 21 | 983 | 4 | 46% | +0.60% | +1.18% | 63% | 18% | 3% | (the contrast above) | | | |
| baseline | 63 | 1203 | | split 2024-06-11, embargo 63 | +2.89% | +3.81% | 70% | 39% | 15% | | | | |
| 注意サイン (warning) | 63 | 253 | 6 | 65% | +4.61% | +5.39% | 68% | 50% | 19% | +2.17 [n/a] p n/a | insufficient | +13.8 [n/a] p n/a | insufficient |
| なし | 63 | 950 | 1 | 46% | +2.44% | +3.60% | 71% | 36% | 14% | (the contrast above) | | | |

### ブレイクアウト成功率 (breakout hold rate) — `rule.breakout`

environmentRules breakout: < 40%. Outcome: ^GSPC (long-history sp500 closes). Judged 1257 sessions (2021-11-01 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1252 | | split 2024-05-07, embargo 5 | +0.22% | +0.33% | 57% | 2% | 0% | | | | |
| 注意サイン (warning) | 5 | 103 | 8 | 71% | +0.67% | +0.69% | 56% | 4% | 0% | +0.49 [−0.63, +0.70] p 0.314 | weak | +1.6 [−2.6, +5.9] p 0.453 | unstable |
| なし | 5 | 1149 | 7 | 48% | +0.18% | +0.32% | 58% | 2% | 0% | (the contrast above) | | | |
| baseline | 10 | 1247 | | split 2024-05-09, embargo 10 | +0.45% | +0.67% | 60% | 8% | 1% | | | | |
| 注意サイン (warning) | 10 | 103 | 8 | 71% | +1.47% | +1.75% | 65% | 10% | 1% | +1.12 [−1.04, +1.33] p 0.172 | insufficient | +2.1 [−8.5, +12.7] p 0.588 | insufficient |
| なし | 10 | 1144 | 5 | 48% | +0.35% | +0.63% | 60% | 8% | 1% | (the contrast above) | | | |
| baseline | 21 | 1236 | | split 2024-05-17, embargo 21 | +0.95% | +1.30% | 64% | 19% | 4% | | | | |
| 注意サイン (warning) | 21 | 103 | 7 | 71% | +3.20% | +4.51% | 73% | 21% | 5% | +2.45 [−1.64, +2.11] p 0.058 | insufficient | +2.6 [−18.5, +18.4] p 0.701 | insufficient |
| なし | 21 | 1133 | 3 | 48% | +0.75% | +1.23% | 63% | 19% | 4% | (the contrast above) | | | |
| baseline | 63 | 1194 | | split 2024-06-18, embargo 63 | +2.94% | +3.85% | 71% | 39% | 15% | | | | |
| 注意サイン (warning) | 63 | 103 | 4 | 71% | +3.68% | +4.53% | 64% | 46% | 16% | +0.81 [n/a] p n/a | insufficient | +6.8 [n/a] p n/a | insufficient |
| なし | 63 | 1091 | 1 | 48% | +2.87% | +3.79% | 72% | 39% | 15% | (the contrast above) | | | |

### 注意サインの数 (fired warning-summary checks) — `rule.count`

dist S&P, dist NAS, FTD failed S&P, FTD failed NAS, split, lows, template, stage, leaders, breakout; all ten judged. Outcome: ^GSPC (long-history sp500 closes). Judged 738 sessions (2022-10-13 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 733 | | split 2025-05-20, embargo 5 | +0.32% | +0.36% | 57% | 1% | 0% | | | | |
| 0 | 5 | 82 | 7 | 57% | −0.47% | −0.45% | 39% | 0% | 0% | −0.79 [−0.82, +0.53] p 0.120 | weak | −1.2 [−3.8, +6.1] p 0.547 | weak |
| 1 | 5 | 160 | 21 | 31% | +0.26% | +0.36% | 60% | 1% | 0% | −0.06 [−0.45, +0.39] p 0.901 | weak | +0.0 [−1.9, +3.2] p 0.967 | weak |
| 2 | 5 | 186 | 24 | 41% | +0.14% | +0.39% | 58% | 1% | 0% | −0.19 [−0.35, +0.38] p 0.350 | unstable | −0.7 [−2.3, +2.7] p 1.000 | weak |
| 3+ | 5 | 305 | 21 | 63% | +0.68% | +0.65% | 60% | 2% | 1% | +0.36 [−0.25, +0.35] p 0.091 | weak | +0.7 [−2.0, +1.3] p 0.500 | weak |
| baseline | 10 | 728 | | split 2025-05-23, embargo 10 | +0.64% | +0.67% | 62% | 4% | 1% | | | | |
| 0 | 10 | 82 | 7 | 57% | −0.66% | −0.65% | 34% | 2% | 0% | −1.30 [−1.57, +0.88] p 0.153 | weak | −1.7 [−10.7, +16.3] p 0.642 | weak |
| 1 | 10 | 160 | 11 | 31% | +0.57% | +0.48% | 61% | 1% | 0% | −0.07 [−0.86, +0.65] p 0.985 | weak | −2.9 [−4.8, +9.8] p 0.369 | weak |
| 2 | 10 | 186 | 17 | 41% | +0.30% | +0.68% | 64% | 3% | 0% | −0.34 [−0.73, +0.62] p 0.321 | weak | −1.4 [−5.8, +7.0] p 0.949 | weak |
| 3+ | 10 | 300 | 14 | 64% | +1.25% | +1.46% | 69% | 7% | 3% | +0.61 [−0.43, +0.70] p 0.124 | weak | +2.9 [−5.8, +3.3] p 0.197 | weak |
| baseline | 21 | 717 | | split 2025-06-02, embargo 21 | +1.44% | +1.45% | 69% | 13% | 3% | | | | |
| 0 | 21 | 82 | 6 | 57% | −0.19% | −0.37% | 46% | 12% | 0% | −1.63 [−2.57, +1.54] p 0.303 | insufficient | −0.6 [−21.4, +22.5] p 0.701 | insufficient |
| 1 | 21 | 160 | 6 | 31% | +1.55% | +1.41% | 76% | 4% | 0% | +0.11 [−2.11, +1.13] p 0.788 | insufficient | −9.1 [−8.6, +15.4] p 0.084 | insufficient |
| 2 | 21 | 186 | 9 | 39% | +0.38% | +1.07% | 63% | 18% | 1% | −1.06 [−1.11, +1.19] p 0.124 | insufficient | +5.4 [−9.7, +11.7] p 0.299 | insufficient |
| 3+ | 21 | 289 | 8 | 66% | +2.53% | +2.85% | 76% | 15% | 7% | +1.08 [−0.69, +1.34] p 0.164 | insufficient | +1.7 [−10.3, +6.2] p 0.661 | insufficient |
| baseline | 63 | 675 | | split 2025-07-02, embargo 63 | +4.51% | +4.54% | 83% | 27% | 9% | | | | |
| 0 | 63 | 62 | 3 | 76% | +1.37% | +2.20% | 76% | 39% | 0% | −3.14 [n/a] p n/a | insufficient | +11.3 [n/a] p n/a | insufficient |
| 1 | 63 | 160 | 3 | 31% | +3.67% | +4.07% | 86% | 23% | 0% | −0.84 [n/a] p n/a | insufficient | −4.9 [n/a] p n/a | insufficient |
| 2 | 63 | 183 | 3 | 38% | +4.30% | +4.46% | 82% | 28% | 6% | −0.20 [n/a] p n/a | insufficient | +1.0 [n/a] p n/a | insufficient |
| 3+ | 63 | 270 | 3 | 64% | +5.87% | +6.86% | 82% | 27% | 19% | +1.36 [n/a] p n/a | insufficient | −0.4 [n/a] p n/a | insufficient |

### 新安値 > 新高値 and S&P 500 at/below its 200-day — `combo.lows_below200`

rule.lows fired and indexSummary vs200 <= 0. Outcome: ^GSPC (long-history sp500 closes). Judged 1070 sessions (2022-08-01 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1065 | | split 2024-09-19, embargo 5 | +0.31% | +0.40% | 59% | 1% | 0% | | | | |
| 両方 (both) | 5 | 131 | 9 | 69% | +0.43% | +0.65% | 57% | 8% | 2% | +0.14 [−0.42, +0.68] p 0.916 | unstable | +7.1 [−3.2, +5.4] p 0.044 | **robust** |
| それ以外 (otherwise) | 5 | 934 | 11 | 47% | +0.29% | +0.38% | 59% | 1% | 0% | (the contrast above) | | | |
| baseline | 10 | 1060 | | split 2024-09-24, embargo 10 | +0.62% | +0.79% | 63% | 5% | 1% | | | | |
| 両方 (both) | 10 | 131 | 5 | 69% | +1.16% | +1.33% | 60% | 18% | 5% | +0.62 [−0.77, +1.21] p 0.504 | insufficient | +15.0 [−8.2, +10.9] p 0.058 | insufficient |
| それ以外 (otherwise) | 10 | 929 | 4 | 47% | +0.54% | +0.74% | 63% | 3% | 0% | (the contrast above) | | | |
| baseline | 21 | 1049 | | split 2024-10-01, embargo 21 | +1.31% | +1.67% | 68% | 14% | 2% | | | | |
| 両方 (both) | 21 | 131 | 5 | 69% | +2.63% | +4.62% | 63% | 33% | 13% | +1.50 [−1.35, +2.31] p 0.354 | insufficient | +21.1 [−16.7, +15.1] p 0.055 | insufficient |
| それ以外 (otherwise) | 21 | 918 | 2 | 47% | +1.13% | +1.52% | 69% | 12% | 1% | (the contrast above) | | | |
| baseline | 63 | 1007 | | split 2024-10-30, embargo 63 | +4.49% | +4.49% | 82% | 30% | 9% | | | | |
| 両方 (both) | 63 | 131 | 4 | 69% | +7.56% | +7.04% | 85% | 33% | 18% | +3.53 [n/a] p n/a | insufficient | +3.7 [n/a] p n/a | insufficient |
| それ以外 (otherwise) | 63 | 876 | 1 | 47% | +4.03% | +4.36% | 81% | 29% | 7% | (the contrast above) | | | |

### 50日線より上の割合がQ1 and S&P 500 above its 200-day — `combo.washout_uptrend`

q.above50Percent causal bucket Q1 and indexSummary vs200 > 0. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03). Two states: one contrast, the first minus the second.

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| 両方 (both) | 5 | 73 | 9 | 45% | +0.14% | −0.17% | 49% | 0% | 0% | −0.26 [−0.75, +0.68] p 0.482 | weak | −1.0 [−3.2, +5.7] p 0.799 | weak |
| それ以外 (otherwise) | 5 | 939 | 5 | 50% | +0.40% | +0.46% | 61% | 1% | 0% | (the contrast above) | | | |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| 両方 (both) | 10 | 73 | 8 | 45% | +0.14% | +0.73% | 53% | 4% | 0% | −0.65 [−1.21, +1.22] p 0.329 | insufficient | +0.9 [−8.3, +13.5] p 0.982 | insufficient |
| それ以外 (otherwise) | 10 | 934 | 2 | 50% | +0.80% | +0.91% | 66% | 3% | 1% | (the contrast above) | | | |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| 両方 (both) | 21 | 62 | 8 | 53% | +1.45% | +1.93% | 69% | 13% | 2% | −0.13 [n/a] p n/a | insufficient | +1.4 [n/a] p n/a | insufficient |
| それ以外 (otherwise) | 21 | 934 | 1 | 50% | +1.58% | +1.78% | 70% | 11% | 2% | (the contrast above) | | | |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| 両方 (both) | 63 | 52 | 6 | 63% | +7.33% | +9.92% | 85% | 38% | 10% | +2.70 [n/a] p n/a | insufficient | +12.0 [n/a] p n/a | insufficient |
| それ以外 (otherwise) | 63 | 902 | 1 | 49% | +4.63% | +4.54% | 84% | 27% | 6% | (the contrast above) | | | |

### 50日線より上 (% above 50-day) — `q.above50Percent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 22.6 / 31.9 / 42.0 / 55.1, after the last session 31.4 / 45.0 / 55.1 / 63.9. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 129 | 10 | 38% | +0.51% | +0.50% | 57% | 5% | 2% | +0.13 [−0.46, +0.54] p 0.661 | weak | +3.8 [−2.4, +3.2] p 0.066 | unstable |
| Q2 | 5 | 126 | 24 | 44% | +0.26% | +0.35% | 58% | 0% | 0% | −0.12 [−0.52, +0.48] p 0.701 | unstable | −0.9 [−2.4, +3.9] p 0.628 | weak |
| Q3 | 5 | 258 | 32 | 43% | +0.74% | +0.69% | 66% | 0% | 0% | +0.36 [−0.35, +0.32] p 0.069 | weak | −0.9 [−1.8, +2.7] p 0.460 | weak |
| Q4 | 5 | 296 | 32 | 50% | +0.31% | +0.36% | 59% | 0% | 0% | −0.07 [−0.36, +0.31] p 0.890 | weak | −0.9 [−1.6, +2.3] p 0.536 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 203 | 19 | 70% | +0.03% | +0.22% | 57% | 1% | 0% | −0.35 [−0.29, +0.42] p 0.040 | **robust** | +0.6 [−2.5, +1.7] p 0.380 | unstable |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 129 | 9 | 38% | +1.23% | +1.32% | 64% | 9% | 5% | +0.48 [−0.83, +1.05] p 0.416 | weak | +6.0 [−6.8, +7.8] p 0.190 | weak |
| Q2 | 10 | 121 | 18 | 46% | +0.48% | +0.94% | 60% | 9% | 2% | −0.27 [−0.94, +0.81] p 0.646 | unstable | +5.8 [−6.0, +6.8] p 0.179 | weak |
| Q3 | 10 | 258 | 23 | 43% | +1.21% | +1.27% | 71% | 0% | 0% | +0.46 [−0.56, +0.48] p 0.128 | weak | −2.9 [−4.3, +5.7] p 0.259 | weak |
| Q4 | 10 | 296 | 17 | 50% | +0.52% | +0.68% | 62% | 1% | 0% | −0.23 [−0.56, +0.52] p 0.624 | weak | −2.3 [−3.6, +4.9] p 0.394 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 203 | 14 | 68% | +0.35% | +0.49% | 64% | 3% | 0% | −0.40 [−0.47, +0.80] p 0.179 | unstable | −0.3 [−6.8, +5.0] p 0.551 | unstable |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 118 | 9 | 42% | +3.44% | +3.71% | 72% | 21% | 13% | +1.86 [−1.42, +2.03] p 0.120 | weak | +9.6 [−14.2, +14.5] p 0.303 | unstable |
| Q2 | 21 | 121 | 12 | 46% | +1.29% | +1.66% | 69% | 21% | 3% | −0.29 [−1.52, +1.31] p 0.730 | weak | +9.9 [−11.5, +12.7] p 0.201 | weak |
| Q3 | 21 | 258 | 12 | 43% | +1.39% | +1.67% | 71% | 9% | 0% | −0.18 [−0.89, +0.73] p 0.887 | unstable | −2.2 [−6.5, +8.1] p 0.474 | unstable |
| Q4 | 21 | 296 | 10 | 49% | +1.61% | +1.91% | 73% | 4% | 0% | +0.03 [−0.89, +0.83] p 0.766 | unstable | −7.5 [−6.4, +8.6] p 0.058 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 203 | 9 | 67% | +0.85% | +1.31% | 65% | 14% | 0% | −0.73 [−0.84, +1.63] p 0.153 | unstable | +2.2 [−14.0, +9.2] p 0.369 | unstable |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 108 | 7 | 45% | +10.70% | +11.12% | 93% | 34% | 18% | +5.92 [n/a] p n/a | insufficient | +7.1 [n/a] p n/a | insufficient |
| Q2 | 63 | 110 | 5 | 51% | +4.53% | +5.00% | 84% | 45% | 18% | −0.25 [n/a] p n/a | insufficient | +18.3 [n/a] p n/a | insufficient |
| Q3 | 63 | 245 | 1 | 44% | +3.99% | +4.35% | 82% | 24% | 8% | −0.78 [n/a] p n/a | insufficient | −2.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 288 | 1 | 45% | +3.81% | +4.25% | 86% | 17% | 1% | −0.96 [n/a] p n/a | insufficient | −10.1 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 203 | 6 | 66% | +4.08% | +4.30% | 78% | 31% | 1% | −0.70 [n/a] p n/a | insufficient | +3.9 [n/a] p n/a | insufficient |

### 50日線より上 (% above 50-day) 21-session change — `d21.above50Percent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -26.5 / -9.26 / 5.73 / 20.7, after the last session -19.5 / -6.16 / 4.38 / 16.8. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 139 | 18 | 47% | +0.83% | +0.76% | 70% | 0% | 0% | +0.48 [−0.45, +0.51] p 0.150 | weak | −0.9 [−2.3, +2.9] p 0.624 | weak |
| Q2 | 5 | 249 | 33 | 45% | +0.17% | +0.28% | 54% | 2% | 0% | −0.18 [−0.36, +0.31] p 0.369 | weak | +1.5 [−1.6, +2.1] p 0.277 | weak |
| Q3 | 5 | 256 | 43 | 48% | +0.13% | +0.28% | 56% | 0% | 0% | −0.22 [−0.29, +0.24] p 0.321 | weak | −0.5 [−1.6, +2.3] p 0.613 | weak |
| Q4 | 5 | 208 | 31 | 53% | +0.31% | +0.33% | 60% | 0% | 0% | −0.03 [−0.35, +0.39] p 0.869 | weak | −0.9 [−2.0, +2.4] p 0.639 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 139 | 15 | 58% | +0.65% | +0.86% | 69% | 1% | 0% | +0.30 [−0.41, +0.47] p 0.281 | unstable | +0.5 [−2.8, +2.7] p 0.617 | unstable |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 139 | 16 | 47% | +1.32% | +1.62% | 75% | 2% | 1% | +0.62 [−0.79, +0.97] p 0.285 | weak | −1.2 [−6.3, +5.8] p 0.766 | weak |
| Q2 | 10 | 249 | 25 | 45% | +0.51% | +0.69% | 58% | 7% | 3% | −0.19 [−0.61, +0.53] p 0.533 | weak | +3.5 [−3.6, +4.9] p 0.226 | weak |
| Q3 | 10 | 255 | 30 | 49% | +0.45% | +0.61% | 59% | 2% | 0% | −0.25 [−0.53, +0.39] p 0.511 | weak | −1.0 [−3.3, +5.0] p 0.551 | weak |
| Q4 | 10 | 204 | 23 | 54% | +0.59% | +0.49% | 63% | 1% | 0% | −0.11 [−0.63, +0.67] p 0.708 | weak | −2.4 [−4.8, +4.0] p 0.533 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 139 | 12 | 58% | +1.06% | +1.29% | 76% | 4% | 0% | +0.36 [−0.72, +0.89] p 0.482 | unstable | +0.3 [−7.7, +5.6] p 0.697 | unstable |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 138 | 14 | 48% | +2.61% | +2.59% | 80% | 12% | 6% | +1.11 [−1.41, +1.63] p 0.285 | weak | −0.2 [−11.7, +11.1] p 0.975 | unstable |
| Q2 | 21 | 242 | 13 | 43% | +1.20% | +1.36% | 63% | 17% | 4% | −0.30 [−0.89, +0.86] p 0.518 | weak | +5.6 [−6.7, +7.5] p 0.259 | weak |
| Q3 | 21 | 252 | 10 | 49% | +1.35% | +1.21% | 69% | 9% | 0% | −0.15 [−0.81, +0.69] p 0.982 | unstable | −3.1 [−5.6, +7.7] p 0.354 | unstable |
| Q4 | 21 | 204 | 16 | 54% | +0.95% | +1.14% | 66% | 8% | 0% | −0.55 [−1.05, +0.91] p 0.281 | weak | −3.5 [−7.8, +7.3] p 0.566 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 139 | 11 | 58% | +1.98% | +3.12% | 76% | 13% | 0% | +0.48 [−1.26, +1.47] p 0.617 | unstable | +1.2 [−13.9, +12.4] p 0.741 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 121 | 6 | 55% | +5.62% | +6.48% | 84% | 38% | 13% | +0.90 [n/a] p n/a | insufficient | +10.4 [n/a] p n/a | insufficient |
| Q2 | 63 | 235 | 2 | 44% | +5.75% | +4.54% | 95% | 29% | 8% | +1.03 [n/a] p n/a | insufficient | +1.7 [n/a] p n/a | insufficient |
| Q3 | 63 | 235 | 1 | 49% | +4.25% | +4.25% | 84% | 22% | 3% | −0.47 [n/a] p n/a | insufficient | −6.0 [n/a] p n/a | insufficient |
| Q4 | 63 | 203 | 2 | 50% | +3.24% | +3.92% | 71% | 29% | 8% | −1.48 [n/a] p n/a | insufficient | +1.4 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 139 | 7 | 58% | +5.15% | +5.40% | 80% | 24% | 4% | +0.43 [n/a] p n/a | insufficient | −3.9 [n/a] p n/a | insufficient |

### 150日線より上 (% above 150-day) — `q.above150Percent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 20.5 / 28.6 / 34.7 / 45.1, after the last session 35.0 / 46.0 / 54.0 / 60.2. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 51 | 3 | 22% | +1.02% | +1.22% | 67% | 12% | 4% | +0.63 [−0.87, +0.98] p 0.234 | insufficient | +10.9 [−3.0, +8.8] p 0.051 | insufficient |
| Q2 | 5 | 114 | 12 | 28% | +0.50% | +0.57% | 56% | 0% | 0% | +0.12 [−0.63, +0.56] p 0.697 | weak | −0.9 [−2.4, +3.8] p 0.511 | weak |
| Q3 | 5 | 191 | 23 | 37% | +0.69% | +0.82% | 66% | 0% | 0% | +0.31 [−0.40, +0.39] p 0.204 | weak | −0.9 [−2.2, +2.9] p 0.650 | weak |
| Q4 | 5 | 336 | 27 | 43% | +0.40% | +0.34% | 61% | 0% | 0% | +0.01 [−0.31, +0.27] p 0.850 | unstable | −0.9 [−1.5, +1.7] p 0.314 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 320 | 15 | 78% | +0.04% | +0.23% | 56% | 1% | 0% | −0.34 [−0.32, +0.28] p 0.099 | weak | +0.0 [−2.3, +2.0] p 0.737 | unstable |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 51 | 3 | 22% | +2.58% | +3.27% | 78% | 18% | 14% | +1.83 [−1.65, +1.84] p 0.106 | insufficient | +14.4 [−9.3, +22.1] p 0.186 | insufficient |
| Q2 | 10 | 109 | 10 | 29% | +0.75% | +0.88% | 65% | 8% | 2% | −0.00 [−1.13, +1.02] p 0.971 | unstable | +5.0 [−7.5, +9.9] p 0.500 | weak |
| Q3 | 10 | 191 | 18 | 37% | +1.29% | +1.72% | 73% | 3% | 0% | +0.54 [−0.68, +0.72] p 0.204 | weak | −0.7 [−5.3, +5.5] p 0.916 | weak |
| Q4 | 10 | 336 | 17 | 43% | +0.65% | +0.67% | 64% | 1% | 0% | −0.10 [−0.57, +0.51] p 0.825 | unstable | −2.4 [−3.9, +4.0] p 0.256 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 320 | 9 | 77% | +0.24% | +0.49% | 58% | 2% | 0% | −0.51 [−0.59, +0.52] p 0.157 | weak | −1.1 [−5.0, +5.9] p 0.949 | unstable |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 51 | 3 | 22% | +4.81% | +6.51% | 73% | 33% | 27% | +3.23 [−3.23, +3.58] p 0.159 | insufficient | +21.8 [−20.8, +35.1] p 0.221 | insufficient |
| Q2 | 21 | 98 | 9 | 33% | +2.79% | +3.45% | 76% | 16% | 5% | +1.22 [−2.01, +2.03] p 0.325 | weak | +4.8 [−14.6, +19.1] p 0.792 | weak |
| Q3 | 21 | 191 | 12 | 37% | +2.13% | +2.46% | 77% | 10% | 0% | +0.55 [−0.98, +1.25] p 0.409 | weak | −1.6 [−9.6, +9.8] p 0.836 | weak |
| Q4 | 21 | 336 | 9 | 43% | +1.09% | +1.34% | 69% | 8% | 0% | −0.49 [−0.96, +0.90] p 0.493 | unstable | −3.2 [−6.2, +7.4] p 0.350 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 320 | 6 | 75% | +0.87% | +1.32% | 66% | 11% | 0% | −0.71 [−1.07, +0.99] p 0.230 | weak | −0.6 [−9.5, +10.6] p 0.861 | unstable |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 51 | 3 | 22% | +14.05% | +14.71% | 100% | 33% | 27% | +9.27 [n/a] p n/a | insufficient | +6.2 [n/a] p n/a | insufficient |
| Q2 | 63 | 83 | 6 | 39% | +9.66% | +10.13% | 98% | 23% | 13% | +4.89 [n/a] p n/a | insufficient | −4.3 [n/a] p n/a | insufficient |
| Q3 | 63 | 183 | 4 | 38% | +4.09% | +4.71% | 81% | 32% | 11% | −0.68 [n/a] p n/a | insufficient | +5.1 [n/a] p n/a | insufficient |
| Q4 | 63 | 317 | 3 | 44% | +3.96% | +4.24% | 81% | 27% | 5% | −0.82 [n/a] p n/a | insufficient | +0.3 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 320 | 4 | 70% | +3.24% | +3.88% | 82% | 24% | 1% | −1.54 [n/a] p n/a | insufficient | −3.1 [n/a] p n/a | insufficient |

### 150日線より上 (% above 150-day) 21-session change — `d21.above150Percent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -14.7 / -6.41 / -0.06 / 8.21, after the last session -10.8 / -3.47 / 2.34 / 9.24. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 152 | 17 | 39% | +0.68% | +0.79% | 64% | 3% | 0% | +0.33 [−0.41, +0.46] p 0.201 | weak | +1.7 [−2.2, +3.1] p 0.376 | unstable |
| Q2 | 5 | 193 | 33 | 55% | +0.49% | +0.59% | 62% | 1% | 1% | +0.14 [−0.34, +0.34] p 0.562 | unstable | −0.4 [−2.0, +2.4] p 0.839 | weak |
| Q3 | 5 | 244 | 42 | 43% | +0.05% | +0.18% | 54% | 1% | 0% | −0.30 [−0.34, +0.29] p 0.193 | weak | −0.1 [−1.6, +2.5] p 0.836 | unstable |
| Q4 | 5 | 224 | 34 | 54% | +0.29% | +0.30% | 57% | 0% | 0% | −0.06 [−0.40, +0.38] p 0.810 | unstable | −0.9 [−2.1, +2.5] p 0.525 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 178 | 16 | 58% | +0.40% | +0.54% | 66% | 1% | 0% | +0.05 [−0.36, +0.42] p 0.967 | unstable | +0.2 [−2.4, +2.2] p 0.584 | unstable |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 152 | 14 | 39% | +1.29% | +1.69% | 72% | 7% | 3% | +0.59 [−0.76, +0.84] p 0.230 | weak | +3.9 [−5.4, +5.7] p 0.329 | unstable |
| Q2 | 10 | 192 | 23 | 55% | +0.80% | +1.19% | 63% | 5% | 2% | +0.10 [−0.60, +0.57] p 0.920 | unstable | +1.9 [−4.0, +4.3] p 0.409 | unstable |
| Q3 | 10 | 240 | 26 | 43% | +0.36% | +0.43% | 57% | 3% | 0% | −0.34 [−0.57, +0.41] p 0.398 | weak | −0.8 [−3.3, +5.7] p 0.507 | unstable |
| Q4 | 10 | 224 | 23 | 54% | +0.56% | +0.64% | 65% | 0% | 0% | −0.14 [−0.71, +0.75] p 0.723 | weak | −2.9 [−4.6, +4.8] p 0.256 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 178 | 14 | 58% | +0.73% | +0.81% | 68% | 3% | 0% | +0.03 [−0.61, +0.78] p 0.854 | unstable | −0.5 [−6.8, +5.5] p 0.661 | unstable |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 149 | 12 | 40% | +2.39% | +2.26% | 73% | 16% | 10% | +0.89 [−1.25, +1.35] p 0.288 | weak | +4.3 [−10.4, +10.9] p 0.551 | unstable |
| Q2 | 21 | 184 | 13 | 57% | +1.99% | +2.25% | 72% | 18% | 2% | +0.49 [−0.93, +0.86] p 0.434 | unstable | +6.7 [−7.4, +6.4] p 0.091 | weak |
| Q3 | 21 | 240 | 14 | 41% | +0.97% | +1.08% | 64% | 6% | 1% | −0.53 [−0.93, +0.65] p 0.405 | unstable | −5.5 [−4.7, +8.0] p 0.058 | weak |
| Q4 | 21 | 224 | 14 | 54% | +0.96% | +1.20% | 67% | 11% | 0% | −0.54 [−1.20, +1.09] p 0.445 | weak | −1.1 [−7.9, +8.6] p 0.785 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 178 | 12 | 58% | +1.63% | +2.50% | 75% | 10% | 0% | +0.13 [−1.08, +1.39] p 0.945 | unstable | −1.7 [−12.8, +9.4] p 0.861 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 133 | 6 | 44% | +6.89% | +7.25% | 88% | 43% | 21% | +2.17 [n/a] p n/a | insufficient | +15.2 [n/a] p n/a | insufficient |
| Q2 | 63 | 178 | 2 | 59% | +5.91% | +5.18% | 94% | 26% | 6% | +1.18 [n/a] p n/a | insufficient | −1.8 [n/a] p n/a | insufficient |
| Q3 | 63 | 224 | 1 | 41% | +3.70% | +4.21% | 79% | 24% | 3% | −1.02 [n/a] p n/a | insufficient | −3.5 [n/a] p n/a | insufficient |
| Q4 | 63 | 220 | 1 | 49% | +2.92% | +3.24% | 76% | 29% | 7% | −1.80 [n/a] p n/a | insufficient | +1.4 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 178 | 6 | 58% | +5.42% | +5.93% | 84% | 21% | 2% | +0.70 [n/a] p n/a | insufficient | −6.9 [n/a] p n/a | insufficient |

### 200日線より上 (% above 200-day) — `q.above200Percent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 19.7 / 27.6 / 34.0 / 46.0, after the last session 35.0 / 45.0 / 54.5 / 60.1. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 33 | 4 | 30% | +2.42% | +2.92% | 76% | 3% | 0% | +2.03 [−1.13, +1.12] p 0.018 | insufficient | +2.1 [−3.0, +9.4] p 0.350 | insufficient |
| Q2 | 5 | 109 | 8 | 28% | +0.19% | +0.54% | 58% | 5% | 2% | −0.20 [−0.63, +0.64] p 0.671 | unstable | +3.7 [−2.4, +3.9] p 0.164 | unstable |
| Q3 | 5 | 203 | 22 | 28% | +0.61% | +0.87% | 63% | 0% | 0% | +0.23 [−0.44, +0.37] p 0.332 | weak | −0.9 [−2.4, +2.7] p 0.704 | weak |
| Q4 | 5 | 343 | 30 | 46% | +0.40% | +0.35% | 61% | 0% | 0% | +0.02 [−0.32, +0.23] p 0.916 | unstable | −0.6 [−1.5, +2.0] p 0.628 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 324 | 13 | 77% | +0.07% | +0.24% | 57% | 1% | 0% | −0.31 [−0.33, +0.29] p 0.117 | weak | −0.3 [−2.3, +2.3] p 0.982 | unstable |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 33 | 4 | 30% | +4.76% | +4.88% | 97% | 6% | 0% | +4.01 [−1.98, +2.11] p 0.004 | insufficient | +2.8 [−9.3, +21.3] p 0.383 | insufficient |
| Q2 | 10 | 104 | 6 | 30% | +0.37% | +0.90% | 63% | 11% | 9% | −0.38 [−1.23, +1.20] p 0.690 | insufficient | +7.3 [−7.5, +9.4] p 0.256 | insufficient |
| Q3 | 10 | 203 | 16 | 28% | +1.22% | +1.48% | 72% | 4% | 0% | +0.47 [−0.78, +0.68] p 0.252 | weak | +1.2 [−6.3, +6.3] p 0.818 | unstable |
| Q4 | 10 | 343 | 19 | 46% | +0.65% | +0.68% | 63% | 2% | 0% | −0.10 [−0.57, +0.42] p 0.723 | unstable | −1.5 [−4.1, +3.6] p 0.533 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 324 | 10 | 77% | +0.27% | +0.49% | 59% | 2% | 0% | −0.48 [−0.63, +0.55] p 0.157 | weak | −1.7 [−5.1, +6.3] p 0.850 | unstable |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 33 | 3 | 30% | +8.48% | +8.90% | 97% | 9% | 0% | +6.91 [−3.55, +3.88] p 0.004 | insufficient | −2.5 [−20.8, +36.1] p 0.748 | insufficient |
| Q2 | 21 | 93 | 5 | 33% | +1.92% | +2.79% | 67% | 27% | 20% | +0.34 [−2.09, +2.16] p 0.770 | insufficient | +15.3 [−15.0, +20.4] p 0.164 | insufficient |
| Q3 | 21 | 203 | 10 | 28% | +2.56% | +2.55% | 83% | 9% | 0% | +0.98 [−1.19, +1.18] p 0.190 | weak | −2.7 [−10.8, +11.3] p 0.730 | weak |
| Q4 | 21 | 343 | 8 | 46% | +0.77% | +0.92% | 64% | 11% | 0% | −0.81 [−0.97, +0.75] p 0.139 | weak | −0.2 [−7.5, +6.8] p 0.898 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 324 | 7 | 75% | +1.01% | +1.50% | 68% | 9% | 0% | −0.56 [−1.30, +1.02] p 0.329 | weak | −2.3 [−10.5, +9.9] p 0.818 | unstable |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 33 | 3 | 30% | +16.83% | +16.42% | 100% | 9% | 0% | +12.05 [n/a] p n/a | insufficient | −18.1 [n/a] p n/a | insufficient |
| Q2 | 63 | 82 | 4 | 38% | +10.06% | +10.30% | 100% | 32% | 24% | +5.29 [n/a] p n/a | insufficient | +4.6 [n/a] p n/a | insufficient |
| Q3 | 63 | 192 | 4 | 29% | +5.18% | +6.10% | 87% | 21% | 10% | +0.40 [n/a] p n/a | insufficient | −6.3 [n/a] p n/a | insufficient |
| Q4 | 63 | 323 | 3 | 48% | +3.51% | +3.70% | 78% | 32% | 7% | −1.26 [n/a] p n/a | insufficient | +4.4 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 324 | 3 | 69% | +3.23% | +3.89% | 82% | 27% | 1% | −1.54 [n/a] p n/a | insufficient | +0.0 [n/a] p n/a | insufficient |

### 200日線より上 (% above 200-day) 21-session change — `d21.above200Percent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -12.9 / -5.35 / -0.55 / 6.14, after the last session -9.83 / -3.17 / 2.14 / 8.22. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 145 | 16 | 34% | +0.54% | +0.66% | 61% | 3% | 1% | +0.19 [−0.44, +0.45] p 0.577 | unstable | +2.5 [−2.3, +3.3] p 0.230 | unstable |
| Q2 | 5 | 195 | 32 | 58% | +0.37% | +0.50% | 59% | 1% | 1% | +0.02 [−0.38, +0.32] p 0.993 | unstable | −0.4 [−1.9, +2.3] p 0.799 | unstable |
| Q3 | 5 | 231 | 36 | 48% | +0.30% | +0.35% | 60% | 0% | 0% | −0.05 [−0.36, +0.25] p 0.847 | unstable | −0.9 [−1.5, +2.3] p 0.296 | weak |
| Q4 | 5 | 252 | 34 | 46% | +0.22% | +0.25% | 56% | 0% | 0% | −0.13 [−0.38, +0.33] p 0.569 | weak | −0.5 [−1.6, +1.9] p 0.671 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 168 | 15 | 64% | +0.42% | +0.54% | 67% | 1% | 0% | +0.07 [−0.32, +0.47] p 0.839 | unstable | +0.3 [−2.4, +2.0] p 0.518 | unstable |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 145 | 13 | 34% | +1.27% | +1.61% | 72% | 9% | 5% | +0.57 [−0.78, +0.88] p 0.321 | weak | +5.6 [−5.6, +6.4] p 0.168 | unstable |
| Q2 | 10 | 194 | 25 | 58% | +0.51% | +0.86% | 57% | 5% | 1% | −0.19 [−0.57, +0.50] p 0.529 | unstable | +1.3 [−4.4, +4.5] p 0.569 | unstable |
| Q3 | 10 | 227 | 23 | 48% | +0.78% | +0.84% | 62% | 1% | 0% | +0.08 [−0.61, +0.43] p 0.708 | unstable | −2.5 [−3.4, +5.3] p 0.215 | weak |
| Q4 | 10 | 252 | 22 | 46% | +0.42% | +0.54% | 63% | 2% | 0% | −0.28 [−0.62, +0.54] p 0.493 | weak | −1.8 [−3.5, +4.2] p 0.420 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 168 | 12 | 64% | +0.76% | +0.92% | 70% | 3% | 0% | +0.06 [−0.63, +0.79] p 0.967 | unstable | −0.4 [−6.4, +5.2] p 0.628 | unstable |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 142 | 12 | 35% | +2.46% | +2.13% | 72% | 19% | 12% | +0.96 [−1.34, +1.49] p 0.358 | weak | +7.2 [−11.7, +13.2] p 0.376 | unstable |
| Q2 | 21 | 186 | 14 | 60% | +1.63% | +1.92% | 69% | 18% | 1% | +0.14 [−0.95, +0.80] p 0.927 | unstable | +6.5 [−8.2, +8.0] p 0.153 | weak |
| Q3 | 21 | 227 | 13 | 46% | +1.34% | +1.22% | 66% | 4% | 0% | −0.16 [−0.94, +0.59] p 0.931 | unstable | −7.8 [−4.9, +8.8] p 0.004 | **robust** |
| Q4 | 21 | 252 | 14 | 46% | +0.98% | +1.11% | 68% | 9% | 0% | −0.52 [−1.15, +0.75] p 0.420 | weak | −2.7 [−6.1, +8.0] p 0.478 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 168 | 11 | 64% | +1.52% | +2.65% | 74% | 13% | 0% | +0.03 [−1.10, +1.38] p 0.814 | unstable | +1.3 [−13.1, +8.7] p 0.595 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 125 | 6 | 39% | +7.80% | +9.55% | 87% | 47% | 23% | +3.07 [n/a] p n/a | insufficient | +19.5 [n/a] p n/a | insufficient |
| Q2 | 63 | 181 | 1 | 62% | +5.80% | +5.58% | 93% | 29% | 6% | +1.08 [n/a] p n/a | insufficient | +1.6 [n/a] p n/a | insufficient |
| Q3 | 63 | 217 | 1 | 44% | +4.13% | +4.21% | 87% | 19% | 1% | −0.59 [n/a] p n/a | insufficient | −8.8 [n/a] p n/a | insufficient |
| Q4 | 63 | 242 | 1 | 42% | +2.67% | +3.43% | 72% | 28% | 8% | −2.05 [n/a] p n/a | insufficient | +0.0 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 168 | 7 | 64% | +4.99% | +5.38% | 83% | 23% | 1% | +0.27 [n/a] p n/a | insufficient | −5.0 [n/a] p n/a | insufficient |

### TT達成率 (% meeting the trend template) — `q.trendTemplatePercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 4.20 / 6.31 / 9.42 / 14.5, after the last session 8.51 / 12.7 / 15.9 / 18.7. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 28 | 5 | 36% | +2.24% | +2.80% | 71% | 4% | 0% | +1.86 [−1.28, +1.19] p 0.025 | insufficient | +2.7 [−3.0, +8.3] p 0.329 | insufficient |
| Q2 | 5 | 104 | 14 | 28% | +0.32% | +0.52% | 58% | 5% | 2% | −0.07 [−0.60, +0.56] p 0.872 | unstable | +3.9 [−3.0, +4.5] p 0.135 | unstable |
| Q3 | 5 | 227 | 24 | 33% | +0.42% | +0.49% | 61% | 0% | 0% | +0.04 [−0.36, +0.37] p 0.964 | weak | −0.4 [−1.9, +2.4] p 0.953 | unstable |
| Q4 | 5 | 325 | 21 | 52% | +0.52% | +0.54% | 62% | 0% | 0% | +0.14 [−0.30, +0.25] p 0.402 | unstable | −0.9 [−1.5, +2.0] p 0.460 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 328 | 10 | 67% | +0.08% | +0.23% | 57% | 1% | 0% | −0.30 [−0.30, +0.28] p 0.102 | weak | −0.3 [−2.3, +2.0] p 0.829 | unstable |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 28 | 5 | 36% | +4.44% | +4.06% | 96% | 7% | 0% | +3.69 [−2.17, +2.04] p 0.004 | insufficient | +3.9 [−9.3, +22.9] p 0.404 | insufficient |
| Q2 | 10 | 103 | 11 | 28% | +0.49% | +0.79% | 60% | 11% | 9% | −0.26 [−1.06, +1.06] p 0.650 | unstable | +7.4 [−7.5, +9.5] p 0.186 | unstable |
| Q3 | 10 | 223 | 17 | 34% | +1.01% | +1.21% | 73% | 5% | 0% | +0.26 [−0.60, +0.62] p 0.540 | weak | +1.7 [−5.1, +6.7] p 0.511 | weak |
| Q4 | 10 | 325 | 17 | 52% | +0.90% | +0.92% | 64% | 2% | 0% | +0.15 [−0.51, +0.43] p 0.584 | unstable | −1.7 [−4.2, +4.8] p 0.591 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 328 | 8 | 66% | +0.19% | +0.46% | 59% | 1% | 0% | −0.56 [−0.61, +0.52] p 0.117 | weak | −2.1 [−5.1, +5.6] p 0.657 | weak |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 28 | 3 | 36% | +7.22% | +9.11% | 86% | 21% | 11% | +5.64 [−3.31, +3.54] p 0.011 | insufficient | +9.9 [−20.8, +33.4] p 0.418 | insufficient |
| Q2 | 21 | 92 | 10 | 32% | +1.77% | +1.95% | 65% | 21% | 17% | +0.19 [−1.80, +1.96] p 0.945 | unstable | +9.1 [−14.5, +18.1] p 0.412 | unstable |
| Q3 | 21 | 223 | 11 | 34% | +2.64% | +2.50% | 85% | 9% | 0% | +1.07 [−1.01, +0.99] p 0.069 | weak | −3.0 [−8.6, +11.5] p 0.799 | unstable |
| Q4 | 21 | 325 | 9 | 52% | +1.01% | +1.05% | 66% | 11% | 0% | −0.56 [−0.79, +0.80] p 0.347 | weak | −0.5 [−8.2, +7.9] p 0.978 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 328 | 7 | 65% | +0.88% | +1.34% | 65% | 11% | 0% | −0.70 [−1.15, +0.94] p 0.332 | weak | −0.9 [−10.9, +11.1] p 0.814 | unstable |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 28 | 3 | 36% | +16.43% | +16.55% | 100% | 21% | 11% | +11.65 [n/a] p n/a | insufficient | −5.7 [n/a] p n/a | insufficient |
| Q2 | 63 | 79 | 5 | 37% | +8.86% | +9.71% | 96% | 30% | 28% | +4.08 [n/a] p n/a | insufficient | +3.2 [n/a] p n/a | insufficient |
| Q3 | 63 | 203 | 6 | 37% | +5.65% | +6.29% | 86% | 21% | 7% | +0.87 [n/a] p n/a | insufficient | −6.5 [n/a] p n/a | insufficient |
| Q4 | 63 | 316 | 3 | 53% | +4.13% | +3.74% | 86% | 24% | 7% | −0.65 [n/a] p n/a | insufficient | −3.4 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 328 | 3 | 59% | +2.89% | +3.90% | 76% | 34% | 1% | −1.89 [n/a] p n/a | insufficient | +7.0 [n/a] p n/a | insufficient |

### TT達成率 (% meeting the trend template) 21-session change — `d21.trendTemplatePercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -4.64 / -1.56 / 0.50 / 2.37, after the last session -3.24 / -0.76 / 1.34 / 3.13. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 157 | 13 | 40% | +0.44% | +0.48% | 58% | 1% | 0% | +0.09 [−0.40, +0.49] p 0.664 | unstable | +0.4 [−2.4, +3.0] p 0.807 | unstable |
| Q2 | 5 | 229 | 32 | 49% | +0.37% | +0.45% | 60% | 1% | 0% | +0.02 [−0.31, +0.31] p 0.890 | unstable | +0.4 [−1.8, +2.4] p 0.810 | unstable |
| Q3 | 5 | 206 | 34 | 48% | +0.16% | +0.22% | 52% | 1% | 0% | −0.19 [−0.37, +0.28] p 0.442 | unstable | +0.1 [−1.6, +2.4] p 0.975 | unstable |
| Q4 | 5 | 187 | 35 | 41% | +0.37% | +0.57% | 67% | 1% | 0% | +0.02 [−0.41, +0.35] p 0.967 | unstable | −0.4 [−2.3, +2.9] p 0.993 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 212 | 19 | 69% | +0.43% | +0.46% | 63% | 0% | 0% | +0.08 [−0.31, +0.44] p 0.825 | unstable | −0.4 [−2.4, +1.9] p 0.920 | unstable |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 157 | 10 | 40% | +0.90% | +1.12% | 65% | 6% | 2% | +0.20 [−0.68, +0.86] p 0.613 | unstable | +3.0 [−6.4, +6.5] p 0.496 | unstable |
| Q2 | 10 | 229 | 23 | 48% | +0.60% | +0.95% | 62% | 6% | 2% | −0.10 [−0.52, +0.52] p 0.865 | unstable | +2.3 [−4.8, +5.5] p 0.511 | weak |
| Q3 | 10 | 205 | 21 | 47% | +0.73% | +0.50% | 61% | 1% | 0% | +0.03 [−0.56, +0.46] p 0.723 | unstable | −2.4 [−4.0, +4.5] p 0.310 | weak |
| Q4 | 10 | 184 | 24 | 41% | +0.57% | +0.66% | 64% | 2% | 0% | −0.13 [−0.63, +0.60] p 0.763 | unstable | −1.2 [−5.8, +7.3] p 0.861 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 211 | 14 | 69% | +0.74% | +0.84% | 70% | 2% | 0% | +0.04 [−0.53, +0.78] p 0.996 | unstable | −1.5 [−6.2, +4.4] p 0.901 | unstable |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 153 | 10 | 41% | +1.72% | +1.76% | 69% | 19% | 9% | +0.22 [−1.21, +1.45] p 0.734 | weak | +7.2 [−11.6, +12.9] p 0.369 | unstable |
| Q2 | 21 | 222 | 10 | 50% | +1.66% | +1.67% | 66% | 15% | 2% | +0.17 [−0.89, +0.83] p 0.741 | unstable | +3.5 [−8.3, +9.9] p 0.566 | weak |
| Q3 | 21 | 205 | 14 | 45% | +1.28% | +1.37% | 65% | 6% | 0% | −0.22 [−1.08, +0.79] p 0.872 | weak | −5.9 [−5.8, +8.6] p 0.095 | weak |
| Q4 | 21 | 184 | 15 | 41% | +1.66% | +1.88% | 79% | 7% | 1% | +0.17 [−1.15, +1.14] p 0.807 | weak | −5.3 [−10.5, +12.6] p 0.449 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 211 | 14 | 69% | +1.23% | +1.95% | 69% | 13% | 0% | −0.27 [−0.96, +1.50] p 0.573 | unstable | +1.5 [−10.8, +8.5] p 0.602 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 132 | 6 | 48% | +6.02% | +7.70% | 80% | 48% | 23% | +1.30 [n/a] p n/a | insufficient | +20.8 [n/a] p n/a | insufficient |
| Q2 | 63 | 210 | 3 | 50% | +6.20% | +5.18% | 96% | 29% | 4% | +1.48 [n/a] p n/a | insufficient | +0.9 [n/a] p n/a | insufficient |
| Q3 | 63 | 197 | 1 | 43% | +4.17% | +4.25% | 90% | 19% | 2% | −0.56 [n/a] p n/a | insufficient | −8.9 [n/a] p n/a | insufficient |
| Q4 | 63 | 183 | 2 | 37% | +3.90% | +4.27% | 79% | 21% | 3% | −0.82 [n/a] p n/a | insufficient | −6.3 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 211 | 5 | 69% | +3.67% | +4.08% | 71% | 27% | 6% | −1.05 [n/a] p n/a | insufficient | −0.2 [n/a] p n/a | insufficient |

### 新高値−新安値 (net new highs, % of coverage) — `q.netHighsPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 -7.62 / -3.26 / -0.19 / 1.50, after the last session -2.52 / 0.03 / 1.72 / 3.54. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 90 | 13 | 34% | +0.30% | +0.44% | 53% | 4% | 1% | −0.08 [−0.53, +0.57] p 0.847 | unstable | +3.6 [−2.8, +4.4] p 0.193 | unstable |
| Q2 | 5 | 168 | 46 | 48% | +0.43% | +0.49% | 60% | 1% | 1% | +0.05 [−0.35, +0.35] p 0.964 | unstable | +0.3 [−1.8, +2.3] p 0.671 | unstable |
| Q3 | 5 | 197 | 55 | 47% | +0.93% | +1.04% | 66% | 0% | 0% | +0.55 [−0.28, +0.30] p 0.007 | **robust** | −0.9 [−1.8, +1.8] p 0.471 | weak |
| Q4 | 5 | 232 | 51 | 42% | +0.29% | +0.35% | 59% | 0% | 0% | −0.09 [−0.28, +0.24] p 0.566 | weak | −0.5 [−1.5, +1.8] p 0.759 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 325 | 37 | 63% | +0.12% | +0.27% | 59% | 1% | 0% | −0.27 [−0.28, +0.28] p 0.128 | weak | −0.3 [−1.8, +1.7] p 0.850 | unstable |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 88 | 12 | 35% | +1.18% | +1.16% | 67% | 9% | 3% | +0.43 [−0.95, +1.04] p 0.453 | weak | +5.8 [−7.0, +10.8] p 0.387 | unstable |
| Q2 | 10 | 165 | 23 | 49% | +0.70% | +1.06% | 61% | 7% | 3% | −0.05 [−0.54, +0.61] p 0.858 | unstable | +3.4 [−4.6, +4.8] p 0.223 | unstable |
| Q3 | 10 | 197 | 30 | 47% | +1.31% | +1.50% | 70% | 4% | 1% | +0.56 [−0.42, +0.47] p 0.073 | weak | +0.3 [−4.2, +3.9] p 0.774 | unstable |
| Q4 | 10 | 232 | 26 | 42% | +0.71% | +1.01% | 65% | 1% | 0% | −0.04 [−0.41, +0.40] p 0.865 | weak | −2.0 [−3.5, +3.3] p 0.423 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 325 | 16 | 62% | +0.35% | +0.57% | 62% | 1% | 0% | −0.40 [−0.45, +0.45] p 0.131 | weak | −2.0 [−4.0, +4.2] p 0.471 | unstable |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 81 | 10 | 38% | +2.43% | +2.35% | 68% | 16% | 7% | +0.85 [−1.84, +1.79] p 0.445 | weak | +4.5 [−14.7, +17.3] p 0.770 | unstable |
| Q2 | 21 | 161 | 14 | 50% | +2.17% | +1.88% | 71% | 18% | 6% | +0.59 [−0.91, +1.01] p 0.391 | weak | +6.5 [−7.5, +9.3] p 0.219 | unstable |
| Q3 | 21 | 197 | 7 | 46% | +1.93% | +2.06% | 71% | 12% | 3% | +0.35 [−0.57, +0.73] p 0.434 | insufficient | +0.1 [−6.5, +6.2] p 0.861 | insufficient |
| Q4 | 21 | 232 | 5 | 42% | +1.31% | +1.65% | 70% | 9% | 0% | −0.26 [−0.70, +0.69] p 0.529 | weak | −2.5 [−5.8, +5.5] p 0.533 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 325 | 7 | 61% | +1.04% | +1.57% | 70% | 9% | 0% | −0.53 [−0.79, +0.71] p 0.248 | weak | −2.6 [−7.5, +6.6] p 0.518 | unstable |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 64 | 7 | 48% | +9.88% | +10.51% | 91% | 31% | 19% | +5.10 [n/a] p n/a | insufficient | +4.1 [n/a] p n/a | insufficient |
| Q2 | 63 | 154 | 1 | 52% | +6.29% | +6.24% | 87% | 38% | 12% | +1.51 [n/a] p n/a | insufficient | +11.2 [n/a] p n/a | insufficient |
| Q3 | 63 | 187 | 1 | 48% | +5.19% | +5.39% | 84% | 25% | 7% | +0.42 [n/a] p n/a | insufficient | −2.0 [n/a] p n/a | insufficient |
| Q4 | 63 | 225 | 1 | 42% | +3.93% | +4.71% | 81% | 22% | 6% | −0.85 [n/a] p n/a | insufficient | −4.9 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 324 | 2 | 56% | +3.40% | +3.82% | 83% | 26% | 2% | −1.38 [n/a] p n/a | insufficient | −1.5 [n/a] p n/a | insufficient |

### 新高値−新安値 (net new highs, % of coverage) 21-session change — `d21.netHighsPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -7.50 / -3.07 / 1.49 / 7.02, after the last session -4.72 / -1.38 / 1.13 / 4.12. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 134 | 28 | 38% | +0.64% | +0.57% | 62% | 1% | 0% | +0.29 [−0.47, +0.44] p 0.266 | weak | −0.2 [−2.1, +3.6] p 0.872 | weak |
| Q2 | 5 | 227 | 46 | 54% | +0.24% | +0.40% | 56% | 0% | 0% | −0.10 [−0.29, +0.29] p 0.588 | weak | −0.5 [−1.5, +1.9] p 0.606 | weak |
| Q3 | 5 | 261 | 54 | 50% | +0.19% | +0.36% | 59% | 2% | 0% | −0.16 [−0.23, +0.22] p 0.204 | weak | +0.6 [−1.5, +1.4] p 0.453 | weak |
| Q4 | 5 | 244 | 46 | 48% | +0.36% | +0.33% | 61% | 0% | 0% | +0.01 [−0.26, +0.30] p 1.000 | unstable | −0.9 [−1.8, +1.9] p 0.500 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 125 | 27 | 58% | +0.56% | +0.74% | 66% | 2% | 1% | +0.21 [−0.44, +0.41] p 0.394 | unstable | +1.5 [−2.2, +3.2] p 0.438 | weak |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 134 | 23 | 38% | +1.17% | +1.42% | 71% | 5% | 0% | +0.47 [−0.68, +0.64] p 0.226 | unstable | +1.9 [−4.2, +5.7] p 0.745 | unstable |
| Q2 | 10 | 227 | 24 | 53% | +0.69% | +0.90% | 63% | 3% | 1% | −0.01 [−0.46, +0.40] p 0.975 | weak | −0.7 [−3.3, +4.3] p 0.631 | unstable |
| Q3 | 10 | 260 | 22 | 50% | +0.32% | +0.38% | 57% | 4% | 2% | −0.38 [−0.32, +0.34] p 0.058 | weak | +0.9 [−2.9, +2.3] p 0.471 | weak |
| Q4 | 10 | 243 | 22 | 49% | +0.62% | +0.66% | 66% | 2% | 1% | −0.08 [−0.41, +0.48] p 0.730 | weak | −1.3 [−3.8, +3.5] p 0.792 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 122 | 21 | 60% | +1.17% | +1.17% | 70% | 3% | 1% | +0.47 [−0.62, +0.62] p 0.256 | weak | −0.1 [−5.2, +6.4] p 0.934 | unstable |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 134 | 17 | 38% | +1.93% | +1.69% | 72% | 10% | 1% | +0.43 [−1.09, +0.93] p 0.387 | weak | −1.3 [−7.7, +9.8] p 0.661 | unstable |
| Q2 | 21 | 224 | 10 | 52% | +1.49% | +1.71% | 67% | 12% | 4% | −0.00 [−0.62, +0.55] p 0.978 | unstable | −0.2 [−4.6, +6.1] p 0.865 | unstable |
| Q3 | 21 | 253 | 6 | 51% | +0.99% | +1.23% | 63% | 17% | 3% | −0.51 [−0.53, +0.47] p 0.124 | weak | +5.6 [−4.5, +4.1] p 0.025 | **robust** |
| Q4 | 21 | 242 | 9 | 49% | +1.33% | +1.71% | 70% | 7% | 1% | −0.16 [−0.62, +0.68] p 0.708 | unstable | −4.4 [−6.5, +5.1] p 0.314 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 122 | 16 | 60% | +2.40% | +2.83% | 84% | 11% | 1% | +0.91 [−0.89, +1.07] p 0.135 | weak | −1.1 [−8.7, +9.7] p 0.832 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 119 | 3 | 42% | +6.01% | +5.82% | 83% | 36% | 8% | +1.29 [n/a] p n/a | insufficient | +8.5 [n/a] p n/a | insufficient |
| Q2 | 63 | 211 | 1 | 53% | +4.65% | +4.70% | 87% | 28% | 9% | −0.07 [n/a] p n/a | insufficient | +0.8 [n/a] p n/a | insufficient |
| Q3 | 63 | 244 | 1 | 49% | +4.78% | +4.68% | 84% | 30% | 6% | +0.06 [n/a] p n/a | insufficient | +2.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 237 | 1 | 47% | +3.69% | +4.17% | 79% | 24% | 6% | −1.03 [n/a] p n/a | insufficient | −3.6 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 122 | 3 | 60% | +5.46% | +5.34% | 85% | 20% | 4% | +0.74 [n/a] p n/a | insufficient | −8.0 [n/a] p n/a | insufficient |

### 10日騰落比 (10-session 4% up/down ratio) — `q.ratio_10day`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-27 0.55 / 0.77 / 1.07 / 1.43, after the last session 0.71 / 0.92 / 1.17 / 1.49. Outcome: ^GSPC (long-history sp500 closes). Judged 1008 sessions (2022-10-27 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1003 | | split 2024-11-01, embargo 5 | +0.36% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 132 | 23 | 51% | +0.46% | +0.43% | 57% | 2% | 0% | +0.10 [−0.48, +0.56] p 0.814 | unstable | +0.6 [−2.4, +3.7] p 0.620 | unstable |
| Q2 | 5 | 229 | 40 | 40% | +0.19% | +0.45% | 55% | 1% | 1% | −0.17 [−0.39, +0.30] p 0.434 | weak | +0.4 [−1.8, +2.7] p 0.872 | unstable |
| Q3 | 5 | 228 | 49 | 52% | +0.43% | +0.46% | 63% | 1% | 0% | +0.06 [−0.33, +0.29] p 0.745 | unstable | −0.0 [−1.8, +2.2] p 0.989 | unstable |
| Q4 | 5 | 207 | 52 | 52% | +0.52% | +0.59% | 66% | 1% | 0% | +0.16 [−0.29, +0.36] p 0.409 | weak | +0.1 [−1.8, +2.0] p 0.796 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 207 | 28 | 56% | +0.25% | +0.27% | 57% | 0% | 0% | −0.11 [−0.37, +0.42] p 0.580 | weak | −0.9 [−2.4, +2.2] p 0.686 | weak |
| baseline | 10 | 998 | | split 2024-11-06, embargo 10 | +0.74% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 129 | 19 | 52% | +1.25% | +1.48% | 67% | 9% | 1% | +0.51 [−0.86, +0.93] p 0.442 | unstable | +5.2 [−6.1, +6.9] p 0.182 | unstable |
| Q2 | 10 | 227 | 27 | 41% | +0.53% | +0.68% | 59% | 4% | 2% | −0.21 [−0.67, +0.47] p 0.551 | weak | +0.7 [−4.1, +6.4] p 0.927 | unstable |
| Q3 | 10 | 228 | 35 | 52% | +0.59% | +0.89% | 63% | 2% | 0% | −0.15 [−0.53, +0.53] p 0.737 | unstable | −1.6 [−3.3, +4.4] p 0.449 | unstable |
| Q4 | 10 | 207 | 31 | 51% | +0.74% | +0.84% | 65% | 2% | 1% | +0.00 [−0.48, +0.58] p 0.956 | unstable | −0.9 [−4.1, +3.7] p 0.792 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 207 | 24 | 56% | +0.81% | +0.70% | 71% | 2% | 0% | +0.07 [−0.64, +0.70] p 0.996 | unstable | −1.4 [−6.3, +5.0] p 0.876 | unstable |
| baseline | 21 | 987 | | split 2024-11-13, embargo 21 | +1.53% | +1.74% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 124 | 15 | 54% | +2.75% | +2.90% | 78% | 16% | 6% | +1.23 [−1.39, +1.50] p 0.161 | weak | +4.5 [−12.5, +10.9] p 0.496 | unstable |
| Q2 | 21 | 221 | 13 | 42% | +1.18% | +1.09% | 62% | 13% | 3% | −0.35 [−0.96, +0.76] p 0.584 | weak | +1.5 [−6.0, +10.3] p 0.931 | unstable |
| Q3 | 21 | 228 | 5 | 52% | +0.96% | +1.25% | 65% | 16% | 1% | −0.57 [−0.84, +0.88] p 0.318 | weak | +4.1 [−6.2, +7.7] p 0.394 | weak |
| Q4 | 21 | 207 | 10 | 48% | +1.48% | +1.59% | 72% | 7% | 1% | −0.05 [−0.80, +0.88] p 0.993 | unstable | −4.9 [−6.9, +6.5] p 0.296 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 207 | 14 | 56% | +1.84% | +2.40% | 76% | 8% | 0% | +0.31 [−0.94, +1.06] p 0.657 | unstable | −3.9 [−9.9, +7.5] p 0.580 | unstable |
| baseline | 63 | 945 | | split 2024-12-13, embargo 63 | +4.75% | +4.68% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 120 | 6 | 56% | +8.05% | +9.60% | 88% | 34% | 13% | +3.29 [n/a] p n/a | insufficient | +6.8 [n/a] p n/a | insufficient |
| Q2 | 63 | 200 | 1 | 46% | +4.88% | +4.85% | 88% | 35% | 7% | +0.13 [n/a] p n/a | insufficient | +7.6 [n/a] p n/a | insufficient |
| Q3 | 63 | 219 | 1 | 52% | +3.34% | +4.08% | 76% | 30% | 9% | −1.42 [n/a] p n/a | insufficient | +2.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 203 | 1 | 44% | +4.12% | +4.27% | 86% | 19% | 5% | −0.64 [n/a] p n/a | insufficient | −8.7 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 203 | 2 | 54% | +4.85% | +4.78% | 83% | 22% | 2% | +0.09 [n/a] p n/a | insufficient | −5.7 [n/a] p n/a | insufficient |

### 10日騰落比 (10-session 4% up/down ratio) 21-session change — `d21.ratio_10day`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-28 -0.64 / -0.20 / 0.22 / 0.71, after the last session -0.56 / -0.19 / 0.11 / 0.54. Outcome: ^GSPC (long-history sp500 closes). Judged 987 sessions (2022-11-28 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 982 | | split 2024-11-18, embargo 5 | +0.34% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 165 | 27 | 52% | +0.48% | +0.68% | 68% | 0% | 0% | +0.14 [−0.41, +0.49] p 0.584 | weak | −0.9 [−2.4, +2.5] p 0.712 | weak |
| Q2 | 5 | 222 | 46 | 46% | +0.48% | +0.56% | 62% | 0% | 0% | +0.13 [−0.31, +0.31] p 0.485 | weak | −0.5 [−2.0, +2.2] p 0.664 | unstable |
| Q3 | 5 | 231 | 45 | 52% | +0.16% | +0.13% | 54% | 1% | 0% | −0.19 [−0.28, +0.31] p 0.336 | weak | −0.1 [−1.6, +2.3] p 0.909 | unstable |
| Q4 | 5 | 217 | 49 | 49% | +0.31% | +0.36% | 60% | 2% | 1% | −0.03 [−0.35, +0.32] p 0.880 | unstable | +1.4 [−1.7, +2.4] p 0.314 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 147 | 22 | 54% | +0.33% | +0.27% | 56% | 1% | 0% | −0.01 [−0.40, +0.56] p 0.971 | unstable | −0.2 [−2.7, +3.1] p 0.901 | unstable |
| baseline | 10 | 977 | | split 2024-11-20, embargo 10 | +0.70% | +0.87% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 165 | 23 | 52% | +0.79% | +1.10% | 67% | 3% | 0% | +0.09 [−0.68, +0.83] p 0.909 | unstable | −0.3 [−6.1, +4.5] p 0.934 | unstable |
| Q2 | 10 | 222 | 33 | 46% | +0.94% | +1.18% | 67% | 2% | 0% | +0.23 [−0.51, +0.53] p 0.420 | weak | −1.6 [−3.6, +4.1] p 0.434 | weak |
| Q3 | 10 | 227 | 32 | 53% | +0.26% | +0.51% | 55% | 5% | 0% | −0.44 [−0.49, +0.49] p 0.150 | weak | +1.5 [−3.2, +4.8] p 0.544 | weak |
| Q4 | 10 | 216 | 33 | 49% | +0.84% | +0.69% | 66% | 4% | 2% | +0.14 [−0.53, +0.49] p 0.580 | weak | +0.3 [−3.2, +3.8] p 1.000 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 147 | 22 | 52% | +0.74% | +0.70% | 70% | 3% | 2% | +0.03 [−0.67, +0.99] p 0.901 | unstable | +0.0 [−7.3, +5.7] p 0.810 | unstable |
| baseline | 21 | 966 | | split 2024-11-29, embargo 21 | +1.54% | +1.74% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 165 | 18 | 52% | +1.13% | +1.70% | 67% | 10% | 1% | −0.40 [−1.08, +1.05] p 0.511 | unstable | −1.4 [−8.7, +8.8] p 0.927 | weak |
| Q2 | 21 | 221 | 12 | 43% | +1.57% | +1.67% | 71% | 10% | 3% | +0.04 [−0.77, +0.76] p 0.854 | unstable | −1.3 [−6.8, +6.0] p 0.628 | unstable |
| Q3 | 21 | 219 | 10 | 55% | +1.34% | +1.35% | 65% | 19% | 2% | −0.20 [−0.83, +0.75] p 0.686 | weak | +7.0 [−5.9, +7.8] p 0.146 | weak |
| Q4 | 21 | 214 | 12 | 49% | +1.62% | +1.44% | 72% | 9% | 2% | +0.09 [−0.77, +0.65] p 0.759 | unstable | −2.8 [−4.3, +5.8] p 0.303 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 147 | 16 | 52% | +2.11% | +2.72% | 76% | 9% | 2% | +0.57 [−1.04, +1.43] p 0.387 | weak | −2.9 [−12.9, +8.3] p 0.620 | unstable |
| baseline | 63 | 924 | | split 2024-12-31, embargo 63 | +4.76% | +4.68% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 158 | 1 | 52% | +4.32% | +4.08% | 84% | 32% | 7% | −0.44 [n/a] p n/a | insufficient | +4.8 [n/a] p n/a | insufficient |
| Q2 | 63 | 209 | 1 | 43% | +4.08% | +4.25% | 77% | 30% | 7% | −0.68 [n/a] p n/a | insufficient | +2.2 [n/a] p n/a | insufficient |
| Q3 | 63 | 212 | 1 | 55% | +5.48% | +4.95% | 85% | 30% | 6% | +0.72 [n/a] p n/a | insufficient | +2.2 [n/a] p n/a | insufficient |
| Q4 | 63 | 203 | 1 | 48% | +4.60% | +4.71% | 86% | 25% | 8% | −0.15 [n/a] p n/a | insufficient | −2.9 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 142 | 3 | 54% | +5.39% | +5.46% | 87% | 20% | 6% | +0.63 [n/a] p n/a | insufficient | −7.8 [n/a] p n/a | insufficient |

### 先導株数 (price-template leaders, % of coverage) — `q.leaderPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 4.54 / 6.99 / 10.2 / 14.7, after the last session 9.21 / 13.1 / 16.1 / 18.8. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 28 | 5 | 36% | +2.24% | +2.80% | 71% | 4% | 0% | +1.86 [−1.28, +1.19] p 0.025 | insufficient | +2.7 [−3.0, +8.3] p 0.329 | insufficient |
| Q2 | 5 | 115 | 14 | 31% | +0.22% | +0.48% | 56% | 4% | 2% | −0.16 [−0.58, +0.53] p 0.591 | unstable | +3.5 [−2.4, +4.2] p 0.139 | unstable |
| Q3 | 5 | 239 | 22 | 34% | +0.51% | +0.59% | 62% | 0% | 0% | +0.12 [−0.34, +0.30] p 0.635 | weak | −0.5 [−2.0, +2.6] p 0.942 | unstable |
| Q4 | 5 | 304 | 21 | 52% | +0.51% | +0.53% | 63% | 0% | 0% | +0.13 [−0.28, +0.26] p 0.394 | unstable | −0.9 [−1.5, +2.2] p 0.445 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 326 | 10 | 67% | +0.07% | +0.22% | 56% | 1% | 0% | −0.31 [−0.28, +0.27] p 0.088 | weak | −0.3 [−2.1, +2.0] p 0.836 | unstable |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 28 | 5 | 36% | +4.44% | +4.06% | 96% | 7% | 0% | +3.69 [−2.17, +2.04] p 0.004 | insufficient | +3.9 [−9.3, +22.9] p 0.404 | insufficient |
| Q2 | 10 | 114 | 12 | 32% | +0.47% | +0.75% | 61% | 11% | 8% | −0.28 [−1.00, +0.97] p 0.558 | unstable | +7.2 [−6.7, +8.5] p 0.179 | weak |
| Q3 | 10 | 235 | 17 | 35% | +1.02% | +1.27% | 72% | 4% | 0% | +0.27 [−0.58, +0.53] p 0.507 | weak | +1.0 [−5.0, +6.6] p 0.584 | unstable |
| Q4 | 10 | 304 | 17 | 52% | +0.93% | +0.95% | 64% | 2% | 0% | +0.18 [−0.46, +0.44] p 0.507 | unstable | −1.6 [−4.3, +4.8] p 0.599 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 326 | 8 | 67% | +0.17% | +0.43% | 58% | 1% | 0% | −0.58 [−0.58, +0.53] p 0.110 | weak | −2.1 [−5.3, +5.7] p 0.661 | weak |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 28 | 3 | 36% | +7.22% | +9.11% | 86% | 21% | 11% | +5.64 [−3.31, +3.54] p 0.011 | insufficient | +9.9 [−20.8, +33.4] p 0.418 | insufficient |
| Q2 | 21 | 103 | 11 | 35% | +2.04% | +2.55% | 67% | 20% | 16% | +0.46 [−1.69, +1.81] p 0.755 | weak | +8.8 [−13.5, +16.5] p 0.398 | unstable |
| Q3 | 21 | 235 | 12 | 35% | +2.44% | +2.43% | 83% | 9% | 0% | +0.86 [−1.01, +0.97] p 0.175 | weak | −2.2 [−8.5, +11.0] p 0.898 | unstable |
| Q4 | 21 | 304 | 9 | 52% | +1.02% | +1.05% | 66% | 10% | 0% | −0.56 [−0.76, +0.79] p 0.358 | weak | −1.3 [−8.1, +8.0] p 0.832 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 326 | 6 | 65% | +0.85% | +1.33% | 64% | 11% | 0% | −0.73 [−1.13, +0.95] p 0.296 | weak | −0.8 [−11.0, +11.3] p 0.825 | unstable |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 28 | 3 | 36% | +16.43% | +16.55% | 100% | 21% | 11% | +11.65 [n/a] p n/a | insufficient | −5.7 [n/a] p n/a | insufficient |
| Q2 | 63 | 89 | 6 | 40% | +8.94% | +9.85% | 97% | 29% | 25% | +4.16 [n/a] p n/a | insufficient | +2.1 [n/a] p n/a | insufficient |
| Q3 | 63 | 216 | 5 | 38% | +5.28% | +5.95% | 85% | 24% | 7% | +0.50 [n/a] p n/a | insufficient | −3.5 [n/a] p n/a | insufficient |
| Q4 | 63 | 295 | 3 | 52% | +4.16% | +3.81% | 86% | 22% | 7% | −0.62 [n/a] p n/a | insufficient | −5.5 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 326 | 3 | 60% | +2.87% | +3.88% | 76% | 34% | 1% | −1.91 [n/a] p n/a | insufficient | +7.2 [n/a] p n/a | insufficient |

### 先導株数 (price-template leaders, % of coverage) 21-session change — `d21.leaderPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -4.71 / -1.62 / 0.53 / 2.51, after the last session -3.20 / -0.71 / 1.33 / 3.12. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 154 | 13 | 41% | +0.40% | +0.41% | 57% | 1% | 0% | +0.05 [−0.41, +0.47] p 0.785 | unstable | +0.4 [−2.4, +3.1] p 0.763 | unstable |
| Q2 | 5 | 232 | 32 | 48% | +0.37% | +0.47% | 59% | 1% | 0% | +0.02 [−0.34, +0.32] p 0.854 | unstable | +0.4 [−2.0, +2.6] p 0.861 | unstable |
| Q3 | 5 | 214 | 35 | 48% | +0.23% | +0.33% | 55% | 0% | 0% | −0.12 [−0.36, +0.26] p 0.602 | unstable | −0.4 [−1.5, +2.3] p 0.704 | weak |
| Q4 | 5 | 194 | 32 | 44% | +0.31% | +0.47% | 66% | 2% | 0% | −0.04 [−0.39, +0.34] p 0.847 | unstable | +0.6 [−2.3, +2.6] p 0.474 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 197 | 17 | 67% | +0.46% | +0.51% | 63% | 0% | 0% | +0.11 [−0.30, +0.42] p 0.712 | unstable | −0.9 [−2.3, +2.2] p 0.748 | weak |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 154 | 9 | 41% | +0.89% | +1.13% | 64% | 6% | 2% | +0.19 [−0.72, +0.83] p 0.682 | unstable | +3.1 [−6.4, +6.8] p 0.489 | unstable |
| Q2 | 10 | 232 | 23 | 47% | +0.56% | +0.98% | 62% | 6% | 2% | −0.14 [−0.61, +0.58] p 0.777 | unstable | +2.3 [−5.0, +5.8] p 0.562 | weak |
| Q3 | 10 | 213 | 19 | 48% | +0.87% | +0.64% | 64% | 0% | 0% | +0.17 [−0.57, +0.50] p 0.467 | weak | −2.9 [−3.6, +4.1] p 0.172 | weak |
| Q4 | 10 | 191 | 25 | 45% | +0.48% | +0.63% | 63% | 4% | 0% | −0.22 [−0.58, +0.62] p 0.569 | unstable | +0.3 [−5.9, +6.2] p 0.693 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 196 | 13 | 67% | +0.76% | +0.82% | 69% | 1% | 0% | +0.06 [−0.55, +0.80] p 0.971 | unstable | −2.3 [−6.0, +4.5] p 0.650 | weak |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 150 | 9 | 42% | +1.76% | +1.73% | 69% | 19% | 9% | +0.27 [−1.32, +1.43] p 0.774 | weak | +7.5 [−11.4, +12.5] p 0.365 | unstable |
| Q2 | 21 | 225 | 11 | 48% | +1.54% | +1.53% | 64% | 15% | 2% | +0.04 [−0.98, +0.85] p 0.854 | unstable | +3.3 [−8.7, +10.5] p 0.646 | weak |
| Q3 | 21 | 213 | 13 | 46% | +1.50% | +1.68% | 69% | 5% | 0% | −0.00 [−0.90, +0.83] p 0.763 | unstable | −6.6 [−5.6, +7.1] p 0.058 | weak |
| Q4 | 21 | 191 | 16 | 45% | +1.66% | +1.82% | 80% | 8% | 1% | +0.16 [−1.06, +1.14] p 0.770 | weak | −3.9 [−10.2, +12.0] p 0.577 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 196 | 13 | 67% | +1.09% | +1.71% | 66% | 13% | 0% | −0.41 [−0.99, +1.62] p 0.471 | unstable | +1.5 [−11.8, +9.0] p 0.657 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 132 | 5 | 48% | +6.13% | +7.97% | 80% | 48% | 23% | +1.40 [n/a] p n/a | insufficient | +20.8 [n/a] p n/a | insufficient |
| Q2 | 63 | 209 | 2 | 48% | +6.04% | +5.19% | 95% | 29% | 4% | +1.32 [n/a] p n/a | insufficient | +1.5 [n/a] p n/a | insufficient |
| Q3 | 63 | 206 | 1 | 44% | +4.36% | +4.41% | 92% | 17% | 2% | −0.36 [n/a] p n/a | insufficient | −10.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 190 | 2 | 42% | +3.93% | +4.10% | 79% | 22% | 3% | −0.79 [n/a] p n/a | insufficient | −6.1 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 196 | 5 | 67% | +3.51% | +4.07% | 68% | 29% | 7% | −1.21 [n/a] p n/a | insufficient | +1.4 [n/a] p n/a | insufficient |

### リーダーの健全度 (% of the cohort above its 50-day) — `q.leaderHealthPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-19 35.1 / 51.1 / 67.6 / 77.9, after the last session 49.0 / 63.8 / 72.1 / 79.1. Outcome: ^GSPC (long-history sp500 closes). Judged 1014 sessions (2022-10-19 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1009 | | split 2024-10-29, embargo 5 | +0.37% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 126 | 14 | 34% | +0.63% | +0.64% | 61% | 2% | 0% | +0.25 [−0.54, +0.53] p 0.460 | unstable | +1.5 [−2.4, +3.6] p 0.522 | unstable |
| Q2 | 5 | 186 | 28 | 48% | +0.22% | +0.30% | 54% | 2% | 1% | −0.15 [−0.41, +0.38] p 0.595 | unstable | +0.7 [−1.9, +3.0] p 0.668 | unstable |
| Q3 | 5 | 270 | 38 | 47% | +0.30% | +0.50% | 59% | 1% | 0% | −0.07 [−0.29, +0.30] p 0.737 | unstable | −0.2 [−1.5, +1.9] p 1.000 | unstable |
| Q4 | 5 | 216 | 39 | 53% | +0.46% | +0.50% | 63% | 0% | 0% | +0.08 [−0.34, +0.33] p 0.642 | weak | −0.4 [−1.8, +2.2] p 0.847 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 211 | 18 | 61% | +0.36% | +0.34% | 63% | 0% | 0% | −0.01 [−0.33, +0.41] p 0.978 | unstable | −0.9 [−2.5, +2.3] p 0.682 | weak |
| baseline | 10 | 1004 | | split 2024-11-01, embargo 10 | +0.73% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 126 | 13 | 34% | +1.41% | +1.79% | 67% | 10% | 2% | +0.68 [−0.97, +0.96] p 0.256 | unstable | +6.2 [−6.8, +7.3] p 0.215 | unstable |
| Q2 | 10 | 181 | 21 | 49% | +0.51% | +0.88% | 61% | 6% | 3% | −0.22 [−0.72, +0.65] p 0.617 | unstable | +2.2 [−4.5, +6.9] p 0.544 | unstable |
| Q3 | 10 | 270 | 24 | 47% | +0.58% | +0.68% | 60% | 3% | 0% | −0.15 [−0.45, +0.48] p 0.679 | weak | −0.7 [−3.4, +3.6] p 0.752 | unstable |
| Q4 | 10 | 216 | 18 | 53% | +0.74% | +1.03% | 69% | 1% | 0% | +0.00 [−0.51, +0.45] p 0.978 | unstable | −1.9 [−3.9, +4.5] p 0.540 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 211 | 13 | 60% | +0.71% | +0.62% | 67% | 0% | 0% | −0.03 [−0.58, +0.66] p 0.975 | unstable | −2.8 [−6.4, +4.2] p 0.515 | weak |
| baseline | 21 | 993 | | split 2024-11-08, embargo 21 | +1.55% | +1.76% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 116 | 10 | 37% | +2.52% | +2.44% | 69% | 21% | 11% | +0.96 [−1.53, +1.61] p 0.274 | weak | +9.1 [−12.9, +14.6] p 0.336 | unstable |
| Q2 | 21 | 180 | 12 | 49% | +2.03% | +1.82% | 74% | 15% | 3% | +0.47 [−1.23, +1.09] p 0.533 | weak | +3.4 [−7.9, +12.0] p 0.610 | weak |
| Q3 | 21 | 270 | 12 | 47% | +0.96% | +1.16% | 64% | 11% | 0% | −0.60 [−0.70, +0.72] p 0.164 | weak | −0.1 [−6.4, +5.9] p 0.887 | unstable |
| Q4 | 21 | 216 | 13 | 53% | +1.58% | +1.68% | 75% | 8% | 0% | +0.03 [−0.78, +0.77] p 0.971 | unstable | −3.7 [−5.9, +7.2] p 0.467 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 211 | 11 | 58% | +1.36% | +2.09% | 70% | 8% | 0% | −0.20 [−1.02, +1.22] p 0.814 | unstable | −4.0 [−11.7, +7.8] p 0.642 | unstable |
| baseline | 63 | 951 | | split 2024-12-10, embargo 63 | +4.77% | +4.70% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 107 | 7 | 40% | +7.77% | +9.97% | 83% | 44% | 26% | +3.00 [n/a] p n/a | insufficient | +16.7 [n/a] p n/a | insufficient |
| Q2 | 63 | 159 | 3 | 56% | +5.59% | +5.46% | 91% | 31% | 8% | +0.82 [n/a] p n/a | insufficient | +4.2 [n/a] p n/a | insufficient |
| Q3 | 63 | 259 | 1 | 49% | +4.16% | +4.45% | 85% | 24% | 7% | −0.61 [n/a] p n/a | insufficient | −3.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 215 | 3 | 49% | +4.58% | +4.79% | 87% | 18% | 1% | −0.19 [n/a] p n/a | insufficient | −9.1 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 211 | 5 | 53% | +3.57% | +3.81% | 74% | 29% | 1% | −1.20 [n/a] p n/a | insufficient | +2.1 [n/a] p n/a | insufficient |

### リーダーの健全度 (% of the cohort above its 50-day) 21-session change — `d21.leaderHealthPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-17 -36.0 / -11.6 / 7.85 / 35.4, after the last session -18.5 / -6.43 / 4.81 / 17.9. Outcome: ^GSPC (long-history sp500 closes). Judged 993 sessions (2022-11-17 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 988 | | split 2024-11-13, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 105 | 17 | 36% | +0.55% | +0.66% | 64% | 0% | 0% | +0.20 [−0.57, +0.66] p 0.573 | unstable | −0.9 [−2.9, +4.9] p 0.894 | weak |
| Q2 | 5 | 266 | 29 | 47% | +0.47% | +0.52% | 61% | 0% | 0% | +0.12 [−0.37, +0.33] p 0.507 | unstable | −0.5 [−1.9, +2.4] p 0.624 | unstable |
| Q3 | 5 | 277 | 40 | 54% | +0.11% | +0.29% | 56% | 1% | 0% | −0.24 [−0.30, +0.25] p 0.168 | weak | +0.2 [−1.3, +1.6] p 0.788 | unstable |
| Q4 | 5 | 218 | 40 | 59% | +0.26% | +0.42% | 61% | 2% | 0% | −0.09 [−0.27, +0.36] p 0.620 | weak | +0.9 [−2.0, +1.7] p 0.369 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 122 | 15 | 43% | +0.61% | +0.53% | 64% | 1% | 1% | +0.26 [−0.59, +0.59] p 0.412 | unstable | −0.1 [−2.8, +3.9] p 0.931 | unstable |
| baseline | 10 | 983 | | split 2024-11-15, embargo 10 | +0.70% | +0.85% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 105 | 16 | 36% | +1.27% | +1.86% | 67% | 7% | 0% | +0.58 [−1.12, +1.27] p 0.391 | unstable | +3.3 [−7.7, +9.2] p 0.631 | unstable |
| Q2 | 10 | 266 | 23 | 47% | +0.79% | +1.13% | 67% | 2% | 0% | +0.10 [−0.64, +0.52] p 0.810 | unstable | −1.1 [−4.2, +5.6] p 0.679 | weak |
| Q3 | 10 | 276 | 24 | 53% | +0.20% | +0.21% | 55% | 3% | 2% | −0.50 [−0.40, +0.33] p 0.058 | weak | −0.1 [−2.6, +2.8] p 0.971 | weak |
| Q4 | 10 | 214 | 25 | 60% | +0.61% | +0.85% | 64% | 5% | 1% | −0.09 [−0.44, +0.56] p 0.668 | unstable | +1.3 [−4.1, +3.8] p 0.343 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 122 | 14 | 43% | +1.28% | +1.23% | 76% | 1% | 1% | +0.58 [−1.09, +1.03] p 0.339 | weak | −2.5 [−7.5, +7.9] p 0.610 | weak |
| baseline | 21 | 972 | | split 2024-11-25, embargo 21 | +1.50% | +1.71% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 103 | 14 | 37% | +2.12% | +2.87% | 75% | 19% | 10% | +0.61 [−1.92, +1.95] p 0.668 | weak | +7.6 [−16.0, +15.0] p 0.595 | unstable |
| Q2 | 21 | 257 | 13 | 47% | +1.48% | +1.74% | 68% | 8% | 0% | −0.03 [−1.19, +0.86] p 0.978 | unstable | −3.7 [−6.9, +10.6] p 0.507 | weak |
| Q3 | 21 | 276 | 13 | 53% | +1.21% | +1.29% | 68% | 12% | 2% | −0.30 [−0.47, +0.49] p 0.402 | weak | −0.2 [−4.5, +4.3] p 0.975 | unstable |
| Q4 | 21 | 214 | 13 | 60% | +1.34% | +1.48% | 66% | 14% | 1% | −0.16 [−0.76, +0.80] p 0.657 | unstable | +1.7 [−8.0, +5.6] p 0.449 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 122 | 13 | 43% | +2.00% | +2.94% | 79% | 11% | 1% | +0.50 [−1.87, +1.82] p 0.628 | weak | −1.2 [−13.6, +12.7] p 0.901 | weak |
| baseline | 63 | 930 | | split 2024-12-26, embargo 63 | +4.73% | +4.65% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 101 | 7 | 38% | +4.19% | +5.56% | 75% | 52% | 27% | −0.54 [n/a] p n/a | insufficient | +24.8 [n/a] p n/a | insufficient |
| Q2 | 63 | 237 | 1 | 49% | +4.93% | +4.25% | 92% | 20% | 2% | +0.20 [n/a] p n/a | insufficient | −7.8 [n/a] p n/a | insufficient |
| Q3 | 63 | 261 | 1 | 50% | +4.97% | +4.73% | 89% | 25% | 3% | +0.25 [n/a] p n/a | insufficient | −2.3 [n/a] p n/a | insufficient |
| Q4 | 63 | 209 | 1 | 61% | +4.62% | +4.47% | 78% | 30% | 4% | −0.11 [n/a] p n/a | insufficient | +2.0 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 122 | 5 | 43% | +4.44% | +5.82% | 69% | 24% | 12% | −0.29 [n/a] p n/a | insufficient | −3.9 [n/a] p n/a | insufficient |

### ブレイクアウト成功率 (breakout hold %) — `q.breakoutHoldPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-01 33.3 / 46.7 / 55.1 / 65.7, after the last session 48.0 / 57.6 / 63.8 / 68.7. Outcome: ^GSPC (long-history sp500 closes). Judged 1005 sessions (2022-11-01 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1000 | | split 2024-11-05, embargo 5 | +0.37% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 127 | 10 | 7% | +0.43% | +0.56% | 61% | 3% | 1% | +0.06 [−0.54, +0.54] p 0.777 | insufficient | +2.2 [−3.0, +4.3] p 0.453 | insufficient |
| Q2 | 5 | 187 | 22 | 35% | +0.45% | +0.53% | 61% | 1% | 1% | +0.08 [−0.45, +0.40] p 0.693 | unstable | +0.2 [−1.8, +3.5] p 0.890 | unstable |
| Q3 | 5 | 265 | 26 | 48% | +0.44% | +0.50% | 58% | 0% | 0% | +0.07 [−0.32, +0.29] p 0.719 | unstable | −0.9 [−1.9, +2.0] p 0.533 | weak |
| Q4 | 5 | 219 | 24 | 51% | +0.08% | +0.18% | 56% | 0% | 0% | −0.29 [−0.35, +0.41] p 0.168 | weak | −0.4 [−2.1, +2.4] p 0.796 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 202 | 11 | 92% | +0.48% | +0.52% | 65% | 1% | 0% | +0.11 [−0.39, +0.51] p 0.785 | insufficient | +0.1 [−2.8, +2.4] p 0.763 | insufficient |
| baseline | 10 | 995 | | split 2024-11-07, embargo 10 | +0.73% | +0.88% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 125 | 8 | 7% | +1.04% | +0.72% | 61% | 9% | 6% | +0.31 [−0.92, +0.95] p 0.555 | insufficient | +5.5 [−7.6, +11.9] p 0.467 | insufficient |
| Q2 | 10 | 184 | 18 | 36% | +0.65% | +0.95% | 64% | 7% | 1% | −0.08 [−0.74, +0.64] p 0.953 | unstable | +3.2 [−4.4, +6.6] p 0.485 | weak |
| Q3 | 10 | 265 | 22 | 48% | +0.90% | +1.12% | 70% | 1% | 0% | +0.17 [−0.58, +0.45] p 0.613 | unstable | −2.2 [−4.0, +4.3] p 0.482 | weak |
| Q4 | 10 | 219 | 20 | 51% | +0.11% | +0.26% | 54% | 2% | 0% | −0.63 [−0.60, +0.72] p 0.080 | weak | −1.5 [−4.4, +5.3] p 0.686 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 202 | 11 | 90% | +1.07% | +1.31% | 71% | 1% | 0% | +0.34 [−0.77, +0.94] p 0.595 | insufficient | −1.8 [−7.5, +5.8] p 0.938 | insufficient |
| baseline | 21 | 984 | | split 2024-11-15, embargo 21 | +1.52% | +1.73% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 121 | 7 | 7% | +1.45% | +0.95% | 62% | 23% | 15% | −0.07 [−1.63, +1.58] p 0.996 | insufficient | +11.5 [−16.4, +19.3] p 0.343 | insufficient |
| Q2 | 21 | 177 | 14 | 37% | +2.08% | +1.88% | 76% | 12% | 1% | +0.56 [−1.12, +1.13] p 0.336 | unstable | +0.2 [−6.9, +10.2] p 0.869 | unstable |
| Q3 | 21 | 265 | 13 | 48% | +1.32% | +1.90% | 68% | 11% | 0% | −0.20 [−1.10, +0.77] p 0.661 | unstable | −0.4 [−8.5, +8.1] p 0.971 | unstable |
| Q4 | 21 | 219 | 14 | 51% | +0.87% | +0.64% | 61% | 12% | 0% | −0.65 [−0.92, +1.22] p 0.296 | weak | +0.2 [−8.3, +9.2] p 0.975 | unstable |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 202 | 10 | 88% | +2.04% | +2.82% | 80% | 5% | 0% | +0.52 [−1.36, +1.56] p 0.741 | insufficient | −6.7 [−13.9, +9.8] p 0.467 | insufficient |
| baseline | 63 | 942 | | split 2024-12-17, embargo 63 | +4.75% | +4.66% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 116 | 5 | 8% | +5.38% | +5.54% | 80% | 39% | 36% | +0.63 [n/a] p n/a | insufficient | +11.3 [n/a] p n/a | insufficient |
| Q2 | 63 | 165 | 4 | 40% | +5.45% | +5.63% | 81% | 18% | 12% | +0.69 [n/a] p n/a | insufficient | −9.9 [n/a] p n/a | insufficient |
| Q3 | 63 | 255 | 3 | 49% | +4.93% | +4.54% | 90% | 32% | 0% | +0.17 [n/a] p n/a | insufficient | +4.3 [n/a] p n/a | insufficient |
| Q4 | 63 | 204 | 3 | 51% | +3.40% | +4.07% | 75% | 39% | 0% | −1.35 [n/a] p n/a | insufficient | +11.7 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 202 | 4 | 83% | +4.97% | +4.57% | 88% | 12% | 0% | +0.22 [n/a] p n/a | insufficient | −15.6 [n/a] p n/a | insufficient |

### ブレイクアウト成功率 (breakout hold %) 21-session change — `d21.breakoutHoldPercent`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-12-01 -22.5 / -10.6 / 5.27 / 21.1, after the last session -13.1 / -4.90 / 3.08 / 12.8. Outcome: ^GSPC (long-history sp500 closes). Judged 984 sessions (2022-12-01 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 979 | | split 2024-11-19, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 117 | 12 | 33% | +0.73% | +0.64% | 62% | 0% | 0% | +0.38 [−0.62, +0.62] p 0.288 | weak | −0.9 [−2.9, +4.3] p 0.661 | weak |
| Q2 | 5 | 195 | 30 | 53% | +0.34% | +0.50% | 58% | 2% | 0% | −0.01 [−0.39, +0.39] p 0.909 | unstable | +0.6 [−2.3, +2.9] p 0.726 | weak |
| Q3 | 5 | 284 | 35 | 53% | +0.16% | +0.29% | 58% | 1% | 0% | −0.19 [−0.34, +0.33] p 0.314 | weak | −0.2 [−2.0, +2.1] p 0.861 | unstable |
| Q4 | 5 | 254 | 28 | 52% | +0.41% | +0.34% | 60% | 1% | 0% | +0.06 [−0.36, +0.34] p 0.726 | weak | +0.3 [−1.7, +2.3] p 0.781 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 129 | 13 | 50% | +0.33% | +0.57% | 64% | 1% | 0% | −0.02 [−0.55, +0.63] p 0.956 | unstable | −0.1 [−2.5, +3.7] p 0.949 | unstable |
| baseline | 10 | 974 | | split 2024-11-22, embargo 10 | +0.71% | +0.87% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 117 | 11 | 33% | +1.70% | +1.17% | 72% | 0% | 0% | +0.99 [−1.04, +1.07] p 0.113 | weak | −3.4 [−6.5, +8.7] p 0.405 | weak |
| Q2 | 10 | 195 | 24 | 52% | +0.47% | +0.88% | 59% | 5% | 3% | −0.23 [−0.70, +0.66] p 0.562 | weak | +1.2 [−5.5, +6.1] p 0.796 | unstable |
| Q3 | 10 | 280 | 29 | 54% | +0.34% | +0.62% | 58% | 3% | 1% | −0.37 [−0.60, +0.58] p 0.288 | weak | −0.2 [−4.9, +4.0] p 0.814 | unstable |
| Q4 | 10 | 253 | 25 | 52% | +0.63% | +0.64% | 64% | 5% | 0% | −0.08 [−0.67, +0.57] p 0.934 | unstable | +1.4 [−4.1, +4.8] p 0.697 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 129 | 12 | 50% | +1.11% | +1.35% | 78% | 2% | 0% | +0.40 [−0.94, +1.16] p 0.518 | weak | −1.1 [−7.4, +7.6] p 0.894 | weak |
| baseline | 21 | 963 | | split 2024-12-02, embargo 21 | +1.56% | +1.76% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 115 | 11 | 34% | +2.44% | +1.88% | 70% | 2% | 0% | +0.88 [−1.67, +1.51] p 0.303 | weak | −9.9 [−11.3, +13.5] p 0.150 | weak |
| Q2 | 21 | 186 | 16 | 53% | +1.75% | +1.89% | 68% | 18% | 4% | +0.19 [−1.13, +1.09] p 0.829 | unstable | +6.1 [−9.8, +10.5] p 0.347 | weak |
| Q3 | 21 | 280 | 15 | 53% | +0.28% | +0.18% | 51% | 17% | 4% | −1.28 [−0.95, +0.87] p 0.022 | **robust** | +5.5 [−7.1, +7.6] p 0.212 | weak |
| Q4 | 21 | 253 | 14 | 52% | +2.01% | +2.49% | 85% | 9% | 1% | +0.45 [−1.01, +0.84] p 0.376 | unstable | −2.9 [−7.8, +7.6] p 0.474 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 129 | 12 | 50% | +2.37% | +2.85% | 87% | 5% | 0% | +0.82 [−1.58, +1.82] p 0.442 | weak | −6.2 [−12.3, +13.1] p 0.522 | weak |
| baseline | 63 | 921 | | split 2025-01-02, embargo 63 | +4.77% | +4.69% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 105 | 5 | 37% | +4.23% | +4.46% | 83% | 20% | 15% | −0.54 [n/a] p n/a | insufficient | −7.5 [n/a] p n/a | insufficient |
| Q2 | 63 | 181 | 3 | 54% | +5.15% | +5.25% | 86% | 31% | 11% | +0.38 [n/a] p n/a | insufficient | +3.5 [n/a] p n/a | insufficient |
| Q3 | 63 | 267 | 1 | 55% | +4.27% | +4.48% | 80% | 44% | 5% | −0.50 [n/a] p n/a | insufficient | +16.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 239 | 2 | 49% | +5.24% | +4.52% | 87% | 16% | 5% | +0.47 [n/a] p n/a | insufficient | −11.2 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 129 | 5 | 45% | +4.85% | +4.79% | 82% | 15% | 2% | +0.08 [n/a] p n/a | insufficient | −12.7 [n/a] p n/a | insufficient |

### ステージ2−ステージ4 (stage 2 % minus stage 4 %) — `q.stageSpread`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-10-14 -53.2 / -43.6 / -28.8 / -8.63, after the last session -29.6 / -12.3 / -3.15 / 6.83. Outcome: ^GSPC (long-history sp500 closes). Judged 1017 sessions (2022-10-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 1012 | | split 2024-10-28, embargo 5 | +0.38% | +0.44% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 14 | 1 | 100% | +1.57% | +2.61% | 57% | 0% | 0% | +1.19 [n/a] p n/a | insufficient | −0.9 [n/a] p n/a | insufficient |
| Q2 | 5 | 84 | 4 | 40% | +1.34% | +0.87% | 67% | 1% | 0% | +0.96 [−0.60, +0.64] p 0.018 | insufficient | +0.3 [−3.0, +6.0] p 0.814 | insufficient |
| Q3 | 5 | 225 | 12 | 31% | +0.41% | +0.65% | 66% | 3% | 1% | +0.03 [−0.46, +0.34] p 0.945 | unstable | +1.8 [−2.4, +3.0] p 0.343 | weak |
| Q4 | 5 | 395 | 14 | 45% | +0.33% | +0.36% | 59% | 0% | 0% | −0.05 [−0.23, +0.22] p 0.832 | unstable | −0.9 [−1.5, +2.3] p 0.350 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 294 | 6 | 72% | +0.10% | +0.19% | 55% | 1% | 0% | −0.29 [−0.34, +0.36] p 0.142 | insufficient | −0.2 [−2.4, +2.5] p 0.890 | insufficient |
| baseline | 10 | 1007 | | split 2024-10-30, embargo 10 | +0.75% | +0.88% | 65% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 14 | 1 | 100% | +2.76% | +2.28% | 86% | 0% | 0% | +2.01 [n/a] p n/a | insufficient | −3.3 [n/a] p n/a | insufficient |
| Q2 | 10 | 79 | 4 | 43% | +2.68% | +3.08% | 80% | 3% | 0% | +1.93 [−1.11, +1.13] p 0.033 | insufficient | −0.7 [−9.0, +12.1] p 0.975 | insufficient |
| Q3 | 10 | 225 | 10 | 31% | +0.81% | +1.19% | 70% | 8% | 4% | +0.06 [−0.92, +0.63] p 0.916 | unstable | +5.2 [−6.7, +7.8] p 0.226 | weak |
| Q4 | 10 | 395 | 11 | 45% | +0.64% | +0.85% | 65% | 2% | 0% | −0.11 [−0.42, +0.42] p 0.792 | unstable | −1.3 [−4.5, +5.8] p 0.588 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 294 | 5 | 71% | +0.24% | +0.27% | 55% | 1% | 0% | −0.51 [−0.63, +0.73] p 0.175 | insufficient | −1.9 [−7.1, +7.4] p 0.639 | insufficient |
| baseline | 21 | 996 | | split 2024-11-07, embargo 21 | +1.58% | +1.81% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 14 | 1 | 100% | +6.23% | +5.93% | 100% | 0% | 0% | +4.66 [n/a] p n/a | insufficient | −11.5 [n/a] p n/a | insufficient |
| Q2 | 21 | 68 | 4 | 50% | +6.16% | +5.76% | 96% | 3% | 0% | +4.59 [−2.22, +2.03] p 0.011 | insufficient | −8.6 [−19.9, +20.5] p 0.610 | insufficient |
| Q3 | 21 | 225 | 10 | 31% | +1.37% | +1.66% | 68% | 20% | 8% | −0.21 [−1.49, +1.07] p 0.646 | unstable | +8.9 [−11.6, +12.7] p 0.223 | weak |
| Q4 | 21 | 395 | 10 | 45% | +1.47% | +1.69% | 74% | 8% | 0% | −0.11 [−0.80, +0.73] p 0.978 | unstable | −3.7 [−8.5, +8.9] p 0.420 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 294 | 5 | 70% | +0.60% | +1.12% | 60% | 12% | 0% | −0.98 [−1.22, +1.48] p 0.215 | insufficient | +0.7 [−16.5, +12.8] p 0.967 | insufficient |
| baseline | 63 | 954 | | split 2024-12-09, embargo 63 | +4.78% | +4.71% | 84% | 27% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 14 | 1 | 100% | +7.24% | +6.60% | 100% | 0% | 0% | +2.47 [n/a] p n/a | insufficient | −27.1 [n/a] p n/a | insufficient |
| Q2 | 63 | 65 | 3 | 52% | +14.19% | +13.83% | 100% | 3% | 0% | +9.41 [n/a] p n/a | insufficient | −24.1 [n/a] p n/a | insufficient |
| Q3 | 63 | 214 | 5 | 32% | +4.28% | +5.38% | 75% | 31% | 22% | −0.50 [n/a] p n/a | insufficient | +3.7 [n/a] p n/a | insufficient |
| Q4 | 63 | 367 | 4 | 48% | +4.12% | +4.11% | 87% | 22% | 4% | −0.66 [n/a] p n/a | insufficient | −5.4 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 294 | 5 | 63% | +3.76% | +4.24% | 82% | 38% | 1% | −1.01 [n/a] p n/a | insufficient | +10.6 [n/a] p n/a | insufficient |

### ステージ2−ステージ4 (stage 2 % minus stage 4 %) 21-session change — `d21.stageSpread`

causal quintiles (edges from every known value strictly before the session, judged after 252); edges at the first judged session 2022-11-14 -13.1 / -9.56 / -5.49 / 1.74, after the last session -11.5 / -4.00 / 1.75 / 8.68. Outcome: ^GSPC (long-history sp500 closes). Judged 996 sessions (2022-11-14 to 2026-11-03).

| bucket | h | n | ep | 1st-half share | mean | median | P(up) | P(DD≤−5%) | P(DD≤−10%) | Δmean [placebo band] p | label | ΔP(DD≤−5%) [placebo band] p | label |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| baseline | 5 | 991 | | split 2024-11-11, embargo 5 | +0.35% | +0.43% | 60% | 1% | 0% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 5 | 173 | 8 | 35% | +0.38% | +0.31% | 55% | 3% | 1% | +0.03 [−0.57, +0.47] p 0.985 | unstable | +2.6 [−2.4, +3.2] p 0.223 | unstable |
| Q2 | 5 | 101 | 23 | 51% | +0.85% | +0.87% | 69% | 0% | 0% | +0.50 [−0.60, +0.57] p 0.150 | weak | −0.9 [−2.8, +4.0] p 0.682 | weak |
| Q3 | 5 | 245 | 26 | 42% | +0.32% | +0.32% | 58% | 0% | 0% | −0.03 [−0.41, +0.33] p 0.996 | unstable | −0.9 [−1.6, +2.5] p 0.394 | weak |
| Q4 | 5 | 258 | 21 | 52% | +0.30% | +0.45% | 64% | 0% | 0% | −0.04 [−0.35, +0.37] p 0.901 | unstable | −0.9 [−1.9, +2.1] p 0.478 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 5 | 214 | 8 | 68% | +0.17% | +0.28% | 58% | 1% | 0% | −0.18 [−0.27, +0.46] p 0.321 | unstable | +0.5 [−2.4, +1.9] p 0.416 | unstable |
| baseline | 10 | 986 | | split 2024-11-14, embargo 10 | +0.70% | +0.86% | 64% | 3% | 1% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 10 | 168 | 8 | 36% | +0.63% | +0.89% | 60% | 10% | 5% | −0.07 [−1.19, +0.88] p 0.869 | unstable | +6.2 [−7.2, +7.9] p 0.164 | weak |
| Q2 | 10 | 101 | 21 | 51% | +1.82% | +1.74% | 82% | 0% | 0% | +1.12 [−0.87, +0.84] p 0.029 | **robust** | −3.3 [−5.7, +7.0] p 0.347 | weak |
| Q3 | 10 | 245 | 22 | 42% | +0.76% | +0.87% | 68% | 3% | 0% | +0.05 [−0.70, +0.54] p 0.796 | unstable | −0.5 [−3.1, +5.0] p 0.759 | unstable |
| Q4 | 10 | 258 | 20 | 52% | +0.54% | +0.80% | 63% | 1% | 0% | −0.16 [−0.66, +0.64] p 0.701 | unstable | −2.2 [−4.5, +5.1] p 0.431 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 10 | 214 | 8 | 68% | +0.35% | +0.23% | 57% | 3% | 0% | −0.35 [−0.54, +0.89] p 0.270 | unstable | −0.1 [−7.3, +4.0] p 0.639 | unstable |
| baseline | 21 | 975 | | split 2024-11-21, embargo 21 | +1.50% | +1.70% | 70% | 12% | 2% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 21 | 157 | 8 | 39% | +2.18% | +1.94% | 66% | 23% | 8% | +0.69 [−2.05, +1.66] p 0.558 | unstable | +11.1 [−13.8, +19.8] p 0.219 | weak |
| Q2 | 21 | 101 | 17 | 51% | +2.48% | +2.55% | 77% | 11% | 4% | +0.98 [−1.30, +1.23] p 0.193 | unstable | −0.9 [−9.2, +12.2] p 0.920 | unstable |
| Q3 | 21 | 245 | 13 | 39% | +1.80% | +2.38% | 84% | 8% | 1% | +0.30 [−1.12, +0.89] p 0.573 | unstable | −4.0 [−6.3, +9.8] p 0.241 | unstable |
| Q4 | 21 | 258 | 18 | 52% | +1.17% | +1.41% | 67% | 9% | 0% | −0.33 [−1.05, +0.99] p 0.602 | unstable | −3.3 [−8.8, +10.3] p 0.482 | weak |
| Q5 上位20% (top fifth of earlier sessions) | 21 | 214 | 7 | 68% | +0.58% | +0.52% | 55% | 13% | 0% | −0.92 [−1.06, +1.72] p 0.128 | weak | +0.8 [−14.6, +5.7] p 0.887 | unstable |
| baseline | 63 | 933 | | split 2024-12-23, embargo 63 | +4.72% | +4.64% | 83% | 28% | 7% | | | | |
| Q1 下位20% (bottom fifth of earlier sessions) | 63 | 149 | 6 | 41% | +6.41% | +8.32% | 85% | 44% | 23% | +1.69 [n/a] p n/a | insufficient | +16.0 [n/a] p n/a | insufficient |
| Q2 | 63 | 95 | 4 | 40% | +6.36% | +6.16% | 86% | 19% | 8% | +1.64 [n/a] p n/a | insufficient | −8.7 [n/a] p n/a | insufficient |
| Q3 | 63 | 236 | 1 | 38% | +4.45% | +4.08% | 92% | 13% | 6% | −0.27 [n/a] p n/a | insufficient | −14.5 [n/a] p n/a | insufficient |
| Q4 | 63 | 239 | 2 | 56% | +4.49% | +4.76% | 87% | 19% | 2% | −0.23 [n/a] p n/a | insufficient | −8.4 [n/a] p n/a | insufficient |
| Q5 上位20% (top fifth of earlier sessions) | 63 | 214 | 6 | 68% | +3.38% | +3.89% | 68% | 46% | 1% | −1.35 [n/a] p n/a | insufficient | +18.1 [n/a] p n/a | insufficient |

