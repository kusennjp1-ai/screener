# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C57 完了（C56=**6年バックテスト成功**——2022ベア防御+20.9pp実証・PF1.67・ただし総リターンはSPY B&Hに劣後、C57=高速価格配信をチャート関連1,200銘柄に絞り~52分短縮）／ **次: C58=2025年アンダーパフォーマンス診断（戦術−4.2% vs SPY+17.7%、ゲート無しも−4.4%→敗因は銘柄選択/執行側）**
- **モデル**: Fable 5（従量課金化したら停止→Opus 4.8で継続、が恒久ルール）。
- **ブランチ**: `claude/minerva-market-360-rebuild-toy2fa`（PR #48-#53 全てMERGED。ブランチに未マージ4コミット: a7de637 C57＋workflow修正3件＋docs——**PR作成→CI green→squash mergeが確立フロー**。mainへの直接pushは禁止）
- **実行中/待機中の外部ジョブ**: なし（backtest-tactics run 29131626082 成功済・24分）

## 凍結metricの現在値（低下＝即revert）

| metric | 値 | 測定 |
|---|---|---|
| 908トレード: TT / S2 / SETUP / FIRE±5 / GATE | 69.7 / 90.0 / 78.6 / 88.6 / **66.5** %（MSCORE 95.5。GATEはC55で45.1→66.5・判別+25.4→**+42.8pp**、他バイト一致） | `scripts/validate_trade_ideas.py`（~7分） |
| 判別（entry−control） | SETUP +52.0pp / FIRE±5 +24.4pp / TT +30.5pp | 同上・CONTROL行 |
| Band right-edge（12銘柄 vs MM360実写） | 91%（P82 / BR92 / TPR100）**床** | `scripts/markets360_band_rightedge_eval.py` |
| Golden回帰 | **43 passed 床** | `make gate-5` |
| 戦術バックテスト（参考・凍結外） | 5年: フル+53.9%/maxDD−13.9%/PF1.67 vs ゲート無し+33.9%/−25.2% vs SPY+83.6%/−24.5% | CI `backtest-tactics.yml`（6yバンドルはリリースに保存済み） |

## 6年バックテストの読み方（C56・docs/BACKTEST_C54.md詳細）

- **証明**: 2022ベアで+2.7% vs SPY−18.2%（+20.9pp）・maxDD半減・PF1.67・選択アルファ+13.5pp（vs SPY×レジーム）。
- **誠実な敗北**: 総リターン−29.7pp劣後。主犯=2025年（−4.2 vs +17.7）と投資比率59%。
- **切り分け済み**: 2025年はゲート無しも−4.4%・SPY×レジーム+11.7% → **レジームは無罪、銘柄選択/執行の問題**。
- 全トレード記録: CI artifact 8242474227（report.full.json）。6yバンドル: `daily-price-data`リリースの`backtest-price-us-6y.json.gz`（81MB・2,068銘柄・as_of 2026-07-10）→ sandboxでオフライン再実行可能（`PYTHONPATH=. python scripts/backtest_minervini_tactics.py --bundle ...`）。

## 次アクション（優先順）

1. **C58: 2025年診断** — 6yバンドルをリリースからDL→sandboxで再実行し2025年トレードを層別（early vs armed・保有期間・エントリー月・セクター）。どの型が負けたか特定してから対策（仮説例: 2025はブレイクアウト失敗年→armed比率/出来高確認の効き具合を検証）。**レジーム較正は触らない**（無罪が実証済み）。
2. **高速配信の2回目実測** — C57マージ後の平日16:06 ETラン（目標: パイプライン~30-40分）。スケジューラ遅延69分は残存課題→cron多重登録（16:06/16:20の2本）が次候補。
3. **単銘柄タブのRPR authentic percentile化** — feature storeからのuniverse-performance供給を設計してから（中型）。
4. **スマホUI統一の続き** — 残る乖離はシェル/ナビとホーム画面の情報密度（スキャン結果・チャート・レジームバナーは共有済み）。
5. **調査済み・保留**: Alpha Vantage未登録adapter=低ROI／TPRストリップ=凍結／traction連動exposure=ポジション管理側／既存workflowテスト3失敗=pre-existing。
**注意（C45/C47の教訓）**: サイクル開始時はSPECを信じる前にコードをgrepする。

## 絶対制約（ユーザー指示・恒久）

- **fableが従量課金になったら停止**（その後はOpus 4.8で継続）。
- **egressプロキシ回避は絶対禁止**（市場データベンダーはsandboxで403のまま扱う）。
- golden/凍結metricの低下＝即revert。数値フィッティングは理論的根拠なしには行わない。metric追加・変更で見かけの改善を作らない。
- 1論点=1コミット、Conventional Commits、サイクル毎にPROGRESS追記＋本ファイル上書き。

## 環境（このsandboxの真実）

- Postgres16/Redisはインストール済み。DB接続は `DATABASE_URL="postgresql://stockscanner:stockscanner@localhost/stockscanner"`。フルスタック起動手順は `sandbox-e2e` skill。
- Node 22 は `/opt/node22/bin`（**このsandboxにNVMは無い**）。
- Yahoo/EDGAR egressは**GitHub Actionsのみ**。**新workflowはmainに載るまでdispatch API不可**（C56教訓）。GitHubリリース資産はプロキシ経由でDL可（daily-price-data）。
- CI成果物のblobストアはプロキシで403 → **ジョブログ（get_job_logs）から読む**。
- スマホ用スクリーナー（静的PWA, GitHub Pages）: **https://kusennjp1-ai.github.io/screener/**
