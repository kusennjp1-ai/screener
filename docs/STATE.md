# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C60 完了（懐疑テスト: **+89%は一般化せず**——9年窓CAGR 6.7% vs SPY 15.1%。ベア防御は両窓で実証、強気年の過剰防御が構造欠陥と確定）／ **次: C61=強気相場のエクスポージャー回復速度（progressive risk・分配日失効のIBD照合、GATE凍結metric直結）**
- **モデル**: Fable 5（従量課金化したら停止→Opus 4.8で継続、が恒久ルール）。
- **ブランチ**: `claude/minerva-market-360-rebuild-toy2fa`（PR #54までMERGED。**未マージコミット5件+docs**: 358df1d/6028bd8/4628e31/07cf293/0f7edb7＝バックテスト修正群。**GitHub MCP切断中→PR作成・マージ不可、再認証待ち**。pushは可能・実施済み）
- **実行中/待機中の外部ジョブ**: なし

## 凍結metricの現在値（低下＝即revert）

| metric | 値 | 測定 |
|---|---|---|
| 908トレード: TT / S2 / SETUP / FIRE±5 / GATE | 69.7 / 90.0 / 78.6 / 88.6 / **66.5** %（MSCORE 95.5・判別+42.8pp） | `scripts/validate_trade_ideas.py`（~7分） |
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

1. **C61: 強気相場のエクスポージャー回復** — ①progressive risk（confirmed uptrendで口座リスク1.25→2.5%、バックテスト側で先に検証）②分配日失効/リセットのIBD定義照合（本体market_regime.py変更＝GATE凍結metric/908ハーネス必須）。**6y/10y両窓で一貫改善のみ採用**。
2. **PR作成・マージ** — PR #55まで完了。C60 docsコミットが未PR（GitHub MCP再失効中→再認証待ち）。
3. **高速配信の2回目実測** — C57マージ済み。平日16:06 ETランでパイプライン~30-40分を確認。
4. **単銘柄タブRPR percentile化／スマホUI統一続き**（中型・保留中）。
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
