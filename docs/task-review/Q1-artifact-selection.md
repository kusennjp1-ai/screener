# Q1 — 最新の公開成果物を時刻で選ぶ

2026-10-01の実API応答で、先頭のartifact ID11142875222（作成05:08:47Z、run36805022628）が、次のID11142713525（作成05:26:00Z、run36818410505）より古かった。両runは成功している。APIの返却順/IDを作成時刻の降順と仮定していたため、Design AcceptanceとResearch UI Releaseが古いbundleを選び得た。

全ページを取得して created_at 降順で明示ソートし、その順で成功runを検証してから復元する。期限切れ・main以外・失敗runは従来同様に使わない。研究値や選定の閾値は変更しない。実APIで先頭が36818410505になることを確認する。

第4回の性能比較は旧版/新版が同じ古いbundleを用いた有効な比較だが、現在の公開内容を表すものではない。最終の検証は正しく選び直した最新bundleでやり直す。現在の公開時刻を改変して鮮度を装わない。

# Calendar / purchase-condition source investigation

- Reviewed: 2026-10-01.
- Original screenshot code: `3c7c54667a833125f676318f365594c7b24cad56`.
- Design capture: run `36866667202`; source Pages run `36805022628`.
- Screenshot report: `.git/design-fourth/report.json`, measured at `2026-10-01T13:14:23.184Z`, analysis date `2026-09-30`, research generation `20439d7a00d74ae585279e43fd650dc8a36b93005221b86744faf3e6d61bd410`.
- Investigation used actual published JSON / actual saved Pages artifact and the production `entryReadiness` function. No mock prices, historical clock replacement in the UI, or changed selection thresholds.

## Source artifact reproduces the screenshot counts

Downloaded `github-pages` artifact from run `36805022628` to `.git/design-source-36805022628/artifact.tar`.

Its manifest is for `2026-09-30`, generation `6cf94a450a3f4c05ecf9cae61ea38033f5c1c4e085797866ba7ee9a25bd42885`. The original research asset `research-index-6cf94a450a3f4c05.json` was decoded with `decodeResearchIndex`. The benchmark rebuild writes another compact generation but uses these same actual inputs.

The source archive has no `static-data/entry-context.json`. All four sampled original rows carry `entry_evidence.calendar = null` and `entry_evidence.earnings = null`. Feeding these original rows into `entryReadiness` at the screenshot report time reproduces:

| Symbol | Original passed / total | Calendar | Earnings |
|---|---:|---|---|
| MSM | 0/7 | unknown | unknown |
| ZETA | 2/7 | unknown | unknown |
| ADI | 1/7 | unknown | unknown |
| TGTX | 1/7 | unknown | unknown |

MSM: price `123.72`, pivot `124.51`, volume ratio `0.8455138086659362`, shape candidate `false`, Minervini `9/9`, IBD `3/10` with one unknown, market cap `0`. Its five known conditions fail; calendar and earnings remain unknown. The displayed 0/7 means zero conditions have passed, not seven confirmed failures.

**The same-input benchmark's 0/7 is a correct fail-closed result for missing source evidence. It is not a loading transient. Unknown calendar / earnings must not be promoted to passing merely to match an earlier screenshot.**

## Current published data differs

At investigation time the public manifest served generation `6d36f9fc4004b4d457c4d9c1143a225b53898bd36e9a3f4aa18d77a04c7d02f1` (same analysis date `2026-09-30`).

The old rebuilt `research-index-20439d7a00d74ae5.json` URL returned 404, so the downloaded source artifact was required for the comparison; current and screenshot generations were not silently treated as identical.

Current calendar:
- latest completed session: `2026-09-30`
- evaluated at: `2026-10-01T05:23:53.901653+00:00`
- valid until: `2026-10-01T20:00:00+00:00`

At the screenshot report time, current rows produce MSM `1/7`, ZETA `4/7`, ADI `3/7`, TGTX `3/7`. Calendar is now passing for all four. Current earnings are obtained for ZETA (`2026-11-03`), ADI (`2026-11-24`), TGTX (`2026-11-02`); **MSM earnings remain null**, so this field is not considered resolved for MSM. Current market cap remains 0 and the other rule failures remain enforced.

## Text-only clarification implemented

`entryReadiness.js` now explains calendar absence, evidence-date mismatch, completed-session mismatch, invalid timestamps, future evaluation, expired verification, and current expiry (JST). The existing state expression and thresholds are unchanged.

This also resolves the misleading old display where equal analysis / latest-session dates were shown next to failure without saying the calendar verification had expired.

Regression verification:
- `entryReadiness.test.js`: 14/14 pass.
- Combined modal + readiness suite: 23/23 pass.
- Targeted ESLint: 0 errors.
- Tests include exact expiry boundary, future evaluation, malformed evaluation / expiry, mismatched session / evidence date, missing calendar, and current valid calendar. They assert both the unchanged state and its explanation.

