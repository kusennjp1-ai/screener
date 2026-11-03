# Daily brief and market-environment indicators

This note covers the `#/brief` screens, which are the whole static app since #127,
and the daily market-environment series behind them. For vocabulary, see `CONTEXT.md`.

## Screens (`frontend/src/static/brief/`)

| Route | Content |
|---|---|
| `#/brief` | A three-item summary first (地合い with the exposure cap, number of focus candidates, sell signals on the watchlist), then 1 Market (verdict, S&P 500 with active distribution days, trend-template count, RS90 leaders, stage mix, share above the 200-day line, 52-week new highs and lows, breakout follow-through, bifurcation note) · 2 Top five qualified candidates in the buy zone or within −5% of the pivot, and the industry groups (or sectors, when most rows lack a group) with the most qualified stocks · 3 Watchlist changes |
| `#/brief/list` | Qualified candidates. Filters: buy zone, near pivot, all qualified, one condition short. Search box and five sort orders (priority, RS, distance to the pivot, volume, distance to the 52-week high). |
| `#/brief/watch` | The shared `research-watch` watchlist |
| `#/brief/market` | 地合い with every figure and the stage mix, then the long-run explorer (trend-template count and RS90, stage mix, share above the 50- and 200-day lines, leader health, breakout success) and sector ETF ranks. Each block keeps its own as-of date. |
| `#/brief/stock/:symbol` | Conclusion card (status, position meter, buy range, stop, 2R) → large daily chart (3 months, 6 months, 1 year, or a 2-year weekly view with 10/30/40-week averages) → eight trend-template rules → VCP footprint → quarterly growth with layered Code 33 → 13F counts → position plan → sell checks |

- **Shell:** the screens have their own shell (48 px top bar, 56 px bottom tabs, light/dark toggle from the existing colour-mode preference).
- **Desktop (≥1024 px):** two panes, list on the left and the selected stock on the right.
- **Retired screens:** the research workspace, comparison, scan, breadth and group pages were removed in #127. Their addresses open the matching brief screen (`frontend/src/static/legacyRoutes.js`): `#/` and `#/daily` → `#/brief`, `#/compare` and `#/scan` → `#/brief/list`, `#/breadth`, `#/groups` and `#/themes` → `#/brief/market`, `#/?symbol=X` → `#/brief/stock/X`.
- **Today vs market tab:** Today keeps the buy-or-wait facts (distribution days, TT count, share above the 200-day line, new highs and lows); the breakout rate, RS90 count, stage mix and trend sparkline are on the market tab.
- **Gates:** Design Acceptance measures these screens (`docs/DESIGN_ACCEPTANCE_POLICY.md`); Static Browser Regression runs `frontend/tests/static/brief-*.spec.js`.

All judgements come from the shared rule functions, so the brief and the exporters never disagree:

- `assess`
- `entryPlan`
- `buildBookTechnicalEvidence`
- `bookFinancialCurrent`
- `financialHistory`
- `institutionalGrowth`
- `code33Layered`

Unknown inputs stay 未確認 or 未取得. They are never counted as a pass.

The VCP footprint ("VCP 7週 24/5 3T": weeks since the first contraction, deepest/shallowest depth, number of contractions) says VCP only when each contraction is shallower than the one before. Otherwise it reads 収縮 … （縮小途切れ）, or （縮小は未確認） when that is unknown. The VCP card also shows the 50-day up/down volume ratio: volume on up closes ÷ volume on down closes.

### Sell checks (`sellSignals` in `briefModel.js`)

The stock screen also lists checks for the last five sessions, in two groups:

- **Selling into strength** (climax): the largest one-day gain since the start of the advance, the largest five-session gain since the start, at least 8 up days in the last 10, and +25% or more within 15 sessions.
- **Selling into weakness:** the largest one-day loss since the start of the advance, a close that crosses below the 50-day SMA on at least 1.4× the prior 50-day average volume, and the book's combined warning from `diagnoseBookChart`: below the 20-day line, three lower lows and heavy volume. The research screen shows the same combined warning.

How the checks are judged:

- The start of the advance is the lowest low of the last 252 sessions.
- The strength checks and the largest one-day loss run only when the close is at least 30% above that low and 20 or more sessions have passed. Otherwise they show 対象外.
- A missing volume on a break day leaves that check 未確認.
- Every check computed from bars — these sell checks, the stage computed from bars, the RS-line high, up/down volume, and the chart marks — needs certified bars. The publisher's `technical_audit` must have passed, and `auditDailyBars` must pass on the same payload: the last bar is on the analysis date, every exchange session is present, and the last close matches the row. Retained or gapped histories leave them 未確認 with the reason, and the chart states the date its bars end on.

The chart marks each day with a signal (▼ above the bar for a climax, ▲ below it for a breakdown). Heavy volume on a lower close is drawn in the warning colour, not the breakout colour.

The watchlist (today's 3rd block and the ウォッチ tab) shows ▲ 売りのサイン n件 for watched stocks. It uses the same chart queries as the stock screen, and only the first 12 watched stocks are fetched. A watched stock that was not checked (beyond the first 12, a failed chart, or uncertified bars) shows 売りのサイン 未確認, so an unchecked stock never looks the same as one with no signals.

The ideas follow Minervini's sell rules. The combined warning cites 『株式トレード 基本と原則』, and its 1.4× volume is the app's proxy. Every other number is this app's own threshold, and the screen labels them 独自判定. The stock screen also shows パワープレー候補（機械的探索） when `diagnoseBookChart` finds its mechanical power-play match, and the RS-line chip adds 株価に先行 when the RS line is at a new high while the price is still 2% or more below its own 52-week high.

### Motion

Motion is used only where it explains something:

- screen changes (View Transitions, with the ticker morphing from list to header)
- the chart intro: candles sweep in on a compositor-only layer, then the contractions drop one by one, then the rising lows and the pivot draw
- the position meter and the trend-template ring
- the stop slider, which moves the chart's stop line

Under `prefers-reduced-motion` the final state appears at once (`theme/foundation.css`).

## Market-environment series (`frontend/tools/collect-market-history.py`)

Every full build recomputes five years of these values from per-symbol daily bars. A missed day is therefore backfilled rather than lost, and the previous capture is retained if a refresh fails. `audit-market-history.py` replays the counts independently, and `validateLongHistory` checks them in the browser.

| Field | Definition | Threshold source |
|---|---|---|
| `trendTemplateCount`, `trendTemplatePercent` | All eight Trend Template conditions (30% above the 52-week low), with same-day proprietary RS ≥ 70 | Minervini's published template. RS is this app's estimate, not IBD's. |
| `rs90TemplateCount` | The subset with RS ≥ 90 | This app |
| `above150`, `above200` (+ `%`) | Close above the 150- and 200-day SMA | Standard |
| `stage1`…`stage4` | Weinstein stage per session, using the scanner's rules in `stage_analysis.py`. The swing-pattern exception is not replayed. | Scanner rules (parity-tested) |
| `breakouts`, `breakoutsJudged`, `breakoutsHeld` | Breakout: close above the prior 251-session high on ≥1.4× the 50-day volume while the price template holds. Held: no low within the next 10 sessions reaches 7% below the breakout close. | Volume threshold and 7% loss limit as used elsewhere in this app. The 10-session window is this app's own. |
| `leaderCohort`, `leaderCohortAbove50` | Stocks that met the trend template 20 sessions earlier and are still observed, and how many of them close above their 50-day SMA today. The share is shown when the cohort has at least 10 stocks. | This app (the idea that leaders break down before the index follows Minervini) |
| `leaderCount` | Earlier variant with the low at 25% | Existing |

The brief warns, labelled 独自判定, when fewer than 50% of that cohort are above the 50-day line.

The brief and the 市場 page also show a bifurcation note: the index is within 5% of its one-year high while fewer than 50% of stocks are above the 200-day line. This follows Minervini's description of a bifurcated market, but both thresholds are this app's own and are labelled 独自判定.

## Fundamentals layering (Code 33)

1. **Dated SEC evidence** (`tools/sec-financials.py` → `book_financials`). EPS uses directly reported quarters only. A Q4 for revenue or net income that is reported only as a fiscal-year total is recovered as the annual value minus three quarters of the same concept, with its four source filings recorded.
2. **Reference from the current Yahoo quarterly statements** (`financial_history`), used only when the SEC result is unknown. It applies the same rule and is labelled 「参考：Yahoo四半期値」.
3. **Otherwise 未確認.**

SEC access reads the `SEC_USER_AGENT` secret and retries 429/5xx responses with backoff.

### Coverage of the brief's rows

The daily build fetches SEC evidence, reported financial history and earnings dates for every row the brief can list: the ranked top-50 lists, then all trend-template qualifiers and the rows one condition short with nothing unknown, from the same-day qualification audit (up to 400 symbols; a stale audit never widens the list). They run before the final research export, so the rows carry this session's evidence. The build log prints `Data coverage (fundamentals)` and `Data coverage (market environment, last 20 sessions)` (`frontend/tools/report-data-coverage.mjs`); missing values stay unknown.

