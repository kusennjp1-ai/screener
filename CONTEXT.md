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
A crossing of today's pivot on 1.4× or more of the prior 50-day volume, within `failedBreakoutSessions` (10, 独自判定) sessions, followed by a last close back under the pivot. It is a broken setup: the conclusion is neutral, the plan is 参考, the watch tile counts it and its headline leads the watch row (▼).
_Avoid_: 失敗ブレイク, だまし

**上抜けからN営業日**:
The sessions since the latest close that crossed today's pivot (`lastPivotCrossing`, up to 60 sessions back), named in the conclusion as 「M/Dに上抜け・N営業日前」. 「上抜けから60営業日超」 when every close in that window is at or above the pivot. Without a dated crossing the zone reads 「上抜け日 未確認」 and never green.

**停滞 / 押し戻し**:
A stock still in the buy zone `staleBreakoutSessions` (10, 独自判定) sessions after its crossing turns to wait: 停滞 when no certified close since the crossing went above the zone's top, 押し戻し when one did and the stock came back. New buying waits for the next pivot (次のピボット待ち).

**ステージ2（ベース形成中）**:
A flat 60-session base above a rising 200-day line, with SMA150 above SMA200 and the price within 25% of its 52-week high: stage 2, never stage 3 (the backend's stage classifier and `stagePhase`, from certified bars only). 「・日足から算出」 when the stage was computed on the screen.

**土台を確認できない / 土台未確認**:
The Setup Engine base is not current for the analysis date, or its confidence is under 55 (`SE_CONFIDENCE_FLOOR`) or missing (信頼度 未確認, never 0): the pivot and the plan are 参考 (独自判定). A certified VCP footprint does not override it (§9-13).

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
A field this publication does not carry (an older publication, before the field existed). Distinct from 未確認, which is a field that was published but could not be judged.

**未検証の足**:
Bars not certified for the analysis date. OHLC and moving averages still draw; the day change and volume ratio read 「（未検証）」, and nothing that judges the stock (pivot ratio, crossing mark, ADR, RS lead) is drawn from them.

**NAS調整中**:
Today's 地合い tile suffix and the verdict's sub-line when the guide is open while the Nasdaq is in correction, a rally attempt or a failed FTD. The verdict, its tone and the caps are judged on SPY only (判定はSPYのみ).

**FTD確認済み**:
The 地合い tile suffix when the guide is 0% while the backend regime is an FTD-upgraded uptrend (`ftdUpgraded`); the basis line says why the guide stays 0%.

**参考（市場の注意サイン）**:
A market check marked 〔参考〕 is counted apart from the 注意 signs (「▲ 注意サイン N件・参考 M件」), takes a neutral ○ and never sets a tab's ▲.

**判定不可（注意サイン）**:
The warning headline when no 注意 sign could be judged: 「注意サインを判定できません」, never 0件 or なし.

**26-03期**:
A fiscal quarter named by its year and end month (YY-MM). It is a period, not a negative number, so the U+2212 rule does not apply to it.

**RS線 新高値**:
The RS line (never RS推計) at a new high on the analysis date, read only from the published `rs_line_high` dated for that day (`publishedRsLineHigh`); absent is 未収録, a published null is 未確認.

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
- "RS" alone is ambiguous between the app's rank, the RS line and IBD's RS Rating. Resolution: the rank is **RS推計** (独自計算), the line is **RS線**, and IBD's value is never shown as either.
