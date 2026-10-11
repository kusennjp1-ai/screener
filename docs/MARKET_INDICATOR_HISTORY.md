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

`frontend/public/static-data` と必要な実市場履歴ファイルはこの checkout に存在しない。外部市場データを取得せず、合成 fixture のみで検証した。`/workspace/.agents` は空、repo の `.agents/skills` は存在しない。関連 `.claude/skills/minervini-dev-loop/SKILL.md` と `sandbox-e2e/SKILL.md` を確認。`bd` は未導入。push/full-stack/auth変更を伴う手順は今回の明示スコープにより実施しない。

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
- 固定した先導株 cohort を全件観測できない場合、50日線割れを0件にしない。
- 空のイベント配列だけで上放れ0件と判断しない。評価不能な日や不足のある記録を明示する。実測0も観測できた母集団に限定して表示する。
- 古い latest を completeness フラグだけで最新扱いしない。既存 proxy の取得日時と母集団構成IDが不明であることを明示する。

## 検証と次の作業

追加依存なし：`cd frontend && node --test tools/market-history.node.mjs`。
既存13F合成テスト：`cd frontend/tools && python3 -m unittest test_institutional_holdings -v`。

結果：追加の合成回帰33件と既存13F集計5件が成功。ローカル Chromium 154 で ES module の計算を実行し、9系列、四半期差分、重複矛盾、全欠測を確認した（外部リクエスト0）。これは React の実画面検証ではない。`node --check` と `git diff --check` も成功。

Vitest/ESLint/ビルド、backend redline、golden gate は依存未導入により実行不能。`npm ci --offline` もキャッシュ不足（ENOTCACHED）。外部依存のダウンロードは実施しない。React実画面の確認は未実施：ローカル Chromium は存在するが、React/Vite/MUI/Recharts がなく実アプリを起動できない。追加の JSX テストは、依存が揃う環境で実行する必要がある。

残作業：出典と公開時点が確認できる実データ契約、指数別履歴 producer、市場全体P/C producer、過去の母集団記録、銘柄別13F/手動ベースの履歴連携、エントリー突破/接近の確認済み定義と producer、実データ検証、全必須ゲートと実画面検証。今回のパッケージは公開準備完了の証明ではない。
