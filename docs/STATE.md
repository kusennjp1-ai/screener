# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C41 完了（Minerviniファンダ監査＋決算日配線修正——死んでいたCANSLIM近接ゲートを復活）／ **次: C42**
- **モデル**: fableから**Opus 4.8**へ切替（ユーザー指示）。以降のコミット co-author は harness指定に従う。
- **ブランチ**: `claude/minerva-market-360-rebuild-toy2fa`（PR #48 OPEN、mainは触らない）
- **実行中/待機中の外部ジョブ**: なし（code33-check ディスパッチは全消化済み）

## 凍結metricの現在値（低下＝即revert）

| metric | 値 | 測定 |
|---|---|---|
| 908トレード: TT / S2 / SETUP / FIRE±5 / GATE | 69.7 / 90.0 / 78.6 / 88.6 / 45.1 % | `scripts/validate_trade_ideas.py`（~7分） |
| 判別（entry−control） | SETUP +52.0pp / FIRE±5 +24.4pp / TT +30.5pp | 同上・CONTROL行 |
| Band right-edge（12銘柄 vs MM360実写） | 91%（P82 / BR92 / TPR100）**床** | `scripts/markets360_band_rightedge_eval.py` |
| Golden回帰 | **43 passed 床** | `make gate-5` |
| レッドラインunit | 181 passed | scanners+services+golden（mcp_market_copilot除外） |
| Code33 as-ofキャッチ率 | 7.1% vs control 3.2%（+4.0pp, 126ペア） | CI `code33-check.yml` as_of_idea_dates=true |

## 次アクション（優先順）

1. **C42候補a（最有力・Minervini最重要ギャップ）: Code 33のライブ統合** — 決算加速がどのスキャナーも未消費（static/presetのみ）。scan_resultsに`code33`列追加＋CIバンドル経由で供給、or EDGAR facts をscan時参照。BuyChecklistの`code33`をライブで点灯させる。要CI検証（EDGARはCIのみ）。SPEC忠実度表のCode33 ⚠️を閉じる。
2. **C42候補b: 保存済ファンダのスコア統合** — 年間EPS成長・売上成長・利益率・ROE・EPS Rating は保存済だが未スコア。Minervini/CANSLIMのランキングに反映（凍結metric影響を要測定）。
3. **C42候補c: Alpha Vantage未登録adapter**（US第3段が空no-op）。
4. **C42候補d: `_store_in_database`部分ペイロード上書き**（Noneで既存カラム上書き）。
5. **設定メモ**: sandboxは`defusedxml`が未インストールになりがち→ファンダ系フェッチ経路を触る前に`pip install defusedxml`（requirements-server.txt宣言済み）。ファンダ列追加後は`alembic upgrade head`。
3. **設定メモ**: 通知は`.env`に`POSITION_ALERT_WEBHOOK_URL`（Discord/Slack webhook）を設定。
4. 静的サイト実ビルドでのカード/バッジ見た目確認（次回static-site.ymlラン後、GitHub Pages）。
3. 静的サイト実ビルドでのカード/バッジ見た目確認（次回static-site.ymlラン後、GitHub Pages）。
4. TPRフルストリップ較正は**凍結**（複数時点のMM360スクショが増えるまで。PROGRESS C19/C23参照）。

## 絶対制約（ユーザー指示・恒久）

- **fableが従量課金になったら停止**（その後はOpus 4.8で継続 — skillsに知識蓄積済み）。
- **egressプロキシ回避は絶対禁止**（市場データベンダーはsandboxで403のまま扱う）。
- golden/凍結metricの低下＝即revert。数値フィッティングは理論的根拠なしには行わない。
- 1論点=1コミット、Conventional Commits、サイクル毎にPROGRESS追記＋本ファイル上書き。

## 環境（このsandboxの真実）

- Postgres16/Redisはインストール済み・停止状態。フルスタック起動手順は `sandbox-e2e` skill。
- Node 22 は `/opt/node22/bin`（**このsandboxにNVMは無い**。NVMはユーザーPC側の話）。
- Yahoo/EDGAR egressは**GitHub Actionsのみ**（CIディスパッチのトリック: `ground-truth-908` skill）。
- CI成果物のblobストアはプロキシで403 → **ジョブログ（get_job_logs）から読む**。
