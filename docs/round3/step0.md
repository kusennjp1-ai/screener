# Round 3 STEP 0：共通部品と検証用の合成銘柄

作成 2026-11-13（日本時間）。ブランチ claude/r3-step0（main 8849bf9 ＋ 計画の文書）。計画は docs/round3/plan.md の §4.1〜§4.3。
既定のフィクスチャでは画面に変化なし（合成銘柄はすべて `oracles: true` のときだけ配信）。実測と未検証は分けて書く。

## 1. 共通部品

### H1 `frontend/src/static/brief/pivotBar.js`（凍結）

`pivotBar(bars, row)` は、行の Setup Engine のピボット（`se_pivot_price`）を作った日足を `{ index, date }` で返す。見つからなければ null で、推測はしない。

- **週足の型**（`PIVOT_TIMEFRAMES` が weekly）：`se_pivot_date` は W-FRI で集計した週の金曜のラベル（取引日でないこともある。例 2026-04-03）。その日までの暦日7日のうち、高値がピボットとセント単位で一致する最後の日足。
- **日足の型**：`se_pivot_date` の日足そのもので、高値がピボットとセント単位で一致するとき。
- **null**：日足なし、日付なし・不正、ピボットなし、表にない型（または型なし）、一致する日足なし。
- `PIVOT_TIMEFRAMES` は凍結した定数1つ。各行に検出器のソース行を書いた（下表）。行の `se_timeframe` は使えない：スキャナーが常に "daily" と報告する（setup_engine_screener.py:174）。

| se_pattern_primary | 時間軸 | 根拠（候補を作る行） |
|---|---|---|
| cup_with_handle | weekly | backend/app/analysis/patterns/cup_handle.py:209 |
| three_weeks_tight | weekly | backend/app/analysis/patterns/three_weeks_tight.py:133 |
| high_tight_flag | daily | backend/app/analysis/patterns/high_tight_flag.py:176 |
| first_pullback | daily | backend/app/analysis/patterns/first_pullback.py:161 |
| vcp | daily | backend/app/analysis/patterns/vcp_wrapper.py:89（pivot_date は常に None なので pivotBar は null） |
| nr7_inside_day | daily | backend/app/analysis/patterns/nr7_inside_day.py:214 |

この6つが、公開されうる `se_pattern_primary` のすべて（実測、コードから）。
- 既定の検出器の組（detectors/__init__.py:18-31 `default_pattern_detectors`）。
- 各候補の `pattern` は検出器の `name`。集約は選んだ候補の `pattern` を `pattern_primary` にする（aggregator.py:184）。
- `double_bottom` はスタブで既定の組に入らず、候補を出さない。主パターンなしは null（recalculate-setups.py の clear_setup）。
- three_weeks_tight.py:200 と report.py:373 の `timeframe="daily"` は候補の時間軸ではない（日足の正規化と、検証用の見本）。

**ずれ防止のテスト**：backend/tests/unit/test_pivot_timeframes.py（Gate 1 に追加。gate-check の対象名ではないため、CI で必ず走るよう GATE_1 に入れた）。
- pivotBar.js の定数を（行コメントを除いて JSON として）読む。
- キーの集合 = 既定の検出器の名前の集合。
- 各検出器のソースで `PatternCandidateModel(pattern=self.name, timeframe=...)` の時間軸が表と一致し、表の行番号がその `timeframe=` の行であること（AST で確認）。
- 各検出器の golden の検出ケースを実際に走らせ、出た候補の (pattern, timeframe) が表と一致すること。
- 改変テスト（実測）：表の時間軸を1つ変える、行番号を1つずらす、1行消す、のいずれでも失敗した。
- 注意：検出器のファイルの参照行より上を編集すると行番号のテストが落ちる。pivotBar.js は凍結なので、その場合は統合で行番号を直す。

### H1b 上抜けの下限（crossing floor）の継ぎ目

- `pivotCrossings`・`lastPivotCrossing`・`breakoutBar`・`crossingEvent`・失敗ブレイクの判定（`sellSignals`／`stockSells` 経由）・`chartCrossing` が、任意の `from`（上抜けとして数えてよい最初の日足の index）を受ける。
- 非負の整数だけが下限。null・undefined・それ以外は、継ぎ目の前とまったく同じ経路を通る。
- `sellSignals` は直近252本だけを読むので、全日足の index を252本の中へずらす。252本より前の下限は何も制限しない。
- `crossingFloor(bars, row)`（breakoutHistory.js）が下限を決める唯一の場所。**STEP 0 の本体は常に null**。本体は R1 が書く（計画では pivotBar の日足の次の index）。
- 呼び出し側はすべて、そのビューの行（`view.row`）で `crossingFloor` を渡す。
  - チャートの矢印：StockChartCard.jsx。
  - 銘柄画面の注記と売りの判定：StockView.jsx（:52 の stockSells は計画の一覧に無かったが、売りカードと一覧の判定をそろえるため配線した）。
  - 結論の上抜けイベント：buyGate.js（結論と試算は同じ buyGate を読むので、両方に効く）。
  - ウォッチ行と Today の売りの判定：useWatchSellChecks（useBriefData.js）。
- 銘柄画面の `view.row` は一覧の行と詳細を合わせた行。一覧の行だけを読むか（計画 R1）は R1 が決める。
- 契約テスト（breakoutHistory.test.js）。
  - 下限なし（6種の値）で全ヘルパーの出力が継ぎ目の前と同じ。
  - 下限 k は k の上抜けを数え、k+1 では数えない。
  - 252本を超える日足でのずらし。
  - STEP 0 では crossingFloor が常に null（R1 はこのテストを自分の本体の契約に置き換える）。
- chartReadout.test.js は、lastPivotCrossing の呼び出しの期待値に `{ from: null }` を足しただけ。

### H2 `frontend/src/static/priceActivity.js`（STEP 0 の後は R の担当）

- export-research.mjs の `price_activity` の計算（60本の値幅と lowRange）をそのまま移した。キーの順も同じ。
- import を持たないので、そのまま Node で動く。
- export-research.mjs と合成銘柄 ZZPG がこの関数を呼ぶ。既定のフィクスチャの行は今までどおり `price_activity` を持たない。
- 同一性の証明（実測）は §3。

### H3 `chartSettled(page, { redraw, timeout })`（brief-fixture.js）

- フォントの読み込みを待つ。
- 次に、各チャートの描画が導入アニメを終えるのを待つ（`.bc-pulsing`）。アニメしない描画（動きを減らす設定、再描画）は脈動の輪を隠すので、それも終わりとみなす。日足不足の表示も終わり。
- 最後に、実行中（running）の有限アニメーションが無くなるのを、毎回 getAnimations を読み直して待ち、さらに 300ms 待つ。導入の最後のラベルの動きは requestAnimationFrame で、getAnimations に出ないため。
  - 最初の版は、待ち始めた時点の有限アニメーションすべての `finished` を Promise.all で待っていた。全件の実行で 1 回（ZZRD・390）、60 秒止まった（実測）。止めたアニメーションは特定できていない（未検証）。
  - 時間切れのときは、残っているアニメーションの名前を添えて失敗させる。
  - 止まった回のトレースでは、脈動の待ちが最初の描画から約 0.9 秒で終わっていた。アニメしない再描画の経路だったと見られる（推論）。
  - 直した版で、オラクルの spec を 3 回繰り返し（vitest の全件と同時に走らせて CPU を取り合わせた）、114 件通過・失敗 0（実測）。ただし前は約 110 回に 1 回の止まりで、この回数では差を示せない。直したのは設計上の対策で、原因は未検証。
- 期間ボタンを押した後は `{ redraw: true }` を渡す。まだ待ち終えていない新しい描画を待つので、前の期間の `.bc-pulsing` で終わることはない。
- 実測（390・CI と同じ Chrome 147・ZZHB、直した後の版）。
  - 初回 6.1 秒、期間の切り替え 4 回（`{ redraw: true }`）で各 4.4 秒。
  - 動きを減らす設定では初回・切り替えとも約 0.3 秒。
  - どちらも、終わった後に動いている有限アニメーションは 0。導入の終わりは、通常は `.bc-pulsing`、動きを減らす設定では脈動の輪が隠れていることで確かめた。

## 2. 合成銘柄（オラクル、§4.1）

### 共通の作り

- `openBrief(page, hash, { oracles: true })` または `routeBrief(page, { oracles: true })` のときだけ配信する。
- エクスポート：`ORACLE_ROWS`、`ORACLE_CHARTS`、`ORACLE_DETAILS`、`ORACLE`（計画上の名前 → 銘柄コード）。
- 銘柄コードは ZZ で始まり、既定の30銘柄・ZZU000〜ZZU099 と重ならない。社名は "(synthetic)" で終わる。
- 行は `withAuditFixture` で作る。監査値は日足そのものから計算したもの（`auditDailyBars`）。
  - consistent() が見る終値・前日比・出来高倍率が日足と一致するので、日足は認証される。
  - トレンドテンプレートが読む移動平均と52週の高値・安値も、その日足のもの。8銘柄とも8条件を満たす（実測）。
- 配信時は既定の行と合わせた非公開の複製を consistent() に通し、`mutate` の各関数はその合わせた集合を受け取る。
- 既定のフィクスチャのバイト一致（実測）：rows・charts・details・marketTrends()（新旧）・rowBySymbol・sessions の sha256 が 8849bf9 と同じ（00df3ae3…、9ec644ad…、4da3ee97…、f80531aa…、1725f8cb…）。

### 各銘柄

| 銘柄 | 形 | 今日の画面（390・実測） | 使う場所 |
|---|---|---|---|
| ZZRL | RS線（終値÷合成ベンチマーク）が分析日に新高値、株価は高値の5%下で RS の先行の印、`rs_line_high {value:true, leading:true}` | RS新高値のタグ、凡例に RS、「RS線 新高値（株価に先行・高値の5%下）」 | C、不変条件 |
| ZZRW | RS線が80営業日前の高値から15%下、`rs_line_high {value:false, leading:false}` | RS新高値なし | C |
| ZZHB | 週足の型（cup_with_handle）。`se_pivot_date` = 2026-09-25（金曜のラベル）、ピボット 48.50 の日足はその週の火曜 9/22。9/28 に前50日平均の2.4倍で上抜け、以後の終値はすべてピボット以上（買いゾーン） | 緑の中抜き矢印（9/28）、結論「9/28に上抜け・4営業日前」、矢印のラベル「上抜け 2.40×」 | R1、C4、不変条件 |
| ZZRD | `se_setup_ready` true、確信度 78、`se_volume_vs_50d` 0.62、`se_quiet_days_10d` 7、土台 12週・18%。収縮3回（18%・8%・5%、出来高も減少、最後の区間の出来高比 0.51）。終値はピボット（最後の収縮の高値 57.58）の2%下（早期ゾーン）。VCP なのでピボットの日付は無い | 枠と深さ、「出来高の枯渇」、「VCP 17週 18/5 3T」 | C3、C4（null の例）、R3c |
| ZZPM | 当日の詳細の SEC 記録が、公開版の invalid_payload の形そのもの（後述） | 「業績 未確認・SEC検証不可」 | D1、OD14 |
| ZZQF | 6月決算、9月の 10-Q 提出済み（10/1）。導出した6月の Q4 が窓の中。Q4 の EPS は 10-K だけ。売上と純利益の Q4 は導出 | 「EPS +73%・売上 +50%（26-09期）」 | D3、D4 |
| ZZNR | nr7_inside_day、`se_pivot_date` = 分析日の前日（10/1、その高値 62.40 がピボット）。その7営業日前（9/23）に2.1倍で終値が上抜け、最終の終値はピボットの下（MGRC の形） | 「ブレイク失敗（独自判定）9/23に出来高2.10×で上抜け…」、灰色の矢印 9/23、「崩れ」 | R1 |
| ZZPG | 収縮3回の後、8/27 に +44% の窓開け（前50日平均の50倍）、その後25営業日の終値が 36.31〜36.49（ADR20 0.15%）。ピボット 36.45（cup_with_handle、9/23 の高値、週のラベル 9/25）。最後の上抜けは 9/30（出来高 0.38×）。`price_activity` は H2 で計算（PCRX の形） | lowRange false、買いゾーン、「9/30に上抜け・出来高不足」、試算 244株、「損切りが収縮の中（安値 24.56 より上）」、「土台の高値を上抜け（8/27）」 | R2、R3a |
| ZZNV | 既定の行のまま。fiscal Q4 の EPS が 10-K にしかない例として名前を付けた | — | D2、D3 |

### SEC 記録の形

- **ZZPM** の `book_financials` は sec-financials.py の `unavailable()` に `invalid_detail()` を足した形（test_sec_financials.py:360 と同じ形で、received_cik は null）。
  - キーは `schema_version, symbol, as_of_date, status: 'unavailable', reason: 'invalid_payload', error: 'SEC取得不可: PayloadMismatch', retrieved_at, invalid_detail`。
  - `invalid_detail` の4つのキーは `class: 'PayloadMismatch'`、`message: 'companyfacts cik does not match the requested cik'`、`requested_cik: 1000001`、`received_cik: null`。
  - 詳細には、エクスポーターが書くとおり `sec_admission {state:'admitted', reason:null}` を付けた。
- **ZZQF** は 8849bf9 の受け入れ判定が受け付けるキーだけ。r3-base（8849bf9）の `admitBookFinancialsDetailed` で、ZZPM・ZZQF とも admitted（実測）。
- **原因コードの違い**（実測）。計画は ZZNV を fiscal_q4_untagged の例と呼んでいるが、原因コードは次のとおり。
  - ZZNV：最新の行が EPS の無い Q4（6月期）なので、`epsUnknownCauses` は `latest_row_fiscal_q4_without_eps`。`code33Parts.q4Eps` は true。
  - ZZQF：EPS の無い Q4 が窓の途中にあり、前後の既知の EPS 成長率は上昇している。EPS の加速と Code 33 が「その Q4 しだいで未確認」になり、原因は `fiscal_q4_untagged`。売上と利益率は導出した Q4 を含めて上昇。

### brief-oracles.spec.js（凍結。トラックが変えてよいのは自分の test.fixme → test だけ）

- **形の検査（Node 側、ブラウザなし）**：全銘柄の合成・重複なし・日足の認証。各オラクルの形を生産者関数で確かめる。
  - 例：chartCrossing、crossingEvent、sellSignals の failedBreakout、pivotBar、buildBookTechnicalEvidence、footprint、rsLineNewHigh／rsLeadMarks／publishedRsLineHigh、admitBookFinancialsDetailed、secStatus、bookFinancialCurrent、code33Parts、epsUnknownCauses、priceActivity。
  - 文言は検査しない（トラックが変えるため）。ZZHB のイベントは kind・tone・日付で確かめる。
- **ZZHB の緑の矢印は今から有効**。
  - 生産者：R1 の規則（pivotBar の次の日足）でも、アプリの crossingFloor でも変わらないことを確かめる。
  - 画面：320・390・1440 で `.bc-breakout[data-date="2026-09-28"][data-tone="zone"]`。
- **ZZNR と ZZPG の今日の形**は、下限なし（継ぎ目が固定した経路）で確かめる。
- **目標**（test.fixme）。
  - R1：ZZNR にブレイク失敗も、ピボットの日足以前の矢印も無い（crossingFloor で判定、画面の矢印も確認）。
  - R2：ZZPG が lowRange、試算は `PLAN_BLOCKED.low`、「損切りが収縮の中」の欄が無い。
- **描画**：9銘柄（ZZNV を含む）× 320・390・1440 で、ページエラー・外部通信・横スクロールが無いこと。オラクル込みで Today・一覧・ウォッチ・市場もエラーなしで描画されること。
- **目標の予行（実測、スクラッチのコピーで、リポジトリには入れていない）**：crossingFloor の本体を「pivotBar の次の日足」に、priceActivity に「20本の値幅 < 3% かつ ADR20 < 0.6%」を足して、fixme を test にして 40/40 通過。
  - 他のオラクルの chartCrossing・crossingEvent・failedBreakout は、その下限で変わらない（Node で確認）。
  - ZZPG は p1 の定義（ADR20 < 0.6% かつ20本の値幅 < 3%）と p4 の定義（ADR20 < 0.5% または20本の値幅 < 3%）の両方で該当：ADR20 0.148%、20本の値幅 0.63%。
  - ZZPG の土台の上抜け日（8/27）はピボットの日足（9/23）より前なので、R2(b) の「前の土台」に当たる。

## 3. 実データでの確認（再現スナップショット、US 2026-11-12。公開版の数ではない）

### H1：pivotBar の確認（実測、`audit3/r3-step0/h1-check.json`）

- **項目の対応**：スナップショットの行は入れ子。
  - `se_pattern_primary` = `setup_engine.pattern_primary`
  - `se_pivot_date` = `pivot.pivot_date`
  - `se_pivot_price` = `pivot.se_pivot_price`
- **CI と同じ日足の準備完了 30 行**：30/30 で見つかった。null は 0。
  - 週足の 24 行（cup_with_handle 20、three_weeks_tight 4）は、すべて `se_pivot_date` の週の中。
  - 日足の 6 行（nr7_inside_day）は、その日の日足そのもの。
  - 見つかった日足が `se_pivot_date` の日だったのは 10/30。週足では 4/24。
- **代理の日足の準備完了 7 行**（EMR、EQH、IQV、GEO、BB、BHB、DSGR）：7/7 で見つかり、週足は週の中。ただし日足は公開版のものではない。
- **参考：掲載 980 行**：894 で見つかった。null は 86。
  - CI と同じ日足の 612 行では 561 で見つかった。null 51 はすべてピボット価格なし。ピボット価格のある行で、見つからなかった行は 0。
  - 代理の日足の 368 行では null 35。25 はピボット価格なし。10（JHX、SWK、HOG、MTD など）は、週の中に高値がピボットとセント単位で一致する日足が無い。
  - この 10 行の Setup Engine は、高値を始値・終値まで広げた日足で計算している。rows.jsonl の日足は広げる前のものなので、一致しないのはそのためと考えられる（推論・未検証）。
  - ピボット価格なしの行が ±25% の規則で消えたものか、元からピボットが無いものかは数えていない（未検証）。
- **未検証**：公開版の行（998・43）での結果。

### H2：エクスポートの同一性（実測、`audit3/r3-step0/h2/h2-proof.json`）

- **入力**：スナップショット自身の入力（`build/serve` の 5955 行からエクスポーターが足す項目を除いたもの、4421 本のチャート、取引カレンダー、`work/benchmark.json` の SPY）で static-data を組んだ。
- **実行**：export-research.mjs を 8849bf9 と 32922af4（H2 の後）のそれぞれの git archive で、同じ `FINANCIAL_EVALUATED_AT` で実行。
- **結果**：出力 14,830 ファイルの sha256 がすべて一致し、ログも一致した。
  - 研究インデックス research-index-1bf5a7cc904990db.json（sha256 1bf5a7cc…3793）と manifest.json（83b53f19…5f2）も、両側で同じ。
  - `price_activity` は詳細 5955 件すべてにあり、値幅ありが 2962、lowRange が 95。比べた中身は空ではない。
- **別途**：掲載 980 行の日足で、8849bf9 の行（git show から取り出したもの）と新しい関数を比べた。監査の通過・不通過と、60本・59本の組み合わせで 3920/3920 がバイト一致。
- **注意**：この入力は CI の公開物そのものではない（SEC 記録・決算日・機関保有などは未収録）。公開版の入力での一致は未検証。

## 4. 検証（このブランチ、実測）

- **vitest**：247 ファイル・3981 件すべて通過。新規 25 件を含む（priceActivity 10、pivotBar 9、継ぎ目の契約 6）。
- **静的 Playwright**（Chrome for Testing 147・CI のフォント、ポート 4421）。
  - 最終回（HEAD）：446 通過・2 スキップ（fixme の目標 2 件）・失敗 0。
  - 1 回目（chartSettled を直す前）：445 通過・2 スキップ・失敗 1（ZZRD・390 で chartSettled が止まった。§1 H3）。既存の 408 件はどちらの回もすべて通過。
  - 件数は 448（17 ファイル）。既存 16 ファイルの件数は 8849bf9 と同じ（408）で、brief-oracles が 40 件（うち fixme 2）。
- **.github/scripts のテスト**：2056 件中、通過 2043・失敗 10・スキップ 3。
  - 失敗 10 のうち 8 は、固定した実行環境（SESSION_CALENDAR_PYTHON・FINANCIAL_REPLAY_PYTHON）を与えて該当 4 ファイルを再実行すると通過（64 件中 62）。
  - 残る 2 は reconcile-candidate-history.test.mjs の「real restore CLI」2 件。GITHUB_EVENT_PATH が無いための、この環境だけの既知の失敗。
- **backend**：make gate-1 は 255 件通過（新規 8 件を含む）。gate-5 は 43 件通過。gate-check は OK。
- **npm run lint**：エラー 0。警告 4 件は 8849bf9 と同じ。
- **エントリーチャンク**：gzip 130.10 kB（8849bf9）→ 130.28 kB で、+0.18 kB（+0.14%、上限 +0.3%）。
- **既定のフィクスチャの sha256**：8849bf9 と同じ（§2）。

8849bf9 とのバイト一致（492 画面のプローブ、テキストと箱のダンプ）は別の検証者が行う。ここでは主張しない。
