# RS Screener — Minervini式スクリーナー

Minervini流トレンドテンプレートと市場環境判定を毎営業日自動で実行し、
スマートフォンで見られる形で配信するスクリーナー。

**アプリURL**: https://kusennjp1-ai.github.io/screener/

## 仕組み

```
GitHub Actions (毎営業日 22:15 UTC = 日本時間 朝7:15)
  └─ screener.py 実行
       ├─ ユニバース取得: S&P500 + NASDAQ-100 (Wikipedia / フォールバックCSV)
       ├─ 株価取得: yfinance (約15ヶ月日足)
       ├─ RSレーティング算出 (IBD流 加重リターン百分位 1-99)
       ├─ トレンドテンプレート8条件 (Stage 2 判定)
       ├─ 市場環境スコア (SPY MA50/200・分配日・ブレッドス → BUY/CAUTION/NO BUY)
       ├─ セクターRS (SPDR 11セクターETF)
       └─ data/screener_latest.json 出力
  └─ GitHub Pages へデプロイ (index.html + JSON)

スマホ → Pages のURLを開くだけで最新データを自動取得
       (ホーム画面に追加すればPWAとしてオフラインでも閲覧可)
```

## 市場環境スコア (0-100)

| 項目 | 配点 |
|---|---|
| SPY > MA200 | 25 |
| SPY > MA50 | 10 |
| MA50 > MA200 | 10 |
| MA200 上向き | 10 |
| MA200超え銘柄比率 (ブレッドス) | 最大25 |
| 分配日の少なさ (直近25営業日) | 最大20 |

- **BUY MODE**: スコア65以上 かつ SPY > MA200
- **CAUTION**: スコア40以上 (分配日6日以上でBUYからも降格)
- **DO NOT BUY**: それ未満

## 手動実行

GitHub の Actions タブ → 「Daily Screener」 → Run workflow。

ローカル検証 (ネットワーク不要):

```bash
python screener.py --selftest
```

## 免責

本ツールは情報提供のみを目的とし、投資勧誘ではありません。
投資判断は自己責任で行ってください。データソース (yfinance) の精度は保証されません。
