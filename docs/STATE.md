# STATE — 現在地（ローカル作業）

更新：2026-10-12。財務条件の整合性監査から、年次EPS境界・通貨情報・期間ラベルを修正。公開済み状態とは区別する。

## 完了

- 基点 `bb090658` と元ブランチ `private/detail-accessibility-20261012` を保持。専用ブランチ `private/financial-consistency-20261012` で作業。
- 年次EPSの25%ちょうどを、受信EPSの十進表記による厳密比較で判定。25%直下は未達、ゼロ/負の比較元は未確認。任意のepsilonや閾値変更なし。
- 表示上25%に丸まる直下のケースには、元EPSでは25%未満と説明する。既存O’Neil/IBD/Minerviniの異なる条件を統一しない。
- 旧形式の年次通貨/出典/セル単位の不整合を、完全履歴でも部分履歴でも未確認とする。一覧の軽量化で不整合情報を削除せず、raw/list/decoded/detailで同じ状態を保持。
- 詳細スキャンの表・入力欄・適用チップを「EPS 前四半期比」「売上 前四半期比」と表示。従来のQ/Qフィールド/保存キー/下限判定を維持し、主画面の前年同期比と区別。
- 判定版は `research-summary-v8-financial-current-annual-decimal-metadata`。旧版との差を市場変化として比較しない。
- 旧バックエンドのscore/pass/bonus隔離を維持。財務capture/admission、閾値、公開条件、認証は無変更。

## 検証

- 合成9例×4経路が期待状態と一致。Python Decimalの独立計算2,708例がJS比較と一致。
- ブラウザ最終18成功（375/1440px、dark、実一覧/詳細/条件/財務/一部拡大画面）。最終画像を作者が抜き取り確認。外部要求は遮断。
- 初回全Vitestは236 files / 2,995 tests中2,977成功、18失敗。追加ヘルパーの仮想checkoutへのコピー漏れ17件、判定版名の既存識別語の欠落1件を修正。
- 修正後は該当2ファイルを含む6 files / 273 tests成功。初回全体と対象再試験を区別し、最終状態での全体一括再走は未実施。関連の境界224/通貨457/ラベル52/表示補足279も成功（重複あり）。
- lint 0 errors / 既存6 warnings、build成功 / 既存chunk警告。実データbundle不在でexportはskip。
- Golden43成功。backend redline262成功/既知1失敗：`test_vcp_footprint.py::test_well_formed_on_real_fixtures` のftnt.csv tight_near_highs。期待値は緩めず全ゲートgreenとは扱わない。

## 次・未確認

- 独立した第三者レビューは未実施。レビュー本文（本番diff/入力/期待値/試験出力）は `docs/FINANCIAL_CONSISTENCY_REVIEW.md`。
- 230ルール表と4冊の原文は今回確認できず、書籍準拠、公式IBD同等性、実銘柄の発生率は未検証。
- 旧バックエンドの別基準、一覧で年次履歴プロパティ自体を省略した場合の詳細補完は前回監査の範囲外残件。通常research exportは明示nullを持つ。
- 実データ取得・財務capture/admissionは他作業。今回のローカル証拠は `/workspace/financial-consistency-fix-20261012/`。
- 前段の市場履歴/詳細アクセシビリティ/日付選択/参照情報/異常チャート対応を保持。実音声screen reader、独立画像レビュー等の前段残件を完了扱いしない。

## 制約

ローカル実装と合成データ検証のみ。外部データ取得、Library再試行、push/PR/merge/Actions/公開、認証変更なし。新しい依存パッケージなし。公開条件や売買基準を緩めない。
