# STATE — Round 3 統合（claude/r3-integration）

更新 2026-11-16（時刻はすべて日本時間）。

- main は 45603f06（#145＝round 3 の STEP 0 のマージ、11-14 14:33）。その前に #144（D1、11-14 00:00）。
- この branch は、round 3 の 4 トラック（DATA・R・MARKET・CHART）の統合。統合の記録は docs/round3/integration.md、履歴は docs/PROGRESS.md の 11-16 の周期。
- 統合では、push・PR・ワークフローの起動・本番の再取得や公開・キャッシュの削除をしていない。PR は、検証の後に指揮役が開く。

## 公開の状態

- round 2 の UI（8849bf9）は 11-13 06:13 に Pages へ反映した。Research UI Release 43298315833、UI のみの再公開。
- 11-12 のデータ：
  - 10:14 の公開（Static Site 43314500446 → Research UI Release 43336886875）では、put_call・long_history・long_breadth・sp500_history・sector_rs・sector_breadth・chart_coverage が 11-12 に届かなかった。
  - 補完の Static Site 43347653915 は、producer-price-history.mjs:59 で失敗した。
  - 監視が起動した Static Site 43385558863（16:24〜19:20）で、長期の市場履歴が 11-12 になった。Research UI Release 43408634161（19:22〜20:10、UI 8849bf9）で、20:10 に公開した（掲載 998 行。計画 §1.1、docs/round3/snapshot.md）。
- 11-13 のデータ：Static Site 43510864288 の公開で、D1 の効果を読んだ（下の「実データ」。指揮役の記録）。この公開の Research UI Release の run id と時刻は、この文書の材料に無い。
- #144（D1）と #145（STEP 0）は main にマージ済み。
  - STEP 0 は、既定のフィクスチャで見える変化が無い（STEP 0 の記録）。
  - #145 の後に UI の再公開があったか、Pages の UI がどのコミットかは、この統合では読んでいない（未検証）。
  - 11-14 以降のデータ公開も読んでいない（未検証）。
- round 3 の統合は、何も push・公開していない。この合流の前のエクスポーターは、インデックスに `se_pivot_date` を書かない。だから、今 Pages にある公開は、round 3 の UI から見ると「古い公開」の形になる（下の「次の行動」の 3）。
- 公開の仕組みの既知の不具合（round 2 以前から。round 3 の範囲外で、直していない。計画 §8 の O1〜O4）：
  - 監視が、上流のバンドルより前に同じ日の再取得を起動し、それが producer-price-history.mjs:59 で必ず落ちる（11-06・11-11・11-13）。
  - `require_current` は、セクター ETF の 1 本の悪い足で、長期履歴の 5 系列をまとめて捨てる。どの ETF かは要約に出ない。
  - AMD の RS 文脈の失敗（原因は未調査）。

## 統合の実測

時刻は 11-16。断りがなければ HEAD のコード（bbcb8753）で、CI と同じ設定（Chrome for Testing 147 の headless shell、CI のフォント、Node 22、ポート 4425）。コマンドは docs/round3/integration.md (f)。

- **合流**：4 つの head（5e580ce7・0127a472・9d47af63・143c5b38）は HEAD の祖先。所有の関門は 4 つとも OK。文字の衝突は無い。
- **エントリーチャンク**：133.85 kB gzip（線 134.00、12:26）。STEP 0 は 130.28 で、4 トラックを合流しただけなら 135.96 だった。
  - D3 の表示の保留（−1.33）と、市場タブだけのコードの遅延チャンクへの移動（B2、−0.80）で線の下に入れた。
  - MarketScreen は 34.03、priceChart は 18.57。
- **vitest**：252 ファイル・4264 本すべて通過（12:28〜12:33）。
- **静的 Playwright**：570 本通過・失敗 0・スキップ 0（12:43〜13:08）。R1・R2 の目標と、INTEGRATION のテスト（古い公開は前と同じに描く）が有効。
- **lint**：エラー 0。警告 4 は前から。
- **.github/scripts**：2067 本で、通過 2063・失敗 2・スキップ 2。失敗 2 はサンドボックスだけの既知のもの。
- **ほかのテスト**：更新のライフサイクル 1/1・2/2。test_sec_financials 54・export 4・8k 5。集め手 34。
- **backend**（8e45a596 で測った。backend はその後 HEAD まで不変）：
  - gate-1 304・gate-2 47・gate-3 152・gate-4 21・gate-5 43、gate-check OK。赤線は範囲の違う 2 回で、どちらも失敗 0：P2 の 293 passed（8e45a596）と、契約のテストを足した指揮者の 326 passed（bd205842）。コマンドは integration.md (f) 3b。
  - 凍結の 908 は「FIRE±5 +25.8pp, SETUP +52.0pp」で不変（SETUP 列は Markets360）。
  - H4 は 28/588 対 23/575（+0.8pp、STEP 0）→ 29/588 対 21/575（+1.3pp）。動いたのは、ゲート 8・SE のステージ・ready・price_pinned だけ。
- **プローブ**：
  - 492 画面のプローブは、CHART だけの木と同じ（sha256 69ce3c5a…a326）。8849bf9 との差は CHART の項目だけ。
  - オラクルのプローブの差は、名指した項目と、帰属のある R1・R2 の 1440 のカードの高さだけ。
  - ダンプの 8849bf9 との差 31 画面は、すべて帰属あり。
- **高さ（375×812）**：
  - Today 1342／1388、候補 593／708、ウォッチ 442／508、市場 1228／1288、ZZNV 3044／3388。STEP 0 と同じ。
  - FTD の食い違いの状態は 1300／1322（OD5 のまま）。
  - 'stalls' は 3114／STOCK_CAP 3124（変えていない）。
  - M1c（200 日線の下）は 1242。M4 のタイルは 115.8。チャートのカードは、1440 の週足だけ +21.19。
- **時間**（静かな機械。開始の loadavg 0.50。8849bf9 と交互に 7 回）：
  - 1440 の最初の表示の最長タスクは、中央値 241ms（8849bf9 は 334ms）。200ms は満たさない。
  - 390 の期間の切り替えは 182.5ms（8849bf9 は 190.5ms）。
- **再構築の数**（11-12 の再構築の数で、公開版の数ではない。基点 → 統合）：
  - 準備：掲載行で 37 → 26、全体で 82 → 26。D2 の分割は、流動性あり 11・なし 15。
  - 低変動の掲載行：17 → 24。PCRX は流動性のある行の 1 位から 1819 位。
  - 失敗ブレイク：21 → 14。
  - 収縮を描く行：187 → 229。上抜けの後の脚からの損切り：76 → 0。
  - R5 の一行：17。
  - インデックス（近似）：+8,335 バイト gzip。
- **出力のスイッチ**：`Q4_EPS_REFERENCE_EMIT = False`（sec-financials.py）、`EMIT_R3_MARKET_FIELDS = False`（collect-market-history.py）、`EMIT_R3_MARKET_FIELDS=false`（export-market-trends.mjs）。
  - admission は `q4EpsReference` を持つ記録を拒む（表示を保留したため）。

## 実データ

### 11-12 のデータ・10:14 の公開（Research UI Release 43336886875。round 2 の backend の最初の公開。round 2 の I7）

- 掲載 941（11-11 は 1018）。選定のコードは変わっていない。チャート認証済みの銘柄が 4535 → 4187 に減ったため（初回の取得で更新失敗 781、うちレート制限 51）。掲載の割合は、日によらず約 22.5%。
- SEC：記録 941／941、四半期あり 752（79.9%）。
  - sec_state：ok 732・stale 10・q4_annual_only 1・no_cik 1・no_companyfacts 5・no_quarterly 82・no_quarterly_values 2・invalid_payload 101・invalid 7。
  - invalid_payload 101 の原因は、すべて PayloadMismatch（例 GFR・RSKD・HTFL・SN・TBBB・AII・ECO・CART・GRDN・BRZE）。
- Code 33 の EPS 加速が不明の 404 行の、主な原因は fiscal_q4_untagged 373。
- code33_parts：Code 33 の EPS 加速 合格1・不合格327・不明404、売上加速 118・511・103、利益率改善 80・549・103。Code 33 合格0・不合格623・不明318。
- setup_ready 合格 41／941（11-11 は 0／1018。CH12 の効果）。不合格の上位は、outside_early_zone 694、readiness_below_threshold 685、volume_above_dryup_cap 411、stage_not_ok 255、rs_leadership_insufficient 148。
- ステージ（feature-run のバンドルから。掲載行ではなく backend の全 9915 行。CH11 の効果）：
  - 200 日線が上向きで、その上で横ばいの行のステージ 3：11-11 は 489 中 489（100%）、11-12 は 418 中 43（10.3%）。
  - テンプレート通過行のステージ 3：41.5% → 18.4%。
- 一覧の要約：rs_line_high は 941 行で認証済み（真 16）。sec_summary は 941 行（EPS 前年比 537・売上前年比 645）。se_pattern_primary は 941 行。

### 11-12 のデータ・20:10 の公開（Static Site 43385558863 → Research UI Release 43408634161。計画 §1.1、CI ログからの実測）

- 掲載 998 行。setup_ready 合格43・不合格955。不合格の上位は、outside_early_zone 735、readiness_below_threshold 726、volume_above_dryup_cap 435、stage_not_ok 272。
- SEC：記録 998／998。ok 775・invalid_payload 112（すべて PayloadMismatch）・no_quarterly 84・stale 11。
- Code 33 の EPS 加速が不明の行のうち、fiscal_q4_untagged 398。
- code33_parts：Code 33 の EPS 加速 合格2・不合格342・不明431（これは 25% の下限の数ではない）。Code 33 合格0。
- round 3 の再構築（掲載 980・準備 37）は、この公開の再現。公開版の 998 行・43 行の銘柄名は 未検証。

### 11-13 のデータ（Static Site 43510864288。D1 の効果。指揮役の記録で、この統合では読み直していない）

- invalid_payload は 159 → 0（11-12 の build の全体の数から）。
- SEC payload cik：{int:read 1089, digits:read 107, int:no_quarterly 122, digits:no_quarterly 47}。
- 掲載 927、四半期ありの掲載行（with_quarters_listed）813。
- code33_parts：Code 33 の EPS 加速 不明457（合格2）。Code 33 合格0・不合格672・不明255。

### 実データの速さ

- round 2（3584d52）の Design Acceptance（11-11 のデータ、CPU 4 倍、中央値。括弧は予算）：
  - 390：最初の候補 1755ms（3500）、タブ切替 153ms（400）、銘柄を開く 360ms（1000）。
  - 1440：タブ切替 210ms（400）、最初の表示の最長タスク 236ms（200、超過）。
  - 超過は、オーナーの速度の保留の承認（docs/design-review/owner-waiver.json）で、保留の警告として通る。
- #145 の Design Acceptance（CI）：1440 の最長タスクは中央値 779ms（保留の警告。指揮役の記録）。
- round 3 の統合の木の CI での値は 未検証。サンドボックスの静かな機械の値は、上の「統合の実測」。

## 未検証

- **公開版の効果のすべて**。round 3 の数は、すべて 11-12 の再構築のもの。
  - R2 の新しい規則、`price_pinned`、ゲート 8、インデックスの `se_pivot_date` は、公開のデータの側で決まる（エクスポーターと再計算）。だから、効くのは新しいエクスポーターの最初のデータ公開から（コードを読んでの推論）。
  - PAG が公開版で低変動になるかも未検証（作業者は、エクスポーターの監査がその日足を拒むと報告）。
- CI と Design Acceptance（統合の木）。1440 の最長タスクの CI の値。
- 391〜1023px の幅。新しい行の axe・明るい表示・200% の拡大。
  - 対象は、R5 の一行、R6 の新しい理由、MARKET の行、C4 の行、D4 の印。
- 実データの描画：
  - R6 の新しい理由（「…割り込み済み」「収縮はすべて…」）は、どこにも描いていない（320 の折り返しを含む）。
  - 「最後の収縮の安値」の線を失う 61 行。
  - 新しく準備の AVTR・SHEL・VSTM。
  - 再構築の描画で強制のラベルが増えた 17 画面の画素の目視。文字の箱どうしの重なりは指揮者が計算した（HEAD で 12 画面・最大 1.5px、基点 c61bf96 で 13 画面・最大 1.2px、2px 超は 0）。
- 割り込みの規則が ISO でない日付の足を飛ばすこと：認証がそのような足を拒むかを、確かめていない。
- `contraction_unconfirmed`（readiness.py の移植は切れ目の前の測り方のまま）が、切れた行でブリーフと違う回数。
- 保留を戻したときのエントリーの大きさ（見込み 約 135.2 kB で、測っていない）。
- D3 の精度。実データで `code33_parts.eps_acceleration` が旧集計の数と同じこと。EPS 加速の合格銘柄と提出書類の照合。
- MARKET の実データの値：^GSPC／^IXIC、M0 の行、分配日の段階、FTD の行の読み、M8 の値、M9 の回数、長期履歴のキャッシュの取り直し。
- M1c の印の付いたラベルの、マウントされない部品（entryReadiness の文、PortfolioDecision／PortfolioPlanDrawer）での折り返し。ブリーフからは届かない。
- インデックスの大きさのトラックごとの内訳と、公開版での値。
  - 公開版は 868,379 バイト gzip。R1 の +6,312 を足した見込みは 874,691（R の記録）。
  - 統合の木の再構築の +8,335 を足すと、見込みは 876,714。どちらも 1,000,000 の内側。
- I2 の 9（文言の規則）は、指揮者が追加された行の grep と作り手を読んで確かめた（空）。描いた画面で読んだのは、再構築の描画の範囲だけ。

## オーナーの判断

既定のまま進めたもの、統合で決めたもの、オーナーに残す選択肢。

- **JS の線（規則 21）**：134.00 kB gzip のまま。線は上げず、build の target も変えていない。
  - オーナーの選択肢 1：`--target es2022`。4 トラックの木で 131.76 kB（実測）。ブラウザーの対応範囲と、線を決めた物差しが変わる。
  - オーナーの選択肢 2：別の線を決める。
  - どちらかを選べば、下の D3 の表示の保留を戻せる（段は使っていないので、ほかに戻すものは無い）。
- **OD1 Q4 EPS**：数えない（既定）。
  - 出力（`Q4_EPS_REFERENCE_EMIT`）は off のまま。
  - **既定からの逸脱**：統合で D3 の表示を保留した（cc326e9a）。表示はトラックのブランチ上で作ってあるが、出荷しない。
  - 戻し方は `git revert cc326e9a`。ただし約 1.33 kB 増えて線を超えるので、上の JS の線の選択肢が先に要る。
  - 戻す前に決めること：publishedContracts.js の `q4EpsReference`、赤字の参考四半期の言い方（「前年比 −N%」ではなく「赤字」にするか）。
- **OD2**：遅延のチャートの分割を残す。速度の保留の承認もそのまま（1440 の最初の表示は 241ms で、200ms を満たさない）。
- **OD3**（`EARNINGS_CHIP_PERCENT` 25）・**OD4**（`FRESHNESS_GRACE_HOURS` 28）・**OD5**（FTD の食い違いの 1300／1322、200 日線の下の食い違いの行の 1300 も同じ種類）：変えていない。
- **OD6 張り付きの閾値**：既定で出荷した。
  - ADR20 < 0.5%、ギャップは終値どうしで 10% 以上、ギャップの後 15 本以上で値幅 3% 未満。どれも独自設定で、チャートを見た後に選んだ。
  - 並び順の変更で、当たった行は最後に並ぶ。`price_pinned` は準備を不合格にする。
- **OD7**：`se_pivot_date` をインデックスに加えた。
- **OD8**：`sell_summary` は加えない。
- **OD9**：10 営業日と R5 の一行（出荷した）。
- **OD10**：R3b はプローブの関門で採用した。
  - H4 は +0.8 → +1.3pp で、弱い。
  - オーナーは断れる（53b82cb の revert だけ）。R4 は何も出荷しない。
- **OD11**：setup_ready は流動性で分けて報告する。
- **OD12**：Finance-Blank Check を外さない。**OD13**：CIK が欠けた記録は失敗のまま。
- **OD14**：「SEC 読取エラー」の表記と Today の警告は、まだ変えていない。D1 の結果（11-13 で invalid_payload 159 → 0）を見たうえでの判断が残る。
- **OD15・OD16**：変えていない。
- **「ピボットの日 未確認」の 1024px 未満の行**：出さないまま（CHART の指揮者の決定）。
  - 出すには STOCK_CAP 3145（+21px）と、StockVcpCard.jsx の条件の変更が要る。
- **MARKET**：
  - M4 のタイル 115.8px と、M1c の +27px は受け入れた。
  - M1e に猶予期間を置かない。次の取引日の引けから公開まで（推論で約 14 時間）、更新待ちの判定が出る。
  - ストーリング日の 5% の規則（後の終値が 5% 上なら外す、backend の数え方）は、出力を on にする前に決める。入れるなら method id も変える。
  - OD-M1〜OD-M9・OD-M11 は既定のまま。OD-M10 は下の「次の行動」の 5。
- **ZZHB の 1y／320 の「150」**：R6 の後は描かれない。配置器の規則（空きが無ければ描かない）のとおりで、受け入れた。

## 次の行動

1. **I4**：指揮役が PR を開く。本文に書くこと：
   - 実測と未検証を分ける。凍結のハーネスの SETUP は Markets360（p1-5）。
   - コミット d298e19b の本文の訂正：ピボットより下の脚が無く、すべての脚が外れたとき、理由は `POST_BREAKOUT_LEGS_REASON` になる。
   - bbcb8753 を決定 E の外の編集として示す。
   - その後、CI・Design Acceptance（実データ、今の保留の承認のもと）→ マージ。
2. **I5**：UI だけの再公開。その後の定時のデータ公開を待つ。手動の再取得はしない。
3. **古い公開の間の見え方**（インデックスに `se_pivot_date` が無い公開。新しいエクスポーターの最初のデータ公開まで）：
   - 1024px 以上で「ピボットの日 未確認」。
   - 上抜けの下限と収縮の切れ目は効かない。どの画面も同じ言葉。
   - R6-P4 の割り込みの規則は `se_pivot_date` を読まないので、この間も計画のカードで効く（コードを読んでの推論。R6 の前の木の再構築では、割り込まれた使える損切りは 5 行）。
4. **I6/I7**：CI のログとリリースの asset を読むだけで測る（Pages はこのサンドボックスから見られない）。各数に run id と日本時間の時刻を添え、読めないものは未検証のままにする。読むもの：
   - `SEC q4 reference accuracy <date>` の行と、`--sec-evidence` の行の `q4_reference`。
   - `code33_parts`、`eps_floor_25`、`q4_only`、`setup_ready_liquidity`。
   - EPS 加速の合格銘柄（`eps_acceleration_pass_symbols`）。提出書類と手で照らす。
   - setup_ready と不合格の上位（`price_pinned` を含む）。
   - 低変動の行（インデックスの asset があればそこから、無ければ feature-run の再構築から）。
   - M0 の指数の行（最後の日・分配日・FTD・ストーリング日）。
   - Design Acceptance の時間（1440 の最長タスク、タブ切替、期間の切り替え）。
   - あわせて、D1 の `SEC payload cik`・invalid_payload・`with_quarters_listed`。
5. **出力のスイッチの追従（それぞれ別のコミット）**：
   - `EMIT_R3_MARKET_FIELDS` を on にするのは、次のすべての後。
     - round 3 の UI が Pages に出たことを、読取で確かめた（市場タブの開いた行に「未収録（この公開データには含まれていません）」が出る）。
     - audit-market-history.py が 5 つのキーを独立に計算し直す。
     - ストーリング日の 5% の規則を決めた。
     - その後、collect-market-history.py と export-market-trends.mjs の 2 つを 1 つのコミットで on にする。長期履歴のキャッシュのキーが変わるので、次の定期実行は全件を 1 回取り直す。
   - `Q4_EPS_REFERENCE_EMIT` を on にするのは、次のすべての後。
     - **保留のコミット（cc326e9a）の差し戻し**が Pages に出た（「round 3 の UI」が出ただけでは足りない）。
     - オーナーが精度の行を見た。
     - publishedContracts.js と赤字の言い方を決めた。
6. **次のラウンドに回したもの**：
   - R6：footprint の週数、収縮が 1 つのときの文、VCP のチップの色。readiness.py への切れ目の移植。
   - market-regime-study.mjs の説明。brief.css の「参考 M件」の色。marketRegimeReference のコメントとテスト名。metricGlossary の「3=天井圏」。
   - 再構築の描画で増えた強制のラベル（R6 の銘柄の 17 画面）の画素の目視。文字の重なりは 1 つだけ（HAFC の 6m／320、1.5px）で、指揮者が受け入れた。配置器の作り直しは、オーナーの画像への意見があるまでしない。
   - 公開の仕組みの既知の不具合（O1〜O4）。

## 絶対の制約

- トレンドテンプレートは公開の8条件だけ。ステージは9番目の拒否条件にしない。Code 33 は加点要素で関門にしない。
- 90% の品質基準を下げない。推計値やスコアを作らない。転送ハッシュの方式を変えない。RS推計を IBD RS と呼ばない。
- 欠けた値を 0・あと0・達成にしない。古いデータを当日として示さない。
- 本番の再取得・公開・キャッシュ削除で検証しない。実データの効果は公開データを読んでから報告する。
- オーナーへの時刻は日本時間で示す。
- 履歴は docs/PROGRESS.md、仕様は docs/SPEC.md。
- 出力のスイッチ（`Q4_EPS_REFERENCE_EMIT`、`EMIT_R3_MARKET_FIELDS`）は、そのキーを受け入れる UI が Pages に出るまで off のまま。Q4 の参考値は、保留のコミットの差し戻しが Pages に出るまで off のまま。
