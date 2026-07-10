# SPEC — Minervini完全再現スクリーナー 正準仕様

> このファイルが「何を作っているか」「何が真実か」の単一情報源。
> 改善ループの各サイクルはこの仕様と §Validation の凍結契約に従う。
> 更新履歴は docs/PROGRESS.md（サイクルログ）に毎回追記する。

## 目的

Mark Minervini の SEPA® 方法論（*Trade Like a Stock Market Wizard* /
*Think & Trade Like a Champion*）の意思決定ロジックを、
検証可能な形で完全再現する。表面的なテクニカル模倣ではなく
「Minervini本人ならこの銘柄・この局面でどう判断するか」を再現する。

**Ground truth**: `data/minervini_trade_ideas.csv` — 本人が公開した908トレード
（1997-2022, 696銘柄, @traderCharlieM編纂, 1998-2009は欠落）。

## 中核コンセプト → 実装マップ（忠実度表）

| コンセプト | 実装 | 状態 | 既知の乖離 |
|---|---|---|---|
| Trend Template 8条件 | `minervini_scanner.py` `passes_template`（厳密AND） | ✅ | +非正準のStage-2回帰条件が追加されている（グラインド上昇を落とす）。52週レンジがClose基準（bandsはHigh/Low基準）で端で不一致 |
| RS Rating | `criteria/relative_strength.py` 63d40%/126d20%/189d20%/252d20%、スキャンユニバース内percentile | ✅ | W3.2で実データ検証済み(KEEP)。ユニバース無しでは線形フォールバック。スキャン対象内percentileでありIBDの全市場percentileではない |
| VCP | `legacy_vcp_detection.py` + `vcp_footprint.py`（漸減する押し・出来高枯れ・pivot） | ✅ | 本人トレードでのrecall ~35%（gate: score≥55+contracting_depth+tight_near_highs）。Close基準の深さ計測。事前Stage-2上昇の要求なし |
| Pivot状態 | `vcp_footprint.py` near_pivot/ready（**要 detected**、chase上限+5%） | ✅ C1で修正 | 修正前はランダム日の96%で発火（構造ゲート無し+下限無し） |
| Code 33 | `sec_edgar_financials.py::compute_code33_from_facts`（EPS+売上+マージン3四半期加速） | ✅ C43でスコア統合 | C42でライブ配線（`refresh_code33_flags`→`code33`列→buy-context→BuyChecklist）、**C43でMinerviniスコアに統合**（`criteria/fundamental_bonus.py`: Code 33 +4を筆頭に上限+10のSEPAファンダボーナス、欠損中立・passes_template不変）。本番はマージン脚を外した緩和版。canslim_scanner.py:32の"Code 33"は誤命名（決算ブラックアウトの話） |
| Market regime | `market_regime.py` 4状態 + health 0-100 + exposure + **FTD検出** | ✅ C45監査で確認 | FTD（day4-15・+1.2%・出来高増・failure circuit breaker）＋分配日+5%失効＋ストーリングデイ＝**全て実装済み**（コミット 0047eb7/8372edd、テスト12件）。FTDはcorrection/downtrendをpilot exposureで confirmed_uptrend に昇格。Minervini（SEPAルール1）・CANSLIM（**C46**のMゲート）ともratingを市場でキャップ |
| Progressive exposure | `market_regime.py::_ftd_exposure` FTD後 25→50→75%ラダー | ✅（stateless近似） | FTD経過日数＋FTD後分配日数による正直なstateless proxy（e05577b）。真のポジション単位traction連動（pilot利益で加速）はスキャン側では不可能——ポジション管理側の将来課題。risk.pyの1.25%は固定のまま |
| Entry signals | `entry_signals.py` pocket pivot / power trend / volume surge | ✅ | |
| Buy signal (Buying Now) | `markets360/signals.py` triple barrel、1.5x出来高、VCP pivotアンカー | ✅ | |
| Exit: 50DMA割れ | `signals.py::detect_50dma_breakdown` | ✅ | |
| Exit: climax / trailing ladder | `exit_signals.py`（1R半減→2R建値→3R+1Rロック） | ✅ | |
| 3色バンド (Pressure/BuyRisk/TPR) | `minervini_bands.py`（Force Index EMA / ATR extension / 7条件TT） | ✅ | right-edge一致 91%（P82%/BR92%/TPR100%, 12銘柄実スクショ）。フルストリップはTPRが最弱（IBB 58%） |
| 二軸 (quality × execution state) | `domain/scanning/scoring.py` 7状態+State Cap | ✅ C47監査で確認 | 入力は`_compute_execution_state`の3段フォールバック（minervini→m360→価格直接計算）で**全スキャンでCap稼働**。SMA200過伸長100%(tradermonty=50%)は未較正。サーバー側フィルタ不可 |
| Setup Engine | `analysis/patterns/` 7検出器+readiness、gate-1..5 | ✅ | 7状態enumとは別語彙（in_early_zone等）。pivotが3実装で不一致あり得る（reconciliation無し） |

## ファンダメンタル・カバレッジ表（C41監査、2026-07-08）

「取得(fetch)→保存(column)→スコア消費(scanner)」の3段で、各Minervini/CANSLIMファンダ指標の状態。**取得できているか＝fetch+column両方が✅か**。

| 指標 | 取得 | 保存(列) | スコア消費 | 備考 |
|---|:--:|:--:|:--:|---|
| 四半期EPS成長YoY (`eps_growth_qq/yy`) | ✅ finviz/growth_cadence | ✅ | ✅ CANSLIM C/A | 中核 |
| 年間EPS成長 (`eps_growth_annual`, `eps_5yr_cagr`) | ✅ | ✅ | ⚠️ 未消費（CはYoY使用） | |
| 四半期/年間 売上成長 (`sales_growth_qq/yy`, `revenue_growth`) | ✅ finviz | ✅ | ✅ Minerviniボーナス **C43** | ≥25% +1.5 / ≥10% +0.5（EPSの売上裏付け） |
| 純/営業/粗 利益率 | ✅ finviz | ✅ | ⚠️ 未スコア（Code33内で加速のみ消費） | |
| ROE/ROA/ROIC | ✅ finviz | ✅ | ✅ ROEはMinerviniボーナス **C43**（+SMR） | ≥17%で+1、単位正規化（finviz=%／yfinance=分数） |
| フォワードEPS推定 (`eps_next_q/y/5y`) | ✅ finviz | ✅ | ⚠️ 未スコア | |
| 機関保有 (`institutional_ownership`) | ✅ finviz | ✅ | ✅ CANSLIM I | 変化(trans/change)は未消費 |
| 負債 (`debt_to_equity`, `lt_debt_to_equity`) | ✅ finviz | ✅ | ⚠️ 未スコア | |
| EPS Rating（percentile合成） | ✅ 算出 | ✅ | ✅ Minerviniボーナス **C43** | ≥80（IBD買い最低ライン）で+1 |
| **決算日 (`next_earnings_date`)** | ✅ yfinance | ✅ **C41で修正** | ✅ CANSLIM近接ゲート | **修正前: 取得済だが列欠落で往復脱落→ゲート常時no-op（死んでいた）** |
| **Code 33（EPS+売上+利益率3四半期加速）** | ✅ EDGAR | ✅ `code33`列 **C42で追加** | ✅ Minerviniボーナス **C43**（+4点の筆頭）＋UIチェックリスト | C42ライブ配線（`refresh_code33_flags`・`FUNDAMENTALS_CODE33_ENABLED`・週次beat）→C43でスコア統合→C44でUI内訳表示。sandboxはEDGAR不達でnull（本番/CIで点灯） |
| 決算サプライズ（実績vs予想） | ❌ 未取得 | ❌ | ❌ | finviz `EPS Surprise`等を未マッピング。カタリスト系 |
| アナリスト推定改定方向 | ❌ 未取得 | ❌ | ❌ | カタリスト系 |
| 利益率の拡大/加速トレンド | ❌（Code33内のみ） | ❌ | ❌ | 単発margin値はあるが前期比トレンド無し |

**結論（C43更新）**: Minervini中核ファンダ（EPS/売上/ROE/機関保有/EPS Rating/Code 33）は**取得+保存+スコア消費まで揃った**。C43で`needs_fundamentals=True`化し、`criteria/fundamental_bonus.py`の上限+10 SEPAボーナス（Code33 +4 / EPS成長 +2.5|+1.5 / 売上 +1.5|+0.5 / ROE +1 / EPS Rating +1、欠損中立0）がMinerviniスコアを再ランク。`passes_template`は不変＝テクニカルが最終審判。残: ①年間EPS成長・margin水準・負債は未スコア（二次的）②サプライズ/推定改定/margin加速トレンドは未取得（カタリスト系）③ボーナス内訳のUI表示。

## Validation — 凍結契約（レッドライン）

**固定 ground-truth ハーネス**: `backend/scripts/validate_trade_ideas.py`
- 凍結metric列: `COV% / TT% / S2% / SETUP% / RS70% / FIRE±5% / MSCORE / GATE%`
  + **CONTROL行**（同銘柄 T0−63営業日）。タイミング系metricの真値は
  (entry − control) の判別力。常時発火シグナルはヒット率を偽装できるが
  コントロール差分は偽装できない。
- **見かけの改善のためにmetricを追加・変更することを禁止**。
  列の変更はSPEC改訂＋PROGRESS記録を伴う意図的決定のみ。
- look-ahead禁止はテストでピン留め（`test_validate_trade_ideas_harness.py`）。
- データ: `backend/calibration/trade_idea_windows/`（CI `backtest.yml` の
  `build_bundle=true` ジョブが構築・コミット。sandboxはYahoo egress無し）。

**その他の固定検証**（すべて毎サイクル比較可能）:
- `make gate-5` golden regression — **一度でも落ちたら即revert**
- `make gates` SE 5ゲート
- バンド一致: `scripts/markets360_band_rightedge_eval.py`（12銘柄 vs 実MM360スクショ）
- forward returns: `scripts/validate_forward_returns.py`（cohort×quartile, T+1/5/21）
- CI（Yahoo egressあり）: `backtest.yml`（catch-rate）, `vcp-calibration.yml`,
  `minervini-validate.yml`, `code33-check.yml`

**環境の真実**: appサンドボックスは市場データvendor全ブロック
（yfinance/stooq 403; GitHub rawのみ可）。実データ作業は
①コミット済みfixture/バンドル ②CI（egressあり） ③ユーザーPC の三択。
プロキシ回避は絶対禁止。

## 既知のground-truthの限界（誠実さのため明記）

- 908トレードは1998-2009が完全欠落（2000-02/2008ベア相場を検証できない）
- 2022は1件のみ
- 「Deepvueエクスポート」なるデータは**リポジトリに存在しない**
  （rs_line.pyのblue dot命名クレジットとHTF閾値の出典参照のみ）
- recall（本人ピックを拾えるか）は測れるが、precision（偽陽性率）の
  ground-truth負例セットは存在しない → forward-returnハーネスで代替

## 優先バックログ（理論的忠実度 → 数値改善 → UX の順）

**C45+C47監査（2026-07-09）: 旧バックログはほぼ全て実装済みだった**——FTD+失効+ストーリング（0047eb7/8372edd）／exposureラダー（e05577b）／Minervini市場ゲート（SEPAルール1）／CANSLIM市場ゲート（C46 32ebd74）／Code 33統合（C43）／execution stateフォールバック（`scan_orchestrator._compute_execution_state`: minervini→m360→価格直接計算の3段、全スキャンでState Cap稼働）／スキャン経路のRPR universe配線（markets360_scanner.py:108）／canslim誤命名（コメント済修正）。

**残る真のバックログ**:
1. Markets 360**単銘柄タブ**のRPRをauthentic percentileに（`services/markets360/service.py:110`は線形フォールバックのまま。単銘柄ページにはスキャンユニバースが無いため、feature store等からのuniverse-performance供給の設計が必要）
2. TPRフルストリップ一致改善（58%→）※凍結中（複数時点のMM360実写が増えるまで）
3. 静的PWA実ビルドでのFnd Bonus/カード確認（PR #48マージ→static-site.ymlラン後）
4. ポジション単位のtraction連動progressive exposure（ポジション管理側の将来課題）
5. 決算サプライズ/アナリスト推定改定/margin加速トレンドの取得（カタリスト系、二次的）
