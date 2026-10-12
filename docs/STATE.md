# STATE — 現在地（ローカル作業）

更新：2026-10-12。現在の作業は日足の数値代替の選択日保護。公開済み状態とは区別する。

## 完了

- ブランチ `private/detail-accessibility-20261012`。市場履歴修正 `3649934e502223c061a7e97ed135bb4d95291570` とアクセシビリティ修正 `a665631a690ec2b2238b45db028358dbb322fbc3` は保持。今回分は別コミット。
- 日足の逆順index選択を日付保持に変更。日足追加・減少・並べ替えでも同じ日を選択し、選択日が消えたら配信内の最新日へ理由付きでリセットする。空→再配信でも古い選択は復活しない。
- 初期表示の最新日は配信内からのみ選ぶ。将来日を推定・補完しない。チャートのbars原本、symbol/分析基準日/末尾日の照合、実測0と欠損、財務ルールを維持。
- 前段の拡大チャートの状態名・数値・根拠、日足数値代替、購入条件と一覧戻りのfocus修正を保持。

## 検証

関連28成功（追加11件、実装前は12失敗）、全Vitest233 files/2949成功。Playwright詳細4＋市場履歴2成功（375/1440、明暗）。axe指摘0。lintエラー0/既存警告6、build成功/既存chunk警告。Golden43成功。
backend redlineは262成功/1失敗：`test_vcp_footprint.py::test_well_formed_on_real_fixtures` のftnt.csv tight_near_highs。前段baselineと同じ既存失敗を維持。全ゲートgreenとは扱わない。

## 次・未確認

- 実音声screen readerの試聴と独立した画像レビューは未実施。作者の画像抜き取り・DOM/axe・キーボード検査のみ。
- 配列更新の動作は単体/コンポーネント結合テスト。ブラウザでは通常の日付選択とチャート最新日の一致を確認し、動的な配列差し替えは未実施。
- 順序不正/重複日付payloadをチャートへ通すための修復は対象外。日足数値の週足/表示範囲追従、X風フィード、実市場履歴の取得・継続更新は未実装。
- 実データbundleは不在。合成fixtureで検証し、exportはskip。Library保存再試行なし。前段ZIPを保持し、今回の検証素材は `/workspace/chart-date-selection-verification/`。
- scanner/band/regimeの凍結指標は再測定せず変更していない。従来の測定記録はPROGRESS/SPECと基点以前のSTATE履歴を参照。

## 制約

ローカル実装・合成データ検証のみ。push/PR/公開、外部市場データ取得、通信・認証設定変更なし。財務capture/admission/判定閾値・公開条件・nullとゼロ・分母・イベント照合を変えない。新規ライブラリなし。精度や全履歴完成は主張しない。

詳細は `docs/DETAIL_ACCESSIBILITY.md`。市場履歴監査は `docs/MARKET_INDICATOR_HISTORY.md`。他環境の財務作業には触れない。
