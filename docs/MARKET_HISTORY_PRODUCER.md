# 市場履歴のオフライン生成・保存・UI接続

2026-10-13 / 基点 `95ba865dcda5dd9662d1def87ee641d1d2297e98`。
この追加はローカルで明示実行する経路であり、workflowや公開処理には接続していない。
固定 `export-research.mjs`、publisherのpin、財務capture/admission、認証は変更しない。

## 6項目の入力監査

| 項目 | このcheckoutの入力 | 今回の接続範囲・残件 |
|---|---|---|
| 市場全体put/call | 収集・保存済み入力なし | 未取得。機関限定値や13Fオプション件数から代用しない |
| 新高値・新安値 | `bookMarketEvidence`の現銘柄集合による過去価格計算 | 取得日時・当時の母集団識別子が不足。生成日時を取得日時に見せず、新契約へ転記しない |
| S&P500/Nasdaq売り抜け | 既存US benchmarkはSPY/IVV。単一snapshotの独自計算あり | `^GSPC`/`^IXIC`の正式履歴ではない。2指数へ転用せず、IBD準拠と呼ばない |
| 機関保有者増減 | `data/institutional/sec13f.json.gz`と`openfigi.json`の保存済み正式入力 | 今回の対象。銘柄別の報告運用会社CIK数を生成・保存・UI読込みまで接続 |
| ベースcount | 端末localStorageの手動記録 | 個人の確認記録であり公開市場入力ではない。今回は接続しない |
| 突破・接近数 | 固定窓上放れproxy、near_pivot、選別履歴あり | 同じ意味ではない。確認済みの別定義と入力が必要 |

市場系の実配信bundle `frontend/public/static-data` は不在。13F元SEC ZIPとOpenFIGIの完全な原応答も不在。
保存済み13F集計は26,210証券・45,987観測、報告期2026-03-31/06-30、提出集計期限2026-08-31、取得2026-09-28。
一意に対応する3,991銘柄のうち142は1期のみ。TGLSの2 CUSIP衝突は除外する。
集計不能な運用会社・期が2件あり、完全市場coverageとは扱わない。

## 明示実行

リポジトリルートから、プロバイダ通信を行わず保存済み入力だけを読む。

```sh
node frontend/tools/export-market-history.mjs \
  --as-of 2026-10-13 --symbols AMD,TSM,AAPL,NVDA,TGLS \
  --store /tmp/screener-market-history
```

`--as-of`は表示の分析基準日であり、保有日・取得日を新しくする指定ではない。
銘柄を明示し、未対応・曖昧な銘柄は`provenance.selection.unavailable`に理由を保存する。
`--seed`と`--mapping`で別のローカルファイルを指定可能。通常の銘柄別13F取得コマンドは、refresh無しでもmapping通信を行い得るため、この経路では実行しない。

既存の**未公開ローカルbundleコピー**へ接続する場合のみ、同じstore内の既存manifestを明示する。

```sh
node frontend/tools/export-market-history.mjs \
  --as-of 2026-10-13 --symbols AMD,TSM \
  --store /tmp/local-static-data \
  --manifest /tmp/local-static-data/manifest.json
```

USのmanifest分析日が一致する必要がある。通常は`markets.US.assets.market_indicator_history`を設定し、legacy manifestではroot assetsへ設定する。
公開receipt/transportに結び付いたbundleへのattachは拒否し、receiptを更新・作成しない。他市場や財務情報を変更しない。
今回の実キャッシュ保存ではmanifestをattachしていない。attachと画面表示は合成の未公開bundleで検証する。

## データと保存契約

- `market-history-producer.mjs`は元gzipと対応表のbyte SHA-256、SECアーカイブ名・記載SHA、cutoff、保有期、提出範囲、CUSIP、元取得文字列を保持する。記載されたアーカイブSHAは元ZIPとの再照合済みという意味ではない。
- 正のSH保有を報告した運用会社をCIKで集計する既存方法を明記。市場の日次購入者数・ファンド数・保有株数・売買proxyには変換しない。限定された公開アーカイブ範囲なので`approximate:true`とする。
- 非四半期末・逆順・重複期間・不正提出日・配列偽装・疎配列は拒否。件数null/空文字/文字列/0/不正整数と、報告数から不可能な件数は未確認。期の欠落は補完しない。既知の同数差分0・減少は保持する。
- `collected_at`はSEC集計と当該銘柄対応表が揃った時刻（両取得の遅い方）をUTCミリ秒へ切り捨てた表示値。元のマイクロ秒精度はprovenanceに残す。現在時刻は未来値の検査だけに使い、データへ刻印しない。取得時点の資料であり過去当時の公表済みを証明しない。
- snapshotは`market-indicator-snapshot-v1`。`market`、`as_of_date`、既存の`history`契約と`provenance`を含む。異なるsource/cutoff/方法のsnapshotは合流しない。
- `market-history/snapshots/<sha256>.json`をimmutable保存し、`market-history/catalog.json`へ参照を追記。全世代を保持し、同一実行は同じbytesのまま。既存ハッシュ・参照・市場を検証してから書く。ロックで並行writerを拒否し、ファイルごとのatomic renameを使う。跨ファイルの電源断transactionは保証せず、中断時に未参照snapshotが残る可能性はある。stale lockは勝手に削除しない。
- UIはmanifestが選ぶ1snapshot内の四半期履歴を表示する。catalog全世代を選ぶUIや継続収集・自動更新は未実装。

## UI接続と検証境界

市場ページは任意のasset参照がある時、既存のpublication境界とSHA-256検証を使って読み込む。
参照・中身のmarket/as_of/schemaが一致しない場合や読込み失敗時は未取得。旧inline値に戻して数値を復活させない。
参照無しの旧bundleでは既存inline表示を維持する。銘柄別履歴はselectorで1銘柄ずつ表示し、市場合計と混同しない。
保存元の取得日時・cutoff・対象期・部分母集団・未対応銘柄を画面に示す。有効参照なら「データを再確認」で再試行できる。

回帰テストは以下。合成入力と保存済み実入力の検査は分けて記録する。

```sh
cd frontend
node --test tools/market-history.node.mjs tools/institutional-history.node.mjs tools/market-history-store.node.mjs
npm run test:run -- tools/market-history-producer.test.mjs src/static/marketHistoryAsset.test.js src/static/pages/StaticBreadthPage.marketHistory.test.jsx src/static/components/MarketIndicatorHistory.test.jsx
```

Playwrightの`market-history-asset.spec.js`は合成gzip/mappingを実CLIで保存し、そのmanifestとsnapshotをローカルブラウザへ配信する。
375/1440px、明暗、銘柄切替、欠損、古い対象期、ハッシュ破損、日付不一致、同一参照での再試行を検証する。外部リクエストは遮断。
保存済み実キャッシュではAAPL/AMD/NVDA/TSMの全8観測が原入力と一致し、TGLSは未確認。実画面のテスト入力は合成のみで、実配信bundleや本番Designゲートの検証ではない。


## 2026-10-13 追加監査：報告件数の上限と曖昧な公開マーカー

`institutional_holdings.py`の原定義では、`selected[accession]`が1つのCIK/対象期へ対応し、`reports_selected=len(selected)`は採用された提出報告の総数。各銘柄・期の`manager_count`はその報告に含まれるCIK集合の大きさである。したがって`manager_count <= reports_selected`は必要条件となる。超過値を上限へ丸めず、履歴の値とprovenanceの件数をともにnull、`count_state:unknown`へ戻す。

原集計の`filings`も、同じ銘柄・期へ寄与したaccession集合から作られる。adapterでは後方互換のため**欠落を許す任意項目**とするが、存在する場合は非空・own要素が揃う配列・重複なし・空白だけではない文字列を必須とし、`filings.length <= reports_selected`と`manager_count <= filings.length`も必要とする。null/undefined/空配列/疎配列/重複などは未確認。accessionは不透明な識別子として扱い、接頭辞からCIKを推定しない。欠落時も全報告数の上限は適用する。

この2つの上限は必要条件にすぎず、accessionが実際にselected集合へ属することやCIKを原資料から再集計した証明ではない。期別の正確なreport総数もないため、より狭い上限は推定しない。保存済み45,987観測はすべてfilings付きで、既存値に両上限の超過はなかった。

保存先の正式な公開bindingは外部`publication.json`とそこに記載されたmanifest SHA/transportであり、既存のstore/parent receipt・`_transport`拒否は有効なまま。`markets.US.publication`などの保存文字列は現在のruntimeで正式bindingとして信頼されない。今回の修正は、既存5種類のown marker（publication、publication_receipt、publication_authority、data_manifest_sha256、transport）をmanifest rootと選択US entryの双方で拒否する**曖昧入力への保守的hardening**であり、正式な公開検証を突破する脆弱性の修正という主張ではない。未選択市場を再帰探索する範囲には広げない。

拒否は書込み前とlock取得後の両方で確認し、既存snapshot/catalog/manifest bytesを保つ。修正前はstore36中7件、producer67中12件の新対照が失敗し、修正後はproducer68件（追加の一覧件数矛盾対照を含む）・store36件が成功。UIコード・財務ルール・固定exporter・公開gateは無変更。
