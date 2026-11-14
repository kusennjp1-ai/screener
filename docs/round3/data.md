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

## D4（予定）

## D3（予定・分離可能）
