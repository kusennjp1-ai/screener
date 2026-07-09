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

### 環境メモ（復元用）
- ブランチ: `claude/minerva-market-360-rebuild-toy2fa`（PR #48 OPEN、#47はMERGED）
- sandbox: yfinance/stooq 403（プロキシ回避は禁止）。GitHub raw 200。celery/httpx未インストール→一部テストはcollection error（既知・環境要因）。
- テスト実行: `cd backend && DATABASE_URL="postgresql://local/none" python3 -m pytest ...`
- フロント: NVM で Node 22 (`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`)
- 908バンドル: CI `backtest.yml` を `build_bundle=true` でdispatch → `backend/calibration/trade_idea_windows/` にコミットされる（完了後 `git pull`）
- 既知のpre-existing failure: backend 37件（main由来）、golden配下 `test_mcp_market_copilot.py` はcelery未導入でcollection error
