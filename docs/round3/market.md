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

## M1a〜M1e と M3：規則どおりの表示と、分配日の 2 段階（パッケージ P2）

コミット（すべて claude/r3-market、push なし）：

- 764747b3 M1c（ラベルの印）
- 213c944c M1a（同日の ^GSPC 記録がないと「FTD確認済み」を出さない）
- 68ff39a5 M1b・M1d（目安の開示文）
- 353623ac M1e（公開が古い日の市場タブの結論文）
- 0013dd22 M3（分配日の 2 段階）
- 02660338 M3 の補正（▲と○が並ぶ群の見出しの高さ）
- f2808088 Playwright（brief-market-r3.spec.js 新規、brief-market.spec.js の 1 か所）
- a7fa8f7c M3 の補正（指数の切替の横に並ぶ ▲と○の組を 1 行に保つ）
- 3a4a1625 M3 の補正（電話では ▲と○の組をいつも短い形で 1 行に置き、古い日付をその下に。02660338 の 17px の規則は外した）
- コードの最終 HEAD は 3a4a1625。そのあとのコミットは文書だけ。

### 着手前に確かめたこと（実測）

- **(i) フィクスチャの基準の分配日数**：brief-fixture.js の `index('^GSPC', [3, 11, 19])` と `index('^IXIC', [2, 7, 13, 21])` から S&P 3 日・NAS 4 日。どちらも 5〜6 日ではないので、基準の描画で変わるのは Today の分配日タイルの「5日以上で注意」→「7日以上で注意」だけ（同じ文字数）。
- **(ii) backend の参加度ガード**：`backend/app/services/market_regime.py:56-57` の `BREADTH_ROT_PCT = 40.0` と `BREADTH_DIVERGENCE_NEAR_HIGH = 0.03`。
  - 判定は 291-296 行で、`regime == "confirmed_uptrend"` のときだけ。
  - 200 日線の比率は `breadth_pct_above_200dma < 40`（未満）。母集団はスキャン対象の銘柄（data_preparation.py の `_attach_market_breadth`）。
  - 高値からの距離は `pct_from_high <= 0.03`（以内）。高値は SPY の 252 営業日の終値の最高値（`close.tail(252).max()`）。
  - 計画の 40%／3% と一致した。
- **(iii) tests/static の 長期トレンド警戒／新規購入を抑制**：0 件。
  - src のテストでは briefCandidate.test.js:258、positionSizing.test.js:96、StockPlanCard.test.jsx:138、entryReadiness.test.js:87 に出る。
  - どれも手書きの market オブジェクトを渡すだけで、`modelMarket` の戻り値は照合していない。
  - `modelMarket` のラベルを照合するのは portfolioPlan.test.js と marketTabModel.test.js（どちらもこのトラックのファイル）だけ。

### 作ったもの

**M1a（briefEnvironment.js）**

- 共有の判定 `sameDayFollowThrough(trends, manifest, symbol)` を足した。記録を返すのは、次のすべてを満たすときだけ。それ以外は null。
  - 系列が ready。
  - 記録が `available === true`。
  - `asOf` が asset の `as_of_date` と同じ日。
  - manifest が `markets.US.as_of_date` を持つときは、その日とも同じ。
- FTD 格上げ・目安 0% の分岐は、その記録の state が `confirmed` のときだけ「FTD確認済み」を返す。
- 「NAS調整中」の分岐も同じ判定を使う（挙動は同じ）。
- `gspcFollowThrough`／`gspcFtdDisagrees` の形は変えていない。市場タブの原因行も変えていない。
- 既存テストのうち、記録が無い・古い・算出不可でも接尾辞を出すとしていた箇所は null に反転した。
  - briefEnvironment.test.js の `trends: null`・`loading`・「nothing to compare」の組。
  - marketTabModel.test.js の「the tile keeps its suffix」の組。

**M1b・M1d（reference/marketTabStudy.js の `exposureRuleText`）**

「注意サインも指数の過去の傾向も目安を変えません。」の後に次の 2 つを足した（指示の並べ方どおり M1d、M1b の順）。

- **M1d**：「目安は口座資金に対する新規の建玉合計の上限です。水準（50%・25%）は検証していない独自設定です。」
  - 水準は引数 `caps` の 2 つの上昇トレンドの上限から出す（0% の段は並べない）。手で書いていない。
- **M1b**：「局面判定（バックエンド）は、スキャン対象のうち200日線より上が40%未満でSPYが1年高値から3%以内のとき「上昇に圧力」に下げることがあり、その日は目安が最大25%になります（独自判定）。発動の有無は公開値に含まれません。」
  - 40 と 3 は凍結した定数 `BACKEND_BREADTH_GUARD` から出す。テストが backend のファイルからこの 2 つの定数を読んで照合する。
  - 最大25% は `capText(caps.uptrend_under_pressure)` から出す。
  - 再生の数字（8% 対 12% など）は書かない。

**M1c（portfolioPlan.js、文字列だけ）**

- 「長期トレンド警戒（独自判定）」「新規購入を抑制（独自判定）」にした。
- 分岐・上限・戻り値の形は変えていない。
- `verdictBasis` は前方一致で読むので、文は変わらない（テストを追加）。
- Today のタイルは TodayView の既存の正規表現で印を外す。

**M1e（marketTabModel.js の `verdictWaiting`、MarketScreen.jsx、MarketDetailCard）**

- 結論文を置き換える条件は、次のすべて。
  - `target`（marketUpdateState の、取引を終えた最後の取引日）が有効な日付。
  - 判定の日付 `date` が有効で、`date < target`。
  - `market.cap > 0`。
- 置き換えた結論文は「M/D引け時点の判定です。新しい公開を待っています（買いの検討は最新の判定で）」。
  - 1024px 未満では 1 行の短い形「M/D時点の判定・更新待ち」。
  - 長い形は 320 と 375 で 3 行（+45px）になったため（実測）。モデルは `lead` と `leadShort` の両方を返し、MarketDetailCard が `switcher` で選ぶ。
- 読む値と渡し方は次のとおり。
  - MarketScreen は系列が ready のときは常に `marketUpdateState` を読み、`{ target }` を MarketDetailCard 経由で `marketCardView` の新しい任意入力 `update` に渡す。
  - モデルは時計を読まない。
  - 推移タブの「?」は、今までどおり長期履歴があるときだけ state を読む。
- **限界（OD-M9）**：変わるのは市場タブの結論文だけ。
  - Today のタイル、銘柄の行、buyGate はそのまま。
  - その間に目安が開いたまま公開が止まると、Today と銘柄の行には「検討可」が残る（上部バーの「古い」表示はある）。

**M3（marketTabModel.js、marketTabGroups.js、reference/marketTabStudy.js、distributionDays.js のコメント 1 行）**

- **定数**
  - `DISTRIBUTION_REFERENCE = 5`、`DISTRIBUTION_CAUTION = 7`（独自設定）。テストで、コミット済みの参照の `buckets.ddGrades`（[5,6] と [7,null]）に一致させている。
  - `distributionGrade` と `DISTRIBUTION_TEXT`（「7日以上」「5〜6日」）。
  - `DISTRIBUTION_WARN = 5` は変えない。調査の二分割（APP_RULES と参照の ddWarn）としてコメントを付けた。
- **Today**
  - 7 日以上は「注意：<名前>が7日以上」（▲・琥珀）。
  - 5〜6 日は「参考：<名前>が5〜6日」（琥珀なし、▲なし）。
  - どちらでもなければ「7日以上で注意」。
- **市場タブ**
  - 確認項目は 5 日以上で同じ文のまま発火する。
  - 5〜6 日は check 自身の `reference` で参考に数える（○、`references`。注意・群の▲・タブの▲には入れない）。7 日以上は注意。
  - 行の印は ▲「7日以上」／○「5〜6日・参考」。▲の側が無いとき、行の状態は ○ 参考。
  - `REFERENCE_CHECKS` と参照の〔参考〕には、分配日を足していない。
- **文**
  - RULE_TEXT.dist は「…除外の基準は資料により5%／6%で、当アプリは後日の高値で5%です（独自選択）。7日以上で注意サイン、5〜6日は参考です（独自設定）。」。
  - 開いた行の 1 行目は「目安の判定はSPYの別集計」、2 行目は「下の分配日は^GSPC/^IXICの別集計（ストーリング日なし・7日以上で注意、5〜6日は参考）」。
  - 「過去は全期間並み」は書いていない。5〜6 日についての調査の言葉は、指数ごとのタグ〔未確立〕と、その指数自身の「過去の傾向」の行だけ。
- **distributionDays.js**：コメント 1 行だけ足した（除外の基準は資料により 5%／6%、当アプリは後日の高値で 5%）。method id はテストで固定した。
- **群の見出し**：片方の指数が 7 日以上で他方が 5〜6 日のとき、見出しに ▲ と ○ が縦に並び、閉じた高さが 7px 増えた（48px 対 40.4px）。
  - 最初は 1024px 未満でこの組（`is-pair`）だけ上の余白を 0 にし、印を 17px の行にした（02660338）。これは当日の状態では足りたが、1 営業日遅れの日付が下に加わると見出しが 44→60px になった（実測、切替なしの配置）。
  - そこで電話では、組をいつも段のタブと同じ短い形「▲ 1」「○ 1」にし、見出しの横では 1 行のグリッドに置いて日付をその下にした（3a4a1625。17px の規則は外した）。語（注意／参考）は読み上げ用に残す。見出しは当日 40.4px、1 営業日遅れ 42px（変更前は 44px）。
  - 印が 1 つのときと、デスクトップは語を残し、縦に並べる。
- **指数の切替の横の組**：Nasdaq の終値が公開されていると、電話では群の印が見出しの下の行（切替の横、`is-inline`）に並ぶ。
  - 7 日以上と 5〜6 日の組に、1 営業日遅れの日付「10/1時点の値」が加わると、375 と 390 でこの行が折り返し、見出しが 44.4→62.4px（+18px）になった（実測。320 は変更前から 62.4px）。
  - この横の欄でも、組は短い形「▲ 1」「○ 1」にした（a7fa8f7c、3a4a1625 で電話の組全体に広げた）。

### 計画・指示からの補いと判断

1. **200 日線の下の状態は、電話で閉じた高さが 27px 増える（M1c の代償。直していない）。**
   - ラベル「長期トレンド警戒（独自判定）」は 20px で 280px 要るのに、欄は 188〜242px しかない。そのため「（独自判定）」が 2 行目に回る。「50日線割れ（弱含み・独自判定）」がもともと折り返しているのと同じ形。
   - 指数も 200 日線の下にそろえた状態の実測（下の表）：375 で 1215→1242。50日線割れの状態（1242）と同じで、1288 以内。先頭下端は 527→554 で、756 以内。
   - 200 日線の下の FTD 格上げの状態も同じく +27px（375 で 1215→1242）。FTD 格上げの状態は「増やさない」が条件なので、ここに挙げる。
   - 指数が 200 日線の上のまま（根拠の食い違い行が出る）作った状態では、375 で 1273→1300 になる。
   - 選択肢：このまま受け入れる。または、統合で市場タブのラベルだけ印を外す（M1c の目的の画面で印が消えるので勧めない）。
2. **M1e の電話の結論文は短い形にした**（上記。長い形は 320／375 で 3 行）。1440 は長い形。
3. **分配日の橋渡しの句は、行ではなく開いた行の 1 行目に置いた。**
   - 行のラベルに足すと、320 と 375 で +19px（390 では収まる）。行の注記にすると、どの幅でも +46px 以上（実測）。
4. **M1b の文で「高値」を「1年高値」とした。** backend は 252 営業日の終値の最高値を使っているため。
5. **M1e には猶予がない（指示どおりの条件の帰結）。**
   - 条件は「取引を終えた最後の取引日が判定の日より後」。毎取引日、次の取引日の引け（米東部 16:00）から、その日の公開が届くまで成り立つ。
   - 実際の refresh_schedule は分析日の 7 日前から 45 日後までの取引日と引けの時刻を持つ（collect-market-trends.py:85-89 を読んだ）。したがって次の取引日の引けは必ず含まれる。
   - 11-12 分の公開は 11-13 20:10 JST だった。毎日この間隔なら、目安が開いている日は毎日およそ 14 時間（次の引けの 06:00 JST 前後から公開まで）、市場タブの結論文が「更新待ち」になる（推論。公開の時刻は日によって違う）。
   - 上部バーの「古い」表示は 28 時間の猶予（FRESHNESS_GRACE_HOURS）の後にしか出ないので、毎日この間は 2 つが一致しない。
   - 文そのもの（「M/D引け時点の判定です。新しい公開を待っています」）は、その間も事実に合っている。
   - 猶予を足すか（例：同じ 28 時間）は指揮役の判断に回す。
6. **「5 本と 7 本の状態で、高さが基準の状態を超えない」は文字どおりには成り立たない。**
   - 発火した確認項目は、変更の前後どちらでも注意サインの一覧に 1 行を足す（375 で 1259 対 1219）。
   - そこで、変更前のコードと変更後のコードで、同じ状態の高さを比べた（下の表：電話の 3 幅とも不変）。
   - コミットした spec では、次を見ている。
     - 375 で ≤1288、先頭下端 ≤756。
     - ▲と○の色、320 で文字切れなし。
     - ▲○の組の見出しが ▲ だけの見出し以下。
     - 時計を進めても内容の高さと結論文の高さが不変。
7. **既存のテストで 5〜6 日を「注意」の例に使っていたものは、入力を 7 日に変えて意図を保った。** そのうえで 5〜6 日の例を別に足した。src/test/fixtures は変えていない。
8. **M1b・M1d のテストは portfolioPlan.test.js に置いた**（`exposureRuleText` の全文照合がもともとそこにある）。
   - こうすると、M3 の「編集しないまま通ること」の確認のときに src/static/reference のテストを無編集のまま走らせられる。
   - marketTabStudy.test.js、MarketCard.jsx、brief-market-phone.spec.js はこのパッケージで変えていない。brief-market-phone.spec.js には「5日以上」の照合が無かった（grep 0 件）。

### 高さ（実測、変更前→変更後）

- **測り方**：スクラッチの計測 spec `audit3/r3-market/measure/m3-measure.spec.js`。
  - Chrome for Testing 147、CI のフォント、reduced motion、ポート 4433。
  - 「変更前」は、このワークツリーで src の変更ファイルだけを一時的に 45603f06 に戻して測り、測ったあと HEAD に戻した（git status がクリーンなことを確認）。
  - 「変更後」は 0013dd22 の木（▲○の組の状態と、指数を 200 日線の下にそろえた状態は 02660338）。
- **内容高**：`#brief-main .brief-stack` の下端。**先頭下端**：判定・注意サイン・最初のタブの下端の最大。
- **負荷**：/proc/loadavg は 0.61→2.20（1 回目の変更前）、1.86→3.24（1 回目の変更後）、0.69→3.64（2 回目）。高さは負荷に依存しない。

| 状態 | 320 内容高 | 375 内容高 | 390 内容高 | 375 先頭下端 | 1440 内容高 |
|---|---|---|---|---|---|
| 基準（S&P 3日・NAS 4日） | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2378→2455 |
| S&P 5日 | 1401（不変） | 1259（不変） | 1259（不変） | 553（不変） | 2396→2473 |
| S&P 6日・NAS 5日 | 1443（不変） | 1282（不変） | 1282（不変） | 576（不変） | 2396→2473 |
| S&P 7日 | 1401（不変） | 1280（不変） | 1280（不変） | 574（不変） | 2396→2473 |
| S&P 7日・NAS 5日 | 1443（不変） | 1302（不変） | 1302（不変） | 596（不変） | 2419→2481 |
| FTD格上げ（50日線の下） | 1390（不変） | 1242（不変） | 1219（不変） | 554（不変） | 2359→2436 |
| FTD格上げ（50日線の下）・1営業日遅れ | 1432（不変） | 1264（不変） | 1241（不変） | 576（不変） | 2392→2468 |
| 50日線割れ（格上げでない） | 1390（不変） | 1242（不変） | 1219（不変） | 554（不変） | 2311→2388 |
| 200日線の下（調整・指数も200日線の下） | 1336→1363 | 1215→1242 | 1192→1219 | 527→554 | 2311→2388 |
| 200日線の下のFTD格上げ | 1336→1363 | 1215→1242 | 1192→1219 | 527→554 | 2359→2436 |
| 200日線の下のFTD格上げ・1営業日遅れ | 1378→1405 | 1237→1242 | 1214→1219 | 549→554 | 2392→2468 |
| 200日線の下（指数は200日線の上＝根拠の食い違い行あり） | 1394→1421 | 1273→1300 | 1250→1277 | 527→554 | 2311→2388 |
| 時計を10/7 09:00Zへ（M1e） | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2378→2477 |

| 状態 | 320 Today 内容高 | 375 Today 内容高 | 375 3タイル | 375 接尾辞 | 320 文字切れ |
|---|---|---|---|---|---|
| 基準（S&P 3日・NAS 4日） | 1213（不変） | 1106（不変） | 96.9（不変） | NAS調整中→NAS調整中 | なし |
| S&P 5日 | 1231（不変） | 1130→1106 | 96.9（不変） | NAS調整中→NAS調整中 | なし |
| S&P 6日・NAS 5日 | 1231（不変） | 1148→1124 | 96.9（不変） | NAS調整中→NAS調整中 | なし |
| S&P 7日 | 1231（不変） | 1130（不変） | 96.9（不変） | NAS調整中→NAS調整中 | なし |
| S&P 7日・NAS 5日 | 1231（不変） | 1148→1130 | 96.9（不変） | NAS調整中→NAS調整中 | なし |
| FTD格上げ（50日線の下） | 1296（不変） | 1153（不変） | 115.8（不変） | FTD確認済み→FTD確認済み | なし |
| FTD格上げ（50日線の下）・1営業日遅れ | 1325→1289 | 1182→1164 | 115.8→97.8 | FTD確認済み→なし | なし |
| 50日線割れ（格上げでない） | 1260（不変） | 1135（不変） | 97.8（不変） | なし→なし | なし |
| 200日線の下（調整・指数も200日線の下） | 1241（不変） | 1135（不変） | 97.8（不変） | なし→なし | なし |
| 200日線の下のFTD格上げ | 1277（不変） | 1153（不変） | 115.8（不変） | FTD確認済み→FTD確認済み | なし |
| 200日線の下のFTD格上げ・1営業日遅れ | 1306→1270 | 1182→1164 | 115.8→97.8 | FTD確認済み→なし | なし |
| 200日線の下（指数は200日線の上＝根拠の食い違い行あり） | 1241（不変） | 1135（不変） | 97.8（不変） | なし→なし | なし |
| 時計を10/7 09:00Zへ（M1e） | 1213（不変） | 1106（不変） | 96.9（不変） | NAS調整中→NAS調整中 | なし |

- **上の表は、Nasdaq の終値が無いフィクスチャの配置（切替なし）の値。** 切替のある配置（brief-market-phone.spec.js の withCloses と同じ作り方）も、変更前→a7fa8f7c で測った。
  - 7 日だけ、7 日と 5 日、7 日と 6 日の 3 通りを、それぞれ当日と 1 営業日遅れで測った。
  - 320／375／390 の内容高と見出しの高さは、6 状態とも不変（例：7 日と 5 日・1 営業日遅れは、375 で 1292、390 で 1284、見出し 44.4px）。
  - 1440 では、1 営業日遅れで ▲・○・日付が縦に 3 つ並び、見出しが 44→68px になる（デスクトップに予算はない）。
  - 切替なしの配置の 1 営業日遅れ（7 日と 5 日、7 日と 6 日）も同じく測った。変更前 44px → 3a4a1625 で 42px、375 の内容高 1314→1312。
  - 負荷（/proc/loadavg）は、切替ありの変更前と変更後 2.62→7.95、a7fa8f7c の再計測 5.08→7.48、切替なしの 1 営業日遅れの変更前と変更後 0.18→2.23、3a4a1625 の再計測 1.05→2.19。
- **1440 の +77px** は M1b・M1d の開示文。開示文の段落が 57.5px（3 行）→134.5px（7 行）になった。M1e の状態ではさらに結論文が 2 行（+22px）。
- **1440 で ▲と○が並ぶ群の見出し**は 40.4→48px（デスクトップには高さの予算がないので、そのまま）。
- **折りたたみの見出し**は、測ったすべての状態で 44px（不変）。
- **銘柄画面**（200 日線の下の状態、ZZNV と ZZAR）
  - 375 は高さ不変（3111／2553）。本文に該当のラベルは出ない。
  - 1440 も高さ不変（1769）。印つきのラベルが出るのは、横に並ぶ Today の地合いカードの判定だけ（スクラッチの `probe-stock.spec.js`）。

### 関門（実測、コードの最終 HEAD 3a4a162）

- **(1) MARKET の spec**：81 件通過（3.0 分）。再実行は不要だった。
  - 途中の f2808088 で 75 件（3.4 分、/proc/loadavg 3.91→9.20）、a7fa8f7c で 78 件（4.3 分、8.13→11.56）、どちらも全件通過。そのあと組の高さのテストを足した。
  - コマンド：`AUDIT_MATCH='brief-market' npx playwright test -c audit3/r3-market/pw-147.config.mjs`（FONTCONFIG_FILE と PATH は指示どおり。以下も同じ）。
  - /proc/loadavg は 2.06→4.10。
- **(2) 凍結 spec（無編集）**：124 件通過、2 件スキップ（brief-oracles の R1／R2 の test.fixme）。6.7 分（f2808088 と a7fa8f7c でも同じ結果）。
  - コマンド：`AUDIT_MATCH='brief-(compact|phone|oracles|freshness)\.spec'`。
  - /proc/loadavg は 4.97→5.59。
  - brief-compact・brief-phone・brief-oracles・brief-freshness・brief-fixture は 45603f06 から差分 0。
- **(3) dump**：`r3-harness/dump/run-dump.sh <W> 4433` → `dump-3a4a162.json`（sha256 822bc4c4…baae9d24）。
  - f2808088・a7fa8f7c の dump とバイト単位で同じ（cmp）。古い出力は削除した。フィクスチャの基準状態には ▲と○の組が出ないため。
  - 8849bf9 との差は、スクラッチの `audit3/r3-market/gate/dumpdiff.py` で比べた（結果は `gate/dumpdiff-3a4a162.txt`）。変わったのは次だけ。
    - 1440-market：開示文の 1 段落（M1b・M1d の 2 文が加わる）。content 2378→2455、page 2410→2487。下の要素は 77px ずつ下がる。
    - 375-today-4／5 と 1440-today-4／5：分配日タイルの「5日以上で注意」→「7日以上で注意」。高さは不変。
    - 375-market-tab0〜3：閉じた「目安と判定の基準」の中身の箱だけ（expander-body 212→346、p 96→230.5）。content は 1219／1031／1075／2141 で不変。
    - 1440-stock-ZZAR／ZZHW／ZZNV／ZZNV-weekly／ZZSD-broken／ZZZF：本文の 1 行だけ（「5日以上で注意」→「7日以上で注意」）。箱・content・page は不変。
      - この行は、1440 の銘柄画面の左に並ぶ Today の地合いカードの分配日タイル。銘柄画面そのものの要素は変わっていない。
      - したがって、関門 (3) の「銘柄画面はすべて同一」は文字どおりには満たしていない。違いは Today の要素 1 行の文字だけ。
  - 候補とウォッチの画面（375・1440、4／5 銘柄）は完全に一致した。
- **(4) ビルド**：`r3-harness/build/run-build.sh <W>` → `build-3a4a162.json`。
  - `npm run build` のエントリチャンクは gzip 130.67 kB。STEP 0（c61bf96）の 130.28 kB から +0.39 kB で、線 134.00 kB の内側（a7fa8f7c では 130.66 kB。遅延チャンクの名前がエントリに入るので、その分だけ揺れる）。
    - 増えた分は、共有の `marketTabModel.js` に置いた `verdictWaiting`、分配日の定数、長くなった RULE_TEXT.dist と、briefEnvironment.js・portfolioPlan.js の変更。
  - デザイン受け入れ用ビルドのエントリは 130.47 kB（vite 表示）。
  - 遅延チャンク MarketScreen は 29.76→30.25 kB gzip。
  - /proc/loadavg は 2.06→5.63（関門 (1) と dump と続けて実行）。
  - f2808088・a7fa8f7c の build・dump・snapshot/trees の出力は削除した。P1 では作っていない。

### その他の実測

- **M3 で「無編集のまま通ること」**：M3 の src を変えた直後、テストを編集する前に走らせた。4 ファイル、63 件すべて通過。
  - コマンド：`npx vitest run tools/market-regime-reference.test.mjs tools/market-regime-study.test.mjs src/static/reference`。
  - 4 ファイルは marketTabStudy.test.js、marketRegimeReference.test.js、market-regime-reference.test.mjs、market-regime-study.test.mjs。
- **関係ファイルの vitest**：brief・reference・portfolioPlan・distributionDays・export-market-trends・調査の各テスト。40 ファイル、842 件通過。
- **vitest 全体（3a4a162 の木）**：247 ファイル、4008 件すべて通過、301.3 秒。
  - /proc/loadavg は 4.28→6.70。他のトラックと共有の負荷下の時間なので、参考値（advisory）。
  - f2808088 の木（4007 件、274.8 秒）と a7fa8f7c の木（4008 件、229.4 秒）でも全件通過。
  - 文書を読むテストは無い（grep。docs/round3 を名指しするのはコメントだけ）。
- **eslint**：45603f06 から変えた .js／.jsx／.mjs の 16 ファイルで、指摘 0。
- **所有の関門**：毎コミット前に `check-ownership.py MARKET` で OWNERSHIP OK（最後は 19 paths）。

### 未検証

- **実際の ^GSPC／^IXIC の分配日数がどの段階に入るか**（4 以下、5〜6、7 以上）：次回の公開の CI ログ（M0 の行）を読むまで分からない。期待値の数字は書かない。
- **実データで M1a の同日判定が FTD 格上げの日にどちらになるか**：今は格上げではないので分からない。
- **M1e が実際に出るか**：公開が止まり、かつ目安が開いている日にしか出ない。その組み合わせは実データでは見ていない。
- **長くなったラベルがほかの画面でどう見えるか**：計画・保有のドロワー、entryReadiness の市場の規則文、buildPortfolioPlan の blockers（所有外）。
  - 測ったのは銘柄画面 2 つ（375／1440）だけ。ResearchHero は `replace('（独自判定）','')` で印を外す（コードを読んだ）。
- **時間の計測**：このパッケージでは取っていない。1440 の長い初回タスクは C1 の対象。

### 統合への依頼・報告（このトラックでは変えていない）

- **調査ツールの説明が古くなる**：`frontend/tools/market-regime-study.mjs`（41 行、762 行）に「market tab warning at >= DISTRIBUTION_WARN」とある。画面の注意は 7 日以上になったので、説明が合わなくなる。定数と参照は変えていないので、動作には影響しない。
- **M1c のラベルが所有外の画面に届く**：entryReadiness の市場の規則文、buildPortfolioPlan の blockers、PortfolioPlanDrawer／PortfolioDecision。これらの画面のテストはラベルを照合していない（grep）。
- **200 日線の下の状態の +27px**：上の判断 1。受け入れるかを決めてほしい。
- **M1e の猶予**：上の判断 5。毎日およそ 14 時間（推論）「更新待ち」になる。猶予を足すかを決めてほしい。
- **新しく見える形**：電話の ▲と○の組の短い形「▲ 1」「○ 1」（段のタブと同じ形）。指示には無かったが、閉じた高さを増やさないために入れた。デザインの確認を頼みたい。
- **CONTEXT.md の語彙**（統合時に移す）
  - 「参考（市場の注意サイン）」に分配日 5〜6 日を加える。
  - 「同日の記録」：`sameDayFollowThrough` が返す、分析日と同じ日の指数の判定記録。
  - 「更新待ちの判定」：M1e の結論文。
