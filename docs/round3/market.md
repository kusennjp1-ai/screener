# Round 3 MARKET トラック：市場環境（地合い）の改善

作成 2026-11-14（日本時間）。ブランチ claude/r3-market（土台 45603f06＝main に STEP 0〔#145〕を合流したもの）。
項目は市場環境の計画（audit-market/market-plan.md）§3 の M0〜M10。全項目は round 3 計画（docs/round3/plan.md）§3 の規則 1〜23 で審査する。
語彙は統合のときに CONTEXT.md へ移す。この文書では、測った・読んだもの（実測）と、まだ確かめていないもの（未検証）を分けて書く。

## 範囲（Scope）

- **492 画面のラベル検査はこのトラックの関門ではない。**
  - このトラックは規則 16 のチャートのファイル（priceChart.js、chartLabels.js、PriceChart.jsx、StockChartCard.jsx、chartReadout.js、bookTechnicalEvidence.js）を触らない。
  - 市場タブの指数チャート（MarketScreen の IndexChart）は、その検査の範囲外。
- **M8 の producer は出力を切った状態で入る**（`EMIT_R3_MARKET_FIELDS = False`）。
  - 規則 18（UI が先）による。新しいキーを受け入れる UI が先に Pages に届き、出力を入れるのは後の追従コミット。
- **このトラックの関門**は次の 4 つ。
  - このトラック自身の spec（brief-market.spec.js、brief-market-phone.spec.js、brief-market-r3.spec.js）。
  - 凍結された brief-compact／brief-phone／brief-oracles の spec。
  - dump の差分。
  - エントリチャンクの増分。
- **変えないもの**
  - 目安（`MARKET_CAPS`）と `modelMarket` の分岐。
  - buyGate と backend の局面判定。
  - `distributionDays.js`／`followThroughDay.js` の定義と method id。
- **実データに依存する値の扱い**：実際の ^GSPC／^IXIC の履歴に依存する値は、次回の公開の CI ログを読むまで未検証のままにする。期待値の数字は書かない。

## M0 指数の値を CI ログに 1 行出す（パッケージ P1、コミット 3584d81f）

公開フィールドは足さず、UI も変えない。11-12 分の指数の値が検証できなかった原因（ON-07）を、次回の公開分から実測にするための項目。

### 作ったもの

`frontend/tools/export-market-trends.mjs` に純関数 `marketIndexLogLines(payload)` を足した。組み上がった market-trends の payload の各指数について 1 行の文字列を返す。

```
Market indices <as_of_date>: <symbol> last=<日付|-> historical=<true|false> dd=<本数|unavailable(<理由>)> ddDates=[<日付,…>]|- ft=<state|unavailable(<理由>)> day=<n|-> ftd=<日付|-> decline=<x.xx|->
```

`exportMarketTrends()` が series のファイルを書いた直後に `for (const line of marketIndexLogLines(payload)) console.log(line);` を呼ぶ。したがって行は、書かれたバイトと同じオブジェクトを読んでいる。`export-research.mjs` は変えていない。

各値の読み先は次のとおり。どれも asset に書いた値を読むだけで、計算し直さない。

| 欄 | 読む値 | 無いとき |
|---|---|---|
| `last` | `indices[i].points` の最後の点の日付（指数の最後のバー） | `-` |
| `historical` | `indices[i].historical === true` | `false` |
| `dd` | `lastObserved.value`。ただし `lastObserved.date` が `last` と同じ日のときだけ | `unavailable(indices[i].reason)` |
| `ddDates` | `events` のうち `state === 'active'` の日付 | `dd` が出せないときは `-`（空の一覧 `[]` にはしない） |
| `ft` | `followThrough.state`（`followThrough.available === true` のとき） | `unavailable(followThrough.reason)` |
| `day` | `followThrough.attempt.day` | `-` |
| `ftd` | `followThrough.ftd.date` | `-` |
| `decline` | `followThrough.declinePct` の小数 2 桁（負なら U+2212） | `-` |

決めたこと（計画の書式からの補い）は次のとおり。

- **`ddDates` は書式に `-` の形が無いので補った。** 本数が出せない指数で `ddDates=-` とした。`[]` は「0 日」と同じ意味になるため（規則 1）。
- **履歴が 1 営業日遅れの指数**（`historical: true`、`available: false`、`latest: null`）は、自分の最後のバーの本数（`lastObserved`）を自分の日付（`last=`）の下に出す。今日の値としては出さない（規則 2）。
- **理由の文は空白・改行を 1 つの空白にまとめる。**
  - 収集側の理由は Python の `str(error)` で、改行を含みうる。
  - 改行が入ると 1 指数 1 行が崩れ、行頭の `::` がワークフローのコマンドとして読まれうる。
- **この関数は例外を投げない。** 公開の経路の中で動くため。payload が無い・形が違うときは空の配列か `-`／`unavailable(-)` を返す。
- **新しい閾値・定数は無い。**

既存テストの変更は 1 か所。

- 「foreign cwd から同じ seed と manifest を再生する」テストは、子プロセスの標準出力の全体を `JSON.parse` していた。
- 行が増えると壊れるので、最後の行を entry として読むようにした。
- 前の行は、書かれた series に対する `marketIndexLogLines` と一致することを確かめている。実際のプロセスの標準出力に行が出ることの確認にもなる。

CI で行が出る回数は次のとおり。

- Static Site の 1 回の実行では `export-research.mjs` が 2 回走る（static-site.yml:1010 と :1030）。research-ui-release.yml も同じく 2 回（:275 と :286）。
- そのため行は 2 回出る。公開されるのは後の方の行。

### テスト（export-market-trends.test.mjs、describe「market index log lines (M0)」）

すべて producer（`buildMarketTrends`／`exportMarketTrends`）を通して作り、行を正規表現で欄に分けて asset の値と照らす。

- **(a) 通常**
  - コミット済みの種 `data/market-trend-source-2026-10-23.json` を使う。
  - `last`・`dd`・`ddDates`・`ft`・`ftd`・`decline` が asset の値と一致する。
  - `ddDates` の個数は `dd` に等しい。
  - 既存テストが確かめている値（^GSPC は 5 本・confirmed・FTD 2026-04-08、^IXIC は no_correction）とも合う。
- **(b) 1 営業日遅れ**
  - ^GSPC の最後のバーを除く。
  - `historical=true`、`last=2026-10-22`（＝`lastObserved.date`）、`dd` は `lastObserved.value`。
- **(c) 欠測**
  - ^IXIC の 1 本の出来高を null にする。
  - `dd=unavailable(<asset の理由>)`、`ft=unavailable(<asset の理由>)`、`ddDates=-`、`last=-`。
  - ` dd=数字`・` ft=数字`・` ddDates=[` が無いことを確かめる。
  - 同じ日付の出典が無い場合と、改行と `::error::` を含む収集側の理由が 1 行のまま出る場合も確かめる。
- **(d) ラリー試行と FTD**
  - 同じ実バーを 2026-04-08 で切る。
  - ^GSPC は `ft=confirmed ftd=2026-04-08 day=- decline=-`。
  - ^IXIC は `ft=rally_attempt day=6 ftd=-`（試行の開始は 2026-03-31）。
- **形の崩れた payload**：例外を投げない。負の下落率は U+2212 で書く。最後の点の本数でない `lastObserved` は、最後の点の日付の下に出さない。
- **バイトの同一性**
  - 長期履歴が取得される前の時刻（2026-10-26T22:00Z）で `exportMarketTrends` を呼ぶ。
  - 書かれた series が `JSON.stringify(buildMarketTrends(…))` と同じバイト・同じ path・同じ sha256 になる。
  - 返り値は `buildMarketTrends` と等しく、`marketIndexLogLines` は payload を変えない。
  - `console.log` は行ごとに 1 回ずつ、その順で呼ばれる。

### 実測（このワークツリー、Node 22）

- **このファイルのテスト**：`npx vitest run tools/export-market-trends.test.mjs` → 1 ファイル、43 件すべて通過。
- **計画の手順 5 の 3 ファイル**：`npx vitest run tools/export-research-order.test.mjs tools/export-market-trends.test.mjs tools/restore-market-trend-source.test.mjs` → 3 ファイル、69 件すべて通過。
  - 開始時の /proc/loadavg は 6.55 5.17 4.10。
  - 3 つとも、SESSION_CALENDAR_PYTHON と FINANCIAL_REPLAY_PYTHON を指定し、PATH の先頭を /opt/node22/bin にして実行した。
- **lint**：`npx eslint tools/export-market-trends.mjs tools/export-market-trends.test.mjs` → 指摘 0。
- **payload のバイト（変更の前後）**
  - スクラッチのスクリプト `audit3/r3-market/m0-bytes.mjs` を、変更前の木と変更後の木で実行した。
  - 対象は次の 7 つで、sha256 はすべて同一。
    - `buildMarketTrends` の 5 通り（通常・1 営業日遅れ・出来高 null・出来高 0・別の日付）。
    - `exportMarketTrends` の 2 通り（長期履歴なし／あり）。それぞれ manifest 参照と、書かれた全ファイルを比べた。
  - 例：通常の series は `ed029467…932e2df6`、長期履歴つきは `b2059b64…69125c009`。
  - 変わったのはログ行だけ（変更前 0 行、変更後 4 行）。
  - 出力は `audit3/r3-market/m0-bytes-base.json` と `m0-bytes-head.json`（コミットしない）。
- **export-research の標準出力を厳密に読むものの有無（.github/ と frontend/tools/ を grep し、該当箇所を読んだ）**
  - 標準出力の全体を解析していたのは、上に書いた自分のテスト 1 か所だけ。
  - export-research の行を照合するテストはすべて `toContain`／`toMatch` で、行が増えても落ちない。
    - export-research-order.test.mjs:467-493。
    - check-data-quality.test.mjs:108。
    - financial-generation-carry.test.mjs:445-446。
  - ワークフローは `node tools/export-research.mjs` の出力をそのまま CI ログに出している。対象は static-site.yml、research-ui-release.yml、design-acceptance.yml。
  - .github/scripts の呼び出し元は、どれも出力を捨てるか、失敗時のメッセージに含めるだけ。標準出力を `JSON.parse` するワーカーはあるが、どれも export-research や exportMarketTrends を同じプロセスで動かしていない。
    - 呼び出し元：ordinary-session-calendar.mjs、financial-performance-exception.mjs、financial-candidate-preview.mjs、select-release-source.mjs、design-financial-carry.mjs、fixtures/*lifecycle*.mjs、fixtures/postcapture-pages-rehearsal.mjs、run-*-retained-price-*.py。
    - `JSON.parse` するワーカー：financial-baseline-normalization-worker.mjs、financial-preview-comparison.mjs、financial-preview-source-phase.mjs。
  - export-research はもともと標準出力に複数の行を出している（`SEC admission …`、`Research index …`、`Market context …` など）。
  - `restore-market-trend-source.mjs` は標準出力に JSON を出すが、呼ぶのは `buildMarketTrends` だけで、ログ行は出ない。
- **vitest 全体（1 回、コミット 3584d81f の木）**：`npx vitest run`（上と同じ環境変数）→ 247 ファイル、3989 件すべて通過、失敗 0。
  - 所要 332 秒。/proc/loadavg は開始時 4.15 4.97 4.14、終了時 11.47 8.24 5.76。
  - 時間は他のトラックと共有の負荷下で取ったもので、参考値（advisory）。

### 未検証

- **実際の ^GSPC／^IXIC の行**：次回の公開の CI ログ（Static Site の 2 回目の export-research の出力）からしか読めない。期待値の数字は書かない。11-12 分はさかのぼって確かめられない。
- **.github/scripts の node:test スイート**（lifecycle など）：実行していない。標準出力の扱いはコードを読んで確かめただけ。
- **エントリチャンクの増分**：測っていない。変えたのは `frontend/tools/` のファイルだけで、アプリのコードはこのファイルを読み込まない（src からの import はテストだけ）ため、増分は構造上 0 のはず。
- **Playwright**：このパッケージでは不要で、走らせていない。
