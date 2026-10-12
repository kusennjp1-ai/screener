# 日足配列・不正payload・遅延応答の実画面検証

2026-10-12、ローカル限定。基点は `a7ece1497035a28d5352a0f7e43c76a179c8ed92`。日付選択 `3dc0da7c826b223183f8eabe67e470341d7684b4` と前段ZIPを保持する。

## 観測と最小修正

最初の有効な20ケースのブラウザ実行は7成功/13失敗。不正日付4種×2幅、数値欠損/文字列2種×2幅の12ケースで制御された欠損表示に到達せず、画面が失われた。残り1件はdesktopで既にキャッシュ済みのOTHERを読み込み待ちと仮定したテスト準備の誤り。OTHERの該当queryを消してcold loadを作り、前銘柄の遅延応答が復活しないことを確認した。この枝に製品コード修正はない。

`requireChartIdentity` に全barの日付検証を追加。既存 `validEvidenceDay` を使い、存在しない日付、欠損、重複、順序逆転を拒否する。銘柄、分析基準日、末尾日が一致する既存条件は維持する。payloadを並べ替えたり重複を勝手に選んだりしない。

既存 `chartHistoryWarning` 内のOHLCV/価格関係/順序条件を `invalidChartHistory` として共有。CandlestickChartは不正時に全描画系列を消す。ローソク足・出来高・MA・RS・EPS補助線を含み、前の値を残さない。生の日足数値欄は別に保持し、null/文字列は未確認、実測出来高0は0。EPSは描画の消去のみで、財務計算・capture/admission・公開判定を変更しない。新しい数値閾値・IBD式・価格補完は追加していない。

## ブラウザで実施した範囲

375px/1440pxの各幅で下記11ケース、計22成功。動的ケースはdark、既存の詳細回帰は両幅×明暗。詳細・拡大とも実際のReact画面とchart canvasを使う。

| ケース | 実際に確認した結果 |
| --- | --- |
| 同じidentity内の過去bar追加・減少・選択日消失・空→復帰 | 追加/減少で選択日と終値103を保持。選択日消失時は理由付きで最新実測日へ。空では数値/チャートを消去し、復帰で最新日を選ぶ。出来高0を保持 |
| 最新日の追加 / 最新日の削除（2ケース） | 同一as-ofのまま末尾日が変わるため既存契約で拒否。基準日を作り直さず、旧数値/チャートも消去 |
| 並べ替え / 存在しない日 / 日付欠損 / 重複日付（4ケース） | エラー表示、数値欄消去、旧canvas非表示。正しい履歴へ戻すと最新日の表示に復帰 |
| close=null / close=文字列、volume=null（2ケース） | 選択日維持、終値/出来高とも未確認、描画停止警告。復帰すると実測0と通常表示へ戻る |
| 前銘柄の遅延応答 | OTHER待機中にSYNTH応答を解放しても旧数値/チャートが復活しない。OTHER到着後はOTHERの日付と終値201、SYNTHの103.75を表示しない |
| 拡大チャートで数値欠損→復帰→重複日付 | 欠損は未確認/出来高0、復帰は終値101、重複時は読み込みエラーで数値/canvas消去 |

ブラウザ側の数値欠損検査は描画停止状態を確認し、全11描画系列が空になって同じchartインスタンスで復帰することは描画APIの単体テストで確認する。null、undefined、文字列、NaN、Infinityを使用。JSONで送れない値は単体のみ。

日付選択UI単体の並べ替え耐性と、実際の受信契約の順序不正拒否は別物。日時の補完、休日判定、分析日更新をこの検証から推論しない。合成barはカレンダー日で作成しており、実取引日精度の検証ではない。

## 再現方法と検証結果

既存 `testAuditFixture.js` / `testFinancialFixture.js` を使用。static-data bundleは存在せず、外部取得で埋めない。127.0.0.1以外のブラウザ通信は遮断する。

Vite開発サーバーのApp.jsxレスポンスだけにテスト用参照 `window.__chartTestQueryClient` を挿入し、実QueryClientのrefetchQueriesを呼ぶ。HTTPレスポンスはroute fixtureで差し替える。query key、fetch処理、キャッシュ設定、component lifetime、公開条件を変更せず、setQueryDataによる描画結果の注入もしない。App.jsx本体への変更や製品の新API追加はない。この実装は開発サーバー用で、production buildのE2Eではない。

- 関連Vitest: 5 files / 79成功。今回追加13件。
- 全Vitest: 235 files / 2977成功。
- 新規Playwright: 22成功、pageerror添付は空。既存詳細4＋市場履歴2成功、既存axe検査0。
- lint: 0 errors / 既存6 warnings。build成功、既存chunk警告、実bundle不在でexport skip。
- Golden: 43成功。backend redline: 262成功/既存1失敗（`test_vcp_footprint.py::test_well_formed_on_real_fixtures`、ftnt.csv tight_near_highs）。全ゲートgreenとは主張しない。
- Node24.19/npm11.9、Python3.12.14、Chromium154.0.8037.57。CIのNode22/Python3.11とは異なる。

コマンドはfrontendで既存ローカルバイナリを使用する：

```sh
./node_modules/.bin/vitest run src/static/chartPayloadIdentity.test.js src/static/components/ChartNumericData.test.jsx src/static/components/ResearchChart.test.jsx src/components/Charts/CandlestickChart.reuse.test.jsx src/static/StaticChartViewerModal.test.jsx
./node_modules/.bin/vitest run
npm run lint
npm run build
./node_modules/.bin/playwright test --config=/workspace/chart-payload-browser-verification/playwright.local.config.mjs
./node_modules/.bin/playwright test --config=/workspace/chart-payload-browser-verification/regression/playwright.local.config.mjs
```

Playwright config/結果JSON/ログ/画像/差分は `/workspace/chart-payload-browser-verification/` に保存。サーバーは `VITE_STATIC_SITE=true VITE_BASE_PATH=/ npm run dev -- --host 127.0.0.1 --port 4188`。既存の合成financial proofを使用し、admissionを無効化しない。backend redlineとgate-5のコマンドは既存minervini-dev-loopに従う。

初期harnessではwindow-focus refetchを仮定し、App.jsxのURLパターンがViteのquery文字列に一致しない試行もあった。修正した上で基点の20ケースを実行した。途中中断ログは旧出力混入の可能性があるため、修正前結果の根拠は保存した `playwright-before-results.json` とする。最終JSON/ログは別保存。画像採取位置をエラー本文に合わせて調整後、22件を再実行し55.0秒で成功した。

## 未実施・変更していない範囲

作者の画像抜き取り確認のみで、独立画像レビュー/実音声screen readerは未実施。財務source/generation/as-of不整合payloadの実画面検証は今回対象外。実市場データの精度や継続取得、全履歴完成も未検証。

公開条件の緩和、依存追加、財務capture/admission、閾値、欠損からの値推定、他環境の作業には触れない。Library再試行、push、PR、merge、Actions、公開、外部データ取得、認証設定変更は行わない。
