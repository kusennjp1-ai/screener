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

## R3b. ゲート 8 はブリーフが示すステージを読む（パッケージ R-P4）

コミット 53b82cb `feat(scanner): gate 8 reads the published stage`（ゴールデンを含む）。**採用**（下の3条件をすべて満たした。判断の規則と予測は測定の前に `$T/r3b/r3b-decision-rule.txt` に書いた）。統合で落とすなら、このコミットだけを revert すればよい（実測：`git diff 53b82cb^ 53b82cb | git apply -R --check` は HEAD 46cde70 の木に衝突なく当たり、53b82cb の backend の差は `git diff fb2db3c HEAD -- backend` とバイト一致。だから revert の後の backend は fb2db3c と同じ。後のコミットは backend に触れていない）。

### 規則

- ゲート 8 の入力を `quick_stage_check` から、Minervini スキャナーが公開する（ブリーフが示す）ステージに替えた。呼ぶのはスキャナーと同じ分類器 `WeinsteinstageAnalyzer.determine_stage`（SMA150 と 52 週高値を渡す、round 2 のステージ 2 の土台の規則を含む）。setup_engine_screener.py の `_published_stage` は、minervini_scanner.py:378-389 と同じ入力（逆順の終値・出来高・200 日線、オーケストレーターの事前計算があればそれ、52 週高値は直近 252 本の高値）を組み立てるだけで、分類の論理は写していない。
- ゲート 8 は**ステージ 2 を要る**。1・3・4 は不合格。**None は合格のまま**（50・150・200 日線のどれかが無いとき。欠けた値は不合格にしない）。
- 短い履歴：スキャナーの 200 日線の傾きは 219 本を要る（それより短いと 'unknown' で 3 か 4 に落ちる）。しかしセットアップエンジンのデータ方針は 252 本未満を insufficient にして、ゲートを一つも走らせない（policy.py `min_daily_bars`）。だからこの場合はゲート 8 に届かない（H4 の 200〜219 本の 6 点はどれも insufficient_data：`$T/r3b/short_hist.py`）。3 つ目の規則は足していない。
- ペイロードの `stage`（インデックスの `se_stage`）も同じ値になる。models.py の項目の説明を直した。トレンドテンプレートは変えていない（stage は 9 番目の拒否にしない）。

### テスト（ゲートに入った既存のファイル）

- test_setup_engine_screener.py `TestPublishedStageParity`（4 件）：4 つの形（上昇・平らな 200 日線・上昇中の 50 日線割れ・下降）で、ペイロードの `stage` が同じ足の `MinerviniScanner` の公開する `stage` と等しい（事前計算あり・なしの両方）。2 つの分類器が食い違う形（平らな 200 日線：quick 1・スキャナー 3 → 不合格になる。50 日線割れ：quick 3・スキャナー 2 → 合格になる）。200 日線が無ければ stage は None。
- test_explain_builder.py `TestGate8Stage`：ステージ 1 は不合格（失敗は `stage_not_ok` だけ、準備は false）、2 と None は合格。

### ゴールデンの差（`make golden-update`、実測。`$T/r3b/golden-r3b.diff`）

| ファイル | 変化 |
|---|---|
| scanner_3wt_strict.json | `stage` 3 → 2。`stage_not_ok` が `failed_checks` から消え、`passed_checks` に `stage_ok` |
| scanner_degraded_no_benchmark.json | 同じ |

どちらも準備は false のまま（`volume_above_dryup_cap`）。ほかのキーとほかのゴールデンは同一（JSON で比べた）。golden-update の失敗は既知の test_mcp_market_copilot だけ。

### 採用の条件

1. **再構築**（`ONLY=bundle,recalc,eval,assemble,eval-sell,eval-today,p1-analyze,p1-stats,counts $H/snapshot/run-snapshot.sh $W` → out/53b82cb。比べたのは R3a の out/24bf6b9。集計 `$T/r3b/r3b_rebuild.py` → `$T/r3b/r3b-rebuild-53b82cb.json`。**再現スナップショットの数**）：
   - **一致**：再計算できた 4,421 行すべてで、ペイロードの `stage` ＝ 同じ行のスキャナーの `stage`（不一致 0）。
   - 掲載の準備 **29 → 26**（予測どおり）。規則 19 の行の一覧（スキャナーのステージ／前の quick のステージ）：

| 行 | 変化 | スキャナー | 前の quick | 前の失敗 | 後の失敗 |
|---|---|---|---|---|---|
| CTKB | 準備から外れる | 3 | 1 | なし | stage_not_ok |
| DJCO | 外れる | 3 | 1 | なし | stage_not_ok |
| FCNCA | 外れる | 3 | 1 | なし | stage_not_ok |
| GEO | 外れる | 3 | 2 | なし | stage_not_ok |
| GLBE | 外れる | 3 | 1 | なし | stage_not_ok |
| RDNT | 外れる | 3 | 1 | なし | stage_not_ok |
| AVTR | 準備になる | 2 | 3 | stage_not_ok | なし |
| SHEL | 準備になる | 2 | 3 | stage_not_ok | なし |
| VSTM | 準備になる | 2 | 3 | stage_not_ok | なし |

   - 計画の見込みとの対応：スキャナーのステージ 3 の 8 行（GLBE, FCNCA, DJCO, RDNT, CEPO, CTKB, GEO, TECH）のうち、CEPO と TECH は R3a（`price_pinned`）で既に準備ではないので、外れたのは残りの 6 行。ステージだけで落ちていた行（AVTR, SHEL, ITGR, VSTM）のうち 3 行が準備になり、ITGR は `price_pinned` で外れたまま。ASIC（スキャナー 3）は外れたまま。
   - **注意（オーナーへ）**：新しく準備になった 3 行は、どれも R3c の `pivot_already_crossed` を持つ（p1 の測り方でピボット日の後の高値が AVTR +11.9%・SHEL +13.0%・VSTM +22.0%。VSTM は 52 週高値の −22.4%）。AVTR と SHEL は代理の日足。下の R4 のゲート 4 の案ならこの 3 行は外れる。
   - 全体（再計算 4,421 行）：準備 34 → 26。外れた 11 行（AIG, BSBK, CTKB, DJCO, FCNCA, GEO, GLBE, NTWO, OVLY, RDNT, UL）はすべてスキャナー 3（前の quick は 1、GEO と OVLY は 2）。準備になった 3 行は上と同じ。`stage_not_ok` の行 2,262 → 3,627。再計算した行のステージの分布：スキャナー {1: 1143, 2: 794, 3: 1049, 4: 1435}、前の quick {1: 1544, 2: 615, 3: 676, 4: 1586}。
   - ほかの出力：counts.json は `ready`（29 → 26、流動 14 → 11、CI の日足 23 → 19・代理 6 → 7）だけ。work/sell-eval.jsonl は上の 9 行の `setup_ready` だけ。work/today-eval.json は「失敗した大商いの上抜け」の一覧の RDNT の `setup_ready` だけ（注目候補・件数・見出しは同じ）。p1/stats.txt は準備の行の項目が 26 行で計算し直される。研究インデックス（5,955 行）：`se_setup_ready` 14 行（上の全体の 14 行）、`entry_evidence` 14 行、`setup_recalculation.reason` 1,871 行（`stage_not_ok` の有無）、`se_stage` 1,039 行（値がスキャナーのものになる）。新しいキーは無い。
2. **ゲート**（実測）：gate-1 304 通過、gate-2 47、gate-3 152、gate-4 21（参考）、gate-5 43、gate-check OK。赤線（`cd backend && … -m pytest tests/unit/scanners tests/unit/services tests/unit/golden tests/unit/test_scan_orchestrator.py tests/unit/test_setup_engine_contract.py --ignore=tests/unit/golden/test_mcp_market_copilot.py -q`）326 通過・失敗 0（R-P3 の組に契約のテストを足した）。
3. **凍結 908**（`validate_trade_ideas.py > $T/r3b/frozen-908-r3b.log`）：「DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp」。R3a の後のログと**バイト一致**（diff 空）。この SETUP の列は Markets360 で、ゲート 8 を見ない（p1-5）。効果は H4 で見る。
4. **H4**（`probe_setup_ready_908.py --json $T/r3b/h4-r3b.json --rows`。前は R-P3 の `$T/r3/h4-r3a.json`、24bf6b9 で取ったもの。HEAD fb2db3c のバックエンドとの差は 31d8dba のドキュメント文字列だけ：`git diff 24bf6b9 31d8dba -- backend` で確かめた）：

| | 変更の前 | R3b の後 |
|---|---|---|
| エントリー（評価した点） | 588 | 588 |
| 対照 | 575 | 575 |
| setup_ready エントリー | 28/588（4.76%） | **29/588（4.93%）** |
| setup_ready 対照 | 23/575（4.00%） | **21/575（3.65%）** |
| 差（probe の表示） | +0.8pp | **+1.3pp** |
| 差（四捨五入なし） | +0.762pp | **+1.280pp** |
| G8 の不合格（エントリー／対照） | 34／178 | 46／185 |
| G8 の差 | −25.2pp | −24.4pp |
| ゲート 8 の入力のステージ 2（エントリー／対照） | 528／300（quick） | 532／378（スキャナー） |
| Minervini のステージ 2（エントリー／対照） | 534／380 | 534／380（同じ） |
| ほかのゲートの不合格（G1〜G7・G9・G10） | docs/round3/step0.md §3 の表 | 同一 |
| 上抜け日のエントリーでの準備 | 215 件で 0 | 215 件で 0 |

   - 準備の点の出入り：エントリーは AG 2016-04-07 が加わる（失うもの無し）。対照は FDX 2020-11-24 が加わり、HTHT 2015-12-23・IOVA 2018-02-22・RIC 2016-03-29 が外れる。測定の前に h4-r3a.json の行から立てた予測（ready′ ＝ 失敗から stage_not_ok を除いて空、かつ Minervini のステージが 2 か None）と、両側の準備の点の集合が**完全に一致**した。
   - スキャナーとゲート入力のステージが違う点はエントリー 2・対照 6 で、すべてセットアップエンジンが insufficient_data（240〜251 本：Minervini は 240 本から、エンジンは 252 本から）。ゲートは走らないので、準備に効かない。
   - 判断の規則：四捨五入なしの差が前（+0.762pp）以上なら満たす。+1.280pp で満たした。

### 規則 18（UI より先にデータを出さない）

- 変わるのは既存の項目の値だけ：インデックスの `se_stage`（ペイロードの `stage`）、`setup_recalculation.reason` の文字列、`se_setup_ready`、詳細の `se_explain`。新しいキー・警告コード・インデックスの項目は無い（再構築のインデックスで確かめた）。
- `se_stage` を読む静的ブリーフの部品は無い（grep `se_stage`：frontend/src、frontend/tools、.github/scripts にテスト以外の読み手なし）。ブリーフのステージは行の `stage`（スキャナーの値）で、これは変わらない。

### 実測（R3b。時刻は日本時間。負荷のもとの時間はすべて参考）

- gate-1〜gate-5・gate-check（11-15 12:57〜12:59、負荷 5.66 → 6.84）、golden-update、赤線：上の数。所有の検査 `check-ownership.py R $W 45603f06…` → OWNERSHIP OK（41 パス）。
- 再構築 out/53b82cb：13:00:26〜13:10:33（recalc 577 秒、負荷 3.10 → 8.99）。
- H4：596 秒（負荷 3.44 → 8.91）。凍結 908：負荷 8.91 → 6.61。

### 未検証（R3b）

- 公開版での数（すべて再構築の数）。公開版では代理の日足の行（AVTR, SHEL を含む）のバーが違いうる。
- ブラウザでの表示（フロントのファイルは変えていない。vitest・Playwright・ビルドは走らせていない）。

### 統合への依頼（R3b）

1. 凍結の probe の説明（probe_setup_ready_908.py:39-41「"SE stage" is … (``quick_stage_check``), the input to gate 8」）は、R3b の後はスキャナーのステージになる。probe は凍結なので統合で直す（数え方は変わらない）。
2. docs/setup_engine/se_h4_formula_dictionary_operator_runbook.md:81・644 の `quick_stage_check` の記述（このトラックの所有の外）。backend/tests/unit/golden/test_golden_scanner.py:105 のコメントも古い（挙動には関係ない）。
3. 語彙（CONTEXT.md）：ゲート 8 ＝スキャナーが公開するステージが 2（None は合格）。
4. **オーナーへ**：R3b は H4 の差を +0.8 → +1.3pp に上げる（ただしエントリー 1 点の増加と対照 2 点の減少で、R4 で見積もった標準誤差 約 ±1.2pp の内。「下がらない」という採用の条件は満たすが、改善の証拠としては弱い）。再構築の掲載の準備は 29 → 26 になる。新しく準備になる AVTR・SHEL・VSTM はどれもピボットを越えて戻った行（`pivot_already_crossed`）。オーナーは採用を拒める（OD10）。

## R4. ゲート 3・4・6 の代案の評価（評価だけ。パッケージ R-P4）

**製品は変えていない**：`derived_ready`、ゲート、閾値、公開の項目はどれもそのまま。このラウンドではどの代案も採用しない（採用はオーナーの判断：OD10）。スクリプトはスクラッチ（`$T/r4/`）にあり、エンジンと凍結の probe の関数を import するだけで、編集していない。

### 「今日」と枠

- 「今日」＝R-P3 の最後（fb2db3c）のエンジン、つまり **R3b の前のゲート 8**（ステージ 1・2・None が合格）。こうすれば R3b を落としても表が残る。R3b を入れた場合は各表の最後の列に一行ずつ足した。
- 再構築は R3a の out/24bf6b9（バックエンドは fb2db3c とドキュメント文字列だけ違う）。掲載 980 行すべてがゲートまで届く。**再現スナップショットの数**。準備は 2 つの枠で数えた：「37 の枠」＝`price_pinned` も無視（R3a の前のゲートの組）、「29 の枠」＝`price_pinned` を含む（HEAD）。37 → 29 は R3a による。
- 代案のもとの準備：setup_score があり、そのゲートの失敗の名前を除いた失敗が空で、代案が合格。setup_score が無い点は準備にしない。
- 定義は 908 の評価の前に `$T/r4/definitions.txt` に固定した（下の修正 1 も 908 の前）。908 の数は、再構築で決めた切りをそのまま使った（908 で合わせ直していない）。

### 908 の計測（H4 と同じ数え方。実測）

- 凍結の probe の `run_probe` に、セットアップエンジンのペイロードを記録する工場を渡して一回だけ走らせた（fb2db3c の木を `git archive` したスクラッチの写し：`$T/r4/tree-fb2db3c`、`$T/r4/r4_908_capture.py`）。**自己検査**：1,163 行（エントリー 588・対照 575）のすべての項目が R-P3 の `$T/r3/h4-r3a.json` と一致（不一致 0）、準備 28/23、G6 の不合格 458/301。
- 代案はその記録から計算した（`$T/r4/r4_908_eval.py` → `$T/r4/h4-alts.json`）。足は束の CSV を T0 で切ったもの（probe と同じ `truncate_at`）。
- R3b を入れた行は、ゲート 8 をスキャナーのステージ（記録の `mv_stage` が 2 か None）で置き換えて数えた。この置き換えで作った R3b の準備の点は、実際の R3b の probe（`$T/r3b/h4-r3b.json`）と両側で完全に一致した。
- 差の目安：準備の率の差の標準誤差はおよそ ±1.2〜1.8pp（独立な二項分布とみなした粗い値。点は銘柄で対になっているので正確ではない）。

### ゲート 3：ピボットを土台の高値に置いた、いまの値動き

**NR7 の計算の訂正**（ここで使う「今日」の値はエンジン自身の readiness_score なので、訂正は今日の数にもう入っている）：

- p1 の誤り：p1 の監査（audit-p1-minervini-buyer.md §p1-2）は nr7_inside_day.py:200-209 と calibration.py:96-104 を引いて、「生の値は最大 58 で 73.9 に較正されるので、新しい NR7 や inside day はどれもゲート 3 を通る」と書いた。
- 正しくは：生の値 ＝ 24 ＋ 22×新しさ ＋（NR7 と inside day が重なった型なら 8、ほかは 4）＋（終値が EMA21 より上なら 4）。新しさ ＝ max(0, 1 − 経過本数/20)。較正は (生 − 24)/46×100（readiness_min 24、max 70）。p1 は 8 点をどの型にも足していた。この木で確かめた：nr7_inside_day.py:200-207、calibration.py:96-100。
- だから、ただの NR7 やただの inside day は最大でも生の値 54 → 65.2 で 70 に届かない。通るのは、重なった型が 0 本か 1 本前で、終値が EMA21 より上のときだけ（73.9 / 71.5）。2 本前なら 69.1。訂正は検証（verify-p1 の corrections）が見つけた。
- 再構築では、掲載の NR7 の主パターン 52 行のうち、今日ゲート 3 を通るのは 20 行。

**代案 G3′ の定義**：

- 土台の高値 BH は、土台の起点から**前日まで**の最高値。
  - 起点は R3c と同じ候補から取る。カップなら左の縁、ほかは開始日。週足のラベルはその週の最初の暦日から数える。
  - 起点が無いときは、前日までの 60 本を使う（独自設定）。再構築で起点から測れたのは 928 行、60 本で測ったのは 52 行。
- 次の三つがすべて成り立てば合格：
  - (i) 距離：終値/BH − 1 が −5%〜＋3%（p1 の 5% とゲート 4 の ＋3% を組み合わせた。独自設定）。
  - (ii) 締まり：直近 10 本の値幅（最高値/最安値 − 1）が T 以下。
  - (iii) 出来高の枯れ：直近 10 本のうち 3 本以上で、出来高がその日の 50 本平均の 0.8 倍未満（独自設定）。
- NR7 は特別扱いしない。

**修正 1（908 の前、再構築を見た後）**：

- T を合わせて今日と同じ合格率にすることは、できなかった。距離と枯れの二つだけで 980 行のうち 178 行（18.2%）が通り、今日のゲート 3 は 261 行（26.6%）だから、どんな T でも届かない。
- T = 10% にすると、距離の下限を外しても 205 行にしかならない。
- だから G3′ は作りからして今日より厳しい（基準は上がるだけで、下がらない）。固定した二つの形を出す：
  - **G3′-10**：T = 10%（独自設定。先に決めた切りのよい数。準備の行の 10 本の値幅の中央値は 8.1%）。
  - **G3′-dd**：締まりを見ない（距離と枯れだけ。この作りでいちばん緩い形）。

| | 今日 | G3′-10 | G3′-dd |
|---|---|---|---|
| ゲート 3 の合格（掲載 980 行、再構築） | 261（26.6%） | 116（11.8%） | 178（18.2%） |
| 両方で合格 / 今日だけ / 代案だけ | — | 37 / 224 / 79 | 54 / 207 / 124 |
| NR7 の主パターン 52 行の合格 | 20 | 9 | 13 |
| 準備（37 の枠） | 37 | 40（−20, ＋23） | 52（−15, ＋30） |
| 準備（29 の枠） | 29 | 32（−19, ＋22） | 44（−14, ＋29） |
| 準備（R3b あり、26 から） | 26 | 31 | 39 |
| H4 エントリー | 28/588（4.76%） | 29/588（4.93%） | 36/588（6.12%） |
| H4 対照 | 23/575（4.00%） | 16/575（2.78%） | 24/575（4.17%） |
| H4 の差 | ＋0.762pp | **＋2.149pp** | **＋1.949pp** |
| H4 の差（R3b あり） | ＋1.280pp | ＋2.153pp | ＋1.952pp |
| H4 の G3 の不合格（エントリー / 対照） | 320 / 365 | 395 / 484 | 233 / 419 |
| 上抜け日のエントリー 215 件での準備 | 0 | 0 | 0 |
| 上抜け日を除いた差（エントリー 373・対照 526） | ＋3.134pp | ＋4.733pp | ＋5.089pp |

- 準備の行の出入り（37 の枠、再構築）：
  - G3′-10 で外れる行：ADI, BB, CFBK, CTKB, DJCO, EMR, EQH, FCNCA, GEO, GLBE, HAFC, IQV, LARK, LCNB, MGRC, OPK, RDNT, RNW, SIG, SWKS。
  - G3′-10 で加わる行：ACNB, ALRS, AMTB, APD, BMBL, BNS, BSVN, CNO, CSX, CUBI, DRI, FNLC, FUSB, GCBC, GSBC, HBNC, LW, MFC, NATL, NDSN, PBA, PDM, TD。
  - G3′-dd は G3′-10 と比べて、外れる行から DJCO, EQH, GEO, IQV, SWKS が抜ける。加わる行には DSGX, GFR, HCA, INN, OBT, OMC, UTMD が足される。
  - 29 の枠では RNW（外れる側）と BMBL（加わる側）が落ちる。どちらも `price_pinned`。
- p1 が挙げた NDSN と NATL（ハンドルの古さでゲート 3 に落ちていた行）は、どちらの代案でも準備になる。加わる行の多くは銀行（ACNB, ALRS, AMTB, BSVN, CUBI, FNLC, FUSB, GCBC, GSBC, HBNC, PBA など）。値幅の切りが絶対値なので、値動きの小さい銘柄が通りやすい（推論）。

### ゲート 4：`pivot_already_crossed` を不合格にする

- 定義：R3c をそのまま使う（R3c は残っている）。ピボット自身の足より後の足で、終値がピボット ×1.03 を超えたら不合格。ピボットの足が分からなければ診断が出ないので、不合格にしない。
- G4′ ＝ `in_early_zone` が成り立ち、かつ `explain.diagnostics` に `pivot_already_crossed` が無い。

| | 今日 | G4′ |
|---|---|---|
| ゲート 4 の合格（掲載 980 行） | 255（26.0%） | 136（13.9%） |
| 準備（37 の枠） | 37 | 23（−14, ＋0） |
| 準備（29 の枠） | 29 | 15（−14, ＋0） |
| 準備（R3b あり、26 から） | 26 | 12（AVTR, SHEL, VSTM を含む 14 行が外れる） |
| H4 エントリー / 対照 | 28 / 23 | 27 / 23（エントリー 1 点が外れる） |
| H4 の差 | ＋0.762pp | **＋0.592pp（下がる）** |
| H4 の差（R3b あり） | ＋1.280pp | ＋1.110pp（下がる） |
| H4 の G4 の不合格（エントリー / 対照） | 358 / 443 | 364 / 472 |
| 上抜け日を除いた差 | ＋3.134pp | ＋2.866pp |

- 外れる 14 行（37 の枠）：ADI, BB, BHB, CTKB, EMR, EQH, FMAO, GLBE, HAFC, LCNB, NBTB, OPK, RDNT, SIG。R3c の 14 行と同じで、張り付いた行は無い。

### ゲート 6：3 つの形（合格率は今日と同じに合わせ、基準を下げない）

**較正**：

- 母集団は再構築の掲載 980 行 × 直近 20 本の 19,600 行日（p1 と同じ）。今日の 1 日の規則（出来高/50 本平均 ≤ 0.8）は 6,506 行日（33.19%）を通す。
- 3 つの形の切りは、それぞれ同じ行日数が通るように決めた。最終日のエンジンのゲート 6 と、この 1 日の規則は 980 行すべてで一致した。
- **G6a**：5 本の平均出来高/50 本平均 ≤ **0.903**（p1 の 0.9 とほぼ同じ）。
- **G6b**：直近 10 本のうち 5 本以上が、その日の 50 本平均の **0.818** 倍未満。5 本は固定で、倍率を合わせた。
- **G6c**：1 日の規則を **0.706** に下げ、加えて「ピボットでの上げの引け」を免除。上げの引けは前日の終値より上。ピボットでは、SE のピボットからゲート 4 の帯（−2%〜＋3%）の中。
  - 免除は合格を足すだけなので、合わせた 1 日の切りは 0.8 より下になる。
  - 免除に当たった行日は 2,728。
  - 再構築の 20 本では今日のピボットを固定した（近似）。過去の各日のエンジンのピボットで測ることは未検証。908 では T0 のペイロードのピボットを使ったので、これは正確。

| | 今日（≤ 0.8） | G6a | G6b | G6c |
|---|---|---|---|---|
| 切り | 0.8 | 0.903 | 0.818 | 0.706 ＋ 免除 |
| 合格率（19,600 行日） | 33.19% | 33.19% | 33.17% | 33.19% |
| 1 行あたりの 20 本での反転（安定性） | 5.19 | **1.86** | **1.09** | 5.68 |
| 最終日の掲載 980 行の合格 | 553 | 477 | 251 | 463 |
| 準備（37 の枠） | 37 | 35（−8, ＋6） | 22（−18, ＋3） | 41（−4, ＋8） |
| 準備（29 の枠） | 29 | 26（−6, ＋3） | 16（−15, ＋2） | 32（−3, ＋6） |
| 準備（R3b あり、26 から） | 26 | 27 | 15 | 31 |
| H4 エントリー | 28/588（4.76%） | 66/588（11.22%） | 73/588（12.41%） | 103/588（17.52%） |
| H4 対照 | 23/575（4.00%） | 24/575（4.17%） | 28/575（4.87%） | 29/575（5.04%） |
| H4 の差 | ＋0.762pp | **＋7.051pp** | **＋7.545pp** | **＋12.474pp** |
| H4 の差（R3b あり） | ＋1.280pp | ＋7.398pp | ＋7.893pp | ＋12.995pp |
| H4 の G6 の不合格（エントリー / 対照） | 458 / 301 | 268 / 278 | 191 / 264 | 326 / 332 |
| 上抜け日のエントリー 215 件での準備 | 0 | 3 | 11 | 19 |
| 上抜け日を除いた差 | ＋3.134pp | ＋12.327pp | ＋11.299pp | ＋17.007pp |

- 準備の行の出入り（37 の枠、再構築）：
  - G6a：外れる ADI, DSGR, FCNCA, FMAO, GEO, HAFC, RDNT, RNW。加わる BOW, CCC, CCNE, ESQ, LGND, SAFT。
  - G6b：外れる ADI, BB, CFBK, CTKB, DSGR, EMR, FCNCA, FMAO, GEO, HAFC, IQV, MGRC, NBTB, RDNT, RNW, TECH, TMP, WSFS。加わる CCC, LGND, SSTI。
  - G6c：外れる HAFC, IQV, RNW, TMP。加わる ASC, CPAC, HMC, LXFR, PAYO, PUBM, SSTI, XOM。
  - 29 の枠では、張り付いた行（DSGR, RNW, TECH, BOW, CCC, SAFT, LXFR, PAYO）が両側から落ちる。
- 合格率は再構築の行日で合わせたもので、908 では合わせていない。908 のエントリーは買いの日に近く、そこではゲート 6 の不合格が減る（458 → 268／191／326）。
- 上抜け日を除いても差は大きく上がる（＋3.1 → ＋11.3〜＋17.0pp）。だから上がった分は上抜け日の出来高を通したことだけによるのではない（実測）。
- それでも G6c は、上抜け日のエントリーを 19 件、準備にする。setup_ready は上抜けの前を見る作り（p1-4 の訂正）なので、作りとぶつかる。

### OD10 への短い勧め（採用はオーナーの判断。このラウンドではどれも出荷しない）

- **ゲート 3**：今のまま出さない。G3′ はゲート 3 からハンドルの古さを外すが、ゲート 1 の setup_score は今も品質と検出器の readiness_score から合成される（setup_engine_scanner.py の `SETUP_SCORE_WEIGHTS`）ので、古さの影響は残る。
  - G3′ は H4 の差を ＋0.76 → ＋1.9〜＋2.1pp に上げる。しかし標準誤差（約 ±1.2pp）を少し超えるだけで、ゲート 3 の合格率は 26.6% → 12〜18% に下がる。
  - 準備の行は半分ほど入れ替わり、加わる行は値動きの小さい銀行に寄る。
  - 進めるなら、締まりを値動きに対する比（ADR に対する比など）にして測り直す（未検証）。
- **ゲート 4**：不合格の検査にしない。R3c の診断のままにする。
  - H4 の差が下がる（＋0.762 → ＋0.592pp。R3b ありでも ＋1.280 → ＋1.110pp）。
  - 外れるのは R3c の 14 行（R3b ありなら AVTR・SHEL・VSTM を含む 14 行）。止まったピボットはブリーフの表示（停滞）で扱う。
- **ゲート 6**：代案を検討する価値がいちばんある。
  - 3 つとも合格率を同じにしたまま、H4 の差を大きく上げる（＋7〜＋12pp。上抜け日を除いても ＋11〜＋17pp）。
  - 注意：H4 のエントリーは買いの日で、対照はそうではない。だから買いの日の出来高を許すゲートは、probe の作りの上で有利になる。上抜け日を除いた列は、この偏りの一部しか取り除かない。
  - 第一の候補は **G6a**（5 本の平均 ≤ 0.90）。反転は 5.19 → 1.86 と安定し、再構築の準備の入れ替わりは最も少ない（37 → 35）。上抜け日の準備も 3 件と少ない。
  - G6b はいちばん安定する（1.09）。ただし準備を 37 → 22 に減らす。
  - G6c は差が最も大きい。しかし反転が増え（5.68）、上抜け日を 19 件通し、ピボットに頼るので勧めない。
  - 採用するなら、別のラウンドで H4・凍結 908・再構築の行の一覧を取り直す（規則 19）。

### 未検証（R4）

- 公開版での数（すべて再構築の数）。
- G6c の過去 20 本を、その日ごとのエンジンのピボットで測ること。ここでは今日のピボットを固定した。全部を歩くには約 2 万回の走査が要る。
- G3′ と G4′ の安定性（20 本での反転）。測ったのはゲート 6 だけ。
- 締まりを値動きに対する比にした G3′。
- 銀行に寄ることの原因。推論にとどまる。
- G3′ のもとでもゲート 1 に残る、ハンドルの古さの影響の大きさ。

### 実測（R4。コマンドと結果。時刻は日本時間。負荷のもとの時間はすべて参考）

- 再構築：`$T/r4/r4_rebuild.py $H/snapshot/out/24bf6b9 $H/snapshot/out/53b82cb $T/r4/rebuild-24bf6b9.json`。上の再構築の数と切りは、すべてこの出力から取った。ゲート 3 の内訳は `$T/r4/g3_breakdown.py`。
- 908 の記録：`cd $T/r4/tree-fb2db3c/backend && DATABASE_URL="postgresql://local/none" …/python $T/r4/r4_908_capture.py $T/r4/capture-fb2db3c.jsonl $T/r3/h4-r3a.json`。13:12〜13:20、負荷 6.38 → 2.02。不一致 0、ペイロードの欠け 0。
- 908 の評価：`$T/r4/r4_908_eval.py capture-fb2db3c.jsonl rebuild-24bf6b9.json h4-alts.json $T/r3b/h4-r3b.json`。R3b の置き換えは実際の probe と一致した。
- 908 の検査（`$T/r4/check_908.py capture-fb2db3c.jsonl` → `$T/r4/check_908.out`）：
  - ゲートまで届いた 1,141 点すべてで、スクリプトの 1 日の規則（≤ 0.8）がエンジンのゲート 6（`volume_above_dryup_cap`）と一致した（不一致 0）。出来高の比も記録の `volume_vs_50d` と一致した（不一致 0）。
  - G3′ の土台の高値の出どころ：エントリーは起点から 536・60 本 42、対照は起点から 497・60 本 66。908 でも大半は候補の起点から測っている。
- frontend/tools/test_recalculate_setups.py：10 件通過（R3b の後）。`stage_ok`・`stage_not_ok` を使うテストのファイル（test_setup_engine_contract.py、golden/test_golden_scanner.py、test_setup_engine_screener.py、test_explain_builder.py）は、どれも gate-1・gate-5・赤線で走らせた。
- `git diff 6b66e7a HEAD -- backend frontend` は空。R4 はドキュメントだけ。

### パッケージ R-P4 の記録

- コミット：
  - 53b82cb（R3b ＋ ゴールデン）
  - 6b66e7a（R3b の記録）
  - この文書の R4 の記録（`docs(round3): evaluate readiness gates 3, 4 and 6`）
  - どれも所有の検査 OWNERSHIP OK の後。R3b と R4 は別々に落とせる。R4 はドキュメントだけで、R3b を落としても表の「今日」の列は残る。
- 順序：
  1. 判断の規則と予測を書いた。
  2. R3b を実装し、テストとゲートを走らせてコミットした。
  3. 再構築・H4・凍結 908 で採用を決め、R3b を記録した。
  4. R4 の定義を固定し、再構築で較正した（修正 1）。
  5. 908 を一回だけ記録して評価し、R4 を記録した。
- 変更の前の基準：R-P3 の H4（`$T/r3/h4-r3a.json`）と凍結 908（`$T/r3/frozen-908-r3a.log`）を使った。どちらも 24bf6b9 で取ったもので、HEAD fb2db3c とのバックエンドの差は 31d8dba のドキュメント文字列だけ。
- 再構築の出力：
  - R3b の `$H/snapshot/out/53b82cb` を残した。
  - R3a の out/24bf6b9 は R4 の計算の後に消した。数は `$T/r3b/` と `$T/r4/` の集計ファイルにある。
  - R-P2 の out/93fd59e は R-P3 が残したまま。
- フロントのファイルは変えていない。全部の vitest を 1 回走らせた：`cd $W/frontend && PATH=/opt/node22/bin:$PATH SESSION_CALENDAR_PYTHON=… FINANCIAL_REPLAY_PYTHON=… npx vitest run`。11-15 13:23〜13:27、241 秒、負荷 0.21 → 7.49。248 ファイル・4,023 本すべて通過（R-P2 と同じ数）。Playwright とビルドは走らせていない（フロントの変更が無い）。

## R5. 窓の後のブレイク失敗を日付つきの一行で示す（パッケージ R-P5、任意・切り離せる）

p4-4 への対応。上抜けから `SELL_RULES.failedBreakoutSessions`（10）を過ぎると、ブレイク失敗の検査は「サインなし」に戻り、失敗について何も言わない（窓は上抜けの日から数える。CONTEXT.md）。そこで株の画面に、中立で日付つきの一行を一つ加える。10 営業日の規則と、すべての数は変えない。

### 規則（briefSell.js の `failedBreakoutContext`。この一行を作るのはこの関数だけ）

- 文言：「ブレイク失敗後（M/D上抜け→M/D割れ・その後の安値 −x.x%）」。
  - 日付は shortDate（年が違えば年つき）。
  - 安値はピボット比で、distanceText で書く（U+2212。「−0.0%」は出さない）。
- 上抜けの読み方は、ブレイク失敗の検査と同じ：
  - 検証済みの日足の直近 60 本（結論の振り返り、`CROSSING_LOOKBACK_SESSIONS`）を読む。
  - `from`（crossingFloor の足。sellSignals が 252 本に合わせ直す）より前の上抜けは読まない。
  - 各上抜けは breakoutBar で日付を決める（ピボットと同値の足の後は、最初にピボットの上で引けた足）。
- 一行を出さない場合：
  - 窓の中に、出来高 1.40× 以上の上抜け、または出来高が未確認の上抜けがある。検査がサインあり（または未確認）で、それ自体が失敗を言う。
  - 最後の終値がピボットのセント以上にある。
  - 窓より古い上抜けを新しい順に読み、軽い上抜けは飛ばす（ブレイク失敗ではない）。最初の重い上抜けを使う。最初に当たったのが出来高未確認の上抜けなら、一行は出さない。
  - その上抜けの後、ピボットの下で引けた最初の日が、上抜けから 10 営業日より後（上抜けが窓の間は持ちこたえた）。その日に検査がサインありになったことは一度もないので、「ブレイク失敗後」とは言わない。
  - 上抜けの足から最後の足までに、終値・安値・出来高の欠け（または 0）がある。日付や 0 を推測しない。
- 割れの日は、上抜けの後に初めてピボットの下で引けた日。いまの下の続きの始まりではない（SAIL のように、軽い再上抜けがあっても動かない）。
- 「その後の安値」は、割れの日から最後の足までの安値（終値ではない）の最小。
- 新しいしきい値は無い。使うのは `failedBreakoutSessions`（10）、`breakVolumeRatio`（1.40×）、`CROSSING_LOOKBACK_SESSIONS`（60）だけ。

### 置き場所（中立）

- sellSignals は、検査が「サインなし」で一行があるときだけ、結果に `failedContext` を載せる。一行がない結果は、形もこれまでと同じ（キーが無い）。
  - 検査の配列には入れない。だから tally・sellChipView・sellMarks・isBreakdown は読まない。ウォッチの行と Today の数も変わらない。
- 結論（StockVerdict.jsx）：見出しの下の行（と決算の注意）の後に、色の無い `<p>` を一つ。どの判定の下にも出る。二つの部分（「M/D上抜け→M/D割れ」「その後の安値 −x.x%」）は、電話の行で割らない。
- 売りのサイン（StockSellCard.jsx）：最初の説明の後に `brief-note` を一つ。折りたたみの外に出すので、電話でも開かずに見える。検査の行ではないので、印も色も無い。
- buyGate.js と positionSizing.js は変えていない。結論は `sells.failedContext` を読む。buyGate.test.js で、一行の有無にかかわらず、判定（kind・reason・reference ほか全部）と計画が同じであることを固定した。

### テスト

- briefSell.test.js（6 本）：
  - 窓の後に、三つの数を持つ一行。窓の終わる日（上抜けから 10 営業日目）には一行が無く、次の日から出る。
  - 窓の中はサインありで一行は無い。窓の中に新しい重い上抜け、または出来高未確認の上抜けがあるときも無い。
  - ピボットの上（同値のセント・それより上）では無い。窓の間ずっと持ちこたえた上抜けにも無い。割れが 10 営業日目なら出る。
  - 同値の後の上抜け、窓の中の軽い再上抜け（GEN の形）、割れの後の再上抜け（SAIL の形）、窓より古い軽い上抜け、重い上抜け二つ、60 本の振り返りの境。
  - 出来高の欠けか 0（上抜けの後・上抜けの日・その前の 50 本）、終値や安値の欠け、ピボットが無いときは無い。
  - 下限（from）：上抜けの足なら同じ。その後の足なら無い。crossingFloor の足（NR7 のピボットが上抜けの後）でも無い。
- StockSellCard.test.jsx（3 本）：電話と机上で一回だけ、producer の文言のまま、色の無い `brief-note`、折りたたみの外。検査の行と状態、説明の行は、一行が無いときと同じ。窓の中と既定の画面には無い。
- StockVerdict.test.jsx（1 本）：上昇トレンドと「控える」地合いの下で一回だけ、色の無い `<p>`、二つの部分はそれぞれ一続き。判定・色・見出し・下の行・メーター・タイル・チップは、一行が無いときと同じ。窓の中はブレイク失敗の判定で、一行は無い。
- buyGate.test.js（1 本）：接近・地合い（控える）・地合い未確認・TT未達で、判定と計画が一行の有無で同じ。
- brief-sell.spec.js（3 本：320・390・1440）：ZZAR を変えた行（`mutate`。ピボットを価格の 2% 上、15 営業日前に 2.2× で上抜け、次の日に割れ）。結論と売りのサインに一回ずつ、producer の文言で見え、カードの中に収まり、横スクロールは 0。判定・色・見出し・売りの検査は、同じ上抜けを軽い出来高にした対照（一行なし）と同じ。
- brief-invariants.spec.js（1 本）：同じ二つで、Today のタイル・ウォッチの行・ウォッチのタブが同じ。対照の株の画面には一行が無く、重い方には二つある。
  - 二つの変種では、上抜けの足とその 2 本前の足の出来高を入れ替えている。だから最後の日の出来高倍率など、行が読む値はすべて同じ。

### 再構築の行（再現スナップショットの数、11-12。公開版の数ではない。`$T/r5/eval-context.mjs` → `$T/r5/context-d5b3e42.json`）

ハーネスの eval-sell.mjs は `failedContext` を書き出さない。そこで、同じ経路（candidateView・certifyBars・diagnoseBookChart・crossingFloor つきの stockSells・buyGate）を新しい bundle で回す自前のスクリプトで数えた。

- 検証済みの上場 615 行、ピボットのある 564 行。ブレイク失敗の検査はサインあり 14、サインなし 550。この 550 のうち **17 行** が一行を持ち、533 行は持たない。
- 一行を持つ 17 行（流動性の順位、位置、判定、一行、その後の安値の日）：

| 銘柄 | 順位 | 位置 | 判定 | 一行 | 安値の日 |
|---|---|---|---|---|---|
| PLBC | – | near | marketHold | ブレイク失敗後（10/22上抜け→10/23割れ・その後の安値 −1.8%） | 11/5 |
| KARO | – | near | marketHold | ブレイク失敗後（9/23上抜け→9/24割れ・その後の安値 −12.0%） | 10/20 |
| SAIL | 94 | near | marketHold | ブレイク失敗後（9/22上抜け→9/25割れ・その後の安値 −13.2%） | 11/5 |
| UTMD | – | near | marketHold | ブレイク失敗後（10/22上抜け→10/23割れ・その後の安値 −11.1%） | 10/30 |
| PFG | 132 | near | marketHold | ブレイク失敗後（9/18上抜け→9/21割れ・その後の安値 −9.0%） | 10/14 |
| GEN | 136 | near | marketHold | ブレイク失敗後（9/14上抜け→9/16割れ・その後の安値 −33.7%） | 9/29 |
| FENC | – | base | basePosition | ブレイク失敗後（8/28上抜け→9/1割れ・その後の安値 −24.5%） | 11/6 |
| DK | 360 | near | template | ブレイク失敗後（8/21上抜け→8/24割れ・その後の安値 −13.7%） | 11/6 |
| FTRE | 361 | near | template | ブレイク失敗後（10/5上抜け→10/7割れ・その後の安値 −8.4%） | 11/12 |
| TNET | 404 | base | template | ブレイク失敗後（10/22上抜け→10/28割れ・その後の安値 −16.0%） | 10/29 |
| VG | 427 | near | template | ブレイク失敗後（10/23上抜け→10/26割れ・その後の安値 −19.3%） | 11/9 |
| RGEN | 446 | base | template | ブレイク失敗後（10/5上抜け→10/6割れ・その後の安値 −15.1%） | 10/8 |
| PAGP | 465 | base | template | ブレイク失敗後（10/23上抜け→10/30割れ・その後の安値 −12.2%） | 11/10 |
| ASND | 475 | near | template | ブレイク失敗後（9/3上抜け→9/9割れ・その後の安値 −18.3%） | 10/8 |
| TACT | – | base | template | ブレイク失敗後（10/22上抜け→11/5割れ・その後の安値 −9.0%） | 11/9 |
| NWBI | – | near | template | ブレイク失敗後（10/26上抜け→10/27割れ・その後の安値 −3.2%） | 10/28 |
| FXNC | – | near | template | ブレイク失敗後（10/27上抜け→10/28割れ・その後の安値 −5.6%） | 11/12 |

- **SAIL・GEN・PFG は一行を持つ**（計画の確認点）。
- p4 の表の % は、その後の **最安終値**（SAIL −12.0%、GEN −32.1%、PFG −8.3%）。注文どおり **最安値（安値）** をとるので、数は SAIL −13.2%、GEN −33.7%、PFG −9.0% になる。日付は p4 と同じ。
- p4 が「TT の 1 条件だけ足りない同じ形」とした 5 行：
  - DK・FTRE・VG・ASND は一行を持つ。一行は TT の判定にかかわらず出る。
  - **MSM は持たない**。10/1 に 1.94× で上抜けた後、初めてピボットの下で引けたのが 10/22（15 営業日後）。窓の間は持ちこたえたので、検査が一度もサインありにしていない。
- p4 の表の残りで窓の後のもの（WSM・IEX・ARQT・SIGI・HURN・APPF・LW・EWBC）は、いまピボットの上にあるので一行は無い。
- 「窓の間は持ちこたえた」という条件だけで一行が無い行は **3**（上抜け→初めての割れ、営業日）：MSM（10/1→10/22、15）、NEOG（9/15→10/6、15）、TALO（10/16→11/2、11）。`$T/r5/held-count.mjs` → `$T/r5/held-count.out`。この条件は注文の文言（「重い上抜けの後にピボットの下へ戻った」）より狭い読み方で、指揮者の確認を求める。
- 下限（crossingFloor）だけが一行を止めた行が **29**：BPRN, FCNCA, LARK, TRGP, DJCO, DE, CFFI, ICCC, AFCG, SI, RLAY, ATRC, NEO, NTAP, GTLB, FLXS, NAT, ZD, ACOG, TITN, DAC, PTGX, WNC, NCNO, CIB, ZYME, RMBI, BWIN, CCC。上抜けがいまのピボットの足より前にあり、このピボットの上抜けではない（R1 と同じ読み方）。
- 17 行すべてで、buyGate の結果（kind・reason・reference・title・note・blocked）は、`failedContext` を外した sells で回したものと同じだった。判定の内訳は、地合い（控える）6、TT未達 10、土台形成中 1。
- 前の head（R-P4 の out/53b82cb）と比べて、`work/sell-eval.jsonl`・`work/today-eval.json`・`counts.json`・`rows.jsonl`・`ready43.jsonl`・`serve/research.json`・`work/eval-proxy.json`・`p1/stats.txt`・`serve/charts`（manifest）はバイト単位で同じ（`$T/r5/compare.sh d5b3e42`）。
  - counts.json のブレイク失敗：サインあり 14・サインなし 550・検査なし 51。窓の中のサインあり 14 行は変わらない。
  - out/53b82cb には `work/pivot-date.json`・`work/oneoffs.txt`・`p1/gate6_alt.txt`・`index-size.json` が無いので、これらは比べていない（R-P4 の走らせ方による。R5 はこれらの入力を変えない）。新しい out/d5b3e42 は中間ファイル（recalc-proxy.jsonl・eval-proxy.jsonl）を残さない既定の走らせ方なので、R3b と R4 が読む out/53b82cb は消していない。

### フィクスチャ（既定の 30 行とオラクルの 8 行）

- 一行を持つ行は **0**（下限を外しても 0）。`$T/r5/zz-r5-fixture-scan.test.js.keep`（vitest の node 環境で一度だけ走らせ、木からは外した）→ `$T/r5/fixture-scan.json`。
- だから 492 枚の probe、dump、オラクルの probe はどれも変わらないはず。実際にバイト単位で同じだった（下の実測）。

### 規則 18（UI より先にデータを出さない）

- 公開するデータ、インデックスのフィールド、警告の符号は何も増やしていない。一行は、ブラウザが検証済みの日足からその場で作る。

### 実測（R5。コマンドと結果。時刻は日本時間。負荷のもとの数はすべて参考）

`S=/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad`、`T=$S/audit3/r3-verdict`、`H=$S/audit3/r3-harness`、`W=/home/user/screener/.claude/worktrees/r3-verdict`。環境は `PATH=/opt/node22/bin:$PATH`、`SESSION_CALENDAR_PYTHON=$S/audit/r1-step0/cal-venv/bin/python`、`FINANCIAL_REPLAY_PYTHON=$S/replay-venv/bin/python`、`FONTCONFIG_FILE=$S/ci-fonts/fonts.conf`。

| 検査 | コマンド | 結果 | 負荷（前 → 後） |
|---|---|---|---|
| 触れた vitest | `cd $W/frontend && npx vitest run src/static/brief/{briefSell,buyGate}.test.js src/static/brief/{StockSellCard,StockVerdict}.test.jsx`（コミット前、`$T/r5/vitest-touched.out`） | 4 ファイル・96 本すべて通過 | 5.51 → 5.79 |
| 全部の vitest | `cd $W/frontend && npx vitest run`（d5b3e42、11-15 14:55–14:59、259 秒、`$T/r5/vitest-full-d5b3e42.out`） | **248 ファイル・4,034 本すべて通過**（R-P4 の 4,023 ＋ 新しい 11 本） | 1.96 → 5.98 |
| Playwright（注文の 8 ファイル） | `cd $W/frontend && AUDIT_PORT=4423 AUDIT_MATCH='brief-(oracles\|sell\|invariants\|watch\|decision\|plan\|compact\|phone)\.spec\.js' npx playwright test -c $T/pw.config.mjs`（d5b3e42、14:40–14:54、14.1 分、`$T/r5/pw-d5b3e42.out`） | 236 本：**235 通過・1 skip**。skip は brief-invariants.spec.js:389 の `test.fixme('INTEGRATION: …')`（R1 の統合の依頼。8 ファイルの fixme/skip はこれだけ、grep で確認）。brief-compact・brief-phone（凍結の高さの予算）も通過。やり直しは無し | 4.54 → 3.37（途中で 12 まで。スナップショットの再構築と重なった） |
| R5 の Playwright だけ（コミット前） | 同じ設定で `AUDIT_MATCH='brief-(sell\|invariants)\.spec\.js' … -g R5`（`$T/r5/pw-r5-first.out`） | 4 本すべて通過（28 秒） | 5.28 → 7.36 |
| 492 枚の probe | `$H/probe/run-probe.sh $W 4423` → `cmp $H/probe/probe-8849bf9.json $H/probe/probe-d5b3e42.json`（14:59–15:02） | **バイト単位で同じ**（sha256 b5f29cff…39fa2）。R-P2 の 93fd59e とも同じ | 5.74 → 5.85 |
| dump | `$H/dump/run-dump.sh $W 4423` → `cmp $H/dump/dump-8849bf9.json $H/dump/dump-d5b3e42.json`（15:02–15:04） | **バイト単位で同じ**（sha256 cba0a2f2…c3555）。42 画面、375 の ZZNV は 3,044、ウォッチ（5 銘柄）は 442 | 5.46 → 4.96 |
| オラクルの probe | `$H/probe/run-probe.sh $W 4423 oracles`（15:04–15:06） | 8 銘柄・132 枚。**93fd59e（R の前のフロントの head）とバイト単位で同じ**（sha256 5df9eb3c…78db）。一行を持つオラクルは無い | 4.73 → 6.33 |
| 再構築 | `$H/snapshot/run-snapshot.sh $W`（14:40–14:52、recalc 685 秒、`$T/r5/snapshot-d5b3e42.out`）、比較 `$T/r5/compare.sh d5b3e42` | 上の「再構築の行」。counts.json は 53b82cb と同じ | 5.35 → 8.13 |
| lint | `cd $W/frontend && npm run lint` | エラー 0、警告 4（土台と同じ 4 つ。R5 のファイルには無い） | — |
| ビルド | `$H/build/run-build.sh $W`（15:06、`$H/build/build-d5b3e42.json`） | 入口のチャンク **131.72 kB gzip**（raw 376.84）。R5 の分は 93fd59e の 131.20 から **＋0.52**。R の累計は STEP 0 の 130.28 から **＋1.44**。線 134.00 まで 2.28 | 5.90 → 7.47 |
| 画面写真 | `$T/r5/shots/{conclusion,sell}-{320,390,1440}.png`（スクラッチの spec。木からは外した） | 320 で結論の一行は 2 行に折れ、二つの部分はそれぞれ一続き。売りのサインでは折りたたみの外 | — |

- 時間は一つも測っていない（このパッケージに時間の検査は無い）。

### 未検証（R5）

- 公開版での数と表示（すべて再構築の数）。
- 一行を持つ実データの株の画面の高さ（SAIL などの 375 での高さ）。既定のフィクスチャの高さの予算（ZZNV、売りのサインの上限）は、dump が同じで、brief-compact と brief-phone も通っている。
- 一行についての axe（アクセシビリティ）の検査、200% の拡大、明るいテーマの見た目。使ったのは既存のクラスと既存の `<p>` の書式だけ。
- 古い公開版（インデックスに se_pivot_date が無い）での表示。下限が null の道は単体テストで通しているが、古い公開版のファイルでは見ていない。
- 一行の出る日々の推移（ここでは今日のピボットで見た）。ピボットは毎日検出し直すので、表示される日々は未検証。

### 統合への依頼（R5）

- CONTEXT.md の語彙（統合で）。案：**ブレイク失敗後（M/D上抜け→M/D割れ・その後の安値 −x%）**：ブレイク失敗の検査の窓（上抜けから 10 営業日）の後、株の画面（結論と売りのサイン）だけに出す中立の一行。サインではなく、どの数にも、チップにも、印にも入らない。安値は割れの日からの最安値で、ピボット比。
- OD9（失敗の記憶）の既定はこの一行。もう一つの案（ピボットの上で引けるまで、または新しいピボットが出るまで失敗を残す）は作っていない。
- ハーネスの eval-sell.mjs（スクラッチ）は `failedContext` を書き出さない。統合で数えるなら `$T/r5/eval-context.mjs` を使う。
- 凍結のファイル（StockView.jsx、brief-fixture.js、brief-oracles.spec.js、briefCandidate.js、useBriefData.js、チャートのファイル、CSS）は変えていない。buyGate.js と positionSizing.js も変えていない。

### パッケージ R-P5 の記録

- コミット（どれも所有の検査 OWNERSHIP OK の後。R5 の 3 つはまとめて落とせる。R1〜R4 はこれに頼らない）：
  - 527ed3e `feat(frontend): date a failed breakout after its window`（briefSell.js・StockSellCard.jsx・StockVerdict.jsx と vitest 4 ファイル）
  - d5b3e42 `test(frontend): show the failed-breakout context on the stock screen and count it nowhere`（brief-sell.spec.js・brief-invariants.spec.js）
  - この記録（`docs(round3): record R5 (the failed-breakout context after the window)`）
- 注文と違えたところ：
  - 安値は p4 の表の終値ではなく、注文どおり安値で測った（数が変わる。上に記した）。
  - 割れが上抜けから 10 営業日より後の上抜けには一行を出さない（MSM）。検査が一度もブレイク失敗と呼ばなかった上抜けを「ブレイク失敗後」とは呼ばない。新しいしきい値ではなく、`failedBreakoutSessions` をそのまま使う。
  - buyGate.js は変えていない。結論は `sells.failedContext` を読み、判定のどれも変わらないことは buyGate.test.js で固定した（「buyGate の note」に入れると、接近の判定では表示されない。callLine が接近では note を使わないため）。
  - 売りのサインでは、一行をブレイク失敗の検査の行の中ではなく、折りたたみの外の説明に置いた。電話では落ち着いた検査は折りたたまれ、そのままでは見えないため。
- 片づけ：自分の古い出力のうち、93fd59e の probe（ふつうとオラクル）・dump・npm ビルドの出力と、再構築の out/93fd59e を消した（比較の後。どれも新しいものとバイト単位で同じか、取り直した）。out/53b82cb は R3b と R4 が中間ファイルを読むので残した。

## R6. 収縮はピボットの上抜けの前の足だけで測る（パッケージ R6-P1）

デザインの調べ（`design-r3/contraction-probe.md`）で、本物のアプリが上抜けの後の値動きを収縮（T）に数えていることが分かった。HUM の 「VCP 5週 13/4 2T」 の T2 は上抜けの次の日の押しで、LIND は測った土台そのものが上抜けの 1 か月後のもの。原因は `bookTechnicalEvidence.js` の `automaticLegs()`。測定は「土台の高値を初めて上回った足」でしか止まらず、Setup Engine のピボットを知らなかった。

### 規則（独自判定。新しいしきい値は無い）

- **上抜けの足**：`pivotBreakout(bars, row)`（bookTechnicalEvidence.js、Node だけで読める）。
  - ピボットの足は STEP 0 の `pivotBar(bars, row)`（H1）。
  - 上抜けの足は、ピボットの足より**後**で、終値のセントが `se_pivot_price` のセントを**上回った最初の足**。
  - ピボットのセントちょうどの終値は到達（touch）で、上抜けではない。終値が数でない足は飛ばす。
  - 後でピボットの下へ戻って、もう一度上抜けても（CFBK）、切れ目は動かない。
  - 結果は `{ state, pivotDate, breakoutDate, index, measuredThrough }`。
    - `'unknown'`：ピボットの足が無い（se_pivot_date が無い・不正、vcp の主パターン、ピボットが無い、高値がセントで一致する足が無い）。何も切らない。
    - `'none'`：ピボットの足はあるが、まだ上で引けていない。何も切らない。
    - `'cut'`：`measuredThrough` はその前の足の日付（収縮に使ってよい最後の足）。
  - bookTechnicalEvidence.js が読み込むのは `./brief/pivotBar.js` だけ（拡張子つき。pivotBar.js は何も読み込まない）。export-research.mjs がこのファイルを素の Node で読むため、breakoutHistory.js は読み込まない。`crossingFloor(bars, row)` は定義上 `pivotBar(bars, row)?.index` なので、継ぎ目（H1b）はそのまま守られる。テストで二つが一致することを確かめた。
- **測り直し**（自動の測定だけ。状態が `'cut'`、切れ目の index が c のとき）。
  - 1 回目のジグザグ（基準の高値）は `[max(0, c − 150), c)` だけを歩く。上抜けの後の高値が基準になることは無い（LIND）。
  - 収縮の歩みと最後の収縮の探索は `min(stop, c)` まで。c − 1 より先へは行かない。
  - ATR は全部の日足から取る。後ろ向きの平均なので、c より前の値は切った日足のものと同じ。短く切っても雑音の下限が 0 にならない。
  - Setup Engine の土台（`setupBase`）は、分析日に対して最新かの確認はそのまま。基準の探索と終わりを c より前に閉じ、基準は c − 1 より前に限る。満たさなければ null で、ジグザグの基準を使う。
  - こうして、収縮は **上抜けの前の日（`measuredThrough`）までの日足でこの測定がとるものと、ちょうど同じ**になる（テストの「切った日足」の性質）。
- **変えないもの**
  - `base.startDate`・`high`・`source` の意味（測った土台の基準）。
  - `base.endDate`・`brokeOut`・`breakoutDate` の定義：基準より後で、**全部の日足のうち**高値が土台の高値を初めて上回った足。ピボットの切れ目で上書きしない。footprint() の 「土台の高値を上抜け」、StockVerdict.jsx の色、R2(b)（positionSizing の previousBaseReason）がこれを読む。
  - レビュー担当者の区間（reviewer-intervals）。収縮はそのまま。`pivotCut` は参考として付ける。
  - `'unknown'` と `'none'` の行は、道筋・収縮・土台が今までとまったく同じ（テストと、既存の 22 本が変更なしで通ることで確認）。
  - VCP_METHOD の値、sma200、RS。
- **出力**：`vcp.pivotCut`（上の結果から `index` を除いたもの）。`limitations` に 1 行足した：「自動測定では、ピボットの日足の後に終値が初めてピボットを上回った日（上抜け）からの値動きを収縮に数えない（独自判定）」。VCP_LOOKBACK の上の説明も書き直した。
- **欠けた値は 0 にしない**
  - 残った収縮が 1 つ：`legs` は 1 つ、`enoughLegs` false、`measurementsValid` false、`depthsContract` null、`volumeContracts` null。`lastMeasuredDate`・`finalContractionVolume` はその 1 つのもの。
  - 残った収縮が無い：`legs` は空、`base` は null（上抜けの前に確かめられた高値が無い）、`lastMeasuredDate` と `finalContractionVolume` は null。
  - 深さ 0 の収縮も、2 つ未満からの `depthsContract` の true/false も、作らない。
  - `buildBookTechnicalEvidence(...).valid` は true のまま。

### なぜ「落とすだけ」ではなく測り直すのか

- 測り直しには、試せる意味がある。収縮は、上抜けの前の最後の日の時点でこの測定が見た土台。テストは `measureContractions(bars, {row, date}).legs` と、上抜けの足の前で切った日足（ピボットの日付を外した行、`date: null`）の `.legs` が同じことを確かめる。
- 落とすだけだと、LIND 型の行（測った基準そのものが上抜けの後）は何も残らない。上抜けの前に本当の土台があってもそうなる。
- 注文の決め方（再構築の数で、測り直しの「有効な 2 つ以上」が落とすだけより少なければ止める）を満たした。影響のある表示中の 98 行で、**測り直し 46、落とすだけ 23**。影響のある 304 行全部でも 136 と 29。だから測り直しを残した。
- 落とすだけのほうが有効になる行は **3**（TW・MCBS・PANL）。逆は表示中の 98 行で 26、304 行で 110。
  - 3 行はどれも、切れ目の手前の最後の収縮が 2〜3 本の短い区間になる（TW 10/06〜10/07、MCBS 10/26〜10/28、PANL 10/05〜10/07）。その区間が `validPeak` か `lowAfterPeak` を満たさず、測定全体が無効になる。HUM もこの種類（測り直すと T1 と無効な 11/09〜11/10 の区間。落とすだけでも T1 の 1 つで、どちらも描かれない）。
  - このパッケージでは直していない。直すと「切った日足と同じ」という定義が崩れる（指揮者の判断を求める）。

### 版の更新（v3）と規則 18（UI より先にデータを出さない）

- `BOOK_TECHNICAL_VERSION` を `'book-technical-evidence-v3'` にした。
  - 理由：StockView.jsx:49 は、公開された証拠の版が今の版と同じならそのまま使い、違えば検証済みの日足で測り直す。更新しないと、もう公開された詳細は、新しい UI の下でも上抜けの後の収縮を見せ続ける。
  - useBriefData.js:138 は公開された証拠を渡すだけで、版の判定は StockView が行う。LeaderEvidenceChart.jsx:66 も、版が違えば測り直す（拒まない）。
- **古い公開 UI が v3 の証拠を受け取った場合**：その UI の版は v2 なので、一致しない。自分のコードで測り直す（拒否は無い）。v2 の証拠を受け取った新しい UI も測り直す。
- キーの検査の grep（`grep -rn "book_technical_evidence\|sameKeys" frontend/src frontend/tools`、実測）：
  - `sameKeys` は bookFinancialAdmission.js（SEC の記録）だけ。
  - `book_technical_evidence` を読むのは useBriefData.js:138、LeaderEvidenceChart.jsx:65、export-research.mjs:144/225/228（書き出し）。テストは scan-list-payload.test.mjs（一覧から外す）と export-research-order.test.mjs:465（詳細のフィールド）。
  - `book_technical_evidence` や `vcp` のキーを数える・拒む検査は無い。新しいキー `vcp.pivotCut` を読む画面も無く、古い UI は知らないキーを読まない。
  - check-data-quality-core.mjs は証拠の版を見ない。
  - リポジトリ全体（`git grep -n "book-technical-evidence\|book_technical_evidence\|BOOK_TECHNICAL_VERSION" -- ':!frontend/src' ':!frontend/tools'`）でも、.github/scripts の 2 つ（financial-candidate-baseline-derived.mjs と publisher-export-research-oct6-carry-v1.mjs のフィクスチャ）が詳細からこのキーを外す・書くだけで、版やキーを検査する所は無い。backend/tests/unit/test_setup_engine_parameters.py は `const VCP_LOOKBACK = …` の宣言の値だけを読む（この行は変えていない。14 本通過、実測）。
- **ほかのトラックへの依頼**：`frontend/src/static/brief/StockChartCard.test.jsx:143`（CHART の持ち物）は版の文字列 `'book-technical-evidence-v2'` を直接書いている。v3 では「古い版」になり、StockView が測り直して収縮が消えるので、「names the contraction marks only when they are drawn…」が落ちる。
  - 原因の確認（実測）：定数を一時的に v2 に戻すと 16 本すべて通る。元に戻したことは cmp で確かめた。
  - 直し方の案：`BOOK_TECHNICAL_VERSION` を読み込んで使う（この test は「今の版の証拠」を意味している）。このファイルは編集していない。

### 書き出し側と画面側の行（読んで確認、編集なし）

- **公開**：recalculate-setups.py は Setup Engine の payload の値をすべて `se_` を付けて行に書く（`pivot_price`→`se_pivot_price`、`pivot_date`→`se_pivot_date`、`pattern_primary`→`se_pattern_primary`）。±25% の規則が消すのは `se_pivot_price` だけ。export-research.mjs は scan の行をまとめ（mergeScanRows）、:94 で `se_candidates` を足し、:129 でその行のまま `buildBookTechnicalEvidence` を呼ぶ。だから平らな 3 つのフィールドが届く。統合への依頼は無い。
- **画面**：StockView の行は `mergeFinancialDetail(summary, detail)`（financialCurrent.js:253、`{ ...detail, ...summary, setup_recalculation: … }`）。インデックスの行は listFields で `se_pivot_price`・`se_pivot_date`（R1）・`se_pattern_primary` を持つ。詳細は `se_candidates` を持つ。se_pivot_date の無い古いインデックスでは、詳細の行の値が残る。

### 再構築での数（再現スナップショットの数、11-12。公開版の数ではない）

- 入力：`$H/snapshot/out/d5b3e42`（rows.jsonl、serve/research.json、serve/charts、work/benchmark.json）。d5b3e42 の後にバックエンドのファイルは変わっていないので、recalc は走らせず、新しいスナップショットも作っていない。
- 「前」は b80ab95e（`git -C $W archive b80ab95e frontend/src frontend/contracts`）、「後」は 196c880。どちらもその木の esbuild の束で読み、行は export-research.mjs と同じに作った（研究の行と、rows.jsonl の setup_engine.candidates からの se_candidates）。上抜けの足は製品の `pivotBar` で決めた。
- 「表示」は `certifyBars(...).certified && vcp.measurementsValid`（StockView がチャートの枠と VCP カードの T を描く条件）。
- 「影響あり」は、状態が `'cut'` で、前の収縮のどれかが上抜けの日かその後に終わる行。
- 「土台の準備完了 30」は土台の木の再構築（c61bf96）の準備完了で、CI と同じ日足の 30 行（調べと同じ組）。「このブランチの準備完了 19」は d5b3e42 の準備完了 26 行のうち CI と同じ日足の 19 行（R3b などで組が変わっている）。
- コマンド：`node $T/r6/tally.mjs $H/snapshot/out/d5b3e42 $T/r6/before-bundle/bundle.mjs $T/r6/after-bundle/bundle.mjs $T/r6/tally-196c880.json $H/snapshot/out/c61bf96/counts.json`（→ `$T/r6/tally-196c880.out`）。

| 数（前 → 後） | 掲載 980 | TT 8/8 の 614 | 土台の準備完了 30 | このブランチの準備完了 19 |
|---|---|---|---|---|
| pivotCut の状態 unknown / none / cut | 86 / 224 / 670 | 60 / 110 / 444 | 0 / 11 / 19 | 0 / 7 / 12 |
| 収縮を描く行（表示） | 187 → 229 | 118 → 155 | 8 → 7 | 5 → 5 |
| 「押しが毎回浅くなっています」の行（footprint().contracting === true） | 131 → 153 | 86 → 104 | 7 → 7 | 4 → 4 |
| 影響あり（前に表示されていた行） | **98** | 63 | 4（ADI・RDNT・CFBK・CTKB） | 3 |
| 影響あり（前に収縮が 1 つでもあった行） | 304 | 208 | 5 | 4 |
| 後で、状態 cut の行のうち上抜けの日以後に終わる収縮がある行 | **0** | 0 | 0 | 0 |
| 影響あり（表示）：測り直しで 0 / 1 / 有効な 2 以上 / 無効な 2 以上 | 0 / 46 / **46** / 6 | 0 / 32 / 28 / 3 | 0 / 2 / 2 / 0 | 0 / 1 / 2 / 0 |
| 同じ行で、落とすだけなら | 55 / 20 / **23** / 0 | 39 / 13 / 11 / 0 | 2 / 1 / 1 / 0 | 1 / 1 / 1 / 0 |
| 影響あり（全部）：測り直し | 0 / 140 / 136 / 28 | 0 / 91 / 97 / 20 | 0 / 2 / 3 / 0 | 0 / 1 / 3 / 0 |
| 同じ行で、落とすだけなら | 244 / 26 / 29 / 5 | 171 / 17 / 16 / 4 | 3 / 1 / 1 / 0 | 2 / 1 / 1 / 0 |
| 構造の損切りが変わった行 | 190 | 134 | 5 | 4 |
| 構造の安値が上抜けの日以後の収縮から来る行 | 76 → **0** | 46 → 0 | 4 → 0 | 3 → 0 |
| unknown・none の行で、収縮か土台が変わった行 | **0** | 0 | 0 | 0 |

- 影響のある表示中の 98 行の内訳は、HUM 型（基準が上抜けの前）54、LIND 型（基準が上抜けの後）44。調べの数と同じ。
- 表示の移り変わり（掲載 980）。
  - 影響あり 304：表示→表示 46、表示→非表示 52、非表示→表示 90、非表示→非表示 116。
  - 新しく表示される 90 行のうち 82 は、測り直した土台の高値がもう上回られている（`base.brokeOut` true。footprint が 「・土台の高値を上抜け（M/D）」 と書く）。58 行が「押しが毎回浅く」。例：DRI、WSM、CATY、AMGN、SYRE、EWTX、TRGP、SAIL、URI、ANET。
  - 状態 cut で影響なし 366：357 は収縮が同じ。**9 は変わった**（DE、APA、LFST、IPAR、CTAS、FET、KMTS、OPK、RDWR）。どの古い収縮も上抜けの日をまたがないが、歩みが上抜けの前で終わるので、最後の収縮か基準が変わった。
    - 8 行は、前の基準が上抜けの後にあり、収縮が 0 だった（LIND 型で収縮なし）。
    - DE は、上抜け（11/9）の前の押し 11/5〜11/6 −4.2% が最後の収縮として数えられた。前は歩みが上抜けの後まで進んだので、反転の幅が要った。
    - 4 行が新しく表示（DE、LFST、FET、RDWR）、**表示から外れた行は 0**。
  - 切れ目の無い 310 行：表示→表示 66、非表示→非表示 244（変化なし）。
- `base.brokeOut` が変わった行は **181**。すべて基準（startDate か high）が動いた行。同じ基準で brokeOut や土台が変わった行は **0**。base.* を上書きしていないため。
  - LIND 型では、基準が上抜けの前の高値に動き、その後の上昇がそれを上回る。同じ定義を新しい基準にあてた結果。
  - footprint().brokeOut が変わった表示中の行 166 のうち、128 は基準の移動。残りの 38 は、行が表示に入る・外れる（footprint が null になる・現れる）だけ。
- 構造の損切り（`structuralStop`、買値は終値がピボット以上なら終値、でなければピボットの近似）の変化 190 行の内訳（前→後の state）：unknown→tooDeep 67、unknown→ok 32、ok→unknown 27、tooDeep→unknown 18、ok→ok 12、tooDeep→tooDeep 10、ok→tooDeep 7、tooDeep→ok 7、unknown→unknown 6、unknown→overLimit 3、overLimit→unknown 1。
  - 後で unknown になった理由は、すべて「収縮を測定できません」（52）。
  - 状態 cut 以外の行での変化は 0。
- **直らない行（pivotBar が null、状態 unknown）**：86 行。
  - 76 は `se_pivot_price` が無い。76 行すべてで、rows.jsonl の `pivot` に `pivot_date` が残り `extended_from_pivot` が true、再計算は calculated（実測、`$T/r6` の python の集計）。つまり ±25% の規則が消した行で、元からピボットが無い行は 0。
  - 10 は、高値がピボットとセントで一致する足が無い（STEP 0 の H1 で数えた 10 行）。
  - 表示中は 12 で、すべてピボットの値が無い行：CDNA、CHYM、ABNB、HAS、AIRT、ARL、CIX、CRCT、JAKK、PERI、SOPH、TLS。どれも `extended_from_pivot` true。収縮は切っていない。
  - 再構築の行にはピボットの値が無いので、上抜けの後の収縮を持つかどうかは判定できない（**未検証**）。ゆるい探し方（調べの方法）でも 0 行しか分類できない。

### 6 銘柄の前と後（再現スナップショット）

| 銘柄 | ピボットの足 → 上抜けの足 | 前（b80ab95e） | 後（196c880） |
|---|---|---|---|
| HUM | 10/13 → 11/11 | 表示。「VCP 5週 13/4 2T」。T1 10/09〜11/02 −12.5%、**T2 11/11〜11/12 −3.7%**。構造の安値 434.09（ok） | 非表示。T1 10/09〜11/02 −12.5%、T2 11/09〜11/10 −5.8%（無効：最後の短い区間）。構造は unknown |
| LIND | 8/17 → 10/01 | 表示。「VCP 1週 21/6 2T」。土台 11/02（上抜けの後）、**T1 11/02〜11/04 −21.3%、T2 11/10〜11/12 −6.0%**。構造の安値 30.57（tooDeep） | 非表示。土台 8/14 の 35.00（brokeOut true）、T1 8/14〜9/10 −30.5% の 1 つ。構造は unknown |
| ADI | 10/13 → 10/27 | 表示。「収縮 20週 22/18 4T（縮小途切れ）」。T3 10/29〜10/30 −6.3%、T4 11/02〜11/06 −18.2% が上抜けの後。構造の安値 354.72（tooDeep） | 表示。「VCP 20週 22/10 2T」。T1 6/22〜9/03 −21.9%、T2 10/06〜10/23 −9.6%。構造の安値 382（ok） |
| RDNT | 9/21 → 11/04 | 表示。「VCP 1週 11/6 2T」。土台 11/05（上抜けの後）、T1・T2 とも 11/05 以後 | 表示。「VCP 7週 17/3 2T・土台の高値を上抜け（11/4）」。T1 9/15〜10/08 −16.9%、T2 11/02〜11/03 −3.1% |
| CFBK | 9/22 → 11/02（11/06 に再び上抜け） | 表示。「VCP 8週 13/7 2T」。**T2 11/04〜11/05 −7.5% はブレイク失敗の下げ** | 非表示。T1 9/14〜10/15 −12.6% の 1 つ |
| CTKB | 10/15 → 10/21 | 表示。「VCP 2週 16/9 2T」。土台 10/29（上抜けの後）、T1・T2 とも 10/29 以後 | 非表示。土台 10/06（brokeOut true）、T1 10/06〜10/08 −18.7% の 1 つ |

### フィクスチャとオラクル（チャート、規則 16）

- priceChart.js は変えていない。チャートは収縮を描くので、収縮が変わる行のチャートは変わる。
- 既定のフィクスチャ 30 行は、どれも `se_pivot_date` を持たない。だから状態はすべて unknown で、収縮と土台は前と同じ（実測、`$T/r6/fixture30.mjs`：30 行、diff 0）。**492 枚の probe はバイト単位で同じはず**。probe は走らせていない（P3、未検証）。
- オラクル 8 行（実測、`$T/r6/oracles.mjs`）。
  - ZZRL・ZZRW・ZZRD・ZZPM・ZZQF は unknown で、変わらない。
  - ZZNR は none（10/01 のピボットの足の後、まだ上で引けていない）。変わらない。
  - ZZPG は cut（9/23 → 9/30）。収縮はギャップ（8/27）の前に終わるので、変わらない。brief-oracles.spec.js の ZZPG の検査（3 つの収縮、brokeOut、ギャップの日）はそのまま。
  - **ZZHB だけが変わる**。cut は 9/22 → 9/28、measuredThrough 9/25。
    - 前：T1 4/28〜6/17 −23.3% の 1 つで、無効（描かれない）。
    - 後：T1 と、取っ手の T2 9/22〜9/25 48.50→46.64 −3.8% の 2 つで、有効（描かれる）。
  - だから、オラクルの probe で予想される差は **ZZHB の画面だけ**。
    - チャートの範囲に収縮が入る期間では、収縮の枠 2 つと 「T1」「−23%」「T2 −4%」 のラベル、aria の 「値幅の収縮 23%→4%」 が増える。
    - VCP カードは 「VCP 未確認」 から footprint の文に変わる。
    - 試算の構造の安値は T2 の 46.64（ピボット 48.50 の下）になる。
    - どの期間・幅で変わるかは描いて確かめていない（P3 で probe、未検証）。
  - ZZHB の緑の矢印（9/28）は上抜けの読み取りなので、変わらない。下の Playwright で確かめた。

### 準備（規則 19）

- 準備・選定・トレンドテンプレート・結論のゲートは、VCP の証拠を読まない。証拠を読むのは StockVcpCard.jsx、StockView.jsx、briefChartModel.js、positionSizing.js、useBriefData.js、LeaderEvidenceChart.jsx だけ（`grep -rln "measurementsValid\|depthsContract\|vcp\.legs\|vcp?\.\|book_technical_evidence\|buildBookTechnicalEvidence" frontend/src/static`、テストを除く）。
- バックエンドのファイルは変えていないので、H4（908 件の準備、バックエンドの probe）の表は R3b の記録のまま。準備は変わらない。だから規則 19 はあたらない。

### 直していないもの

- ピボットの足が null の行（上の 86。表示中の 12 はピボットの値が ±25% の規則で消えた行）。
- レビュー担当者の区間（そのまま。`pivotCut` は参考）。
- 土台の高値が上回られていない行（HUM 型）では、footprint の週数が最後の足まで数える（briefChartModel.js は持ち物でない）。
- VCP カードには収縮 1 つのための文が無い（2 つ未満は 「測定できる収縮が2回以上ないため、VCPは未確認です。」）。0 とも 「浅く」 とも言わないので誤りではない。
- 切れ目の直前の無効な短い区間（HUM・TW・MCBS・PANL・KOF・NTRS。影響のある表示中の行で 6）。直すと「切った日足と同じ」が崩れる。
- 構造の損切りが上抜けの後の収縮の安値をとらないことは、自動の測定ではこのパッケージで成り立つ（76 → 0）。レビューの区間の道と、positionSizing.js 自身の守りは次のパッケージ（R6-P2）。

### 統合への依頼（R6）

1. **CHART**：StockChartCard.test.jsx:143 の版の文字列（上の「版の更新」）。直すまで全部の vitest でこの 1 本が落ちる。
2. **統合（チャート）**：HUM 型の footprint の週数は、`vcp.pivotCut.measuredThrough` で止めるのが筋（briefChartModel.js）。VCP カードの収縮 1 つの文（調べの案 「収縮は1回のみ（縮小は判定できません・独自算出）」）も。どちらも CHART の持ち物。
3. **CONTEXT.md の語彙（統合で）**：**上抜けの足（pivot breakout bar）**：ピボットの足より後で、終値がピボットのセントを初めて上回った足。自動の収縮はその前の日（measuredThrough）までの日足で測る。
4. **規則 16**：オラクルの probe の予想される差は ZZHB だけ（上）。492 枚は同じのはず。P3 で確かめる。
5. **R（バックエンド、R3c の続き）**：readiness.py の `contraction_unconfirmed`（R3c）は、bookTechnicalEvidence.js の自動測定を Python に移したもので、R6 の切れ目を持たない。だから状態 cut の行では、診断（エンジン自身の日足で測る）とブリーフの 「収縮は未確認」 が食い違いうる。診断は準備にも failed_checks にも効かない（R3c の規則）。このパッケージはバックエンドを触れないので、R6 の切れ目を readiness.py に移すかどうかは指揮者の判断を求める。食い違う行の数は数えていない（未検証）。

### 実測（R6。コマンドと結果。時刻は日本時間。負荷のもとの数はすべて参考）

`S=/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad`、`T=$S/audit3/r3-verdict`、`H=$S/audit3/r3-harness`、`W=/home/user/screener/.claude/worktrees/r3-verdict`。環境は `PATH=/opt/node22/bin:$PATH`、`SESSION_CALENDAR_PYTHON=$S/audit/r1-step0/cal-venv/bin/python`、`FINANCIAL_REPLAY_PYTHON=$S/replay-venv/bin/python`、`FONTCONFIG_FILE=$S/ci-fonts/fonts.conf`。

| 検査 | コマンド | 結果 | 負荷（前 → 後） |
|---|---|---|---|
| 注文の vitest | `cd $W/frontend && npx vitest run src/static/bookTechnicalEvidencePivot.test.js src/static/bookTechnicalEvidence.test.js src/static/brief/positionSizing.test.js src/static/brief/StockView.test.jsx src/static/brief/StockChartCard.test.jsx src/static/brief/StockVcpCard.test.jsx src/static/brief/breakoutHistory.test.js tools/export-research-order.test.mjs tools/scan-list-payload.test.mjs`（`$T/r6/acceptance-vitest.out`。注文のパスはすべてある） | 9 ファイル・138 本：**137 通過・1 失敗**。失敗は StockChartCard.test.jsx の「names the contraction marks only when they are drawn…」（版の文字列。上の CHART への依頼）。既存の bookTechnicalEvidence.test.js の 22 本は変更なしで通過、新しい bookTechnicalEvidencePivot.test.js は 14 本 | 3.04 → — |
| 失敗の原因 | 定数を一時的に v2 に戻して `npx vitest run src/static/brief/StockChartCard.test.jsx`、元に戻して `cmp` | 16 本すべて通過。元に戻したことを cmp で確認 | — |
| 改変テスト A | `contractions()` で切れ目を一時的に無効にした（どの状態も unknown として扱う）。最後のテストのファイル（b141086）で取り直した。`$T/r6/mutation-A.out` | **6 本が落ちた**：HUM、LIND、切った日足との一致、CFBK（注文の 1〜4）、収縮 1 つ・0、Setup Engine の土台。ほかの 8 本と既存の 22 本は通った | — |
| 改変テスト B | `setupBase` の基準の条件 `anchor < limit - 1` を一時的に `anchor < limit` にした。`$T/r6/mutation-B.out` | Setup Engine の土台のテストだけが落ちた（基準が c − 1 の場合）。A・B とも、元に戻したことを cmp と `git diff --quiet HEAD` で確認 | — |
| 素の Node | `cd $W/frontend && node -e "import('./src/static/bookTechnicalEvidence.js').then(m=>console.log(m.BOOK_TECHNICAL_VERSION, typeof m.pivotBreakout))"` | `book-technical-evidence-v3 function` | — |
| eslint | `cd $W/frontend && npx eslint src/static/bookTechnicalEvidence.js src/static/bookTechnicalEvidence.test.js src/static/bookTechnicalEvidencePivot.test.js` | エラー 0・警告 0 | — |
| lint | `cd $W/frontend && npm run lint` | エラー 0、警告 4（土台と同じ 4 つ） | — |
| 全部の vitest | `cd $W/frontend && npx vitest run`（196c880、22:31–22:35、237 秒、`$T/r6/vitest-full-196c880.out`） | 249 ファイル・4,048 本：**4,047 通過・1 失敗**（上と同じ StockChartCard.test.jsx の 1 本）。R-P5 の 4,034 ＋ 新しい 14 本 | 2.29 → 5.29 |
| Playwright（R の 8 ファイル） | `cd $W/frontend && AUDIT_PORT=4423 AUDIT_MATCH='brief-(oracles\|sell\|invariants\|watch\|decision\|plan\|compact\|phone)\.spec\.js' npx playwright test -c $T/pw.config.mjs`（196c880、22:20–22:31、10.8 分、`$T/r6/pw-196c880.out`） | 236 本：**235 通過・1 skip**（R-P5 と同じ skip：brief-invariants.spec.js の `test.fixme('INTEGRATION: …')`）。brief-oracles.spec.js は全部通過（ZZHB の緑の矢印、ZZPG の 3 つの収縮、R1・R2）。brief-compact・brief-phone も通過。やり直しは無し | 2.93 → 2.89（途中で 8.6） |
| 所有の検査 | `python3 -I $S/audit3/check-ownership.py R $W 45603f065f054cd48c812a3003f3a71ffd91cf45` | コードのコミットの前に `OWNERSHIP OK (R): 45 paths` | — |
| 触らない場所 | `git -C $W diff --stat b80ab95e -- backend frontend/tools frontend/tests frontend/src/static/brief` | 出力は空 | — |
| 再構築の数 | `node $T/r6/tally.mjs …`（上の「再構築での数」） | 上の表 | 1.51 → 3.00 |
| ビルド（規則 21） | `$H/build/run-build.sh $W`（b141086、11-16 07:39–07:40、`$H/build/build-b141086.json`） | 入口のチャンク **132.06 kB gzip**（raw 377.60）。b80ab95（R-P5 の後）の 131.72 から **＋0.34**。R の累計は STEP 0 の 130.28 から ＋1.78。線 134.00 まで 1.94 | 0.13 → 0.80 |
| フィクスチャ・オラクル | `node $T/r6/fixture30.mjs`、`node $T/r6/oracles.mjs` | 既定の 30 行は diff 0、オラクルは ZZHB だけが変わる（上） | — |

- 時間は一つも測っていない（このパッケージに時間の検査は無い）。

### 未検証（R6）

- 公開版での数と表示（すべて再構築の数）。
- 492 枚の probe・dump・オラクルの probe（P3）。予想は、492 枚と dump はバイト単位で同じ、オラクルの probe は ZZHB の画面だけ変わる（上）。
- 実データの株の画面での、収縮が増える・減るときのチャートのラベルの重なり（HUM・LIND・ADI・RDNT など）。priceChart.js は変えていないが、描く収縮の数と場所が変わる。
- ピボットの値が消された表示中の 12 行が、上抜けの後の収縮を持つかどうか。
- 詳細のファイルの大きさ：`vcp.pivotCut` と `limitations` の 1 行で、詳細 1 つあたり数百バイト増える。公開の大きさへの効きは測っていない（インデックスには入らない。export-research.mjs:225 が book_technical_evidence を外す）。

### パッケージ R6-P1 の記録

- コミット（どれも所有の検査 OWNERSHIP OK の後）：
  - 196c880 `fix(frontend): measure contractions only before the pivot's breakout`（bookTechnicalEvidence.js と、新しい bookTechnicalEvidencePivot.test.js）
  - c0729bd `docs(round3): record R6 (contractions end at the breakout)`
  - b141086 `test(frontend): pin the Setup Engine anchor bound at the breakout bar`（Setup Engine の基準が c − 1 になる場合のテスト。改変テスト B で効くことを確かめた）
  - この追記（`docs(round3): add R6's build size, mutation checks and the backend port request`）
- テストは注文の 1〜11 を、新しいファイル bookTechnicalEvidencePivot.test.js の 14 本に入れた（形はそのファイルの中で作る。brief-fixture.js とオラクルは読み込まない）。既存の bookTechnicalEvidence.test.js は変えていない。
- 注文と違えたところ：
  - 「vcp の主パターン」の unknown は、日付の無い vcp の行で確かめた。pivotBar の表では vcp は日足の型なので、日付を付けると足が見つかる。vcp_wrapper.py は pivot_date を出さないので、実際の vcp の行は日付を持たない。
  - 「収縮 0」の形は、ピボットの足まで滑らかに上がり、次の足で上抜ける形にした（上抜けの前に確かめられた高値が無いので、基準も収縮も無い）。注文の括弧書き（「基準がその直前」）どおりの形では、ジグザグがピボットの足を基準として確かめられず、Setup Engine の土台も c − 1 より前に限るので、収縮 0 にならない。収縮 1 の形は、収縮 1 つの後にピボットの足、次の足で上抜けにした。
  - 土台の準備完了 30 行は c61bf96 の組で数え、このブランチの d5b3e42 の組（19 行）も並べた。d5b3e42 の準備完了は R3b などで 26 行（CI と同じ日足は 19）に変わっているため。
- 片づけ：このパッケージが作ったハーネスの出力はビルドの b141086 だけ（json、trees/b141086、npm-build-b141086）。R-P5 の d5b3e42 のビルドは R5 の記録が参照するので消していない。probe・dump・スナップショットは作っていない。スクラッチの `$T/r6/before`（b80ab95e の frontend/src と frontend/contracts、6 MB）と束は、指揮者の確認のために残した。

## R6（続き）. 構造の損切りは上抜けの後の収縮の安値をとらない（パッケージ R6-P2）

P1 の後、自動の収縮（v3）は上抜けの足をまたがない。だからこれは主な直しではなく守り。P1 が測り直さない証拠、つまりレビュー担当者の区間や、ほかの方法で測った脚を持つ証拠にも効く。前の structuralStop は「ピボットより下の最後の脚」をとった。上抜けの後にピボットを割った押しも、そのまま損切りの安値になった（HUM：11/12 の 434.09、ピボット 442.99、state ok、損切り 431.92）。

### 規則（positionSizing.js の structuralStop。独自判定。新しいしきい値は無い）

- 引数 `breakoutDate = null`（ISO の日）を足した。
  - positionPlan（呼び出しはここだけ）は `pivotBreakout(judged, view.row).breakoutDate` を渡す。P1 の関数（bookTechnicalEvidence.js）なので、測定と損切りで切れ目の定義は一つ。`pivotDate` は今のまま pivotBar から渡す。
  - 読み込みの循環は無い。bookTechnicalEvidence.js が読むのは qualificationAudit.js（evidenceTime.js だけを読む）と brief/pivotBar.js（何も読まない）だけ。
- breakoutDate が ISO の日なら、終わりがその日かその後の脚は候補にしない。
  - 脚の終わりは、endDate が ISO の日ならそれ、でなければ lowDate。
  - どちらも ISO の日でない脚は日付で比べられないので外さない。選ばれれば、日足との照合で 「収縮の測定日が日足と不一致」 になる（今と同じ）。
- 残った脚から今と同じ選び方をする：ピボットより下の最後の脚。
- 全部の脚が外れたら unknown（low・lowDate・stop・percent は null）。理由は新しく書き出した定数 `POST_BREAKOUT_LEGS_REASON`：「収縮はすべてピボットの上抜けの後の値動き」。
- 残った脚がすべてピボット以上なら、今の理由 「最後の収縮がピボットより上（上抜け後の押し）」 のまま。外れた脚の安値はとらない。
- 固定の％にも 0 にもしない。unknown は理由を言う。
- breakoutDate が null・undefined・形の悪い値なら、何も外さず今と同じ結果（テスト 4 で toEqual）。

### 検査の順番と R2(b)

- 今の検査は、すべて同じ順番で残した。外す脚（kept）は脚を選ぶところで決め、結論は R2(b) の後に出す。
  1. 今の選び方（全部の脚から）でピボットより下の脚が無ければ、今と同じ場所で unknown。理由は、全部外れていれば新しい理由、そうでなければ今の理由。
  2. 測定日・日足との照合・R2(b)（previousBaseReason）は、今と同じ脚で今と同じに行う。
  3. その後で、残った脚から選び直す。無ければ unknown（全部外れた → 新しい理由、残ったが全部ピボット以上 → 今の理由）。選び直した脚が今の脚と違えば、その脚も日足と照合する。
- だから、breakoutDate 無しの呼び出しが 前の土台（R2(b)）か 「収縮の測定日が日足と不一致」 を返す入力では、breakoutDate があっても同じものを返す。**R2(b) が勝つ**。テスト 5 で 3 つの場合を確かめた：一部が外れる、全部が外れる、残った脚がピボット以上。
- 二つの規則が同時に当たるのは、手で作った証拠だけ。
  - 自動の脚は土台の上抜けの前に終わる。土台がピボットの足より前に上抜けていれば、脚はすべてピボットの足より前に終わるので、新しい規則では外れない。
  - レビュー担当者の区間の証拠は base を持たないので、R2(b) は当たらない。
- 注文は「脚を選ぶところに置く」。外す脚はそこで決めるが、結論は R2(b) の後に出した。注文のもう一つの文 「R2(b) はそのまま、前に当たったところでは勝つ」 を、全部の入力で守るため。結論を脚を選ぶところで出す形（改変テスト C）では、全部が外れる場合に新しい理由が前の土台に勝ち、テスト 5 が落ちる。

### 文言と規則 18

- 新しい理由は 20 字。StockPlanCard.jsx（読んだだけで、変えていない）は unknown を 「構造上の損切り目安：収縮の安値 未確認」 に続けて、同じ行に 「（理由）」 として出す（`.brief-structural.is-unknown` は inline）。だから 320px では、どの理由も 1 行に入らない（今の 22 字の理由も同じ）。入れ子の括弧は避けた。
- この理由が出る画面は、フィクスチャにも再構築にも無い（下の数で 0 行）。描いて確かめていない（未検証）。
- 新しいレコードのキー・警告コード・インデックスの欄は無い（理由は画面の側で計算する）。規則 18 は当たらない。

### テスト（新しいファイル positionSizingBreakout.test.js の 6 本）

- positionSizing.test.js は変えていない（`git diff 05488ef8 -- frontend/src/static/brief/positionSizing.test.js` は空）。既存の 28 本は配線の直後にも、そのまま通った。
- 形はファイルの中で作る。HUM の形は bookTechnicalEvidencePivot.test.js と同じ作り方（ピボットの足 → 上抜け → ピボットを割る押し）。
1. HUM の形を、レビュー担当者の区間で測る。T1 は取っ手（上抜けの前）、T2 は上抜けの後の押し。どちらの安値もピボットより下。breakoutDate ありでは T1 の low・lowDate、なしでは T2（前の振る舞い）。null でもなしと同じ。
2. 全部の脚が上抜けの日かその後に終わる → toEqual unknown（POST_BREAKOUT_LEGS_REASON）。全部ピボット以上で全部外れても同じ理由。残った脚がピボット以上なら今の理由。外れた脚だけがピボットより下でも今の理由。
3. 上抜けの日に終わる脚は外れ、その前の日に終わる脚は残る。lowDate が前でも endDate が上抜けの日なら外れる（endDate と lowDate が分かれる場合）。endDate が無い脚、ISO の日でない脚は lowDate で比べる。選び直した脚も日足と照合する。
4. breakoutDate が null・undefined・'bad'・'2026-3-1'・数・Date のとき、ok・tooDeep・above・ピボットより上の 4 つの形で、引数なしと toEqual。
5. R2(b) が勝つ（上の 3 つの場合）。測定日の不一致も同じ場所に残る。
6. positionPlan の配線。HUM の形の日足と、se_pattern_primary・se_pivot_date・se_pivot_price を持つ行を使う。
   - P1 の証拠（buildBookTechnicalEvidence）に、上抜けの後の押しの脚を手で足す。plan.structural は、breakoutDate = pivotBreakout(judged, row).breakoutDate の structuralStop と等しい。安値は押しの安値ではない（breakoutDate なしでは押しの安値）。
   - P1 の証拠そのままでは、measurementsValid true、全部の脚が切れ目の前に終わる、state ok。守りのありなしで同じ。
- 理由の文はすべて作り手から読む：新しい理由は定数、今の理由は structuralStop の呼び出しから。

### 改変テスト（実測）

- どれも `cp` で控え、`cmp` で戻したことを確かめた。
- A：除外をやめた（`const kept = legs;`）→ 1・2・3・6 が落ちた。4・5 と既存の 28 本は通った（`$T/r6/p2-mutation.out`）。
- B：positionPlan の配線を外した（`breakoutDate: null`）→ 6 だけが落ちた（`$T/r6/p2-mutation-B.out`）。
- C：今の脚を残った脚から選んだ（結論を脚を選ぶところで出す形）→ 5 だけが落ちた（`$T/r6/p2-mutation-C.out`）。

### 再構築での数（再現スナップショットの数、11-12。公開版の数ではない）

- 入力は P1 と同じ `$H/snapshot/out/d5b3e42`。新しいスナップショットは作っていない。
- 束：P1 の 2 つ（b80ab95e、196c880。196c880 の束は P1 の時に作ったものをそのまま使った）と、HEAD（d298e19）の新しい束 `$T/r6/p2-bundle`。89116e6 は注釈だけの違いで、束はバイト単位で同じ。
- 買値は P1 の数と同じ近似（終値がピボット以上なら終値、でなければピボット）。judged は certifyBars が certified のときだけ日足。HEAD の breakoutDate は positionPlan と同じ `pivotBreakout(judged, row).breakoutDate`。
- コマンド：`node $T/r6/tally-p2.mjs $H/snapshot/out/d5b3e42 $T/r6/before-bundle/bundle.mjs $T/r6/after-bundle/bundle.mjs $T/r6/p2-bundle/bundle.mjs $T/r6/tally-p2-d298e19.json $H/snapshot/out/c61bf96/counts.json`（→ `$T/r6/tally-p2-d298e19.out`）。

| 数（再構築の数） | 掲載 980 | TT 8/8 の 614 | 土台の準備完了 30 | このブランチの準備完了 19 |
|---|---|---|---|---|
| 構造の損切り（state・low・lowDate）が変わった行：b80ab95e → HEAD | 184 | 130 | 5 | 4 |
| そのうち P1 の測り直しで変わった行（b80ab95e → 196c880） | 184 | 130 | 5 | 4 |
| そのうち、この守りでさらに変わった行（196c880 → HEAD） | **0** | 0 | 0 | 0 |
| stop と reason も比べたとき（P1 の 190 の数え方）：P1 で / 守りで | 190 / 0 | 134 / 0 | 5 / 0 | 4 / 0 |
| 構造の安値が、上抜けの日以後に終わる脚から来る行：b80ab95e / 196c880 / HEAD | 76 / 0 / 0 | 46 / 0 / 0 | 4 / 0 / 0 | 3 / 0 / 0 |
| HEAD で理由が POST_BREAKOUT_LEGS_REASON の行 | 0 | 0 | 0 | 0 |
| 参考：b80ab95e の証拠に HEAD の structuralStop（守りつき）をあてて、変わった行（state・low・lowDate） | 76 | 46 | 4 | 3 |
| 同じく、上抜け後の脚から安値をとる行 | 76 → 0 | 46 → 0 | 4 → 0 | 3 → 0 |

- 守りが自動の証拠で何も変えないことは、ほかに 2 つの数で確かめた。
  - 196c880 と HEAD の証拠は、980 行すべてで同じ（深く等しい）。P2 は測定を変えていない。
  - HEAD の structuralStop に breakoutDate を渡さないと、980 行すべてで 196c880 と同じ結果。
- 「上抜け後の脚から」は 2 通りで数えた（安値の日が上抜けの日以後、脚の終わりが上抜けの日以後）。どちらも同じ数。
- 参考の行は、v2 の証拠に守りをあてた場合。画面は古い版の証拠を日足で測り直すので、実際にはこの道を通らない。守りが効くことを示すためだけの数。
  - 76 行の内訳。ok→unknown 25、tooDeep→unknown 15、overLimit→unknown 1。この 41 行は新しい理由になる。
  - ok→ok 10、ok→tooDeep 10、tooDeep→tooDeep 11、tooDeep→ok 4。この 35 行は、上抜けの前の脚の安値になる。
  - ほかに 14 行は、理由だけが変わる（「最後の収縮がピボットより上」 → 新しい理由。脚が全部ピボット以上で、全部上抜けの後）。
  - 切れ目の無い行（状態 unknown・none）での変化は 0。
- HUM と LIND（再構築の数）：

| 銘柄 | b80ab95e | 196c880（P1） | HEAD（P2） | 参考：v2 の証拠に守り |
|---|---|---|---|---|
| HUM（上抜け 11/11） | ok、安値 434.09（11/12、上抜けの後の押し）、損切り 431.92 | unknown（収縮を測定できません） | 同じ | tooDeep、安値 399.35（11/02、上抜けの前の T1） |
| LIND（上抜け 10/01） | tooDeep、安値 30.57（11/04、上抜けの後） | unknown（収縮を測定できません） | 同じ | unknown（新しい理由。2 つの脚とも上抜けの後） |

### フィクスチャとオラクル（チャート、規則 16）

- `node $T/r6/fixture-stops-p2.mjs`：既定の 30 行（状態はすべて unknown）とオラクル 8 行で、196c880 と HEAD の構造の損切りは同じ（diff 0）。
  - ZZHB は ok 46.64（9/25、切れ目 9/28 の前）。ZZPG は前の土台（8/27）のまま。
- だから、オラクルの probe と 492 枚の probe で予想される差は、P1 の差（ZZHB だけ）から増えない。この守りで変わる画面は無い。probe は走らせていない（未検証、P3）。

### 準備（規則 19）

- 準備・選定・トレンドテンプレート・結論のゲートは、構造の損切りを読まない。バックエンドのファイルは変えていない。H4 の表は R3b の記録のまま。規則 19 は当たらない。

### 実測（R6-P2。コマンドと結果。時刻は日本時間。負荷のもとの数はすべて参考）

環境は R6 と同じ（`PATH=/opt/node22/bin:$PATH`、`SESSION_CALENDAR_PYTHON`、`FINANCIAL_REPLAY_PYTHON`、`FONTCONFIG_FILE`）。

| 検査 | コマンド | 結果 | 負荷（前 → 後） |
|---|---|---|---|
| 既存のテスト（配線の直後） | `cd $W/frontend && npx vitest run src/static/brief/positionSizing.test.js` | 28 本すべて通過 | — |
| 注文の vitest | `cd $W/frontend && npx vitest run src/static/brief/positionSizing.test.js src/static/brief/positionSizingBreakout.test.js src/static/bookTechnicalEvidence.test.js src/static/bookTechnicalEvidencePivot.test.js src/static/brief/StockPlanCard.test.jsx src/static/brief/StockView.test.jsx src/static/brief/buyGate.test.js`（注文のパスはすべてある。新しいファイルと P1 のファイルを足した。`$T/r6/p2-acceptance-vitest.out`） | 7 ファイル・119 本すべて通過 | — |
| 改変テスト A・B・C | 上 | 上 | — |
| eslint | `cd $W/frontend && npx eslint src/static/brief/positionSizing.js src/static/brief/positionSizing.test.js src/static/brief/positionSizingBreakout.test.js` | エラー 0・警告 0 | — |
| Playwright（plan と oracles、CI と同じ） | `cd $W/frontend && FONTCONFIG_FILE=$S/ci-fonts/fonts.conf AUDIT_PORT=4423 AUDIT_MATCH='brief-(oracles\|plan)\.spec\.js' npx playwright test -c $T/pw.config.mjs`（d298e19、07:52–07:56、3.9 分、`$T/r6/pw-p2-d298e19.out`。89116e6 との差は注釈だけ：Node の束がバイト単位で同じ） | 59 本すべて通過。skip 0、やり直し 0。ZZPG の R2 と、plan のカードの構造の損切りの検査を含む。brief-oracles.spec.js の `test.fixme(` は 0（3 行目の注釈の中の文字だけ）で、このパッケージでは変えていない（基準との差は R1・R2 の 2 つの切り替えだけ） | 0.27 → 1.88 |
| 全部の vitest | `cd $W/frontend && npx vitest run`（89116e6、07:57–08:01、3 分 50 秒、`$T/r6/vitest-full-89116e6.out`） | 250 ファイル・4,054 本：**4,053 通過・1 失敗**。失敗は P1 と同じ StockChartCard.test.jsx の版の文字列の 1 本（P1 の統合への依頼 1）。P1 の 4,048 本 ＋ 新しい 6 本 | 0.96 → 5.47 |
| ビルド（規則 21） | `$H/build/run-build.sh $W`（89116e6、08:01、`$H/build/build-89116e6.json`） | 入口のチャンク **132.23 kB gzip**（raw 378.01）。b141086（P1）の 132.06 から **＋0.17**。R の累計は STEP 0 の 130.28 から ＋1.95。線 134.00 まで 1.77 | 4.63 → 3.50 |
| 所有の検査 | `python3 -I $S/audit3/check-ownership.py R $W 45603f065f054cd48c812a3003f3a71ffd91cf45` | d298e19・89116e6・この記録の前に `OWNERSHIP OK (R): 46 paths` | — |
| 再構築の数 | `node $T/r6/tally-p2.mjs …`（上） | 上の表 | 0.37 → 0.42 |
| フィクスチャ・オラクル | `node $T/r6/fixture-stops-p2.mjs` | diff 0（上） | — |
| 触らない場所 | `git -C $W diff --stat 05488ef8 -- backend frontend/tools frontend/tests frontend/src/static/bookTechnicalEvidence.js frontend/src/static/brief/StockPlanCard.jsx frontend/src/static/brief/buyGate.js frontend/src/static/brief/briefSell.js frontend/src/static/brief/breakoutHistory.js frontend/src/static/brief/pivotBar.js` | 出力は空 | — |

- 時間は一つも測っていない（このパッケージに時間の検査は無い）。

### 未検証（R6-P2）

- 新しい理由が出る画面（StockPlanCard の 320px での折り返し）。この理由になる行は、フィクスチャにも再構築にも無い。
- レビュー担当者の区間を持つ行での数（再構築の行には区間が無い）。
- 公開版での数（すべて再構築の数）。
- オラクルの probe と 492 枚の probe（P3）。予想は P1 のまま（ZZHB だけ）。

### 統合への依頼（R6-P2）

- コードの依頼は無い。breakoutHistory.js に継ぎ目は要らなかった（pivotBreakout が切れ目を一つで持つ）。
- P1 の依頼はそのまま（StockChartCard.test.jsx:143 の版の文字列、footprint の週数、CONTEXT.md の 「上抜けの足」、規則 16 の probe、readiness.py）。全部の vitest の 1 本の失敗は、P1 の依頼 1 のもの。

### パッケージ R6-P2 の記録

- コミット（どれも所有の検査 OWNERSHIP OK の後）：
  - d298e19 `fix(frontend): keep the structural stop off post-breakout contractions`（positionSizing.js と、新しい positionSizingBreakout.test.js）
  - 89116e6 `docs(frontend): state where the structural stop's breakout guard sits`（positionSizing.js の注釈だけ。Node の束がバイト単位で同じことを cmp で確かめた）
  - この記録（`docs(round3): record R6-P2 (the structural stop's breakout guard)`）
- 注文と違えたところ：
  - テストは positionSizing.test.js ではなく、新しいファイル positionSizingBreakout.test.js に入れた（注文が許す positionSizing*.test.js）。既存のファイルを一字も変えないことを、diff の空で示せるため。
  - 結論を出す場所は R2(b) の後（上の 「検査の順番と R2(b)」）。
  - 注文の呼び出し名 computePlan は、実際には positionPlan。
  - 理由の文は注文の例（「収縮は上抜け後の値動きのみ（収縮には数えません）」、24 字）より短くし、入れ子の括弧を避けた。
- 片づけ：このパッケージのハーネスの出力はビルドの 89116e6 だけ（json、trees/89116e6、npm-build-89116e6）。古くなった P1 の b141086 の trees と npm-build は消した（json とログは P1 の記録が引くので残した）。スクラッチの束 `$T/r6/p2-bundle`、`tally-p2.mjs`、`fixture-stops-p2.mjs`、改変テストの出力は、指揮者の確認のために残した。probe・dump・スナップショットは作っていない。

## R6（記録）. ゲートと再構築の数（パッケージ R6-P3）

このパッケージはコードを変えない。変えたのはこの記録（docs/round3/verdict.md）だけ。

- 測った HEAD は **ed945a9**（R6-P1・P2 のコミットと P2 の記録の後）。コードは 89116e6 と同じ（`git -C $W diff --stat 89116e6 ed945a9 -- frontend backend` は空）。
- この記録のコミットで HEAD は動く。差は verdict.md だけ（下の「パッケージ R6-P3 の記録」）。
- 「前」は b80ab95e（R5 の後、R6 の前）、「後」は ed945a9。
- Node で読む束（実測）。
  - HEAD の束 `$T/r6/p3-bundle` は、P2 の束 `$T/r6/p2-bundle`（d298e19）と entry のパスの注釈 1 行だけが違う（diff）。P1・P2 の数を同じコードで取り直したことになる。
  - 前の束は P1 の `$T/r6/before-bundle`（`git archive b80ab95e`）。

### 予想した差（規則 16。ブラウザを一度も走らせる前に書いた）

- 方法：`node $T/r6/p3-expected.mjs`（→ `$T/r6/p3-expected.json`、メモ `$T/r6/p3-expected-diff.md`）。
  - フィクスチャ（brief-fixture.js）は読むだけ。
  - 各行で `pivotBreakout(bars,row).state` を出し、アプリがチャートに渡すものを前と後で比べた。比べたのは、収縮、`legsValid`、`dryUpLeg`、構造の損切り（`breakoutDate` は positionPlan と同じ）。
  - 期間ごとに、priceChart.js が収縮から読むものを、そのコードの式どおりに計算した。収縮の枠（`firstOnOrAfter`・`lastOnOrBefore`）、安値を結ぶ線、買いゾーンの帯の始まり、出来高の枯渇の括弧（`b − a > 3`）、aria、「収縮は未確認」 の注記、構造の安値。
- **既定の 30 行**：状態はすべて unknown（30/30）。`se_pivot_date` を持つ行は 0。チャートへの入力は 30/30 で前と同じ。
  - だから予想は、**492 枚の probe と dump はバイト単位で同じ**。
- **オラクル 8 行**

| オラクル | 状態（ピボットの足 → 上抜けの足） | 収縮 | チャートの入力 |
|---|---|---|---|
| ZZRL・ZZRW・ZZRD・ZZPM・ZZQF | unknown | 同じ | 同じ |
| ZZNR | none（10/01、まだ上で引けていない） | 同じ | 同じ |
| ZZPG | cut（9/23 → 9/30） | 同じ。T1〜T3 は 5/05・6/17・8/25 に終わる | 同じ（構造は前の土台 8/27 のまま） |
| **ZZHB** | cut（9/22 → 9/28、measuredThrough 9/25） | 前：T1 4/28〜6/17 −23.3% の 1 つで無効（描かれない）。後：T1 と T2 9/22〜9/25 48.50→46.64 −3.8%、有効 | **変わる**。構造は unknown（収縮を測定できません）→ ok 46.64（9/25） |

- ZZHB の損切りの線は 46.50 のまま。`stopSource` は 'setting' で、構造の損切りは選んだ銘柄だけ。価格の目盛り（ピボット・上限・損切り）も変わらない。だからローソク足・移動平均・出来高は変わらない。
- **予想した差の範囲**：ZZHB のラベルの 16 枚と値の 16 枚（3m・6m・1y・週足 × 320・375・390・1440）だけ。ZZRL の暗色の画面を含め、ほかはすべて同じ。
- ZZHB の期間ごとの予想（モデルから正確に）

| 期間 | 収縮の枠（窓の中の足の番号） | 安値を結ぶ線 | 買いゾーンの帯の始まり（足） | 出来高の枯渇 |
|---|---|---|---|---|
| 3m（07-02〜10-02） | T2 [56..59] だけ（T1 は窓の前の 6/17 に終わる） | なし（枠 1 つ） | 45 → 0 | なし（b − a = 3。4 以上が要る） |
| 6m（03-30〜10-02） | T1 [20..55]、T2 [121..124] | あり | 110 → 20 | なし（3） |
| 1y（2025-10-06〜） | T1 [140..175]、T2 [241..244] | あり | 230 → 140 | なし（3） |
| 週足（2025-08-29〜） | T1 [35..42]、T2 [56..56] | あり | 38 → 35 | なし（0） |

- どの期間・幅でも、次が変わると予想した。
  - aria：「、収縮は未確認」 → 「、値幅の収縮 23%→4%」。aria は全部の収縮を読むので、3m でも変わる。
  - 「収縮は未確認」 の注記は消える。
  - T のラベル：3m は T2 だけ（「T2」「−4%」 か 「T2 −4%」）。ほかは T1 と T2。
  - 構造の安値 46.64 の線（bc-structural、0.6 pw から）。320・375・390（幅 480 未満）では右の軸に 「安値」 のタグ。1440 では 「最後の収縮の安値 46.64」 の名前かタグ。
  - 凡例：「最後の収縮の安値 46.64」、「収縮の安値を結ぶ線」、「枠＝値幅の収縮」（1440）または 「枠＝収縮」（1024 未満）が増える。
  - 「出来高の枯渇」 はどの画面にも出ない。
- ラベルの置き場に任せたところ（ZZHB の画面の中だけで動いてよいとしたもの）
  - ほかのラベルの位置。
  - 右の軸のタグの積み重ね。損切り 46.50 と新しい 46.64 のタグが引き出し線で重なり、近くの目盛りの数字が消えうる。
  - 1024 未満の凡例の折りたたみ。
  - カードの高さ。

### 実際の差（実測）と予想との照合

- **492 枚の probe**：`probe-ed945a9.json` は `probe-8849bf9.json` と**バイト単位で同じ**（cmp。sha256 b5f29cff…39fa2）。
- **dump**：`dump-ed945a9.json` は `dump-8849bf9.json` と**バイト単位で同じ**（cmp。sha256 cba0a2f2…c3555）。
- **オラクルの probe**：`node $H/probe/diff.mjs $H/probe/probe-d5b3e42-oracles.json $H/probe/probe-ed945a9-oracles.json --texts`（→ `$T/r6/p3-oracle-diff.txt`）。
  - 基準の sha256 は 5df9eb3c…78db で、`probe-verify-b80ab95-oracles.json` と同じ。つまり b80ab95e の木。
  - 結果：**264 枚のうち 32 枚が違う。すべて ZZHB**（ラベル 16・値 16）。ページのエラーは 0 → 0。
  - ほかのオラクルの画面はすべて同じ。ZZRL の暗色も同じ。
- 予想どおりだったもの（32 枚すべてで確かめた）
  - 違う画面の組。
  - 期間ごとの枠：3m は T2 だけ、ほかは T1 と T2。
  - 安値を結ぶ線：3m は無く（`lows` は空）、ほかはある。
  - 買いゾーンの帯の始まり。1440 では x 594 → 0、726 → 132、789 → 481、562 → 518。足の番号 0・20・140・35 と一致する。
  - aria は 「収縮は未確認」 → 「値幅の収縮 23%→4%」 だけが違う（残りの文は同じ）。
  - 「収縮は未確認」 の注記が消える。
  - T のラベル：3m は 「T2 −4%」 か 「T2」「−4%」、ほかは T1 と T2。
  - 「安値」 のタグ：320・375・390 のすべて。1440 は 4 期間とも名前 「最後の収縮の安値 46.64」。
  - 凡例に 「最後の収縮の安値 46.64」 と 「枠＝値幅の収縮」／「枠＝収縮」 が増える。
  - 「出来高の枯渇」 は無い。
  - 32 枚すべてで、ローソク足・出来高・移動平均の線・目盛りの線・価格の目盛り・画面の大きさが同じ。
- 予想の範囲に入れていた種類の差（置き場・タグ・凡例で決まったもの）
  - 目盛りの数字が消えた：「45」（3m・6m の 320・375・390）と 「40」（1y の 320）。タグの積み重ねの近く。
  - 1024 未満の凡例の折りたたみ。
    - 3m では 「10日線」「21日EMA」 が見える凡例から外れた。
    - 多くの画面で 「損切り」 が外れた。損切りの線、「損切り −7.0%」 の名前、46.50 のタグはチャートに残る。
    - 320 では 「収縮の安値を結ぶ線」 が出ない。375 の週足では、それと 「枠＝収縮」 が出ない。
  - カードの高さ：390 の 6m・1y が 490 → 508。1440 の 3m が 664.75 → 684.75、6m が 685.94 → 705.94。
- **予想に書いていなかったもの（言い訳にせず報告する）**
  - ZZHB の 1y・320 で、150 日線の名前 「150」（bc-malabel-ma150）が出なくなった。
  - T1 −23%・T2 −4% と 「安値」 のタグが置き場をとった後、置き場がこの名前の場所を見つけられなかった。
  - priceChart.js の 「どこも空いていなければ出さない」 の振る舞いで、ほかの 31 枚では起きていない。
  - priceChart.js は持ち物でないので直していない。CHART・統合への依頼（下の 7）。

### オラクル以外のブラウザの検査（実測）

- brief-oracles.spec.js の次の検査は、そのまま通った（下の表の Playwright）。
  - ZZHB の緑の矢印（9/28）。
  - ZZPG の 3 つの収縮と前の土台。
  - ZZRD の 3 つの縮む収縮（producer から count 3・contracting true）。
  - R1・R2 の目標。
- ZZRD の footprint の文は、前も後も 「VCP 17週 18/5 3T」（モデルの出力、実測）。spec はこの文字列そのものではなく、producer の値を確かめる。
- ZZHB の VCP カードの文（モデルでは 「VCP 22週 23/4 2T」）と、試算の構造の安値 46.64 を、描いた画面で読む検査は無い（**未検証**。モデルの出力だけ）。

### 再構築での数（再現スナップショットの数、11-12。公開版の数ではない）

- 入力は `$H/snapshot/out/d5b3e42`。新しいスナップショットは作っていない。行は export-research.mjs と同じに作った（研究の行と、rows.jsonl の setup_engine からの se_candidates・se_explain）。
- コマンド：`node $T/r6/tally-p3.mjs $H/snapshot/out/d5b3e42 $T/r6/before-bundle/bundle.mjs $T/r6/p3-bundle/bundle.mjs $T/r6/tally-p3-ed945a9.json $H/snapshot/out/c61bf96/counts.json`（→ `$T/r6/tally-p3-ed945a9.out`、4 秒）。
- 構造の損切りは P1・P2 と同じ近似。
  - 買値は、終値がピボット以上なら終値、でなければピボット。
  - HEAD の `breakoutDate` は positionPlan と同じ `pivotBreakout(judged, row).breakoutDate`。
- 「土台の準備完了 30」 は P1 と同じ組（c61bf96 の準備完了で、CI と同じ日足の 30 行）。「このブランチの準備完了 19」 は d5b3e42 の組。

| 数（前 b80ab95e → 後 ed945a9。すべて再現スナップショットの数） | 掲載 980 | TT 8/8 の 614 | 土台の準備完了 30 | このブランチの準備完了 19 |
|---|---|---|---|---|
| pivotCut の状態 unknown / none / cut | 86 / 224 / 670 | 60 / 110 / 444 | 0 / 11 / 19 | 0 / 7 / 12 |
| 収縮を描く行（certified かつ measurementsValid） | 187 → 229 | 118 → 155 | 8 → 7 | 5 → 5 |
| 　外れた行 / 加わった行 | 52 / 94 | 35 / 72 | CFBK・CTKB / TRST | CFBK / TRST |
| 「押しが毎回浅くなっています」 の行（表示中で footprint().contracting === true） | 131 → 153 | 86 → 104 | 7 → 7 | 4 → 4 |
| 状態 cut の行で、上抜けの日かその後に終わる収縮がある行 | 304 → **0** | 208 → 0 | 5 → 0 | 4 → 0 |
| 　そのうち表示中 | 98 → **0** | 63 → 0 | 4 → 0 | 3 → 0 |
| 構造の損切り（state・low・lowDate）が変わった行 | 184 | 130 | 5 | 4 |
| 　stop と reason も比べたとき（P1 の 190 の数え方） | 190 | 134 | 5 | 4 |
| 　状態 cut 以外の行での変化 | 0 | 0 | 0 | 0 |
| 構造の安値が、上抜けの日かその後の脚から来る行 | 76 → **0** | 46 → 0 | 4 → 0 | 3 → 0 |
| 直らない行：pivotBar が null（状態 unknown） | 86 | 60 | 0 | 0 |
| 　そのうち収縮を描く行 | 12 | 9 | 0 | 0 |
| 状態 cut で、後の収縮が 1 つ / 0 | 222 / 8 | 155 / 4 | 11 / 2 | 5 / 2 |
| 　そのうち前は収縮が 2 つ以上（1 つになった / 0 になった） | 57 / 0 | 39 / 0 | 2 / 0 | 1 / 0 |
| 　そのうち前に収縮を描いていた行 | 46 | 32 | 2（CFBK・CTKB） | 1（CFBK） |
| 後で、深さが 0 以下の収縮を持つ行 / 収縮 2 つ未満から footprint が出る行 | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |

- 前と後の 「描く」「浅く」「損切り」 の数は P1（187 → 229、131 → 153）と P2（184、190、76 → 0）の数とすべて一致した。
- **構造の損切りの state の移り変わり**（state・low・lowDate が変わった行）

| 移り変わり | 掲載 980 | TT 8/8 の 614 | 土台の準備完了 30 | このブランチの準備完了 19 |
|---|---|---|---|---|
| unknown → tooDeep | 67 | 53 | 0 | 0 |
| unknown → ok | 32 | 25 | 1 | 1 |
| ok → unknown | 27 | 21 | 2 | 1 |
| tooDeep → unknown | 18 | 10 | 0 | 0 |
| ok → ok（安値が変わる） | 12 | 7 | 1 | 0 |
| tooDeep → tooDeep | 10 | 8 | 0 | 0 |
| ok → tooDeep | 7 | 2 | 0 | 1 |
| tooDeep → ok | 7 | 3 | 1 | 1 |
| unknown → overLimit | 3 | 1 | 0 | 0 |
| overLimit → unknown | 1 | 0 | 0 | 0 |
| 計 | 184 | 130 | 5 | 4 |

- 例（再現スナップショット）
  - HUM（上抜け 11/11）：前は ok、安値 434.09（11/12、上抜けの次の日の押し）、損切り 431.92。後は unknown（収縮を測定できません）。収縮は T1 10/09〜11/02 −12.5% と、無効な T2 11/09〜11/10 −5.8% で、描かない。
  - LIND（上抜け 10/01）：前は tooDeep、安値 30.57（11/04、上抜けの 1 か月後）。後は unknown（収縮を測定できません）。収縮は T1 8/14〜9/10 −30.5% の 1 つ。
  - ADI（準備完了 30 の 1 行）：前は tooDeep、安値 354.72（11/06、上抜けの後の T4）。後は ok、382（10/23、T2）。
- **直らない行（pivotBar が null）の原因**（pivotBar の検査の順：型 → 日付 → 値 → 一致する足）

| 原因 | 掲載 980 | うち描く | TT 8/8 の 614 | うち描く | 準備完了 30 |
|---|---|---|---|---|---|
| vcp の主パターン（日付が無い） | 0 | 0 | 0 | 0 | 0 |
| se_pivot_date が無い | 0 | 0 | 0 | 0 | 0 |
| se_pivot_price が無い（±25% の規則で消えた。P1 で確認） | 76 | 12 | 53 | 9 | 0 |
| 高値がピボットとセントで一致する足が無い | 10 | 0 | 7 | 0 | 0 |

  - 描く 12 行は CDNA、CHYM、ABNB、HAS、AIRT、ARL、CIX、CRCT、JAKK、PERI、SOPH、TLS（P1 と同じ）。
  - 掲載の行の主パターンは、cup_with_handle 902、nr7_inside_day 52、three_weeks_tight 22、high_tight_flag 4。vcp は 0。
- **収縮が 1 つ・0 の行**（状態 cut、後）
  - 230 行すべて（222 と 8）で、モデルの出力は次のとおりだった。だから VCP カードの道は 「VCP 未確認」 で、最後の収縮の出来高も 「未確認」。
    - `footprint()` が null。
    - `measurementsValid` false、`depthsContract` null、`volumeContracts` null。
    - 深さが 0 以下の収縮は無い。
    - 収縮 0 の行は `finalContractionVolume` も null。
  - 根拠は StockVcpCard.jsx:35-36（`print = footprint(...)`、print が無ければ dry も null）と :72-75（「VCP 未確認」 と 「測定できる収縮が2回以上ないため、VCPは未確認です。」）。
  - 0 も 「縮小」「浅く」 も言わない。数は 1 つの収縮を 1 つとして持つ（`legs.length` 1）。
  - 収縮 0 の 8 行はどれも `base` を持つ。土台の高値は確かめられたが、収縮が無い形。P1 のテストの 「基準も無い」 形とは別だが、どちらも footprint は null。
  - ほかに、状態 cut の 244 行（全体では 365 行）は、前も後も vcp が null。日足の検査（「日足の順序・重複・OHLCVに異常」）で測定しない行で、R6 では変わらない。
- **実データの描いた画面**（`$H/snapshot/run-render.sh`）は走らせていない。HEAD のスナップショット（約 300 MB）が要るため。実データのチャートは**未検証**。根拠はモデルの出力と、フィクスチャ・オラクルの probe。

### 古い公開版（規則「古い公開版は正直に描く」）

- 注文の予想は 「古い公開版には se_pivot_date が無いので、新しい UI は状態 unknown で測り直し、今と同じものを出す」 だった。**銘柄の画面ではそうならない**。
- 根拠（読んで確認、実測は再構築）
  1. 8849bf9 の export-research.mjs:226-229 は、行から book_* と sec_admission を除いたすべての欄を詳細に書く。
  2. 8849bf9 の再構築では、研究の行 5,955 のうち 4,421 が `se_pivot_date` を持つ（`$H/snapshot/out/8849bf9/serve/research.json`）。recalculate-setups.py が Setup Engine の値をすべて se_ を付けて書くため。R1 の前、インデックスには無かったが、詳細にはある。
  3. 銘柄の画面の行は `mergeFinancialDetail(summary, detail)`（financialCurrent.js:253、`{ ...detail, ...summary }`）。
  4. 公開された証拠は v2 なので、StockView.jsx:49-51 は v3 の測定で測り直す。
- だから、古い公開版でも、詳細が届いた後の銘柄の画面では pivotBreakout の切れ目がかかる。詳細が届くまでは 「VCP 未確認（読み込み中）」。
- 一覧・ウォッチの行（古いインデックスには se_pivot_date が無い）は収縮を描かないので、影響はない。
- 古い UI（v2）が v3 の証拠を受け取った場合は、P1 のとおり、自分のコードで測り直す。
- 公開版そのものでこれを読んではいない（**未検証**）。公開版での効き目は、リリースの後に読むまで未検証。

### 準備（規則 19 はあたらない）

- `git -C $W diff --stat b80ab95e ed945a9 -- backend frontend/tools` の出力は空（実測）。
- R6 は準備・ステージ・選定・トレンドテンプレートの入力を一つも変えない。準備・選定・トレンドテンプレート・結論のゲートは、VCP の証拠も構造の損切りも読まない（P1・P2 の grep）。
- だから H4 と 908 は再実行していない。このブランチの数は R3b の記録のまま。
  - H4：エントリー 29/588、対照 21/575、+1.3pp（+1.280pp）、G8 の不合格 46／185。
  - 凍結 908：「DISCRIMINATION (entry − control): FIRE±5 +25.8pp, SETUP +52.0pp」。

### 実測（R6-P3。コマンドと結果。時刻は日本時間 11-16。負荷のもとの時間はすべて参考）

`S=/tmp/claude-0/-home-user-screener/c937365f-db46-520a-bbf4-94843e169170/scratchpad`、`T=$S/audit3/r3-verdict`、`H=$S/audit3/r3-harness`、`W=/home/user/screener/.claude/worktrees/r3-verdict`。環境は `PATH=/opt/node22/bin:$PATH`、`FONTCONFIG_FILE=$S/ci-fonts/fonts.conf`、`SESSION_CALENDAR_PYTHON=$S/audit/r1-step0/cal-venv/bin/python`、`FINANCIAL_REPLAY_PYTHON=$S/replay-venv/bin/python`。HEAD はすべて ed945a9（clean）。

| 検査 | コマンド | 時刻・時間 | 結果 | 負荷（前 → 後） |
|---|---|---|---|---|
| 1. 予想した差 | `node $T/r6/p3-expected.mjs > $T/r6/p3-expected.json`（メモ `p3-expected-diff.md`） | 08:12–08:13（ブラウザの前） | 上の 「予想した差」 | — |
| 2. 492 枚の probe | `$H/probe/run-probe.sh $W 4423 ; cmp $H/probe/probe-8849bf9.json $H/probe/probe-ed945a9.json`（`$T/r6/p3-probe.out`） | 08:13–08:16、194 秒 | 492 ラベル・480 値の画面、エラー 0。**バイト単位で同じ**（sha256 b5f29cff…39fa2） | 0.00 → 1.40 |
| 3. オラクルの probe | `$H/probe/run-probe.sh $W 4423 oracles ; node $H/probe/diff.mjs $H/probe/probe-d5b3e42-oracles.json $H/probe/probe-ed945a9-oracles.json --texts`（`$T/r6/p3-probe-oracles.out`、`p3-oracle-diff.txt`） | 08:16–08:18、73 秒 | 8 銘柄、132 ラベル・132 値の画面、エラー 0（sha256 730f4df9…9d80c）。264 枚のうち 32 枚（ZZHB だけ）が違う。上の照合のとおり。予想に無かったのは 1y・320 の 「150」 の 1 つ | 1.24 → 2.22 |
| 4. dump | `$H/dump/run-dump.sh $W 4423 ; cmp $H/dump/dump-8849bf9.json $H/dump/dump-ed945a9.json`（`$T/r6/p3-dump.out`） | 08:19–08:20、102 秒 | 42 画面、エラー 0。**バイト単位で同じ**（sha256 cba0a2f2…c3555） | 0.78 → 0.68 |
| 5. Playwright（注文の 9 ファイル） | `cd $W/frontend && AUDIT_PORT=4423 AUDIT_MATCH='brief-(oracles\|plan\|decision\|invariants\|sell\|watch\|chart\|compact\|phone)\.spec\.js' npx playwright test -c $T/pw.config.mjs`（`$T/r6/p3-pw-ed945a9.out`） | 08:20–08:34、13.9 分 | 275 本：**274 通過・1 skip**。skip は brief-invariants.spec.js:389 の `test.fixme('INTEGRATION: …')` だけ。brief-chart.spec.js（39 本、R6 で初めて走らせた）も通過。brief-oracles.spec.js の 40 本はすべて通過（ZZHB の緑の矢印、ZZPG、ZZRD、R1・R2）。このファイルの `test.fixme(` は 0（3 行目の注釈だけ）、基準からの差は R1・R2 の切り替えの 2 行だけ（`git diff --stat 45603f06 HEAD -- frontend/tests/static/brief-oracles.spec.js`）。やり直しは無し | 0.63 → 3.03 |
| 6. 全部の vitest | `cd $W/frontend && npx vitest run`（`$T/r6/p3-vitest-full-ed945a9.out`） | 08:35–08:39、226 秒 | 250 ファイル・4,054 本：**4,053 通過・1 失敗・skip 0**。失敗は StockChartCard.test.jsx の 「names the contraction marks only when they are drawn…」（版の文字列 v2、CHART の持ち物。P1・P2 と同じ 1 本）。d5b3e42 は 248 ファイル・4,034 本すべて通過。差は R6 の 2 ファイル・20 本（14 ＋ 6） | 1.55 → 5.14 |
| 7. eslint | `cd $W/frontend && npx eslint src/static/bookTechnicalEvidence.js src/static/brief/positionSizing.js src/static/bookTechnicalEvidence.test.js src/static/brief/positionSizing.test.js src/static/bookTechnicalEvidencePivot.test.js src/static/brief/positionSizingBreakout.test.js`（`$T/r6/p3-eslint.out`。注文の 4 つに R6 の新しいテスト 2 つを足した） | 08:39、2 秒 | エラー 0・警告 0 | 3.74 → 3.74 |
| 8. ビルド（規則 21） | `$H/build/run-build.sh $W`（`$H/build/build-ed945a9.json`） | 08:39–08:40、21 秒 | 入口のチャンク **132.23 kB gzip**（raw 378.01）。89116e6 と同じ。d5b3e42 の 131.72 から **R6 で ＋0.51**（P1 ＋0.34、P2 ＋0.17）。R の累計は STEP 0 の 130.28 から ＋1.95。線 134.00 まで 1.77 | 3.44 → 2.89 |
| 9. 準備 | `git -C $W diff --stat b80ab95e HEAD -- backend frontend/tools` | 08:40 | 出力は空 | — |
| 10. 凍結・ほかの持ち物 | `git -C $W diff --stat b80ab95e HEAD`、`python3 -I $S/audit3/check-ownership.py R $W 45603f065f054cd48c812a3003f3a71ffd91cf45` | 08:40 | 5 ファイルだけ：bookTechnicalEvidence.js、そのテスト bookTechnicalEvidencePivot.test.js、positionSizing.js、そのテスト positionSizingBreakout.test.js、docs/round3/verdict.md。`OWNERSHIP OK (R): 46 paths` | — |
| 再構築の数 | `node $T/r6/tally-p3.mjs …`（上の 「再構築での数」） | 08:15、4 秒 | 上の表 | 1.48 → 1.53 |

- 時間はすべて負荷のもとの参考で、時間の検査は無い。
- 再構築の数の集計（ブラウザを使わない Node の 4 秒）は、492 枚の probe の途中で走らせた。注文の 「一つずつ」 から外れたが、probe はバイト単位で同じだった。
- やり直しが要った Playwright は無い。

### 未検証（R6-P3）

- 公開版での数と表示。すべて再構築の数で、公開版での効き目はリリースの後に読むまで未検証。
- 古い公開版の詳細が `se_pivot_date` を持つこと。コードと 8849bf9 の再構築で確かめたが、公開されたファイルは読んでいない。
- 実データの描いた画面（run-render.sh を走らせていない）。ラベルの重なりも含む（HUM・LIND・ADI・RDNT など）。
- ZZHB の VCP カード・試算のカードの描いた文（モデルの出力だけ）。
- 新しい理由 POST_BREAKOUT_LEGS_REASON の画面（P2 のまま。フィクスチャにも再構築にも当たる行が無い）。
- レビュー担当者の区間を持つ行での数（再構築の行には区間が無い）。
- 時間は一つも測っていない（このパッケージに時間の検査は無い）。

### 統合・ほかのトラックへの依頼（ここではしていない）

1. **briefChartModel.footprint()**（CHART・統合）：状態が 'cut' のとき、土台の週数を `vcp.pivotCut.measuredThrough` で終える。今は、土台の高値が上回られていなければ最後の足まで数える（HUM 型）。
2. **StockVcpCard**（CHART・統合）：一般の 「測定できる収縮が2回以上ないため」 に代わる文が要る。
   - 収縮が 1 つだけのとき：調べの案 「収縮は1回のみ（縮小は判定できません・独自算出）」。
   - 上抜けの後の収縮を外したとき：そう言う文。
   - 再構築で、収縮が 1 つの行は 222、そのうち前は 2 つ以上だった行は 57（上の表）。
3. **StockVerdict の VCP のチップ**：色は footprint の `brokeOut`（`vcp.base.brokeOut`、StockVerdict.jsx:149）だけを読む。HUM 型（土台の高値がピボットより上）では、ピボットの上抜けの後も 'zone' のままになりうる。
4. **CONTEXT.md の語彙**（統合で）
   - **上抜けの足（pivot breakout bar／pivot cut）**：ピボットの足より後で、終値がピボットのセントを初めて上回った足。
   - **上抜け後の値動き**：その足からの値動き。自動の収縮には数えない（独自判定）。
5. **写し**：ハーネスの p4 のスクリプトの写しと、デザインの試作は、このモジュールの古い写しを持つ。統合で合わせるか、古いと明記する。
6. **P1・P2 からの依頼（そのまま）**
   - `frontend/src/static/brief/StockChartCard.test.jsx:143` の版の文字列 `'book-technical-evidence-v2'`（CHART）。直すまで全部の vitest でこの 1 本が落ちる（下の表）。
   - 書き出し側の行の欄（P1 で読んで確認。統合で変えるものは無い）。
   - readiness.py の `contraction_unconfirmed`（R3c）は R6 の切れ目を持たない。バックエンドに移すかは指揮者の判断。食い違う行は数えていない。
   - 切れ目の直前の無効な短い区間（HUM・TW・MCBS・PANL・KOF・NTRS）は直していない（P1 の判断待ち）。
7. **新しく見つけたもの（CHART）**：ZZHB の 1y・320 で、150 日線の名前 「150」 が出なくなる（上の照合）。置き場の 「空きが無ければ出さない」 の振る舞いで、priceChart.js は持ち物でない。統合でオラクルの probe を取り直すとき、この 1 枚を予想に入れるか、置き場で直すかを決めてほしい。
8. **注文の前提の訂正**：古い公開版でも、銘柄の画面では切れ目がかかる（上の 「古い公開版」）。

### パッケージ R6-P3 の記録

- コミット：この記録（`docs(round3): record the R6 gates and rebuild counts`）だけ。コードは変えていない。コミットの前に `OWNERSHIP OK (R)`。
- 測った HEAD は ed945a9。この記録の後の HEAD との差は verdict.md だけ。
- 注文と違えたところ
  - eslint に、R6 の新しいテストのファイル 2 つ（bookTechnicalEvidencePivot.test.js、positionSizingBreakout.test.js）を足した。R6 のテストはこの 2 つにあるため。
  - 直らない行の原因に 「se_pivot_price が無い」 を足した。注文の 3 つ（vcp の主パターン、一致する足が無い、se_pivot_date が無い）のうち 2 つは 0 行で、実際の原因の大半がこれだったため。
  - 「古い公開版は状態 unknown で今と同じ」 は書かなかった。コードと再構築がそうならないことを示したため（上の 「古い公開版」）。
  - 再構築の数の集計は、probe と並んで走った（上）。
  - 実データの描いた画面（run-render.sh）は走らせていない。HEAD のスナップショット（約 300 MB）が要り、注文が全部の再構築を禁じているため。
- 片づけ
  - 古くなったこのトラックの出力として、P2 のビルドの `snapshot/trees/89116e6`（40 MB）と `build/npm-build-89116e6`（19 MB）を消した。`build-89116e6.json` とログは P2 の記録が引くので残した。
  - 8849bf9・土台・b80ab95・d5b3e42 の出力と、ほかのトラックの出力は触っていない。
  - 新しい出力は残した：probe-ed945a9（.json と -oracles.json）、dump-ed945a9、build-ed945a9、trees/ed945a9。
  - スクラッチは `$T/r6/` の p3-*（予想・照合・ログ）、tally-p3.mjs、tally-p3-ed945a9.{json,out}、p3-bundle、p3-expect-bundle。コミットしていない。
