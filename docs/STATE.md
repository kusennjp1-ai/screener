# STATE — 現在地（ローカル作業）

更新：2026-10-12。現在の作業は日足配列更新・不正payload・遅延応答のブラウザ検証と最小防御修正。公開済み状態とは区別する。

## 完了

- ブランチ `private/detail-accessibility-20261012`。市場履歴3649934、アクセシビリティa665631、日付選択3dc0da7、参照情報a7ece14を保持。今回の防御修正は別コミット。
- 日足数値は実日付で選択保持。適格な履歴追加/減少でも同日を参照し、選択日削除時は理由付きで配信内の最新日にリセット。空→復帰では古い選択を復活させない。
- チャート受信時に存在しない日付、日付欠損、重複、順序逆転を拒否。勝手な修復・並べ替え・補完は行わない。銘柄/分析基準日/末尾日の既存照合も維持。
- OHLCV不正時は旧ローソク足・出来高・移動平均・RS・EPS補助線を消去。独立した日足数値欄は同日の実測値と未確認を表示し、実測出来高0を維持する。既存の数値妥当性条件を再利用し、閾値を新設していない。
- 375/1440pxの詳細/拡大画面で、動的な更新・空・不正日付/数値・前銘柄の遅延応答を検証済み。遅延応答は既存の銘柄別キャッシュで分離され、追加の製品修正は不要だった。
- 前段の選出/購入の区別、対象外の分離、根拠対象日/画面基準日/表示用配信版の区別を維持。

## 検証

全Vitest235 files/2977成功、関連5 files/79成功（追加13件）。新規Playwright22成功（375/1440、dark、各11ケース）。既存詳細4＋市場履歴2成功（詳細は明暗）、既存axe検査0。lint0errors/既存6warnings、build成功/既存chunk警告。Golden43成功。
backend redlineは262成功/既存1失敗：`test_vcp_footprint.py::test_well_formed_on_real_fixtures` のftnt.csv tight_near_highs。期待値を緩めず、全ゲートgreenとは扱わない。

## 次・未確認

- 実音声screen readerと独立画像レビューは未実施。作者の画像抜き取り・DOM/axe・キーボード検査のみ。
- 財務根拠の日付/配信版/提供元不整合の枝は単体/結合テストにとどまり、今回のブラウザ検証の対象外。全選出ルールの構造化source/as-ofも未整備で、欠けた値は未確認。
- 順序不正/重複日付payloadの修復、週足/表示範囲追従、複数比較、新規依存、ピボット100、X風フィード、実市場履歴の継続取得は未実装・保留。
- 実データbundle不在。既存の合成fixtureを使い、exportはskip。Library保存再試行なし。前段成果物を保持。今回分は `/workspace/chart-payload-browser-verification/`。
- scanner/band/regimeの凍結指標は再測定せず変更していない。従来の測定記録はPROGRESS/SPECと以前のSTATE履歴を参照。

## 制約

ローカル実装・合成データ検証のみ。push/PR/公開、外部市場データ取得、通信・認証設定変更なし。財務capture/admission/判定閾値・公開条件・分母・イベント照合を変えない。新規ライブラリなし。精度や全履歴完成は主張しない。

今回の監査は `docs/CHART_PAYLOAD_BROWSER_AUDIT.md`。前段は `docs/EVIDENCE_CONTEXT_AUDIT.md`、`docs/DETAIL_ACCESSIBILITY.md`、`docs/MARKET_INDICATOR_HISTORY.md`。他環境の財務作業には触れない。
