# Round 3 トラック DATA（D2・D4・D3）

- 基準：45603f06（main に STEP 0 を合流したもの）。ブランチ `claude/r3-data`、ポート 4422。
- D1（厳密な CIK と診断）は #144 で出荷済み。ここでは扱わない。
- 順序：D2 → D4 → D3。D3 は統合で外せるよう、自分のコミットに分ける。
- この文書の数は、断りがない限りこのサンドボックスでの実測。公開版の数ではない（規則 17）。

---

## D2 集計レポート：正しい名前、q4_only、EPS 25% の下限、流動性の分割

診断用のツール `frontend/tools/report-data-coverage.mjs` だけの変更。UI・公開データ・警告コードは変えていない。

### 変更

1. **`sec_conditions` → `code33_parts`**（2か所）。
   - 入力側（`fundamentalsCoverage`）：`code33_parts: { eps_acceleration, sales_acceleration, margin_improvement, q4_eps_missing }`。`q4_eps_missing` はこの中に残した。
   - 公開側（`publishedCoverage`）：`code33_parts: { eps_acceleration, sales_acceleration, margin_improvement, eps_acceleration_pass_symbols }`。
   - 表の行は「SEC conditions (listed)」から「Code 33 parts (listed, SEC)」に変え、`EPS acceleration …; sales acceleration …; margin improvement …` と出す。
   - コメントに、これは Code 33 の「加速」（四半期 EPS 成長率の上昇）であって、EPS ≥ 25% の下限ではないと書いた。
   - 数え方は変えていない（名前だけ）。`schema_version` は 'published-fundamentals-report-v1' のまま。
2. **`code33_parts.eps_acceleration_pass_symbols`**（公開側だけ）。
   - EPS の加速が pass の掲載銘柄を、掲載順に最初の `limit`（既定 25）件まで。決算書と手で照らし合わせるため。
   - 上限は一覧だけにかかり、件数（`eps_acceleration.pass`）にはかからない。
   - 表には出さない（指示の行の文言どおり）。JSON（`--json`）とログの `Published coverage (fundamentals): …` の行に出る。
3. **`eps_floor_25: { last2, last4 }`**（公開側の `out` の最上位）。
   - カードの「EPS ≥25%」チップ。現在有効な SEC 報告（`code33_parts` と同じ `report`）の `report.epsFloor[2|4].at25` を数える。
   - しきい値はここでは定義しない。bookFinancialEvidence の判定を読むだけ。pass/fail/unknown 以外の値は数えない。
   - 表の行：「EPS ≥25% (listed, SEC; the card's chip) | latest 2 quarters …; latest 4 quarters …」。
4. **`round2.eps_unknown.q4_only`**。
   - 現在の報告で EPS の加速が unknown の行のうち、`epsUnknownCauses(report).all` が空でなく、そのすべてが `fiscal_q4_untagged` か `latest_row_fiscal_q4_without_eps`（`Q4_EPS_CAUSES`）の行。
   - **上限値**。`epsUnknownCauses` は no_base・ambiguous_base・Q4 でない行の not_reported を数えないので、そうした原因が Q4 の原因の陰に隠れている行も入りうる（コードの `Q4_EPS_CAUSES` のコメントにも書いた）。
   - 原因が1つも列挙されない行（例：前年同期の EPS が無い no_base だけ）は数えない。
   - 表の「EPS acceleration unknown」の行に `Q4-only (upper bound) N` と出す。
5. **`setup_ready_liquidity`**（公開側の `out` の最上位、`setup_ready` の隣）。
   - `briefLiquid(row)`（export）：`filterRanked([{ row, assessment: null }], { liquidOnly: true }).length === 1`。useBriefData.js:45 と同じ呼び出しで、ブリーフ自身の規則を読む。数値（価格・売買代金の線）はレポートにもテストにも書いていない。オブジェクトでない行は false（filterRanked はそこで例外になる）。
   - `setupReadyLiquidity(rows)`（export）→ `{ liquid: {pass, fail, unknown}, illiquid: {…}, missing_price_or_adv }`。状態は `setupReadiness(row).state`。
   - `current_price` か `adv_usd` が有限の数でない行は illiquid（ブリーフは載せない）に入り、`missing_price_or_adv` にも数える。
   - 掲載行のどれも有限の価格と売買代金を持たない（古い公開）ときは、全体を null（未計測）にする。「すべて流動性不足」とは言わない。
   - 公開側では `setup_ready` と同じ行（詳細、無ければ一覧の行）を読むので、両者の pass の合計が一致する。ブリーフ自身が絞るのは一覧の行（research index）。C の木では、掲載 632 行すべてで一覧と詳細の価格・売買代金が一致した（実測、下）。
   - 表の行：「setup readiness: liquid / illiquid (the brief's liquidity rule, measurement only)」。null なら 未計測。

### ガードの位置

- `code33_parts`・`eps_floor_25`・`setup_ready_liquidity` は round 1 側（round 2 の try の外）。どの行の形でも例外にならないよう、オプショナルチェーンで読む。`setup_ready_liquidity` は、round 2 が例外で止まったときの早期 return より前に代入する。
- `eps_unknown.q4_only` は round 2 の try の中で、ほかの eps_unknown の数と一緒に数える。
- 変えていないもの（`git diff -U0` で確認、下の実測 G2）：`fundamentalsCoverageBlock`、`coverageWarnings`、`BLOCK_KEYS`、`validFundamentalsCoverageBlock`、`COVERAGE_WARNINGS`、`secAdmissionState`、`compareSecCarryForward`、`publishedSecInventory`、すべての `warnings.push` と `::warning::` の文言、SEC の carry の比較。

### 規則 18

D2 は記録のキー・警告コード・インデックスの項目を1つも足していない。変わるのはレポートの診断用 JSON とマークダウン（ジョブのサマリー）だけ。公開物の `fundamentals_coverage` ブロックとその警告コードは同じ。

### テスト（`frontend/tools/report-data-coverage.test.mjs`）

基準の 16 件（実測：編集前に `npx vitest run tools/report-data-coverage.test.mjs` で 16 passed）に 7 件を足し、1 件を広げた。既存の 16 件には `sec_conditions` を参照するアサーションが無かったので、名前の変更で直すアサーションは無かった。

- (a) 名前の変更：変更前のツール（45603f06、blob 09c3b81）で同じ記録から取った `sec_conditions` の数（eps pass 2・unknown 2、sales pass 3・unknown 1、margin pass 2・fail 1・unknown 1、q4_eps_missing 1）を書き込み、`code33_parts` が同じ数で、`sec_conditions` が無いことを入力側・公開側の両方で確かめる。
- (b) `eps_acceleration_pass_symbols`：掲載順に並び、`limit: 2` で2件に切れ、件数は 3 のまま。
- (c) `eps_floor_25`：bookFinancialEvidence 自身の判定（UP pass/pass、PASS pass/fail、SLOW fail/fail、YOUNG unknown/unknown）を確かめた上で、last2 {2,1,1}・last4 {1,2,1}。SEC 報告の無い行は数えない。
- (d) `q4_only`：この試験ファイルで作った5つの記録（凍結のフィクスチャ secRecord/secPoint は読み込むだけ）。それぞれの `epsUnknownCauses(...).all` を明示して、1行だけの公開で数える。
  - ZZNV の形（最新の行が EPS の無い fiscal Q4）：`['latest_row_fiscal_q4_without_eps']` → 1。
  - ZZQF の形（直近4四半期の中に fiscal Q4 の行があり、売上・純利益はあるが EPS は 10-K の年だけ）：`['fiscal_q4_untagged']` → 1。epsUnknownCauses の「Q4 の行に EPS が無い」分岐。
  - fiscal Q4 の行そのものが直近4四半期の中で欠けている形：`['fiscal_q4_untagged']` → 1。もう一方の分岐（連続していない窓と `fiscalQ4Missing`）。
  - Q4 の原因に前年の赤字が重なる行：`['latest_row_fiscal_q4_without_eps', 'prior_year_loss_or_zero']` → 0。
  - 原因が列挙されない行（no_base）：`[]` → 0。
  - 5行まとめて：with_current_report 5、q4_only 3、any の fiscal_q4_untagged 2・latest_row_fiscal_q4_without_eps 2。
- (e) `briefLiquid`・`setupReadyLiquidity`：
  - 価格と売買代金の線は filterRanked 自身を倍々で探し、二分して隣り合う数まで詰めた（線の値は書いていない）。線の直下・線上・null・NaN・Infinity・文字列・負・0 の組み合わせで、`briefLiquid` が filterRanked と一致し、両方とも線上の行だけが載る。
  - liquid の pass/fail/unknown、illiquid の pass、価格の無い行（illiquid かつ missing）、価格も売買代金も無い集合で null。
- (f) 表：新しい3行と `Q4-only (upper bound) 1` の文言、古い公開での 未計測、「SEC conditions」が消えたこと。`setup_ready_liquidity` が `setup_ready` の直後のキーであること。
- 既存の「round 2 の計測が例外になっても round 1 を残す」テストを広げ、`code33_parts`・`eps_floor_25`・`setup_ready_liquidity` が例外の後も残ることを確かめる。

### 実測

環境：`export PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=…/audit/r1-step0/cal-venv/bin/python FINANCIAL_REPLAY_PYTHON=…/replay-venv/bin/python`（`…` はセッションの scratchpad）。

**A. 単体テスト**

```
cd frontend && npx vitest run tools/report-data-coverage.test.mjs
 ✓ tools/report-data-coverage.test.mjs (23 tests)
 Test Files  1 passed (1)
      Tests  23 passed (23)
```

**B. 再現スナップショット（11-12 の再現。公開版の数ではない）**

ハーネスの行は `setup_ready` を文字列で持つ。setupReadiness が読むのは `se_setup_ready`（真偽）と `setup_recalculation.status` なので、`se_setup_ready` を文字列から作り、`setup_recalculation` は行自身のものを渡した（980 行すべて status calculated、実測）。

```
cd frontend && O=…/audit3/r3-harness/snapshot/out/c61bf96 node --input-type=module -e "import { setupReadyLiquidity, briefLiquid } from './tools/report-data-coverage.mjs'; import { readFileSync } from 'node:fs'; const rows = readFileSync(process.env.O + '/rows.jsonl','utf8').trim().split('\n').map(l=>JSON.parse(l)).map(r => ({ ...r, se_setup_ready: r.setup_ready === 'pass' ? true : r.setup_ready === 'fail' ? false : null })); console.log(JSON.stringify(setupReadyLiquidity(rows)), rows.filter(r => briefLiquid(r) === (r.ui_liquid_rank != null)).length, rows.length);"
{"liquid":{"pass":18,"fail":543,"unknown":0},"illiquid":{"pass":19,"fail":400,"unknown":0},"missing_price_or_adv":0} 980 980
```

- liquid pass 18・illiquid pass 19（掲載の準備 37 のうちブリーフが載せるのは 18）。不合格の分け方も司令役の filterRanked での直接の数（liquid fail 543・illiquid fail 400）と同じ。
- `briefLiquid` はハーネスの `ui_liquid_rank` と 980/980 行で一致。
- 計画の訂正：計画の「再現での実行（`--published`）」はできない。公開の形をした再現の木は下の C の木だけで、掲載 632 行・準備 32 で、SEC 記録を持たない。

**C. 公開の形の木での配線の確認（読むだけ。書き込みは scratch だけ）**

木：`…/audit3/r3-step0/final/h2/new/repo/frontend/public`（STEP 0 の H2 の再エクスポート。SEC 記録・決算日などは入っていない）。

コマンド（終了コード 0）と、書き出した JSON から読んだ値（下の4行は JSON の要約で、ツールの標準出力そのものではない）：

```
cd frontend && env -u GITHUB_STEP_SUMMARY node tools/report-data-coverage.mjs --published --root …/r3-step0/final/h2/new/repo/frontend/public --json …/audit3/r3-data/d2-h2-report.json
listed 632  setup_ready {pass 32, fail 600, unknown 0}
setup_ready_liquidity {liquid {pass 14, fail 317, unknown 0}, illiquid {pass 18, fail 283, unknown 0}, missing_price_or_adv 0}
code33_parts: すべて 0（有効な SEC 報告が 0 件）、eps_acceleration_pass_symbols []
eps_floor_25: すべて 0、round2.eps_unknown.q4_only 0（without a current report 632）
```

- pass の合計 14 + 18 = 32 = setup_ready.pass。liquid 331 + illiquid 301 = 632 = listed。
- 独立の数（`…/audit3/r3-data/proto/independent-liquidity.mjs`。レポートのモジュールを読み込まず、manifest・研究インデックス・監査・詳細を自分で読み、ブリーフと同じく一覧の行に filterRanked、詳細に setupReadiness を当てる）：

```
{"listed":632,"detail_missing":0,"index_detail_price_adv_agree":632,"disagree":[],"liquid":{"pass":14,"fail":317,"unknown":0},"illiquid":{"pass":18,"fail":283,"unknown":0}}
```

- 変更前のツールとの比較。変更前のツールは、編集の前にこのワークツリーのきれいな状態（`git status` が空、ファイルの blob 09c3b8127d2ddfef68a7cace6f3ff70844991b4b = `git rev-parse 45603f06:frontend/tools/report-data-coverage.mjs`）で同じ木に対して走らせた（`…/audit3/r3-data/d2-h2-report-base.json`、listed 632・setup_ready pass 32・fail 600）。指示の一時ファイル（`.base-report.tmp.mjs`）は作っていない（同じファイルなので不要）。
- `code33_parts` を `sec_conditions` に戻し、新しいキー（pass_symbols・eps_floor_25・setup_ready_liquidity・q4_only）を除いて、キーを並べ替えた JSON で比べた（`…/audit3/r3-data/proto/compare-base.py`）：

```
top-level keys equal: True
  as_of_date / carry_forward / coverage / derived_states / file / fundamentals_coverage / records / schema_version / ui_only_republish / warnings: identical
coverage keys that differ: []
whole report identical after mapping: True
warning lines identical (4)
other log lines identical
```

- 新しい表の行（この木）：

```
| Code 33 parts (listed, SEC) | EPS acceleration pass 0, fail 0, unknown 0; sales acceleration pass 0, fail 0, unknown 0; margin improvement pass 0, fail 0, unknown 0 |
| EPS ≥25% (listed, SEC; the card's chip) | latest 2 quarters pass 0, fail 0, unknown 0; latest 4 quarters pass 0, fail 0, unknown 0 |
| setup readiness: liquid / illiquid (the brief's liquidity rule, measurement only) | liquid pass 14, fail 317, unknown 0 / illiquid pass 18, fail 283, unknown 0 (no price or ADV 0) |
| EPS acceleration unknown (current SEC report) | 0: none; fiscal-Q4 share 未計測; Q4-only (upper bound) 0; without a current report 632 |
```

  - SEC 記録の無い木での `code33_parts`・`eps_floor_25` の 0 は「有効な SEC 報告を持つ行の数」が 0 という意味で、変更前の `sec_conditions` と同じ数え方。

**E. lint**

```
cd frontend && npx eslint tools/report-data-coverage.mjs tools/report-data-coverage.test.mjs
（出力なし、exit 0）
```

**F. vitest 全体（1回）**

```
cd frontend && npx vitest run
 Test Files  247 passed (247)
      Tests  3990 passed (3990)      （基準 247 / 3983。+7 は D2 の追加分）
 Duration  275.39s
/proc/loadavg 前 4.69 3.58 1.79（06:10:58Z）、後 6.34 5.36 3.04（06:15:34Z）
```

時間は負荷のある機械での参考値（advisory）。全体の実行はコミット 194dddc8 の上。その後のテストだけの変更（q4_only に ZZQF の形の行を足した、件数は 23 のまま）の後は、このテストファイル（23 passed）と eslint だけを走らせ直した。

**G. 所有の確認と差分の確認**

- G1：`python3 -I …/audit3/check-ownership.py DATA <worktree> 45603f06…` → コードのコミット（194dddc8）の前に `OWNERSHIP OK (DATA): 2 paths`、この文書の最初のコミット（733fda47）の前に `OWNERSHIP OK (DATA): 3 paths`。テストの追加と記録の直し（次のコミット）の前にも同じ結果。
- G2：`git diff -U0` の削除行（`-`）は `sec_conditions` の4か所、表の2行、`let`/`const` の宣言1組だけ。上の「変えていないもの」の関数名・`warnings.push`・`::warning::` を含む `+`/`-` 行は 0（grep の exit 1）。差分の塊は fundamentalsCoverage・publishedCoverage・fundamentalsSummaryTable と新しいコードの中だけ。
- G3：しきい値の数字（10、20000000 とその書き方の変種）は2つのファイルのどちらにも無い（grep、実測）。
- G4：`sec_conditions` を読むのは、リポジトリ内で docs/STATE.md（凍結）だけ（grep、実測）。.github のワークフローは「SEC conditions」も `sec_conditions` も読まない。research-ui-release.yml の `--previous` が読むのは前のレポートの `records`（compareSecCarryForward）で、名前の変更の影響を受けない。

### 未検証

- 実データで `code33_parts.eps_acceleration` が旧 `sec_conditions.eps` と同じこと。このサンドボックスには SEC 記録を持つ公開の木が無い。確かめたのはフィクスチャの上だけ（テスト a）。
- 公開版での各数（`code33_parts`、`eps_floor_25`、`q4_only`、`setup_ready_liquidity`）。次の公開の後に読むまで未検証。
- `eps_acceleration_pass_symbols` の銘柄が決算書と合っているか（手での照合はしていない）。
- `q4_only` が上限からどれだけ離れているか（Q4 の EPS が出たときに実際に決まる行の数）。

### 指示からの逸脱

1. C の変更前のツールは一時ファイルからではなく、編集前のきれいなワークツリー（blob が 45603f06 と同じ）から走らせた。結果の JSON は上の比較に使ったもの。
2. `eps_acceleration_pass_symbols` は表に出さない（指示の行の文言どおり）。JSON とログの行には出る。
3. q4_only のテストに、原因が列挙されない行（no_base）を足した（「空でない」の条件を確かめるため）。
4. 既存のテストに `sec_conditions` のアサーションが無かったので、(a) の「古い数」は変更前のツールで同じ記録から取って書き込んだ（`…/audit3/r3-data/proto/old-sec-conditions.out`）。

### 統合への依頼

- docs/STATE.md（凍結）：「sec_conditions: EPS 合格1・不合格327・不明404 …」の「EPS 合格」「EPS 条件」を「Code 33 の EPS 加速」に、`sec_conditions` を `code33_parts` に書き換える。
- CONTEXT.md の語彙：`code33_parts`（Code 33 の3つの部分。EPS 加速は EPS ≥ 25% の下限ではない）、`eps_floor_25`（カードの ≥25% チップ、直近2・4四半期）、`q4_only`（上限値）、`setup_ready_liquidity`（ブリーフ自身の流動性の規則での分割、測るだけ）。
- 計画 §5 D2 の「Rebuild run」：再現に対する `--published` はできない（上の B の訂正）。再現の数は行のファイル（B）で、配線は公開の形の木（C）で確かめた。

---

## D4 算出した Q4 を引くところすべてに「Q4算出」（p2-6）

UI の文言だけの変更。データのキー・チャートのコードは触っていない。測った木は **9efa9927**（コード 3bf9f4a8＋テスト 9efa9927）。この記録はその上の docs だけのコミット。

### 変更

文言は `frontend/src/static/fundamentalsExplain.js` に置き、カードとテストはそこから読む。

- `Q4_DERIVED_MARK = '（Q4算出）'`、`Q4_DERIVED_SOURCE_NOTE = '・Q4算出：売上/純利益のQ4は10-K年度値−3四半期'`、`Q4_DERIVED_LEGEND = '算出＝Q4算出（10-K年度値−3四半期）'`（どれも U+2212）。
- `q4DerivedRate(row, metric)`：その行の値が算出した Q4 に乗っているか。売上の前年比は `(salesDerived ?? derived) === true || salesBaseDerived === true`、純利益率は `derived === true`、EPS は常に false。
- `q4DerivedSourceNote(rows, tiles)`：行かタイルのどれかが算出なら注記、なければ ''。`fundamentalsSource(report)` 自体は変えていない（1 引数の出力は同じ。briefModelShared.test.js の固定もそのまま）。

カード（`StockFundamentalsCard.jsx`）：

1. **出典の行**：`fundamentalsSource(report) + q4DerivedSourceNote(wide ? [] : rows, tiles)`。
   - スマホでは、窓の中のどれかの四半期が算出なら必ず付く（軸の「算出」の鍵になる）。ZZQF のように算出のタイルが無いカードでも付く。
   - デスクトップ（1024px 以上）では、これまでどおりタイルが算出に乗るときだけ（下の「指示からの逸脱 1」）。
2. **凡例**：デスクトップの項目を `Q4_DERIVED_LEGEND` に。スマホの凡例は1行のまま、文言は足していない。コメントは「出典の行が、行が算出のときは必ず名前を出す（q4DerivedSourceNote）」に直した。軸のセルは「算出」のまま（320px の列に4文字は入らない。同じカードの出典の行か凡例が鍵になる）。
3. **未達の根拠（settledText）**：引いた四半期ごとに、その値が算出した Q4 に乗っていれば値の直後に「（Q4算出）」。from と to を別々に見る。EPS には付けない（赤字の文も同じ）。
   - 例：「売上 前年比が2026-03期 +60% → 2026-06期 +30%（Q4算出）と伸びが鈍化しています。」
4. **売上タイルの「前期 +x%」**：前の行の売上の前年比が算出に乗っていれば「（Q4算出）」。EPS の前期には付かない（EPS は算出しない）。前期に値が無く理由を出すときも付かない。タイル自身の「・前年同期はQ4算出」と `derived` の判定はそのまま（その行は触っていない）。
5. **折り返し**：印は `span.brief-q4-mark`（`white-space: nowrap`、brief-fundamentals.css）で包み、印の中では折れない。390px の ZZQF の売上タイルが「（Q4」「算出）」で折れていたため（実測、下）。タイルの注記と未達の根拠の文に使う。
6. 触っていないもの：CARD_NOTE・EPS_NOTE（もともと「Q4算出」）、QuarterTable の「（Q4算出）」、code33Explain、チップ、判定・スコア、チャートのファイル。新しいしきい値は無い。

### 算出した前年同期（base）の扱い（ここで決めたこと）

- 売上の前年比は、その四半期か前年同期のどちらかが算出した Q4 なら、値が算出に乗っている。だから `salesDerived` か `salesBaseDerived` のどちらかで印を付ける。`salesDerived` を持たない行は行自身の `derived` を読む（タイルの `derived` と同じ読み方）。
- 純利益率はその四半期の売上と純利益だけから出すので、`derived`（売上か純利益が算出）のときだけ。前年同期は関係しない。
- EPS は算出しない（bookFinancialEvidence が算出の EPS を受け付けない）ので、印は付かない。

### 規則 18

記録のキー・警告コード・インデックスの項目は1つも足していない。足したのは UI の定数と関数だけ。`fundamentalTiles(...).note` を読むのはカードだけ（report-data-coverage.mjs が読むのは `tile.value` の数だけ）。

### 既存のテストで変えたもの

文言を producer から読むように変えた箇所だけ。数値の上限・箱の位置は1つも変えていない。

- `brief-fundamentals.spec.js`
  - 「fundamentals show the latest SEC quarter …」（全ビューポート）：ZZNV の出典の文字列を `` `…2026-06期まで${Q4_DERIVED_SOURCE_NOTE}` `` に。
  - 1440「keeps the desktop layout …」：凡例の項目を `Q4_DERIVED_LEGEND` に。箱（x・幅・順序）はそのまま通る（ZZNV の出典は 1440 で 2 行のまま）。
  - 390「keeps the Code 33 parts visible beside a 未達 …」：未達の根拠の文に「（Q4算出）」が入る（ZZNV の 6 月の売上は算出なので、言い換えではなく項目 3 による変化）。
  - ヘルパーの移動：320 の `wider` とセルの切れの判定（`cutCells`）、390 の注意の1行判定（`lineFit`）をファイルの先頭に出した。アサーションは変えていない。
- `StockFundamentalsCard.test.jsx`「flags a sales rate whose quarter or year-ago base is a derived Q4」：出典の2つの文字列を producer から。注記が無いことの確認は、言い換えで空振りになるので `/Q4算出|10-K年度値−3四半期/` に。

### 新しいテスト

- `fundamentalsExplain.test.js`（4 件）：3つの文字列（U+2212、`-3` が無い）、`q4DerivedRate`（売上の四半期・前年同期、純利益だけ算出の銀行、EPS は常に false、null、`salesDerived` の無い古い行）、`q4DerivedSourceNote`（行・タイル・どちらも無い）と `fundamentalsSource` が変わらないこと、売上タイルの前期の印（ZZQF の形・前年同期だけ算出・ZZNV の形は変わらない・印なし・理由のときは印なし）。
- `StockFundamentalsCard.test.jsx`（3 件、ZZQF と同じ形の記録を試験の中で作る）：
  - スマホ：軸の「算出」、出典の注記、売上タイル「2026-09期・前期 +43%（Q4算出）」と印の span、EPS の前期は理由、利益率は期だけ、スマホの凡例は4項目のまま。
  - デスクトップ：凡例の項目、カードの注記の「「Q4算出」と表示します」、出典に注記が無いこと、タイルの印。算出のタイルがあるときは両方の幅で注記。算出が無いときはどちらの幅でも注記・凡例の項目・印が無い。
  - 未達の根拠：EPS・売上・利益率が同じ四半期で落ちる記録で、売上と利益率だけに印（EPS には付かない）。前年同期だけ算出で印。from の四半期が算出なら from の後に印。算出なしで印なし。赤字の文には印なし。
- `brief-fundamentals.spec.js`（4 件、オラクル ZZQF、`openBrief(page, '#/brief/stock/ZZQF', { oracles: true })`、`chartSettled`、reduced motion）：
  - 320×640・375×812・390×844：出典の文字列（注記つき）が見えていて閉じた折りたたみの中に無い、軸の「算出」、スマホの凡例、売上タイルの文字列と印が1つの行に収まる（`lineBoxes`）、横はみ出し 0、セルの切れ 0（`cutCells`・`wider`）、品質チップは各1行・自分の箱の余り 6px 以上・カードの右端まで 6px 以上、375 で画面の高さ 3388 以内。
  - 1440：凡例の項目とカードの注記が見える、出典は注記なし、タイルの印、横はみ出し 0、セルの切れ 0、カードの高さ 847 以内（STEP 0 の 846.8）。

### 実測（このサンドボックス、CI と同じ設定：Chrome for Testing 147 headless shell、CI のフォント、ポート 4422）

- **A**：`cd $W/frontend && npx vitest run src/static/fundamentalsExplain.test.js src/static/brief/StockFundamentalsCard.test.jsx` → 2 files、48 passed（27＋21。基準は 23＋18）。
- **B**：`AUDIT_PORT=4422 AUDIT_MATCH='brief-(fundamentals|oracles|compact|phone|accessibility)' npx playwright test -c $S/audit3/r3-data/pw-147.config.mjs` → 149 件、147 passed・2 skipped（7.5 分、再実行なし）。内訳：fundamentals 33（基準 29＋4）、oracles 40（38 passed＋R1・R2 の fixme 2）、compact 27、phone 39、accessibility 10。compact・phone の上限は変えていない。負荷（advisory）：前 1.64 / 後 5.67。
  - その前に fundamentals だけを1回：33 passed（再実行なし）。
  - B はコミットを2つに分ける前の作業ツリーで走らせた。分けた後の 9efa9927 の3つの試験ファイルは、B で走らせたファイルとバイト単位で同じ（`git show 9efa9927:<path> | cmp - audit3/r3-data/d4-split/*.final`、3つとも一致）。ソースの3ファイルは B の後に編集していない（`git diff 9efa9927 -- frontend` は空）。A・C・F・G はコミット後の 9efa9927 で走らせた。
- **C（dump）**：コミット後に `$H/dump/run-dump.sh $W 4422` → `dump-9efa992.json`（sha256 996e122d…8982）、42 画面・エラー 0。`dump-8849bf9.json` との差（スクラッチの `audit3/r3-data/d4-dumpdiff.py`）：
  - 違う項目は `text` だけ。`boxes`・`content`・`page`・`blocks`・`rows`・`overflow` はすべての画面で同じ。高さの変化は 0。
  - 違う行は2つだけで、どちらも ZZNV の業績カードの中：
    - 出典：「…・2026-06期まで・売上/純利益のQ4は10-K年度値−3四半期で算出」→「…・2026-06期まで・Q4算出：売上/純利益のQ4は10-K年度値−3四半期」
    - デスクトップの凡例の項目：「算出＝Q4を10-K年度値−3四半期で算出」→「算出＝Q4算出（10-K年度値−3四半期）」
  - 違う画面は 10。375 の ZZNV と ZZNV 週足（出典だけ）。1440 の ZZNV と ZZNV 週足（2行）。それに 1440 の today-4・today-5・list-zone-4・list-zone-5・watch-4・watch-5（2行）。この6つは、デスクトップの右の欄に ZZNV の銘柄画面を開いている画面（実測：欄の業績カードの直前の銘柄が ZZNV で、出典がある）。右の欄が ZZAR・ZZZF・ZZHW などの 1440 の画面と、ほかの 375 の画面はすべて同じ。指示の想定（ZZNV の銘柄画面だけ）より画面は多いが、違う要素は同じカードの同じ2行（下の「指示からの逸脱 2」）。
- **D（規則 16）**：`git -C $W diff --name-only 45603f06...HEAD` → docs/round3/data.md、StockFundamentalsCard.jsx (+test)、brief-fundamentals.css、fundamentalsExplain.js (+test)、brief-fundamentals.spec.js、report-data-coverage.mjs (+test)。チャートのファイル（priceChart.js・chartLabels.js・PriceChart.jsx・StockChartCard.jsx・chartReadout.js・bookTechnicalEvidence.js）は無い。492 画面のプローブは不要で、走らせていない。C で高さが変わらなかったので、heights も走らせていない。
- **E**：`npx eslint src/static/fundamentalsExplain.js src/static/brief/StockFundamentalsCard.jsx tests/static/brief-fundamentals.spec.js` → 0 errors（2つの試験ファイルも 0）。
- **F**：`npx vitest run`（全体）→ 247 files、3997 passed。負荷（advisory）：前 0.74 2.14 2.85 / 後 5.81 4.16 3.51。
- **G**：`$H/build/run-build.sh $W` → `build-9efa992.json`。`npm run build` の入口チャンク 373.39 kB・gzip **130.52 kB**。STEP 0（c61bf96・996bfdc、130.28）から **+0.24 kB**（DATA の D4 までの差。D2 はツールだけで入口に入らない）。線 134.00 まで 3.48 kB。Design Acceptance の入口は gzip 130.31 kB（vite）。
- **H**：`python3 -I $S/audit3/check-ownership.py DATA $W 45603f06…` → コードのコミットの前に `OWNERSHIP OK (DATA): 8 paths`、テストのコミットの前に `9 paths`。この文書のコミットの前にも走らせる。
- **I**：古い r3-data の HEAD の名前の dump・probe・build の出力は無かった（P1 は作っていない）。消したものは無い。8849bf9・c61bf96 と他トラックの出力には触っていない。

画面の高さ（スクラッチの `audit3/r3-data/d4-measure/measure.spec.js`。STEP 0 の oracle-heights.spec.js と同じ測り方：`#brief-main .brief-stack` の下端、reduced motion、有限のアニメーションを待ち、1.5 秒の DOM の静止。変更前の木（d4d5d327）で STEP 0 の数をそのまま再現した）：

| 銘柄 | 320×640 | 375×812 | 390×844 | 1440×900 |
|---|---|---|---|---|
| ZZQF（STEP 0 → D4） | 3189 → 3207（+18） | 2985 → 3000（+15） | 2985 → 3000（+15） | 1832 → 1832 |
| ZZQF のカード | 659.4 → 677.4 | 607.3 → 622 | 607.3 → 622 | 846.8 → 846.8 |
| ZZNV（既定の行） | 3308 → 3308 | 3044 → 3044（線 3388） | 2954 → 2954 | 1832 → 1832 |
| ZZNV のカード | 712.2 → 712.2 | 656.8 → 656.8 | 593.5 → 593.5 | 914.3 → 914.3 |

- ZZQF の 320 の +18 は出典の行が 2 → 3 行（注記）。375・390 の +15 は売上タイルの注記が 1 → 2 行（「（Q4算出）」が次の行へ。375 は「2026-09期・前期 +43%」「（Q4算出）」、390 も同じ）。375 の 3000 は線 3388 の中。
- 銀行の形（spec の `bank`：売上なし・純利益の 6 月は算出）のカード：320 625.5 → 643.5（上限 655）、375 588.1 → 588.1（上限 588.1）、1440 872.7 → 872.7（上限 872.7）。375 では出典の2行目が 313px のうち 302.4px で、残りは **10.6px**。上限との余裕は 0 なので、出典がもう1文字長くなると 375 の上限を超える。
- ZZQF の品質チップ（「EPS前年比≥25%（直近4期）未確認」「年間EPS最高 未確認」）：どの幅でも各1行。自分の箱の余り 10 / 14 / 14 / 18px（320 / 375 / 390 / 1440）、カードの右端までの余り 62.7px 以上。
- 印の折り返し（スクラッチの wrap.spec.js）：nowrap の前、390 の ZZQF の売上タイルは「2026-09期・前期 +43%（Q4」「算出）」と印の中で折れていた。nowrap の後は 320「2026-09期・前期 」「+43%（Q4算出）」、375・390・1440「2026-09期・前期 +43%」「（Q4算出）」。

### 指示からの逸脱

1. **デスクトップでは、行だけが算出のときに出典の注記を付けない。** 指示どおり（どの幅でも `rows.some(r => r.derived)` で付ける）にすると、デスクトップで出典が1行増え、銀行の形のカードが上限を超える（実測：1440 で 872.7 → 893.1、上限 872.7。ZZQF は 846.8 → 867.2）。上限は上げない、文言を短くしても 1440 の1行目の残り（約 110px）には入らない、という指示の優先順に従った。
   - デスクトップでも鍵は欠けない。軸の「算出」は、軸と同じ条件（`rows.some(r => r.derived)`）で出る凡例の項目が鍵になる。タイルと文の「（Q4算出）」とクォーター表は、デスクトップでカードの中に出る注記（CARD_NOTE の「「Q4算出」と表示します」）が鍵になる。
   - 指示どおりに戻すときのコード：`q4DerivedSourceNote(wide ? [] : rows, tiles)` を `q4DerivedSourceNote(rows, tiles)` に（1か所）。ただし、この逸脱はテストでも固定しているので、次も一緒に変わる：
     - `StockFundamentalsCard.test.jsx`「on the desktop keys 算出 with the legend item …」：デスクトップの ZZQF の出典に注記が無いこと。
     - `brief-fundamentals.spec.js` の D4 の 1440：ZZQF の出典の文字列（注記なし）と、カードの高さ 847 以内（指示どおりなら 867.2）。
     - `brief-fundamentals.spec.js` の round-2 の 1440「the card of a bank keeps its step-0 height」：上限 872.7（指示どおりなら 893.1 で落ちる）。この上限を誰かが決め直す必要がある。
   - どちらを採るかは指揮者が決める。
2. **dump の差は、想定より6画面多い。** 1440 の today・list-zone・watch（各 4・5）は右の欄に ZZNV の銘柄画面を出すので、同じカードの同じ2行が変わる。要素も箱も想定どおり。
3. **印を nowrap の span で包んだ**（手順 6 が許す CSS）。タイルの注記と未達の根拠の文が対象。testing-library の `getByText` は自分の文字ノードしか見ないので、印のある文は `textContent` で確かめている。

### 未検証

- 窓の中に算出した Q4 がある実データの銘柄は、ここでは描画していない（SNAP の再現の上でも D4 の画面は見ていない）。
- 公開版（Pages）での表示。
- 時間の計測はしていない（チャートのコードは触っていない）。ここの負荷の数はすべて advisory。
- 492 画面のプローブと heights は走らせていない（規則 16 の対象外、C で高さの変化なし）。

### 統合への依頼

- CONTEXT.md：「Q4算出」を一つの名前として載せる。10-K の年度値から3四半期を差し引いた fiscal Q4 の売上・純利益（EPS は算出しない）。軸の短い「算出」は、スマホでは出典の行が、デスクトップでは凡例が鍵になる。
- 計画 §5 D4 の「whenever rows.some(r => r.derived)」：上の逸脱 1 を採るなら「スマホでは常に、デスクトップではタイルが算出のときだけ（凡例と注記が鍵）」と直す。採らないなら銀行の 1440 の上限を決め直す。
- D4 の dump の想定に、ZZNV を右の欄に出す 1440 の6画面を加える。

pre-D3 SHA：測った木 9efa9927 の上に、この文書だけを変える docs(round3) のコミットが1つ。その SHA が D4 までの区切り（D3 を入れないときの落とし所）で、指揮者への報告に書く。`git diff 9efa9927..<その SHA> --name-only` は docs/round3/data.md だけ。


## D3（分離可能）独自計算・参考の fiscal Q4 EPS：作る側と精度の計測、出力は止めたまま（P3）

D3 のうち作る側（`frontend/tools/sec-financials.py`）だけ。UI 側（admission の任意キー、カードの表示）は P4。出力は止めてある（`Q4_EPS_REFERENCE_EMIT = False`）ので、公開されるレコードの形は変わらない。Q4 の参考値は**判定・点数・絞り込み・並べ替えのどれにも使わない**（使うかどうかはオーナー判断 OD1、既定は使わない）。

### 方法

10-K の中でしか fiscal Q4 を報告しない会社の、各会計年度（330〜400 日の年度値）について：

- **分子（Q4 純利益）**：既存の `derive_fourth_quarters`（そのまま）で、年度値から同じタグの3四半期を引いた残り。タグは `Q4_REFERENCE_NUMERATOR_TAGS` の順に試し、年度値があって3四半期が年度を隙間なく埋める最初のタグを使い、そのタグを記録する。会計年度末に終わる四半期の値（10-K の Q4 の報告値）があっても、計算からは外す。残りは常に「年度値 − 3四半期」になる。
- **分母（Q4 の希薄化後加重平均株数）**：(年度の加重株数 × 年度の日数 − Σ 四半期の加重株数 × その日数) ÷ Q4 の日数。株数の事実は、分子の鎖と**同じ期間の境界**のものだけを使う。日数は両端を含む（concept_points と同じ数え方）。基本株数なら正確、希薄化後は近似（希薄化の増分と逆希薄化の除外が期間ごとに決まるため）。docstring にもそう書いた。
- **値**：round(Q4 純利益 ÷ Q4 株数, 4)。

### 定数（すべて 独自設定：このブリーフ自身の選択で、SEC の規則でも Minervini の規則でもない）

| 定数 | 値 | 意味 |
| --- | --- | --- |
| `Q4_EPS_REFERENCE_EMIT` | `False` | ただ一つのスイッチ。オフでも計算と精度の行は動く。レコードには載らない |
| `Q4_REFERENCE_METHOD` | `"q4-ni-over-q4-diluted-shares-v1"` | 各エントリーに書く方法の名前 |
| `Q4_REFERENCE_NUMERATOR_TAGS` | `NetIncomeLossAvailableToCommonStockholdersDiluted` → `…Basic` → `NetIncomeLoss`（USD） | 分子。この順に試す |
| `Q4_REFERENCE_SHARE_TAGS` | `WeightedAverageNumberOfDilutedSharesOutstanding`（`shares`） | 分母 |
| `Q4_REFERENCE_SHARE_BAND` | `0.10` | Q4 株数が [min(Q1..Q3) × 0.9, max(Q1..Q3) × 1.1] の外なら分割・修正とみなす |
| `Q4_REFERENCE_CHECK_TOLERANCE` | `0.02` | Q1〜Q3 の各期で \|報告 EPS × 株数 − 純利益\| ≤ 0.02 × \|純利益\| |
| `Q4_REFERENCE_MAX` | `4` | 1レコードあたりのエントリー数の上限（新しい方を残す） |
| `Q4_REFERENCE_WITHIN_CENTS` / `_SHARE` | `0.01` / `0.02` | 精度の「1¢ または 2% 以内」 |

タグは `TAGS` に**入れていない**（制約 1）。`TAGS` はレコードの `quarterly` のキーを決め、ブラウザーの admission の `SEC_FIELD_TAGS`（sameKeys）と一致を検査されている。分子の2つ（`NetIncomeLoss` と `…Basic`）は元から `TAGS["netIncome"]` にあり、そこは変えていない。

### 値が未確認のまま（エントリーなし）になる理由

上から順に調べ、最初に当たった理由を数える。

| 理由 | いつ |
| --- | --- |
| `no_numerator` | どの分子タグにもその年度の年度値がない（年度は、分子・株数の年度値または年次 EPS から知る。derivation_gaps と同じ考え方） |
| `no_tiling` | 年度値はあるが、どのタグの3四半期も年度を埋めない。または株数の事実が分子と別の期間の境界にある |
| `no_shares` | 年度または Q1〜Q3 の希薄化後加重株数が無い |
| `split_band` | Q4 株数が 0 以下、または帯の外 |
| `check_failed` | Q1〜Q3 のどれかに報告 EPS が無い、または 2% の照合に落ちる（純利益 0 は落ちる） |
| `not_finite` | 商が有限の数でない |
| `error` | 計算そのものが例外を出した（レコード単位。fetch_symbol が数える） |

**数える年度（ここで決めたこと）**：エントリーになり得る年度だけ、すなわちレコードの窓の中（`TRIM_DAYS` の cutoff 以降）で、Q4 EPS が報告されていない年度。窓より古い年度と、Q4 EPS が報告されている年度は `refused` に数えない。

例外：四半期の EPS も売上高も無いレコードには cutoff が無い（normalize も切らない）。そのレコードでは、事実のあるすべての会計年度が数えられ、多くは `check_failed`・`no_shares`・`no_numerator` になる。そのため `refused` の合計が大きく出ることがある（エントリーは出ない。報告 EPS が無いと照合に落ちるため）。

### エントリー

`{"end", "start", "value", "method", "numerator": {"tag", "components": [年度の accession, q1, q2, q3]}, "shares": {"tag", "components": [年度, q1, q2, q3]}}`（キーはこれだけ）。end 順、レコードの cutoff 以降の年度末だけ、四半期 EPS が報告されていない年度末だけ、最大 4 件。`quarterly.eps` には何も足さない・埋めない（制約 4）。報告 EPS は、レコードと同じ**切る前**の系列（`series(facts, "eps", as_of)`）から読む。切った後の系列だと、窓の最も古い年度の Q1〜Q3 が欠けて誤って `check_failed` になる。

### 精度の計測（レコードには書かない）

- `q4`：Q4 EPS を報告している年度で、同じ理由の規則で計算した参考値と、報告された Q4 EPS（同じ開始日のもの）を比べる。
- `q1_q3`：埋まる年度すべての Q1〜Q3 で、純利益 ÷ 加重株数と報告 EPS を比べる。2% の照合の**前**に測る（後で測ると定義上 2% 以内になる）。窓より古い年度も含む。
- それぞれ `{"n", "median_abs_error", "within_1c_or_2pct", "share"}`。誤差は 6 桁に丸めてから 1¢・2% と比べる（ちょうど 1¢ の差が二進の浮動小数で落ちないように）。中央値と share は 4 桁。

### 配線

- `fetch_symbol(…, q4_reference=None)`：normalize が成功した（available / partial）後、**normalize の try の外**で、別の try の中で `attach_q4_reference` を呼ぶ。例外ならレコードは normalize が返したまま、`error` を数える（制約 3）。`q4EpsReference` を付けるのは `Q4_EPS_REFERENCE_EMIT and entries` のときだけ。
- `collect`：既存の lock の下で集計し、`output["q4_reference"]` を返す（`payload_cik` と同じ扱い）。
- `main`：それを取り出し、1行 `SEC q4 reference accuracy <date>: {...}` を出し、同じ行をステップサマリーに足し、ファイルの `coverage.q4_reference` に書く（集計だけ、銘柄なし）。
- 集計の形：`{"emit": false, "records_with_reference", "entries", "refused": {理由: n（error を含む）}, "q4": {...}, "q1_q3": {...}}`。`records_with_reference` と `entries` は、出力がオフでも「計算できた数」。

**集計レポートの経路（計画の細部をここで決めた）**：`coverage.q4_reference` はファイルの最上位の coverage で、レコードのキーでも警告コードでも索引の項目でもない。`git grep -n "brief_fetched\|q4_revenue_derived" -- . ':!docs'` は sec-financials.py とそのテストだけを返した（実測）。ファイルの coverage を厳密に検査するものは無い：`secInputSummary` は名前のあるキーだけを読み、`secEvidenceLine` は `file.coverage` を展開して「SEC evidence … (published file)」の行に出す（両方のワークフローが `--sec-evidence` で出す）。ブラウザーはこのファイルを読まない。`git grep -ln "sec-financials\|sec_financials" -- frontend .github` の先も見たが、作る側のファイルのバイトを固定しているゴールデンは無い。したがって報告側のコードは変えず、テスト1つで固定した。

### 規則 18

レコードのキー `q4EpsReference` は**出力オフ**（`Q4_EPS_REFERENCE_EMIT = False`）で出荷するので、公開されるレコードの形は変わらない。未知のレコードのキーを拒むのはブラウザーではなくツールである：export-research.mjs の admission、financial-correction-overlay.mjs の再 admission（`fail`）、集計レポートの admission。どれも bookFinancialAdmission.js の sameKeys を通る。P4 より前のコミットから作ったリリースは、このキーのあるレコードを丸ごと拒む。ファイル最上位の `coverage.q4_reference` は、レコードのキーでも警告コードでも索引の項目でもない。

### テスト

- `frontend/tools/test_sec_financials.py`：39 → 54（新しい 15）。
  - `Q4EpsReference`：埋まる年度（値 = Q4 純利益 ÷ Q4 株数 = 1.3592、4件ずつの components）。分子タグの順と記録（希薄化後 → 年度値なし／鎖が切れていれば基本 → NetIncomeLoss）。分割（年度値が2倍、残りが負）→ `split_band`。欠けた事実 → `no_shares`（四半期・年度・タグごと無い）、`no_numerator`、`no_tiling`（純利益の Q2 が無い、株数の Q2 が別の境界）。損失の Q4（希薄化後 = 基本）→ 負の値。Q1〜Q3 の照合失敗（EPS がずれる・無い・純利益 0）→ `check_failed`、ずれた期も精度のサンプルには入る。Q4 EPS を報告する会社 → エントリーなし、`q4` のサンプル1件（10-K の Q4 純利益・株数は外して計算）。窓と上限（2022〜2025 の4件、上限 2 で新しい2件、上限 10 でも窓で4件、窓より古い年度の失敗は数えない）。`quarterly.eps` は埋めない、`TAGS` は変わらない。
  - `Q4EpsReferenceEmission`：出力オフで、株数の事実があってもなくても書くレコードが normalize の出力とバイト一致、`q4EpsReference` は無い（制約 2）。出力オン（定数をテストで差し替え）でちょうどその形のキー、外せば normalize の出力と一致。計算に例外を注入 → レコードは normalize のまま、`error` を数える（制約 3）。読めないペイロードは計算に届かない。
  - `Q4EpsReferenceAccuracy`：精度の算術（n = 0 で null、ちょうど 1¢・ちょうど 2% は以内）。collect の集計。main の行・ステップサマリー・ファイルの `coverage.q4_reference`（ネットワークなし：collect を差し替え、一時ディレクトリで実行）。
- `frontend/tools/report-data-coverage.test.mjs`：23 → 24（新しい1つ）。`secEvidenceLine` がファイルの `coverage.q4_reference` を null も含めてそのまま出し、集計の無い古いファイルは今までどおり。

### 実測（このサンドボックス）

- A：`cd frontend/tools && PATH=/opt/node22/bin:$PATH python3 -m unittest test_sec_financials` → 編集前 `Ran 39 tests … OK`、編集後 `Ran 54 tests … OK`。
- B：`npx vitest run tools/report-data-coverage.test.mjs`（SESSION_CALENDAR_PYTHON・FINANCIAL_REPLAY_PYTHON を指定）→ 24 passed。全体の `npx vitest run` → 247 files / 3998 tests passed（302.95 s、loadavg 前 2.61 1.69 1.22、後 9.32 6.29 3.34。時間は advisory）。
- C：`git grep -n "q4EpsReference" -- frontend/src` → 何も出ない（UI 側は P4）。
- 制約 2 の基準との照合（スクラッチ、コミットしない）：45603f06 の sec-financials.py と新しいものを並べて読み込み、同じ 10 のペイロード（7年分、参考値のある年度、Q4 EPS を報告する会社、損失、株数なし、照合失敗、別タグの年度値、cik 不一致、壊れた facts、20-F だけ）で `collect` を回した。`results` は JSON でバイト一致（sha256 先頭 304c62871fe0cb57 が両方）、`coverage()` も一致、`write_output` のファイルは `coverage.q4_reference` を除いて一致、ファイルに `q4EpsReference` の文字列は無い。collect の戻り値で増えたキーは `q4_reference` だけ。
- 変異の確認（スクラッチのコピー）：出力オン、10-K の Q4 の値を外さない、normalize の try の中で計算、cutoff なし、切った EPS 系列、の5つとも、新しいテストのどれかが落ちる（cutoff なしは最初は上限 4 に隠れて通ったので、上限 10 の確認を足した）。
- ownership gate：コミットの前ごとに `OWNERSHIP OK (DATA): 11 paths`。

### 未検証

- 実データの精度（`q4`・`q1_q3` の数）はすべて未検証。ここでは何も取得していない（`main()`／data.sec.gov への collect は実行していない）。最初の公開の実行のログの `SEC q4 reference accuracy <date>` の行が計測になる。
- 実際の会社のうち、何社の年度が埋まるか（`WeightedAverageNumberOfDilutedSharesOutstanding` を使わず `WeightedAverageNumberOfShareOutstandingBasicAndDiluted` だけを付ける会社は `no_shares` になる）。
- 計画の「掲載のうち Code 33 が fiscal Q4 にかかるのは最大 103 行、Q4 の行に付けられるのは最大 21 行」の上限。
- 52/53 週の会計年度や決算期の変更での振る舞い（テストは暦年の会社だけ）。

### 設計の注記（精度の行を読む人へ）

- **2% の照合は、EPS が小さい会社にはきびしい。** 報告 EPS はセント単位に丸められている。丸めの誤差（最大 0.005）だけで、\|EPS\| が約 0.25 ドル未満のときに 2% を超えうる。そうした会社の年度は `check_failed` になり、`q4` のサンプルからも外れる。指示どおりの許容幅の帰結なので、ここでは直さない。OD1 の判断の材料として、指揮者に申し送る。

### 指示からの逸脱（小さいもの）

1. n = 0 のとき、`within_1c_or_2pct` も null にした（指示は中央値と share だけ null）。サンプルが無いときの「以内の数」も測っていないので。
2. `q4_eps_reference(facts, as_of, eps_quarters, cutoff=None)`：レコードの窓を渡すため、任意の引数 `cutoff` を足した。normalize の窓は `trim_cutoff` に出し、normalize もそれを呼ぶ（出力は変わらない、上の照合）。
3. 「商が有限でない」の理由名を `not_finite` にした。`error` は `refused` の中に、レコード単位で数える。
4. 単位と「1¢・2%」も名前のある定数にした（`Q4_REFERENCE_NUMERATOR_UNIT`、`Q4_REFERENCE_SHARE_UNIT`、`Q4_REFERENCE_WITHIN_CENTS`、`Q4_REFERENCE_WITHIN_SHARE`）。
5. 既存の `SEC evidence <date>: …` のログ行は `output["coverage"]` を丸ごと出すので、そこにも `q4_reference` が入る（ファイル最上位に書く経路の帰結。ログだけ）。

### 分離

D3 のコミットは d8457cfb（pre-D3）の上の3つ：b306c6de（feat：作る側とその Python テスト）、19135046（test：集計レポートの1テスト）、この docs(round3) のコミット。触るのは frontend/tools/sec-financials.py、frontend/tools/test_sec_financials.py、frontend/tools/report-data-coverage.test.mjs（末尾に足した describe）、docs/round3/data.md（この節）だけ。3つを戻せば D2・D4 の状態に戻る。

### 統合・オーナーへの依頼

- **OD1**：出力のスイッチ（`Q4_EPS_REFERENCE_EMIT = True`）は後の別の変更で、次の両方の後に限る：(a) round 3 の UI（P4 の admission の任意キーと表示）が Pages で動いていることを読み取りだけで確かめた、(b) オーナーが公開の実行の精度の行を見た。
- P4 の admission は `q4EpsReference` を任意・厳密なキーとして受け、無いレコードは今と同じに扱うこと（上の規則 18）。
- CONTEXT.md：「独自計算・参考 Q4 EPS」（方法の名前 `q4-ni-over-q4-diluted-shares-v1`、判定に使わない）を載せる。
- I6/I7 で読むもの：公開の実行の `SEC q4 reference accuracy <date>` の行（と `--sec-evidence` の行の `q4_reference`）。run id と JST の時刻を添える。

## D3（分離可能）の UI 側：任意キーの admission、参考の表示、判定に使わないことの証明（P4）

P3 の作る側（出力は止めたまま）に続く、受け取る側と見せる側。出力のスイッチ（`Q4_EPS_REFERENCE_EMIT`）は**オフのまま**で、既定の fixture・公開のレコードにこのキーを持つものは無い。参考値は**判定・点数・絞り込み・並べ替えのどれにも使わない**（OD1、既定は使わない）。

### 変更

- **admission**（`bookFinancialAdmission.js`）
  - `OPTIONAL_RECORD_KEYS` に `q4EpsReference`。available・partial のレコードだけ（unavailable のレコードの `UNAVAILABLE_KEYS` には入れていないので、そこに付いていれば `keys` で拒む）。
  - 作る側と同じ定数を出す：`SEC_Q4_REFERENCE_METHOD = 'q4-ni-over-q4-diluted-shares-v1'`、`SEC_Q4_REFERENCE_TAGS = { numerator: [3タグ], shares: ['WeightedAverageNumberOfDilutedSharesOutstanding'] }`、`SEC_Q4_REFERENCE_MAX = 4`（test_sec_financials.py が Python 側と照合する）。
  - `q4ReferenceEntryValid(entry, asOfDate)`（カードの読み手と共有）：キーは end・start・value・method・numerator・shares だけ。日付は正しい日、start ≤ end ≤ asOfDate、期間は両端を含めて 70〜105 日（safeSeries・Python の `_days` と同じ数え方）、value は有限の数、method が一致、numerator・shares はキーが tag・components だけで、tag は上の一覧の中、components はちょうど4つの空でない文字列。
  - リスト：1〜4 件、end が厳密に増える、どの end も quarterly.eps の点の end と一致しない（報告された EPS を参考値で覆わない）。
  - どれかに外れればレコード全体を**既存の理由 `keys`** で拒む。`SEC_REFUSAL_REASONS`・`REFUSAL_TEXT` は変えていない。キーの検査は既存の検査の**後**（limitations の後）に置いたので、キーのあるレコードでも既存の理由（`series:eps` など）が先に名指しされ、quarterly.eps は検査済みの系列として読める。キーの無いレコードは今までとまったく同じ（基準の 66 件のテストが新しい admission の上でそのまま通る、実測）。
  - `admitPoint`（quarterly.eps に算出した EPS が入れば `series:eps`）と bookFinancialEvidence の `safeSeries`（同じく拒む）は**変えていない**。テストで確かめただけ。
- **読み手**（`fundamentalsExplain.js`）
  - `q4EpsReference(record, report)` → `[]` か `[{ end, value, yoy, yoyBase: 'reported' | 'reference' | null }]`（古い順）。表示のためだけ。
    - ブラウザーは admission を走らせない（admission はツールの中だけ：export-research.mjs・financial-correction-overlay.mjs・report-data-coverage.mjs）。だから自分で厳しく確かめ、形の崩れたものは無いものとして扱う。
    - リストの形（配列、1〜4 件、end が文字列の日付で厳密に増える）が崩れていれば全体が無い。
    - 1件ずつ：`q4ReferenceEntryValid` に外れる、quarterly.eps に書かれた四半期で終わる、カードの窓（`report.rows.slice(-8)`）の `fiscalQ4: true` かつ `eps === null` の行でない、のどれかなら落とす。
    - 前年比は bookFinancialEvidence の `yoyDetail` をそのまま使う（基準の規則を二つ目に書かない）。系列は、報告された EPS の点と、見せる参考値を点の形にしたもの（同じ end なら報告が勝つ）。`yoyDetail` が理由（前年同期なし・赤字やゼロの前年同期・期間の不一致など）を返せば `yoy` は null、`yoyBase` も null。
    - 報告された EPS は、bookFinancialEvidence がその系列を丸ごと拒んだ（`refusedSeries` に eps）ときは使わない（安全でない基準から率を作らない）。safeSeries は全部か無しかなので、拒まれていなければ生の quarterly.eps が検査済みの系列そのもの。
    - 参考値の基準になるのは、見せる参考値だけ（窓の外の参考値は基準にしない）。
  - `secStatus` の `make('ok', …)` に、リストが空でないときだけ `q4Reference` を足す。キーの無いレコード（と、全部が落ちたレコード）の secStatus の結果は今と deep-equal。
  - 行の文：`q4ReferenceLine(reference)` → 見せる中で一番新しい四半期について「参考（独自計算・判定に使わない）：26-06期 Q4 EPS ≈ 1.80（純利益÷希薄化株数）→ 前年比 +71%（前年同期も参考値）」。率が無ければ「→ 前年比 …」を付けない（+0% と書かない）。基準が参考値なら「（前年同期も参考値）」。率は `growth`（`wholePercent` の後 `signed`）なので 0.3% は ±0%、負の数は U+2212（`fixedMinus` と `signed`）。
  - 棒の title：`q4ReferenceTitle(entry)` →「参考（独自計算）Q4 EPS ≈ 1.80 → 前年比 +71%（前年同期も参考値）」。カードは「2026-06期 EPS 前年比：Q4のEPSは年次報告のみ・」の後ろに付ける。
  - デスクトップの凡例：`Q4_REFERENCE_LEGEND = '太い破線＝参考（独自計算・判定に使わない）'`。
- **カード**（`StockFundamentalsCard.jsx`、`brief-fundamentals.css`）：`financial.sec.q4Reference` を読む（`sec.state === 'ok'` で配列のときだけ、窓の行にある end だけ）。
  - (a) Code 33 の箱（と3条件）の下に1行、`p.brief-note.brief-fin-reference`。カードの上で、どの幅でも折りたたみの中に入れない。
  - (b) 棒：参考値のある四半期の EPS の棒は、同じ大きさ・同じ位置の灰色の `q-unknown` の rect のまま、`is-reference` の class で**太く濃い破線**（`stroke: var(--text-2); stroke-width: 2px; stroke-dasharray: 4 2`）。title は上のとおり。
  - (b) 軸：率があれば EPS のセルに既存の4文字の `growthShort` の形で書き（例「+71」、赤字の参考値は「赤字」）、灰色の破線のセル（`q-eps-t is-reference`、`outline: 1px dashed`、`outline-offset: -1px`、角は 4px のトークン）。EPS の色にはしない。率が無ければ「—」のまま（`is-unknown`）。outline なのでセルの大きさは変わらない。
  - (b) 1024px 以上の凡例に「太い破線＝参考（独自計算・判定に使わない）」（見本は同じ破線の四角）。スマホの凡例は4項目のまま（行の文が「参考」を言う）。
  - (c) 棒の尺度（`known`、up・down・span）は行の `epsYoY`・`salesYoY` だけから作るので参考値を含まない。その四半期は「値なしの理由」に元の理由（「Q4のEPSは年次報告のみ」）で残る。タイル・品質のチップ・Code33Parts・Code 33 の箱の題・文・色・settledText・出典の行は変えていない。Code 33 は 未確認 のまま。
  - 参考値が無い（または全部落ちた）ときは、何も足さない：空の要素も、class の文字列も増えない（DOM が同じ、下のテストと dump）。
- **変えていないもの**：quarterly.eps の扱い、`chipQuarter`、`epsFloor`、`earningsChipView`、`earningsCaution`、`secRowChip`、`code33ChipView`、`buildSecSummary`・`secSummary` の出力、`code33Explain`。UI に新しいしきい値は無い（10% 帯・2% 照合などは作る側の 独自設定、P3）。

### 計画の修正（指揮者の指示どおり、コードに合わせた）

- 計画の「admitPoint と safeSeries は算出の EPS を拒む（bookFinancialAdmission.js:49）」：admitPoint は bookFinancialAdmission.js、safeSeries は bookFinancialEvidence.js（DATA のものではない）。どちらも算出の EPS の点をすでに拒むので、規則は変えずにテストで確かめた。
- admission はツールの中でしか走らず、ブラウザーは呼ばない。だから表示の関数が自分で厳しく確かめ、崩れたものは無いものとして扱う。
- カードが受け取るのは `financial = { report, sec, history, historyRetrievedAt, code33 }`（useBriefData.js で作る、DATA のものではない）だけで、`report` は生のレコードを持たない。生のレコードに届く DATA の道は `secStatus(row, book, …)` だけ（`row.book_financials` を受け取る）。だから参考値は secStatus の 'ok' の結果に乗せた。
- 計画の軸の文「参考 +45」は軸のセルに入らない（320px のスマホで 12px の4文字、spec はどのセルも切れないことを確かめている）。上の形（率だけを灰色の破線のセルに、「参考」は行の文とデスクトップの凡例が言う）にした。

### 規則 18

- このコミットの admission がキーを受け、このコミットの UI が読む。出力は**オフのまま**。
- これより前のコミットから作ったツール（export-research.mjs・financial-correction-overlay.mjs・集計レポートの admission）は、このキーのあるレコードを丸ごと拒む（`keys`）。だから出力のスイッチは後の別の変更（OD1）で、この UI が Pages で動いていることを読み取りだけで確かめてから。
- 警告コード・索引の項目・`sec_summary` の項目は足していない。secStatus の結果の `q4Reference` は画面の中だけのもので、公開されるファイルには書かれない（buildSecSummary は `sec.state` しか書かない、テストで確かめた）。

### 判定に使わないことの証明（テスト、キーのある記録と無い記録を toEqual で比べる）

`fundamentalsExplain.test.js`「never counted」（ZZQF と同じ形の記録をテストの中で作る。その記録は admission を通ることも確かめる）：

- `quarterly` そのものが同じ（参考値は quarterly.eps に入らない）。
- `bookFinancialEvidence`：報告全体と、rows（eps・epsYoY・epsYoYReason を含む）・epsFloor・epsAcceleration・salesAcceleration・marginImprovement・code33・settled・consecutive・stale・annualRecord。`bookFinancialCurrent` 全体。
- `chipQuarter`（eps・epsYoY・salesYoY）。
- `code33Layered`、`code33Explain`（カードの interim の有無とも）、`code33Parts`。
- `earningsChipView`、`earningsCaution`、`code33ChipView`。
- `fundamentalTiles`、`fundamentalsSource`。
- `buildSecSummary`（索引の要約。行のチップ・EPS の絞り込み・並べ替えはこれを読む）と、その JSON に reference・q4Eps・参考 の文字が無いこと。`secRowChip`、`secSummaryCurrent`。
- `secStatus`：`q4Reference` を除けば同じ。キーの無い記録の結果には `q4Reference` が無い。全部が落ちる記録（method 違い）の結果は、キーの無い記録と同じ。180 日を過ぎた記録（古い）には付かない。

`StockFundamentalsCard.test.jsx`：タイル・品質のチップ・Code 33 の箱と3条件・出典・値なしの理由・四半期表の文字がキーの有無で同じ（両方の幅）。棒と基準線の座標が同じ。StockView の画面のチップ（結論の業績チップとカードの品質チップ）が両方の幅で同じ。参考値が無い・崩れている（method 違い、順序違い、空、報告のある四半期だけ）ときのカードの outerHTML が、キーの無い記録とバイト単位で同じ。

`brief-fundamentals.spec.js`（実ブラウザー）：画面のチップすべて、タイル、値なしの理由とその件数、Code 33 の箱、出典、棒の rect の座標と大きさがキーの有無で同じ。

### テスト

- `bookFinancialAdmission.test.js`：66 → 96（新しい 30）。定数と理由の一覧が変わらないこと、正しいリストは同じオブジェクトで受ける（3つの分子タグ、負の値、4件、partial）、キーの無い記録は今までどおり、`keys` で拒む 25 の形（余分・欠けたキー、`__proto__`、method、分子・株数のタグ、shares の余分なキー、components 3・5・空、NaN・Infinity・文字列の値、asOfDate の後の end、start > end、105 日超・70 日未満、存在しない日、順序、同じ end、報告のある四半期、5件、空、オブジェクトでないエントリー）、配列でないもの5つ、unavailable の5つの理由すべて、既存の理由が先に出る（`series:eps`・`symbol`・`keys`）、算出の EPS は（キーがあっても）`series:eps`、`q4ReferenceEntryValid` の境界（70・105 日は可、69・106 日は不可）。
- `fundamentalsExplain.test.js`：27 → 33（新しい 6）。上の証明、secStatus に付くとき・付かないとき、率（報告の基準・参考の基準・赤字・ゼロ・基準なし・期間の不一致・負の参考値・拒まれた EPS の系列）、落とすもの（崩れたエントリー6種のそれぞれと残るもの、報告のある四半期、窓の外、fiscal Q4 でない行）、リストの形（空・null・{}・逆順・重複・5件・null のエントリー）、別の日の記録、無効な報告、null の記録。行の文と title の文（U+2212、±0%、率なしで尾なし、基準なしで尾なし、ASCII のマイナスが無い）。
- `StockFundamentalsCard.test.jsx`：21 → 26（新しい 5）。上の証明、行が1回・折りたたみの外・Code 33 の箱の後、棒の class と title、軸のセル（+71 は is-reference、率の無い 2025-06 は — のまま）、凡例、赤字の参考値、率の無い参考値。
- `test_sec_financials.py`：54 → 56（新しい 2、`Q4EpsReferenceBrowserAdmission`）。method・タグ・上限が bookFinancialAdmission.js の定数と一致。出力を（テストの中で）オンにして P3 のコードで作ったレコード（2022〜2025 の4件）が node の admission を通り、出力オフのレコードも通り、method 違い・報告のある四半期・5件は拒まれる（既存の `ADMIT_SCRIPT` を使う）。
- `brief-fundamentals.spec.js`：4 件（320×640・375×812・390×844・1440×900、reduced motion、`chartSettled`）。ZZQF に `{ oracles: true, mutate: { details } }` で 2025-06-30 と 2026-06-30 の参考値を足す（fixture は凍結のまま）。キーの無い画面・ある画面・method 違いの画面を同じ context の3つのページで開いて比べる：行が見える・閉じた折りたたみの外・Code 33 の箱の後・文は producer の出力、チップ・タイル・値なしの理由とその件数（スマホの見出しの「N件」）・Code 33（未確認）・出典・rect の座標が同じ、軸で変わるのは 2026-06 の EPS のセル（— → +71）だけでその色は「—」のセルと同じ灰色・EPS の色ではない・outline は dashed、参考の棒の破線と太さは値なしの棒と違う、デスクトップの凡例・スマホの凡例、横はみ出し 0、切れたセル 0（`cutCells`・`wider`）、375 で 3388 以内、method 違いは何も無い画面と同じ。高さはログに出す。

### 実測（このサンドボックス、CI と同じ設定：Chrome for Testing 147 headless shell、CI のフォント、ポート 4422）

測った木は **2acdaaf4**（この節の docs のコミットの直前）。この docs のコミットは文書しか変えない。

- **A**：`cd $W/frontend && npx vitest run src/static/bookFinancialAdmission.test.js src/static/fundamentalsExplain.test.js src/static/brief/StockFundamentalsCard.test.jsx` → 3 files、**155 passed**（96＋33＋26。P4 の前は 66＋27＋21）。`cd $W/frontend/tools && python3 -m unittest test_sec_financials` → **Ran 56 tests … OK**（P3 の後は 54）。P4 の前の admission のテスト（0d8d668c の bookFinancialAdmission.test.js）を新しい admission の上で走らせても 66 passed（スクラッチにコピーして実行、コミットしない）。
- **B**：コミットの後に `cd $W/frontend && AUDIT_PORT=4422 npx playwright test -c $S/audit3/r3-data/pw-147.config.mjs` → **456 件：454 passed・2 skipped**（20.3 分、**再実行なし**）。456 ＝ STEP 0 の 448 ＋ D4 の 4 ＋ D3 の 4。skip の2つは brief-oracles.spec.js の `test.fixme('R1: …')` と `test.fixme('R2: …')`（触っていない。`git diff 45603f06 -- frontend/tests/static/brief-oracles.spec.js frontend/tests/static/brief-fixture.js` は空）。brief-oracles の有効なアサーションはすべて通った。負荷（advisory）：前 1.19 2.68 3.79 / 後 6.56 5.24 4.57。
  - その前に D3 の4件だけ：`AUDIT_MATCH='brief-fundamentals' … -g 'round-3 D3'` → 4 passed（30.2 s、再実行なし）。
- **C（dump）**：`$H/dump/run-dump.sh $W 4422` → `dump-2acdaaf.json`、42 画面・エラー 0、sha256 **996e122d…8982**。`cmp dump-2acdaaf.json dump-9efa992.json` → **バイト単位で同じ**（P2 で測った木 9efa9927 の dump。d8457cfb はそれと docs だけが違う）。既定の fixture にこのキーを持つ記録は無いので、D3 は何も変えない。
- **D（規則 16）**：`git -C $W diff --name-only 45603f06...HEAD` → docs/round3/data.md、bookFinancialAdmission.js (+test)、StockFundamentalsCard.jsx (+test)、brief-fundamentals.css、fundamentalsExplain.js (+test)、brief-fundamentals.spec.js、report-data-coverage.mjs (+test)、sec-financials.py、test_sec_financials.py。チャートのファイルは無い。492 画面のプローブは不要で、走らせていない。
- **E**：`npx vitest run`（全体）→ 247 files、4039 件のうち 4038 passed、1 件が時間切れ（`tools/export-market-trends.test.mjs` の「writes raw and derived data with exact content hashes …」、20 s。DATA は触っていない、負荷 9.46 のとき）。そのファイルだけを1回走らせ直して **37 passed**（31 s、負荷 9.23 → 7.49）。全体の数：P2 の 3997 ＋ P3 の 1 ＋ P4 の 41 ＝ 4039。負荷（advisory）：前 4.25 4.76 4.48 / 後 9.46 7.86 5.94。`npx eslint`（触った 7 ファイル）→ 0 errors。
- **F（入口チャンク）**：`$H/build/run-build.sh $W` → `build-2acdaaf.json`。`npm run build` の入口 377.02 kB・gzip **131.82 kB**。
  - **D3 の差**：P2 の 130.52 kB（9efa9927）から **+1.30 kB**（P3 はツールだけで入口に入らないので、全部 P4 の UI。admission の定数と検査、読み手、行の文、カード）。
  - **DATA の D4 までの差**（P2）：STEP 0 の 130.28 から +0.24。DATA 全体（D2〜D3）：+1.54。線 134.00 まで **2.18 kB**。Design Acceptance の build（vite）の入口は gzip 131.62 kB（9efa992 の 130.31 から +1.31）。
  - 中身の確認：入口に `q4-ni-over-q4-diluted-shares-v1`、分子・株数のタグ、`太い破線`、`参考（独自計算）`、`brief-fin-reference`、`is-reference` が入り、それ以外の新しいものは無い（スクラッチで grep）。
- **G**：`python3 -I $S/audit3/check-ownership.py DATA $W 45603f06…` → コミットの前ごとに `OWNERSHIP OK (DATA): 13 paths`。
- **H**：古い r3-data の HEAD（9efa992）の大きな出力を消した：`snapshot/trees/9efa992`（39M）、`build/npm-build-9efa992`（19M）、`dump/raw/dump-9efa992`（と log）、`dump/dump-9efa992.json`（と sha256。dump-2acdaaf.json とバイト単位で同じなので失うものは無い）。`build/build-9efa992.json` と3つの build の log は P2 の数の記録として残した（数 kB）。8849bf9・c61bf96 と他トラックの出力には触っていない。

**画面の高さ**（スクラッチの `audit3/r3-data/d3-measure/measure.spec.js`。D4 の measure.spec.js をそのまま写し、ZZQF に参考値を足した版を加えたもの。STEP 0 の oracle-heights と同じ測り方：`#brief-main .brief-stack` の下端、reduced motion、有限のアニメーションを待ち、1.5 秒の DOM の静止、deviceScaleFactor 2）。キーの無い画面は D4 の数をそのまま再現した。

| 画面 | 320×640 | 375×812 | 390×844 | 1440×900 |
|---|---|---|---|---|
| ZZQF（D4 → 参考値あり） | 3207 → 3277（+70） | 3000 → 3069（+69、線 3388） | 3000 → 3069（+69） | 1832 → 1832 |
| ZZQF のカード | 677.4 → 746.6 | 622 → 691.2 | 622 → 691.2 | 846.8 → 920 |
| ZZNV（既定の行、キーなし） | 3308 → 3308 | 3044 → 3044 | 2954 → 2954 | 1832 → 1832 |

- スマホの +69〜70 は行の文が3行（12px・行の高さ 1.7）とカードの間隔。1440 はカードが +73.2（行の文が2行と凡例の項目の1行）だが、画面の下端は変わらない（その幅では業績のカードが一番長い列ではない）。
- spec（brief-fundamentals.spec.js の D3 の4件）が出すログ：320 3207 → 3277、375 3000 → 3069、390 3000 → 3069、1440 1837 → 1837（spec の 1440 は VIEWPORTS.desktop で deviceScaleFactor 1 なので、上の表の 1832 と測り方が違う）。カードは表と同じ。
- 見た目（スクラッチのスクリーンショット `audit3/r3-data/d3-measure/card-375.png`・`card-1440.png`、コミットしない）：参考の棒は値なしの棒より太く濃い破線、軸の「+71」は灰色の破線の枠、1440 の凡例の3行目に「太い破線＝参考（独自計算・判定に使わない）」、行の文は Code 33 の3条件の下。

### 指示からの逸脱

1. **凡例の言葉は「太い破線＝参考（独自計算・判定に使わない）」**（指示は「破線＝…」）。brief.css（DATA のものではない）が `.q-unknown` をもともと細い破線（`stroke-dasharray: 3 3`）で描くので、「破線＝参考」ではすべての値なしの棒を参考と呼ぶことになる。参考の棒は `is-reference` で太く濃い破線（`--text-2`、2px、`4 2`）にして区別し、凡例の見本も同じ破線にした。
2. **崩れたものの扱い**：リストの形（配列でない・0 件や 5 件以上・end の順序や重複・end が日付でない）はリスト全体を無いものとし、1件ずつの崩れはその件だけを落とす。だから Playwright の「崩れた参考値は無いものと同じ」はすべての件を崩して（method 違い）確かめた。参考値の前年同期の基準になるのは、見せる参考値だけ（窓の外の参考値は基準にしない）。
3. **赤字の参考値**：軸のセルは `growthShort` の既存の規則（その四半期の EPS が負なら「赤字」）を参考の EPS に当てて「赤字」。行の文は率をそのまま U+2212 で書く（例「→ 前年比 −124%」）。
4. **棒の title**：「2026-06期 EPS 前年比：Q4のEPSは年次報告のみ・参考（独自計算）Q4 EPS ≈ 1.80 → 前年比 +71%（前年同期も参考値）」（値なしの理由の後に参考値。producer は `q4ReferenceTitle`）。
5. **行の位置**：Code 33 の箱の後、3条件（Code33Parts）の後。箱と3条件は一つのまとまりなので、その下に置いた。
6. **Python の照合**：567 行付近の `ADMIT_SCRIPT` をそのまま使い、テストはファイルの最後に新しいクラス `Q4EpsReferenceBrowserAdmission` として足した。
7. **入口チャンクが D4 より大きく増えた**（+1.30 kB）。日本語の文（行・凡例・title）と分子のタグの長い文字列が主。線までは 2.18 kB 残る。

### 未検証

- 実際の銘柄での表示（このキーを持つ公開の記録はまだ無い。出力はオフ）。実データの精度（P3 の未検証と同じ）。公開版（Pages）での効果と表示。
- ライトモードでの参考の棒と軸のセルの見え方（スクリーンショットはダークだけ）。axe（brief-accessibility）は既定の画面で通ったが、参考値のある ZZQF の画面では走らせていない。軸は `aria-hidden` で、参考値は SVG の title と行の文で読まれる（スクリーンリーダーでは確かめていない）。
- 時間の計測はしていない（チャートのコードは触っていない）。ここの負荷の数はすべて advisory。CI の Design Acceptance は走らせていない。

### D3 のコミット（古い順。統合で D3 を外すときは新しい順に戻せば pre-D3 の d8457cfb に戻る）

1. b306c6de feat(frontend): compute a reference fiscal-Q4 EPS in the SEC producer with emission off（P3）
2. 19135046 test(frontend): check that the SEC evidence line prints coverage.q4_reference（P3）
3. 60180dd5 docs(round3): record D3 producer（P3）
4. 0d8d668c docs(round3): note D3's unwindowed refusals and the 2% check on small EPS（P3）
5. 07bcd93d feat(frontend): admit and show the reference fiscal-Q4 EPS without counting it（P4）
6. c770fd31 test(frontend): prove the reference fiscal-Q4 EPS is strict, shown and never counted（P4）
7. 2acdaaf4 test(frontend): check the reference fiscal-Q4 EPS on ZZQF at 320, 375, 390 and 1440（P4）
8. この docs(round3) のコミット（P4、この節だけ）

`git diff d8457cfb..HEAD --name-only` は D3 の 12 ファイル（上の D の一覧の 13 から report-data-coverage.mjs を除いたもの。report-data-coverage.test.mjs は P3 が末尾に足した describe だけ）。D3 を外しても D2・D4 は触らない。

### 統合・オーナーへの依頼

- **OD1**：出力のスイッチ（`Q4_EPS_REFERENCE_EMIT = True`）は後の別の変更で、次の両方の後に限る：(a) この UI（admission の任意キーと表示）が Pages で動いていることを読み取りだけで確かめた、(b) オーナーが公開の実行の精度の行（`SEC q4 reference accuracy <date>`）を見た。数えるかどうか（判定・点数に使うか）も OD1 で、既定は使わない。
- **CONTEXT.md の言葉**：「参考 Q4 EPS」（独自計算・参考の fiscal Q4 EPS、方法 `q4-ni-over-q4-diluted-shares-v1`、純利益÷希薄化株数）と「独自計算・判定に使わない」（どの判定・点数・絞り込み・並べ替えにも入らない値の言い方）。
- **任意**：参考値を secStatus の結果に乗せる代わりに、useBriefData.js（DATA のものではない）で `financial.q4Reference = q4EpsReference(row.book_financials, report)` として作ってもよい。そのときはカードの読む場所（`financial.sec.q4Reference`）と secStatus の `q4Reference` を一緒に変え、「secStatus は 'ok' の q4Reference を除いて同じ」のテストを「secStatus はキーの有無で同じ」に直す。
