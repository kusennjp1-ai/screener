# STATE — 現在地（carry chart のローカル修正候補）

更新：2026-10-13。承認済みPR #99 headから独立した修正。公開済み状態とは区別する。

## 入力と保存ブランチ

- 基点：`32ee9c2116f8d8d42c70ed4607a94a7b311c0aa6`。`private/integrate-pr98-ui-20261012`をそのまま保持。
- 作業先：`private/projection-idempotence-20261013`。今回remote操作なし。
- 既存UI `134737f901bc5a3847fc50ceaac2ad59bda935de`、PR #98 `2de4270a0fb7608f3a892b6b04bfd2f1a5b4229d`の保存ブランチも保持。別のbackend夜間候補は取り込まない。

## 今回の変更

- `export-research.mjs`のcarry-owned chartへの冗長な外側projectionだけを除去。carryなしの通常export/correctionは従来の処理を維持。
- 変更後exporterは既存の固定publisher fixtureと全バイト一致（SHA-256 `f9e0ad58f7bbaf911eab2943fcfb18df32f6ee881c3847272f5201e448d9cf40`）。本体差分は1行を2行へ置換。
- 期限切れ通常scalarが初回null化された後、コピー経由の再projectionで理由だけstale_source→missing_or_invalid_valueになる機構を合成再現。verifierは所有元入力を再構築して初回状態を期待するため不一致となる。
- 全対象銘柄・対象日・build clockを照合するcarry入口、financialCurrent、proof、理由コード、期限、generation、capture/admission、verifier、公開条件は変更しない。
- 一般のコピー/JSON後の直接再projectionの診断変化は残る。公開用所有境界の修正であり、nullから有効値を復元する処理は加えない。

## 検証結果

- 修正前carry回帰：24成功/4失敗。完全export fixtureでverified-charts/.../fundamentals/.../state mismatchを再現。修正後28成功。
- raw/list/detail/chart、保存/再export、stale source/reporting period、missing、identity mismatch、valid、unowned/fund/inherited identityを確認。値復活・表示状態偽装・generation/銘柄改変・後日の期限切れを既存verifierが拒否。
- 関連Vitest：9 files/386成功。全Vitest：236 files/2,996成功、exit 0、501.94秒。
- backend redline：275成功。Golden：43成功。lint：0 errors/既存6 warnings。build成功/既存chunk警告。
- 追加controller：初回203成功/1失敗。環境umask0077が一時ファイル0644を0600にするため。該当controller/testは基点と同一。子プロセスのみumask0022で対象ファイル全111成功。権限assertionや製品設定は変更なし。条件付き結果として区別。
- 実データbundle不在でnpm build内の通常exportはskip。完全exportは独立した合成fixtureで実行。今回はUI component変更なし、ブラウザ実画面確認は未実施。

## 制約・残件

- run38349001715/job115136914293で失敗した実際のA bytesは不在。機構と同形エラーの再現であり、本番原因確定ではない。
- 旧exporter hashを固定したordinary publisher helperは新候補を拒否することを確認。承認境界は変更しない。本候補を公開可能と扱わない。
- この作業ではpush、PR変更、remote読取、merge、Actions、公開、外部データ取得、archive/Library再試行、認証変更なし。
- 売買閾値・市場履歴ルールは変更なし。実サーバー不在、書籍原文との全230ルール照合、実音声screen reader等の以前の残件は完了扱いしない。
- 差分・完全合成入力・再現スクリプト・ログ・ソースhash・検証パッケージ：`/workspace/projection-idempotence-20261013/`。bdは未インストール。
