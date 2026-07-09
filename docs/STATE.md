# STATE — 現在地スナップショット

**目的**: 新しいセッション/コンテキストが30秒で再開できること。
**規律**: 各サイクル末尾に**全面上書き**する（追記しない）。履歴は PROGRESS.md、仕様は SPEC.md、ここは「今」だけ。

## 現在

- **サイクル**: C42 完了（Code 33ライブ統合＝配線39c32aa＋EDGAR計算4bcc658。最重要ファンダギャップをUIまで閉じた）／ **次: C43**
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

1. **C43候補a: Code 33をスキャナースコア/ランキングに統合** — C42でUIチェックリストまでは点灯するが、スキャンの並び順には影響しない。Minervini/CANSLIMのスコアにボーナス項として加算（凍結metric＝908harness+golden影響を要測定、加算は控えめに）。
2. **C43候補b: 保存済ファンダのスコア統合** — 年間EPS成長・売上成長・利益率・ROE・EPS Rating は保存済だが未スコア。
3. **C43候補c: Alpha Vantage未登録adapter**（US第3段が空no-op、`use_alpha_vantage`param未消費）。
4. **C43候補d: `_store_in_database`部分ペイロード上書き**（Noneで既存カラム上書き）。
5. **設定メモ**: sandboxは`defusedxml`未インストールになりがち→ファンダ系フェッチ前に`pip install defusedxml`。ファンダ列追加後は`alembic upgrade head`。Code33本番有効化は`.env`に`FUNDAMENTALS_CODE33_ENABLED=true`（要data.sec.gov）。
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
