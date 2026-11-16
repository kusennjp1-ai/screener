# Round 3 統合（claude/r3-integration）の記録

- 基点：45603f06（main。STEP 0 を合流した PR #145、11-14 14:33）。ブランチ `claude/r3-integration`、ワークツリー `.claude/worktrees/r3-integration`、ポート 4425。
- 時刻はすべて日本時間（2026-11-16）。
- 統合では push・PR・公開・ワークフローの起動・再取得・キャッシュの削除をしていない。PR は検証の後に指揮役が開く。
- 実測（コマンドつき）と未検証を分けて書く。実データの数はすべて **11-12 の再構築（rebuild）の数**で、公開版の数ではない（規則 17）。
- 指揮者の決定（拘束力あり）は、決定の記号（B〜I）で引く。
- 作業者の測定の記録（台帳、各チェックの報告、生の出力）は作業領域にあり、リポジトリには入れていない。この文書には、コマンドと結果をそのまま写した。

---

## (a) 合流した head と合流コミット

順は DATA → R → MARKET → CHART。どれも `--no-ff` の合流で、文字の衝突は無かった。

| 順 | トラック | ブランチ | head | 合流コミット | 時刻 | 差分 |
|---|---|---|---|---|---|---|
| 1 | DATA（D2・D4・D3 の作る側） | claude/r3-data | 5e580ce7 | 4d71abea | 10:43 | 13 ファイル、+2472／−65 |
| 2 | R（R1〜R6） | claude/r3-verdict | 0127a472 | 497d86d4 | 10:56 | 46 ファイル、+5269／−120 |
| 3 | MARKET（M0〜M10） | claude/r3-market | 9d47af63 | 71daaf65 | 11:32 | 29 ファイル、+4421／−230 |
| 4 | CHART（C1〜C5） | claude/r3-chart | 143c5b38 | 5a380c66 | 12:20 | 15 ファイル、+2758／−93 |

統合のコミット（first-parent の順。すべて Conventional Commits で、作業の指示どおりの 2 行の trailer で終わる）：

| コミット | 内容 |
|---|---|
| 4d71abea | `chore(integration): merge track DATA (claude/r3-data 5e580ce7)` |
| cc326e9a | `chore(frontend): hold the reference fiscal-Q4 EPS display until the entry chunk has room`（D3 の表示の保留。下の (c) B1） |
| 497d86d4 | `chore(integration): merge track R (claude/r3-verdict 0127a472, R1-R6)` |
| 10ed34ba | `test(frontend): put the plan card fixture's contraction low on the last bar` |
| a6fbcf2d | `fix(frontend): read the pivot's date from the index row only` |
| 7f843b8f | `docs(round3): name GDL as the one row where lowRange and price_pinned differ` |
| 8e45a596 | `docs(backend): say gate 8 reads the scanner's published stage` |
| 71daaf65 | `chore(integration): merge track MARKET (claude/r3-market 9d47af63)` |
| c7b8e6c8 | `fix(frontend): name the long-run breakout series as the market rows do` |
| fab16940 | `refactor(frontend): keep market-tab-only code in the lazy market chunk`（下の (c) B2） |
| 5a380c66 | `chore(integration): merge track CHART (claude/r3-chart 143c5b38)` |
| 4c452419 | `test(frontend): follow the v3 technical evidence in the chart card tests` |
| bbcb8753 | `test(frontend): put the chart legend fixture's contraction low on the last bar` |
| 02fe2060 | `docs(round3): record the round 3 integration`（この文書） |
| 367163ec | `docs: fold the round 3 vocabulary into CONTEXT.md` |
| 60106226 | `docs: append the round 3 integration cycle to PROGRESS.md` |
| 32b4f67f | `docs: overwrite STATE.md for the round 3 integration` |
| bd205842 | `docs(round3): label the forced-label rise as a rebuild count and record the final checks`（指揮者が検証した HEAD） |
| （その後） | 指揮者の検証の結果に、この文書・STATE.md・PROGRESS.md を合わせる docs のコミット 1 本 |

実測（15:1x、loadavg 0.00）：

- 4 つの head がすべて HEAD の祖先：`git merge-base --is-ancestor <head> HEAD`（5e580ce7・0127a472・9d47af63・143c5b38）→ 4 つとも真。
- 所有の関門：`python3 -I $S/audit3/check-ownership.py <TRACK> <track worktree> 45603f06…` → `OWNERSHIP OK (DATA): 13 paths`、`OWNERSHIP OK (R): 46 paths`、`OWNERSHIP OK (MARKET): 29 paths`、`OWNERSHIP OK (CHART): 15 paths`。合流の前にも、各パッケージが同じ関門を通した。

---

## (b) トラックの所有の外、または凍結のファイルへの編集（1 行に 1 件）

確かめ方（実測、P6）：

- `git diff --name-only 45603f06 HEAD` のうち、どのトラックの差分（`git diff --name-only 45603f06 <head>`）にも無いファイルは 9 件だった。
  - useBriefData.js、StockPlanCard.test.jsx、MarketHistoryExplorer.jsx、新しい 3 つのモジュール、probe_setup_ready_908.py、se_h4 の手引き、test_golden_scanner.py。
- トラックのファイルで合流の後にまた変わったもの（`git diff --stat <head> HEAD -- <そのトラックのファイル>`）は次のとおり。
  - DATA：9 件。保留の差し戻し。
  - R：2 件。verdict.md と brief-invariants.spec.js。
  - MARKET：5 件。B2 の 4 件と brief-market.spec.js。
  - CHART：1 件。StockChartCard.test.jsx。
- 下の表はこれで全部。docs の 4 ファイルは、この記録のコミットで加わる。

| # | ファイル | 変更 | 理由 | 依頼したトラック | コミット |
|---|---|---|---|---|---|
| 1 | frontend/src/static/brief/useBriefData.js（どのトラックの範囲でもない。R の記録は凍結と呼ぶ） | useStockData の行の memo で、合わせた行から「要約（インデックスの行）が持たない se_pivot_date」を消す。上抜けの下限（R1）、収縮の切れ目（R6）、ピボットの日（C4）は、インデックスの行だけを読む | 規則 18。古い公開（インデックスに se_pivot_date が無く、詳細にはある）で、銘柄画面とウォッチ行・Today が同じ銘柄を別々の言葉で言わないため | R（R1 の必須の依頼 1、R6 の依頼 2） | a6fbcf2d |
| 2 | frontend/tests/static/brief-invariants.spec.js（R） | `test.fixme('INTEGRATION: an index without se_pivot_date and a detail with it leave the stock screen and the watch row both unbounded'` を `test(` にした | 1 の行が入ったので目標のテストを有効にした | R（R1 の依頼 1） | a6fbcf2d |
| 3 | frontend/src/static/brief/StockPlanCard.test.jsx（持ち主なし） | `measured()` の収縮の安値を足 190 から最後の足 199 へ（2 か所）。注釈は「最後の足が安値を持つので、後の足が割り込まない」 | R6-P4（後の足が割り込んだ安値は構造の損切りにしない）で、フィクスチャの安値が後の足に割り込まれ、5 本が落ちた。フィクスチャだけを変え、アサーションは変えていない（規則 G） | R6（R6-P4 の依頼 1） | 10ed34ba |
| 4 | frontend/src/static/brief/StockChartCard.test.jsx（CHART） | `version: 'book-technical-evidence-v2'` の 2 か所を、書き出した定数 `BOOK_TECHNICAL_VERSION` に | R6 が版を v3 にした。StockView は版が違う証拠を測り直すので、v2 の文字列のフィクスチャの脚が置き換わった。テストの意味は「今の版の証拠」なので定数から | R6 と CHART が出会うところ（R6 の依頼 3） | 4c452419 |
| 5 | frontend/src/static/brief/StockChartCard.test.jsx（CHART） | C3 の凡例のフィクスチャで、2 つ目の収縮の終わりと安値を最後の足（`list[199]`、`bars: 30`）にした。期待の安値は `list[199].low`（`toBeCloseTo(80.77, 2)`、旧 84.03） | R6-P4 と CHART の C3 のテストが出会うところ。最後の足の安値 80.77 が 2 つ目の収縮の安値 84.03（足 175）を割り込むので、計画に構造の安値が無くなり、C3 の 5 本が落ちた。凡例の文の照合は今までどおり作り手 `structuralLowLegend(low)` を通す。`80.77` はフィクスチャ自身の足の値を固定する数で、緩めたアサーションは無い | **決定 E の一覧に無い**（どのトラックも名指ししていない。原因は 3 と同じ）。指揮者の検証で受け入れた：変えたのはフィクスチャとその固定値だけで、照合は今までどおり `structuralLowLegend` を通す（規則 G に合う） | bbcb8753 |
| 6 | frontend/src/static/components/MarketHistoryExplorer.jsx（持ち主なし） | 長期推移の指標の名前を `BREAKOUT_HOLD_NAME`（briefEnvironment.js）から読む。「ブレイクアウトの成功率」→「上抜け維持（確定分）」 | 1440 の同じ市場画面で、環境の行と同じものに 2 つの名前が付いていた | MARKET（依頼 9） | c7b8e6c8 |
| 7 | frontend/tests/static/brief-market.spec.js:97（MARKET） | 照合を `[BREAKOUT_HOLD_NAME, '10日間 −7%に届かず']` に（spec がすでに読み込んでいる定数） | 6 に合わせる | MARKET（依頼 9） | c7b8e6c8 |
| 8 | frontend/src/static/brief/marketTabOnly.js（新規、どの範囲の外） | marketTabModel.js の `indexCloses`・`groupDate`・`signedPercent`・`STAGE_FIELDS`・`SURVIVORSHIP_NOTE`（再 export）と、marketCardView の上抜けの塊（rate・judgedNow・whyNot・breakoutRule・breakout。`breakoutView`）をここへ移した | 規則 21。Today が読み込むモジュールから、遅延読み込みの市場画面だけが読むコードを出し、市場のチャンクに入れる | 決定 B2 | fab16940 |
| 9 | frontend/src/static/brief/marketTabEnvironment.js（新規、どの範囲の外） | briefEnvironment.js の `gspcFollowThrough` を移した（再 export、gspcFtdDisagrees のために import） | 同上 | 決定 B2 | fab16940 |
| 10 | frontend/src/static/marketHistoryWindow.js（新規、どの範囲の外） | marketLongHistory.js の `historyWindow` を移した（素の Node のツールのため拡張子つきで再 export） | 同上 | 決定 B2 | fab16940 |
| 11 | MARKET のファイル 4 つ：briefEnvironment.js、marketTabGroups.js、marketTabModel.js、marketLongHistory.js | 8〜10 の移動の残り（再 export と import）。marketTabParts が上抜けの塊を計算し、marketCardView は breakout と judgedNow を渡さなくなった。文言・定数・分岐の変更なし | 同上 | 決定 B2 | fab16940 |
| 12 | backend/scripts/probe_setup_ready_908.py（凍結） | モジュールの docstring の「SE stage」の定義だけ（quick_stage_check ではなく、スキャナーの公開するステージ） | R3b の後に古くなった説明。コミットの本文：docstring を除いた AST は同じで、プローブの数は動かない | R（依頼 11） | 8e45a596 |
| 13 | docs/setup_engine/se_h4_formula_dictionary_operator_runbook.md（持ち主なし） | stage の項目の行、stage の式、「ステージ 1 か 2 でゲート 8 に合格」と書いた 3 か所 | 同上 | R（依頼 11） | 8e45a596 |
| 14 | backend/tests/unit/golden/test_golden_scanner.py（R の範囲の glob の中。R は変えていない） | 3WT のケースで stage_ok を挙げない理由の注釈（コミット済みのスナップショットはステージ 2、stage_ok 合格） | 同上。注釈だけ | R（依頼 11） | 8e45a596 |
| 15 | docs/round3/verdict.md（R） | R3a の一致の検査の節に 1 行：GDL がインデックスで lowRange（125 行）と price_pinned（124 行）が違うただ 1 行。理由は、掲載外の行で、再計算は代理の包絡の日足、research.json の price_activity は監査済みのチャートの日足を読むこと。同じ日足どうしの一致は 5,955／5,955 のまま。再構築の数 | R の未解決の小さな指摘（minor） | R（open minor） | 7f843b8f |
| 16 | DATA のファイル 9 つ：bookFinancialAdmission.js（＋test）、StockFundamentalsCard.jsx（＋test）、brief-fundamentals.css、fundamentalsExplain.js（＋test）、brief-fundamentals.spec.js、tools/test_sec_financials.py | D3 の表示の 5 コミット（07bcd93d・c770fd31・2acdaaf4・11c59c5b・d4eb1fd6）を 1 コミットで差し戻した（`git revert --no-commit`） | 規則 21（下の (c) B1）。作る側・精度の行・`Q4_EPS_REFERENCE_EMIT = False` は残した | 決定 B1 | cc326e9a |
| 17 | CONTEXT.md、docs/STATE.md、docs/PROGRESS.md（凍結） | round 3 の語彙を入れ、周期を 1 つ足し、STATE.md を書き直した | 計画 §7 I3。各トラックの記録の語彙の依頼と、DATA の STATE.md の文言の訂正の依頼 | DATA・R・MARKET・CHART | この記録の後の docs のコミット |
| 18 | docs/round3/integration.md（新規） | この記録 | 決定 E：所有の外と凍結の編集をすべてここに書く | 統合 | この記録のコミット |
| — | `STOCK_CAP`（brief-decision.spec.js、R） | **変えていない**（3124）。'stalls' はどの合流の後も 3114（下の (c) C1） | — | — | — |

---

## (c) 指揮者の決定と、その根拠

### B. JS の予算（規則 21、線は 134.00 kB gzip）

エントリーチャンクの推移。実測は `$H/build/run-build.sh <worktree>`（HEAD の `git archive` で `npm run build`）。遅延チャンクは同じ実行の Design Acceptance の build（`VITE_STATIC_SITE=true VITE_BASE_PATH=/screener/ npx vite build`）の vite gzip。

| 木 | エントリー（gzip kB） | MarketScreen | priceChart | 測った人 |
|---|---|---|---|---|
| 45603f06（STEP 0、c61bf96 と同じコード） | 130.28 | 29.76 | 18.25 | STEP 0 |
| DATA だけ（5e580ce7） | 131.88 | 29.76 | 18.24 | DATA の指揮者 |
| DATA＋保留（cc326e9a） | 130.52 | 29.76 | 18.25 | P1 |
| ＋R（8e45a596） | 132.52 | 29.76 | 18.25 | P2 |
| ＋MARKET（c7b8e6c8、B2 の前） | 133.81 | — | — | P3 |
| ＋B2（fab16940） | **133.01** | 34.03 | 18.25 | P3 |
| ＋CHART（bbcb8753、HEAD のコード） | **133.85** | 34.03 | 18.57 | P4（12:26、loadavg 0.02） |

- bbcb8753 の Design Acceptance の build では、エントリーは 133.64 kB（vite gzip）、133,462 バイト（gzip -9）。
- 計画のときの指揮者の実測（4 つの head の文字の合流の木 f12121ea）：
  - 編集なしで 135.96。D3 の表示を外すと 134.63。D3 の表示と R5 を外すと 134.17。
  - 遅延のみの export をすべて抜いた上限：135.02（合流のまま）、133.70（D3 の表示を除く）。
  - 2 回目の測定で、D3 の表示を除き B2 の移動を入れ R5 を残した木（E）は 133.83。これが命じた終わりの形。
  - `--target es2022` は 131.76。情報としてだけ測った。命じていない。
- **B1 D3 の表示だけを保留した**（cc326e9a、−1.33 kB）。
  - 理由：今のどの公開でも表示は使われない（`Q4_EPS_REFERENCE_EMIT = False`）。計画は D3 を切り離せる作りにした。作る側と `SEC q4 reference accuracy` のログの行は残るので、オーナーは OD1 が求める数を受け取れる。
  - **OD1 の既定（「出力オフのまま作る」）からの、記録した逸脱**：表示はトラックのブランチ上で作ったが、出荷しない。
  - **規則 18 の帰結**：出力は、**保留のコミットの差し戻し（revert）が Pages に出た後でなければ** on にできない。「round 3 の UI が Pages に出た後」では足りない。
  - 指揮者の決定の原文（B1）：
    > This is a recorded deviation from OD1's default 'built with emission off' (the display is built, on the track branch, not shipped). CONSEQUENCE (rule 18): emission may be switched on only after THE REVERT OF THE HOLD COMMIT is live on Pages, not merely 'the round-3 UI'. Write it that way everywhere.
    - data.md の OD1 の文（「round 3 の UI が Pages で動いていることを確かめた後」）は、この保留で置き換わる。data.md は DATA の文書なので編集していない。
  - **戻し方**：`git revert cc326e9a`。
    - ただし、この HEAD のエントリー 133.85 に表示の約 1.33 を足すと約 135.2 で、134.00 を超える。足し算の見込みで、測っていない。
    - だから戻す前に、次のどれかが要る。オーナーが別の線を決める。オーナーの選択肢として `--target es2022`（4 トラックの木で 131.76、実測）。または、さらに遅延チャンクへ移す。
    - `--target es2022` はブラウザーの対応範囲と、線を決めた物差しを変える。統合では選んでいない。
- **B2 市場タブだけのコードを遅延の市場チャンクへ移した**（fab16940、133.81 → 133.01、−0.80）。
  - 関門（実測、P3）：ダンプが前後で同じ。`$H/dump/run-dump.sh` で c7b8e6c8 と fab16940 がどちらも sha256 fa971a67…afa6、42 画面、エラー 0（11:44〜11:57）。
  - 市場の 3 つの spec 146 本が通った（6.1 分）。移動にかかわる 16 ファイルの vitest は 295 本すべて通過した。全部の vitest は 4183 本通過・失敗 1 で、失敗は CHART の合流で直す既知の StockChartCard.test.jsx だった（(b) 4）。テストは変えていない。
- **B3 CHART の合流の後の関門（≦ 133.90）**：133.85。**段（ladder）は一つも使っていない**。R5 は出荷する（OD9 の既定のまま）。線を上げていない。build の target も変えていない。

### C. 保留の行と高さ

- **C1 STOCK_CAP**：'stalls'（brief-decision.spec.js の 375 の場合）は合流の後のどの木でも 3114（STOCK_CAP 3124、余り 10）。
  - P4 の実行 cc326e9・8e45a59・fab1694・bbcb875 はどれも [3114, 3001, 3240]。P5 の再実行（14:07〜14:08、loadavg 2.25）も 30 本通過で同じ。
  - だから STOCK_CAP は変えていない。凍結の STOCK_LINE 3388 にも触れていない。
- **C2「ピボットの日 未確認」**：1024px 未満で土台の注記が無い銘柄では、**出さないまま**（CHART の指揮者の決定）。
  - 理由：出すには +21px（STOCK_CAP 3145）が要り、電話の読み手が使える価値を足さない。戻していない。
  - 戻し方は chart.md の通り：StockVcpCard.jsx の `(wide || pivotDay !== PIVOT_DAY_UNKNOWN)` を外し、決定を固定するテスト（StockVcpCard.test.jsx の 1024px 未満の場合、brief-chart.spec.js の ZZNV の describe）と STOCK_CAP を直す。
- **C3 MARKET**：次の点は受け入れた。
  - M4：Today の地合いタイルは 375／390 で 115.8px（既存の「FTD確認済み」のタイルと同じ高さ。新しい状態ではない）。P5 の実測も 115.8。
  - M1c：200 日線の下で電話の閉じた市場タブが +27px（375 で 1242 ≦ 1288。50日線割れの状態と同じ）。
  - M1e：猶予期間を足していない（このままで正直。オーナーの判断）。
  - M2：経過日数を先頭に置く。M3 の短い形は「▲ 1」「○ 1」。
  - M8c：名前は「上抜け維持（確定分）」。MarketHistoryExplorer の名前もこれに合わせた（c7b8e6c8）。
  - M8d：ストーリング日は 25 営業日の失効だけ。backend の 5% の外し方は、出力を on にする前に決める。今は決めない。
- **C4 ZZHB の 1y／320**：R6 の後、150 日線の名前「150」は描かれない（その場所を「T1 −23%」がとる）。
  - 配置器の規則「空きが無ければ描かない」の通り。計画は配置器の作り直しを禁じる。
  - オラクルの差分の予想の中にある。オーナーに伝える（下の (e)）。
- **C5 useBriefData.js の 1 行の帰結**：下の (e) 4。指揮者の決定の原文（C5）：
  > The useBriefData.js line makes every reader of the pivot's date use the index row. On today's live publication (index has no se_pivot_date) the stock screen therefore shows 「ピボットの日 未確認」 at 1024px and wider, no crossing floor and no contraction cut, exactly as the watch rows, until the first data publication from the new exporter. Honest (未確認, never a guess) and one wording per stock; recorded for the owner.
  - 統合の注記：R6-P4 の割り込みの規則は `se_pivot_date` を読まないので、そのような公開でも計画のカードで効く。だから計画のカードは「前とまったく同じ」ではない（R6 の指揮者の記録では、割り込まれた使える損切りは R6 の前の木の再構築で 5 行）。

### D. オーナーの既定のまま出荷するもの

- **OD6** 張り付きの閾値：ADR20 < 0.5%、ギャップは終値どうしで 10% 以上、ギャップの後 15 本以上で値幅 3% 未満。どれも独自設定。並び順の変更で、当たった行は最後に並ぶ。
- **OD7** `se_pivot_date` をインデックスに加える。
- **OD9** R5 の一行を出す（段 ii は使わなかった）。
- **OD10**：R3b はプローブの関門で採用（H4 は +0.8 → +1.3pp。弱い。オーナーは断れる）。R4 は何も出荷しない。
- **OD1／OD-M10**：出力のスイッチは両方 off。
- **OD2**：保留の承認（waiver）はそのまま。C1 の時間は静かな機械で測り直した（下の (f) 8）。
- OD3・OD4・OD5・OD8・OD11〜OD16 は変えていない。

### F. 今はしていないこと（その場で足さない）

- publishedContracts.js の `q4EpsReference` と、D3 の赤字の言い方。出力の前に、表示を戻すときに一緒に決める。
- readiness.py への R6 の切れ目の移植。
  - 診断だけ。今は「切れ目の前の測り方」を移したままなので、切れた行ではブリーフと違うことがある。
  - そのことは CONTEXT.md と STATE.md に書いた。
- R6 の次の 3 つ。どれも新しい挙動なので次のラウンドに回す。
  - footprint の週数。
  - 収縮が 1 つのときの文。
  - VCP のチップの色。
- 次のラウンドに回すもの：
  - market-regime-study.mjs の説明（41・762・201・785 行）。
  - brief.css で、注意の日に琥珀色になる「参考 M件」。
  - marketRegimeReference.js:75 のコメントと、同じテストのテスト名。
  - metricGlossary.js:139 の「3=天井圏」。
- audit-market-history.py での再計算。出力の前にする。
- 出力のスイッチ 2 つ。配置器の編集。
- 次のファイルの変更：brief-fixture.js、brief-oracles.spec.js、pivotBar.js、転送、publishedContracts.js、secRecord.js、brief-compact／brief-phone の予算、owner-waiver.json、briefCandidate.js。

### G. トラックが出会うところのテストの直し

- 各トラックの指揮者が確かめた挙動は、そのまま残した。テストはフィクスチャか期待値だけを、作り手か書き出した定数を通して変えた。緩めたアサーションは無い。
- 該当するのは上の (b) の 3・4・5。5 は決定 E の一覧の外だったが、指揮者の検証で受け入れた（フィクスチャとその固定値だけ）。

---

## (d) 記録する計画の訂正

- **step0.md §6**（STEP 0 の訂正。計画と違うところは、こちらが優先する）
  1. §4.1 ZZHB の欄：結論の文言は「9/28に上抜け・4営業日前」。8849bf9 の crossingEvent は、出来高の形を上抜けの当日にだけ出す。
  2. §5 R1：`crossingFloor` の本体はピボットの足そのものの index で、「次の足」ではない。「ピボットの日足の後」は「ピボットの日足以降」。
  3. §4.1 ZZNV の欄：ZZNV の原因は `latest_row_fiscal_q4_without_eps`。`fiscal_q4_untagged` の例は ZZQF。`q4_only` は両方を数える。
  4. §4.5：ウォッチの高さは 442（5 銘柄）。495 は round 2 の古い読み。
- **DATA**
  - §5 D2 の「Rebuild run」は `--published` ではできない（再構築には SEC の記録を持つ公開の形の木が無い）。数は rows.jsonl から取った。DATA だけの木で liquid 18／illiquid 19。統合の木では 11／15（下の (e)）。
  - §5 D4：出典の注記は、スマホでは窓の中の行が算出なら必ず出す。デスクトップでは、タイルが算出に乗るときだけ（指揮者の裁定。文字どおりの規則は、1440 の凍結の銀行カードの上限 872.7 を破る）。
  - §5 D3：軸のセルに「参考」の語を書かない。スマホは行の文が名指す四半期だけに印を付け、デスクトップは凡例が鍵になる。
    - D3 の UI の計画の訂正：admitPoint は bookFinancialAdmission.js、safeSeries は bookFinancialEvidence.js にある。admission はツールの中でしか走らない。
  - D3 の切り離し方：data.md の手順（d8457cfb に 5e580ce7 を cherry-pick）は、統合では使っていない。表示の 5 コミットを 1 つの差し戻しにした（cc326e9a）。作る側と記録は残る。
- **R**
  - R1 の関門「ZZNR の矢印だけが変わる」と、R2 の関門「ZZPG のチャートは変わらない」は、書いたとおりには成り立たない。
    - ZZNR は矢印のラベルも消え、配置器が空きを埋める。
    - ZZPG は `PLAN_BLOCKED.low` で計画が止まるので、計画の水準がすべて消える（凍結の R2 の目標が求めるとおり）。
    - ほかの銘柄は変わらない。
  - R1：下限はピボットの足の index。次のことは規則の帰結として受け入れた。PR にも書く。
    - 境界の 58 行は、単純な規則の通りに日付を持つか持たない（日付つきの上抜けで失われたものは 0）。
    - 26 行は失敗ブレイクの文言だけが変わり、そのうち 9 行は、ピボットの足より前の軽い上抜けが落ちる。
    - `forgotten` は 52 → 32。
    - §5 R1 の「61」はゆるい判定の数（厳密な判定で消える矢印は 61、同じハーネスのゆるい判定は 69）。
    - 「銘柄画面はインデックスの要約から読む」は、(b) 1 の行が入って初めて成り立つ（入った）。
  - R3a：`price_pinned` は呼び出し側の失敗として渡し、11 番目のゲートにはしない（凍結のプローブのゲート表のため）。
  - R3c：`contraction_unconfirmed` は、エクスポーターが公開する候補の経路をたどる（28／37。p1 の 28 とは別の 28）。`pivot_below_base_high` の土台の起点は、一致する最初の候補（集約は選んだ候補を公開しない）。
  - R5：
    - 一行が出るのは、上抜けから `failedBreakoutSessions` 以内に初めてピボットの下で引けたときだけ（新しいしきい値なし。MSM・NEOG・TALO には出ない）。
    - 数は最安値の安値（p4 の最安の終値ではない）。
    - 売りのカードでは折りたたみの外に出す。buyGate.js は変えていない。
- **MARKET**（market.md「このトラックで計画から変えたこと」）
  - P1（M0）：本数を出せない指数は `ddDates=-`（`[]` は 0 日と同じ意味になるため）。1 営業日遅れの指数は自分の日付で出す。
  - P2（M1・M3）：
    - 200 日線の下で電話の閉じた高さが +27px。
    - M1e の電話の短い形を足し、猶予は置かない。M1b は「1年高値」。
    - 分配日の橋渡しの句は、開いた行の 1 行目に置く。
    - ▲と○の組の短い形は「▲ 1」「○ 1」。
  - P3（M2・M4）：
    - M4 のタイルは 97±2 ではなく 115.8px。
    - M2 の経過日数は値ではなく em の先頭に置く。
    - 原因行の同日の判定に、記録の asOf も求めた。
    - 年をまたぐ前回の FTD は、320 で +24px。
  - P4（M5〜M7）：
    - M7 の凡例は短い形。M6 の凡例の句は注記の文へ移し、M6 の日付は見出しにまとめた。
    - 系列が ready でないときは、銘柄側の行を出さない。
  - P5（M8 の作る側）：
    - ストーリング日は 25 営業日の失効だけ（backend の 5% の外し方は入れていない）。
    - 49 本未満は不可。
    - 早期の判定は、後の 5 営業日の安値がすべて観測されたものだけ。
  - P6：
    - M8e は新しいキーを作らず、followThroughDay の既存の `peak`・`low`・`declinePct` を読む。
    - キーが無いときの語は「未収録（この公開データには含まれていません）」。
    - 上抜けの行の名前は「上抜け維持（確定分）」。
    - ストーリング日と +3% の日は、2 つの指数を 1 行に出す。
    - 古い日は隠さず、日付を付ける。
- **CHART**
  - C3：項目は折りたためるまま（開示した訂正）。320 では「最後の収縮の安値」→「収縮の安値」→「安値」と短くして価格を残す。
  - C4 の置き場所：
    - ピボットの日は、土台の注記があればその中に書く。
    - 土台の注記が無いときの「ピボットの日 未確認」は、1024px 以上だけに出す（C2 の決定）。
    - ZZHB の行が名指すのは 9/22（高値がピボットの火曜）。9/25 は金曜のラベル、9/28 は上抜けの日。

---

## (e) オーナーに知らせる帰結

1. **並び順の変更（OD6）**。
   - 低変動・監視のみの行は一覧の最後に並ぶ。
   - 再構築では、掲載行の低変動が 17 → 24（PCRX・BWIN・PAG・PTC・BMBL・CCC・PRTH が加わる）。PCRX は流動性のある行の 1 位から 1819 位になる。
   - 理由の文「M/Dの窓開け（+44%）」の動きは終値どうしなので、窓を開けない 1 日の大きな上げも「窓開け」と呼ぶ（R の記録の注記）。
   - PAG は、公開版では出ないかもしれない（エクスポーターの監査がその日足を拒む、と作業者が報告）。
2. **準備（setup_ready）の KPI が再構築で下がる**。
   - 掲載行の準備は 37 → 29（R3a）→ 26（R3b）。全体の再計算でも 82 → 34 → 26。
   - 統合の木の D2 の分割は、流動性あり 11・なし 15（DATA だけの木では 18／19）。
   - 抜けたのは次の 14 行。
     - 張り付きの 8 行：PCRX・BWIN・TECH・ARX・CEPO・DSGR・PRTH・RNW。
     - スキャナーのステージ 3 の 6 行：GLBE・FCNCA・GEO・DJCO・RDNT・CTKB。
   - 入ったのは AVTR・SHEL・VSTM。3 行とも `pivot_already_crossed` を持つ。
3. **R3b の H4 の伸びは弱い**。
   - +0.8 → +1.3pp。エントリーが 1 件増え、対照が 2 件減っただけで、作業者の見積もりの誤差 ±1.2pp の中。
   - オーナーは R3b を断れる（OD10）。落とすときは 53b82cb の revert だけ。
4. **インデックスに `se_pivot_date` を持たない公開**では、次のようになる。
   - この合流の前のエクスポーターは、インデックスに `se_pivot_date` を書かない（R の記録）。だから、それが作った公開（今 Pages にあるものを含む）はこの形。公開そのものは、この統合では読んでいない。
   - 銘柄画面のピボットが今の Setup Engine のピボットである銘柄で、1024px 以上に「ピボットの日 未確認」が出る（ダンプでは既定の 18 画面。どれも 1440）。
   - 上抜けの下限も、収縮の切れ目も効かない。ウォッチ行・Today と同じで、1 銘柄に 1 つの言葉（未確認。推測はしない）。
   - これは、新しいエクスポーターが作る最初のデータ公開まで続く（決定 C5）。
   - 同じく、次の 4 つも公開のデータから読むので、効くのはその公開から（コードを読んでの推論。公開で確かめていない）。
     - R2 の新しい 2 つの規則（ギャップの後・ADR20）。`price_activity` はエクスポーターが書く。
     - R3a の `price_pinned`。
     - R3b のゲート 8。この 2 つは公開のときの再計算が決める。
     - インデックスの `se_pivot_date`。
   - R6-P4 の割り込みの規則は `se_pivot_date` を読まない。だから UI が出れば、どの公開でも効く（verdict.md の記録。コードを読んでの推論）。
   - 版 v3 の UI は、公開された v2 の証拠を自分のコードで測り直す（verdict.md R6）。
5. **コミット d298e19b の本文の訂正**（R6 の依頼）。
   - 本文は「前の unknown の理由はすべて変わらない」と言う。
   - 実際は、ピボットより下の脚が無く、すべての脚が外れたとき、理由は `POST_BREAKOUT_LEGS_REASON`（「収縮はすべてピボットの上抜けの後の値動き」）になる。
   - 89116e6a で注釈を直した。履歴は書き換えない。PR の本文にもこの訂正を書く。
6. **コミットの trailer についての注記**（R の記録の依頼 15）。
   - トラックのコミットは、ワークフローが指定した共著者の行を持つ。セッションの帰属の注意書きは、別のモデルを挙げていた。
   - 履歴の書き換えは命じられていない。統合のコミットも、この作業の指示どおりの同じ 2 行で終わる。
7. **R1 の効果（再構築）**。
   - 失敗ブレイクは 21 → 14。MGRC・TMP・CZFS・TBCH・OABI・JILL・ASO が外れる。保有者に誤った売りのサインを出さない。
   - ピボットの足より前の上抜けで付いていた矢印が消える（R1 の 61 行）。
8. **R6 の効果（再構築）**。
   - 収縮を描く行は 187 → 229。「毎回浅く」は 131 → 153。
   - 上抜けの後の脚からとった構造の損切りは 76 → 0。後の足に割り込まれた安値の損切りは 0。
   - 6 行（HUM・KOF・TW・NTRS・MCBS・PANL）は、切れ目の前の短い無効な最後の脚のために描かれない。そのままにした。
9. **ZZHB の 1y／320 の「150」**：描かれない（C4）。
10. **C3 の注記**：CHART の記録では、320 で HUM の安値が 1y と週足で隠れ、「上抜け」「枠＝収縮」の鍵が折りたたまれる。
    - 統合の木の再構築では、320 で安値の札を持つ銘柄は 9（BMO・DRI・GLBE・HAFC・MGRC・NBTB・RMBI・TRST・WSM）で、どの期間でも隠れていない。HUM は R6 で札を描かなくなった。
11. **1440 の最初の表示の最長タスク**は 241ms（8849bf9 は 334ms）で、まだ 200ms を超える。保留の承認はそのまま（OD2）。
12. **M1e の結論文**は、次の取引日の引けから新しい公開が届くまで（推論では毎取引日 約 14 時間）出る。上部のバーの「古い」は 28 時間後。
13. **統合の測定で見つかり、どのトラックの記録にも無かったもの**（直していない。扱いは指揮者の検証で決めた）。
    - 再構築の描画（11-12、476 画面）で、配置器が強制で置くラベルが、STEP 0 より 17 画面で増えた（CHART だけの木より 27 画面）。
      - 対象は BMO・CFBK・GLBE・HAFC・NBTB・TRST・WSM の 320／390 の画面。どれも R6 が測り直した銘柄で、新しい収縮の T ラベル。
      - フィクスチャの関門（492 画面の forcedUp は空）はこれを見ない。
      - 指揮者の計算（再構築の描画の文字の箱から。bd205842）：強制のラベルの文字が、ほかの見える文字と重なる画面は、基点 c61bf96 で 13 画面（最大 1.2px）、HEAD で 12 画面（最大 1.5px）。2px を超える重なりはどちらも 0。増えた 17 画面の中の重なりは 1 つだけ（HAFC の 6m／320、「T4 −3%」と「150」、高さ 1.5px）。指揮者は受け入れて記録した。
      - 画素の目視（ラベルとローソク足）はしていない（(g)）。
    - 320 の安値の札の集合が 13 → 9、週足の強制の行が 29 → 24（R6・R2 による。帰属は済み）。
    - 200 日線の下で基準の食い違いの行がある状態の市場タブは 375 で 1300（1288 の線の上。OD5 と同じ種類で既知）。

---

## (f) I2 の結果（実測。最終のコードの HEAD bbcb8753 で、断りがなければ CI と同じ設定）

CI と同じ設定 ＝ Chrome for Testing 147 の headless shell、CI のフォント（`FONTCONFIG_FILE=$S/ci-fonts/fonts.conf`）、Node 22、ポート 4425、workers 1。負荷のもとの時間は参考。

指揮者の検証（HEAD bd205842。コードは bbcb8753 と同じで、違うのは docs の 4 ファイルだけ）は、下の検査を自分でもう一度走らせ（15:30〜16:31、再開後 16:48〜）、結果は作業者のものと同じだった。数が違うところ（1・3b・3d・8・9）は、その行に指揮者の値を書いた。台帳は作業領域の `audit3/r3-int-verify/ledger.md`。

| # | 検査 | 結果 | 測った木・時刻・負荷 | コマンド |
|---|---|---|---|---|
| 1 | git | 4 つの head は祖先。所有の外の編集は (b) の表のとおり（9 ファイル＋トラックのファイルの再編集）。docs の 5 コミットの後で、45603f06..bd205842 の 142 本すべてが（指揮者が数え直した。作業者の 141 は 5 本目の docs のコミットの前の数） Conventional Commits で、最後の 2 行がちょうど指示の 2 行の trailer。trailer の外にモデル名は無い。大きなファイル・基準の形のファイル・zip は無い（114 ファイル、最大はトラックの記録 verdict.md の 1906 行）。`git status` は空 | HEAD、15:1x〜15:3x、0.00 | `git merge-base --is-ancestor`、`git diff --name-only 45603f06 HEAD`、`git diff --stat <head> HEAD -- <track files>`、`git rev-list 45603f06..HEAD` の各本文の最後の 2 行、`git diff --numstat 45603f06..HEAD` |
| 2a | vitest 全部 | 252 ファイル・4264 本すべて通過、失敗 0 | bbcb8753、12:28〜12:33、0.55 → 3.38 | `npx vitest run`（SESSION_CALENDAR_PYTHON・FINANCIAL_REPLAY_PYTHON つき） |
| 2b | 静的 Playwright 全部 | 570 本通過・失敗 0・スキップ 0（24.5 分）。R1／R2 の目標と INTEGRATION のテストが有効 | bbcb8753、12:43〜13:08、2.74 → 4.00 | `npx playwright test -c $S/audit3/r3-integration/pw.config.mjs --workers=1` |
| 2c | lint | エラー 0、警告 4（8849bf9 からある 4 つ） | bbcb8753、12:34 | `npm run lint` |
| 2d | .github/scripts | 2067 本：通過 2063・失敗 2・スキップ 2（STEP 0 と同じ）。失敗 2 はサンドボックスだけの「real restore CLI」（GITHUB_EVENT_PATH が無い、select-release-source.mjs:905） | bbcb8753、14:06〜14:19、1.74 | `node --test .github/scripts/*.test.mjs` |
| 2e | 更新のライフサイクル | financial-source-renewal-lifecycle 1/1（subtest を含め 8/8）、automatic-lifecycle 2/2（6/6） | bbcb8753（クリーンな木）、14:19〜14:32、1.33／1.09 | `node --test .github/scripts/financial-source-renewal-{,automatic-}lifecycle.test.mjs` |
| 2f | test_sec_financials ＋ export／8k | 54 本 OK（DATA の 57 から、保留が test_sec_financials.py の表示側の 61 行を外した）、test_export_financial_history 4 本 OK、test_sec_8k_samples 5 本 OK | bbcb8753（sec-financials.py と test は cc326e9a から不変）、15:11、0.00 | `cd frontend/tools && python3 -m unittest test_sec_financials test_export_financial_history test_sec_8k_samples`（PATH に Node 22） |
| 2g | 集め手のテスト | 34 本 OK | 71daaf65 の後（P3、12:05）。frontend/tools は 71daaf65 から HEAD まで不変（`git diff --quiet`） | `cal-venv/bin/python -m unittest discover -s frontend/tools -p "test_collect_market*.py"` |
| 3a | backend のゲート | gate-1 304・gate-2 47・gate-3 152・gate-4 21・gate-5 43 通過、gate-check OK | 8e45a596、11:05〜11:06、3.23 → 2.27。backend は 8e45a596 から HEAD まで不変（`git diff --quiet 8e45a596 HEAD -- backend`） | `make gate-1 … gate-5 gate-check PYTHON=/home/user/screener/backend/venv/bin/python` |
| 3b | 赤線（red line） | 範囲の違う 2 回で、どちらも失敗 0。(i) P2：293 本集めて 293 本通過。(ii) 指揮者：**326 本通過**（警告 2、30.5 秒）。(ii) は (i) に test_setup_engine_contract.py を足し、golden の test_mcp_market_copilot.py を外したもの。(i) の `--ignore` の道（services の下）は存在しないので、(i) は golden の copilot のテストを含む | (i) 8e45a596、11:07。(ii) bd205842、15:41〜15:42、2.61 | (i) 計画の P2 の命令：`cd backend && DATABASE_URL=postgresql://local/none <venv の python> -m pytest tests/unit/scanners tests/unit/services tests/unit/golden tests/unit/test_scan_orchestrator.py --ignore=tests/unit/services/test_mcp_market_copilot.py -q`。(ii) `cd backend && DATABASE_URL=postgresql://local/none /home/user/screener/backend/venv/bin/python -m pytest tests/unit/scanners tests/unit/services tests/unit/golden tests/unit/test_scan_orchestrator.py tests/unit/test_setup_engine_contract.py --ignore=tests/unit/golden/test_mcp_market_copilot.py -q` |
| 3c | 凍結の 908 | `DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp`（不変。SETUP 列は Markets360 のもの、p1-5） | 8e45a596、11:08、1.89 → 2.04 | `backend/scripts/validate_trade_ideas.py` |
| 3d | H4（補助のプローブ） | setup_ready 29/588（4.9%）対 21/575（3.7%）、+1.3pp（STEP 0 は 28/588 対 23/575、+0.8pp）。G8 46/588 対 185/575（STEP 0 は 34 対 178）。SE のステージ 2 は 532 対 378（STEP 0 は 528 対 300）。price_pinned はその他の失敗にエントリー 2・対照 2。G1〜G7・G9・G10 は STEP 0 と同じ。上抜け日のエントリー 215 件で準備 0。指揮者の再実行（bd205842）も同じ数で、R の h4-before.json との 1160 行の差分で入れ替わったのは、エントリー +AG、対照 +FDX・−HTHT・−IOVA・−RIC | 8e45a596、11:04〜11:12、0.14 で開始、482 秒 | `backend/scripts/probe_setup_ready_908.py --json …` |
| 3e | プローブの docstring | 45603f06 との差は、モジュールの docstring の中の 5 行（「SE stage」の定義）だけ。コードの行は変わらない（コミットの本文は、docstring を除いた AST が同じと言う） | HEAD、P6 | `git diff 45603f06 HEAD -- backend/scripts/probe_setup_ready_908.py` |
| 4 | build | エントリー 133.85 kB ≦ 134.00。MarketScreen 34.03 kB、priceChart 18.57 kB（Design Acceptance の build） | bbcb8753、12:26、0.02 | `$H/build/run-build.sh <worktree>` |
| 5a | 492 画面のプローブ | ラベル 492・値 480・エラー 0、sha256 69ce3c5a…a326（CHART だけの木と同じ）。8849bf9 との差は CHART の項目だけ。週足でない SVG は同じ、週足は注意書きの行が消えるだけ、強制の数はどの画面でも増えない、カードの高さは 1440 週足だけ +21.19、C5 のラベル、注記の文。aria の変化 0 | bbcb8753、13:55〜13:57、1.72 | `$H/probe/run-probe.sh <worktree> 4425`、`node $H/probe/diff.mjs … --texts`、CHART の `gate.mjs` |
| 5b | オラクルのプローブ | ラベル 132・値 132・エラー 0、sha256 98bd4cf2…b930。CHART だけの木との差は ZZHB・ZZNR・ZZPG（R6・R1・R2）、R だけの木との差は C2・C3・C5。両方が変えた 84 画面で、合流の差は 2 つの和にちょうど等しい。名指しされていないが帰属のあるもの：ZZNR の 1440 のカード −21.19（R1）、ZZPG の 1440 の 3m／6m のカード −20 と凡例の埋め戻し（R2） | bbcb8753、13:57〜13:59、2.12 | `$H/probe/run-probe.sh <worktree> 4425 oracles` |
| 5c | ダンプ | 42 画面・エラー 0、sha256 aaf7ae71…509e。8849bf9 と違う 31 画面はすべて帰属あり（C4 の 1440 の 18 画面、C2、C5 の 375 の 6 画面、M3「7日以上で注意」、MARKET の画面、c7b8e6c8 の名前、D4「Q4算出」の 10 画面）。R による差は無い。高さは 1440 の市場 2519（MARKET だけと同じ）のほかは同じ。B2 はダンプが同じ（(c) B2） | bbcb8753、13:59〜14:00、2.30 | `$H/dump/run-dump.sh <worktree> 4425` |
| 6 | 高さの台帳（375×812） | 下の表 | bbcb8753、14:00〜14:08 | `$H/heights/run-heights.sh`、MARKET の測定の spec の写し、STEP 0 のオラクルの高さの spec、brief-decision.spec.js の写し |
| 7 | 再構築の数（11-12） | 下の表。予想どおりで、それ以外の動きはすべて帰属あり | bbcb8753、13:22〜13:27（スナップショット）、13:54〜14:06（数と描画） | `$H/snapshot/run-snapshot.sh <worktree> --keep`、数の集計、`$H/snapshot/run-render.sh <worktree> 4425 reduce`（読み取りの型を `対\s*ピボット` に直した写し） |
| 8 | C1 の時間（静かな機械） | 1440 の最初の表示：8849bf9 と交互に 7 回、中央値 241ms（8849bf9 は 334ms）。指揮者の繰り返し（bd205842、開始 loadavg 0.48、ほかのプロセスなし、7 回とも有効）は 263ms（8849bf9 は 366ms）。200ms 以下は **どちらも満たさない**。保留の承認はそのまま。390 の期間の切り替え：182.5ms（8849bf9 は 190.5）、1440 は 190.0（197.5） | 開始 13:30:26、loadavg 0.50（有効）。期間は 14:36:27 に 0.10、14:47:31 に 0.52 | `$H/timing/wait-quiet.sh 0.5 600 $H/timing/run-timing.sh <worktree> 4425 <r3-base> 7`、`… run-period.sh` |
| 9 | 合流した作り手の文言の規則 | 指揮者の検証で確かめた。追加された非テストのソースの行の grep（IBD／RS の語、あと0／達成、`?? 0` の既定値、ASCII のマイナス）は空。ダンプの追加と削除の行（20／20）と、プローブ・オラクルの文字の差分（削除を含む）は、すべてトラックの項目に帰属する。ダンプの「ピボット±0.0%」は基準と同じ値で、pivotDistanceText はピボットの cents ちょうどのときだけそれを出す | 指揮者、bd205842、16:48〜 | 差分は作業領域の `audit3/r3-int-verify/src.diff`（frontend/src/static の非テストの 33 ファイル）。その追加行への `grep`。差分を作った正確なコマンドは残っていない。ダンプとプローブの文字の差分 |
| 10 | 規則 18 | 出力のスイッチは 3 つとも off（`Q4_EPS_REFERENCE_EMIT = False`、`EMIT_R3_MARKET_FIELDS = False`、`EMIT_R3_MARKET_FIELDS=false`）。admission の `OPTIONAL_RECORD_KEYS` は `['derivation_gaps']` だけなので、`q4EpsReference` を持つ記録は `keys` で拒む。frontend/src に `q4EpsReference` は無く、作り手も出さない。INTEGRATION のテスト（古い公開は前と同じに描く）は 2b の中で通った | HEAD、15:1x | `grep -n` |
| 11 | 文書 | STATE.md と CONTEXT.md に「EPS 合格」「EPS 条件」・旧名のキーが無い（grep の出力は空）。出力の前提は、STATE.md の「次の行動」5 と「絶対の制約」で保留の差し戻しを名指す。STATE.md の「絶対の制約」は前の版と同じ行に、出力の 1 行を足しただけ（`diff`）。出力のスイッチは 3 つとも off。`npm run lint` はエラー 0・警告 4 | HEAD、15:2x〜15:3x | `grep -rn 'EPS 合格\|EPS 条件\|sec_conditions' docs/STATE.md CONTEXT.md`、`diff <(git show <前>:docs/STATE.md …) …`、`npm run lint` |

### 高さ（375×812。P5、bbcb8753）

| 画面 | 支配する状態 | 実測 | 線 | 結果 |
|---|---|---|---|---|
| Today | 1 日遅れ・5 銘柄・ZZSD 崩れ | 1342 | 1388 | 合格 |
| 候補 | 既定の買いゾーン | 593 | 708 | 合格 |
| ウォッチ | 5 銘柄 | 442 | 508 | 合格 |
| 市場 | 1 日遅れ | 1228 | 1288 | 合格 |
| 市場 FTD の食い違い | 格上げ／1 日遅れ | 1300／1322 | 1288 | 前と同じ（OD5） |
| 市場 200 日線の下（M1c） | 一貫した状態 | 1242 | 1288 | 合格（+27、受け入れ） |
| 市場 200 日線の下・食い違いの行あり | — | 1300 | 1288 | 線の上（OD5 と同じ種類、既知） |
| 銘柄 ZZNV | 375 | 3044 | 3388 | 合格 |
| 'stalls'（STOCK_CAP） | 上抜けが 25 営業日ゾーンにとどまる | 3114 | 3124 | 合格（余り 10） |
| 失敗ブレイク（STOCK_LINE） | — | 3240 | 3388 | 合格 |
| チャートのカード | 320／375／390 日足 | 508 | — | 前と同じ |
| チャートのカード | 320 週足／375・390 週足 | 492／508（ZZLI 490） | — | 前と同じ |
| チャートのカード | 1440 | 最大 727.125、週足 +21.19（C2） | — | 予想どおり |
| Today の地合いタイル（M4） | 375／390、反発n日目 | 115.8 | — | 受け入れ |

- オラクルの銘柄画面（375）は、ZZHB 2513（R6）、ZZNR 2680（R1）、ZZPG 2325（R2）、ZZQF 3000（D4）、ZZRD 2533（C4）。どれも 3388 以内で、はみ出しは 0。
- M1c の印の付いたラベルは、銘柄画面に出ない（320／375、2 状態で 16 本通過、はみ出し 0）。
- entryReadiness の文、buildPortfolioPlan の blockers、PortfolioDecision／PortfolioPlanDrawer は、ブリーフのどの道筋にも載っていない。だから折り返しは画面で読めない（未検証）。

### 再構築の数（11-12 の再構築。公開版の数ではない）

基点は STEP 0（c61bf96）か 8849bf9、統合は bbcb8753。

| 数 | 基点 | 統合 |
|---|---|---|
| 掲載行 | 980 | 980 |
| 準備（掲載行） | 37 | 26 |
| 準備（全体 5,955 行） | 82 | 26 |
| D2 の流動性の分割（合格） | 18／19（DATA だけ） | 11／15 |
| price_pinned（失敗チェックの上位） | なし | 24 |
| stage_not_ok | 265 | 277 |
| 低変動の掲載行 | 17 | 24 |
| インデックスの lowRange／price_pinned | 107／0 | 125／124（違いは GDL） |
| 失敗ブレイク hit／clear／ピボットなし（認証済み 615） | 21／543／51 | 14／550／51 |
| ピボットの日付より前の上抜け／その失敗 | 69／7 | 1（HHS）／0 |
| forgotten | 52 | 32 |
| 収縮を描く行 | 187 | 229 |
| 毎回浅く | 131 | 153 |
| 上抜けの後の脚からの損切り | 76 | 0 |
| 後の足に割り込まれた使える損切り | — | 0 |
| R5 の一行 | — | 17 |
| 読み取りの ±0.0 の不一致（計算） | 4 | 4（PFIS・TECH・PCRX・LNTH） |
| 読み取りの ±0.0 の描画（390） | 4 | 0（型が 126／150 に当たる。残り 24 は数を持たない未検証の足） |
| インデックスの大きさ（近似、gzip） | 613,518 | 621,853（+8,335。R だけの木と同じ） |

- スナップショットの出力 4,437 ファイルのうち、R だけの木（d5b3e42）と違うのは 3 つだけ。
  - bundle.mjs。
  - sell-eval.jsonl：R6 の版・脚・構造の損切り。
  - oneoffs.txt：構造の損切りの状態の集計。
- DATA・MARKET・CHART は、再構築の数を動かさない。

---

## (g) 未検証

- **公開版の効果のすべて**。
  - ここの実データの数は、すべて 11-12 の再構築のもの。公開版の銘柄・順位・インデックスの大きさ・描画は、リリースの後に読むまで未検証。
  - PAG が公開版で低変動になるかも未検証。
- **割り込みの規則と ISO でない日付**：割り込みの規則は、日付が ISO の日でない足を飛ばす。認証（auditDailyBars）がそのような足を拒むかは確かめていない（R6 の open minor）。再構築では 980 行すべてが ISO の昇順で、影響は 0。
- **391〜1023px の幅**：どのトラックも描いていない。320／375／390／1440 だけ。
- **新しい行の axe・明るい表示・200% の拡大**。対象は R5 の一行、R6 の新しい理由、M の行、C4 の行、D4 の印。
- **実データの描画**。
  - R6 の新しい理由（「…割り込み済み」「収縮はすべて…」）は、フィクスチャにも再構築の描画にも出ない。描いていない（320 の折り返しを含む）。
  - 「最後の収縮の安値」の線を失う 61 行も描いていない。
  - AVTR・SHEL・VSTM（新しく準備）は、描画の対象の 48 銘柄に入っていない。
  - 再構築の描画で強制のラベルが増えた 17／27 画面は、文字の箱どうしの重なりを計算しただけ（(e) 13）。画素の目視はしていない。
- **CI と Design Acceptance**：走らせていない（起動しない）。PR #145 の Design Acceptance は 1440 の最長タスクの中央値を 779ms と測った（指揮者の記録）。統合の木での CI の値は未検証。
- **`contraction_unconfirmed` がブリーフと違う回数**：数えていない（readiness.py への切れ目の移植は、していない）。
- **保留を戻したときのエントリーの大きさ**：この HEAD では測っていない（見込み 約 135.2）。
- インデックスの大きさのトラックごとの内訳と、公開版での値。
- MARKET の実データの値：^GSPC／^IXIC の値、M0 のログの行、M8 の値、長期履歴のキャッシュの取り直しの成否と時間。
- D3 の精度、実データで `code33_parts.eps_acceleration` が旧集計の EPS の数と同じこと、`eps_acceleration_pass_symbols` と提出書類の照合。
- P3 のエントリー 133.01 は、見込みの約 132.6 より 0.41 大きい。理由は切り分けていない。最後の 133.85 は、指揮者の試作の 133.83 とほぼ同じ。
- I2 の 9（文言の規則）は、追加された行の grep と作り手を読むことで確かめた（(f) 9）。描いた画面で読んだのは、上の描画の範囲だけ。
- 時間：1440 の最初の表示と期間の切り替えは、このサンドボックスの静かな機械の値。CI の値ではない。
