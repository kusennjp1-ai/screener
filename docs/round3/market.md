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

**P5（M8d、コミット 3e3af808）で行末に ` stalling=<本数|unavailable(<理由>)> stallingDates=[<日付,…>]|-` を足した。** この 2 欄だけは、出力が off の間は asset ではなく同じ build の値（`buildMarketTrendsWithStalling` の `stalling`）を読む。詳しくは下の P5 の節。

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

## M2 と M4：FTD 行の経過日数と「前回のFTD」、Today の「反発n日目」（パッケージ P3）

コミット（すべて claude/r3-market、push なし）：

- cb3b5be4 M2（FTD 行・指数チャート・開いた行・原因行）と、その vitest
- 11a0d7ea M4（Today のタイルの「反発n日目」とその説明）と、その vitest
- 2a37e51a Playwright（brief-market-r3.spec.js に M2・M4 を追加、brief-market.spec.js と brief-market-phone.spec.js の照合を producer 経由に）
- d6ef61b1 この記録（初版）
- 30515542 M2 の補正（指数チャートの凡例は「◆ FTD」のまま。切替のある電話の配置で 320 の凡例が 2 行になったため。spec に切替のある状態を追加）
- コードの最終 HEAD は 30515542。そのあとのコミットは文書だけ。

### 作ったもの

**M2（briefEnvironment.js、MarketScreen.jsx、marketTabGroups.js、reference/marketTabStudy.js）**

- **定数**：`FTD_RECENT_SESSIONS = 25`（briefEnvironment.js、独自設定）。
  - followThroughView は Today のエントリチャンクに入り、参照 JSON を読まないので、定数にした（指揮役の訂正どおり）。
  - marketTabStudy.test.js が参照の `buckets.ftdRecentSessions` に一致させ、0／1／24／25／26／152 で `ftdRecent` と逆になることも確かめる。
- **共有の判定**：`ftdSessionsSince(ft)`（confirmed で `ftd.sessionsSince` が 0 以上の整数のときその数、他は null）と `ftdPrevious(ft)`（その数が 25 を超える）。FTD 行、指数チャートの ◆、原因行の 3 か所がこれだけを読む。
- **FTD 行（followThroughView の confirmed）**
  - 値（b）は「確認 M/D」、25 営業日を超えたら「前回のFTD M/D」（`previous: true`、色なし）。
  - 経過日数は em の先頭に置く：「35日前・+1.6%・反発5日目・FTD後の有効な分配日3」。FTD 当日（0）は「当日」。
  - `sessionsSince` が使えない記録（欠落・負・小数・文字列）は今の文言のまま。数は推測しない。
  - 「n日前」は FTD の日の後の営業日数。「目」は使わない（指揮役の訂正どおり）。営業日で数えることは開いた行で言う（下記）。
- **指数チャート（IndexChart）**：◆ は残す。25 営業日を超えた FTD は、◆ のラベルと aria-label を「前回のFTD M/D」にする。失敗した FTD（ftd_failed）は今までどおり「FTD M/D（失敗 …）」。
  - 凡例は「◆ FTD」のまま（記号の意味の説明）。「◆ 前回のFTD」にすると、Nasdaq の終値が公開されている電話の配置（切替が見出しの横）で、320 の凡例が 2 行になり内容高が +22px（1337→1359）になった（実測）。30515542 で戻した。
- **開いた行（study.followThrough、遅延チャンク）**：`followThroughDetail()` の 4 行の後に、今までの「基準」の行。
  1. 「FTDの基準は独自設定（+1.2%・4〜15日目・高値から6%以上の下落後）。出典ごとの上昇率の目安：1.0%〜1.25%（IBD）、1.7%（William O'Neil + Co.）（二次資料経由・未確認）。」
     - 前半は `FTD_TEXT` から作る。後半は定数 `FTD_SOURCE_GAINS`（引用。アプリの規則でも閾値でもない）。
     - 市場の計画 §3 の M2（217 行）が出典を IBD と William O'Neil + Co. と名指ししているので、数を出した。一次資料は開いていない（調査の framework-william.json：検索要約経由、ページの日付は未確認）ので「二次資料経由・未確認」と書いた。
  2. 「失敗の判定はFTD当日の安値を終値で割ったとき（独自・出典より早く出る場合があります）。」
  3. 「「n日前」はFTDの日からの営業日数で、25営業日を過ぎた確認は「前回のFTD」と表示します（独自設定）。」（25 は `FTD_RECENT_SESSIONS` から）
  4. 「FTDの状態ごとの過去の傾向は、下の「過去の傾向」を参照。」
  - 過去の傾向の数字は行に書かない。指数ごとの数字は「過去の傾向」の指数ごとの行だけにあるので、S&P の数字が NAS の行に付くことはない。
  - 指揮役の文の『過去の傾向』は入れ子の引用なので、画面では「過去の傾向」とした。
- **原因行（regimeCause）**：局面判定の block が correction か downtrend で、^GSPC の記録（`gspcFollowThrough`）が confirmed かつ `asOf` が分析日と同じとき、最後に 1 句足す。
  - 「下の^GSPCのFTD（M/D）は指数の別集計で、高値から6%未満の下落では取り消しません（独自設定）」。25 営業日を超えたら「下の^GSPCの前回のFTD（M/D）…」。6% は `FTD_TEXT.decline`。
  - FTD の日付がない記録は日付を省く。別の日の記録・他の状態・他の局面判定では何も足さない。
  - followThroughDay.js を読んで確かめた：confirmed は、FTD 当日の安値を終値で下回る（失敗）か、FTD 後の高値から 6% 以上の新しい下落（調整入り）まで続く。したがって「6%未満の下落では取り消しません」は実装どおり。

**M4（briefEnvironment.js：MARKET_TILE_SUFFIX、marketTileSuffix、marketTileNote）**

- `MARKET_TILE_SUFFIX.rally(day)` が「反発n日目」を返す。全角 7 文字以内（1〜15 日目と 999 日目で測るテスト）。
- 条件（すべて）：判定が既知、`cap === 0`、`ftdUpgraded` でない、系列が ready、P2 の同日ガード（`sameDayFollowThrough`：記録の asOf が asset の as_of_date、manifest に日付があればそれとも同じ）、^GSPC か ^IXIC が `available === true`・state `rally_attempt`・`attempt.day` が正の整数。両方なら大きい方の日数。
- 出さない：correction、attempt_expired、confirmed、no_correction、ftd_failed、算出不可、別の日の記録、日数が 0・負・小数・欠落、`cap` が数でない。
- 優先順位：FTD 格上げ（cap 0）は今までどおり「FTD確認済み」か何もなし（反発の日数は出さない）。cap 0 で格上げでなければ「反発n日目」。cap > 0 の「NAS調整中」は変えていない。接尾辞は 1 つまで。色・目安・判定は変えない。
- 新しい「調整入り」の定義は作っていない。エクスポーターの 6% ゲートで rally_attempt に入った指数だけ。
- `marketTileNote` の説明：「Nasdaq総合は安値9/29から反発3日目。4日目以降の+1.2%上昇待ち（独自判定）。判定と目安は変わりません。」
  - 両指数なら「S&P 500は安値9/25から反発5日目、Nasdaq総合は安値9/29から反発3日目。…」と、それぞれの日数と安値の日付。
  - 安値の日付がなければ「安値M/Dから」を省く（推測しない）。4・+1.2% は `FTD_TEXT` から。
  - TodayView はこの 2 つの戻り値だけを読むので、TodayView は変えていない。1440 では市場カードの下の注記、電話では Today の注記と、タイルの title・読み上げに出る。

### 計画・指示からの補いと判断

1. **M4 の「375 で 97±2」は満たせない（TodayView と brief.css の変更が要る。所有外なので直していない）。**
   - 目安 0% のラベル 3 つ（50日線割れ（弱含み）、長期トレンド警戒、新規購入を抑制）は、電話のタイルでどれも 2 行になる。そこに接尾辞の行が加わるので、タイルは 97.8→115.8px（375・390）、134.7→152.7px（320、50日線割れ）、115.8→133.8px（320、長期トレンド警戒と新規購入を抑制）になる（実測）。
   - これは P2 で受け入れた「FTD確認済み」のタイルと同じ高さ（375 で 115.8px）。320 では「FTD確認済み」が折り返すので、「反発n日目」の方が 18px 低い。
   - Today 全体は 1153（375・390）／1278（320）で、1400 以内。320 で文字切れなし。
   - spec が確かめていること：タイルは同じラベルの「FTD確認済み」のタイル以下（375・390 では等しい）、3 つのタイルの高さがそろう、Today ≤1400、320 で文字切れなし。
   - 選択肢：受け入れる。または統合で TodayView を変える（例：cap 0 で接尾辞があるとき「買いは控える」と接尾辞を 1 行にまとめる。12 文字あり、375 のタイルの幅には入らないので、別の形が要る）。
2. **M2 の経過日数は、値（b）ではなく em の先頭に置いた。**
   - 指揮役の「確認 M/D（n営業日前）」「前回のFTD M/D（n営業日前）」と、代わりの「（152日前）」を 320／375／390 で測った（実測、下の表）。
     - 前回の形は、320 ではどの書き方でも 2 行（「前回のFTD 8/13（35日前）」も 2 行）。
     - 375 では「前回のFTD 2/25（152日前）」は 1 行に入るが、「前回のFTD 12/25（152日前）」は 2 行。
     - 直近の形も「確認 9/16（12営業日前）」は 320 で 2 行。
     - b が 2 行になると、閉じた高さが +24px。電話の閉じた高さは増やさない規則なので、この形は採れなかった。
   - em の先頭なら「35日前・」「当日・」で em の行数が変わらず、320／375／390 の閉じた高さが変わらない（実測）。「35営業日前・」は 320 で em が 3 行になる（+18px）ので「n日前」にし、営業日であることは開いた行で言う。
   - em の最も長い形も 320 で 2 行のまま（「152日前・+1.6%・反発15日目・FTD後の有効な分配日12」「当日・+12.3%・反発15日目・FTD後の有効な分配日12」、実測）。
   - 例外：年をまたぐ前回の FTD（「前回のFTD 2025/10/31」）は、320 で b が 2 行になり +24px（1341→1365）。375／390 は不変。前回の FTD が前の年の日付のまま年が変わると、この形になる。直していない。
   - 直近の FTD だけなら、指揮役の形を「日前」に縮めた「確認 9/16（12日前）」「確認 10/2（当日）」は 320 でも 1 行に入る（実測）。前回の形と置き場所をそろえるために em の先頭にした。直近だけ値の中に戻すかは指揮役の判断に回す。
   - 1440 では em が 2 行になり、市場の内容高が +16px（2455→2471）。デスクトップには高さの予算がない。
3. **原因行の同日の判定は、`gspcFollowThrough`（asset の as_of_date と同じ）に加えて、記録の asOf が分析日と同じことも求めた。** block は分析日の日付なので、別の日の記録で 1 句が付かないようにするため。
4. **M1c の spec（P2）の状態を変えた。** SPY が 200 日線の下の状態で、フィクスチャの Nasdaq は同日の反発 3 日目なので、M4 で「反発3日目」が付きタイルが 115.8px になる。M1c のテストは「ラベルの印を外し 97px を保つ」なので、Nasdaq を反発のない調整中にして接尾辞なしを確かめるようにした。反発の状態は M4 のテストで見ている。
5. **MarketCard.test.jsx を変えた（パッケージのファイル一覧にないが、このトラックの所有）。** MarketDetailCard（MarketScreen.jsx）のテストがここにあり、vitest のフィクスチャの FTD（sessionsSince 40）が「前回のFTD 8/7」になったため。照合は followThroughView の戻り値から作るようにした。src/test/fixtures は変えていない。
6. **vitest の「sessionsSince が無い confirmed」は vitest だけ。** marketTrendAsset の followThroughValid がその記録を取り下げるので、Playwright の「古い asset」は `followThrough` がない状態（未集計）にした（指揮役の注記どおり）。

### 高さ（実測、変更前→変更後）

- **測り方**：スクラッチの計測 spec `audit3/r3-market/measure3/m2-measure.spec.js`（Chrome for Testing 147、CI のフォント、reduced motion、ポート 4433）。
  - 変更前は 3a4a162（このワークツリーの P2 の最終、変更前に測った `before.jsonl`）、変更後は 11a0d7ea の木（`after.jsonl`）。
  - 内容高は `#brief-main .brief-stack` の下端、先頭下端は判定・注意サイン・最初のタブの下端の最大。
  - /proc/loadavg：変更前 0.63→3.70、変更後 3.05→8.59。高さは負荷に依存しない。
- **文言の幅**：`audit3/r3-market/measure3/fit.spec.js` と `fit2.spec.js`（S&P の FTD 行の b と em に候補の文を入れて行数を数える）。

市場タブ（閉じた状態）：

| 状態 | 320 | 375 | 390 | 375 先頭下端 | 1440 |
|---|---|---|---|---|---|
| 基準（FTD 35 営業日前） | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2455→2471 |
| (a) FTD 35 営業日前・目安 0%（50日線割れ・調整の block） | 1390（不変） | 1242（不変） | 1219（不変） | 554（不変） | 2436→2471 |
| (b) FTD 12 営業日前 | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2478→2494 |
| FTD 当日 | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2478→2494 |
| (c) followThrough なし（古い asset） | 1314（不変） | 1202（不変） | 1202（不変） | 531（不変） | 2388（不変） |
| (d) 1 営業日遅れ | 1391（不変） | 1228（不変） | 1219（不変） | 539（不変） | 2487→2503 |
| FTD 152 営業日前 | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2455→2471 |
| FTD 230 営業日前（前年の日付） | 1341→1365 | 1219（不変） | 1219（不変） | 531（不変） | 2455→2471 |
| FTD 120 営業日前（◆ が左端近く） | 1341 | 1219 | 1219 | 531 | 2471 |

- 先頭下端は、測ったすべての状態で 756 以内（最大は 1 営業日遅れの 50日線割れで 320 の 642）。
- **切替のある配置**（Nasdaq の終値あり。P2 の spec の withCloses と同じ作り方、30515542 の木、`closes-before.jsonl`／`closes-after2.jsonl`）：

| 状態 | 320 | 375 | 390 | 1440 |
|---|---|---|---|---|
| 基準 | 1337（不変） | 1201（不変） | 1201（不変） | 2491→2507 |
| FTD 12 営業日前 | 1337（不変） | 1201（不変） | 1201（不変） | 2514→2530 |
| FTD 35 営業日前・目安 0% | 1386（不変） | 1223（不変） | 1201（不変） | 2472→2507 |
| 1 営業日遅れ | 1372（不変） | 1209（不変） | 1201（不変） | 2523→2539 |

  - 凡例を「◆ 前回のFTD」にしていた 2a37e51 では、320 の 3 状態（基準・目安 0%・1 営業日遅れ）が +22px だった（1337→1359 など）。FTD 行そのものは 160.4px で不変、値は 1 行。
  - /proc/loadavg は 1.03→3.52。
- ◆ のラベルは枠の中（FTD 120 営業日前の 320：左 20px・右 152px、54 営業日前：左 154px・右 18px、35 営業日前：左 99px・右 73px）。
- 1440 の (a) は原因行の 1 句と em の 2 行目で 2436→2471。電話では原因行は閉じた折りたたみの中。

Today：

| 状態 | 320 内容高 | 375 内容高 | 390 内容高 | 375 タイル | 接尾辞 | 1440 内容高 |
|---|---|---|---|---|---|---|
| 基準（目安 50%、Nasdaq 反発 3 日目） | 1213（不変） | 1106（不変） | 1106（不変） | 96.9（不変） | NAS調整中（不変） | 1837（不変） |
| 50日線割れ・Nasdaq 反発 3 日目 | 1260→1278 | 1135→1153 | 1135→1153 | 97.8→115.8 | なし→反発3日目 | 1785→1854 |
| 50日線割れ・両指数（S&P 5 日目） | 1260→1278 | 1135→1153 | 1135→1153 | 97.8→115.8 | なし→反発5日目 | 1785→1874 |
| 長期トレンド警戒・Nasdaq 反発 3 日目 | 1241→1259 | 1135→1153 | 1135→1153 | 97.8→115.8 | なし→反発3日目 | 1785→1854 |
| 新規購入を抑制・Nasdaq 反発 3 日目 | 1241→1259 | 1135→1153 | 1135→1153 | 97.8→115.8 | なし→反発3日目 | 1766→1835 |
| 新規購入を抑制・Nasdaq 反発 12 日目 | 1241→1259 | 1135→1153 | 1135→1153 | 97.8→115.8 | なし→反発12日目 | 1766→1835 |
| 50日線割れ・1 営業日遅れ | 1289（不変） | 1164（不変） | 1164（不変） | 97.8（不変） | なし（不変） | 1817（不変） |
| (c) followThrough なし | 1213（不変） | 1106（不変） | 1106（不変） | 96.9（不変） | なし（不変） | 1768（不変） |
| (d) 1 営業日遅れ（目安 50%） | 1242（不変） | 1135（不変） | 1135（不変） | 96.9（不変） | なし（不変） | 1800（不変） |

- 320 で文字切れなし（すべての状態）。
- 1440 の増分は、タイルの接尾辞の行と、市場カードの下の注記「反発n日目：…」の行。

文言の候補（S&P の FTD 行の b、1 行に入るか。実測）：

| 文 | 320（181px） | 375（220px） | 390（235px） |
|---|---|---|---|
| 前回のFTD 8/13（35営業日前） | 2 行 | 2 行 | 2 行 |
| 前回のFTD 8/13（35日前） | 2 行 | 1 行 | 1 行 |
| 前回のFTD 2/25（152日前） | 2 行 | 1 行 | 1 行 |
| 前回のFTD 12/25（152日前） | 2 行 | 2 行 | 1 行 |
| 前回のFTD 2025/10/31（230日前） | 3 行 | 2 行 | 2 行 |
| 確認 9/16（12営業日前） | 2 行 | 1 行 | 1 行 |
| 確認 9/16（12日前） | 1 行 | 1 行 | 1 行 |
| 確認 10/2（当日） | 1 行 | 1 行 | 1 行 |
| 前回のFTD 8/13（b だけ、採用） | 1 行 | 1 行 | 1 行 |
| 前回のFTD 2025/12/31（b だけ） | 2 行 | 1 行 | 1 行 |

em の先頭に経過日数を置いたときの S&P の FTD 行の高さ（閉じた行のボタン、実測）：320 で 160px（変更前と同じ。「35営業日前・」なら 178px）、375／390 で 143px（同じ）、1440 で 119→135px。

### 関門（実測、コードの最終 HEAD 2a37e51）

- 関門 (1)〜(4) は 2a37e51 で一度通し、凡例の補正（30515542）のあと、最終の木でもう一度通した。下は最終の木の値。
- **(1) MARKET の spec**：111 件通過（4.1 分）。再実行は不要だった（2a37e51 では 105 件通過、4.8 分）。
  - コマンド：`AUDIT_MATCH='brief-market' npx playwright test -c audit3/r3-market/pw-147.config.mjs`（FONTCONFIG_FILE は CI のフォント、PATH の先頭は /opt/node22/bin。以下も同じ）。
  - /proc/loadavg は 4.40→6.64（2a37e51 では 5.77→9.81）。
  - 変更前の木（3a4a162 の spec、11a0d7ea のコード）では 7 件失敗（FTD 行の照合 5 か所と M1c のタイル。上の判断 4）。spec を直してから通過。
- **(2) 凍結 spec（無編集）**：124 件通過、2 件スキップ（brief-oracles の R1／R2 の test.fixme）。6.2 分（2a37e51 でも同じ結果、6.7 分）。
  - コマンド：`AUDIT_MATCH='brief-(compact|phone|oracles|freshness)\.spec'`。/proc/loadavg は 5.17→4.21（2a37e51 では 7.91→3.50）。
  - brief-compact・brief-phone・brief-oracles・brief-freshness・brief-fixture は 45603f06 から差分 0（`git diff --stat`）。
- **(3) dump**：`r3-harness/dump/run-dump.sh <W> 4433` → `dump-3051554.json`（sha256 49f39e84…5e14b233e、42 画面、エラー 0）。/proc/loadavg は 3.21→2.81。
  - P2 の dump（3a4a162）との差（2a37e51 の dump で比べた。`gate/dumpdiff-2a37e51-vs-3a4a162.txt`）は 2 画面だけ。30515542 では凡例が「◆ FTD」に戻ったので、その 1 行の差が消える（`gate/dumpdiff-3051554-vs-2a37e51.txt`）。
    - 375-market-tab0：FTD 行の文（「確認 8/13」→「前回のFTD 8/13」と em「35日前・…」）、◆ のラベル「FTD 8/13」→「前回のFTD 8/13」。内容高 1219 は不変。
    - 1440-market：同じ文の変更。内容高 2455→2471、ページ 2487→2503（em の 2 行目）。
  - 8849bf9 の dump との差（`gate/dumpdiff-3051554.txt`）：上の 2 画面に加えて、P2 からの差だけ（1440-market の開示文、Today の「7日以上で注意」、1440 の銘柄画面 6 つの横の Today の分配日タイルの 1 行「5日以上で注意」→「7日以上で注意」）。
    - 1440 の銘柄画面 6 つの差は P2 のときと同じ 1 行で、このパッケージは銘柄・候補・ウォッチの画面に差を足していない。
  - 古い dump（3a4a162、2a37e51）は削除した。
- **(4) ビルド**：`r3-harness/build/run-build.sh <W>` → `build-3051554.json`（2a37e51 と同じエントリの大きさ）。/proc/loadavg は 2.81→3.59。
  - `npm run build` のエントリチャンクは gzip 131.13 kB。STEP 0（c61bf96）の 130.28 kB から +0.85 kB、P2（3a4a162）の 130.67 kB から +0.46 kB。線 134.00 kB の内側。
    - 増分は briefEnvironment.js の M2（定数・判定・経過日数）と M4（タイルの読み・説明）。開いた行の文と原因行の 1 句は遅延チャンク（marketTabStudy.js）にある。
  - デザイン受け入れ用ビルドのエントリは 130.93 kB（vite 表示）。
  - 遅延チャンク MarketScreen は 29.82→30.29 kB（gzip -9、ファイルから測った）。
  - 古い build（3a4a162、2a37e51）の出力は削除した。

### その他の実測

- **関係ファイルの vitest**：`npx vitest run src/static/brief src/static/reference src/static/portfolioPlan.test.js` → 36 ファイル、761 件通過（M2 だけの木では 758 件、30515542 の木でも 761 件）。
- **em の最も長い形**：`audit3/r3-market/measure3/fit2.spec.js` に足して測った（上の判断 2）。
- **vitest 全体（2a37e51 の木、1 回。30515542 は凡例の文字列と、そのテスト 3 か所だけを変えたので、関係ファイルの vitest と関門 (1)〜(4) を通し直した）**：`npx vitest run`（SESSION_CALENDAR_PYTHON と FINANCIAL_REPLAY_PYTHON を指定）→ 247 ファイル、4017 件すべて通過、244.3 秒。
  - /proc/loadavg は 0.67→6.78。他のトラックと共有の負荷下の時間なので、参考値（advisory）。
- **eslint**：変えた 11 ファイル（src の 8 つと spec 3 つ）で指摘 0。
- **所有の関門**：毎コミット前に `check-ownership.py MARKET` で OWNERSHIP OK（最後は 21 paths）。

### 未検証

- **実際の ^GSPC の行がどれを読むか**（「前回のFTD」「反発n日目」「確認」）：次回の公開の CI ログ（M0 の行の `ft=`・`day=`・`ftd=`）と照らすまで分からない。期待値の数字は書かない。
- **実データで Today に「反発n日目」が出るか**：判定が 0% のまま、^GSPC か ^IXIC の公開状態が同日の rally_attempt のときだけ。6% ゲートと出来高しだい。
- **年をまたぐ前回の FTD の 320 の +24px**：合成データで測っただけ。実データで起きるかは、次の FTD が年内に出るかしだい（推論）。
- **PRE_M2 の上限**（brief-market-r3.spec.js）：3a4a162 で測った閉じた高さ。後のパッケージが判定のそばに閉じた行を足す（M6 など）ときは測り直しが要る。
- **原因行の 1 句が実データで出るか**：局面判定が調整・下降トレンドで、同日の ^GSPC が confirmed のときだけ。
- **出典ごとの上昇率**：一次資料は開いていない。画面では「二次資料経由・未確認」と書いた。
- **時間の計測**：このパッケージでは取っていない。

### 統合への依頼・報告（このトラックでは変えていない）

- **M4 のタイルの高さ（判断 1）**：375 で 97.8→115.8px。受け入れるか、TodayView／brief.css で接尾辞の置き方を変えるかを決めてほしい。
- **年をまたぐ前回の FTD（判断 2）**：320 で +24px。受け入れるか、日付の書き方を変えるか（shortDate は共有）を決めてほしい。
- **gspcFtdWords（FTD 格上げの原因行）は「^GSPCの日足ではFTD 8/7」のまま。** 古い ^GSPC の FTD を「前回の」と言うかは指示になかったので変えていない。
- **「前回のFTD」の語は 3 つのソース（briefEnvironment.js、MarketScreen.jsx、marketTabStudy.js）と spec に直接書いてある。** 行と原因行の照合は producer 経由だが、チャートの照合は語を直接書いている。1 つの定数にまとめるなら関門の通し直しが要る。
- **CONTEXT.md の語彙**（統合時に移す）
  - 「前回のFTD」：確認から `FTD_RECENT_SESSIONS`（25）営業日を過ぎた、アプリ自身の指数の FTD 記録。今の FTD としては読まない。
  - 「反発n日目」：目安 0% の日に、同日の指数の記録がラリー試行（rally_attempt）のときの Today の接尾辞。n は試行の日数。

## M5・M6・M7：0% の開示と過去の傾向の読み方、判定のそばの「銘柄側」1 行、2 つの凡例（パッケージ P4）

コミット（すべて claude/r3-market、push なし）：

- bd4ab1fc M5（50日線割れの 0% の注記 `zeroCapNote`、過去の傾向の脚注）と、その vitest
- e805d50a M6（「銘柄側」1 行 `stockSide`、〔参考〕の凡例と注記の言い直し）と、その vitest、brief-market-phone.spec.js の凡例の照合
- 1e5b2993 M7（ステージ構成の凡例と開いた行の 1 行）と、その vitest
- 3c27d4ce Playwright（brief-market-r3.spec.js に M5〜M7 を追加）
- d522ce7c brief-market-phone.spec.js の FTD 格上げの折りたたみの段落一覧を producer 経由に（M5・M6 で段落が 2 つ増えたため）
- コードの最終 HEAD は d522ce7c。目安・判定・規則・上限（`MARKET_CAPS`）・`modelMarket` の分岐は変えていない。

### 作ったもの

**M5（reference/marketTabStudy.js、MarketScreen.jsx、brief-market-history.css）**

- **`zeroCapNote({ market, regime, reference, date })`**：判定が `modelMarket` の 50日線割れ（`verdictBasis` が「SPY は 50日線の下・200日線の上」と読む状態）で、目安が 0% のときだけ文を返す。それ以外の判定（上昇トレンド・上昇に圧力・長期トレンド警戒・新規購入を抑制・未確認）は null。
  - 文は必ず「0%は独自設定で、検証された水準ではありません。」で終わる。0% は `capText(market.cap)` から出す。
  - 数字は、^GSPC 自身の 50・200 日線の区分（過去の傾向が判定したもの：`marketRegimeContext` の `^GSPC.ma.quadrant` の項目。長期履歴の ^GSPC 終値に `indexSummary`）が `above200_below50` で、その日付が分析日のときだけ付ける（指揮役の訂正どおり、SPY の判定ラベルではなく ^GSPC の区分で結合する）。
  - 数字の形：「^GSPC・21営業日で5%以上の下げ：この状態 a%〔未確立〕／両線の上 b%〔S&P・Nasdaqとも〕／全期間 c%。0%は独自設定で、検証された水準ではありません。」（a・b・c はコミット済みの参照 JSON の行から読む。この文書には数字を書かない）。
    - a＝その区分の行の `pDd5`、b＝`above_both` の行の `pDd5`、c＝その行の `comparatorPDd5`（全期間）。21 と 5 は参照の `outcome` から。
    - それぞれの状態に自分のタグ（`stateTag`）を付ける。今は `above200_below50` が〔未確立〕。
    - 指示に加えて、その状態の行に〔偏り〕（`biasTag`）があれば付ける（今はどちらにも無い。数字が注意書きを失わないため）。
  - 数字を出さない場合（後半の文だけ）：長期履歴なし、^GSPC の終値なし、200 本未満（区分の窓がない）、直近 200 本の中に欠測（後ろからの連続が切れる）、区分の日付が分析日より古い、別の区分、参照が無効、行が無い、行の `pDd5`／`comparatorPDd5` が null、`labelDd5` が insufficient。
    - **「method」の結合条件について**：参照の `methods` には区分（ma.quadrant）の method id が無い（distribution と followThrough だけ）。区分の判定は `indexSummary` の 50・200 日の窓そのもので、過去の傾向と同じ関数を通る。したがって「method・窓が違う」ときの不可は、上の「200 本未満」「欠測」「参照が無効（outcome の窓が違う参照を含む）」で確かめた。
  - 置き場所：「目安と判定の基準」の最後（目安の開示文の後）。電話では閉じた折りたたみの中、1440 ではその場。クラスは `brief-exposure-zero`（`brief-exposure-basis` と同じ書式）。過去の傾向の側の同じ状態の行はそのまま残し、この行は 3 つの行を 1 回ずつ出す。
- **過去の傾向の脚注（`meansSentence`）**：
  - 「この欄は下げの割合だけを示…」を「この欄は下げの頻度の比較です（21営業日・^GSPC／^IXIC）。」に変えた。21 は `outcome.horizonSessions`、指数名は `INDEX_SYMBOLS` から。
  - 「平均リターンが低かった状態はどちらの指数にもありません。」は、今までどおり `meanLowerStates` が空のときだけ。
  - 表示中の状態は、その行（その指数の indicator と state）の `labelMean` が robust で `meanDirection` が higher のときだけ「表示中の状態のうち、200日線の上・50日線の下（S&P）は平均リターンは高めでした。」と名指しする（指数名つき。両指数とも高めなら「調整中（S&P・Nasdaq）」）。今の参照で該当するのは ^GSPC の above200_below50 と、両指数の ftd.state の correction だけ。
  - 振れ幅（ボラティリティ）は参照に無いので書かない。「調整中はむしろ高め（振れ幅が大きい）」と「どの状態でも」は書いていない（指揮役の訂正どおり）。

**M6（marketTabGroups.js、marketTabModel.js、MarketScreen.jsx、reference/marketTabStudy.js、brief-market-history.css）**

- **`stockSideLine`（marketTabGroups.js、遅延の市場チャンク）**：`marketTabParts` が signals・groups・series の横に `stockSide` として返す。`marketCardView` は受け取って返すだけ（分割代入とその戻り値に 1 語ずつ）。Today はタブを渡さないので作らない（null）。
  - 文：「銘柄側（参考・目安は変えません）：TT達成 N（1か月前 M）・ブレイクアウト成功率 x%（n件）・リーダーの健全度 y%（n銘柄）」。
  - 値はタブがすでに出している行のものだけ：TT 達成数の行（`known('trendTemplateCount')` と同じ欄の `monthBefore`。行の「1か月前」と同じ計算）、上抜けの行（その行の `label` と `b`、率の行の `breakoutsJudged`）、リーダーの健全度の行（その行の `label` と `b`、率の行の `leaderCohort`）。新しい数字・規則・印は作らない。
  - **上抜けの行の名前は行自身の `label` を使う**（定数は無かった）。P6 で行の名前を「上抜けの維持」に変えれば、この行も同じ名前になる。
  - 欠測：各項は行自身の absent の語（未収録・未算出・未配信・確認できません …）。0 にはしない。1 か月前の値が無いときは「TT達成 30（1か月前の値なし）」。
  - 件数不足：率を出さず件数だけ（「ブレイクアウト成功率 3件」「リーダーの健全度 8銘柄」。行と同じ規則 `BREAKOUT_MIN_SAMPLE`・`LEADER_MIN_COHORT`）。
  - 日付：長期履歴が分析日より古いときは見出しに 1 回「銘柄側（10/1時点・参考・目安は変えません）」（注意サインの見出し「（10/1時点・独自判定）」と同じ形）。それより古い回の値を出す項（例：最新の回の上抜け件数が無く、前の回の率を出すとき）は、その項に自分の日付「75%（10/1時点・8件）」。
  - 色・▲・○ は付けない。注意サインに数えない。目安は読まない。系列が ready でない（読み込み中・取得失敗・なし）ときは null。
  - 置き場所：電話は「目安と判定の基準」の折りたたみの先頭行（閉じた高さは不変、実測）。1440 は判定の根拠のすぐ下（`p.brief-verdict-why + p.brief-verdict-stock`）。クラスは `brief-verdict-stock`（`brief-verdict-why` を使うと、根拠の行を数える既存の spec と原因行の並びが変わるため、別のクラスにした）。Today の 4 タイルは入れ替えていない（OD-M6）。
- **〔参考〕の凡例（`signalTagText`）**：「〔参考〕＝2021〜26年の検証で関係未確認」→「〔参考〕＝指数の下げとの関係は未確認」（定数 `BREADTH_LEGEND`）。
  - 「（個別株のブレイクアウト成績との関係は未検証）」を凡例に足すと、320／375／390 で 1→3／1→2／1→2 行になった（実測、下の表）。そのため、この句（定数 `STOCK_OUTCOME_UNTESTED`）は注記の文の括弧に入れた：「…確認できなかった注意サインです（全体として偶然と区別できない結果・個別株のブレイクアウト成績との関係は未検証）。」。年（2021〜2026年）は注記に残る。
  - 1440 では注記の文がその場に出る（4 行のまま、実測）。電話では「注記」の中。
- **見出し「注意 0件・参考 M件」の太さ**：`.brief-signals` の書式は brief.css（このトラックの所有外）にある。brief-market-history.css にあるのは `.brief-signals li.is-reference` だけ。
  - 実測：見出しは 1 つの `<b>` の中の 1 つの文字列で、320／375／390／1440 のどれでも計算された太さは 700。参考の件数はすでに注意の件数と同じ太さなので、CSS は変えていない。brief.css の変更も要らない。
  - 観察（指示外）：注意サインが 1 件以上あると `.brief-signals.is-warn > b { color: var(--ext) }` で見出し全体が琥珀色になり、「・参考 M件」も琥珀色になる。直すには見出しの中の印を分ける（JSX）と CSS が要る。「CSS のみ」の指示を超えるので直していない（統合への質問）。

**M7（marketTabGroups.js）**

- `STAGE_NAMES` は変えていない。`STAGE_NAMES` を読むのは、変更前は marketTabModel.js（`RULE_TEXT.stage`）と marketTabGroups.js（凡例）の 2 か所、変更後は marketTabModel.js（`RULE_TEXT.stage`）だけ（grep。テストを除く）。
  - 別のファイルの frontend/src/constants/metricGlossary.js:139 に「1=底固め、2=上昇、3=天井圏、4=下落」がある（`STAGE_NAMES` とは別の文字列。所有外なので変えていない）。
- 凡例だけが読む定数 `STAGE_LEGEND_NAMES`：「1 底固め」「2 上昇（加速中）」「3 横ばい・天井圏」「4 下降」。
  - 長い形「2 上昇（加速中のみ）」「3 横ばい・天井圏（ベース形成中を含む）」は 320 で凡例が 2→4 行（375／390 は 2→3 行）になった（実測）。そのため指示どおり短い形にした。短い形は 320／375／390／1440 で 2 行のまま（実測）。
- 開いた行の 1 行目（`STAGE_REPLAY_NOTE`）：「スキャナーのステージ2ベース例外は再生していません（独自集計）」。その後に今までどおり「基準」。
- ステージの割合、ステージ4＞ステージ2 の参考サイン（○ 参考）、`RULE_TEXT.stage` の文は変えていない（テストで固定）。

### 計画・指示からの補いと判断

1. **M7 は短い形にした**（上記。長い形は 320 で凡例が 4 行）。
2. **M6 の凡例の句は注記の文に入れた**（上記。凡例に足すと電話の 3 幅すべてで行が増える）。
3. **M6 の日付は見出しにまとめた**：指示の「（M/D時点）」を行末に付けると、最後の項（リーダーの健全度）だけの日付に読める。注意サインの見出しと同じ「（10/1時点・…）」の形で見出しの括弧に入れた。古い回の項には項ごとの日付が付く。
4. **M6 の TT の項は数だけ**（「TT達成 30（1か月前 25）」）：指示の文の形どおり。行の `b`（「30銘柄」）ではなく同じ欄の値から数字を出す（行の値と同じ計算、`known` と `monthBefore`）。
5. **M5 の〔偏り〕**：指示は「各状態の stateTag」。行に〔偏り〕があるときはそれも付ける（今の参照では付かないので、画面の文は指示の形と同じ）。
6. **MarketCard.test.jsx を変えた**（パッケージのファイル一覧にないが、このトラックの所有。P3 と同じ）。MarketDetailCard（MarketScreen.jsx）のテストがここにあり、折りたたみの段落一覧・凡例・ステージの凡例・脚注の照合が変わったため。照合は producer（`marketCardView`＋`marketTabParts`、`marketTabStudy`）から作るようにした。
7. **brief-market-phone.spec.js の FTD 格上げのテスト（d522ce7c）**：折りたたみの段落を全部並べて照合していた。M6 の先頭行と M5 の最後の行が加わったので、producer の文を前後に足した。最初の関門 (1) で 1 件失敗して見つけた（下記）。
8. **系列が ready でないとき、銘柄側の行は出さない**（null）。指示の「欠測の項は各行の absent の語」は、系列が読めたうえで項が欠けるときに当てはめた。読み込み中・取得失敗・データなしのときは、3 項とも同じ語（「読み込み中…」「取得できません」など）が並ぶだけになり、そのことはカードの StatusAlert とタブの各群がすでに言う。長期履歴だけが無い・整合性エラーのときは、行を出して 3 項とも「未配信」「確認できません」と書く。
9. **1 営業日遅れの状態の折りたたみの見出しは 320／375 で 52.2px**（44〜48px の線の外）。P4 の前から同じ高さ（実測、下の表の注）で、このパッケージでは変えていない。新しい spec はこの状態だけ 53px までを許している。

### 高さ（実測、変更前→変更後）

- **測り方**：スクラッチの計測 spec `audit3/r3-market/measure4/p4-measure.spec.js`（Chrome for Testing 147、CI のフォント、reduced motion、ポート 4433）。
  - 変更前は a085a88a の src（変えた 5 ファイルだけを一時的に戻した。測ったあと HEAD に戻し、git status がクリーンなことを確認）、変更後は 1e5b2993 の木（spec の変更は高さに関係しない）。
  - 内容高は `#brief-main .brief-stack` の下端、先頭下端は判定・注意サイン・最初のタブの下端の最大。
  - /proc/loadavg：変更後 4.49→6.22、変更前 5.80→4.85。高さは負荷に依存しない。
- **文言の幅**：`audit3/r3-market/measure4/fit4.spec.js`（凡例の候補とステージの凡例の候補を DOM に入れて行数を数える）。

市場タブ（閉じた状態、電話の折りたたみの見出しは 44px、1 営業日遅れの 320／375 だけ 52.2px。すべて不変）：

| 状態 | 320 | 375 | 390 | 375 先頭下端 | 1440 |
|---|---|---|---|---|---|
| フィクスチャ（上昇トレンド） | 1341（不変） | 1219（不変） | 1219（不変） | 531（不変） | 2471→2519 |
| 50日線割れ（^GSPC は 200日線の上・50日線の下） | 1390（不変） | 1242（不変） | 1219（不変） | 554（不変） | 2471→2587 |
| 50日線割れ・切替あり | 1386（不変） | 1223（不変） | 1201（不変） | 554（不変） | 2507→2623 |
| 1 営業日遅れ | 1391（不変） | 1228（不変） | 1219（不変） | 539（不変） | 2503→2552 |
| 切替あり（Nasdaq の終値あり） | 1337（不変） | 1201（不変） | 1201（不変） | 531（不変） | 2507→2555 |

- **リーダーのタブ**（ステージの凡例のある区画）の内容高：320／375／390 で 1159／1075／1061（不変）。凡例は 42px（2 行、不変）。50日線割れの状態でも 1208／1097／1061（不変）。
- **開いた折りたたみ**：銘柄側の行は電話の 3 幅で 3 行（57.6px、1 営業日遅れの 320 は 4 行 76.8px）。0% の注記は 4 行。折りたたみの中身は 320 で 403.8→469.3px（フィクスチャ）、442.1→592.4px（50日線割れ）。
- **1440**：
  - 銘柄側の行は 2 行（38.4px。指示の「2 行まで」の内側）。判定の箱と注意サインの箱（同じ行の高さにそろう）が 370.5→418.8px、内容高が +48px（フィクスチャ）。
  - 50日線割れでは、さらに 0% の注記が 2 行（38.4px）、過去の傾向の脚注が 3→4 行（57.6→76.8px）。内容高は +116px。
  - 注意サインの注記（その場）は 4 行のまま。ステージの凡例は 39px（2 行、不変）。
  - デスクトップには高さの予算がない。

文言の候補（実測、`fit4.spec.js`）：

| 文 | 320 | 375 | 390 |
|---|---|---|---|
| 〔参考〕＝2021〜26年の検証で関係未確認（変更前） | 1 行 | 1 行 | 1 行 |
| 〔参考〕＝指数の下げとの関係は未確認（採用） | 1 行 | 1 行 | 1 行 |
| 〔参考〕＝指数の下げとの関係は未確認（個別株のブレイクアウト成績との関係は未検証） | 3 行（+38px） | 2 行（+20px） | 2 行（+20px） |
| ステージの凡例・変更前（2 上昇・3 天井圏） | 2 行 | 2 行 | 2 行 |
| ステージの凡例・長い形（加速中のみ・ベース形成中を含む） | 4 行（+64px） | 3 行（+23px） | 3 行（+23px） |
| ステージの凡例・短い形（加速中・横ばい・天井圏、採用） | 2 行 | 2 行 | 2 行 |

（1440 のステージの凡例：変更前 2 行、長い形 3 行、短い形 2 行。）

見出しの太さ（実測、同じ `fit4.spec.js`）：320／375／390／1440 とも `.brief-signals > b` の子は文字列 1 つ（「注意 0件・参考 1件」）と `<small>`、計算された太さは 700。

### 関門（実測、コードの最終 HEAD d522ce7c）

- **(1) MARKET の spec**：130 件通過（4.4 分）。コマンド：`AUDIT_MATCH='brief-market' npx playwright test -c audit3/r3-market/pw-147.config.mjs`（FONTCONFIG_FILE は CI のフォント、PATH の先頭は /opt/node22/bin。以下も同じ）。/proc/loadavg は 2.20→5.32。
  - 1 回目（3c27d4ce の木）は 129 件通過・1 件失敗：brief-market-phone.spec.js の「round 2 at 375×812: an FTD-upgraded uptrend」（折りたたみの段落を全部並べた照合。上の判断 7）。d522ce7c で spec を直し、2 回目で全件通過。時間切れではない。
  - 新しいテスト 19 件（M5・M6・M7）は単独でも通過（40.9 秒）。
- **(2) 凍結 spec（無編集）**：123 件通過、2 件スキップ（brief-oracles の R1／R2 の test.fixme）、1 件失敗、6.8 分。/proc/loadavg は 4.88→8.22。
  - 失敗は brief-freshness.spec.js の「two sessions later on the desktop」（銘柄画面 ZZNV、時計を 2 営業日進めた上部バーの文。受け取った文は「分析基準日 10/2（金）引け・米国株」で、遅れの表示に切り替わる前に読んだ形）。このパッケージは上部バーと鮮度の計算を触っていない。
  - 時間切れではなく照合の不一致。負荷の下で遅れの表示に切り替わる前に読んだもの（推論）として、brief-freshness.spec.js だけを 1 回再実行した：20 件すべて通過（54.2 秒、/proc/loadavg 7.72→9.49）。**再実行が必要だった**ことをここに書く。
  - brief-compact・brief-phone・brief-oracles・brief-freshness・brief-fixture は 45603f06 から差分 0（`git diff --stat`）。
- **(3) dump**：`r3-harness/dump/run-dump.sh <W> 4433` → `dump-d522ce7.json`（sha256 4cdddcf3…c4471a6983、42 画面、エラー 0）。/proc/loadavg は 8.80→6.40。
  - P3 の dump（3051554）との差（`gate/dumpdiff-d522ce7-vs-3051554.txt`）は市場の 5 画面だけ。Today・銘柄・候補・ウォッチの画面は完全に一致した。
    - 1440-market：銘柄側の 1 行（2 行の高さ）、注意サインの注記の括弧、ステージの凡例の 2 項、過去の傾向の脚注の 1 文。内容高 2471→2519、ページ 2503→2551。
    - 375-market-tab0〜3：〔参考〕の凡例の 1 行（同じ 1 行）と、tab2 のステージの凡例の 2 項。閉じた折りたたみの中身の箱（expander-body 346→412）が変わり、内容高とページの高さ（1219／1031／1075／2141）は不変。
  - 8849bf9 の dump との差（`gate/dumpdiff-d522ce7.txt`）：上の差に加えて P2・P3 からの差だけ（1440-market の開示文、Today の「7日以上で注意」、FTD 行の「前回のFTD 8/13」と「35日前・」、1440 の銘柄画面 6 つの横の Today の分配日タイルの 1 行）。このパッケージは銘柄・候補・ウォッチ・Today の画面に差を足していない。
  - 古い dump（3051554）は削除した。
- **(4) ビルド**：`r3-harness/build/run-build.sh <W>` → `build-d522ce7.json`。/proc/loadavg は 5.23→5.49。
  - `npm run build` のエントリチャンクは gzip 131.14 kB。P3（3051554）の 131.13 kB から +0.01 kB、STEP 0（c61bf96）の 130.28 kB から +0.86 kB。線 134.00 kB の内側。
    - このパッケージがエントリに足したのは、marketTabModel.js の `stockSide` の受け渡し（分割代入と戻り値に 1 語ずつ）だけ。M5〜M7 の文と計算は遅延チャンク（marketTabGroups.js、marketTabStudy.js、MarketScreen.jsx）にある。
  - デザイン受け入れ用ビルドのエントリは 130.93 kB（vite 表示、gzip -9 で 130760→130758 バイト）。
  - 遅延チャンク MarketScreen は 30.74→31.84 kB（vite 表示。gzip -9 で 30687→31781 バイト）。
  - 古い build（3051554）の出力と snapshot/trees/3051554 は削除した。

### その他の実測

- **関係ファイルの vitest**：`npx vitest run src/static/brief/MarketCard.test.jsx src/static/brief/marketTabModel.test.js src/static/reference src/static/brief/MarketScreen.test.jsx` → 5 ファイル、169 件通過（M7 の前）。M7 の後の MarketCard.test.jsx と marketTabModel.test.js は 2 ファイル 127 件通過。
- **vitest 全体（d522ce7c の木、1 回）**：`npx vitest run`（SESSION_CALENDAR_PYTHON と FINANCIAL_REPLAY_PYTHON を指定）→ 247 ファイル、4034 件すべて通過、251.6 秒。/proc/loadavg は 3.65→5.82。他のトラックと共有の負荷下の時間なので、参考値（advisory）。
- **eslint**：45603f06 から変えた .js／.jsx／.mjs の 18 ファイルで指摘 0。
- **関門の外の spec**：tests/static の全 spec を、変えた要素と文（exposure-basis、brief-verdict-why、brief-regime-foot、brief-signals、stagelegend、天井圏、関係未確認、下げの割合）で grep した。当たるのは MARKET の 3 つの spec だけ。市場タブを開く brief-accessibility.spec.js と brief-invariants.spec.js も 1 回走らせた：`AUDIT_MATCH='brief-(accessibility|invariants)\.spec'` → 46 件通過（2.1 分、/proc/loadavg 0.92→4.73）。
- **所有の関門**：毎コミット前に `check-ownership.py MARKET` で OWNERSHIP OK（21 paths）。

### 未検証

- **実データで 0% の注記に数字が付くか**：判定が 50日線割れで、かつ長期履歴の ^GSPC 終値が分析日に 200日線の上・50日線の下のときだけ。次回の公開を読むまで分からない。期待値の数字は書かない。
- **実データの銘柄側の値**（TT 達成数とその 1 か月前、上抜けの率と件数、健全度と銘柄数）：計画の 11-12 の値は CI ログの実測だが、この行が実際の画面でどう読めるかは次回の公開の後に、行の値と照らして確かめる。
- **実データで脚注に「平均リターンは高め」が出るか**：表示中の状態しだい（^GSPC の 200日線の上・50日線の下か、どちらかの指数の FTD 判定が調整中のとき）。
- **1024〜1439px の幅**：測っていない（1440 だけ）。
- **もう一方のテーマの色**：銘柄側の行は `--text-2`（トークン）。spec が色を照合したのは既定のテーマ（このフィクスチャの描画では暗い配色：見出しの文字色 rgb(240, 242, 250)）だけ。
- **時間の計測**：このパッケージでは取っていない。

### 統合への依頼・報告（このトラックでは変えていない）

- **見出しの「参考 M件」の色**（観察）：注意サインが 1 件以上の日は、`.brief-signals.is-warn > b`（brief.css）で見出しの「・参考 M件」も琥珀色になる。太さは同じ（700、実測）。参考は琥珀にしない方針に合わせるなら、見出しの中で参考の件数を別の要素にし（MarketScreen.jsx の `signalsHeadline`）、色を戻す CSS が要る。直すかを決めてほしい。
- **marketRegimeReference.js:75 のコメント**と **marketRegimeReference.test.js:41 のテスト名**が古い凡例の語「関係未確認」「検証で関係未確認」を引いている（所有外）。意味（参加度の規則は robust でない）は今の凡例「指数の下げとの関係は未確認」と同じなので、動作には影響しない。
- **過去の傾向の脚注の「値動きが荒い」**：既存の文「これらは同じ事実（下げの最中・直後は値動きが荒い）を別の形で数えたもの」は振れ幅についての言い方を含む。参照 JSON は振れ幅を持たない。このパッケージでは変えていない（M5 の「振れ幅は書かない」は新しく足す文についての指示と読んだ）。残すかを決めてほしい。
- **frontend/src/constants/metricGlossary.js:139**（所有外）の「3=天井圏」：M7 は市場タブの凡例だけを変えた。用語集の語をそろえるかは統合の判断。
- **P6 との関係**：上抜けの行の名前を「上抜けの維持」に変えると、銘柄側の行は行の `label` を読むので同じ名前になる。そのとき、この行の spec と vitest の照合は producer 経由（`marketCardView` の `stockSide`）なので通し直しだけでよい。marketTabModel.test.js の M6 のテストは「ブレイクアウト成功率」を文字で書いているので、そこは直しが要る。
- **CONTEXT.md の語彙**（統合時に移す）
  - 「銘柄側の 1 行」：判定のそばの参考の 1 行（TT 達成数とその 1 か月前、上抜けの率と件数、リーダーの健全度と銘柄数）。目安は読まない。注意サインに数えない。
  - 「0% の注記」：50日線割れの判定の 0% が独自設定で検証されていないことを言う文。^GSPC の区分が同じ日のときだけ調査の数字を付ける。

## M8a〜M8d：producer の追加、出力は off（パッケージ P5）

コミット（すべて claude/r3-market、push なし）：

- fc3bc60d M8a〜M8c（`frontend/tools/collect-market-history.py`）と、その unittest（`test_collect_market_history.py`）
- 3e3af808 M8d（`frontend/tools/export-market-trends.mjs`）と、その vitest（`export-market-trends.test.mjs`）
- このコミットの文書（この節、M0 の節の 1 段落、docs/MARKET_HISTORY_PRODUCER.md の追記）
- 両方の producer とも `EMIT_R3_MARKET_FIELDS` は **off**（Python は `False`、JS は `false`）。規則 18 により、新しいキーを読む UI が Pages に出たのを読取で確かめた後の追従コミットでだけ on にする（このパッケージではしない）。
- UI（marketLongHistory.js、marketTrendAsset.js、marketTabModel.js、marketTabStudy.js の読み手と表示）はこのパッケージに含まない。src/ は 1 行も変えていない。

### 作ったもの

**長期履歴 collector（M8a〜M8c、collect-market-history.py）**

`build()` が 5 つの値を各営業日について計算する。既存の約束事（`sufficient` の条件、`val`、`leaderCohort` の 20 営業日のずらし、上抜けのマスク、銘柄ごとの値は `try` の中のローカルで作り、成功した銘柄だけ足す）にそのまま従った。

| キー | 定義 | null |
|---|---|---|
| `rs90Cohort` | 20 営業日前（`LEADER_LOOKBACK_SESSIONS`）に `rs90TemplateCount` と同じ集合（`template30 & rs>=90`）にいて、今日も観測されている銘柄の数 | `leaderCohort` と同じ条件 |
| `rs90CohortAbove50` | そのうち今日 50 日線の上（`over50`） | 同上 |
| `newHighsClose` | 終値 > 上抜けの規則の `prior_high`（直前 251 営業日の高値の最大） | 当日が `sufficient` でない |
| `breakoutsEarlyJudged` | 5〜9 営業日前の既存の `breakout` のうち、後の 5 営業日の安値がすべて観測されたもの | 9 営業日前〜当日のどれかが `sufficient` でない |
| `breakoutsEarlyFailed` | そのうち後の 5 営業日の最安値 ≤ 上抜けの終値 ×（1 − `BREAKOUT_FAILURE_DRAWDOWN`） | 同上 |

- **定数**：`BREAKOUT_EARLY_SESSIONS = 5`（独自設定、新規）。窓の幅は `BREAKOUT_HOLD_SESSIONS − BREAKOUT_EARLY_SESSIONS`（=5）で作るので、5〜9 営業日前の窓は 10〜29 営業日前の確定分の窓と構造上重ならない。−7% は既存の `BREAKOUT_FAILURE_DRAWDOWN`。新しい閾値はこの 1 つだけ。
- **部分集合の確認（コード読取）**：rs90 の集合は `template30 & (rs>=90)`、コホートの集合は `template30 & (rs>=70)`。RS 90 以上は 70 以上を含むので、指示どおり部分集合になっている（止める必要はなかった）。
- **M8b の答え（コード読取）**：`newHighsClose ≤ newHighs` は**定義上成り立つ**。`parse_series` は 高値 ≥ max(始値, 終値, 安値) の足だけを残し（欠けた足は全欄 NaN）、`new_high` は同じ `f.high.shift(1).rolling(251)` の窓を当日高値で比べる。終値 > 窓の最大なら高値 ≥ 終値 > 窓の最大。よってテストで全行について確かめている。
- **`EMIT_R3_MARKET_FIELDS = False`** の間は、行にも `indicator_policy` にも何も足さない（`indicator_policy` はモジュールの `INDICATOR_POLICY` そのもの）。True のときは全行に 5 つのキーを書き、`indicator_policy` に `rs90_cohort`、`new_highs_close`、`breakout_early` を足した新しい dict を書く（モジュールの dict は変えない）。定数は `build()` の中で呼び出しのたびに読む（テストが patch で切り替えられる）。
- **ログ**：`build(..., log=None)` に引数を足した。`collect()` が `log=lambda line: print(line, flush=True)` を渡し、最新の営業日の値を 1 行出す。出力に書くかどうかに関わらず同じ値。
  `Market history r3 fields <日付> (emission off): rs90Cohort=<n|unavailable> rs90CohortAbove50=… newHighsClose=… breakoutsEarlyJudged=… breakoutsEarlyFailed=…`
  - 値は `build()` の戻り値にも `summary`（`--report` に書かれる）にも入れない。`collect()` のテストは `build` をただの dict に差し替えるので、ログは `build()` の中から出す。

**market-trends exporter（M8d、export-market-trends.mjs）**

- **`stallingDays({ bars, asOfDate })`**（純関数、export）：`{available:true, method, dates:[…]}` または `{available:false, method, reason}`。分析日に生きているストーリング日を古い順に返す。
  - 条件は backend の近似（backend/app/services/market_regime.py の `STALL_MAX_GAIN`、`STALL_NEAR_HIGH_PCT`、`_distribution_days` の `DIST_WINDOW`）と同じ：0 < 上昇率 ≤ +0.2%（`close/前日close − 1`、pandas の `pct_change` と同じ計算）、出来高が前日を上回る、終値が日中レンジ（> 0）の下半分、終値がその日を含む 25 営業日の終値の最高値から 3% 以内。分配日と同じく当日が 0 日目で、25 営業日後に失効。
  - 定数：`STALLING_METHOD = 'stalling-up0.2-higher-volume-lower-half-near3-age25-v1'`、`STALLING_MAX_GAIN = 0.002`、`STALLING_NEAR_HIGH = 0.03`、`STALLING_WINDOW_SESSIONS = 25`。backend の値と同じ（計画の値とも同じ）。IBD は定義を公開していないので独自設定と書いた。テストは backend のファイルの 3 つの定数を読んで照らす。
  - 不可（`available:false`＋理由、空の一覧にはしない）：日付が無い・不正、バーが配列でない、日付の無いバー、分析日にバーが無い、日付の重複・逆順、OHLCV のどれかが正の有限数でない、高値 < max(始値, 終値, 安値)、安値 > min(始値, 終値)、49 本未満。
  - バーには取引日の一覧が無いので、この関数は日の欠けを見られない。exporter は distributionDays が取引日と照らして `available` にしたときだけ呼び、そうでなければその理由をそのまま渡す（followThrough と同じ）。
- **`buildMarketTrendsWithStalling(source, options)`**（export）：`{payload, stalling}` を返す。`stalling` は `{'^GSPC': …, '^IXIC': …}` で、出力の on／off に関わらず計算する。`emitR3MarketFields`（既定は `EMIT_R3_MARKET_FIELDS`）が true のときだけ、各指数のオブジェクトの `followThrough` の後に `stalling` を書く。`buildMarketTrends(source, options)` はその `payload` を返すだけになった。
- **分配日とは混ぜない**：ストーリング日は分配日の本数（`latest`、`lastObserved`）、`points`、`events` に入れない（テストで、on と off の `points`・`events`・`latest`・`lastObserved`・`followThrough`・`closes`・`state` が等しいことを確かめた）。
- **M0 のログ行**：`marketIndexLogLines(payload, {stalling})` に引数を足し、行末に ` stalling=<本数|unavailable(<理由>)> stallingDates=[…]|-` を出す。指数の `stalling` が書かれていればそれを、無ければ同じ build の値を読む。どちらも無ければ `unavailable(-)` と `-`（0 にしない）。`exportMarketTrends` は同じ build の `stalling` を渡すので、出力が off でも本数と日付が出る。

### 計画・指示からの補いと判断

1. **backend との違い（決めてほしい）**：backend はストーリング日を分配日と同じ列に OR してから失効を数えるので、**後の終値が その日の終値の 5% 以上上に来たストーリング日も外す**（`DIST_EXPIRY_RALLY`）。指示の条件と method id（`…-age25-v1`）にはこれが無いので、指示どおり 25 営業日の失効だけにした。定数（0.2%、3%、25）は backend と同じ。backend の数え方にそろえるなら、5% の外し方（backend は終値、`distributionDays.js` は後日の高値で 5%）を決め、method id も変える必要がある。
2. **短い履歴**：backend の 25 営業日の終値の最高値は `rolling(25, min_periods=1)` で、系列の最初の方では短い窓を使う。ここでは生きている窓（最後の 25 営業日）の各日に 25 本の窓がそろうことを求め、49 本未満は不可にした。実際の指数の系列（280 本）では違いは出ない（下の照合で 0 件）。
3. **M8c の「判定済み」**：指示は「5〜9 営業日前の上抜けの件数」。既存の確定分（`matured`）が後の 10 営業日の安値がすべて観測されたものだけを数えるのに合わせ、後の 5 営業日の安値がすべて観測されたものだけを数えた（欠けた日に −7% に届いたかもしれないので、判定しない）。テストに、欠けた足のある上抜けが数えられない例を入れた。
4. **ログの読み先（M0 の約束の例外）**：M0 の行は「asset に書いた値だけを読む」約束だった。出力が off の間はストーリングが asset に無いので、この 2 欄だけは同じ build の値を読む。M0 の節にもその旨を書いた。
5. **既存テストの変更**（どれも自分の package のファイル）：M0 の行の正規表現に 2 欄を足した。(c) の 2 つの `toEqual` に `stalling:'unavailable(-)'`、`stallingDates:'-'` を足した（側の値を渡していないため）。foreign cwd の再生テストと「書いた行をログに出す」テストは、`marketIndexLogLines` に同じ build の `stalling` を渡して照らすようにした。

### テスト

**Python（test_collect_market_history.py、`R3MarketFieldTests` の 6 件）**

- 入力：110 銘柄・560 営業日の合成。乱数の傾向（RS の散らばり）に、設計した銘柄を足した：5〜9 営業日前の上抜け 4 件（後の 3・5 営業日目に −10% の安値、6 営業日目に −10%〔5 日の外〕、届かない）、後の 2 営業日目の足が欠けた上抜け 1 件、高値だけが新高値の銘柄、20 営業日前に RS 上位で今日 50 日線を割った銘柄。最後の日は 0 < 失敗 < 判定、0 < 50 日線の上 < rs90Cohort < leaderCohort、上抜けの日は 0 < newHighsClose < newHighs（どれも 0 や上限に張り付かない）。
- 各定義を、テストの中に別に書いたスカラーの再計算（audit-market-history.py と同じ作り：バーから移動平均・テンプレート・RS 順位・上抜けを 1 銘柄ずつ数える）と、最後の 25 営業日について 5 つのキーとも照合。
- 出力 off：どの行にも 5 つのキーが無い、`indicator_policy` はモジュールの dict そのもの。off の出力のバイト ＝ on の出力から 5 つのキーと 3 つの定義を除いたもののバイト（時計を固定）。
- null の規則：12 銘柄が 1 日欠けて 253 営業日 観測率が 90% を下回る入力で、`rs90Cohort` の null ⇔ `leaderCohort` の null、`newHighsClose` の null ⇔ 当日の不足、上抜けの早期 2 つの null ⇔ 9 営業日前〜当日のどれかの不足を全行で確かめ、戻った後の 9 日・20 日の境目も確かめた。99 銘柄だけの入力では 5 つとも null（0 にしない）。
- 検査：全行で上の 5 つの不等式と、値が null か 0 以上の整数であること。
- ログ：on でも off でも同じ 1 行で、値は on の最後の行と同じ。99 銘柄だけの入力では 5 つとも `unavailable`。

**vitest（export-market-trends.test.mjs、describe「stalling days (M8d)」の 16 件）**

- 定数が backend のファイルの値と同じで、出力が off であること。
- すべての条件を満たす日が 1 日だけ見つかること、そして各条件が 1 つだけ欠けた 6 通り（変わらず、下げ、+0.21%、出来高が同じ、出来高が少ない、上半分）で見つからないこと。+0.19% とレンジのちょうど中央は見つかり、レンジ 0 は見つからないこと。
- 25 営業日の終値の最高値から 2.9% は見つかり、3.1% は見つからないこと。窓の外（26 営業日前）の高い終値は数えないこと。
- 失効：0 日目と 24 日目は残り、25 日目に消えること。
- 不可：49 本未満、空、無し、不正な日付、分析日のバーが無い、null のバー、出来高 null・0、終値 NaN、高値 < 終値、日付の重複。49 本ちょうどは可。
- コミット済みの実データ（data/market-trend-source-2026-10-23.json）：^GSPC は 2026-07-27 を分析日にすると `['2026-07-27']`、2026-10-23 では `[]`。
- 出力 off のバイト：`JSON.stringify(buildMarketTrends(…))` の sha256 が、変更前（45603f06 のコード）に取った値と一致すること（`ed029467…932e2df6`、1 営業日遅れの形で `242bbf6f…6ad6a29`）。on から `stalling` を除いたものが off と同じバイトであること。
- 出力 on の形：2026-07-27 までの入力で ^GSPC の `stalling` が `{available:true, method, dates:['2026-07-27']}`、分配日の欄が off と同じ、その日は分配日の event に無い。ログ行は on（asset から）と off（同じ build から）で同じ。指数が不可のとき・その日の出典が無いときは指数の理由、1 営業日遅れの指数は自分の最後の日で計算すること。

### 実測（このワークツリー）

- **Python（CI と同じコマンド、ワークツリーの直下で）**：`$S/audit/r1-step0/cal-venv/bin/python -m unittest discover -s frontend/tools -p "test_collect_market*.py"` → 33 件 OK（31.9 秒）。所有していない test_collect_market_environment.py と test_collect_market_trends.py は無編集で通過（変更前は 27 件 OK）。
- **vitest（指示の一覧）**：`npx vitest run tools/export-market-trends.test.mjs tools/export-research-order.test.mjs tools/market-history-producer.test.mjs tools/market-history-transport.test.mjs src/static/marketLongHistory.test.js src/static/marketTrendAsset.test.js`（PATH の先頭 /opt/node22/bin、SESSION_CALENDAR_PYTHON と FINANCIAL_REPLAY_PYTHON を指定）→ 6 ファイル、189 件通過。
- **eslint**：`npx eslint tools/export-market-trends.mjs tools/export-market-trends.test.mjs` → 指摘 0。
- **collector の出力のバイト（変更前のコードとの比較、コミットしない scratch のスクリプト）**：`git show 45603f06:frontend/tools/collect-market-history.py` を読み込み、同じ入力・固定した時計で `encode(build(…))` を比べた（`$S/audit3/r3-market-p5/identity.py`）。3 つの入力すべてでバイトが一致：
  - 設計した合成入力（393,631 バイト、sha256 0d3e2d71…）
  - 同じ入力で 12 銘柄が 1 日欠けたもの（420,890 バイト、30015d1d…）
  - test_collect_market_environment.py の 110 銘柄の入力に業種の分類を付けたもの（1,116,570 バイト、6dd27eca…）
- **ストーリング日の backend との照合（コミットしない scratch のスクリプト）**：コミット済みの実バー（^GSPC／^IXIC、各 280 本、2025-09-15〜2026-10-23）で、49 本目以降の各日を分析日として `stallingDays` を計算し、backend の `_distribution_days` と同じ式（`market_regime.py` の定数を読み込む）のストーリングの列の最後の 25 営業日と比べた（`$S/audit3/r3-market-p5/parity.py`、/home/user/screener/backend/venv の Python）。各指数 232 日、不一致 0。この期間に backend の式がストーリングとした日は ^GSPC 2025-10-21・2025-12-05・2026-01-02・2026-07-27、^IXIC 2026-01-28・2026-05-22。2026-10-23 を分析日とすると両指数とも 0 日（ログ行は `stalling=0 stallingDates=[]`）。
  - backend の 5% の外し方は比べていない（判断 1）。この期間の値でそれが違いを生むかは確かめていない。
- **所有の関門**：各コミットの前に `python3 -I $S/audit3/check-ownership.py MARKET <W> 45603f06…` → `OWNERSHIP OK (MARKET): 23 paths`。

### 推論（11-12 の再構築の代理。公開値ではない）

`$S/audit3/r3-market-p5/proxy_r3.py`：このトラックの HEAD の `build()` を定数を patch で on にして、11-12 の上流の日足 bundle（`audit3/snapshot/build/dl/px/daily-price-us-20261112.json.gz`、2 年分）の、snapshot が検証済みとした 4421 銘柄に掛けた（audit-market/inventory/scripts/long_history_proxy.py と同じ入力と包絡の補修。ネットワークなし、1 分 28 秒）。

- 既存のキー：11-12 までの 31 日について、前の代理（7f0ff13 の collector、`long-history-proxy.json`）とすべてのキーが一致。
- **M8a**：11-12 は `rs90Cohort` 233、うち 50 日線の上 105（45.1%）。計画の代理値「233 銘柄中 45.1%」と一致。
- **M8b**：11-05 は `newHighs` 281 のうち `newHighsClose` 46、11-04 は 278 のうち 180。計画の代理値と一致。11-12 は 74 のうち 21。
- **M8c**：11-12 は 146 件中 43 件が −7% 到達（29.5%）。同じ日の確定分の失敗は 245 件中 99 件（40.4%）。
  - 計画の問い（09-22〜09-29 に確定分より先に上がるか）：早期の割合は 09-17 の 22.2%（10/45）から 09-22 に 33.9%、09-24 に 48.1%、09-25 に 50.0%（40/80）と上がり、09-29 の 45.7% から 10-01 には 25.0% に下がった。確定分の失敗は 09-17 の 43.9% から 09-25 に 49.8%、10-01〜10-02 に 56.4〜56.5% が山。早期の山（09-25）は確定分の山（10-01〜10-02）より約 4 営業日早く、上がり幅も大きい（+27.8pp 対 +12.6pp）。代理の上での読みで、公開値ではない。
- 最新の日のログ行（代理）：`Market history r3 fields 2026-11-12 (emission on): rs90Cohort=233 rs90CohortAbove50=105 newHighsClose=21 breakoutsEarlyJudged=146 breakoutsEarlyFailed=43`
- 公開された長期履歴（Yahoo の 6 年分、公開銘柄集合）での値は、次回の公開の CI ログを読むまで未検証。期待値は書かない。

### 読取による確認（計画が未検証のまま残していたもの）

- **指示にあった 4 ファイル**（`market-history-producer.mjs`、`export-market-history.mjs`、`market-history-store.mjs`、`market-history.node.mjs`）は 13F の市場指標履歴の経路で、長期履歴（`market-history-source.json`）を読まない。grep で `leaderCohort`・`rs90TemplateCount`・`breakoutsHeld`・`market-history-source`・`long_history` は 0 件（market-history.node.mjs の `newHighs` は 13F の別の契約の `latest.newHighs`）。したがって「行のキーの許可リストは無い」は成り立つが、この経路とは無関係という意味での答え。
- **長期履歴が実際に通る経路**：`collect-market-history.py` → `market-history-source.json` → `restore-market-history-source.mjs`（`verifyLongHistorySource` で検査し、公開 series の `long_history` と `isDeepStrictEqual` で照合）→ `exportMarketTrends`（`verifyLongHistorySource` → `validateLongHistory`、`payload.long_history={...history}`）。`validateLongHistory` は既知のキーだけを `key in row` で検査して行をそのまま返し、未知のキーを拒まず落とさない。照合も同じバイトどうし。新しいキーで止まる所は無かった。
- `restore-market-trend-source.mjs` は `buildMarketTrends` で投影して、指数に points があるか・put/call の値が合うかだけを見る。公開済みの series とは比べないので、`stalling` を on にしても復元は止まらない。
- `indicator_policy` を読むコードは collector と 2 つのテスト（`assertIn('stage')`、`assertIn('leader_health')`）だけ。
- **audit-market-history.py**（85 行目）：既知のキーだけを独立に再計算し（`extended` は `if key in points[day]` のときだけ照合）、行のキーを列挙しないので、新しいキーは拒まれないが照合もされない。
- **8849bf9 の `marketLongHistory.js`／`marketTrendAsset.js` が新しいキー入りの asset を受け入れて表示を変えないこと**（計画 M8 のリリース順 2）は、UI のパッケージのテストで確かめる。このパッケージでは実行していない（未検証）。

### 運用上の注意（キャッシュ）

`static-site.yml:979` の長期履歴のキャッシュキーは `market-long-history-v1-<日付>-${{ hashFiles('frontend/tools/collect-market-history.py') }}`。**collect-market-history.py を変える合流は、そのたびにキャッシュキーを変える**ので、次の定期実行は長期履歴の全件（約 6 年分・公開銘柄すべて）を 1 回取り直す。このパッケージの合流で 1 回、後の on への切り替え（同じファイルを変える）でもう 1 回起きる。取り直しに失敗すると、前回の取得分がそのまま残り（`updated:false`）、新しいキーは単に無い。この取り直しは計画に織り込み済みで、検証のための再実行はしない。

### 未検証

- 公開された長期履歴での 5 つの値と、公開された ^GSPC／^IXIC でのストーリング日（次回の公開の CI ログの 2 種類の行で読む）。期待値は書かない。
- backend の 5% の外し方を入れたときの違い（判断 1）。
- 8849bf9 の読み手が on の asset を受け入れること（UI のパッケージで確かめる）。
- 定期実行の全件取り直しにかかる時間と、成功するか。
- 時間の計測はしていない（上の秒数は負荷下の参考値）。

### 統合への依頼・報告（このトラックでは変えていない）

- **audit-market-history.py に 5 つのキーの独立の再計算を足す**（計画 M8 の書き方。このパッケージでは編集禁止）。今の `wanted` の窓（標本日の 9 営業日前〜当日と 20 営業日前）は `rs90Cohort`（`_template` と並べて rs90 の集合を持てばよい）と `newHighsClose`（標本日の終値と直前 251 営業日の高値）には足りるが、`breakoutsEarly*` には足りない：5〜9 営業日前の上抜けは、その日の 251 営業日前からの高値と 50 営業日の出来高、後の 5 営業日の安値が要る。on に切り替える追従コミットの前に入れるのがよい。
- **backend の 5% の外し方をストーリング日に入れるか**（判断 1）。入れるなら method id を変える。
- **on への切り替え**は、UI が Pages に出たのを読取で確かめた後、Python と JS の 2 つの定数を同じ追従コミットで変える（それぞれ全件の取り直しが 1 回起きる。上の注意）。
- **CONTEXT.md の語彙**（統合時に移す）：「早期（上抜け後5営業日）」＝5〜9 営業日前の上抜けを後の 5 営業日の安値で読んだ割合（独自設定）。「ストーリング日（独自近似）」＝backend と同じ条件の、分配日に数えない別の集計。「終値でも更新」＝`newHighsClose`。「RS推計90以上のコホート」＝`rs90Cohort`。
