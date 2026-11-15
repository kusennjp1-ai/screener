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

## R2. ギャップの後に張り付いた値動き（パッケージ R-P2）

### 規則（a）：低変動の3つの判定（priceActivity.js）

- `price_activity` の最初の2つのキー `range60pct`・`lowRange` は今日と同じ意味（lowRange が true なら 低変動・監視のみ）。その後に `reason`、`adr20pct`、`gap` を足した。
- lowRange は次のどれかが成り立つとき true。順に調べ、最初に成り立ったものが `reason`。
  1. **'range60'**：60本の値幅（最高値÷最安値−1）が 5% 未満（今日の規則。値もキーの順も今日と同じ）。
  2. **'since_gap'**：直近60本で最大の1日の動き（終値比 |当日終値÷前日終値−1|。窓開けも、一日の大きな上げ下げも数える）が 10% 以上で、その足より後の足が 15 本以上あり、その高値・安値の値幅が 3% 未満。
  3. **'adr'**：ADR20（直近20本の (高値÷安値−1) の平均、%）が 0.5% 未満。
- 今日 lowRange の行は、すべて 'range60' のまま（その2キーの値も同じ）。
- **欠けた値では決して当たらない**。60本未満（または日足なし）は `{ range60pct: null, lowRange: false, reason: null, adr20pct: null, gap: null }`。各規則は自分が読む値に、有限でない値か0以下の値が1つでもあれば「不明」で、当たりにも0にもならない。
  - 60本ちょうどのとき、最初の足の動きは前日の終値が無いので、'since_gap' は不明（gap は null）。'range60' と 'adr' はそのまま判定する。
  - 60本の値幅は今日の計算をそのまま残した（欠けた高値は NaN、JSON では null）。安値が0以下の窓は 'range60' に当てない（今日は負の安値で true になり得た。実データでは起きない。vitest で固定）。
- `adr20pct` と `gap` は**低変動の行だけに載せ、ほかの行は null**。
  - `gap` は `{ date, pct, sessions, rangePct }`：その足の日付、符号付きの動き、その後の本数、その後の値幅。最大の動きが 10% 未満なら null。
  - 理由：`price_activity` はインデックスの列でもあるので、全行に載せると研究インデックスが約 83 kB（gzip）増える。低変動の行だけなら約 2.6 kB（下の「インデックスの大きさ」）。
- ADR の式は計画書の ADR（positionSizing.js の adrState、高値÷安値−1）と同じ。priceActivity.js は import を持てない（素の Node とエクスポーターが読む）ので式を書き直し、vitest で `adrPercent` と一致させた（`toBe`）。
  - 注文の文には「(高値−安値)÷終値」とあるが、拘束力のある指示は「adrState と同じ式」なので、こちらに従った。オラクルの spec の ZZPG の確認は (高値−安値)÷終値 で < 0.2% を見ており、どちらの式でも ZZPG は 0.15%。

### 定数（独自設定。チャートを見た後に選んだ。オーナーの確認待ち：OD6）

| 名前 | 値 | 意味 |
|---|---|---|
| `ACTIVITY_ADR_SESSIONS` | 20 | ADR20 の本数（positionSizing の ADR_SESSIONS と同じ。vitest で固定） |
| `LOW_ADR_PERCENT`（X） | 0.5 | ADR20 がこれ未満なら低変動 |
| `GAP_MOVE_PERCENT`（G） | 10 | 1日の動き（終値比）がこれ以上ならギャップ |
| `SINCE_GAP_RANGE_PERCENT`（Y） | 3 | ギャップの後の値幅がこれ未満なら張り付き |
| `SINCE_GAP_MIN_SESSIONS`（N） | 15 | ギャップの後に必要な本数 |

- 出発点は X 0.6・Y 3・N 15・G 10。X だけを 0.6 → 0.5 に締めた。
  - 再構築でも H4 でも、0.5 と 0.6 で当たる行は同じ。同じ結果なら狭いほうを取った（p4 の値と同じ）。
  - 再構築の ADR20 の余裕：新たに当たる行の最大は PTC の 0.493（since_gap でも当たる）。range60 で当たる行には BOW 0.766・CZR 0.887 がある。当たらない掲載行の最小は CPBI の 0.651（20本の値幅 5.63%）、次が CPAC 0.713・PBHC 0.731・SYNA 0.790（`$T/r2/measure-9ac8705.json` と R2 の price_activity から計算）。H4 は下。
  - 0.4 は採らない。BWIN（ADR20 0.392）は ADR だけで当たる行（ギャップ +7.9% は G 未満、その後の値幅 3.19% は Y 以上）で、0.4 では余裕が 0.008 しかない。また同じ数字の PAG（0.436）・CCC（0.418）が外れる。
- 近い外れ（再構築、記録のみ）：
  - BRZE：10/20 に +51.7%、その後 17 本の値幅 3.01%（Y の 3% をわずかに超える）。ADR20 1.14%（20本の窓にギャップの日が入る）。
  - ADT：10/29 に +33.2%、その後 10 本の値幅 1.12%。N の 15 本に足りない（あと 5 本で当たる）。
  - どちらも、今の定数では当たらない。緩めてはいない。

### 二つのペルソナの定義で当たる行（再現スナップショットの数、11-12。`$T/r2/measure-9ac8705.json`）

- 対象：掲載 980 行（再構築の research の行で technical_audit が通るものは 980 行すべて）。R-P1 の再構築（out/9ac8705、R2 の前）の日足で計算。
- 列：流動順位は R2 の前の `ui_liquid_rank`（今日 lowRange の行はすでに最後に並ぶので 1822 以降）。「60本で最大の1日の動き」は、R2 の gap と同じ終値比で、10% 未満でも載せた。「その後の値幅」はその足より後の足だけの高値・安値（p1 の rng_since_big はその足を含むので、PCRX で 1.1 と 1.02 の差がある）。

p1 (ADR20 < 0.6% かつ 20本の値幅 < 3%)： 22 行

| 銘柄 | 流動順位 | ADR20 % | 20本の値幅 % | 60本の値幅 % | 60本で最大の1日の動き（終値比） | その後の本数 | その後の値幅 % | 準備 | 今日の lowRange | R2 後の reason |
|---|---|---|---|---|---|---|---|---|---|---|
| PCRX | 1 | 0.150 | 0.52 | 55.05 | 10/08 +44.4% | 25 | 1.02 | ready | — | since_gap |
| BWIN | 75 | 0.392 | 1.32 | 17.92 | 09/14 +7.9% | 43 | 3.19 | ready | — | adr |
| PAG | 142 | 0.436 | 1.29 | 14.95 | 10/15 +8.8% | 20 | 1.29 | — | — | adr |
| PTC | 400 | 0.493 | 2.09 | 55.21 | 10/05 +33.5% | 28 | 2.19 | — | — | since_gap |
| DV | 1822 | 0.214 | 0.74 | 2.71 | 09/14 +0.8% | 43 | 1.65 | — | ○ | range60 |
| TECH | 1823 | 0.157 | 0.59 | 1.11 | 08/20 −0.3% | 59 | 1.11 | ready | ○ | range60 |
| OGN | 1824 | 0.312 | 1.31 | 1.98 | 09/09 −0.6% | 46 | 1.98 | — | ○ | range60 |
| LNTH | 1825 | 0.448 | 2.21 | 2.51 | 08/24 +0.8% | 57 | 2.51 | — | ○ | range60 |
| ARX | 1826 | 0.243 | 0.96 | 2.05 | 09/04 +0.9% | 48 | 2.05 | ready | ○ | range60 |
| HZO | 1827 | 0.298 | 1.75 | 1.75 | 10/19 −0.7% | 18 | 1.42 | — | ○ | range60 |
| SLAB | 1828 | 0.406 | 1.05 | 3.05 | 09/11 +0.5% | 44 | 2.05 | — | ○ | range60 |
| ITGR | 1829 | 0.134 | 0.35 | 1.59 | 09/04 +0.8% | 48 | 0.77 | — | ○ | range60 |
| BMBL | —（非流動） | 0.453 | 1.85 | 147.54 | 10/13 +56.6% | 22 | 1.85 | — | — | since_gap |
| CCC | —（非流動） | 0.418 | 1.45 | 26.76 | 10/12 +8.1% | 23 | 5.19 | — | — | adr |
| CEPO | —（非流動） | 0.130 | 0.65 | 1.50 | 08/21 +1.1% | 58 | 0.84 | ready | ○ | range60 |
| DSGR | —（非流動） | 0.307 | 0.95 | 1.93 | 11/11 +0.3% | 1 | 0.26 | ready | ○ | range60 |
| LXFR | —（非流動） | 0.235 | 1.11 | 1.46 | 11/04 +0.6% | 6 | 0.40 | — | ○ | range60 |
| PAYO | —（非流動） | 0.428 | 1.55 | 1.98 | 09/03 +0.8% | 49 | 1.83 | — | ○ | range60 |
| PRTH | —（非流動） | 0.369 | 1.66 | 52.99 | 09/21 +33.8% | 38 | 2.32 | ready | — | since_gap |
| RNW | —（非流動） | 0.414 | 1.90 | 2.80 | 09/04 +0.6% | 48 | 2.20 | ready | ○ | range60 |
| SAFT | —（非流動） | 0.210 | 0.68 | 1.45 | 09/01 −0.6% | 51 | 1.43 | — | ○ | range60 |
| VREX | —（非流動） | 0.307 | 1.86 | 1.86 | 11/12 −0.7% | 0 | — | — | ○ | range60 |

p4 (ADR20 < 0.5% または 20本の値幅 < 3%)： 27 行

| 銘柄 | 流動順位 | ADR20 % | 20本の値幅 % | 60本の値幅 % | 60本で最大の1日の動き（終値比） | その後の本数 | その後の値幅 % | 準備 | 今日の lowRange | R2 後の reason |
|---|---|---|---|---|---|---|---|---|---|---|
| PCRX | 1 | 0.150 | 0.52 | 55.05 | 10/08 +44.4% | 25 | 1.02 | ready | — | since_gap |
| BWIN | 75 | 0.392 | 1.32 | 17.92 | 09/14 +7.9% | 43 | 3.19 | ready | — | adr |
| PAG | 142 | 0.436 | 1.29 | 14.95 | 10/15 +8.8% | 20 | 1.29 | — | — | adr |
| PTC | 400 | 0.493 | 2.09 | 55.21 | 10/05 +33.5% | 28 | 2.19 | — | — | since_gap |
| SYNA | 432 | 0.790 | 2.69 | 38.41 | 10/02 +14.1% | 29 | 4.30 | — | — | — |
| DV | 1822 | 0.214 | 0.74 | 2.71 | 09/14 +0.8% | 43 | 1.65 | — | ○ | range60 |
| TECH | 1823 | 0.157 | 0.59 | 1.11 | 08/20 −0.3% | 59 | 1.11 | ready | ○ | range60 |
| OGN | 1824 | 0.312 | 1.31 | 1.98 | 09/09 −0.6% | 46 | 1.98 | — | ○ | range60 |
| LNTH | 1825 | 0.448 | 2.21 | 2.51 | 08/24 +0.8% | 57 | 2.51 | — | ○ | range60 |
| ARX | 1826 | 0.243 | 0.96 | 2.05 | 09/04 +0.9% | 48 | 2.05 | ready | ○ | range60 |
| HZO | 1827 | 0.298 | 1.75 | 1.75 | 10/19 −0.7% | 18 | 1.42 | — | ○ | range60 |
| SLAB | 1828 | 0.406 | 1.05 | 3.05 | 09/11 +0.5% | 44 | 2.05 | — | ○ | range60 |
| ITGR | 1829 | 0.134 | 0.35 | 1.59 | 09/04 +0.8% | 48 | 0.77 | — | ○ | range60 |
| CZR | 1830 | 0.887 | 2.87 | 4.24 | 10/29 +2.0% | 10 | 1.63 | — | ○ | range60 |
| BMBL | —（非流動） | 0.453 | 1.85 | 147.54 | 10/13 +56.6% | 22 | 1.85 | — | — | since_gap |
| BOW | —（非流動） | 0.766 | 2.03 | 3.50 | 08/24 +0.7% | 57 | 3.34 | — | ○ | range60 |
| CCC | —（非流動） | 0.418 | 1.45 | 26.76 | 10/12 +8.1% | 23 | 5.19 | — | — | adr |
| CEPO | —（非流動） | 0.130 | 0.65 | 1.50 | 08/21 +1.1% | 58 | 0.84 | ready | ○ | range60 |
| CPAC | —（非流動） | 0.713 | 2.86 | 11.47 | 09/17 −3.7% | 40 | 8.38 | — | — | — |
| DSGR | —（非流動） | 0.307 | 0.95 | 1.93 | 11/11 +0.3% | 1 | 0.26 | ready | ○ | range60 |
| FUSB | —（非流動） | 0.904 | 2.39 | 9.83 | 10/05 −4.5% | 28 | 3.65 | — | — | — |
| LXFR | —（非流動） | 0.235 | 1.11 | 1.46 | 11/04 +0.6% | 6 | 0.40 | — | ○ | range60 |
| PAYO | —（非流動） | 0.428 | 1.55 | 1.98 | 09/03 +0.8% | 49 | 1.83 | — | ○ | range60 |
| PRTH | —（非流動） | 0.369 | 1.66 | 52.99 | 09/21 +33.8% | 38 | 2.32 | ready | — | since_gap |
| RNW | —（非流動） | 0.414 | 1.90 | 2.80 | 09/04 +0.6% | 48 | 2.20 | ready | ○ | range60 |
| SAFT | —（非流動） | 0.210 | 0.68 | 1.45 | 09/01 −0.6% | 51 | 1.43 | — | ○ | range60 |
| VREX | —（非流動） | 0.307 | 1.86 | 1.86 | 11/12 −0.7% | 0 | — | — | ○ | range60 |

- 二つの定義の違い：p1 の 22 行は p4 の 27 行にすべて入る。p4 だけの 5 行は SYNA（ADR20 0.790・20本 2.69%）、CZR（今日すでに range60）、BOW（同）、CPAC（0.713・2.86%）、FUSB（0.904・2.39%）。この 3 行（SYNA、CPAC、FUSB）は 20本の値幅だけが狭く、ADR は 0.7% 以上。R2 はこの 3 行を当てない。
- R2 の定数で新たに当たる掲載行は p1 の 22 行のうち、今日 lowRange でない 7 行とちょうど同じ（PCRX、BWIN、PAG、PTC、BMBL、CCC、PRTH）。この 7 行は ADR20 0.15〜0.49%・20本の値幅 0.52〜2.09% で、同じ数字で張り付いている。4 行（PCRX、PTC、BMBL、PRTH）は +33〜57% のギャップの後 22〜38 本が 1.0〜2.3% の幅に収まる（買収発表の後のような値動き）。3 行（BWIN、PAG、CCC）は +7.9〜8.8% の動き（G 未満）の後に ADR20 0.39〜0.44%。

### H4：908 件の補助の点での当たり（実測、`$T/r2/h4_flags.py` と `h4_summary.py`、`$T/r2/h4-figures.json`）

- 方法：凍結の probe（backend/scripts/probe_setup_ready_908.py）を import し、その `run_probe` に差し替えのスキャナーを渡した。だから点の選び方（読み込み、T0 での切り出し、63 本前の対照、飛ばす規則）は probe そのもの。差し替えの Setup Engine は準備の判定をせず、その点の日足から上の数字だけを返す。リポジトリには何も足していない（凍結のファイルは変えず、写しも作らない）。
  - コマンド：`cd $W/backend && DATABASE_URL="postgresql://local/none" /home/user/screener/backend/venv/bin/python $T/r2/h4_flags.py $T/r2/h4-figures.json`（11 秒）。
  - 結果の点の数：エントリー 588・対照 575。飛ばした数は no_bundle_file 270・short_history 50・対照の control_before_min_prior_bars 13 で、H4 と同じ。61 本未満の点は 0。

| 定義 | エントリー（/588） | 対照（/575） |
|---|---|---|
| 今日（60本の値幅 < 5%） | 1 | 1 |
| p1（ADR20 < 0.6% かつ 20本 < 3%） | 1 | 1 |
| p4（ADR20 < 0.5% または 20本 < 3%） | 2 | 2 |
| ADR だけ（X 0.4 / 0.5 / 0.6） | 2 / 2 / 2 | 2 / 2 / 2 |
| ギャップの後だけ（Y 3・N 15・G 10。Y 2、G 15、N 10 も） | 0 | 0 |
| **R2 の採用値（X 0.5・Y 3・N 15・G 10）** | **2** | **2** |
| 出発点（X 0.6・Y 3・N 15・G 10） | 2 | 2 |

- 当たったエントリーは 2 件で、どちらも束の日足の品質の問題。
  - SWSH 2017-03-31：60 本の終値・高値・安値がすべて同じ（出来高 0）。今日の 60 本の規則でも当たる。対照（2016-12-29）も同じ形。
  - POWR 2013-07-11：ADR20 0.37%、20本の値幅 6.53%。直近 21 本のうち 10 本が高値＝安値で出来高 0。対照（2013-04-11）は ADR20 0.15%。
- 採用の条件（エントリーの当たりが 5/588 以下）を満たす。余裕も大きい：上の 2 件を除くエントリーの ADR20 の最小は 1.109%（中央値 3.36%）。G 以上のギャップの後に 15 本以上ある点は 392 あり、その後の値幅の最小は 5.72%。
- H4 そのもの（setup_ready 28/588 対 23/575、+0.8pp、gate 6 で 458/588 が不合格）は R2 で変わらない。これは**推論**で、再実行はしていない。根拠：`git diff --stat 45603f06 HEAD -- backend` の出力が空（R2 はバックエンドのファイルを一つも変えていない）。凍結 908 ハーネス（SETUP +52.0pp）も同じ理由で変わらないとみているが、再実行はしていない。

### 規則（b）：前の土台（positionSizing.js）

- `positionPlan` は `pivotBar(judged, view.row)`（H1、凍結）でピボットの足を求め、その日付を `structuralStop` に渡す。
- `technical.vcp.base.brokeOut === true` で、`base.breakoutDate` が日付で、ピボットの足の日付より**前**なら、その土台は前の土台。構造上の損切りは未確認になり、理由は `previousBaseReason(breakoutDate, 分析日)` が作る 「前の土台（M/Dに上抜け済み）」（M/D は shortDate）。
  - だから `structural.low` は null、`stopInsideBase` は null、`structuralDeep` は null になり、「損切りが収縮の中」は出ない。planLevels の structuralLow も null なので、チャートの「最後の収縮の安値」の線もその行では消える。
  - 判定の場所は、収縮の安値を日足で確かめた直後（既存の「収縮を測定できません」「ピボットが未確認」「最後の収縮がピボットより上」「収縮の測定日が日足と不一致」の理由は今までどおり先に出る）。
  - 決まった % に置き換えることはしない。この銘柄の構造上の損切りを選んでいた人は、ほかの未確認のときと同じく設定の損切り幅に戻る（stopSource 'structural' は state 'ok' のときだけ）。
- ピボットの足が無い（vcp、se_pivot_date が無い、古い公開、一致する足が無い、日足が未検証）、土台が上抜けていない、上抜けがピボットの足と同じ日かそれより後：何も変わらない（vitest で固定）。
- bookTechnicalEvidence.js を読んだ：ピボットを読むところは無く、土台の安値をピボットと組む箇所も無い（`grep -n pivot` で 0 件）。組み合わせは positionSizing.js の structuralStop だけ。チャートの脚と VCP の「土台の高値を上抜け（M/D）」の文言は変えていない（オラクルの spec の ZZPG の形の検査が通る）。報告すべきものは無い。

### 規則（c）：結論の一行

- 今日は、低変動の行の結論は buyGate の既定（kind 'unjudged'、題は「低変動・監視のみ」、下の行は「買い位置を判定できません。」）で、理由を書いていなかった。
- いまは kind 'lowActivity'、題は同じ「低変動・監視のみ」、下の行は `lowActivityNote(view)`＝「{lowActivityReason の文}（独自設定）。」。例：「60日値幅5%未満（独自設定）。」「10/8の窓開け（+44%）後25営業日の値幅3%未満（独自設定）。」「20日平均値幅（ADR）0.5%未満（独自設定）。」
- `PLAN_BLOCKED.low` の文はそのまま。行の状態・並び・試算は今までどおり `lowRange` だけを読む（researchEngine.js:174/:196、portfolioPlan.js:49 は変えていない）。
- entryReadiness.js の選定の行は `${lowActivityReason(...)}：低変動のため監視のみ（独自リスク設定）。`。range60 の行と reason の無い古い公開の行では、文全体が今日とバイト一致（vitest）。

### 再現スナップショットでの結果（再構築の数、11-12。R-P1 の out/9ac8705 と R-P2 の out/93fd59e。`$T/r2/compare.mjs` → `$T/r2/compare-93fd59e.json`）

- **注意（PAG）**：下の数は再構築のもの。PAG は再構築の research の行では監査を通って price_activity が計算され、当たる。しかし銘柄画面の証明（certifyBars）は PAG の日足を通さず（R-P1 の試算の構造上の損切りが「日足が分析日で未検証」）、同じ入力のエクスポーターの再実行でも監査が日足を退ける（range60pct null、下の「エクスポートの同一性」）。だから公開版では PAG が当たらず、PAG の順位の動き（142 → 1826）と接近の件数の −1 は出ない可能性がある（未検証）。ほかの 6 行（PCRX、BWIN、PTC、BMBL、CCC、PRTH）はエクスポーターの再実行でも当たる。
- **lowRange の掲載行 17 → 24**。足されたのは PCRX（since_gap）、BWIN（adr）、PAG（adr）、PTC（since_gap）、BMBL（since_gap）、CCC（adr）、PRTH（since_gap）。外れた行は 0。今日の 17 行は 17 行とも reason 'range60' で、`range60pct`・`lowRange` の値も同じ。
  - counts.json の「準備のある張り付いた行と SLAB」：6/9 → **9/9**（TECH、PCRX、ARX、BWIN、CEPO、DSGR、PRTH、RNW、SLAB）。
  - 配信する全 5955 行では lowRange 107 → 125。掲載外の 11 行（AKO-A、CAPN、CHAR、EURK、FSHP、IBAC、NCEW、OPCH、SIMA、SSEA、TCBS）が足された（多くは信託の価格に張り付く SPAC）。
- 掲載 980・準備 37 は同じ（選定は変えていない）。rows.jsonl と ready43.jsonl は `ui_liquid_rank` 以外がすべて同じ。research の行は price_activity 以外がすべて同じで、price_activity の最初の2キーが変わったのは上の 18 行の lowRange だけ。
- **順位の変化（PR と OD6 で名前を出す）**：当たった行は最後に並ぶ。流動順位が動いた掲載行は 561。PCRX 1 → 1819、BWIN 75 → 1825、PAG 142 → 1826、PTC 400 → 1828。
  - 流動の上位 10（前）：PCRX、DRI、BMO、HCI、HUM、SWKS、WSM、SONO、PRGS、NDSN。
  - 流動の上位 10（後）：DRI、BMO、HCI、HUM、SWKS、WSM、SONO、PRGS、NDSN、LTC（PCRX が 1 位から外れる）。
  - Today の上位 5（focus、`work/today-eval.json`）：前後とも SWKS、HCI、HAE、ANF、LIND。件数はゾーン 68 → 67、接近 82 → 80、計 150 → 147。見出しの注記と forgotten（32 行）は同じ。
    - today-eval は件数の行の一覧を持たない。sell-eval で、ゾーン・接近から低変動に移った流動の選定行は PCRX（ゾーン）と BWIN・PAG（接近）で、件数の差（−1・−2）と合う。どの行が件数から抜けたかは、この対応からの推論。
- **当たった 7 行の画面**（`work/sell-eval.jsonl`）：
  - PCRX：前は 買いゾーン・結論 marketHold・試算 244 株・構造上の損切り tooDeep（安値 24.56）・`stopInsideBase` true（「損切りが収縮の中（安値 24.56 より上・独自判定）」）。後は 低変動・監視のみ・結論 lowActivity「10/8の窓開け（+44%）後25営業日の値幅3%未満（独自設定）。」・試算は `PLAN_BLOCKED.low`、株数なし、「損切りが収縮の中」なし。
  - BWIN：ピボット接近・277 株 → 低変動・lowActivity「20日平均値幅（ADR）0.5%未満（独自設定）。」・試算なし。
  - PAG：ピボット接近・40 株 → 低変動・lowActivity（ADR）・試算なし。
  - PRTH：買いゾーン・1128 株 → 低変動・lowActivity「9/21の窓開け（+34%）後38営業日の値幅3%未満（独自設定）。」・試算なし。
  - BMBL：ピボット接近・1478 株 → 低変動・lowActivity「10/13の窓開け（+57%）後22営業日の値幅3%未満（独自設定）。」・試算なし。
  - PTC、CCC：トレンドテンプレートの 1 条件未達で、結論は template のまま。状態は低変動・試算は `PLAN_BLOCKED.low`。
- **当たらなかった行**：sell-eval で差のある行は 570。当たった 7 行を除く 563 のうち 551 は `liquidRank` だけ（上の順位の変化）。残る 12 行（DV、TECH、PAYO、OGN、RNW、LNTH、ARX、SAFT、LXFR、HZO、BOW、DSGR）は今日すでに低変動の行で、結論の kind が 'unjudged' → 'lowActivity' になり、下の行が「買い位置を判定できません。」→「60日値幅5%未満（独自設定）。」になった（規則 c）。状態と試算は同じ。今日低変動の残る 5 行（SLAB は買収、ITGR、CEPO、CZR、VREX はテンプレート未達）は結論も同じ。
  - つまり、低変動でない行の状態・結論・試算は一つも変わっていない。変わったのは順位だけ。
- **規則（b）で構造上の損切りが変わる行**（`$T/r2/prevbase2.mjs` → `$T/r2/prevbase-93fd59e.json`。この木のモジュールで、試算が止まっていても構造上の損切りを直接計算した）：
  - 検証済みの掲載 615 行のうち、土台を測れたのが 615、上抜けた土台が 99、そのうちピボットの足より前に上抜けたのが 13。
  - 構造上の損切りが変わるのは 3 行。PCRX（土台の上抜け 10/8 < ピボットの足 10/26、tooDeep 安値 24.56 → 未確認「前の土台（10/8に上抜け済み）」）、VREX（8/10 < 11/3、tooDeep 安値 10.02 → 「前の土台（8/10に上抜け済み）」）、CCC（10/12 < 10/27、tooDeep 安値 6.43 → 「前の土台（10/12に上抜け済み）」）。3 行とも低変動で試算が止まるので、この再構築では画面に出ない。
  - 残る 10 行（BSVN、OVBC、IDT、TBCH、VTMX、ARX、SAFT、BMBL、BWIN、PTC）は前から「収縮を測定できません」で、変わらない。
  - 試算のある行で構造上の損切りが変わった行：**0**。

### インデックスの大きさとエクスポートの同一性

- `ONLY=index-size`（再構築の近似、差だけを使う）：ea5b8cd 619,830 → 93fd59e **622,390 バイト gzip（+2,560）**、raw 1,759,379 → 1,787,559（+28,180）。R のこれまでの合計は 8849bf9 の 613,518 から +8,872。公開版 868,379 にこの差を足すと 877,251 で、1,000,000 の内側（公開版での値は未検証）。
  - 全行に `adr20pct` と `gap` を載せた場合を同じ方法で測った（スクラッチ、`$T/r2/size/`）：+82,955。低変動の行だけに載せる形にしたのはこのため。丸め（小数 3 桁）でも +36,360 だった。
- **エクスポートの同一性**（STEP 0 の H2 の実行器の写し `$T/h2/run.sh`、old = 45603f06、new = 93fd59e、同じ `FINANCIAL_EVALUATED_AT=2026-11-13T10:14:12Z`、入力は `audit3/r3-step0/h2/input`）：
  - 両側とも 14,830 ファイル、エクスポーターは exit 0。old の研究インデックスは research-index-1bf5a7cc904990db.json で、STEP 0 の H2 の記録と同じ。
  - ハッシュを除いた名前で組にして、バイト単位で中身が違うのは 10,385 ファイル：詳細 5,955（price_activity にキーが増えた）、verified-charts 4,421（stock_data に price_activity を含む）、static-data 直下の 4 つ（研究インデックス、manifest、workbench、workbench-summary）、research-daily.json、scan/US.json、candidate-history の 1 つ、scan-list の 2 つ（5,955＋4,421＋4＋1＋1＋1＋2）。ほかに、名前のハッシュが変わって機械的に組にならない charts-index と scan-list の塊のファイルがある（手で組にして、ハッシュを伏せれば同じ）。
  - 正規化して比べた（`$T/h2/normalize.py`、`lists.mjs`、`deep.py`）：price_activity を最初の2キーに切り、インデックスから R1 の se_pivot_date を除き、ファイル名とパスの 16 桁のハッシュを伏せる。残る差は次の 3 つだけ。
    1. 17 行の `price_activity.lowRange` false → true（詳細 17、scan/US.json の rows 17 と initial_rows 3、研究インデックス 17）。17 行は再構築の 18 行から PAG を除いたもの。この入力では PAG の監査が日足を退けている（old・new とも range60pct null）。再構築の research の行は監査を通っているので、PAG はそちらでだけ当たる（入力の差。下の未検証）。
    2. research-daily.json の候補の順位（minervini と minervini2 の上位 50 が、当たった行が後ろに回った分ずれる）。
    3. インデックスに se_pivot_date（4,421 行、R1）。
  - それ以外（scan-list の行と preview、charts-index、candidate-history、workbench、manifest）は、ハッシュを伏せればすべて同じ。
  - エクスポーター自身のログ：研究インデックス 1,746,122 raw / 630,964 gzip → 1,781,586 / 639,390（+8,426 gzip。R1 の se_pivot_date と R2 の合計）。
  - export-research.mjs は変えていない（R-P1 の後の差は 0）。

### 規則 18（UI より先にデータを出さない）

- vitest（priceActivity.test.js の「the new price_activity keys reach no reader that refuses them」）：新しいキーを持つ行と、最初の2キーだけの同じ行で、researchEngine の状態（entryPlan）と並び（rankCandidates）が同じ。研究インデックスの符号化と復号で、price_activity がキーの順も null もそのまま戻る。entryReadiness も新しい形の行で動く（entryReadiness.test.js）。
- 8849bf9 の UI での確認（スクラッチ、`$T/rule18-r2/check.mjs`。8849bf9 の木 /home/user/screener/.claude/worktrees/r3-base を読むだけ）：再構築の 5955 行に R2 の price_activity を付けたもの（`$T/r2/research-r2.json`）と、それを最初の2キーに切ったものから、この木の listFields で 2 つのインデックスを作り、8849bf9 の prepareResearchBundle、candidateView、rowEvent、focusCandidates、focusCounts、entryReadiness、buyGate に通した。
  - 結果：エラー無し。順位・評価・ビュー・行のイベント・注目候補・件数・entryReadiness・buyGate の結論・行（price_activity を除く）が、両方で**すべて同じ**（`$T/rule18-r2/result.json`）。8849bf9 の UI は新しいキーを読まず、拒みもせず、lowRange だけを読む。
- price_activity のキーを調べる検証器は無い（grep：researchEngine.js、entryReadiness.js、portfolioPlan.js は lowRange だけを読む）。
- 古い UI が since_gap・adr の行に 60日の理由を出すか：8849bf9 で entryReadiness の選定の行の文（「60日値幅5%未満：…」）を描く部品は components/CandidateBoard.jsx・CandidateCharts.jsx・ChartDecisionSummary.jsx だけで、brief からは import されていない（grep：CandidateBoard が CandidateCharts を読むだけ。researchPreprocess.js は prepareReadinessBoundaries だけを読む）。8849bf9 の結論は低変動の行に「低変動・監視のみ／買い位置を判定できません。」と書き、理由を書かない。だから R2 のデータが UI より先に公開されても、誤った理由は画面に出ない（状態・並び・試算は lowRange どおり）。この木でも同じ部品はどこからも import されていないので、entryReadiness の文の変更は今の brief の画面には出ない（同じ生産者を使うための変更）。

### オラクルの probe（実測、93fd59e）

- `$H/probe/run-probe.sh $W 4423 oracles` → `probe-93fd59e-oracles.json`（label 132・value 132・8 銘柄・エラー 0、sha256 5df9eb3c…78db）。
- `node $H/probe/diff.mjs $H/probe/probe-ea5b8cd-oracles.json $H/probe/probe-93fd59e-oracles.json --texts` → 「32 of 264 views differ (0 → 0 page errors)」。32 は **ZZPG の label 16・value 16 だけ**。ほかの銘柄の差は 0（`$T/oracle-diff-93fd59e.txt`）。
- 計画は「ZZPG のチャートは変わらない」と見ていたが、変わる。理由は（b）ではなく（a）：ZZPG が低変動になって試算が止まり、planLevels が null を返すので、試算の水準が全部チャートから消える。期待どおりの差として次に挙げる。
  - 消える：損切りの線と名前「損切り −7.0%」、その価格「33.91」、構造上の安値（狭い幅では「安値」の札、1440 では「最後の収縮の安値 24.56」）、凡例の「損切り」と注記の「最後の収縮の安値 24.56」、aria の「損切りの目安 33.91、」。
  - 空いた場所に入る（配置器の置き直し。新しい要素ではない）：移動平均の名前（25、30、10日線、21日EMA）、320 の週足の「上抜け 0.38×」、2 行の凡例の次の項目（「収縮の安値を結ぶ線」「枠＝収縮」）。
  - 位置：チャートのカードは 320 で 38.8px、375 で 20.8px 上にずれる（その上の結論が短くなった）。カードの高さは phone で同じ。1440 の 3か月・6か月はカードが 20px 低くなる（注記の行が減る）。
- 492 ビューの probe と dump はバイト同一（下の実測）。既定のフィクスチャの行は price_activity も se_pivot_date も持たない。

### 語彙（CONTEXT.md、統合で）

- **ギャップ後の低変動**（since-gap 低変動）：直近60本で最大の1日の動き（終値比）が 10% 以上で、その後 15 本以上の値幅が 3% 未満の行。低変動（lowRange、低変動・監視のみ）の一つの理由。ほかの理由は 60日値幅（range60）と ADR20（adr）。
- **前の土台**：ピボットの足より前に上抜けた収縮の土台。その安値はこのピボットの構造上の損切りにしない。

### 未検証（R2）

- 公開版での効果（当たる行の数、順位、インデックスの大きさ）。数はすべて 11-12 の再現のもの。
- PAG のように、再構築の research の行と CI のエクスポーターで監査の結果が違う行の、公開版での扱い（この入力のエクスポートでは PAG は当たらない）。
- H4 と凍結 908 ハーネスの再実行（バックエンドの差が 0 なので変わらないと推論）。
- R3a（同じ定義のバックエンドへの移植）との一致：R3a はまだ無い。
- 時間の計測はしていない（チャートのコードは変えていない）。負荷のもとの loadavg はすべて参考。
- ブラウザで PCRX などの実データの画面を描いてはいない（sell-eval の結論と試算で確かめた）。

### 実測（R2。コマンドと結果。時刻は日本時間。負荷のもとでの数はすべて参考）

環境は R1 と同じ（`PATH=/opt/node22/bin:$PATH`、`FONTCONFIG_FILE=$S/ci-fonts/fonts.conf`、`SESSION_CALENDAR_PYTHON`、`FINANCIAL_REPLAY_PYTHON`）。HEAD は 93fd59e（この文書のコミットの前。後のコミットは docs/round3/verdict.md だけ）。

| 何を | コマンド | 結果 | /proc/loadavg（前 → 後、参考） |
|---|---|---|---|
| 測定（STEP A、再構築） | `node $T/r2/measure.mjs $H/snapshot/out/9ac8705 $T/r2/measure-9ac8705.json` | 掲載 980 行。p1 22 行、p4 27 行、今日の lowRange 17 行（上の表） | — |
| 測定（STEP A、H4） | `cd $W/backend && DATABASE_URL="postgresql://local/none" /home/user/screener/backend/venv/bin/python $T/r2/h4_flags.py $T/r2/h4-figures.json`、`python3 -I $T/r2/h4_summary.py $T/r2/h4-figures.json` | エントリー 588・対照 575、飛ばした数は H4 と同じ。採用値で 2/588・2/575（上の表） | 1.37 → — |
| vitest（触ったファイルと読み手） | `cd $W/frontend && npx vitest run src/static/priceActivity.test.js src/static/entryReadiness.test.js src/static/brief/positionSizing.test.js src/static/brief/buyGate.test.js src/static/brief/StockVerdict.test.jsx src/static/brief/StockPlanCard.test.jsx src/static/brief/StockView.test.jsx src/static/researchTransport.test.js src/static/entryPosition.test.js src/static/portfolioPlan.test.js tools/export-research-order.test.mjs`（93fd59e、11-14 20:32） | 11 ファイル・448 本すべて通過 | 3.37 → 6.14 |
| vitest（全部、1 回） | `cd $W/frontend && npx vitest run`（93fd59e、11-14 21:03–21:10、389 秒） | 248 ファイル・**4023 本**すべて通過（R1 の後 3993、+30） | 7.48 → 9.56 |
| Playwright | `cd $W/frontend && AUDIT_PORT=4423 AUDIT_MATCH='brief-(oracles\|plan\|decision\|invariants\|sell\|watch\|rows\|compact\|phone)\.spec\.js' npx playwright test -c $T/pw.config.mjs`（93fd59e、11-14 20:49–21:02、12.9 分、`$T/pw-93fd59e.out`） | 290 本：**289 通過・1 skip**。skip は brief-invariants.spec.js:340 の `test.fixme('INTEGRATION: …')`（R1 の統合の依頼）。brief-oracles.spec.js の fixme は **0**（R1・R2 とも test）。やり直しは無し。brief-compact と brief-phone（凍結の高さの予算）も通過 | 5.24 → 5.83 |
| R2 の Playwright だけ（コミット前） | 同じ設定で `-g 'R2'`、oracles・plan・decision・invariants | 9 本すべて通過（41 秒） | — → 3.87 |
| 492 ビューの probe | `$H/probe/run-probe.sh $W 4423` → `cmp $H/probe/probe-8849bf9.json $H/probe/probe-93fd59e.json`（11-14 20:35–20:39） | label 492・value 480・30 銘柄・エラー 0。**バイト同一**（sha256 b5f29cff…39fa2） | 8.02 → 11.25 |
| dump | `$H/dump/run-dump.sh $W 4423` → `cmp $H/dump/dump-8849bf9.json $H/dump/dump-93fd59e.json`（11-14 20:40–20:42） | 42 画面・エラー 0。**バイト同一**（sha256 cba0a2f2…c3555）。ウォッチ 5 銘柄の高さ 442 | 10.28 → 4.87 |
| オラクルの probe | `$H/probe/run-probe.sh $W 4423 oracles` → `node $H/probe/diff.mjs $H/probe/probe-ea5b8cd-oracles.json $H/probe/probe-93fd59e-oracles.json --texts`（11-14 20:43–20:45） | 132・132 ビュー・エラー 0。差は ZZPG の 32 ビューだけ（上の節） | 2.74 → 4.88 |
| 再構築（SNAP） | `$H/snapshot/run-snapshot.sh $W`（93fd59e、11-14 20:32–20:41、recalc 492 秒） | 全段 ok。eval-proxy は 980 掲載・準備 37 で同じ。rows.jsonl と ready43.jsonl のハッシュは SNAP と違う（`ui_liquid_rank` だけ。上の節）。counts.json：lowRange 17 → 24、張り付いた準備の行と SLAB 9/9、failedBreakout は R1 と同じ（hit 14） | 3.37 → 7.51 |
| 再構築の比較 | `node $T/r2/compare.mjs $H/snapshot/out/9ac8705 $H/snapshot/out/93fd59e $W/frontend/src/static/brief/pivotBar.js $T/r2/compare-93fd59e.json`、`node $T/r2/prevbase2.mjs $H/snapshot/out/93fd59e $H/snapshot/out/93fd59e/rows.jsonl $T/r2/prevbase-93fd59e.json` | 上の節のとおり | — |
| インデックスの大きさ | `ONLY=index-size` は再構築に含まれる（`out/93fd59e/index-size.json`）。全行に載せる案などは `$T/r2/restamp.mjs`・`variants.mjs` と `$H/snapshot/scripts/index-size.mjs` | 622,390 バイト gzip（ea5b8cd から +2,560） | — |
| エクスポートの同一性 | `$T/h2/run.sh 93fd59ec`（old 45603f06、new 93fd59e）→ `normalize.py`、`lists.mjs`、`deep.py`（11-14 20:45–20:46） | 上の節のとおり。両側の出力の木は記録の後に消した（sha の一覧、ログ、比較の結果は `$T/h2/` に残した） | 2.89 → 4.88 |
| 古い UI での確認 | `node $T/rule18-r2/check.mjs /home/user/screener/.claude/worktrees/r3-base $W $T/r2/research-r2.json $T/rule18-r2` | エラー無し。9 つの比較がすべて同じ（`$T/rule18-r2/result.json`） | — |
| lint | `cd $W/frontend && npm run lint`（93fd59e） | 0 errors・4 warnings（前と同じ 4 つ） | — |
| build | `$H/build/run-build.sh $W`（93fd59e、11-14 21:02–21:03） | `npm run build` の入口のチャンク 375.41 kB・**gzip 131.20 kB**。R1 の後（130.62）から **+0.58 kB**、STEP 0（130.28）からの R の合計 **+0.92 kB**、線 134.00 の内側。Design Acceptance の build の入口 gzip9 130,841 バイト（R1 の後 130,244 から +597） | 5.46 → 6.85 |
| 所有の門 | `python3 -I $S/audit3/check-ownership.py R $W 45603f065f054cd48c812a3003f3a71ffd91cf45` | 各コミットの前に OWNERSHIP OK | — |
| バックエンドの差 | `git diff --stat 45603f06 HEAD -- backend` | 出力は空 | — |
| 凍結のファイル | `git diff --stat ea5b8cd HEAD -- pivotBar.js brief-fixture.js portfolioPlan.js researchEngine.js positionGeometry.js briefCandidate.js StockPlanCard.jsx researchTransport.js transport bookTechnicalEvidence.js export-research.mjs` | 出力は空（brief-oracles.spec.js は R2 の 1 行だけ） | — |

- 高さ：brief-compact と brief-phone は変更なしで通過。台帳の高さ（既定のフィクスチャ）は動かない。既定の行は低変動でないので、結論の新しい行は台帳のどの変種にも出ない。ZZPG の結論は短くなった（チャートのカードが 320 で 38.8px、375 で 20.8px 上にずれる。オラクルの probe）。

### パッケージ R-P2 の記録

- コミット：a462ca5 `feat(frontend): flag pinned prices after a gap as low activity`、507afa6 `fix(frontend): never pair the stop with a base that broke out before the pivot`、93fd59e `test(frontend): flip the R2 oracle target and cover pinned prices after a gap`、この文書のコミット（docs）。
- 変えたファイル：priceActivity.js（規則と定数、`lowActivityReason`）、entryReadiness.js（理由の文）、buyGate.js（低変動の結論 `lowActivityNote`、kind 'lowActivity'）、StockVerdict.jsx（その行）、positionSizing.js（前の土台、`previousBaseReason`）、テスト（priceActivity・entryReadiness・buyGate・StockVerdict・positionSizing）、spec（brief-oracles.spec.js の R2 の 1 行、brief-plan・brief-decision・brief-invariants）、この文書。
- export-research.mjs は変えていない（注文どおり。price_activity はすでに列）。
- 注文からのずれ：
  1. X は 0.6 ではなく **0.5**（同じ結果で狭いほう。上の「定数」）。
  2. `adr20pct` と `gap` は**低変動の行だけ**に載せる（全行だとインデックスが約 83 kB 増える）。注文は「figures it used」とだけ書き、全行とは書いていない。低変動でない行では両方 null。
  3. `gap` は最大の動きが G 以上のときだけ（G 未満の動きはギャップと呼ばない）。
  4. ADR の式は注文の文の (高値−安値)÷終値 ではなく、注文が拘束する adrState の 高値÷安値−1（上の「規則（a）」）。
  5. 60本の窓に 0 以下の安値があると 'range60' に当てない（今日は負の安値で true になり得た。実データでは起きない）。
  6. 結論の kind を 'unjudged' から 'lowActivity' に変えた（'unjudged' の行は note を描かないので、理由を出すには別の kind が要る）。今日すでに低変動の 12 行の結論の下の行が「買い位置を判定できません。」→「60日値幅5%未満（独自設定）。」になる（状態・試算は同じ）。
  7. 計画の「ZZPG のチャートは変わらない」は成り立たない。試算が止まるので試算の水準が全部消える（上の「オラクルの probe」に正確な差）。

### 統合への依頼（R2）

1. **OD6（オーナーの確認）**：定数 X 0.5・Y 3・N 15・G 10 は、チャートを見た後に選んだもの。順位の変化（当たった行が最後に回り、PCRX が流動 1 位から外れる）を PR に書く。
2. **語彙（CONTEXT.md）**：上の「語彙」。
3. **R3a**：同じ定義と定数を Python に移す（このパッケージではしていない）。一致の検査の対象は、再構築の 18 行（掲載 7、掲載外 11）。
4. **計画の訂正（記録のみ）**：§5 R2 の「ZZPG のチャートは変わらない」（上の 7）。ADR の式の文（上の 4）。
5. bookTechnicalEvidence.js に直すべき組み合わせは無い（上の「規則（b）」）。依頼なし。
6. **合流のときの注意（ほかのトラックのオラクルの spec）**：ZZPG はオラクルを配信するどの画面でも低変動になる。ゾーンと注目候補の件数から抜け、並びは最後、チャートには試算の水準が無い。ZZPG を数える・並べる・チャートの水準を読む spec がほかのトラックにあれば、合流で当たる（R の spec の中には無い。凍結の brief-oracles.spec.js の形の検査は通る）。
7. **R1 の useBriefData.js の 1 行との関係**：規則（b）のピボットの足は、R1 の下限と同じく `view.row` の se_pivot_date から読む。R1 の統合の 1 行（インデックスに項目が無ければ詳細の se_pivot_date を消す）が入れば、古い公開では（b）も働かず、今日と同じになる。両方が同じ源を読むので食い違わない。
8. **JS の予算**：R の入口のチャンクの増分は STEP 0 から +0.92 kB（R1 +0.34、R2 +0.58）。線 134.00 までの残り 3.72 kB（130.28 から）の一部で、ほかのトラックと分け合う。

### 変えていないもの（R2）

`lowRange` の意味（今日の 17 行はすべて 'range60' で当たったまま）、低変動でない行の状態・結論・試算、選定、90% の線、トレンドテンプレート、Code 33、portfolioPlan.js、researchEngine.js、positionGeometry.js、briefCandidate.js、StockPlanCard.jsx、pivotBar.js、brief-fixture.js、輸送、バックエンド、チャートの脚と VCP の足跡の文、BOOK_TECHNICAL_VERSION、`PLAN_BLOCKED.low` の文、492 ビューの probe、dump、高さの台帳。

## R3c. 準備に効かない3つの診断（パッケージ R-P3）

コミット 6eae7cd `feat(scanner): add setup diagnostics for unconfirmed contractions and stale pivots`（ゴールデンを含む）。準備（`derived_ready`）・`failed_checks`・10 のゲートの名前と順・トレンドテンプレート・Code 33 は変えていない。

### 規則

- 3つの名前を `explain.diagnostics` に足す。通り道は既存の診断の経路（`ExplainBuilderInput.diagnostics`）。setup_engine_screener.py が、検出器の診断（`agg_output.detector_failed_checks`）の後ろに、readiness.py の `setup_diagnostics` の結果を並べて渡す。`failed_checks` には入らず、`derived_ready` を動かさない。新しい最上位の値は作らない（round 2 の規則 10）。
- 値が欠けていれば診断を出さない（不明は発見ではない）。どの診断も「ある」ときだけ出るので、欠けた値で誤って出ることはない。
- **`contraction_unconfirmed`**：ブリーフの収縮の自動測定（bookTechnicalEvidence.js の `automaticLegs`・`setupBase`・`contractions`、独自近似）が有効な並びを見つけない。チャートの「収縮は未確認」に当たる。
  - JS を Python に移した。浮動小数の演算の順も JS と同じ（ATR20 の累積和など。pandas の和は使わない）。定数は VCP_METHOD と同じ値で、test_setup_engine_parameters.py が bookTechnicalEvidence.js の宣言を読んで固定する。
  - 土台の起点は JS と同じ：主パターンの型の**最初の**候補の開始日・終了日（ペイロードが公開する形。カップならハンドルの日付が metrics から start_date に上がる）の間の最高値。その候補が無ければ、直近150本のジグザグで確かめた最高のスイング高値。エクスポーターが公開する `book_technical_evidence` は、再計算がその日のものなら、この土台を使う（export-research.mjs:128 は `se_candidates` を持つ行で呼ぶ）。
  - 有効とは、2〜6 個の収縮で、どれも始まりが山・後に安値・深さが正。ブリーフはさらに日足の認証を要る（認証されない行のチャートは常に「収縮は未確認」）が、診断はエンジン自身の日足で測る。
  - 高値・安値・終値のどれかが欠けるか 0 以下の足がある、または 20 本未満なら不明（診断なし）。
- **`pivot_already_crossed`**：ピボット自身の足より後の足で、終値がピボット ×（1 ＋ `PIVOT_ALREADY_CROSSED_PCT`／100）を超える。`PIVOT_ALREADY_CROSSED_PCT` = 3（config.py、独自設定）。
  - ピボットの足は pivotBar.js（凍結）の規則をそのまま移した：週足の型ならピボット日はその週の金曜のラベルで、その日までの7暦日のうち、高値がピボットとセント単位で等しい最も新しい足。日足の型ならその日の足（高値がセントで等しいとき）。セントは JS の `Math.round`（0.5 は切り上げ。Python の銀行丸めではない。単体テストで固定）。時間軸は選ばれた主パターンの候補自身のもの。足が見つからなければ診断なし。
  - p1 の 17/37 は「ピボット日より後の高値が 3% 超」。こちらは「ピボットの足より後の終値が 3% 超」で、狭い。
- **`pivot_below_base_high`**：ピボットが、土台の起点からピボットの足までの最高値より `PIVOT_BELOW_BASE_HIGH_PCT` を超えて下。`PIVOT_BELOW_BASE_HIGH_PCT` = 5（config.py、独自設定。p1 の 5%）。
  - 起点は選ばれた主パターンの候補（型・ピボット価格・ピボット日で一致するもの）の、カップなら左の縁（`left_lip_date`）、ほかは開始日。週足のラベルはその週の最初の暦日から数える。起点・ピボットの足・窓の高値のどれかが無ければ診断なし。
  - カップの左の縁のピボットは普通（p1 の検証の注意）なので、これは記録のための診断で、判定には使わない。

### テスト（すべてゲートに入った既存のファイル）

- test_setup_engine_screener.py `TestSetupDiagnostics`（13 件）：各診断がその形で出る、閾値の手前では出ない、欠けた入力では出ない（ピボット日なし・不正な日付・セントが合わない・ピボットなし・候補なし・高値の欠け）、週足のラベルはその週の最後の一致の足で区切る（その前の高い終値は数えない）、JS の丸め、ペイロードの日付で土台を取ると結果が変わる、診断があっても準備は true のまま。
- test_explain_builder.py：3つの名前を診断として渡しても `derived_ready` は true、ゲートの不合格はそのまま。
- test_setup_engine_parameters.py：VCP_METHOD の定数の固定。
- 既存の 2 件（理想の VCP、検出器の一つが履歴不足）は診断の正確な並びを固定していたので、末尾に `contraction_unconfirmed` を足した（どちらも準備は true のまま。緩めてはいない）。

### ゴールデンの差（`make golden-update`、実測）

scanner の 9 ファイルだけが変わり、どれも `explain.diagnostics` の末尾に足しただけ（前からの並びはそのまま、ほかのキーは同一。JSON を読んで比べた）。

| ファイル | 足した文字列 |
|---|---|
| scanner_3wt_strict.json | contraction_unconfirmed |
| scanner_cwh_classic.json | contraction_unconfirmed |
| scanner_degraded_no_benchmark.json | contraction_unconfirmed |
| scanner_first_pullback.json | contraction_unconfirmed |
| scanner_high_score_not_ready.json | contraction_unconfirmed, pivot_already_crossed |
| scanner_htf_classic.json | contraction_unconfirmed |
| scanner_no_pattern_exponential.json | contraction_unconfirmed |
| scanner_nr7_inside_day.json | contraction_unconfirmed |
| scanner_vcp_detected.json | contraction_unconfirmed |

検出器・集約・rrg のゴールデンと、ほかの scanner のゴールデン（scanner_insufficient_50_bars・scanner_policy_insufficient）は変わらない。golden-update の唯一の失敗は既知の test_mcp_market_copilot（このパッケージの前の HEAD での空の実行でも同じで、そのときは木が汚れなかった）。

### 再構築での確認（再現スナップショットの数、11-12。公開版の数ではない）

コマンド：`ONLY=bundle,recalc,eval,assemble,eval-sell,p1-analyze,p1-stats,counts $H/snapshot/run-snapshot.sh $W`（out/6eae7cd）。前は R-P2 の out/93fd59e。集計は `$T/r3/r3c-rebuild.py`（→ `$T/r3/r3c-rebuild-6eae7cd.txt`）。

- **準備は変わらない**：掲載 980 行のうち、新しい3つの文字列を除いて違う行は 0。準備 37 行は同じ銘柄。前からの診断が変わった行も 0。counts.json・work/sell-eval.jsonl・p1/stats.txt・work/eval-proxy.json・serve/research.json はバイト一致（R3c は failed_checks を変えないので、インデックスの `setup_recalculation.reason` も同じ）。
- **`contraction_unconfirmed`**：準備 37 行のうち **28**（計画の見込み 28）。CI の日足 22、代理の日足 6（BB, BHB, EMR, EQH, GEO, IQV）。掲載 694/980。
  - AMAL, BB, BHB, BWIN, CEPO, CZFS, EMR, EQH, FCNCA, GEO, GLBE, HAFC, IDT, IQV, LARK, LCNB, NBTB, OPK, PCRX, PRTH, RMBI, RNW, SIG, SWKS, TECH, TMP, TRST, WSFS。
  - 出ない 9 行：ADI, ARX, CFBK, CTKB, DJCO, DSGR, FMAO, MGRC, RDNT。
  - **JS との一致**（`$T/r3/contraction-parity.mjs` → `$T/r3/contraction-parity-6eae7cd.json`）：スナップショットのバンドルの `buildBookTechnicalEvidence` を、各行の公開形の候補（`se_candidates`）と再計算の記録で呼んだ。認証された掲載行 615 行すべてで、JS の「有効な並びなし」と Python の診断が一致（不一致 0）。認証されない 365 行はブリーフでは常に「収縮は未確認」。準備の行では、JS（認証なしは未確認と数える）29、Python 28 で、差は DSGR だけ（代理の日足で認証されないのでチャートは未確認、エンジンは包んだ日足で有効な並びを測る）。
  - **p1 の 28 との関係**：p1 と p3 の数（スナップショットの aria ラベル）は、土台の候補が無い経路（ジグザグだけ）で描かれたもの。同じ経路で測ると 27（CI 21、代理 6）で、CI の 21 行と、脚が描かれた 9 行（PCRX, MGRC, ADI, RDNT, CFBK, CTKB, LCNB, PRTH, RMBI）は p3 と同じ（最初の版のコミットで測った。`$T/r3/r3c-rebuild-d4049ba-algorithm-only.txt`）。公開の経路（土台の候補あり）では LCNB, PCRX, PRTH, RMBI が加わり、ARX, DJCO, FMAO が外れて 28。PCRX は p1 が見た 18/12/5（ギャップの前の脚）が、公開の経路ではハンドルの週から測るので脚にならない。
  - 最初の版（d4049ba、増やす前に修正して amend）は、集約の候補が開始日を metrics にしか持たないのを見落とし、いつもジグザグの経路を通っていた。JS との突き合わせで 55 行の不一致として見つけ、ペイロードと同じ正規化（`coerce_pattern_candidate`）を通すように直した。
- **`pivot_already_crossed`**：準備 37 行のうち **14**（p1 は 17）。ADI, BB, BHB, CTKB, EMR, EQH, FMAO, GLBE, HAFC, LCNB, NBTB, OPK, RDNT, SIG。CI 10、代理 4（BB, BHB, EMR, EQH）。掲載 614/980。
  - 内訳（`$T/r3/r3c-split.py` → `$T/r3/r3c-split.json`、再計算の全ペイロードから測り直し、バックエンドの出力と全 37 行で一致）：出た 14、ピボットの足があって出ない 23、ピボットの足が見つからない（不明）0。
  - p1 の 17 のうち SWKS（高値 +3.7%）・IQV（+4.0%）・TRST（+4.2%）は、高値では 3% を超えたが、ピボットの足より後の終値の最大は +0.17%・+2.14%・+1.15%（実測）。p1 に無い行は無い。
- **`pivot_below_base_high`**：準備 37 行のうち **8**。ADI, BB, CFBK, CTKB, GLBE, LARK, LCNB, OPK。CI 7、代理 1（BB）。掲載 369/980。
  - 内訳：出た 8、起点とピボットの足があって出ない 23、不明（起点の日付が無い：NR7 などの主パターン）6（AMAL, CZFS, FCNCA, MGRC, TMP, WSFS）。
  - **起点を取る候補は一意ではない**：型・ピボット価格・ピボット日が同じ候補が複数あり、起点（左の縁または開始日）が違う掲載行が 692/980（準備の行では 23）。集約がどれを選んだかはペイロードに無いので、診断はペイロードの順で最初に一致した候補の起点を使う（31d8dba で注記をそう直した。挙動は同じ）。信頼度でも絞ってみると、一致が取れない行が 133 あり、取れた行ではこの診断は変わらなかった（`$T/r3/r3c-primary.py`）。どの候補を使うかを確かめる手段は、集約が選んだ候補を出すこと（統合への依頼）。
- `contraction_unconfirmed` の内訳：出た 28、出ない 9、不明 0。

### H4（実測）

`cd $W/backend && DATABASE_URL="postgresql://local/none" /home/user/screener/backend/venv/bin/python scripts/probe_setup_ready_908.py --json $T/r3/h4-r3c2.json --rows`：変更の前（`$T/r3/h4-before.json`、STEP 0 の記録 `audit3/r3-h4/probe-908-8849bf9.json` ともバイト一致）と**バイト一致**（cmp）。probe は診断を出力しないので、変わるところが無い。準備の率・ゲートの表も同じ（28/588 対 23/575、+0.8pp、ゲート 6 で 458/588）。

### 規則 18（UI より先にデータを出さない）

- **新しい文字列は公開の研究の詳細に届く**：export-research.mjs:94 `row.se_explain=row.setup_engine?.explain`、また詳細は行そのもの（`setup_engine` を含む）を持つ。どちらも既存の自由形式の配列 `explain.diagnostics` の中の要素が増えるだけで、新しいキー・警告コード・インデックスの項目ではない。
- **読む側も拒む側も無い**（grep `diagnostics`・`se_explain`・`setup_engine`・`failed_checks`・`setup_recalculation`。frontend/src/static、frontend/src/components、frontend/tools）：
  - frontend/src/static（公開のブリーフ）は `se_explain`・`setup_engine`・`explain.diagnostics` を読まない。bookTechnicalEvidence.js が読むのは `se_candidates` と `setup_recalculation` の status・as_of_date だけ。
  - `se_explain` を読むのは接続版アプリの src/components/Scan（SetupEngineDrawer.jsx など）だけで、静的ビルドには入らない（main.jsx：`STATIC_BUILD` のとき App の遅延 import を落とす）。SetupEngineDrawer も表示するのは passed/failed の check と invalidation_flags で、diagnostics は描かない。
  - 詳細の受け入れの検査（bookFinancialAdmission.js の `sameKeys`、fundamentalsExplain.js の警告コード）は財務の記録とその警告コードのもので、`se_explain` の中身を見ない。
  - recalculate-setups.py は `failed_checks` だけを `setup_recalculation.reason` に写す（診断は写さない）。だからインデックスの行には届かない。このラウンドでは写さない（診断はバックエンド側に留める）。
- 詳細の内容が変わるので詳細のハッシュ（パス）は変わる。これは公開ごとに起きることで、新しい形ではない。

### 実測（R3c。コマンドと結果。時刻は日本時間。負荷のもとでの時間はすべて参考）

- 変更の前（HEAD b609500、11-14 23:10〜）：
  - H4：上のコマンドを `--json $T/r3/h4-before.json --rows` で（8分4秒、負荷 3.64 → 1.40）。8849bf9 の記録とバイト一致。
  - 凍結 908：`cd $W/backend && DATABASE_URL="postgresql://local/none" /home/user/screener/backend/venv/bin/python scripts/validate_trade_ideas.py > $T/r3/frozen-908-before.log`：「DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp」。STEP 0 の記録と、バンドルのパスの行と警告を除いて同じ。
  - ゲート：`cd $W && make PYTHON=/home/user/screener/backend/venv/bin/python gate-1`（〜gate-5、gate-check）：gate-1 279、gate-2 47、gate-3 152、gate-4 21（参考）、gate-5 43、gate-check OK。`make … golden-update` の空の実行は test_mcp_market_copilot の既知の失敗だけで、`git status` は空のまま。
- 変更の後（6eae7cd）：gate-1 294（新しい 15 件）、gate-2 47、gate-3 152、gate-5 43、gate-check OK。所有の検査 OWNERSHIP OK。再構築・JS との一致・H4 は上。

### 未検証（R3c）

- 公開版での数（すべて再構築の数）。公開版の詳細の `book_technical_evidence` が、ここで JS を呼んだ形（`se_candidates` あり）と同じ経路を通ること（export-research.mjs:94-95 と :128 の読みからの推論）。
- 凍結 908 は R3c だけでは再実行していない（R3a の後に1回。SETUP の列は Markets360 の条件で Setup Engine を見ない：p1-5）。
- R3c の時点の ready43.jsonl は単独では比べていない（rows.jsonl の同一から推論。R3a の後では比べた）。

## R3a. 張り付いた値動きで準備を不合格にする `price_pinned`（パッケージ R-P3）

コミット 24bf6b9 `feat(scanner): fail readiness on a pinned price`（ゴールデンを含む）。**採用**（下の4条件をすべて満たした）。統合で落とすなら、このコミットだけを revert すればよい（実測：作業用の clone で `git revert --no-commit 24bf6b9` は衝突なしで、その後の gate-1 は 294 件通過）。R3c は R3a の部品（`DailyBars`・`daily_bars_from_frame`・`_positive`）を使われ、同じ4つのファイルの末尾に足しているので、**R3c だけの revert は衝突する**（実測）。R3c を落とすときは R3a → 31d8dba（下の注記の訂正）→ 6eae7cd の順に revert する（実測：衝突なし、backend は b609500 と同一、gate-1 279・gate-5 43）。

### 規則

- R2（a）の低変動の規則（frontend/src/static/priceActivity.js の `lowRange` と `reason`）を、同じ定数で Python に移した（readiness.py `price_activity`・`price_pinned`）。順に調べ、最初に成り立ったものが理由：
  1. 'range60'：直近60本の値幅（最高値÷最安値−1）が 5% 未満（窓の高値・安値がすべて正のとき）。
  2. 'since_gap'：直近60本で最大の1日の動き（終値比。同じ大きさなら古いほう）が 10% 以上で、その後の足が 15 本以上あり、その高値・安値の値幅が 3% 未満。61 本未満、窓の中に欠けた終値、その後の足に欠けた高値・安値があれば不明。
  3. 'adr'：ADR20（直近20本の 高値÷安値−1 の平均）が 0.5% 未満。
- 演算は JS と同じ順の素の浮動小数（pandas の和・平均は使わない）。60 本未満、または規則の値が欠けていれば、その規則は当たらない（欠けた値で不合格にしない）。
- 成り立てば、スクリーナー（setup_engine_screener.py）が集約の `failed_checks` に `price_pinned` を足す。`build_explain_payload` は呼び出し側の失敗をすべて不合格にするので、`derived_ready` は false になる。
- **11 番目のゲートにはしない**（計画の訂正）：backend/tests/unit/services/test_probe_setup_ready_908.py は、`pre_existing_failed_checks=()` で全ゲートを落とし、explain_builder の失敗の名前がすべて凍結の probe の `GATE_OF_CHECK`（ゲート 1〜10）にあることを確かめている。ゲートの中に足せばこのテストが落ち、probe は凍結。呼び出し側の失敗として渡すので、10 のゲートの名前と順は変わらず、probe は `price_pinned` を「その他の失敗」に数える（このテストは gate-1 で通っている）。

### 定数（config.py。priceActivity.js と同じ値。test_setup_engine_parameters.py が JS の `export const` 7 つを読んで固定）

| 名前 | 値 | ラベル |
|---|---|---|
| `PRICE_ACTIVITY_SESSIONS` | 60 | ブリーフの規則（R2 の前からの 60 本） |
| `LOW_RANGE_PERCENT` | 5 | ブリーフの規則（低変動・監視のみ） |
| `ACTIVITY_ADR_SESSIONS` | 20 | 独自設定 |
| `LOW_ADR_PERCENT`（X） | 0.5 | 独自設定（OD6） |
| `GAP_MOVE_PERCENT`（G） | 10 | 独自設定（OD6） |
| `SINCE_GAP_RANGE_PERCENT`（Y） | 3 | 独自設定（OD6） |
| `SINCE_GAP_MIN_SESSIONS`（N） | 15 | 独自設定（OD6） |

### テスト（ゲートに入った既存のファイル）

- test_setup_engine_screener.py `TestPricePinned`（5 件）：ギャップの後の張り付き（上げ・下げ）、60 本より古いギャップ・本数不足（14 本は外れ、15 本で当たる）・小さすぎる動き、ADR だけ・60 本の値幅、欠けた値や 59 本では当たらない（欠けた終値では since_gap が不明になり ADR だけで当たる、JS のテストと同じ形）、スクリーナーでは理想の VCP を張り付かせると準備が false で、失敗は `price_pinned` ひとつ（10 のゲートはすべて通過）、診断には入らない。
- test_setup_engine_parameters.py：priceActivity.js の 7 つの定数の固定。
- frontend/tools/test_recalculate_setups.py は足していない：写すべき値は無い（recalculate-setups.py は既に `failed_checks` を `setup_recalculation.reason` に ` / ` でつなぐ）。そのテストは 10 件通過（実測）。

### ゴールデンの差（`make golden-update`、実測。R3c の後との差）

| ファイル | 変化 |
|---|---|
| scanner_cwh_classic.json | `failed_checks` の先頭に price_pinned（合成の 60 本の値幅 3.26%、reason 'range60'） |
| scanner_htf_classic.json | `failed_checks` の先頭に price_pinned（60 本の値幅 2.02%、'range60'） |

ほかのキーは同一（JSON で比べた）。どちらも前から準備は false。ほかのゴールデンは変わらない。

### 採用の4条件（判断の規則は H4 を走らせる前に `$T/r3/r3a-decision-rule.txt` に書いた）

1. **再構築**（`ONLY=bundle,recalc,eval,assemble,eval-sell,eval-today,p1-analyze,p1-stats,counts $H/snapshot/run-snapshot.sh $W`、out/24bf6b9。比べたのは R3c の out/6eae7cd。集計 `$T/r3/r3a-rebuild.py` → `$T/r3/r3a-rebuild-24bf6b9.json`。再構築の数）：
   - 準備 37 → **29**。準備から外れた行（規則 19 の行の一覧）：**ARX, BWIN, CEPO, DSGR, PCRX, PRTH, RNW, TECH**（p1 の張り付いた準備の 8 行と同じ。8 行とも `price_pinned`）。外れて準備になった行は 0。張り付いた準備の行は 8 → 0。
   - 張り付いていない掲載行は 1 行も変わらない（行のオブジェクトがすべて同一）。張り付いた行でも、`price_pinned`・準備・`setup_recalculation.reason` 以外は同一。ready43.jsonl は 37 → 29 行（上の 8 行が抜ける）で、残る 29 行は R-P2 の out/93fd59e と、R3c の診断の文字列を除いて同一（実測）。
   - 掲載行で `price_pinned` は 24 行：ARX, BMBL, BOW, BWIN, CCC, CEPO, CZR, DSGR, DV, HZO, ITGR, LNTH, LXFR, OGN, PAG, PAYO, PCRX, PRTH, PTC, RNW, SAFT, SLAB, TECH, VREX（R2 の lowRange の掲載 24 行と同じ）。
   - 全体（再計算 4,421 行）：準備 82 → 34。外れた 48 行はすべて `price_pinned`（掲載の 8 行のほか、AES, ALF, BDCI, BLZR, CCII, CHEC, CRAQ, EMIS, EVAC, FERA, FIGX, FSHP, GIW, GSHR, JACS, KOYN, LATA, LCCC, LKSP, LPBB, MBVI, MCGA, MKLY, NPAC, ONCH, ORIQ, OYSE, PACH, PAII, PCAP, RAC, RANG, RDAG, RTAC, SDHI, TAVI, TONT, UYSC, VNME, YCY。名前の多くは SPAC と見られる：推論）。
   - ほかの出力：work/today-eval.json は R-P2 の out/93fd59e とバイト一致（Today は変わらない）。work/sell-eval.jsonl は 8 行の `setup_ready` だけが true → false。counts.json で変わるのは `ready`（37 → 29、流動 18 → 14・非流動 19 → 15、CI の日足 30 → 23・代理 7 → 6）、`pinned_listed.ready`（8 行 → 空）、`lowRange_pinned_ready_plus_SLAB`（9 → SLAB の 1）だけ。p1/stats.txt は準備の行の上の項目が 29 行で計算し直される（[A] の張り付いた準備 8/22 → 0/22、[B] 流動 18/37 → 14/29 など）。
   - 研究インデックス（serve/research.json、5,955 行）：124 行の `setup_recalculation.reason` の先頭に `price_pinned` が付く。そのうち 48 行は `se_setup_ready` が true → false、`entry_evidence.shape` の `setup_ready` と既存の文「ブレイク前の準備条件を通過」→「ブレイク前の準備条件は未達（当日の購入条件とは別判定）」が変わる。新しいキーは無い。
2. **ゲート**：gate-5 43 通過（差は上の2ファイル）、gate-1 300、gate-2 47、gate-3 152、gate-4 21（参考）、gate-check OK。赤線（`cd backend && DATABASE_URL="postgresql://local/none" /home/user/screener/backend/venv/bin/python -m pytest tests/unit/scanners tests/unit/services tests/unit/golden tests/unit/test_scan_orchestrator.py --ignore=tests/unit/golden/test_mcp_market_copilot.py -q`）293 通過・失敗 0。
3. **凍結 908**（`validate_trade_ideas.py > $T/r3/frozen-908-r3a.log`）：「DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp」。変更の前のログと、バンドルのパスの1行を除いてバイト一致（diff）。凍結ハーネスの SETUP の列は Markets360 の条件で、Setup Engine の準備を見ない（p1-5）。だからこの一致は R3a の効果を示さない。効果は H4 で見る。
4. **H4**（`probe_setup_ready_908.py --json $T/r3/h4-r3a.json --rows`）：

| | 変更の前 | R3a の後 |
|---|---|---|
| エントリー（評価した点） | 588 | 588 |
| 対照 | 575 | 575 |
| setup_ready エントリー | 28/588（4.76%） | 28/588 |
| setup_ready 対照 | 23/575（4.00%） | 23/575 |
| 差（probe の表示、四捨五入） | +0.8pp | +0.8pp |
| 差（四捨五入なし） | +0.762pp | +0.762pp |
| ゲートごとの不合格（G1〜G10、両側） | docs/round3/step0.md §3 H4 の表（例：G6 エントリー 458・対照 301） | 同一（両側の gate_fail_n が全ゲートで一致） |
| その他の失敗（エントリー） | insufficient_data 10・insufficient_daily_bars 10・insufficient_weekly_bars 10 | 同じ ＋ price_pinned 2 |
| その他の失敗（対照） | insufficient_data 12・insufficient_daily_bars 12・insufficient_weekly_bars 6・primary_pattern_below_confidence_floor 2 | 同じ ＋ price_pinned 2 |
| 上抜け日のエントリーでの準備 | 215 件で 0 | 215 件で 0 |

   - `price_pinned` の点：エントリー SWSH 2017-03-31・POWR 2013-07-11、対照 SWSH 2016-12-29・POWR 2013-04-11。4 点とも前から準備ではない（ほかのゲートでも落ちる）ので、準備の数も準備の点の一覧（`ready_ideas`）も変わらない。R-P2 で測った「R2 の規則が当たる H4 の点：エントリー 2・対照 2」と同じ点。
   - 判断の規則（前もって書いた）：probe の差の表示が +0.8pp 以上なら満たす。満たした（+0.8pp、四捨五入なしでも同じ 0.762）。

### 一致の検査（計画 R3a のパリティ。再構築）

- **掲載の CI の日足の行**（612 行）：バックエンドの `price_pinned` の集合＝ブリーフの lowRange の集合（serve/research.json の `price_activity`、R2 の定義）。18 行で、違いは 0：ARX, BMBL, BWIN, CCC, CEPO, CZR, DV, LNTH, OGN, PAYO, PCRX, PRTH, PTC, RNW, SAFT, SLAB, TECH, VREX。代理の日足の掲載行でも 6 行（BOW, DSGR, HZO, ITGR, LXFR, PAG）で一致（ただしブリーフの公開版では代理の日足は認証されない：R2 の注意）。
- **関数どうし**（`$T/r3/pa-js.mjs` と `$T/r3/pa-py.py` → `$T/r3/pa-parity.json`）：再構築の入力の全 5,955 行で、再計算と同じ日足（受け入れた束の日足、または代理の包み）に priceActivity.js と Python の `price_activity` をかけ、`lowRange` と `reason` が 5,955 行すべてで一致（当たり 291 対 291）。再計算できた 4,421 行では、バックエンドの `price_pinned` 124 行＝JS の lowRange 124 行（違い 0）。

### 規則 18（UI より先にデータを出さない）

- `price_pinned` が届くのは既存の自由文の `setup_recalculation.reason`（インデックスの項目、` / ` でつないだ失敗の名前）と、詳細の `se_explain.failed_checks`。新しいキーも警告コードも無い。
- 読む側（grep `setup_recalculation`・`reason`。frontend/src/static、frontend/tools）：
  - setupReadiness.js は理由の文字列をそのまま根拠として返す（researchEngine.js の CSV の列と entryChecks の evidence）。名前の一覧で絞らないので、拒まない。
  - briefCandidate.js（凍結、読み取りだけ）と buyGate.js の `SE_BELOW_FLOOR_CHECK` は `reason.includes('primary_pattern_below_confidence_floor')`。`price_pinned` はその文字列を含まないので影響しない。briefCandidate.js:134 の `'25%超'` も同じ。
  - report-data-coverage.mjs は理由を ` / ` で分けて名前ごとに数える（`price_pinned` が一つの名前として加わるだけ。計画 §7 が「price_pinned を含む上位の失敗」を見込んでいる）。check-data-quality-core.mjs は status だけを見る。
- ブリーフでは 8 行とも R2 で既に「低変動・監視のみ」（試算なし）。準備が false になって変わるのは、準備に関わる表示（`se_setup_ready`、`entry_evidence` の文）だけ。ブラウザでの表示は確かめていない（未検証）。

### 未検証（R3a）

- 公開版での数（すべて再構築の数）。公開版の 8 行とほかの張り付いた行の、ブラウザでの表示（このパッケージはフロントのファイルを変えていないので vitest・Playwright は走らせていない）。
- 公開版のバーが再構築と違う行（代理の日足の 7 行など）での一致。
- 時間はすべて負荷のもとの参考（H4 10分13秒、負荷 2.70 → 7.26。凍結 908 は負荷 7.26 → 4.62）。

### 統合への依頼（R3）

1. **計画の訂正（記録のみ）**：§5 R3a の「準備の失敗の検査」は 11 番目のゲートではなく、呼び出し側の失敗として渡す（凍結の probe とそのテストのため。上の「規則」）。
2. **語彙（CONTEXT.md、統合で）**：`price_pinned`（張り付いた値動きで準備を不合格にする検査。ブリーフの低変動・監視のみと同じ規則）。`contraction_unconfirmed`・`pivot_already_crossed`・`pivot_below_base_high`（準備に効かない診断）。
3. **OD6**：定数はブリーフと同じ。ブリーフの定数を変えると test_setup_engine_parameters.py が落ちるので、両方を一緒に変える。
4. **オーナーに伝えること**：R3a は準備の KPI（再構築で掲載 37 → 29、全体 82 → 34）を下げる。H4 の差（+0.8pp）と凍結 908（SETUP +52.0pp）は変わらない。
5. 凍結のファイル（probe、凍結ハーネス、test_pivot_timeframes.py、検出器）は変えていない。
6. **集約が選んだ候補**：`AggregatedPatternOutput` は選んだ候補そのものを持たない（型・信頼度・ピボットの価格と日付だけ）。`pivot_below_base_high` を確かな起点で測るには、集約が選んだ候補（またはその順番）を出す必要がある（aggregator.py はこのトラックの所有だが、検出器・集約の出力の形を変えるのでこのラウンドではしない）。
7. **落とし方**：R3a だけなら 24bf6b9 の revert。R3c まで落とすなら 24bf6b9 → 31d8dba → 6eae7cd の順（上の実測）。

### 変えていないもの（R3）

10 のゲートの名前と順、`derived_ready` の組み立て（explain_builder.py は変えていない）、トレンドテンプレートと stage の規則（stage は 9 番目の拒否にしない）、Code 33、検出器のファイル（pivotBar.js が行番号を引く）、凍結の probe・ハーネス・バンドル、Makefile、フロントの実行時のファイル（このパッケージはフロントを変えていない）。

### パッケージ R-P3 の記録

- コミット：6eae7cd（R3c ＋ ゴールデン）、c54933b（R3c の記録）、24bf6b9（R3a ＋ ゴールデン）、97a59df（R3a の記録）、31d8dba（R3c の注記の訂正。挙動は同じ。gate-1 300・gate-5 43）、この文書の追記。どれも所有の検査 OWNERSHIP OK の後。R3a は単独で落とせる。R3c は R3a と 31d8dba の後でなければ落とせない（上の「落とし方」）。
- 順序：変更の前の基準（H4・凍結 908・ゲート・ゴールデンの空の実行）→ R3c → 再構築・JS との突き合わせ・H4 → R3a → 再構築・関数どうしの一致・H4・凍結 908・赤線・gate-4。
- 再構築の出力は `$H/snapshot/out/24bf6b9`（R3a）と R-P2 の `out/93fd59e` を残し、R3c の out/6eae7cd と最初の版の out/d4049ba は測定の後に消した（数は `$T/r3/` の集計ファイルにある）。
- フロントのファイルは変えていない（vitest・Playwright・ビルドは走らせていない。必要ない）。
