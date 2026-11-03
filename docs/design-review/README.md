# デザイン検証の証跡

静的サイトは「今日のブリーフ」だけになった（`#/brief`・`#/brief/list`・`#/brief/watch`・`#/brief/market`・`#/brief/stock/:SYMBOL`）。`Design Acceptance` ワークフロー（ジョブ名 `Real-data design and performance budgets`）は、この新しい画面だけを測る。旧画面（`#/`・`#/compare`・`#/scan`・`#/breadth` など）は撮影しない。

GitHub Pages への新しいUIの公開には、同じコミットで `CI` と `Design Acceptance` の両方が成功していることが必要（`.github/scripts/publication-gate.mjs`）。

## 実行の流れ

1. 公開済みの実データを一度だけ復元する（`select-release-source.mjs design`）。財務引継ぎの準備（`design-financial-carry.mjs prepare`）、`check-design-data`、引継ぎ検証用の比較データ（同一データの生コピー）をそろえる。比較用の旧UIはビルドしない。
2. 現在のUIを Vite でビルドし、データを戻してから公開時と同じ圧縮転送に変換・往復検証する（`design-transport.mjs`）。
3. `frontend/tools/design-review.mjs` が本番 Chromium でブラウザ検査を行う。
4. `frontend/tools/check-design-review.mjs` が結果を判定する。
5. 結果は失敗時も `design-acceptance-<commit>` 成果物に残る（`report.json` とスクリーンショット）。

財務訂正の候補（`FINANCIAL_CANDIDATE_DIR`）が準備された場合は、ブリーフ側に財務表示を検証する契約がまだないため、測定の前に失敗させる（fail closed）。候補は「UNAPPROVED」の診断成果物としてだけ残り、封印（`design-seal`）には進まない。

## ブラウザ検査（brief-design-review-v1）

共通の契約（画面の組み合わせ、必須の撮影キー、予算、文字サイズ `[11,12,13,14,16,20,26,34,42]`、角丸 `[4,8,12,16]`）は `frontend/tools/brief-design-contract.mjs` にまとめ、検査側と判定側が同じものを読む。文字サイズと角丸の値は `src/static/theme/tokens.js` から読む。

- ビルド（`CURRENT_BUILD`、既定 `dist`）を `/screener/` 配下で `127.0.0.1` から配信する。それ以外へのリクエストはすべて中断し、失敗として記録する。Service Worker は使わない。日付は書き換えない（実際のブラウザ時計）。
- 組み合わせは 390/ダーク → 390/ライト → 1440/ダーク → 1440/ライト の順（スマホ優先）。390 はタッチ端末・画素比2で再現する。テーマはアプリが保存する `localStorage` の `screener:color-mode` で指定し、`.brief[data-theme]` が一致することを確かめる。
- 各組み合わせで7画面を撮影する（計28枚、PNG）。
  - `today`：`#/brief`
  - `list`：`#/brief/list`
  - `list-near`：「あと1条件」の絞り込みを押した状態
  - `market`：`#/brief/market`
  - `stock`：最初の候補の行をクリックして開いた銘柄（URLで直接は開かない）
  - `stock-weekly`：チャートの表示期間を「週足2年」に切り替えた状態
  - `watch`：開いた銘柄を ☆ で追加したあとの `#/brief/watch`
  - 候補が1件もない場合は、撮影を省略せず失敗として記録する。
- 撮影ごとの客観検査（1件でも違反があれば停止）：
  - axe-core（wcag2a / wcag2aa / wcag21aa / wcag22aa）の違反 0 件（`.brief` が対象）
  - 操作対象の大きさ：390 で 44px 以上、1440 で 24px 以上（range 入力と文中のリンクは除く）
  - 文字サイズと角丸が上記の段階に収まること（高さの半分以上の角丸は丸型として許可）
  - 数値の前のマイナスに ASCII のハイフンを使っていないこと
  - 横スクロールが出ないこと
  - 390 で固定表示（上のバー＋下のドック）の高さが 110px 以下
  - ページのエラー、コンソールのエラー、HTTP エラーがないこと
  - 画面に `NaN`・`undefined`・`null`・`Infinity` が出ていないこと
  - バーの「分析基準日 YYYY-MM-DD」が、公開されたマニフェストと研究データの基準日と一致すること（両者が食い違う場合も失敗）
  - 読み込み中の表示が60秒以内に消えること
- 機能の検査（停止条件）：
  - 行のクリックで `#/brief/stock/SYM` が開き、チャートにローソク足が60本以上あること。戻る操作で元の画面に戻ること
  - テーマ切替で `data-theme` が反転し、元に戻せること
  - 市場画面に「地合い」と「市場環境の推移」があり、後者がエラー表示になっていないこと
  - 旧アドレス（`#/`→`#/brief`、`#/compare`・`#/scan`→`#/brief/list`、`#/breadth`・`#/groups`・`#/themes`→`#/brief/market`、`#/?symbol=X`→`#/brief/stock/X`）がそれぞれ転送されること
  - 動きを減らす設定（reduced motion）で、銘柄を開いて400ms後に動いているアニメーションがないこと（幅ごとに1回）
  - ☆ を押すとボタンが押下状態になり、通知と「元に戻す」が表示されること
- 速度（CDP で CPU 4倍、390 と 1440 で各3回、中央値）：
  - 遷移後に最初の候補行が見えるまで：3500ms
  - 「候補」タブへの切替：400ms
  - 行のクリックから銘柄が開くまで：1000ms
  - 初回読み込み中の最長タスク：200ms
  - 3500ms・400ms・200ms は旧検査の P1 の値をそのまま使う。銘柄を開く操作は旧検査に相当するものがないため、1000ms とした。
  - 超過は `report.timing_warnings` にだけ記録し、`failures` には入れない（所有者の指示による保留。下記）。測れなかった場合も警告として残す。
- `DESIGN_REVIEW_OUTPUT/report.json` には `schema`・`commit`・`measured_at`・`input_basis`・`groups`・`screens`（`key`・`path`・`viewport`・`theme`・`screenshot`・`failures`・`metrics`）・`functional`・`failures`・`timing`・`timing_warnings` を書く。`failures` が1件でもあれば終了コードは0以外。

## 判定（check-design-review.mjs）

まず客観的な証跡を確かめる。どの経路でも省略しない。

- `schema` が `brief-design-review-v1` であること
- 4つの組み合わせがすべて完了し、必須の28キーがそれぞれ1回ずつ、空でないPNG付きで撮影されていること
- `failures` が空であること

そのうえで、主観的な点数について次のどちらかが必要。

- 現在のUIと一致する日付付きレビュー（下記の形式）。撮影した全キーについて4項目すべて8.0以上と理由があること。
- 所有者による採点の免除（`owner-waiver.json`）。

速度の超過（`timing_warnings`）は、`owner-waiver.json` に所有者の速度に関する指示（`timing_instruction`・`timing_granted_at`）が記録されている場合に限り、`::warning title=Deferred measured timing under the owner waiver::…` として表示したうえで通す。記録がなければ停止する。

### 日付付きレビューの形式

画面を実際に確認した後、日付付きMarkdownに4項目の点数と理由を記録し、同じ内容を日付付きJSONにも保存する。

```json
{
  "observed_commit": "撮影したソースの40桁コミット",
  "reviewer": "レビュー担当と、内部評価であること",
  "evidence_run": "GitHub Actions実行のURL",
  "screens": [{
    "key": "today/390/dark",
    "screenshot": "today-390-dark.png",
    "scores": {
      "design": {"value": 0, "reason": "画像を見てから採点する"},
      "usability": {"value": 0, "reason": "同上"},
      "originality": {"value": 0, "reason": "同上"},
      "content": {"value": 0, "reason": "同上"}
    }
  }]
}
```

上の0点は形式例であり合格記録ではない。採点前の8点入力、未撮影の画面の採点、客観検査の失敗を点数で相殺することはしない。採点後に `frontend/src`・`frontend/index.html`・`frontend/vite.config.js` が変われば、再撮影・再採点が必要。

このフォルダにある 2026-10 の日付付きレビューと `prior-capture-review.*`・`reviewed-prior-capture.md` は旧画面の記録で、現在のUIには一致しない。過去の撮影を再利用する仕組み（prior-capture）と、スクリーニング優先の画像レビュー（`review_policy`）は旧画面とともに廃止した。

## 所有者による採点の免除（owner-waiver.json）

2026-11-01、リポジトリ所有者から「点数はつけなくていいから、自律的に公開まで」との指示があった。これを受けて `docs/design-review/owner-waiver.json` を置いている。

- 免除するのは主観的な4項目の点数と理由だけ。点数は記録しないし、8点以上だったことにもしない。
- 機能・アクセシビリティ・表示の客観検査は免除しない。必須の28画面が同じ実行で撮影されていること、`failures` が空であることが必要。
- 2026-11-02、所有者から「速度の基準超過も保留にして公開してよい」との指示があった（`timing_instruction`）。このため速度の超過は警告として表示し、公開を止めない。速度以外の検査は保留しない。
- 日付付きのレビュー記録が現在のUIに一致する場合は、その記録の検査が優先される。
- ファイルが壊れている・必須項目が欠けている場合は通さない。
- 免除をやめるときは、このファイルを削除する。速度の保留だけをやめるときは `timing_instruction` と `timing_granted_at` を削除する。
- ファイル内の `effect` の説明文は旧画面の検査（2026-10-21 のスクリーニング優先ポリシー）に基づいて書かれている。判定はこのファイルの必須項目だけを読み、`effect` の文面は使わない。
