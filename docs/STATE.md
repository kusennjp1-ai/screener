# STATE — PR99 研究モード切替の回帰固定（未push）

更新2026-10-19。branch review/pr98-ui-integration-32ee9c2。未push実装候補71c6d863a73a38b3e02861874a098a755fcc65f0のparentはd5a428c1d0dfa2c22347b8d631c2de58851a3a28。今回も明示指示によりpushしない。

## 現在の変更と根拠

- 候補の2つの効果を区別する。研究/書籍モードの未描画EMA10/20/50生成省略は計算削減。memoに両フラグを追加した変更は、researchViewだけを変えた時に再作成されたchartへ価格・出来高等を渡し直す既存更新漏れの修正である。表示完全不変とは言わない。
- 今回はCandlestickChart.reuse.test.jsxへ独立4ケース（日足/週足×書籍注記OFF/ON）を追加。実装2ファイルは71c6d86から変更なし。同じ入力参照・bookAnnotationsを維持し、通常→研究→通常の切替を検査する。
- 旧d5とEMA省略だけは各4件失敗（新chartへsetData 1回を期待、実際0回）。依存配列変更だけと候補は各4件成功。同じ正の期待値で比較し、前回の厳密等価性4失敗を合格化していない。
- 各切替後の価格/出来高/SMA/EMA/RS/EPSの必要更新と、非空の書籍注記・帯・購入点・pivotの再設定は1回。同じpropsのrerender×3とホバーのstate更新で追加の系列更新/注記attach/chart生成なし。旧chartは各1回remove。初期の週足選択だけは日足→週足の2回設定を明記して保持。
- jsdom/chart API mockでの呼出し確認であり、実Canvas描画回数・ブラウザーイベント循環・実ピクセル検証ではない。

## 検証

- 新規4ケースと4構成の切り分け完了。対象36件成功。全frontend258files/3629成功（224.06秒）。lint0errors/既存6warnings。build成功、実static-data exportは不在でskip、既存chunk警告あり。
- 前段で隔離Python3.12.14 venvへ公式PyPIからruntime+test依存を導入し、Red line275（17.97秒）/Golden43（4.65秒）成功。GoldenはRed lineにも含まれる。今回backend無変更のため再実行していない。CI Python3.11/server依存との完全同一性は未実証。
- 以前の変換480ケース/1920 assertionsは一致。保存LLY/QQQ各186本のdaily未描画EMA点481→0。純JSの改善約0.005–0.011ms/変換、weekly混在は、735msの実切替やP1/Q1/D9の原因解消を証明しない。

## 公開・証拠の状態

- 最後のremote保存確認は2026-10-19 18:05UTC、PR99 head d5、draft/open/unmerged。既存CI39286575063は4job成功。Design39286575062はbuild成功後に計測/review失敗。未push候補のexact SHA CIは未実行。
- 最新Designの詳細ログ/report/profile/trace/画像bytesは未取得。実ピクセル未確認。以前のForbidden/CLI401の経路は再試行しない。今回は新取得/認証変更/ネットワーク設定変更/新run/merge/公開なし。
- D9の207点・初回同期描画・実size/DPR・元50ms基準、品質/鮮度/必須unknownと財務の判定基準は維持。期限切れunknownは正当動作でfreshカテゴリーの代替ではない。ordinary carryは無効かつ10月17日期限切れ。
- 財務5ケースの実source/manifest/receipt bytes、実画面受入れ、原本全230規則照合、実3期売上加速接続、不足5市場producer・継続収集等は未完了。
- 自己レビューのみ。local Chromiumのsandboxを回避しない。最新詳細はpr99-transition-regression/、前段はpr99-backend-review/evidence/とpr99-local-performance/へ保存し、既存Library PR99成果物を更新する。bd未導入。
