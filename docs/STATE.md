# STATE — Round 2 統合（claude/r2-integration、未push）

更新 2026-11-06。branch claude/r2-integration（基点 claude/r2-step0 = db8e297 + 18ccfbc。main は 4e3ede7＝PR #141 の step 0 のマージで、この branch はその上にある。PR の base は main 4e3ede7）。5トラック（data → chart → market → verdict → rows）を統合中。push・PR・ワークフロー起動・本番の再取得や公開はしていない。

## 現在のサイクル（スキャナー）

- 準備判定（setup_ready、CH12）: 10 の準備ゲートと主パターンの3条件だけで判定する。検出器レベルのチェックは `explain.diagnostics`（「<検出器>:<チェック>」）へ移し、準備判定を落とさない。DoubleBottom のスタブを既定の検出器から外した。検出器の例外は Error の結果（db8e297 でも同じく Error で、recalculate-setups.py は土台を消して unavailable と記録し、ピボットも消える。この挙動は round 2 で変えていない。変わったのは Error の理由の文言だけ）。data のカバレッジ報告は `setup_readiness.not_calculated`・`incomplete_report` を数え、掲載行の1%を超えると警告する。ただし `incomplete_report` は「Setup Engine が完全な報告を返さなかった」行の数で、検出器の例外（Error）だけでなく Insufficient Data の判定と payload なしを含む（recalculate-setups.py の理由文は3つを区別しない）。検出器の例外の件数そのものではない。
- ゲート6: `volume_below_minimum` を `volume_above_dryup_cap` に改名（判定 volume_vs_50d ≤ 0.8 は不変）。旧公開の reason には旧名が残る。
- ステージ（CH11）: 200日線が上向き・終値が上・SMA150 > SMA200・52週高値から25%以内なら、横ばいの60本でもステージ2（ベース形成中）。`minervini_scanner.py` と `/technical/{symbol}/stage` が SMA150 と52週高値を渡す。トレンドテンプレートは公開の8条件のまま。

## 現在の数値（統合ブランチで実測）

- 赤線: 277 passed / 1 failed（`test_mcp_market_copilot::test_market_overview_snapshot`、db8e297 でも失敗する既存のもの）。
- Golden（gate-5）: 43 passed（下限43）。gate-1 163 / gate-2 47 / gate-3 152、gate-check OK。
- 908件の正解データ（オフライン、同梱バンドル）: 変更前後で同一。判別力 SETUP +52.0pp、FIRE±5 +25.8pp（S2 90.0% 対 対照 37.9%）。S2・SETUP 列は Markets360 由来のため CH11・CH12 はこの表では 未検証。
- 補助プローブ（凍結指標ではない）: 仕掛けのステージ2 80.8%→90.8%（対照 60.2%→66.1%）、TT通過のステージ3 11.4%→4.2%、setup_ready 仕掛け 28/588・対照 23/575（差 +0.8pp）、仕掛けの失敗の最多はゲート6（78%）。

## 公開データの実測（CI ログを読んだもの。I7 の「変更前」）

いずれも 11-05 のデータ（分析日 2026-11-05）。数値は各ランのカバレッジ報告（Published coverage）から読んだ。
- Static Site 42110952350（59e2dd7、手動起動、2026-11-05 21:15Z〜11-06 00:36Z、成功）: 掲載 858、SEC 記録 858、四半期あり 704。SEC の状態 ok 681・stale 15・no_quarterly 65・invalid 91（ほか no_cik 1・no_companyfacts 3・no_quarterly_values 2）、invalid_payload 85。Code 33 合格 0・未達 578・不明 280。setup_ready 合格 0／858。research index の gzip 825,297 バイト。SEC 取得 670 秒。
- Static Site 42218395807（main 4e3ede7、手動起動、11-06 12:32Z〜15:12Z、成功）: 掲載 908、SEC 記録 908、四半期あり 739。ok 713・stale 16・no_quarterly 72・invalid 101、invalid_payload 93。Code 33 0・601・307。setup_ready 0／908。SEC 取得 604 秒。
- Research UI Release 42282195175（main 4e3ede7、11-06 19:43Z〜20:32Z、成功）＝いま公開中: 掲載 908、SEC 記録 908、四半期あり 739。ok 714・stale 15・no_quarterly 72・invalid 101、invalid_payload 93。Code 33 0・583・325。setup_ready 0／908。I7 の比較の起点はこのラン。

## 未検証（公開データを読むまで）

- 次の定時データ公開（recalculate-setups.py が全行を再計算）の後の setup_ready 合格・不合格・不明、主な失敗チェック、再計算できなかった行の理由、ゲート6の割合、vcp_ready_for_breakout、TT通過銘柄のステージ3の割合。

## 次の行動

1. 統合の I4 を終え、PR を main へ（CI と Design Acceptance が通ること）。マージ後に UI のみの再公開（I6）。
2. 次の定時データ公開の後に I7 の実測（上の未検証の項目）。
3. round 3 の候補: ゲート6を分析日前の数セッションで判定するか、1.4倍以上でピボット上の引けを除外するかを、908 の仕掛け−対照の判別力で評価する。準備判定を並び順に使うかどうか（§9-4）はその後。

## 絶対の制約

- トレンドテンプレートは公開の8条件だけ。ステージは9番目の拒否条件にしない。Code 33 は加点要素で関門にしない。
- 90% の品質基準を下げない。推計値やスコアを作らない。転送ハッシュの方式を変えない。RS推計を IBD RS と呼ばない。
- 本番の再取得・公開・キャッシュ削除で検証しない。実データの効果は公開データを読んでから報告する。
- 履歴は docs/PROGRESS.md、仕様は docs/SPEC.md。
