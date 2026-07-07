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

### 環境メモ（復元用）
- ブランチ: `claude/minerva-market-360-rebuild-toy2fa`（PR #48 OPEN、#47はMERGED）
- sandbox: yfinance/stooq 403（プロキシ回避は禁止）。GitHub raw 200。celery/httpx未インストール→一部テストはcollection error（既知・環境要因）。
- テスト実行: `cd backend && DATABASE_URL="postgresql://local/none" python3 -m pytest ...`
- フロント: NVM で Node 22 (`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`)
- 908バンドル: CI `backtest.yml` を `build_bundle=true` でdispatch → `backend/calibration/trade_idea_windows/` にコミットされる（完了後 `git pull`）
- 既知のpre-existing failure: backend 37件（main由来）、golden配下 `test_mcp_market_copilot.py` はcelery未導入でcollection error
