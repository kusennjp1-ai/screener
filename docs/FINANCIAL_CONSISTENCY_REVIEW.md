# 財務条件の整合性修正・独立レビュー用本文

2026-10-12、ローカル限定。基点 `bb090658c43555725f993b0a3f61bdf3b819621f` を保持し、`private/financial-consistency-20261012` で修正した。原文未確認のため書籍準拠は断言しない。

## 修正と意図

| 区分 | 実装コミット | 修正 |
| --- | --- | --- |
| 年次EPSの境界 | `ea8afa6` | 受け取った数値の往復可能な十進表記を整数比へ変換し、25%下限を厳密比較。任意の許容誤差を足さない。 |
| 通貨・出典・単位 | `8dcffd9` | 旧形式も完全履歴/部分履歴に共通の整合確認を適用。不整合セルの情報を一覧変換で消さず、O’Neil/IBDとも未確認を維持。判定版をv8へ更新。 |
| 期間ラベル | `da54dbc` | 詳細スキャンの表、入力欄、適用中チップを「EPS 前四半期比」「売上 前四半期比」と表示。フィールド/保存キー/閾値は据え置き。 |
| 境界表示の補足 | `bf84499` | 25%直下が表示では25%に丸まる場合、元EPSでは25%未満という説明を判定内訳と財務欄へ追加。判定版名の既存financial-current識別語も保持。 |

`reportedGrowth.js`は新規依存パッケージを使わない。JS Numberから元データで失われた精度を復元するものではなく、受信値をJSON等へ往復できる十進表記を比較契約とする。EPS元値・wire値を丸めない。表示用の成長率計算と、下限の厳密な比較を分ける。成長率が有限でない場合、判定は従来どおり未確認。

旧バックエンドCANSLIM/ボーナス、財務capture/admission、取得元、公開条件、.github、売買閾値は変更していない。新ヘルパー追加に伴い、`publication-cli.test.mjs`の仮想release用コピー一覧へ1ファイル追加しただけで、公開処理の製品コードや期待値は緩めていない。

## 再現入力と期待値

全例は実企業と無関係の合成値。対象日は2026-10-02、評価時計は2026-10-04T12:00:00Z、年次取得時刻は2026-10-04T11:00:00Z。年次期末は2022/2023/2024/2025の各12月31日。`pass/fail/unknown`は下表の年次条件の状態であり、銘柄全体の購入許可ではない。

| 合成銘柄 | 連続4期の報告EPS / 追加情報 | O’Neil年次期待値 | 確認すること |
| --- | --- | --- | --- |
| BELOW | `[0.28, 0.3499999999999999, 0.45, 0.57]` | fail | 25%直下を合格にしない。表示の丸めを説明。 |
| EXACT | `[0.28, 0.35, 0.45, 0.57]` | pass | 初回はちょうど25%。表示は25%→28.57%→26.67%。 |
| ABOVE | `[0.28, 0.35000000000000003, 0.45, 0.57]` | pass | 直上を正しく認める。 |
| ZERO | `[0, 0.35, 0.45, 0.57]` | unknown | ゼロ基準年から通常成長率を作らない。 |
| NEGATIVE | `[-0.28, 0.35, 0.45, 0.57]` | unknown | 負の基準年を通過に置換しない。 |
| CURRENCY | `[1,2,4,8]`、legacy root USD / annual JPY | unknown | 完全な数値履歴でも矛盾した通貨では比較しない。 |
| CELL | `[8,4,2,null]`、legacy USD・先頭セルJPY | unknown | 変換前unknownを、情報削除後のfailに格上げしない。 |
| NATIVE | EXACTと同じEPS、既存native CAD契約 | pass | 一つの通貨で整合する履歴は利用可能。USDへのFX変換をしない。 |
| CADENCE | EXACTと同じ年次。EPS Q/Q40・Y/Y−10、売上Q/Q35・Y/Y−5 | 年次pass、四半期YoY条件は両方fail | Q/Q25%以上の補助フィルターには残る。前年同期比条件とは異なる。 |

一覧/詳細/判定の対照は、元row → researchListRow → encode/decode → mergeFinancialDetailの4経路で実行した。rankCandidatesの件数とassess、financialEvidencePresentationの状態を照合。欠損、ゼロ、負値、部分未達、通貨・出典・株式単位の不整合、nativeのUSD/CAD/EUR/GBP/CNYもテストした。元入力を改変せず、不整合情報をそのまま保持する。

IBD型は年次履歴の充足を確認する従来仕様のまま。正しい単位で4期が揃った負のEPS履歴をO’Neil型の成長率条件と同一視しない。Minerviniの技術一次選考と財務参考も統一していない。旧バックエンドのscore/pass/bonusはstatic投影で引き続きnull/未確認になることを対照確認した。

## 検証結果

- 数値の独立対照: Python Decimal（精度1000）による2,708比較とJSの厳密比較が全件一致。正の基準年、25%近傍、大小の指数表記、ゼロ/負の基準年を含む。許容epsilonは使用していない。
- 合成配信: 9例×4経路が期待状態に一致。入力全体と各出力を`input-expectation-results.json`へ保存。
- 関連Vitest: 境界修正224件、通貨修正457件、ラベル52件、表示補足279件が成功（重複あり、合計しない）。
- 初回の全Vitest: 236ファイル/2,995件中2,977成功、18失敗。内訳は新ヘルパーをコピーしていない公開処理の仮想checkoutで17件、判定版名の識別語で1件。両原因を修正した。
- 修正後の再検証: 関連6ファイル273件すべて成功。失敗した公開処理43件とexport1件を含む。全2,995件の一括再走はしておらず、初回結果と対象再試験を区別する。
- ブラウザ: ローカルChromium、375/1440px。8種類の年次ケース×2幅とQ/Q/Y/Y×2幅、計18件成功。実際の一覧件数、詳細の条件、財務カード、EXACT/CELLの拡大画面も照合。画像を作者が抜き取り確認した。独立した第三者レビューは未実施。
- lint: 0 errors、既存6 warnings。build成功、既存chunk-size警告。実データbundleがないためexportはskip。
- Golden: 43成功。backend redline: 262成功、既知の1失敗（`test_vcp_footprint.py::test_well_formed_on_real_fixtures`、ftnt.csvのtight_near_highs）。前段STATEの同じ失敗で、backendは無変更。全ゲートgreenとは扱わない。

ブラウザは外部リクエストをすべて遮断。既存のGoogle Fonts要求2件は遮断記録に残るが取得していない。実データ/外部API、Actions、公開、Libraryは使用していない。初回ブラウザ準備の失敗（モバイルの詳細へ直接入ってから一覧を探した操作、遮断済みフォント要求を失敗扱いした検査）を修正した。300ms debounceの入力は一つの確定を待って次を入れ、両条件が保持されることを確認した。

## 読み取り可能なテスト出力

```text
初回全体:
Test Files  2 failed | 234 passed (236)
Tests       18 failed | 2977 passed (2995)

修正後の関連再走:
tools/publication-cli.test.mjs (43 tests) passed
tools/export-financial-current.test.mjs (1 test) passed
src/static/annualConsistency.test.js (17 tests) passed
src/static/researchTransport.test.js (125 tests) passed
src/static/financialEvidencePresentation.test.js (68 tests) passed
src/static/candidateHistory.test.js (19 tests) passed
Test Files  6 passed (6)
Tests       273 passed (273)

Decimal oracle: 2708 cases, 0 mismatches
Playwright: 18 passed (375px / 1440px)
Golden: 43 passed
Backend redline: 1 failed, 262 passed
```

## 再実行

```bash
cd /workspace/screener/frontend
./node_modules/.bin/vitest run src/static/annualConsistency.test.js src/static/financialHistory.test.js src/static/nativeAnnualHistory.test.js src/static/compoundRuleStates.test.js src/static/researchTransport.test.js src/static/financialEvidencePresentation.test.js src/components/Scan/ResultsTable.test.jsx --maxWorkers=1
./node_modules/.bin/vitest run tools/publication-cli.test.mjs tools/export-financial-current.test.mjs --maxWorkers=1
./node_modules/.bin/playwright test --config /workspace/financial-consistency-fix-20261012/playwright.local.config.mjs
node /workspace/financial-consistency-fix-20261012/reproduce.mjs
python /workspace/financial-consistency-fix-20261012/decimal_oracle.py
```

ブラウザ用Viteは`VITE_STATIC_SITE=true VITE_BASE_PATH=/`でlocalhost:4191に起動する。テスト自体が合成HTTP応答を与え、既存の判定・取得日・データ整合性のゲートを通す。実会社の有効な証拠を作ったことにはならない。

## 残件と範囲外

230ルール対応表/4冊原文は手元で確認できていない。書籍準拠、実銘柄での発生率、公式IBD同等性、過去時点の公表済み証明は未検証。旧バックエンドのQ/Q・A代理値・0の別名フォールバックは今回も隔離のまま。前回監査の「一覧にfinancial_history自体がない場合の詳細からの補完」は、通常research exportでは明示nullになる条件付き防御候補として未変更。新しい売買条件や戦略統一は行っていない。

## 本番ソース差分（基点bb090658から、テスト・文書を除く）

以下はレビュー対象の実際のパッチ。完全差分、合成入力、期待値、出力JSON、試験ログ、スクリーンショット、各ファイルSHA-256をローカル検証パッケージへ同梱する。

```diff
diff --git a/frontend/src/components/Scan/ResultsTable.jsx b/frontend/src/components/Scan/ResultsTable.jsx
index 96f392d..4f2cb67 100644
--- a/frontend/src/components/Scan/ResultsTable.jsx
+++ b/frontend/src/components/Scan/ResultsTable.jsx
@@ -137,8 +137,8 @@ const columns = [
   { id: 'market_cap', label: '時価総額', sortable: true, width: 75 },
   { id: 'adv_usd', label: '平均売買代金', sortable: true, width: 70 },
   { id: 'ipo_date', label: '上場から', sortable: true, width: 70 },
-  { id: 'eps_growth_qq', label: 'EPS', sortable: true, width: 50 },
-  { id: 'sales_growth_qq', label: '売上成長', sortable: true, width: 50 },
+  { id: 'eps_growth_qq', label: 'EPS 前四半期比 (%)', sortable: true, width: 115 },
+  { id: 'sales_growth_qq', label: '売上 前四半期比 (%)', sortable: true, width: 115 },
   { id: 'adr_percent', label: 'ADR', sortable: true, width: 50 },
   { id: 'ma_alignment', label: '移動平均整列', sortable: false, width: 35 },
   // The VCP header sorts by quality_rank (VCP-detected setups first, ties by
@@ -463,11 +463,11 @@ const VirtualTableRow = memo(function VirtualTableRow({
         {formatIpoAge(row.ipo_date).replace('mo','か月').replace('y','年')}
       </TableCell>
 
-      <TableCell align="center" sx={{ fontFamily: 'monospace', color: row.eps_growth_qq == null ? 'text.secondary' : row.eps_growth_qq >= 0 ? 'success.main' : 'error.main', width: 50, minWidth: 50 }}>
+      <TableCell align="center" sx={{ fontFamily: 'monospace', color: row.eps_growth_qq == null ? 'text.secondary' : row.eps_growth_qq >= 0 ? 'success.main' : 'error.main', width: 115, minWidth: 115 }}>
         {row.eps_growth_qq != null ? signed(row.eps_growth_qq,0) : '-'}
       </TableCell>
 
-      <TableCell align="center" sx={{ fontFamily: 'monospace', color: row.sales_growth_qq == null ? 'text.secondary' : row.sales_growth_qq >= 0 ? 'success.main' : 'error.main', width: 50, minWidth: 50 }}>
+      <TableCell align="center" sx={{ fontFamily: 'monospace', color: row.sales_growth_qq == null ? 'text.secondary' : row.sales_growth_qq >= 0 ? 'success.main' : 'error.main', width: 115, minWidth: 115 }}>
         {row.sales_growth_qq != null ? signed(row.sales_growth_qq,0) : '-'}
       </TableCell>
 
diff --git a/frontend/src/features/scan/components/filterPanel/FundamentalFiltersSection.jsx b/frontend/src/features/scan/components/filterPanel/FundamentalFiltersSection.jsx
index de76371..728ac58 100644
--- a/frontend/src/features/scan/components/filterPanel/FundamentalFiltersSection.jsx
+++ b/frontend/src/features/scan/components/filterPanel/FundamentalFiltersSection.jsx
@@ -76,7 +76,7 @@ function FundamentalFiltersSection({
         </Grid>
         <Grid item xs={6} sm={4} md={1.5}>
           <CompactRangeInput
-            label="EPS成長"
+            label="EPS 前四半期比"
             minValue={filters.epsGrowth?.min}
             maxValue={filters.epsGrowth?.max}
             onChange={(range) => updateRangeFilter('epsGrowth', range)}
@@ -87,7 +87,7 @@ function FundamentalFiltersSection({
         </Grid>
         <Grid item xs={6} sm={4} md={1.5}>
           <CompactRangeInput
-            label="売上成長"
+            label="売上 前四半期比"
             minValue={filters.salesGrowth?.min}
             maxValue={filters.salesGrowth?.max}
             onChange={(range) => updateRangeFilter('salesGrowth', range)}
diff --git a/frontend/src/features/scan/components/filterPanel/utils.js b/frontend/src/features/scan/components/filterPanel/utils.js
index 3d290d0..828e4db 100644
--- a/frontend/src/features/scan/components/filterPanel/utils.js
+++ b/frontend/src/features/scan/components/filterPanel/utils.js
@@ -151,14 +151,14 @@ export function buildActiveFilters(filters) {
     const { min, max } = filters.epsGrowth;
     active.push({
       key: 'epsGrowth',
-      label: `EPS: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
+      label: `EPS 前四半期比: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
     });
   }
   if (hasRangeValue(filters.salesGrowth)) {
     const { min, max } = filters.salesGrowth;
     active.push({
       key: 'salesGrowth',
-      label: `売上成長: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
+      label: `売上 前四半期比: ${min != null ? `≥${min}%` : ''}${max != null ? ` ≤${max}%` : ''}`,
     });
   }
 
diff --git a/frontend/src/static/components/FinancialHistory.jsx b/frontend/src/static/components/FinancialHistory.jsx
index cd320b9..c5e2c80 100644
--- a/frontend/src/static/components/FinancialHistory.jsx
+++ b/frontend/src/static/components/FinancialHistory.jsx
@@ -10,10 +10,10 @@ export default function FinancialHistory({row, date, now = Date.now(), expanded
   const report=blocked ? financialHistory(data,row.symbol,date,Date.parse(data?.retrieved_at)) : currentFinancialHistory(data,row.symbol,date,now,row);
   const content = <>
     {blocked && <Typography role="note">{instrumentApplicabilityLabel(applicability)}。以下は保存した参考記録です。企業EPS・売上成長の現在の判定には使用しません。</Typography>}
-    {!data || !report.valid ? <Typography sx={{fontSize:13}}>この銘柄の有効な報告財務履歴は未取得、または取得から72時間を超えています。</Typography> : <>
+    {!data || !report.valid ? <Typography sx={{fontSize:13}}>{report.annualReason ? annualAvailabilityText(report) : 'この銘柄の有効な報告財務履歴は未取得、または取得から72時間を超えています。'}</Typography> : <>
       <Typography sx={{fontSize:12,my:1}}>{typeof data.source === 'string' && data.source.trim() ? data.source : '提供元 未確認'}・履歴で最古の取得 {data.retrieved_at}。報告希薄化EPSで、調整後EPSとは異なります。{ANNUAL_REPORTED_LIMITATION}取得時点の財務履歴です。分析日当時の公表確認や過去検証には使いません。</Typography>
       {data.annual_source && report.annual.length > 0 && <Typography sx={{fontSize:12}}>年次EPS・取得 {data.annual_source.observed_at}</Typography>}
-      {report.annual.length ? <div style={{overflowX:'auto'}}><table className="financial-history-table"><caption>年次の希薄化EPS</caption><thead><tr><th scope="col">決算期末</th><th scope="col">EPS（{data.annual_currency || data.currency} / 提供元の株式単位）</th></tr></thead><tbody>{report.annual.map(p=><tr key={p.end}><th scope="row">{p.end}</th><td>{value(p.eps)}</td></tr>)}</tbody></table></div> : <p className="financial-history-unavailable">年次EPSは未取得です。連続4期の実績がないため、3年の成長履歴を確認できません。</p>}
+      {report.annual.length ? <div style={{overflowX:'auto'}}><table className="financial-history-table"><caption>年次の希薄化EPS</caption><thead><tr><th scope="col">決算期末</th><th scope="col">EPS（{data.annual_currency || data.currency} / 提供元の株式単位）</th></tr></thead><tbody>{report.annual.map(p=><tr key={p.end}><th scope="row">{p.end}</th><td>{value(p.eps)}</td></tr>)}</tbody></table></div> : <p className="financial-history-unavailable">{report.annualReason ? annualAvailabilityText(report) : '年次EPSは未取得です。連続4期の実績がないため、3年の成長履歴を確認できません。'}</p>}
       <Typography sx={{fontSize:12,my:1}}>{blocked ? '参考計算・直近3年の比率：' : '直近3年の成長率：'}{report.annualGrowth ? report.annualGrowth.map(n=>`${n.toFixed(1)}%`).join(' → ') : '比較不可（4期不足・欠損・赤字基準年・期間不整合など）'}</Typography>
       {!report.annualGrowth && report.annualComparisons.length > 0 && <><Typography sx={{fontSize:12}}>{annualAvailabilityText(report)}。確認できる年次比較と未確認の年次比較：</Typography><ul>{report.annualComparisons.map(comparison => <li key={comparison.to}>{annualComparisonText(comparison)}</li>)}</ul></>}
       {data.quarterly_retrieved_at && report.quarterly.length > 0 && <Typography sx={{fontSize:12}}>四半期業績・取得 {data.quarterly_retrieved_at}</Typography>}
diff --git a/frontend/src/static/financialEvidencePresentation.js b/frontend/src/static/financialEvidencePresentation.js
index c22ce49..50031c0 100644
--- a/frontend/src/static/financialEvidencePresentation.js
+++ b/frontend/src/static/financialEvidencePresentation.js
@@ -1,7 +1,7 @@
 import { instrumentApplicability, instrumentApplicabilityLabel, INSTRUMENT_IDENTITY_FIELDS } from './instrumentApplicability.js';
 import { assess, annualGrowthRule } from './researchEngine.js';
 import { projectFinancialRow } from './financialCurrent.js';
-import { financialHistory, financialHistoryDeadlines, ANNUAL_REPORTED_LIMITATION, annualComparisonText, annualAvailabilityText } from './financialHistory.js';
+import { financialHistory, financialHistoryDeadlines, ANNUAL_REPORTED_LIMITATION, ANNUAL_METADATA_UNKNOWN, annualComparisonText, annualAvailabilityText } from './financialHistory.js';
 import { validClock, validEvidenceDay } from './evidenceTime.js';
 
 // Presentation of the shared current-use projection and existing assessment.
@@ -66,6 +66,7 @@ export const financialUnknownReason = reason => ({
   value_mismatch: '実数値と選定条件の判定値が一致しません。',
   missing_value: '実数値が未取得です。',
   invalid_history: '有効な報告希薄化EPS履歴がありません（取得後72時間・銘柄・日付などを確認）。',
+  inconsistent_annual_metadata: ANNUAL_METADATA_UNKNOWN,
   incomplete_annual_history: '3年の成長履歴に必要な連続4期の年次EPSが揃っていません。',
   incomparable_annual_growth: '年次成長率を比較できません（欠損・ゼロ／赤字基準年・期間不整合など）。',
 }[reason] || '現在の判定に使える根拠を確認できません。');
@@ -141,10 +142,11 @@ const metadata = data => ({
 function annualRow(history, context, required, condition) {
   const { symbol, date, now, method } = context;
   const report = financialHistory(history, symbol, date, now);
-  const reason = !report.valid ? 'invalid_history' : !sourceLabel(history.source) ? 'missing_source' : !finite(timestamp(history.retrieved_at)) ? 'missing_observed_at' : null;
+  const reason = report.annualReason || (!report.valid ? 'invalid_history' : !sourceLabel(history.source) ? 'missing_source' : !finite(timestamp(history.retrieved_at)) ? 'missing_observed_at' : null);
   const unavailable = !report.annualComplete ? 'incomplete_annual_history' : method !== 'ibd' && !report.annualGrowth ? 'incomparable_annual_growth' : null;
   const value = method === 'ibd' ? report.annualComplete : report.annualGrowth ? Math.min(...report.annualGrowth) : null;
-  const knownFailure = method === 'oneil' && annualGrowthRule(report).state === 'fail';
+  const annualDecision = annualGrowthRule(report);
+  const knownFailure = method === 'oneil' && annualDecision.state === 'fail';
   let decision = !reason && required && (!unavailable || knownFailure) ? conditionState(condition, value) : { state: reason || unavailable ? 'unknown' : 'reference', reason: reason || unavailable };
   if (!reason && required && knownFailure && !report.annualGrowth && decision.state !== 'fail') decision = { state: 'unknown', reason: 'value_mismatch' };
   // A failed conjunction and incomplete inputs are independent facts. Keep the
@@ -154,6 +156,7 @@ function annualRow(history, context, required, condition) {
   const measuredComparisons = report.annualComparisons.filter(comparison => finite(comparison.growth)).length;
   return {
     ...decision, availability: report.annualComplete ? 'complete' : 'incomplete', availabilityReason: unavailable,
+    calculationNote: !reason && method === 'oneil' ? annualDecision.precisionNote || null : null,
     actual: reason ? '未確認' : partial ? `${annualAvailabilityText(report)}。${report.annualComparisons.map(annualComparisonText).join(' / ')}` : unavailable ? '未確認' : report.annualGrowth ? report.annualGrowth.map(n => `${number(n)}%`).join(' → ') : '連続4期の年次EPSあり（成長率は比較不可）',
     period: report.annual.length ? `${report.annual.slice(-4)[0].end} ～ ${report.annual.at(-1).end}` : '決算期 未確認',
     source: sourceLabel(history?.source) ? history.source : '提供元 未確認',
diff --git a/frontend/src/static/financialHistory.js b/frontend/src/static/financialHistory.js
index a5fdc8d..48b16cc 100644
--- a/frontend/src/static/financialHistory.js
+++ b/frontend/src/static/financialHistory.js
@@ -1,4 +1,5 @@
 import { evidenceTimestamp, validClock } from './evidenceTime.js';
+import { reportedGrowth } from './reportedGrowth.js';
 import nativeContract from '../../contracts/native_annual_history_v1.json' with { type: 'json' };
 
 const finite = n => typeof n === 'number' && Number.isFinite(n);
@@ -26,6 +27,15 @@ export function nativeAnnualHistoryContract(data, symbol) {
     evidenceTimestamp(data.retrieved_at) === Math.min(observed, finite(quarter) ? quarter : Infinity);
 }
 
+export function annualHistoryMetadataValid(data, symbol) {
+  if (data?.schema_version === NATIVE_ANNUAL_SCHEMA) return Boolean(nativeAnnualHistoryContract(data, symbol));
+  return data?.schema_version === undefined && data?.currency === 'USD' &&
+    (data.annual_currency === undefined || data.annual_currency === 'USD') && data.annual_source === undefined &&
+    Array.isArray(data.annual) && data.annual.every(point => point &&
+      Object.keys(point).every(key => ['end', 'eps', 'revenue', 'netIncome'].includes(key)));
+}
+export const ANNUAL_METADATA_UNKNOWN = '年次EPSの通貨・出典・単位の整合性を確認できません。異なる基準の値を変換せず比較しません。';
+
 export function financialHistoryDeadlines(data) {
   return (data?.schema_version === NATIVE_ANNUAL_SCHEMA
     ? [data.annual_source?.observed_at, data.quarterly_retrieved_at] : [data?.retrieved_at])
@@ -36,12 +46,14 @@ export function financialHistoryDeadlines(data) {
 export function financialHistory(data, symbol, date, now = Date.now()) {
   const result = { valid: false, annualComplete: null, annualGrowth: null, annualComparisons: [], epsYoY: null, salesYoY: null, annual: [], quarterly: [] };
   const native = data?.schema_version === NATIVE_ANNUAL_SCHEMA;
+  const annualMetadataValid = annualHistoryMetadataValid(data, symbol);
+  if (data?.annual?.length && !annualMetadataValid) result.annualReason = 'inconsistent_annual_metadata';
   const fresh = value => { const age = validClock(now) ? now - evidenceTimestamp(value) : NaN; return finite(age) && age >= -5000 && age <= 72 * 3600000; };
   if (!data || data.symbol !== symbol || data.as_of_date !== date || !validDay(date) ||
       data.status !== 'available' || data.basis !== 'reported_diluted_eps' ||
       (native ? !nativeAnnualHistoryContract(data, symbol) : data.schema_version !== undefined || data.currency !== 'USD' || !fresh(data.retrieved_at))) return result;
   const clean = values => Array.isArray(values) && values.every((p, i) => p && validDay(p.end) && p.end <= date && (!i || p.end > values[i-1].end)) ? values : [];
-  result.annual = !native || fresh(data.annual_source.observed_at) ? clean(data.annual) : [];
+  result.annual = annualMetadataValid && (!native || fresh(data.annual_source.observed_at)) ? clean(data.annual) : [];
   result.quarterly = !native || fresh(data.quarterly_retrieved_at) ? clean(data.quarterly) : [];
   result.valid = result.annual.length > 0 || result.quarterly.length > 0;
   const annual = result.annual.slice(-4);
@@ -50,19 +62,16 @@ export function financialHistory(data, symbol, date, now = Date.now()) {
   result.annualComplete = annualPeriodsValid && annual.every(p => finite(p.eps)) ? true : null;
   // Partial comparisons need the entire dated four-period window. Never skip a
   // missing year, fill a null cell, or derive a rate from a nonpositive baseline.
-  // Legacy USD histories cannot establish a different per-cell source/basis or
-  // currency; ambiguous extensions may not authorize a new partial failure.
-  const unambiguousAnnual = native || (data.annual_currency === undefined || data.annual_currency === 'USD') &&
-      data.annual_source === undefined && annual.every(p => Object.keys(p).every(key => ['end','eps','revenue','netIncome'].includes(key)));
-  if (annualPeriodsValid && unambiguousAnnual) result.annualComparisons = annual.slice(1).map((point, i) => {
+  // The same source/currency contract governs complete and partial histories.
+  if (annualPeriodsValid) result.annualComparisons = annual.slice(1).map((point, i) => {
     const previous = annual[i];
     const reason = !finite(previous.eps) || !finite(point.eps) ? 'missing_annual_eps' : previous.eps <= 0 ? 'nonpositive_comparison_base' : null;
-    const growth = reason ? null : (point.eps / previous.eps - 1) * 100;
+    const growth = reason ? null : reportedGrowth(previous.eps, point.eps);
     return { from: previous.end, to: point.end, previous: previous.eps, latest: point.eps,
       growth: finite(growth) ? growth : null, reason: reason || (finite(growth) ? null : 'invalid_annual_growth') };
   });
   if (result.annualComplete && annual.slice(0,3).every(p => p.eps > 0)) {
-    const growth = annual.slice(1).map((p,i) => (p.eps / annual[i].eps - 1) * 100);
+    const growth = annual.slice(1).map((p,i) => reportedGrowth(annual[i].eps, p.eps));
     result.annualGrowth = growth.every(finite) ? growth : null;
   }
   const latest = result.quarterly.at(-1);
@@ -82,5 +91,6 @@ export function annualComparisonText(comparison) {
   return `${comparison.from} → ${comparison.to}: ${result}`;
 }
 export function annualAvailabilityText(report) {
+  if (report.annualReason === 'inconsistent_annual_metadata') return ANNUAL_METADATA_UNKNOWN;
   return report.annualComplete ? '年次EPS履歴：連続4期取得済み' : '年次EPS履歴：不完全（4期不足・欠損・期間不整合など）';
 }
diff --git a/frontend/src/static/reportedGrowth.js b/frontend/src/static/reportedGrowth.js
new file mode 100644
index 0000000..21a3d57
--- /dev/null
+++ b/frontend/src/static/reportedGrowth.js
@@ -0,0 +1,36 @@
+const finite = value => typeof value === 'number' && Number.isFinite(value);
+// JSON numbers carry decimal values. Use their round-trippable decimal spelling
+// for comparisons; an arbitrary epsilon would also admit values below the floor.
+const decimal = value => {
+  const [mantissa, exponent = '0'] = String(value).toLowerCase().split('e');
+  const [integer, fraction = ''] = mantissa.split('.');
+  return { coefficient: BigInt(integer + fraction), exponent: Number(exponent) - fraction.length };
+};
+const growthFraction = (previous, latest) => {
+  if (!finite(previous) || previous <= 0 || !finite(latest)) return null;
+  const a = decimal(previous), b = decimal(latest), exponent = Math.min(a.exponent, b.exponent);
+  const denominator = a.coefficient * 10n ** BigInt(a.exponent - exponent);
+  const numerator = (b.coefficient * 10n ** BigInt(b.exponent - exponent) - denominator) * 100n;
+  return { numerator, denominator };
+};
+export function reportedGrowth(previous, latest) {
+  const fraction = growthFraction(previous, latest);
+  if (!fraction) return null;
+  let { numerator, denominator } = fraction;
+  let a = numerator < 0n ? -numerator : numerator, b = denominator;
+  while (b) [a, b] = [b, a % b];
+  numerator /= a; denominator /= a;
+  // Reducing the fraction makes exact decimal boundaries (e.g. 0.28 -> 0.35)
+  // exactly representable. Extreme magnitudes retain the existing finite check.
+  let value = Number(numerator) / Number(denominator);
+  if (!finite(value)) value = (latest / previous - 1) * 100;
+  return finite(value) ? value : null;
+}
+export function reportedGrowthAtLeast(previous, latest, minimum) {
+  const fraction = growthFraction(previous, latest);
+  if (!fraction || !finite(minimum)) return null;
+  const floor = decimal(minimum);
+  return floor.exponent < 0
+    ? fraction.numerator * 10n ** BigInt(-floor.exponent) >= fraction.denominator * floor.coefficient
+    : fraction.numerator >= fraction.denominator * floor.coefficient * 10n ** BigInt(floor.exponent);
+}
diff --git a/frontend/src/static/researchEngine.js b/frontend/src/static/researchEngine.js
index d74f7cf..d68ddd3 100644
--- a/frontend/src/static/researchEngine.js
+++ b/frontend/src/static/researchEngine.js
@@ -1,4 +1,5 @@
 import { ANNUAL_REPORTED_LIMITATION, annualComparisonText, annualAvailabilityText } from './financialHistory.js';
+import { reportedGrowthAtLeast } from './reportedGrowth.js';
 import { instrumentApplicability, instrumentApplicabilityLabel } from './instrumentApplicability.js';
 import { projectFinancialRow, currentFinancialHistory } from './financialCurrent.js';
 import { canonicalPivot } from './researchPresentation.js';
@@ -54,13 +55,17 @@ export function annualGrowthRule(report, fallbackMinimum = null) {
   const item = rule('A：直近3年の各年 EPS 成長率 ≥ 25%（最小値）', report?.annualGrowth?.length === 3 && report.annualGrowth.every(finite) ? Math.min(...report.annualGrowth) : fallbackMinimum, value => value >= 25, '%');
   if (!report) return item;
   item.comparisons = report.annualComparisons.map(comparison => ({ ...comparison,
-    state: !finite(comparison.growth) ? 'unknown' : comparison.growth >= 25 ? 'pass' : 'fail' }));
+    state: !finite(comparison.growth) ? 'unknown' : reportedGrowthAtLeast(comparison.previous, comparison.latest, 25) ? 'pass' : 'fail' }));
   if (item.comparisons.length === 3) {
     const result = threeStateAnd(item.comparisons.map(comparison => comparison.state === 'unknown' ? null : comparison.state === 'pass'));
     item.state = result === null ? 'unknown' : result ? 'pass' : 'fail';
   }
   item.annualComplete = report.annualComplete;
   item.evidence = [annualAvailabilityText(report), ...item.comparisons.map(comparison => `${annualComparisonText(comparison)}（${comparison.state === 'pass' ? '通過' : comparison.state === 'fail' ? '未達' : '未確認'}）`)].join('。');
+  if (item.comparisons.some(comparison => comparison.state === 'fail' && comparison.growth.toFixed(2) === '25.00')) {
+    item.precisionNote = '表示では25%に丸まりますが、元のEPSで比較すると25%未満の年があります。';
+    item.evidence += `。${item.precisionNote}`;
+  }
   return item;
 }
 export function assess(input, method = 'minervini', now = Date.now()) {
@@ -128,7 +133,7 @@ export function assess(input, method = 'minervini', now = Date.now()) {
 
 // Generated from the same rule function; unresolved inputs remain explicit. Details and CSV
 // retain complete, independently recomputed rule evidence.
-export const RULE_SUMMARY_VERSION = 'research-summary-v7-financial-current-three-state-conjunction';
+export const RULE_SUMMARY_VERSION = 'research-summary-v8-financial-current-annual-decimal-metadata';
 export function assessmentSummary(row, method, now = Date.now()) {
   // Packed summaries and orders from legacy bundles are observations, not
   // authority for current decisions. Preparation recomputes once per epoch.
diff --git a/frontend/src/static/researchTransport.js b/frontend/src/static/researchTransport.js
index 18c7c7a..d4fb5aa 100644
--- a/frontend/src/static/researchTransport.js
+++ b/frontend/src/static/researchTransport.js
@@ -1,4 +1,4 @@
-import { NATIVE_ANNUAL_SCHEMA, nativeAnnualHistoryContract } from './financialHistory.js';
+import { annualHistoryMetadataValid } from './financialHistory.js';
 // Versioned wire format. Decision inputs remain lossless; displayed numbers are
 // formatted by the UI, never rounded before a threshold or order calculation.
 import { encodeResearchFloat64, decodeResearchFloat64 } from './researchFloat64.js';
@@ -36,7 +36,7 @@ export function researchListRow(row) {
   if (row.financial_history) out.financial_history = {
     ...pick(row.financial_history, ['symbol', 'as_of_date', 'status', 'basis', 'currency', 'retrieved_at', 'source', 'schema_version', 'annual_currency', 'quarterly_currency', 'quarterly_retrieved_at', 'annual_source']),
     // Do not strip contradictory per-cell currency/unit metadata into valid proof.
-    annual: row.financial_history.schema_version === NATIVE_ANNUAL_SCHEMA && !nativeAnnualHistoryContract(row.financial_history, row.symbol) ? []
+    annual: !annualHistoryMetadataValid(row.financial_history, row.symbol) ? row.financial_history.annual
       : Array.isArray(row.financial_history.annual) ? row.financial_history.annual.map(item => pick(item, ['end', 'eps'])) : row.financial_history.annual,
   };
   return out;
```
