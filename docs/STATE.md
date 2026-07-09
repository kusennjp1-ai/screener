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

**残C43候補の調査結論（C42時点で精査済——次セッションは再調査不要）**:
1. **C43候補a: Code 33をスキャナースコアに統合** — C42でUIチェックリスト点灯まで完了。並び順への反映は残。**ただしsandboxではcode33=null（EDGAR不達）のため、スコア加算の効果を検証できない＋凍結metric（908harness+golden）影響を測れない→本番/CI環境かEDGARモック整備が前提**。着手はユーザー判断（凍結metricトレードオフ）待ち推奨。
2. **C43候補b: 保存済ファンダのスコア統合**（年間EPS/売上/margin/ROE/EPS Rating）— Minerviniスキャナは意図的に`needs_fundamentals=False`。追加は方法論変更＋908metric影響大→要ユーザー判断＋測定。
3. **C43候補c: Alpha Vantage未登録adapter — 低優先と判定**。AVServiceは統一`get_fundamentals`を持たず（overview/earnings/income statement分離）、25req/日でfinviz+yfinose両失敗時のみ発火。adapter登録は非自明かつ本番のみ検証可、削除はテスト複数＋PLAN_VERSION更新。実害は毎fetchのWARNINGログのみ。**やるなら削除より登録だが投資対効果低**。
4. **C43候補d: 部分ペイロード上書き — 理論上のホットスポットで実経路では未発生と確認**。`_fetch_and_cache`（フル取得）・hybrid（フルpayload）・`refresh_code33_flags`（targeted update）いずれも部分storeしない。on-demand enrichmentもフル再取得。**現状defensive-onlyで、50フィールド改修は完全性テスト回帰リスク＞益→保留**。将来partial store経路を追加する時に対処。

**設定メモ**: sandboxは`defusedxml`未インストールになりがち→ファンダ系フェッチ前に`pip install defusedxml`。ファンダ列追加後は`alembic upgrade head`。Code33本番有効化は`.env`に`FUNDAMENTALS_CODE33_ENABLED=true`（要data.sec.gov）。

**ファンダ系の到達点（C40-C42）**: 取得ロジック健全（ユニット多数green）／stale失敗時フォールバック配信（C40）／決算日配線復活でCANSLIM近接ゲート稼働（C41）／Code 33ライブ配線＋EDGAR計算タスク（C42）。中核Minerviniファンダは取得・保存・（一部）スコア消費まで揃う。残はスコア統合系で、いずれも凍結metric or 実環境の制約下。
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
