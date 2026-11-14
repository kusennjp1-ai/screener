# Round 3 共有スナップショット（米国 2026-11-12）

作成 2026-11-13（日本時間）。GitHub は読み取りのみ。再取得・起動・公開はしていない。データと画像はリポジトリに入れず、作業領域 `audit3/snapshot/` に置く（README.md・MANIFEST.md）。

## 入力（実測）

| 入力 | 場所 | sha256 |
|---|---|---|
| feature-run-us-2026-11-12.json.gz（110,783,688 B） | 本リポジトリの release daily-price-data（338284553）の asset 743083867 | efbc14c0…ba59ee（ポインターと一致） |
| daily-price-us-20261112.json.gz（118,602,942 B） | 上流 xang1234/stock-screener の release daily-price-data（Static Site の GITHUB_DATA_REPOSITORY）。本リポジトリの release にはない。asset id は取得不可 | 24799ce0…5b9f0e（CI の build-market ログの input.sha256 と一致） |
| ジョブログ | Static Site 43385558863（16:24〜19:20）の build-market・combine-and-build、Research UI Release 43408634161（19:22〜20:10）の publish | MANIFEST.md に記録 |

コードは main 8849bf9 の git archive。CI と同じ処理を順に再現した。

1. 走査行（ETF を除く）。
2. 価格の取り込み判定。
3. 450日の窓で 310 本の日足。
4. recalculate-setups.py の再計算。
5. 選定に使うモジュール（auditDailyBars・rankVerifiedUniverse・assess・briefRows・setupReadiness）。esbuild でまとめて使った。

## 公開値との比較

| 項目 | 公開（CI ログ） | 再現 |
|---|---|---|
| 走査行 | 5955 | 5955（一致） |
| 価格の取り込み 採用／不採用 | 6043／3997 | 6043／3997（一致） |
| 検証済みチャート（RS推計の母集団） | 4538 | 4421（−117） |
| テンプレート8条件の通過 | 627 | 614（−13） |
| 掲載行 | 998 | 980（−18、−1.8%） |
| setup_ready 合格／不合格 | 43／955 | 37／943 |
| 不合格の上位（outside_early_zone・readiness・出来高・stage） | 735・726・435・272 | 725・719・427・265（順位は同じ） |
| RS線新高値（真）・先行（真） | 16・4 | 16・4（一致） |

差の原因は次の二つ。

- CI は上流の日足を 3997 銘柄で不採用にし、実行時に Yahoo から取り直した。この環境では Yahoo に届かない。
  - 掲載 980 行のうち 368 行は上流の生の日足で代用した。日足の名目（bars_basis）で区別している。
  - 選定の計算では、各日の高値・安値をその日の始値・終値まで広げて数えた。
  - 描画は生の足のまま。アプリは「未検証の足」と表示する。
- CI では描けた 120 銘柄に、ここではチャートがない。株式分割の不連続が 59、日足なしが 47、異常のままが 14。このため RS推計の母集団が約 2.6% 小さい。

上の比較は件数の差だけを見たもの。公開の 43 行と 998 行の銘柄名は、公開の索引を読めないため 未検証 で、再現側に余分な行がある可能性もある。

- CI ログに掲載行として名前が出る 35 銘柄（PayloadMismatch の 10 と、Code 33 が不明の 25）は、すべて再現の 980 行に入っている（実測）。
- 代用の足の行は、Setup Engine の結果も公開と違いうる。例として MFC のピボットは再現で 44.54、feature-run では 43.81。

## 中身

- rows.jsonl：掲載 980 行。各行に次を収める。
  - 終値、ピボット、Setup Engine の値。
  - setup_ready と不合格の理由。
  - ステージとその入力。
  - トレンドテンプレート8条件（ステージは条件に入れない）。
  - RS推計（IBD RS ではない）。
  - ベースの長さと深さ、310 本の日足。
  - backend の feature-run の値。比較用に区別して収め、画面には出ない値。
- ready43.jsonl：setup_ready 合格の 37 行。
  - 一覧（流動性の条件あり）に出るのは 18 行。
  - 7 行は代用の足。
- examples.json：
  - PayloadMismatch の例は HTFL。
  - fiscal_q4_untagged の例は 未検証。銘柄名がどこにも出ないため。
  - 準備未達で順位の高い 10 行。
- charts/：アプリの実物の株価チャートカード。
  - 390×844 で 48 銘柄 × 6か月・週足。
  - 1440 で 6 銘柄。
  - Chrome for Testing 147 と CI のフォントで描画。ページのエラーは 0。カードの高さはすべて 508。

## 未収録

- SEC の記録。
- 公開の索引と詳細。
- 決算日、機関投資家、市場トレンド。

いずれも release asset にない。または取得先が遮断されている。画面の「SEC 未配信」は、このスナップショットでは 未収録 の意味。
