# STATE — 現在地（ローカル統合候補）

更新：2026-10-12。PR #98 exact headと現在UIの共存検証。公開済み状態とは区別する。

## 入力と保存ブランチ

- UI: `134737f901bc5a3847fc50ceaac2ad59bda935de`、`private/financial-consistency-20261012`を保持。
- PR #98: `2de4270a0fb7608f3a892b6b04bfd2f1a5b4229d`、`private/pr98-exact-20261012`に保存。
- 共通祖先: `8cf7d9b231a5926696d261da51a4bab531f33cfa`。
- 統合先: `private/integrate-pr98-ui-20261012`。指定remote/branchから通常HTTPS git fetchで取得し、exact head一致を確認。
- 別のbackend夜間候補83009c0や保留中の境界修正は取り込まない。

## 統合内容

- UIの市場履歴・詳細アクセシビリティ・日付/異常チャート・年次EPS十進境界・通貨不整合unknown保持・前四半期比ラベルを保持。
- PR #98の8コミットをそのまま統合。VCPの集約detectedとlegacy_detectedを区別、欠損closeをclimaxの日次上昇へ補完しない、FX stale fallbackで新しいcache値を保持。unit fixtureの認証・同期API・cache/wrapper隔離の修正を保持。
- 競合はdocs/STATE.mdとdocs/PROGRESS.mdのみ。PROGRESSは両側の追記を全保持。STATEは現状に更新し、両元文書は元commitとローカル証拠へ保持。
- 売買閾値・公開条件・実認証ガードは緩めない。財務capture/admissionは非対象。

## 検証状況

- UI単独134737fの全体Vitest: 236ファイル/2995件成功、exit 0、504.46秒。以前の18失敗は全体再走で解消確認済み。独立ソースレビューで現在の主経路にブロッカーなしとの親レビュー結果を受領。
- 統合候補のFTNT、関連backend、Golden、frontend全体、重要browser回帰は検証中。結果をUI単独やPR単独の記録で代用しない。
- 既知のFTNT失敗はPR #98の経路別契約修正で解消することを実測する。過去のbackend全unit未対応や実サーバー不在の制約まで解消済みとは扱わない。
- 生ログ・両入力差分・元文書: `/workspace/pr98-ui-integration-20261012/`。

## 制約・残件

- ローカル統合のみ。push、PR変更、main merge、Actions実行、公開、Library再試行なし。外部市場データ取得なし。指定GitHubコード取得だけ許可。
- 実データbundle不在でのexport検証、書籍原文との全230ルール照合、実音声screen reader等の以前の残件は完了扱いしない。
- 検証完了後は根拠となるhead・ログ・既知失敗を報告。元branchは保持。
