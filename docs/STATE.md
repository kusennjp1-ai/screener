# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C44 完了（ファンダボーナス内訳をスキャンUIに表示、コミット 34addf8。C43のスコア統合と合わせ「取得→保存→スコア→UI説明」まで全段クローズ）／ **次: C45候補は下記**
- **モデル**: Fable 5復帰（従量課金化したら停止→Opus 4.8で継続、が恒久ルール）。
- **ブランチ**: `claude/minerva-market-360-rebuild-toy2fa`（PR #48 OPEN、mainは触らない）
- **実行中/待機中の外部ジョブ**: なし

## 凍結metricの現在値（低下＝即revert）

| metric | 値 | 測定 |
|---|---|---|
| 908トレード: TT / S2 / SETUP / FIRE±5 / GATE | 69.7 / 90.0 / 78.6 / 88.6 / 45.1 %（**C43後フル再実行でバイト一致**、MSCORE 95.5） | `scripts/validate_trade_ideas.py`（~7分） |
| 判別（entry−control） | SETUP +52.0pp / FIRE±5 +24.4pp / TT +30.5pp | 同上・CONTROL行 |
| Band right-edge（12銘柄 vs MM360実写） | 91%（P82 / BR92 / TPR100）**床** | `scripts/markets360_band_rightedge_eval.py` |
| Golden回帰 | **43 passed 床** | `make gate-5` |
| レッドラインunit | 200 passed（唯一のfail=`test_mcp_market_copilot` はpre-existing・除外対象、クリーンベース再現確認済） | scanners+services+golden |
| Code33 as-ofキャッチ率 | 7.1% vs control 3.2%（+4.0pp, 126ペア） | CI `code33-check.yml` as_of_idea_dates=true |

## C43で入ったもの（要点）

- `backend/app/scanners/criteria/fundamental_bonus.py` — 純関数、上限+10: Code33 +4 / EPS成長qq ≥40 +2.5・≥25 +1.5 / 売上qq ≥25 +1.5・≥10 +0.5 / ROE ≥17% +1（単位正規化: finviz=%、旧yfinance=分数） / EPS Rating ≥80 +1。欠損＝中立0。
- Minervini `needs_fundamentals=True` + `needs_quarterly_growth=True`。cache-onlyスキャンは`batch_only_fundamentals`（run_bulk_scan.py:243）でget_many読みのみ・ライブフォールバック無し。
- `passes_template`/Stage-2/setup検出は不変。テンプレ不通過はスコア85でもBuyにならない（E2E確認: FTNT 76.83→85.83 +9.0でrating Watchのまま）。
- ボーナス内訳は `details.fundamental_bonus` / `fundamental_bonus_detail` としてAPI・UIスナップショットまで配線済み（C44）。サイドバーSCORESに「Fnd Bonus +N / 10」＋成分チップ表示。
- **UIスナップショットの罠（C44で発見）**: スキャン結果ページは`/v1/scans/bootstrap`（発行済スナップショット）から読む。スキーマ追加後は`publish_scan_bootstrap(scan_id)`で再発行しないと既存スキャンのUIに出ない（新規スキャンは自動）。
- 908ハーネスは`StockData(fundamentals=None)`構築なのでボーナス恒等0＝凍結metric構造的に不変（テストでピン留め: `test_fundamental_bonus.py::test_scanner_score_unchanged_without_fundamentals`）。

## 次アクション（優先順）

1. **C45候補a: SPECバックログ1（FTD検出＋分配日+5%失効＋ストーリングデイ）** — 理論忠実度の最大残項目（O'Neil/Minervini市場タイミングの核）。凍結metricへは市場regime経由のみ（buyable_nowゲート）で影響小さいが要測定。
2. **C45候補b: 静的PWAビューアのFnd Bonus表示確認** — StaticChartViewerModalは同一Sidebarを使うため次回static-site.ymlラン後に自動表示のはず。実ビルド（GitHub Pages）で要確認。
3. **調査済み・保留（再調査不要）**: Alpha Vantage未登録adapter=低ROI／部分ペイロード上書き=理論のみdefensive／CANSLIMへのファンダボーナス思想適用=要ユーザー判断。
4. TPRフルストリップ較正は**凍結**（複数時点のMM360スクショが増えるまで。PROGRESS C19/C23参照）。

**設定メモ**: sandboxは`defusedxml`未インストールになりがち→ファンダ系フェッチ前に`pip install defusedxml`。ファンダ列追加後は`alembic upgrade head`。Code33本番有効化は`.env`に`FUNDAMENTALS_CODE33_ENABLED=true`（要data.sec.gov）。通知は`POSITION_ALERT_WEBHOOK_URL`。

## 絶対制約（ユーザー指示・恒久）

- **fableが従量課金になったら停止**（その後はOpus 4.8で継続 — skillsに知識蓄積済み）。
- **egressプロキシ回避は絶対禁止**（市場データベンダーはsandboxで403のまま扱う）。
- golden/凍結metricの低下＝即revert。数値フィッティングは理論的根拠なしには行わない。
- 1論点=1コミット、Conventional Commits、サイクル毎にPROGRESS追記＋本ファイル上書き。

## 環境（このsandboxの真実）

- Postgres16/Redisはインストール済み（このセッションで起動済み）。DB接続は `DATABASE_URL="postgresql://stockscanner:stockscanner@localhost/stockscanner"`。フルスタック起動手順は `sandbox-e2e` skill。
- Node 22 は `/opt/node22/bin`（**このsandboxにNVMは無い**。NVMはユーザーPC側の話）。
- Yahoo/EDGAR egressは**GitHub Actionsのみ**（CIディスパッチのトリック: `ground-truth-908` skill）。
- CI成果物のblobストアはプロキシで403 → **ジョブログ（get_job_logs）から読む**。
- スマホ用スクリーナー（静的PWA, GitHub Pages）: **https://kusennjp1-ai.github.io/screener/**（static-site.yml がmainから毎日デプロイ。URLは2026-07-09のdeployジョブログで実確認済み）。
