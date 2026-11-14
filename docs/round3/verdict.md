# Round 3 トラック R（READINESS/VERDICT）：記録

作成 2026-11-14（日本時間）。ブランチ claude/r3-verdict（土台 45603f06 = main に STEP 0 を合流したもの）。
計画は round3-plan.md の §5 R、STEP 0 の記録は docs/round3/step0.md（§6 の訂正が計画に優先）。
実測と未検証は分けて書く。実データの数はすべて **再現スナップショットの数**（11-12 の再構築、ハーネス H5）で、公開版の数ではない（規則 17）。

## R1. 上抜けはピボットの足から数える（パッケージ R-P1）

### 規則

- **下限はピボットの足そのものの index**。`crossingFloor(bars, row)` は `pivotBar(bars, row)?.index ?? null` を返す（breakoutHistory.js）。
  - ピボットの足 ＝ Setup Engine のピボット（`se_pivot_price`）を作った日足（H1 `pivotBar`、凍結）。週足の型は `se_pivot_date`（金曜のラベル）の週で高値がピボットとセント単位で一致する最後の日足、日足の型はその日の日足。
  - 失敗ブレイクの判定・結論の上抜けイベント・チャートの矢印・ウォッチ行と Today の売りの判定が、STEP 0 の継ぎ目（H1b）を通して同じ下限を読む。呼び出し側のコードは変えていない。
- **次の足（index + 1）にしない理由**（step0.md §6 の 2）。ピボットの足の終値はその日の高値（＝ピボット）を超えられない。その日の上抜けは「ピボット到達」（touch）にしかならず、上抜けの日付は後の足になる（breakoutBar）。次の足を下限にすると、ピボットの足が高値で引けて翌日に出来高を伴って上で引けた本物の上抜けを落とす（契約テストで固定）。
- **下限が null のとき**（日足なし、`se_pivot_date` なし・不正、ピボットなし、表にない型、vcp、一致する日足なし）は、どの読み手も今日とまったく同じ。古い公開（インデックスに `se_pivot_date` が無い）はこの経路。
- **ピボットの足より前からピボットのセント以上で引けていた並び**（足の前日の終値がすでにピボット以上）は特別扱いしない。下限以降に下からの上抜けが無いので、その後の上の終値も日付を付けない（結論は「上抜け日 未確認」、緑にならない）。再現スナップショットでの数は下の「境界の場合」。
- **climaxGate**（上昇の加速の判定の起点）は変えていない。起点は「ピボットより上の終値が続く並びの最初」で、ピボットの足の終値はピボット以下なので、並びはピボットの足をまたげない（セントの丸めの差を除く）。再現スナップショットで上昇の加速の判定（strength と run）が変わった行は 0（実測、下の差分）。buyGate.js・StockSellCard.jsx・StockVerdict.jsx に、下限を通らない上抜けの読み取りは無い（buyGate.js は STEP 0 から下限を渡している。コメントだけ直した）。

### 文言の規則

- 失敗ブレイクの判定は、状態（hit / clear / unknown / null）を今日と同じ決め方で決め、上抜けの範囲だけを下限で区切る。
- 下限がリストの中の足で（`from` が `list` の index）、その足が判定の窓より新しく（`n − 1 − from < failedBreakoutSessions`、10営業日）、下限以降に上抜けが無いときだけ、clear の文言が
  「このピボット（M/D）以降の上抜けなし（終値はピボット比 …）」になる（生産者 `noBreakoutSincePivot(day, shown)`、briefSell.js）。M/D は `shortDate(list[from].date, last.date)`。
- それ以外はすべて今日と同じ文字列。ピボットの足が窓と同じかそれより古ければ「直近10営業日にピボットの上抜けなし（…）」はそのまま正しいので変えない。
- 252本より前の下限（sellSignals が読む範囲の外）は、何も区切らない「下限なし」に読み替える（以前は 0 に寄せていた。どちらも数える上抜けは同じで、挙動は変わらない）。新しい文言は出ない。最後の足より後の下限（`from: bars.length`）も新しい文言は出さない。

### 7 行（再現スナップショットの数、11-12。`work/sell-eval.jsonl`、`$T/rebuild/seven-9ac8705.json`）

失敗ブレイクの hit は 615 の検証済み掲載行で **21 → 14**。clear になったのは下の 7 行で、残りの 14 行（ATNI、CRON、EBC、EMBJ、ETON、EWTX、HQY、LLYVA、MCBS、MSFT、NWL、PFIS、PVLA、RDNT）は変わらない。新しい hit は 0。
7 行はすべて `nr7_inside_day`（`se_pivot_type` nr7_inside_day_trigger_high）で、外れた上抜けはピボットの足より前。

| 銘柄 | se_pivot_date ＝ ピボットの足 | 外れた上抜け（日付・出来高比） | 失敗ブレイクの判定（後） | 結論（前 → 後、buyGate） | チャートの矢印（前 → 後） |
|---|---|---|---|---|---|
| MGRC | 11/12（分析日、0営業日前） | 11/3・27.03× | clear「このピボット（11/12）以降の上抜けなし（終値はピボット比 −0.1%）」 | failedBreakout「ブレイク失敗（独自判定）」→ marketHold「地合いが新規の買いを控える状態（独自判定）」 | 11/3 灰 → なし |
| TMP | 11/11（1営業日前） | 11/4・1.51× | clear「このピボット（11/11）以降の上抜けなし（終値はピボット比 −0.7%）」 | failedBreakout → marketHold | なし → なし（最後の交差 11/10 は到達だけで上抜けなし） |
| CZFS | 11/11（1） | 11/4・1.41× | clear「このピボット（11/11）以降の上抜けなし（終値はピボット比 −1.2%）」 | failedBreakout → marketHold | 11/4 灰 → なし |
| TBCH | 11/10（2） | 11/9・1.73× | clear「このピボット（11/10）以降の上抜けなし（終値はピボット比 −2.5%）」 | failedBreakout → marketHold | 11/9 灰 → なし |
| OABI | 11/11（1） | 11/9・1.70× | clear「このピボット（11/11）以降の上抜けなし（終値はピボット比 −4.8%）」 | failedBreakout → marketHold | 11/9 灰 → なし |
| JILL | 11/10（2） | 10/29・1.85× | clear「このピボット（11/10）以降の上抜けなし（終値はピボット比 −2.4%）」 | template「TT 1条件未達 — 買いの対象外」（変わらず） | 11/9 灰（0.40×）→ なし |
| ASO | 11/11（1） | 11/9・2.07× | clear「このピボット（11/11）以降の上抜けなし（終値はピボット比 −4.4%）」 | template「TT 1条件未達 — 買いの対象外」（変わらず） | 11/9 灰 → なし |

- 5 行（MGRC、TMP、CZFS、TBCH、OABI）の結論は、失敗ブレイクの代わりに地合いの判定になる（11-12 の地合いは 50日線割れ・買いは控える）。試算の参考理由は「崩れ」→「地合い」。
- JILL と ASO はトレンドテンプレートの未達で結論は変わらない。チップは JILL が「崩れ（独自判定）」→「50日線の下」、ASO が「崩れ」→ なし。
- 出来高比は画面と同じく小数2桁で切り捨て。

### 失敗ブレイク以外に変わった行（再現スナップショット、`work/sell-eval.jsonl` を out/8849bf9 と比較）

- 差がある行は 980 行中 **33**：上の 7 行と、文言だけが変わった 26 行。状態・上昇の加速・結論・試算は 26 行とも同じ。
  - 17 行（ASIC、ASTL、BMBL、BPRN、BWIN、CFFI、CLBK、CPBI、DSGX、HALO、LBRX、NTSK、OFG、PSNL、TUSK、VREX、VTMX）：「直近10営業日にピボットの上抜けなし（…）」→「このピボット（M/D）以降の上抜けなし（…）」。ピボットの比は同じ。
  - 9 行（AMAL、AROW、DAO、FCNCA、HOFT、PYPL、RRGB、TTC、WSFS）：「M/D の上抜けは出来高 0.xx×（基準 1.40×未満）・…」→「このピボット（M/D）以降の上抜けなし（…）」。その軽い上抜けはピボットの足より前だった。
- `work/today-eval.json`：注目候補（focus）・件数（ゾーン 68・接近 82）・見出しは同じ。差は `forgotten`（失敗した大商いの上抜けの一覧）だけで、52 → 32。外れた 20 行（AHR、ASO、BMO、BWIN、DE、DJCO、FCNCA、GLBE、GTLB、MGRC、NCNO、NDSN、PSNL、RLAY、RPRX、SLDE、SWKS、TGT、TRGP、URBN）は、すべて上抜けの日がピボットの足より前（実測、`$T/rebuild/forgotten.mjs`）。残る 32 行は同じ。
- 上記以外に、検証済みの行で失敗ブレイクの状態・上抜け・結論が変わった行は無い。

### チャートの矢印（再現スナップショット、`$T/rebuild/r1-rows-9ac8705.json`）

- 対象：検証済みの掲載 615 行のうちピボットのある 564 行。564 行とも下限が見つかった（null 0、`view.pivot` と `se_pivot_price` のセントの食い違い 0）。
- 矢印 480 → 419。**消えた 61、動いた 0、増えた 0**。消えた 61 はすべて灰色（その後に終値がピボットを割った上抜け）。型は cup_with_handle 41、nr7_inside_day 18、three_weeks_tight 2。
- 消えた 61：ACOG AMAL ARGX AROW ASIC ASO BATRA BATRK BNED BP BPRN BWIN CASS CFFI CGON CIB CNXN CP CZFS DAC DJCO ELVN FCNCA FISI FLXS FUSB HOFT ICCC IMVT JAZZ JCTC JILL LARK MATX MGRC MTCH NTSK OABI OFG PAYX PBT PLTR PSNL PUBM PYPL RAL RMBI RRGB SEIC SENEA SHBI SHOP SI SPT TBCH TTC TWFG TWIN WLY WSFS ZD
- 計画の「61」はゆるい判定（最後の交差が `se_pivot_date` 以前）だった。同じハーネスで 8849bf9 のゆるい判定は 69（`work/pivot-date.json` の beforePivotDate）。厳密な判定（ピボットの足の index）で実際に消える矢印は 61。差の 8（ASTL、CPBI、DAO、HHS、HURC、REPX、SSTI、TMP）は、もともと矢印の無い到達だけの交差か、週足でピボットの足と金曜のラベルの間の交差。
- 下限の後でゆるい判定に残るのは HHS の 1 行：週足のラベル 10/2、ピボットの足 9/29（火曜）、交差はその足そのものの到達（上抜けなし、矢印なし）。設計どおり。

### p4 の 6 銘柄のウォッチ（再現スナップショット）

- ウォッチ EMBJ、MGRC、HALO、PCRX、FCNCA、ABCL。タイルはアプリの `watchAttention`（TodayView.jsx）に再構築の売りの判定を渡して計算した：8849bf9 の判定で「3件」（EMBJ、MGRC、HALO）、この木の判定で **「2件」**（EMBJ、HALO）。MGRC の崩れのチップ（▲）は消える。
- `work/today-eval.json` にはウォッチの一覧が無いので、タイルは `work/sell-eval.jsonl`（useWatchSellChecks と同じ stockSells、下限は行から）から計算した。ブラウザでこのウォッチを描いてはいない（未検証）。

### 境界の場合（step 2 の測定、再現スナップショット）

- 注文の定義（ピボットの足がある、その前日の終値がピボットのセント以上、後にピボットより上の終値がある）：**58 行**。0 ではないので、規則は作らず記録して報告する。
  - PRGS ACNB LIND CHRD RPRX FCAP CUZ JNJ ULCC XHR UTMD PFG AII FWONK MA LIVN ADPT FWONA ROIV RMNI SHO CAH RLJ KFFB CART MAR UEIC MEOH PCTY APLE ROP EGBN AMPL III STGW BB CURV MTEX GTLB WEST REGN RIGL VG NCNO SABR APPF PPLI SBLK ZYME ZBH HFBL CME TRI BGR CURB PAYO OGN RNW
- 内訳（`$T/rebuild/edge-9ac8705.json`）。
  - 56 行：ピボットの足の後に一度ピボットの下で引け、その後の上抜けが下限の中で日付付きで数えられている（cup_with_handle 52、nr7_inside_day 3、three_weeks_tight 1）。下限で失ったものは無い。
  - 2 行（KFFB、MTEX）：ピボットの足が 60 営業日の見る範囲より古い（92・247 営業日前）。下限があってもなくても上抜けは無い。
  - 「ピボットの足の前からピボット以上の並びが続き、その後の上の終値が日付を失う」行：**0**。
  - 下限のせいで、ピボットの足以降に日付の付く上抜けが消えた行（下限なしの breakoutBar がピボットの足以降なのに、下限ありでは無いもの）：**0**。
- つまり STEP 0 が残した場合（ピボットの足より前からの並び）は、この再構築では起きていない。注文の定義の 58 は、それより広い集合（ピボットの足の前日が上で引けたが、その後の上抜けは数えられている行）。
- **指揮者への報告（停止条件）**：注文は「0 でなければ記録して止まり、規則を作らずに報告する」。注文の定義どおりの数は 58 で 0 ではない。規則は作っていない（crossingFloor の本体は単純なまま）。この節の測定は R1 の 3 つのコミットの後（再構築にコミットが要るため）に行い、その後は測定（probe、dump、lint、build、Playwright）と記録だけをした。58 行をどう扱うか（狭い定義の 0 で足りるか）は指揮者が決める。

### 規則 18（UI より先にデータを出さない）

- `se_pivot_date` を exporter の `listFields` に足した（export-research.mjs、se_pivot_price の隣。型の説明も追記）。ほかのエクスポーターの変更は無い。
- 輸送（researchTransport.js、transport/**）は 8849bf9 と同じ（実測：`git -C $W diff --stat 8849bf9 HEAD -- frontend/src/static/researchTransport.js frontend/src/static/transport` の出力は空）。
- vitest（breakoutHistoryIndex.test.js）：`se_pivot_date` を持つ行を `encodeResearchIndex` で符号化し `decodeResearchIndex` で戻すと、日付・null・無しがそのまま戻り、戻した行の下限が元の行と同じ。
- 古い UI での確認（スクラッチ、`$T/rule18/check.mjs`。8849bf9 の木 /home/user/screener/.claude/worktrees/r3-base を読むだけ）：
  - 再構築の 5955 行から、8849bf9 のインデックスのコード（fitResearchIndex＋encodeResearchIndex）で 2 つのインデックスを作った。A は 8849bf9 の listFields（83）、B はこの木の listFields（84、足したのは se_pivot_date だけ）。
  - それぞれを 8849bf9 の `prepareResearchBundle`（decodeResearchIndex、mergeScanRows、projectFinancialRow、rankCandidates、preparePortfolioRows）と、その brief の行のモデル（candidateView、rowEvent、focusCandidates、focusCounts）に通した。
  - 結果：エラー無し。B の行のうち 4421 行が se_pivot_date を持つ。順位・評価・ビュー・行のイベント・注目候補・件数・（その項目を除いた）行は A と B ですべて同じ。8849bf9 の UI はこの項目を読まず、拒みもしない。

### インデックスの大きさ（再現スナップショットの近似、`ONLY=index-size`）

- out/8849bf9：gzip 613,518 バイト。この木（ea5b8cd）：619,830 バイト。**差 +6,312 バイト**（raw +19,478）。
- 近似なので差だけを使う。公開版 868,379 ＋ 6,312 ＝ 874,691 バイトで、1,000,000 の内側（公開版での値は未検証）。

### 統合への依頼（Integration requests）

1. **useBriefData.js の 1 行**（このトラックのファイルではない）。**UI を先に出すリリース（規則 18）では必須**。
   - 理由：今の公開はすべて古いエクスポーターの出力で、インデックスの行に se_pivot_date が無く、詳細（`{...compact}`、行のほぼ全部）にはある（export-research-order.test.mjs の R1 のテストが詳細側でも確かめている）。R1 の UI だけを先に出すと、次のデータ公開までの間、同じ銘柄で銘柄画面は下限あり（例：ブレイク失敗なし）、ウォッチ行と Today は下限なし（崩れのチップ）になり、「1 銘柄に 1 つの文言」が崩れる。この 1 行を入れれば、その間はどの画面も今日と同じ（下限なし）、データ公開の後はどの画面も下限あり。
   - 計画は「銘柄画面は se_pivot_date をインデックスの要約から読み、詳細だけが持つ値は読まない」と書く。R のファイルの中ではできない。
   - useStockData（useBriefData.js:124）は `mergeFinancialDetail` で `{...detail, ...summary}` の行を作る。古い公開（インデックスに項目が無く、詳細にはある）では、銘柄画面の `view.row` が詳細の se_pivot_date を持って下限が効き、ウォッチ行と Today の行（インデックスだけ）は効かない。crossingFloor は合わせた行とインデックスの行を区別できない（凍結のオラクル行は se_pivot_date だけを持つ）。
   - 直し方：合わせた直後に、要約が自分の se_pivot_date を持たないなら行から消す。
     ```diff
        const row = useMemo(() => summary ? mergeFinancialDetail(summary, detail.data?.value, { now: financialNow, asOfDate: bundle.data?.date, generation: version,
          detailGeneration: detail.data?.generation, expectedDetailPath: summary.research_detail_path, detailPath: detail.data?.path }) : null, [summary, detail.data, financialNow, bundle.data?.date, version]);
     +  if (row && !Object.hasOwn(summary, 'se_pivot_date')) delete row.se_pivot_date; // the crossing floor reads the index row only (round 3 R1)
     ```
   - 目標のテスト：brief-invariants.spec.js の `test.fixme('INTEGRATION: an index without se_pivot_date and a detail with it leave the stock screen and the watch row both unbounded', …)`。統合でこの行を入れたら `test(…)` にする。
   - 実測：この木では fixme を一時的に test にして走らせると銘柄画面の側で落ちる（`data-gate` が期待 failedBreakout・実際 near：合わせた行が詳細の se_pivot_date で下限を持つため）。fixme に戻した。この 1 行を入れたスクラッチの写し（`$T/patch-tree`、W との差は useBriefData.js のこの 1 行と fixme → test だけ。全ファイルを cmp で確認）では、このテストを含む 13 本（R1 と失敗ブレイクの spec）が通った（下の実測）。
   - `delete` は useMemo の結果（mergeFinancialDetail が作る新しいオブジェクト、projectFinancialRow を通したもの）に対してで、何度走っても同じ結果。入れる場所（useMemo の中か外か）は統合が決めてよい。
2. **語彙（CONTEXT.md、統合で）**：**ピボットの足**（Setup Engine のピボットを作った日足。pivotBar が返す足。上抜けはこの足から数える）。「上抜けの下限」（crossing floor：上抜けとして数えてよい最初の足＝ピボットの足）。
3. **計画の訂正（記録のみ）**：§5 R1 の「次の足」→「ピボットの足そのもの」（step0.md §6 の 2 と同じ）。§5 R1 の「銘柄画面はインデックスの要約から読む」は上の 1 が入るまで成り立たない。§5 R1 の「61」はゆるい判定の数で、厳密な判定で消える矢印は 61、同じハーネスのゆるい判定は 69。

### オラクルの probe の差分（実測、ea5b8cd）

- `$H/probe/run-probe.sh $W 4423 oracles` → `probe-ea5b8cd-oracles.json`（label 132 ビュー・value 132 ビュー、8 銘柄、エラー 0、sha256 217809d7…1ee13c）。
- `node $H/probe/diff.mjs $H/probe-oracles-step0.json $H/probe/probe-ea5b8cd-oracles.json --texts` → 「32 of 264 views differ (0 → 0 page errors)」。32 は ZZNR の label 16 と value 16（3か月・6か月・1年・週足 × 320/375/390/1440）。**ZZNR 以外のビューの差は 0**（ZZHB を含む。フィールド単位で確認）。
- ZZNR の差の中身と原因（`$T/zznr-compact.mjs`、`$T/zznr-multiset.mjs`、`$T/zznr-html.mjs`）。
  - **矢印**：チャートの印が 16 ビューすべてで消える（solids −1）。名前「上抜け 2.10×」（bc-breakouttext）は 14 ビューで消える（320 と 390 の 6か月は、前から名前の置き場が無く印だけだった）。
  - **ほかのラベル**：名前と class の多重集合で比べると、足されたラベルも消えたラベルも **0**（矢印の名前だけ）。変わったのは置き場所だけで、移動平均の名前（50/150/200、10/30/40、21）、T の線（−4%、−16%）、375 の 6か月の「損切り −7.0%」、1440 の 3か月の「最後の収縮の安値 61.05」。矢印の名前が取っていた場所が空き、配置器が置き直した。halos・leaders・maskRects の数の差もこの置き直しによる。375 の 6か月の「損切り −7.0%」と 375 の週足の「30」は forced true → false（空いた場所に普通に置けた）。
  - **凡例と注記**：凡例の「上抜け」（rank 2）が消える。1024px 未満の凡例は 2 行に収める（StockChartCard.jsx の useTwoLineLegend）ので、空いた幅に次の順位の項目が入る。320 の 3か月・6か月・1年は「損切り」、320 の週足、375 の 3か月・6か月・1年、390 の 4 期間は「枠＝収縮」、375 の週足は何も入らない。1440 は凡例の「上抜け」と注記「チャートの印：灰色の矢印＝終値がピボットを上抜けた日（…）。」が消え、チャートのカードが 4 期間とも 21.19px 低くなる。
  - **aria**：「、ピボットを上抜けた日 2026-09-23（上抜け 2.10×）」（週足は 2026-09-25）の句が消える。
  - **位置**：チャートとカードの大きさは変わらない（phone 幅での高さ・幅の差 0）。320 で 24.39px、375/390 で 5.80px 下にずれる。1440 はずれ 0。チャートより上で変わるのは結論（ブレイク失敗 → near）なので、その文言の高さと見ている（結論カードの高さそのものは測っていない）。
- 高さの台帳（brief-compact、brief-phone の既定のフィクスチャ）は動かない（下の Playwright）。

### 実測（コマンドと結果。時刻は日本時間。負荷のもとでの数はすべて参考）

環境：`export PATH=/opt/node22/bin:$PATH FONTCONFIG_FILE=$S/ci-fonts/fonts.conf SESSION_CALENDAR_PYTHON=$S/audit/r1-step0/cal-venv/bin/python FINANCIAL_REPLAY_PYTHON=$S/replay-venv/bin/python`。`S`＝スクラッチパッド、`H=$S/audit3/r3-harness`、`T=$S/audit3/r3-verdict`、`W`＝このワークツリー。

| 何を | コマンド（HEAD） | 結果 | /proc/loadavg（前 → 後、参考） |
|---|---|---|---|
| vitest（受け入れ 1 の組） | `cd $W/frontend && npx vitest run src/static/brief/breakoutHistory.test.js src/static/brief/breakoutHistoryIndex.test.js src/static/brief/briefSell.test.js src/static/brief/buyGate.test.js src/static/brief/chartReadout.test.js src/static/brief/useWatchSellChecks.test.jsx tools/export-research-order.test.mjs`（ea5b8cd、11-14 19:19） | 7 ファイル・113 本すべて通過 | 1.98 → 2.23 |
| vitest（全部、1 回） | `cd $W/frontend && npx vitest run`（ea5b8cd、11-14 15:19、321 秒） | 248 ファイル・**3993 本**すべて通過（土台 3983、+10） | 0.92 → 7.58（probe と同時） |
| Playwright | `cd $W/frontend && AUDIT_PORT=4423 AUDIT_MATCH=<8 ファイル> npx playwright test -c $T/pw.config.mjs`。8 ファイル＝brief-oracles・sell・watch・invariants・decision・plan・compact・phone（出力の行で確認、ea5b8cd、11-14 15:26–15:36、`$T/pw-build-ea5b8cd.out`） | 224 本：**222 通過・2 skip**。skip は brief-oracles.spec.js:238 の `test.fixme('R2: …')` と brief-invariants.spec.js:340 の `test.fixme('INTEGRATION: …')`（8 ファイルの fixme/skip はこの 2 つだけ、grep で確認）。R1 は通過。やり直しは無し | 2.68 → 10.71 |
| 492 ビューの probe | `$H/probe/run-probe.sh $W 4423` → `cmp $H/probe/probe-8849bf9.json $H/probe/probe-ea5b8cd.json`（11-14 15:19–15:22） | label 492・value 480・30 銘柄・エラー 0。**バイト同一**（sha256 b5f29cff…39fa2） | 0.82 → 7.04 |
| オラクルの probe | `$H/probe/run-probe.sh $W 4423 oracles` → diff.mjs（上） | ZZNR の 32 ビューだけ、差は上の節のとおり | 7.04 → 8.45 |
| dump | `$H/dump/run-dump.sh $W 4423` → `cmp $H/dump/dump-8849bf9.json $H/dump/dump-ea5b8cd.json`（11-14 15:24–15:25） | 42 画面・エラー 0。**バイト同一**（sha256 cba0a2f2…c3555）。ウォッチ 5 銘柄の高さ 442 | 8.45 → 3.95 |
| 再構築（SNAP） | `$H/snapshot/run-snapshot.sh $W`（9ac8705、11-14 15:05–15:11、recalc 335 秒） | 全段 ok。rows.jsonl・ready43.jsonl・serve/research.json の hash は SNAP と同じ。counts.json の failedBreakout hit **21 → 14**（clear 543 → 550、no_check 51 は同じ）、ほかの counts の項目は 8849bf9 と同じ | 0.99 → 5.65 |
| インデックスの大きさ | `ONLY=index-size $H/snapshot/run-snapshot.sh $W`（ea5b8cd） | gzip 613,518 → 619,830（**+6,312**）、raw +19,478、listFields 83 → 84 | — |
| lint | `cd $W/frontend && npm run lint`（ea5b8cd） | 0 errors・4 warnings（前と同じ 4 つ：App.jsx、StockDetails.jsx、MetricInfoPopover.jsx、StaticMarketContext.jsx） | — |
| build | `$H/build/run-build.sh $W`（ea5b8cd、11-14 15:36） | `npm run build` の入口のチャンク 373.98 kB・**gzip 130.62 kB**（STEP 0 の 130.28 から **+0.34 kB**、線 134.00 の内側）。Design Acceptance の build の入口 130.42 kB（vite）・gzip9 130,244 バイト（STEP 0 129,915 から +329） | 8.27（終了時） |
| 輸送 | `git -C $W diff --stat 8849bf9 HEAD -- frontend/src/static/researchTransport.js frontend/src/static/transport` | 出力は空 | — |
| 古い UI での確認 | `node $T/rule18/check.mjs /home/user/screener/.claude/worktrees/r3-base $W <rebuild research.json> $T/rule18` | エラー無し。B（84 項目）の 4421 行が se_pivot_date を持ち、順位・評価・ビュー・行のイベント・注目候補・件数・項目を除いた行は A と同じ（`$T/rule18/result.json`） | — |
| 統合の fixme（今日） | fixme を一時的に test にして、そのテスト 1 本を同じ設定で走らせた（2917229 ＋ 未コミットの spec、11-14 15:14 ごろ、`$T/integration-fixme-confirm.txt`） | 落ちる：銘柄画面の `data-gate` 期待 failedBreakout・実際 near。fixme に戻した | — |
| 統合の 1 行（スクラッチ） | `$T/patch-tree`（W ＋ useBriefData.js の 1 行 ＋ fixme → test）で `-c $T/pw-patch.config.mjs`、R1 と失敗ブレイクの 13 本 | 13 本通過（1.3 分） | 6.44 → 4.16 |
| 所有の門 | `python3 -I $S/audit3/check-ownership.py R $W 45603f065f054cd48c812a3003f3a71ffd91cf45` | 各コミットの前に OWNERSHIP OK | — |
| ハーネスの行 | eval-sell.mjs:33、eval-today.mjs:37、pivot-date.mjs:18 を読んだ | どれも crossingFloor に `view.row`（または research の行）をそのまま渡す。行は平らな se_pivot_date・se_pattern_primary・se_pivot_price を持つ。写しは作っていない | — |

- 再構築の数は 9ac8705 で取った。9ac8705 → ea5b8cd の frontend/src と frontend/tools の差は、breakoutHistoryIndex.test.js（テスト）、export-research-order.test.mjs（テスト）、export-research.mjs の listFields の 1 語と型の説明だけ（`git diff --stat 9ac8705 ea5b8cd -- frontend/src frontend/tools`）。ハーネスの行はエクスポーターを通らないので、再構築の数はこの差で変わらない。インデックスの大きさだけは listFields を読むので ea5b8cd で取り直した。
- probe・dump・lint・build・Playwright は ea5b8cd で取った。この後のコミットは docs/round3/verdict.md だけ。

### 未検証

- 再構築を最後の HEAD（ea5b8cd、docs のコミット）で取り直してはいない（理由は上）。
- 時間の計測はしていない（R1 には不要）。負荷のもとの loadavg はすべて参考。
- p4 の 6 銘柄のウォッチをブラウザで描いてはいない（タイルは watchAttention に再構築の売りの判定を渡して計算）。
- 公開版のインデックスの大きさ（868,379 ＋ 6,312 の見積もり）は公開では測っていない。
- 実際の公開での R1 の効果。統合の 1 行はこの木に入っていない（スクラッチの写しでだけ確かめた）。
- バックエンド（gate 1–5、gate-check、908 の固定ハーネス、H4）は走らせていない。R1 はバックエンドも準備・ステージの判定も変えない。
- ダークテーマの probe（オラクルの probe はライトだけ）。

### パッケージ R-P1 の記録

- コミット：9ac8705 `fix(frontend): count pivot crossings from the pivot's own bar`、2917229 `feat(frontend): publish se_pivot_date in the research index`、ea5b8cd `test(frontend): flip the R1 oracle target and cover the bounded crossings`、この文書のコミット（docs）。
- 変えたファイル：breakoutHistory.js（crossingFloor の本体と説明）、briefSell.js（noBreakoutSincePivot、clear の文言、252 本より前の下限を「下限なし」に）、buyGate.js（コメントだけ）、export-research.mjs（listFields に se_pivot_date、型の説明）、テスト（breakoutHistory.test.js、breakoutHistoryIndex.test.js（新規）、briefSell.test.js、buyGate.test.js、export-research-order.test.mjs）、spec（brief-oracles.spec.js の R1 の 1 行、brief-sell・brief-watch・brief-invariants）、この文書。
- 注文からのずれ：buyGate.js はパッケージのファイル一覧に無いが、トラックの持ち物で、変えたのはコメント 1 行だけ（STEP 0 の「null in STEP 0」の説明を直した）。境界の場合が 0 でないこと（58）は上の「指揮者への報告」。

### 変えていないもの

pivotBar.js とそのテスト、brief-fixture.js、brief-oracles.spec.js の R1 の 1 行以外、輸送、briefCandidate.js、portfolioPlan.js、バックエンド、下限が null の行の文言と状態、492 ビューの probe、dump、高さの台帳、失敗ブレイクの 10 営業日の窓、BREAKOUT_VOLUME_RATIO、選定、トレンドテンプレート。
