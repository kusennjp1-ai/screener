# Daily brief and market-environment indicators

This note covers the `#/brief` screens, which are the whole static app since #127,
and the daily market-environment series behind them. For vocabulary, see `CONTEXT.md`.

## Screens (`frontend/src/static/brief/`)

| Route | Content |
|---|---|
| `#/brief` | A three-item summary first, each a link (地合い with the exposure guide, number of focus candidates, ウォッチの注意: broken setups among the watched stocks), then 1 Market (verdict, S&P 500 with active distribution days, trend-template count, RS90 leaders, stage mix, share above the 200-day line, 52-week new highs and lows, breakout follow-through, bifurcation note) · 2 Top five qualified candidates in the buy zone or within −5% of the pivot, and the industry groups (or sectors, when most rows lack a group) with the most qualified stocks · 3 ウォッチの状況 (each watched stock's state today) |
| `#/brief/list` | Qualified candidates. Filters: buy zone, near pivot, all qualified, one condition short. Search box and five sort orders (priority, RS, distance to the pivot, volume, distance to the 52-week high). |
| `#/brief/watch` | The shared `research-watch` watchlist |
| `#/brief/market` | 地合い with every figure and the stage mix, the index's past tendencies (see below), then the long-run explorer (trend-template count and RS90, stage mix, share above the 50- and 200-day lines, leader health, breakout success) and sector ETF ranks. Each block keeps its own as-of date. |
| `#/brief/stock/:symbol` | Conclusion card (status, position meter, buy range, stop, shares) → large daily chart with its readout (3 months, 6 months, 1 year, or a weekly view of up to 2 years, labelled with its real length, with 10/30/40-week averages) → eight trend-template rules → VCP footprint → quarterly growth with layered Code 33 → 13F counts → position plan → sell checks |

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

### Sell checks (`sellSignals` in `briefSell.js`)

The stock screen also lists checks for the last five sessions, in two groups:

- **Selling into strength** (climax): the largest one-day gain since the pivot breakout, the largest five-session gain since then, at least 8 up days in the last 10 (sessions after the breakout only), and +25% or more within 15 sessions. They are judged only for a stock beyond the buy zone (`view.state === 'ext'`) at least `SELL_RULES.climaxFromPivotPercent` (+20%) above its pivot whose run of closes above the pivot is at least 15 sessions old; otherwise each reads 対象外 with the reason (below the pivot, a small gain since the breakout, a breakout only N sessions ago).
- **Selling into weakness:** the largest one-day loss since the start of the advance (the lowest low of the last 252 sessions; judged only when the close is at least 30% above it and 20 or more sessions have passed), the 50-day line as a state, and the book's combined warning from `diagnoseBookChart`: below the 20-day line, three lower lows and heavy volume.

The 50-day check is a state, not a one-day event. Below the line, the break day is the session after the last close at or above it (within 252 sessions): a hit when it traded at least 1.4× the prior 50-day average volume (「9/22 に出来高 2.2倍で割れ、以降50日線の下（9営業日）」), a caution (「50日線の下（大商いの割れは未確認）」) after a lighter break or when no close above the line is found, 未確認 when that day's volume is missing or 0. Back above the line it is clear.

A **broken setup** is a hit of the 50-day check or of the combined warning (`isBreakdown`). The stock's conclusion then never makes a buy-side call (「買いの前提が崩れた（独自判定）」), the rows show 崩れ（独自判定）, and the watch counts it. A climax or the advance's largest down day alone is a holder's signal: the rows say 保有なら売りのサイン and nothing counts it, because no holding is registered (保有未登録).

Every check computed from bars — these sell checks, the stage computed from bars, the RS-line high, up/down volume, and the chart marks — needs certified bars. The publisher's `technical_audit` must have passed, and `auditDailyBars` must pass on the same payload: the last bar is on the analysis date, every exchange session is present, and the last close matches the row. Retained or gapped histories leave them 未確認 with the reason, and the chart states the date its bars end on.

The chart marks each day with a signal (▼ above the bar for a climax, ▲ below it for a breakdown). Heavy volume on a lower close is drawn in the warning colour, not the breakout colour.

Today's tile 「ウォッチの注意」 counts the broken setups only, and reads 0件 only when every watched stock was checked; unchecked, limited (beyond the first 12), unlisted and partly checked stocks are said in its note (未確認, 上限超, 対象外, 一部未確認, 保有未登録). Each watched stock that was not checked shows 売りのサイン 未確認, so an unchecked stock never looks the same as one with no signals. The watch uses the same chart queries as the stock screen.

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

## Past tendencies on the market tab (過去の傾向)

The 指数 panel of `#/brief/market` has one fold, 「過去の傾向」 (its summary since round 2: see below): closed at the end of the 指数 panel on a phone, open across the card on the desktop. It is never in the verdict lead, the warning summary or Today.

**Source.** `frontend/src/static/reference/market-regime-reference-v1.json`, generated by `frontend/tools/market-regime-reference.mjs` from the market-regime study's CI output (`frontend/tools/market-regime-study.mjs`, pre-registered as market-regime-study-v2). Round 1 builds it from the study's markdown report of Design Acceptance run 41844557380 (artifact 13331791935, as of 2026-11-03), committed byte-for-byte as `frontend/tools/reference-sources/market-regime-study-v2/ci-results-run41844557380.md` (sha256 `4fc7dcbee932df388e16990b178bf704e1c710b76ae2e33e5afe4c57ce9bb0c6`); its shares are rounded to 1 pt there (`source.precision: rounded-1pt`). The builder also reads the study's `results.json` (exact values) once it is archived. No percentage is typed in `src/`; a change to the reference is a rebuild, never an edit.

```bash
cd frontend
node tools/market-regime-reference.mjs --markdown tools/reference-sources/market-regime-study-v2/ci-results-run41844557380.md \
  --ci-run 41844557380 --artifact 13331791935 --out src/static/reference/market-regime-reference-v1.json
node tools/market-regime-reference.mjs --results results.json --check src/static/reference/market-regime-reference-v1.json
```

The builder refuses to build unless the study version, the distribution-day method (`index-down-strictly-over-0.2-higher-volume-age25-high5-v1`), the follow-through method (`rally-attempt-gain1.2-day4-15-decline6-v1` on the trailing 280 sessions), every state's bucket labels and rule text and, from `results.json`, the app rules the study ran with (`DISTRIBUTION_WARN`, `SPLIT_RULE`, `ENV_RULES`) equal the app's current ones. `--check` compares two builds: labels and mean directions must be equal, shares and first-half shares within ±1 pt, and no first-half share may cross the 〔偏り〕 bounds (40% / 60%); changes of n and episodes are counted as information. `--summary <file>` appends the drift table to a step summary. A Design Acceptance step that runs it against each fresh study's `results.json` (a diagnostic, never a gate) is added at integration together with the workflow test that pins Design Acceptance's steps.

**Definitions.**

- The share is the outcome the study tested at h = 21 sessions: of the sessions in a state, how many saw a close at least 5% below the observed close within the next 21 sessions (the first line says 「21営業日以内に5%以上下げた割合」; the key under the lines defines it with closes and sessions). Index-level only (^GSPC / ^IXIC daily bars, 1990-01-02 to 2026-11-03), never a stock's value.
- The comparator is the same sample's baseline, called 全期間 (never 平常), for an indicator with three or more states, or the other state for a two-state one (for example 「29%（5%以内 11%）」).
- States, judged the way the study judged them: the 50/200-day cell (`ma.quadrant`, 200 closes needed) and within 5% of the 252-session closing high (`high.near`, a full year needed) from `indexSummary` — for the S&P on the long history's ^GSPC closes, as a trailing run that never bridges an unknown close; for the Nasdaq on the exporter's `indices[^IXIC].state`. The distribution grade (`dd.graded`: 0–2, 3–4, 5–6, 7+) and the follow-through state (`ftd.state`) come from the market-trends index series, only when its method ids equal the reference's; the follow-through state also needs the study's window (`methods.followThroughWindowSessions`, 280 sessions: the series' points are its validated bars, so an index whose last bar is before the analysis date, judged on 279, says 「判定期間が検証（280営業日）と異なるため表示しません」). FTD confirmed within 25 sessions adds the `combo.ftd_recent` row.
- Every line carries its own date; an FTD state's qualifier shares that parenthesis (「反発中（FTD判定・10/2時点）」). A state that cannot be joined says why instead: a short window, a missing close, a method mismatch or a method not recorded, another follow-through window, a missing study row, or 「旧形式の公開データに未収録」 for a publication from before the exporter recorded the Nasdaq's position.
- A comparator and each tag are kept whole on a line. A key under the lines, generated from `TAGS` and `BIAS_SHARE`, defines the share, 全期間 and exactly the tags the lines show (確認 = placebo p ≤ 0.05 with both halves of the period in the same direction).

**Labels.** From the study's drawdown label for that state, on that index and on the other one: robust on both 〔S&P・Nasdaqとも〕; robust on this index only 〔S&Pのみ〕 or 〔Nasdaqのみ〕; weak or unstable here 〔未確立〕; too few sessions 〔標本不足〕, with no number. A first-half share of 60% or more, or 40% or less, adds 〔偏り〕. The mean return is stored as a label and, for a robust label only, its direction (`meanDirection`: higher or lower than the comparator), never as a number. In the warning summary each fired check carries its state's tags (the check-to-indicator map is `SIGNAL_INDICATORS` in `marketRegimeReference.js`): a breadth check whose rule the study did not find robust 〔参考〕 (every breadth rule of the committed reference; the 2021–26 breadth panel was, as a whole, consistent with chance), a distribution count its graded bucket's tag (round 2), S&P FTD failure 〔S&Pのみ〕〔偏り〕, the Nasdaq's 〔未確立〕. An index check whose published method (or, for the FTD failure, the follow-through window) is not the study's gets no tag. The sentence beside the tags defines each tag shown.

**What the block does not change.** No verdict, threshold, exposure cap, warning rule or order. The states are never combined into one probability; the footer says so, that the lines count the same fact (an index in or just after a decline is volatile) in different ways, that the two indices move together, and that the block shows drawdown shares only. It adds that no state had a lower mean return on either index only while the reference has no robust-lower mean (`meanLowerStates`); in the committed reference the robust means (調整中 on both indices, 200日線の上・50日線の下 on the S&P) are all higher. The survivorship caveat (「現在の銘柄で過去をさかのぼった集計（上場廃止銘柄を含まない）」) applies to the breadth panel only and is shown under the 参加度 and リーダー headers on the desktop, in the 注記 on a phone and in the long history's takeaway.

**Beside it.** The exposure guide's disclosure is printed from `MARKET_CAPS` (`portfolioPlan.js`; `otherwise` is the cap of every known state that is not an uptrend, an unknown market is 0). The verdict's basis, then, while the verdict is positive and the Nasdaq is correcting, rallying or failed, the note that the verdict reads the S&P 500 (SPY) only, then the disclosure: in place under the meter on the desktop, a 44 px fold on a phone whose summary is 「目安と判定の基準」, followed by the note's short form when it applies. The Nasdaq's published position is a row above the chart on the desktop and the first line of the Nasdaq block inside 過去の傾向 on a phone (the market screen's 375×812 budget), until the publication carries the Nasdaq's closes (round 2: the switch shows them). The market tab's index chart adds a dashed 200-day line, ◆ the FTD day (「FTD 8/13（失敗 9/2）」 once it failed) and ○ the rally low inside its window: during a rally attempt the record's low, after an FTD the low its ftd event confirmed (no ○ without that date), and scale labels on an opaque chip (round 2). Without 200 closes the S&P's 200-day distance reads 「200日線比 —」, said in words to a screen reader and in the 注記. The opened 分配日 row lists each index's active days and the sessions left on the oldest. A confirmed FTD no longer carries the buy-zone tone in the model (the row never drew it).

**Where the code lives.** The study block, the tags' words, the Nasdaq note and position and the 分配日 detail are in `frontend/src/static/reference/marketTabStudy.js`, imported only by the lazily loaded `MarketScreen.jsx` (which also renders the fold), so Today's chunk carries neither the study's code nor its data.

## Market tab, round 2: the regime's cause, the Nasdaq, the tags

Round 2 adds disclosures only. The verdict, its tone, the exposure caps (`MARKET_CAPS`), `DISTRIBUTION_WARN`, `ENV_RULES` and the generated reference are unchanged; a `modelMarket` snapshot guards the label and the cap.

**FTD-upgraded uptrend.** The backend regime (`backend/app/services/market_regime.py`) upgrades a correction or a downtrend to `confirmed_uptrend` on a live follow-through day, weeks before SPY recovers its moving averages; it is the only path to `confirmed_uptrend` while SPY is under its 50-day or 200-day line. `modelMarket` returns the raw `regime` and `ftdUpgraded` beside its label and cap, which never read them, so the guide stays 0% (§9-15 holds the pilot-cap option for the owner). Inside 「目安と判定の基準」 (in place on the desktop) one line after the basis says why: 「局面判定はSPYのFTD（9/18）による上昇トレンド。この目安はSPYが50日線の下のため0%（独自判定）」, or 「…200日線の下…」; the 0% is printed from the cap (`capText`), and the line is said only while the cap is 0. The FTD's date comes only from the regime's block below; without it the date is left out, never guessed from the ^GSPC series. The regime's FTD is SPY's (`detect_follow_through`: its own low anchor and volume rule), while the tab's フォロースルーデー row and its ◆ are the app's own ^GSPC record (`followThroughDay.js`), so the two can differ: when that day's ^GSPC record (`gspcFollowThrough`) reads otherwise, the line says so after the FTD (「^GSPCの日足ではFTD未確認」, 「…FTD失敗」, or 「^GSPCの日足ではFTD 8/13」 for a confirmed FTD of another date). Today's 地合い tile adds 「FTD確認済み」 in this state (`marketTileSuffix`), unless that day's ^GSPC record is available and is not a confirmed FTD: Today never asserts an FTD the tab's own record contradicts.

**The regime's cause.** `manifest.markets.US.market_context` (plan §2.3, exported by the research export from the canonical rows when every US row agrees) is read raw by `publishedMarketContext`, only in shape and for the analysis date. When it is present and agrees with the verdict's regime, the same place states the regime's own SPY count as a fact: 「局面判定の分配日：SPY 4日（ストーリング日を含む数え方）」. Under any regime but a confirmed uptrend it adds 「局面判定は分配日のほか50日線・200日線と参加度も見ます」, because the backend also reaches 上昇に圧力 through the moving averages or the breadth guard, so a count under 4 never reads as the cause. The regime is named (「局面判定は「調整」で、…」) only where the basis line does not already name it (it does for 上昇トレンド and 上昇に圧力). The count is kept apart from the 分配日 row, which counts ^GSPC and ^IXIC separately without stalling days. A null count reads 「局面判定の分配日（SPY）は未収録」, never 0. An older publication has no block, and the basis is one line as before. At most one line is added, inside the existing fold on a phone.

**The Nasdaq.** The market-trends exporter writes `indices[i].closes` (`[{date, close}]`, at most `INDEX_CLOSES_MAX` = 300 points, the last of the same validated bars as that index's distribution count, only when the count was computed); `readMarketTrends` withdraws malformed closes alone (`closes_error`), keeping the counts and the follow-through. With the Nasdaq's closes (60 or more), the 指数 panel gets an S&P／Nasdaq switch (kept for the session): the selected index's figures, its line, its 200-day line (from 200 closes; a line that starts inside the 130-session window names its first day, 「200日線（6/12〜）」), its ▲ distribution days, ◆ FTD and ○ rally low from its own series. The figures are the exporter's `indices[^IXIC].state` only when it describes the line's last bar (the same date and close), else `indexSummary` on those closes, so the figures and the line never disagree. On a phone the switch is two 44 px buttons 「S&P」「NAS」 (read out as 「S&P 500」 and 「Nasdaq総合（NAS）」) beside the 指数 group's heading, in the slot of the group's marks and date, which then take the question's line; its pressed button names the series, so the chart's legend and the figures' first label drop the index's name (the label reads 終値). It replaces content and adds no row: measured CI-faithfully at 320, 375 and 414 px, the market screen is no taller with the switch than without it. On the desktop the switch sits above the figures. The Nasdaq's figures move from their own row (desktop) or from inside 過去の傾向 (phone) into the switch. Without closes there is no switch; closes the reader withdrew are said in the 注記 (「Nasdaq総合の終値は形式を確認できないため、指数の切替を表示しません。」). While the verdict is positive and the Nasdaq's own follow-through state of the analysis date is a correction, a rally attempt, an expired rally attempt (15 sessions without an FTD: still a correction) or a failed FTD (`nasdaqInCorrection`), the guide's fold summary carries 「Nasdaqは調整中（判定はSPYのみ）」 (an expired attempt too: the fold itself says 「調整中・15日以内のFTDなし」, and the summary keeps 2 lines at 320 px) and Today's 地合い tile 「NAS調整中」; an older Nasdaq state (a series one session behind) gives no tile suffix. Neither changes the tone or the cap (§9-16).

**Tags and counts.** A fired distribution warning (5 or more days, unchanged) takes the tag of its count's graded bucket (`dd.graded`), the tag its 過去の傾向 line shows: 5–6 days 〔未確立〕 on both indices, 7 or more 〔S&P・Nasdaqとも〕. A fired check tagged 〔参考〕 (a breadth rule the study could not confirm) is counted apart: the summary reads 「▲ 注意 1件・参考 2件」 (「注意 0件・参考 1件」 without a warning; the shorter count keeps the line on one line at 375 px with its date), its line takes a neutral ○, its row reads ○ 参考, its group 「○ 参考 1」, and it never sets a group's or a section tab's ▲. 「注意 0件」 and 「注意サインなし」 need a judged check that can warn (`signals.warnable`, the judged checks that are not 参考): with none (every breadth check is 参考 under the committed reference, so this is the case when the index series are unavailable) the summary reads 「注意サインを判定できません」, or 「注意 判定不可・参考 M件」 when a 参考 sign fired (判定不可 in the count's place keeps the line on one line at 375 px). Today, which never loads the study, marks the same rules with `REFERENCE_CHECKS` (`marketTabModel.js`; a test keeps it equal to the reference's 〔参考〕 checks): its TT達成数, 200日線より上 and 新高値・新安値 tiles read 「参考：…」 in the warning's place and length with no ▲ and no amber, and its deterioration notes and split alert take a neutral ○ and 「参考：」, so one rule has one marker on both screens.

**過去の傾向.** A line its own index confirmed says which way its share differs from the comparator (「10%（全期間 16%より少ない）」); a 〔未確立〕 or 〔標本不足〕 line says no direction. The fold's summary counts them: 「過去の傾向：下げが多かった状態 2・少なかった状態 1（1990〜2026年）」, wrapping only between its parts. A state both indices are in, confirmed the same way on each, counts once (the two indices move together). With judged lines but no direction it reads 「過去の傾向：差がはっきりした状態なし（1990〜2026年）」; with every line a reason (an older publication) it keeps the neutral 「過去の傾向（1990〜2026年・予測ではありません）」, never a finding. Each index's block starts at its column's top on the desktop. The key and the footer move into a nested 44 px fold, 「読み方と出典（予測ではありません）」, open on the desktop. On the desktop the block spans the card under the three columns, the two indices side by side. The banned words stay banned (上がりやすい, 下がりやすい, 安全, 底打ち, オールクリア, 今日の確率).

**One disclosure.** 「注意サインも指数の過去の傾向も目安を変えません」 is said once, in `exposureRuleText`; the warning summary's trailing paragraph and the last sentence of `signalTagText` are gone.

**Labels.** An opened row's year lines name their index when the row draws two (「S&P　1年の最低 0日・最高 3日」), at 12 px. The index chart's scale labels sit on an opaque chip of the card's surface in both themes (a line passing under a label never reads as a minus sign); a negative label uses U+2212. TT達成数 names its population in the 200-day row's form (「観測100中2」), and the 注記 says whom it counts, once and only while the row shows a value: the long history's names on their daily closes, the trend template's price conditions only (RS推計 included), not the candidate list's selection.

## Fundamentals layering (Code 33)

1. **Dated SEC evidence** (`tools/sec-financials.py` → `book_financials`). EPS uses directly reported (diluted) quarters only. A Q4 for revenue or net income that is reported only as a fiscal-year total is recovered as the annual value minus three quarters of the same concept, with its four source filings recorded and labelled 「Q4算出」. Fiscal-Q4 EPS is never derived.
2. **Reference from the current Yahoo quarterly statements** (`financial_history`), used only when the SEC result is unknown and that history is at most 72 hours old. It applies the same rule and is labelled 「参考：Yahoo四半期値」.
3. **Otherwise 未確認**, with the reason.

Code 33 combines its three conditions (EPS growth acceleration, sales growth acceleration, rising net margin) with a three-valued AND: one known 未達 condition makes it 未達, 達成 needs all three known 達成, and anything else is 未確認. Missing data never becomes a pass.

### SEC fetch

- **Targets**: every row the brief can list comes first — trend-template qualifiers, then the rows one condition short with nothing unknown, from the same-day qualification audit (a stale audit adds nothing) — then the trend-template top 50, then the minervini2, IBD and O'Neil lists. At most 1500 symbols (`MAX_SYMBOLS`, the tool's default budget).
- **Rate**: one shared limiter for all 4 worker threads, 5 requests/second by default (`SEC_MAX_RPS` may lower it or raise it to at most 8; SEC allows 10), before every request and retry, including `company_tickers.json`. Responses are requested gzip-compressed. The User-Agent comes from the `SEC_USER_AGENT` secret.
- **Failures** are recorded, never filled: `no_cik` (not in SEC's ticker map), `no_companyfacts` (404), `no_quarterly` (no us-gaap quarterly facts; the most frequent filing forms, e.g. 20-F, are kept), `invalid_payload`, and `transient` (429/5xx after retries, timeouts, resets). Only `transient` gets the second pass 20 s later. Nothing from an earlier run is reused.
- **Window**: Q4 derivation uses the full series; the published quarterly series are then trimmed to 1100 days before the latest quarter (the 8 quarters the rules read and their year-ago bases). Annual EPS stays complete.
- **Output**: `public/static-data/book-financials.json.gz` (schema 2, deterministic gzip). Every record carries `retrieved_at`. Readers still accept a legacy raw `book-financials.json`.

### Admission into published rows

Ordinary releases run the financial carry, which owns every scalar financial field and `financial_history`. `book_financials` is the one exception: the export, the carry/correction overlay and the financial gate each keep it only when `admitBookFinancials` (`src/static/bookFinancialAdmission.js`) accepts it — same symbol and as-of date, retrieved between the start of that day and the evaluation instant, a companyfacts URL bound to the CIK, every fact filed on or before the as-of date in a named 10-K/10-Q (or amendment) with its field's tag and unit, and no extra keys. Anything else, and every fund or quarantined instrument, publishes `null`. Admitted records never change rankings or qualification (`researchEngine` does not read them). Point-in-time granularity is the filing date; the acceptance time of day is not known.

The Yahoo history fetch keeps 1 request/second with one worker. Under the carry the release requests none (`--limit 0`), because the carried history replaces it.

### Why a same-day SEC record is not published

Every published row's research detail carries `sec_admission` (detail-only, never in the list rows or the scan pages): `admitted` (the detail holds the record), `not_requested` (the same-day SEC input has no record for the symbol: 今回の取得に含まれていない), `not_fetched` (no SEC input for this publication date: `no_file` or `other_date`) or `refused` with the reason, observed, never guessed — the export's own admission reason, else the carry/correction overlay's re-admission reason, else what the final row shows:

| Reason | Meaning |
|---|---|
| `schema` | The record's schema version is not the reader's |
| `symbol` | The record's symbol is not the row's |
| `as_of` | The record's date is not the publication date |
| `retrieved_window` | The retrieval time cannot be checked against the evaluation instant |
| `keys` | The record has keys other than the expected ones |
| `cik_url` | The companyfacts URL is not bound to the CIK |
| `series:<field>` | A quarterly series (`eps`, `revenue`, `netIncome`, `inventory`, `receivables`) or `series:annualEps` fails its filing date, period, form, tag or unit check |
| `not_corporate` | A fund or quarantined instrument, including one the overlay or the projection made non-corporate (the projection then nulls `book_financials`) |
| `projection` | Admission accepted the record but a later publication step removed it from the row (a label only; admission never returns it) |

The manifest carries the publication's block at `markets.US.fundamentals_coverage` (`fundamentals-coverage-v1`, computed by one function for the export, the quality gate and the report): `as_of_date`, `sec_fetch_ran` (the SEC input is for this date), `sec_as_of`, `file_schema`, `universe` (published rows, funds and ETFs included), `requested`, `eligible`, `truncated`, `deadline_unreached`, `ticker_map_ok` (null when the input lists no errors, false when the SEC ticker map could not be read), `admitted`, `with_quarters` (admitted records with status available or partial), `not_requested`, `not_fetched`, `refused` and `refused_by_reason`. A count the input does not carry is null (未計測), never 0. The four states add up to `universe`, and the financial quality gate (`check-data-quality-financial.mjs`) rejects a block that is malformed or differs from the one it recomputes from the published details and the SEC input. The brief-listed counts (`sec_record`, `with_quarters_listed` over `listed`) stay in the report's `--published` output, not in the block.

`report-data-coverage.mjs --published` warns (never fails the build) when SEC quarters cover under 80% of the brief-listed rows, when the input holds records for the date but no published row carries quarters, when `deadline_unreached` is above 0, when `ticker_map_ok` is false, when the input file is missing, of another schema or of another date, and when the manifest block differs from the published details.

A UI-only republish of the Research UI Release records the live publication's SEC records before the export and compares them after it. Round 1 ships it warn-only (plan §9.1): a dropped or changed record, or a comparison that cannot be made (未計測), is a `::warning::`. It fails the release only when the repository variable `SEC_CARRY_FORWARD_REQUIRED` is `'true'`; the manual input `allow_sec_coverage_drop` then lets one owner-approved drop through.

The stock screen keeps the reasons apart: **配信側の問題** (the publication delivered no SEC quarters at all: no same-day fetch, another schema, or no ticker map; not the stock's own state), **SEC 今回未取得** (not in this publication's SEC fetch; temporary), **SEC 不採用** (fetched, refused at verification, with the reason) and **SEC 対象外** (no CIK in SEC's ticker map).

### What the stock screen shows

Each tile shows the newest quarter that has a value, with its period. When a newer quarter has none, the tile says why (for example 「2026-06期・最新 2026-09期はQ4のEPSは年次報告のみ」); with no value at all it shows the reason (比較不可 for a loss or zero base, 前年同期なし, 未報告). A source line names the filing (`出典：SEC XBRL（10-Q 2026-08-05 提出）・2026-06期まで`). Without a usable SEC record the card says why: SEC 未配信, SEC 対象外, SEC データなし, 四半期報告なし, SEC 取得失敗, 対象外 (funds), 古い (latest quarter older than 180 days) or SEC 検証不可. The Code 33 box names the failed condition, or why it is unknown (Q4 EPS only in the 10-K, fewer than 8 quarters, a gap, stale, no SEC record).

### Coverage of the brief's rows

The build log prints `SEC evidence <date>` (requested, reasons, `brief_listed`/`brief_fetched`, `truncated`, with a warning when truncated), `Data coverage (fundamentals)`, `Data coverage (market environment, last 20 sessions)`, and after the build `Published coverage (fundamentals)` (`frontend/tools/report-data-coverage.mjs --published`): per brief-listable row what the published detail carries — SEC records, tiles with a value, SEC states, Code 33 states and the reasons Code 33 stays unknown. Reported financial history (up to 300 eligible rows, none under the carry) and earnings dates are fetched by their own tools; missing values stay unknown.

