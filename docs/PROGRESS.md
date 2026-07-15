# PROGRESS — 改善サイクルログ

> 1サイクル = 1論点 = 1コミット。毎サイクル末尾に追記。
> 形式: 日時 / 変更点 / 検証数値 / 次の候補 / 未解決。
> セッションが切れても、このファイル＋docs/SPEC.mdだけで状態を完全復元できること。

## 固定metricの現在値（最新が真実）

| metric | 値 | 測定日 | ソース |
|---|---|---|---|
| golden gate-5 | 43 passed | 2026-07-05 | `make gate-5` |
| バンドright-edge一致 | 91% (P 82% / BR 92% / TPR 100%, 12銘柄) | 2026-07-05 | `markets360_band_rightedge_eval.py` |
| TPRフルストリップ(IBB) | 58% | PR#47時点 | 同上docstring |
| FIRE±5 fixtures基準率(コントロール) | 95.8% → **54.2%** (C1後) | 2026-07-05 | `validate_trade_ideas.py --fixtures` |
| 908トレード実測 @C1 (CIベースライン) | COV 64.8 / TT 61.7 / S2 90.0 / SETUP 78.6 / RS70 73.6 / FIRE±5 88.6 / MSCORE 95.5 / GATE 40.0（判別力: SETUP +52.0pp, FIRE±5 +24.4pp） | 2026-07-05 | `backend/calibration/trade_idea_report.md`（CI） |
| 908トレード実測 @C3 | GATE 40.0→**45.1**（2011: 0→75, 2020: 28.3→45.8）、control 19.7、他metric不変 | 2026-07-05 | ローカル再測定（バンドル、〜7分） |
| 908トレード実測 @C6 | TT 61.7→**69.7**（control 35.9→39.2のみ）→ **TT判別力 +25.8→+30.5pp** | 2026-07-05 | ローカル再測定 |
| 908トレード実測 @C15（ドリフト確認） | **C6と完全一致**（TT 69.7 / S2 90.0 / SETUP 78.6 / FIRE 88.6 / GATE 45.1、判別力 SETUP+52.0pp / FIRE+24.4pp）＝C13-15による劣化なし | 2026-07-07 | ローカル再測定 |
| W3.2 RS較正 | KEEP 40/20/20/20 (T+21 excess +1.79%, t=+9.63, n=1978) | 済 | `backend/calibration/W3.2_rs_weight_calibration.md` |

## サイクルログ

### C0 — 2026-07-05 ループ基盤（コミット 4a18420, ci 2件）
- **変更**: 固定ground-truthハーネス `validate_trade_ideas.py`（凍結8metric+CONTROL行+look-aheadゼロ、テスト6件）、`fetch_trade_idea_windows.py`、CI `backtest.yml` に bundle ジョブ追加（Yahoo egressはCIのみ→バンドルをブランチにコミットさせ、以後sandboxでフル検証をオフライン再生）。
- **検証**: ハーネステスト 6/6。fixtures smoke動作。CI dispatch成功（backtest+bundle実行中）。
- **発見**: workflow_dispatchは登録済みワークフローID＋任意refで実行され、実行内容はref側ファイル（standalone新規ymlはブランチからはdispatch不可）。
- **次**: C1(pivot状態) → C2(FTD/regime)。

### C1 — 2026-07-05 pivot状態の構造ゲート（コミット 5a08a48）
- **変更**: `find_pivot_point.ready_for_breakout` に下限追加（0≤dist≤3%。pivot超過銘柄が永久に"ready"だった）。`vcp_footprint` の near_pivot/ready を `detected`（VCP構造）でゲート、chase上限+5%。
- **検証**: FIRE±5コントロール基準率 95.8%→54.2%。golden gate-5 43 passed。services/scanners/golden 172 passed。新テスト4件。
- **理論的根拠**: Minerviniはpivot+5%超を追わない。構造なき高値近接はセットアップではない。
- **次**: C2 FTD検出。

### C2 — 2026-07-05 FTD検出（コミット 0047eb7）
- **変更**: `detect_follow_through` — 補正安値(≥6%下落)→試行day1=最初の陽線→day4-15の+1.2%＋出来高増で確認。FTD日安値割れ失効、分配日カウントのFTDリセット、pilot露出50%でcorrection/downtrend→confirmed_uptrend昇格。
- **検証**: 新テスト5、影響208 passed、golden 43。**実測: GATE 40.0→45.1%（2011年 0→75%、2020年 28.3→45.8%）、判別力維持**。
- **次**: C3 分配日正典化。

### C3 — 2026-07-05 分配日の正典化（コミット 8372edd）
- **変更**: +5%ラリーで失効、ストーリングデイ（高値圏±3%・出来高増・レンジ下半分・値幅≤+0.2%）を分配にカウント、docstring整合。
- **検証**: 新テスト2、影響210 passed、golden 43。
- **次**: C4 RPRユニバース配線。

### C4 — 2026-07-05 markets360 RPR = authentic percentile（コミット 2b97b1f）
- **変更**: バルクスキャンで `rs_universe_performances["weighted"]`（63/126/189/252・40/20/20/20、W3.2検証済み定義と同一）をcompute_rprに配線。daily限定（weeklyは非可換）。
- **検証**: 新テスト1（ユニバースが順位を駆動する双方向証明）、200 passed、golden 43。
- **次**: C5 SEPAルール1。

### C5 — 2026-07-05 MinerviniScannerに市場ゲート（コミット be718ca）
- **変更**: rating計算で `market_uptrend is False` ならBuy/Strong Buy→Watchにcap。passes_template（セットアップ判定）は市場非依存のまま。regime不明はノーブロック。
- **検証**: 新テスト3、216 passed、golden 43。C2のFTDによりcapは底で数週早く解除される。
- **次**: C6 TT正典化。

### C6 — 2026-07-05 passes_templateを公刊8条件に正典化（コミット直近）
- **変更**: 非正準の9つ目のベトー（60日回帰スロープStage分類）をpasses_templateから除去。8条件（MAスタック+200日上向き / 52週位置 / RS≥70）の厳密ANDに。回帰Stageはスコア20点とdetails["stage"]に残存。
- **根拠**: 実測でTT 61.7% vs バンドStage-2 90.0%。ピン留めテスト：+52%/年のリーダーが+2.9%/70日のグラインドで「Stage 3 Topping」誤読、8条件は全成立。
- **検証**: 新テスト2、205 passed、golden 43。**908実測: TT 61.7→69.7%、判別力+25.8→+30.5pp**（エントリー側が+8.0pp、コントロール側は+3.3ppのみ＝ベトーは本人のエントリーを選択的に落としていた）。
- **次**: C7 progressive exposure ladder。

### C7 — 2026-07-05 Progressive exposure ladder（コミット直近）
- **変更**: FTD後の固定50%を段階化——0-4営業日25% / 5-14日50% / 15日以上かつ分配≤2日で75% / MA回復でベース経路100%。遷移は滑らか（20→25→50→55→100）。
- **検証**: 3段すべてピン留め、206 passed、golden 43。
- **次**: C8 FTD/exposureのUI露出（現状バナーに出ない）。

### C8 — 2026-07-05 FTDをUIに露出（コミット 441ad47）
- **変更**: market_ftd_date / market_ftd_days_since を orchestrator→repo×2→schema→ScanResultItem に配線。regimeバナーに「FTD 2026-06-30 (+3d)」チップ＋日本語グロッサリー（follow_through）。
- **検証**: backend 369 passed、frontend banner 6/6、golden 43。
- **次**: C9 execution stateフォールバック。

### C9 — 2026-07-05 execution state入力フォールバック（コミット 3198064）
- **変更**: 入力優先順位 minervini→markets360(footprint pivot/volume_surge)→価格データ直接計算(SMA50/200・15日安値・50日出来高比)。UNKNOWN は価格データ欠如時のみ。「minervini無し→unknown」のピンは意図的に更新。
- **検証**: 新テスト3、235 passed、golden 43。gate-1の4failはstash検証で既存（NR7 numpy read-only、環境起因）。
- **次**: C10 ブラウザ実証。

### C10 — 2026-07-06 E2Eブラウザ実証＋バンドラベル修正（コミット 727b7ce）
- **変更**: sandbox内にフルスタック構築（Postgres16+Redis+uvicorn+celery+vite、fixtures13銘柄シード、SERVER_AUTH_ENABLED=false / SCAN_FRESHNESS_GATE_ENABLED=false の実機動作確認）。PlaywrightでSCAN投入（UI→API→celery疎通）、M360ページ実描画確認（バンド・チャート・カード全部出る）。発見した欠陥「バンドラベルがストリップを覆う」をピル化で修正、1440px/375px両方で前後比較。
- **検証**: スクショ前後比較（scratchpad/m360_bands_fixed_*.png）、markets360スイート+lint緑。
- **教訓**: Redis再起動でprice cache消失→celeryがyfinanceフォールバック（ブロック済み）に走る。sandbox E2Eは seed_from_realdata 再実行でRedis温め直しが必要。
- **次**: C11 スキャン結果テーブル＋regimeバナーの実画面検証、モバイルヘッダー崩れ修正。

### C11 — 2026-07-06 NumPy 2.x互換（コミット ae2f08c）+ モバイルヘッダー（f596885）
- **変更**: `np.float_`/`np.int_`（NumPy 2.0で削除）→ `np.floating`/`np.integer`（serialization.py + technical.py）。**sandbox E2Eで発見した実バグ**：numpy 2.x環境では全スキャンが永続化で失敗する。ヘッダーは375pxで1行化（タイトルmd未満非表示、ナビはスワイプ可能ストリップ、44pxタップ領域）。
- **検証**: numpy 2.4.6でround-trip検証、golden 43、スイート175。ヘッダーはPlaywright 375px実写で確認。

### C12 — 2026-07-06 freshness gate OFF時のcached-only読み（コミット 9565282）
- **変更**: `_read_prices_bulk()` 抽出——gate ON: get_many（vendor refresh込み）/ OFF: get_many_cached_only（ネットワークゼロ）。トグルの意味論をパイプラインまで貫通。
- **検証**: **sandbox E2Eでスキャン完走**（13銘柄、rating/regime=correction/execution_state全行、composite順位付き）。seamテスト2件、210 passed、golden 43。
- **E2E教訓**: pkillはシェルごと死ぬことがある（exit 144）→ setsidで起動、旧celeryプロセスが旧バイトコードで走り続ける罠に注意。
- **既知の残課題**: ①UIのPrevious Scansピッカーから完了スキャンを選ぶ自動化が未検証（API直では13件返る）②composite ratingは市場ゲート非適用（M360/minerviniの各rating capのみ）——SEPAルール1のグローバル適用は次サイクル候補 ③mobileのMA凡例重なり ④ベンチマークbundleはgate OFFでもvendorを試みる（SPYはDBにあるが未配線）。

### C13 — 2026-07-06 最終ratingへのSEPAルール1（コミット 3cd4988）
- **変更**: オーケストレータで execution cap 直後に市場ゲート——best-fitがCANSLIM/SE由来でも correction/downtrend で Buy/Strong Buy→Watch。rating_explanationに「market gate: … (SEPA rule 1)」記録。E2Eで観測した「FTNTがcorrection中にBuy」を封鎖。
- **検証**: 専用テスト＋orchestrator 34/34、スイート211、golden 43。テストハーネスのベンチマークを上昇系列に（RSフォールバック50をピンする2テストのみflat維持）。

### C14 — 2026-07-06 Code 33誤命名の除去（コミット 30b2b4e）
- **変更**: canslim_scannerの決算ブラックアウトから"Code 33"ラベル除去（本来のCode 33＝EPS+売上+マージン3四半期加速はsec_edgar_financials.py）。挙動不変。
- **検証**: canslim 4/4、gate テスト更新、golden 43。

### C15 — 2026-07-06 M360チャート凡例のモバイル可読性（コミット 直近）
- **変更**: LegendOverlayに半透明バッキング＋responsive font（375pxでロウソク足に重なって判読不能だった）。タイトルはnoWrap+ellipsis、MA行はwrap。
- **検証**: Playwright 375px実写確認、markets360スイート+lint緑。

### C16 — 2026-07-07 ドリフト確認（レッドライン儀式）
- **測定**: 908ハーネス再実行→**C6と全metric完全一致**（想定通り：C13-15はorchestrator/UI層でハーネス経路外）。フロント全スイート446/446。
- **次の候補（優先順）**: ①Code33のCI統計検証（`code33-check.yml --from-trade-ideas`、GitHub MCP要再認証） ②TPRフルストリップ較正（LLYハーネスはスクショ近似価格でノイズ大——実OHLCV固定のright-edge評価を週次系列に拡張する方が筋が良い） ③ポジション管理ビュー（買値登録→売りエンジンがR倍数自動監視） ④static PWAへのmarkets360組み込み。
### C17 — 2026-07-07 バンド3列の日本語グロッサリー（コミット 794335c）
- **変更**: metricGlossaryに pressure_state / buy_risk_state / tpr_state 追加——結果テーブルで唯一「?」が出なかった列群を解消（EN/JAツールチップのテーブル全列カバレッジ完成）。
- **検証**: Scanスイート109/109、lint緑。

### C18 — 2026-07-07 execution state「unknown」の解説補完（コミット 直近）
- **変更**: EXECUTION_STATE_GLOSSARYにunknownエントリ（判定不能＝Cap非適用の説明）。マップ指摘の残件。
- **次の最有力**: ①Code33 CI統計検証（要GitHub MCP再認証）②TPRフルストリップ（実OHLCVベースの週次right-edge拡張として設計）③ポジション管理ビュー④static PWAにmarkets360。

### C19（設計のみ・次コンテキストで実装） — TPRフルストリップ較正の方針
- **現状**: right-edge一致は TPR 100%（12銘柄）だが、フルストリップ（時系列全体）はLLYハーネスで52%。ただしLLYハーネスはスクショからの近似価格で**ground truthがノイズ**。
- **観測**: OURSのTPRはREALより早期にweakへ落ち、weakに長く留まる（ヒステリシス不足 or 条件の非対称）。REALはG→A→G→A→Rの遷移が滑らか＝**A（transition）の滞留が長い**。
- **設計案**: ①minervini_bandsのTPRヒステリシス（strong→weak直行を禁止しtransition経由を強制、N=3-5日の確認待ち）②52週レンジをClose基準→High/Low基準に統一（scanner系との不一致もマップ指摘済み）③【設計修正】週次遡及はground truth不在（スクショは各銘柄1時点のみ）で不可能。正しい評価軸：REALストリップ（スクショ由来のLLY/IBB系列）と OURS の**フリップ率・状態滞留時間の分布**を比較し、OURSの過剰フリップ/早期weak落ちをヒステリシスで是正する（9dff227のPressure較正と同じ手法をTPRに適用）。真値系列が無い区間の「一致率」を偽装しないこと。
- **レッドライン**: right-edge 12銘柄の一致（P82/BR92/TPR100）を絶対に下げない。calibration/bands関連の既存テスト16件green維持。

### C20 — 2026-07-07 開発スキル蓄積（コミット f0da6b0）
- **変更**: `.claude/skills/` に minervini-dev-loop（サイクル規律・凍結metric・理論ガードレール）/ ground-truth-908（オフライン再生＋CIディスパッチ手順）/ sandbox-e2e（フルスタック起動＋Playwright＋落とし穴集）。将来のOpus 4.8セッションがモデル非依存で即継続可能に。

### C21 — 2026-07-07 セクター回転アニメーション＋資金フロー・ストリップ（コミット 直近）
- **変更**: RRGChartに再生機能——▶で週次テールをタイムトラベル（rechartsのtweenでドットが滑らかに移動、スライダーで任意週へ、終端でLiveに復帰）。**資金流入/流出ストリップ**：現フレームの移動ベクトル(Δratio+Δmomentum、JdK流「向きが資金の行き先」)で流入トップ3↗（緑チップ）/流出トップ3↘（赤チップ）を常時表示。groups/sectors両スコープ・live/staticページ共用のRRGChart内で完結。
- **検証**: rrgFlow純関数テスト5件（象限・フレームスライス・流入流出ランキング・フレーム別フロー）、DOMテスト4件（ストリップ表示・3週未満で再生非表示・再生開始）。Chartsスイート54/54、lint緑。
- **未検証**: ブラウザ実写はsandboxにgroup-rankデータが無くRRGが404のため不可（DOMテストで代替）。ユーザーPC（ランク実データあり）のGROUPSページで要目視確認。

### C23 — 2026-07-07 TPR較正実験（**否決・revert済み**、コード変更なし）
- **実験**: フリップ/滞留統計でOURSのTPRが弱気過剰（R47/60 vs REAL32/60、A帯に留まれない）と判明→仮説「TPR_WEAK_RAW 4→3（過半数喪失で初めてweak）」を両固定metricで検証。
- **結果**: right-edge floorは維持（TPR10/10・全体91%）だが**LLYフルストリップは52.4%→38.1%に悪化**→即revert。乖離の主因は閾値でなく**時間軸の系統的リード**（OURSがREALより約10バケット早く遷移＝スクショ近似価格の歪み）。
- **結論**: フルストリップ較正は追加のMM360スクショ（複数時点）というground truthが増えるまで凍結。閾値フィッティングは行わない（憲章どおり）。right-edge 12銘柄が引き続き信頼できる較正基準。
### C24 — 2026-07-07 Code 33 YoYベースを期末日キーに（コミット 4b8b856）
- **原因**: CI code33-check（run 28856831094）で大型株が軒並み「missing/invalid YoY base at FY2026 Q1」。EDGARの`fy`/`fp`は**提出書類側の会計フレーム**であり期間のものではない——新しい10-Q内の前年同期比較行は新しいfyを名乗るため、旧実装の`(fy−1, q)`ルックアップは前年四半期を喪失（同一キーに衝突・上書き）。
- **Fix**: `quarterly_series_dated()`新設——期末日キー（衝突フリー）、同一期間の重複は最新filed優先（restatement対応）、表示ラベルは最古filed優先（元の提出書類は自四半期を正しくラベルする）、Q4は年次−期内3四半期で導出。`_yoy_base()`は期末日の近接（350-380日、変則決算向け340-390日フォールバック）で前年同期を特定。`compute_code33_from_facts`を全面的にdated系列へ移行（`quarterly_series`は四半期テーブル/静的エクスポートの既存消費者向けに温存）。
- **検証**: 回帰テスト追加——2024年四半期がfy=2025ラベルの比較行としてのみ存在する形状で、旧keyingは前年喪失・新pathはCode33合格を固定。restatement dedupeテストも追加。unit 10/10・レッドライン177/177・golden gate-5 43/43。
- **CI実測（run 28857536047 vs 28856831094、同一120銘柄）**: フル判定（3系列YoY算出まで到達）**32→38銘柄**（GME/DECK/ABG/HVT/R/CMGが復活）、YoYベース失敗41→37、✓は3のまま（RICK/CSX/DDOG——データ復元でありパス偽造でないことの傍証）。さらに旧コードは**衝突キーで別年の四半期をベースに使い誤った成長率を出していた**（PFE: 旧「6%>77%>59%」→新「46%>6%>77%」、PAG等も変化）——見えない誤答の修正が実は最大の成果。残る37件の大半は前年EPS≤0の赤字銘柄（RBLX/DKNG/SNAP/biotech群＝正の基数ルールによる理論的に正しい棄却）、残渣はQ4導出の欠落（GM/OXY/Z/SSTK/NATR、FY Q4末で失敗）——別サイクルで要調査。

### C25 — 2026-07-07 Code 33のas-of（point-in-time）評価＋アイデア日キャッチ率（コミット 30155fb / 6da9c97）
- **変更**: `compute_code33_from_facts(as_of=...)`——filed≦as_of の提出書類だけで評価（filed無しは除外、後日のrestatementは不可視）＝ゼロ先読みのpoint-in-time。`check_code33 --as-of-idea-dates`は908アイデア各々をアイデア日当日に評価し、**同一銘柄の1年前をCONTROL**として判別力を報告（生の率単独は禁止＝憲章どおり）。CIワークフローに`as_of_idea_dates`入力を追加。
- **検証（CI run 28858056500、全908アイデア）**: EDGAR facts無し288（上場廃止群）、point-in-time履歴不足555（XBRLは~2009-2011開始のため1997/2010年代前半はほぼ不可）→**評価可能ペア65**。pass@idea **12.3%** vs control **6.2%**＝判別 **+6.2pp**。年別では2021年（n=19）が31.6% vs 5.3%（+26.3pp）と明瞭、2020年は4.3% vs 8.7%と逆転（COVID崩落→回復リーダーはEPS加速が「まだ印字されていない」局面での買い）。
- **解釈**: Code 33はアイデア時点でも~12%しか点灯しない＝Minervini本人の記述どおり「理想形であって必要条件ではない」。**スクリーナーではボーナス/ランキング信号に留め、ハードゲートにしない**（現行配線どおり）を実測で確認。単体テスト12/12（vantageシフト・restatement不可視をピン留め）、レッドライン177/177、golden 43/43。
- **次**: Q4導出の残渣（GM/OXY/Z/SSTK/NATRがFY Q4末でYoYベース欠落）の調査、またはポジション管理ビュー（買値登録→売りエンジンR倍数監視）。

### C26 — 2026-07-07 ポジション管理ビュー（買値登録→売りエンジン自動監視）（コミット 67aa478）
- **変更**: トレードの「管理・売り」半分を実装。positionsテーブル＋`/v1/positions` CRUD＋close。ライブ状態は**読み取り時に既存のMarkets 360売りエンジンで計算**（compute_sell_plan＋r_multiple_targets再利用＝2画面が食い違えない設計）。トレーリングストップ・ラダー（stopは上がるのみ）、クライマックス、50日線割れ、R倍数＋2R進捗バー、2R/3Rターゲット（元のリスク単位基準）。価格はcache-only読み（一覧表示が外部fetchを誘発しない）。フロントはPositionsナビページ——SellPlanCardと同じ配色/日本語のアクションチップ、登録ダイアログ（stop<entry検証、1Rリスク%とMinervini 7-8%上限表示）、44pxタップターゲット。
- **検証**: sandboxフルスタック（Postgres+uvicorn+vite+Playwright）で実写確認——MSFTフィクスチャが+2.07Rで50日線崩壊のexit（stopはbreakevenへ切り上げ）、ブラウザ経由登録のFTNTはラダーが110→128.87へトレール。1440px/375pxスクショ目視済み。backend unit 4/4・ページテスト5/5・レッドライン181/181・golden 43/43・eslint緑。
- **次**: Markets360のSellPlanCard/BuyingNowCardから「この銘柄をポジション登録」ワンクリック導線、またはQ4導出残渣調査。

### C27 — 2026-07-07 Buying Nowカードから「ポジション登録」ワンクリック導線（コミット f6b104b）
- **変更**: スクリーン→買い→管理のループを閉じる導線。Markets 360の買いシグナルカードに登録ボタン——シグナルのトリガー価格・損切り・当日日付をプレフィルした共有AddPositionDialog（PositionsPageから components/positions/ へ抽出、open毎にinitialValuesで再シード）を開き、コミット前に1Rリスク%をMinervini 7-8%上限と並べて表示。成功時はスナックバー＋Positionsへのジャンプリンク。
- **検証**: FTNTフィクスチャ（Buying Nowアクティブ）でブラウザ実写——カードのボタン→プレフィル済みダイアログ（149.67/stop 134.70/リスク10.0%）→スナックバー→/positionsに行が出現。テスト BuyingNowCard 3・AddPositionDialog 2・PositionsPage 5 全緑、eslint緑。
- **次**: Q4導出残渣（GM/OXY/Z/SSTK/NATR）のCI診断、または静的PWAへのmarkets360統合。

### C28 — 2026-07-07 Q4「残渣」診断→赤字四半期セマンティクス修正（コミット 6d1b38b / 50316b9）
- **診断**: `--dump`診断モード＋CI `extra_args`入力を追加し、GM/OXY/Z/SSTK/NATRの日付キー系列をCIログで実見（run 28904876982）。**Q4導出の欠落ではなかった**——全四半期が存在し、前年Q4のEPSが負（GM −1.42 / OXY −0.32 / Z −0.23 / SSTK −0.04 / NATR −0.02）でYoY%が定義不能なだけ＝理論的に正しい棄却。副産物として実バグ2件発見：①導出Q4/比較行のみのQ4のラベルがまた提出書類側fy（GMの2023-12-31が「FY2025Q4」、fy欠落で「FY0Q4」、DECKの2025-03-31が「FY2026Q4」）②「missing/invalid YoY base」がデータ欠落と赤字四半期を混同。
- **Fix**: 理由を分離——`YoY base <= 0 at <label>（赤字四半期）`は**評価可能なFAIL**（Code 33は黒字成長企業のテスト）、`missing YoY base`のみ「判定不能」。Q4ラベルは期末年で決定（provenance非依存）。passesの意味は不変（全て✗のまま）。unit 14/14・レッドライン181/181・golden 43/43。
- **再計測（run 28905243272、全908、正直な分母）**: 評価可能ペア65→**126**、pass@idea **7.1%** vs control **3.2%**＝判別**+4.0pp**（ベース比2.2倍）。2021年（n=48）14.6% vs 2.1%。結論強化：**Code 33はレアなボーナス信号でありハードゲート不可**（現行配線どおり）。
- **次**: 静的PWAへのmarkets360統合（static-site.ymlにper-symbolペイロード輸出＋StaticMarkets360Page）。

### C29 — 2026-07-08 ループ基盤強化: STATE.md＋失敗台帳（Failure as Asset）
- **変更**: ユーザー提供の自己改善型AI設計ガイド（STATE/Verification/Memory/Skillsの4本柱）を当ループに写像。既存: PROGRESS.md=履歴、凍結metric+golden=Verification、`.claude/skills/`=Skills蓄積。**欠けていた2要素を追加**——①`docs/STATE.md`（「今」だけのスナップショット。毎サイクル全面上書き。現在metric値・次アクション・絶対制約・実行中ジョブ。30秒で再開可能）②失敗パターン台帳（minervini-dev-loop skillに「Failure ledger」節——EDGAR fy/fp罠、赤字ベース=FAIL、閾値フィッティング否決、artifact 403→job logs、jsdom date input、RQ v5 mutationFn第2引数、Playwright ESM解決、NVM無し等）。CLAUDE.mdにSTATE.md最優先読み込みを明記。sandbox-e2e skillの誤記（NVM前提）も修正。
- **注**: ガイドの「Fable 5フレームワーク」なるPython APIは実在しない（Fable 5は本セッションのモデル名）。設計思想のみ採用し、架空APIの移植は行わない。
- **次**: C30 静的PWA markets360統合。

### C30 — 2026-07-08 静的PWAにMarkets 360シグナルカード（コミット a3a8bb9）
- **変更**: 静的チャートペイロード（charts/{SYMBOL}.json）に`signal`＋`sell_plan`ブロックを追加——`_compute_m360_signals()`はライブMarkets360Serviceと**同一配線**（buy signalにチャート自身のbuy points＋バンド状態を供給、sell planはbuy signalのentry/stopを使用）なので静的ビューアとライブページが食い違えない。StaticChartViewerModalがローソク足上に同じBuyingNowCard/SellPlanCardを描画（デスクトップのみ——375pxでは300pxカードがチャートを覆うため。モバイル向け表現は将来課題）。シグナル計算失敗はカード非表示に縮退、エクスポートを壊さない。
- **検証**: export serviceテストがペイロードブロックとバンド状態フィードスルーをピン（57 passed、tpr_state=strong→barrels.trend=true）。モーダルテストが静的ペイロードから両カード描画をピン（staticスイート49 passed）。レッドライン238・golden 43・eslint緑。実サイトの見た目は次回のstatic-site.ymlビルド後にGitHub Pagesで確認可能。
- **次**: ポジションのdaily要約 or モバイル向けシグナル表現（コンパクトバッジ）。

### C31 — 2026-07-08 デイリーダイジェストにポジション要約（コミット f4097b7）
- **変更**: 日次ダイジェストが全オープンポジションを**Positionsページと同一の売りエンジン**で評価（cache-only価格＝外部fetch誘発なし）し、**要アクションのみ**を緊急度順（exit＞sell_into_strength＞tighten_stop＞raise_stop）で表示——R倍数・P&L・現在のラダーstop・日本語注記付き。JSON・markdown（通知用アラート素材）・DigestPageテーブル（色分けアクション、/positionsへリンク）の3面に出力。副産物：**孤児だったDigestTabをDailyページに実装**（どこからもimportされていなかった）。プロファイル定義のsection_orderには'positions'をrisks直前に自動挿入。失敗時は空セクションに縮退。
- **検証**: sandbox実機で/v1/digest/dailyがMSFT exit(+2.07R)・FTNT raise_stop(+4.70R, stop 128.87↑)を緊急度順で返却、hold/no_dataは非表示（C27でシグナル価格登録した方のFTNTはhold＝正しく除外）。markdownセクション・Digestタブのブラウザ実写確認。digestテスト11/11・ページ4/4・レッドライン192・golden 43。
- **次**: モバイル向け静的シグナルバッジ、またはポジションアラートのpush通知化（beat＋markdown配信）。

### C32 — 2026-07-08 モバイル向けアニメーション・シグナルバッジ（コミット aef4b9b）
- **変更**: 375pxでオーバーレイカードがローソク足を覆う問題（C30はモバイル非表示で回避＝情報喪失）を解消。`SignalBadges`——チャート上部の**通常フロー行**（何も覆わない）のコンパクトバッジ帯。カードと同じ配色・日本語タップ解説。ライブMarkets 360ページと静的PWAビューアの両方で使用、デスクトップはフルカード維持。モーションは意図設計：90msスタガーのスライドフェード入場（「エンジンが今語った」感）、緊急アクション（exit/sell_into_strength/active buy）は共有2秒パルスリング、**全て`prefers-reduced-motion`ガード付き**（モーション無しでも完全に読める）。raise_stopバッジはラダーの新stopをインライン表示（`Raise Stop @ 128.87`）。
- **検証**: FTNT実機375pxでブラウザ実写——初版はバンドストリップ左端に被り→**フロー行に置き直して再実写**（ストリップ・全バー可視を確認）。デスクトップはバッジ0個（カード不変）をPlaywrightでカウント検証。SignalBadgesテスト4/4・markets360+モーダル20/20・レッドライン181・golden 43・eslint緑。
- **次**: C33候補=ポジションアラートのpush通知化、またはRRG再生とバッジの統一モーション言語化（duration/easingトークン共有）。

### C33 — 2026-07-08 モーション語彙の統一（コミット 9c61828）
- **変更**: 4画面が同じ概念を4つの私的定義で実装していた（sellPulse/posPulse/badgeIn+badgePulse/インライン600ms・700msリテラル）→ `theme/motion.js`に単一語彙化：MOTION durations（fast160/enter360/tween600/pulse2000）＋easing 2種、`pulseRing()`・`enterSlideFade(order, pulseColor)`・`standardTransition()`・`PLAYBACK_FRAME_MS`。SignalBadges・SellPlanCard・Positionsアクションチップ＋R進捗バー・RRG再生（フレーム間隔＋ヘッドtween）が全てトークン消費——トークン1つ変えれば全画面が一緒に動く。
- **アクセシビリティ**: SellPlanCardとポジションチップは従来**無条件**でパルスしていた→全アニメーションを`prefers-reduced-motion`背後に移動。Playwrightの`reducedMotion: 'reduce'`エミュレーションで`animationName: none`を機械検証＋通常モーションのスクショでパルスリング健在を目視。
- **検証**: motionトークンテスト3（ガード・スタガー算術・合成をピン）、消費側スイート42/42、eslint緑。ビジュアル回帰なし（positions実写）。
- **次**: C34候補=ポジションアラートのpush通知化、または登録済みポジションのMarkets360チャートへのentry/stop水平線描画。

### C34 — 2026-07-08 自分のトレードをチャートに描画（コミット f169a3a）
- **変更**: 表示中の銘柄にオープンポジションがあれば、Markets 360チャートに**自分の建値と現在のラダーstop**を水平線描画——entry=青実線、stop=破線（元リスク未解消は赤、ラダー切り上げ後は緑＋↑）、両方軸ラベル付き。売りエンジンがstopを切り上げるたびに線が動く。`positionPriceLines()`は純関数、チャートは汎用`priceLines`プロップ（lightweight-charts createPriceLine、変更時に再生成）。同一銘柄に複数ポジション時は最新entryを描画（v1仕様）。
- **検証**: FTNT実機で「Entry 149.67」「Stop 134.70」の軸ラベル＋水平線を実写確認。positionLinesテスト4/4・markets360スイート23/23・eslint緑。
- **次**: C35候補=ポジションアラートのpush通知化、または複数ポジション線の重ね描き。

### C35 — 2026-07-08 ポジションアラートのpush通知化（コミット d019a50）
- **変更**: celery beatタスク`send_position_alerts`（平日、`POSITION_ALERT_HOUR/MINUTE`、デフォルト21:30=US close後）——digestのポジションセクション（=Positionsページと同一の売りエンジン）を評価し、**要アクションがある時だけ**`POSITION_ALERT_WEBHOOK_URL`へcompactなmarkdownをPOST。ペイロードはDiscord`content`とSlack`text`両キー同梱で1設定で両対応。URL未設定=no-op、要アクションなし=送信なし（日次ノイズゼロ）。`_build_positions_section`を単一の真実として再利用——アラート・ダイジェスト・Positionsページが食い違えない。
- **検証**: sandboxでローカルHTTPシンク相手にE2E——実DBの5ポジション評価→`{'status':'sent', actionable:2}`、受信メッセージにMSFT exit(+2.07R)とFTNT raise_stop(+4.70R, stop 128.87↑)＋日本語注記。beat登録とタスク登録をcelery_app importで機械検証。unit 3・digest 11・レッドライン193・golden 43。
- **次**: C36候補=同一銘柄複数ポジション線の重ね描き、または凍結中以外のバックログ再点検（SPEC優先表）。

### C36 — 2026-07-08 複数ポジション線の重ね描き（コミット de267b6）
- **変更**: C34は最新ポジションのみ描画→`symbolPositionLines()`が表示銘柄の**全オープンポジション**を古いentry順に積層、複数時は軸ラベルに#1/#2番号（ピラミッディングが一意に読める。単一時は無番号のまま）。stop線は個別に色分け——ラダー切り上げ済みは緑↑、新規建玉の初期stopは赤。
- **検証**: FTNT実機（2建玉）で4本全て実写確認——Entry #1 110.00／Stop #1 128.87 ↑（緑）／Entry #2 149.67／Stop #2 134.70（赤）。positionLines 5/5・markets360 24/24・eslint緑。
- **次**: SPECバックログ再点検（トレードライフサイクル可視化は完成——screen→buy→chart上のトレード→daily監視→アラート→close）。

### C37 — 2026-07-08 全スキャン結果チャートにMM360バンド＋VCP＋buy points（コミット 83f619f）
- **変更**: 新エンドポイント`GET /v1/technical/{symbol}/buy-context`（cache-only、ミス時`available:false`で絶対に500しない）——3本カラーバンド（per-bar履歴付き）・VCP箱・段階buy points・買いシグナル（3バレル内訳）を、**Markets 360タブと同一エンジン**で任意銘柄に供給。スキャン結果のChartViewerModalが全てをCandlestickChartへ（プリミティブは既存）：バンド帯・VCP破線箱・Alert/Buy Ptチップ・Buy Triggerピボット線。
- **検証**: 実スキャン（FTNT）でブラウザ実写——3帯・VCP箱・チップ・「Buy Trigger 149.67」全描画。serviceテスト3/3（形状・キャッシュミス縮退・ベンチマーク死亡耐性）、Scanスイート109/109、レッドライン184、golden 43。

### C38 — 2026-07-08 買い点灯条件チェックリスト＋グロッサリ拡充（コミット 7903812）
- **変更**: スキャンチャートビューアのサイドバー最上部に**買い点灯条件チェックリスト**——エンジン直結の3バレル（Trend=TPR緑／Pressure=圧力緑／Breakout=ピボット突破＋Buy Risk緑黄）＋ファンダ脚（Trend Template 8条件=必須、RS≥70=必須・90+理想、EPS≥80=推奨、Code 33=ボーナス・レア※実測7.1%に整合、ハードゲートにしない）。行毎に✓/×/—、点灯時はシグナル名＋トリガー価格をヘッダ表示、ルール自体を日本語で明記（「3バレル全点灯=Triple Barrel。VCP箱・Buy Ptチップ・Buy Trigger線が根拠の位置」）。全行タップで日本語解説（グロッサリに`trend_template`/`triple_barrel`/`code33`追加）。行は共有モーショントークンでスタガー入場。
- **検証**: 実スキャンFTNTで実写——エンジン実値どおりの表示（Pressure✓・TPR transition×・template fail・RS 62×）、Trend Templateタップで日本語ツールチップ。BuyChecklist 3/3・Scanスイート112/112・eslint緑。
- **次**: C39=英語表記グロッサリの残カバレッジ一斉点検（サイドバー各ラベル等）、静的ビューアへのチェックリスト展開。

### C39 — 2026-07-08 グロッサリ全面カバレッジ＋静的ビューアにチェックリスト（コミット 79a17fb）
- **変更**: スキャンサイドバーの英語ラベルはグロッサリ適用**ゼロ**だった→`MetricRow`に`term`プロップを追加し、解説のある全行を配線（スコア4種・RS 1M/3M/12M・Beta・β-adj RS・成長6種・バリュエーション5種・VCP Score/Pivot）。グロッサリに13エントリ新規追加（EPS Q/Q=CANSLIMのC・+25%合格ライン、P/E=Minerviniは高PERで却下しない、Inst Own=40-70%適正帯等）。静的PWAビューアにもライブと同一の買い点灯条件チェックリスト（静的ペイロードのbands+signalから供給——1コンポーネント2画面）。
- **検証**: ブラウザ実写——サイドバーEPS Q/Qホバーで日本語解説表示、適用済みラベルに点線下線。Scan+staticスイート161/161・eslint緑。
- **次**: SPECバックログ再点検（理論忠実度残項目）。

### C40 — 2026-07-08 ファンダ取得パイプライン検証＋stale配信フォールバック（コミット e5dd30c）※Opus 4.8で実施
- **検証（ユーザー依頼「ファンダ取得は問題ないか」）**: 探索エージェント＋ライブ実測でパイプライン全体を確認。①parse/compute/cache=ユニット69件green ②`store()→get_fundamentals`一気通貫=全フィールド往復OK（pe/epsQQ/salesQQ/roe/mcap）③空キャッシュ=クリーンに404縮退 ④`DataSourceService`構築OK（宣言済み`defusedxml`がsandboxのみ未インストール→pip install、requirements-server.txtには存在）→ネットワーク境界まで到達（sandboxは403で仕様通り）⑤ライブ取得の実体はCI `weekly-reference-data.yml`（本番アプリは週次GitHubバンドルをimportし通常ライブ取得しない）。
- **発見した実バグ→修正**: `get_fundamentals`のstale分岐が、DB行が古い（>7日）＋ライブ取得失敗（プロバイダ403/429/停止は日常）時に**使えるstale行を捨ててNone→404→パネル全「-」**。修正: 先にリフレッシュ試行→失敗時のみstale行を`is_stale:true`付きで配信。真のキャッシュミスは従来通りNone→404、明示`force_refresh`（週次タスク）も不変。
- **E2E実証**: FTNT行を30日前に古くしRedisキー削除、プロバイダ遮断下で`GET /v1/stocks/FTNT/fundamentals`——修正前404→修正後`is_stale=true`でpe=45.2/roe=0.34配信。回帰テスト3分岐（stale配信・fresh優先・真ミス）。fundamentals 52・レッドライン184・golden 43。
- **未修正で記録（別サイクル候補）**: ①US planの`alphavantage`ステップは未登録adapterで空no-op（第3段が死んでいる）②`_store_in_database`が部分ペイロードのNoneで既存カラムを上書きし得る。
- **次**: C41=Alpha Vantage未登録adapter（登録 or plan除去でWARNINGノイズ解消）、またはSPECバックログ再点検。

### C41 — 2026-07-08 Minerviniファンダ・カバレッジ監査＋決算日配線修正（コミット 9455153）
- **監査（ユーザー依頼「必要なファンダ指標は全て取得できているか」）**: 探索エージェント2本＋ライブ実測で「取得→保存→スコア消費」3段マップ作成→SPEC.mdに永続カバレッジ表を記録。**中核（EPS/売上/利益率/ROE/機関保有/EPS Rating）は取得+保存とも揃う**。ギャップ: ①Code 33がどのスキャナーも未消費（static/presetのみ、最大の残課題・EDGAR依存）②多数のファンダが保存済だが未スコア ③サプライズ/推定改定/margin加速は未取得（カタリスト系）。
- **発見→修正した実バグ**: `next_earnings_date`は yfinance が取得しCANSLIM近接ゲートが読むのに、`StockFundamental`に列が無く store→DB→read再構築で脱落→ゲートが常時no-op（W2.1「完了」扱いだが data plumbing 断線・**死んでいた**）。列追加（migration 0024）＋store/read 4箇所配線。日付欠落時は従来通り permissive（golden不変）。
- **E2E実証**: 実DBに3日後の決算日を投入→`get_fundamentals`往復でキー生存→CANSLIMゲートが`blackout=True (3d to report)`発火（修正前は到達せず）。配線回帰テスト2件＋既存ゲートテスト10件。レッドライン199・golden 43。
- **次**: C42候補=Code 33のライブ統合（EDGAR facts をscan時に参照 or scan_resultsに`code33`列を追加しCIバンドル経由で供給）——Minervini最重要ファンダの未統合を閉じる。要CI検証。

### C42 — 2026-07-08 Code 33のライブ統合（最重要ファンダギャップを閉じる）※2コミット
- **C42.1 配線（コミット 39c32aa）**: `code33`列を`stock_fundamentals`に追加（migration 0025）＋store/read 4箇所配線＋`build_buy_context`が cached fundamentals から surface＋`BuyChecklist`が`buyContext.code33`優先読み（scan行fallback）。null時は「—」（false negative無し）。E2E: `store(code33=True)`→get_fundamentals往復→buy-context `code33:true`→チェックリスト点灯。
- **C42.2 EDGAR計算（コミット 4bcc658）**: `refresh_code33_flags`タスク——EDGAR company factsで全US行のCode 33を計算し、**単一カラムの targeted update**（他ファンダを壊さない）＋Redis無効化。週次beat（土12:00、ファンダリフレッシュ後）。`FUNDAMENTALS_CODE33_ENABLED`でゲート（data.sec.gov必要＝CI/本番のみ、sandboxは不達）。
- **検証**: buy-context surfacing 3ケース＋store persistence＋BuyChecklist読み（フロント4/4）＋タスク3ケース（disabled/非US/stamp）。レッドライン189・golden 43。
- **残（C43候補）**: ①Code 33を**スキャナースコア/ランキングに統合**（現状はUIチェックリスト情報のみ、凍結metric影響を要測定）②保存済ファンダのスコア統合（年間EPS/売上/margin/ROE/EPS Rating）③Alpha Vantage未登録adapter ④`_store_in_database`部分ペイロード上書き。

### C43 — 2026-07-09 SEPAファンダボーナスをMinerviniスコアに統合（コミット 0364c62）※Fable 5復帰
- **設計（ユーザー指示「ミネルヴィニなら何を重視するかで判断」）**: 「テクニカルが最終審判」の原則を守り、**上限+10の純粋加点**として統合——Code 33 +4（本人最重要の決算加速シグナル、実測+4.0ppエッジ）／四半期EPS成長 ≥40% +2.5・≥25% +1.5（オニールのC）／売上確認 ≥25% +1.5・≥10% +0.5（EPSの裏付け）／ROE ≥17% +1（オニール/IBD品質床）／EPS Rating ≥80 +1（IBD買い最低ライン）。`passes_template`・Stage-2・setup検出は**不変**、欠損データは中立0（ペナルティ無し）、ボーナスはテンプレ通過者の**並び替え**にのみ働く（テンプレ不通過はスコア85でもBuyにならないことをE2Eで確認）。純関数`criteria/fundamental_bonus.py`、ROE単位正規化（finviz=%／旧yfinance=分数）。`needs_fundamentals=True`化——cache-onlyスキャンは`batch_only_fundamentals`でget_many読みのみ・ライブフォールバック無し（ミス=中立0）。
- **凍結metric安全性**: 908ハーネスは`StockData(fundamentals=None)`で構築→ボーナス恒等0。**フル再実行で全数値バイト一致**: TT 69.7 / S2 90.0 / SETUP 78.6 / FIRE±5 88.6 / MSCORE 95.5 / GATE 45.1、判別 SETUP +52.0pp / FIRE±5 +24.4pp。golden 43 passed床維持。レッドライン200 passed（唯一のfailは除外対象`test_mcp_market_copilot`のpre-existing、クリーンベースで再現確認済み）。
- **検証**: 新テスト14（tier境界・cap厳密10・欠損中立・ゴミ値中立・ROE分数正規化・スキャナー統合3種）。実DBのE2E: FTNT実キャッシュ行（code33=True他）→get_many→スキャナーで**76.83→85.83（+9.0）**、passes不変・stale-fallback配信（C40経路）も同時に実証。
- **残**: UIでボーナス内訳表示（details.full_analysis.fundamental_bonusに搭載済み・フロント未表示）、CANSLIMへの同思想適用は別論点。

### C44 — 2026-07-09 ファンダボーナス内訳をスキャンUIに表示（コミット 34addf8）
- **変更**: `fundamental_bonus`＋成分内訳を読み経路の全段に配線——orchestrator flatten → `scan_results.details` → `scan_result_repo`/`feature_store_repo`（スキーマ・パリティ）→ `ScanResultItem` → UIスナップショットbootstrap。チャートビューアのSCORESセクションに「Fnd Bonus +N / 10」行＋成分チップ（達成=緑+加点表示／未達=ミュート／欠損=非表示）、共有モーショントークンでスタガー入場、グロッサリに`fundamental_bonus`日本語エントリ（採点ルール明文）。
- **ハマりどころ（次回のため）**: スキャン結果ページのデータ源は`/v1/scans/{id}/results`ではなく**`/v1/scans/bootstrap`（発行済UIスナップショット）**。スナップショットは発行時点のシリアライズで凍結されるため、スキーマ追加後は`get_ui_snapshot_service().publish_scan_bootstrap(scan_id)`で再発行しないとUIに出ない（新規スキャンは自動で新スキーマ）。sandboxのvite/uvicornはコード編集後に必ず再起動（stale bytecode/module）。
- **検証**: ブラウザ実写3枚（1440px/ツールチップ/375px）——FTNTで+9.0/10、Code 33 +4・EPS Q/Q +2.5・Sales Q/Q +0.5・ROE +1が緑、EPS Ratがミュート、タップで日本語ツールチップ。バックエンドred-line 275 passed・golden 43床・Scanスイート116/116・eslint 0 errors。フロントテスト3件＋永続化テスト2件追加。
- **残**: 静的PWAビューア側への同表示展開（次のstatic-site.ymlラン後に自動でpayloadに載る——StaticChartViewerModalは同一Sidebarを使うため表示されるはずだが実ビルドで要確認）。

### C45 — 2026-07-09 SPEC真実化監査——バックログ4項目は実装済みだった（コミット docs）
- **監査**: SPECバックログ着手前のコード照合で、**旧バックログ1・2・5・6が全て実装済み**と判明——①FTD検出（day4-15・+1.2%・出来高増・failed-FTD circuit breaker、0047eb7）②分配日+5%失効＋ストーリングデイ（8372edd）③FTD後progressive exposureラダー 25→50→75%（e05577b）④Minervini市場ゲート（calculate_ratingのSEPAルール1）⑤Code 33統合（C43）。market_regimeテスト12件green。SPECの忠実度表2行（Market regime ⚠️→✅、Progressive exposure ❌→✅ stateless近似）とバックログを現実に同期。
- **教訓**: SPECの「既知の乖離」列はコミットに追随しない——**サイクル開始時はSPECを信じる前にコードをgrepする**（今回それで無駄な再実装を回避）。
- **残バックログ（真実）**: ①execution stateフォールバック＋全スキャンState Cap ②RPRのuniverse_performances配線 ③CANSLIM市場ゲート ④canslim誤命名修正 ⑤TPRストリップ（凍結）⑥静的ビルド確認 ⑦traction連動exposure（ポジション管理側）。

### C46 — 2026-07-09 O'Neilの「M」ゲート——CANSLIMは市場に逆らってBuyを出さない（コミット 32ebd74）
- **変更**: CANSLIMはC-A-N-S-L-Iを採点しながら**自分の「M」（市場方向）を無視**——確立した下降相場でもStrong Buyを印字できた。Minervini SEPAルール1ゲートを鏡映：取得済みベンチマークから`assess_market_regime`（FTD昇格込み）、`details.market_regime`/`market_uptrend`を露出、correction/downtrendではBuy/Strong Buy→**Watchにキャップ**。スコアはセットアップ計測のまま不変、regime不明（ベンチマーク無し/短い）は絶対にブロックしない（Minerviniゲートと同一のフォールバック意味論）。
- **検証**: 新ゲートテスト5件（純粋rating 3態様＋scan_stock配線2件、downtrend合成ベンチでrating≠Buy/market_uptrend=False）。凍結metricは構造的に無風（908ハーネスはMinervini+Markets360のみ実行）。レッドライン205 passed・golden 43床・CANSLIMスイート15/15。
- **次**: 残バックログ=①execution stateフォールバック＋全スキャンState Cap ②RPRのuniverse_performances配線 ③canslim誤命名修正。

### C47 — 2026-07-09 最終監査——execution stateフォールバック/RPRスキャン配線も実装済み（docsコミット）
- **監査**: C47候補a（execution stateフォールバック）は`scan_orchestrator._compute_execution_state`で**実装済み**（minervini詳細→m360詳細→価格データ直接計算の3段フォールバック、全スキャンでState Cap稼働、docstringに設計意図明記）。C47候補b（RPR universe配線）は**スキャン経路は実装済み**（markets360_scanner.py:108-110）、残るのは単銘柄タブ（service.py:110）のみでこれはスキャンユニバース不在という構造問題（feature storeからの供給設計が必要）。C47候補c（canslim誤命名）も**修正済みコメント**を確認。→SPECバックログを真実に全面同期。
- **ループ全体の到達点（C43-C47）**: Minerviniファンダ5項目のスコア統合（+10上限ボーナス）→UI内訳表示（チップ+日本語解説）→O'Neil Mゲート（CANSLIM市場キャップ）→SPEC/バックログの真実化。凍結metric全維持（908ハーネスはバイト一致、golden 43床、band right-edge 91%床）。
- **次セッションへ**: 残バックログはSPEC参照（単銘柄RPR設計／TPR凍結／静的ビルド確認／traction exposure／カタリスト系取得）。**開始前にコードをgrepしてSPECの乖離欄を検証すること**（C45/C47で2度、再実装の無駄を回避した教訓）。

### C48 — 2026-07-09 クローズ後~30分の高速価格配信（コミット ac7edfd）※ユーザー要望「市場が閉まってから30分以内に更新」
- **原因分析**: PWAの価格鮮度＝Pagesデプロイ時刻。従来は16:10 ETトリガー→フルビルド（スキャン/スナップショット再計算）~2時間→**クローズ2時間超後にやっと反映**。ボトルネックは価格取得ではなくスキャン再計算。チャート/バンド/買いシグナルは**エクスポート時に価格キャッシュから再計算**される構造なので、価格だけ先行更新する2段階配信が成立。
- **変更**: ①`export_static_site --prices-only`＝当日価格をバッチ取得→**発行済みfeature run（前日ランク）のまま再エクスポート**（スナップショット再構築なし。発行済run無しはexit 79でcombineがフォールバック）②`last_completed_trading_day(close_buffer_minutes=)`＝既定30分は全既存呼び出し不変、高速パスのみ5分バッファ（16:05に当日を「完了」扱い）③static-site.yml＝平日16:06 ET新スケジュール＋`prices_only` dispatch入力→高速モード、**専用concurrencyグループ**（16:10フルビルドに相殺されない）、IBD診断スキップ、daily-priceリリース資産も先行更新。
- **検証**: 新ユニット4件（16:04/16:06/16:31のバッファ境界・refresh配線・CLIガード）。sandbox E2E＝fixture feature run(13銘柄)発行→prices-onlyエクスポートで完全バンドル生成（scan chunks＋charts 13枚: bars/bands/VCP/signal）。レッドライン160・golden 43床。既存workflowテスト3失敗はC48以前からのpre-existing（main系多市場定義期待）とstashで確認。
- **注意**: スケジュールは**mainマージ後に発効**。初回実runで実測タイミング要確認（目標: 16:06起動→~16:30-35配信）。GitHub MCPは現在切断（要再認証）でCI dispatchはこのセッションから不可。

### C49 — 2026-07-09 PWAに「価格更新 M/D HH:MM」表示（コミット 599da28）
- **変更**: home payloadの`freshness.prices_generated_at`（エクスポート時刻＝価格反映時刻）を新設し、PWAホームの鮮度行の先頭に「価格更新 7/9 16:32」のように表示（閲覧者ロケール）。2段階配信で「価格は今日・ランクは前日スキャン」という分離が見えるように。旧バンドル（フィールド無し）は従来表示のまま。
- **検証**: StaticHomePageテスト9/9（新2件: ラベル表示＋旧バンドル後方互換）、staticスイート全green、eslint 0 errors。

### C50 — 2026-07-10 feature-runバンドル——高速価格配信をCIの新品DBで成立させる（コミット 3e7ede5）
- **発見したギャップ**: `--prices-only`は「発行済みfeature run」への再エクスポートだが、CIジョブのDBは毎回新品＝runが存在せず、16:06高速ジョブはexit 79→combineフォールバック→**前日サイトの再発行になるだけ**だった（C48時点の見落とし）。
- **変更**: ①`build_feature_run_bundle.py`＝フルビルドが発行済みrun（メタ+全StockFeatureDaily行+pointer key）をgzipで`daily-price-data`リリースへ ②`import_feature_run_bundle.py`＝高速ジョブが新品DBへseed（冪等・manifest未発行時は既存exit79へ縮退）③static-site.ymlに条件付きseed/uploadステップ（uploadはcontinue-on-errorで夜間発行を絶対に塞がない）。
- **検証**: sandbox往復E2E（実Postgres run→feature store全消去→import→prices-onlyエクスポートで完全USバンドル再生成）＋新ユニット2件（新品DB往復・冪等性）。レッドライン164・golden 43床。
- **運用メモ**: PR #48マージ済（main 00b9c90）→当日フルビルドをdispatch（run 29067612109）。**C50はブランチ上——mainへマージされるまで16:06高速ランは無害なフォールバック動作**。

### C51 — 2026-07-10 市場レジームバナーを静的PWAに搭載——UI統一の第一歩（コミット 39918b4）
- **調査結論（ユーザー要望①「なぜUIが違う」）**: スキャン結果テーブルとフィルタは**既にPC版と同一コンポーネント**（StaticScanPageがResultsTable/FilterPanelをimport済み）、チャートモーダルも共有済み。真の乖離は①シェル/ナビ ②ホーム画面 ③**市場レジームバー不在**（ミネルヴィニ・ルール1の文脈がスマホに無い）だった。
- **変更**: PC版の`MarketRegimeBanner`（レジームchip・Health 0-100・推奨エクスポージャー・分配日数・FTD経過）を静的スキャンページ（フィルタ上、未フィルタ行から供給＝0件でも市場文脈が残る）と静的ホーム（鮮度行直下）へそのまま搭載。レジーム項目は全エクスポート行に既に載っており**純粋なコンポーネント再利用**（新規データ配線ゼロ）。
- **検証**: 375px実写2枚——両タブで「Market [Correction] Health 54/100 · Suggested exposure 20% · 7 distribution days」がPC版と同一描画。staticスイート52/52・eslint 0 errors。
- **運用**: PR #49（C50）はCI green→mainへマージ済（c433bff）。**本日16:06 ETの定時ランが高速価格配信の初回実測**になる。

### C52 — 2026-07-10 UIアニメーション/グラフィック強化（コミット 5744669, cf45f28）※ユーザー依頼
- **変更①（バナー）**: 市場レジームバナー（PC/スマホ共有）をテキストからグラフィックへ——Healthメーター（0-100、マウント時にtweenでスイープ・赤/琥珀/緑の水準色）／エクスポージャー階段（4段が下からスタガー点灯＝pilot→full のスケールイン思想）／レジームchipに決定的局面（confirmed_uptrend/downtrend）のみ呼吸パルス／分配日chipは件数でエスカレート（≥4警告・≥6エラー）。数値ラベルは不変が第一・全モーションはprefers-reduced-motionガード内。既存6テスト無改変でpass＋新3テスト（メーター/階段点灯数/chip色）。
- **変更②（ホームカード）**: キー指数カード（SPY/QQQ…）に共有enterSlideFadeスタガー入場＋hover 2px浮上（fastトークン、hover対応端末のみ）。
- **検証**: 375px実写で2状態（correction=琥珀54%・1/4段・赤分配7日chip／confirmed_uptrend=緑89%・3/4段・FTDチップ・ミュート2日chip）を確認。関連スイート177/177・eslint 0 errors。

### C53-C55 — 2026-07-10 弱点監査＋戦術バックテスト＋レジーム修正（コミット 4257e16, 5bf508e）※ユーザー依頼「弱点を直視し、戦術としてバックテストせよ」
- **C53 監査**: `docs/WEAKNESSES.md`新設——S級=戦術未証明（ポートフォリオバックテスト不在/precision不明/ベア未検証）、A級=データ構造欠陥（生存バイアス/point-in-timeファンダ不能/単一ベンダー/日足のみ）、B級=較正の甘さ（VCP recall35%/TPR58%/SMA200未較正）を数値つきで明文化。
- **C54 バックテスト**: 新エンジン`backtest_minervini_tactics.py`——本人式の完全執行（テンプレ+RS percentile+実VCPDetector/タイトベース、ピボット事前アーミング+早期ポストブレイク、1.25%リスク・ラダー・50DMA割れ、SPYレジームゲート、翌日寄付き+10bps）。**初回実測（2025-07〜2026-07・3,340銘柄）: フル戦術+7.7%（PF1.47・平均R+0.32・maxDD−10.1%）vs SPY+19.5% vs ゲート無し−7.4%**＝市場ゲート寄与+15.1ppを定量化。単年上昇相場ではB&Hに勝てず——複数年（2022ベア込み）検証がC56。**副産物: 執行不能ファネル発見**（テンプレ+RS+VCP確定時点で98.6%がピボット突破済→クロス待ちは年2約定）。
- **C55 レジーム修正（本体）**: SPY高値3%以内の日を124日「correction=20%」判定していた旧マッピングを修正——分配積み上がり×トレンド無傷=Under Pressure、correctionは価格実損傷（50日線喪失）が必要（IBD定義）。**凍結metric: 他全て不変、GATE 45.1→66.5・判別+25.4→+42.8pp**（SPEC改訂として記録）。レジームテスト14（新2）・red-line 207・golden 43。
- **次（C56）**: CIで5年超バンドル構築→2022ベア込み再実行（戦術の本命検証）。トレード分布分析。レジーム追加較正は長期窓まで凍結。

### 環境メモ（復元用）
- ブランチ: `claude/minerva-market-360-rebuild-toy2fa`（PR #48 OPEN、#47はMERGED）
- sandbox: yfinance/stooq 403（プロキシ回避は禁止）。GitHub raw 200。celery/httpx未インストール→一部テストはcollection error（既知・環境要因）。
- テスト実行: `cd backend && DATABASE_URL="postgresql://local/none" python3 -m pytest ...`
- フロント: NVM で Node 22 (`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`)
- 908バンドル: CI `backtest.yml` を `build_bundle=true` でdispatch → `backend/calibration/trade_idea_windows/` にコミットされる（完了後 `git pull`）
- 既知のpre-existing failure: backend 37件（main由来）、golden配下 `test_mcp_market_copilot.py` はcelery未導入でcollection error

### C56 — 2026-07-11 6年バックテスト——2022ベア込みで戦術の本命検証（コミット 16a66cb, 969ea3e, 878e3f0, ec33953／PR #53）
- **基盤**: 新workflow `backtest-tactics.yml`＝CI（Yahoo egress唯一の場所）で6年バンドル構築（`us_universe_full.txt` 2,074銘柄・≥$2B・ETF除外＋SPY）→`daily-price-data`リリースへ保存（`backtest-price-us-6y.json.gz`、オフライン再実行用）→戦術バックテスト実行→ジョブサマリへ레포트。新スクリプト`build_backtest_price_bundle.py`（BulkDataFetcher・gzipバンドルv1）。
- **CIデバッグ3連**（教訓）: ①バンドルスクリプトは`backend/scripts/`＝`PYTHONPATH=. python scripts/...`で起動（app.scripts ではない）②settings検証で`DATABASE_URL`必須③`prepare_runtime`は起動時に実DB接続する→postgres:16-alpineサービスコンテナが必要。**新workflowはmainに載るまでdispatch API不可**（PR #53を先にマージしてから任意refをdispatch）。run 29131626082が24分で成功。
- **結果（5年: 2021-07〜2026-07、パネル1,967銘柄×1,506日）**: フル戦術**+53.9%**（CAGR 9.1%・maxDD **−13.9%**・PF **1.67**・135取引・投資比率59%）vs ゲート無し+33.9%（maxDD −25.2%）vs SPY B&H +83.6%（maxDD −24.5%）vs SPY×レジーム+40.4%（maxDD −6.9%・Sharpe 1.03）。
- **検証された主張**: ①**2022ベア防御=+2.7% vs SPY −18.2%（+20.9pp）**——「大きく負けない」を5年窓で実証 ②maxDDほぼ半減 ③損小利大の型維持（PF1.67・勝率34.8%で利益超過）④銘柄選択アルファ+13.5pp（vs SPY×レジーム）。**誠実な敗北**: 総リターンはSPY B&Hに−29.7pp劣後——主犯は2025年（戦術−4.2% vs SPY +17.7%）と平均投資比率59%の機会費用。
- **重要な切り分け（年次表から）**: 2025年はゲート無しも−4.4%・SPY×レジームは+11.7%→**2025年の敗因はレジームではなく銘柄選択/執行**。次ループ=2025年トレードの層別診断（early vs armed・保有期間・月別）。詳細: `docs/BACKTEST_C54.md`（C56節）。

### C57 — 2026-07-11 高速価格配信の実測→チャート関連銘柄のみ更新で~52分短縮（コミット a7de637）
- **実測（初回本番16:06 ETラン）**: クローズ後2時間40分で配信——内訳=GitHubスケジューラ遅延69分（制御不能・観測30-89分）＋パイプライン84分。パイプラインの支配項は**全9,872銘柄の価格更新52分**だが、静的サイトのチャート/バンド/シグナルに実際に使われるのは発行済みfeature runの上位銘柄のみ。
- **変更**: `--prices-only`パスに`_chart_relevant_symbols(market, limit=1200)`＝FeatureRunPointer→StockFeatureDailyのcomposite_score上位1,200銘柄だけを`_refresh_static_daily_prices(symbols=...)`で更新（refresh service に`symbols`オーバーライド追加）。フルビルド経路は全銘柄更新のまま不変。パイプライン予測84分→~30-40分。
- **検証**: `test_prices_only_export.py` 4件（subset配線・buffer境界・CLIガード）green。**次の平日16:06ランで2回目実測**（スケジューラ遅延は残るため、根本対策候補=cron多重登録 or 外部トリガーは次候補に記録）。

### C58 — 2026-07-11 バックテスト信頼性の全面監査＋製品チェックリスト忠実再現（コミット 358df1d, 6028bd8, 4628e31, 07cf293, 0f7edb7）※ユーザー指示「VCP限定でなく、画面の条件を満たすものを買った前提で。カラーバンドも重要」
- **致命的発見①（非決定性）**: C56の「+53.9%」は無効——候補銘柄をsetから作っていたためハッシュランダム化で10銘柄枠の埋まり方が実行毎に変動、同一データで+53.9%/+24.3%の乖離を実証。RS降順（リーダー優先）に固定し、シード2種で経済的同一を確認。pending_sellsもsort（bitwise再現）。**教訓: ポートフォリオシミュは「集計が一致」でも信用するな、トレード集合で照合しろ**。
- **致命的発見②（armedレーン死亡）**: 毎日のウォッチリスト上書きで買い逆指値が構造的に発火不能→全エントリーがearly（1-2日遅れ・最大+5%高買い）だった。交差判定を前日プランに対して行うよう修正——armedが全体の~7割に復活。
- **製品ファネル新設**（--funnel product）: 出荷済み`minervini_bands`のウォークフォワード履歴（TPR緑∧圧力緑ゲート・Buy Risk緑/黄）＋`_breakout_now`同等のピボット（VCP→30日もみ合い高値）とフレッシュ交差条件で、スマホ画面のBuy Signalチェックリストを機械再現。バンド全銘柄計算は7分（history_bars拡張で1コール/銘柄）。初回近似はフレッシュ交差を省き緩すぎた（WL131銘柄/日・2022年−14.1%）→修正。
- **最終結果（決定的・5年）**: 製品再現+49.1%（maxDD−23.7・PF1.60）／legacy+36.8%（maxDD−15.8・2022年−2.9%）vs SPY+83.6%（−24.5）／SPY×レジーム+40.4%（−6.9・Sharpe1.03）。ゲート無し製品は−11.6%（ゲート寄与+60.7pp）。**層別の宝**: VCP由来トレードPF6.10（n=17・利益の73%）vs タイトベースPF1.12、armedは本物ピボットでのみ機能（製品1.65 vs legacy疑似ピボット0.93）。
- **誠実な結論**: この強気5年窓ではどの構成もSPY買い持ちに勝てず（機会費用+生存バイアス考慮で現実はさらに悪い）。型（損小利大・ベア生存・ゲート必須）は実証、「指数を大きく上回る」は未実証。詳細: docs/BACKTEST_C54.md全面改訂。
- **次**: VCP検出器recall向上が最大レバー（PF6.10の源泉を増やす）。GitHub MCP切断中のためPR作成は再認証待ち（ブランチpush済み）。

### C59 — 2026-07-11 VCP時系列反転バグ修正で戦術がSPY超え＋recall調査（コミット 0a12190, docs）
- **致命的発見③（時系列反転）**: `detect_vcp`は最新日先頭の系列を期待（`vcp_footprint.py`が`iloc[::-1]`で反転して呼ぶのが正）だが、**バックテストは時系列順のまま渡していた**＝全ランのVCP検出が時間反転チャート上だった。修正でVCP由来トレード17→115件（79%）。
- **最終結果（全修正後・決定的）**: legacyファネル**+89.0%・CAGR 13.7%・maxDD −13.9%・Sharpe 0.87・PF 2.02**——**SPY買い持ち(+83.6%/−24.5%/0.80)を初めてリターン・リスク両面で上回った**。2022年ベア−4.0%。ゲート寄与+81.2pp。製品チェックリスト再現は+45.4%（圧力バンド緑ゲートが静かなベースを弾く構造問題——製品への示唆: バンドはシグナル日確認に限定すべき）。全て独立正当化されるバグ修正のみでパラメータ調整ゼロ。次の懐疑テスト=別窓（2016-2021）追試。
- **recall調査（変更見送り）**: 908ウィンドウでオフライン計測を確立（36.1%、CI実測と一致＝egress不要化）。見逃しの81%=深さ逐次収縮ゲート。「最終収縮最タイト」union仮説はrecall+2.8pp/判別+0.8ppに留まり、FIRE±5/golden連動を考え**見送り**（フィッティング禁止の規律）。プローブ: scratchpad/vcp_rule_probe.py（PROGRESS用に記録）。
- **エグジット経路分析（C59補遺・legacy v3全146トレード）**: ①≥+3Rの20トレードが純益の**152%**を稼ぐ（他は合計マイナス）＝戦術の本質はテール捕獲であり、少数の大勝ちを逃すと結果が崩れる（非決定性バグで結果が数十pp振れた理由の構造説明）。②ストップ退出93件中25件は建値以上で退出＝トレーリングラダーが機能。③50DMA大商い売りはPF1.42と地味だが健全。④期末未決済3件で+$43.8k（ランナー保持の価値）。

### C60 — 2026-07-11 懐疑テスト：+89%は一般化せず（コミット 9a4a9b3）
- 10年バンドル（CIビルド→リリースDL）で2017-07〜2026-07の9年窓を実行。**フル戦術+78.2%（CAGR 6.7%）vs SPY+251.8%（CAGR 15.1%）**。5年窓の+89%は窓依存だった——PDCAの規律（別窓追試）が誇大な結論を止めた。
- 確定した型: ベア防御は両窓で本物（2022 −3.6%）。**構造欠陥も確定: 強い上昇年（2019/2021/2023/2025）で一貫して取り残される**。2021年はゲート無し+68.4% vs ゲート有り−3.7%＝レジームの過剰防御が1年で~72pp奪った。SPY×レジームも+92% vs +251.8%——タイミング層が守り（maxDD−9.6%・Sharpe1.01）の対価として9年~160pp支払う。
- 次（C61）: 強気相場でのエクスポージャー回復速度が本命レバー。①progressive risk（confirmed uptrendで1.25→2.5%）②分配日失効/リセットのIBD照合（GATE凍結metric直結＝908ハーネス必須）。**両窓一貫改善のみ採用**。

### C61 — 2026-07-11 progressive risk採用（コミット 5382eb4, docs）
- `--progressive-risk`＝confirmed_uptrend時のみ口座リスク1.25→2.5%（本人のprogressive exposureのサイジング適用。他レジームは据え置き）。**両窓で一貫改善→採用**: 6y窓 +89.0→**+112.4%**（CAGR16.4・Sharpe0.87→0.92・PF2.22・maxDD−14.3ほぼ不変・2022 −1.6%）／10y窓 +78.2→**+97.8%**（CAGR7.9・Sharpe0.50→0.53・maxDD−27.9）。リスク倍増でもDDが増えない＝「確認後にのみ踏み込む」設計の実証。
- **残る本命課題**: それでも9年窓はSPY+251.8%に大差——2019 −4.9/2021 −8.8の「強気年の過剰防御」はサイジングでは埋まらない。次=**分配日カウントの失効/リセットのIBD照合**（本体market_regime.py＝GATE凍結metric直結、908ハーネス+両窓バックテストの二重検証で）。

### C62 — 2026-07-12 分配日閾値4→5の実験：不採用・revert（コミット 6cfdb34→f7cee13）
- 診断: 2021年under pressure判定182日（55%キャップ）が新規買いを塞ぎテール銘柄を逸失（C60）。ストーリングは無関係（年4件）——クラシック分配だけで2021年189/252日がカウント≥4。SPY ETF出来高はIBDの取引所出来高より熱い（代理変数の既知限界として記録）。
- 実験: IBD公開ドクトリン「5〜6本で相場が変わる」に合わせDIST_UNDER_PRESSURE 4→5。**凍結metricは無傷**（908ハーネス全値バイト一致・golden 43床・regimeユニット18）だが、**6y窓が+112.4%→+54.4%（Sharpe 0.92→0.56）と大幅悪化**→事前登録基準（両窓一貫改善）で不合格・即revert（10y窓は打ち切り）。
- 教訓: 過剰防御は閾値の一点物ではない——緩めると圧力局面のエントリーが増え2025年型の負けが膨張。本丸は**under pressure中の新規買い意味論**（本人は「選別を厳しくする」のであって「買いを止める」のではない）。次候補: バックテスト側で「under pressure時はRS床90に引き上げ×キャップ緩和」の選別強化×露出維持仮説。

### C63 — 2026-07-12 「選別強化×露出維持」仮説：不採用（フラグは残置・既定OFF）
- 仮説: under pressure中はRS90+リーダーのみ・フル露出で買う（「圧力下は選別を厳しくするのであって買いを止めない」）。
- 結果: 6y窓 +112.4%→**+20.3%**（Sharpe 0.28・2022年−13.7%＝ベア防御崩壊）→初窓で即棄却（10y打ち切り）。
- **C62/C63を通じた科学的結論**: under pressure日には本物の悪化前兆が相当量含まれ、閾値緩和も選別付き解禁も**ベア防御と引き換え**になる。現行C61構成（レジーム維持×progressive risk）は単純レバー群の**局所最適**。強気年の取り分を増やすには情報量のある切り口（分配集中度×ブレッドス等）の設計が必要——安易な緩和は全て棄却された。

### C64 — 2026-07-12 ブレッドス確認付きキャップ解除：不採用（フラグ残置・既定OFF）
- 仮説: under pressure中でもユニバースの200日線超え比率≥60%（健全な過半参加）ならキャップ解除——2021型ノイズと2022型悪化を市場内部指標で区別。
- 結果: 6y窓 +112.4%→**+46.7%**（Sharpe 0.48・2022 −7.5%・2025 −10.7%）→初窓で棄却（10y打ち切り）。
- **C62/C63/C64三連の最終結論**: この執行モデル（10枠・テール集中）では、**圧力局面のエントリー追加はどう条件付けても改悪**。増えたエントリーが枠と資金を占有し、テール銘柄の取り分を希釈する——「under pressureキャップは荷重支持構造」。このレバーは**закрыть（closed）**。強気年の改善は別経路（検出器recall向上・エグジット側）でしか実現しない。

### C65 — 2026-07-12 検証済みprogressive riskを製品に搭載（コミット b010c5c）
- `risk.py`に`account_risk_pct_for_regime`＝confirmed_uptrendのみ口座リスク1.25→2.5%（C61で両窓検証済み・C62-64の代替案は全棄却という証拠に基づく出荷）。markets360スキャナのrisk planが同関数でサイズ提案をスケール、`account_risk_pct`をplanに明示。
- 検証: リスク11・m360スキャナ7・golden 43床・regime系18全green。テンプレ/セットアップ判定は不変（凍結metric構造的に無風）。UI側はposition_size_pctが自動で反映（表示強化は次候補）。

### C66 — 2026-07-12 correctionでは買わない仮説：不採用（ユーザー提案・フラグ残置）
- 仮説（ユーザー）: market correctionは現金・FTD確認まで買わない（correction露出20→0）。confirmed/under-pressureは従来どおり。ミネルヴィニ「押し目はFTDを待つ」に忠実、C62-64（キャップ緩和）とは逆の厳格化。
- 結果: **6y窓 +112.4→+117.1%（全指標改善・maxDD−13.3）だが、10y窓 +97.8→+58.2%（CAGR5.2・maxDD−27.9→−35.6悪化・Sharpe0.38）**→窓間で真逆・不採用。
- **診断（重要）**: 6y窓（2021-26）は深いcorrectionが乏しく、残余20%露出は悪トレードを拾うだけ→切ると改善。だが**10y窓（2018Q4・2020コロナ・2022を含む）ではV字回復の初動を残余20%が捉えており、切ると①初動を逃す②FTD時点に2xリスク(progressive)で集中エントリー→フラジャイルな底で被弾が増えmaxDD悪化**。つまり**出荷済みの20% correction露出は長期サイクルで有用な仕事をしている**。単窓の改善は窓アーティファクト——二窓規律がまた誇大結論を止めた。
- **累積結論**: 圧力/correction露出ラダーは、緩和（C62-64）も特定の厳格化（C66）も全てアウトオブサンプルで棄却＝**出荷済みマッピングはよく較正されている**。強気年の改善レバーはレジーム露出ではなく、検出器recall/エグジット側に残る。

### C67 — 2026-07-12 クライマックス売り（sell into strength）配線＝窓間で不一致（ユーザー指示: 全メカニクス反映）
- 資料: 2022 TraderLion会議PDF（traderCharlieM・128p）全精読＋SEPA公開ドキュメント。外部リンク4件はプロキシ403（環境ポリシー・回避禁止）。網羅表 `docs/MINERVINI_MECHANICS_COVERAGE.md` 新設（買い/売り/タイミング/資金の34機構×実装状況）。最大の反映漏れ＝**D2クライマックス売り**（出荷済み`detect_climax_run`をバックテストが未使用）。
- 検証（全株クライマックス売り）: **6y +112.4→+82.6%（総リターン−30pp・Sharpe0.92→0.87、ただしmaxDD−14.3→−12.0改善）／10y +97.8→+132.7%（全指標改善・maxDD−22.2・Sharpe0.68）**→**窓間で真逆・採用不可**。
- 診断: クライマックス売り22件の平均R+3.01＝大勝ち。6y窓では+8〜11Rのモンスター（MU/LASR）の尾を+3Rで刈り総リターン減（C59のテール依存を実証）。10y窓では2018/2020/2022の天井で戻り回避が効いた。**全株売りが尾を殺すのが問題**。
- 精緻化（C68・実行中）: ミネルヴィニ本来の**部分利確**（半分クライマックス売り・残りラダー）で両窓改善を狙う。

### C68 — 2026-07-12 部分利確（半分クライマックス売り・残りラダー）＝リスク調整改善・生リターンは窓依存
- 結果（progressive risk基準）: **6y +112.4→+90.9%（生リターン−21pp・maxDD−14.3→−12.0改善・Sharpe0.92同値）／10y +97.8→+121.1%（生リターン+23pp・maxDD−27.9→−23.0・Sharpe0.53→0.66改善）**。
- 判定: **生リターンは窓で割れる（6y減/10y増）が、maxDDは両窓改善・Sharpeは両窓で同値以上**＝リスク調整後は一貫改善。全株売り(C67)より明確に優れる（尾を半分残すため）。ミネルヴィニの実際の「強さに一部売る」に最も忠実。
- **性質**: 純粋なリターン増ではなく「生リターン↔ドローダウン/一貫性」の目的トレードオフ。事前登録の採用基準（両窓の生リターン一貫改善）は満たさないため**自動採用せず、ユーザー判断に付す**。フラグ（--sell-into-strength --climax-partial）は残置・既定OFF。
- 次: ユーザーがリスクトーン版を望めば製品搭載（compute_sell_plan既存のsell_into_strengthをSellPlanCardで前面化）。望まなければ現行C61構成維持。いずれにせよVCP recall（B1・最大レバー）が次の本命。

### C69 — 2026-07-13 ミネルヴィニ実弾ミラー・バックテスト（ユーザー動画＝908地上真実と確認）
- ユーザー動画（Notion「Minervini's Historical Buys」スクロール録画）をffmpeg（imageio-ffmpeg・pip）でフレーム化・ビジョン読取→サンプル20行が`minervini_trade_ideas.csv`と**20/20完全一致**＝**動画は既存908ハーネスそのもの**（再抽出不要）。
- 新規`scripts/backtest_minervini_picks.py`＝本人の実弾を翌寄付き買い→出荷済み売りルール管理（638/908ウィンドウ・1997-2022・632トレード）。**勝率40%・平均+0.66R・PF2.10・+4.4%/トレード（34日）**。素朴保有ベンチ: 252日+13.3%/勝率60%＝**選択アルファ実在**。テール: ≥3R 90件（14%）が利益の133%（AG+21.9R/NTLA+18.8R/PTON+18.6R…）＝**勝者を切るな再確認**（C67/68のクライマックス自動売り不採用を補強）。
- 年次: 強2016+2.73/2017+1.45/2020+1.08、弱**2021−0.23（勝率20%）**＝本人でも2021は困難＝我々のC60-64過剰防御議論の背景。詳細: docs/MINERVINI_PICKS_MIRROR.md。
- 発展含意: スクリーン基準（RS/テンプレ/VCP）が正しい銘柄を狙う裏付け。売りはタイトすぎる可能性（本人銘柄は252日で伸びる）→exit leash検証は将来候補。

### C70 — 2026-07-13 VCP recall向上のブレークスルー（記事「Studying Historical Winners」由来）
- ユーザー提供PDF（Substack記事・先にリンク403だったもの）を副エージェント精読。核心: 本人のタイトさ定義は**「10/20日線に沿った複数のタイトな日」**＋ベース**2週-2ヶ月**＋**「volatility contracting」**（厳密単調ではない）＋前提**「double off lows」**。現行検出器の律速（単調減少ゲート・見逃し81%）とは別物。
- 実装＋測定: `scripts/measure_ma_tight_recall.py`（908オフライン・entry vs T0-63 control）。**VCP∪MA-tight で recall 36.1→63.8%（+27.7pp）・判別 +20.1→+26.3pp（改善）**。事前上昇フィルタが精度保持（no-priorはcontrol過発火で判別劣化）。C59のパラメータ微調整+2.8ppとは桁違い＝ベース型の取りこぼし（フラットベース/base-on-base）をMA-huggingで捕捉。
- **凍結契約への含意で一旦停止**: `detect_vcp`/`compute_vcp_footprint`へのOR配線はSETUP(78.6)/FIRE±5(88.6)/GATE(66.5)/golden(43)を再ベースライン化する重い変更。測定は可逆（shipped無変更）。**次段=①統合プロトタイプで908ハーネス全再測→②低下ゼロならgolden-update＋両窓バックテストで検出増の質確認→③採用**。goldenの再凍結は検証契約の再定義のためユーザーgo待ち。

### C70（完了・採用）— MA-tightnessベース経路統合でVCP footprint recall向上（コミット済み）
- ユーザーgo（「進めていい」）。記事準拠のMA-tight経路を`compute_vcp_footprint`にOR配線（VCPDetector本体は無変更＝goldenのVCPスナップショット不変）。事前上昇は記事の実数**2.0x「double off lows」**（1.5xだと判別−1.1pp→2.0xで−0.3pp・control発火半減。フィッティングでなく原典準拠）。
- **決定的908ハーネス**: FIRE±5 **88.6→91.2（+2.6pp）**・判別+24.4→+24.1pp（575-588標本で1標本≈0.17pp＝ノイズ内）・**TT/S2/SETUP/RS70/MSCORE/GATEバイト一致**・golden gate-5 **43 passed不変**。純粋な検出改善として採用。ユニットテスト+1（ma_tight経路ピン留め・11 passed）。
- **含意**: 製品のFIRE±5シグナル/スキャナ setup検出が本人の実セットアップをより多く捕捉（フラットベース/base-on-base）。最新ライブ保有（`docs/MINERVINI_LIVE_HOLDINGS.md`）も記録。
- 次（C71）: 戦術バックテストのウォッチリスト構築（`detect_vcp`直呼び）にも同MA-tight経路を配線し、両窓で「検出増→トレード質同等以上」を検証。製品コミットはPR化。

### C71 — 2026-07-13 MA-tight経路を戦術バックテストにも配線＝窓間不一致でデフォルト不採用（フラグ残置）
- C70の製品採用（検出/アドバイザリ）に続き、同経路を戦術ウォッチリスト（`--ma-tight`）に配線し**自動売買**での効果を両窓検証。
- 結果（progressive risk基準 6y +112.4%/10y +97.8%）: **6y +64.3%（−48pp・maxDD−20.9・2025 −13.5%）／10y +156.4%（+58.6pp・maxDD−23.9・2020 +31.4%）**→窓間で真逆・**デフォルト不採用**（クライマックス実験と同型）。
- **重要な区別（この一連の核心）**: recall向上は**人間トレーダーへの表示（C70・採用）**には価値があるが、**全検出を機械的に自動売買（C71）**すると10枠×テール依存の下で「エントリー増≠好成績」——低質フラットベースが高PFのVCP枠を希釈。製品のFIRE±5 recall改善（88.6→91.2）は維持、バックテスト自動執行のデフォルトはC61据置。フラグは検証用に残置（既定OFF）。

### C72 — 2026-07-13 品質ランク枠割当（設計原則の実装）＝MA-tight併用は窓依存を解消せず
- 原則（ユーザー指示）: recallで候補プールを広げ、限られた10枠は最良セットアップ（VCP PF2.13優先→RS）で埋める＝ミネルヴィニ「セットアップが資金より多い時は最良を選べ」。`--quality-rank`実装。
- C72（--ma-tight --quality-rank）: **6y +52.5%（基準+112.4%・C71 +64.3%を下回る）／10y +181.1%**→品質順序でもMA-tight併用は6y窓を救えず・窓依存継続。
- **知見**: MA-tight候補は枠順序に関わらず6y窓の自動売買で不利＝recall（発見）は**人間の表示（C70製品採用）**に価値、機械的自動売買には翻訳されない。設計原則を別角度で実証。
- 続行中（C72b）: MA-tightを足さず**既存プール（VCP+タイトベース）を品質ランク**する純粋テスト（VCP優先がタイトベースを上回るか）。結果次第で「最良を買う」原則の成績寄与を確定。

### C72b — 2026-07-13 品質ランク単独＝設計原則が成績に翻訳（両窓で生リターン基準以上）
- MA-tightを足さず**既存プール（VCP+タイトベース）をVCP優先で枠割当**（`--quality-rank`のみ）: **6y +113.2%（基準+112.4%≈同値・Sharpe0.90）／10y +115.1%（基準+97.8%・+17.3pp・Sharpe0.59・PF1.76）**。両窓とも生リターン基準以上＝「最良を買う」が長期窓で+17pp寄与。
- **設計原則の確定（docs/DESIGN_PRINCIPLE_SELECTION.md）**: ①recall（発見）は人間の表示に効く・機械的自動売買には翻訳されない（C70採用/C71-72不採用）②既存プールの品質ランク（VCP優先）は生リターンに寄与（C72b・長期+17pp）③現行ファネルは既に原則を大部分体現（VCP支配ゆえ改善は小さめ）。
- **製品への翻訳**: スキャン結果を「セットアップ品質」でランク（VCP検出＞タイトベース、同格内composite降順）＝原則のUI実装。次候補=スキャン結果ソートの品質ランク化＋exit leash検証。

### C73 — 2026-07-14 908再現性の直接計測＋exit leash両窓検証（不採用）
- **問い1「以前の908は出荷済みエンジンで当時買えたか」**（`scripts/reproduce_908_buys.py`・[-15,+5]窓・オフライン）: setup **detected 73.1%** / 機械的 **buy_trigger 33.4%**（pivot上抜け+≥1.4x出来高+テンプレ健全）。参考: 凍結FIRE±5=91.2%。**発見はほぼ再現・機械執行は1/3のみ**＝73→33ギャップが設計原則（発見≠執行）の独立裏づけ。docs/MINERVINI_908_REPRODUCIBILITY.md。
- **問い2「売り助言はタイトすぎるか」**: 908ミラー診断（`exit_leash_diagnostic.py`）で拘束条件は「50DMA1日割れ」の即時退出と判明（ロック期トレイル緩和ma65は無効）。confirm（50DMA下2日連続）は単窓ミラーで期待値4.51→4.79%・≥3R勝者89→100本。
- **両窓検証（`--confirm-exit`新設・progressive-risk）＝不採用**: **6y 112.4→88.9%（−23.5pp・maxDD−14.3→−21.8）／10y 97.8→84.3%（−13.5pp・maxDD−27.9→−30.6）**。両窓で生リターンDOWN∧maxDD UP。単窓ミラーの+0.28ppは10枠ポートフォリオの「壊れ玉を1日長く持つ＝DD増＋枠塞ぎで再投入逃す」コストに逆転される（C71/C72同型）。凍結契約「低下＝即revert」で本体無変更。docs/MINERVINI_EXIT_LEASH.md。
- **確定**: 現行exit leashは両窓最適に近い。執行チューニングは信頼レバーでない（3度目の確認）。正のレバーはdiscovery＋human品質表示に集約。次候補=製品スキャン結果の品質ランクUI（要ブラウザ検証）。

### C74 — 2026-07-14 品質ランクUI実装（設計原則の製品翻訳・両検証済み）
- **原則の製品化**: スキャン結果を「セットアップ品質」でソートする `quality_rank`（VCP検出優先→composite降順）を実装。C72b両窓バックテスト（長期+17pp）の忠実な製品リダクション。バックエンド`scan_result_query.py`のPythonソートに追加、フロントは既存VCP列ヘッダに`sortField`オーバーライドで配線（クリックで最良セットアップが最上位・初回desc）。凍結metric無変更。
- **副次バグ修正（発見・修正）**: 結果エンドポイントのJOINクエリ行はSQLAlchemy 2.0の`Row`（tupleでない）。旧Pythonソートは`isinstance(row,tuple)`のみで`Row`を`.details`直読み→`AttributeError('details')`。**全Pythonソートフィールド（vcp_detected/ma_alignment/passes_template/stage_name＋新quality_rank）がAPI境界で壊れていた**のを修正＋回帰テスト。
- **検証**: バックエンド単体5＋回帰1、フロント25（VCPヘッダがquality_rank desc発火）。**実ブラウザ検証（sandbox-e2e・1440px/375px）**: 実DB・実scan（AA/MSFTをvcp=trueにパッチ）でVCPヘッダクリック→`sort_by=quality_rank`発火→VCP行（composite39.5/4.5）がcomposite100の非VCP行の上に浮上を目視確認（scratchpad/qrank_before/after/mobile.png）。
- **次候補**: quality_rank発見の拡張（VCP品質スコアで人間watchlistランク）・21EMA押し目(B6)・VCP recall再設計(C69)。

### C75 — 2026-07-14 VCP recall向上: ATRボラティリティ収縮ベースを採用
- **根拠**: ミス構造計測（`vcp_recall_pareto.py`）で見逃しの**50.7%が単調深さゲート(ratio<0.6)**で死亡・うち84%は高値近辺タイト＝ミネルヴィニの literal「volatility contracting（単調深さではない）」と矛盾。C70 MA-tightは10DMA吸着ぶんを回収済。
- **実装**: `vcp_footprint.py`に第3並列パス`_vol_contract_base`（ATRが基底ピークの≤0.70倍に収縮＋直近10本タイト near-high＋2x prior advance＝判別ガード、**MA吸着不要**）。VCPDetector無変更＝golden凍結維持（C70同手法）。source='vol_contract'追加。
- **検証**: オフライン（`measure_volcontract_recall.py`）detected-recall **52.4→55.6%(+3.2pp)**・判別 **+26.2→+27.5pp**（両方向改善・増分 真+19/偽+11）。**凍結908ハーネス: FIRE±5 91.2→91.7（床超え）・判別+24.1→+24.0pp（1/575ノイズ）・TT/S2/SETUP/RS70/GATE/MSCORE バイト一致・golden gate-5 43維持・footprint単体12・harness単体6 pass**。C70と同型（FIRE±5↑・判別flat・他不変）＝採用。理論根拠あり・リターンフィッティングでない。
- **frozen更新**: FIRE±5床 91.2→**91.7**。**次候補**: VCB系のさらなるrecall（W型・複合ベース）・21EMA押し目(B6)・VCP品質スコアでwatchlistランク。

### C76 — 2026-07-14 young-base（trend-template guard）＝両検証で分岐→不採用
- **動機**: 残ミスの72%が`young_no_2x`（高値近辺だが prior advance<2x＝2xガードで除外される first-base/早期リーダー）。2xは判別ヒューリスティックでミネルヴィニ規則でない→本人の実ゲート「Stage-2トレンドテンプレート」に置換を試作。
- **オフライン（`measure_youngbase_recall.py`）**: detected-recall **55.6→74.3%（+18.7pp）**・判別 **+27.5→+32.8pp**（両方向改善・増分110真/77偽・精度59%）＝VCBより遥かに大きいレバーに見えた。
- **凍結908ハーネス＝不採用**: FIRE±5 entry 91.7→95.4だが control 67.7→**73.6**（より大きく上昇）→**FIRE±5判別 +24.0→+21.8pp（−2.2pp・~13idea＝ノイズでない実低下）**。「低下＝即revert」で**revert**。
- **確定した学び**: オフラインの detected-recall（セットアップ存在）は改善でも、FIRE±5（±5日のタイミング特異性）が劣化。young base near-highs in Stage2は本人エントリーの四半期前にも出る＝**タイミング特異性がない**。**2xガードは恣意的に見えて、trend templateが持たないタイミング判別を供給していた**。C74/C75の「見かけの改善を作らない」原則の実践（exit-leash・C71/C72と同型の分岐棄却）。
- 計測スクリプト（`vcp_miss_frontier.py`・`measure_youngbase_recall.py`）は資産として保持。frozen FIRE±5=91.7（C75）維持。**次候補**: recallは現状が判別最適に近い。VCP品質スコアでwatchlistランク（表示・低risk）・21EMA押し目B6（別エントリー型・要慎重）。

### C77 — 2026-07-14 資金流入（機関需要）シグナルの調査＝日次プロキシは弱判別
- **動機（ユーザー・REDFORD投稿）**: 機関の買い集めリスト（13F "$ invested"）はファンダ優良の代理＝スクリーナーに資金流入要素を追加すべきでは。
- **発見**: 蓄積レーティング`acc_dis_rating`（CLVマネーフロー0-99）は**既に実装済**（composite_ratingに組込）。だが908で判別を計測すると**極めて弱い**: acc_dis +2.5pp／up-down volume ratio 50d +3.8pp（最良）／accumulation-days +2.5pp。cf. VCP検出+27.5pp・trend template ~+30pp・SETUP +52pp。
- **構造的理由**: Stage-2セットアップに達した時点で既に蓄積済＝controlも同様。蓄積はエントリー**タイミング**情報をほぼ足さない（trend/structure要件と冗長）。日次accumulationを timing screen に足すのは young-base同型の希釈リスク＝不採用。
- **正しい設計（2トラック分離）**: (a) REDFORDの"$ invested"の価値は**ファンダ・ショートリスト**（機関がDD済＝優良）で、**真の13F機関保有データ**が要る＝四半期・45日遅延・EDGAR egressはGitHub Actionsのみ＝「日次」は原理的に不可（13Fは四半期更新）。別トラックのデータ工学（GHA+EDGAR 13F）。(b) 日次でできるのは既存acc_dis/UDVRの表示のみ＝タイミング判別は弱いので screen/rank の主軸にはしない。
- 計測スクリプト保持（`measure_accdis_discrimination.py`・`measure_udvr_discrimination.py`）。**結論**: 資金流入はタイミングでなくファンダ選別の軸。日次プロキシは弱く主軸化しない。真の13Fは四半期・別トラック。
