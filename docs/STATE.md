# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C91完了（**8点Trend Templateスコアカード・push要**）。GitHubのMinervini screenerが普遍的に表示する8点チェックリストが当製品に無い（passes_templateはflat boolのみ）→追加。`compute_tpr`にopt-in `with_breakdown`（バンドと同一per-barロジック再利用＝矛盾しない・default Falseで凍結band/golden不変）、static exportが`trend_template`をemit（export-only＝908/golden無変更）、`TrendTemplateScorecard`をチャートドリルインに配置。375px検証・backend 13+57／static 85テストgreen（c824ef0/386e94b）。**次候補: MarketRegimeBanner色統一・買い/監視行TV導線・クライアントreplay・scorecardをdesktop scanへ**。直前C90: hallmark auditでカードをde-slop（39c2f2c）。
- **モデル**: Opus 4.8（Fable従量課金/上限で停止→Opus継続、が恒久ルール。C86はsession上限でsubagent不可→mainループ単独遂行）。
- **ブランチ**: `claude/minerva-market-360-rebuild-toy2fa`（PR #59までMERGED・mainと同期。フロー: PR作成→CI green→squash merge→mainマージバック。**C86の2コミット(d87fe80/20b9b61)は未PR・push要**）
- **実行中/待機中の外部ジョブ**: なし（PR#59マージ済＝C81本番反映済・今日の買い候補UI稼働）。C82グループローテーション=最終棄却、表示バッジ化はユーザー判断待ち。20yバックテスト=ヘッドライン無効（凍結810宇宙）・**2008/2022ベア防御確認・チョップ年出血発見**→C85 tiering3窓棄却。**執行チューニング族5連続棄却＝打ち切り確定**（C71/76/80/82/85）。残proven-lever=discovery/表示・規律UI・fundamentals計測(matrix#5)・mobile可用性(matrix#4=C86着手/残SW)・desktop/scanカード。

## 凍結metricの現在値（低下＝即revert）

| metric | 値 | 測定 |
|---|---|---|
| 908トレード: TT / S2 / SETUP / FIRE±5 / GATE | 69.7 / 90.0 / 78.6 / **91.7** / **66.5** %（MSCORE 95.5。**FIRE±5はC70で88.6→91.2、C75で91.2→91.7に改善**・判別+24.1→+24.0pp＝1sample/575ノイズ、他バイト一致） | `scripts/validate_trade_ideas.py`（~7分） |
| Band right-edge（12銘柄 vs MM360実写） | 91%（P82 / BR92 / TPR100）**床** | `scripts/markets360_band_rightedge_eval.py` |
| Golden回帰 | **43 passed 床** | `make gate-5` |
| 戦術バックテスト（参考・凍結外・**決定的**） | 5年: legacy+89.0%（SPY+83.6%超え）だが**9年窓では+78.2% vs SPY+251.8%＝一般化せず**（C60）。ベア防御のみ両窓で実証 | ローカル or CI `backtest-tactics.yml`（6y/10yバンドルはリリースに保存） |

**注意**: C55までの凍結metricは不変（バックテスト修正はscripts/のみ、本体サービス無変更）。
**C56の+53.9%は非決定性バグの偶然の1試行＝無効**（BACKTEST_C54.md参照）。

## C58の要点（docs/BACKTEST_C54.md全面改訂済み）

- バックテストは決定的になった（RS降順候補・sorted sells・シード2種で一致確認）。
- armed買い逆指値=前日プランに対し交差判定（毎日上書きで死んでいた）。
- `--funnel product`=スマホ画面のBuy Signalチェックリスト再現（minervini_bandsウォークフォワード履歴・TPR緑∧圧力緑・Buy Risk緑/黄・フレッシュ交差）。バンド計算は`compute_band_panels`（history_bars拡張で1コール/銘柄・全銘柄7分）。
- 誠実な結論: 強気5年窓ではSPY B&Hに勝てず。型は実証（PF1.4-1.6・ゲート寄与+60.7pp・2022年legacy−2.9% vs SPY−18.2%）。
- C59でVCP時系列反転を修正→VCP由来115件/PF2.13が主役に（v2までの数字は反転バグ込み）。
- 成果物: scratchpadの`report_6y_legacy_v2.full.json`・`report_6y_product_v2.full.json`（全トレード）、6yバンドルはリリース`backtest-price-us-6y.json.gz`。

## 次アクション（優先順）

**★ docs/MINERVINI_CAPABILITY_MATRIX.md（C78）が優先順の正。(1)ストップ・ヒット売り分岐=C79完了（324b5c2・実ブラウザ検証済）** (2)ブレッドスdivergenceガード=C80完了（高値圏∧<40%のみ降格・直近10年で発火0＝テール保険・908バイト一致・plumbingは#3の基盤） 残: (3)エクスポージャー梯子の実効化＋レジーム別rating cap＋市場売りアラート（要908＋両窓） (4)mobileオフラインSW＋localStorage watchlist＋保有連動exit可視化（client側・要browser375px） (5)fundamentals付き908リプレイでrating stack検証（data=point-in-time要GHA・計測先行）。


0. **【C77一部完了】コヒーレンスギャップ**: 製品のフラット`vcp_detected`（VCP列表示）は依然 minervini_scanner の別VCPDetector由来だが、**quality_rank（並び順）は既に markets360 footprint の recall改善detection＋source tier を読むよう修正済（C77・backend限定・9db1fad）**。∴ recall改善（C70/C75）は品質ランクに反映される。**残**: VCP**列の表示bool**もfootprint由来に寄せる/`source`を列バッジ表示（要frontend＋ブラウザ検証）。どのdetectorを表示の正とするかは相関的変更＝慎重に。
1. **C69: VCP recall向上（最大レバー・概ね飽和）** — オフライン計測基盤あり（scratchpad/vcp_recall_pareto.py・36.1%、見逃しの81%は深さ逐次収縮ゲート）。パラメータ微調整は+2.8ppしか出ない（C59実証済）→**ベース分割ロジックの再設計**（W型・ハンドル・複合ベース＝B2と一体）。凍結metric（SETUP/FIRE±5/golden）直結＝本体変更は908ハーネス必須。
2. **未マージdocs/実験フラグのPR** — C66〜C68のコミットが未PR。GitHub MCP再認証後にPR→CI→マージ。
3. **保留**: Notion/Substack/YouTube/fewmoredaysはプロキシ403（環境ネットワークポリシー・回避禁止）→ユーザーのエクスポート/複製待ち。C81後の初回実測: fast 3本クロン化＋US warm 16:05 ET（mainマージ後に発効・着弾=目標 夏5:30-6:15/冬6:30-6:50 JST）。UI: account_risk_pct表示・スマホ統一。
4. **リスクトーン・オプション（ユーザー選択待ち）**: 半分クライマックス売り（--sell-into-strength --climax-partial）は両窓でmaxDD改善・Sharpe同値以上・検証済み。リスク低減優先なら即採用可。
**注意（C45/C47の教訓）**: サイクル開始時はSPECを信じる前にコードをgrepする。

## 絶対制約（ユーザー指示・恒久）

- **fableが従量課金になったら停止**（その後はOpus 4.8で継続）。
- **egressプロキシ回避は絶対禁止**（市場データベンダーはsandboxで403のまま扱う）。
- golden/凍結metricの低下＝即revert。数値フィッティングは理論的根拠なしには行わない。metric追加・変更で見かけの改善を作らない。
- 1論点=1コミット、Conventional Commits、サイクル毎にPROGRESS追記＋本ファイル上書き。

## 環境（このsandboxの真実）

- Postgres16/Redis稼働。`DATABASE_URL="postgresql://stockscanner:stockscanner@localhost/stockscanner"`。フルスタックは `sandbox-e2e` skill。
- Node 22 は `/opt/node22/bin`（NVM無し）。
- Yahoo/EDGAR egressは**GitHub Actionsのみ**。新workflowはmainに載るまでdispatch不可。リリース資産DLは可（6yバンドル取得済み）。
- バックテストのローカル実行: `cd backend && DATABASE_URL=... REDIS_ENABLED=false PYTHONPATH=. python3 scripts/backtest_minervini_tactics.py --bundle <6y.json.gz> --output out.json [--funnel product]`（~35分）。
- **GitHub MCP切断中**（PR操作・CIログ読み不可。git push/pullは可）。
- スマホ用スクリーナー（静的PWA）: **https://kusennjp1-ai.github.io/screener/**
