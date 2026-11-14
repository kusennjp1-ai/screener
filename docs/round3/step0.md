# Round 3 STEP 0：共通部品と検証用の合成銘柄

作成 2026-11-13、更新 2026-11-14（日本時間）。ブランチ claude/r3-step0（main 8849bf9 ＋ 計画の文書 ＋ H4 の合流）。計画は docs/round3/plan.md の §4.1〜§4.3。
レビューの指摘への対応は §5、計画の訂正は §6、未検証の一覧は §7。
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
- `crossingFloor(bars, row)`（breakoutHistory.js）が下限を決める唯一の場所。**STEP 0 の本体は常に null**。本体は R1 が書く。
- **R1 の下限は、ピボットの日足そのものの index**（`pivotBar(bars, row).index`）。計画の「次の日足」ではない（§6）。
  - ピボットの日足の終値は、その日の高値（＝ピボット）を超えられない。だから、その日の上抜けは「ピボット到達」（touch）にしかならず、上抜けの日付は後の日足になる（breakoutBar）。ピボットができる前の上抜けは入らない。
  - 次の日足を下限にすると、本物の上抜けを落とす（契約テストで実測）。ピボットの日足が高値で引け、翌日に出来高を伴って上で引けた場合：到達は下限より前で、翌日は直前の終値がピボットの下ではないので上抜けにならない。矢印は消え、結論は「上抜け日 未確認」になり、失敗ブレイクの判定もその上抜けを見ない。実データでの頻度は未検証。
  - R1 が決める残りの場合：ピボットの日足より前からピボットのセントで引け続けた並び（前日もセントで引けた）。どちらの下限でも下限以降に上抜けが無く、後の上抜けも落ちる。
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
  - ピボットの日足 k で到達し、k+1 で上に引けた場合：`from: k` では残り（矢印は緑・結論の日付・失敗ブレイク）、`from: k + 1` では落ちる。
  - 最後の日足より後の下限（`from: bars.length`。「次の日足」の規則で、ピボットの日足が分析日そのもののとき。MGRC の形、ZZNR はその前日）：上抜けなし、矢印なし、結論は日付不明、失敗ブレイクは clear。252本へのずらしでも同じ。
  - STEP 0 では crossingFloor が常に null（R1 はこのテストを自分の本体の契約に置き換える）。
- chartReadout.test.js は、lastPivotCrossing の呼び出しの期待値に `{ from: null }` を足しただけ。

### H2 `frontend/src/static/priceActivity.js`（STEP 0 の後は R の担当）

- export-research.mjs の `price_activity` の計算（60本の値幅と lowRange）を、同じ出力のまま移した。キーの順も同じ。
  - 逐語の移動ではない。60 と 5 を名前付きの定数（`PRICE_ACTIVITY_SESSIONS`・`LOW_RANGE_PERCENT`）にし、エクスポーターの `audit.valid ? chart.bars.slice(-60) : []` を、監査が日足を退けたときは null を受ける引数に変えた。
  - だから `git diff --color-moved` では確かめられない。同一性は再エクスポートで示した（§3）。
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

### H4 `backend/scripts/probe_setup_ready_908.py`（凍結。claude/r3-step0-h4 から合流）

- 908 件の Minervini の売買例で Setup Engine の準備（`setup_ready`）を数える、補助のプローブ。round 2 の補助プローブをコミットしたもの。
- 凍結した 908 ハーネス（validate_trade_ideas.py）は変えず、呼ばない。ハーネスの読み込み関数を import して使うだけ。
  - ハーネスの SETUP の列は Markets360 の条件で、Setup Engine の準備・CH11・CH12 を見ない（p1-5）。PR の本文にもこの注意を書く。
- コミット済みの 908 バンドルだけを読み、オフラインで走る（この環境で約 6 分）。
  - エントリー（T0）と対照（T0 の 63 本前）で MinerviniScanner と SetupEngineScanner を走らせる。
  - 出すもの：準備の合格率と差、ゲートごとの不合格、ステージ 2 の割合、上抜け日のエントリーでの準備。
  - JSON はキーを並べ替え、時間を含まないので、2つの木で比べられる。`--rows` は評価した全行を足す。
- テスト：backend/tests/unit/services/test_probe_setup_ready_908.py。ゲートの表を explain_builder.py に対して固定し、T0 での切り方も確かめる。
  - **GATE_1 に追加した**（レビューの指摘）。CI は明示したファイルとゲートしか走らせず、tests/unit/services を集める CI のジョブは無い。gate-check の対象名にも当たらない。
  - R は readiness.py と explain_builder.py を受け持つ。失敗の名前が変わると、プローブの「その他の失敗」に落ち、規則 19 のゲートの表が変わる。このテストがそれを捕まえるので、CI で必ず走らせる。
  - 凍結ハーネスの仕組みのテスト test_validate_trade_ideas_harness.py も、同じ理由で GATE_1 に入れた。2つで約 2 秒、24 件。
- 合流（3c8cbc0a）：ファイルは STEP 0 と重ならず、競合なし。

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
| ZZRD | `se_setup_ready` true、確信度 78、`se_volume_vs_50d` 0.74、`se_quiet_days_10d` 2、土台 17週・18%（この日足から。下の注）。収縮3回（18%・8%・5%、出来高も減少、最後の区間の出来高比 0.51）。終値はピボット（最後の収縮の高値 57.58）の2%下（早期ゾーン）。VCP なのでピボットの日付は無い | 枠と深さ、「出来高の枯渇」、「VCP 17週 18/5 3T」、当日の出来高 0.73×。VCP カードに Setup Engine との食い違いの印は無い | C3、C4（null の例）、R3c |
| ZZPM | 当日の詳細の SEC 記録が、公開版の invalid_payload の形そのもの（後述） | 「業績 未確認・SEC検証不可」 | D1、OD14 |
| ZZQF | 6月決算、9月の 10-Q 提出済み（10/1）。導出した6月の Q4 が窓の中。Q4 の EPS は 10-K だけ。売上と純利益の Q4 は導出 | 「EPS +73%・売上 +50%（26-09期）」 | D3、D4 |
| ZZNR | nr7_inside_day、`se_pivot_date` = 分析日の前日（10/1、その高値 62.40 がピボット）。その7営業日前（9/23）に2.1倍で終値が上抜け、最終の終値はピボットの下（MGRC の形） | 「ブレイク失敗（独自判定）9/23に出来高2.10×で上抜け…」、灰色の矢印 9/23、「崩れ」 | R1 |
| ZZPG | 収縮3回の後、8/27 に +44% の窓開け（前50日平均の50倍）、その後25営業日の終値が 36.31〜36.49（ADR20 0.15%）。ピボット 36.45（cup_with_handle、9/23 の高値、週のラベル 9/25）。最後の上抜けは 9/30（出来高 0.38×）。`price_activity` は H2 で計算（PCRX の形） | lowRange false、買いゾーン、「9/30に上抜け・出来高不足」、試算 244株、「損切りが収縮の中（安値 24.56 より上）」、「土台の高値を上抜け（8/27）」 | R2、R3a |
| ZZNV | 既定の行のまま。最新の行が、EPS が 10-K にしかない fiscal Q4（`ORACLE.fiscalQ4Latest`、原因 `latest_row_fiscal_q4_without_eps`） | — | D2、D3 |

- **ZZRD の Setup Engine の値**（レビューの指摘で直した）。
  - 以前の 0.62・7・12週は手で置いた値で、自分の日足と合わなかった。日足の当日の出来高比は 0.73、チップの土台は 17週。トラックが両方を出すと、1画面に1つの量の数字が2つ並ぶ。
  - いまはこの日足から取った値。`se_volume_vs_50d` 0.74 と `se_quiet_days_10d` 2 は、readiness.py の式（当日を含む50日平均に対する当日の出来高。出来高が枯れ、値幅が ATR14 より小さい日の数）をこの日足で計算した値（実測）。`se_base_length_weeks` 17・`se_base_depth_pct` 18 は、アプリ自身による土台の測定（footprint）。
  - Setup Engine の VCP 検出器そのものがこの日足で何週と測るかは、走らせていない（未検証）。確信度と `se_setup_ready` は置いた値で、計算ではない。
  - spec は、出来高比が画面の値の 0.03 以内（公開版での関係）、週数と深さが VCP カードの許容（2週・3%）以内であることを確かめる。

### SEC 記録の形

- **ZZPM** の `book_financials` は sec-financials.py の `unavailable()` に `invalid_detail()` を足した形（test_sec_financials.py:360 と同じ形で、received_cik は null）。
  - キーは `schema_version, symbol, as_of_date, status: 'unavailable', reason: 'invalid_payload', error: 'SEC取得不可: PayloadMismatch', retrieved_at, invalid_detail`。
  - `invalid_detail` の4つのキーは `class: 'PayloadMismatch'`、`message: 'companyfacts cik does not match the requested cik'`、`requested_cik: 1000001`、`received_cik: null`。
  - 詳細には、エクスポーターが書くとおり `sec_admission {state:'admitted', reason:null}` を付けた。
- **ZZQF** は 8849bf9 の受け入れ判定が受け付けるキーだけ。r3-base（8849bf9）の `admitBookFinancialsDetailed` で、ZZPM・ZZQF とも admitted（実測）。
- **原因コードの違い**（実測）。計画は ZZNV を fiscal_q4_untagged の例と呼んでいるが（§6）、原因コードは次のとおり。`ORACLE` のキーは `fiscalQ4Untagged` から `fiscalQ4Latest` に変えた。spec は各銘柄の原因コードを1つに固定する（ZZNV は `['latest_row_fiscal_q4_without_eps']`、ZZQF は `['fiscal_q4_untagged']`）。D2 の `eps_unknown.q4_only` のテストは、この2銘柄で2つの原因を別々に確かめられる。
  - ZZNV：最新の行が EPS の無い Q4（6月期）なので、`epsUnknownCauses` は `latest_row_fiscal_q4_without_eps`。`code33Parts.q4Eps` は true。
  - ZZQF：EPS の無い Q4 が窓の途中にあり、前後の既知の EPS 成長率は上昇している。EPS の加速と Code 33 が「その Q4 しだいで未確認」になり、原因は `fiscal_q4_untagged`。売上と利益率は導出した Q4 を含めて上昇。

### brief-oracles.spec.js（凍結。トラックが変えてよいのは自分の test.fixme → test だけ）

- **形の検査（Node 側、ブラウザなし）**：全銘柄の合成・重複なし・日足の認証。各オラクルの形を生産者関数で確かめる。
  - 例：chartCrossing、crossingEvent、sellSignals の failedBreakout、pivotBar、buildBookTechnicalEvidence、footprint、rsLineNewHigh／rsLeadMarks／publishedRsLineHigh、admitBookFinancialsDetailed、secStatus、bookFinancialCurrent、code33Parts、epsUnknownCauses、priceActivity。
  - 文言は検査しない（トラックが変えるため）。ZZHB のイベントは kind・tone・日付で確かめる。
- **ZZHB の緑の矢印は今から有効**。
  - 生産者：ピボットの日足そのものの index、その次の日足、アプリの crossingFloor の3つの下限で変わらないことを確かめる。
  - 画面：320・390・1440 で `.bc-breakout[data-date="2026-09-28"][data-tone="zone"]`。
- **ZZNR と ZZPG の今日の形**は、下限なし（継ぎ目が固定した経路）で確かめる。
- **目標**（test.fixme）。
  - R1：ZZNR の失敗ブレイクの判定が clear（null・unknown ではない）。ピボットの日足以前の矢印が無い（crossingFloor で判定、画面の矢印も確認）。
    - 結論が失敗ブレイクのものでない。生産者は buyGate に銘柄画面と同じトレンドテンプレートを渡す。下限なしでは失敗ブレイクの結論になることも確かめるので、空振りでは通らない（テンプレートを渡さないと、今日でも 'template' になり通ってしまう。実測）。
    - 画面は結論の `data-gate` を、チャートが落ち着いた後に読む。
  - R2(a)：ZZPG が lowRange、試算は `PLAN_BLOCKED.low`、「損切りが収縮の中」の欄が無い。
  - R2(b)：低変動の規則と独立に確かめる。lowRange が false の行（古い公開の、60本の値幅だけの行）でも、試算の損切りが、ギャップで上抜けた土台（`vcp.base.breakoutDate` より前の収縮）の安値と組まれない。
    - 生産者：positionPlan の `stopInsideBase` が true でなく、`structural.low` がその収縮の安値のどれでもない。
    - 画面：その行を配信した2つ目のページで、試算（株数）が出たうえで、チャートが落ち着いた後に「損切りが収縮の中」が無い。
    - 以前の目標は R2(a) だけを見ていた。低変動で試算が止まれば警告は消えるので、R2(b) が無くても通った（レビューの指摘、下の予行で実測）。
- **描画**：9銘柄（ZZNV を含む）× 320・390・1440 で、ページエラー・外部通信・横スクロールが無いこと。オラクル込みで Today・一覧・ウォッチ・市場もエラーなしで描画されること。
- **目標の予行**（実測。スクラッチのコピー `audit3/r3-step0/dry/` で、リポジトリには入れていない。CI と同じ Chrome 147・CI のフォント・ポート 4421）。fixme を test にして、3つの状態で走らせた。
  - **今のコード**：R1 は「clear」で失敗（hit）、R2 は R2(a) の lowRange で失敗。
    - 画面の読み取り点は、今日の悪い状態を見る（別の probe で確認）。ZZNR の `data-gate` は、チャートが落ち着いた後に failedBreakout。lowRange を false にした ZZPG は、株数が出て、落ち着いた後に「損切りが収縮の中」が1件。どちらの画面側も空振りでは通らない。
  - **R2(a) だけ**（priceActivity に ADR20 < 0.6% を足しただけ。positionSizing はそのまま）：39192869 の R2 の目標はそのまま通る（レビューの指摘した穴）。新しい R2 の目標は R2(b) の `stopInsideBase` で失敗。
  - **R1 ＋ R2(a) ＋ R2(b)**（下限 = ピボットの日足の index。`vcp.base.breakoutDate` が pivotBar の日付より前なら、構造上の損切りを未確認「前の土台」に）：オラクルの spec 40/40 通過、スキップ 0。
  - 以前の予行（39192869）は、下限「pivotBar の次の日足」で 40/40 だった。ZZNR ではどちらの下限でも同じ結果になるので、この目標では下限の違いを区別できない。違いは契約テストが固定する（§1 H1b）。
  - 他のオラクルの chartCrossing・crossingEvent・failedBreakout は、その下限で変わらない（ZZHB は spec が3つの下限で確かめる）。
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

### H2：エクスポートの同一性（実測、`audit3/r3-step0/final/h2/`）

- **入力**：スナップショット自身の入力（`build/serve` の 5955 行からエクスポーターが足す項目を除いたもの、4421 本のチャート、取引カレンダー、`work/benchmark.json` の SPY）で static-data を組んだ。
- **実行**：export-research.mjs を、8849bf9 と c61bf96b（H4 の合流とレビューの修正の後の、STEP 0 の HEAD）の git archive で、同じ `FINANCIAL_EVALUATED_AT` で実行。
  - 実行器はレビューの実行器（`audit3/r3-review-bi/h2/run.sh`）の写し（`final/h2/run.sh`）。両側の出力の木と sha256 の一覧を消さずに残した。
- **結果**：出力 14,830 ファイルの sha256 がすべて一致し（14,830/14,830）、ログも一致した。
  - 研究インデックス research-index-1bf5a7cc904990db.json（sha256 1bf5a7cc…3793）と manifest.json（83b53f19…0755）も、両側で同じ。
  - `price_activity` は詳細 5955 件すべてにある。値幅ありが 2962（lowRange 95）、値幅なしが 2993。比べた中身は空ではない。
- **前の記録との関係**：最初の記録は 8849bf9 と 32922af4（H2 の直後）の比較で、出力の木を消していたため、記録のままでは監査し直せない。レビューが 39192869 で再実行して同じ結果・同じインデックスのハッシュを得た。上の c61bf96b の結果が、いまの HEAD での記録。
- **この再エクスポートが届かない分岐**（実測、`final/h2/null-ranges.json`）。
  - 値幅なしの 2993 件は、すべて監査を通っていない行（`technical_audit.valid` が true でない）。
  - 「監査は通ったが日足が60本未満」で null になる、priceActivity のもう一つの分岐は 0 件。実データの再エクスポートはこの分岐を通っていない。
  - この分岐を確かめているのは vitest（priceActivity.test.js）と、次の切り出しだけ。R2（STEP 0 の後に priceActivity.js を受け持つ）は、再エクスポートをこの分岐の証明と読まないこと。
- **別途**：掲載 980 行の日足で、8849bf9 の行（git show から取り出したもの）と新しい関数を比べた（c61bf96b で再実行）。監査の通過・不通過と、60本・59本の組み合わせで 3920/3920 がバイト一致。59本で監査を通った場合が、上の分岐。
- **注意**：この入力は CI の公開物そのものではない（SEC 記録・決算日・機関保有などは未収録）。公開版の入力での一致は未検証。

### H4：908 件での準備（実測、`audit3/r3-step0/final/probe-908-c61bf96b.json`）

908 件を試み、エントリー 588 件・対照 575 件を評価した。スキップは、エントリーが日足不足 50・バンドルのファイルなし 270、対照が T0−63 の前の日足不足 13。G1〜G10 の行は、そのゲートで不合格だった行の数。

| | エントリー | 対照（T0−63） | 差 |
|---|---|---|---|
| setup_ready | 28/588（4.8%） | 23/575（4.0%） | +0.8pp |
| Minervini のステージ 2 | 534/588（90.8%） | 380/575（66.1%） | +24.7pp |
| SE のステージ 2（ゲート 8 の入力） | 528/588（89.8%） | 300/575（52.2%） | +37.6pp |
| G1 セットアップの点数 | 67（11.4%） | 66（11.5%） | −0.1pp |
| G2 品質 | 3（0.5%） | 2（0.3%） | +0.2pp |
| G3 準備度 | 320（54.4%） | 365（63.5%） | −9.1pp |
| G4 早期ゾーン | 358（60.9%） | 443（77.0%） | −16.2pp |
| G5 ATR14 | 8（1.4%） | 26（4.5%） | −3.2pp |
| G6 出来高の枯渇 | 458（77.9%） | 301（52.3%） | +25.5pp |
| G7 RS の先導 | 50（8.5%） | 140（24.3%） | −15.8pp |
| G8 ステージ | 34（5.8%） | 178（31.0%） | −25.2pp |
| G9 移動平均の並び | 17（2.9%） | 88（15.3%） | −12.4pp |
| G10 RS レーティング | 11（1.9%） | 72（12.5%） | −10.7pp |

- 上抜け日（エンジン自身の当日の出来高比 ≥ 1.4、終値がピボットの上）：エントリー 215 件で準備 0、対照 49 件で準備 0。
- その他の失敗（エンジンがゲートを飛ばした行など）：エントリーは insufficient_data・insufficient_daily_bars・insufficient_weekly_bars が各 10。対照は insufficient_data 12、insufficient_daily_bars 12、insufficient_weekly_bars 6、primary_pattern_below_confidence_floor 2。
- 不明：準備の不明はエントリー 0・対照 0。点数なし（短い日足）はエントリー 10・対照 12。
- **計画の受け入れをすべて再現**：28/588 対 23/575（+0.8pp）、ゲート 6 の不合格 458/588、上抜け日のエントリー 215 件で準備 0。
- **8849bf9 との一致**：8849bf9 の記録（`audit3/r3-h4/probe-908-8849bf9.json`、`--rows` 付き）と、`--rows` 付きの再実行（`final/probe-908-c61bf96-rows.json`）がバイト一致（sha256 ff66d919…2682）。`--rows` なしの出力は rows のキーが無いぶん cmp では異なるが、rows を除けば同じ。
- **凍結ハーネス**：H4 のブランチで「DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp」（実測）。STEP 0 は backend/app を変えていない（8849bf9 からの差分なし）ので、この HEAD でも同じはず（推論。この HEAD では再実行していない）。

## 4. 検証（このブランチ、実測）

計測はすべて c61bf96b（クリーンな木）。この文書を足すコミットは docs/round3/step0.md だけを変えるので、コードとテストは c61bf96b と同じ（`git diff --name-only c61bf96b..HEAD` で確かめる）。

### スイート

- **vitest**：247 ファイル・3983 件すべて通過。新規 27 件を含む（priceActivity 10、pivotBar 9、継ぎ目の契約 8）。
- **静的 Playwright**（Chrome for Testing 147 の headless shell・CI のフォント、ポート 4421）：446 通過・2 スキップ・失敗 0。
  - 件数は 448（17 ファイル）。既存 16 ファイルは 8849bf9 と同じ 408 件で、brief-oracles が 40 件。スキップ 2 は fixme の目標 R1・R2。
  - 以前の回（chartSettled を直す前）：445 通過・2 スキップ・失敗 1（ZZRD・390 で chartSettled が止まった。§1 H3）。既存の 408 件はどの回もすべて通過。
- **.github/scripts のテスト**（SESSION_CALENDAR_PYTHON・FINANCIAL_REPLAY_PYTHON を与えた）：2067 件中、通過 2063・失敗 2・スキップ 2。
  - 失敗 2 は reconcile-candidate-history.test.mjs の「real restore CLI」2 件。GITHUB_EVENT_PATH が無く、select-release-source.mjs:905 の runCommand に undefined のパスが渡る。この環境だけの既知の失敗。
  - スキップ 2 は、実際に保持したソースが要る 2 件（retained real source …）。
- **更新のライフサイクルのテスト**：financial-source-renewal-lifecycle（1/1）と financial-source-renewal-automatic-lifecycle（2/2）が通過。上の実行の中で、コミット済みでクリーンな c61bf96b に対して走った（フィクスチャが git archive HEAD で制御器を写すため）。
- **backend**：make gate-1 は 279 件通過（STEP 0 の 255 件に、H4 のプローブのテストと凍結ハーネスのテストの 24 件を足した）。gate-5 は 43 件通過。gate-check は OK（Setup Engine のテストはすべてどれかのゲートに入っている）。
- **npm run lint**：エラー 0。警告 4 件は 8849bf9 と同じ。
- **エントリーチャンク**（npm run build、HEAD の git archive）：gzip 130.10 kB（8849bf9）→ 130.28 kB。+0.18 kB（+0.14%、STEP 0 の上限 +0.3% = 130.49 kB）。39192869 と同じファイル（index-k7TvM-ky.js）で、レビューの後の変更はコメントとテストだけ。
- **既定のフィクスチャの sha256**：8849bf9 と同じ（§2）。ZZRD の値を直した後の c61bf96b で計算し直しても同じ（`final/fixture-hash-c61bf96.json`）。

### 8849bf9 とのバイト一致（実測、ハーネス `audit3/r3-harness`、ポート 4421、CI と同じ設定）

- **492 画面のプローブ**：`probe-c61bf96.json` の sha256 b5f29cff…39fa2 が 8849bf9 と同じ。ラベル 492 画面・値 480 画面・30 銘柄・ページエラー 0。
- **テキストと箱のダンプ**：42 画面、sha256 cba0a2f2…c3555 が 8849bf9 と同じ。
- **画面の高さ（375×812）**：8849bf9 と同じ。Today 1342、候補 593、ウォッチ（5 銘柄）442、市場 1228（FTD の食い違い 1300、1 日遅れ 1322）、銘柄 ZZNV 3044。チャートのカードは 320・375・390 で 508（週足の 320 で 492）、1440 で最大 727.1。
  - ウォッチの 442 は計画の 495 と違う。495 は round 2 の古い読み。理由は baseline.json に書いた。
- **再現スナップショット**（`snapshot/out/c61bf96/`。11-12 の再現の数で、公開版の数ではない）。
  - rows.jsonl・ready43.jsonl・serve/research.json が SNAP と同じ。counts.json（失敗ブレイク・lowRange・準備・凡例・±0.0 など §4.5 の数）が 8849bf9 と同じ。
  - 出力のファイル 4,440 件を比べ、違うのは 3 件だけ。bundle.mjs（木のコードが変わったので当然）と、描画のプローブ 2 件（各画面の PNG のパスに出力先の名前が入るだけ。名前をそろえると同じ）。
  - recalc-proxy.jsonl と eval-proxy.jsonl は、実行器が実行後に消すので直接は比べていない。それから作る rows.jsonl などは SNAP と同じ。
  - 実データの描画のプローブ：476 画面・エラー 0。counts-render.json は 8849bf9 と同じ。
- **H1 の確認**：§3 の記録と同じ（c61bf96b で再実行）。

### 新しい基準（実測、`audit3/r3-harness/baseline.json` の "step0"）

- **オラクルのプローブ**（`PROBE_ORACLES=1`）：8 銘柄、ラベル 132 画面・値 132 画面、ページエラー 0。2 回の実行が同じ。sha256 d94b0244…5e89。`audit3/r3-harness/probe-oracles-step0.json` に保存。
  - 39192869 の記録と同じ（264 画面のうち違いは 0）。ZZRD の値の修正は、チャートの画面を変えない。
- **オラクルのチャートのカードの高さ**（プローブの cardH、明るい表示）。
  - 320：3m・6m・1y で 476、週足で 492（全 8 銘柄）。
  - 375：全期間 508。390：全期間 508。ただし ZZHB の 6m と 1y は 490。ZZRL の暗い表示（390）も 508。
  - 1440：622.4〜727.1。ZZPG の 6m が最大の 727.1。
- **オラクルの銘柄画面の高さ**（content。2 回の実行が同じ。はみ出し 0・エラー 0）。

| 銘柄 | 320×640 | 375×812 | 390×844 | 1440×900 |
|---|---|---|---|---|
| ZZHB | 2476 | 2348 | 2330 | 1832 |
| ZZNR | 2882 | 2778 | 2736 | 1832 |
| ZZPG | 2781 | 2619 | 2571 | 1832 |
| ZZPM | 2608 | 2483 | 2483 | 1832 |
| ZZQF | 3189 | 2985 | 2985 | 1832 |
| ZZRD | 2621 | 2496 | 2496 | 1832 |
| ZZRL | 2634 | 2509 | 2509 | 1832 |
| ZZRW | 2608 | 2483 | 2483 | 1832 |
| ZZNV（既定の行） | 3308 | 3044 | 2954 | 1832 |

  - 375 の ZZQF は 2985 で、銘柄画面の上限 3388 の中（D3 の基準）。
  - 1440 はどの銘柄も 1832 で、画面の高さで決まる。

## 5. レビューの指摘への対応

| # | 指摘 | 対応 |
|---|---|---|
| 1 | priceActivity.js の冒頭と本書が「そのまま移した」と書いている。実際は同じ出力の書き換え | 採用。冒頭のコメント（a8d66219）と §1 H2 を「同じ出力のまま移した（名前付きの定数、日足なしは null）。同一性は再エクスポートで示した」に直した。コードは変えていない |
| 2 | H2 の記録が 8849bf9 対 32922af4 で、出力の木も消えていた | 採用。合流後の HEAD（c61bf96b）でレビューの実行器の写しを走らせ、木を残した。14,830/14,830 一致、インデックスの sha256 も同じ（§3 H2） |
| 3 | 再エクスポートは「監査は通ったが60本未満」の分岐に届かない | 採用。実測で値幅なし 2993 件はすべて監査不通過、その分岐は 0 件。§3 H2 に書き、R2 への注意を足した |
| 4（major） | R2 の目標が R2(a) だけを見ていた | 採用（c61bf96b）。lowRange を false にした行で、positionPlan の `stopInsideBase` が true でなく、`structural.low` がギャップ前の土台の収縮の安値のどれでもないこと、画面で「損切りが収縮の中」が 0 件であることを、同じ fixme の中で確かめる。予行で、今のコードと R2(a) だけでは失敗し、R1＋R2(a)＋R2(b) で通ることを確かめた（§2） |
| 5（major） | プローブのテストを走らせる CI のジョブが無い | 採用（fcda8ee3）。test_probe_setup_ready_908.py と test_validate_trade_ideas_harness.py を GATE_1 に入れた。gate-check OK、gate-1 279 件通過 |
| 6（major） | R1 に渡す下限「pivotBar の次の日足」が本物の上抜けを落とす | 採用（a293422c、c61bf96b）。crossingFloor のコメントと §1 H1b を「ピボットの日足そのものの index」に直した。契約テストに 2 件を足した（k で到達・k+1 で上抜けは `from: k` で残る、`from: bars.length` は上抜けなし・失敗ブレイクは clear）。ZZHB の確認は `bar.index` も見る。挙動は変わらない（下限は null のまま） |
| 7 | R1 の目標が「hit でない」だけで、結論を見ていない | 採用（c61bf96b）。失敗ブレイクの判定が 'clear' であること、buyGate の結論が失敗ブレイクのものでないこと（下限なしでは失敗ブレイクになることも確かめる）、画面の結論の `data-gate` を確かめる |
| 8 | ZZNV の原因コードを正規表現でどちらでも通していた。キー名も誤り | 採用（c61bf96b）。ZZNV は `['latest_row_fiscal_q4_without_eps']`、ZZQF は `['fiscal_q4_untagged']` に固定。キー `fiscalQ4Untagged` を `fiscalQ4Latest` に変えた |
| 9 | ZZRD の Setup Engine の値が自分の日足と合わない | 採用（c61bf96b）。日足から取った値（0.74・2・17週・18%）にした。spec で画面の値との差を確かめる。既定のフィクスチャとチャートの画面は変わらない（§2、§4） |
| 10 | 計画の ZZHB の欄の文言が 8849bf9 の出す文言と違う | 記録した。リポジトリの docs/round3/plan.md（要約）にはこの文言が無く、直すところは無い。スクラッチの計画の訂正は §6 に書き、統合で反映する。spec は文言でなく kind・tone・日付を確かめる |

## 6. 計画の訂正（統合で計画と記録に反映する）

1. **§4.1 ZZHB の欄**：期待する結論の文言は「M/Dに上抜け・出来高N×」ではなく「9/28に上抜け・4営業日前」（すべての幅で実測）。8849bf9 の crossingEvent は、出来高の形を上抜けの当日にだけ出す。R1 と C4 は 8849bf9 が出さない文言を追わないこと。
2. **§5 R1**：`crossingFloor` の本体は「pivotBar の次の index」ではなく、ピボットの日足そのものの index。見出しの「ピボットの日足の後の上抜けだけ」は「ピボットの日足以降」。ピボットの日足の上の到達は touch にしかならず、上抜けの日付は後の日足になる（§1 H1b）。
3. **§4.1 ZZNV の欄**：ZZNV は `fiscal_q4_untagged` の例ではない。原因は `latest_row_fiscal_q4_without_eps`。`fiscal_q4_untagged` の例は ZZQF。D2 の `eps_unknown.q4_only` は両方の原因を数えるので、2 銘柄で別々に確かめられる。
4. **§4.5 ウォッチの高さ**：今の値は 442（5 銘柄）。495 は round 2 の古い読み（§4）。

## 7. 未検証

- 公開版の行（998・43）での H1 の結果と、すべての数の公開版での値。ここの数はすべて 11-12 の再現のもの。
- 実データで「ピボットの日足が高値で引け、翌日に上抜け」が何件あるか（下限を次の日足にすると落ちる場合）。
- ZZRD の日足で Setup Engine の VCP 検出器そのものが測る土台の週数（走らせていない）。
- chartSettled が 1 回止まった原因（止めたアニメーションは特定できていない）。
- 代理の日足の 10 行で pivotBar が null になる理由（推論のみ）。
- H2 の同一性の、公開版の入力での確認。
- 時間（1440 の最初の表示、390 の期間の切り替え）は STEP 0 で測り直していない。STEP 0 はチャートのコードを変えていない。トラックは 8849bf9 と交互に測る（ハーネスの README）。
- 凍結 908 ハーネスの、この HEAD での再実行。
