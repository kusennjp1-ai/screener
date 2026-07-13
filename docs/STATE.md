# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C67/C68 完了（ユーザー指示「全メカニクス反映」→網羅表 `docs/MINERVINI_MECHANICS_COVERAGE.md` 新設。**D2クライマックス売りは製品で既にアドバイザリ表示済み**と確認、自動執行を両窓特性化＝生リターン↔DDトレードオフ・**デフォルトはC61維持**、半分売りは検証済みオプション）／ **次: C69=B1 VCP recall向上（36%・PF2.13の源泉＝最大レバー・ベース分割の設計から）／保留: Notion/外部リンクはプロキシ403（ユーザーのエクスポート待ち）**
- **モデル**: Fable 5（従量課金化したら停止→Opus 4.8で継続、が恒久ルール）。
- **ブランチ**: `claude/minerva-market-360-rebuild-toy2fa`（**PR #57までMERGED・mainと同期済み・未マージ差分なし**。フロー: PR作成→CI green→squash merge→mainマージバック）
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

1. **C69: VCP recall向上（最大レバー）** — オフライン計測基盤あり（scratchpad/vcp_recall_pareto.py・36.1%、見逃しの81%は深さ逐次収縮ゲート）。パラメータ微調整は+2.8ppしか出ない（C59実証済）→**ベース分割ロジックの再設計**（W型・ハンドル・複合ベース＝B2と一体）。凍結metric（SETUP/FIRE±5/golden）直結＝本体変更は908ハーネス必須。
2. **未マージdocs/実験フラグのPR** — C66〜C68のコミットが未PR。GitHub MCP再認証後にPR→CI→マージ。
3. **保留**: Notion/Substack/YouTube/fewmoredaysはプロキシ403（環境ネットワークポリシー・回避禁止）→ユーザーのエクスポート/複製待ち。高速配信2回目実測（平日16:06 ET後）。UI: account_risk_pct表示・スマホ統一。
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
