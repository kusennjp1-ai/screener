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


## D3（予定・分離可能）
