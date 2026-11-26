# Stock Screener Context

Shared domain language for the stock screening platform. This file records project-specific terms so architecture reviews, implementation plans, and tests use the same names for the same concepts.

## Language

**Market**:
A supported trading region such as US, HK, IN, JP, KR, TW, or CN with one or more MICs, a primary calendar, a fallback default currency, and data refresh work. A Market may aggregate multiple MICs (e.g., Euronext groups XPAR, XAMS, XBRU, XLIS, XMIL, XOSL).
_Avoid_: region, locale

**MIC**:
ISO 10383 Market Identifier Code for an individual venue (XNYS, XNAS, XHKG, XPAR). The canonical exchange identifier inside SecurityMaster, calendar resolution, and snapshot keys.
_Avoid_: exchange code, venue code, bourse

**MIC Facts**:
Stable facts for one MIC, including calendar ID, timezone, default currency, and provider calendar ID when needed.
_Avoid_: market calendar facts

**MIC Alias**:
A backward-compatible informal venue name or legacy exchange label that resolves to one canonical **MIC** within a **Market** (e.g., US/NYSE → XNYS, IN/BSE → XBOM).
_Avoid_: exchange as canonical identifier

**Market Catalog**:
The backend-owned source of stable facts about supported Markets, including primary MIC, supported MICs, and capabilities.
_Avoid_: market constants, market config

**Market Capability**:
An app-visible feature available for a Market, such as breadth, group rankings, feature snapshot, or official universe.
_Avoid_: provider capability

**Field Capability**:
The availability state of a screening field for a Market based on provider coverage or computed data.
_Avoid_: market capability

**Provider Data Plan**:
The ordered provider execution strategy for one Market and dataset, with optional MIC-specific overrides.
_Avoid_: field capability matrix

**Default Currency**:
A fallback currency used only when creating identity before a row currency is known; MIC default currency is preferred over Market default currency when MIC context exists.
_Avoid_: market currency for FX

**Market Workload**:
The operational lifecycle state for work running against a Market, including refresh leases, activity progress, bootstrap readiness, and active holders.
_Avoid_: job status, task state

**Runtime Preferences**:
The mutable local choices for primary Market, enabled Markets, and Bootstrap state.
_Avoid_: market config

**SecurityMaster**:
The source of truth for a security's explicit identity fields: symbol, market, MIC, currency, timezone, and local code. The `exchange` field on existing models stores the MIC.
_Avoid_: ticker parser, suffix inference

**Universe**:
A named or structured set of tradable securities used by scans, refreshes, bootstrap, and static export.
_Avoid_: ticker list

**All Universe**:
The global Universe containing all active security rows across supported Markets, independent of Runtime Preferences.
_Avoid_: enabled markets universe

**Index Registry**:
The backend-owned source of index definitions used as Universe options, including owning Market, display label, and membership source.
_Avoid_: index enum

**Benchmark Registry**:
The backend-owned source of benchmark instruments used for relative-strength and scan comparisons.
_Avoid_: index registry

**Listing Tier**:
A board / segment classification within a Market and optionally a MIC (Euronext: Regulated/Growth/Access/Expand; HK: Main Board / GEM). Stored as an optional first-class Universe row field; used as a scan filter and breadth grouping axis.
_Avoid_: exchange group, board, segment

**Listing Tier Registry**:
The backend-owned source of canonical Listing Tier keys, display labels, and Market/MIC scoping.
_Avoid_: source tier labels

**Scan**:
A screening run over a Universe using one or more screening methodologies and filter criteria.
_Avoid_: search, query

**Scan Readiness**:
The backend admission decision that a Scan can run for a Universe with current enough data, required field coverage, and no blocking Market Workload conflict.
_Avoid_: market enabled state

**Bootstrap**:
The first-run hydration workflow that prepares selected Markets with universe, price, fundamentals, breadth, group ranking, feature snapshot, and initial autoscan data.
_Avoid_: setup, initial load

## Daily brief vocabulary (static app)

The words the brief's screens use (Japanese, as shown), so plans, tests and reviews name the same thing the same way.

**RS推計**:
The app's own relative-strength rank (1–99), computed from the published daily bars. Never IBD's RS Rating.
_Avoid_: RS, IBD RS, 独自RS

**RS線**:
The price divided by the S&P 500, drawn as a line. A different measure from **RS推計** and from IBD RS.
_Avoid_: RS推計 (for the line)

**SEC 今回未取得**:
The stock was not in this publication's SEC fetch. Temporary: a later publication may fetch it.
_Avoid_: 取得対象外, SEC 対象外

**SEC 対象外**:
The stock has no SEC identifier (no CIK in SEC's ticker map).

**SEC 不採用**:
An SEC record was fetched but refused at verification; the screen names the reason.

**配信側の問題**:
The publication delivered no SEC quarters at all (no same-day fetch, another schema, or no ticker map). Never the stock's own state.

**ウォッチの状況**:
Today's watch card: each watched stock's state today, not a change since the previous publication.
_Avoid_: ウォッチの変化

**ウォッチの注意**:
Today's tile that counts watched stocks whose buy setup broke. It reads 0件 only when every check is in.

**保有未登録**:
The brief keeps no holdings, so no sell count implies a holding.

**崩れ（独自判定）**:
A row's short form of 「買いの前提が崩れた／保有なら売りのサイン（独自判定）」: a heavy-volume break of the 50-day line with the close still below it, or the book's combined warning.

**保有なら売りのサイン**:
A row's short form of a holder's signal (a climax, the advance's largest down day). It means something only for a holding.

**一部未確認**:
Some weakness checks could not be judged. Never read as clear.

**上限超**:
Watched stocks beyond the sell checks' 12-stock limit. Their checks are 未確認.

**一覧外**:
The open stock is not in the list the dock steps through.

**注目候補（上位）**:
The list the dock steps through from Today or the market tab: the top focus candidates Today shows (「注目候補の上位5件」), never the whole focus pool.

**参考 / 試算のみ / 既定条件**:
The qualifiers on the stock's level tiles: 参考 when the stock is no buy candidate now (TT未達, TT未確認, a broken setup or ブレイク失敗, the market, an earnings date, and from round 2 the base check, 下落日の大商い and 停滞), 試算のみ when the market guide allows no new position or is unknown, 既定条件 when every plan input is still at its default. The plan's heading names the cause in 参考（…）: TT未達, TT未確認, 崩れ, 土台未確認, 地合い, 地合い未確認, 決算前 / 決算当日 / 決算後, 下落日の大商い or 停滞 (positionSizing's referenceReason).

### Round 2 terms

**ブレイク失敗（独自判定）**:
A breakout of today's pivot on 1.4× or more of the prior 50-day volume, within `failedBreakoutSessions` (10, 独自判定) sessions of the breakout itself (a run of touches may begin earlier), followed by a last close back under the pivot. A close at the pivot's cents is a touch (ピボット到達), not a breakout: the breakout is the first later close above the pivot, on that day's volume. It is a broken setup: the conclusion is neutral, the plan is 参考, the watch tile counts it, its headline leads the watch row and a watched focus row carries the same 崩れ chip (▲, the app's caution mark: see ▲ / ▼). From round 3 only breakouts from the pivot's own bar count (**上抜けの下限**); after the window the stock screen may add the neutral **ブレイク失敗後** line, which is no check.
_Avoid_: 失敗ブレイク, だまし

**上抜けからN営業日**:
The sessions since the latest close that broke above today's pivot (`lastPivotCrossing`, up to 60 sessions back and, from round 3, no earlier than the pivot's own bar, **上抜けの下限**; after a touch at the pivot's cents, the first close above it), named in the stock conclusion as 「M/Dに上抜け・N営業日前」, or 「ピボット到達からN営業日」 (wait, the touch's date in the line under it) when a touch was never followed by a close above. 「上抜けから60営業日超」 when every close in that window is at or above the pivot. Without a dated crossing the stock conclusion reads 「上抜け日 未確認」 and is never green. The rows have no bars (owner decision §9-11) and compare the day's two closes with the pivot in whole cents, as the conclusion and the chart do: a row whose previous close was already above the pivot's cents keeps its plain 「● 買いゾーン +x%」, green while the market is open and the base is current, and ranks below the day's events. A previous close at the pivot's cents is a touch only when the closes before it were below the pivot, and the rows cannot see those closes: it may as well be a pullback onto the pivot after an earlier breakout. So a close above the pivot's cents after one at them reads 「上抜け日 未確認」 on the rows (wait, never green or dated; 「うち上抜け」 leaves it out and the 上抜け filter counts it as 未確認), and a second close at the pivot's cents reads 「ピボットと同値のまま」 (wait). The conclusion tells them apart from certified bars: after a touch from below, the first close above it is that day's breakout (「M/Dに上抜け・出来高N×」 on the day's volume) or 「ピボット到達からN営業日」 while it stays on the cents; after an earlier close above the pivot, the breakout is dated from that close, on its volume and under the 停滞 / 押し戻し rule, as the chart's arrow marks it. The chart's arrow turns grey once the breakout is older than `staleBreakoutSessions`. Recording in the published audit whether the run at the pivot's cents began from below would let the rows date it too; that is a transport change for the owner.

**ピボット到達 / ピボットと同値のまま**:
A close at the pivot's cents after a close under it: 「M/Dにピボット到達」, green on that day only, as a stock arriving at its buy point. A later close at the pivot's cents is still a touch only while every close since the arrival stayed on the cents; the rows cannot see that far back, so they say what they see (「ピボットと同値のまま」, wait). The conclusion reads the bars: 「ピボット到達からN営業日」 (緑はピボット到達の当日のみ, 独自判定) while no close has broken out since the touch, or the earlier breakout's date when a close went above the pivot before this pullback onto it. Without certified bars it claims neither (ピボットに届いた日を確認できない).

**±0.0% / 0〜+0.1% / 0〜−0.1%**:
The distance from the pivot to one decimal: 「±0.0%」 only at the pivot's cents (whichever side of the cent the float noise in a published pivot falls), 「0〜+0.1%」 or 「0〜−0.1%」 (`distanceText`'s in-band forms; before UI slice S2 「+0.1%未満」 / 「−0.1%未満」) for a cent or more over or under the pivot that rounds to 0.0%; never 「+0.0%」 or 「−0.0%」. The in-band form is never broken after its 〜 (`KeepDistance`). The near call's gap keeps its own words, 「ピボット接近（あと0.1%未満）」 (「あと0〜」 would print あと0); a close at the pivot's cents that the shared position rule still puts just under the pivot reads 「ピボット接近（ピボットと同値）」, never 「あと0.1%未満」.
_Avoid_: +0.1%未満, −0.1%未満 (as a distance)

**▲ / ▼**:
▲ is the app's amber caution mark wherever it appears: 買いゾーン超過, 下落日の大商い, 分配日 (from round 3 only at 7 days or more; 5–6 take the neutral ○, see **分配日の参考／注意**), the market tab's 注意, and 崩れ / ブレイク失敗; the words beside it always name which. On the price chart ▼ is 上昇の加速 (a holder's sell-into-strength sign). On the sector table ▲N and ▼N are a rank that rose or fell N places, not a caution. The glyphs are hidden from assistive tech; the text names the event.

**停滞 / 押し戻し**:
A stock still in the buy zone `staleBreakoutSessions` (10, 独自判定) sessions after its crossing turns to wait: 停滞 when no certified close since the crossing went above the zone's top, 押し戻し when one did and the stock came back. New buying waits for the next pivot (次のピボット待ち).

**ステージ2（ベース形成中）**:
A flat 60-session base above a rising 200-day line, with SMA150 above SMA200 and the price within 25% of its 52-week high: stage 2, never stage 3 (the backend's stage classifier and `stagePhase`, from certified bars only). 「・日足から算出」 when the stage was computed on the screen.

**土台を確認できない / 土台未確認**:
The Setup Engine base is not current for the analysis date, or its confidence is under 55 (`SE_CONFIDENCE_FLOOR`) or missing (信頼度 未確認, never 0): the pivot and the plan are 参考 (独自判定). A certified VCP footprint does not override it (§9-13). On every row surface a buy-zone or near-pivot row with such a base is grey and says 「土台未確認」 in the RS chip's place (the conclusion's reason in its title and the row's label; a broken setup's 崩れ leads instead); Today's 注目候補 tile is green only while one focus row has a current base, its 「うち上抜け」 and the 上抜け filter leave such a row out (counted as 未確認), and the notes say why the rows are grey.

**収縮の中**:
The stop sits above the last contraction's low, inside the base, where normal swings reach it (独自判定). The stop never moves by itself.

**8%超で見送り候補**:
The structural stop is deeper than `STOP_WARN_PERCENT` (8%, 独自設定): a buy at the pivot carries a large risk.

**参考（地合い）**:
The plan's heading when the market guide is 0%: the shares are a reference only. The same 参考 qualifier names its other causes: the base check (土台), 下落日の大商い, 停滞, and 決算前 / 決算当日 / 決算後.

**未反映 / 鮮度未確認**:
The publication is older than the last closed NYSE session past `FRESHNESS_GRACE_HOURS` (28h, 独自設定): every bar reads 「分析基準日 M/D（曜）引け・N営業日前（M/D・M/D 未反映）」 in the warning tone. 鮮度未確認 when no valid exchange calendar is published; never 最新.

**TT未確認（N条件）**:
A trend-template row with N conditions that could not be judged and none failed. Never 「あと0条件」; with failures too it reads 「未達N・未確認M」.

**未収録**:
A field this publication does not carry (an older publication, before the field existed). Distinct from 未確認, which is a field that was published but could not be judged. The market tab's long form is 「未収録（この公開データには含まれていません）」 (`KEY_ABSENT`, marketTabGroups.js), used both for an older publication and for the round-3 market fields while their emission is off (`EMIT_R3_MARKET_FIELDS`); never 0 or a rate.

**未検証の足**:
Bars not certified for the analysis date. OHLC and moving averages still draw; the day change and volume ratio read 「（未検証）」, and nothing that judges the stock (pivot ratio, crossing mark, ADR, RS lead) is drawn from them.

**NAS調整中**:
Today's 地合い tile suffix and the verdict's sub-line when the guide is open while the Nasdaq is in correction, a rally attempt or a failed FTD. The verdict, its tone and the caps are judged on SPY only (判定はSPYのみ).

**FTD確認済み**:
The 地合い tile suffix when the guide is 0% while the backend regime is an FTD-upgraded uptrend (`ftdUpgraded`); the basis line says why the guide stays 0%. From round 3 it shows only when the same day's ^GSPC record (**同日の記録**) is `confirmed`; one session behind, the tile has no suffix.

**参考（市場の注意サイン）**:
A market check marked 〔参考〕 is counted apart from the 注意 signs (「▲ 注意サイン N件・参考 M件」), takes a neutral ○ and never sets a tab's ▲.

**判定不可（注意サイン）**:
The warning headline when no 注意 sign could be judged: 「注意サインを判定できません」, never 0件 or なし.

**26-03期**:
A fiscal quarter named by its year and end month (YY-MM). It is a period, not a negative number, so the U+2212 rule does not apply to it.

**RS線 新高値**:
The RS line (never RS推計) at a new high on the analysis date. The rows read only the published `rs_line_high` dated for that day (`publishedRsLineHigh`): absent is 未収録 there, a published null is 未確認. The stock view reads the same field and, when the row has none for that day (an older publication, such as a UI-only republish, or one dated for another day), falls back to `rsLineNewHigh` on the bars certified for that day; a published null stays 未確認.

### Round 3 terms

Fundamentals and SEC (track DATA):

**code33_parts（Code 33 の3つの部分）**:
The coverage report's count of Code 33's three parts on listed rows: EPS acceleration, sales acceleration and margin improvement (`code33_parts.{eps_acceleration, sales_acceleration, margin_improvement}`, report-data-coverage.mjs), with `eps_acceleration_pass_symbols` (the first 25 passing listed symbols, for a hand check against filings). EPS acceleration (加速) is a rise in the quarterly EPS growth rate, not the EPS ≥ 25% floor (that is **eps_floor_25**). Code 33 stays a bonus, never a gate.
_Avoid_: the EPS condition, the 25% count

**eps_floor_25**:
The card's 「EPS ≥25%」 chip counted over listed rows with a current SEC report, for the latest 2 and 4 quarters (`eps_floor_25.{last2, last4}`, read from bookFinancialEvidence's `epsFloor[2|4].at25`; the report defines no threshold of its own).

**q4_only**:
`round2.eps_unknown.q4_only`: listed rows whose EPS acceleration is unknown and whose listed causes are all fiscal-Q4 causes (`Q4_EPS_CAUSES`: `fiscal_q4_untagged`, `latest_row_fiscal_q4_without_eps`). An upper bound: causes `epsUnknownCauses` does not list (no base, an ambiguous base, a non-Q4 row not reported) can hide behind a Q4 cause. A row with no listed cause is not counted.

**setup_ready_liquidity**:
setup_ready split by the brief's own liquidity rule (`briefLiquid`, `setupReadyLiquidity`, report-data-coverage.mjs: `filterRanked`'s liquidOnly, the call useBriefData makes; no price or dollar-volume line is copied). Measurement only. A row without a finite price or ADV counts as illiquid and in `missing_price_or_adv`; when no listed row has both, the split is null (未計測), never "all illiquid".

**Q4算出**:
The one term for a fiscal Q4 derived as the 10-K year less three quarters (`Q4_DERIVED_MARK` 「（Q4算出）」, `Q4_DERIVED_SOURCE_NOTE`, `Q4_DERIVED_LEGEND`, fundamentalsExplain.js), on sales and margin only, never EPS (`q4DerivedRate`). The quarter table's axis cell reads 「算出」: on a phone the source line keys it whenever a row in the window is derived (`q4DerivedSourceNote`); on the desktop the legend keys it, and the source line names it only when a tile is derived.

**参考 Q4 EPS / 独自計算・判定に使わない**:
A 独自計算・参考 fiscal-Q4 EPS for filers that report the fourth quarter only in the 10-K: Q4 net income over Q4 diluted weighted shares (method `q4-ni-over-q4-diluted-shares-v1`, `Q4_REFERENCE_METHOD`, sec-financials.py; its bands and checks are 独自設定). 「独自計算・判定に使わない」 names a value that enters no verdict, score, filter or sort; Code 33 stays 未確認 for that quarter, and the value is never counted (OD1). In round 3 only the producer ships: it logs `SEC q4 reference accuracy <date>` and writes the file-level `coverage.q4_reference` aggregate, and `Q4_EPS_REFERENCE_EMIT = False`, so no record carries `q4EpsReference`. Its display (admission of the key, the card's 参考 line and dashed marks) was held at integration (commit cc326e9a), so today's admission refuses a record with the key. Emission waits until the revert of that hold is live on Pages and the owner has seen the accuracy line.

**SEC payload cik**:
The run's log-only count of how each received companyfacts payload wrote its `cik`, by outcome (`cik_kind`: int, digits, missing, null, text, bool, not_object or another JSON type; the `SEC payload cik <date>` log line and the step summary). Never in a record. `payload_cik` reads a non-negative int or 1–10 ASCII digits as the CIK; anything else, a missing or null cik included, still fails the identity check (PayloadMismatch, OD13).

Readiness and the verdict (track R):

**ピボットの足 / 上抜けの下限**:
ピボットの足 is the daily bar that made the Setup Engine pivot (`pivotBar`, pivotBar.js): the day's bar for a daily pattern; for a weekly pattern the last bar in `se_pivot_date`'s week whose high equals the pivot in whole cents; null when there is none, never guessed. 上抜けの下限 (the crossing floor, `crossingFloor` = `pivotBar(bars, row)?.index`, breakoutHistory.js) is that bar itself: the failed-breakout check, the conclusion's crossing, the chart's arrow, the watch rows and Today count crossings only from it. A close on the pivot's bar cannot clear its own high, so it is at most a touch, and the breakout is dated on a later bar. With no floor (no `se_pivot_date`, no matching bar, a vcp pattern) every reader is unbounded as before. The stock screen reads `se_pivot_date` from the index row only (useBriefData.js drops a detail-only one), so on a publication whose index lacks it every screen is unbounded alike. A clear check whose pivot bar is inside the window reads 「このピボット（M/D）以降の上抜けなし」 (`noBreakoutSincePivot`).

**低変動・監視のみ（3つの規則）**:
A row whose `price_activity.lowRange` holds (priceActivity.js, written by the exporter). The first rule that holds is its `reason`: `range60`, the 60-session high-to-low range under `LOW_RANGE_PERCENT` (5%, the brief's rule from before round 3); `since_gap`, ギャップ後の低変動: the largest one-day close-to-close move in 60 sessions is `GAP_MOVE_PERCENT` (10%) or more and the `SINCE_GAP_MIN_SESSIONS` (15) or more sessions after it range under `SINCE_GAP_RANGE_PERCENT` (3%); `adr`, ADR20 (the mean of high ÷ low − 1 over `ACTIVITY_ADR_SESSIONS`, 20) under `LOW_ADR_PERCENT` (0.5%). Those last four are 独自設定 (OD6). A missing value, or fewer than 60 bars, never makes a row low. The conclusion and entry readiness print the rule with 「（独自設定）」 (`lowActivityReason`, `lowActivityNote`), the plan is blocked (`PLAN_BLOCKED.low`) and flagged rows sort last. The since-gap text calls the move 窓開け although it is close to close, so a one-day run without an opening gap is also called 窓開け.

**前の土台**:
A contraction base that broke out (`base.brokeOut`, `base.breakoutDate`) before the pivot's bar. Its low is never this pivot's structural stop: the stop reads 「前の土台（M/Dに上抜け済み）」 (`previousBaseReason`, positionSizing.js), with no fixed percentage in its place.

**price_pinned**:
The Setup Engine readiness failed check for the same three low-activity rules, ported to Python with the same constants (readiness.py `price_pinned`; config.py, pinned to priceActivity.js by test_setup_engine_parameters.py). The screener passes it with the caller's failed checks, so it fails `derived_ready`; it is not an 11th gate, and the ten gates keep their names and order.

**contraction_unconfirmed / pivot_already_crossed / pivot_below_base_high**:
Three Setup Engine diagnostics in `explain.diagnostics` only (readiness.py `setup_diagnostics`): never in `failed_checks`, never readiness, and present only when found (a missing value is no finding). `contraction_unconfirmed`: the brief's automatic contraction measurement, ported, finds no valid run (the chart's 「収縮は未確認」). It still ports the measurement from before the pivot-breakout cut (**上抜けの足**), so on cut rows it can disagree with the brief. `pivot_already_crossed`: a close after the pivot's bar more than `PIVOT_ALREADY_CROSSED_PCT` (3%, 独自設定) above the pivot. `pivot_below_base_high`: the pivot more than `PIVOT_BELOW_BASE_HIGH_PCT` (5%, 独自設定) under the base's high; a record, never a verdict.

**ゲート8（ステージ）**:
Setup Engine readiness gate 8 reads the stage the Minervini scanner publishes (`_published_stage`, setup_engine_screener.py, through the scanner's own `WeinsteinstageAnalyzer.determine_stage`) and requires stage 2; None (a missing moving average) passes. The payload's `stage` (the index's `se_stage`) is the same value. It is readiness input only: the trend template stays the 8 published conditions, and stage is never a 9th veto.

**ブレイク失敗後**:
The stock screen's neutral, dated line after a failed breakout's window: 「ブレイク失敗後（M/D上抜け→M/D割れ・その後の安値 −x.x%）」 (`failedBreakoutContext`, briefSell.js), in the conclusion and outside the sell card's fold. It shows only when the check is clear, the last close is under the pivot's cents, and the first close back under the pivot came within `failedBreakoutSessions` (10) of a breakout on 1.40× volume or more; the low is the lowest low since that close, from the pivot. It is no check: no chip, mark, tile, count or plan change, and no new threshold (OD9).

**上抜けの足（ピボットの上抜け）**:
The first bar after the pivot's bar whose close is above `se_pivot_price` in whole cents (`pivotBreakout(bars, row)`, bookTechnicalEvidence.js; 独自判定, no threshold); a close at the cents is a touch. Its state is `unknown` without a pivot bar, `none` before any close above, or `cut` with `measuredThrough` the day before. Contractions are measured only on the bars before it (`vcp.pivotCut`; `BOOK_TECHNICAL_VERSION` v3, so the screen re-measures published v2 evidence). It is the pivot's breakout, not the base's: `base.breakoutDate` (the first high above the base's high) keeps its meaning. The cut reads the same row as the crossing floor, so it is off on a publication whose index lacks `se_pivot_date`.

**上抜け後の値動き**:
Price action from the pivot's breakout on. It is never a contraction (T), and the structural stop never takes a leg that ends on or after the breakout (`structuralStop`'s `breakoutDate`); when every leg is excluded the stop is unknown with `POST_BREAKOUT_LEGS_REASON` 「収縮はすべてピボットの上抜けの後の値動き」.

**割り込み済みの収縮の安値**:
A chosen last contraction low that a later certified bar's low has traded under. It is never a structural stop (独自判定): the stop is unknown with `UNDERCUT_LOW_REASON` 「最後の収縮の安値をその後の日足が割り込み済み」, with no low, stop or percent, and no fallback to a fixed percentage or an earlier leg. The rule does not read `se_pivot_date`.

The market (track MARKET):

**前回のFTD**:
The app's own index FTD record confirmed more than `FTD_RECENT_SESSIONS` (25) sessions ago; never read as a current FTD. The word lives only in `FTD_PREVIOUS_NAME` (briefEnvironment.js), which the FTD row, the ◆, the opened row and both cause lines read.

**反発n日目**:
The sign line of Today's **地合いゲート** (before slice S1, the 地合い tile's suffix) while the guide is 0% and the same day's ^GSPC or ^IXIC record is a rally attempt; n is the attempt's day (`MARKET_TILE_SUFFIX.rally`, briefEnvironment.js). The gate's line names the index on the larger day before the word and says what the sign is after it: 「NAS 反発3日目（参考・目安は不変）」 (both indices on the same day: 「S&P・NAS …」; `rallyIndexNames`, `SIGN_NOTE`); the open guide's Nasdaq caution reads 「NAS調整中（参考・目安は不変）」 the same way.

**指数の分配日**:
The two indices' own effective distribution days over 25 sessions (^GSPC and ^IXIC, 「S&P n日・NAS n日」), counted from the app's index records. Not the count the regime's verdict reads (the backend's SPY count, 「分配日（局面判定が数えるSPY）」, 4日以上で上昇に圧力): on Today's **地合いゲート** fold it is named 「指数の分配日（25日）」 and read 「判定には使わない別集計」 (`INDEX_DISTRIBUTION`, marketGate.js); the 市場 tab's row keeps 「分配日（25日）」.

**分配日の参考／注意**:
Effective distribution days graded in two steps (marketTabModel.js, 独自設定): 5–6 (`DISTRIBUTION_REFERENCE`) are 参考 (○, not counted among the 注意 signs), 7 or more (`DISTRIBUTION_CAUTION`) are 注意 (▲).

**銘柄側（参考）**:
The reference line beside the market verdict (`STOCK_SIDE_HEAD` 「銘柄側（参考・目安は変えません）」, marketTabGroups.js): TT達成数 and its value a month earlier, the **上抜け維持（確定分）** rate and count, and the leaders' health and count. It does not move the guide and is no 注意 sign.

**上抜け維持（確定分）**:
Of the 52-week-high breakouts 10–29 sessions ago, the share that did not reach −7% in the next 10 sessions (`BREAKOUT_HOLD_NAME`, briefEnvironment.js; the long-run explorer uses the same name). Formerly ブレイクアウト成功率. A 52-week-high breakout, not a base pivot's (`BREAKOUT_NOT_PIVOT`).
_Avoid_: ブレイクアウトの成功率

**早期（上抜け後5営業日）**:
The breakouts 5–9 sessions ago, read on the lows of the following `BREAKOUT_EARLY_SESSIONS` (5) sessions: the share that reached −7% (独自設定). Its window never overlaps the 確定分 window.

**ストーリング日（独自近似）**:
An approximation of the backend's conditions: an up day of +0.2% or less on higher volume, closing in the lower half of the day's range, within 3% of the 25-day closing high, expiring after 25 sessions (`STALLING_METHOD`, export-market-trends.mjs). IBD's definition is not public. Counted apart, never in the distribution count. Unlike the backend it does not drop a day after a later close 5% above it; that is settled before emission.

**うち終値でも更新**:
Of the 52-week new highs, the stocks whose close also cleared the prior 251-session high (`newHighsClose`).

**RS推計90以上（コホート）**:
The stocks that met the trend template with RS推計 of 90 or more 20 sessions ago and are still observed (`rs90Cohort`), and the share of them above their 50-day line (`rs90CohortAbove50`). RS推計, never IBD RS.

**現在の下落（FTD 後）**:
After a confirmed FTD, the fall from the high to the close of the lowest day since (followThroughDay's `declinePct`); 6% is where the app judges a correction (独自設定).

**+3%以上の上昇日**:
The count of days up 3% or more on the prior close (〔参考〕, not a buy signal; the heading is `BIG_UP_HEAD` 「+3%以上の上昇日（独自設定）」, marketTabStudy.js). The +3% is Minervini's figure; how the app uses it is 独自設定.

**同日の記録**:
The index's judged record dated the analysis day (`sameDayFollowThrough`, briefEnvironment.js): a ready series, an available record, and `asOf` equal to the asset's and the manifest's date.

**更新待ちの判定**:
The market tab's verdict sentence once a later session has closed and no publication has come (`verdictWaiting`, marketTabModel.js): 「M/D引け時点の判定です。新しい公開を待っています（買いの検討は最新の判定で）」. No grace period: it shows from the next session's close until the publication lands, while the bar's stale warning waits `FRESHNESS_GRACE_HOURS`. Since slice S1 Today says the same with an open guide: the **地合いゲート**'s headline is its short form 「10/2時点の判定・更新待ち」 (the verdict block at 1024px and wider its long form) and the figure is labelled 「新規買いの目安（10/2時点・独自設定）」, never 検討できる. The last closed session (`target`, marketUpdateState's) is always passed in; no pure function reads the clock.

**0% の注記**:
The sentence saying that the 50日線割れ verdict's 0% is 独自設定 and untested.

The chart and the VCP card (track CHART):

**ピボットの日**:
The VCP card's line naming the pivot's own bar, found by `pivotBar` on certified bars: 「ピボット $X＝M/Dの高値（SE）」, with 「（週足の型）」 for a weekly pattern (`pivotDayNote`, StockVcpCard.jsx). Shown only when the screen's pivot is the current Setup Engine pivot in whole cents. 「ピボットの日 未確認」 (`PIVOT_DAY_UNKNOWN`) when there is no bar; `se_pivot_date` itself is never printed. The day ends the base note when one shows; a standalone 未確認 shows only at 1024px and wider. It reads the index row, so a publication whose index lacks `se_pivot_date` reads 未確認.

**静かな日**:
「静かな日 N/10日（SE）」 (`quietDaysText`, StockVcpCard.jsx): the Setup Engine's `quiet_days_10d` over its own 10 sessions (`QUIET_DAYS_WINDOW`, the field's window, not a threshold of the brief's), days whose volume is under 0.8× its 50-day average and whose true range is under ATR14. A real 0 prints 0/10; a missing or invalid value prints nothing.

### UI slice S1 terms (the market gate)

**地合いの帯**:
The one value every surface that states the market verdict in a line reads (`marketBand`, marketGate.js): subject 地合い, the answer, the guide and the kind labels. Its line reads 「地合い 検討可・目安 最大50%」, 「地合い 買いは控える・目安 0%」, 「地合い 10/2時点の判定・更新待ち」 (an open guide once a newer session has closed), 「地合い 未確認・買いは見送り」 or 「地合い 読込中」; the unknown and loading forms carry no figure and no 「%」, and the kind labels sit beside what they label (判定＝独自判定・目安＝独自設定), never as a bare 独自. In slice S1 it is a model only: the bar of 候補 and ウォッチ and the wide bar's chip were not built (the fit proof found states with no form that fits: the waiting form at 320px (when late, also at 375px), and a late publication at 0% with both kind labels and the calendar-less bar at every phone width), so every bar is as before; **地合いゲート** reads its answer and figure from it. Since slice S2 the stock screen's **結論（銘柄画面）** reads it too, as its first line.
_Avoid_: band (in Japanese copy), 地合いバー

**地合いゲート**:
Today's market card (`TodayGate`, model `marketGate`, marketGate.js), in the region named 地合い. On a phone its first fold carries every rule-bearing line and nothing is trimmed: the kicker 「地合い・10/2（金）引け」 (with 「・n営業日前」 in the warning tone on a late publication; below 375px a late kicker leaves out the weekday, 「地合い・10/2引け・2営業日前」, which the bar's date line still gives), the headline (買いは控える, 新規の買いを検討できる, 「市場未確認・買いは見送り」 naming what is unknown, or the waiting form of **更新待ちの判定**) with （独自判定）, the **新規買いの目安** with its label and definition, one 根拠 line (実測), each **再開の条件** that is 未達 or 未確認 by name, the sign line, Today's note, each firing ▲ and the status alert. The rest is in one fold (closed on a phone, in place at 1024px and wider): the 判定 row with the regime's label, the facts in three groups (根拠（指数側）, 広がり（参考）, 銘柄側（参考・目安は変えません）) each with its **種別**, the conditions that are met, the sign's sentence, the ○ 参考 notes, the conflict sentences, the full 根拠 and 未検証. It replaced the 地合い tile and the phone's facts block. It adds no state, threshold, score or gate: every word comes from modelMarket's verdict, marketLines, capText, verdictWaiting and verdictBasis.
_Avoid_: 地合いタイル (removed), market gate (in Japanese copy)

**新規買いの目安**:
modelMarket's cap printed through `capText`: 「最大50%」, 「最大25%」 or 「0%」 (MARKET_CAPS, unchanged), labelled 「新規買いの目安（独自設定）」 (「新規買いの目安（10/2時点・独自設定）」 in the waiting form) and defined in the first fold as 「最大50%＝新規建ての上限（口座比・独自設定）」 / 「0%＝新規建ての上限（口座比・独自設定）」. Its levels are untested (`GUIDE_UNTESTED`, in the fold). An unknown or loading market has no figure, no definition and no 「%」. It caps new positions as a share of the account; it is not a buy recommendation, and nothing on the stock side moves it. It replaced the tile's 「目安≤N%」.
_Avoid_: 目安≤N% (the removed tile's form)

**再開の条件**:
The three conditions in modelMarket's rule order (`resumeConditions`, marketGate.js; `CONDITION_LABELS`): 「SPY終値が200日線の上」, 「SPY終値が50日線の上」 (both read by `marketLines` from the same rows and filter as modelMarket) and 「局面判定が上昇トレンド／上昇に圧力」. Each is 達成, 未達 or 未確認; all three are met exactly when the cap is above 0 (a property test). On a 0% day the list is 「買いの再開の条件（独自設定）」, on an open day 「目安が動く条件（独自設定）」. The first fold names each unmet or unknown one (「SPY終値が50日線の上：未達」, 「局面判定が上昇トレンド／上昇に圧力：未達（いま 調整）」), the met ones are in the fold, and an unknown market reads 「再開の条件：未確認」, never 未達 or 達成. No count of conditions (「n条件中」) is ever printed.
_Avoid_: n条件中, 達成率

**種別（実測／独自判定／独自設定）**:
What kind of statement a gate fact is, fixed per fact by `FACT_KINDS` (marketGate.js, pinned by a vitest) from seven kinds (`GATE_KINDS`): 実測 (a measured fact: SPY against its lines, the 根拠 line), 独自判定 (the app's own judgement: the verdict, the signs), 独自設定 (the app's own setting: the guide, the conditions, a threshold), 実測・基準は独自設定 (a measured count read against the app's threshold: the regime's SPY distribution count, **上抜け維持（確定分）**), 実測・参考 (measured, not part of the verdict: the indices' distribution days, new highs and lows, the share above the 200-day and 50-day lines), 独自集計（RS推計を含む） (TT達成; RS推計, never IBD RS) and 独自定義 (the leaders' health). A fact without a value has no kind (「—」, `NO_KIND`) and carries its own absent words, never 0. S1 prints the kind as a tag beside each fact of the gate's fold.
_Avoid_: 独自 (bare), ソース

### UI slice S2 terms (B's stock screen)

**ゾーン上限**:
The buy zone's upper edge, the pivot + 5% (`view.upper`), and its one name on the stock screen (minor B1, S2-P3). The price chart's label by the band's top reads 「ゾーン上限 116.28」 (before S2-P3: 「買いゾーン 〜116.28」); when no spot is free for that label, the chart names the band itself, 「買いゾーン」, with no price (a band, not a level). The chart's price gutter is plain text for the levels (ピボット, 損切り, 安値, a level named at the axis), each in its line's ink, with one filled plate: the last close (終値).
_Avoid_: 上限+5%, 買いゾーン 〜X (as the level's name)

**判定なし（売りのサイン）**:
A sell check this stock is not judged by (its reason says why, 「…のため判定しません」): the sell card's row, its quiet fold's summary (「サインなし n件・判定なし n件」), the strength note (「上昇の加速は判定なし（…）」) and the status sentence (「判定なしの項目 n件。」, never 「いま出ているサインはありません」 while one is not judged) all say 判定なし (plan D9, S2-P5; before: 判定せず and 「判定していない項目 n件」). One word for the state; never 対象外 (SEC, funds and unlisted watch symbols only), never 0. The 市場 tab's 「判定していない項目」 counts market signals, not sell checks, and is unchanged.
_Avoid_: 判定せず, 判定していない項目 (on the sell card)

**仮の損切り**:
The sell card's provisional stop (S2-P6, BEH-1, plan D8): the pivot −7.0% (`stopLevel.js`, `PROVISIONAL_STOP_PERCENT`), this app's own setting, printed 「仮の損切り $93.00（ピボットの −7.0%・独自設定）」. One level for every viewer whatever the plan's stop setting, so whether a stock reached it is a fact of the data, not of a device. It is judged and printed from one number, the level's whole cents rounded half up from the pivot's cents (a pivot of 10.50 gives 9.77). The plan keeps its own stop (損切り, `positionPlan`'s unrounded `stop`); when the two print differently (another stop setting, the structural stop, a four-digit pivot) the row names both, each under its own name: 「仮の損切り X（ピボットの −7.0%・独自設定）／計画の損切り Y（設定 −5.0%）」 (or 「（構造 −n%）」).
_Avoid_: 損切り (for this level), one name with two numbers

**損切りに到達（保有なら）**:
The sell card's stop row (S2-P6, BEH-1, `stopReachedCheck`, `sells.stop`): whether the lowest low of the bars after the breakout bar (breakoutBar of the last pivot crossing within 60 sessions, with the crossing floor) is at or under the 仮の損切り's cents. States: 該当 (bold, in the `--neg` ink, on one line, never ▲), 該当なし, 判定なし with the reason (a buy-zone stock: 「計画の買値は M/D 終値・その後の日足はまだありません」; a breakout on the analysis day; no dated breakout, naming the bound that left none: 「直近60営業日に上抜けの日付なし」 or 「ピボットの日以降に上抜けなし」, or 「ピボット到達のみ・上抜けの日付なし」; no pivot: 「ピボットが未確認」) and 未確認 (a low or close missing where it is read, or sell checks that cannot be judged), never 該当なし for a missing value. It is a holder's fact beside the sell checks, never one of them: it is in no count (`tally()`, 「n件のサイン」, the quiet fold's two counts), chip, chart mark, watch tile, gate or plan (counting it is BEH-2, an open owner decision). The card's status sentence never contradicts it: at 該当 it says 「損切りの行：仮の損切りに到達しています（サインの件数には含めていません）。」 (in place of 「いま出ているサインはありません。」, or after any other sentence), at 未確認 「損切りの行は未確認です。」. On a phone a quiet row is the first line of the quiet fold, whose summary gains a segment of its own after the two counts, 「／損切り判定なし」 or 「／損切り該当なし」; a 該当 or 未確認 row stays outside the fold; at 1024px and wider the row is always in place.
_Avoid_: 損切りのサイン, ▲該当, counting it among 売りのサイン

**Setup Engineの準備条件**:
The VCP card's Setup Engine line, 「Setup Engineの準備条件（トレンドテンプレートとは別）：土台 N週・深さ N%」 with the pivot's own day after 「・」 (S2-P5, minor B9; before: 「Setup Engine：」). Shown only while the Setup Engine's recalculation is current for the analysis date. The qualifier keeps it apart from the trend template (the 8 published conditions); the lead spells out Setup Engine. The pivot-day note at the line's end keeps its own 「（SE）」 tag, as 「静かな日 N/10日（SE）」 does (minor C2's gloss question for those tags is open).

**結論（銘柄画面）**:
The stock screen's conclusion card (`StockVerdict`, region 結論, `data-gate` = buyGate's kind) in B's form, two lines (S2-P1). Line 1, the market line: **地合いの帯**'s answer and **新規買いの目安** with the analysis date and each kind beside what it labels, 14px in the text ink on every day: 「地合い 10/2：検討可（独自判定）・目安 最大50%（独自設定）」, 「地合い 10/2：買いは控える（独自判定）・目安 0%（独自設定）」, once a newer session has closed with an open guide the **更新待ちの判定** form 「地合い 10/2時点の判定・更新待ち（独自判定）・目安 最大50%（10/2時点・独自設定）」 (the same `target` as Today and the 市場 tab), and on an unknown market 「地合い 10/2：未確認・買いは見送り」 (no figure). It breaks only after a 「：」 or a 「・」. Line 2 is labelled 銘柄 and is buyGate's own title and line, unchanged; a sell chip the call does not state, or a near earnings date under another gate, joins the 銘柄 label in its own short words (「銘柄・決算まで3日」). The level tiles and the chips are under the chart card (S2-P2's strip takes the tiles' place); the pivot meter is not drawn on the stock screen (its one sentence for an unknown pivot, 「ピボットを確認できないため位置は未確認です。」, is a line under the tiles). On a waiting day only line 1 changes: buyGate's title, tone and plan are as published.
_Avoid_: ピボットのメーター (retired from the stock screen)

## Relationships

- A **Market Catalog** describes many **Markets**.
- A **Market** has one or more **MICs**; one MIC is primary.
- **MIC Facts** provide calendar and timezone data for each **MIC**; Market-level calendar calls use the primary MIC as fallback.
- Market-level display timezone is derived from the primary **MIC** and is not canonical for every MIC in the Market.
- A **MIC Alias** resolves to exactly one **MIC** within a **Market**; it is not a canonical venue fact.
- A **Market** may have one **Default Currency**, while each security row has its own currency for FX normalization.
- A **MIC** may have a narrower **Default Currency** than its **Market**.
- A **Market Workload** belongs to exactly one **Market**.
- **Runtime Preferences** choose which **Markets** are active locally; they do not define the **Market Catalog**.
- The backend exposes **Market Catalog** facts to the frontend through runtime capabilities.
- The **Market Catalog** records **Market Capabilities**; **Field Capabilities** are derived from provider coverage and computed-data coverage.
- A **Provider Data Plan** chooses provider execution order for a Market and dataset; a MIC-specific override may refine it for one venue.
- A **SecurityMaster** resolves securities within a **Market**, identified by **MIC**.
- Row timezone may be stored on a security for compatibility, but **MIC Facts** are the source of truth for calendar decisions.
- A **Universe** is scoped by **Market**, **MIC**, **Listing Tier**, index, custom symbols, or test symbols.
- The **Index Registry** defines index Universes; index membership rows are data, not Market Catalog facts.
- The **Benchmark Registry** defines comparison instruments; a benchmark is not necessarily an index Universe.
- The **All Universe** spans all active rows globally; enabled **Runtime Preferences** do not narrow it.
- A security in a **Universe** may have one **Listing Tier**, scoped by Market and optionally MIC.
- The **Listing Tier Registry** defines canonical tier keys; source labels are mapped during Universe ingestion.
- A security row is keyed by canonical symbol today, while `(Market, MIC, local code)` must remain unique for active rows.
- A **Scan** runs against exactly one **Universe**; that **Universe** may span multiple **Markets**.
- **Scan Readiness** is evaluated for a **Scan** and its **Universe**; it is not the same as a Market being enabled.
- **Bootstrap** creates **Market Workloads** for the primary and enabled **Markets**.

## Example Dialogue

> **Dev:** "Should the frontend import the **Market Catalog** directly?"
> **Domain expert:** "No. The backend owns the **Market Catalog** and exposes the current **Market** facts through runtime capabilities."
>
> **Dev:** "Should **Market Workload** decide whether a **Scan** can start?"
> **Domain expert:** "No. The **Scan** path owns scan-blocking policy; it asks **Market Workload** for current activity state."
>
> **Dev:** "Does the **Market Catalog** include enabled Markets?"
> **Domain expert:** "No. Enabled Markets are **Runtime Preferences**; the **Market Catalog** only describes stable supported-Market facts."

## Flagged Ambiguities

- "Market config" previously mixed stable **Market Catalog** facts with mutable **Market Workload** state. Resolution: stable facts belong to **Market Catalog**; operational state belongs to **Market Workload**.
- Queue names are **Market Workload** implementation details derived from **Market** codes, not **Market Catalog** facts.
- **Market Catalog** may include coarse provider capability facts, but provider routing policy remains behind provider-specific modules.
- "exchange" on existing models (`MarketProfile.exchanges`, `StockUniverse.exchange`) historically mixed MICs (XNYS) and informal venue names (NYSE). Resolution: **MIC** is the canonical identifier going forward; existing string aliases are kept as backward-compatible lookups but new code keys on MIC.
- **Market Catalog** owns canonical MIC facts only. **MIC Aliases** are Market-scoped compatibility lookup facts that belong to surfaces such as SecurityMaster or MarketRegistry and may be exposed to clients only under explicit alias fields.
- Legacy exchange alias resolution requires **Market** context unless the alias is explicitly known to be globally unambiguous.
- Calendar resolution is MIC-level. Market-level calendar APIs are compatibility defaults that resolve to the Market's primary MIC.
- "Market currency" previously meant both **Default Currency** and row currency. Resolution: **Default Currency** is fallback-only; FX normalization uses the security row's currency whenever row context exists.
- "Capabilities" previously mixed **Market Capabilities** with **Field Capabilities**. Resolution: **Market Catalog** owns app-visible Market availability; provider and screening-field coverage live outside the **Market Catalog**.
- **Provider Data Plan** is not a field matrix. Resolution: it owns provider execution order, fallback, batching, and provider keys; **Field Capability** owns field-level support.
- **Provider Data Plans** default to Market-level policy; MIC-specific overrides are used only when one MIC inside an aggregated **Market** has distinct provider behavior.
- Index definitions do not belong directly to the **Market Catalog**. Resolution: the **Index Registry** owns canonical index definitions; runtime capabilities may expose derived summaries.
- Benchmark definitions are separate from index definitions. Resolution: **Benchmark Registry** owns comparison instruments; **Index Registry** owns Universe index definitions.
- **Listing Tier** is not source-only JSON metadata. It is optional, queryable **Universe** row metadata; source-specific labels may remain in lineage metadata.
- **Listing Tier** labels are not global. Resolution: tier definitions/options are Market-scoped and may be MIC-scoped when a Market spans venues with distinct tier systems.
- **Listing Tier** definitions do not belong directly to the **Market Catalog**. Resolution: the **Listing Tier Registry** owns canonical tier definitions; runtime capabilities may expose derived summaries.
- **Listing Tier** changes are audit events, not active/inactive lifecycle statuses.
- "All" previously risked meaning "all enabled Markets." Resolution: **All Universe** means all active rows globally; runtime jobs use explicit Market-scoped Universes.
- Multi-Market scans are not multiple **Scans** by default. Resolution: one **Scan** has one **Universe**, and row-level Market/MIC/currency plus mixed-market policy govern result semantics.
- **Universe** row identity remains canonical symbol for now, but `(Market, MIC, local code)` is a required active-row invariant.
- "Scan-ready Market" previously risked meaning only enabled in Runtime Preferences. Resolution: **Scan Readiness** is a scan-admission decision using Universe data, freshness, field coverage, and Market Workload state.
- "対象外" appears in three places in the brief. Resolution: SEC's word is always **SEC 対象外** (no CIK), never for a stock this publication merely did not fetch (**SEC 今回未取得**); the fundamentals card's 対象外 is a fund; the watch tile's 対象外N counts watched symbols this publication does not analyse (delisted, renamed or missing), whose state is 未確認, never 0. A sell check that is not judged for a stock (its reason reads 「…のため判定しません」) is **判定せず**, never 対象外. The dock's word for a stock outside its step list is **一覧外**.
- The breakout row has one name in the app, **上抜け維持（確定分）** (`BREAKOUT_HOLD_NAME`), on the 市場 tab and in the **地合いゲート** alike; the UI plan wrote 上抜けの維持. Resolution: the app prints the constant only; a rename is the owner's decision and changes every surface at once.
- "RS" alone is ambiguous between the app's rank, the RS line and IBD's RS Rating. Resolution: the rank is **RS推計** (独自計算), the line is **RS線**, and IBD's value is never shown as either.
