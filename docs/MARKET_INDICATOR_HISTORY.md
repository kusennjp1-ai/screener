# 市場指標の履歴：表示契約とローカル監査

2026-10-11 / baseline `8cf7d9b231a5926696d261da51a4bab531f33cfa`

この変更は表示・履歴・欠損処理だけを対象とする。データ取得、財務 capture/admission、年次 EPS、購入条件、公開条件、認証、CI、売り抜け日算定ルールは変更しない。ローカル専用で、push・PR・merge・Actions・公開は実施しない。

## 現コードの監査

| 依頼項目 | baseline の範囲 | 残る不足 |
|---|---|---|
| 市場全体のプットコールレシオ | 実装なし | 市場全体の対象範囲・分子分母・出典が確認できる履歴が必要。機関限定値からの代用不可 |
| 新高値・新安値数 | `bookMarketEvidence.js` が直前251本に対する厳密な高値/安値更新を計算 | 現在公開されている銘柄集合を過去へ適用。当時の全上場銘柄、廃止銘柄、取得日時、構成履歴の識別子はない |
| S&P500 / Nasdaq 売り抜け日 | `backend/app/services/market_regime.py` に独自カウント。静的画面の配信スキャン値はスナップショット | 2指数の履歴経路なし。コード上の説明だけでは正確な IBD 式との一致は証明できない。SPY/QQQ を指数履歴へ改名しない |
| 機関保有者数増減 | `institutional_holdings.py` の13F CIK集計と `institutionalEvidence.js` の2四半期比較 | 購入者数、ファンド数、市場の日次集計ではない。欠測は従来も未確認。既存 comparator は0保有者を未確認にし、同数の差分0は保持する。このルールは変更しない |
| ベースカウント | `bookExitEvidence.js` と `BookExitEvidence.jsx` の銘柄別手動文脈 | 自動認定・市場集計履歴なし |
| エントリー突破・接近数 | 固定20本窓の上放れ proxy とイベント履歴 | 完成VCP・初回エントリーとは異なる。接近件数なし。未知の代理件数でも空イベント配列を「記録なし」としていた |

`frontend/public/static-data` と必要な実市場履歴ファイルはこの checkout に存在しない。市場履歴の追加検証は合成 fixture、backend/golden は既存 checkout の fixture を使用し、外部市場データは取得しない。`/workspace/.agents` は空、repo の `.agents/skills` は存在しない。関連 `.claude/skills/minervini-dev-loop/SKILL.md` と `sandbox-e2e/SKILL.md` を確認。`bd` は未導入。push/full-stack/auth変更を伴う手順は今回の明示スコープにより実施しない。

## 任意の履歴入力

既存 breadth JSON の `payload.market_indicator_history` に渡せる**表示用**の新契約。現行 exporter はこのフィールドを生成しない。欠落時は未取得と表示する。旧 `book_market_evidence` を自動変換・混合しない。

```json
{
  "version": "market-indicator-history-v1",
  "series": [{
    "metric": "put_call_ratio",
    "market": "US",
    "population": "synthetic-only-options-universe-v1",
    "method": "synthetic-only-method-v1",
    "source": "synthetic-only",
    "unit": "ratio",
    "frequency": "daily",
    "scope": "market_wide",
    "instrument": "US",
    "approximate": true,
    "observations": [{
      "date": "2026-10-09",
      "value": 0.72,
      "collected_at": "2026-10-10T01:00:00Z"
    }]
  }]
}
```

例の数値・出典・方法はすべて合成で、実データとして公開してはならない。

| metric | unit | frequency | scope / instrument |
|---|---|---|---|
| put_call_ratio | ratio | daily | market_wide / 対象市場 |
| new_highs, new_lows | stocks | daily | universe / 対象集合 |
| distribution_sp500 | sessions | daily | index / ^GSPC |
| distribution_nasdaq | sessions | daily | index / ^IXIC（Nasdaq Composite） |
| institutional_holders | reporting_managers | quarterly | security / 対象銘柄 |
| base_count | bases | manual | security / 対象銘柄 |
| entry_breakouts, entry_approaches | stocks | daily | universe / 対象集合 |

- `population` は比較対象となる構成を識別する安定したID。対象集合・集計対象の定義が変われば別IDにする。日次の当時構成を確認できない値を市場全体としない。
- `method` は再現可能な算定方法と版、`source` は出典の識別子。`approximate` は明示必須で、false も独立検証や IBD 認定を意味しない。表示側は宣言の真実性まで検証できない。
- 市場・母集団・方法・出典・単位・頻度・scope・instrument・近似区分が違えば別系列。観測行での矛盾する上書きは系列全体を除外する。
- 対象日 `date` と取得日時 `collected_at`（UTC）を分離する。取得日時は公表日時ではない。後日取得された過去の値は「当時知り得た」証拠として使用できない。
- 未取得、空欄、文字列、負数、非有限数、整数でない件数、不明/未来/対象日より前の取得日時は未確認。観測された数値の0は表示可能。取得可能な完全な対象集合の件数でない場合、producer は欠損を0として出力してはならない。部分集合なら、その別母集団を識別し近似と明記する。
- 分析基準日より後の観測は除外。古い値は元の日付で表示し、当日へ繰り越さない。任意の鮮度日数や投資判定を発明しない。
- 完全一致の重複行は1行。同一対象日の値や取得日時が異なる場合は競合として未確認。自動の最新版優先・合計・平均はしない。
- 四半期は13Fの暦四半期末のみ。隣接四半期かつ同一系列の既知値同士だけ差分を表示する。欠四半期をまたがず日次補間もしない。これは表示計算で、既存の institutionalGrowth の判定ルールには接続しない。
- ベースは手動の記録としてのみ扱う。突破/接近の方法や数値閾値は作っていないため、producer の確認済み定義が必要。

## 既存 proxy の修正

- 既知の benchmark 営業日で全銘柄が欠測した場合、その日を履歴に残し、件数/出来高は null、coverage は観測数として0とする。benchmark のない期間に未知の取引カレンダーは作らない。
- 同じ価格日付の重複は、その日以降を rolling window に採用しない。それ以前の有効な prefix は残す。
- 固定した先導株 cohort の `observed < size` では、全体件数 `below50` / `lostLeaderStatus` は null。観測部分だけの `observedBelow50` / `observedLostLeaderStatus` を別に持ち、UIは分母を明記し、実際に観測部分に0件がある場合だけ「部分集計の0件は欠測銘柄も問題がないことを示さない」と補足する。観測数0の場合は部分件数もnull。旧payloadに全体0があっても欠測時は表示しない。
- 独立レビューの再現条件（150銘柄のうち固定45銘柄だけ欠測し、他105銘柄のRS観測は十分）と1銘柄だけ欠測するケースを追加した。完全観測の実測0は保持する。
- 空のイベント配列だけで上放れ0件と判断しない。対象日が履歴内にあること、銘柄が明記され同日同銘柄の重複がないこと、日別イベント件数と既知のproxy件数が一致することを検査する。不整合な一覧は非表示。全日を確認した0件だけ観測母集団内の実測0として表示する。
- 古い latest を completeness フラグだけで最新扱いしない。既存 proxy の取得日時と母集団構成IDが不明であることを明示する。

## 検証と次の作業

追加依存なし：`cd frontend && node --test tools/market-history.node.mjs`。
既存13F合成テスト：`cd frontend/tools && python3 -m unittest test_institutional_holdings -v`。

初回環境は `node_modules` / pytest 未導入で、`vitest: not found`、`eslint: not found`、`vite: not found`、`No module named pytest`。`npm ci --offline` は ENOTCACHED だった。追加依頼に従い、通常の npm registry 接続による `npm ci`（575 packages）と通常の PyPI 接続による `requirements-runtime.txt` + `requirements-test.txt` のvenvインストールで復旧した。認証/ネットワーク許可の追加、アクセス拒否の回避、lockfile/依存定義の変更はない。

ローカルは Node 24.19.0 / npm 11.9.0 / Python 3.12.14 / Chromium 154。CI定義はNode22/Python3.11であり、この実行と同一runtimeではない。Pythonにはlockfileがなく既存の下限指定を含むrequirementsをそのまま解決した。実際の全バージョンを検証パッケージに記録し、`pip check` は成功。backend対象に不要なtheme ML依存は導入していない。

以下はモバイル表示の追加修正前（`91e1495`）に実施した検証。

| 検証 | 結果 |
|---|---|
| 追加依存不要の合成回帰 | 36 passed |
| 既存13F集計 | 5 passed |
| 最終コードの関連Vitest / exporter順序 | 55 passed（7 files） |
| 全Vitest | 最終コードを固定して232 files / 2931 passed |
| ESLint | 0 errors / 6 warnings。6警告はbaselineでも同一 |
| Vite build | 成功。1000kB超chunk警告はbaselineでも再現。static-data不在のためデータexportはskip |
| Golden `make gate-5` | 43 passed |
| backend redline | 262 passed / 1 failed。baselineでも262 passed / 同じ1 failed |
| backend市場regime配線・静的export | 61 passed |
| React実画面（Playwright） | 375px / 1440pxの2 tests成功、両方で明暗テーマを確認。画面キャプチャもローカルで確認 |

backendの既存失敗は `tests/unit/services/test_vcp_footprint.py::test_well_formed_on_real_fixtures`（`ftnt.csv` の `tight_near_highs` がTrueである期待に対しFalse）。別worktreeのbaseline `8cf7d9b` で同じ環境・同じ全redlineコマンドを実行して再現し、今回の変更から切り分けた。期待値・ルールは変更しない。このゲート全体がgreenとは扱わない。

React実画面はローカルViteと合成ルート応答だけで確認した。外部リクエストは遮断し、既存CSSのGoogle Fonts取得も遮断して代替フォントで描画。新規履歴の未取得9系列、実測0と欠損、四半期と取得日時、重複矛盾、別母集団、古い値、部分cohortの全体不明/観測部分0を確認。ページの横はみ出し・pageerrorはなし。当初の全ページ画像だけでは内部表の切れ・固定ナビ下のフォーカスを検出できなかった。追加依頼により、合成データだけの画面画像をLibraryに保存することが許可された。

残作業：出典と公開時点が確認できる実データ契約、指数別履歴 producer、市場全体P/C producer、過去の母集団記録、銘柄別13F/手動ベースの履歴連携、エントリー突破/接近の確認済み定義と producer、実データ検証。契約と欠損表示の改善が完成した段階で、実データ機能や公開準備が完成したという意味ではない。


## モバイル表示の追加監査

375pxの実ブラウザで、ページ幅は375px以内でも履歴表は幅364pxに対して表示領域341pxで、状態列の右端381pxが隠れることを再現した。下端の開閉ボタンにフォーカスすると y768〜812px に残り、固定ナビ y756〜812px と重なった。全ページ画像上の固定ナビ位置だけを根拠にした指摘ではない。

- 700px以下では履歴をラベル付きリスト／定義リストのカードに変更。対象日、値、状態・未確認理由、UTC取得日時を縦に並べ、長い母集団・方法・出典も折り返す。数値正規化・欠損判定・履歴契約は変更しない。
- 市場ページがある時だけルートの scroll-padding を設定し、native focus / scrollIntoView がヘッダー・下ナビを避ける。既存の画面末尾paddingでフッターはナビより上に表示できており、重複したpadding追加や強制focus移動は行わない。
- 全欠測（観測0、部分集計null）ではデータ未取得を説明する。観測部分に実測0がある時だけ0件用の注意文を出す。非ゼロ・部分件数未確認には通常の欠測説明を使う。数値/null・分母・イベント照合は維持。
- ブラウザ検査を内部コンテナ・全履歴セル／カード欄の横幅まで拡張。375/1440px、dark/lightをDOMで確認してから撮影し、リロード後のテーマ初期化も検査する。スクロール前、状態理由、実測0、部分44/45、全欠測0/45、不整合イベント、キーボードfocus、フッターの32枚を保存する。画像はviewport撮影で、位置調整のための追加scrollBy補正は使わない（不具合再現の下端配置だけ除く）。

今回の完成範囲は既存履歴表示の読みやすさ・欠損説明・フォーカスの改善。X風フィード、実市場履歴の取得・継続更新、6項目の実データ機能を完成した扱いにはしない。財務capture/admission/年次EPSや公開条件は無変更。


追加修正後の最終検証：全Vitest 232 files / 2935 passed、関連2 files / 15 passed、依存不要node 36 passed、Playwright 2 passed（各375/1440pxでdark/light）。lint 0 errors / 既存6 warnings、build成功／既存chunk警告。内部表幅・カード欄・上下ナビとfocusの実測も成功。backend/13F/goldenは上記91e1495時点の結果を引き継ぎ、表示修正後の再実行結果とは区別する。Libraryにはこの差分・ログと、別項目に最終32枚＋修正前2枚を保存する。
