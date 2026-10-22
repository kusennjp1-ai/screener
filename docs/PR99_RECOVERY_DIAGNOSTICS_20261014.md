# PR99：保存済みUIの復元と価格欠落理由の診断

## ソースの由来

- 統合差分の基点：`c7896479837449bed18d922fe84ac80ecaa666cf`。
- 保存済み候補：`a55e8621dbaba0417744820b57f7c4e8e4c2e378`。既存の累積差分を基点へ適用し、全4,012 tracked filesとGit tree `9261c2465c884f3c900de9b3bf41f7e4af7a6c7d`の一致を確認。保存メタデータから復元したcommit objectも元のSHAと一致した。
- 元の候補は別途保持。中間commitの履歴全体を復元したという意味ではなく、今回の統合差分は上記PR99基点に対するもの。
- 価格欠落診断はmain `8cf7d9b231a5926696d261da51a4bab531f33cfa`を基点とする別差分。変更する既存backend 3ファイルは保存済み候補とbyte一致を確認してから統合した。

## 価格欠落診断の範囲

既存のcache-only SQL読取りを使い、チャートが作られなかった銘柄の理由を記録する。理由は `no_rows_in_window`、`insufficient_rows`、`incoherent_history`、`bulk_read_error`、`no_serializable_bars`。期間内に行がないことと、DB全体に履歴がないことは区別する。例外本文や接続情報は診断へ保存しない。

既存の単一市場export CLIが `diagnostics/<market>/cache-only-chart-omissions.json` を保存する。公開用markets subtreeやmanifestには追加しない。レポートの `observed_at` は診断作成時刻であり、価格取得時刻ではない。`chart_bundle_started` と `export_completed` を分け、失敗・未開始時の0件を完全coverageと扱わない。前回の成功レポートは実行初期に未完了へ更新する。診断ファイルや警告の書込み失敗で元のexport結果・例外・終了codeを変更しない。

価格の補充、プロバイダ通信、選定や50行条件・coherent-history判定の変更、失敗値の救済は行わない。財務capture/admission、契約、公開workflow、publisher pin、認証・権限設定は変更しない。市場履歴側の不正期間・不正入力の拒否は、保存済み候補に含まれる意図した修正である。

## 検証

統合後のbackendで新たに実行：

- 価格cache・export・CLIの関連8 files：208 passed（43.38秒）
- backend redline：275 passed（37.56秒）
- Golden：43 passed（7.18秒、redlineと重複）
- 差分の空白検査：成功

frontend subtreeは保存済みa55eと完全一致（`5ad097c9184cd4f887435f1409046d0a75a1791b`）。その同一ソースで復元後に実行した検証は全Vitest 244 files / 3,429 passed、Node 219、独立不変比較9,556、境界・不正入力940、lint 0 errors / 既存6 warnings、build成功。これらは統合後の再実行結果ではなく、byte不変のfrontendに対する直前の結果である。各件数には重複がある。

ローカル環境はNode24.19.0/Python3.12.14であり、CIのNode22/Python3.11と同一ではない。build時の実static-data exportはbundle不在でskip。

## 残る検証境界

375/1440px・明暗の4 browserケースはChromium起動時のローカルsocket権限制限で停止し、画面・assertionへ到達していない。許可された再実行でも同じ制限が残ったため、今回のbrowser成功や新しい画面画像は主張しない。

実retained artifactでのexport/Design/admission検証は別の証拠として扱う。この記録は実市場データの合格性、公開承認、原典全条件の再現、価格欠落の解消を認定しない。今回の診断が実運用で記録されるのは、統合後の通常実行からとなる。
