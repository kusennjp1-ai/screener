# STATE — 現在地（ローカル作業）

更新：2026-10-12。現在の作業は選出/購入条件の参照情報・対象外表示。公開済み状態とは区別する。

## 完了

- ブランチ `private/detail-accessibility-20261012`。市場履歴3649934、アクセシビリティa665631、日付選択3dc0da7を保持。根拠表示の追加は別コミット。
- 日足数値は実日付で選択保持。配列追加/減少/並べ替え時も同日を参照し、選択日削除時は理由付きで最新実測日にリセット。未来日を補完しない。
- 詳細/拡大/財務で画面の分析基準日・配信版と根拠対象日を区別。財務表示用envelopeの版違いも明示。提供元の原データ版や取得時刻とは区別する。
- モバイル要約の対象外を未達・未確認から分離。選出/購入条件を明記し、既存の判定state・合格数・財務の出典不明理由を維持。

## 検証

全Vitest234 files/2964成功、今回関連65成功（追加15件）。Playwright詳細4＋市場履歴2成功（375/1440、明暗、対象外要約も確認）。axe0、lint0errors/既存6warnings、build成功/既存chunk警告。Golden43成功。
backend redlineは262成功/既存1失敗：`test_vcp_footprint.py::test_well_formed_on_real_fixtures` のftnt.csv tight_near_highs。期待値を緩めず、全ゲートgreenとは扱わない。

## 次・未確認

- 実音声screen readerと独立画像レビューは未実施。作者の画像抜き取り・DOM/axe・キーボード検査のみ。
- 配列更新、根拠の日付/配信版/提供元不整合の枝は単体/結合テスト。ブラウザでは通常の配信・日付選択・対象外を検査し、不正payloadや動的配列差し替えは未実施。
- 全選出ルールに構造化source/as-ofが揃うとは保証しない。欠けた値を作るproducerは追加していない。個別根拠に記載がない提供元/対象日は未確認。
- 順序不正/重複日付payloadの修復、週足/表示範囲追従、複数比較、新規依存、ピボット100、X風フィード、実市場履歴の継続取得は未実装・保留。
- 実データbundle不在。合成fixture検証とexport skip。Library保存再試行なし。日付選択ZIPを含む前段成果物を保持。今回分は `/workspace/evidence-context-verification/`。
- scanner/band/regimeの凍結指標は再測定せず変更していない。従来の測定記録はPROGRESS/SPECと以前のSTATE履歴を参照。

## 制約

ローカル実装・合成データ検証のみ。push/PR/公開、外部市場データ取得、通信・認証設定変更なし。財務capture/admission/判定閾値・公開条件・欠損/ゼロ・分母・イベント照合を変えない。新規ライブラリなし。精度や全履歴完成は主張しない。

今回の監査は `docs/EVIDENCE_CONTEXT_AUDIT.md`。前段は `docs/DETAIL_ACCESSIBILITY.md` と `docs/MARKET_INDICATOR_HISTORY.md`。他環境の財務作業には触れない。
