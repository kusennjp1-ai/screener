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
| 908トレード実測 (COV/TT/S2/SETUP/RS70/FIRE±5/MSCORE/GATE) | **CI実行中** | — | CI `backtest.yml` bundleジョブ |
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

### 環境メモ（復元用）
- ブランチ: `claude/minerva-market-360-rebuild-toy2fa`（PR #48 OPEN、#47はMERGED）
- sandbox: yfinance/stooq 403（プロキシ回避は禁止）。GitHub raw 200。celery/httpx未インストール→一部テストはcollection error（既知・環境要因）。
- テスト実行: `cd backend && DATABASE_URL="postgresql://local/none" python3 -m pytest ...`
- フロント: NVM で Node 22 (`export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh"`)
- 908バンドル: CI `backtest.yml` を `build_bundle=true` でdispatch → `backend/calibration/trade_idea_windows/` にコミットされる（完了後 `git pull`）
- 既知のpre-existing failure: backend 37件（main由来）、golden配下 `test_mcp_market_copilot.py` はcelery未導入でcollection error
